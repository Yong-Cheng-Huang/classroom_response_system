import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {publicImportFixture,publicUrl} from '../helpers/public-import.js';
import {csvTeacher} from '../helpers/csv-browser.js';
import {sheetFixture} from '../helpers/sheets.js';
import {f2} from '../fixtures/catalog.js';
import {parseCsv} from '../helpers/csv.js';

test('公開免Google：模式鎖定、取消重選、多表、學生作答到CSV；寫回仍拒絕',async({context})=>{
 const f=await publicImportFixture(true,true);try{
  const source=sheetFixture(f2);source.sheets.push(sheetFixture(f2,2,'第二工作表').sheets[0]!);f.setTransport(async()=>Response.json(source));
  const teacher=await context.newPage();let headers:Record<string,string>={};teacher.on('request',r=>{const h=r.headers();if(r.url().startsWith(f.base+'/api/')&&h.authorization)headers={Authorization:h.authorization,'X-Tab-Proof':h['x-tab-proof']!,'X-Document-Instance':h['x-document-instance']!,'X-Session-Generation':h['x-session-generation']!,'Content-Type':'application/json'};});await csvTeacher(teacher,f);const mode=teacher.getByLabel('匯入方式',{exact:true}),read=teacher.getByRole('button',{name:'讀取學習單',exact:true});
  await expect(mode).toHaveValue('PUBLIC');await expect(read).toBeEnabled();
  await mode.selectOption('SERVICE_ACCOUNT');await expect(read).toBeDisabled();await mode.selectOption('PUBLIC');await teacher.getByLabel('Google Sheets 網址',{exact:true}).fill(publicUrl);await read.click();
  await expect(mode).toBeDisabled();await expect(teacher.getByLabel('選擇工作表',{exact:true})).toBeVisible();await teacher.getByRole('button',{name:'取消匯入',exact:true}).click();await expect(mode).toBeEnabled();
  await read.click();await teacher.getByLabel('選擇工作表',{exact:true}).selectOption('2');await teacher.getByRole('button',{name:'讀取工作表',exact:true}).click();await expect(teacher.getByText('已完整解析：4 題、6 個作答欄位、2 組。',{exact:true})).toBeVisible();await teacher.getByRole('button',{name:'匯入此學習單',exact:true}).click();await expect(teacher.getByRole('button',{name:'開始搶答',exact:true})).toBeEnabled();
  const student=await context.newPage();await student.goto(f.base);await student.getByLabel('暱稱').fill('公開匯入學生');await student.getByRole('button',{name:/^第 1 組 /}).click();await expect(student.getByRole('heading',{name:'已加入組別',exact:true})).toBeVisible();
  await teacher.getByRole('button',{name:'開始搶答',exact:true}).click();const question=student.getByRole('region',{name:'第 1.0 題',exact:true});await expect(question.locator('textarea')).toHaveCount(2);for(let i=0;i<2;i++)await question.locator('textarea').nth(i).fill('公開來源作答');await question.getByRole('button',{name:'送出第 1.0 題',exact:true}).click();await expect(question.getByText('已送出（公開匯入學生）',{exact:true})).toBeVisible();
  await teacher.getByRole('button',{name:'結束活動',exact:true}).click();await teacher.getByRole('button',{name:'確認結束',exact:true}).click();const pending=teacher.waitForEvent('download');await teacher.getByRole('button',{name:'下載送出紀錄 CSV',exact:true}).click();const download=await pending;const rows=parseCsv(readFileSync((await download.path())!,'utf8'));expect(rows).toHaveLength(3);expect(rows[1]![4]).toBe('公開來源作答');
  const current=f.database.prepare('SELECT id,version FROM activities').get() as {id:string;version:number};const denied=await fetch(f.base+`/api/activities/${current.id}/exports`,{method:'POST',headers,body:JSON.stringify({accessMode:'SERVICE_ACCOUNT',requestId:randomUUID(),mode:'ANSWERS',paused:true,expectedVersion:current.version})});expect(denied.status).toBe(503);expect((await denied.json()).error.code).toBe('SERVICE_ACCOUNT_NOT_CONFIGURED');
  expect(f.database.prepare('SELECT * FROM google_connection').get()).toBeUndefined();expect(f.oauthCalls()).toBe(0);await teacher.getByLabel('匯入 Guided Notes',{exact:true}).screenshot({path:'test-results/public-import.png'});
  writeFileSync('test-results/public-import-browser.json',JSON.stringify({Chrome:context.browser()!.version(),公開上游:'模擬Sheets API，非真實Google驗證',OAuthProvider:null,Google連結:false,模式切換與候選鎖定:true,多表選擇:true,真學生表單:true,真CSV下載:true},null,2)+'\n');
 }finally{await f.close();}
});
test('公開缺配置提示與失敗不fallback、不登出，服務帳戶選項明確可選',async({page})=>{
 const missing=await publicImportFixture(false,true);try{await csvTeacher(page,missing);await expect(page.getByText(/公開讀取尚未配置/)).toBeVisible();await expect(page.getByRole('button',{name:'讀取學習單',exact:true})).toBeDisabled();await page.getByLabel('匯入方式',{exact:true}).selectOption('SERVICE_ACCOUNT');await expect(page.getByText('請先配置服務帳戶，並將原表共用給頁面顯示的Email。',{exact:true})).toBeVisible();}finally{await missing.close();}
 const f=await publicImportFixture(true,true);try{f.setTransport(async()=>Response.json({error:{message:'PUBLIC_CANARY'}},{status:403}));await csvTeacher(page,f);await page.getByLabel('Google Sheets 網址',{exact:true}).fill(publicUrl);await page.getByRole('button',{name:'讀取學習單',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'無法公開讀取此文件'})).toBeVisible();await expect(page.getByRole('heading',{name:'老師已登入',exact:true})).toBeVisible();await expect(page.getByLabel('匯入方式',{exact:true})).toHaveValue('PUBLIC');expect(await page.content()).not.toContain('PUBLIC_CANARY');expect(f.oauthCalls()).toBe(0);}finally{await f.close();}
});
