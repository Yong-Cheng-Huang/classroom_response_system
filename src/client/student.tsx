import { useEffect,useMemo,useRef,useState } from 'react';
import type { StudentView,QuestionView,OwnSubmission } from '../shared/views.js';
import type { SubmissionAccepted } from '../shared/submissions.js';
import { normalizeAnswer,visibleLength } from '../shared/validation.js';
import { tabSession,ApiFailure } from './session.js';
import { ActivityTimer } from './activity.js';
import { StudentResults } from './results.js';
import { DraftStore,type QuestionDraft,type SubmissionAttempt } from './drafts.js';

type RunningView=Extract<StudentView,{phase:'RUNNING'}>;
export function StudentPanel({view,busy,act,refresh}:{view:StudentView;busy:boolean;act:(work:()=>Promise<void>)=>void;refresh:()=>void}){
  const store=useMemo(()=>new DraftStore(sessionStorage,view),[view.activityId,view.groupId,view.participantId]);
  useEffect(()=>{
    const route=()=>{
      if(view.phase==='ENDED'&&location.hash!=='#/results')history.replaceState(null,'',location.pathname+location.search+'#/results');
      if(view.phase!=='ENDED'&&location.hash==='#/results')history.replaceState(null,'',location.pathname+location.search);
    };
    route();window.addEventListener('hashchange',route);return()=>window.removeEventListener('hashchange',route);
  },[view.phase,view.activityId]);
  useEffect(()=>{if(view.phase==='ENDED')for(const result of view.results)if(result.ownSubmission){try{store.remove(result.questionId);}catch{/* 身分／換場的整體清除仍由分頁身分模組處理。 */}}},[view,store]);
  return <div className="student-panel" data-student-route={view.phase==='ENDED'?'results':'activity'}>
    <p>第 {view.groups.find(group=>group.id===view.groupId)?.number} 組 · {view.phase==='READY'?'待開始':view.phase==='RUNNING'?'搶答進行中':'已結束'}</p>
    <ActivityTimer startedAt={view.startedAt} endedAt={view.endedAt} serverNow={view.serverNow}/>
    <details className="student-members" open><summary>本組成員 · {view.members.length} 人</summary><ul className="members" aria-label="本組成員">{view.members.map(member=><li key={member.id}>{member.nickname}{member.isSelf&&<span>本人</span>}</li>)}</ul></details>
    <button className="secondary" disabled={busy||view.phase!=='READY'} onClick={()=>act(()=>tabSession.leave())}>離開組別</button>
    {view.phase==='READY'?<section className="student-questions" aria-label="待開始題號"><h3>本場題號</h3><div className="question-index">{view.questions.map(question=><span key={question.id}>第 {question.number} 題</span>)}</div><p className="hint">題目會在老師開始後同時開放。現在可以離組，再重新選擇組別。</p></section>:
    view.phase==='RUNNING'?<StudentQuestions view={view} store={store} refresh={refresh}/>:
    <StudentResults view={view}/>}
  </div>;
}
function StudentQuestions({view,store,refresh}:{view:RunningView;store:DraftStore;refresh:()=>void}){
  return <section className="student-questions" aria-label="作答題目"><div className="activity-heading"><h3>自由選題作答</h3><span className="hint">共 {view.questions.length} 題</span></div><p className="hint">每組每題只能送出一次，送出後不能修改。草稿只保留在目前分頁。</p>
    <nav className="question-index" aria-label="題號導覽">{view.questions.map(question=><button key={question.id} onClick={()=>document.getElementById('question-'+question.id)?.scrollIntoView({block:'start'})}>第 {question.number} 題</button>)}</nav>
    {view.questions.map(question=><QuestionCard key={question.id} question={question} view={view} store={store} submission={view.ownSubmissions.find(s=>s.questionId===question.id)} refresh={refresh}/>)}
  </section>;
}
function QuestionCard({question,view,store,submission,refresh}:{question:QuestionView;view:RunningView;store:DraftStore;submission:OwnSubmission|undefined;refresh:()=>void}){
  const [initial]=useState(()=>store.read(question.id,question.fields.map(field=>field.id)));
  const [draft,setDraft]=useState<QuestionDraft>(initial.draft),draftRef=useRef(draft);
  const [storageError,setStorageError]=useState(initial.message),[message,setMessage]=useState(''),[errorFields,setErrorFields]=useState<string[]>([]),[touched,setTouched]=useState<string[]>([]);
  const [sending,setSending]=useState(false),sendingRef=useRef(false),live=useRef(false);
  const [confirmed,setConfirmed]=useState<OwnSubmission|null>(null);
  const submitted=submission??confirmed,submittedRef=useRef(submitted);submittedRef.current=submitted;
  const current=()=>{const identity=tabSession.snapshot().session;return live.current&&identity?.role==='STUDENT'&&identity.activityId===view.activityId&&identity.participantId===view.participantId;};
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  useEffect(()=>{if(submitted){try{store.remove(question.id);setStorageError('');}catch{setStorageError('本題已送出，但暫存清理尚未完成。');}}},[submitted,store,question.id]);
  const persist=(value:QuestionDraft)=>{
    draftRef.current=value;setDraft(value);
    try{store.save(question.id,value);setStorageError('');return true;}
    catch{setStorageError('草稿暫時無法保存，請勿重新整理；請稍後再試。');return false;}
  };
  const normalized=question.fields.map(field=>{try{return{fieldId:field.id,text:normalizeAnswer(draft.answers[field.id]??'')};}catch{return null;}});
  const valid=normalized.every(answer=>answer!==null);
  const update=(id:string,value:string)=>{
    if(submittedRef.current||sendingRef.current||draftRef.current.attempt)return;
    persist({version:1,answers:{...draftRef.current.answers,[id]:value}});setMessage('');setErrorFields(fields=>fields.filter(field=>field!==id));
  };
  const send=async()=>{
    if(!current()||submittedRef.current||sendingRef.current)return;
    const previous=draftRef.current;
    if(!previous.attempt&&!valid)return;
    const attempt:SubmissionAttempt=previous.attempt??{requestId:crypto.randomUUID(),answers:normalized.filter(answer=>answer!==null)};
    if(!persist({...previous,attempt}))return;
    sendingRef.current=true;setSending(true);setMessage('');setErrorFields([]);
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
    try{
      const result=await tabSession.request<SubmissionAccepted>(`/api/activities/${encodeURIComponent(view.activityId)}/questions/${encodeURIComponent(question.id)}/submissions`,'POST',attempt,true,controller.signal);
      if(!current())return;
      setConfirmed(result.submission);store.remove(question.id);setStorageError('');refresh();
    }catch(error){
      if(!current()||submittedRef.current)return;
      const code=error instanceof ApiFailure?error.code:'UNKNOWN';
      if(['INVALID_ANSWER','INCOMPLETE_ANSWERS','INVALID_REQUEST','REQUEST_ID_CONFLICT'].includes(code)){
        persist({version:1,answers:previous.answers});
        if(error instanceof ApiFailure)setErrorFields(error.fieldIds);
        setMessage(error instanceof Error?error.message:'請檢查作答內容。');
      }else if(code==='ALREADY_SUBMITTED'){
        setMessage('本組此題已送出，正在同步送出者。');refresh();
      }else{
        setMessage('尚未確認本次送出結果，已保留送出內容。請按「重新確認提交」確認，或等待連線恢復。');refresh();
      }
    }finally{clearTimeout(timeout);sendingRef.current=false;if(live.current)setSending(false);}
  };
  const pending=!!draft.attempt&&!submitted;
  return <section className={'question-card'+(submitted?' question-submitted':'')} id={'question-'+question.id} aria-labelledby={'title-'+question.id}>
    <div className="question-heading"><h3 id={'title-'+question.id}>第 {question.number} 題</h3><span className="question-kind">{question.kind==='GROUP'?`題組 · ${question.fields.length} 個子題`:'單題'}</span></div>
    {submitted&&<p className="submitted-note" aria-live="polite">已送出（{submitted.senderNickname}）</p>}
    <form noValidate onSubmit={event=>{event.preventDefault();void send();}}>
      {question.fields.map(field=>{
        const value=draft.answers[field.id]??'',length=visibleLength(value.trim()),invalid=length<1||length>200,showInvalid=errorFields.includes(field.id)||(touched.includes(field.id)&&invalid);
        return <div className="answer-field" key={field.id}><p className="question-prompt" id={'prompt-'+field.id}>{field.label&&<strong>{field.label} </strong>}{field.prompt}</p>
          {submitted?<p className="submitted-answer">{submitted.answers.find(answer=>answer.fieldId===field.id)?.text??''}</p>:
          <><label htmlFor={'answer-'+field.id}>第 {question.number} 題{field.label?'・'+field.label:''}作答</label><textarea id={'answer-'+field.id} value={value} rows={3} required aria-required="true" aria-invalid={showInvalid} aria-describedby={'prompt-'+field.id+' hint-'+field.id} disabled={sending||pending} onChange={event=>update(field.id,event.target.value)} onBlur={()=>setTouched(values=>values.includes(field.id)?values:[...values,field.id])}/><p id={'hint-'+field.id} className={'field-hint'+(showInvalid?' invalid':'')}>{showInvalid?'請填寫 1～200 個字，不能只填空白。':`${length}／200 字`}</p></>}
        </div>;
      })}
      {!submitted&&<><p className="draft-note">{storageError|| (pending?'已保留本次送出內容，確認結果前暫停編輯。':Object.values(draft.answers).some(text=>text.length)?'草稿已儲存在此分頁。':'輸入會自動保存於此分頁。')}</p>
        {message&&<p className="notice" role="alert">{message}</p>}
        <button className="primary" aria-label={`${pending?'重新確認':'送出'}第 ${question.number} 題`} disabled={sending||(!pending&&!valid)} type="submit">{sending?'正在送出…':pending?'重新確認提交':question.kind==='GROUP'?'送出題組':'送出本題'}</button></>}
    </form>
  </section>;
}
