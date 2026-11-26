import { test,expect,chromium,type Page,type BrowserContext } from '@playwright/test';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/server/database.js';
import { createApplication } from '../../src/server/app.js';
import { readConfig } from '../../src/server/config.js';
import { IdentityService } from '../../src/server/identity.js';
import { assertRequestOrigin } from '../../src/server/identity-http.js';
import { readActivityModel } from '../../src/server/read-model.js';
import { replacePreparedActivity } from '../../src/server/activity-replacement.js';
import { preparedActivity } from '../helpers/replacement.js';
import { sessionKeys } from '../../src/shared/session.js';
import { ActivityService } from '../../src/server/activity.js';

type Driver={tabs:{query(q:object):Promise<{id:number;url:string}[]>;duplicate(id:number):Promise<unknown>};sessions:{getRecentlyClosed():Promise<{tab?:{sessionId:string;url:string}}[]>;restore(id:string):Promise<unknown>}};
test('正式身分：同一 Chrome 原生副本、交接競爭、重啟、到期與草稿撤銷',async()=>{
  test.setTimeout(120000);
  const directory=mkdtempSync(join(tmpdir(),'crs-identity-browser-'));
  let database=openDatabase(join(directory,'classroom.db'));
  const password='browser-fixture-only-password';let now=Date.now();
  let identity!:IdentityService,app!:ReturnType<typeof createApplication>,base:string;
  let context:BrowserContext|undefined;
  const start=async(port=0)=>{
    identity=new IdentityService(database,password,()=>now,true);
    app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:password}),database,()=>{}, {
      identity,activities:new ActivityService(database,identity,undefined,()=>now),now:()=>now,authenticate:req=>{assertRequestOrigin(req);return identity.principal(identity.proof(req));},
      beforeRead:()=>identity.sweep(),readModel:()=>readActivityModel(database,identity),
    });
    const address=await app.listen(port);if(!address||typeof address==='string')throw new Error('測試服務未啟動');
    identity.markReady();base=`http://127.0.0.1:${address.port}`;return address.port;
  };
  try{
    const port=await start();
    await replacePreparedActivity(database,preparedActivity(),{activityId:null,version:null,confirmed:false});
    const extension=join(directory,'driver');mkdirSync(extension);
    writeFileSync(join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'正式身分測試分頁工具',version:'1.0',permissions:['tabs','sessions']}));
    writeFileSync(join(extension,'control.html'),'<title>隔離測試控制器</title>');
    context=await chromium.launchPersistentContext(join(directory,'profile'),{channel:'chrome',headless:!process.env.CRS_HEADED,
      ignoreDefaultArgs:['--disable-extensions','--disable-back-forward-cache','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],args:['--enable-unsafe-extension-debugging']});
    test.info().annotations.push({type:'browser',description:context.browser()!.version()},{type:'mode',description:process.env.CRS_HEADED?'有視窗':'無視窗'});
    const cdp=await context.browser()!.newBrowserCDPSession();const {id}=await cdp.send('Extensions.loadUnpacked',{path:extension});
    const control=await context.newPage();await control.goto(`chrome-extension://${id}/control.html`);
    const page=async(tag:string)=>{const p=await context!.newPage();await p.goto(base+'/#'+tag);await expect(p.getByLabel('暱稱')).toBeVisible();return p;};
    const login=async(p:Page)=>{await p.getByRole('button',{name:'老師登入',exact:true}).click();await p.getByLabel('老師密碼').fill(password);await p.getByRole('button',{name:'登入老師身分',exact:true}).click();await expect(p.getByRole('heading',{name:'老師已登入'})).toBeVisible();};
    const credential=(p:Page)=>p.evaluate(key=>JSON.parse(sessionStorage.getItem(key)??'null'),sessionKeys.credential);
    const draft=(p:Page)=>p.evaluate(key=>sessionStorage.getItem(key),sessionKeys.draftPrefix+'test');
    const seedDraft=(p:Page)=>p.evaluate(key=>sessionStorage.setItem(key,'本分頁未提交內容'),sessionKeys.draftPrefix+'test');
    const duplicate=async(original:Page,waitForLoad=true)=>{
      const created=context!.waitForEvent('page');
      await control.evaluate(async url=>{const api=(globalThis as unknown as {chrome:Driver}).chrome;const tab=(await api.tabs.query({})).find(t=>t.url===url);if(!tab)throw new Error('沒有測試頁');await api.tabs.duplicate(tab.id);},original.url());
      const copy=await created;
      if(waitForLoad){await copy.waitForLoadState();await expect(copy.getByLabel('暱稱')).toBeVisible();}
      else await copy.waitForURL(original.url(),{waitUntil:'commit'});
      return copy;
    };
    const teachers=[await page('teacher1'),await page('teacher2')];for(const p of teachers)await login(p);
    const students=[await page('student1'),await page('student2')];
    for(const [i,p]of students.entries()){
      const initial=await p.getByLabel('暱稱').inputValue();expect(initial).toMatch(/^[A-Za-z]+$/);
      await p.getByRole('button',{name:'換個名字'}).click();expect(await p.getByLabel('暱稱').inputValue()).toMatch(/^[A-Za-z]+$/);
      await p.getByLabel('暱稱').fill('同名👨‍👩‍👧‍👦');await p.getByRole('button',{name:new RegExp(`第 ${i+1} 組`)}).click();
      await expect(p.getByRole('heading',{name:'已加入組別'})).toBeVisible();await seedDraft(p);
    }
    for(const p of [...teachers,...students]){
      const before=await credential(p);await p.reload();
      await expect(p.getByRole('heading',{name:teachers.includes(p)?'老師已登入':'已加入組別'})).toBeVisible();
      expect((await credential(p)).token).toBe(before.token);expect((await credential(p)).generation).toBe(before.generation+1);
    }
    for(const p of students)expect(await draft(p)).toBe('本分頁未提交內容');
    // 交接已落盤但回覆截斷：原頁重試不延長期限、不重複建立身分或加世代。
    let cut=false;const beforeCut=await credential(students[0]!);
    await context.route('**/api/session/resume',async route=>{
      if(route.request().frame().page()===students[0]&&!cut){cut=true;const response=await route.fetch();await route.fulfill({response,body:'{"ok":'});}
      else await route.continue();
    });
    await students[0]!.reload();await expect(students[0]!.getByRole('heading',{name:'已加入組別'})).toBeVisible({timeout:10000});
    expect(cut).toBe(true);expect((await credential(students[0]!)).generation).toBe(beforeCut.generation+1);expect(await draft(students[0]!)).toBe('本分頁未提交內容');await context.unroute('**/api/session/resume');
    // 真正原生複製；不是手動複製 storage 代替 Chrome 行為。
    const teacherCopy=await duplicate(teachers[0]!);expect(await credential(teacherCopy)).toBeNull();
    const copy=await duplicate(students[0]!);expect(await credential(copy)).toBeNull();expect(await draft(copy)).toBeNull();
    expect(await copy.getByLabel('暱稱').inputValue()).toBe('同名👨‍👩‍👧‍👦');
    await expect(students[0]!.getByRole('heading',{name:'已加入組別'})).toBeVisible();
    // 原頁 HTML 已交接但主程式暫停；讓副本先完成初始化。
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let held=false;
    await context.route('**/assets/*.js',async route=>{
      if(route.request().frame().page()===students[0]&&!held){held=true;await gate;}
      await route.continue().catch(()=>{});
    });
    await students[0]!.reload({waitUntil:'commit'});
    await expect.poll(()=>held).toBe(true);
    const racingCopy=await duplicate(students[0]!);expect(await credential(racingCopy)).toBeNull();release();
    await expect(students[0]!.getByRole('heading',{name:'已加入組別'})).toBeVisible();await context.unroute('**/assets/*.js');
    // 正常停止／重啟：副本先到，原頁稍後恢復；同一來源、固定期限不變。
    const expiry=database.prepare('SELECT id,expires_at FROM sessions ORDER BY id').all();
    await app.close();identity.shutdown();database.close();database=openDatabase(join(directory,'classroom.db'));await start(port);
    await copy.reload();expect(await credential(copy)).toBeNull();
    await students[0]!.reload();await expect(students[0]!.getByRole('heading',{name:'已加入組別'})).toBeVisible();
    expect(database.prepare('SELECT id,expires_at FROM sessions ORDER BY id').all()).toEqual(expiry);
    // 一位老師登出，另一老師及學生保持有效。
    await teachers[0]!.getByRole('button',{name:'登出',exact:true}).click();await expect(teachers[0]!.getByRole('button',{name:'老師登入',exact:true})).toBeVisible();
    await teachers[1]!.reload();await expect(teachers[1]!.getByRole('heading',{name:'老師已登入'})).toBeVisible();
    // 原頁關閉，先前副本與關閉後還原均不得接手。
    const existingPages=new Set(context.pages());let copyHeld=false;let releaseCopy!:()=>void;
    const copyGate=new Promise<void>(resolve=>{releaseCopy=resolve;});
    await context.route('**/assets/*.js',async route=>{
      if(!existingPages.has(route.request().frame().page())&&!copyHeld){copyHeld=true;await copyGate;}
      await route.continue().catch(()=>{});
    });
    const secondCopy=await duplicate(students[1]!,false);await expect.poll(()=>copyHeld).toBe(true);
    expect(await credential(secondCopy)).not.toBeNull(); // 原生副本確實帶入 token，但尚未執行產品主程式。
    const originalUrl=students[1]!.url();await students[1]!.close();await secondCopy.reload();releaseCopy();
    await expect(secondCopy.getByLabel('暱稱')).toBeVisible();expect(await credential(secondCopy)).toBeNull();expect(await draft(secondCopy)).toBeNull();await context.unroute('**/assets/*.js');
    const restoredEvent=context.waitForEvent('page');
    await control.evaluate(async url=>{const api=(globalThis as unknown as {chrome:Driver}).chrome;const item=(await api.sessions.getRecentlyClosed()).find(i=>i.tab?.url===url);if(!item?.tab)throw new Error('沒有已關閉頁');await api.sessions.restore(item.tab.sessionId);},originalUrl);
    const restored=await restoredEvent;await restored.waitForLoadState();await expect(restored.getByLabel('暱稱')).toBeVisible();expect(await credential(restored)).toBeNull();expect(await draft(restored)).toBeNull();
    // 原分頁的新活動失效清掉本分頁草稿，暱稱仍保留。
    const activity=database.prepare('SELECT id,version FROM activities').get() as {id:string;version:number};
    await replacePreparedActivity(database,preparedActivity(),{activityId:activity.id,version:activity.version,confirmed:true});
    await expect(students[0]!.getByRole('alert')).toContainText('新活動');await expect(students[0]!.getByLabel('暱稱')).toHaveValue('同名👨‍👩‍👧‍👦');expect(await draft(students[0]!)).toBeNull();
    await students[0]!.getByRole('button',{name:/第 1 組/}).click();await expect(students[0]!.getByRole('heading',{name:'已加入組別'})).toBeVisible();await seedDraft(students[0]!);
    // 測試已確定的 GRACE 截止消費端；斷線偵測／心跳仍由 7.4 承接。
    database.prepare("UPDATE sessions SET lifecycle='GRACE',grace_started_at=?,grace_deadline=? WHERE id=(SELECT session_id FROM participants WHERE membership_state='JOINED' LIMIT 1)").run(now,now+30000);now+=30000;
    await expect(students[0]!.getByRole('alert')).toContainText('斷線');expect(await draft(students[0]!)).toBeNull();await expect(students[0]!.getByLabel('暱稱')).toHaveValue('同名👨‍👩‍👧‍👦');
    await students[0]!.getByRole('button',{name:/第 1 組/}).click();await expect(students[0]!.getByRole('heading',{name:'已加入組別'})).toBeVisible();await seedDraft(students[0]!);
    await expect(teachers[1]!.getByRole('button',{name:'開始搶答',exact:true})).toBeVisible();
    await teachers[1]!.getByRole('button',{name:'開始搶答',exact:true}).click();
    await expect(teachers[1]!.getByRole('heading',{name:'搶答進行中',exact:true})).toBeVisible();
    const runningCopy=await duplicate(students[0]!);expect(await credential(runningCopy)).toBeNull();await expect(runningCopy.getByRole('button',{name:/第 1 組/})).toBeDisabled();
    await expect(students[0]!.getByRole('heading',{name:'已加入組別'})).toBeVisible();now+=43200000;
    await expect(students[0]!.getByRole('alert')).toContainText('12 小時期限');await expect(students[0]!.getByLabel('暱稱')).toHaveValue('同名👨‍👩‍👧‍👦');expect(await draft(students[0]!)).toBeNull();
    await expect(students[0]!.getByRole('button',{name:/第 1 組/})).toBeDisabled();
    await students[0]!.screenshot({path:'test-results/identity-student.png',fullPage:true});
    await students[0]!.setViewportSize({width:390,height:844});await students[0]!.screenshot({path:'test-results/identity-mobile.png',fullPage:true});
    expect(await students[0]!.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    // 固定期限後重新老師登入；原活動仍進行中，可取消／確認結束。
    await login(teachers[0]!);const timerTeacher=await page('timer-teacher');await login(timerTeacher);
    const finish=teachers[0]!;
    await finish.getByRole('button',{name:'結束活動',exact:true}).click();await expect(finish.getByRole('dialog')).toBeVisible();
    await finish.getByRole('button',{name:'取消',exact:true}).click();await expect(finish.getByRole('dialog')).not.toBeVisible();
    expect((database.prepare('SELECT state FROM activities').get() as {state:string}).state).toBe('RUNNING');
    now+=10000;await finish.getByRole('button',{name:'結束活動',exact:true}).click();await finish.getByRole('button',{name:'確認結束',exact:true}).click();
    await expect(finish.getByRole('heading',{name:'已結束',exact:true})).toBeVisible();await expect(timerTeacher.getByRole('heading',{name:'已結束',exact:true})).toBeVisible();
    const total=await finish.getByLabel('搶答計時',{exact:true}).innerText();await expect(timerTeacher.getByLabel('搶答計時',{exact:true})).toHaveText(total);
    now+=60000;await finish.reload();await expect(finish.getByRole('heading',{name:'已結束',exact:true})).toBeVisible();await expect(finish.getByLabel('搶答計時',{exact:true})).toHaveText(total);
    await expect(finish.getByRole('button',{name:'開始搶答',exact:true})).toHaveCount(0);await finish.screenshot({path:'test-results/activity-ended.png',fullPage:true});
  }finally{
    await context?.close();if(app!)await app.close().catch(()=>{});if(database.open){identity!?.shutdown();database.close();}rmSync(directory,{recursive:true,force:true});
  }
});
