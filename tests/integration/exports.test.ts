import test from 'node:test';
import assert from 'node:assert/strict';
import { exportFixture } from '../helpers/exports.js';
import { sheetGrid } from '../../src/server/export-plan.js';
import { ExportService } from '../../src/server/exports.js';
import { ExportWriteRejected } from '../../src/shared/errors.js';
import { parseGuidedNotes } from '../../src/server/guided-notes.js';
import { sheetFixture } from '../helpers/sheets.js';
import { openDatabase } from '../../src/server/database.js';
import type { TabProof } from '../../src/shared/session.js';
import { createSqliteAllocator } from '../../src/server/command-queue.js';
import { createApplication } from '../../src/server/app.js';
import { readConfig } from '../../src/server/config.js';
import { assertRequestOrigin } from '../../src/server/identity-http.js';
import { rankingHeaders,freshProof } from '../helpers/ranking.js';
import { f1,f2 } from '../fixtures/catalog.js';

for(const grouped of [false,true])test(`12.2～12.7 ${grouped?'題組混合':'單題'}三乘三模式、文字、無人題、原格式及重複一致`,async t=>{
 const f=await exportFixture(t,grouped),initial=structuredClone(f.memory.source),last=grouped?'G13':'G15';
 const source=f.source(),first=source.questions[0]!.fields[0]!.answerRange.split(':')[0]!;
 for(const a of ['ANSWERS','COLUMNS','INLINE'] as const)for(const b of ['ANSWERS','COLUMNS','INLINE'] as const){
  assert.equal((await f.run(a)).state,'COMPLETED');assert.equal((await f.run(b)).state,'COMPLETED');const once=structuredClone(f.memory.source);assert.equal((await f.run(b)).state,'COMPLETED');assert.deepEqual(f.memory.source,once);
  assert.match(f.memory.cell(first).userEnteredValue!.stringValue!,/^=不是公式/);assert.equal(f.memory.cell(first).userEnteredValue!.formulaValue,undefined);
  assert.deepEqual(f.memory.cell(last).userEnteredValue,sheetGrid(initial.sheets[0]!).cell(last).userEnteredValue);
  assert.deepEqual(f.memory.source.sheets[0]!.merges,initial.sheets[0]!.merges);
  if(b==='INLINE'){assert.equal((f.memory.cell(first).textFormatRuns as {format:{fontSize?:number}}[])[1]!.format.fontSize,9);assert.match(f.memory.cell(first).userEnteredValue!.stringValue!,/1970-01-01 08:00:01\.000（Asia\/Taipei）/);}
  else{assert.equal((f.memory.cell(first).userEnteredFormat as {wrapStrategy?:string}|undefined)?.wrapStrategy,undefined);assert.equal(sheetGrid(f.memory.source.sheets[0]!).row(Number(first.slice(1))-1),24);}
  assert.equal(f.memory.cell('I4').userEnteredValue?.stringValue,b==='COLUMNS'?'組別':undefined);assert.equal(f.memory.cell('I'+last.slice(1)).userEnteredValue?.stringValue,undefined);
 }
});

