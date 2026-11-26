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
import { sessionKeys } from '../../src/shared/session.js';

async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'crs-student-browser-')),database=openDatabase(join(directory,'classroom.db')),password='student-browser-only';
 const identity=new IdentityService(database,password,Date.now,true);
 const app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:password}),database,()=>{},{identity,activities:new ActivityService(database,identity),submissions:new SubmissionService(database,identity),authenticate:request=>{assertRequestOrigin(request);return identity.principal(identity.proof(request));},beforeRead:()=>identity.sweep(),readModel:()=>readActivityModel(database,identity)});
 const address=await app.listen(0);if(!address||typeof address==='string')throw new Error('測試服務未啟動');identity.markReady();
 return{database,password,base:`http://127.0.0.1:${address.port}`,close:async()=>{await app.close();identity.shutdown();database.close();rmSync(directory,{recursive:true,force:true});}};
}
async function login(p:Page,password:string){await p.getByRole('button',{name:'老師登入',exact:true}).click();await p.getByLabel('老師密碼').fill(password);await p.getByRole('button',{name:'登入老師身分',exact:true}).click();await expect(p.getByRole('heading',{name:'老師已登入',exact:true})).toBeVisible();}
async function joinGroup(p:Page,name='同名👨‍👩‍👧‍👦',number=1){await p.getByLabel('暱稱').fill(name);await p.getByRole('button',{name:new RegExp(`第 ${number} 組`)}).click();await expect(p.getByRole('heading',{name:'已加入組別',exact:true})).toBeVisible();}
const question=(p:Page,n:number)=>p.getByRole('region',{name:`第 ${n} 題`,exact:true});
const drafts=(p:Page)=>p.evaluate(prefix=>Object.keys(sessionStorage).filter(k=>k.startsWith(prefix)).map(k=>JSON.parse(sessionStorage.getItem(k)!)),sessionKeys.draftPrefix);

