import { sessionKeys } from '../shared/session.js';
import { normalizeAnswer } from '../shared/validation.js';
export type DraftOwner={activityId:string;groupId:string;participantId:string};
export type SubmissionAttempt={requestId:string;answers:{fieldId:string;text:string}[]};
export type QuestionDraft={version:1;answers:Record<string,string>;attempt?:SubmissionAttempt};
type DraftStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export class DraftStore {
  constructor(private readonly storage:DraftStorage,private readonly owner:DraftOwner){}
  private key(questionId:string){return sessionKeys.draftPrefix+encodeURIComponent(JSON.stringify([this.owner.activityId,this.owner.participantId,this.owner.groupId,questionId]));}
  read(questionId:string,fieldIds:string[]):{draft:QuestionDraft;message:string}{
    const empty=():QuestionDraft=>({version:1,answers:Object.fromEntries(fieldIds.map(id=>[id,'']))});
    try{
      const raw=this.storage.getItem(this.key(questionId));if(!raw)return{draft:empty(),message:''};
      const value:unknown=JSON.parse(raw);
      if(!object(value)||value.version!==1||!object(value.answers)||Object.keys(value.answers).some(id=>!fieldIds.includes(id))||Object.values(value.answers).some(text=>typeof text!=='string'))throw new Error();
      const draft:QuestionDraft={version:1,answers:{...empty().answers,...value.answers as Record<string,string>}};
      if(value.attempt!==undefined){
        const attempt=value.attempt;
        if(!object(attempt)||typeof attempt.requestId!=='string'||!attempt.requestId.trim()||!Array.isArray(attempt.answers)||attempt.answers.length!==fieldIds.length)throw new Error();
        const answers=attempt.answers.map(answer=>{if(!object(answer)||typeof answer.fieldId!=='string'||!fieldIds.includes(answer.fieldId))throw new Error();return{fieldId:answer.fieldId,text:normalizeAnswer(answer.text)};});
        if(new Set(answers.map(a=>a.fieldId)).size!==fieldIds.length||answers.some(a=>normalizeAnswer(draft.answers[a.fieldId])!==a.text))throw new Error();
        draft.attempt={requestId:attempt.requestId,answers};
      }
      return{draft,message:''};
    }catch{return{draft:empty(),message:'草稿暫時無法讀取，請重新檢查作答內容。'};}
  }
  save(questionId:string,draft:QuestionDraft){this.storage.setItem(this.key(questionId),JSON.stringify(draft));}
  remove(questionId:string){this.storage.removeItem(this.key(questionId));}
}
