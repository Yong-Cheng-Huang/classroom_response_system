import {test,expect} from '@playwright/test';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../../src/server/database.js';
import {IdentityService} from '../../src/server/identity.js';
import {ActivityService} from '../../src/server/activity.js';
import {createApplication} from '../../src/server/app.js';
import {readConfig} from '../../src/server/config.js';
import {assertRequestOrigin} from '../../src/server/identity-http.js';
import {readActivityModel} from '../../src/server/read-model.js';
import {replacePreparedActivity} from '../../src/server/activity-replacement.js';
import {preparedActivity} from '../helpers/replacement.js';

test('D39 真Chrome受控凍結另列暫停，恢復正確結果；12小時已到期不得復活',async({context})=>{
 test.setTimeout(30000);const directory=mkdtempSync(join(tmpdir(),'crs-paused-')),db=openDatabase(join(directory,'classroom.db'));let offset=0;const now=()=>Date.now()+offset,identity=new IdentityService(db,'paused-browser-fixture',now,true),activities=new ActivityService(db,identity,undefined,now);
 const app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:'paused-browser-fixture'}),db,()=>{},{identity,activities,now,authenticate:r=>{assertRequestOrigin(r);return identity.principal(identity.proof(r));},beforeRead:()=>identity.sweep(),readModel:()=>readActivityModel(db,identity)});const address=await app.listen(0);if(!address||typeof address==='string')throw new Error('隔離服務未啟動');identity.markReady();const base='http://127.0.0.1:'+address.port;
 const teacher=await context.newPage(),student=await context.newPage(),cdp=await context.newCDPSession(student);
 try{
  await replacePreparedActivity(db,preparedActivity(),{activityId:null,version:null,confirmed:false});await teacher.goto(base);await teacher.getByRole('button',{name:'老師登入',exact:true}).click();await teacher.getByLabel('老師密碼').fill('paused-browser-fixture');await teacher.getByRole('button',{name:'登入老師身分',exact:true}).click();await student.goto(base);await student.getByLabel('暱稱').fill('暫停原學生');await student.getByRole('button',{name:/第 1 組/}).click();await expect(student.getByText('本人',{exact:true})).toBeVisible();await teacher.getByRole('button',{name:'開始搶答',exact:true}).click();await expect(student.getByRole('region',{name:'作答題目',exact:true})).toBeVisible();
  const expiry=db.prepare('SELECT id,expires_at FROM sessions ORDER BY id').all();const start=performance.now();await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await teacher.getByRole('button',{name:'結束活動',exact:true}).click();await teacher.getByRole('button',{name:'確認結束',exact:true}).click();await expect(teacher.getByRole('heading',{name:'已結束',exact:true})).toBeVisible();await cdp.send('Page.setWebLifecycleState',{state:'active'});await expect(student.locator('[data-student-route="results"]')).toBeVisible();expect(student.url()).toContain('#/results');const restored=performance.now();expect(db.prepare('SELECT id,expires_at FROM sessions ORDER BY id').all()).toEqual(expiry);
  await cdp.send('Page.setWebLifecycleState',{state:'frozen'});offset+=43200000;identity.sweep();await cdp.send('Page.setWebLifecycleState',{state:'active'});await expect(student.getByRole('alert')).toContainText('12 小時');await expect(student.getByLabel('暱稱')).toHaveValue('暫停原學生');expect((db.prepare("SELECT count(*) AS n FROM sessions WHERE lifecycle='EXPIRED'").get() as {n:number}).n).toBeGreaterThanOrEqual(2);await expect(student.getByRole('region',{name:'搶答結果',exact:true})).toHaveCount(0);
  writeFileSync('test-results/paused-browser.json',JSON.stringify({日期:'2026-11-26 Asia/Taipei',Chrome:context.browser()!.version(),分類:'D39受控Chrome凍結；非正常背景效能樣本',凍結至結果恢復觀察毫秒:restored-start,恢復原身分結果:true,期限未延長:true,已到12小時不復活:true,保留暱稱:true,未執行:['Chrome真正丟棄','macOS休眠'],範圍:'CDP凍結／解除與可控伺服器時鐘；沒有暫停使用者OS或宣稱一般背景時限通過'},null,2)+'\n');
 }finally{await cdp.send('Page.setWebLifecycleState',{state:'active'}).catch(()=>{});await app.close();identity.shutdown();db.close();rmSync(directory,{recursive:true,force:true});}
});
