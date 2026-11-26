import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {temporaryDatabase} from '../helpers/database.js';
import {freshProof,rankingHeaders} from '../helpers/ranking.js';
import {openDatabase} from '../../src/server/database.js';
import {IdentityService} from '../../src/server/identity.js';
import {ActivityService} from '../../src/server/activity.js';
import {SubmissionService} from '../../src/server/submissions.js';
import {createSqliteAllocator} from '../../src/server/command-queue.js';
import {parseGuidedNotes} from '../../src/server/guided-notes.js';
import {sheetFixture} from '../helpers/sheets.js';
import {f2} from '../fixtures/catalog.js';

for(const phase of ['EMPTY','READY','RUNNING','ENDED'])test('13.4 真HTTP程序SIGKILL與跨60秒重啟 '+phase,{timeout:15000},async t=>{
 const f=temporaryDatabase(t),db=f.database,identity=new IdentityService(db,'state-crash-fixture',()=>1000),activities=new ActivityService(db,identity,undefined,()=>1000),p=freshProof(),g=identity.login('state-crash-fixture',p),teacher={...p,token:g.token,generation:g.generation};
 if(phase!=='EMPTY'){
  const a=await activities.replace(teacher,parseGuidedNotes(sheetFixture(f2),'1',2),{activityId:null,version:null,confirmed:false});const group=db.prepare('SELECT id FROM groups ORDER BY number LIMIT 1').get() as {id:string},sp=freshProof(),sg=identity.join(a.activityId,group.id,'原學生',sp),student={...sp,token:sg.token,generation:sg.generation},order=createSqliteAllocator(db,()=>1000);
  if(phase!=='READY'){activities.transition(teacher,a.activityId,1,'start',order());const q=db.prepare('SELECT id FROM questions ORDER BY position LIMIT 1').get() as {id:string};new SubmissionService(db,identity).submit(student,a.activityId,q.id,{requestId:'saved',answers:(db.prepare('SELECT id FROM question_fields WHERE question_id=? ORDER BY position').all(q.id) as {id:string}[]).map(v=>({fieldId:v.id,text:'原答案'}))},order());if(phase==='ENDED')activities.transition(teacher,a.activityId,2,'end',order(),true);}
 }
 const snapshot=()=>['activities','sources','questions','question_fields','groups','submissions','submission_answers','receive_orders'].map(table=>({table,rows:db.prepare(`SELECT * FROM ${table}`).all()})),before=snapshot(),expiry=db.prepare('SELECT id,created_at,expires_at FROM sessions ORDER BY id').all();identity.shutdown();db.close();
 const file=join(f.directory,'state.json');writeFileSync(file,JSON.stringify({path:f.path,directory:f.directory}),{mode:0o600});const children:ChildProcess[]=[];t.after(()=>{for(const c of children)if(c.exitCode===null&&c.signalCode===null)c.kill('SIGKILL');});
 async function start(time:number,port=0){const child=spawn(process.execPath,['--import','tsx',resolve('tests/helpers/state-crash.ts'),file,String(time),String(port)],{stdio:['ignore','pipe','pipe']});children.push(child);let output='';const actual=await new Promise<number>((done,fail)=>{const timeout=setTimeout(()=>fail(new Error('隔離服務啟動逾時')),5000);child.stdout!.on('data',v=>{output+=v.toString();try{const r=JSON.parse(output.trim());if(r.ready){clearTimeout(timeout);done(r.ready);}}catch{}});child.once('error',e=>{clearTimeout(timeout);fail(e);});child.once('exit',()=>{clearTimeout(timeout);if(!output)fail(new Error('隔離服務提前結束'));});});return{child,port:actual};}
 async function kill(child:ChildProcess){const closed=new Promise<void>(done=>child.once('exit',()=>done()));child.kill('SIGKILL');await closed;assert.equal(child.signalCode,'SIGKILL');}
 const first=await start(2000),base='http://127.0.0.1:'+first.port;const read=async()=>{const r=await fetch(base+'/api/activities/current/view',{headers:rankingHeaders(teacher)});assert.equal(r.status,200);return(await r.json()).data;};assert.equal((await read()).phase,phase);await kill(first.child);
 const second=await start(62000,first.port);const view=await read();assert.equal(view.phase,phase);await kill(second.child);
 const restored=openDatabase(f.path);t.after(()=>{if(restored.open)restored.close();});assert.equal(restored.pragma('integrity_check',{simple:true}),'ok');for(const entry of before)assert.deepEqual(restored.prepare(`SELECT * FROM ${entry.table}`).all(),entry.rows);assert.deepEqual(restored.prepare('SELECT id,created_at,expires_at FROM sessions ORDER BY id').all(),expiry);if(phase==='RUNNING')assert.ok(view.serverNow-view.startedAt>=61000);
});
