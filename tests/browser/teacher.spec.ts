import {fixtureSheets} from '../helpers/service-account.js';
import { test,expect,type Page } from '@playwright/test';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/server/database.js';
import { createApplication } from '../../src/server/app.js';
import { IdentityService } from '../../src/server/identity.js';
import { ActivityService } from '../../src/server/activity.js';
import { SubmissionService } from '../../src/server/submissions.js';
import { readConfig } from '../../src/server/config.js';
import { assertRequestOrigin } from '../../src/server/identity-http.js';
import { readActivityModel } from '../../src/server/read-model.js';
import { replacePreparedActivity } from '../../src/server/activity-replacement.js';
import { preparedActivity } from '../helpers/replacement.js';
import { ImportService } from '../../src/server/imports.js';
import { sheetFixture } from '../helpers/sheets.js';
import { f1,f2 } from '../fixtures/catalog.js';

test('10.2～10.4 多老師獨立預覽、完整題組監看、同毫秒名次、結束及重啟保存',async({context})=>{
 test.setTimeout(60000);
 const directory=mkdtempSync(join(tmpdir(),'crs-teacher-monitor-')),path=join(directory,'classroom.db'),password='teacher-monitor-fixture';
 let database=openDatabase(path),now=Date.UTC(2026,10,26,4,5,6,789),identity!:IdentityService,app!:ReturnType<typeof createApplication>,base='';
 const launch=async(port=0)=>{
  identity=new IdentityService(database,password,()=>now,true);const db=database,id=identity,google=fixtureSheets(id,()=>now);
  app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:password}),db,()=>{},{identity:id,sheets:google,now:()=>now,activities:new ActivityService(db,id,undefined,()=>now),submissions:new SubmissionService(db,id),authenticate:request=>{assertRequestOrigin(request);return id.principal(id.proof(request));},beforeRead:()=>id.sweep(),readModel:()=>readActivityModel(db,id)});
  const address=await app.listen(port);if(!address||typeof address==='string')throw new Error('隔離服務未啟動');identity.markReady();base=`http://127.0.0.1:${address.port}`;return address.port;
 };
 const headers=new Map<Page,Record<string,string>>();
 const page=async()=>{const p=await context.newPage();p.on('request',request=>{const h=request.headers();if(request.url().startsWith(base+'/api/')&&h.authorization)headers.set(p,{authorization:h.authorization,'X-Tab-Proof':h['x-tab-proof']!,'X-Document-Instance':h['x-document-instance']!,'X-Session-Generation':h['x-session-generation']!});});await p.goto(base);return p;};
 const rpc=async(p:Page,path:string,body:unknown)=>p.evaluate(async args=>{const r=await fetch(args.path,{method:'POST',headers:{...args.headers,'Content-Type':'application/json'},body:JSON.stringify(args.body)});return{status:r.status,body:await r.json()};},{path,body,headers:headers.get(p)!});
 const preview=(p:Page)=>p.getByRole('region',{name:'題目預覽內容',exact:true});
 const status=(p:Page,n:number)=>p.getByRole('region',{name:`第 ${n} 題提交狀況`,exact:true});
 const form=(p:Page,n:number)=>p.getByRole('region',{name:`第 ${n} 題`,exact:true});
 try{
  const port=await launch(),prepared=preparedActivity();prepared.questions[1]!.fields.push({label:'（3）',prompt:'第三個子題',answerRange:'H9',original:{}},{label:'（4）',prompt:'第四個子題',answerRange:'H10',original:{}});
  prepared.questions.push({number:'3',kind:'SINGLE',fields:[{label:null,prompt:'無人題目',answerRange:'G12:H12',original:{}}]});
  const activity=await replacePreparedActivity(database,prepared,{activityId:null,version:null,confirmed:false});
  const teachers=[await page(),await page()],students=[await page(),await page()];
  for(const p of teachers){await p.getByRole('button',{name:'老師登入',exact:true}).click();await p.getByLabel('老師密碼').fill(password);await p.getByRole('button',{name:'登入老師身分',exact:true}).click();await expect(p.getByRole('heading',{name:'老師已登入',exact:true})).toBeVisible();}
  for(const [i,p]of students.entries()){await p.getByLabel('暱稱').fill(i===0?'甲':'<b>乙</b>');await p.getByRole('button',{name:new RegExp(`第 ${i+1} 組`)}).click();await expect(p.getByRole('heading',{name:'已加入組別',exact:true})).toBeVisible();}
  const [a,b]=teachers as [Page,Page];
  await a.getByRole('button',{name:'預覽第 2 題',exact:true}).click();await expect(preview(a).getByText('第四個子題',{exact:false})).toBeVisible();await expect(preview(a).locator('.question-prompt')).toHaveCount(4);await expect(preview(b)).toHaveCount(0);
  await a.getByRole('button',{name:'預覽第 2 題',exact:true}).click();await expect(preview(a)).toHaveCount(0);
  await a.getByRole('button',{name:'預覽第 1 題',exact:true}).click();await b.getByRole('button',{name:'預覽第 2 題',exact:true}).click();await a.getByRole('button',{name:'預覽第 3 題',exact:true}).click();
  await expect(preview(a).getByText('無人題目',{exact:true})).toBeVisible();await expect(preview(a).getByText('新單題',{exact:true})).toHaveCount(0);await expect(preview(b).locator('.question-prompt')).toHaveCount(4);
  await expect(students[0]!.getByRole('textbox')).toHaveCount(0);await expect(status(a,1).getByRole('list',{name:'第 1 題未提交組別'}).getByRole('listitem')).toHaveCount(3);
  await a.getByRole('button',{name:'開始搶答',exact:true}).click();await expect(b.getByRole('heading',{name:'搶答進行中',exact:true})).toBeVisible();
  const times=()=>database.prepare('SELECT started_at,ended_at FROM activities').get();const started=times();
  expect((await rpc(b,`/api/activities/${activity.activityId}/start`,{expectedVersion:1})).status).toBe(409);expect(times()).toEqual(started);
  await a.getByRole('button',{name:'結束活動',exact:true}).click();await a.getByRole('button',{name:'取消',exact:true}).click();await expect(a.getByRole('dialog')).not.toBeVisible();expect((database.prepare('SELECT state FROM activities').get() as {state:string}).state).toBe('RUNNING');
  for(const i of [1,0]){const p=students[i]!;await form(p,1).getByRole('textbox').fill(i===1?'第一名答案':'未成功答案\n<img src=x onerror="window.injected=1">');await p.getByRole('button',{name:'送出第 1 題',exact:true}).click();await expect(form(p,1).getByText(/^已送出/)).toBeVisible();}
  const fields=form(students[0]!,2).getByRole('textbox');for(let i=0;i<4;i++)await fields.nth(i).fill('完整子題'+i);await students[0]!.getByRole('button',{name:'送出第 2 題',exact:true}).click();
  for(const p of teachers){
   await expect(status(p,1).getByRole('list',{name:'第 1 題提交排名'}).getByRole('listitem')).toHaveCount(2);
   const first=status(p,1).getByRole('listitem',{name:'第 1 題第 2 組提交',exact:true}),second=status(p,1).getByRole('listitem',{name:'第 1 題第 1 組提交',exact:true});
   await expect(first.getByText('搶答成功',{exact:true})).toBeVisible();await expect(second.getByText('已送出，未搶到',{exact:true})).toBeVisible();
   expect(await status(p,1).locator('.submission-heading strong').allTextContents()).toEqual(['第 1 名 · 第 2 組','第 2 名 · 第 1 組']);
   await expect(status(p,1).locator('time')).toHaveText(['2026-11-26 12:05:06.789（Asia/Taipei）','2026-11-26 12:05:06.789（Asia/Taipei）']);
   await second.getByText('查看完整答案',{exact:true}).click();await expect(second.getByText('未成功答案',{exact:false})).toBeVisible();await expect(second.locator('img')).toHaveCount(0);expect(await p.evaluate(()=>Reflect.get(window,'injected'))).toBeUndefined();
   const group=status(p,2).getByRole('listitem',{name:'第 2 題第 1 組提交',exact:true});await group.getByText('查看完整答案',{exact:true}).click();await expect(group.locator('dd')).toHaveCount(4);await expect(group.locator('dd').nth(3)).toHaveText('完整子題3');
  }
  await a.evaluate(()=>scrollTo(0,0));await a.screenshot({path:'test-results/teacher-monitor-desktop.png',fullPage:true});await a.setViewportSize({width:390,height:844});await a.screenshot({path:'test-results/teacher-monitor-mobile.png',fullPage:true});expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await a.getByRole('button',{name:'結束活動',exact:true}).click();await b.getByRole('button',{name:'結束活動',exact:true}).click();now+=10000;await b.getByRole('button',{name:'確認結束',exact:true}).click();
  await expect(a.getByRole('heading',{name:'已結束',exact:true})).toBeVisible();await expect(a.getByRole('dialog')).not.toBeVisible();const ended=times();
  expect((await rpc(a,`/api/activities/${activity.activityId}/end`,{expectedVersion:2,confirmed:true})).status).toBe(409);expect(times()).toEqual(ended);
  for(const p of teachers){await expect(status(p,3).getByText('無人搶答',{exact:true})).toBeVisible();await expect(p.getByRole('button',{name:'開始搶答',exact:true})).toHaveCount(0);await expect(p.getByLabel('搶答計時',{exact:true})).toHaveText('00:00:10');}
  const saved=database.prepare('SELECT * FROM submissions ORDER BY id').all();await app.close();identity.shutdown();database.close();database=openDatabase(path);now+=20000;await launch(port);
  for(const p of teachers){await expect(p.getByRole('heading',{name:'已結束',exact:true})).toBeVisible();await p.reload();await expect(p.getByLabel('搶答計時',{exact:true})).toHaveText('00:00:10');await expect(status(p,3).getByText('無人搶答',{exact:true})).toBeVisible();
   const second=status(p,1).getByRole('listitem',{name:'第 1 題第 1 組提交',exact:true});await second.getByText('查看完整答案',{exact:true}).click();await expect(second.getByText('未成功答案',{exact:false})).toBeVisible();}
  expect(database.prepare('SELECT * FROM submissions ORDER BY id').all()).toEqual(saved);expect(times()).toEqual(ended);
  writeFileSync('test-results/teacher-monitor.json',JSON.stringify({日期:'2026-11-26 Asia/Taipei',Chrome:context.browser()!.version(),老師分頁:2,學生分頁:2,四子題完整預覽:true,同題關閉與切題唯一:true,預覽分頁獨立:true,每題所有組別狀況:true,同毫秒名次:[1,2],提交時間:'2026-11-26 12:05:06.789（Asia/Taipei）',全部答案含未成功:true,無人題無虛構答案:true,取消不結束與重複不改時間:true,其他老師結束自動關閉舊確認:true,重啟重整保存:true,窄螢幕無水平溢出:true,範圍:'真Chrome學生表單／老師監看、HTTP／WS／SQLite；固定時鐘驗同毫秒及時區，非42分頁效能'},null,2)+'\n');
 }finally{await app?.close().catch(()=>{});if(database.open){identity?.shutdown();database.close();}rmSync(directory,{recursive:true,force:true});}
});

