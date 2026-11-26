import { createHash,randomUUID } from 'node:crypto';
import type { SqliteDatabase } from './database.js';
import type { IdentityService } from './identity.js';
import type { TabProof } from '../shared/session.js';
import type { CommandInputs } from '../shared/contracts.js';
import type { Receipt } from './command-queue.js';
import type { SubmissionAccepted } from '../shared/submissions.js';
import { AppError,SubmissionValidationError } from '../shared/errors.js';
import { normalizeAnswer } from '../shared/validation.js';
import { persistCompleteSubmission } from './storage.js';

type Saved={id:string;question_id:string;sender_nickname:string;request_hash:string};
export class SubmissionService {
  constructor(private readonly database:SqliteDatabase,private readonly identity:IdentityService){}
  private accepted(saved:Saved,requestId:string):SubmissionAccepted{
    const answers=this.database.prepare(`SELECT a.field_id AS fieldId,a.answer_text AS text FROM submission_answers a
      JOIN question_fields f ON f.id=a.field_id WHERE a.submission_id=? ORDER BY f.position`).all(saved.id) as {fieldId:string;text:string}[];
    return{accepted:true,requestId,submission:{questionId:saved.question_id,senderNickname:saved.sender_nickname,answers}};
  }
  submit(proof:TabProof,activityId:string,questionId:string,input:CommandInputs['submit'],receipt:Receipt):SubmissionAccepted{
    try{
      // 到期／撤銷先獨立裁定，不隨業務失敗回滾。
      const authorized=this.identity.principal(proof);if(authorized.role!=='STUDENT')throw new AppError('FORBIDDEN');
      return this.database.transaction(()=>{
        const subject=this.identity.principal(proof);if(subject.role!=='STUDENT')throw new AppError('FORBIDDEN');
        const current=this.database.prepare('SELECT id,state FROM activities WHERE current_slot=1').get() as {id:string;state:string}|undefined;
        if(!current||current.id!==activityId||subject.activityId!==activityId)throw new AppError('ACTIVITY_CHANGED');
        if(!this.database.prepare('SELECT id FROM questions WHERE id=? AND activity_id=?').get(questionId,activityId))throw new AppError('NOT_FOUND');
        const member=this.database.prepare("SELECT nickname FROM participants WHERE id=? AND session_id=? AND activity_id=? AND group_id=? AND membership_state='JOINED'").get(subject.participantId,subject.sessionId,activityId,subject.groupId) as {nickname:string}|undefined;
        if(!member)throw new AppError('FORBIDDEN');
        const prior=this.database.prepare('SELECT id,question_id,sender_nickname,request_hash FROM submissions WHERE activity_id=? AND group_id=? AND request_id=? AND sealed=1').get(activityId,subject.groupId,input.requestId) as Saved|undefined;
        // 指紋採正規化答案及穩定欄位排序；順序、頭尾空白不是另一筆答案。
        const invalid:string[]=[];
        const normalized=input.answers.map(answer=>{
          try{return{fieldId:answer.fieldId,text:normalizeAnswer(answer.text)};}
          catch(error){if(!(error instanceof AppError)||error.code!=='INVALID_ANSWER')throw error;invalid.push(answer.fieldId);return{fieldId:answer.fieldId,text:answer.text};}
        });
        const ordered=[...normalized].sort((a,b)=>a.fieldId<b.fieldId?-1:a.fieldId>b.fieldId?1:0);
        const hash=createHash('sha256').update(JSON.stringify({activityId,questionId,answers:ordered})).digest('hex');
        if(prior){
          if(invalid.length||prior.question_id!==questionId||prior.request_hash!==hash)throw new AppError('REQUEST_ID_CONFLICT');
          return this.accepted(prior,input.requestId);
        }
        if(current.state!=='RUNNING')throw new AppError('STATE_CONFLICT');
        const fields=this.database.prepare('SELECT id FROM question_fields WHERE activity_id=? AND question_id=? ORDER BY position').all(activityId,questionId) as {id:string}[];
        const provided=new Set(normalized.map(answer=>answer.fieldId)),expected=new Set(fields.map(field=>field.id));
        const missing=fields.filter(field=>!provided.has(field.id)).map(field=>field.id);
        if(!fields.length||normalized.length!==fields.length||provided.size!==normalized.length||normalized.some(answer=>!expected.has(answer.fieldId)))
          throw new SubmissionValidationError('INCOMPLETE_ANSWERS',missing.length?missing:fields.map(field=>field.id));
        if(invalid.length)throw new SubmissionValidationError('INVALID_ANSWER',invalid);
        if(this.database.prepare('SELECT id FROM submissions WHERE activity_id=? AND question_id=? AND group_id=? AND sealed=1').get(activityId,questionId,subject.groupId))throw new AppError('ALREADY_SUBMITTED');
        if(!Number.isSafeInteger(receipt.receivedAt)||receipt.receivedAt<0||!this.database.prepare('SELECT id FROM receive_orders WHERE id=?').get(receipt.receiveOrder))throw new AppError('INVALID_REQUEST');
        const rank=(this.database.prepare('SELECT coalesce(max(rank),0)+1 AS n FROM submissions WHERE activity_id=? AND question_id=? AND sealed=1').get(activityId,questionId) as {n:number}).n;
        const id=randomUUID(),byField=new Map(normalized.map(answer=>[answer.fieldId,answer.text]));
        persistCompleteSubmission(this.database,{id,activityId,questionId,groupId:subject.groupId,participantId:subject.participantId,
          senderNickname:member.nickname,...receipt,rank,requestId:input.requestId,requestHash:hash,answers:fields.map(field=>({fieldId:field.id,text:byField.get(field.id)!}))});
        return this.accepted({id,question_id:questionId,sender_nickname:member.nickname,request_hash:hash},input.requestId);
      }).immediate();
    }catch(error){if(error instanceof AppError)throw error;throw new AppError('DATABASE_UNAVAILABLE');}
  }
}
