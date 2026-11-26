# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: recovery.spec.ts >> 7.4～7.7 同 Chrome 背景心跳、關閉 30 秒移除、正常及 D38 重建自動恢復、結束與校時
- Location: tests/browser/recovery.spec.ts:16:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "hidden"
Received: "visible"

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1  | import { test,expect,type BrowserContext,type Page } from '@playwright/test';
  2  | import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
  3  | import { tmpdir,release,arch } from 'node:os';
  4  | import { join } from 'node:path';
  5  | import { openDatabase } from '../../src/server/database.js';
  6  | import { IdentityService } from '../../src/server/identity.js';
  7  | import { ActivityService } from '../../src/server/activity.js';
  8  | import { createApplication } from '../../src/server/app.js';
  9  | import { readConfig } from '../../src/server/config.js';
  10 | import { assertRequestOrigin } from '../../src/server/identity-http.js';
  11 | import { readActivityModel } from '../../src/server/read-model.js';
  12 | import { replacePreparedActivity } from '../../src/server/activity-replacement.js';
  13 | import { nativeChrome } from '../helpers/native-chrome.js';
  14 | import { preparedActivity } from '../helpers/replacement.js';
  15 | 
  16 | test('7.4～7.7 同 Chrome 背景心跳、關閉 30 秒移除、正常及 D38 重建自動恢復、結束與校時',async()=>{
  17 |   test.setTimeout(120000);
  18 |   const directory=mkdtempSync(join(tmpdir(),'crs-recovery-browser-')),path=join(directory,'classroom.db');
  19 |   let database=openDatabase(path),context:BrowserContext|undefined;let releaseHeld=()=>{};let native:Awaited<ReturnType<typeof nativeChrome>>|undefined;
  20 |   const password='recovery-browser-fixture';let identity!:IdentityService,app!:ReturnType<typeof createApplication>,base='',offset=0;
  21 |   const now=()=>Date.now()+offset;
  22 |   const start=async(port=0)=>{
  23 |     identity=new IdentityService(database,password,now,true);
  24 |     app=createApplication(readConfig({TEACHER_PASSWORD:password}),database,()=>{}, {identity,now,activities:new ActivityService(database,identity,undefined,now),
  25 |       authenticate:r=>{assertRequestOrigin(r);return identity.principal(identity.proof(r));},beforeRead:()=>identity.sweep(),readModel:()=>readActivityModel(database,identity)});
  26 |     const address=await app.listen(port);if(!address||typeof address==='string')throw new Error('測試服務未啟動');identity.markReady();base=`http://127.0.0.1:${address.port}`;return address.port;
  27 |   };
  28 |   const joinStudent=async(p:Page,name:string)=>{await p.bringToFront();await p.goto(base);await p.getByLabel('暱稱').fill(name);await p.getByRole('button',{name:/第 1 組/}).click();await expect(p.getByText('本人',{exact:true})).toBeVisible();};
  29 |   try{
  30 |     const port=await start();await replacePreparedActivity(database,preparedActivity(),{activityId:null,version:null,confirmed:false});
  31 |     native=await nativeChrome(join(directory,'profile'),!!process.env.CRS_HEADED);context=native.context;
  32 |     const teacher=await context.newPage(),student=await context.newPage(),closing=await context.newPage();
  33 |     await teacher.bringToFront();
  34 |     await teacher.goto(base);await teacher.getByRole('button',{name:'老師登入',exact:true}).click();await teacher.getByLabel('老師密碼').fill(password);await teacher.getByRole('button',{name:'登入老師身分',exact:true}).click();
  35 |     await joinStudent(student,'背景原組員');await joinStudent(closing,'關閉組員');
  36 |     const original=database.prepare('SELECT id,session_id,nickname FROM participants ORDER BY id').all();
  37 |     const expiry=database.prepare('SELECT id,created_at,expires_at FROM sessions ORDER BY id').all();
> 38 |     await teacher.bringToFront();await expect.poll(()=>student.evaluate(()=>document.visibilityState)).toBe('hidden');
     |                                                                                                        ^ Error: expect(received).toBe(expected) // Object.is equality
  39 |     const background:string[]=[];student.on('websocket',socket=>socket.on('framereceived',frame=>background.push(String(frame.payload))));
  40 |     // 等待超過 pong 判定窗口，沒有停用 Chrome 背景節流來使測試過關。
  41 |     await new Promise(resolve=>setTimeout(resolve,7500));
  42 |     const live=database.prepare("SELECT count(*) AS n FROM sessions WHERE lifecycle='CONNECTED'").get() as {n:number};expect(live.n).toBe(3);
  43 |     const participant=database.prepare("SELECT session_id FROM participants WHERE nickname='關閉組員'").get() as {session_id:string};
  44 |     const T_close=performance.now();await closing.close();
  45 |     await expect.poll(()=> (database.prepare('SELECT lifecycle FROM sessions WHERE id=?').get(participant.session_id) as {lifecycle:string}).lifecycle).toBe('GRACE');
  46 |     const grace=database.prepare('SELECT grace_started_at,grace_deadline FROM sessions WHERE id=?').get(participant.session_id) as {grace_started_at:number;grace_deadline:number};expect(grace.grace_deadline-grace.grace_started_at).toBe(30000);
  47 |     await expect.poll(()=> (database.prepare('SELECT lifecycle FROM sessions WHERE id=?').get(participant.session_id) as {lifecycle:string}).lifecycle,{timeout:35000,intervals:[100,250,500]}).toBe('REVOKED');
  48 |     const removedAfter=performance.now()-T_close;expect(removedAfter).toBeGreaterThanOrEqual(29500);expect(removedAfter).toBeLessThan(32500);
  49 |     expect((database.prepare('SELECT membership_state FROM participants WHERE session_id=?').get(participant.session_id) as {membership_state:string}).membership_state).toBe('INVALID');
  50 |     await teacher.bringToFront();await teacher.getByRole('button',{name:'開始搶答',exact:true}).click();await expect(student.getByText(/第 1 組 · 搶答進行中/)).toBeVisible();
  51 |     const elapsed=async(p:Page)=>Number(await p.getByLabel('搶答計時',{exact:true}).getAttribute('data-elapsed-ms'));
  52 |     const divergence=async()=>Math.abs(await elapsed(teacher)-await elapsed(student));
  53 |     await student.bringToFront();await expect.poll(divergence).toBeLessThanOrEqual(1000);
  54 |     const firstDifference=await divergence();
  55 |     // 正常停機；邏輯伺服器時間增加 >30 秒，牆鐘只短暫中斷。
  56 |     const beforeRestart=background.filter(raw=>JSON.parse(raw).type==='snapshot').length;
  57 |     await app.close();identity.shutdown();database.close();offset+=60000;database=openDatabase(path);await start(port);
  58 |     const T_ready=performance.now();await expect.poll(()=>background.filter(raw=>JSON.parse(raw).type==='snapshot').length,{timeout:5000}).toBeGreaterThan(beforeRestart);await expect(student.getByRole('status')).toHaveText('本機服務已連線',{timeout:5000});await expect(student.getByText(/第 1 組 · 搶答進行中/)).toBeVisible();
  59 |     await expect.poll(()=>elapsed(student),{timeout:5000}).toBeGreaterThanOrEqual(60000);
  60 |     const restoredNormal=performance.now()-T_ready;expect(restoredNormal).toBeLessThanOrEqual(5000);
  61 |     await expect.poll(()=> (database.prepare("SELECT lifecycle FROM sessions WHERE id=(SELECT session_id FROM participants WHERE nickname='背景原組員')").get() as {lifecycle:string}).lifecycle).toBe('CONNECTED');
  62 |     // 暫時阻擋學生恢復網路，讓老師先結束；釋放後必須直接得到 ENDED 快照。
  63 |     let releaseStudent!:()=>void;const gate=new Promise<void>(resolve=>{releaseStudent=resolve;releaseHeld=resolve;});let blocked=false;
  64 |     await student.route('**/api/realtime/ticket',async route=>{blocked=true;await gate;await route.continue().catch(()=>{});});
  65 |     // 未保存正常關機檢查點的服務重建；真正 SIGKILL／COMMIT 邊界另由 G2 探針驗證。
  66 |     await app.close();database.close();offset+=60000;database=openDatabase(path);await start(port);
  67 |     await expect.poll(()=>blocked).toBe(true);
  68 |     await expect(teacher.getByRole('status')).toHaveText('本機服務已連線',{timeout:5000});await teacher.bringToFront();await teacher.getByRole('button',{name:'結束活動',exact:true}).click();await teacher.getByRole('button',{name:'確認結束',exact:true}).click();
  69 |     await expect(teacher.getByRole('heading',{name:'已結束',exact:true})).toBeVisible();
  70 |     const T_networkReady=performance.now();releaseStudent();await student.unroute('**/api/realtime/ticket');
  71 |     await expect.poll(()=>background.filter(raw=>{const frame=JSON.parse(raw);return frame.type==='snapshot'&&frame.data.view.phase==='ENDED';}).length,{timeout:5000}).toBeGreaterThan(0);
  72 |     await expect(student.getByText(/第 1 組 · 已結束/)).toBeVisible({timeout:5000});const restoredEnded=performance.now()-T_networkReady;expect(restoredEnded).toBeLessThanOrEqual(5000);
  73 |     await expect.poll(divergence).toBeLessThanOrEqual(1000);const endedDifference=await divergence();
  74 |     expect(database.prepare('SELECT id,created_at,expires_at FROM sessions ORDER BY id').all()).toEqual(expiry);
  75 |     expect(database.prepare('SELECT id,session_id,nickname FROM participants ORDER BY id').all()).toEqual(original);
  76 |     await student.bringToFront();await student.reload();await expect(student.getByText(/第 1 組 · 已結束/)).toBeVisible();
  77 |     const fixed=await elapsed(student);await new Promise(resolve=>setTimeout(resolve,1250));expect(await elapsed(student)).toBe(fixed);
  78 |     await student.screenshot({path:'test-results/recovery-ended.png',fullPage:true});
  79 |     writeFileSync(`test-results/recovery-browser-${process.env.CRS_HEADED?'headed':'headless'}.json`,JSON.stringify({日期:'2026-11-26 Asia/Taipei',Chrome:native.browser.version(),OS:release(),架構:arch(),有視窗:!!process.env.CRS_HEADED,
  80 |       背景等待毫秒:7500,背景狀態:'hidden',Playwright焦點模擬:false,原生關閉後移除毫秒:removedAfter,正常恢復毫秒:restoredNormal,網路可用後結束快照恢復毫秒:restoredEnded,開始計時差毫秒:firstDifference,結束計時差毫秒:endedDifference,
  81 |       固定期限不延長:true,原參與不重建:true,備註:'同設定檔三分頁；停機>30秒以注入時鐘模擬；重建不是 SIGKILL；不代表42分頁／20輪效能或凍結／OS休眠驗收'},null,2)+'\n');
  82 |   }finally{releaseHeld();await native?.close();await app?.close().catch(()=>{});if(database.open){identity?.shutdown();database.close();}rmSync(directory,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
  83 | });
  84 | 
```