import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { ActivityService,DocumentOperations } from '../../src/server/activity.js';
import { IdentityService } from '../../src/server/identity.js';
import { createSqliteAllocator } from '../../src/server/command-queue.js';
import { createApplication } from '../../src/server/app.js';
import { readConfig } from '../../src/server/config.js';
import { assertRequestOrigin } from '../../src/server/identity-http.js';
import { readActivityModel } from '../../src/server/read-model.js';
import { openDatabase } from '../../src/server/database.js';
import { temporaryDatabase,seedActivity } from '../helpers/database.js';
import { preparedActivity,seedOldActivity } from '../helpers/replacement.js';
import type { TabProof,SessionGrant } from '../../src/shared/session.js';

const password='activity-test-only-password';
const proof=():TabProof=>({secret:randomBytes(32).toString('hex'),instanceId:randomUUID(),generation:0});
const credential=(p:TabProof,g:SessionGrant):TabProof=>({...p,token:g.token,generation:g.generation});
function fixture(t:Parameters<typeof temporaryDatabase>[0],seed=true){
  const data=temporaryDatabase(t);if(seed){seedActivity(data.database);data.database.exec("UPDATE activities SET state='READY',started_at=NULL");}
  let now=1000;const identity=new IdentityService(data.database,password,()=>now),activities=new ActivityService(data.database,identity,undefined,()=>now);
  const p=proof(),teacher=credential(p,identity.login(password,p));
  return{...data,identity,activities,teacher,tick:(time:number)=>{now=time;},now:()=>now,receipt:createSqliteAllocator(data.database,()=>now)};
}

test('5.1 四階段 × 開始／結束／匯入的合法與非法轉換完整矩陣',async t=>{
  for(const state of ['EMPTY','READY','RUNNING','ENDED'] as const)for(const action of ['start','end','replace'] as const){
    const f=fixture(t,false);let activityId='missing',version=1;
    if(state!=='EMPTY')activityId=(await f.activities.replace(f.teacher,preparedActivity(),{activityId:null,version:null,confirmed:false})).activityId;
    if(state==='RUNNING'||state==='ENDED'){f.tick(2000);f.activities.transition(f.teacher,activityId,version++,'start',f.receipt());}
    if(state==='ENDED'){f.tick(3000);f.activities.transition(f.teacher,activityId,version++,'end',f.receipt(),true);}
    f.tick(4000);
    const valid=action==='replace'?state!=='RUNNING':action==='start'?state==='READY':state==='RUNNING';
    const work=()=>action==='replace'?f.activities.replace(f.teacher,preparedActivity(),{activityId:state==='EMPTY'?null:activityId,version:state==='EMPTY'?null:version,confirmed:state!=='EMPTY'}):Promise.resolve().then(()=>f.activities.transition(f.teacher,activityId,version,action,f.receipt(),true));
    if(valid)await work();else await assert.rejects(work(),{code:state==='EMPTY'?'ACTIVITY_CHANGED':'STATE_CONFLICT'});
  }
});

test('5.1／5.2 完整狀態轉換、全部題目揭露、學生不撤銷、結束須確認且不能重開',async t=>{
  const f=fixture(t),p=proof(),s=credential(p,f.identity.join('a','g1','學生',p));
  const before=f.database.prepare('SELECT * FROM sessions').all();
  assert.equal(f.activities.timing(f.teacher).phase,'READY');
  assert.throws(()=>f.activities.transition(s,'a',1,'start',f.receipt()),{code:'FORBIDDEN'});
  f.tick(2000);assert.equal(f.activities.transition(f.teacher,'a',1,'start',f.receipt()).phase,'RUNNING');
  assert.deepEqual(f.database.prepare('SELECT * FROM sessions').all(),before);
  const model=readActivityModel(f.database,f.identity)!;assert.equal(model.questions.length,2);assert.equal(model.activity.startedAt,2000);
  assert.equal(f.identity.current(s).activityId,'a');
  await assert.rejects(f.activities.replace(f.teacher,preparedActivity(),{activityId:'a',version:2,confirmed:true}),{code:'STATE_CONFLICT'});
  assert.throws(()=>f.activities.transition(f.teacher,'a',2,'end',f.receipt(),false),{code:'INVALID_REQUEST'});
  assert.equal(f.activities.timing(s).phase,'RUNNING');
  f.tick(4000);const ended=f.activities.transition(f.teacher,'a',2,'end',f.receipt(),true);
  assert.equal(ended.endedAt,4000);assert.equal(ended.version,3);
  assert.throws(()=>f.activities.transition(f.teacher,'a',3,'start',f.receipt()),{code:'STATE_CONFLICT'});
  assert.throws(()=>f.activities.transition(f.teacher,'a',3,'end',f.receipt(),true),{code:'STATE_CONFLICT'});
  assert.equal(f.activities.timing(f.teacher).elapsedMs,2000);
});

