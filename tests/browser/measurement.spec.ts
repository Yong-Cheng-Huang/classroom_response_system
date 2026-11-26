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

test('13.3 觀測器在真Chrome無序列化helper錯誤，React commit後才記錄實際狀態與DOM',async({context})=>{
 await installReactMeasurement(context);const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('data:text/html,<html><body>觀測器初始化</body></html>');expect(errors).toEqual([]);expect(await page.evaluate(()=>typeof Reflect.get(window,'__REACT_DEVTOOLS_GLOBAL_HOOK__')?.onCommitFiberRoot)).toBe('function');
 const directory=mkdtempSync(join(tmpdir(),'crs-measurement-')),db=openDatabase(join(directory,'classroom.db')),identity=new IdentityService(db,'measurement-fixture'),activities=new ActivityService(db,identity);
 const app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:'measurement-fixture'}),db,()=>{},{identity,activities,authenticate:r=>{assertRequestOrigin(r);return identity.principal(identity.proof(r));},beforeRead:()=>identity.sweep(),readModel:()=>readActivityModel(db,identity)});const address=await app.listen(0);if(!address||typeof address==='string')throw new Error('隔離服務未啟動');
 try{
  await replacePreparedActivity(db,preparedActivity(),{activityId:null,version:null,confirmed:false});await page.goto('http://127.0.0.1:'+address.port);await page.getByRole('button',{name:'老師登入',exact:true}).click();await page.getByLabel('老師密碼').fill('measurement-fixture');await page.getByRole('button',{name:'登入老師身分',exact:true}).click();await expect.poll(async()=>(await samples(page)).some(s=>s.role==='TEACHER'&&s.phase==='READY'&&s.domQuestions===2)).toBe(true);await page.getByRole('button',{name:'開始搶答',exact:true}).click();await expect.poll(async()=>(await samples(page)).some(s=>s.role==='TEACHER'&&s.phase==='RUNNING'&&s.domQuestions===2)).toBe(true);const records=await samples(page);expect(records.every(s=>Number.isFinite(s.at)&&s.revision>0)).toBe(true);expect(errors).toEqual([]);
 }finally{await app.close();identity.shutdown();db.close();rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
