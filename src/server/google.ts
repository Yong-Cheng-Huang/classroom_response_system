import { createHash,randomBytes } from 'node:crypto';
import { readFileSync,existsSync,chmodSync,realpathSync } from 'node:fs';
import { resolve,sep } from 'node:path';
import { OAuth2Client,CodeChallengeMethod,type Credentials } from 'google-auth-library';
import type { SqliteDatabase } from './database.js';
import type { IdentityService } from './identity.js';
import type { TabProof } from '../shared/session.js';
import { ExportWriteRejected, AppError } from '../shared/errors.js';
import { GoogleVault } from './google-vault.js';
import { projectRoot } from './config.js';

export const googleScopes=['https://www.googleapis.com/auth/spreadsheets','openid','email'];
export type GoogleClientConfig={clientId:string;clientSecret:string;redirectUri:string};
export type GoogleTokens={accessToken:string;refreshToken:string;expiresAt:number;scopes:string[];account:string};
export interface GoogleProvider {
  authorization(state:string,challenge:string):string;
  exchange(code:string,verifier:string):Promise<GoogleTokens>;
  refresh(tokens:GoogleTokens):Promise<GoogleTokens>;
}
export function loadGoogleClient(path:string,port:number):GoogleClientConfig|null{
  if(!existsSync(path))return null;
  try{
    const actual=realpathSync(path);
    for(const area of ['src','dist','node_modules']){
      const blocked=resolve(projectRoot,area);if(actual===blocked||actual.startsWith(blocked+sep))throw new Error();
    }
    const c=JSON.parse(readFileSync(actual,'utf8')).web;
    const redirectUri=`http://127.0.0.1:${port}/api/google/callback`;
    if(!c||typeof c.client_id!=='string'||!c.client_id||typeof c.client_secret!=='string'||!c.client_secret||!Array.isArray(c.redirect_uris)||!c.redirect_uris.includes(redirectUri))throw new Error();
    chmodSync(actual,0o600);return{clientId:c.client_id,clientSecret:c.client_secret,redirectUri};
  }catch{throw new AppError('GOOGLE_CONFIGURATION_INVALID');}
}
function validateTokens(tokens:GoogleTokens){
  if(!tokens||typeof tokens.accessToken!=='string'||!tokens.accessToken||typeof tokens.refreshToken!=='string'||!tokens.refreshToken||!Number.isSafeInteger(tokens.expiresAt)||tokens.expiresAt<=0
    ||typeof tokens.account!=='string'||!tokens.account||!Array.isArray(tokens.scopes)||!tokens.scopes.includes(googleScopes[0]!))throw new AppError('GOOGLE_REAUTHORIZE');
  return tokens;
}
export class GoogleOAuthProvider implements GoogleProvider {
  constructor(private readonly config:GoogleClientConfig){}
  private client(){return new OAuth2Client({clientId:this.config.clientId,clientSecret:this.config.clientSecret,redirectUri:this.config.redirectUri,transporterOptions:{timeout:15000}});}
  authorization(state:string,challenge:string){return this.client().generateAuthUrl({access_type:'offline',prompt:'consent',scope:googleScopes,state,
    code_challenge:challenge,code_challenge_method:CodeChallengeMethod.S256});}
  private tokens(c:Credentials,prior?:GoogleTokens,account=prior?.account??''):GoogleTokens{
    return validateTokens({accessToken:c.access_token??'',refreshToken:c.refresh_token??prior?.refreshToken??'',expiresAt:c.expiry_date??0,
      scopes:c.scope?.split(/\s+/u)??prior?.scopes??[],account});
  }
  async exchange(code:string,verifier:string){
    const client=this.client();
    const {tokens}=await client.getToken({code,codeVerifier:verifier,redirect_uri:this.config.redirectUri});
    if(!tokens.access_token)throw new AppError('GOOGLE_REAUTHORIZE');
    if(!tokens.scope){const info=await client.getTokenInfo(tokens.access_token);tokens.scope=info.scopes.join(' ');tokens.expiry_date??=info.expiry_date;}
    if(!tokens.id_token)throw new AppError('GOOGLE_REAUTHORIZE');
    const ticket=await client.verifyIdToken({idToken:tokens.id_token,audience:this.config.clientId});
    const account=ticket.getPayload();if(!account?.sub)throw new AppError('GOOGLE_REAUTHORIZE');
    return this.tokens(tokens,undefined,account.email_verified&&account.email?account.email:account.sub);
  }
  async refresh(prior:GoogleTokens){
    const client=this.client();client.setCredentials({refresh_token:prior.refreshToken});
    const {credentials}=await client.refreshAccessToken();return this.tokens(credentials,prior);
  }
}
type Connection={account_label:string;scopes_json:string;credential_reference:string;state:'CONNECTED'|'REAUTHORIZE'};
type Intent={sessionId:string;verifier:string;expiresAt:number;epoch:number;reference:string|null};
type Ordered=<T>(work:()=>T)=>Promise<T>;
export class GoogleService {
  private pending=new Map<string,Intent>();
  private epoch=0;
  private refreshing:{reference:string;promise:Promise<string>}|undefined;
  constructor(private readonly database:SqliteDatabase,private readonly identity:IdentityService,private readonly vault:GoogleVault,
    private readonly provider:GoogleProvider|null,private readonly now:()=>number=Date.now){}
  private connection(){return this.database.prepare('SELECT * FROM google_connection WHERE id=1').get() as Connection|undefined;}
  revision(){return this.epoch;}
  assertRevision(revision:number){if(revision!==this.epoch||this.connection()?.state!=='CONNECTED')throw new AppError('GOOGLE_REAUTHORIZE');}
  async spreadsheet(proof:TabProof,id:string,params:Record<string,string>,transport:typeof fetch=fetch):Promise<unknown>{
    if(!/^[A-Za-z0-9_-]+$/u.test(id))throw new AppError('INVALID_SHEETS_URL');
    const revision=this.epoch,token=await this.accessToken(proof);this.teacher(proof);this.assertRevision(revision);
    const reference=this.connection()!.credential_reference;
    const url=new URL('https://sheets.googleapis.com/v4/spreadsheets/'+id);for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);
    let response:Response;
    try{response=await transport(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});}catch{throw new AppError('EXTERNAL_UNAVAILABLE');}
    this.teacher(proof);this.assertRevision(revision);
    if(response.status===401){this.database.prepare("UPDATE google_connection SET state='REAUTHORIZE' WHERE credential_reference=?").run(reference);throw new AppError('GOOGLE_REAUTHORIZE');}
    if(response.status===403)throw new AppError('GOOGLE_DOCUMENT_FORBIDDEN');
    if(response.status===404)throw new AppError('GOOGLE_DOCUMENT_NOT_FOUND');
    if(!response.ok)throw new AppError('EXTERNAL_UNAVAILABLE');
    let data:unknown;try{data=await response.json();}catch{throw new AppError('EXTERNAL_UNAVAILABLE');}
    this.teacher(proof);this.assertRevision(revision);return data;
  }
  async batchUpdate(proof:TabProof,id:string,requests:unknown[],transport:typeof fetch=fetch){
    let token:string,revision:number,reference:string;
    try{revision=this.epoch;token=await this.accessToken(proof);this.teacher(proof);this.assertRevision(revision);reference=this.connection()!.credential_reference;if(!/^[A-Za-z0-9_-]+$/u.test(id))throw new AppError('INVALID_SHEETS_URL');}
    catch(error){throw new ExportWriteRejected(error instanceof AppError?error.code:'EXTERNAL_UNAVAILABLE');}
    let response:Response;
    try{response=await transport('https://sheets.googleapis.com/v4/spreadsheets/'+id+':batchUpdate',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({requests}),signal:AbortSignal.timeout(20000)});}
    catch{throw new AppError('EXTERNAL_UNAVAILABLE');} // 已送出：不得把逾時當成未寫入。
    if(response.status>=400&&response.status<500){
      if(response.status===401)this.database.prepare("UPDATE google_connection SET state='REAUTHORIZE' WHERE credential_reference=?").run(reference);
      throw new ExportWriteRejected(response.status===401?'GOOGLE_REAUTHORIZE':response.status===403?'GOOGLE_DOCUMENT_WRITE_FORBIDDEN':'EXPORT_WRITE_REJECTED');
    }
    if(!response.ok)throw new AppError('EXTERNAL_UNAVAILABLE');
    let result:unknown;try{result=await response.json();}catch{throw new AppError('EXTERNAL_UNAVAILABLE');}
    if((result as {spreadsheetId?:string})?.spreadsheetId!==id)throw new AppError('EXTERNAL_UNAVAILABLE');
    this.teacher(proof);this.assertRevision(revision);
  }
  private teacher(proof:TabProof){const actor=this.identity.principal(proof);if(actor.role!=='TEACHER')throw new AppError('FORBIDDEN');return actor;}
  status(proof:TabProof){
    this.teacher(proof);const row=this.connection();
    return{configured:!!this.provider,state:row?.state??'DISCONNECTED',account:row?.account_label??null};
  }
  begin(proof:TabProof){
    const actor=this.teacher(proof);if(!this.provider)throw new AppError('GOOGLE_NOT_CONFIGURED');
    for(const [key,intent] of this.pending)if(intent.expiresAt<=this.now())this.pending.delete(key);
    const state=randomBytes(32).toString('hex'),verifier=randomBytes(32).toString('base64url');
    this.pending.set(this.hash(state),{sessionId:actor.sessionId,verifier,expiresAt:Math.min(actor.expiresAt,this.now()+600000),epoch:this.epoch,reference:this.connection()?.credential_reference??null});
    return{authorizationUrl:this.provider.authorization(state,createHash('sha256').update(verifier).digest('base64url'))};
  }
  private hash(value:string){return createHash('sha256').update(value).digest('hex');}
  private eligible(intent:Intent){
    if(intent.expiresAt<=this.now()||intent.epoch!==this.epoch||(this.connection()?.credential_reference??null)!==intent.reference)throw new AppError('OAUTH_STATE_INVALID');
    const row=this.database.prepare(`SELECT s.id FROM sessions s JOIN identity_settings i ON i.id=1 WHERE s.id=? AND s.role='TEACHER'
      AND s.expires_at>? AND s.password_version=i.password_version AND (s.lifecycle='CONNECTED' OR(s.lifecycle='GRACE' AND s.grace_deadline>?))`).get(intent.sessionId,this.now(),this.now());
    if(!row)throw new AppError('OAUTH_STATE_INVALID');
  }
  async complete(state:string,code:string|null,denied:boolean,ordered:Ordered=async work=>work()){
    const intent=await ordered(()=>{
      if(!/^[0-9a-f]{64}$/u.test(state))throw new AppError('OAUTH_STATE_INVALID');
      const key=this.hash(state),intent=this.pending.get(key);this.pending.delete(key);
      if(!intent)throw new AppError('OAUTH_STATE_INVALID');this.eligible(intent);return intent;
    });
    if(denied)throw new AppError('GOOGLE_ACCESS_DENIED');
    if(!code||!this.provider)throw new AppError('OAUTH_STATE_INVALID');
    let tokens:GoogleTokens;
    try{tokens=validateTokens(await this.provider.exchange(code,intent.verifier));}
    catch(error){if(error instanceof AppError)throw error;throw new AppError('GOOGLE_AUTH_FAILED');}
    return ordered(()=>{
      this.eligible(intent);const reference=this.vault.save(tokens);
      try{this.database.prepare(`INSERT INTO google_connection VALUES(1,?,?,?,'CONNECTED')
        ON CONFLICT(id) DO UPDATE SET account_label=excluded.account_label,scopes_json=excluded.scopes_json,credential_reference=excluded.credential_reference,state='CONNECTED'`)
        .run(tokens.account,JSON.stringify(tokens.scopes),reference);}
      catch{this.vault.remove(reference);throw new AppError('DATABASE_UNAVAILABLE');}
      this.epoch++;this.pending.clear();if(intent.reference)this.vault.remove(intent.reference);
      return{connected:true};
    });
  }
  disconnect(proof:TabProof){
    this.teacher(proof);const row=this.connection();this.database.prepare('DELETE FROM google_connection WHERE id=1').run();
    this.epoch++;this.pending.clear();if(row)this.vault.remove(row.credential_reference);return{disconnected:true};
  }
  async accessToken(proof:TabProof){
    this.teacher(proof);const row=this.connection();
    if(!row||row.state!=='CONNECTED'||!this.provider)throw new AppError('GOOGLE_REAUTHORIZE');
    let tokens:GoogleTokens;
    try{tokens=validateTokens(this.vault.load<GoogleTokens>(row.credential_reference));}
    catch{this.database.prepare("UPDATE google_connection SET state='REAUTHORIZE' WHERE credential_reference=?").run(row.credential_reference);throw new AppError('GOOGLE_REAUTHORIZE');}
    if(tokens.expiresAt>this.now()+60000)return tokens.accessToken;
    if(this.refreshing?.reference===row.credential_reference){const token=await this.refreshing.promise;this.teacher(proof);return token;}
    const epoch=this.epoch;
    const promise=(async()=>{
      let fresh:GoogleTokens;
      try{fresh=validateTokens(await this.provider!.refresh(tokens));}
      catch(error){
        const invalid=(error as {response?:{data?:{error?:string}}})?.response?.data?.error==='invalid_grant'||error instanceof AppError;
        if(invalid)this.database.prepare("UPDATE google_connection SET state='REAUTHORIZE' WHERE credential_reference=?").run(row.credential_reference);
        throw new AppError(invalid?'GOOGLE_REAUTHORIZE':'EXTERNAL_UNAVAILABLE');
      }
      if(epoch!==this.epoch||this.connection()?.credential_reference!==row.credential_reference)throw new AppError('GOOGLE_REAUTHORIZE');
      const reference=this.vault.save(fresh);
      const changed=this.database.prepare('UPDATE google_connection SET credential_reference=?,scopes_json=? WHERE credential_reference=? AND state=\'CONNECTED\'').run(reference,JSON.stringify(fresh.scopes),row.credential_reference);
      if(changed.changes!==1){this.vault.remove(reference);throw new AppError('GOOGLE_REAUTHORIZE');}
      this.vault.remove(row.credential_reference);return fresh.accessToken;
    })();
    this.refreshing={reference:row.credential_reference,promise};
    try{const token=await promise;this.teacher(proof);return token;}finally{if(this.refreshing?.promise===promise)this.refreshing=undefined;}
  }
}
