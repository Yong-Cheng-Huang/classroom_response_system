import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { openDatabase } from '../../src/server/database.js';
import { IdentityService } from '../../src/server/identity.js';
import { SubmissionService } from '../../src/server/submissions.js';
import { replacePreparedActivity } from '../../src/server/activity-replacement.js';
import { createSqliteAllocator } from '../../src/server/command-queue.js';
import { preparedActivity } from '../helpers/replacement.js';
import { freshProof } from '../helpers/ranking.js';

for(const mode of ['before','after'])test(`8.4／8.6 真 SIGKILL ${mode==='before'?'題組 COMMIT 前回滾':'COMMIT 後尚未回覆'}，接收序號不重用、重送與排名延續`,{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'crs-submission-crash-')),path=join(dir,'classroom.db');let db=openDatabase(path),child:ReturnType<typeof spawn>|undefined;
 try{
  const identity=new IdentityService(db,'crash-ranking-fixture',()=>1000,true);identity.markReady();
  const activity=await replacePreparedActivity(db,preparedActivity(),{activityId:null,version:null,confirmed:false});
  const groups=db.prepare('SELECT id FROM groups ORDER BY number').all() as {id:string}[],question=db.prepare("SELECT id FROM questions WHERE kind='GROUP'").get() as {id:string};
  const fields=db.prepare('SELECT id FROM question_fields WHERE question_id=? ORDER BY position').all(question.id) as {id:string}[];
  const proofs=groups.map((group,i)=>{const initial=freshProof(),g=identity.join(activity.activityId,group.id,'故障測試'+i,initial);return{...initial,token:g.token,generation:g.generation};});
  db.prepare("UPDATE activities SET state='RUNNING',started_at=1000,version=version+1").run();
  const input=(requestId:string,text:string)=>({requestId,answers:fields.map((field,i)=>({fieldId:field.id,text:text+i}))});
  const service=new SubmissionService(db,identity),allocate=createSqliteAllocator(db,()=>1000);
  service.submit(proofs[0]!,activity.activityId,question.id,input('first','原第一名'),allocate());
  const first=db.prepare('SELECT * FROM submissions ORDER BY rank').all();
  const fixture=join(dir,'fixture.json'),second=input('crash-id','第二組題組');
  writeFileSync(fixture,JSON.stringify({proof:proofs[1],activityId:activity.activityId,questionId:question.id,input:second,lastField:fields[1]!.id}),{mode:0o600});
  identity.shutdown();db.close();
  child=spawn(process.execPath,['--import','tsx',resolve('tests/helpers/submission-crash.ts'),path,fixture,mode],{stdio:['ignore','pipe','pipe']});
  const active=child;let output='';
  await new Promise<void>((done,fail)=>{
   const timer=setTimeout(()=>{active.kill('SIGKILL');fail(new Error('子程序未到達故障注入點'));},5000);
   active.stdout!.on('data',chunk=>{output+=chunk.toString();if(output.includes(mode==='before'?'BEFORE_COMMIT':'AFTER_COMMIT_BEFORE_RESPONSE')){clearTimeout(timer);done();}});
   active.once('error',error=>{clearTimeout(timer);fail(error);});active.once('exit',()=>{clearTimeout(timer);if(!output.includes('COMMIT'))fail(new Error('子程序提前結束'));});
  });
  const stopped=new Promise<NodeJS.Signals|null>(done=>active.once('exit',(_code,signal)=>done(signal)));active.kill('SIGKILL');assert.equal(await stopped,'SIGKILL');
  db=openDatabase(path);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.exec('DROP TRIGGER IF EXISTS cut_submission');
  const restart=new IdentityService(db,'crash-ranking-fixture',()=>3000,true);restart.markReady();const restored=new SubmissionService(db,restart),next=createSqliteAllocator(db,()=>3000);
  assert.deepEqual(db.prepare('SELECT * FROM submissions ORDER BY rank LIMIT 1').all(),first);
  const crashOrder=(db.prepare('SELECT receive_high_water AS n FROM system_state').get() as {n:number}).n;assert.equal(crashOrder,2);
  if(mode==='before'){
   assert.equal((db.prepare('SELECT count(*) AS n FROM submissions').get() as {n:number}).n,1);
   assert.equal((db.prepare('SELECT count(*) AS n FROM submission_answers').get() as {n:number}).n,2);
  }else{
   const original=db.prepare('SELECT * FROM submissions WHERE request_id=?').get('crash-id');
   const retry=restored.submit(proofs[1]!,activity.activityId,question.id,second,next());assert.equal(retry.accepted,true);assert.equal(retry.submission.senderNickname,'故障測試1');
   assert.deepEqual(db.prepare('SELECT * FROM submissions WHERE request_id=?').get('crash-id'),original);
  }
  restored.submit(proofs[2]!,activity.activityId,question.id,input('third','重新啟動後'),next());
  const last=db.prepare('SELECT rank,receive_order FROM submissions ORDER BY rank DESC LIMIT 1').get() as {rank:number;receive_order:number};
  assert.equal(last.rank,mode==='before'?2:3);assert.ok(last.receive_order>crashOrder);
  assert.equal((db.prepare('SELECT count(*) AS n FROM submissions WHERE rank=1').get() as {n:number}).n,1);
  restart.shutdown();
 }finally{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');if(db.open)db.close();rmSync(dir,{recursive:true,force:true});}
});
