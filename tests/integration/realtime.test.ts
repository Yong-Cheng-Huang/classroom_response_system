import {RealtimeService} from '../../src/server/realtime.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { temporaryDatabase,seedActivity } from '../helpers/database.js';
import { IdentityService } from '../../src/server/identity.js';
import { createApplication } from '../../src/server/app.js';
import { readConfig } from '../../src/server/config.js';
import { assertRequestOrigin } from '../../src/server/identity-http.js';
import { readActivityModel } from '../../src/server/read-model.js';
import { persistCompleteSubmission } from '../../src/server/storage.js';
import { createSqliteAllocator } from '../../src/server/command-queue.js';
import { replacePreparedActivity } from '../../src/server/activity-replacement.js';
import { preparedActivity } from '../helpers/replacement.js';
import type { TabProof } from '../../src/shared/session.js';
import type { RealtimeFrame,RealtimeFailure } from '../../src/shared/realtime.js';
import type { TestContext } from 'node:test';
const proof=():TabProof=>({secret:randomBytes(32).toString('hex'),instanceId:randomUUID(),generation:0});
const headers=(p:TabProof)=>({'X-Tab-Proof':p.secret,'X-Document-Instance':p.instanceId,'X-Session-Generation':String(p.generation),...(p.token?{Authorization:'Bearer '+p.token}:{})});
async function setup(t:TestContext){
  const {database,directory}=temporaryDatabase(t);seedActivity(database);database.exec("UPDATE activities SET state='READY',started_at=NULL");
  let now=1000,modelReads=0,beforeReads=0;const identity=new IdentityService(database,'fixture-password',()=>now),logs:string[]=[];
  const app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:'fixture-password'}),database,value=>logs.push(JSON.stringify(value)),{
    identity,now:()=>now,authenticate:r=>{assertRequestOrigin(r);return identity.principal(identity.proof(r));},
    beforeRead:()=>{beforeReads++;identity.sweep();},readModel:()=>{modelReads++;return readActivityModel(database,identity);},
  });
  const address=await app.listen(0);assert.ok(address&&typeof address==='object');t.after(()=>app.close());
  const base=`http://127.0.0.1:${address.port}`;
  const p=proof(),grant=identity.login('fixture-password',p),teacher={...p,token:grant.token,generation:grant.generation};
  const join=(group:string)=>{const p=proof(),g=identity.join('a',group,'同名',p);return{...p,token:g.token,generation:g.generation};};
  async function ticket(p:TabProof,body:unknown={scope:'activity'},extra:Record<string,string>={}){
    const response=await fetch(base+'/api/realtime/ticket',{method:'POST',headers:{...headers(p),'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
    return{status:response.status,...await response.json()};
  }
  async function connect(token:string,autoPong=true){
    const ws=new WebSocket(base.replace('http:','ws:')+'/ws',['crs.v1','ticket.'+token],{origin:base,autoPong});
    const frames:(RealtimeFrame|RealtimeFailure)[]=[];
    ws.on('message',raw=>{const frame=JSON.parse(raw.toString());if(frame.type==='snapshot'||frame.type==='update'||frame.type==='error')frames.push(frame);});ws.on('error',()=>{});
    await once(ws,'open',{signal:AbortSignal.timeout(2500)});t.after(()=>ws.terminate());
    await wait(()=>frames.length>0);return{ws,frames};
  }
  return{database,identity,app,base,teacher,join,ticket,connect,logs,modelReads:()=>modelReads,beforeReads:()=>beforeReads,setNow:(value:number)=>{now=value;}};
}
async function wait(check:()=>boolean){const start=Date.now();while(!check()){if(Date.now()-start>2500)assert.fail('未於測試時限收到通道資料');await new Promise(resolve=>setTimeout(resolve,10));}}
async function closeSocket(ws:WebSocket){
  if(ws.readyState===WebSocket.CLOSED)return;
  const closed=once(ws,'close',{signal:AbortSignal.timeout(2500)});
  ws.close();await closed;
}
async function rejected(base:string,token:string,path='/ws',origin=base){
  const ws=new WebSocket(base.replace('http:','ws:')+path,['crs.v1','ticket.'+token],{origin});
  ws.on('error',()=>{});const [,response]=await once(ws,'unexpected-response',{signal:AbortSignal.timeout(2500)});assert.equal(response.statusCode,401);response.resume();ws.terminate();
}

test('7.1 真 HTTP／WS 一次票證、到期、來源、角色及分頁世代授權；不接受自行選頻道',async t=>{
  const s=await setup(t),student=s.join('g1');
  assert.equal((await s.ticket(proof())).status,401);
  assert.equal((await s.ticket({...student,token:'a'.repeat(64)})).status,401);
  for(const body of [{scope:'teacher'},{scope:'activity',role:'TEACHER'},{scope:'activity',groupId:'g2'},{scope:'activity',activityId:'old'}])assert.equal((await s.ticket(student,body)).status,400);
  assert.equal((await s.ticket(student,undefined,{Origin:'https://example.test'})).status,403);
  const issued=await s.ticket(student);assert.equal(issued.status,200);const connected=await s.connect(issued.data.ticket);
  const first=(connected.frames[0] as RealtimeFrame).data;assert.equal(first.scope,'activity');if(first.scope==='activity')assert.equal(first.view.role,'STUDENT');
  await rejected(s.base,issued.data.ticket);
  const exp=await s.ticket(s.teacher);s.setNow(11000);await rejected(s.base,exp.data.ticket);
  s.setNow(12000);const badOrigin=await s.ticket(s.teacher);await rejected(s.base,badOrigin.data.ticket,'/ws','https://example.test');
  const inUrl=await s.ticket(s.teacher);await rejected(s.base,inUrl.data.ticket,'/ws?token='+s.teacher.token);
  const stale=await s.ticket(student);s.identity.resume({...student,instanceId:randomUUID()});await rejected(s.base,stale.data.ticket);
  for(const secret of [s.teacher.token,student.token,student.secret,issued.data.ticket])assert.ok(!s.logs.join('').includes(secret!));
});

test('7.1 票證後登出／期限／換場仍重驗；既有 socket 收到中文失效後關閉',async t=>{
  const s=await setup(t),student=s.join('g1');
  const a=await s.ticket(s.teacher),b=await s.ticket(student);const connected=await s.connect(a.data.ticket);
  const beforeLogout=await s.ticket(s.teacher);s.identity.logout(s.teacher);await rejected(s.base,beforeLogout.data.ticket);
  await wait(()=>connected.frames.some(frame=>frame.type==='error'));
  assert.equal((connected.frames.at(-1) as RealtimeFailure).code,'SESSION_REVOKED');
  const old=await s.connect(b.data.ticket);await replacePreparedActivity(s.database,preparedActivity(),{activityId:'a',version:1,confirmed:true});
  await wait(()=>old.frames.some(frame=>frame.type==='error'));assert.equal((old.frames.at(-1) as RealtimeFailure).code,'SESSION_ACTIVITY_CHANGED');
  const teacherProof=proof(),grant=s.identity.login('fixture-password',teacherProof),p={...teacherProof,token:grant.token,generation:grant.generation};
  const exp=await s.ticket(p),live=await s.connect(exp.data.ticket);s.setNow(grant.session.expiresAt);
  await wait(()=>live.frames.some(frame=>frame.type==='error'));assert.equal((live.frames.at(-1) as RealtimeFailure).code,'SESSION_EXPIRED');
});

test('7.2 真 SQLite 提交分流：本組與老師更新，他組／大廳無事件無序號變動；失敗交易不推成功',async t=>{
  const s=await setup(t),a=s.join('g1'),b=s.join('g2');
  const clients=await Promise.all([s.teacher,a,b].map(async p=>s.connect((await s.ticket(p)).data.ticket)));
  const lobby=await s.connect((await s.ticket(proof(),{scope:'lobby'})).data.ticket);
  for(const client of clients.slice(1))assert.ok(!JSON.stringify(client.frames).includes('第一個子題'));
  s.database.exec("UPDATE activities SET state='RUNNING',started_at=1000,version=version+1");
  await wait(()=>clients.every(c=>c.frames.length===2)&&lobby.frames.length===2);
  const allocate=createSqliteAllocator(s.database,()=>1100),principal=s.identity.principal(a);assert.equal(principal.role,'STUDENT');if(principal.role!=='STUDENT')return;
  const submission={id:'ws-submission',activityId:'a',questionId:'q',groupId:'g1',participantId:principal.participantId,senderNickname:'同名',...allocate(),rank:1,requestId:'ws-request',requestHash:'fixture',answers:[{fieldId:'f1',text:'本組秘密答案一'},{fieldId:'f2',text:'本組秘密答案二'}]};
  assert.throws(()=>persistCompleteSubmission(s.database,{...submission,answers:submission.answers.slice(0,1)}));
  await new Promise(resolve=>setTimeout(resolve,250));assert.ok(clients.every(c=>c.frames.length===2));
  persistCompleteSubmission(s.database,submission);await wait(()=>clients[0]!.frames.length===3&&clients[1]!.frames.length===3);
  await new Promise(resolve=>setTimeout(resolve,250));assert.equal(clients[2]!.frames.length,2);assert.equal(lobby.frames.length,2);
  const teacher=JSON.stringify(clients[0]!.frames.at(-1)),mine=JSON.stringify(clients[1]!.frames.at(-1));assert.ok(teacher.includes('"rank":1'));assert.ok(mine.includes('本組秘密答案一'));assert.ok(!mine.includes('"rank"'));assert.ok(!mine.includes('receiveOrder'));
  assert.ok(!JSON.stringify(clients[2]!.frames).includes('本組秘密答案'));assert.ok(!JSON.stringify(lobby.frames).includes('本組秘密答案'));
  s.database.exec("UPDATE activities SET state='ENDED',started_at=1000,ended_at=2000,version=version+1");
  await wait(()=>clients[2]!.frames.length===3);assert.ok(JSON.stringify(clients[2]!.frames.at(-1)).includes('本組秘密答案一'));
});

test('7.2 成員／人數變更即時分流；重疊訂閱不重複計人，非法訊息無跨組資料',async t=>{
  const s=await setup(t),a=s.join('g1'),channel=await s.connect((await s.ticket(a)).data.ticket);
  const duplicate=await s.connect((await s.ticket(a)).data.ticket);
  s.join('g1');await wait(()=>channel.frames.length===2&&duplicate.frames.length===2);
  const frame=channel.frames.at(-1) as RealtimeFrame;assert.ok('groups' in frame.data.view);assert.equal(frame.data.view.groups[0]?.memberCount,2); // 沒有正式分頁綁定的 seed 身分不計入讀模型
  assert.equal(frame.data.scope,'activity');if(frame.data.scope==='activity'&&frame.data.view.role==='STUDENT')assert.equal(frame.data.view.members.filter(m=>m.isSelf).length,1);
  channel.ws.send(JSON.stringify({type:'subscribe',groupId:'g2',role:'TEACHER'}));await wait(()=>channel.frames.at(-1)?.type==='error');
  assert.equal((channel.frames.at(-1) as RealtimeFailure).code,'INVALID_REQUEST');
});

test('7.3 快照銜接、重取最新及重連 epoch／channel；換場舊訂閱失效',async t=>{
  const s=await setup(t),a=s.join('g1');
  const teacher=await s.connect((await s.ticket(s.teacher)).data.ticket),student=await s.connect((await s.ticket(a)).data.ticket);
  s.database.exec("UPDATE activities SET state='RUNNING',started_at=1000,version=version+1");
  student.ws.send(JSON.stringify({type:'snapshot'}));await wait(()=>student.frames.some(f=>f.type==='snapshot'&&f.revision>1));
  const frame=student.frames.at(-1) as RealtimeFrame;assert.equal(frame.data.view.phase,'RUNNING');assert.equal(frame.type,'snapshot');
  const reconnect=await s.connect((await s.ticket(a)).data.ticket);const next=reconnect.frames[0] as RealtimeFrame;
  assert.equal(next.serverEpoch,frame.serverEpoch);assert.notEqual(next.channelId,frame.channelId);assert.equal(next.revision,1);assert.equal(next.data.view.phase,'RUNNING');
  s.database.exec("UPDATE activities SET state='ENDED',started_at=1000,ended_at=2000,version=version+1");
  await replacePreparedActivity(s.database,preparedActivity(),{activityId:'a',version:3,confirmed:true});
  await wait(()=>teacher.frames.some(f=>f.type==='snapshot'&&f.activityId!=='a')&&student.frames.some(f=>f.type==='error'));
  assert.ok(!student.frames.some(f=>f.type!=='error'&&f.activityId!=='a'));
});

test('7.4 重疊連線、世代交接與 30 秒持久寬限；HTTP 查詢不延長，截止立即拒絕',async t=>{
  const s=await setup(t),a=s.join('g1');
  const first=await s.connect((await s.ticket(a)).data.ticket),second=await s.connect((await s.ticket(a)).data.ticket);
  const lifecycle=()=>s.database.prepare(`SELECT lifecycle,grace_started_at,grace_deadline FROM sessions WHERE id=?`).get(s.identity.principal(a).sessionId) as {lifecycle:string;grace_started_at:number|null;grace_deadline:number|null};
  await closeSocket(first.ws);assert.equal(lifecycle().lifecycle,'CONNECTED');
  const handed={...a,instanceId:randomUUID()},resumed=s.identity.resume(handed),fresh={...handed,generation:resumed.generation};
  const next=await s.connect((await s.ticket(fresh)).data.ticket);
  await closeSocket(second.ws);
  const owner=s.identity.principal(fresh).sessionId;
  const state=()=>s.database.prepare('SELECT lifecycle,grace_started_at,grace_deadline FROM sessions WHERE id=?').get(owner) as {lifecycle:string;grace_started_at:number|null;grace_deadline:number|null};
  assert.equal(state().lifecycle,'CONNECTED');
  await closeSocket(next.ws);await wait(()=>state().lifecycle==='GRACE');
  assert.deepEqual(state(),{lifecycle:'GRACE',grace_started_at:1000,grace_deadline:31000});
  s.setNow(30999);const response=await fetch(s.base+'/api/session',{headers:headers(fresh)});assert.equal(response.status,200);
  assert.equal(state().grace_deadline,31000);
  const reconnect=await s.connect((await s.ticket(fresh)).data.ticket);assert.equal(state().lifecycle,'CONNECTED');
  await closeSocket(reconnect.ws);await wait(()=>state().lifecycle==='GRACE');assert.equal(state().grace_deadline,60999);
  s.setNow(60999);await wait(()=>state().lifecycle==='REVOKED');assert.equal((await s.ticket(fresh)).error.code,'SESSION_DISCONNECTED');
  assert.equal((s.database.prepare('SELECT membership_state FROM participants WHERE session_id=?').get(owner) as {membership_state:string}).membership_state,'INVALID');
});

test('7.4 原生 ping/pong；不回 pong 的連線偵測中斷，寬限仍保留成員',async t=>{
  const s=await setup(t),a=s.join('g1'),owner=s.identity.principal(a).sessionId;
  const broken=await s.connect((await s.ticket(a)).data.ticket,false);
  const ping=once(broken.ws,'ping',{signal:AbortSignal.timeout(2500)});s.setNow(3000);await ping;
  s.setNow(9000);await wait(()=>broken.ws.readyState===WebSocket.CLOSED);
  const row=s.database.prepare('SELECT lifecycle,grace_started_at,grace_deadline FROM sessions WHERE id=?').get(owner);
  assert.deepEqual(row,{lifecycle:'GRACE',grace_started_at:9000,grace_deadline:39000});
  assert.equal((s.database.prepare('SELECT membership_state FROM participants WHERE session_id=?').get(owner) as {membership_state:string}).membership_state,'JOINED');
  s.setNow(38999);const reconnect=await s.connect((await s.ticket(a)).data.ticket);assert.equal((reconnect.frames[0] as RealtimeFrame).data.view.phase,'READY');
});

test('7.7 授權校時與協定觀測：T_commit、revision、快照恢復；不把收到事件當 UI 驗收',async t=>{
  const s=await setup(t),a=s.join('g1'),client=await s.connect((await s.ticket(a)).data.ticket);
  const requestId=randomUUID();client.ws.send(JSON.stringify({type:'clock',requestId}));
  const [raw]=await once(client.ws,'message',{signal:AbortSignal.timeout(2500)});const clock=JSON.parse(raw.toString());assert.equal(clock.type,'clock');assert.equal(clock.requestId,requestId);assert.equal(clock.serverNow,1000);
  const T_commit=performance.now();s.database.exec("UPDATE activities SET state='RUNNING',started_at=1000,version=version+1");
  // 量測點以交易提交後的單調時間為準；此測試不宣稱 DOM 的 T_apply。
  const committed=performance.now();await wait(()=>client.frames.some(frame=>frame.type==='update'));
  const update=client.frames.find(frame=>frame.type==='update') as RealtimeFrame;
  assert.equal(update.revision,2);const T_protocol=performance.now();
  await closeSocket(client.ws);
  const ready=performance.now(),restored=await s.connect((await s.ticket(a)).data.ticket),T_snapshot=performance.now();
  const snapshot=restored.frames[0] as RealtimeFrame;assert.equal(snapshot.type,'snapshot');assert.equal(snapshot.data.view.phase,'RUNNING');
  const {mkdirSync,writeFileSync}=await import('node:fs');mkdirSync('test-results',{recursive:true});
  writeFileSync('test-results/realtime-protocol.json',JSON.stringify({T_before_commit:T_commit,T_commit:committed,T_protocol,revision:update.revision,T_ready:ready,T_snapshot,
    範圍:'同 Node 單調時鐘；協定接收與授權快照，非 DOM T_apply／42 分頁時限驗收',恢復原組:true},null,2)+'\n');
});


test('13.3 單次同步共用同版權威模型，逐通道仍驗權限且下一次變更即時可見',async t=>{
 const s=await setup(t),clients:{ws:WebSocket;frames:(RealtimeFrame|RealtimeFailure)[]}[]=[];for(let i=0;i<6;i++){const student=s.join(i%2?'g2':'g1');clients.push(await s.connect((await s.ticket(student)).data.ticket));}
 const teacher=await s.connect((await s.ticket(s.teacher)).data.ticket);
 let checks=0;const principal=s.identity.principal.bind(s.identity);s.identity.principal=(...args)=>{checks++;return principal(...args);};
 const readCost=()=>new Promise<{models:number;presence:number;checks:number}>(done=>{
  const flush=RealtimeService.prototype.flush;let captured=false;
  t.mock.method(RealtimeService.prototype,'flush',function(this:RealtimeService){const before=s.modelReads(),presence=s.beforeReads(),auth=checks;flush.call(this);if(!captured){captured=true;done({models:s.modelReads()-before,presence:s.beforeReads()-presence,checks:checks-auth});}});
 });
 const cost=readCost();await (await fetch(s.base+'/api/flush-probe',{method:'POST'})).json();const count=await cost;t.diagnostic('7通道單次flush：'+JSON.stringify(count));assert.deepEqual(count,{models:1,presence:1,checks:7});
 s.database.exec("UPDATE activities SET state='ENDED',started_at=1000,ended_at=2000,version=version+1");await (await fetch(s.base+'/api/health')).json();await wait(()=>teacher.frames.some(f=>'data'in f&&f.data.view.phase==='ENDED'));
 for(const client of clients){await wait(()=>client.frames.some(f=>'data'in f&&f.data.view.phase==='ENDED'));assert.ok(!JSON.stringify(client.frames).includes('receiveOrder'));}
 s.setNow(43201000);await wait(()=>clients.every(c=>c.ws.readyState===WebSocket.CLOSED));
});

test('13.3 有效活動通道每500ms收到無業務資料的計時脈衝；不增revision，到期即停止',async t=>{
 const s=await setup(t),p=s.join('g1'),client=await s.connect((await s.ticket(p)).data.ticket),ticks:unknown[]=[];
 client.ws.on('message',raw=>{const value=JSON.parse(String(raw));if(value.type==='clock-tick')ticks.push(value);});s.setNow(1499);await new Promise(done=>setTimeout(done,120));assert.equal(ticks.length,0);
 s.setNow(1500);await wait(()=>ticks.length===1);assert.deepEqual(ticks,[{type:'clock-tick',serverNow:1500}]);assert.equal(client.frames.length,1);assert.equal((client.frames[0] as RealtimeFrame).revision,1);
 s.setNow(43201000);await wait(()=>client.ws.readyState===WebSocket.CLOSED);assert.equal(ticks.length,1);
});
