import Database from 'better-sqlite3';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes,randomUUID } from 'node:crypto';
import { readConfig } from '../../src/server/config.js';
import { openDatabase } from '../../src/server/database.js';
import { IdentityService } from '../../src/server/identity.js';
import { ActivityService } from '../../src/server/activity.js';
import { GoogleService,GoogleOAuthProvider,loadGoogleClient,type GoogleTokens } from '../../src/server/google.js';
import { GoogleVault } from '../../src/server/google-vault.js';
export async function liveGoogleContext(){
 const config=readConfig(),directory=mkdtempSync(join(tmpdir(),'crs-export-boundary-')),path=join(directory,'classroom.db'),database=openDatabase(path),identity=new IdentityService(database,'isolated-live-boundary');
 const proof={secret:randomBytes(32).toString('hex'),instanceId:randomUUID(),generation:0},grant=identity.login('isolated-live-boundary',proof),teacher={...proof,token:grant.token,generation:grant.generation};
 try{
  const real=new Database(config.databasePath,{readonly:true,fileMustExist:true});let tokens:GoogleTokens;
  try{const row=real.prepare("SELECT credential_reference FROM google_connection WHERE state='CONNECTED'").get() as {credential_reference:string}|undefined;if(!row)throw new Error('缺少既有Google授權');tokens=new GoogleVault(config.dataDir).load<GoogleTokens>(row.credential_reference);}finally{real.close();}
  const vault=new GoogleVault(directory),reference=vault.save(tokens),client=loadGoogleClient(config.googleClientFile,config.port);if(!client)throw new Error('缺少Google設定');
  database.prepare("INSERT INTO google_connection VALUES(1,?,?,?,'CONNECTED')").run(tokens.account,JSON.stringify(tokens.scopes),reference);
  return{directory,path,database,identity,teacher,google:new GoogleService(database,identity,vault,new GoogleOAuthProvider(client)),activities:new ActivityService(database,identity),close:()=>{identity.shutdown();database.close();rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}};
 }catch(error){identity.shutdown();database.close();rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});throw error;}
}
