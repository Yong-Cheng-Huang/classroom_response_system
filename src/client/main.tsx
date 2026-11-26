import { StrictMode, useEffect, useState,useSyncExternalStore,useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { tabSession,ApiFailure } from './session.js';
import type { ActivityView,LobbyView } from '../shared/views.js';
import { TeacherActivity } from './activity.js';
import { GoogleConnection } from './google.js';
import { ExportGuidedNotes } from './exports.js';
import { ImportGuidedNotes } from './imports.js';
import { StudentPanel } from './student.js';
import { openRealtime } from './realtime.js';
import './style.css';

function App() {
  const [identityInitialized,setIdentityInitialized]=useState(false);
  const initialized=useRef(false),loadPending=useRef(0);
  const [status, setStatus] = useState('正在連接本機服務…');
  const identity=useSyncExternalStore(tabSession.subscribe,tabSession.snapshot);
  const [mode,setMode]=useState<'STUDENT'|'TEACHER'>('STUDENT');
  const [password,setPassword]=useState('');
  const [lobby,setLobby]=useState<LobbyView|null>(null);
  const [view,setView]=useState<ActivityView|null>(null);
  const [loadMessage,setLoadMessage]=useState('');
  const [googleReady,setGoogleReady]=useState(false);
  const [abandonmentToken,setAbandonmentToken]=useState('');
  useEffect(()=>setAbandonmentToken(''),[view?.activityId,identity.session?.role,identity.session?.createdAt]);
  const loadSequence=useRef(0);
  const realtimeConnected=useRef(false);
  const load=async()=>{
    const sequence=++loadSequence.current;loadPending.current++;
    try{
    await tabSession.refresh();if(sequence!==loadSequence.current)return;
    const current=tabSession.snapshot();
    try{
      if(current.status==='OWNED'){
        const data=await tabSession.request<ActivityView>('/api/activities/current/view');
        if(sequence===loadSequence.current)setView(data);
      }else{
        setView(null);const data=await tabSession.request<LobbyView>('/api/lobby');
        if(sequence===loadSequence.current)setLobby(data);
      }
      if(sequence===loadSequence.current)setLoadMessage('');
    }catch(error){if(sequence===loadSequence.current&&error instanceof ApiFailure)setLoadMessage(error.message);}
    }finally{loadPending.current--;}
  };
  const act=(work:()=>Promise<void>)=>{++loadSequence.current;void work().then(load).catch(()=>{});};
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok || body.ok !== true) throw new Error();
      setStatus('本機服務已連線');
    }).catch(() => { if (!controller.signal.aborted) setStatus('暫時無法連接本機服務，正在自動重連。'); });
    return () => controller.abort();
  }, []);
  useEffect(()=>{
    let live=true;void tabSession.initialize().then(()=>{if(live){initialized.current=true;setIdentityInitialized(true);void load();}});
    // 健康即時通道已提供授權狀態；僅斷線時保留HTTP恢復輪詢，避免多分頁爭用。
    const timer=setInterval(()=>{if(initialized.current&&(!realtimeConnected.current||tabSession.snapshot().status==='DISCONNECTED')&&loadPending.current===0)void load();},2000);
    const visible=()=>{if(initialized.current&&document.visibilityState==='visible')void load();};document.addEventListener('visibilitychange',visible);
    return()=>{live=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[]);
  useEffect(()=>{
    realtimeConnected.current=false;
    if(!identityInitialized)return;
    return openRealtime(identity.session?'activity':'lobby',data=>{
      ++loadSequence.current;
      if(data.scope==='activity')setView(data.view);
      else{setView(null);setLobby(data.view);}
      setLoadMessage('');
    },setLoadMessage,message=>{realtimeConnected.current=message==='本機服務已連線';setStatus(message);});
  },[identityInitialized,identity.status==='NEW',identity.session?.createdAt,identity.session?.role]);
  useEffect(()=>{if(identity.status==='NEW'&&!identity.session&&location.hash==='#/results')history.replaceState(null,'',location.pathname+location.search);},[identity.status,identity.session]);
  return <main>
    <header><p className="eyebrow">課堂互動・共同探索</p><p role="status" className="connection">{status}</p></header>
    <div className={'layout'+(identity.session?.role==='STUDENT'?' student-layout':identity.session?.role==='TEACHER'?' teacher-layout':'')}><div className="intro"><span className="index">課堂登記簿 ／ 01</span><h1>課堂搶答系統</h1><p className="lead">{identity.session?.role==='TEACHER'?<>掌握課堂節奏，<br/>看見每組的思考。</>:<>加入你的組別，<br/>一起思考，搶先回答。</>}</p><div className="rule"/><p className="quiet">每個分頁各自登入，<br/>老師與不同組別可以同時操作。</p></div>
    <section className="workspace" aria-label="身分與組別">
      {identity.message&&<p className="notice" role="alert">{identity.message}</p>}
      {identity.status==='DISCONNECTED'?<><h2>正在恢復連線</h2><p>暫存資料已保留，請稍候。</p></>:
      identity.session?.role==='TEACHER'?<><div className="section-heading"><span className="badge">老師</span><button className="link-button" disabled={identity.busy} onClick={()=>act(()=>tabSession.logout())}>登出</button></div><h2>老師已登入</h2><p>此分頁可管理課堂活動。</p><GoogleConnection onReady={setGoogleReady}/>{view?.role==='TEACHER'&&view.phase!=='EMPTY'?<><TeacherActivity key={view.activityId} view={view} act={act}/><ExportGuidedNotes key={view.activityId+':exports'} view={view} googleReady={googleReady} onAbandon={setAbandonmentToken}/></>:<div className="empty-state"><h3>尚未匯入活動</h3></div>}<ImportGuidedNotes abandonmentToken={abandonmentToken} phase={view?.phase} googleReady={googleReady} onImported={()=>{void load();}}/></>:
      identity.session?.role==='STUDENT'?<><span className="badge">學生</span><h2>已加入組別</h2><p className="nickname-display">{identity.session.nickname}</p>
        {view?.role==='STUDENT'&&view.participantId===identity.session.participantId&&view.activityId===identity.session.activityId?<StudentPanel key={view.activityId+':'+view.participantId} view={view} busy={identity.busy} act={act} refresh={()=>{void load();}}/>:<p>正在同步組別資料…</p>}
      </>:
      <><div className="role-picker" aria-label="選擇操作身分"><button aria-pressed={mode==='STUDENT'} onClick={()=>setMode('STUDENT')}>學生加入</button><button aria-pressed={mode==='TEACHER'} onClick={()=>setMode('TEACHER')}>老師登入</button></div>
      {mode==='TEACHER'?<form noValidate onSubmit={event=>{event.preventDefault();act(async()=>{await tabSession.login(password);setPassword('');});}}><span className="index">老師專用</span><h2>開始管理課堂</h2><label htmlFor="teacher-password">老師密碼</label><input id="teacher-password" type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required/><button className="primary" disabled={identity.busy} type="submit">{identity.busy?'正在登入…':'登入老師身分'}</button></form>:
      <><span className="index">學生登記</span><h2>先告訴我們你的名字</h2><label htmlFor="nickname">暱稱</label><div className="name-row"><input id="nickname" value={identity.nickname} onChange={event=>tabSession.setNickname(event.target.value)} autoComplete="off"/><button className="secondary" onClick={()=>tabSession.randomizeNickname()}>換個名字</button></div><p className="hint">1～20 個字元，可以使用中文或 emoji。</p>
      {lobby?.phase==='EMPTY'?<div className="empty-state"><span className="waiting-dot"/><h3>等待老師匯入活動</h3><p>準備好後，就能在這裡選擇組別。</p></div>:lobby&&<><h3>選擇你的組別</h3><div className="group-grid">{lobby.groups.map(group=><button className="group" key={group.id} disabled={!lobby.canJoin||identity.busy} onClick={()=>act(()=>tabSession.join(lobby.activityId!,group.id))}><strong>第 {group.number} 組</strong><span>{group.memberCount} 人</span></button>)}</div>{!lobby.canJoin&&<p className="hint">{lobby.phase==='ENDED'?'本場活動已結束，請等待老師建立新活動。':'本場活動已開始，現在不能新加入。'}</p>}</>}
      </>}
      </>}
      {loadMessage&&<p className="notice">{loadMessage}</p>}
    </section></div><footer>共同作答，以組別為單位。搶答名次由伺服器判定。</footer>
  </main>;
}

const root=createRoot(document.getElementById('root')!);
root.render(<StrictMode><App /></StrictMode>);
import.meta.hot?.dispose(()=>root.unmount());
