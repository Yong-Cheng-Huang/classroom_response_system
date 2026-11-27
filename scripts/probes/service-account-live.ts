// 只允許明確指定的測試副本；不得使用原始兩份範本。
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
import {liveGoogleContext} from './live-google-context.js';
import {ImportService} from '../../src/server/imports.js';
import {ExportService} from '../../src/server/exports.js';
import {SubmissionService} from '../../src/server/submissions.js';
import {createSqliteAllocator} from '../../src/server/command-queue.js';
import {PublicSheetsReader} from './helpers/public-sheets.js';
import {readConfig} from '../../src/server/config.js';
import {parseGuidedNotes,type Spreadsheet} from '../../src/server/guided-notes.js';
import {readActivityModel} from '../../src/server/read-model.js';
import {projectActivity} from '../../src/server/projections.js';
import {serializeSubmissionCsv} from '../../src/server/submission-csv.js';
import {AppError} from '../../src/shared/errors.js';
import {f1,f2} from '../../tests/fixtures/catalog.js';
import {freshProof} from '../../tests/helpers/ranking.js';
import {hash} from '../../src/server/export-plan.js';

const forbidden=new Set([f1.sourceSpreadsheetId,f2.sourceSpreadsheetId]);
const ids=(process.env.SERVICE_ACCOUNT_TEST_SPREADSHEET_IDS??'').split(',').filter(Boolean),viewer=process.env.SERVICE_ACCOUNT_VIEWER_SPREADSHEET_ID;
if(ids.length!==2||ids.some(id=>!/^[A-Za-z0-9_-]+$/u.test(id)||forbidden.has(id))||new Set(ids).size!==2)throw new Error('請明確設定兩份非原始範本的測試副本ID');
const report:Record<string,unknown>={日期:new Date().toISOString(),狀態:'執行中',OAuth憑證載入:false,正式資料庫存取:false,案例:[],寫入批次:0};let context:Awaited<ReturnType<typeof liveGoogleContext>>|undefined;
const file='docs/evidence/service-account-live.json';mkdirSync('docs/evidence',{recursive:true});const save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');
try{
 const f=context=await liveGoogleContext(),{database:db,identity,teacher,google,activities}=f;
 const imports=new ImportService(db,identity,google,activities),exports=new ExportService(db,identity,google,activities),allocator=createSqliteAllocator(db),submissions=new SubmissionService(db,identity);
 const read=(id:string)=>google.spreadsheet(teacher,id,{includeGridData:'true'}) as Promise<Spreadsheet>;
 for(const id of ids){
  const initial=await read(id),valid=initial.sheets.flatMap(s=>{try{return[parseGuidedNotes(initial,String(s.properties.sheetId),2)];}catch{return[];}});assert.equal(valid.length,1,'測試副本須明確只有一張符合範本的工作表');const candidate=valid[0]!;
  const inspection=await imports.inspect(imports.begin(teacher,`https://docs.google.com/spreadsheets/d/${id}/edit?gid=${candidate.source.sheetId}`,2,undefined,'SERVICE_ACCOUNT'));
  const prior=db.prepare('SELECT id FROM activities').get(),created=await imports.commit(teacher,inspection.inspectionToken,!!prior),p=freshProof(),group=(db.prepare('SELECT id FROM groups ORDER BY number LIMIT 1').get() as {id:string}).id,g=identity.join(created.activityId,group,'服務帳戶真實驗證',p),student={...p,token:g.token,generation:g.generation};
  activities.transition(teacher,created.activityId,1,'start',allocator());const questions=db.prepare('SELECT id FROM questions ORDER BY position').all() as {id:string}[];
  for(const q of questions.slice(0,-1)){const fields=db.prepare('SELECT id FROM question_fields WHERE question_id=? ORDER BY position').all(q.id) as {id:string}[];submissions.submit(student,created.activityId,q.id,{requestId:randomUUID(),answers:fields.map((field,i)=>({fieldId:field.id,text:'=服務帳戶驗證\n答案'+i+'👨‍👩‍👧‍👦'}))},allocator());}
  activities.transition(teacher,created.activityId,2,'end',allocator(),true);
  const row:Record<string,unknown>={副本:id,題數:candidate.questions.length,欄位:candidate.questions.reduce((n,q)=>n+q.fields.length,0),模式:[]};(report.案例 as unknown[]).push(row);save();
  for(const mode of ['ANSWERS','COLUMNS','INLINE']as const){
   const outcome=await exports.execute(exports.begin(teacher,created.activityId,{accessMode:'SERVICE_ACCOUNT',requestId:randomUUID(),mode,paused:true,expectedVersion:3}));assert.equal(outcome.state,'COMPLETED',outcome.message);report.寫入批次=Number(report.寫入批次)+1;
   const before=await read(id),repeat=await exports.execute(exports.begin(teacher,created.activityId,{accessMode:'SERVICE_ACCOUNT',requestId:randomUUID(),mode,paused:true,expectedVersion:3}));assert.equal(repeat.state,'COMPLETED');report.寫入批次=Number(report.寫入批次)+1;const after=await read(id);assert.equal(hash(after),hash(before),'重複匯出讀回一致');
   assert.deepEqual(after.sheets.filter(s=>String(s.properties.sheetId)!==candidate.source.sheetId),initial.sheets.filter(s=>String(s.properties.sheetId)!==candidate.source.sheetId));(row.模式 as unknown[]).push({模式:mode,真實寫入與讀回核對:true,重複一致:true});save();console.log(JSON.stringify({副本:id,模式:mode,狀態:'通過'}));
  }
  const model=readActivityModel(db,identity);assert.ok(model);const view=projectActivity(model,identity.principal(teacher),Date.now());assert.equal(view.role,'TEACHER');if(view.role!=='TEACHER'||view.phase==='EMPTY')throw new Error();const csv=serializeSubmissionCsv(view);assert.equal(csv.subarray(0,3).toString('hex'),'efbbbf');assert.ok(csv.toString().includes('服務帳戶驗證'));row.CSV通過=true;
 }
 if(viewer){
  assert.ok(/^[A-Za-z0-9_-]+$/u.test(viewer)&&!forbidden.has(viewer)&&!ids.includes(viewer));const raw=await read(viewer);assert.ok(raw.sheets.length);const valid=raw.sheets.flatMap(s=>{try{return[parseGuidedNotes(raw,String(s.properties.sheetId),2)];}catch{return[];}});assert.equal(valid.length,1);const preview=await imports.inspect(imports.begin(teacher,`https://docs.google.com/spreadsheets/d/${viewer}/edit?gid=${valid[0]!.source.sheetId}`,2,undefined,'SERVICE_ACCOUNT'));await imports.commit(teacher,preview.inspectionToken,true);report.檢視者私有來源完整匯入=true;let denied=false;
  // 空批次只確認Google的寫入授權，不更新任何儲存格。
  try{await google.batchUpdate(teacher,viewer,[]);}catch(error){if(error instanceof AppError&&error.code==='SERVICE_ACCOUNT_WRITE_FORBIDDEN')denied=true;else throw error;}assert.equal(denied,true,'檢視者副本必須拒絕寫入');report.檢視者可讀不可寫=true;
 }else{report.檢視者可讀不可寫='待提供僅查看權限副本';}
 const reader=new PublicSheetsReader(process.env.GOOGLE_SHEETS_API_KEY),raw=await reader.spreadsheet(f1.sourceSpreadsheetId!,{fields:'spreadsheetId,sheets(properties,merges,data)'});parseGuidedNotes(raw as Spreadsheet,f1.sheetId,2);report.公開API仍可讀=true;
 assert.equal(db.prepare('SELECT * FROM google_connection').get(),undefined);report.狀態=viewer?'通過':'部分通過，尚缺檢視者驗收';if(!viewer)process.exitCode=1;
}catch(error){report.狀態='未通過';report.安全錯誤代碼=error instanceof AppError?error.code:'VERIFICATION_FAILED';report.驗證行號=error instanceof Error?error.stack?.match(/service-account-live\.ts:(\d+):/u)?.[1]:undefined;process.exitCode=1;}
finally{context?.close();save();console.log(JSON.stringify({狀態:report.狀態,安全錯誤代碼:report.安全錯誤代碼,驗證行號:report.驗證行號}));}