test('12.1～12.2 全題預檢失敗零寫入，標題無關修改保留，角色與 D31 強制檢查',async t=>{
 const f=await exportFixture(t);assert.throws(()=>f.service.begin(f.student,f.activityId,{requestId:'bad',mode:'ANSWERS',paused:true,expectedVersion:3}),{code:'FORBIDDEN'});assert.throws(()=>f.service.begin(f.teacher,f.activityId,{requestId:'bad',mode:'ANSWERS',paused:false,expectedVersion:3}),{code:'EXPORT_PAUSE_REQUIRED'});
 for(const key of ['C15','G15','B5']){const prior=structuredClone(f.memory.cell(key));f.memory.cell(key).userEnteredValue={stringValue:'人工修改'};delete f.memory.cell(key).formattedValue;const result=await f.run('ANSWERS');assert.equal(result.state,'FAILED');assert.match(result.message,/位置|核對/);assert.equal(f.memory.writes,0);Object.keys(f.memory.cell(key)).forEach(k=>delete f.memory.cell(key)[k]);Object.assign(f.memory.cell(key),prior);}
 const merges=structuredClone(f.memory.source.sheets[0]!.merges);f.memory.source.sheets[0]!.merges=merges!.filter(m=>m.startRowIndex!==14);assert.equal((await f.run('ANSWERS')).state,'FAILED');assert.equal(f.memory.writes,0);f.memory.source.sheets[0]!.merges=merges;
 const ghost=structuredClone(f.memory.cell('H5'));f.memory.cell('H5').userEnteredFormat={backgroundColor:{red:1}};assert.equal((await f.run('ANSWERS')).state,'FAILED');assert.equal(f.memory.writes,0);Object.keys(f.memory.cell('H5')).forEach(k=>delete f.memory.cell('H5')[k]);Object.assign(f.memory.cell('H5'),ghost);
 f.memory.cell('I5').userEnteredValue={stringValue:'人工欄位'};assert.equal((await f.run('COLUMNS')).state,'FAILED');assert.equal(f.memory.writes,0);f.memory.cell('I5').userEnteredValue={};
 f.memory.cell('B2').userEnteredValue={stringValue:'新標題'};delete f.memory.cell('B2').formattedValue;assert.equal((await f.run('ANSWERS')).state,'COMPLETED');assert.equal(f.memory.cell('B2').userEnteredValue?.stringValue,'新標題');
});

test('12.8～12.9 寫前落盤、五狀態、明確拒絕及落盤後回覆遺失先核對不重送',async t=>{
 const f=await exportFixture(t);f.memory.beforeWrite=()=>{const op=f.database.prepare("SELECT state,recovery_plan_json FROM export_operations WHERE state='WRITING'").get() as {state:string;recovery_plan_json:string};assert.ok(JSON.parse(op.recovery_plan_json).requests.length);assert.ok(JSON.parse(op.recovery_plan_json).changes[0].before);};
 f.memory.afterWrite=()=>{throw new Error('隔離已套用但回覆遺失');};const unknown=await f.run('INLINE');assert.equal(unknown.state,'UNCONFIRMED');assert.equal(f.memory.writes,1);assert.throws(()=>f.service.begin(f.teacher,f.activityId,{requestId:'blocked',mode:'ANSWERS',paused:true,expectedVersion:3}),{code:'EXPORT_RECONCILIATION_REQUIRED'});
 f.memory.afterWrite=()=>{};const restarted=new ExportService(f.database,f.identity,f.google,f.activities,f.now,f.io);assert.equal((await restarted.reconcile(f.teacher,unknown.id)).state,'COMPLETED');assert.equal(f.memory.writes,1);
 f.memory.beforeWrite=()=>{throw new ExportWriteRejected('GOOGLE_DOCUMENT_WRITE_FORBIDDEN');};const rejected=await f.run('COLUMNS');assert.equal(rejected.state,'FAILED');assert.match(rejected.message,/沒有寫入/);assert.equal(f.memory.writes,1);
 f.database.prepare("UPDATE export_operations SET state='PREPARING' WHERE id=?").run(rejected.id);new ExportService(f.database,f.identity,f.google,f.activities,f.now,f.io);assert.equal(f.service.get(f.teacher,rejected.id).state,'FAILED');
 f.database.prepare("UPDATE export_operations SET state='WRITING' WHERE id=?").run(rejected.id);new ExportService(f.database,f.identity,f.google,f.activities,f.now,f.io);assert.equal(f.service.get(f.teacher,rejected.id).state,'UNCONFIRMED');
});

