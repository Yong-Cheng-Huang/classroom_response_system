import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {singleImportFixture,importUrl} from '../helpers/single-import.js';
import {csvTeacher} from '../helpers/csv-browser.js';
import {sheetFixture} from '../helpers/sheets.js';
import {f2} from '../fixtures/catalog.js';
import {parseCsv} from '../helpers/csv.js';

test('單一服務帳戶：無方式選單、直接讀取、多表／取消、學生作答到CSV',async({context})=>{
 const f=await singleImportFixture(true,true);try{
  const source=sheetFixture(f2);source.sheets.push(sheetFixture(f2,2,'第二工作表').sheets[0]!);f.setTransport(async()=>Response.json(source));const teacher=await context.newPage(),requests:Record<string,unknown>[]=[];teacher.on('request',r=>{if(r.url().endsWith('/api/imports/inspect'))requests.push(r.postDataJSON());});await csvTeacher(teacher,f);
  const read=teacher.getByRole('button',{name:'讀取學習單',exact:true}),input=teacher.getByLabel('Google Sheets 網址',{exact:true});await expect(teacher.getByLabel('匯入方式',{exact:true})).toHaveCount(0);await expect(read).toBeEnabled();await expect(teacher.getByText('robot@fixture.iam.gserviceaccount.com',{exact:true})).toBeVisible();await expect(teacher.getByText(/GOOGLE_SHEETS_API_KEY|知道連結的任何人/)).toHaveCount(0);
  await input.fill(importUrl);await read.click();await expect(input).toBeDisabled();await expect(teacher.getByLabel('選擇工作表',{exact:true})).toBeVisible();await teacher.getByRole('button',{name:'取消匯入',exact:true}).click();await expect(input).toBeEnabled();
  await read.click();await teacher.getByLabel('選擇工作表',{exact:true}).selectOption('2');await teacher.getByRole('button',{name:'讀取工作表',exact:true}).click();await expect(teacher.getByText('已完整解析：4 題、6 個作答欄位、2 組。',{exact:true})).toBeVisible();await teacher.getByRole('button',{name:'匯入此學習單',exact:true}).click();expect(requests.every(body=>!Object.hasOwn(body,'accessMode'))).toBe(true);
  const student=await context.newPage();await student.goto(f.base);await student.getByLabel('暱稱').fill('服務帳戶學生');await student.getByRole('button',{name:/^第 1 組 /}).click();await expect(student.getByRole('heading',{name:'已加入組別',exact:true})).toBeVisible();await teacher.getByRole('button',{name:'開始搶答',exact:true}).click();const question=student.getByRole('region',{name:'第 1.0 題',exact:true});for(let i=0;i<2;i++)await question.locator('textarea').nth(i).fill('單一匯入作答');await question.getByRole('button',{name:'送出第 1.0 題',exact:true}).click();await expect(question.getByText('已送出（服務帳戶學生）',{exact:true})).toBeVisible();
  await teacher.getByRole('button',{name:'結束活動',exact:true}).click();await teacher.getByRole('button',{name:'確認結束',exact:true}).click();const pending=teacher.waitForEvent('download');await teacher.getByRole('button',{name:'下載送出紀錄 CSV',exact:true}).click();const bytes=readFileSync((await (await pending).path())!),rows=parseCsv(bytes.toString('utf8'));expect(rows).toHaveLength(3);expect(rows[1]![4]).toBe('單一匯入作答');await teacher.getByLabel('匯入 Guided Notes',{exact:true}).screenshot({path:'test-results/single-import.png'});
  writeFileSync('test-results/single-import-browser.json',JSON.stringify({Chrome:context.browser()!.version(),方式選單:false,匯入請求省略方式:true,多表及取消:true,真學生表單:true,真CSV下載:true,Google傳輸:'隔離替身'},null,2)+'\n');
 }finally{await f.close();}
});
test('服務帳戶缺配置與無權提示，不提供公開備援、不登出',async({page})=>{
 const missing=await singleImportFixture(false,true);try{await csvTeacher(page,missing);await expect(page.getByLabel('匯入方式',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'讀取學習單',exact:true})).toBeDisabled();await expect(page.getByText('請先配置服務帳戶，並將原表共用給頁面顯示的Email。',{exact:true})).toBeVisible();await expect(page.getByText(/GOOGLE_SHEETS_API_KEY|公開讀取|知道連結的任何人/)).toHaveCount(0);}finally{await missing.close();}
 const f=await singleImportFixture(true,true);try{f.setTransport(async()=>Response.json({error:{message:'PRIVATE_CANARY'}},{status:403}));await csvTeacher(page,f);await page.getByLabel('Google Sheets 網址',{exact:true}).fill(importUrl);await page.getByRole('button',{name:'讀取學習單',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'服務帳戶無法讀取此文件'})).toBeVisible();await expect(page.getByRole('heading',{name:'老師已登入',exact:true})).toBeVisible();expect(await page.content()).not.toContain('PRIVATE_CANARY');}finally{await f.close();}
});
