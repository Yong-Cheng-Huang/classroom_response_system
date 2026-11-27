import { test,expect,type Page } from '@playwright/test';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../../src/server/database.js';
import { createApplication } from '../../src/server/app.js';
import { IdentityService } from '../../src/server/identity.js';
import { ActivityService } from '../../src/server/activity.js';
import { SubmissionService } from '../../src/server/submissions.js';
import { assertRequestOrigin } from '../../src/server/identity-http.js';
import { readActivityModel } from '../../src/server/read-model.js';
import { readConfig } from '../../src/server/config.js';
import { preparedActivity } from '../helpers/replacement.js';
import { replacePreparedActivity } from '../../src/server/activity-replacement.js';
import type { RealtimeFrame } from '../../src/shared/realtime.js';

test('11.1～11.4 完整學生結果：三狀態、四子題只計一題、成功公開、無人題及重啟恢復',async({context})=>{
 test.setTimeout(60000);const directory=mkdtempSync(join(tmpdir(),'crs-results-browser-')),path=join(directory,'classroom.db'),password='results-browser-fixture';
 let database=openDatabase(path),identity!:IdentityService,app!:ReturnType<typeof createApplication>,base='';
 const launch=async(port=0)=>{
  identity=new IdentityService(database,password,Date.now,true);const db=database,id=identity;
  app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:password}),db,()=>{},{identity:id,activities:new ActivityService(db,id),submissions:new SubmissionService(db,id),authenticate:request=>{assertRequestOrigin(request);return id.principal(id.proof(request));},beforeRead:()=>id.sweep(),readModel:()=>readActivityModel(db,id)});
  const address=await app.listen(port);if(!address||typeof address==='string')throw new Error('測試服務未啟動');identity.markReady();base=`http://127.0.0.1:${address.port}`;return address.port;
 };
 const headers=new Map<Page,Record<string,string>>(),frames=new Map<Page,RealtimeFrame[]>();
 const page=async()=>{const p=await context.newPage();frames.set(p,[]);p.on('request',request=>{const h=request.headers();if(request.url().startsWith(base+'/api/')&&h.authorization)headers.set(p,{authorization:h.authorization,'X-Tab-Proof':h['x-tab-proof']!,'X-Document-Instance':h['x-document-instance']!,'X-Session-Generation':h['x-session-generation']!});});
  p.on('websocket',socket=>socket.on('framereceived',raw=>{const f=JSON.parse(String(raw.payload));if(f.type==='snapshot'||f.type==='update')frames.get(p)!.push(f);}));await p.goto(base);return p;};
 const rpc=(p:Page,path:string)=>p.evaluate(async args=>{const r=await fetch(args.path,{headers:args.headers});return{status:r.status,...await r.json()};},{path,headers:headers.get(p)!});
 const question=(p:Page,n:number)=>p.getByRole('region',{name:`第 ${n} 題`,exact:true});
 const result=(p:Page,n:number)=>p.getByRole('region',{name:`第 ${n} 題結果`,exact:true});
 const noPrivate=(data:unknown)=>expect(JSON.stringify(data)).not.toMatch(/"rank"|"version"|receiveOrder|receive_order|receivedAt|submittedAt|requestId|requestHash|來源舊答案不可當結果/);
 try{
  const port=await launch(),prepared=preparedActivity(),group=prepared.questions[1]!,single=prepared.questions[0]!;
  group.number='1';group.fields.push({label:'（3）',prompt:'第三子題敘述',answerRange:'H9',original:{}},{label:'（4）',prompt:'第四子題敘述',answerRange:'H10',original:{}});single.number='2';
  prepared.groupCount=4;prepared.source.snapshot={originalAnswers:['來源舊答案不可當結果']};
  prepared.questions=[group,single,{number:'3',kind:'SINGLE',fields:[{label:null,prompt:'第三題敘述',answerRange:'G12:H12',original:{}}]},{number:'4',kind:'SINGLE',fields:[{label:null,prompt:'本場無人題敘述',answerRange:'G14:H14',original:{}}]}];
  const activity=await replacePreparedActivity(database,prepared,{activityId:null,version:null,confirmed:false});const teacher=await page(),students=[await page(),await page(),await page(),await page()];
  await teacher.getByRole('button',{name:'老師登入',exact:true}).click();await teacher.getByLabel('老師密碼').fill(password);await teacher.getByRole('button',{name:'登入老師身分',exact:true}).click();
  for(const [i,p]of students.entries()){await p.getByLabel('暱稱').fill(i===0?'<b>甲</b>':'學生'+(i+1));await p.getByRole('button',{name:new RegExp(`第 ${i+1} 組`)}).click();await expect(p.getByRole('heading',{name:'已加入組別',exact:true})).toBeVisible();}
  await teacher.getByRole('button',{name:'開始搶答',exact:true}).click();
  async function submit(i:number,n:number,prefix:string){const p=students[i]!,fields=question(p,n).getByRole('textbox');await expect(fields.first()).toBeVisible();for(let index=0;index<await fields.count();index++)await fields.nth(index).fill(prefix+'\n子題'+index);await p.getByRole('button',{name:`送出第 ${n} 題`,exact:true}).click();await expect(question(p,n).getByText(/^已送出/)).toBeVisible();}
  await submit(0,1,'WINNER_A <img src=x onerror="window.injected=1">');await submit(1,1,'LOSER_B_PRIVATE');
  await submit(1,2,'WINNER_B');await submit(0,2,'LOSER_A_PRIVATE');await submit(2,3,'WINNER_C');
  await question(students[3]!,4).getByRole('textbox').fill('尚未送出的個人草稿');
  for(const [i,p]of students.entries()){
   const running=await rpc(p,`/api/activities/${activity.activityId}/results`);expect(running.status).toBe(200);expect(running.data.phase).toBe('RUNNING');noPrivate(running.data);
   if(i!==0)expect(JSON.stringify(running.data)).not.toContain('LOSER_A_PRIVATE');if(i!==1)expect(JSON.stringify(running.data)).not.toContain('LOSER_B_PRIVATE');
   expect(await p.getByRole('region',{name:'活動結果',exact:true}).count()).toBe(0);
  }
  const observerBefore=JSON.stringify(frames.get(students[3]!)!);expect(observerBefore).not.toMatch(/WINNER_A|WINNER_B|WINNER_C|LOSER_A|LOSER_B/);noPrivate(frames.get(students[3]!)!);
  await teacher.getByRole('button',{name:'結束活動',exact:true}).click();await teacher.getByRole('button',{name:'確認結束',exact:true}).click();
  for(const [i,p]of students.entries()){
   await expect(p.getByRole('region',{name:'活動結果',exact:true})).toBeVisible();await expect(p).toHaveURL(/#\/results$/);await expect(p.getByRole('textbox')).toHaveCount(0);
   await expect(p.getByLabel('本組成功題數',{exact:true})).toHaveText(`${i===3?0:1}／4 題搶答成功`);
   const states=await p.getByLabel('本組本題結果',{exact:true}).allTextContents();expect(states).toEqual(i===0?['本組搶答成功','已送出，未搶到','本組未作答','本組未作答']:i===1?['已送出，未搶到','本組搶答成功','本組未作答','本組未作答']:i===2?['本組未作答','本組未作答','本組搶答成功','本組未作答']:['本組未作答','本組未作答','本組未作答','本組未作答']);
   await expect(result(p,1).getByRole('region',{name:'搶答成功答案',exact:true}).locator('dd')).toHaveCount(4);await expect(result(p,1).getByText('送出者：<b>甲</b>',{exact:true})).toBeVisible();
   await expect(result(p,4).getByText('無人搶答',{exact:true})).toBeVisible();await expect(result(p,4).locator('dd')).toHaveCount(0);
   const text=await p.locator('body').innerText();expect(text).not.toContain('來源舊答案不可當結果');if(i!==0)expect(text).not.toContain('LOSER_A_PRIVATE');if(i!==1)expect(text).not.toContain('LOSER_B_PRIVATE');expect(await p.evaluate(()=>Reflect.get(window,'injected'))).toBeUndefined();await expect(p.locator('img')).toHaveCount(0);
   const ended=await rpc(p,`/api/activities/${activity.activityId}/results`);noPrivate(ended.data);if(i!==0)expect(JSON.stringify(ended.data)).not.toContain('LOSER_A_PRIVATE');if(i!==1)expect(JSON.stringify(ended.data)).not.toContain('LOSER_B_PRIVATE');
   noPrivate(frames.get(p)!);if(i!==0)expect(JSON.stringify(frames.get(p)!)).not.toContain('LOSER_A_PRIVATE');if(i!==1)expect(JSON.stringify(frames.get(p)!)).not.toContain('LOSER_B_PRIVATE');
  }
  const own=result(students[0]!,2).getByRole('region',{name:'本組已送出答案',exact:true});await expect(own).toContainText('LOSER_A_PRIVATE');
  const teacherResult=await rpc(teacher,`/api/activities/${activity.activityId}/results`);expect(teacherResult.data.submissions).toHaveLength(5);expect(JSON.stringify(teacherResult.data)).toMatch(/LOSER_A_PRIVATE|LOSER_B_PRIVATE/);
  const anonymous=await page();expect((await rpc(anonymous,`/api/activities/${activity.activityId}/results`)).status).toBe(401);await expect(anonymous.getByRole('region',{name:'活動結果',exact:true})).toHaveCount(0);
  await students[0]!.evaluate(()=>scrollTo(0,0));await students[0]!.screenshot({path:'test-results/results-desktop.png',fullPage:true});await students[0]!.setViewportSize({width:390,height:844});await students[0]!.screenshot({path:'test-results/results-mobile.png',fullPage:true});expect(await students[0]!.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const saved=await students[0]!.getByRole('region',{name:'活動結果',exact:true}).innerText();await students[0]!.reload();await expect(students[0]!.getByRole('region',{name:'活動結果',exact:true})).toHaveText(saved,{useInnerText:true});
  const epoch=frames.get(students[3]!)!.at(-1)!.serverEpoch;await app.close();identity.shutdown();database.close();database=openDatabase(path);await launch(port);
  await expect.poll(()=>frames.get(students[3]!)!.at(-1)?.serverEpoch,{timeout:5000}).not.toBe(epoch);
  for(const [i,p]of students.entries()){await expect(p.getByLabel('本組成功題數',{exact:true})).toHaveText(`${i===3?0:1}／4 題搶答成功`);await expect(result(p,4).getByText('無人搶答',{exact:true})).toBeVisible();noPrivate(frames.get(p)!);if(i!==0)expect(JSON.stringify(frames.get(p)!)).not.toContain('LOSER_A_PRIVATE');if(i!==1)expect(JSON.stringify(frames.get(p)!)).not.toContain('LOSER_B_PRIVATE');}
  await expect(students[0]!.getByRole('region',{name:'活動結果',exact:true})).toHaveText(saved,{useInnerText:true});
  writeFileSync('test-results/results-browser.json',JSON.stringify({日期:'2026-11-26 Asia/Taipei',Chrome:context.browser()!.version(),角色:{老師:1,學生:4,組別:4},三種成績同頁:true,四子題只算一題:true,成功題數:[1,1,1,0],未提交仍能看成功答案:true,其他組未成功答案不外洩:true,無人題不套來源舊答案:true,結束時輸入立即轉結果:true,重整與重啟自動恢復完整結果:true,HTTP與WS及重連快照權限:true,HTML純文字與390px無溢出:true,範圍:'獨立SQLite與真Chrome表單／結果畫面；非42分頁效能或真Sheets寫入'},null,2)+'\n');
 }finally{await app?.close().catch(()=>{});if(database.open){identity?.shutdown();database.close();}rmSync(directory,{recursive:true,force:true});}
});