test('12.10～12.11 永久無法讀取仍可確認放棄換場，失敗保留、未核實隔離及舊回覆不改新場',async t=>{
 const f=await exportFixture(t);f.memory.afterWrite=()=>{throw new Error('已寫入但未收到回覆');};const op=await f.run('INLINE');assert.equal(op.state,'UNCONFIRMED');f.memory.readable=false;assert.equal((await f.service.reconcile(f.teacher,op.id)).state,'UNCONFIRMED');
 const before=f.database.prepare('SELECT * FROM activities').all();assert.throws(()=>f.activities.confirmAbandonment(f.teacher,op.id,3,false),{code:'REPLACEMENT_CONFIRMATION_REQUIRED'});const confirmation=f.activities.confirmAbandonment(f.teacher,op.id,3,true);assert.deepEqual(f.database.prepare('SELECT * FROM activities').all(),before);
 const expectation={activityId:f.activityId,version:3,confirmed:true,abandonmentToken:confirmation.abandonmentToken};const bad=parseGuidedNotes(sheetFixture(f1),'1',2);bad.questions[0]!.fields[0]!.prompt='';await assert.rejects(f.activities.replace(f.teacher,bad,expectation));assert.equal(f.service.get(f.teacher,op.id).state,'UNCONFIRMED');assert.equal((f.database.prepare("SELECT count(*) AS n FROM document_output_management WHERE verification='UNVERIFIED'").get() as {n:number}).n,0);
 const fresh=parseGuidedNotes(sheetFixture(f1),'1',2);const changed=await f.activities.replace(f.teacher,fresh,expectation);assert.notEqual(changed.activityId,f.activityId);assert.throws(()=>f.service.get(f.teacher,op.id),{code:'NOT_FOUND'});assert.ok((f.database.prepare("SELECT count(*) AS n FROM document_output_management WHERE verification='UNVERIFIED'").get() as {n:number}).n>0);
 const managed=f.database.prepare('SELECT * FROM document_output_management').all();assert.doesNotMatch(JSON.stringify(managed),/不是公式|答案👨/);await assert.rejects(f.service.reconcile(f.teacher,op.id),{code:'NOT_FOUND'});assert.deepEqual(f.database.prepare('SELECT * FROM document_output_management').all(),managed);
 f.memory.readable=true;const receipt=createSqliteAllocator(f.database,f.now);f.activities.transition(f.teacher,changed.activityId,1,'start',receipt());f.activities.transition(f.teacher,changed.activityId,2,'end',receipt(),true);
 const blocked=await f.service.execute(f.service.begin(f.teacher,changed.activityId,{requestId:'overlap',mode:'ANSWERS',paused:true,expectedVersion:3}));assert.equal(blocked.state,'FAILED');assert.match(blocked.message,/未核實/);assert.equal(f.memory.writes,1);
 const grouped=sheetFixture(f2);f.memory.source=grouped;const groupActivity=await f.activities.replace(f.teacher,parseGuidedNotes(grouped,'1',2),{activityId:changed.activityId,version:3,confirmed:true});f.activities.transition(f.teacher,groupActivity.activityId,1,'start',receipt());f.activities.transition(f.teacher,groupActivity.activityId,2,'end',receipt(),true);
 const mergedOverlap=await f.service.execute(f.service.begin(f.teacher,groupActivity.activityId,{requestId:'merged-overlap',mode:'ANSWERS',paused:true,expectedVersion:3}));assert.equal(mergedOverlap.state,'FAILED');assert.match(mergedOverlap.message,/未核實/);assert.equal(f.memory.writes,1);
 const other=sheetFixture(f1);other.spreadsheetId='other-copy';const next=await f.activities.replace(f.teacher,parseGuidedNotes(other,'1',2),{activityId:groupActivity.activityId,version:3,confirmed:true});f.memory.source=other;f.memory.afterWrite=()=>{};
 f.activities.transition(f.teacher,next.activityId,1,'start',receipt());f.activities.transition(f.teacher,next.activityId,2,'end',receipt(),true);assert.equal((await f.service.execute(f.service.begin(f.teacher,next.activityId,{requestId:'other-document',mode:'ANSWERS',paused:true,expectedVersion:3}))).state,'COMPLETED');
 const isolated=f.database.prepare("SELECT * FROM document_output_management WHERE verification='UNVERIFIED'").all();f.database.close();const reopened=openDatabase(f.path);assert.deepEqual(reopened.prepare("SELECT * FROM document_output_management WHERE verification='UNVERIFIED'").all(),isolated);reopened.close();
});