test('9.1～9.6 學生表單：等待、同名組員、分頁草稿、四子題、鎖定、結束與換場',async({context})=>{
 test.setTimeout(60000);const f=await fixture();
 try{
  const a=await context.newPage(),b=await context.newPage(),other=await context.newPage(),teacher=await context.newPage();
  await a.goto(f.base);await expect(a.getByText(/等待老師匯入/)).toBeVisible();
  await a.getByLabel('暱稱').fill('先等候');await a.reload();await expect(a.getByLabel('暱稱')).toHaveValue('先等候');
  const prepared=preparedActivity();prepared.questions[0]!.fields[0]!.prompt='<img src=x onerror="window.injected=1">\n請說明答案';
  prepared.questions[1]!.fields.push({label:'（3）',prompt:'第三子題',answerRange:'H9',original:{}},{label:'（4）',prompt:'第四子題',answerRange:'H10',original:{}});
  const activity=await replacePreparedActivity(f.database,prepared,{activityId:null,version:null,confirmed:false});
  for(const p of [b,other,teacher])await p.goto(f.base);
  await joinGroup(a);await joinGroup(b);await joinGroup(other,'另一組',2);await login(teacher,f.password);
  for(const p of [a,b]){await expect(p.getByRole('list',{name:'本組成員'}).getByRole('listitem')).toHaveCount(2);await expect(p.getByText('本人',{exact:true})).toHaveCount(1);await expect(p.getByRole('textbox')).toHaveCount(0);await expect(p.getByText('新子題一')).toHaveCount(0);}
  await a.evaluate(prefix=>sessionStorage.setItem(prefix+'leave-check',JSON.stringify('待清除的原組草稿')),sessionKeys.draftPrefix);
  await a.getByRole('button',{name:'離開組別',exact:true}).click();await expect.poll(()=>drafts(a)).toEqual([]);await joinGroup(a,'換組暱稱',2);
  await expect(a.getByRole('list',{name:'本組成員'}).getByRole('listitem')).toHaveCount(2);
  await a.getByRole('button',{name:'離開組別',exact:true}).click();await joinGroup(a);await a.reload();
  await expect(a.getByRole('list',{name:'本組成員'}).getByRole('listitem')).toHaveCount(2);
  await teacher.getByRole('button',{name:'開始搶答',exact:true}).click();
  await expect(a.getByRole('region',{name:'作答題目'})).toBeVisible();await expect(a.getByRole('textbox')).toHaveCount(5);
  await expect(a.getByRole('button',{name:'離開組別',exact:true})).toBeDisabled();
  await expect(question(a,1).getByText('<img src=x onerror="window.injected=1">',{exact:false})).toBeVisible();expect(await a.evaluate(()=>Reflect.get(window,'injected'))).toBeUndefined();
  const first=question(a,1).getByRole('textbox');await first.fill('字'.repeat(201));await expect(a.getByRole('button',{name:'送出第 1 題',exact:true})).toBeDisabled();
  await first.fill('👨‍👩‍👧‍👦'.repeat(200));await expect(a.getByRole('button',{name:'送出第 1 題',exact:true})).toBeEnabled();
  const raw='  個人甲\n<img src=x onerror="window.injected=2">  ';await first.fill(raw);await question(b,1).getByRole('textbox').fill('個人乙');
  await a.reload();await expect(question(a,1).getByRole('textbox')).toHaveValue(raw);await expect(question(b,1).getByRole('textbox')).toHaveValue('個人乙');
  await a.screenshot({path:'test-results/student-desktop.png',fullPage:true});await a.setViewportSize({width:390,height:844});
  await a.screenshot({path:'test-results/student-mobile.png',fullPage:true});expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const fields=question(a,2).getByRole('textbox');await fields.nth(0).fill('子題一');await expect(a.getByRole('button',{name:'送出第 2 題',exact:true})).toBeDisabled();
  for(let i=1;i<4;i++)await fields.nth(i).fill('子題'+i);await expect(a.getByRole('button',{name:'送出第 2 題',exact:true})).toBeEnabled();
  await a.getByRole('button',{name:'送出第 1 題',exact:true}).click();
  for(const p of [a,b]){await expect(question(p,1).getByText('已送出（同名👨‍👩‍👧‍👦）',{exact:true})).toBeVisible();await expect(question(p,1).getByRole('textbox')).toHaveCount(0);await expect(question(p,2).getByRole('textbox')).toHaveCount(4);}
  expect(await a.evaluate(()=>Reflect.get(window,'injected'))).toBeUndefined();await expect(question(a,1).locator('img')).toHaveCount(0);
  await expect(question(other,1).getByRole('textbox')).toHaveValue('');expect((await drafts(b)).length).toBe(0);
  await a.getByRole('button',{name:'送出第 2 題',exact:true}).click();await expect(question(b,2).getByRole('textbox')).toHaveCount(0);
  expect(f.database.prepare('SELECT count(*) AS n FROM submissions').get()).toEqual({n:2});await expect.poll(()=>drafts(a)).toEqual([]);
  await question(other,2).getByRole('textbox').nth(0).fill('未提交草稿');
  await teacher.getByRole('button',{name:'結束活動',exact:true}).click();await teacher.getByRole('button',{name:'確認結束',exact:true}).click();
  for(const p of [a,b,other]){await expect(p.getByRole('region',{name:'活動結果'})).toBeVisible();await expect(p).toHaveURL(/#\/results$/);await expect(p.getByRole('textbox')).toHaveCount(0);}
  await other.evaluate(()=>{location.hash='return';});await expect(other).toHaveURL(/#\/results$/);await other.reload();await expect(other.getByRole('region',{name:'活動結果'})).toBeVisible();
  const late=await context.newPage();await late.goto(f.base);await expect(late.getByRole('button',{name:/第 1 組/})).toBeDisabled();
  const old=f.database.prepare('SELECT version FROM activities WHERE id=?').get(activity.activityId) as {version:number};
  await replacePreparedActivity(f.database,preparedActivity(),{activityId:activity.activityId,version:old.version,confirmed:true});
  await expect(other.getByLabel('暱稱')).toHaveValue('另一組');await expect(other.getByRole('alert')).toContainText('新活動');expect(await drafts(other)).toEqual([]);
  await expect(other).not.toHaveURL(/#\/results$/);await joinGroup(other,'另一組',1);await expect(other.getByRole('textbox')).toHaveCount(0);
  writeFileSync('test-results/student-browser.json',JSON.stringify({日期:'2026-11-26 Asia/Taipei',Chrome:context.browser()!.version(),同名本人唯一:true,READY無敘述:true,四子題完整才可提交:true,每頁草稿獨立且重整恢復:true,可見字元邊界:[200,201],HTML純文字:true,同組鎖定且顯示送出者:true,其他組不洩漏:true,結束路由與換場清除:true,行動版無水平溢出:true,資料庫提交數:2,範圍:'獨立資料庫、真 Chrome 學生表單；完整結果 UI 由 11.3 承接'},null,2)+'\n');
 }finally{await f.close();}
});

test('9.4～9.6 送出前中斷、重整及相同 requestId 重試；儲存失敗不送出',async({context})=>{
 test.setTimeout(45000);const f=await fixture();
 try{
  await replacePreparedActivity(f.database,preparedActivity(),{activityId:null,version:null,confirmed:false});
  const p=await context.newPage(),teacher=await context.newPage();await p.goto(f.base);await joinGroup(p,'重送者');await teacher.goto(f.base);await login(teacher,f.password);
  await teacher.getByRole('button',{name:'開始搶答',exact:true}).click();await expect(question(p,1).getByRole('textbox')).toBeVisible();
  let posts=0,fail=true;const bodies:unknown[]=[];
  await p.route('**/submissions',async route=>{posts++;bodies.push(route.request().postDataJSON());if(fail)await route.abort('failed');else await route.continue();});
  await p.evaluate(prefix=>{const original=Storage.prototype.setItem;Reflect.set(window,'restoreStorage',()=>{Storage.prototype.setItem=original;});Storage.prototype.setItem=function(k,v){if(k.startsWith(prefix))throw new DOMException('隔離測試容量已滿','QuotaExceededError');original.call(this,k,v);};},sessionKeys.draftPrefix);
  await question(p,1).getByRole('textbox').fill('保留原始提交');await expect(question(p,1).getByText(/草稿暫時無法保存/)).toBeVisible();await p.getByRole('button',{name:'送出第 1 題',exact:true}).click();expect(posts).toBe(0);
  await p.evaluate(()=>Reflect.get(window,'restoreStorage')());
  await p.getByRole('button',{name:'重新確認第 1 題',exact:true}).click();
  await expect(p.getByRole('button',{name:'重新確認第 1 題',exact:true})).toBeEnabled({timeout:10000});expect(posts).toBe(1);
  await expect(question(p,1).getByRole('textbox')).toBeDisabled();const before=await drafts(p);expect(before[0].attempt.requestId).toBeTruthy();
  await p.reload();await expect(p.getByRole('button',{name:'重新確認第 1 題',exact:true})).toBeEnabled();expect(await drafts(p)).toEqual(before);
  fail=false;await p.getByRole('button',{name:'重新確認第 1 題',exact:true}).click();await expect(question(p,1).getByText('已送出（重送者）',{exact:true})).toBeVisible();
  expect(posts).toBe(2);expect(bodies[1]).toEqual(bodies[0]);await expect.poll(()=>drafts(p)).toEqual([]);expect(f.database.prepare('SELECT count(*) AS n FROM submissions').get()).toEqual({n:1});
  writeFileSync('test-results/student-retry.json',JSON.stringify({Chrome:context.browser()!.version(),儲存失敗不提交:true,未落盤中斷保留原requestId與內容:true,重整後同ID重試:true,原始答案只提交一次:true,送出後草稿清除:true},null,2)+'\n');
 }finally{await f.close();}
});

test('9.5 伺服器欄位錯誤、他人先送出，以及換場後延遲回覆不得復活草稿',async({context})=>{
 test.setTimeout(45000);const f=await fixture();let release:()=>void=()=>{};
 try{
  const activity=await replacePreparedActivity(f.database,preparedActivity(),{activityId:null,version:null,confirmed:false});
  const a=await context.newPage(),b=await context.newPage(),teacher=await context.newPage();
  for(const p of [a,b,teacher])await p.goto(f.base);await joinGroup(a,'延遲者');await joinGroup(b,'先送者');await login(teacher,f.password);
  await teacher.getByRole('button',{name:'開始搶答',exact:true}).click();await expect(question(a,1).getByRole('textbox')).toBeVisible();
  await question(a,1).getByRole('textbox').fill('甲草稿');
  let invalid=true;
  await a.route('**/submissions',async route=>{
   if(invalid){invalid=false;const body=route.request().postDataJSON();await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INVALID_ANSWER',message:'請檢查作答內容。',fieldIds:[body.answers[0].fieldId]}})});}
   else await route.abort('failed');
  });
  await a.getByRole('button',{name:'送出第 1 題',exact:true}).click();await expect(question(a,1).getByRole('alert')).toHaveText('請檢查作答內容。');
  await expect(question(a,1).getByRole('textbox')).toHaveAttribute('aria-invalid','true');await expect(question(a,1).getByRole('textbox')).toHaveValue('甲草稿');expect((await drafts(a))[0].attempt).toBeUndefined();
  await a.getByRole('button',{name:'送出第 1 題',exact:true}).click();await expect(a.getByRole('button',{name:'重新確認第 1 題',exact:true})).toBeEnabled({timeout:10000});
  await question(b,1).getByRole('textbox').fill('乙先送出');await b.getByRole('button',{name:'送出第 1 題',exact:true}).click();
  await expect(question(a,1).getByText('已送出（先送者）',{exact:true})).toBeVisible();await expect(question(a,1).getByRole('textbox')).toHaveCount(0);await expect.poll(()=>drafts(a)).toEqual([]);
  await a.unroute('**/submissions');let held=false;const gate=new Promise<void>(resolve=>{release=resolve;});
  await a.route('**/submissions',async route=>{const response=await route.fetch();held=true;await gate;await route.fulfill({response}).catch(()=>{});});
  const fields=question(a,2).getByRole('textbox');for(let i=0;i<2;i++)await fields.nth(i).fill('延遲的子題'+i);
  await a.getByRole('button',{name:'送出第 2 題',exact:true}).click();await expect.poll(()=>held).toBe(true);
  await teacher.getByRole('button',{name:'結束活動',exact:true}).click();await teacher.getByRole('button',{name:'確認結束',exact:true}).click();await expect(a.getByRole('region',{name:'活動結果'})).toBeVisible();
  const old=f.database.prepare('SELECT version FROM activities WHERE id=?').get(activity.activityId) as {version:number};
  await replacePreparedActivity(f.database,preparedActivity(),{activityId:activity.activityId,version:old.version,confirmed:true});
  await expect(a.getByLabel('暱稱')).toHaveValue('延遲者');release();await a.unrouteAll({behavior:'wait'});
  await expect(a.getByRole('heading',{name:'已加入組別',exact:true})).toHaveCount(0);expect(await drafts(a)).toEqual([]);await expect(a.getByRole('button',{name:/第 1 組/})).toBeEnabled();
  writeFileSync('test-results/student-boundaries.json',JSON.stringify({Chrome:context.browser()!.version(),欄位錯誤繁體提示與原草稿:true,他人先送出清除待確認草稿:true,結束切離作答:true,換場後延遲回覆不復活身分或草稿:true,範圍:'欄位錯誤使用隔離HTTP替身；競爭提交、結束及換場使用正式服務'},null,2)+'\n');
 }finally{release();await f.close();}
});
