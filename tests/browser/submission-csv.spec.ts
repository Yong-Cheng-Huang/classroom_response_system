import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {csvBrowserFixture,csvTeacher,endCsvActivity} from '../helpers/csv-browser.js';
import {parseCsv} from '../helpers/csv.js';
import {replacePreparedActivity} from '../../src/server/activity-replacement.js';
import {preparedActivity} from '../helpers/replacement.js';

const button='下載送出紀錄 CSV';
test('CSV01～05 實際下載全組單題／四子題，位於匯入下方、免Google、UTF8中文與原排名',async({context})=>{
 const f=await csvBrowserFixture();try{
  const teacher=await context.newPage();await teacher.addInitScript(()=>{const counts={created:0,revoked:0};Reflect.set(window,'__csvUrls',counts);const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=(blob:Blob)=>{counts.created++;return create(blob);};URL.revokeObjectURL=(url:string)=>{counts.revoked++;revoke(url);};});await csvTeacher(teacher,f);await expect(teacher.getByRole('button',{name:button,exact:true})).toBeDisabled();
  expect(await teacher.evaluate(()=>document.querySelector('[aria-label="匯入 Guided Notes"]')?.nextElementSibling===document.querySelector('[aria-label="匯出 CSV"]'))).toBe(true);
  const students=[];for(let i=0;i<2;i++){const p=await context.newPage();await p.goto(f.base);await p.getByLabel('暱稱').fill('同名,"學生"');await p.getByRole('button',{name:new RegExp('^第 '+(i+1)+' 組 ')}).click();await expect(p.getByRole('heading',{name:'已加入組別',exact:true})).toBeVisible();expect(await p.getByRole('button',{name:button,exact:true}).count()).toBe(0);students.push(p);}
  await teacher.getByRole('button',{name:'開始搶答',exact:true}).click();await expect(teacher.getByRole('button',{name:button,exact:true})).toBeDisabled();
  const special='中文,"答案"\n第二行👨‍👩‍👧‍👦';for(const [i,p]of students.entries()){
   const q=p.getByRole('region',{name:'第 2 題',exact:true});await expect(q.locator('textarea')).toHaveCount(4);for(let n=0;n<4;n++)await q.locator('textarea').nth(n).fill(n===0?special:n===1?'=1+1':'第'+i+'組子題'+n);await q.getByRole('button',{name:'送出第 2 題',exact:true}).click();await expect(q.getByText('已送出（同名,"學生"）',{exact:true})).toBeVisible();
  }
  const single=students[0]!.getByRole('region',{name:'第 1 題',exact:true});await single.locator('textarea').fill('單題答案');await single.getByRole('button',{name:'送出第 1 題',exact:true}).click();await expect(single.getByText('已送出（同名,"學生"）',{exact:true})).toBeVisible();
  await teacher.getByRole('button',{name:'結束活動',exact:true}).click();await teacher.getByRole('button',{name:'確認結束',exact:true}).click();await expect(teacher.getByRole('button',{name:button,exact:true})).toBeEnabled();
  const pending=teacher.waitForEvent('download');await teacher.getByRole('button',{name:button,exact:true}).click();const download=await pending;expect(download.suggestedFilename()).toBe('classroom-submissions-'+f.activityId+'.csv');const path=await download.path();expect(path).not.toBeNull();const bytes=readFileSync(path!),rows=parseCsv(bytes.toString('utf8'));
  expect([...bytes.subarray(0,3)]).toEqual([239,187,191]);expect(rows).toHaveLength(10);expect(rows.every(r=>r.length===8)).toBe(true);expect(rows[1]!.slice(0,5)).toEqual(['1','','第 1 組','同名,"學生"','單題答案']);expect(rows.filter(r=>r[4]===special)).toHaveLength(2);expect(rows.filter(r=>r[4]==="'=1+1")).toHaveLength(2);expect(rows.slice(2,6).every(r=>r[5]==='1'&&r[7]==='是')).toBe(true);expect(rows.slice(6).every(r=>r[5]==='2'&&r[7]==='否')).toBe(true);expect(rows.slice(1).every(r=>r[6]?.includes('Asia/Taipei'))).toBe(true);
  await expect.poll(()=>teacher.evaluate(()=>Reflect.get(window,'__csvUrls'))).toEqual({created:1,revoked:1});await teacher.getByLabel('匯出 CSV',{exact:true}).screenshot({path:'test-results/csv-export-section.png'});
  writeFileSync('test-results/csv-export-browser.json',JSON.stringify({Chrome:context.browser()!.version(),真實下載:true,資料列:rows.length-1,欄位:8,原名次:[1,2],中文多行與emoji:true,題組四列:true,Google未配置:true,物件網址已釋放:true,Excel原生開啟:'尚未實測'},null,2)+'\n');
 }finally{await f.close();}
});

test('CSV01／08 JSON錯誤不下載，可重試取得零提交表頭',async({page})=>{
 const f=await csvBrowserFixture();try{await csvTeacher(page,f);await endCsvActivity(page);const downloads:string[]=[];page.on('download',d=>downloads.push(d.suggestedFilename()));await page.route('**/submissions.csv',r=>r.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'STATE_CONFLICT',message:'下載測試失敗，請重試。'}})}));await page.getByRole('button',{name:button,exact:true}).click();await expect(page.getByLabel('匯出 CSV',{exact:true}).getByRole('alert')).toHaveText('下載測試失敗，請重試。');expect(downloads).toEqual([]);await page.unroute('**/submissions.csv');const pending=page.waitForEvent('download');await page.getByRole('button',{name:button,exact:true}).click();const d=await pending;expect(parseCsv(readFileSync((await d.path())!,'utf8'))).toHaveLength(1);
 }finally{await f.close();}
});

for(const action of ['logout','replacement'] as const)test('CSV08 '+action+' 後取消延遲檔案，不觸發舊下載',async({page})=>{
 const f=await csvBrowserFixture();let release:()=>void=()=>{};try{
  await csvTeacher(page,f);await endCsvActivity(page);let entered:()=>void=()=>{},finished:()=>void=()=>{};const seen=new Promise<void>(r=>entered=r),done=new Promise<void>(r=>finished=r),gate=new Promise<void>(r=>release=r);const downloads:string[]=[];page.on('download',d=>downloads.push(d.suggestedFilename()));
  await page.route('**/submissions.csv',async r=>{entered();await gate;try{await r.fulfill({status:200,contentType:'text/csv',body:'\uFEFF"舊檔案"\r\n'});}catch{}finally{finished();}});await page.getByRole('button',{name:button,exact:true}).click();await seen;
  if(action==='logout'){await page.getByRole('button',{name:'登出',exact:true}).click();await expect(page.getByRole('button',{name:'學生加入',exact:true})).toBeVisible();}
  else{const version=(f.database.prepare('SELECT version FROM activities').get() as {version:number}).version;await replacePreparedActivity(f.database,preparedActivity(),{activityId:f.activityId,version,confirmed:true});await expect(page.getByRole('button',{name:button,exact:true})).toBeDisabled();}
  release();await done;await page.waitForTimeout(150);expect(downloads).toEqual([]);
 }finally{release();await f.close();}
});