test('12.5～12.7 字型、灰色9點、UTF16附註、換行列高與跨場無人題還原',async t=>{
 const original={textFormat:{fontFamily:'Noto Serif TC',fontSize:16},wrapStrategy:'CLIP',backgroundColor:{red:.9},horizontalAlignment:'CENTER',borders:{bottom:{style:'SOLID'}}};
 const f=await exportFixture(t,false,m=>{m.cell('G5').userEnteredFormat=structuredClone(original);m.source.sheets[0]!.data![0]!.rowMetadata![4]={pixelSize:35};});
 assert.equal((await f.run('INLINE')).state,'COMPLETED');const inline=f.memory.cell('G5'),runs=inline.textFormatRuns as {startIndex:number;format:{fontSize?:number;foregroundColorStyle?:unknown}}[];
 assert.equal(runs[0]!.format.fontSize,16);assert.equal(runs[1]!.format.fontSize,9);assert.ok(runs[1]!.format.foregroundColorStyle);assert.equal(inline.userEnteredValue!.stringValue!.slice(0,runs[1]!.startIndex).endsWith('\n'),true);
 assert.deepEqual({...inline.userEnteredFormat as object,wrapStrategy:'CLIP'},original);assert.ok(sheetGrid(f.memory.source.sheets[0]!).row(4)>35);
 const oldText=inline.userEnteredValue!.stringValue!.slice(0,runs[1]!.startIndex-1),receipt=createSqliteAllocator(f.database,f.now);
 const next=await f.activities.replace(f.teacher,parseGuidedNotes(f.memory.source,'1',2),{activityId:f.activityId,version:3,confirmed:true});
 assert.equal((f.database.prepare('SELECT count(*) AS n FROM export_operations').get() as {n:number}).n,0);
 f.activities.transition(f.teacher,next.activityId,1,'start',receipt());f.activities.transition(f.teacher,next.activityId,2,'end',receipt(),true);
 const result=await f.service.execute(f.service.begin(f.teacher,next.activityId,{requestId:'new-unanswered',mode:'ANSWERS',paused:true,expectedVersion:3}));assert.equal(result.state,'COMPLETED');assert.equal(f.memory.cell('G5').userEnteredValue!.stringValue,oldText);assert.deepEqual(f.memory.cell('G5').userEnteredFormat,original);assert.equal(sheetGrid(f.memory.source.sheets[0]!).row(4),35);
});

test('12.8 預檢取消後晚到讀取不得寫入；已送出但遠端仍原狀不能猜未寫入',async t=>{
 const f=await exportFixture(t);let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});const service=new ExportService(f.database,f.identity,f.google,f.activities,f.now,{read:async()=>{await gate;return f.memory.read();},write:(...args)=>f.memory.write(...args)});
 const work=service.begin(f.teacher,f.activityId,{requestId:'cancel',mode:'ANSWERS',paused:true,expectedVersion:3}),running=service.execute(work);assert.equal(service.cancel(f.teacher,work.row.id).state,'FAILED');release();assert.equal((await running).state,'FAILED');assert.equal(f.memory.writes,0);
 const unknownService=new ExportService(f.database,f.identity,f.google,f.activities,f.now,{read:()=>f.memory.read(),write:async()=>{throw new Error('已送出但結果不明');}});const uncertain=await unknownService.execute(unknownService.begin(f.teacher,f.activityId,{requestId:'unknown',mode:'ANSWERS',paused:true,expectedVersion:3}));assert.equal(uncertain.state,'UNCONFIRMED');assert.equal((await unknownService.reconcile(f.teacher,uncertain.id)).state,'UNCONFIRMED');assert.equal(f.memory.writes,0);
});

