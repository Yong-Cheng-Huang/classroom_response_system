import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openDatabase, type SqliteDatabase } from '../../src/server/database.js';
import { replacePreparedActivity } from '../../src/server/activity-replacement.js';
import { temporaryDatabase } from '../helpers/database.js';
import { preparedActivity, seedOldActivity } from '../helpers/replacement.js';

const expectation = { activityId:'a', version:1, confirmed:true };
function snapshot(database: SqliteDatabase) {
  return ['activities','sources','groups','questions','question_fields','sessions','participants','submissions','submission_answers','export_operations','document_output_management','google_connection','system_state','receive_orders']
    .map(table=>({table,rows:database.prepare(`SELECT * FROM ${table}`).all()}));
}
function checkNew(database:SqliteDatabase) {
  const activity=database.prepare('SELECT id,state,group_count,started_at,ended_at FROM activities').get() as {id:string;state:string;group_count:number;started_at:null;ended_at:null};
  assert.notEqual(activity.id,'a');assert.equal(activity.state,'READY');assert.equal(activity.group_count,3);
  assert.equal(activity.started_at,null);assert.equal(activity.ended_at,null);
  for(const [table,count]of [['activities',1],['sources',1],['groups',3],['questions',2],['question_fields',3],['participants',0],['submissions',0],['submission_answers',0],['export_operations',0]] as const) {
    assert.equal((database.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n,count,table);
  }
  const sessions=database.prepare('SELECT id,lifecycle,expires_at FROM sessions ORDER BY id').all() as {id:string;lifecycle:string;expires_at:number}[];
  assert.deepEqual(sessions.map(s=>[s.id,s.lifecycle]),[['s1','REVOKED'],['s2','REVOKED'],['teacher','CONNECTED']]);
  assert.ok(sessions.every(s=>s.expires_at===43200000));
  assert.equal((database.prepare('SELECT verification FROM document_output_management').get() as {verification:string}).verification,'UNVERIFIED');
  assert.equal((database.prepare('SELECT credential_reference FROM google_connection').get() as {credential_reference:string}).credential_reference,'protected-reference');
  assert.equal((database.prepare('SELECT receive_high_water AS n FROM system_state').get() as {n:number}).n,1);
  assert.equal(database.pragma('integrity_check',{simple:true}),'ok');
  return activity;
}

test('3.5 成功換場同交易清舊資料與撤銷學生，獨立連線證明先落盤再通知',async t=>{
  const {database,path}=temporaryDatabase(t);seedOldActivity(database);
  let calls=0;
  const result=await replacePreparedActivity(database,preparedActivity(),expectation,notice=>{
    calls++;const independent=openDatabase(path);
    try {assert.equal(checkNew(independent).id,notice.activityId);assert.equal(notice.previousActivityId,'a');}
    finally{independent.close();}
  });
  assert.equal(calls,1);assert.equal(result.notification,'DISPATCHED');assert.equal(result.committed,true);
  assert.deepEqual(result.invalidatedSessionIds.sort(),['s1','s2']);checkNew(database);
  assert.equal(JSON.parse((database.prepare('SELECT snapshot_json FROM sources').get() as {snapshot_json:string}).snapshot_json).originalAnswers[0],'僅作基準');
});

test('3.5 最後欄位寫入失敗，全場資料與學生失效一併回滾且不通知',async t=>{
  const {database}=temporaryDatabase(t);seedOldActivity(database);const before=snapshot(database);let notified=false;
  database.exec(`CREATE TRIGGER test_failure BEFORE INSERT ON question_fields WHEN NEW.prompt='新子題二'
    BEGIN SELECT RAISE(ABORT,'injected_last_field_failure'); END;`);
  await assert.rejects(replacePreparedActivity(database,preparedActivity(),expectation,()=>{notified=true;}),{code:'DATABASE_UNAVAILABLE'});
  assert.equal(notified,false);assert.deepEqual(snapshot(database),before);
});

test('3.5 候選最後欄位或 JSON 不合法時完全不碰原場，取消與舊版本亦不改資料',async t=>{
  const {database}=temporaryDatabase(t);seedOldActivity(database);const before=snapshot(database);
  const invalid=preparedActivity();invalid.questions[1]!.fields[1]!.prompt='';
  await assert.rejects(replacePreparedActivity(database,invalid,expectation),{code:'INVALID_REQUEST'});
  const circular=preparedActivity();const loop:Record<string,unknown>={};loop.self=loop;circular.source.snapshot=loop;
  await assert.rejects(replacePreparedActivity(database,circular,expectation),{code:'INVALID_REQUEST'});
  await assert.rejects(replacePreparedActivity(database,preparedActivity(),{...expectation,confirmed:false}),{code:'REPLACEMENT_CONFIRMATION_REQUIRED'});
  await assert.rejects(replacePreparedActivity(database,preparedActivity(),{...expectation,version:2}),{code:'VERSION_CONFLICT'});
  await assert.rejects(replacePreparedActivity(database,preparedActivity(),{...expectation,activityId:'old'}),{code:'ACTIVITY_CHANGED'});
  assert.deepEqual(snapshot(database),before);
});

test('3.5 進行中、寫入中與未確認匯出不可被儲存邊界擅自清除',async t=>{
  const {database}=temporaryDatabase(t);seedOldActivity(database);
  database.prepare("UPDATE activities SET state='RUNNING',ended_at=NULL").run();
  let before=snapshot(database);
  await assert.rejects(replacePreparedActivity(database,preparedActivity(),expectation),{code:'STATE_CONFLICT'});
  assert.deepEqual(snapshot(database),before);
  database.prepare("UPDATE activities SET state='ENDED',ended_at=2000").run();
  for(const state of ['PREPARING','WRITING','UNCONFIRMED']){
    database.prepare('UPDATE export_operations SET state=?').run(state);before=snapshot(database);
    await assert.rejects(replacePreparedActivity(database,preparedActivity(),expectation),{code:state==='UNCONFIRMED'?'EXPORT_RECONCILIATION_REQUIRED':'DOCUMENT_OPERATION_BUSY'});
    assert.deepEqual(snapshot(database),before);
  }
});

test('3.5 通知失敗仍清楚回報已提交，重啟保留完整新場；禁止外層交易提前通知',async t=>{
  const {database,path}=temporaryDatabase(t);seedOldActivity(database);
  database.exec('BEGIN IMMEDIATE');
  await assert.rejects(replacePreparedActivity(database,preparedActivity(),expectation),{code:'INTERNAL_ERROR'});
  database.exec('ROLLBACK');
  const result=await replacePreparedActivity(database,preparedActivity(),expectation,()=>{throw new Error('通知中斷');});
  assert.equal(result.committed,true);assert.equal(result.notification,'PENDING');database.close();
  const reopened=openDatabase(path);try{assert.equal(checkNew(reopened).id,result.activityId);}finally{reopened.close();}
});

test('3.5 首次匯入不需替換確認，組數邊界及完整候選均可保存',async t=>{
  const {database}=temporaryDatabase(t);
  const candidate=preparedActivity();candidate.groupCount=20;
  const result=await replacePreparedActivity(database,candidate,{activityId:null,version:null,confirmed:false});
  assert.equal(result.previousActivityId,null);assert.equal(result.notification,'NOT_REQUESTED');
  assert.equal((database.prepare('SELECT count(*) AS n FROM groups').get() as {n:number}).n,20);
  const before=snapshot(database);candidate.groupCount=21;
  await assert.rejects(replacePreparedActivity(database,candidate,{activityId:result.activityId,version:1,confirmed:true}),{code:'INVALID_REQUEST'});
  assert.deepEqual(snapshot(database),before);
});

test('3.5 換場不復活或改寫已到期身分，老師與最少管理資訊保持',async t=>{
  const {database}=temporaryDatabase(t);seedOldActivity(database);
  database.prepare("UPDATE sessions SET lifecycle='EXPIRED',revoked_reason='原本已到期' WHERE id='s2'").run();
  const result=await replacePreparedActivity(database,preparedActivity(),expectation);
  assert.deepEqual(result.invalidatedSessionIds,['s1']);
  assert.deepEqual(database.prepare("SELECT lifecycle,revoked_reason FROM sessions WHERE id='s2'").get(),{lifecycle:'EXPIRED',revoked_reason:'原本已到期'});
  assert.equal((database.prepare("SELECT lifecycle FROM sessions WHERE id='teacher'").get() as {lifecycle:string}).lifecycle,'CONNECTED');
  assert.equal((database.prepare('SELECT verification FROM document_output_management').get() as {verification:string}).verification,'UNVERIFIED');
});

for(const boundary of ['before','after'] as const)test(`3.5 真程序 SIGKILL：${boundary==='before'?'COMMIT 前恢復完整舊場':'COMMIT 後通知前恢復完整新場'}`,async t=>{
  const {database,path}=temporaryDatabase(t);seedOldActivity(database);const before=snapshot(database);
  const child=spawn(process.execPath,['--import','tsx','tests/helpers/replacement-crash.ts',path,boundary],{stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  await new Promise<void>((done,fail)=>{
    let marker=false,stderr='';
    const timer=setTimeout(()=>{child.kill('SIGKILL');fail(new Error('未到達預定中斷點'));},5000);
    child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.stdout.on('data',chunk=>{if(String(chunk).includes(boundary==='before'?'BEFORE_COMMIT':'AFTER_COMMIT')){marker=true;child.kill('SIGKILL');}});
    child.once('error',error=>{clearTimeout(timer);fail(error);});
    child.once('exit',(_code,signal)=>{clearTimeout(timer);if(marker&&signal==='SIGKILL')done();else fail(new Error(stderr||'中斷位置不符'));});
  });
  database.close();const reopened=openDatabase(path);
  try{if(boundary==='before')assert.deepEqual(snapshot(reopened),before);else checkNew(reopened);}
  finally{reopened.close();}
});
