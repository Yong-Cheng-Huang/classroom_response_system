import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { rankingFixture,freshProof } from '../helpers/ranking.js';
import { preparedActivity } from '../helpers/replacement.js';
import type { RealtimeFrame } from '../../src/shared/realtime.js';

const noPrivate=(data:unknown)=>assert.doesNotMatch(JSON.stringify(data),/"rank"|"version"|receivedAt|submittedAt|receiveOrder|receive_order|requestId|requestHash|sessionId|token_hash|credential_ref|僅作基準/);
async function wait(check:()=>boolean){const deadline=Date.now()+3000;while(!check()){if(Date.now()>deadline)assert.fail('未於測試時限取得結果');await new Promise(done=>setTimeout(done,10));}}

test('11.1／11.2 HTTP 結果矩陣：階段、三種成績、題組一題、角色與查詢越權',async t=>{
 const s=await rankingFixture(t),path=`/api/activities/${s.activityId}/results`,[a,b,c]=s.students;
 assert.equal((await s.call(path,undefined)).status,401);
 const ready=await s.call(path,a);assert.equal(ready.status,200);assert.equal(ready.data.phase,'READY');assert.doesNotMatch(JSON.stringify(ready.data),/"fields"|"prompt"|"answers"|"results"/);noPrivate(ready.data);
 await s.start();
 assert.equal((await s.submit(a!,s.input('group-a','組一成功子題'))).status,200);
 assert.equal((await s.submit(b!,s.input('group-b','組二未成功私有子題'))).status,200);
 assert.equal((await s.submit(c!,s.input('group-c','組三未成功私有子題'))).status,200);
 assert.equal((await s.submit(b!,s.input('single-b','組二單題成功',s.singleQuestion),s.singleQuestion.id)).status,200);
 assert.equal((await s.submit(a!,s.input('single-a','組一單題未成功',s.singleQuestion),s.singleQuestion.id)).status,200);
 for(const [i,subject]of s.students.entries()){
  const running=await s.call(path,subject);assert.equal(running.data.phase,'RUNNING');assert.equal(running.data.ownSubmissions.length,i===2?1:2);noPrivate(running.data);assert.deepEqual((await s.call('/api/activities/current/view',subject)).data,running.data);
  if(i!==0)assert.doesNotMatch(JSON.stringify(running.data),/組一成功子題|組一單題未成功/);
  if(i!==1)assert.doesNotMatch(JSON.stringify(running.data),/組二未成功私有子題|組二單題成功/);
  if(i!==2)assert.doesNotMatch(JSON.stringify(running.data),/組三未成功私有子題/);
 }
 const teacher=await s.call(path,s.teacher);assert.equal(teacher.data.submissions.length,5);assert.match(JSON.stringify(teacher.data),/組二未成功私有子題|組三未成功私有子題|Asia\/Taipei/);
 assert.equal((await s.end()).status,200);
 for(const [i,subject]of s.students.entries()){
  const ended=await s.call(path,subject);assert.equal(ended.data.phase,'ENDED');noPrivate(ended.data);assert.deepEqual((await s.call('/api/activities/current/view',subject)).data,ended.data);
  assert.equal(ended.data.successCount,i<2?1:0);const group=ended.data.results.find((r:{questionId:string})=>r.questionId===s.groupQuestion.id),single=ended.data.results.find((r:{questionId:string})=>r.questionId===s.singleQuestion.id);
  assert.equal(group.status,i===0?'SUCCESS':'SUBMITTED');assert.equal(group.winner.groupNumber,1);assert.equal(group.winner.answers.length,2);
  assert.equal(single.status,i===0?'SUBMITTED':i===1?'SUCCESS':'MISSING');assert.equal(single.winner.groupNumber,2);
  assert.match(JSON.stringify(ended.data),/組一成功子題|組二單題成功/);
  if(i!==0)assert.doesNotMatch(JSON.stringify(ended.data),/組一單題未成功/);
  if(i!==1)assert.doesNotMatch(JSON.stringify(ended.data),/組二未成功私有子題/);
  if(i!==2)assert.doesNotMatch(JSON.stringify(ended.data),/組三未成功私有子題/);
  for(const query of [`?groupId=${s.groups[(i+1)%3]!.id}`,'?role=TEACHER','?includeAll=true']){const r=await s.call(path+query,subject);assert.equal(r.status,400);assert.equal(r.data,undefined);}
  const forged=await s.call(path,subject,undefined,{'X-Role':'TEACHER','X-Group-Id':s.groups[(i+1)%3]!.id});assert.deepEqual(forged.data,ended.data);
 }
 const saved=(await s.call(path,a)).data;await s.restart();assert.deepEqual((await s.call(path,a)).data,saved);
 const version=(s.database.prepare('SELECT version FROM activities').get() as {version:number}).version;await s.activities.replace(s.teacher,preparedActivity(),{activityId:s.activityId,version,confirmed:true});
 assert.equal((await s.call(path,a)).status,401);assert.equal((await s.call(path,s.teacher)).status,409);
});

