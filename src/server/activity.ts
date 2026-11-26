import { randomBytes } from 'node:crypto';
import type { SqliteDatabase } from './database.js';
import type { IdentityService } from './identity.js';
import type { TabProof } from '../shared/session.js';
import type { Receipt } from './command-queue.js';
import type { ActivityState } from '../shared/contracts.js';
import { AppError } from '../shared/errors.js';
import { elapsedMilliseconds } from './time.js';
import { replacePreparedActivity, type PreparedActivity, type ReplacementExpectation, type ReplacementNotice } from './activity-replacement.js';

type CurrentActivity = { id:string; state:ActivityState; version:number; started_at:number|null; ended_at:number|null };
export type ReplacementGate = {
  expectation:ReplacementExpectation;
  operations:{id:string;state:'PREPARING'|'WRITING'|'UNCONFIRMED'}[];
} & ({
  status:'REQUIRES_RECONCILIATION';
  nextAction:'RECONCILE_OR_REQUEST_ABANDONMENT_CONFIRMATION';
  // 這是「請求顯示再次確認」的輸入，不是已授權／已放棄的票證。
  confirmationRequests:{operationId:string;activityId:string;expectedVersion:number}[];
}|{
  status:'AVAILABLE'|'CONFIRM_REPLACEMENT'|'RUNNING'|'DOCUMENT_BUSY';
  nextAction:'INSPECT_SOURCE'|'CONFIRM_REPLACEMENT'|'END_ACTIVITY'|'WAIT';
});

// 單一權威程序內的文件互斥；匯出仍須另外先落盤 WRITING，才能跨重啟恢復。
export class DocumentOperations {
  private active=new Set<string>();
  async run<T>(spreadsheetId:string,sheetId:string,work:()=>T|Promise<T>):Promise<T>{
    const key=JSON.stringify([spreadsheetId,sheetId]);
    if(this.active.has(key))throw new AppError('DOCUMENT_OPERATION_BUSY');
    this.active.add(key);
    try{return await work();}finally{this.active.delete(key);}
  }
  busy(spreadsheetId:string,sheetId:string){return this.active.has(JSON.stringify([spreadsheetId,sheetId]));}
}

