# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: student.spec.ts >> 9.4～9.6 送出前中斷、重整及相同 requestId 重試；儲存失敗不送出
- Location: tests/browser/student.spec.ts:77:1

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator: getByRole('button', { name: '重新確認第 1 題', exact: true })
Expected: enabled
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeEnabled" getByRole('button', { name: '重新確認第 1 題', exact: true }) with timeout 10000ms
  - waiting for getByRole('button', { name: '重新確認第 1 題', exact: true })
    - locator resolved to <button disabled type="submit" class="primary" aria-label="重新確認第 1 題">正在送出…</button>
    - unexpected value "disabled"

```

```yaml
- main:
  - paragraph: 課堂互動・共同探索
  - status: 本機服務已連線
  - text: 課堂登記簿 ／ 01
  - heading "課堂搶答系統" [level=1]
  - paragraph: 加入你的組別， 一起思考，搶先回答。
  - paragraph: 每個分頁各自登入， 老師與不同組別可以同時操作。
  - region "身分與組別":
    - alert: 連線中斷，正在嘗試恢復身分。
    - heading "正在恢復連線" [level=2]
    - paragraph: 暫存資料已保留，請稍候。
  - text: 共同作答，以組別為單位。搶答名次由伺服器判定。
```

# Test source

```ts
  1   | import { test,expect,type Page } from '@playwright/test';
  2   | import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
  3   | import { tmpdir } from 'node:os';
  4   | import { join } from 'node:path';
  5   | import { openDatabase } from '../../src/server/database.js';
  6   | import { createApplication } from '../../src/server/app.js';
  7   | import { IdentityService } from '../../src/server/identity.js';
  8   | import { ActivityService } from '../../src/server/activity.js';
  9   | import { SubmissionService } from '../../src/server/submissions.js';
  10  | import { readConfig } from '../../src/server/config.js';
  11  | import { assertRequestOrigin } from '../../src/server/identity-http.js';
  12  | import { readActivityModel } from '../../src/server/read-model.js';
  13  | import { replacePreparedActivity } from '../../src/server/activity-replacement.js';
  14  | import { preparedActivity } from '../helpers/replacement.js';
  15  | import { sessionKeys } from '../../src/shared/session.js';
  16  | 
  17  | async function fixture(){
  18  |  const directory=mkdtempSync(join(tmpdir(),'crs-student-browser-')),database=openDatabase(join(directory,'classroom.db')),password='student-browser-only';
  19  |  const identity=new IdentityService(database,password,Date.now,true);
  20  |  const app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:password}),database,()=>{},{identity,activities:new ActivityService(database,identity),submissions:new SubmissionService(database,identity),authenticate:request=>{assertRequestOrigin(request);return identity.principal(identity.proof(request));},beforeRead:()=>identity.sweep(),readModel:()=>readActivityModel(database,identity)});
  21  |  const address=await app.listen(0);if(!address||typeof address==='string')throw new Error('測試服務未啟動');identity.markReady();
  22  |  return{database,password,base:`http://127.0.0.1:${address.port}`,close:async()=>{await app.close();identity.shutdown();database.close();rmSync(directory,{recursive:true,force:true});}};
  23  | }
  24  | async function login(p:Page,password:string){await p.getByRole('button',{name:'老師登入',exact:true}).click();await p.getByLabel('老師密碼').fill(password);await p.getByRole('button',{name:'登入老師身分',exact:true}).click();await expect(p.getByRole('heading',{name:'老師已登入',exact:true})).toBeVisible();}
  25  | async function joinGroup(p:Page,name='同名👨‍👩‍👧‍👦',number=1){await p.getByLabel('暱稱').fill(name);await p.getByRole('button',{name:new RegExp(`第 ${number} 組`)}).click();await expect(p.getByRole('heading',{name:'已加入組別',exact:true})).toBeVisible();}
  26  | const question=(p:Page,n:number)=>p.getByRole('region',{name:`第 ${n} 題`,exact:true});
  27  | const drafts=(p:Page)=>p.evaluate(prefix=>Object.keys(sessionStorage).filter(k=>k.startsWith(prefix)).map(k=>JSON.parse(sessionStorage.getItem(k)!)),sessionKeys.draftPrefix);
  28  | 
  29  | test('9.1～9.6 學生表單：等待、同名組員、分頁草稿、四子題、鎖定、結束與換場',async({context})=>{
  30  |  test.setTimeout(60000);const f=await fixture();
  31  |  try{
  32  |   const a=await context.newPage(),b=await context.newPage(),other=await context.newPage(),teacher=await context.newPage();
  33  |   await a.goto(f.base);await expect(a.getByText(/等待老師匯入/)).toBeVisible();
  34  |   await a.getByLabel('暱稱').fill('先等候');await a.reload();await expect(a.getByLabel('暱稱')).toHaveValue('先等候');
  35  |   const prepared=preparedActivity();prepared.questions[0]!.fields[0]!.prompt='<img src=x onerror="window.injected=1">\n請說明答案';
  36  |   prepared.questions[1]!.fields.push({label:'（3）',prompt:'第三子題',answerRange:'H9',original:{}},{label:'（4）',prompt:'第四子題',answerRange:'H10',original:{}});
  37  |   const activity=await replacePreparedActivity(f.database,prepared,{activityId:null,version:null,confirmed:false});
  38  |   for(const p of [b,other,teacher])await p.goto(f.base);
  39  |   await joinGroup(a);await joinGroup(b);await joinGroup(other,'另一組',2);await login(teacher,f.password);
  40  |   for(const p of [a,b]){await expect(p.getByRole('list',{name:'本組成員'}).getByRole('listitem')).toHaveCount(2);await expect(p.getByText('本人',{exact:true})).toHaveCount(1);await expect(p.getByRole('textbox')).toHaveCount(0);await expect(p.getByText('新子題一')).toHaveCount(0);}
  41  |   await a.evaluate(prefix=>sessionStorage.setItem(prefix+'leave-check',JSON.stringify('待清除的原組草稿')),sessionKeys.draftPrefix);
  42  |   await a.getByRole('button',{name:'離開組別',exact:true}).click();await expect.poll(()=>drafts(a)).toEqual([]);await joinGroup(a,'換組暱稱',2);
  43  |   await expect(a.getByRole('list',{name:'本組成員'}).getByRole('listitem')).toHaveCount(2);
  44  |   await a.getByRole('button',{name:'離開組別',exact:true}).click();await joinGroup(a);await a.reload();
  45  |   await expect(a.getByRole('list',{name:'本組成員'}).getByRole('listitem')).toHaveCount(2);
  46  |   await teacher.getByRole('button',{name:'開始搶答',exact:true}).click();
  47  |   await expect(a.getByRole('region',{name:'作答題目'})).toBeVisible();await expect(a.getByRole('textbox')).toHaveCount(5);
  48  |   await expect(a.getByRole('button',{name:'離開組別',exact:true})).toBeDisabled();
  49  |   await expect(question(a,1).getByText('<img src=x onerror="window.injected=1">',{exact:false})).toBeVisible();expect(await a.evaluate(()=>Reflect.get(window,'injected'))).toBeUndefined();
  50  |   const first=question(a,1).getByRole('textbox');await first.fill('字'.repeat(201));await expect(a.getByRole('button',{name:'送出第 1 題',exact:true})).toBeDisabled();
  51  |   await first.fill('👨‍👩‍👧‍👦'.repeat(200));await expect(a.getByRole('button',{name:'送出第 1 題',exact:true})).toBeEnabled();
  52  |   const raw='  個人甲\n<img src=x onerror="window.injected=2">  ';await first.fill(raw);await question(b,1).getByRole('textbox').fill('個人乙');
  53  |   await a.reload();await expect(question(a,1).getByRole('textbox')).toHaveValue(raw);await expect(question(b,1).getByRole('textbox')).toHaveValue('個人乙');
  54  |   await a.screenshot({path:'test-results/student-desktop.png',fullPage:true});await a.setViewportSize({width:390,height:844});
  55  |   await a.screenshot({path:'test-results/student-mobile.png',fullPage:true});expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  56  |   const fields=question(a,2).getByRole('textbox');await fields.nth(0).fill('子題一');await expect(a.getByRole('button',{name:'送出第 2 題',exact:true})).toBeDisabled();
  57  |   for(let i=1;i<4;i++)await fields.nth(i).fill('子題'+i);await expect(a.getByRole('button',{name:'送出第 2 題',exact:true})).toBeEnabled();
  58  |   await a.getByRole('button',{name:'送出第 1 題',exact:true}).click();
  59  |   for(const p of [a,b]){await expect(question(p,1).getByText('已送出（同名👨‍👩‍👧‍👦）',{exact:true})).toBeVisible();await expect(question(p,1).getByRole('textbox')).toHaveCount(0);await expect(question(p,2).getByRole('textbox')).toHaveCount(4);}
  60  |   expect(await a.evaluate(()=>Reflect.get(window,'injected'))).toBeUndefined();await expect(question(a,1).locator('img')).toHaveCount(0);
  61  |   await expect(question(other,1).getByRole('textbox')).toHaveValue('');expect((await drafts(b)).length).toBe(0);
  62  |   await a.getByRole('button',{name:'送出第 2 題',exact:true}).click();await expect(question(b,2).getByRole('textbox')).toHaveCount(0);
  63  |   expect(f.database.prepare('SELECT count(*) AS n FROM submissions').get()).toEqual({n:2});await expect.poll(()=>drafts(a)).toEqual([]);
  64  |   await question(other,2).getByRole('textbox').nth(0).fill('未提交草稿');
  65  |   await teacher.getByRole('button',{name:'結束活動',exact:true}).click();await teacher.getByRole('button',{name:'確認結束',exact:true}).click();
  66  |   for(const p of [a,b,other]){await expect(p.getByRole('region',{name:'活動結果'})).toBeVisible();await expect(p).toHaveURL(/#\/results$/);await expect(p.getByRole('textbox')).toHaveCount(0);}
  67  |   await other.evaluate(()=>{location.hash='return';});await expect(other).toHaveURL(/#\/results$/);await other.reload();await expect(other.getByRole('region',{name:'活動結果'})).toBeVisible();
  68  |   const late=await context.newPage();await late.goto(f.base);await expect(late.getByRole('button',{name:/第 1 組/})).toBeDisabled();
  69  |   const old=f.database.prepare('SELECT version FROM activities WHERE id=?').get(activity.activityId) as {version:number};
  70  |   await replacePreparedActivity(f.database,preparedActivity(),{activityId:activity.activityId,version:old.version,confirmed:true});
  71  |   await expect(other.getByLabel('暱稱')).toHaveValue('另一組');await expect(other.getByRole('alert')).toContainText('新活動');expect(await drafts(other)).toEqual([]);
  72  |   await expect(other).not.toHaveURL(/#\/results$/);await joinGroup(other,'另一組',1);await expect(other.getByRole('textbox')).toHaveCount(0);
  73  |   writeFileSync('test-results/student-browser.json',JSON.stringify({日期:'2026-11-26 Asia/Taipei',Chrome:context.browser()!.version(),同名本人唯一:true,READY無敘述:true,四子題完整才可提交:true,每頁草稿獨立且重整恢復:true,可見字元邊界:[200,201],HTML純文字:true,同組鎖定且顯示送出者:true,其他組不洩漏:true,結束路由與換場清除:true,行動版無水平溢出:true,資料庫提交數:2,範圍:'獨立資料庫、真 Chrome 學生表單；完整結果 UI 由 11.3 承接'},null,2)+'\n');
  74  |  }finally{await f.close();}
  75  | });
  76  | 
  77  | test('9.4～9.6 送出前中斷、重整及相同 requestId 重試；儲存失敗不送出',async({context})=>{
  78  |  test.setTimeout(45000);const f=await fixture();
  79  |  try{
  80  |   await replacePreparedActivity(f.database,preparedActivity(),{activityId:null,version:null,confirmed:false});
  81  |   const p=await context.newPage(),teacher=await context.newPage();await p.goto(f.base);await joinGroup(p,'重送者');await teacher.goto(f.base);await login(teacher,f.password);
  82  |   await teacher.getByRole('button',{name:'開始搶答',exact:true}).click();await expect(question(p,1).getByRole('textbox')).toBeVisible();
  83  |   let posts=0,fail=true;const bodies:unknown[]=[];
  84  |   await p.route('**/submissions',async route=>{posts++;bodies.push(route.request().postDataJSON());if(fail)await route.abort('failed');else await route.continue();});
  85  |   await p.evaluate(prefix=>{const original=Storage.prototype.setItem;Reflect.set(window,'restoreStorage',()=>{Storage.prototype.setItem=original;});Storage.prototype.setItem=function(k,v){if(k.startsWith(prefix))throw new DOMException('隔離測試容量已滿','QuotaExceededError');original.call(this,k,v);};},sessionKeys.draftPrefix);
  86  |   await question(p,1).getByRole('textbox').fill('保留原始提交');await expect(question(p,1).getByText(/草稿暫時無法保存/)).toBeVisible();await p.getByRole('button',{name:'送出第 1 題',exact:true}).click();expect(posts).toBe(0);
  87  |   await p.evaluate(()=>Reflect.get(window,'restoreStorage')());
  88  |   await p.getByRole('button',{name:'重新確認第 1 題',exact:true}).click();
> 89  |   await expect(p.getByRole('button',{name:'重新確認第 1 題',exact:true})).toBeEnabled({timeout:10000});expect(posts).toBe(1);
      |                                                                     ^ Error: expect(locator).toBeEnabled() failed
  90  |   await expect(question(p,1).getByRole('textbox')).toBeDisabled();const before=await drafts(p);expect(before[0].attempt.requestId).toBeTruthy();
  91  |   await p.reload();await expect(p.getByRole('button',{name:'重新確認第 1 題',exact:true})).toBeEnabled();expect(await drafts(p)).toEqual(before);
  92  |   fail=false;await p.getByRole('button',{name:'重新確認第 1 題',exact:true}).click();await expect(question(p,1).getByText('已送出（重送者）',{exact:true})).toBeVisible();
  93  |   expect(posts).toBe(2);expect(bodies[1]).toEqual(bodies[0]);await expect.poll(()=>drafts(p)).toEqual([]);expect(f.database.prepare('SELECT count(*) AS n FROM submissions').get()).toEqual({n:1});
  94  |   writeFileSync('test-results/student-retry.json',JSON.stringify({Chrome:context.browser()!.version(),儲存失敗不提交:true,未落盤中斷保留原requestId與內容:true,重整後同ID重試:true,原始答案只提交一次:true,送出後草稿清除:true},null,2)+'\n');
  95  |  }finally{await f.close();}
  96  | });
  97  | 
  98  | test('9.5 伺服器欄位錯誤、他人先送出，以及換場後延遲回覆不得復活草稿',async({context})=>{
  99  |  test.setTimeout(45000);const f=await fixture();let release:()=>void=()=>{};
  100 |  try{
  101 |   const activity=await replacePreparedActivity(f.database,preparedActivity(),{activityId:null,version:null,confirmed:false});
  102 |   const a=await context.newPage(),b=await context.newPage(),teacher=await context.newPage();
  103 |   for(const p of [a,b,teacher])await p.goto(f.base);await joinGroup(a,'延遲者');await joinGroup(b,'先送者');await login(teacher,f.password);
  104 |   await teacher.getByRole('button',{name:'開始搶答',exact:true}).click();await expect(question(a,1).getByRole('textbox')).toBeVisible();
  105 |   await question(a,1).getByRole('textbox').fill('甲草稿');
  106 |   let invalid=true;
  107 |   await a.route('**/submissions',async route=>{
  108 |    if(invalid){invalid=false;const body=route.request().postDataJSON();await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INVALID_ANSWER',message:'請檢查作答內容。',fieldIds:[body.answers[0].fieldId]}})});}
  109 |    else await route.abort('failed');
  110 |   });
  111 |   await a.getByRole('button',{name:'送出第 1 題',exact:true}).click();await expect(question(a,1).getByRole('alert')).toHaveText('請檢查作答內容。');
  112 |   await expect(question(a,1).getByRole('textbox')).toHaveAttribute('aria-invalid','true');await expect(question(a,1).getByRole('textbox')).toHaveValue('甲草稿');expect((await drafts(a))[0].attempt).toBeUndefined();
  113 |   await a.getByRole('button',{name:'送出第 1 題',exact:true}).click();await expect(a.getByRole('button',{name:'重新確認第 1 題',exact:true})).toBeEnabled({timeout:10000});
  114 |   await question(b,1).getByRole('textbox').fill('乙先送出');await b.getByRole('button',{name:'送出第 1 題',exact:true}).click();
  115 |   await expect(question(a,1).getByText('已送出（先送者）',{exact:true})).toBeVisible();await expect(question(a,1).getByRole('textbox')).toHaveCount(0);await expect.poll(()=>drafts(a)).toEqual([]);
  116 |   await a.unroute('**/submissions');let held=false;const gate=new Promise<void>(resolve=>{release=resolve;});
  117 |   await a.route('**/submissions',async route=>{const response=await route.fetch();held=true;await gate;await route.fulfill({response}).catch(()=>{});});
  118 |   const fields=question(a,2).getByRole('textbox');for(let i=0;i<2;i++)await fields.nth(i).fill('延遲的子題'+i);
  119 |   await a.getByRole('button',{name:'送出第 2 題',exact:true}).click();await expect.poll(()=>held).toBe(true);
  120 |   await teacher.getByRole('button',{name:'結束活動',exact:true}).click();await teacher.getByRole('button',{name:'確認結束',exact:true}).click();await expect(a.getByRole('region',{name:'活動結果'})).toBeVisible();
  121 |   const old=f.database.prepare('SELECT version FROM activities WHERE id=?').get(activity.activityId) as {version:number};
  122 |   await replacePreparedActivity(f.database,preparedActivity(),{activityId:activity.activityId,version:old.version,confirmed:true});
  123 |   await expect(a.getByLabel('暱稱')).toHaveValue('延遲者');release();await a.unrouteAll({behavior:'wait'});
  124 |   await expect(a.getByRole('heading',{name:'已加入組別',exact:true})).toHaveCount(0);expect(await drafts(a)).toEqual([]);await expect(a.getByRole('button',{name:/第 1 組/})).toBeEnabled();
  125 |   writeFileSync('test-results/student-boundaries.json',JSON.stringify({Chrome:context.browser()!.version(),欄位錯誤繁體提示與原草稿:true,他人先送出清除待確認草稿:true,結束切離作答:true,換場後延遲回覆不復活身分或草稿:true,範圍:'欄位錯誤使用隔離HTTP替身；競爭提交、結束及換場使用正式服務'},null,2)+'\n');
  126 |  }finally{release();await f.close();}
  127 | });
  128 | 
```