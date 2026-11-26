import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { temporaryDatabase } from '../helpers/database.js';
import { sheetFixture } from '../helpers/sheets.js';
import { f1,f2 } from '../fixtures/catalog.js';
import { IdentityService } from '../../src/server/identity.js';
import { GoogleService,googleScopes } from '../../src/server/google.js';
import { GoogleVault } from '../../src/server/google-vault.js';
import { ActivityService } from '../../src/server/activity.js';
import { ImportService } from '../../src/server/imports.js';
import { parseGuidedNotes,type Spreadsheet } from '../../src/server/guided-notes.js';
import { createApplication } from '../../src/server/app.js';
import { readConfig } from '../../src/server/config.js';
import { createSqliteAllocator } from '../../src/server/command-queue.js';
import { assertRequestOrigin } from '../../src/server/identity-http.js';
import { readActivityModel } from '../../src/server/read-model.js';
import type { TabProof } from '../../src/shared/session.js';

const password='imports-fixture-password',url='https://docs.google.com/spreadsheets/d/fixture-copy/edit';
async function fixture(t:Parameters<typeof temporaryDatabase>[0]){
  const data=temporaryDatabase(t);let now=1000;const identity=new IdentityService(data.database,password,()=>now);
  const proof:TabProof={secret:randomBytes(32).toString('hex'),instanceId:randomUUID(),generation:0};const grant=identity.login(password,proof);proof.token=grant.token;proof.generation=grant.generation;
  const google=new GoogleService(data.database,identity,new GoogleVault(data.directory),{authorization:state=>'https://accounts.google.com?state='+state,exchange:async()=>({accessToken:'fake',refreshToken:'fake-refresh',expiresAt:99999999,scopes:[...googleScopes],account:'fixture'}),refresh:async()=>{throw new Error();}},()=>now);
  await google.complete(new URL(google.begin(proof).authorizationUrl).searchParams.get('state')!,'code',false);
  const activities=new ActivityService(data.database,identity,undefined,()=>now);let reader=async():Promise<unknown>=>structuredClone(sheetFixture(f1));
  const imports=new ImportService(data.database,identity,google,activities,()=>now,()=>reader());
  return{...data,identity,google,activities,imports,proof,setReader:(next:typeof reader)=>{reader=next;},tick:(next:number)=>{now=next;},receipt:createSqliteAllocator(data.database,()=>now),now:()=>now};
}
test('6.3／6.7 單表預覽不改 EMPTY，完整成功才建立，候選不接受客戶端題目或答案',async t=>{
  const f=await fixture(t),work=f.imports.begin(f.proof,url,2),preview=await f.imports.inspect(work);
  assert.equal(preview.stage,'READY');assert.equal(preview.questionCount,6);assert.equal(preview.fieldCount,6);assert.equal(f.database.prepare('SELECT * FROM activities').get(),undefined);
  const result=await f.imports.commit(f.proof,preview.inspectionToken,false);assert.equal(result.phase,'READY');assert.equal((f.database.prepare('SELECT count(*) AS n FROM groups').get() as {n:number}).n,2);
  await assert.rejects(f.imports.commit(f.proof,preview.inspectionToken,false),{code:'IMPORT_EXPIRED'});
});
test('6.3 工作表列表／明確 gid 與選表只用選定的表，舊選擇 token 不能重用',async t=>{
  const f=await fixture(t),source=sheetFixture(f1);source.sheets.push(sheetFixture(f2,2,"Bob's sheet").sheets[0]!);f.setReader(async()=>structuredClone(source));
  const choice=await f.imports.inspect(f.imports.begin(f.proof,url,20));assert.equal(choice.stage,'SELECT_SHEET');assert.equal(choice.sheets!.length,2);
  const next=f.imports.prepareSelect(f.proof,choice.inspectionToken,'2');const preview=await f.imports.select(next);assert.equal(preview.questionCount,4);assert.notEqual(preview.inspectionToken,choice.inspectionToken);
  assert.throws(()=>f.imports.prepareSelect(f.proof,choice.inspectionToken,'1'),{code:'IMPORT_EXPIRED'});
  await f.imports.commit(f.proof,preview.inspectionToken,false);assert.equal((f.database.prepare('SELECT sheet_id FROM sources').get() as {sheet_id:string}).sheet_id,'2');
  const explicit=await f.imports.inspect(f.imports.begin(f.proof,url+'?gid=1',2));assert.equal(explicit.questionCount,6);
  await assert.rejects(f.imports.inspect(f.imports.begin(f.proof,url+'?gid=999',2)),{code:'GOOGLE_SHEET_NOT_FOUND'});
});
test('6.7 最後一題錯誤、取消、未確認、網路失敗均不撤銷舊學生或清除原場',async t=>{
  const f=await fixture(t),old=await f.activities.replace(f.proof,parseGuidedNotes(sheetFixture(f1),'1',2),{activityId:null,version:null,confirmed:false});
  const p:TabProof={secret:randomBytes(32).toString('hex'),instanceId:randomUUID(),generation:0};const group=(f.database.prepare('SELECT id FROM groups LIMIT 1').get() as {id:string}).id;
  const g=f.identity.join(old.activityId,group,'原學生',p);p.token=g.token;p.generation=g.generation;
  const snapshot=()=>['activities','questions','question_fields','participants','sessions'].map(table=>f.database.prepare(`SELECT * FROM ${table}`).all());const before=snapshot();
  f.setReader(async()=>sheetFixture({...f1,merges:f1.merges.filter(x=>x!=='G15:H15')}));await assert.rejects(f.imports.inspect(f.imports.begin(f.proof,url,2)),{code:'GUIDED_NOTES_FORMAT'});assert.deepEqual(snapshot(),before);
  f.setReader(async()=>sheetFixture(f1));const preview=await f.imports.inspect(f.imports.begin(f.proof,url,2));await assert.rejects(f.imports.commit(f.proof,preview.inspectionToken,false),{code:'REPLACEMENT_CONFIRMATION_REQUIRED'});f.imports.cancel(f.proof,preview.inspectionToken);assert.deepEqual(snapshot(),before);assert.equal(f.identity.current(p).nickname,'原學生');
  f.setReader(async()=>{throw new Error('network-fixture');});await assert.rejects(f.imports.inspect(f.imports.begin(f.proof,url,2)));assert.deepEqual(snapshot(),before);
});
test('6.7 讀取期間另一老師開始，完成後不能以舊確認替換；解除 Google 亦不建立半個活動',async t=>{
  const f=await fixture(t),old=await f.activities.replace(f.proof,parseGuidedNotes(sheetFixture(f1),'1',2),{activityId:null,version:null,confirmed:false});
  let release!:(value:Spreadsheet)=>void;f.setReader(()=>new Promise(resolve=>{release=resolve;}));
  const pending=f.imports.inspect(f.imports.begin(f.proof,url,2));f.tick(2000);f.activities.transition(f.proof,old.activityId,1,'start',f.receipt());release(sheetFixture(f1));await assert.rejects(pending,{code:'VERSION_CONFLICT'});
  f.tick(3000);f.activities.transition(f.proof,old.activityId,2,'end',f.receipt(),true);
  const after=f.imports.inspect(f.imports.begin(f.proof,url,2));f.google.disconnect(f.proof);release(sheetFixture(f1));await assert.rejects(after,{code:'GOOGLE_REAUTHORIZE'});
  assert.equal((f.database.prepare('SELECT id FROM activities').get() as {id:string}).id,old.activityId);
});
test('6.7 真 HTTP 外部讀取不阻塞共用命令佇列，學生／匿名不能匯入',async t=>{
  const f=await fixture(t),old=await f.activities.replace(f.proof,parseGuidedNotes(sheetFixture(f1),'1',2),{activityId:null,version:null,confirmed:false});
  let release!:(value:Spreadsheet)=>void,started!:()=>void;const entered=new Promise<void>(r=>{started=r;});f.setReader(()=>{started();return new Promise(resolve=>{release=resolve;});});
  const app=createApplication(readConfig({TEACHER_PASSWORD:password}),f.database,()=>{}, {identity:f.identity,activities:f.activities,imports:f.imports,now:f.now,authenticate:req=>{assertRequestOrigin(req);return f.identity.principal(f.identity.proof(req));}});
  const address=await app.listen(0);assert.ok(address&&typeof address==='object');t.after(()=>app.close());const base=`http://127.0.0.1:${address.port}`;
  const headers={Authorization:'Bearer '+f.proof.token,'X-Tab-Proof':f.proof.secret,'X-Document-Instance':f.proof.instanceId,'X-Session-Generation':String(f.proof.generation),'Content-Type':'application/json'};
  const post=(path:string,body:unknown,h=headers)=>fetch(base+path,{method:'POST',headers:h,body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  assert.equal((await post('/api/imports/inspect',{url,groupCount:2},{'Content-Type':'application/json'} as typeof headers)).status,401);
  const p:TabProof={secret:randomBytes(32).toString('hex'),instanceId:randomUUID(),generation:0},group=(f.database.prepare('SELECT id FROM groups LIMIT 1').get() as {id:string}).id;
  const g=f.identity.join(old.activityId,group,'學生',p);
  assert.equal((await post('/api/imports/inspect',{url,groupCount:2},{...headers,Authorization:'Bearer '+g.token,'X-Tab-Proof':p.secret,'X-Document-Instance':p.instanceId,'X-Session-Generation':String(g.generation)})).status,403);
  const pending=post('/api/imports/inspect',{url,groupCount:2});await entered;
  try{f.tick(2000);assert.equal((await post(`/api/activities/${old.activityId}/start`,{expectedVersion:1})).status,200);}finally{release(sheetFixture(f1));}
  assert.equal((await pending).status,409);
});

test('6.6 重用已有答案文件：保留原格格式，但不建立提交或把來源答案傳給學生',async t=>{
  const f=await fixture(t);f.setReader(async()=>sheetFixture({...f1,cells:{...f1.cells,G5:'PRIVATE_OLD_SOURCE_ANSWER'}}));
  const preview=await f.imports.inspect(f.imports.begin(f.proof,url,2));const created=await f.imports.commit(f.proof,preview.inspectionToken,false);
  assert.ok((f.database.prepare('SELECT snapshot_json FROM sources').get() as {snapshot_json:string}).snapshot_json.includes('PRIVATE_OLD_SOURCE_ANSWER'));
  assert.equal((f.database.prepare('SELECT count(*) AS n FROM submissions').get() as {n:number}).n,0);
  const p:TabProof={secret:randomBytes(32).toString('hex'),instanceId:randomUUID(),generation:0},group=(f.database.prepare('SELECT id FROM groups LIMIT 1').get() as {id:string}).id;
  const g=f.identity.join(created.activityId,group,'學生',p);
  const app=createApplication(readConfig({TEACHER_PASSWORD:password}),f.database,()=>{}, {identity:f.identity,now:f.now,authenticate:req=>f.identity.principal(f.identity.proof(req)),readModel:()=>readActivityModel(f.database,f.identity)});
  const address=await app.listen(0);assert.ok(address&&typeof address==='object');t.after(()=>app.close());
  const headers={Authorization:'Bearer '+g.token,'X-Tab-Proof':p.secret,'X-Document-Instance':p.instanceId,'X-Session-Generation':String(g.generation)};
  for(const phase of ['READY','RUNNING']){
    if(phase==='RUNNING'){f.tick(2000);f.activities.transition(f.proof,created.activityId,1,'start',f.receipt());}
    const response:Response=await fetch(`http://127.0.0.1:${address.port}/api/activities/current/view`,{headers});assert.equal(response.status,200);const body=await response.text();assert.ok(!body.includes('PRIVATE_OLD_SOURCE_ANSWER'));assert.ok(!body.includes('snapshot_json'));
  }
});
