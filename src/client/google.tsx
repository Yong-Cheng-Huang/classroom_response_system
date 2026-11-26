import { useEffect,useState } from 'react';
import { ApiFailure,tabSession } from './session.js';

type Status={configured:boolean;state:'CONNECTED'|'REAUTHORIZE'|'DISCONNECTED';account:string|null};
export function GoogleConnection({onReady}:{onReady?:(ready:boolean)=>void}){
  const [status,setStatus]=useState<Status|null>(null),[message,setMessage]=useState(''),[authorizationUrl,setAuthorizationUrl]=useState(''),[busy,setBusy]=useState(false);
  async function load(){
    try{const next=await tabSession.request<Status>('/api/google/status');setStatus(next);onReady?.(next.configured&&next.state==='CONNECTED');if(next.state==='CONNECTED')setAuthorizationUrl('');}
    catch(error){if(error instanceof ApiFailure)setMessage(error.message);}
  }
  useEffect(()=>{void load();const timer=setInterval(()=>{void load();},2000);return()=>clearInterval(timer);},[]);
  async function connect(){
    setBusy(true);setMessage('');setAuthorizationUrl('');
    try{const result=await tabSession.request<{authorizationUrl:string}>('/api/google/connect','POST',{});setAuthorizationUrl(result.authorizationUrl);}
    catch(error){setMessage(error instanceof ApiFailure?error.message:'暫時無法啟動 Google 授權。');}finally{setBusy(false);}
  }
  async function disconnect(){
    setBusy(true);setMessage('');
    try{await tabSession.request('/api/google/connection','DELETE',{});setAuthorizationUrl('');await load();}
    catch(error){setMessage(error instanceof ApiFailure?error.message:'暫時無法解除 Google 連結。');}finally{setBusy(false);}
  }
  return <div className="empty-state google-connection" aria-label="Google 連結管理"><h3>Google 文件連結</h3>
    {status?.state==='CONNECTED'?<><p>已連結：<span>{status.account}</span></p><button className="secondary" disabled={busy} onClick={()=>{void disconnect();}}>解除本機連結</button></>:
    <><p>{status?.state==='REAUTHORIZE'?'請重新授權 Google，原活動資料已保留。':status?.configured?'連結老師的 Google 帳號，供學習單匯入及結果寫回使用。':'尚未完成 Google OAuth 設定。'}</p><button className="secondary" disabled={busy||!status?.configured} onClick={()=>{void connect();}}>連結 Google</button></>}
    {authorizationUrl&&<p><a className="google-authorize" href={authorizationUrl} target="_blank" rel="noopener noreferrer">前往 Google 授權（另開分頁）</a><span className="hint">授權後返回此老師分頁。</span></p>}
    {message&&<p className="notice" role="alert">{message}</p>}
  </div>;
}
