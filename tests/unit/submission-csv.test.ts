import test from 'node:test';
import assert from 'node:assert/strict';
import { submissionCsvRows,submissionCsvHeaders } from '../../src/server/submission-csv.js';
import { projectActivity } from '../../src/server/projections.js';
import { readModel,teacher } from '../helpers/read-model.js';
import type { TeacherView } from '../../src/shared/views.js';
function fixture(){const model=readModel();model.activity.state='ENDED';model.activity.endedAt=2000;model.participants=[];
 const q=model.questions[0]!;q.fields.push({id:'f4',label:'（3）',prompt:'三'},{id:'f5',label:'（4）',prompt:'四'});
 for(const s of model.submissions){s.senderNickname='同名原送出者';s.receivedAt=1500;if(s.questionId===q.id){s.answers.push({fieldId:'f4',text:'三'},{fieldId:'f5',text:'四'});s.answers.reverse();}}
 return projectActivity(model,teacher,3000) as TeacherView;}

test('CSV02～04 八欄、全組四子題與單題、原暱稱、同毫秒原順位及固定排序',()=>{
 const view=fixture(),before=structuredClone(view),rows=submissionCsvRows(view);
 assert.deepEqual(submissionCsvHeaders,['題號','子題','組別','姓名','答案','搶答順位','送出時間','是否搶答成功']);assert.equal(rows.length,13);assert.ok(rows.every(r=>r.length===8));
 assert.deepEqual(rows.slice(0,4).map(r=>r[1]),['（1）','（2）','（3）','（4）']);assert.deepEqual(rows.slice(0,4).map(r=>r[4]),['成功答案一','成功答案二','三','四']);
 assert.deepEqual(rows.filter((_,i)=>i%4===0).map(r=>[r[0],r[2],r[5],r[7]]),[['1','第 2 組','1','是'],['1','第 1 組','2','否'],['1','第 3 組','3','否'],['3','第 1 組','1','是']]);
 assert.equal(rows.at(-1)![1],'');assert.ok(rows.every(r=>r[3]==='同名原送出者'&&r[6]==='1970-01-01 08:00:01.500（Asia/Taipei）'));
 assert.deepEqual(submissionCsvRows(view),rows);assert.deepEqual(view,before);view.submissions=[];assert.deepEqual(submissionCsvRows(view),[]);
});

import { serializeSubmissionCsv } from '../../src/server/submission-csv.js';
import { parseCsv } from '../helpers/csv.js';
test('CSV05 BOM／CRLF／quoting保留中文、多行、引號及emoji；零提交仍有表頭',()=>{
 const view=fixture(),text='中文,「引號」"\r\n第二行\n👨‍👩‍👧‍👦';view.submissions[0]!.answers[0]!.text=text;view.submissions[0]!.senderNickname='同名,"學生"';const before=structuredClone(view);
 const bytes=serializeSubmissionCsv(view);assert.deepEqual([...bytes.subarray(0,3)],[239,187,191]);const rows=parseCsv(bytes.toString('utf8'));assert.equal(rows.length,14);assert.ok(rows.every(r=>r.length===8));assert.ok(rows.some(r=>r[4]===text&&r[3]==='同名,"學生"'));assert.ok(bytes.toString('utf8').endsWith('\r\n'));assert.deepEqual(view,before);
 view.submissions=[];assert.deepEqual(parseCsv(serializeSubmissionCsv(view).toString()),[Array.from(submissionCsvHeaders)]);
});
test('CSV05 公式型及前置空白／控制字元輸出文字前綴，不修改資料',()=>{
 for(const text of ['=1+1','+SUM(1,2)','-2+3','@SUM(1,2)','  =1+1','\t文字','\r文字','\n文字','\u000b@SUM(1,2)']){
  const view=fixture();view.submissions[0]!.senderNickname=text;view.submissions[0]!.answers[0]!.text=text;const before=structuredClone(view);const rows=parseCsv(serializeSubmissionCsv(view).toString());assert.ok(rows.some(r=>r[3]==="'"+text&&r[4]==="'"+text));assert.deepEqual(view,before);
 }
});
