import type { SessionGrant,SessionView } from '../shared/session.js';
import { sessionKeys,tabNamePrefix } from '../shared/session.js';
import { normalizeNickname,randomEnglishNickname } from '../shared/validation.js';

type Credential={token:string;generation:number};
type State={status:'NEW'|'OWNED'|'DISCONNECTED';session:SessionView|null;message:string;nickname:string;busy:boolean};
export class ApiFailure extends Error {constructor(readonly code:string,message:string,readonly fieldIds:string[]=[]){super(message);}}
export class TabSession {
  readonly instanceId=crypto.randomUUID();
  private credential:Credential|null=null;
  private secret:string;
  private state:State;
  private listeners=new Set<()=>void>();
  private initializing:Promise<void>|undefined;
  private resumePromise:Promise<void>|undefined;
  constructor(){
    let copied=false;
    if(!new RegExp('^'+tabNamePrefix+'[0-9a-f]{64}$','u').test(window.name)){
      copied=!!sessionStorage.getItem(sessionKeys.credential);this.clearPrivateStorage();
      window.name=tabNamePrefix+Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
    }
    this.secret=window.name.slice(tabNamePrefix.length);
    try{
      const saved=JSON.parse(sessionStorage.getItem(sessionKeys.credential)||'null');
      if(saved&&typeof saved==='object'&&/^[0-9a-f]{64}$/u.test(saved.token)&&Number.isSafeInteger(saved.generation)&&saved.generation>=1)this.credential=saved;
      else this.clearPrivateStorage();
    }catch{this.clearPrivateStorage();}
    const nickname=sessionStorage.getItem(sessionKeys.nickname)||randomEnglishNickname();sessionStorage.setItem(sessionKeys.nickname,nickname);
    this.state={status:'NEW',session:null,message:copied?'這是新的分頁，請重新登入或選組。':'',nickname,busy:false};
  }
  private clearPrivateStorage(){
    sessionStorage.removeItem(sessionKeys.credential);
    for(const key of Object.keys(sessionStorage))if(key.startsWith(sessionKeys.draftPrefix))sessionStorage.removeItem(key);
  }
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  snapshot=()=>this.state;
  private update(patch:Partial<State>){this.state={...this.state,...patch};for(const listener of this.listeners)listener();}
  headers(){return{'X-Tab-Proof':this.secret,'X-Document-Instance':this.instanceId,'X-Session-Generation':String(this.credential?.generation??0),
    ...(this.credential?{Authorization:'Bearer '+this.credential.token}:{})};}
  private invalid(message:string){this.clearPrivateStorage();this.credential=null;this.update({status:'NEW',session:null,message});}
  private save(grant:SessionGrant){this.credential={token:grant.token,generation:grant.generation};sessionStorage.setItem(sessionKeys.credential,JSON.stringify(this.credential));this.update({status:'OWNED',session:grant.session,message:''});}
  async request<T>(path:string,method='GET',body?:unknown,handleFailure=true,signal?:AbortSignal):Promise<T>{
    const requestToken=this.credential?.token;
    let response:Response;
    try{response=await fetch(path,{method,signal,headers:{...this.headers(),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});}
    catch{if(!signal?.aborted&&this.credential&&this.credential.token===requestToken)this.update({status:'DISCONNECTED',message:'連線中斷，正在嘗試恢復身分。'});throw new ApiFailure('NETWORK','暫時無法連接本機服務。');}
    let value;
    try{value=await response.json();}
    catch{throw new ApiFailure('INVALID_RESPONSE','服務回覆不完整，請稍候再試。');}
    if(!value||typeof value!=='object'||typeof value.ok!=='boolean')throw new ApiFailure('INVALID_RESPONSE','服務回覆不完整，請稍候再試。');
    if(!response.ok||value.ok!==true){
      const code=String(value.error?.code??'INTERNAL_ERROR'),message=String(value.error?.message??'暫時無法完成操作。');
      if(handleFailure&&this.credential?.token===requestToken){
        if(['SESSION_EXPIRED','SESSION_REVOKED','SESSION_ACTIVITY_CHANGED','SESSION_DISCONNECTED','SESSION_PASSWORD_CHANGED','UNAUTHORIZED','ACTIVITY_CHANGED'].includes(code))this.invalid(message);
        else if(code==='RECOVERY_UNCERTAIN'&&this.credential)this.update({status:'DISCONNECTED',message});
      }
      throw new ApiFailure(code,message,Array.isArray(value.error?.fieldIds)?value.error.fieldIds.filter((id:unknown):id is string=>typeof id==='string'):[]);
    }
    return value.data as T;
  }
  initialize(){return this.initializing??=this.restore();}
  restore(){return this.resumePromise??=this.restoreOnce().finally(()=>{this.resumePromise=undefined;});}
  private async restoreOnce(){
    if(!this.credential)return;
    const original=this.credential;
    try{
      let data:{generation:number;session:SessionView};
      try{data=await this.request('/api/session/resume','POST',{},false);}
      catch(error){
        if(!(error instanceof ApiFailure)||error.code!=='STALE_DOCUMENT')throw error;
        const current=await this.request<{generation:number}>('/api/session/ownership','GET',undefined,false);
        if(this.credential!==original)return;
        this.credential.generation=current.generation;data=await this.request('/api/session/resume','POST',{},false);
      }
      if(this.credential===original)this.save({...data,token:original.token});
    }catch(error){
      if(this.credential!==original)return;
      if(error instanceof ApiFailure&&['UNAUTHORIZED','SESSION_EXPIRED','SESSION_REVOKED','SESSION_PASSWORD_CHANGED','SESSION_ACTIVITY_CHANGED','SESSION_DISCONNECTED'].includes(error.code))this.invalid(error.message);
      else this.update({status:'DISCONNECTED',message:error instanceof Error?error.message:'正在嘗試恢復連線。'});
    }
  }
  async refresh(){
    if(!this.credential)return;
    const token=this.credential.token;
    if(this.state.status==='DISCONNECTED'){await this.restore();return;}
    try{const session=await this.request<SessionView>('/api/session');if(this.credential?.token===token)this.update({session,status:'OWNED'});}
    catch(error){if(this.credential?.token===token&&error instanceof ApiFailure&&error.code==='STALE_DOCUMENT')await this.restore();}
  }
  setNickname(value:string){
    if(this.state.session?.role==='STUDENT')throw new ApiFailure('FORBIDDEN','請先在待開始時離開組別，再修改暱稱。');
    sessionStorage.setItem(sessionKeys.nickname,value);this.update({nickname:value});
  }
  randomizeNickname(){this.setNickname(randomEnglishNickname());}
  private async action(work:()=>Promise<void>){
    if(this.state.busy)return;this.update({busy:true,message:''});
    try{await work();}catch(error){this.update({message:error instanceof Error?error.message:'暫時無法完成操作。'});throw error;}
    finally{this.update({busy:false});}
  }
  login(password:string){return this.action(async()=>this.save(await this.request<SessionGrant>('/api/teacher/login','POST',{password})));}
  join(activityId:string,groupId:string){return this.action(async()=>{
    const nickname=normalizeNickname(this.state.nickname);this.setNickname(nickname);
    this.save(await this.request<SessionGrant>(`/api/activities/${encodeURIComponent(activityId)}/join`,'POST',{groupId,nickname}));
  });}
  logout(){return this.action(async()=>{await this.request('/api/session/logout','POST',{});this.invalid('已登出這個老師分頁。');});}
  changeActivity(activityId:string,expectedVersion:number,action:'start'|'end'){
    return this.action(async()=>{await this.request(`/api/activities/${encodeURIComponent(activityId)}/${action}`,'POST',{expectedVersion,...(action==='end'?{confirmed:true}:{})});});
  }
  leave(){return this.action(async()=>{
    const id=this.state.session?.activityId;if(!id)throw new ApiFailure('UNAUTHORIZED','請先加入活動。');
    await this.request(`/api/activities/${encodeURIComponent(id)}/leave`,'POST',{});this.invalid('已離開組別，可以修改暱稱或重新選組。');
  });}
}
export const tabSession=new TabSession();
