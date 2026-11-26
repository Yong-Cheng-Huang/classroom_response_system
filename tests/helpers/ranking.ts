import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { randomBytes,randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { IncomingMessage } from 'node:http';
import { openDatabase } from '../../src/server/database.js';
import { createApplication } from '../../src/server/app.js';
import { readConfig } from '../../src/server/config.js';
import { IdentityService } from '../../src/server/identity.js';
import { assertRequestOrigin } from '../../src/server/identity-http.js';
import { ActivityService } from '../../src/server/activity.js';
import { SubmissionService } from '../../src/server/submissions.js';
import { readActivityModel } from '../../src/server/read-model.js';
import { replacePreparedActivity } from '../../src/server/activity-replacement.js';
import { preparedActivity } from './replacement.js';
import type { TabProof,SessionGrant } from '../../src/shared/session.js';

export const rankingPassword='ranking-isolated-fixture';
export const freshProof=():TabProof=>({secret:randomBytes(32).toString('hex'),instanceId:randomUUID(),generation:0});
export const rankingHeaders=(p:TabProof)=>({'X-Tab-Proof':p.secret,'X-Document-Instance':p.instanceId,'X-Session-Generation':String(p.generation),...(p.token?{Authorization:'Bearer '+p.token}:{})});
export async function rankingFixture(t:TestContext,authorize?: (request:IncomingMessage)=>Promise<void>){
  const directory=mkdtempSync(joinPath(tmpdir(),'crs-ranking-')),path=joinPath(directory,'classroom.db');
  let database=openDatabase(path),now=1000,identity!:IdentityService,activities!:ActivityService,submissions!:SubmissionService,app!:ReturnType<typeof createApplication>,base='';
  const logs:string[]=[];
  const launch=async(port=0)=>{
    identity=new IdentityService(database,rankingPassword,()=>now,true);activities=new ActivityService(database,identity,undefined,()=>now);submissions=new SubmissionService(database,identity);
    const db=database,id=identity;
    app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:rankingPassword}),db,event=>logs.push(JSON.stringify(event)),{identity:id,activities,submissions,now:()=>now,
      authenticate:async request=>{await authorize?.(request);assertRequestOrigin(request);return id.principal(id.proof(request));},beforeRead:()=>id.sweep(),readModel:()=>readActivityModel(db,id)});
    const address=await app.listen(port);assert.ok(address&&typeof address==='object');identity.markReady();base=`http://127.0.0.1:${address.port}`;return address.port;
  };
  const port=await launch();
  t.after(async()=>{await app.close();identity.shutdown();database.close();rmSync(directory,{recursive:true,force:true});});
  const initial=await replacePreparedActivity(database,preparedActivity(),{activityId:null,version:null,confirmed:false});
  const activityId=initial.activityId;
  const groups=database.prepare('SELECT id FROM groups ORDER BY number').all() as {id:string}[];
  const questions=(database.prepare('SELECT id,kind FROM questions ORDER BY position').all() as {id:string;kind:string}[]).map(q=>({...q,fields:database.prepare('SELECT id FROM question_fields WHERE question_id=? ORDER BY position').all(q.id) as {id:string}[]}));
  const call=async(path:string,p:TabProof|undefined,body?:unknown,extra:Record<string,string>={})=>{
    const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Connection:'close',...(p?rankingHeaders(p):{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
    return{status:response.status,...await response.json()};
  };
  const grant=(p:TabProof,value:SessionGrant):TabProof=>({...p,token:value.token,generation:value.generation});
  const teacherProof=freshProof(),teacherLogin=await call('/api/teacher/login',teacherProof,{password:rankingPassword});assert.equal(teacherLogin.status,200);const teacher=grant(teacherProof,teacherLogin.data);
  const join=async(groupIndex:number,nickname='合成組員')=>{const p=freshProof(),result=await call(`/api/activities/${activityId}/join`,p,{groupId:groups[groupIndex]!.id,nickname});assert.equal(result.status,200);return grant(p,result.data);};
  const students=[await join(0,'第一組甲'),await join(1,'第二組'),await join(2,'第三組')];
  const start=async()=>{const version=(database.prepare('SELECT version FROM activities').get() as {version:number}).version;const r=await call(`/api/activities/${activityId}/start`,teacher,{expectedVersion:version});assert.equal(r.status,200);return r;};
  const end=async()=>{const version=(database.prepare('SELECT version FROM activities').get() as {version:number}).version;return call(`/api/activities/${activityId}/end`,teacher,{expectedVersion:version,confirmed:true});};
  const groupQuestion=questions.find(q=>q.kind==='GROUP')!,singleQuestion=questions.find(q=>q.kind==='SINGLE')!;
  const input=(requestId:string,text=' 與來源不同的答案\n👨‍👩‍👧‍👦 ',question=groupQuestion)=>({requestId,answers:question.fields.map((f,i)=>({fieldId:f.id,text:i?text+'二':text}))});
  const submit=(p:TabProof,body:unknown,questionId=groupQuestion.id,extra:Record<string,string>={})=>call(`/api/activities/${activityId}/questions/${questionId}/submissions`,p,body,extra);
  const rows=()=>database.prepare('SELECT id,question_id,group_id,participant_id,sender_nickname,received_at,receive_order,rank,request_id,request_hash,sealed FROM submissions ORDER BY question_id,rank').all() as {id:string;question_id:string;group_id:string;participant_id:string;sender_nickname:string;received_at:number;receive_order:number;rank:number;request_id:string;request_hash:string;sealed:number}[];
  return{directory,path,base,activityId,groups,questions,teacher,students,join,start,end,call,submit,input,rows,groupQuestion,singleQuestion,logs,setNow:(value:number)=>{now=value;},
    get database(){return database;},get identity(){return identity;},get submissions(){return submissions;},get activities(){return activities;},get app(){return app;},
    async restart(clean=true){await app.close();if(clean)identity.shutdown();database.close();database=openDatabase(path);await launch(port);},
  };
}
