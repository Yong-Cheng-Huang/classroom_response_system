import { useEffect,useRef,useState,useSyncExternalStore } from 'react';
import type { ActivityPhase } from '../shared/contracts.js';
import { ApiFailure,tabSession } from './session.js';

export function ExportSubmissionCsv({activityId,phase}:{activityId:string|null;phase:ActivityPhase}){
  const identity=useSyncExternalStore(tabSession.subscribe,tabSession.snapshot);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const working=useRef<AbortController|null>(null),urls=useRef(new Set<string>());
  const scope=useRef({activityId,phase});scope.current={activityId,phase};
  useEffect(()=>{
    setMessage('');setBusy(false);
    return()=>{working.current?.abort();working.current=null;for(const url of urls.current)URL.revokeObjectURL(url);urls.current.clear();};
  },[activityId,phase,identity.status,identity.session?.role,identity.session?.createdAt]);
  const enabled=!!activityId&&phase==='ENDED'&&identity.status==='OWNED'&&identity.session?.role==='TEACHER';
  async function download(){
    if(!enabled||!activityId||working.current)return;
    const controller=new AbortController(),target=activityId;working.current=controller;setBusy(true);setMessage('');
    try{
      const file=await tabSession.download(`/api/activities/${encodeURIComponent(target)}/submissions.csv`,controller.signal);
      const current=tabSession.snapshot();
      if(controller.signal.aborted||scope.current.activityId!==target||scope.current.phase!=='ENDED'||current.status!=='OWNED'||current.session?.role!=='TEACHER')return;
      const url=URL.createObjectURL(file);urls.current.add(url);const link=document.createElement('a');link.href=url;link.download=`classroom-submissions-${target}.csv`;document.body.append(link);
      try{link.click();}finally{link.remove();setTimeout(()=>{if(urls.current.delete(url))URL.revokeObjectURL(url);},0);}
      setMessage('CSV 下載已開始。');
    }catch(error){if(!controller.signal.aborted)setMessage(error instanceof ApiFailure?error.message:'暫時無法下載 CSV，請稍候重試。');}
    finally{if(working.current===controller){working.current=null;setBusy(false);}}
  }
  return <div className="empty-state" aria-label="匯出 CSV"><h3>匯出 CSV</h3>
    <p>下載所有組別已送出的答案，含未搶到紀錄，可用 Excel 開啟。</p>
    <p className="hint">題組每個子題一列，姓名為送出者暱稱。{phase!=='ENDED'?'活動結束後才能下載。':'不需要連結 Google；沒有送出紀錄時只下載表頭。'}</p>
    <button className="secondary" disabled={!enabled||busy} onClick={()=>{void download();}}>{busy?'正在準備 CSV…':'下載送出紀錄 CSV'}</button>
    {message&&<p className="notice" role="alert">{message}</p>}
  </div>;
}