export class ActivityService {
  private abandonment=new Map<string,{sessionId:string;activityId:string;version:number;operationIds:string[];expiresAt:number}>();
  constructor(private readonly database:SqliteDatabase,private readonly identity:IdentityService,
    readonly documents=new DocumentOperations(),private readonly now:()=>number=Date.now){}
  private current(){return this.database.prepare('SELECT id,state,version,started_at,ended_at FROM activities WHERE current_slot=1').get() as CurrentActivity|undefined;}
  private teacher(proof:TabProof){if(this.identity.principal(proof).role!=='TEACHER')throw new AppError('FORBIDDEN');}
  transition(proof:TabProof,activityId:string,expectedVersion:number,action:'start'|'end',receipt:Receipt,confirmed?:boolean){
    this.teacher(proof); // 到期／撤銷先獨立落盤，不隨業務交易失敗回滾。
    if(action==='end'&&confirmed!==true)throw new AppError('INVALID_REQUEST');
    if(!Number.isSafeInteger(receipt.receivedAt)||receipt.receivedAt<0||!this.database.prepare('SELECT 1 FROM receive_orders WHERE id=?').get(receipt.receiveOrder))throw new AppError('INVALID_REQUEST');
    return this.database.transaction(()=>{
      this.teacher(proof);
      const current=this.current();
      if(!current||current.id!==activityId)throw new AppError('ACTIVITY_CHANGED');
      if(current.version!==expectedVersion)throw new AppError('VERSION_CONFLICT');
      const required=action==='start'?'READY':'RUNNING';
      if(current.state!==required)throw new AppError('STATE_CONFLICT');
      if(action==='end'&&receipt.receivedAt<current.started_at!)throw new AppError('STATE_CONFLICT');
      const changed=action==='start'
        ?this.database.prepare("UPDATE activities SET state='RUNNING',started_at=?,version=version+1 WHERE id=? AND state='READY' AND version=?").run(receipt.receivedAt,current.id,current.version)
        :this.database.prepare("UPDATE activities SET state='ENDED',ended_at=?,version=version+1 WHERE id=? AND state='RUNNING' AND version=?").run(receipt.receivedAt,current.id,current.version);
      if(changed.changes!==1)throw new AppError('VERSION_CONFLICT');
      return{activityId:current.id,phase:action==='start'?'RUNNING' as const:'ENDED' as const,version:current.version+1,
        startedAt:action==='start'?receipt.receivedAt:current.started_at,endedAt:action==='end'?receipt.receivedAt:null};
    }).immediate();
  }
  timing(proof:TabProof){
    const subject=this.identity.principal(proof),current=this.current(),serverNow=this.now();
    if(subject.role==='STUDENT'&&current?.id!==subject.activityId)throw new AppError('ACTIVITY_CHANGED');
    return{activityId:current?.id??null,phase:current?.state??'EMPTY',startedAt:current?.started_at??null,endedAt:current?.ended_at??null,serverNow,
      elapsedMs:elapsedMilliseconds(current?.started_at??null,current?.ended_at??null,()=>serverNow)};
  }
  replacementGate(proof:TabProof):ReplacementGate{
    this.teacher(proof);const current=this.current();
    const expectation={activityId:current?.id??null,version:current?.version??null,confirmed:false};
    const operations=current?this.database.prepare("SELECT id,state FROM export_operations WHERE activity_id=? AND state IN ('PREPARING','WRITING','UNCONFIRMED') ORDER BY id").all(current.id) as ReplacementGate['operations']:[];
    if(current?.state==='RUNNING')return{expectation,status:'RUNNING',operations:[],nextAction:'END_ACTIVITY'};
    const source=current?this.database.prepare('SELECT spreadsheet_id,sheet_id FROM sources WHERE activity_id=?').get(current.id) as {spreadsheet_id:string;sheet_id:string}:undefined;
    if(operations.some(op=>op.state!=='UNCONFIRMED')||(source&&this.documents.busy(source.spreadsheet_id,source.sheet_id)))return{expectation,status:'DOCUMENT_BUSY',operations,nextAction:'WAIT'};
    if(operations.length)return{expectation,status:'REQUIRES_RECONCILIATION',operations,nextAction:'RECONCILE_OR_REQUEST_ABANDONMENT_CONFIRMATION',
      confirmationRequests:operations.map(operation=>({operationId:operation.id,activityId:current!.id,expectedVersion:current!.version}))};
    return{expectation,status:current?'CONFIRM_REPLACEMENT':'AVAILABLE',operations:[],nextAction:current?'CONFIRM_REPLACEMENT':'INSPECT_SOURCE'};
  }
  confirmAbandonment(proof:TabProof,operationId:string,version:unknown,confirmed:unknown){
    this.teacher(proof);const actor=this.identity.principal(proof),gate=this.replacementGate(proof),current=this.current();
    if(confirmed!==true)throw new AppError('REPLACEMENT_CONFIRMATION_REQUIRED');
    if(!current||current.version!==version)throw new AppError('VERSION_CONFLICT');
    if(gate.status!=='REQUIRES_RECONCILIATION'||!gate.operations.some(op=>op.id===operationId))throw new AppError('EXPORT_RECONCILIATION_REQUIRED');
    const token=randomBytes(32).toString('hex');this.abandonment.set(token,{sessionId:actor.sessionId,activityId:current.id,version:current.version,operationIds:gate.operations.map(op=>op.id),expiresAt:Math.min(actor.expiresAt,this.now()+600000)});
    return{abandonmentToken:token,activityId:current.id,expectedVersion:current.version,message:'原表可能已修改，不會自動回滾；新活動完整建立成功才清除舊結果，未核實範圍繼續受保護。'};
  }
  private approval(proof:TabProof,token?:string){
    const actor=this.identity.principal(proof),current=this.current(),approval=token?this.abandonment.get(token):undefined;
    if(!approval||approval.sessionId!==actor.sessionId||approval.expiresAt<=this.now()||approval.activityId!==current?.id||approval.version!==current.version)throw new AppError('EXPORT_RECONCILIATION_REQUIRED');
    return approval;
  }
  importGate(proof:TabProof,token?:string){const gate=this.replacementGate(proof);if(gate.status==='REQUIRES_RECONCILIATION'&&token){this.approval(proof,token);return{...gate,status:'CONFIRM_REPLACEMENT' as const};}return gate;}
  async replace(proof:TabProof,candidate:PreparedActivity,expectation:ReplacementExpectation,afterCommit?:(notice:ReplacementNotice)=>void|Promise<void>){
    this.teacher(proof);
    const gate=this.replacementGate(proof);
    if(gate.status==='DOCUMENT_BUSY')throw new AppError('DOCUMENT_OPERATION_BUSY');
    // 12.10 接入經驗證的放棄意圖後才可處理此分支；不得由候選本文自行宣告已核對。
    const approval=gate.status==='REQUIRES_RECONCILIATION'?this.approval(proof,expectation.abandonmentToken):undefined;
    if(gate.status==='RUNNING')throw new AppError('STATE_CONFLICT');
    if(!candidate?.source)throw new AppError('INVALID_REQUEST');
    return this.documents.run(candidate.source.spreadsheetId,candidate.source.sheetId,()=>{
      this.teacher(proof);
      return replacePreparedActivity(this.database,candidate,expectation,afterCommit,approval).then(result=>{if(expectation.abandonmentToken)this.abandonment.delete(expectation.abandonmentToken);return result;});
    });
  }
}
