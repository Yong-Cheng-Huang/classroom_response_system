import { useEffect,useRef,useState } from 'react';
import { ApiFailure,tabSession } from './session.js';
import type { ImportView } from '../shared/imports.js';
import type { ActivityPhase } from '../shared/contracts.js';

export function ImportGuidedNotes({phase,serviceAccountReady,onImported,abandonmentToken}:{abandonmentToken?:string;phase:ActivityPhase|undefined;serviceAccountReady:boolean;onImported:()=>void}){
  const [url,setUrl]=useState(''),[groups,setGroups]=useState('2'),[preview,setPreview]=useState<ImportView|null>(null),[sheetId,setSheetId]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [mode,setMode]=useState<'PUBLIC'|'SERVICE_ACCOUNT'>(serviceAccountReady?'SERVICE_ACCOUNT':'PUBLIC'),[publicConfigured,setPublicConfigured]=useState(false);
  const selected=useRef(false);
  useEffect(()=>{let active=true;void tabSession.request<{publicConfigured:boolean}>('/api/imports/options','GET').then(value=>{if(active)setPublicConfigured(value.publicConfigured);}).catch(()=>{});return()=>{active=false;};},[]);
  useEffect(()=>{if(!selected.current&&!preview&&!working.current)setMode(serviceAccountReady?'SERVICE_ACCOUNT':'PUBLIC');},[serviceAccountReady,preview]);
  const working=useRef(false);
  const blocked=phase==='RUNNING'||(mode==='SERVICE_ACCOUNT'?!serviceAccountReady:!publicConfigured);
  async function action(work:()=>Promise<void>){if(working.current)return;working.current=true;setBusy(true);setMessage('');try{await work();}catch(error){setMessage(error instanceof ApiFailure?error.message:'匯入暫時無法完成，原活動仍保留。');}finally{working.current=false;setBusy(false);}}
  async function inspect(){selected.current=true;if(!Number.isInteger(Number(groups))||Number(groups)<2||Number(groups)>20)throw new ApiFailure('INVALID_GROUP_COUNT','組數必須是 2～20 的整數。');if(!url.trim())throw new ApiFailure('INVALID_REQUEST','請填寫 Google Sheets 網址。');setPreview(await tabSession.request<ImportView>('/api/imports/inspect','POST',{url,accessMode:mode,groupCount:Number(groups),...(abandonmentToken?{abandonmentToken}:{})}));setSheetId('');}
  async function select(){if(!preview)return;setPreview(await tabSession.request<ImportView>(`/api/imports/${preview.inspectionToken}/select`,'POST',{sheetId}));}
  async function commit(){if(!preview)return;await tabSession.request(`/api/imports/${preview.inspectionToken}/commit`,'POST',{confirmed:preview.needsReplacementConfirmation});setPreview(null);setMessage('匯入完成，活動目前待開始。');onImported();}
  async function cancel(){if(!preview)return;try{await tabSession.request(`/api/imports/${preview.inspectionToken}/cancel`,'POST',{});setMessage('已取消匯入，原活動保持不變。');}finally{setPreview(null);}}
  return <div className="empty-state" aria-label="匯入 Guided Notes"><h3>匯入 Guided Notes</h3>
    {phase==='RUNNING'?<p>搶答進行中，結束活動後才能匯入新學習單。</p>:<>
    <label htmlFor="import-mode">匯入方式</label><select id="import-mode" disabled={busy||!!preview} value={mode} onChange={e=>{selected.current=true;setMode(e.target.value as 'PUBLIC'|'SERVICE_ACCOUNT');setMessage('');}}>
      <option value="PUBLIC">公開學習單（免 Google 登入）</option><option value="SERVICE_ACCOUNT">服務帳戶</option>
    </select>
    {mode==='SERVICE_ACCOUNT'&&!serviceAccountReady&&<p className="hint">請先配置服務帳戶，並將原表共用給頁面顯示的Email。</p>}
    {mode==='PUBLIC'&&<p className="hint">請貼原始 Sheets 網址，並將原表共用設為「知道連結的任何人可查看」。僅發布到網路不保證可讀；不需開放編輯。</p>}
    {mode==='PUBLIC'&&!publicConfigured&&<p className="notice">公開讀取尚未配置，請管理者設定 GOOGLE_SHEETS_API_KEY 並重新啟動，或改選服務帳戶。</p>}
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
