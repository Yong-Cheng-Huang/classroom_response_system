// 唯讀驗證：僅限三份已授權副本；試算表傳輸拒絕非GET。
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {liveGoogleContext} from './live-google-context.js';
import {readConfig} from '../../src/server/config.js';
import {loadServiceAccount} from '../../src/server/service-account-config.js';
import {ServiceAccountSheets,ServiceAccountTokens} from '../../src/server/service-account.js';
import {ImportService} from '../../src/server/imports.js';
import {parseGuidedNotes,type Spreadsheet} from '../../src/server/guided-notes.js';
import {f1,f2} from '../../tests/fixtures/catalog.js';
import {sheetFixture} from '../../tests/helpers/sheets.js';
import {AppError} from '../../src/shared/errors.js';
const sources=[{id:'1coRaTtKMRHlNQg6nVVancgNygiktjQuZgtg8tCmUJl0',fixture:f1,role:'原可寫單題副本（本輪只讀）'},
 {id:'12FE3R1BPeOlUI0qNs_owOpH51yLpyZtBKecM-MqRvFI',fixture:f2,role:'原可寫題組副本（本輪只讀）'},
 {id:'1vfVBY_j9lFf_BFeEnAo0W4pM_gZtCermaoJhth70yJA',fixture:f1,role:'已授權私有檢視者副本'}];
const report:Record<string,unknown>={日期:new Date().toISOString(),狀態:'執行中',公開key依賴:false,匯入方式欄位:'省略',正式資料庫存取:false,試算表寫入批次:0,試算表GET次數:0,案例:[]};
let context:Awaited<ReturnType<typeof liveGoogleContext>>|undefined;
const file='docs/evidence/single-import-live.json';mkdirSync('docs/evidence',{recursive:true});const save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');
try{
 assert.ok(!process.env.GOOGLE_SHEETS_API_KEY,'請以GOOGLE_SHEETS_API_KEY空值執行');
 const f=context=await liveGoogleContext();let last:Spreadsheet|undefined;
 const transport:typeof fetch=async(input,init)=>{const url=new URL(String(input));assert.equal(url.origin,'https://sheets.googleapis.com');assert.equal(init?.method,'GET');assert.ok(sources.some(s=>url.pathname==='/v4/spreadsheets/'+s.id));const response=await fetch(input,init);if(response.ok)last=await response.clone().json() as Spreadsheet;report.試算表GET次數=Number(report.試算表GET次數)+1;return response;};
 const google=new ServiceAccountSheets(f.identity,new ServiceAccountTokens(loadServiceAccount(readConfig().serviceAccountFile)),transport),imports=new ImportService(f.database,f.identity,google,f.activities);
 for(const source of sources){
  let preview=await imports.inspect(imports.begin(f.teacher,`https://docs.google.com/spreadsheets/d/${source.id}/edit`,2));
  if(preview.stage==='SELECT_SHEET'){assert.ok(preview.sheets!.some(s=>s.id===source.fixture.sheetId));preview=await imports.select(imports.prepareSelect(f.teacher,preview.inspectionToken,source.fixture.sheetId));}
  assert.equal(preview.stage,'READY');assert.ok(last);const parsed=parseGuidedNotes(last,source.fixture.sheetId,2),expected=parseGuidedNotes(sheetFixture(source.fixture), '1',2);
  // Google顯示的數值題號1與擷取fixture的1.0僅在比對時正規化，產品解析器不變。
  const structure=(questions:typeof parsed.questions)=>questions.map(q=>({number:Number.isFinite(Number(q.number))?String(Number(q.number)):q.number,kind:q.kind,fields:q.fields.map(v=>({label:v.label,prompt:v.prompt,answerRange:v.answerRange}))}));
  assert.deepEqual(structure(parsed.questions),structure(expected.questions));assert.equal(preview.questionCount,expected.questions.length);assert.equal(preview.fieldCount,expected.questions.reduce((n,q)=>n+q.fields.length,0));
  const prior=f.database.prepare('SELECT id FROM activities').get(),created=await imports.commit(f.teacher,preview.inspectionToken,!!prior);
  const stored=f.database.prepare('SELECT snapshot_json FROM sources WHERE activity_id=?').get(created.activityId) as {snapshot_json:string};assert.deepEqual(JSON.parse(stored.snapshot_json),parsed.source.snapshot);
  const questions=f.database.prepare('SELECT id,number,kind FROM questions ORDER BY position').all() as {id:string;number:string;kind:string}[];assert.equal(questions.length,parsed.questions.length);
  questions.forEach((q,i)=>{const raw=parsed.questions[i]!;assert.equal(q.number,raw.number);assert.equal(q.kind,raw.kind);const fields=f.database.prepare('SELECT label,prompt,answer_range,original_json FROM question_fields WHERE question_id=? ORDER BY position').all(q.id) as {label:string|null;prompt:string;answer_range:string;original_json:string}[];assert.deepEqual(fields.map(v=>({label:v.label,prompt:v.prompt,answerRange:v.answer_range,original:JSON.parse(v.original_json)})),raw.fields);});
  (report.案例 as unknown[]).push({副本:source.id,權限:source.role,題數:preview.questionCount,欄位:preview.fieldCount,完整結構與定位:true,原始格式快照逐值一致:true,欄位格式逐值一致:true,預覽與隔離確認:true});save();
 }
 report.狀態='通過';
}catch(error){report.狀態='未通過';report.安全錯誤代碼=error instanceof AppError?error.code:'VERIFICATION_FAILED';report.驗證行號=error instanceof Error?error.stack?.match(/single-import-live\.ts:(\d+):/u)?.[1]:undefined;process.exitCode=1;}
finally{context?.close();save();console.log(JSON.stringify({狀態:report.狀態,安全錯誤代碼:report.安全錯誤代碼,驗證行號:report.驗證行號,案例數:(report.案例 as unknown[]).length,試算表GET次數:report.試算表GET次數,試算表寫入批次:report.試算表寫入批次}));}
