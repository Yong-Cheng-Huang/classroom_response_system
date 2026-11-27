import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {openDatabase} from '../../src/server/database.js';
import {IdentityService} from '../../src/server/identity.js';
import {ActivityService} from '../../src/server/activity.js';
import {SubmissionService} from '../../src/server/submissions.js';
import {ExportService} from '../../src/server/exports.js';
import {GoogleService} from '../../src/server/google.js';
import {GoogleVault} from '../../src/server/google-vault.js';
import {ImportService} from '../../src/server/imports.js';
import {PublicSheetsReader} from '../../src/server/public-sheets.js';
import {createApplication} from '../../src/server/app.js';
import {readConfig} from '../../src/server/config.js';
import {readActivityModel} from '../../src/server/read-model.js';
import {assertRequestOrigin} from '../../src/server/identity-http.js';
import type {TabProof} from '../../src/shared/session.js';
import {sheetFixture} from './sheets.js';
import {f1} from '../fixtures/catalog.js';

export const freshPublicProof=():TabProof=>({secret:randomBytes(32).toString('hex'),instanceId:randomUUID(),generation:0});
export function publicHeaders(p:TabProof){return{Authorization:'Bearer '+p.token,'X-Tab-Proof':p.secret,'X-Document-Instance':p.instanceId,'X-Session-Generation':String(p.generation),'Content-Type':'application/json'};}
export const publicUrl='https://docs.google.com/spreadsheets/d/fixture-copy/edit';
export async function publicImportFixture(configured=true,realClock=false){
 const directory=mkdtempSync(join(tmpdir(),'crs-public-import-')),database=openDatabase(join(directory,'classroom.db')),password='public-import-fixture';let time=1000;
 const now=()=>realClock?Date.now():time,identity=new IdentityService(database,password,now,true),activities=new ActivityService(database,identity,undefined,now),google=new GoogleService(database,identity,new GoogleVault(directory),null,now);
 let transport:typeof fetch=async()=>Response.json(sheetFixture(f1)),oauthCalls=0;
 const reader=new PublicSheetsReader(configured?'PUBLIC_CANARY':undefined,(...args)=>transport(...args));
 const imports=new ImportService(database,identity,google,activities,now,async()=>{oauthCalls++;throw new Error('OAuth 不應被呼叫');},reader);
 const logs:string[]=[];
 const app=createApplication(readConfig({APP_DATA_DIR:directory,TEACHER_PASSWORD:password}),database,entry=>{logs.push(JSON.stringify(entry));},{identity,activities,google,imports,submissions:new SubmissionService(database,identity),exports:new ExportService(database,identity,google,activities,now),now,authenticate:r=>{assertRequestOrigin(r);return identity.principal(identity.proof(r));},beforeRead:()=>identity.sweep(),readModel:()=>readActivityModel(database,identity)});
 const address=await app.listen(0);if(!address||typeof address==='string')throw new Error('公開匯入測試服務未啟動');identity.markReady();
 const proof=freshPublicProof(),grant=identity.login(password,proof);proof.token=grant.token;proof.generation=grant.generation;
 return{database,identity,activities,google,imports,proof,now,password,base:'http://127.0.0.1:'+address.port,logs,oauthCalls:()=>oauthCalls,setTime:(n:number)=>{time=n;},setTransport:(next:typeof fetch)=>{transport=next;},close:async()=>{await app.close();identity.shutdown();database.close();rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}};
}
