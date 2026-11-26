import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir,cpus,totalmem} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {expect,type Page} from '@playwright/test';
import {nativeChrome} from '../../tests/helpers/native-chrome.js';
import {installReactMeasurement,calibrate,samples} from '../../tests/helpers/react-measurement.js';
import {openDatabase} from '../../src/server/database.js';
import {IdentityService} from '../../src/server/identity.js';
import {ActivityService} from '../../src/server/activity.js';
import {SubmissionService} from '../../src/server/submissions.js';
import {createApplication} from '../../src/server/app.js';
import {readConfig} from '../../src/server/config.js';
import {readActivityModel} from '../../src/server/read-model.js';
import {assertRequestOrigin} from '../../src/server/identity-http.js';
import {parseGuidedNotes} from '../../src/server/guided-notes.js';
import {sheetFixture} from '../../tests/helpers/sheets.js';
import {syntheticF3} from '../../tests/fixtures/catalog.js';
import {replacePreparedActivity} from '../../src/server/activity-replacement.js';

const directory=mkdtempSync(join(tmpdir(),'crs-perf-preflight-')),db=openDatabase(join(directory,'classroom.db')),identity=new IdentityService(db,'performance-isolated',Date.now,true),activities=new ActivityService(db,identity),submissions=new SubmissionService(db,identity);
const report:Record<string,any>={日期:'2026-11-26 Asia/Taipei',狀態:'執行中',程序:'F3單輪測量工具預檢；不是F1～F3各20輪完整驗收',資料集:'F3',輪次:1,環境:{cpu:cpus()[0]?.model,memory:totalmem(),macOS:execFileSync('sw_vers',['-productVersion'],{encoding:'utf8'}).trim(),powerSavingSettings:execFileSync('pmset',['-g','custom'],{encoding:'utf8'})},量測:[],失敗:[],無效:[]};
mkdirSync('docs/evidence',{recursive:true});const save=()=>writeFileSync('docs/evidence/performance-preflight.json',JSON.stringify(report,null,2)+'\n');let native:Awaited<ReturnType<typeof nativeChrome>>|undefined,base='';
const app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:'performance-isolated'}),db,()=>{},{identity,activities,submissions,authenticate:r=>{assertRequestOrigin(r);return identity.principal(identity.proof(r));},beforeRead:()=>identity.sweep(),readModel:()=>readActivityModel(db,identity)});
try{
 const candidate=parseGuidedNotes(sheetFixture(syntheticF3()),'1',20),activity=await replacePreparedActivity(db,candidate,{activityId:null,version:null,confirmed:false});
 const address=await app.listen(0);assert.ok(address&&typeof address==='object');identity.markReady();base='http://127.0.0.1:'+address.port;
 native=await nativeChrome(join(directory,'profile'),true);report.環境.Chrome=native.browser.version();const context=native.context,initial=[...context.pages()];await installReactMeasurement(context);
 const pages:Page[]=[];for(let i=0;i<42;i++)pages.push(await context.newPage());for(const p of initial)await p.close();
 for(let n=0;n<42;n+=4)await Promise.all(pages.slice(n,n+4).map(p=>p.goto(base)));
 for(const p of pages.slice(0,2)){await p.getByRole('button',{name:'老師登入',exact:true}).evaluate((e:HTMLElement)=>e.click());await p.getByLabel('老師密碼').evaluate((element:HTMLInputElement,value:string)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));},'performance-isolated');await p.getByRole('button',{name:'登入老師身分',exact:true}).evaluate((e:HTMLElement)=>e.click());await expect(p.getByRole('heading',{name:'老師已登入',exact:true})).toBeVisible();}
 const students=pages.slice(2);for(const [i,p] of students.entries()){await p.bringToFront();await p.getByLabel('暱稱').evaluate((element:HTMLInputElement,value:string)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));},'預檢'+(i+1));}
 await Promise.all(students.map((p,i)=>p.getByRole('button',{name:new RegExp('^第 '+(Math.floor(i/2)+1)+' 組 ')}).evaluate((e:HTMLElement)=>e.click())));
 await Promise.all(students.map(p=>expect(p.getByRole('heading',{name:'已加入組別',exact:true})).toBeVisible()));await pages[0]!.bringToFront();
 const clocks:{offset:number;uncertainty:number}[]=[];for(const p of pages)clocks.push(await calibrate(p));report.校準=clocks;report.環境.分頁=await Promise.all(pages.map(async(p,i)=>({分頁:i,visibility:await p.evaluate(()=>document.visibilityState),discarded:await p.evaluate(()=>Reflect.get(document,'wasDiscarded')??null)})));save();console.log('42分頁F3已就緒，開始React commit量測');
 // 同一程序單調時鐘；同步方法返回的區間包住權威交易COMMIT，整段加入不確定度。
 let commit:{before:number;after:number}|undefined;const transition=activities.transition.bind(activities);activities.transition=(...args:Parameters<typeof activities.transition>)=>{const before=performance.now(),v=transition(...args);commit={before,after:performance.now()};return v;};
 await pages[0]!.getByRole('button',{name:'開始搶答',exact:true}).evaluate((e:HTMLElement)=>e.click());assert.ok(commit);const committed=commit;
 await Promise.all(pages.map(async(p,i)=>{await expect.poll(async()=> (await samples(p)).some(s=>s.phase==='RUNNING'),{timeout:30000}).toBe(true);const s=(await samples(p)).find(s=>s.phase==='RUNNING')!,clock=clocks[i]!,T_apply=s.at+clock.offset,uncertainty=clock.uncertainty+(committed.after-committed.before),delay=T_apply-committed.after+uncertainty;const result={dataset:'F3',round:1,operation:'開始',revision:s.revision,tab:i,role:s.role,T_commit:committed.after,T_commitLower:committed.before,T_apply,T_ready:null,T_restored:null,clockUncertaintyMs:uncertainty,visibility:s.visibility,domQuestions:s.domQuestions,questions:s.questions,delayUpperMs:delay,outcome:delay<=1000?'通過':'未達1秒'};report.量測.push(result);if(s.domQuestions!==60)report.無效.push({tab:i,原因:'React commit與60題DOM不符'});if(delay>1000)report.失敗.push(result);}));
 report.最壞同步上界ms=Math.max(...report.量測.map((s:any)=>s.delayUpperMs));report.狀態=report.失敗.length||report.無效.length?'未通過':'工具預檢通過';report.後續='未執行20輪或其他固定批次，不得以單輪預檢宣告RR08完成。';save();console.log(JSON.stringify({狀態:report.狀態,最壞同步上界ms:report.最壞同步上界ms,失敗:report.失敗.length,無效:report.無效.length}));if(report.狀態==='未通過')process.exitCode=1;
}catch(error){report.狀態='未通過';report.錯誤=error instanceof Error?error.message:'量測中斷';report.無效.push({階段:'建立量測或套用前置',原因:report.錯誤});save();console.log(JSON.stringify({狀態:report.狀態,原因:report.錯誤}));process.exitCode=1;}
finally{await native?.close().catch(()=>{});await app.close().catch(()=>{});identity.shutdown();db.close();rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
