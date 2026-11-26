import { useState } from 'react';
import type { TeacherView } from '../shared/views.js';

export function TeacherQuestions({view}:{view:TeacherView}){
  const [previewId,setPreviewId]=useState<string|null>(null);
  const preview=view.questions.find(question=>question.id===previewId);
  return <>
    <section className="teacher-preview" aria-label="題號預覽">
      <div className="activity-heading"><h3>題目預覽</h3><span className="hint">僅此分頁</span></div>
      <p className="hint">點擊題號查看完整題目；再次點擊可關閉，不影響學生或其他老師。</p>
      <nav className="question-index" aria-label="老師題號導覽">{view.questions.map(question=><button key={question.id} aria-label={`預覽第 ${question.number} 題`} aria-expanded={previewId===question.id} aria-controls="teacher-question-preview" onClick={()=>setPreviewId(previous=>previous===question.id?null:question.id)}>第 {question.number} 題</button>)}</nav>
      {preview&&<section className="teacher-question-preview" id="teacher-question-preview" aria-label="題目預覽內容"><h4>第 {preview.number} 題{preview.kind==='GROUP'?` · 題組（${preview.fields.length} 個子題）`:' · 單題'}</h4>{preview.fields.map(field=><p className="question-prompt" key={field.id}>{field.label&&<strong>{field.label} </strong>}{field.prompt}</p>)}</section>}
    </section>
    <section className="teacher-monitor" aria-label="全部組別提交監看">
      <div className="activity-heading"><h3>{view.phase==='ENDED'?'本場完整結果':'即時作答狀況'}</h3><span className="hint">{view.submissions.length} 筆提交</span></div>
      <p className="hint">依伺服器接收的有效提交順序排名，第一名為「搶答成功」，不代表答案正確；系統不批改答案。老師可查看全部組別，學生依活動階段取得允許的資料。</p>
      {view.questions.map(question=>{
        const submissions=view.submissions.filter(submission=>submission.questionId===question.id).sort((a,b)=>a.rank-b.rank);
        const missing=view.groups.filter(group=>!submissions.some(submission=>submission.groupId===group.id));
        return <section className="teacher-question-status" key={question.id} aria-label={`第 ${question.number} 題提交狀況`}>
          <div className="question-heading"><h4>第 {question.number} 題</h4><span className="question-kind">{question.kind==='GROUP'?`題組 · ${question.fields.length} 個子題`:'單題'} · {submissions.length}／{view.groups.length} 組已提交</span></div>
          {submissions.length===0&&<p className="question-empty">{view.phase==='ENDED'?'無人搶答':view.phase==='READY'?'尚未開始':'尚無提交'}</p>}
          {submissions.length>0&&<ol className="teacher-submissions" aria-label={`第 ${question.number} 題提交排名`}>{submissions.map(submission=>{
            const group=view.groups.find(group=>group.id===submission.groupId);
            return <li key={submission.id} className={submission.rank===1?'winning-submission':''} aria-label={`第 ${question.number} 題第 ${group?.number} 組提交`}>
              <div className="submission-heading"><strong>第 {submission.rank} 名 · 第 {group?.number} 組</strong><span className={submission.rank===1?'success-label':'question-kind'}>{submission.rank===1?'搶答成功':'已送出，未搶到'}</span></div>
              <p className="submission-sender">送出者：{submission.senderNickname}</p>
              <p className="submission-time">提交時間：<time dateTime={new Date(submission.receivedAt).toISOString()}>{submission.submittedAt}</time></p>
              <details className="teacher-answers"><summary>查看完整答案</summary><dl>{question.fields.map((field,index)=><div key={field.id}><dt>{field.label??(question.fields.length===1?'作答':`子題 ${index+1}`)}</dt><dd>{submission.answers.find(answer=>answer.fieldId===field.id)?.text??''}</dd></div>)}</dl></details>
            </li>;
          })}</ol>}
          {missing.length>0&&<ul className="unsubmitted-groups" aria-label={`第 ${question.number} 題未提交組別`}>{missing.map(group=><li key={group.id}>第 {group.number} 組 · 未提交</li>)}</ul>}
        </section>;
      })}
    </section>
  </>;
}
