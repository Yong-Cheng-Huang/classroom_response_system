import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Page} from '@playwright/test';
import {openDatabase} from '../../src/server/database.js';
import {IdentityService} from '../../src/server/identity.js';
import {ActivityService} from '../../src/server/activity.js';
import {SubmissionService} from '../../src/server/submissions.js';
import {createApplication} from '../../src/server/app.js';
import {readConfig} from '../../src/server/config.js';
import {readActivityModel} from '../../src/server/read-model.js';
import {assertRequestOrigin} from '../../src/server/identity-http.js';
import {replacePreparedActivity} from '../../src/server/activity-replacement.js';
import {preparedActivity} from './replacement.js';

export async function csvBrowserFixture(){
 const directory=mkdtempSync(join(tmpdir(),'crs-csv-browser-')),database=openDatabase(join(directory,'classroom.db')),password='csv-browser-fixture';
 const identity=new IdentityService(database,password,Date.now,true),activities=new ActivityService(database,identity);
 const app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:password}),database,()=>{},{identity,activities,submissions:new SubmissionService(database,identity),authenticate:r=>{assertRequestOrigin(r);return identity.principal(identity.proof(r));},beforeRead:()=>identity.sweep(),readModel:()=>readActivityModel(database,identity)});
 const address=await app.listen(0);if(!address||typeof address==='string')throw new Error('CSV測試服務未啟動');identity.markReady();
 const prepared=preparedActivity();prepared.questions[1]!.fields.push({label:'（3）',prompt:'第三子題',answerRange:'H9',original:{}},{label:'（4）',prompt:'第四子題',answerRange:'H10',original:{}});const activity=await replacePreparedActivity(database,prepared,{activityId:null,version:null,confirmed:false});
 return{database,identity,activities,activityId:activity.activityId,password,base:'http://127.0.0.1:'+address.port,close:async()=>{await app.close();identity.shutdown();database.close();rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}};
}
export async function csvTeacher(page:Page,f:Awaited<ReturnType<typeof csvBrowserFixture>>){await page.goto(f.base);await page.getByRole('button',{name:'老師登入',exact:true}).click();await page.getByLabel('老師密碼').fill(f.password);await page.getByRole('button',{name:'登入老師身分',exact:true}).click();}
export async function endCsvActivity(page:Page){await page.getByRole('button',{name:'開始搶答',exact:true}).click();await page.getByRole('button',{name:'結束活動',exact:true}).click();await page.getByRole('button',{name:'確認結束',exact:true}).click();}
