import {test,expect} from '@playwright/test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installReactMeasurement,samples} from '../helpers/react-measurement.js';
import {openDatabase} from '../../src/server/database.js';
import {IdentityService} from '../../src/server/identity.js';
import {ActivityService} from '../../src/server/activity.js';
import {createApplication} from '../../src/server/app.js';
import {readConfig} from '../../src/server/config.js';
import {readActivityModel} from '../../src/server/read-model.js';
import {assertRequestOrigin} from '../../src/server/identity-http.js';
import {replacePreparedActivity} from '../../src/server/activity-replacement.js';
import {preparedActivity} from '../helpers/replacement.js';

test('13.3 診斷器保留HTTP已呈現的React DOM時刻，與稍後WS快照分開',async({context})=>{
 await installReactMeasurement(context);const page=await context.newPage();let release=()=>{};const gate=new Promise<void>(done=>{release=done;});await page.route('**/api/realtime/ticket',async route=>{await gate;await route.continue().catch(()=>{});});
 const directory=mkdtempSync(join(tmpdir(),'crs-measurement-http-')),db=openDatabase(join(directory,'classroom.db')),identity=new IdentityService(db,'measurement-fixture'),activities=new ActivityService(db,identity);
 const app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:'measurement-fixture'}),db,()=>{},{identity,activities,authenticate:r=>{assertRequestOrigin(r);return identity.principal(identity.proof(r));},beforeRead:()=>identity.sweep(),readModel:()=>readActivityModel(db,identity)});const address=await app.listen(0);if(!address||typeof address==='string')throw new Error('隔離服務未啟動');
 try{await replacePreparedActivity(db,preparedActivity(),{activityId:null,version:null,confirmed:false});await page.goto('http://127.0.0.1:'+address.port);await page.getByRole('button',{name:'老師登入',exact:true}).click();await page.getByLabel('老師密碼').fill('measurement-fixture');await page.getByRole('button',{name:'登入老師身分',exact:true}).click();await expect(page.getByRole('heading',{name:'待開始',exact:true})).toBeVisible();
  const dom=await page.evaluate(()=>Reflect.get(window,'__crsMeasurement')?.domRecords??[]);expect(dom.some((s:any)=>s.role==='TEACHER'&&s.phase==='READY'&&s.domQuestions===2)).toBe(true);expect((await samples(page)).some(s=>s.role==='TEACHER')).toBe(false);
  release();await expect.poll(async()=>(await samples(page)).some(s=>s.role==='TEACHER'),{timeout:5000}).toBe(true);const ws=(await samples(page)).find(s=>s.role==='TEACHER')!;expect(dom.find((s:any)=>s.role==='TEACHER').at).toBeLessThan(ws.at);
 }finally{release();await app.close();identity.shutdown();db.close();rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
