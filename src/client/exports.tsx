import { useEffect,useRef,useState } from 'react';
import type { TeacherView } from '../shared/views.js';
import type { ExportMode,ExportState,ExportView } from '../shared/exports.js';
import { tabSession } from './session.js';
const modes:Record<ExportMode,string>={ANSWERS:'只有答案',COLUMNS:'答案＋組別時間欄',INLINE:'答案＋格內附註行'};
const states:Record<ExportState,string>={PREPARING:'準備中',WRITING:'寫入中',COMPLETED:'已完成',FAILED:'已失敗',UNCONFIRMED:'結果待確認'};
export function ExportGuidedNotes({view,serviceAccountReady,onAbandon}:{view:TeacherView;serviceAccountReady:boolean;onAbandon:(token:string)=>void}){
 const [mode,setMode]=useState<ExportMode>('ANSWERS'),[paused,setPaused]=useState(false),[operations,setOperations]=useState<ExportView[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState<ExportView|null>(null),[approved,setApproved]=useState(false);
 const [acknowledged,setAcknowledged]=useState<Record<string,boolean>>({});
 const requestId=useRef(crypto.randomUUID()),dialog=useRef<HTMLDialogElement>(null),live=useRef(false);
 const pending=operations.some(op=>['PREPARING','WRITING','UNCONFIRMED'].includes(op.state));
 async function load(){if(view.phase!=='ENDED')return;try{const data=await tabSession.request<ExportView[]>(`/api/activities/${encodeURIComponent(view.activityId)}/exports`);if(live.current)setOperations(data);}catch(error){if(live.current)setMessage(error instanceof Error?error.message:'暫時無法查詢匯出結果。');}}
 useEffect(()=>{live.current=true;void load();const timer=setInterval(()=>{void load();},1000);return()=>{live.current=false;clearInterval(timer);};},[view.activityId,view.phase]);
 useEffect(()=>{if(confirm&&!dialog.current?.open)dialog.current?.showModal();if(!confirm&&dialog.current?.open)dialog.current.close();},[confirm]);
 async function action(work:()=>Promise<void>){if(busy)return;setBusy(true);setMessage('');try{await work();}catch(error){if(live.current)setMessage(error instanceof Error?error.message:'暫時無法完成匯出操作，請先查詢結果。');}finally{if(live.current){setBusy(false);void load();}}}
 async function begin(){const result=await tabSession.request<ExportView>(`/api/activities/${encodeURIComponent(view.activityId)}/exports`,'POST',{accessMode:'SERVICE_ACCOUNT',requestId:requestId.current,mode,paused,expectedVersion:view.version});if(!live.current)return;setMessage(result.message);setPaused(false);requestId.current=crypto.randomUUID();await load();}
 async function abandon(){if(!confirm)return;const result=await tabSession.request<{abandonmentToken:string}>('/api/operations/'+confirm.id+'/abandon-confirmation','POST',{confirmed:true,expectedVersion:view.version});if(!live.current)return;onAbandon(result.abandonmentToken);setApproved(true);setConfirm(null);}
 return <section className="empty-state export-panel" aria-label="匯出 Guided Notes"><h3>匯出 Guided Notes</h3>
  {view.phase!=='ENDED'?<p>活動結束後才能匯出成功答案。</p>:<>
   <p className="hint">寫回本場匯入的原工作表。只有成功組的答案會寫入；本機結果及名次不變。</p>
   <label htmlFor="export-mode">匯出模式</label><select id="export-mode" value={mode} disabled={busy||pending} onChange={event=>{setMode(event.target.value as ExportMode);requestId.current=crypto.randomUUID();}}>{Object.entries(modes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
   <p className="notice">老師與協作者必須自預檢開始至匯出完成暫停編輯該工作表。系統無法強制鎖表，仍會執行完整變更檢查與整批寫入。</p>
   <label className="export-pause"><input type="checkbox" checked={paused} disabled={busy||pending} onChange={event=>setPaused(event.target.checked)}/>已確認老師與協作者暫停編輯此工作表</label>
   {!serviceAccountReady&&<p className="hint">請先配置服務帳戶，並將原始試算表共用給服務帳戶為編輯者。</p>}
   <button className="primary" disabled={busy||pending||!paused||!serviceAccountReady} onClick={()=>{void action(begin);}}>{busy?'正在處理…':'預檢並匯出'}</button>
   {busy&&<p className="hint">匯出處理中，請保持暫停外部編輯，直到完成核對。</p>}
   <ol className="export-operations" aria-label="本場匯出操作">{operations.map((op,index)=><li key={op.id} aria-label={`匯出操作 ${op.id}`}><p><strong>{modes[op.mode]} · {states[op.state]}</strong></p><p>{index===0&&!busy?op.message:states[op.state]}</p>
    {op.state==='PREPARING'&&<button className="secondary" onClick={()=>{void tabSession.request('/api/operations/'+op.id+'/cancel','POST',{}).then(()=>load()).catch(error=>setMessage(error instanceof Error?error.message:'暫時無法取消。'));}}>取消預檢</button>}
    {op.state==='UNCONFIRMED'&&<div className="export-recovery">{op.requiresCredentialConfirmation&&<label><input type="checkbox" checked={!!acknowledged[op.id+op.accountEmail]} onChange={e=>setAcknowledged(previous=>({...previous,[op.id+op.accountEmail]:e.target.checked}))}/>確認以目前服務帳戶 {op.accountEmail??'（尚未配置）'} 只讀核對，不重新送出寫入</label>}<button className="secondary" disabled={busy||(op.requiresCredentialConfirmation&&!acknowledged[op.id+op.accountEmail])} onClick={()=>{void action(async()=>{const result=await tabSession.request<ExportView>('/api/operations/'+op.id+'/reconcile','POST',{...(op.requiresCredentialConfirmation?{acknowledgeCredentialChange:true}:{})});setMessage(result.message);});}}>再次核對</button><button className="link-button" disabled={busy} onClick={()=>setConfirm(op)}>放棄核對以建立新活動</button></div>}
   </li>)}</ol>
   {approved&&<p className="notice">本分頁已確認放棄核對，請在下方匯入新活動。原表可能已修改，沒有回滾；新活動完整建立成功才清除舊結果，未核實範圍仍受保護。</p>}
  </>}
  {message&&<p className="notice" role="alert">{message}</p>}
  <dialog ref={dialog} aria-labelledby="abandon-export-title" onCancel={event=>{event.preventDefault();setConfirm(null);}} onClose={()=>setConfirm(null)}><h3 id="abandon-export-title">確認放棄核對舊匯出？</h3><p>原始工作表可能已被修改，系統不會自動回滾。只有新活動完整匯入成功才清除舊結果；舊文件的未核實範圍將保留保護，不會自動覆寫或清除。</p><p>取消或新匯入失敗都會保留原活動與核對資料。</p><div className="dialog-actions"><button autoFocus className="secondary" onClick={()=>setConfirm(null)}>取消</button><button className="primary" disabled={busy} onClick={()=>{void action(abandon);}}>確認放棄核對</button></div></dialog>
 </section>;
}
