import {ServiceAccountSheets,ServiceAccountTokens} from '../../src/server/service-account.js';
import {loadServiceAccount} from '../../src/server/service-account-config.js';
// 僅在操作者明確執行時，以現有授權建立隔離副本並測正式匯出服務。
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync,writeFileSync,mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readConfig } from '../../src/server/config.js';
import { openDatabase } from '../../src/server/database.js';
import { IdentityService } from '../../src/server/identity.js';
import { ActivityService } from '../../src/server/activity.js';
import { SubmissionService } from '../../src/server/submissions.js';
import { ExportService,type ExportIO } from '../../src/server/exports.js';
import { parseGuidedNotes,type Spreadsheet } from '../../src/server/guided-notes.js';
import { createSqliteAllocator } from '../../src/server/command-queue.js';
import { hash,sheetGrid } from '../../src/server/export-plan.js';
import type { ExportMode } from '../../src/shared/exports.js';
import type { TabProof } from '../../src/shared/session.js';

const allowed=['1coRaTtKMRHlNQg6nVVancgNygiktjQuZgtg8tCmUJl0','12FE3R1BPeOlUI0qNs_owOpH51yLpyZtBKecM-MqRvFI'];
const directory=mkdtempSync(join(tmpdir(),'crs-real-exports-')),config=readConfig(),database=openDatabase(join(directory,'classroom.db'));
const report:{日期:string;狀態:string;副本:Record<string,unknown>[];錯誤?:string}={日期:'2026-11-26 Asia/Taipei',狀態:'執行中',副本:[]};
const save=()=>writeFileSync('docs/evidence/exports-live.json',JSON.stringify(report,null,2)+'\n');
const fresh=():TabProof=>({secret:randomBytes(32).toString('hex'),instanceId:randomUUID(),generation:0});
const identity=new IdentityService(database,'isolated-live-password'),proof=fresh(),grant=identity.login('isolated-live-password',proof),teacher={...proof,token:grant.token,generation:grant.generation};
const activities=new ActivityService(database,identity),created=new Set<string>();let writes=0,request=0;
const delay=(ms:number)=>new Promise<void>(done=>setTimeout(done,ms));
try{
 const tokens=new ServiceAccountTokens(loadServiceAccount(config.serviceAccountFile));const google=Object.assign(new ServiceAccountSheets(identity,tokens),{accessToken:async(p:TabProof)=>{identity.principal(p);return tokens.token();}});
 async function raw(path:string,body:unknown){const token=await google.accessToken(teacher),response=await fetch('https://sheets.googleapis.com/v4/'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Google隔離副本操作HTTP_'+response.status);return await response.json() as Record<string,unknown>;}
 const read=async(id:string)=>await google.spreadsheet(teacher,id,{includeGridData:'true'}) as Spreadsheet;
 const io:ExportIO={read:(p,id)=>read(id),write:async(p,id,requests)=>{assert.ok(created.has(id),'只能寫入本探針建立的隔離副本');await google.batchUpdate(p,id,requests);writes++;}};
 const service=new ExportService(database,identity,google,activities,Date.now,io),allocator=createSqliteAllocator(database),submissions=new SubmissionService(database,identity);
 for(const [index,sourceId]of allowed.entries()){
  const metadata=await google.spreadsheet(teacher,sourceId,{fields:'spreadsheetId,sheets(properties)'}) as Spreadsheet;
  const newFile=await raw('spreadsheets',{properties:{title:'課堂搶答匯出驗證_'+(index===0?'單題':'題組')+'_'+Date.now()}}),id=String(newFile.spreadsheetId);assert.ok(id&&!allowed.includes(id));created.add(id);
  const entry:Record<string,unknown>={類型:index===0?'單題':'題組',連結:`https://docs.google.com/spreadsheets/d/${id}/edit`,狀態:'執行中'};report.副本.push(entry);save();console.log(JSON.stringify({步驟:'建立隔離副本',類型:entry.類型,連結:entry.連結}));
  const copied=await raw(`spreadsheets/${sourceId}/sheets/${metadata.sheets[0]!.properties.sheetId}:copyTo`,{destinationSpreadsheetId:id}),sheetId=String(copied.sheetId);
  let source=await read(id);const selected=source.sheets.find(s=>String(s.properties.sheetId)===sheetId)!;const otherBefore=source.sheets.filter(s=>String(s.properties.sheetId)!==sheetId).map(s=>hash(s));
  const candidate=parseGuidedNotes(source,sheetId,2),old=database.prepare('SELECT id,version FROM activities').get() as {id:string;version:number}|undefined;
  const changed=await activities.replace(teacher,candidate,{activityId:old?.id??null,version:old?.version??null,confirmed:!!old});
  const group=database.prepare('SELECT id FROM groups WHERE activity_id=? ORDER BY number LIMIT 1').get(changed.activityId) as {id:string};const p=fresh(),g=identity.join(changed.activityId,group.id,'=匯出驗證👨‍👩‍👧‍👦',p),student={...p,token:g.token,generation:g.generation};
  activities.transition(teacher,changed.activityId,1,'start',allocator());const questions=database.prepare('SELECT id FROM questions WHERE activity_id=? ORDER BY position').all(changed.activityId) as {id:string}[];
  for(const [qIndex,q]of questions.slice(0,-1).entries()){const fields=database.prepare('SELECT id FROM question_fields WHERE question_id=? ORDER BY position').all(q.id) as {id:string}[];submissions.submit(student,changed.activityId,q.id,{requestId:randomUUID(),answers:fields.map((f,i)=>({fieldId:f.id,text:qIndex===0?'=文字不是公式👨‍👩‍👧‍👦\n'+'測'.repeat(140):`=第${qIndex+1}題子題${i+1}\n答案👨‍👩‍👧‍👦`}))},allocator());}
  activities.transition(teacher,changed.activityId,2,'end',allocator(),true);
  const run=async(mode:ExportMode)=>{const outcome=await service.execute(service.begin(teacher,changed.activityId,{accessMode:'SERVICE_ACCOUNT',requestId:'live-'+(++request),mode,paused:true,expectedVersion:3}));assert.equal(outcome.state,'COMPLETED',JSON.stringify({mode,state:outcome.state,message:outcome.message}));await delay(2300);return outcome;};
  const checkpoint=()=>{entry.已完成批次=writes;save();};
  for(const from of ['ANSWERS','COLUMNS','INLINE'] as const)for(const to of ['ANSWERS','COLUMNS','INLINE'] as const){await run(from);await run(to);const before=await read(id);await run(to);const after=await read(id);assert.deepEqual(after,before,'重複匯出必須完全一致');checkpoint();console.log(JSON.stringify({類型:entry.類型,切換:from+'→'+to,重複一致:true}));}
  await run('INLINE');source=await read(id);const fields=candidate.questions.flatMap(q=>q.fields),grid=sheetGrid(source.sheets.find(s=>String(s.properties.sheetId)===sheetId)!);const first=fields[0]!.answerRange.split(':')[0]!,cell=grid.cell(first),runs=cell.textFormatRuns as {startIndex:number;format:{fontSize?:number}}[];assert.equal(runs[1]!.format.fontSize,9);assert.match(cell.userEnteredValue!.stringValue!,/組別：第 1 組/);assert.equal(cell.userEnteredValue!.formulaValue,undefined);entry.灰色9點與純文字=true;
  const token=await google.accessToken(teacher),pdf=await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=pdf&gid=${sheetId}&portrait=false&fitw=true`,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
  entry.PDF預覽HTTP=pdf.status;if(pdf.ok&&(pdf.headers.get('content-type')??'').includes('pdf')){mkdirSync('test-results',{recursive:true});const file=`test-results/export-live-${index+1}.pdf`;writeFileSync(file,Buffer.from(await pdf.arrayBuffer()));entry.PDF預覽=file;}
  await run('ANSWERS');
  const lossIO:ExportIO={read:io.read,write:async(...args)=>{await io.write(...args);throw new Error('隔離真實遠端完成後的回覆遺失');}};const loss=new ExportService(database,identity,google,activities,Date.now,lossIO),unknown=await loss.execute(loss.begin(teacher,changed.activityId,{accessMode:'SERVICE_ACCOUNT',requestId:'lost-'+randomUUID(),mode:'COLUMNS',paused:true,expectedVersion:3}));assert.equal(unknown.state,'UNCONFIRMED');const sent=writes;assert.equal((await loss.reconcile(teacher,unknown.id)).state,'COMPLETED');assert.equal(writes,sent);entry.真實寫入後注入回覆遺失核對不重送=true;await delay(2300);
  await run('ANSWERS');source=await read(id);assert.deepEqual(source.sheets.filter(s=>String(s.properties.sheetId)!==sheetId).map(s=>hash(s)),otherBefore);entry.未選工作表不變=true;entry.三乘三切換與重複一致=true;entry.狀態='通過';checkpoint();
 }
 report.狀態='通過';save();console.log('真實Google隔離匯出驗證通過');
}catch(error){report.狀態='未通過';report.錯誤=error instanceof Error?error.message:'未完成';mkdirSync('test-results',{recursive:true});const last=database.prepare('SELECT state,recovery_plan_json FROM export_operations ORDER BY rowid DESC LIMIT 1').get();if(last)writeFileSync('test-results/export-live-last-operation.json',JSON.stringify(last,null,2)+'\n');save();console.log(JSON.stringify({狀態:report.狀態,原因:report.錯誤}));process.exitCode=1;}
finally{identity.shutdown();database.close();rmSync(directory,{recursive:true,force:true});}
