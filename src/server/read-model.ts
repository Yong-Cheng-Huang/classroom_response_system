import type { SqliteDatabase } from './database.js';
import type { ActivityReadModel } from './projections.js';
import type { IdentityService } from './identity.js';

export function readActivityModel(database:SqliteDatabase,identity:IdentityService):ActivityReadModel|null {
  identity.assertPresenceKnown();
  const activity=database.prepare(`SELECT id,state,version,started_at AS startedAt,ended_at AS endedAt FROM activities WHERE current_slot=1`).get() as ActivityReadModel['activity']|undefined;
  if(!activity)return null;
  const groups=database.prepare('SELECT id,number FROM groups WHERE activity_id=? ORDER BY number').all(activity.id) as ActivityReadModel['groups'];
  const participants=database.prepare(`SELECT p.id,p.session_id AS sessionId,p.group_id AS groupId,p.nickname FROM participants p
    JOIN sessions s ON s.id=p.session_id JOIN tab_bindings b ON b.session_id=s.id
    WHERE p.activity_id=? AND p.membership_state='JOINED' AND s.lifecycle IN ('CONNECTED','GRACE')`).all(activity.id) as ActivityReadModel['participants'];
  const rows=database.prepare('SELECT id,number,kind FROM questions WHERE activity_id=? ORDER BY position').all(activity.id) as Omit<ActivityReadModel['questions'][number],'fields'>[];
  // 固定次數讀取整場明細，避免每個分頁為每題／提交重新準備SQL。
  type Field=ActivityReadModel['questions'][number]['fields'][number];
  const fields=new Map<string,Field[]>();
  for(const {questionId,...field} of database.prepare('SELECT question_id AS questionId,id,label,prompt FROM question_fields WHERE activity_id=? ORDER BY question_id,position').all(activity.id) as (Field&{questionId:string})[]){
    const list=fields.get(questionId)??[];list.push(field);fields.set(questionId,list);
  }
  const questions=rows.map(question=>({...question,fields:fields.get(question.id)??[]}));
  type Answer=ActivityReadModel['submissions'][number]['answers'][number];
  const answers=new Map<string,Answer[]>();
  for(const {submissionId,...answer} of database.prepare(`SELECT a.submission_id AS submissionId,a.field_id AS fieldId,a.answer_text AS text
    FROM submission_answers a JOIN submissions s ON s.id=a.submission_id
    WHERE s.activity_id=? AND s.sealed=1 ORDER BY a.submission_id,a.field_id`).all(activity.id) as (Answer&{submissionId:string})[]){
    const list=answers.get(submissionId)??[];list.push(answer);answers.set(submissionId,list);
  }
  const submissions=(database.prepare(`SELECT id,question_id AS questionId,group_id AS groupId,sender_nickname AS senderNickname,rank,received_at AS receivedAt
    FROM submissions WHERE activity_id=? AND sealed=1 ORDER BY question_id,rank`).all(activity.id) as Omit<ActivityReadModel['submissions'][number],'answers'>[])
    .map(value=>({...value,answers:answers.get(value.id)??[]}));
  return{activity,groups,participants,questions,submissions};
}
