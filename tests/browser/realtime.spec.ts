import { test,expect } from '@playwright/test';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/database.js';
import { readConfig } from '../../src/server/config.js';
import { IdentityService } from '../../src/server/identity.js';
import { ActivityService } from '../../src/server/activity.js';
import { assertRequestOrigin } from '../../src/server/identity-http.js';
import { readActivityModel } from '../../src/server/read-model.js';
import { replacePreparedActivity } from '../../src/server/activity-replacement.js';
import { preparedActivity } from '../helpers/replacement.js';

test('7.1～7.3 同 Chrome 兩老師與學生由 WS 套用快照；停用 view 輪詢仍同步',async({context})=>{
  const directory=mkdtempSync(join(tmpdir(),'crs-realtime-ui-')),database=openDatabase(join(directory,'classroom.db'));
  const password='realtime-browser-fixture',identity=new IdentityService(database,password);
  const app=createApplication(readConfig({TEACHER_PASSWORD:password}),database,()=>{}, {identity,activities:new ActivityService(database,identity),
    authenticate:r=>{assertRequestOrigin(r);return identity.principal(identity.proof(r));},beforeRead:()=>identity.sweep(),readModel:()=>readActivityModel(database,identity)});
  const address=await app.listen(0);if(!address||typeof address==='string')throw new Error('測試服務未啟動');
  const base=`http://127.0.0.1:${address.port}`;
  try{
    await replacePreparedActivity(database,preparedActivity(),{activityId:null,version:null,confirmed:false});
    const teacher=await context.newPage(),other=await context.newPage(),student=await context.newPage();
    // HTTP view 可以失敗；此測試的活動資料須從授權 WS 取得。
    for(const page of [teacher,other,student])await page.route('**/api/activities/current/view',route=>route.fulfill({status:501,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'FEATURE_NOT_READY',message:'測試停用查詢，僅由即時通道取得活動。'}})}));
    let activityReads=0;for(const page of [teacher,other,student])page.on('request',request=>{if(request.url().endsWith('/api/activities/current/view'))activityReads++;});
    const frames:string[]=[];student.on('websocket',socket=>{if(socket.url().endsWith('/ws'))socket.on('framereceived',frame=>frames.push(String(frame.payload)));});
    for(const p of [teacher,other]){
      await p.goto(base);await p.getByRole('button',{name:'老師登入',exact:true}).click();await p.getByLabel('老師密碼').fill(password);
      await p.getByRole('button',{name:'登入老師身分',exact:true}).click();await expect(p.getByRole('heading',{name:'待開始',exact:true})).toBeVisible();
    }
    await student.goto(base);await student.getByLabel('暱稱').fill('即時組員');await student.getByRole('button',{name:/第 1 組/}).click();
    await expect(student.getByRole('heading',{name:'已加入組別',exact:true})).toBeVisible();await expect(student.getByText('本人',{exact:true})).toBeVisible();
    await new Promise(done=>setTimeout(done,300));const idleReads=activityReads;await new Promise(done=>setTimeout(done,2500));expect(activityReads,'健康WS期間不重複輪詢畫面').toBe(idleReads);
    const restoreScopes:string[]=[];student.on('request',request=>{if(request.url().endsWith('/api/realtime/ticket'))restoreScopes.push(request.postDataJSON().scope);});await student.reload();await expect(student.getByText('本人',{exact:true})).toBeVisible();await expect(student.getByRole('status')).toHaveText('本機服務已連線');expect(restoreScopes[0]).toBe('activity');expect(restoreScopes).not.toContain('lobby');
    const beforeStart=frames.filter(raw=>raw.includes('"scope":"activity"'));expect(beforeStart.length).toBeGreaterThan(0);expect(beforeStart.join('')).not.toContain('新子題一');
    await teacher.getByRole('button',{name:'開始搶答',exact:true}).click();
    await expect(other.getByRole('heading',{name:'搶答進行中',exact:true})).toBeVisible();await expect(student.getByText(/第 1 組 · 搶答進行中/)).toBeVisible();
    expect(frames.some(raw=>raw.includes('"phase":"RUNNING"'))).toBe(true);
    await other.getByRole('button',{name:'結束活動',exact:true}).click();await other.getByRole('button',{name:'確認結束',exact:true}).click();
    await expect(teacher.getByRole('heading',{name:'已結束',exact:true})).toBeVisible();await expect(student.getByText(/第 1 組 · 已結束/)).toBeVisible();
    await teacher.getByRole('button',{name:'登出',exact:true}).click();await expect(teacher.getByRole('button',{name:'老師登入',exact:true})).toBeVisible();
    await expect(other.getByRole('heading',{name:'老師已登入',exact:true})).toBeVisible();
    await student.screenshot({path:'test-results/realtime-ended.png',fullPage:true});
  }finally{await app.close();database.close();rmSync(directory,{recursive:true,force:true});}
});
