import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { IdentityService } from '../../src/server/identity.js';
import type { TabProof,SessionGrant } from '../../src/shared/session.js';
import { temporaryDatabase,seedActivity } from '../helpers/database.js';
import { preparedActivity } from '../helpers/replacement.js';
import { replacePreparedActivity } from '../../src/server/activity-replacement.js';
import { createApplication } from '../../src/server/app.js';
import { readConfig } from '../../src/server/config.js';
import { createLogger } from '../../src/server/logger.js';
import { assertRequestOrigin } from '../../src/server/identity-http.js';
import { readActivityModel } from '../../src/server/read-model.js';
import { createSqliteAllocator } from '../../src/server/command-queue.js';
import { persistCompleteSubmission } from '../../src/server/storage.js';

const password='local-test-only-password';
const proof=():TabProof=>({secret:randomBytes(32).toString('hex'),instanceId:randomUUID(),generation:0});
function granted(p:TabProof,g:SessionGrant):TabProof{return{...p,token:g.token,generation:g.generation};}
function ready(database:ReturnType<typeof temporaryDatabase>['database']){seedActivity(database);database.exec("UPDATE activities SET state='READY',started_at=NULL");}

test('4.1 兩老師獨立登入／登出，Google 連結不變；密碼錯誤及缺值拒絕',t=>{
  const {database}=temporaryDatabase(t);const id=new IdentityService(database,password,()=>1000);
  database.exec("INSERT INTO google_connection VALUES(1,'fixture','[]','opaque-reference','CONNECTED')");
  const a=proof(),b=proof(),ga=id.login(password,a),gb=id.login(password,b);
  assert.throws(()=>id.login('incorrect',proof()),{code:'INVALID_PASSWORD'});
  id.logout(granted(a,ga));assert.throws(()=>id.current(granted(a,ga)),{code:'SESSION_REVOKED'});
  assert.equal(id.current(granted(b,gb)).role,'TEACHER');
  assert.equal((database.prepare('SELECT state FROM google_connection').get() as {state:string}).state,'CONNECTED');
  const missing=new IdentityService(database,undefined,()=>1000);
  assert.throws(()=>missing.login('',proof()),{code:'TEACHER_PASSWORD_REQUIRED'});
});
test('4.2 雙憑證交接只增一世代；錯誤第二憑證、舊文件與延遲回覆不能取得權限',t=>{
  const {database}=temporaryDatabase(t);const id=new IdentityService(database,password,()=>1000),p=proof(),g=id.login(password,p),owned=granted(p,g);
  const next={...owned,instanceId:randomUUID()};const resumed=id.resume(next);
  assert.equal(resumed.generation,2);assert.equal(id.resume(next).generation,2);
  assert.throws(()=>id.principal(owned),{code:'STALE_DOCUMENT'});
  assert.throws(()=>id.resume({...owned,instanceId:randomUUID()}),{code:'STALE_DOCUMENT'});
  assert.throws(()=>id.resume({...next,secret:proof().secret}),{code:'UNAUTHORIZED'});
  const recovered={...next,generation:id.ownership(next).generation};assert.equal(id.current(recovered).role,'TEACHER');
  const stored=JSON.stringify(database.prepare('SELECT * FROM sessions JOIN tab_bindings ON session_id=id').all());
  assert.ok(!stored.includes(g.token));assert.ok(!stored.includes(p.secret));assert.ok(!stored.includes(password));
});
test('4.3 固定期限：重整、重連與正常停機不延長，屆滿與寬限同時發生先到期',t=>{
  const {database}=temporaryDatabase(t);let now=1000;let id=new IdentityService(database,password,()=>now,true);id.markReady();
  const p=proof(),g=id.login(password,p),owned=granted(p,g);const expires=g.session.expiresAt;
  now+=100;const changed={...owned,instanceId:randomUUID()};const r=id.resume(changed);
  assert.equal(r.session.expiresAt,expires);id.shutdown();
  now+=1000;id=new IdentityService(database,password,()=>now,true);id.markReady();
  assert.equal(id.current({...changed,generation:r.generation}).expiresAt,expires);
  assert.equal((database.prepare('SELECT lifecycle FROM sessions').get() as {lifecycle:string}).lifecycle,'GRACE');
  id.channelConnected({...changed,generation:r.generation});
  now=expires;assert.throws(()=>id.current({...changed,generation:r.generation}),{code:'SESSION_EXPIRED'});
  id.shutdown();id=new IdentityService(database,password,()=>now,true);id.markReady();
  assert.throws(()=>id.resume(owned),{code:'SESSION_EXPIRED'});id.shutdown();
});
test('4.3 變更密碼僅撤銷老師；學生、活動、答案與固定期限保留',t=>{
  const {database}=temporaryDatabase(t);ready(database);
  const id=new IdentityService(database,password,()=>1000),a=proof(),b=proof(),s=proof();
  const ga=id.login(password,a),gb=id.login(password,b),gs=id.join('a','g1','同名',s);
  database.exec("UPDATE activities SET state='RUNNING',started_at=1000");
  persistCompleteSubmission(database,{id:'password-survival',activityId:'a',questionId:'q',groupId:'g1',participantId:gs.session.participantId!,senderNickname:'同名',
    ...createSqliteAllocator(database,()=>1100)(),rank:1,requestId:'password-test',requestHash:'fixture-hash',answers:[{fieldId:'f1',text:'答案一'},{fieldId:'f2',text:'答案二'}]});
  const data=['activities','submissions','submission_answers'].map(table=>database.prepare(`SELECT * FROM ${table}`).all());
  const changed=new IdentityService(database,'new-test-password',()=>2000);
  for(const p of [granted(a,ga),granted(b,gb)])assert.throws(()=>changed.current(p),{code:'SESSION_PASSWORD_CHANGED'});
  assert.deepEqual(['activities','submissions','submission_answers'].map(table=>database.prepare(`SELECT * FROM ${table}`).all()),data);
  assert.equal(changed.current(granted(s,gs)).expiresAt,gs.session.expiresAt);
  assert.throws(()=>changed.login(password,proof()),{code:'INVALID_PASSWORD'});
  assert.equal(changed.login('new-test-password',proof()).session.role,'TEACHER');
});
test('4.4 同名是不同身分；入組拒改，READY 離組後可改名／換組，開始後不可離／新入',t=>{
  const {database}=temporaryDatabase(t);ready(database);const id=new IdentityService(database,password,()=>1000),a=proof(),b=proof();
  const ga=id.join('a','g1',' 同名 ',a),gb=id.join('a','g1','同名',b);
  assert.notEqual(ga.session.participantId,gb.session.participantId);assert.equal(ga.session.nickname,'同名');
  assert.throws(()=>database.prepare('UPDATE participants SET nickname=? WHERE id=?').run('改名',ga.session.participantId),/joined_nickname_immutable/u);
  assert.throws(()=>id.join('a','g2','另名',a),{code:'SESSION_EXISTS'});
  id.leave(granted(a,ga));const second=id.join('a','g2','另名',a);assert.equal(second.session.groupId,'g2');
  database.exec("UPDATE activities SET state='RUNNING',started_at=1000");
  assert.throws(()=>id.leave(granted(a,second)),{code:'STATE_CONFLICT'});
  assert.throws(()=>id.join('a','g2','新生',proof()),{code:'STATE_CONFLICT'});
});
test('4.7 換場、到期、已知斷線逾期是不同原因；舊憑證均不復活',async t=>{
  const {database}=temporaryDatabase(t);ready(database);let now=0;
  const id=new IdentityService(database,password,()=>now),a=proof(),b=proof(),c=proof();
  const gb=id.join('a','g1','到期',b);now=1000;
  const ga=id.join('a','g1','新活動',a),gc=id.join('a','g2','斷線',c);
  database.prepare("UPDATE sessions SET lifecycle='GRACE',grace_started_at=1000,grace_deadline=31000 WHERE token_hash=(SELECT token_hash FROM sessions JOIN participants ON session_id=sessions.id WHERE participants.id=?)").run(gc.session.participantId);
  now=31000;assert.throws(()=>id.current(granted(c,gc)),{code:'SESSION_DISCONNECTED'});
  now=gb.session.expiresAt;
  assert.throws(()=>id.current(granted(b,gb)),{code:'SESSION_EXPIRED'});
  await replacePreparedActivity(database,preparedActivity(),{activityId:'a',version:1,confirmed:true});
  assert.throws(()=>id.resume(granted(a,ga)),{code:'SESSION_ACTIVITY_CHANGED'});
  assert.throws(()=>id.resume(granted(c,gc)),{code:'SESSION_DISCONNECTED'});
});
test('D38／U01 不明中斷依已提交狀態恢復；原期限不延長、到期不復活',t=>{
  const {database}=temporaryDatabase(t);ready(database);let now=1000;
  const original=new IdentityService(database,password,()=>now,true);original.markReady();const p=proof(),g=original.join('a','g1','保留',p);
  now=60000;const restarted=new IdentityService(database,password,()=>now,true);restarted.markReady();
  assert.equal(restarted.current(granted(p,g)).expiresAt,g.session.expiresAt);
  assert.equal((database.prepare('SELECT grace_deadline FROM sessions WHERE id=(SELECT session_id FROM participants WHERE id=?)').get(g.session.participantId) as {grace_deadline:number}).grace_deadline,90000);
  restarted.channelConnected(granted(p,g));restarted.assertPresenceKnown();
  assert.equal((database.prepare('SELECT membership_state FROM participants WHERE id=?').get(g.session.participantId) as {membership_state:string}).membership_state,'JOINED');
  now=g.session.expiresAt;assert.throws(()=>restarted.current(granted(p,g)),{code:'SESSION_EXPIRED'});restarted.shutdown();
});
test('固定埠已占用的第二程序不撤銷原服務身分，也不修改原停機證據',async t=>{
  const {database,directory}=temporaryDatabase(t);ready(database);
  const config=readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:password});
  const original=new IdentityService(database,password,()=>1000,true);
  const app=createApplication(config,database,()=>{});const address=await app.listen(0);
  assert.ok(address&&typeof address==='object');original.markReady();t.after(()=>app.close());
  const a=proof(),s=proof(),ga=original.login(password,a),gs=original.join('a','g1','原學生',s);
  const tables=['identity_settings','sessions','tab_bindings','runtime_state'];
  const before=tables.map(table=>database.prepare(`SELECT * FROM ${table}`).all());
  const failedIdentity=new IdentityService(database,'other-attempt-password',()=>2000,true);
  const failedApp=createApplication(config,database,()=>{});
  await assert.rejects(failedApp.listen(address.port),{code:'EADDRINUSE'});
  await failedApp.close().catch(()=>{});failedIdentity.shutdown();
  assert.deepEqual(tables.map(table=>database.prepare(`SELECT * FROM ${table}`).all()),before);
  assert.equal(original.current(granted(a,ga)).role,'TEACHER');assert.equal(original.current(granted(s,gs)).role,'STUDENT');
});
test('4.1／4.6 真實 HTTP：伺服器權威角色、來源防護、他組／舊場及安全投影',async t=>{
  const {database,directory}=temporaryDatabase(t);ready(database);const id=new IdentityService(database,password,()=>1000),logs:string[]=[];
  const app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:password}),database,createLogger(line=>logs.push(line)),{
    identity:id,now:()=>1000,authenticate:req=>{assertRequestOrigin(req);return id.principal(id.proof(req));},
    beforeRead:()=>id.sweep(),readModel:()=>readActivityModel(database,id),
  });
  const address=await app.listen(0);assert.ok(address&&typeof address==='object');t.after(()=>app.close());
  const base=`http://127.0.0.1:${address.port}`;
  async function call(path:string,p:TabProof|undefined,body?:unknown,method=body===undefined?'GET':'POST',extra:Record<string,string>={}){
    const response=await fetch(base+path,{method,headers:{...(p?{'X-Tab-Proof':p.secret,'X-Document-Instance':p.instanceId,'X-Session-Generation':String(p.generation),...(p.token?{Authorization:'Bearer '+p.token}:{})}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
    return{status:response.status,value:await response.json(),coop:response.headers.get('cross-origin-opener-policy')};
  }
  const teacher=proof(),student=proof();const login=await call('/api/teacher/login',teacher,{password});assert.equal(login.status,200);assert.equal(login.coop,'noopener-allow-popups');
  const pt=granted(teacher,login.value.data);const join=await call('/api/activities/a/join',student,{groupId:'g1',nickname:'組員'});assert.equal(join.status,200);const ps=granted(student,join.value.data);
  assert.equal((await call('/api/activities/current/view',undefined)).status,401);
  const view=await call('/api/activities/current/view',ps);assert.equal(view.value.data.role,'STUDENT');assert.ok(!JSON.stringify(view.value.data).includes('第一個子題'));
  for(const [path,body]of [['/api/activities/a/start',{expectedVersion:1}],['/api/activities/a/end',{expectedVersion:1,confirmed:true}],['/api/session/logout',{}]] as const)assert.equal((await call(path,ps,body)).status,403);
  assert.equal((await call('/api/session/nickname',ps,{nickname:'篡改'},'PATCH')).status,403);
  assert.equal((await call('/api/activities/current/view?groupId=g2',ps)).status,400);
  assert.equal((await call('/api/activities/old/results',ps)).value.error.code,'ACTIVITY_CHANGED');
  assert.equal((await call('/api/activities/a/join',proof(),{groupId:'g2',nickname:'偽造',role:'TEACHER'})).status,400);
  assert.equal((await call('/api/session',ps,undefined,'GET',{Origin:'http://example.test'})).status,403);
  assert.equal((await call('/api/session',{...ps,secret:proof().secret})).status,401);
  assert.equal((await call('/api/session',pt)).value.data.role,'TEACHER');
  assert.ok(!logs.join('').includes(password));assert.ok(!logs.join('').includes(pt.token!));assert.ok(!logs.join('').includes(ps.secret));
});

test('7.5／D38 舊版待確認紀錄可依新政策恢復；正常停機在截止點先保存撤銷',t=>{
  const {database}=temporaryDatabase(t);ready(database);let now=1000;
  const id=new IdentityService(database,password,()=>now,true);id.markReady();const a=proof(),b=proof(),ga=id.join('a','g1','原身分',a),gb=id.join('a','g2','已逾期',b);
  const pa=granted(a,ga),pb=granted(b,gb),oa=id.principal(pa),ob=id.principal(pb);
  id.channelDisconnected({...ob,generation:pb.generation,instanceId:pb.instanceId});now=31000;id.shutdown();
  assert.equal((database.prepare('SELECT lifecycle FROM sessions WHERE id=?').get(ob.sessionId) as {lifecycle:string}).lifecycle,'REVOKED');
  database.prepare('UPDATE sessions SET shutdown_evidence_json=? WHERE id=?').run(JSON.stringify({kind:'UNRESOLVED_RESTART'}),oa.sessionId);
  now=60000;const restart=new IdentityService(database,password,()=>now,true);restart.markReady();
  assert.equal(restart.current(pa).participantId,ga.session.participantId);assert.equal(restart.current(pa).expiresAt,ga.session.expiresAt);
  assert.throws(()=>restart.current(pb),{code:'SESSION_DISCONNECTED'});
  const row=database.prepare('SELECT lifecycle,grace_deadline,shutdown_evidence_json FROM sessions WHERE id=?').get(oa.sessionId) as {lifecycle:string;grace_deadline:number;shutdown_evidence_json:string};
  assert.equal(row.lifecycle,'GRACE');assert.equal(row.grace_deadline,90000);assert.equal(JSON.parse(row.shutdown_evidence_json).policy,'D38');
  now=90000;assert.throws(()=>restart.resume(pa),{code:'SESSION_DISCONNECTED'});restart.shutdown();
});
