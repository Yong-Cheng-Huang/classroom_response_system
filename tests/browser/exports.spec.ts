import {fixtureSheets} from '../helpers/service-account.js';
import { test,expect } from '@playwright/test';
import { mkdtempSync,rmSync,writeFileSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../../src/server/database.js';
import { createApplication } from '../../src/server/app.js';
import { readConfig } from '../../src/server/config.js';
import { IdentityService } from '../../src/server/identity.js';
import { ActivityService } from '../../src/server/activity.js';
import { SubmissionService } from '../../src/server/submissions.js';
import { ImportService } from '../../src/server/imports.js';
import { ExportService } from '../../src/server/exports.js';
import { assertRequestOrigin } from '../../src/server/identity-http.js';
import { readActivityModel } from '../../src/server/read-model.js';
import { parseGuidedNotes } from '../../src/server/guided-notes.js';
import { replacePreparedActivity } from '../../src/server/activity-replacement.js';
import { SheetsMemory } from '../helpers/exports.js';
import { sheetFixture } from '../helpers/sheets.js';
import { f1,f2 } from '../fixtures/catalog.js';

test('12.1～12.12 老師匯出三模式、D31、預檢取消、核對及放棄後完整成功換場',async({context})=>{
 test.setTimeout(90000);const directory=mkdtempSync(join(tmpdir(),'crs-export-ui-')),database=openDatabase(join(directory,'classroom.db')),password='exports-browser-fixture';
 const identity=new IdentityService(database,password,Date.now,true),activities=new ActivityService(database,identity);let base='',release:()=>void=()=>{},hold:Promise<void>|null=null;
 const google=fixtureSheets(identity);
 const memory=new SheetsMemory(sheetFixture(f1));let next=sheetFixture(f2);next.spreadsheetId='next-copy';
 const imports=new ImportService(database,identity,google,activities,Date.now,async()=>structuredClone(next));
 const exports=new ExportService(database,identity,google,activities,Date.now,{read:async()=>{if(hold)await hold;return memory.read();},write:(...args)=>memory.write(...args)});
 const app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:password}),database,()=>{},{identity,activities,sheets:google,imports,exports,submissions:new SubmissionService(database,identity),authenticate:req=>{assertRequestOrigin(req);return identity.principal(identity.proof(req));},beforeRead:()=>identity.sweep(),readModel:()=>readActivityModel(database,identity)});
 const address=await app.listen(0);if(!address||typeof address==='string')throw new Error('隔離服務未啟動');identity.markReady();base=`http://127.0.0.1:${address.port}`;
 try{
  const initial=await replacePreparedActivity(database,parseGuidedNotes(memory.source,'1',2),{activityId:null,version:null,confirmed:false});const teacher=await context.newPage(),otherTeacher=await context.newPage(),student=await context.newPage();
  for(const p of [teacher,otherTeacher]){await p.goto(base);await p.getByRole('button',{name:'老師登入',exact:true}).click();await p.getByLabel('老師密碼').fill(password);await p.getByRole('button',{name:'登入老師身分',exact:true}).click();await expect(p.getByRole('heading',{name:'老師已登入',exact:true})).toBeVisible();}
  await expect(teacher.getByText('robot@fixture.iam.gserviceaccount.com',{exact:true})).toBeVisible();
  await student.goto(base);await student.getByLabel('暱稱').fill('匯出送出者');await student.getByRole('button',{name:/第 1 組/}).click();await expect(student.getByRole('heading',{name:'已加入組別',exact:true})).toBeVisible();await teacher.getByRole('button',{name:'開始搶答',exact:true}).click();await student.getByLabel(`第 ${f1.cells.B5} 題作答`,{exact:true}).fill('=不是公式\n完整答案👨‍👩‍👧‍👦');await student.getByRole('button',{name:`送出第 ${f1.cells.B5} 題`,exact:true}).click();await expect(student.getByText('已送出（匯出送出者）',{exact:true})).toBeVisible();
  await expect(teacher.getByRole('button',{name:'預檢並匯出',exact:true})).toHaveCount(0);await teacher.getByRole('button',{name:'結束活動',exact:true}).click();await teacher.getByRole('button',{name:'確認結束',exact:true}).click();
  const downloadEvent=teacher.waitForEvent('download');await teacher.getByRole('button',{name:'下載送出紀錄 CSV',exact:true}).click();const csv=readFileSync((await (await downloadEvent).path())!);expect(csv.subarray(0,3).toString('hex')).toBe('efbbbf');expect(csv.toString('utf8')).toContain('完整答案');
  const panel=teacher.getByRole('region',{name:'匯出 Guided Notes',exact:true}),latest=panel.getByRole('list',{name:'本場匯出操作'}).getByRole('listitem').first();
  await expect(panel.getByRole('button',{name:'預檢並匯出',exact:true})).toBeDisabled();await expect(panel.getByText(/系統無法強制鎖表/)).toBeVisible();
  async function start(mode:string){await panel.getByLabel('匯出模式',{exact:true}).selectOption(mode);await panel.getByLabel('已確認老師與協作者暫停編輯此工作表',{exact:true}).check();await panel.getByRole('button',{name:'預檢並匯出',exact:true}).click();}
  for(const [mode,label]of [['ANSWERS','只有答案'],['COLUMNS','答案＋組別時間欄'],['INLINE','答案＋格內附註行']]){await start(mode!);await expect(latest.getByText(label+' · 已完成',{exact:true})).toBeVisible();await expect(panel.getByLabel('已確認老師與協作者暫停編輯此工作表',{exact:true})).not.toBeChecked();}
  expect(memory.cell('G5').userEnteredValue?.stringValue).toContain('組別：第 1 組');expect(memory.cell('G5').userEnteredValue?.formulaValue).toBeUndefined();await panel.screenshot({path:'test-results/export-desktop.png'});await teacher.setViewportSize({width:390,height:844});await panel.screenshot({path:'test-results/export-mobile.png'});expect(await teacher.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const beforeCancel=memory.writes;hold=new Promise<void>(done=>{release=done;});await start('ANSWERS');await expect(latest.getByText('只有答案 · 準備中',{exact:true})).toBeVisible();await latest.getByRole('button',{name:'取消預檢',exact:true}).click();await expect(latest.getByText('只有答案 · 已失敗',{exact:true})).toBeVisible();release();hold=null;await expect(latest.getByText(/已取消預檢/)).toBeVisible();await expect(panel.getByRole('button',{name:'預檢並匯出',exact:true})).toBeDisabled();expect(memory.writes).toBe(beforeCancel);
  memory.afterWrite=()=>{memory.readable=false;throw new Error('隔離遠端已寫入但回覆遺失');};await start('COLUMNS');await expect(latest.getByText('答案＋組別時間欄 · 結果待確認',{exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'預檢並匯出',exact:true})).toBeDisabled();
  const legacy=database.prepare("SELECT id,recovery_plan_json FROM export_operations WHERE state='UNCONFIRMED' ORDER BY rowid DESC LIMIT 1").get() as {id:string;recovery_plan_json:string};const plan=JSON.parse(legacy.recovery_plan_json);delete plan.access;database.prepare('UPDATE export_operations SET recovery_plan_json=? WHERE id=?').run(JSON.stringify(plan),legacy.id);await expect(latest.getByRole('checkbox',{name:/確認以目前服務帳戶/})).toBeVisible();await expect(latest.getByRole('button',{name:'再次核對',exact:true})).toBeDisabled();await latest.getByRole('checkbox',{name:/確認以目前服務帳戶/}).check();
  await latest.getByRole('button',{name:'再次核對',exact:true}).click();await expect(latest.getByText(/結果待確認/).first()).toBeVisible();await latest.getByRole('button',{name:'放棄核對以建立新活動',exact:true}).click();await expect(teacher.getByRole('dialog')).toContainText('不會自動回滾');await teacher.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();expect((database.prepare('SELECT id FROM activities').get() as {id:string}).id).toBe(initial.activityId);
  memory.readable=true;memory.afterWrite=()=>{};const writes=memory.writes;await latest.getByRole('button',{name:'再次核對',exact:true}).click();await expect(latest.getByText('答案＋組別時間欄 · 已完成',{exact:true})).toBeVisible();expect(memory.writes).toBe(writes);
  memory.afterWrite=()=>{memory.readable=false;throw new Error('隔離第二次回覆遺失');};await start('INLINE');await expect(latest.getByText('答案＋格內附註行 · 結果待確認',{exact:true})).toBeVisible();await latest.getByRole('button',{name:'放棄核對以建立新活動',exact:true}).click();await teacher.getByRole('button',{name:'確認放棄核對',exact:true}).click();await expect(panel.getByText(/本分頁已確認放棄核對/)).toBeVisible();
  await teacher.getByLabel('Google Sheets 網址',{exact:true}).fill('https://docs.google.com/spreadsheets/d/next-copy/edit');await teacher.getByRole('button',{name:'讀取學習單',exact:true}).click();await teacher.getByRole('button',{name:'取消匯入',exact:true}).click();expect((database.prepare('SELECT id FROM activities').get() as {id:string}).id).toBe(initial.activityId);
  await teacher.getByRole('button',{name:'讀取學習單',exact:true}).click();await teacher.getByRole('button',{name:'確認替換並匯入',exact:true}).click();await expect(teacher.getByRole('heading',{name:'待開始',exact:true})).toBeVisible();await expect(otherTeacher.getByRole('heading',{name:'待開始',exact:true})).toBeVisible();await expect(student.getByRole('alert')).toContainText('新活動');expect((database.prepare("SELECT count(*) AS n FROM document_output_management WHERE verification='UNVERIFIED'").get() as {n:number}).n).toBeGreaterThan(0);expect(database.prepare('SELECT count(*) AS n FROM export_operations').get()).toEqual({n:0});
  writeFileSync('test-results/export-browser.json',JSON.stringify({日期:'2026-11-26 Asia/Taipei',Chrome:context.browser()!.version(),三模式:true,D31必須確認:true,預檢取消不寫入:true,未知結果不新寫入:true,再次核對不重送:true,放棄確認與取消:true,完整換場才清除:true,未核實範圍保留:true,'390px無溢出':true,範圍:'真Chrome／HTTP／SQLite；Sheets為隔離記憶體替身，真Google另驗'},null,2)+'\n');
 }finally{release();await app.close();identity.shutdown();database.close();rmSync(directory,{recursive:true,force:true});}
});
