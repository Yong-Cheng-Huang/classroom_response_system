import {useEffect,useState} from 'react';
import {ApiFailure,tabSession} from './session.js';
type Status={configured:boolean;accountEmail:string|null};
export function SheetsConnection({onReady}:{onReady?:(ready:boolean)=>void}){
 const [status,setStatus]=useState<Status|null>(null),[message,setMessage]=useState('');
 useEffect(()=>{let active=true;const load=async()=>{try{const value=await tabSession.request<Status>('/api/sheets/status');if(active){setStatus(value);onReady?.(value.configured);}}catch(error){if(active){onReady?.(false);setMessage(error instanceof ApiFailure?error.message:'暫時無法讀取學習單存取設定。');}}};void load();const timer=setInterval(()=>{void load();},2000);return()=>{active=false;clearInterval(timer);};},[]);
 return <section className="empty-state" aria-label="學習單存取設定"><h3>學習單存取設定</h3>{status?.configured&&status.accountEmail?<><p>服務帳戶：<span>{status.accountEmail}</span></p><button className="secondary" onClick={()=>{void navigator.clipboard.writeText(status.accountEmail!).then(()=>setMessage('已複製服務帳戶Email。')).catch(()=>setMessage('請選取上方Email後複製。'));}}>複製服務帳戶Email</button><p className="hint">請將原始試算表共用給此Email。匯入可給檢視者，寫回需給編輯者；私有文件不必公開。</p></>:<p>服務帳戶尚未配置。請管理者依服務帳戶設定指南配置；公開匯入及CSV仍可獨立使用。</p>}{message&&<p className="notice" role="alert">{message}</p>}</section>;
}
