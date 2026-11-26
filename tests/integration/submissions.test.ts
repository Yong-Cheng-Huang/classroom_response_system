import test from 'node:test';
import assert from 'node:assert/strict';
import { rankingFixture,freshProof } from '../helpers/ranking.js';
import { preparedActivity } from '../helpers/replacement.js';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { rankingHeaders } from '../helpers/ranking.js';
async function wait(check:()=>boolean){const deadline=Date.now()+3000;while(!check()){if(Date.now()>deadline)assert.fail('未於測試時限完成');await new Promise(done=>setTimeout(done,5));}}

test('8.1 授權、活動、階段、欄位與可見字元；不合法不占名次，欄位錯誤可定位',async t=>{
  const s=await rankingFixture(t),a=s.students[0]!,b=s.students[1]!;
  assert.equal((await s.submit(a,s.input('not-running'))).error.code,'STATE_CONFLICT');
  await s.start();
  assert.equal((await s.submit(freshProof(),s.input('unauthorized'))).status,401);
  assert.equal((await s.submit(s.teacher,s.input('teacher'))).status,403);
  for(const extra of [{groupId:s.groups[1]!.id},{participantId:'other'},{rank:1},{receivedAt:0},{role:'TEACHER'}])assert.equal((await s.submit(a,{...s.input('forged'),...extra})).status,400);
  assert.equal((await s.call(`/api/activities/old/questions/${s.groupQuestion.id}/submissions`,a,s.input('old'))).error.code,'ACTIVITY_CHANGED');
  assert.equal((await s.submit(a,s.input('unknown-question'),'unknown')).status,404);
  for(const answers of [[],[{fieldId:s.groupQuestion.fields[0]!.id,text:'只有第一子題'}],[{fieldId:s.singleQuestion.fields[0]!.id,text:'別題'}]]){
    const r=await s.submit(a,{requestId:'missing',answers});assert.equal(r.error.code,'INCOMPLETE_ANSWERS');assert.ok(r.error.fieldIds.length>0);
  }
  for(const text of ['', ' \n ', '👨‍👩‍👧‍👦'.repeat(201)]){
    const body=s.input('invalid');body.answers[0]!.text=text;const r=await s.submit(a,body);assert.equal(r.error.code,'INVALID_ANSWER');assert.deepEqual(r.error.fieldIds,[s.groupQuestion.fields[0]!.id]);
  }
  assert.equal(s.rows().length,0);assert.equal((s.database.prepare('SELECT count(*) AS n FROM submission_answers').get() as {n:number}).n,0);
  const valid=s.input('length-200');valid.answers[0]!.text='  '+'👨‍👩‍👧‍👦'.repeat(200)+'  ';valid.answers[1]!.text=' 一 ';
  const success=await s.submit(b,valid);assert.equal(success.status,200);assert.equal(success.data.submission.answers[1].text,'一');assert.equal(s.rows()[0]!.rank,1);
  assert.doesNotMatch(JSON.stringify(success.data),/rank|receiveOrder|receivedAt|submittedAt/);
  s.setNow(43201000);assert.equal((await s.submit(a,s.input('expired'))).error.code,'SESSION_EXPIRED');assert.equal(s.rows().length,1);
});