test('11.4 WebSocket 更新、重新訂閱與重啟快照只公開本組及結束後成功答案',async t=>{
 const s=await rankingFixture(t),sockets:WebSocket[]=[],[a,b,c]=s.students;
 t.after(()=>sockets.forEach(ws=>ws.terminate()));
 async function channel(subject:typeof s.teacher){
  const ticket=await s.call('/api/realtime/ticket',subject,{scope:'activity'});assert.equal(ticket.status,200);
  const ws=new WebSocket(s.base.replace('http:','ws:')+'/ws',['crs.v1','ticket.'+ticket.data.ticket],{origin:s.base});sockets.push(ws);
  const frames:RealtimeFrame[]=[];ws.on('message',raw=>{const data=JSON.parse(raw.toString());if(data.type==='snapshot'||data.type==='update')frames.push(data);});
  await once(ws,'open',{signal:AbortSignal.timeout(3000)});await wait(()=>frames.length>0);return{ws,frames};
 }
 await s.start();const own=await channel(c!),teacher=await channel(s.teacher),before=own.frames.length;
 assert.equal((await s.submit(a!,s.input('winner','成功答案可於結束公開'))).status,200);assert.equal((await s.submit(b!,s.input('loser','禁止洩漏的他組未成功答案'))).status,200);
 await wait(()=>teacher.frames.at(-1)?.data.scope==='activity'&&(teacher.frames.at(-1)!.data.view as {submissions:unknown[]}).submissions.length===2);
 await new Promise(done=>setTimeout(done,200));assert.equal(own.frames.length,before);assert.equal(own.frames.at(-1)!.revision,1);noPrivate(own.frames);
 assert.doesNotMatch(JSON.stringify(own.frames),/成功答案可於結束公開|禁止洩漏/);
 own.ws.terminate();const runningReconnect=await channel(c!);assert.doesNotMatch(JSON.stringify(runningReconnect.frames),/成功答案可於結束公開|禁止洩漏/);noPrivate(runningReconnect.frames);
 assert.equal((await s.call('/api/realtime/ticket',c!,{scope:'activity',groupId:s.groups[1]!.id})).status,400);
 assert.equal((await s.call('/api/realtime/ticket',c!,{scope:'teacher'})).status,400);
 assert.equal((await s.call('/api/realtime/ticket',freshProof(),{scope:'activity'})).status,401);
 assert.equal((await s.end()).status,200);await wait(()=>runningReconnect.frames.at(-1)?.data.view.phase==='ENDED');
 const ended=runningReconnect.frames.at(-1)!.data.view;noPrivate(ended);assert.match(JSON.stringify(ended),/成功答案可於結束公開/);assert.doesNotMatch(JSON.stringify(ended),/禁止洩漏/);
 runningReconnect.ws.terminate();const afterEnd=await channel(c!);assert.deepEqual(afterEnd.frames[0]!.data.view,ended);
 await s.restart();const afterRestart=await channel(c!);assert.deepEqual(afterRestart.frames[0]!.data.view,ended);noPrivate(afterRestart.frames);
 s.setNow(43201000);assert.equal((await s.call(`/api/activities/${s.activityId}/results`,c)).error.code,'SESSION_EXPIRED');assert.equal((await s.call('/api/realtime/ticket',c!,{scope:'activity'})).status,401);
});
