import test from 'node:test';
import assert from 'node:assert/strict';
import {publicImportFixture,publicHeaders,freshPublicProof,publicUrl as url} from '../helpers/public-import.js';
import {sheetFixture} from '../helpers/sheets.js';
import {f1,f2} from '../fixtures/catalog.js';
import {parseGuidedNotes} from '../../src/server/guided-notes.js';
import {createSqliteAllocator} from '../../src/server/command-queue.js';

test('PUBLIC 無OAuth完整單題／題組、gid／選表與2～20組；原格式保存',async t=>{
 const f=await publicImportFixture();t.after(f.close);
 for(const groups of [1,21,2.5,undefined])assert.throws(()=>f.imports.begin(f.proof,url,groups,undefined,'PUBLIC'),{code:'INVALID_GROUP_COUNT'});
 for(const bad of [url.replace('/d/fixture-copy/edit','/d/e/published/pubhtml'),url+'/pub?output=csv','https://evil.test'])assert.throws(()=>f.imports.begin(f.proof,bad,2,undefined,'PUBLIC'),{code:'INVALID_SHEETS_URL'});
 const first=await f.imports.inspect(f.imports.begin(f.proof,url,2,undefined,'PUBLIC'));assert.equal(first.questionCount,6);assert.equal(first.fieldCount,6);await f.imports.commit(f.proof,first.inspectionToken,false);
 const source=sheetFixture(f1);source.sheets.push(sheetFixture(f2,2,"Bob's sheet").sheets[0]!);f.setTransport(async()=>Response.json(source));
 const choice=await f.imports.inspect(f.imports.begin(f.proof,url,20,undefined,'PUBLIC'));assert.equal(choice.stage,'SELECT_SHEET');assert.equal(choice.sheets!.length,2);
 const next=await f.imports.select(f.imports.prepareSelect(f.proof,choice.inspectionToken,'2'));assert.equal(next.questionCount,4);assert.equal(next.fieldCount,6);await f.imports.commit(f.proof,next.inspectionToken,true);
 assert.equal((f.database.prepare('SELECT count(*) n FROM groups').get() as {n:number}).n,20);
 const stored=JSON.parse((f.database.prepare('SELECT snapshot_json FROM sources').get() as {snapshot_json:string}).snapshot_json);assert.deepEqual(stored.sheet,source.sheets[1]);
 const gid=await f.imports.inspect(f.imports.begin(f.proof,url+'?gid=1',2,undefined,'PUBLIC'));assert.equal(gid.questionCount,6);
 assert.equal(f.oauthCalls(),0);assert.equal(f.database.prepare('SELECT * FROM google_connection').get(),undefined);
});
test('PUBLIC 最後一題失敗／取消／未確認／外部錯誤保留舊活動及學生，無憑證回退',async t=>{
 const f=await publicImportFixture();t.after(f.close);
 const old=await f.activities.replace(f.proof,parseGuidedNotes(sheetFixture(f1),'1',2),{activityId:null,version:null,confirmed:false});
 const p=freshPublicProof(),group=(f.database.prepare('SELECT id FROM groups LIMIT 1').get() as {id:string}).id,grant=f.identity.join(old.activityId,group,'原學生',p);Object.assign(p,{token:grant.token,generation:grant.generation});
 const snapshot=()=>['activities','sources','groups','questions','question_fields','participants','sessions'].map(table=>f.database.prepare(`SELECT * FROM ${table}`).all()),before=snapshot();
 f.setTransport(async()=>Response.json(sheetFixture({...f1,merges:f1.merges.filter(m=>m!=='G15:H15')})));await assert.rejects(f.imports.inspect(f.imports.begin(f.proof,url,2,undefined,'PUBLIC')),{code:'GUIDED_NOTES_FORMAT'});assert.deepEqual(snapshot(),before);
 f.setTransport(async()=>Response.json(sheetFixture(f1)));const preview=await f.imports.inspect(f.imports.begin(f.proof,url,2,undefined,'PUBLIC'));await assert.rejects(f.imports.commit(f.proof,preview.inspectionToken,false),{code:'REPLACEMENT_CONFIRMATION_REQUIRED'});f.imports.cancel(f.proof,preview.inspectionToken);assert.deepEqual(snapshot(),before);
 f.setTransport(async()=>Response.json({error:{message:'PUBLIC_CANARY'}},{status:403}));await assert.rejects(f.imports.inspect(f.imports.begin(f.proof,url,2,undefined,'PUBLIC')),{code:'PUBLIC_SHEETS_FORBIDDEN'});assert.deepEqual(snapshot(),before);assert.equal(f.identity.current(p).nickname,'原學生');assert.equal(f.identity.current(f.proof).role,'TEACHER');assert.equal(f.oauthCalls(),0);
});
test('PUBLIC 與Google解除獨立，仍驗老師／到期／版本；OAuth預設不回退',async t=>{
 const f=await publicImportFixture();t.after(f.close);
 assert.throws(()=>f.imports.begin(f.proof,url,2),{code:'GOOGLE_REAUTHORIZE'});assert.equal(f.oauthCalls(),0);
 let release!:(r:Response)=>void;f.setTransport(()=>{f.setTransport(async()=>Response.json(sheetFixture(f1)));return new Promise(r=>{release=r;});});
 const pending=f.imports.inspect(f.imports.begin(f.proof,url,2,undefined,'PUBLIC'));f.google.disconnect(f.proof);release(Response.json(sheetFixture(f1)));
 const ready=await pending,other=freshPublicProof(),grant=f.identity.login(f.password,other);Object.assign(other,{token:grant.token,generation:grant.generation});
 await assert.rejects(f.imports.commit(other,ready.inspectionToken,false),{code:'IMPORT_EXPIRED'});await f.imports.commit(f.proof,ready.inspectionToken,false);
 f.setTransport(()=>{f.setTransport(async()=>Response.json(sheetFixture(f1)));return new Promise(r=>{release=r;});});
 const delayed=f.imports.inspect(f.imports.begin(f.proof,url,2,undefined,'PUBLIC'));const id=(f.database.prepare('SELECT id FROM activities').get() as {id:string}).id;
 f.activities.transition(other,id,1,'start',createSqliteAllocator(f.database,f.now)());release(Response.json(sheetFixture(f1)));await assert.rejects(delayed,{code:'VERSION_CONFLICT'});
 f.activities.transition(other,id,2,'end',createSqliteAllocator(f.database,f.now)(),true);
 f.setTransport(()=>{f.setTransport(async()=>Response.json(sheetFixture(f1)));return new Promise(r=>{release=r;});});const expired=f.imports.inspect(f.imports.begin(f.proof,url,2,undefined,'PUBLIC'));f.setTime(602000);release(Response.json(sheetFixture(f1)));await assert.rejects(expired,{code:'IMPORT_EXPIRED'});
 f.setTime(603000);f.setTransport(()=>{f.setTransport(async()=>Response.json(sheetFixture(f1)));return new Promise(r=>{release=r;});});const loggedOut=f.imports.inspect(f.imports.begin(f.proof,url,2,undefined,'PUBLIC'));f.identity.logout(f.proof);release(Response.json(sheetFixture(f1)));await assert.rejects(loggedOut,{code:'SESSION_REVOKED'});
});
test('PUBLIC 真HTTP老師限定options與模式，拒絕偽造、過期、偷換模式；網路不占命令佇列',async t=>{
 const f=await publicImportFixture();t.after(f.close);const headers=publicHeaders(f.proof);
 const get=(h:Record<string,string>=headers,suffix='')=>fetch(f.base+'/api/imports/options'+suffix,{headers:h});
 const post=(path:string,body:unknown,h=headers)=>fetch(f.base+path,{method:'POST',headers:h,body:JSON.stringify(body)});
 assert.equal((await get({})).status,401);assert.equal((await get({...headers,'X-Role':'TEACHER',Authorization:'Bearer invented'})).status,401);
 assert.equal((await get({...headers,'X-Document-Instance':'wrong'})).status,401);assert.equal((await get(headers,'?accessMode=PUBLIC')).status,400);
 const response=await get();assert.equal(response.status,200);assert.deepEqual((await response.json()).data,{publicConfigured:true});
 for(const mode of ['public','INVALID',null,{},true])assert.equal((await post('/api/imports/inspect',{url,groupCount:2,accessMode:mode})).status,400);
 const inspected=await post('/api/imports/inspect',{url,groupCount:2,accessMode:'PUBLIC'}),preview=(await inspected.json()).data;assert.equal(inspected.status,200);
 for(const path of ['select','commit'])assert.equal((await post(`/api/imports/${preview.inspectionToken}/${path}`,{sheetId:'1',confirmed:false,accessMode:'OAUTH'})).status,400);
 await f.imports.commit(f.proof,preview.inspectionToken,false);
 const activityId=(f.database.prepare('SELECT id FROM activities').get() as {id:string}).id,p=freshPublicProof(),group=(f.database.prepare('SELECT id FROM groups LIMIT 1').get() as {id:string}).id,g=f.identity.join(activityId,group,'學生',p);Object.assign(p,{token:g.token,generation:g.generation});assert.equal((await get(publicHeaders(p))).status,403);assert.equal((await post('/api/imports/inspect',{url,groupCount:2,accessMode:'PUBLIC'},publicHeaders(p))).status,403);
 let release!:(r:Response)=>void,entered!:()=>void;const seen=new Promise<void>(r=>entered=r);f.setTransport(()=>{entered();return new Promise(r=>release=r);});const pending=post('/api/imports/inspect',{url,groupCount:2,accessMode:'PUBLIC'});await seen;
 try{const start=await post(`/api/activities/${activityId}/start`,{expectedVersion:1});assert.equal(start.status,200);}finally{release(Response.json(sheetFixture(f1)));}assert.equal((await pending).status,409);
 f.setTime(43201001);assert.equal((await get()).status,401);assert.ok(!JSON.stringify(f.logs).includes('PUBLIC_CANARY'));
});