test('12.1／12.8～12.11 真HTTP角色、狀態白名單及確認意圖綁定老師',async t=>{
 const f=await exportFixture(t),app=createApplication(readConfig({APP_DATA_DIR:f.directory,TEACHER_PASSWORD:'exports-isolated-fixture'}),f.database,()=>{},{identity:f.identity,google:f.google,activities:f.activities,exports:f.service,now:f.now,authenticate:req=>{assertRequestOrigin(req);return f.identity.principal(f.identity.proof(req));}});
 const address=await app.listen(0);assert.ok(address&&typeof address==='object');t.after(()=>app.close());const base='http://127.0.0.1:'+address.port;
 const call=async(path:string,proof:TabProof=f.teacher,body?:unknown)=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...rankingHeaders(proof),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,...await response.json()};};
 const path='/api/activities/'+f.activityId+'/exports';assert.equal((await call(path,freshProof())).status,401);assert.equal((await call(path,f.student)).status,403);assert.equal((await call(path,f.teacher,{requestId:'no-pause',mode:'ANSWERS',expectedVersion:3})).status,400);
 const completed=await call(path,f.teacher,{requestId:'http-export',mode:'COLUMNS',paused:true,expectedVersion:3});assert.equal(completed.data.state,'COMPLETED');assert.doesNotMatch(JSON.stringify(completed),/requests|changes|不是公式|credential|token_hash/);const before=f.memory.writes;assert.equal((await call(path,f.teacher,{requestId:'http-export',mode:'COLUMNS',paused:true,expectedVersion:3})).data.id,completed.data.id);assert.equal(f.memory.writes,before);
 f.memory.afterWrite=()=>{throw new Error('回覆遺失');};const uncertain=await call(path,f.teacher,{requestId:'http-unknown',mode:'INLINE',paused:true,expectedVersion:3});assert.equal(uncertain.data.state,'UNCONFIRMED');const confirmation=await call('/api/operations/'+uncertain.data.id+'/abandon-confirmation',f.teacher,{confirmed:true,expectedVersion:3});assert.match(confirmation.data.abandonmentToken,/^[a-f0-9]{64}$/);
 const p=freshProof(),grant=f.identity.login('exports-isolated-fixture',p),other={...p,token:grant.token,generation:grant.generation};await assert.rejects(f.activities.replace(other,parseGuidedNotes(sheetFixture(f1),'1',2),{activityId:f.activityId,version:3,confirmed:true,abandonmentToken:confirmation.data.abandonmentToken}),{code:'EXPORT_RECONCILIATION_REQUIRED'});
 assert.equal((await call('/api/operations/'+uncertain.data.id+'/reconcile',f.student,{})).status,403);
});

test('12.9 Google整批明確拒絕與未知傳送分開，沒有公開token或內部本文',async t=>{
 const f=await exportFixture(t);let sent=0;
 for(const status of [400,401,403,429]){const transport:typeof fetch=async()=>{sent++;return new Response('內部訊息不得公開',{status});};await assert.rejects(f.google.batchUpdate(f.teacher,'fixture-copy',[],transport),error=>error instanceof ExportWriteRejected);if(status===401)f.database.prepare("UPDATE google_connection SET state='CONNECTED'").run();}
 for(const transport of [(async()=>new Response('private',{status:500})),(async()=>{throw new Error('private');}),(async()=>new Response('{broken',{status:200}))] as typeof fetch[])await assert.rejects(f.google.batchUpdate(f.teacher,'fixture-copy',[],transport),error=>!(error instanceof ExportWriteRejected));
 assert.equal(sent,4);
});


test('12.9 Google格式正規表示：省略零索引、補色彩欄位及8bit色彩仍能核對',async t=>{
 const f=await exportFixture(t),io={read:async()=>{const source=await f.memory.read();for(const grid of source.sheets[0]!.data??[])for(const row of grid.rowData??[])for(const cell of row.values??[])if(Array.isArray(cell.textFormatRuns))for(const run of cell.textFormatRuns as {startIndex?:number;format:{foregroundColorStyle?:{rgbColor:Record<string,number>};foregroundColor?:unknown}}[]){if(run.startIndex===0)delete run.startIndex;if(run.format.foregroundColorStyle){const rgb=run.format.foregroundColorStyle.rgbColor;run.format.foregroundColorStyle.rgbColor=Object.fromEntries(Object.entries(rgb).map(([k,v])=>[k,Number((Math.round(v*255)/255).toFixed(8))]));run.format.foregroundColor=run.format.foregroundColorStyle.rgbColor;}}return source;},write:(...args:Parameters<typeof f.memory.write>)=>f.memory.write(...args)};
 const service=new ExportService(f.database,f.identity,f.google,f.activities,f.now,io);const result=await service.execute(service.begin(f.teacher,f.activityId,{requestId:'canonical',mode:'INLINE',paused:true,expectedVersion:3}));assert.equal(result.state,'COMPLETED');assert.equal((await service.execute(service.begin(f.teacher,f.activityId,{requestId:'canonical-again',mode:'INLINE',paused:true,expectedVersion:3}))).state,'COMPLETED');
});


