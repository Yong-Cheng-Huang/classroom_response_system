import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {readConfig} from '../../src/server/config.js';
import {openDatabase} from '../../src/server/database.js';
import {IdentityService} from '../../src/server/identity.js';
import {ActivityService} from '../../src/server/activity.js';
import {loadServiceAccount} from '../../src/server/service-account-config.js';
import {ServiceAccountTokens,ServiceAccountSheets} from '../../src/server/service-account.js';
import type {TabProof} from '../../src/shared/session.js';
export async function liveGoogleContext(){
 const config=readConfig(),directory=mkdtempSync(join(tmpdir(),'crs-service-live-')),path=join(directory,'classroom.db'),database=openDatabase(path),identity=new IdentityService(database,'isolated-live-boundary');
 const proof={secret:randomBytes(32).toString('hex'),instanceId:randomUUID(),generation:0},grant=identity.login('isolated-live-boundary',proof),teacher={...proof,token:grant.token,generation:grant.generation};
 try{const tokens=new ServiceAccountTokens(loadServiceAccount(config.serviceAccountFile));const google=Object.assign(new ServiceAccountSheets(identity,tokens),{accessToken:async(p:TabProof)=>{identity.principal(p);const token=await tokens.token();identity.principal(p);return token;}});google.assertConfigured();
 return{directory,path,database,identity,teacher,google,activities:new ActivityService(database,identity),close:()=>{identity.shutdown();database.close();rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}};
 }catch(error){identity.shutdown();database.close();rmSync(directory,{recursive:true,force:true});throw error;}
}