test('PUBLIC 原答案只保留後端，學生READY／RUNNING不取得；安全HTTP錯誤不清身分',async t=>{
 const f=await publicImportFixture();t.after(f.close);f.setTransport(async()=>Response.json(sheetFixture({...f1,cells:{...f1.cells,G5:'PRIVATE_SOURCE_CANARY'}})));
 const preview=await f.imports.inspect(f.imports.begin(f.proof,url,2,undefined,'PUBLIC')),created=await f.imports.commit(f.proof,preview.inspectionToken,false);
 assert.ok((f.database.prepare('SELECT snapshot_json FROM sources').get() as {snapshot_json:string}).snapshot_json.includes('PRIVATE_SOURCE_CANARY'));
 const p=freshPublicProof(),group=(f.database.prepare('SELECT id FROM groups LIMIT 1').get() as {id:string}).id,g=f.identity.join(created.activityId,group,'學生',p);Object.assign(p,{token:g.token,generation:g.generation});
 for(const phase of ['READY','RUNNING']){if(phase==='RUNNING')f.activities.transition(f.proof,created.activityId,1,'start',createSqliteAllocator(f.database,f.now)());const response=await fetch(f.base+'/api/activities/current/view',{headers:publicHeaders(p)});assert.equal(response.status,200);const text=await response.text();assert.ok(!text.includes('PRIVATE_SOURCE_CANARY'));assert.ok(!text.includes('PUBLIC_CANARY'));}
 f.activities.transition(f.proof,created.activityId,2,'end',createSqliteAllocator(f.database,f.now)(),true);
 f.setTransport(async()=>Response.json({error:{message:'PUBLIC_CANARY',details:[{reason:'API_KEY_INVALID'}]}},{status:400}));const failed=await fetch(f.base+'/api/imports/inspect',{method:'POST',headers:publicHeaders(f.proof),body:JSON.stringify({url,groupCount:2,accessMode:'PUBLIC'})});assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes('PUBLIC_CANARY'));assert.equal(f.identity.current(f.proof).role,'TEACHER');assert.ok(!JSON.stringify(f.logs).includes('PUBLIC_CANARY'));
});