test('8.2 SQLite 最後子題寫入失敗整筆回滾，重試只有一個名次與時間',async t=>{
  const s=await rankingFixture(t);await s.start();
  s.database.exec("CREATE TRIGGER fail_last BEFORE INSERT ON submission_answers WHEN NEW.field_id='"+s.groupQuestion.fields[1]!.id+"' BEGIN SELECT RAISE(ABORT,'fixture-private-sql-error'); END;");
  const first=await s.submit(s.students[0]!,s.input('atomic'));
  assert.equal(first.status,503);assert.equal(first.error.code,'DATABASE_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(first),/fixture-private|SQLITE|stack|INSERT/);
  assert.equal(s.rows().length,0);assert.equal((s.database.prepare('SELECT count(*) AS n FROM submission_answers').get() as {n:number}).n,0);
  const high=(s.database.prepare('SELECT receive_high_water AS n FROM system_state').get() as {n:number}).n;
  s.database.exec('DROP TRIGGER fail_last');const second=await s.submit(s.students[0]!,s.input('atomic'));
  assert.equal(second.status,200);assert.equal(s.rows().length,1);assert.equal(s.rows()[0]!.rank,1);assert.ok(s.rows()[0]!.receive_order>high);
  assert.equal((s.database.prepare('SELECT count(*) AS n FROM submission_answers').get() as {n:number}).n,2);
});

test('8.3 同組多人競爭僅首次有效者成功；其他組與其他題仍可提交',async t=>{
  const s=await rankingFixture(t),mate=await s.join(0,'第一組乙');await s.start();
  const responses=await Promise.all([s.submit(s.students[0]!,s.input('a','甲的答案')),s.submit(mate,s.input('b','乙的答案'))]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(responses.find(r=>r.status===409)!.error.code,'ALREADY_SUBMITTED');
  assert.equal(s.rows().length,1);assert.equal(s.rows()[0]!.rank,1);
  assert.equal((await s.submit(s.students[1]!,s.input('other-group'))).status,200);assert.equal(s.rows().find(r=>r.group_id===s.groups[1]!.id)!.rank,2);
  assert.equal((await s.submit(mate,s.input('another-question','另一題',s.singleQuestion),s.singleQuestion.id)).status,200);
  assert.equal(s.rows().find(r=>r.question_id===s.singleQuestion.id)!.rank,1);
});

test('8.4 同毫秒競爭、無效缺口、重啟第三名與換場接收序號延續',async t=>{
  const s=await rankingFixture(t);await s.start();
  const invalid=s.input('invalid');invalid.answers[0]!.text='';assert.equal((await s.submit(s.students[0]!,invalid)).status,400);
  const answers=await Promise.all([s.submit(s.students[1]!,s.input('second-group'),s.groupQuestion.id,{'X-Client-Time':'9999999999999'}),s.submit(s.students[0]!,s.input('first-group'),s.groupQuestion.id,{'X-Client-Time':'-1'})]);assert.ok(answers.every(r=>r.status===200));
  const before=s.rows();assert.deepEqual(before.map(r=>r.rank),[1,2]);assert.equal(before[0]!.received_at,before[1]!.received_at);assert.ok(before[0]!.receive_order<before[1]!.receive_order);
  s.setNow(2000);await s.restart(false);assert.deepEqual(s.rows(),before);
  assert.equal((await s.submit(s.students[2]!,s.input('third-group'))).status,200);assert.equal(s.rows()[2]!.rank,3);assert.deepEqual(s.rows().slice(0,2),before);
  assert.equal((await s.end()).status,200);
  const high=(s.database.prepare('SELECT receive_high_water AS n FROM system_state').get() as {n:number}).n;
  const version=(s.database.prepare('SELECT version FROM activities').get() as {version:number}).version;
  const replacement=await s.activities.replace(s.teacher,preparedActivity(),{activityId:s.activityId,version,confirmed:true});
  assert.equal(s.rows().length,0);assert.equal((s.database.prepare('SELECT receive_high_water AS n FROM system_state').get() as {n:number}).n,high);
  assert.equal((await s.submit(s.students[0]!,s.input('old-after-replace'))).error.code,'SESSION_ACTIVITY_CHANGED');
  assert.equal((s.database.prepare('SELECT id FROM activities').get() as {id:string}).id,replacement.activityId);
  const initial=freshProof(),newGroup=s.database.prepare('SELECT id FROM groups ORDER BY number LIMIT 1').get() as {id:string};
  const joined=await s.call(`/api/activities/${replacement.activityId}/join`,initial,{groupId:newGroup.id,nickname:'新場次'});assert.equal(joined.status,200);
  const proof={...initial,token:joined.data.token,generation:joined.data.generation};
  assert.equal((await s.call(`/api/activities/${replacement.activityId}/start`,s.teacher,{expectedVersion:1})).status,200);
  const q=s.database.prepare("SELECT id FROM questions WHERE kind='SINGLE'").get() as {id:string},f=s.database.prepare('SELECT id FROM question_fields WHERE question_id=?').get(q.id) as {id:string};
  assert.equal((await s.call(`/api/activities/${replacement.activityId}/questions/${q.id}/submissions`,proof,{requestId:'first-group',answers:[{fieldId:f.id,text:'新場次自己的答案'}]})).status,200);
  assert.equal(s.rows()[0]!.rank,1);assert.ok(s.rows()[0]!.receive_order>high);
});

test('8.5 延遲驗證仍依 A提交→E結束→B提交 排序，原接收時間與結束時間不改',async t=>{
  let release!:()=>void,entered!:()=>void;const held=new Promise<void>(done=>{release=done;}),firstEntered=new Promise<void>(done=>{entered=done;});t.after(()=>release());
  const order:string[]=[];const s=await rankingFixture(t,async request=>{const tag=request.headers['x-fixture-order'];if(typeof tag==='string'){order.push(tag);if(tag==='A'){entered();await held;}}});await s.start();
  const high=(s.database.prepare('SELECT receive_high_water AS n FROM system_state').get() as {n:number}).n;
  s.setNow(2000);const a=s.submit(s.students[0]!,s.input('before-end'),s.groupQuestion.id,{'X-Fixture-Order':'A'});await firstEntered;
  s.setNow(2001);const e=s.call(`/api/activities/${s.activityId}/end`,s.teacher,{expectedVersion:2,confirmed:true},{'X-Fixture-Order':'E'});
  await wait(()=>(s.database.prepare('SELECT receive_high_water AS n FROM system_state').get() as {n:number}).n>=high+2);
  s.setNow(2002);const b=s.submit(s.students[1]!,s.input('after-end'),s.groupQuestion.id,{'X-Fixture-Order':'B'});
  await wait(()=>(s.database.prepare('SELECT receive_high_water AS n FROM system_state').get() as {n:number}).n>=high+3);assert.deepEqual(order,['A']);release();
  const result=await Promise.all([a,e,b]);assert.deepEqual(result.map(r=>r.status),[200,200,409]);assert.equal(result[2]!.error.code,'STATE_CONFLICT');assert.deepEqual(order,['A','E','B']);
  assert.equal(s.rows().length,1);assert.equal(s.rows()[0]!.received_at,2000);assert.equal((s.database.prepare('SELECT ended_at FROM activities').get() as {ended_at:number}).ended_at,2001);
  assert.equal((await s.end()).status,409);assert.equal((s.database.prepare('SELECT ended_at FROM activities').get() as {ended_at:number}).ended_at,2001);
});

test('8.6 requestId 同組正規化重送、跨組隔離、結束及重啟後原結果不變',async t=>{
  const s=await rankingFixture(t),mate=await s.join(0,'另一組員');await s.start();const input=s.input('retry');const first=await s.submit(s.students[0]!,input);assert.equal(first.status,200);
  const before=s.rows();const retry={...input,answers:[...input.answers].reverse().map(a=>({...a,text:a.text.trim()}))};
  assert.deepEqual((await s.submit(mate,retry)).data,first.data);assert.deepEqual(s.rows(),before);
  assert.equal((await s.submit(s.students[0]!,s.input('retry','不同內容'))).error.code,'REQUEST_ID_CONFLICT');
  assert.equal((await s.submit(s.students[0]!,s.input('retry','別題',s.singleQuestion),s.singleQuestion.id)).error.code,'REQUEST_ID_CONFLICT');
  const other=await s.submit(s.students[1]!,s.input('retry','第二組自己的內容'));assert.equal(other.status,200);assert.ok(!JSON.stringify(other.data).includes('與來源不同的答案'));
  assert.equal((await s.end()).status,200);assert.deepEqual((await s.submit(s.students[0]!,retry)).data,first.data);
  const saved=s.rows();s.setNow(3000);await s.restart();assert.deepEqual((await s.submit(s.students[0]!,retry)).data,first.data);assert.deepEqual(s.rows(),saved);
  assert.equal((await s.submit(s.students[2]!,s.input('new-after-end'))).error.code,'STATE_CONFLICT');
  s.setNow(43201000);assert.equal((await s.submit(s.students[0]!,retry)).error.code,'SESSION_EXPIRED');
});

test('8.7 真提交的 WS 分流、來源答案不批改、原臺灣時間及成功後斷線重送',async t=>{
  const s=await rankingFixture(t);await s.start();const sockets:WebSocket[]=[];
  async function channel(p:typeof s.teacher){const ticket=await s.call('/api/realtime/ticket',p,{scope:'activity'});const ws=new WebSocket(s.base.replace('http:','ws:')+'/ws',['crs.v1','ticket.'+ticket.data.ticket],{origin:s.base});sockets.push(ws);const frames:unknown[]=[];ws.on('message',raw=>frames.push(JSON.parse(raw.toString())));await once(ws,'open',{signal:AbortSignal.timeout(3000)});await wait(()=>frames.length>0);return{ws,frames};}
  t.after(()=>sockets.forEach(ws=>ws.terminate()));const [teacher,own,other]=await Promise.all([channel(s.teacher),channel(s.students[0]!),channel(s.students[1]!)]);
  s.database.exec("CREATE TRIGGER ws_fail BEFORE INSERT ON submission_answers BEGIN SELECT RAISE(ABORT,'fixture-rollback'); END;");
  assert.equal((await s.submit(s.students[0]!,s.input('failed-before-push'))).status,503);
  await new Promise(done=>setTimeout(done,200));assert.equal(teacher.frames.length,1);assert.equal(own.frames.length,1);assert.equal(other.frames.length,1);
  s.database.exec('DROP TRIGGER ws_fail');
  const input=s.input('actual-http',' =非標準答案\n👨‍👩‍👧‍👦 ');const response=await s.submit(s.students[0]!,input);assert.equal(response.status,200);
  await wait(()=>teacher.frames.length===2&&own.frames.length===2);await new Promise(done=>setTimeout(done,200));assert.equal(other.frames.length,1);
  const privateKeys=/"rank"|receiveOrder|receivedAt|submittedAt/;assert.doesNotMatch(JSON.stringify(own.frames),privateKeys);assert.doesNotMatch(JSON.stringify(other.frames),/非標準答案/);
  assert.match(JSON.stringify(teacher.frames.at(-1)),/1970-01-01 08:00:01\.000（Asia\/Taipei）/);
  own.ws.terminate();await wait(()=>own.ws.readyState===WebSocket.CLOSED);assert.deepEqual((await s.submit(s.students[0]!,input)).data,response.data);assert.equal(s.rows().length,1);
});


test('8.6 真 HTTP 已落盤但回覆本文中斷；重送只取回原成功，不重複保存',async t=>{
  const s=await rankingFixture(t);await s.start();const input=s.input('lost-response');
  const route=`/api/activities/${s.activityId}/questions/${s.groupQuestion.id}/submissions`;
  await new Promise<void>((done,fail)=>{
    const request=httpRequest(s.base+route,{method:'POST',headers:{...rankingHeaders(s.students[0]!),Connection:'close','Content-Type':'application/json'}},response=>{
      try{assert.equal(response.statusCode,200);assert.equal(s.rows().length,1);response.on('error',()=>{});response.destroy();done();}catch(error){response.destroy();fail(error);}
    });
    request.once('error',fail);request.setTimeout(3000,()=>request.destroy(new Error('測試回覆未於時限到達')));request.end(JSON.stringify(input));
  });
  const original=s.rows();const retry=await s.submit(s.students[0]!,input);assert.equal(retry.status,200);assert.equal(retry.data.accepted,true);
  assert.deepEqual(s.rows(),original);assert.equal((s.database.prepare('SELECT count(*) AS n FROM submission_answers').get() as {n:number}).n,2);
});
