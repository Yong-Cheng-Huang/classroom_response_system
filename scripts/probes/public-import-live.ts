// 只讀使用者提供的公開原始範本；隔離資料庫、空Google連結、停用OAuth。
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readConfig} from '../../src/server/config.js';
import {openDatabase} from '../../src/server/database.js';
import {IdentityService} from '../../src/server/identity.js';
import {ActivityService} from '../../src/server/activity.js';
import {SubmissionService} from '../../src/server/submissions.js';
import {ExportService} from '../../src/server/exports.js';
import {GoogleService} from '../../src/server/google.js';
import {GoogleVault} from '../../src/server/google-vault.js';
import {ImportService} from '../../src/server/imports.js';
import {PublicSheetsReader} from '../../src/server/public-sheets.js';
import {createApplication} from '../../src/server/app.js';
import {readActivityModel} from '../../src/server/read-model.js';
import {assertRequestOrigin} from '../../src/server/identity-http.js';
import {parseGuidedNotes,type Spreadsheet,type GridRange} from '../../src/server/guided-notes.js';
import {AppError} from '../../src/shared/errors.js';
import {f1,f2} from '../../tests/fixtures/catalog.js';
import {sheetFixture} from '../../tests/helpers/sheets.js';
import type {TabProof} from '../../src/shared/session.js';

