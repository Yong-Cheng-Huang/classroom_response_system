import {JWT,type Credentials} from 'google-auth-library';
import type {ServiceAccountConfig} from './service-account-config.js';
import type {IdentityService} from './identity.js';
import type {TabProof} from '../shared/session.js';
import {AppError,ExportWriteRejected} from '../shared/errors.js';
export const sheetsScope='https://www.googleapis.com/auth/spreadsheets';
export function createServiceJwt(config:ServiceAccountConfig){
 const jwt=new JWT({email:config.email,key:config.privateKey,scopes:[sheetsScope],transporterOptions:{timeout:15000,retry:false,maxRedirects:0}});
 jwt.transporter.interceptors.request.add({resolved:async request=>{
  if(String(request.url)!=='https://oauth2.googleapis.com/token')throw new AppError('SERVICE_ACCOUNT_INVALID');
  request.timeout=15000;request.retry=false;request.maxRedirects=0;return request;
 }});return jwt;
}
export class ServiceAccountTokens {
 private cached:{token:string;expiresAt:number}|undefined;
 private refreshing:Promise<string>|undefined;
 private readonly authorize:()=>Promise<Credentials>;
 constructor(private readonly config:ServiceAccountConfig|null,private readonly now:()=>number=Date.now,authorize?:()=>Promise<Credentials>){
  this.authorize=authorize??(()=>createServiceJwt(config!).authorize());
 }
 invalidate(){this.cached=undefined;}
 get accountId(){return this.config?.email??null;}
 get configured(){return !!this.config;}
 async token(){
  if(!this.configured)throw new AppError('SERVICE_ACCOUNT_NOT_CONFIGURED');
  if(this.cached&&this.cached.expiresAt>this.now()+60000)return this.cached.token;
  if(this.refreshing)return this.refreshing;
  const pending=(async()=>{try{const result=await this.authorize();if(!result.access_token||!Number.isFinite(result.expiry_date)||result.expiry_date!<=this.now()+60000)throw new Error();this.cached={token:result.access_token,expiresAt:result.expiry_date!};return result.access_token;}catch{this.cached=undefined;throw new AppError('SERVICE_ACCOUNT_INVALID');}})();
  this.refreshing=pending;try{return await pending;}finally{if(this.refreshing===pending)this.refreshing=undefined;}
 }
}
export interface SheetsGateway {
 readonly configured:boolean;readonly accountId:string|null;
 assertConfigured():void;
 status(proof:TabProof):{configured:boolean;accountEmail:string|null};
 spreadsheet(proof:TabProof,id:string,params:Record<string,string>):Promise<unknown>;
 batchUpdate(proof:TabProof,id:string,requests:unknown[]):Promise<void>;
}
export class ServiceAccountSheets implements SheetsGateway {
 constructor(private readonly identity:IdentityService,private readonly tokens:ServiceAccountTokens,private readonly transport:typeof fetch=fetch){}
 get configured(){return this.tokens.configured;}
 get accountId(){return this.tokens.accountId;}
 assertConfigured(){if(!this.configured)throw new AppError('SERVICE_ACCOUNT_NOT_CONFIGURED');}
 private teacher(proof:TabProof){if(this.identity.principal(proof).role!=='TEACHER')throw new AppError('FORBIDDEN');}
 status(proof:TabProof){this.teacher(proof);return{configured:this.configured,accountEmail:this.accountId};}
 private url(id:string){if(!/^[A-Za-z0-9_-]+$/u.test(id))throw new AppError('INVALID_SHEETS_URL');return new URL('https://sheets.googleapis.com/v4/spreadsheets/'+id);}
 async spreadsheet(proof:TabProof,id:string,params:Record<string,string>):Promise<unknown>{
  this.teacher(proof);const url=this.url(id);for(const [key,value]of Object.entries(params)){if(!['fields','ranges','includeGridData'].includes(key))throw new AppError('INVALID_REQUEST');url.searchParams.set(key,value);}
  const token=await this.tokens.token();this.teacher(proof);let response:Response;
  try{response=await this.transport(url,{method:'GET',headers:{Authorization:'Bearer '+token},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new AppError('EXTERNAL_UNAVAILABLE');}
  this.teacher(proof);if(response.status===401){this.tokens.invalidate();throw new AppError('SERVICE_ACCOUNT_INVALID');}if(response.status===403)throw new AppError('SERVICE_ACCOUNT_FORBIDDEN');if(response.status===404)throw new AppError('GOOGLE_DOCUMENT_NOT_FOUND');if(!response.ok)throw new AppError('EXTERNAL_UNAVAILABLE');
  let data:unknown;try{data=await response.json();}catch{throw new AppError('EXTERNAL_UNAVAILABLE');}this.teacher(proof);return data;
 }
 async batchUpdate(proof:TabProof,id:string,requests:unknown[]){
  let token:string,url:URL;
  try{this.teacher(proof);url=this.url(id);url.pathname+=':batchUpdate';token=await this.tokens.token();this.teacher(proof);}catch(error){throw new ExportWriteRejected(error instanceof AppError?error.code:'EXTERNAL_UNAVAILABLE');}
  let response:Response;try{response=await this.transport(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({requests}),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new AppError('EXTERNAL_UNAVAILABLE');}
  if(response.status===401)this.tokens.invalidate();
  if(response.status>=400&&response.status<500)throw new ExportWriteRejected(response.status===401?'SERVICE_ACCOUNT_INVALID':response.status===403?'SERVICE_ACCOUNT_WRITE_FORBIDDEN':'EXPORT_WRITE_REJECTED');
  if(!response.ok)throw new AppError('EXTERNAL_UNAVAILABLE');let raw:unknown;try{raw=await response.json();}catch{throw new AppError('EXTERNAL_UNAVAILABLE');}
  if(!raw||typeof raw!=='object'||Reflect.get(raw,'spreadsheetId')!==id)throw new AppError('EXTERNAL_UNAVAILABLE');this.teacher(proof);
 }
}