test('5.2／5.5 重複與過期老師操作不重設時間或越過版本；EMPTY 不可開始',async t=>{
  const f=fixture(t,false);assert.equal(f.activities.timing(f.teacher).phase,'EMPTY');
  assert.throws(()=>f.activities.transition(f.teacher,'a',1,'start',f.receipt()),{code:'ACTIVITY_CHANGED'});
  const imported=await f.activities.replace(f.teacher,preparedActivity(),{activityId:null,version:null,confirmed:false});
  f.tick(2000);f.activities.transition(f.teacher,imported.activityId,1,'start',f.receipt());
  f.tick(3000);assert.throws(()=>f.activities.transition(f.teacher,imported.activityId,1,'start',f.receipt()),{code:'VERSION_CONFLICT'});
  f.activities.transition(f.teacher,imported.activityId,2,'end',f.receipt(),true);
  f.tick(4000);assert.throws(()=>f.activities.transition(f.teacher,imported.activityId,2,'end',f.receipt(),true),{code:'VERSION_CONFLICT'});
  assert.equal(f.activities.timing(f.teacher).startedAt,2000);assert.equal(f.activities.timing(f.teacher).endedAt,3000);
  f.tick(43201000);assert.throws(()=>f.activities.transition(f.teacher,imported.activityId,3,'start',f.receipt()),{code:'SESSION_EXPIRED'});
});