test('12.9 舊Google寫入401回覆不能撤銷已新連結的憑證',async t=>{
 const f=await exportFixture(t);const transport:typeof fetch=async()=>{await f.google.complete(new URL(f.google.begin(f.teacher).authorizationUrl).searchParams.get('state')!,'code',false);return new Response('',{status:401});};
 await assert.rejects(f.google.batchUpdate(f.teacher,'fixture-copy',[],transport),error=>error instanceof ExportWriteRejected);assert.equal(f.google.status(f.teacher).state,'CONNECTED');
});


test('12.8～12.9 寫後本機狀態保存失敗，儲存恢復後可核對而不永久卡住寫入中',async t=>{
 const f=await exportFixture(t);f.database.exec("CREATE TRIGGER state_fault BEFORE UPDATE ON export_operations WHEN NEW.state IN ('COMPLETED','UNCONFIRMED') BEGIN SELECT RAISE(ABORT,'isolated-state-fault'); END;");
 await assert.rejects(f.run('ANSWERS'));assert.equal(f.memory.writes,1);assert.equal((f.database.prepare('SELECT state FROM export_operations').get() as {state:string}).state,'WRITING');
 f.database.exec('DROP TRIGGER state_fault');const op=f.service.list(f.teacher,f.activityId)[0]!;assert.equal(op.state,'UNCONFIRMED');assert.equal((await f.service.reconcile(f.teacher,op.id)).state,'COMPLETED');assert.equal(f.memory.writes,1);
});

test('12.4 僅有B:H的來源在末端增加I:K，不移動原題目或合併',async t=>{
 const f=await exportFixture(t,false,m=>{m.source.sheets[0]!.properties.gridProperties={columnCount:8};});
 const before=structuredClone(f.memory.source.sheets[0]!),merges=structuredClone(before.merges);
 assert.equal((await f.run('COLUMNS')).state,'COMPLETED');assert.equal((f.memory.source.sheets[0]!.properties.gridProperties as {columnCount:number}).columnCount,11);
 assert.deepEqual(f.memory.source.sheets[0]!.merges,merges);assert.deepEqual(f.memory.cell('C5'),before.data![0]!.rowData![4]!.values![2]);assert.equal(f.memory.cell('I4').userEnteredValue!.stringValue,'組別');
});

test('12.8～12.9 SQLite關閉重開後待確認計畫可核對，準備中與寫入中各依狀態恢復',async t=>{
 const f=await exportFixture(t);f.memory.afterWrite=()=>{throw new Error('遠端套用後本機回覆中斷');};const op=await f.run('INLINE');assert.equal(op.state,'UNCONFIRMED');
 const saved=f.database.prepare('SELECT recovery_plan_json FROM export_operations WHERE id=?').get(op.id);f.database.close();const db=openDatabase(f.path);t.after(()=>{if(db.open)db.close();});
 const {IdentityService}=await import('../../src/server/identity.js'),{ActivityService}=await import('../../src/server/activity.js');const identity=new IdentityService(db,'exports-isolated-fixture',f.now),activities=new ActivityService(db,identity,undefined,f.now);
 assert.deepEqual(db.prepare('SELECT recovery_plan_json FROM export_operations WHERE id=?').get(op.id),saved);
 const service=new ExportService(db,identity,f.google,activities,f.now,f.io);assert.equal(service.get(f.teacher,op.id).state,'UNCONFIRMED');assert.equal((await service.reconcile(f.teacher,op.id)).state,'COMPLETED');assert.equal(f.memory.writes,1);
 for(const [before,after]of [['PREPARING','FAILED'],['WRITING','UNCONFIRMED']]){db.prepare('UPDATE export_operations SET state=? WHERE id=?').run(before,op.id);new ExportService(db,identity,f.google,activities,f.now,f.io);assert.equal(service.get(f.teacher,op.id).state,after);}
});
