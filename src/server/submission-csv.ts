import type { TeacherView } from '../shared/views.js';
import { AppError } from '../shared/errors.js';
import { formatSubmissionTime } from './time.js';

export const submissionCsvHeaders=['題號','子題','組別','姓名','答案','搶答順位','送出時間','是否搶答成功'] as const;

// 只取匯出欄位；答案依欄位位置展開，不依 answers 的儲存順序。
export function submissionCsvRows(view:TeacherView):string[][] {
  const rows:string[][]=[];
  for(const question of view.questions){
    const submissions=view.submissions.filter(s=>s.questionId===question.id).sort((a,b)=>a.rank-b.rank);
    for(const submission of submissions){
      const group=view.groups.find(g=>g.id===submission.groupId);
      if(!group)throw new AppError('INTERNAL_ERROR');
      for(const field of question.fields){
        const answer=submission.answers.find(a=>a.fieldId===field.id);
        if(!answer)throw new AppError('INTERNAL_ERROR');
        rows.push([question.number,field.label??'',`第 ${group.number} 組`,submission.senderNickname,answer.text,
          String(submission.rank),formatSubmissionTime(submission.receivedAt),submission.rank===1?'是':'否']);
      }
    }
  }
  return rows;
}

function csvCell(value:string){
  // 引號本身不阻止 Excel 公式判讀；先將外部公式型文字標為文字。
  const text=/^[\t\r\n]/u.test(value)||/^\s*[=+\-@]/u.test(value)?"'"+value:value;
  return '"'+text.replaceAll('"','""')+'"';
}
export function serializeSubmissionCsv(view:TeacherView):Buffer {
  const rows=[Array.from(submissionCsvHeaders),...submissionCsvRows(view)];
  return Buffer.from('\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n','utf8');
}
