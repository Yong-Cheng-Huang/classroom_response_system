import { useRef,useState } from 'react';
import { ApiFailure,tabSession } from './session.js';
import type { ImportView } from '../shared/imports.js';
import type { ActivityPhase } from '../shared/contracts.js';

export function ImportGuidedNotes({phase,googleReady,onImported,abandonmentToken}:{abandonmentToken?:string;phase:ActivityPhase|undefined;googleReady:boolean;onImported:()=>void}){
  const [url,setUrl]=useState(''),[groups,setGroups]=useState('2'),[preview,setPreview]=useState<ImportView|null>(null),[sheetId,setSheetId]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const working=useRef(false);
  const blocked=phase==='RUNNING'||!googleReady;
  async function action(work:()=>Promise<void>){if(working.current)return;working.current=true;setBusy(true);setMessage('');try{await work();}catch(error){setMessage(error instanceof ApiFailure?error.message:'匯入暫時無法完成，原活動仍保留。');}finally{working.current=false;setBusy(false);}}
  async function inspect(){if(!Number.isInteger(Number(groups))||Number(groups)<2||Number(groups)>20)throw new ApiFailure('INVALID_GROUP_COUNT','組數必須是 2～20 的整數。');if(!url.trim())throw new ApiFailure('INVALID_REQUEST','請填寫 Google Sheets 網址。');setPreview(await tabSession.request<ImportView>('/api/imports/inspect','POST',{url,groupCount:Number(groups),...(abandonmentToken?{abandonmentToken}:{})}));setSheetId('');}
  async function select(){if(!preview)return;setPreview(await tabSession.request<ImportView>(`/api/imports/${preview.inspectionToken}/select`,'POST',{sheetId}));}
  async function commit(){if(!preview)return;await tabSession.request(`/api/imports/${preview.inspectionToken}/commit`,'POST',{confirmed:preview.needsReplacementConfirmation});setPreview(null);setMessage('匯入完成，活動目前待開始。');onImported();}
  async function cancel(){if(!preview)return;try{await tabSession.request(`/api/imports/${preview.inspectionToken}/cancel`,'POST',{});setMessage('已取消匯入，原活動保持不變。');}finally{setPreview(null);}}
  return <div className="empty-state" aria-label="匯入 Guided Notes"><h3>匯入 Guided Notes</h3>
    {phase==='RUNNING'?<p>搶答進行中，結束活動後才能匯入新學習單。</p>:<>
    {!googleReady&&<p className="hint">請先完成 Google 連結。</p>}
    <form noValidate onSubmit={event=>{event.preventDefault();void action(inspect);}}>
      <label htmlFor="sheet-url">Google Sheets 網址</label><input id="sheet-url" type="url" value={url} required disabled={busy||blocked||!!preview} onChange={e=>setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…"/>
      <label htmlFor="group-count">組數（2～20）</label><input id="group-count" type="number" min="2" max="20" step="1" value={groups} required disabled={busy||blocked||!!preview} onChange={e=>setGroups(e.target.value)}/>
      {!preview&&<button className="secondary" type="submit" disabled={busy||blocked}>{busy?'正在讀取…':'讀取學習單'}</button>}
    </form></>}
    {preview?.stage==='SELECT_SHEET'&&<><label htmlFor="sheet-choice">選擇工作表</label><select id="sheet-choice" disabled={busy||blocked} value={sheetId} onChange={e=>setSheetId(e.target.value)}><option value="">請選擇</option>{preview.sheets?.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select><button className="secondary" disabled={busy||blocked||!sheetId} onClick={()=>{void action(select);}}>讀取工作表</button></>}
    {preview?.stage==='READY'&&<><p className="import-summary">已完整解析：{preview.questionCount} 題、{preview.fieldCount} 個作答欄位、{preview.groupCount} 組。</p>
      {preview.needsReplacementConfirmation&&<p className="notice">確認後會清除目前活動的題目、組員及全部作答結果；尚未匯出的舊結果將無法再匯出。只有新活動完整建立成功才會清除。</p>}
      <button className="primary" disabled={busy||blocked} onClick={()=>{void action(commit);}}>{preview.needsReplacementConfirmation?'確認替換並匯入':'匯入此學習單'}</button></>}
    {preview&&<button className="link-button" disabled={busy} onClick={()=>{void action(cancel);}}>取消匯入</button>}
    <p className="hint">匯入只讀取來源，不會修改原始試算表。</p>{message&&<p className="notice" role="alert">{message}</p>}
  </div>;
}