test('10.1 老師匯入介面：繁體驗證、2／20組、選表、跨階段限制及替換清除提醒',async({context})=>{
 test.setTimeout(60000);const directory=mkdtempSync(join(tmpdir(),'crs-teacher-controls-')),database=openDatabase(join(directory,'classroom.db')),password='teacher-controls-fixture';
 const identity=new IdentityService(database,password,Date.now,true);let base='',source=sheetFixture(f1),inspects=0;
 const google=fixtureSheets(identity),activities=new ActivityService(database,identity),imports=new ImportService(database,identity,google,activities,Date.now,async()=>structuredClone(source));
 const app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:password}),database,()=>{},{identity,sheets:google,activities,imports,authenticate:request=>{assertRequestOrigin(request);return identity.principal(identity.proof(request));},beforeRead:()=>identity.sweep(),readModel:()=>readActivityModel(database,identity)});
 const address=await app.listen(0);if(!address||typeof address==='string')throw new Error('隔離服務未啟動');identity.markReady();base=`http://127.0.0.1:${address.port}`;
 try{
  const a=await context.newPage(),b=await context.newPage(),student=await context.newPage();
  for(const p of [a,b]){await p.goto(base);await p.getByRole('button',{name:'老師登入',exact:true}).click();await p.getByRole('button',{name:'登入老師身分',exact:true}).click();await expect(p.getByRole('alert')).toHaveText('老師密碼不正確，請重新輸入。');await p.getByLabel('老師密碼').fill(password);await p.getByRole('button',{name:'登入老師身分',exact:true}).click();await expect(p.getByRole('heading',{name:'老師已登入',exact:true})).toBeVisible();}
  for(const p of [a,b])await expect(p.getByText('robot@fixture.iam.gserviceaccount.com',{exact:true})).toBeVisible();
  a.on('request',request=>{if(request.url()===base+'/api/imports/inspect')inspects++;});
  await a.getByLabel('Google Sheets 網址',{exact:true}).fill('https://docs.google.com/spreadsheets/d/fixture-copy/edit');
  for(const invalid of ['1','21','2.5','']){await a.getByLabel('組數（2～20）',{exact:true}).fill(invalid);await a.getByRole('button',{name:'讀取學習單',exact:true}).click();await expect(a.getByRole('alert')).toHaveText('組數必須是 2～20 的整數。');}expect(inspects).toBe(0);
  await a.getByLabel('組數（2～20）',{exact:true}).fill('2');await a.getByLabel('Google Sheets 網址',{exact:true}).fill('');await a.getByRole('button',{name:'讀取學習單',exact:true}).click();await expect(a.getByRole('alert')).toHaveText('請填寫 Google Sheets 網址。');expect(inspects).toBe(0);
  await a.getByLabel('Google Sheets 網址',{exact:true}).fill('https://docs.google.com/spreadsheets/d/fixture-copy/edit');await a.getByRole('button',{name:'讀取學習單',exact:true}).click();await expect(a.getByText('已完整解析：6 題、6 個作答欄位、2 組。',{exact:true})).toBeVisible();await a.getByRole('button',{name:'取消匯入',exact:true}).click();expect(database.prepare('SELECT id FROM activities').get()).toBeUndefined();
  await a.getByLabel('組數（2～20）',{exact:true}).fill('20');await a.getByRole('button',{name:'讀取學習單',exact:true}).click();await expect(a.getByText('已完整解析：6 題、6 個作答欄位、20 組。',{exact:true})).toBeVisible();await a.getByRole('button',{name:'匯入此學習單',exact:true}).click();await expect(b.getByRole('heading',{name:'待開始',exact:true})).toBeVisible();
  const old=(database.prepare('SELECT id FROM activities').get() as {id:string}).id;expect(database.prepare('SELECT count(*) AS n FROM groups').get()).toEqual({n:20});
  await student.goto(base);await student.getByLabel('暱稱').fill('保留原組員');await student.getByRole('button',{name:/第 1 組 /}).click();await expect(student.getByRole('heading',{name:'已加入組別',exact:true})).toBeVisible();
  source=sheetFixture(f1);source.sheets.push(sheetFixture(f2,2,'題組分頁').sheets[0]!);await a.getByLabel('組數（2～20）',{exact:true}).fill('2');await a.getByRole('button',{name:'讀取學習單',exact:true}).click();await expect(a.getByRole('button',{name:'讀取工作表',exact:true})).toBeDisabled();await a.getByLabel('選擇工作表',{exact:true}).selectOption('2');await a.getByRole('button',{name:'讀取工作表',exact:true}).click();await expect(a.getByText('已完整解析：4 題、6 個作答欄位、2 組。',{exact:true})).toBeVisible();
  await expect(a.getByText(/確認後會清除目前活動的題目、組員及全部作答結果/)).toContainText('尚未匯出的舊結果將無法再匯出');await a.getByRole('button',{name:'取消匯入',exact:true}).click();expect((database.prepare('SELECT id FROM activities').get() as {id:string}).id).toBe(old);await expect(student.getByRole('heading',{name:'已加入組別',exact:true})).toBeVisible();
  source=sheetFixture(f1);await a.getByRole('button',{name:'讀取學習單',exact:true}).click();await expect(a.getByRole('button',{name:'確認替換並匯入',exact:true})).toBeEnabled();await b.getByRole('button',{name:'開始搶答',exact:true}).click();await expect(a.getByRole('heading',{name:'搶答進行中',exact:true})).toBeVisible();await expect(a.getByRole('button',{name:'確認替換並匯入',exact:true})).toBeDisabled();await a.getByRole('button',{name:'取消匯入',exact:true}).click();await expect(a.getByRole('button',{name:'讀取學習單',exact:true})).toHaveCount(0);expect((database.prepare('SELECT id FROM activities').get() as {id:string}).id).toBe(old);
  await b.getByRole('button',{name:'結束活動',exact:true}).click();await b.getByRole('button',{name:'確認結束',exact:true}).click();await expect(a.getByRole('heading',{name:'已結束',exact:true})).toBeVisible();
  source=sheetFixture(f2);await a.getByRole('button',{name:'讀取學習單',exact:true}).click();await expect(a.getByRole('button',{name:'確認替換並匯入',exact:true})).toBeVisible();await a.getByRole('button',{name:'取消匯入',exact:true}).click();expect((database.prepare('SELECT id FROM activities').get() as {id:string}).id).toBe(old);
  await a.getByRole('button',{name:'讀取學習單',exact:true}).click();await a.getByRole('button',{name:'確認替換並匯入',exact:true}).click();await expect(a.getByRole('heading',{name:'待開始',exact:true})).toBeVisible();expect((database.prepare('SELECT id FROM activities').get() as {id:string}).id).not.toBe(old);await expect(student.getByRole('alert')).toContainText('新活動');await expect(student.getByLabel('暱稱')).toHaveValue('保留原組員');
  await a.getByRole('button',{name:'登出',exact:true}).click();await expect(a.getByRole('region',{name:'全部組別提交監看',exact:true})).toHaveCount(0);await expect(b.getByRole('heading',{name:'老師已登入',exact:true})).toBeVisible();await expect(b.getByText('robot@fixture.iam.gserviceaccount.com',{exact:true})).toBeVisible();
  writeFileSync('test-results/teacher-controls.json',JSON.stringify({Chrome:context.browser()!.version(),空密碼繁體錯誤:true,服務帳戶可直接匯入:true,繁體組數驗證:['1','21','2.5','空白'],合法組數:[2,20],選表完整解析:true,待開始及結束替換提示與取消:true,讀取後另一老師開始即禁用提交:true,成功換場才清除舊身分:true,登出只影響自己:true,範圍:'真Chrome／HTTP／SQLite；服務帳戶及來源讀取為隔離替身，真Google整合沿用第6群組證據，沒有外部寫入'},null,2)+'\n');
 }finally{await app.close();identity.shutdown();database.close();rmSync(directory,{recursive:true,force:true});}
});
