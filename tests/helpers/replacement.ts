import type { PreparedActivity } from '../../src/server/activity-replacement.js';
import type { SqliteDatabase } from '../../src/server/database.js';
import { createSqliteAllocator } from '../../src/server/command-queue.js';
import { persistCompleteSubmission } from '../../src/server/storage.js';
import { seedActivity } from './database.js';

export function preparedActivity(): PreparedActivity {
  return { groupCount: 3, source: { spreadsheetId: 'new-copy', sheetId: 'selected-sheet', parserVersion: 'test-v1',
    snapshot: { cells: { B4:'題號',C4:'題目',G4:'作答' }, merges:['G5:H5'], originalAnswers:['僅作基準'] } },
    questions: [
      { number:'1', kind:'SINGLE', fields:[{label:null,prompt:'新單題',answerRange:'G5:H5',original:{fontSize:12}}] },
      { number:'2', kind:'GROUP', fields:[
        {label:'（1）',prompt:'新子題一',answerRange:'H7',original:{}},
        {label:'（2）',prompt:'新子題二',answerRange:'H8',original:{}},
      ] },
    ] };
}
export function seedOldActivity(database: SqliteDatabase) {
  seedActivity(database);
  const receipt=createSqliteAllocator(database,()=>1500)();
  persistCompleteSubmission(database,{id:'old-submit',activityId:'a',questionId:'q',groupId:'g1',participantId:'p1',senderNickname:'同名',
    ...receipt,rank:1,requestId:'old-request',requestHash:'old-hash',answers:[{fieldId:'f1',text:'舊答案一'},{fieldId:'f2',text:'舊答案二'}]});
  database.exec(`UPDATE activities SET state='ENDED',ended_at=2000;
    INSERT INTO sessions(id,token_hash,role,created_at,expires_at,lifecycle,password_version)
      VALUES ('teacher','teacher-hash','TEACHER',0,43200000,'CONNECTED','v1');
    INSERT INTO google_connection VALUES (1,'test-account','[]','protected-reference','CONNECTED');
    INSERT INTO document_output_management VALUES ('old-copy','sheet','H5','UNVERIFIED','content-hash',0,'{}','format-hash');
    INSERT INTO export_operations VALUES ('old-export','a','old-copy','sheet','ANSWERS','COMPLETED','{"oldAnswer":"舊答案一"}','hash',1,2);`);
}
