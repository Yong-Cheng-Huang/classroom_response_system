import { useEffect,useMemo,useRef,useState,useSyncExternalStore } from 'react';
import type { TeacherView } from '../shared/views.js';
import { serverClock } from './clock.js';
import { tabSession } from './session.js';
import { TeacherQuestions } from './teacher.js';

export function ActivityTimer({startedAt,endedAt,serverNow}:{startedAt:number|null;endedAt:number|null;serverNow:number}){
  const sample=useMemo(()=>({at:performance.now(),serverNow}),[serverNow]);
  useSyncExternalStore(serverClock.subscribe,serverClock.snapshot);
  const [,redraw]=useState(0);
  useEffect(()=>{if(startedAt===null||endedAt!==null)return;const timer=setInterval(()=>redraw(n=>n+1),250);return()=>clearInterval(timer);},[startedAt,endedAt]);
  const elapsed=startedAt===null?0:Math.max(0,(endedAt??serverClock.now(sample.serverNow+performance.now()-sample.at))-startedAt);
  const seconds=Math.floor(elapsed/1000);
  const formatted=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
  return <p className="activity-timer"><span>{endedAt===null?'搶答計時':'總時長'}</span><time aria-label="搶答計時" data-elapsed-ms={Math.round(elapsed)}>{formatted}</time></p>;
}

export function TeacherActivity({view,act}:{view:TeacherView;act:(work:()=>Promise<void>)=>void}){
  const [confirm,setConfirm]=useState<{activityId:string;version:number}|null>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  const busy=tabSession.snapshot().busy;
  useEffect(()=>{if(confirm&&!dialog.current?.open)dialog.current?.showModal();if(!confirm&&dialog.current?.open)dialog.current.close();},[confirm]);
  useEffect(()=>{if(confirm&&(view.phase!=='RUNNING'||confirm.activityId!==view.activityId||confirm.version!==view.version))setConfirm(null);},[view.phase,view.activityId,view.version,confirm]);
  return <div className="empty-state teacher-activity">
    <div className="activity-heading"><h3>{view.phase==='READY'?'待開始':view.phase==='RUNNING'?'搶答進行中':'已結束'}</h3><span className="hint">{view.questions.length} 題 · {view.groups.length} 組</span></div>
    <ActivityTimer startedAt={view.startedAt} endedAt={view.endedAt} serverNow={view.serverNow}/>
    {view.phase==='READY'&&<><p>開始後，所有題目會同時開放給已加入的學生。</p><button className="primary" disabled={busy} onClick={()=>act(()=>tabSession.changeActivity(view.activityId,view.version,'start'))}>開始搶答</button></>}
    {view.phase==='RUNNING'&&<button className="secondary" disabled={busy} onClick={()=>setConfirm({activityId:view.activityId,version:view.version})}>結束活動</button>}
    {view.phase==='ENDED'&&<p>本場活動已結束。重新匯入文件才能建立新活動。</p>}
    <dialog ref={dialog} aria-labelledby="end-confirm-title" onCancel={event=>{event.preventDefault();setConfirm(null);}} onClose={()=>setConfirm(null)}>
      <h3 id="end-confirm-title">確認結束本場活動？</h3><p>結束後停止接受新作答，保留目前結果；本場活動將無法重新開啟。</p>
      <div className="dialog-actions"><button autoFocus className="secondary" onClick={()=>setConfirm(null)}>取消</button><button className="primary" disabled={busy||view.phase!=='RUNNING'} onClick={()=>{
        const pending=confirm;if(!pending)return;setConfirm(null);act(()=>tabSession.changeActivity(pending.activityId,pending.version,'end'));
      }}>確認結束</button></div>
    </dialog>
    <TeacherQuestions view={view}/>
  </div>;
}