test('5.3 老師授權後成功換場才清資料；保留老師、Google、設定及最少管理，學生失效',async t=>{
  const f=fixture(t,false);seedOldActivity(f.database);
  f.database.exec("UPDATE activities SET state='READY',started_at=NULL,ended_at=NULL");
  const p=proof(),student=credential(p,f.identity.join('a','g2','原學生',p));
  f.database.exec("UPDATE activities SET state='ENDED',started_at=1000,ended_at=2000");
  const expectation={activityId:'a',version:1,confirmed:true};
  const tables=['activities','sessions','participants','submissions','submission_answers','sources','questions','question_fields','export_operations','document_output_management','google_connection','identity_settings'];
  const snapshot=()=>tables.map(table=>f.database.prepare(`SELECT * FROM ${table}`).all());const before=snapshot();
  await assert.rejects(f.activities.replace(student,preparedActivity(),expectation),{code:'FORBIDDEN'});assert.deepEqual(snapshot(),before);
  await assert.rejects(f.activities.replace(f.teacher,preparedActivity(),{...expectation,confirmed:false}),{code:'REPLACEMENT_CONFIRMATION_REQUIRED'});assert.deepEqual(snapshot(),before);
  f.database.exec("CREATE TRIGGER failed_last_field BEFORE INSERT ON question_fields WHEN NEW.prompt='新子題二' BEGIN SELECT RAISE(ABORT,'fixture'); END;");
  await assert.rejects(f.activities.replace(f.teacher,preparedActivity(),expectation),{code:'DATABASE_UNAVAILABLE'});assert.deepEqual(snapshot(),before);f.database.exec('DROP TRIGGER failed_last_field');
  const retained=['google_connection','document_output_management','identity_settings'].map(table=>f.database.prepare(`SELECT * FROM ${table}`).all());
  let notified=false;
  const result=await f.activities.replace(f.teacher,preparedActivity(),expectation,notice=>{
    const independent=openDatabase(f.path);try{assert.equal((independent.prepare('SELECT id FROM activities').get() as {id:string}).id,notice.activityId);notified=true;}finally{independent.close();}
  });
  assert.equal(result.committed,true);assert.equal(notified,true);assert.notEqual(result.activityId,'a');
  for(const table of ['submissions','submission_answers','participants','export_operations'])assert.equal((f.database.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n,0);
  assert.deepEqual(['google_connection','document_output_management','identity_settings'].map(table=>f.database.prepare(`SELECT * FROM ${table}`).all()),retained);
  assert.equal(f.identity.current(f.teacher).role,'TEACHER');assert.throws(()=>f.identity.current(student),{code:'SESSION_ACTIVITY_CHANGED'});
  assert.equal((f.database.prepare('SELECT count(*) AS n FROM groups').get() as {n:number}).n,3);
});

test('5.5 讀取期間另一老師開始／結束時重驗階段版本；不以舊確認換場',async t=>{
  const f=fixture(t),gate=f.activities.replacementGate(f.teacher);assert.equal(gate.status,'CONFIRM_REPLACEMENT');
  f.tick(2000);f.activities.transition(f.teacher,'a',1,'start',f.receipt());
  await assert.rejects(f.activities.replace(f.teacher,preparedActivity(),{...gate.expectation,confirmed:true}),{code:'STATE_CONFLICT'});
  f.tick(3000);f.activities.transition(f.teacher,'a',2,'end',f.receipt(),true);
  await assert.rejects(f.activities.replace(f.teacher,preparedActivity(),{...gate.expectation,confirmed:true}),{code:'VERSION_CONFLICT'});
  assert.equal(f.activities.timing(f.teacher).endedAt,3000);
});

test('5.5 寫入中與未確認匯出提供不同狀態及後續確認意圖介面，不猜測已寫入／已放棄',async t=>{
  const f=fixture(t,false);seedOldActivity(f.database);
  for(const state of ['PREPARING','WRITING','UNCONFIRMED']){
    f.database.prepare('UPDATE export_operations SET state=?').run(state);
    const gate=f.activities.replacementGate(f.teacher);
    assert.equal(gate.status,state==='UNCONFIRMED'?'REQUIRES_RECONCILIATION':'DOCUMENT_BUSY');
    assert.equal(gate.nextAction,state==='UNCONFIRMED'?'RECONCILE_OR_REQUEST_ABANDONMENT_CONFIRMATION':'WAIT');
    assert.deepEqual(Object.keys(gate.operations[0]!).sort(),['id','state']);
    if(gate.status==='REQUIRES_RECONCILIATION')assert.deepEqual(gate.confirmationRequests,[{operationId:'old-export',activityId:'a',expectedVersion:1}]);
    await assert.rejects(f.activities.replace(f.teacher,preparedActivity(),{...gate.expectation,confirmed:true}),{code:state==='UNCONFIRMED'?'EXPORT_RECONCILIATION_REQUIRED':'DOCUMENT_OPERATION_BUSY'});
    assert.equal((f.database.prepare('SELECT id FROM activities').get() as {id:string}).id,'a');
  }
  f.database.exec("UPDATE export_operations SET state='COMPLETED'");let release!:()=>void;
  const held=f.activities.documents.run('test-copy','sheet',()=>new Promise<void>(resolve=>{release=resolve;}));
  try{assert.equal(f.activities.replacementGate(f.teacher).status,'DOCUMENT_BUSY');await assert.rejects(f.activities.replace(f.teacher,preparedActivity(),{activityId:'a',version:1,confirmed:true}),{code:'DOCUMENT_OPERATION_BUSY'});}finally{release();await held;}
  assert.equal(f.activities.replacementGate(f.teacher).status,'CONFIRM_REPLACEMENT');
});

test('5.4 READY／RUNNING／ENDED 重啟時間不變，停機仍累計，已結束固定',async t=>{
  const f=fixture(t);f.database.close();let db=openDatabase(f.path);
  let id=new IdentityService(db,password,f.now);let service=new ActivityService(db,id,undefined,f.now);
  assert.equal(service.timing(f.teacher).elapsedMs,0);f.tick(2000);
  service.transition(f.teacher,'a',1,'start',createSqliteAllocator(db,f.now)());db.close();f.tick(62000);db=openDatabase(f.path);
  id=new IdentityService(db,password,f.now);service=new ActivityService(db,id,undefined,f.now);
  assert.equal(service.timing(f.teacher).elapsedMs,60000);assert.equal(service.timing(f.teacher).startedAt,2000);
  service.transition(f.teacher,'a',2,'end',createSqliteAllocator(db,f.now)(),true);db.close();f.tick(122000);db=openDatabase(f.path);
  try{id=new IdentityService(db,password,f.now);service=new ActivityService(db,id,undefined,f.now);assert.equal(service.timing(f.teacher).elapsedMs,60000);assert.equal(service.timing(f.teacher).endedAt,62000);}finally{db.close();}
});

test('5.5 文件互斥跨 await 有效、失敗釋放，其他文件不阻擋',async()=>{
  const documents=new DocumentOperations();let release!:()=>void;
  const held=documents.run('copy','sheet',()=>new Promise<void>(resolve=>{release=resolve;}));
  assert.equal(documents.busy('copy','sheet'),true);
  await assert.rejects(documents.run('copy','sheet',()=>{}),{code:'DOCUMENT_OPERATION_BUSY'});
  await documents.run('other','sheet',()=>{});release();await held;assert.equal(documents.busy('copy','sheet'),false);
  await assert.rejects(documents.run('copy','sheet',()=>{throw new Error('fixture');}));await documents.run('copy','sheet',()=>{});
});

test('5.2 真 HTTP 同一佇列處理多老師開始／結束、取消及偽造拒絕，原時間不重寫',async t=>{
  const f=fixture(t),app=createApplication(readConfig({TEACHER_PASSWORD:password}),f.database,()=>{}, {
    identity:f.identity,activities:f.activities,now:f.now,authenticate:req=>{assertRequestOrigin(req);return f.identity.principal(f.identity.proof(req));},
    beforeRead:()=>f.identity.sweep(),readModel:()=>readActivityModel(f.database,f.identity),
  });
  const address=await app.listen(0);assert.ok(address&&typeof address==='object');t.after(()=>app.close());
  const base=`http://127.0.0.1:${address.port}`;
  async function post(action:string,body:unknown,p:TabProof=f.teacher){const response=await fetch(base+`/api/activities/a/${action}`,{method:'POST',headers:{Authorization:'Bearer '+p.token,'X-Tab-Proof':p.secret,'X-Document-Instance':p.instanceId,'X-Session-Generation':String(p.generation),'Content-Type':'application/json'},body:JSON.stringify(body)});return{status:response.status,value:await response.json()};}
  const p=proof(),other=credential(p,f.identity.login(password,p));
  f.tick(2000);assert.equal((await post('start',{expectedVersion:1})).status,200);
  f.tick(3000);assert.equal((await post('start',{expectedVersion:1},other)).status,409);
  assert.equal((await post('end',{expectedVersion:2,confirmed:false})).status,400);
  assert.equal(f.activities.timing(f.teacher).phase,'RUNNING');
  assert.equal((await post('end',{expectedVersion:2,confirmed:true},other)).status,200);
  f.tick(4000);assert.equal((await post('end',{expectedVersion:2,confirmed:true})).status,409);
  assert.equal(f.activities.timing(f.teacher).endedAt,3000);
  assert.equal((await post('start',{expectedVersion:3,role:'TEACHER'})).status,400);
});