const config=readConfig(),directory=mkdtempSync(join(tmpdir(),'crs-public-live-')),database=openDatabase(join(directory,'classroom.db')),password=randomBytes(32).toString('hex');
const identity=new IdentityService(database,password),activities=new ActivityService(database,identity),google=new GoogleService(database,identity,new GoogleVault(directory),null);
const captures:Spreadsheet[]=[],methods:string[]=[];
const reader=new PublicSheetsReader(config.googleSheetsApiKey,async(input,init)=>{assert.equal(init?.method,'GET');assert.equal(new URL(String(input)).origin,'https://sheets.googleapis.com');assert.ok(!new Headers(init?.headers).has('Authorization'));methods.push(init.method);const response=await fetch(input,init);if(response.ok){const raw=await response.clone().json() as Spreadsheet;if(raw.sheets?.some(s=>s.data))captures.push(raw);}return response;});
const imports=new ImportService(database,identity,google,activities,Date.now,async()=>assert.fail('不可使用OAuth'),reader);
const app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:password}),database,()=>{},{identity,activities,imports,google,submissions:new SubmissionService(database,identity),exports:new ExportService(database,identity,google,activities),authenticate:r=>{assertRequestOrigin(r);return identity.principal(identity.proof(r));},beforeRead:()=>identity.sweep(),readModel:()=>readActivityModel(database,identity)});
const report:Record<string,unknown>={日期:new Date().toISOString(),狀態:'執行中',環境:{隔離SQLite:true,OAuthProvider:null,Google連結:0,APIkey已設定:reader.configured},來源:[],外部寫入:0};
try{
 if(!reader.configured)throw new AppError('PUBLIC_SHEETS_NOT_CONFIGURED');
 const address=await app.listen(0);assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const fresh=():TabProof=>({secret:randomBytes(32).toString('hex'),instanceId:randomUUID(),generation:0});
 const headers=(p:TabProof)=>({'Content-Type':'application/json',...(p.token?{Authorization:'Bearer '+p.token}:{}),'X-Tab-Proof':p.secret,'X-Document-Instance':p.instanceId,'X-Session-Generation':String(p.generation)});
 const call=async(path:string,p:TabProof,body?:unknown)=>fetch(base+path,{headers:headers(p),method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)})});
 const teacher=fresh(),login=await call('/api/teacher/login',teacher,{password}),grant=(await login.json()).data;Object.assign(teacher,{token:grant.token,generation:grant.generation});
 for(const fixture of [f1,f2]){
  const inspected=await call('/api/imports/inspect',teacher,{url:fixture.source,groupCount:2,accessMode:'PUBLIC'}),result=await inspected.json();
  if(!result.ok)throw new AppError(result.error.code);assert.equal(inspected.status,200);
  const raw=captures.at(-1)!;assert.equal(raw.spreadsheetId,fixture.sourceSpreadsheetId);
  const candidate=parseGuidedNotes(raw,fixture.sheetId,2),expected=parseGuidedNotes(sheetFixture(fixture,Number(fixture.sheetId)),fixture.sheetId,2);
  // 舊xlsx擷取快照將數字題號字串化為1.0；API formattedValue為1。
  // 只於參考快照比對正規化數值題號，正式匯入仍原樣保存API顯示與格式。
  const numberKey=(value:string)=>/^\d+(?:\.0+)?$/u.test(value)?String(Number(value)):value;
  const shape=(c:typeof candidate)=>c.questions.map(q=>({number:numberKey(q.number),kind:q.kind,fields:q.fields.map(f=>({label:f.label,prompt:f.prompt,answerRange:f.answerRange}))}));assert.deepEqual(shape(candidate),shape(expected));
  report.參考快照題號比對='僅比對時1.0與1等值；正式內容不改寫';
  const sheet=raw.sheets.find(s=>String(s.properties.sheetId)===fixture.sheetId)!;const geometry=(merges:GridRange[]|undefined)=>(merges??[]).map(m=>[m.startRowIndex??0,m.endRowIndex,m.startColumnIndex??0,m.endColumnIndex].join(':')).sort();
  assert.deepEqual(geometry(sheet.merges),geometry(sheetFixture(fixture,Number(fixture.sheetId)).sheets[0]!.merges));assert.ok(sheet.data?.some(d=>d.rowData?.some(r=>r.values?.some(c=>c.userEnteredFormat))));
  const committed=await call(`/api/imports/${result.data.inspectionToken}/commit`,teacher,{confirmed:fixture===f2});assert.equal(committed.status,200);const activityId=(await committed.json()).data.activityId;
  const snapshot=JSON.parse((database.prepare('SELECT snapshot_json FROM sources WHERE activity_id=?').get(activityId) as {snapshot_json:string}).snapshot_json);assert.deepEqual(snapshot.sheet,sheet);assert.deepEqual(snapshot.spreadsheetProperties,raw.properties??null);
  const student=fresh(),group=(database.prepare('SELECT id FROM groups ORDER BY number LIMIT 1').get() as {id:string}).id;
  const joined=await call(`/api/activities/${activityId}/join`,student,{groupId:group,nickname:'公開唯讀驗證'}),g=(await joined.json()).data;Object.assign(student,{token:g.token,generation:g.generation});
  assert.equal((await call(`/api/activities/${activityId}/start`,teacher,{expectedVersion:1})).status,200);
  const q=(database.prepare('SELECT id FROM questions ORDER BY position LIMIT 1').get() as {id:string}),fields=database.prepare('SELECT id FROM question_fields WHERE question_id=? ORDER BY position').all(q.id) as {id:string}[];
  assert.equal((await call(`/api/activities/${activityId}/questions/${q.id}/submissions`,student,{requestId:randomUUID(),answers:fields.map(f=>({fieldId:f.id,text:'真實公開匯入後本機作答'}))})).status,200);
  assert.equal((await call(`/api/activities/${activityId}/end`,teacher,{expectedVersion:2,confirmed:true})).status,200);
  const csv=await call(`/api/activities/${activityId}/submissions.csv`,teacher);assert.equal(csv.status,200);const bytes=Buffer.from(await csv.arrayBuffer());assert.equal(bytes.subarray(0,3).toString('hex'),'efbbbf');assert.ok(bytes.toString().includes('真實公開匯入後本機作答'));
  const denied=await call(`/api/activities/${activityId}/exports`,teacher,{requestId:randomUUID(),mode:'ANSWERS',paused:true,expectedVersion:3});assert.equal(denied.status,401);assert.equal((await denied.json()).error.code,'GOOGLE_REAUTHORIZE');
  assert.equal(database.prepare('SELECT * FROM google_connection').get(),undefined);
  (report.來源 as unknown[]).push({類型:fixture.dataset,網址:fixture.source,題數:candidate.questions.length,欄位:candidate.questions.reduce((n,q)=>n+q.fields.length,0),合併數:sheet.merges?.length,定位與題目比對:true,必要格式存在:true,快照SHA256:createHash('sha256').update(JSON.stringify(candidate.source.snapshot)).digest('hex'),真HTTP匯入:true,CSV含作答且BOM正確:true,Sheets寫回無OAuth拒絕:true});
 }
 report.狀態='通過';report.外部請求=methods;
}catch(error){report.狀態='未通過';report.安全錯誤代碼=error instanceof AppError?error.code:'VERIFICATION_FAILED';report.驗證行號=error instanceof Error?error.stack?.match(/public-import-live\.ts:(\d+):/u)?.[1]:undefined;process.exitCode=1;}
finally{await app.close();identity.shutdown();database.close();rmSync(directory,{recursive:true,force:true});mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/public-import-live.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
