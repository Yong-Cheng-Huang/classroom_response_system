import { test,expect,type Page } from '@playwright/test';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir,release,arch } from 'node:os';
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
import type { RealtimeFrame } from '../../src/shared/realtime.js';
import type { StudentView } from '../../src/shared/views.js';

test('8.1～8.7 同 Chrome 兩老師四學生：同組競爭、角色分流、重建後第三名及結束重送',async({context})=>{
 test.setTimeout(60000);
 const directory=mkdtempSync(join(tmpdir(),'crs-ranking-browser-')),path=join(directory,'classroom.db'),password='ranking-browser-fixture';
 let database=openDatabase(path),identity!:IdentityService,app!:ReturnType<typeof createApplication>,base='';
 const launch=async(port=0)=>{
  identity=new IdentityService(database,password,Date.now,true);
  const db=database,id=identity;
  app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:password}),db,()=>{}, {identity:id,activities:new ActivityService(db,id),submissions:new SubmissionService(db,id),
   authenticate:request=>{assertRequestOrigin(request);return id.principal(id.proof(request));},beforeRead:()=>id.sweep(),readModel:()=>readActivityModel(db,id)});
  const address=await app.listen(port);if(!address||typeof address==='string')throw new Error('測試服務未啟動');identity.markReady();base=`http://127.0.0.1:${address.port}`;return address.port;
 };
 const frames=new Map<Page,RealtimeFrame[]>(),headers=new Map<Page,Record<string,string>>();
 const page=async()=>{const p=await context.newPage();frames.set(p,[]);
  p.on('request',request=>{const h=request.headers();if(request.url().startsWith(base+'/api/')&&h.authorization)headers.set(p,{authorization:h.authorization,'X-Tab-Proof':h['x-tab-proof']!,'X-Document-Instance':h['x-document-instance']!,'X-Session-Generation':h['x-session-generation']!});});
  p.on('websocket',socket=>{if(socket.url().endsWith('/ws'))socket.on('framereceived',received=>{const value=JSON.parse(String(received.payload));if(value.type==='snapshot'||value.type==='update')frames.get(p)!.push(value);});});return p;};
 const rpc=async(p:Page,path:string,body?:unknown)=>{const proof=headers.get(p);expect(proof).toBeTruthy();return p.evaluate(async args=>{const response=await fetch(args.path,{method:args.body===undefined?'GET':'POST',headers:{...args.proof,...(args.body===undefined?{}:{'Content-Type':'application/json'})},body:args.body===undefined?undefined:JSON.stringify(args.body)});return{status:response.status,...await response.json()};},{path,body,proof:proof!});};
 try{
  const port=await launch();const activity=await replacePreparedActivity(database,preparedActivity(),{activityId:null,version:null,confirmed:false});
  const teachers=[await page(),await page()],students=[await page(),await page(),await page(),await page()];
  for(const p of teachers){await p.goto(base);await p.getByRole('button',{name:'老師登入',exact:true}).click();await p.getByLabel('老師密碼').fill(password);await p.getByRole('button',{name:'登入老師身分',exact:true}).click();await expect(p.getByRole('heading',{name:'老師已登入',exact:true})).toBeVisible();}
  for(const [i,p] of students.entries()){await p.goto(base);await p.getByLabel('暱稱').fill('提交測試'+i);await p.getByRole('button',{name:new RegExp('第 '+(i<2?1:i)+' 組')}).click();await expect(p.getByRole('heading',{name:'已加入組別',exact:true})).toBeVisible();}
  await teachers[0]!.getByRole('button',{name:'開始搶答',exact:true}).click();
  for(const p of students)await expect.poll(()=>frames.get(p)!.at(-1)?.data.view.phase).toBe('RUNNING');
  const view=(await rpc(students[0]!,'/api/activities/current/view')).data as StudentView;expect(view.phase).toBe('RUNNING');if(view.phase!=='RUNNING')throw new Error('階段不符');
  const question=view.questions.find(q=>q.kind==='GROUP')!,single=view.questions.find(q=>q.kind==='SINGLE')!;
  const input=(requestId:string,answer:string)=>({requestId,answers:question.fields.map((field,i)=>({fieldId:field.id,text:answer+i}))});
  const route=`/api/activities/${activity.activityId}/questions/${question.id}/submissions`;
  const a=input('browser-a','第一組甲答案'),b=input('browser-b','第一組乙答案');
  const otherBefore=frames.get(students[2]!)!.filter(f=>f.type==='update').length;
  const raced=await Promise.all([rpc(students[0]!,route,a),rpc(students[1]!,route,b)]);expect(raced.map(r=>r.status).sort()).toEqual([200,409]);
  const winner=raced[0]!.status===200?0:1,original=raced[winner]!.data,winningInput=winner===0?a:b;
  for(const p of [students[0]!,students[1]!])await expect.poll(()=>{const last=frames.get(p)!.at(-1)?.data;return last?.scope==='activity'&&last.view.role==='STUDENT'&&last.view.phase==='RUNNING'?last.view.ownSubmissions.length:0;}).toBe(1);
  for(const p of teachers)await expect.poll(()=>{const last=frames.get(p)!.at(-1)?.data;return last?.scope==='activity'&&last.view.role==='TEACHER'&&last.view.phase!=='EMPTY'?last.view.submissions.length:0;}).toBe(1);
  expect(frames.get(students[2]!)!.filter(f=>f.type==='update').length).toBe(otherBefore);
  expect(JSON.stringify(frames.get(students[2]!))).not.toContain('第一組');
  expect(JSON.stringify(frames.get(students[0]!))).not.toMatch(/"rank"|receivedAt|receiveOrder|submittedAt/);
  expect((await rpc(students[2]!,route,input('browser-second','第二組答案'))).status).toBe(200);
  const firstTwo=database.prepare('SELECT * FROM submissions ORDER BY rank').all();expect(firstTwo).toHaveLength(2);
  const epoch=frames.get(students[3]!)!.at(-1)!.serverEpoch;
  await app.close();identity.shutdown();database.close();database=openDatabase(path);await launch(port);
  await expect.poll(()=>frames.get(students[3]!)!.at(-1)?.serverEpoch,{timeout:5000}).not.toBe(epoch);
  expect((await rpc(students[3]!,route,input('browser-third','重啟後第三組'))).status).toBe(200);
  expect(database.prepare('SELECT * FROM submissions ORDER BY rank LIMIT 2').all()).toEqual(firstTwo);
  expect(database.prepare('SELECT rank FROM submissions ORDER BY rank').all()).toEqual([{rank:1},{rank:2},{rank:3}]);
  await expect(teachers[1]!.getByRole('button',{name:'結束活動',exact:true})).toBeVisible();await teachers[1]!.getByRole('button',{name:'結束活動',exact:true}).click();await teachers[1]!.getByRole('button',{name:'確認結束',exact:true}).click();await expect(teachers[0]!.getByRole('heading',{name:'已結束',exact:true})).toBeVisible();
  const retry=await rpc(students[winner]!,route,winningInput);expect(retry.status).toBe(200);expect(retry.data).toEqual(original);
  const late=await rpc(students[3]!,`/api/activities/${activity.activityId}/questions/${single.id}/submissions`,{requestId:'late',answers:single.fields.map(f=>({fieldId:f.id,text:'結束後新提交'}))});expect(late.status).toBe(409);
  expect((database.prepare('SELECT count(*) AS n FROM submissions').get() as {n:number}).n).toBe(3);
  const result=await rpc(students[3]!,`/api/activities/${activity.activityId}/results`);expect(result.status).toBe(200);expect(JSON.stringify(result.data)).not.toContain('第二組答案');
  writeFileSync('test-results/ranking-browser.json',JSON.stringify({日期:'2026-11-26 Asia/Taipei',Chrome:context.browser()!.version(),OS:release(),架構:arch(),角色分頁:{老師:2,學生:4,組別:3},競爭回覆:raced.map(r=>r.status).sort(),排名:[1,2,3],第一名唯一:true,重建後前兩筆不變:true,結束後重送原結果:true,學生無他組未成功答案:true,範圍:'真 Chrome／HTTP／WS／SQLite；利用現有登入與活動畫面直接呼叫提交 API，學生表單與老師完整監看畫面仍待後續，非42分頁效能或程序 SIGKILL'},null,2)+'\n');
 }finally{await app?.close().catch(()=>{});if(database.open){identity?.shutdown();database.close();}rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
