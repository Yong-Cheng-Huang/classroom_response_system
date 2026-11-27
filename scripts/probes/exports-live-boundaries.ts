import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { randomBytes,randomUUID } from 'node:crypto';
import { liveGoogleContext } from './live-google-context.js';
import { parseGuidedNotes,type Spreadsheet,type Cell } from '../../src/server/guided-notes.js';
import { ExportService,type ExportIO } from '../../src/server/exports.js';
import { sheetGrid,coordinates,hash } from '../../src/server/export-plan.js';
import { createSqliteAllocator } from '../../src/server/command-queue.js';
import { SubmissionService } from '../../src/server/submissions.js';
import { AppError } from '../../src/shared/errors.js';

const previous=JSON.parse(readFileSync('docs/evidence/exports-live.json','utf8')) as {狀態:string;副本:{連結:string;狀態:string}[]};assert.equal(previous.狀態,'通過');
const ids=previous.副本.map(copy=>{assert.equal(copy.狀態,'通過');return new URL(copy.連結).pathname.split('/')[3]!;});assert.equal(ids.length,2);
const f=await liveGoogleContext(),report:Record<string,unknown>={日期:'2026-11-26 Asia/Taipei',狀態:'執行中',測試副本:previous.副本.map(c=>c.連結),案例:[]};
const save=()=>writeFileSync('docs/evidence/exports-live-boundaries.json',JSON.stringify(report,null,2)+'\n'),record=(name:string)=>{(report.案例 as string[]).push(name);save();console.log(JSON.stringify({通過:name}));};
let writes=0,readable=true,drop=false;
const read=async(id:string)=>await f.google.spreadsheet(f.teacher,id,{includeGridData:'true'}) as Spreadsheet;
const io:ExportIO={read:async(_p,id)=>{if(!readable)throw new AppError('GOOGLE_DOCUMENT_FORBIDDEN');return read(id);},write:async(p,id,requests)=>{assert.ok(ids.includes(id));await f.google.batchUpdate(p,id,requests);writes++;if(drop)throw new Error('真實遠端完成後注入回覆遺失');}};
const service=new ExportService(f.database,f.identity,f.google,f.activities,Date.now,io);
function selected(source:Spreadsheet){const valid=source.sheets.flatMap(sheet=>{try{return[parseGuidedNotes(source,String(sheet.properties.sheetId),2)];}catch{return[];}});assert.equal(valid.length,1);return valid[0]!;}
try{
 const source=await read(ids[0]!),candidate=selected(source),sheetId=candidate.source.sheetId,sheet=source.sheets.find(s=>String(s.properties.sheetId)===sheetId)!,grid=sheetGrid(sheet),prepared=await f.activities.replace(f.teacher,candidate,{activityId:null,version:null,confirmed:false}),receipt=createSqliteAllocator(f.database);
 const group=f.database.prepare('SELECT id FROM groups ORDER BY number LIMIT 1').get() as {id:string},p={secret:randomBytes(32).toString('hex'),instanceId:randomUUID(),generation:0},grant=f.identity.join(prepared.activityId,group.id,'邊界驗證',p),student={...p,token:grant.token,generation:grant.generation};
 f.activities.transition(f.teacher,prepared.activityId,1,'start',receipt());const question=f.database.prepare('SELECT id FROM questions ORDER BY position LIMIT 1').get() as {id:string},fields=f.database.prepare('SELECT id FROM question_fields WHERE question_id=?').all(question.id) as {id:string}[];
 new SubmissionService(f.database,f.identity).submit(student,prepared.activityId,question.id,{requestId:randomUUID(),answers:fields.map(field=>({fieldId:field.id,text:'=邊界測試\n長答案👨‍👩‍👧‍👦'+'測'.repeat(120)}))},receipt());f.activities.transition(f.teacher,prepared.activityId,2,'end',receipt(),true);
 let attempt=0;const run=(mode:'ANSWERS'|'COLUMNS'|'INLINE')=>service.execute(service.begin(f.teacher,prepared.activityId,{accessMode:'SERVICE_ACCOUNT',requestId:'boundary-'+(++attempt),mode,paused:true,expectedVersion:3}));
 async function control(cells:Record<string,Cell>){const requests=Object.entries(cells).map(([key,cell])=>{const p=coordinates(key);return{updateCells:{range:{sheetId:Number(sheetId),startRowIndex:p.r,endRowIndex:p.r+1,startColumnIndex:p.c,endColumnIndex:p.c+1},rows:[{values:[{userEnteredValue:cell.userEnteredValue??{},textFormatRuns:cell.textFormatRuns??[]}]}],fields:'userEnteredValue,textFormatRuns'}};});await f.google.batchUpdate(f.teacher,ids[0]!,requests);}
 async function rejectChanges(name:string,cells:Record<string,Cell>,restore:Record<string,Cell>,mode:'ANSWERS'|'COLUMNS'='ANSWERS'){
  const before=writes;await control(cells);try{const result=await run(mode);assert.equal(result.state,'FAILED');assert.equal(writes,before);record(name);}finally{await control(restore);}
 }
 await control({B2:{userEnteredValue:{stringValue:'真實隔離邊界驗證標題'}}});assert.equal((await run('ANSWERS')).state,'COMPLETED');const updated=await read(ids[0]!);assert.equal(sheetGrid(updated.sheets.find(s=>String(s.properties.sheetId)===sheetId)!).cell('B2').userEnteredValue!.stringValue,'真實隔離邊界驗證標題');record('無關標題修改保留且可匯出');await control({B2:grid.cell('B2')});
 const last=candidate.questions.at(-1)!.fields[0]!.answerRange.split(':')[0]!,row=coordinates(last).r+1,current=sheetGrid((await read(ids[0]!)).sheets.find(s=>String(s.properties.sheetId)===sheetId)!);
 assert.deepEqual(current.cell(last).userEnteredValue,grid.cell(last).userEnteredValue);record('無人題原答案不變');
 await rejectChanges('最後一題敘述改動整次零寫入',{['C'+row]:{userEnteredValue:{stringValue:'人工修改最後一題'}}},{['C'+row]:grid.cell('C'+row)});
 await rejectChanges('無人題標記遺失整次零寫入',{['B'+row]:{userEnteredValue:{}},['C'+row]:{userEnteredValue:{}}},{['B'+row]:grid.cell('B'+row),['C'+row]:grid.cell('C'+row)});
 const answer=candidate.questions[0]!.fields[0]!.answerRange.split(':')[0]!,answerBefore=current.cell(answer);
 await rejectChanges('答案人工修改整次零寫入',{[answer]:{userEnteredValue:{stringValue:'人工答案'}}},{[answer]:answerBefore});
 await rejectChanges('非系統I欄內容衝突整次零寫入',{I5:{userEnteredValue:{stringValue:'人工I欄'}}},{I5:current.cell('I5')},'COLUMNS');
 drop=true;const uncertain=await run('INLINE');assert.equal(uncertain.state,'UNCONFIRMED');const sent=writes;readable=false;assert.equal((await service.reconcile(f.teacher,uncertain.id)).state,'UNCONFIRMED');assert.equal(writes,sent);record('真實寫入後注入回覆遺失與永久讀取失權，不盲重送');
 const confirmation=f.activities.confirmAbandonment(f.teacher,uncertain.id,3,true),other=selected(await read(ids[1]!));const bad=structuredClone(other);bad.questions[0]!.fields[0]!.prompt='';const expectation={activityId:prepared.activityId,version:3,confirmed:true,abandonmentToken:confirmation.abandonmentToken};await assert.rejects(f.activities.replace(f.teacher,bad,expectation));assert.equal(service.get(f.teacher,uncertain.id).state,'UNCONFIRMED');record('放棄後新匯入失敗仍保留原場與核對資料');
 await f.activities.replace(f.teacher,other,expectation);const minimal=f.database.prepare("SELECT * FROM document_output_management WHERE verification='UNVERIFIED'").all();assert.ok(minimal.length);assert.doesNotMatch(JSON.stringify(minimal),/邊界測試|長答案/);const before=hash(minimal);await assert.rejects(service.reconcile(f.teacher,uncertain.id),{code:'NOT_FOUND'});assert.equal(hash(f.database.prepare("SELECT * FROM document_output_management WHERE verification='UNVERIFIED'").all()),before);record('永久失權時成功換場、舊操作拒絕與最少未核實資訊保存');
 report.未核實資訊=minimal;report.故障注入說明='人工修改是對真實隔離副本使用Google API；回覆遺失是在真實批次完成後注入本機例外，永久失權由讀取層注入403，沒有刪除文件或撤銷使用者授權。';report.狀態='通過';save();
}catch(error){report.狀態='未通過';report.錯誤=error instanceof Error?error.message:'未完成';save();console.log(JSON.stringify({狀態:report.狀態,錯誤:report.錯誤}));process.exitCode=1;}
finally{f.close();}
