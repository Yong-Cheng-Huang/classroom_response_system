import type { StudentView,QuestionView,OwnSubmission,OwnResult } from '../shared/views.js';

type EndedView=Extract<StudentView,{phase:'ENDED'}>;
const labels:Record<OwnResult['status'],string>={SUCCESS:'本組搶答成功',SUBMITTED:'已送出，未搶到',MISSING:'本組未作答'};

export function StudentResults({view}:{view:EndedView}){
  return <section className="student-results-route" aria-label="活動結果">
    <span className="index">本場結果</span><h3>活動已結束</h3>
    <p className="result-score" aria-label="本組成功題數"><strong>{view.successCount}</strong>／{view.questions.length} 題搶答成功</p>
    <p className="hint">以整題計算，題組只算一題。搶答成功依有效提交順序判定，不代表答案正確。</p>
    <p className="hint">結束後公開各題成功組的答案與送出者，並保留本組作答；不公開其他組未搶到的答案或完整排名。</p>
    <nav className="question-index" aria-label="結果題號導覽">{view.questions.map(question=><button key={question.id} onClick={()=>document.getElementById('result-'+question.id)?.scrollIntoView({block:'start'})}>第 {question.number} 題</button>)}</nav>
    {view.questions.map(question=>{
      const result=view.results.find(result=>result.questionId===question.id);
      return <section className="student-question-result" id={'result-'+question.id} key={question.id} aria-label={`第 ${question.number} 題結果`}>
        <div className="question-heading"><h4>第 {question.number} 題</h4><span className="question-kind">{question.kind==='GROUP'?`題組 · ${question.fields.length} 個子題`:'單題'}</span></div>
        {question.fields.map(field=><p key={field.id} className="question-prompt">{field.label&&<strong>{field.label} </strong>}{field.prompt}</p>)}
        {!result?<p className="notice">結果暫時無法顯示，請等待同步。</p>:<>
          <p className={'own-result-status '+(result.status==='SUCCESS'?'successful-result':'')} aria-label="本組本題結果">{labels[result.status]}</p>
          {result.winner?<section className="winning-result" aria-label="搶答成功答案"><h5>搶答成功 · 第 {result.winner.groupNumber} 組</h5><SubmissionAnswers question={question} submission={result.winner}/></section>:<p className="no-winning-result">無人搶答</p>}
          {result.status==='SUBMITTED'&&result.ownSubmission&&<section className="own-result-answers" aria-label="本組已送出答案"><h5>本組已送出答案</h5><SubmissionAnswers question={question} submission={result.ownSubmission}/></section>}
        </>}
      </section>;
    })}
  </section>;
}
function SubmissionAnswers({question,submission}:{question:QuestionView;submission:OwnSubmission}){
  return <><p className="result-sender">送出者：{submission.senderNickname}</p><dl className="result-answers">{question.fields.map((field,index)=><div key={field.id}><dt>{field.label??(question.fields.length===1?'作答':`子題 ${index+1}`)}</dt><dd>{submission.answers.find(answer=>answer.fieldId===field.id)?.text??''}</dd></div>)}</dl></>;
}
