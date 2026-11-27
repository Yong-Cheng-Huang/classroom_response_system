import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rankingFixture,rankingHeaders,freshProof } from '../helpers/ranking.js';
import type { TabProof } from '../../src/shared/session.js';
import { parseCsv } from '../helpers/csv.js';
import { preparedActivity } from '../helpers/replacement.js';
async function download(s:{base:string;activityId:string},proof?:TabProof,options:{method?:string;path?:string;headers?:Record<string,string>}={}){
 const response=await fetch(s.base+(options.path??`/api/activities/${s.activityId}/submissions.csv`),{method:options.method??'GET',headers:{...(proof?rankingHeaders(proof):{}),...options.headers},signal:AbortSignal.timeout(5000)});
 const bytes=Buffer.from(await response.arrayBuffer());return{response,bytes,text:bytes.toString('utf8')};
}
function rejected(result:Awaited<ReturnType<typeof download>>,status?:number){assert.ok(result.response.status>=400);if(status)assert.equal(result.response.status,status);assert.match(result.response.headers.get('content-type')??'',/application\/json/);assert.equal(JSON.parse(result.text).ok,false);assert.doesNotMatch(result.text,/本場秘密答案|senderNickname|receivedAt|Bearer/);}

test('CSV01／06 真HTTP老師下載，階段、權限、方法、query與舊活動限制',async t=>{
 const s=await rankingFixture(t);
 rejected(await download(s),401);rejected(await download(s,s.teacher),409);await s.start();rejected(await download(s,s.teacher),409);
 await s.submit(s.students[0]!,s.input('csv-private','本場秘密答案'));assert.equal((await s.end()).status,200);
 const result=await download(s,s.teacher);assert.equal(result.response.status,200);assert.equal(result.response.headers.get('content-type'),'text/csv; charset=utf-8');assert.equal(result.response.headers.get('cache-control'),'no-store');assert.match(result.response.headers.get('content-disposition')??'',/^attachment; filename="classroom-submissions-[a-f0-9-]+\.csv"$/);assert.deepEqual([...result.bytes.subarray(0,3)],[239,187,191]);assert.equal(parseCsv(result.text).length,3);
 rejected(await download(s,s.students[0]!,{headers:{'X-Role':'TEACHER'}}),403);rejected(await download(s,{...s.teacher,secret:freshProof().secret}));rejected(await download(s,{...s.teacher,instanceId:randomUUID()}));rejected(await download(s,s.teacher,{method:'POST'}),405);
 rejected(await download(s,s.teacher,{path:`/api/activities/${s.activityId}/submissions.csv?role=TEACHER`}),400);rejected(await download(s,s.teacher,{path:`/api/activities/${randomUUID()}/submissions.csv`}),409);
 s.identity.logout(s.teacher);rejected(await download(s,s.teacher),401);
});
test('CSV01／02 Google未配置、零提交只有表頭，過期身分拒絕',async t=>{
 const s=await rankingFixture(t);await s.start();await s.end();const result=await download(s,s.teacher);assert.equal(result.response.status,200);assert.equal(parseCsv(result.text).length,1);
 s.setNow(43201000);rejected(await download(s,s.teacher),401);
});

function businessSnapshot(s:Awaited<ReturnType<typeof rankingFixture>>){return JSON.stringify(['activities','questions','question_fields','groups','submissions','submission_answers','system_state','receive_orders','export_operations','document_output_management'].map(table=>[table,s.database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));}
test('CSV02～04／07 重送不重複、離線快照、重啟與待確認Sheets狀態不受下載影響',async t=>{
 const s=await rankingFixture(t);await s.start();const input=s.input('csv-retry','本場秘密答案');assert.equal((await s.submit(s.students[0]!,input)).status,200);assert.equal((await s.submit(s.students[0]!,input)).status,200);assert.equal((await s.submit(s.students[0]!,s.input('other','不能覆寫'))).status,409);
 assert.equal((await s.submit(s.students[1]!,s.input('csv-second','後續名次'))).status,200);await s.end();const proof=s.students[0]!,subject=s.identity.principal(proof);s.identity.channelDisconnected({sessionId:subject.sessionId,generation:proof.generation,instanceId:proof.instanceId});s.setNow(31001);s.identity.sweep();
 const stamp=1000;s.database.prepare("INSERT INTO export_operations VALUES (?,?,?,?,?,'UNCONFIRMED',?,?,?,?)").run('csv-unknown',s.activityId,'sheet-fixture','1','ANSWERS','{}','hash',stamp,stamp);
 s.database.prepare("INSERT INTO document_output_management VALUES (?,?,?,'UNVERIFIED',?,NULL,?,?)").run('sheet-fixture','1','G5','hash','{}','format');
 const before=businessSnapshot(s),first=await download(s,s.teacher);assert.equal(first.response.status,200);const rows=parseCsv(first.text);assert.equal(rows.length,5);assert.deepEqual(rows.slice(1).map(r=>[r[3],r[5],r[7]]),[['第一組甲','1','是'],['第一組甲','1','是'],['第二組','2','否'],['第二組','2','否']]);assert.equal(businessSnapshot(s),before);assert.deepEqual((await download(s,s.teacher)).bytes,first.bytes);
 await s.restart();assert.deepEqual((await download(s,s.teacher)).bytes,first.bytes);assert.equal(businessSnapshot(s),before);

});
test('CSV07 非同步授權交錯換場後拒絕舊場，不回新舊混合檔',async t=>{
 let release:()=>void=()=>{},entered:()=>void=()=>{};const gate=new Promise<void>(done=>release=done),seen=new Promise<void>(done=>entered=done);let hold=false;
 const s=await rankingFixture(t,async request=>{if(hold&&request.url?.endsWith('/submissions.csv')){entered();await gate;}});await s.start();await s.submit(s.students[0]!,s.input('snapshot','舊場答案'));await s.end();hold=true;
 const pending=download(s,s.teacher);await seen;const version=(s.database.prepare('SELECT version FROM activities').get() as {version:number}).version;await s.activities.replace(s.teacher,preparedActivity(),{activityId:s.activityId,version,confirmed:true});release();rejected(await pending,409);
});
