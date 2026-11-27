import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from './database.js';
import type { IdentityService } from './identity.js';
import type { ActivityService } from './activity.js';
import type { SheetsGateway } from './service-account.js';
import type { TabProof } from '../shared/session.js';
import type { ExportMode,ExportState,ExportView } from '../shared/exports.js';
import { AppError,ExportConflict,ExportWriteRejected,errorCatalog,type ErrorCode } from '../shared/errors.js';
import { hash,planExport,matchesPlan,valueHash,formatHash,type Managed,type ExportPlan,type WinningQuestion } from './export-plan.js';
import type { Spreadsheet } from './guided-notes.js';
import type { PreparedActivity } from './activity-replacement.js';

type Row={id:string;activity_id:string;spreadsheet_id:string;sheet_id:string;mode:ExportMode;state:ExportState;recovery_plan_json:string;request_hash:string;created_at:number;updated_at:number};
export type ExportIO={read:(proof:TabProof,id:string,sheetId:string)=>Promise<Spreadsheet>;write:(proof:TabProof,id:string,requests:unknown[])=>Promise<void>};
const messages:Record<ExportState,string>={PREPARING:'正在完整預檢，請保持暫停外部編輯。',WRITING:'整批寫入中，請保持暫停外部編輯。',COMPLETED:'匯出完成且已核對，可以恢復編輯。',FAILED:'本次已確認沒有寫入，可以恢復編輯。',UNCONFIRMED:'結果待確認，原表可能已修改；請保持暫停外部編輯並再次核對，不要盲目重送。'};
export class ExportService {
 private readonly io:ExportIO;
 private active=new Set<string>();
 constructor(private readonly db:SqliteDatabase,private readonly identity:IdentityService,private readonly sheets:SheetsGateway,private readonly activities:ActivityService,private readonly now:()=>number=Date.now,io?:ExportIO){
  this.io=io??{read:async(p,id)=>await sheets.spreadsheet(p,id,{includeGridData:'true'}) as Spreadsheet,write:(p,id,requests)=>sheets.batchUpdate(p,id,requests)};
  db.prepare("UPDATE export_operations SET state=CASE WHEN state='PREPARING' THEN 'FAILED' ELSE 'UNCONFIRMED' END,updated_at=? WHERE state IN ('PREPARING','WRITING')").run(now());
 }
 private teacher(proof:TabProof){const actor=this.identity.principal(proof);if(actor.role!=='TEACHER')throw new AppError('FORBIDDEN');return actor;}
 private row(id:string){const row=this.db.prepare('SELECT * FROM export_operations WHERE id=?').get(id) as Row|undefined;if(!row)throw new AppError('NOT_FOUND');return row;}
 private current(activityId:string){const current=this.db.prepare('SELECT id,state,version,group_count FROM activities WHERE current_slot=1').get() as {id:string;state:string;version:number;group_count:number}|undefined;if(current?.id!==activityId)throw new AppError('ACTIVITY_CHANGED');if(current.state!=='ENDED')throw new AppError('STATE_CONFLICT');return current;}
 private same(row:Row){const fresh=this.row(row.id);if(fresh.activity_id!==row.activity_id)throw new AppError('ACTIVITY_CHANGED');this.current(row.activity_id);return fresh;}
 private sameAccount(row:Row){const access=JSON.parse(row.recovery_plan_json).access;return access?.mode==='SERVICE_ACCOUNT'&&access.accountId===this.sheets.accountId;}
 private view(row:Row):ExportView{let message=messages[row.state];if(row.state==='FAILED'&&JSON.parse(row.recovery_plan_json).cancelled)message='已取消預檢，確認沒有寫入，可以恢復編輯。';const failure=JSON.parse(row.recovery_plan_json).failure as {code:ErrorCode;range?:string}|undefined;if(failure&&row.state==='FAILED')message+=((['GOOGLE_REAUTHORIZE','GOOGLE_NOT_CONFIGURED','GOOGLE_CONFIGURATION_INVALID','GOOGLE_AUTH_FAILED','GOOGLE_ACCESS_DENIED','OAUTH_STATE_INVALID'].includes(failure.code)?'此舊操作的個人Google授權已停用，請使用服務帳戶核對。':errorCatalog[failure.code]?.message??'請重新核對。'))+(failure.range?`（${failure.range}）`:'');return{requiresCredentialConfirmation:!this.sameAccount(row),accountEmail:this.sheets.accountId,id:row.id,activityId:row.activity_id,mode:row.mode,state:row.state,message,updatedAt:row.updated_at};}
 private recoverIdle(){
  const rows=this.db.prepare("SELECT * FROM export_operations WHERE state IN ('PREPARING','WRITING')").all() as Row[];
  for(const row of rows)if(!this.active.has(row.id)&&!this.activities.documents.busy(row.spreadsheet_id,row.sheet_id))this.db.prepare("UPDATE export_operations SET state=?,updated_at=? WHERE id=? AND state=?").run(row.state==='PREPARING'?'FAILED':'UNCONFIRMED',this.now(),row.id,row.state);
 }
 list(proof:TabProof,activityId:string){this.teacher(proof);this.recoverIdle();this.current(activityId);return(this.db.prepare('SELECT * FROM export_operations WHERE activity_id=? ORDER BY created_at DESC,rowid DESC').all(activityId) as Row[]).map(r=>this.view(r));}
 get(proof:TabProof,id:string){this.teacher(proof);this.recoverIdle();const row=this.row(id);this.current(row.activity_id);return this.view(row);}
 begin(proof:TabProof,activityId:string,input:{requestId:unknown;mode:unknown;paused:unknown;expectedVersion:unknown;accessMode?:unknown}){
  this.teacher(proof);if(input.accessMode!=='SERVICE_ACCOUNT')throw new AppError('SHEETS_ACCESS_MODE_REQUIRED');this.recoverIdle();const current=this.current(activityId);
  if(input.paused!==true)throw new AppError('EXPORT_PAUSE_REQUIRED');if(current.version!==input.expectedVersion)throw new AppError('VERSION_CONFLICT');
  if(typeof input.requestId!=='string'||!input.requestId.trim()||!['ANSWERS','COLUMNS','INLINE'].includes(String(input.mode)))throw new AppError('INVALID_REQUEST');
  const fingerprint=hash({activityId,requestId:input.requestId}),prior=this.db.prepare('SELECT * FROM export_operations WHERE activity_id=? AND request_hash=?').get(activityId,fingerprint) as Row|undefined;
  if(prior){if(prior.mode!==input.mode)throw new AppError('REQUEST_ID_CONFLICT');if(!this.sameAccount(prior))throw new AppError('CREDENTIAL_CHANGE_CONFIRMATION_REQUIRED');return{proof,row:prior,existing:true};}
  const busy=this.db.prepare("SELECT state FROM export_operations WHERE activity_id=? AND state IN ('PREPARING','WRITING','UNCONFIRMED')").get(activityId) as {state:ExportState}|undefined;
  if(busy)throw new AppError(busy.state==='UNCONFIRMED'?'EXPORT_RECONCILIATION_REQUIRED':'DOCUMENT_OPERATION_BUSY');
  const source=this.db.prepare('SELECT spreadsheet_id,sheet_id FROM sources WHERE activity_id=?').get(activityId) as {spreadsheet_id:string;sheet_id:string};
  if(this.activities.documents.busy(source.spreadsheet_id,source.sheet_id))throw new AppError('DOCUMENT_OPERATION_BUSY');
  this.sheets.assertConfigured();
  const id=randomUUID(),time=this.now();this.db.prepare('INSERT INTO export_operations VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,activityId,source.spreadsheet_id,source.sheet_id,input.mode,'PREPARING',JSON.stringify({access:{mode:'SERVICE_ACCOUNT',accountId:this.sheets.accountId}}),fingerprint,time,time);
  this.active.add(id);return{proof,row:this.row(id),existing:false};
 }
 private save(row:Row,state:ExportState,plan:Partial<ExportPlan>){this.same(row);this.db.prepare('UPDATE export_operations SET state=?,recovery_plan_json=?,updated_at=? WHERE id=?').run(state,JSON.stringify({...plan,access:JSON.parse(this.row(row.id).recovery_plan_json).access}),this.now(),row.id);return this.view(this.row(row.id));}
 cancel(proof:TabProof,id:string){this.teacher(proof);this.recoverIdle();const row=this.row(id);this.same(row);if(row.state!=='PREPARING')throw new AppError('DOCUMENT_OPERATION_BUSY');return this.save(row,'FAILED',{cancelled:true});}
 private material(row:Row){
  const current=this.current(row.activity_id),source=this.db.prepare('SELECT spreadsheet_id,sheet_id,parser_version,snapshot_json FROM sources WHERE activity_id=?').get(row.activity_id) as {spreadsheet_id:string;sheet_id:string;parser_version:string;snapshot_json:string};
  const questions=(this.db.prepare('SELECT id,number,kind FROM questions WHERE activity_id=? ORDER BY position').all(row.activity_id) as {id:string;number:string;kind:'SINGLE'|'GROUP'}[]).map(q=>{
   const fields=this.db.prepare('SELECT id,label,prompt,answer_range AS answerRange,original_json FROM question_fields WHERE question_id=? ORDER BY position').all(q.id) as (WinningQuestion['fields'][number]&{original_json:string})[];
   const submission=this.db.prepare('SELECT id,sender_nickname,received_at,group_id FROM submissions WHERE question_id=? AND rank=1 AND sealed=1').get(q.id) as {id:string;sender_nickname:string;received_at:number;group_id:string}|undefined;
   const group=submission&&this.db.prepare('SELECT number FROM groups WHERE id=?').get(submission.group_id) as {number:number}|undefined;
   return{number:q.number,kind:q.kind,fields,winner:submission&&group?{sender:submission.sender_nickname,receivedAt:submission.received_at,groupNumber:group.number,answers:this.db.prepare('SELECT field_id AS fieldId,answer_text AS text FROM submission_answers WHERE submission_id=?').all(submission.id) as {fieldId:string;text:string}[]}:undefined};
  });
  const candidate:PreparedActivity={groupCount:current.group_count,source:{spreadsheetId:source.spreadsheet_id,sheetId:source.sheet_id,parserVersion:source.parser_version,snapshot:JSON.parse(source.snapshot_json)},questions:questions.map(q=>({...q,fields:q.fields.map(f=>({...f,original:JSON.parse(f.original_json)}))}))};
  const managed=this.db.prepare('SELECT * FROM document_output_management WHERE spreadsheet_id=? AND sheet_id=?').all(row.spreadsheet_id,row.sheet_id) as Managed[];
  return{candidate,questions,managed};
 }
 private complete(row:Row,plan:ExportPlan){
  return this.db.transaction(()=>{
   this.same(row);const save=this.db.prepare(`INSERT INTO document_output_management VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(spreadsheet_id,sheet_id,range_key) DO UPDATE SET verification=excluded.verification,content_hash=excluded.content_hash,annotation_start=excluded.annotation_start,original_format_json=excluded.original_format_json,expected_format_hash=excluded.expected_format_hash`);
   for(const c of plan.changes){const prior=this.db.prepare('SELECT verification FROM document_output_management WHERE spreadsheet_id=? AND sheet_id=? AND range_key=?').get(row.spreadsheet_id,row.sheet_id,c.key) as {verification:string}|undefined;if(prior?.verification==='UNVERIFIED')throw new ExportConflict(c.key,'EXPORT_UNVERIFIED');save.run(row.spreadsheet_id,row.sheet_id,c.key,'VERIFIED',valueHash(c.after),c.annotationStart,JSON.stringify(c.original),formatHash(c.after,c.rowSizeAfter));}
   return this.save(row,'COMPLETED',plan);
  }).immediate();
 }
 async execute(work:ReturnType<ExportService['begin']>){
  const {row,proof}=work;if(!this.sameAccount(row))throw new AppError('CREDENTIAL_CHANGE_CONFIRMATION_REQUIRED');if(work.existing)return row.state==='UNCONFIRMED'?this.reconcile(proof,row.id):this.get(proof,row.id);
  try{return await this.activities.documents.run(row.spreadsheet_id,row.sheet_id,async()=>{
   let plan:ExportPlan|undefined;
   try{
    const remote=await this.io.read(proof,row.spreadsheet_id,row.sheet_id);this.teacher(proof);if(this.same(row).state!=='PREPARING')return this.get(proof,row.id);
    const material=this.material(row);plan=planExport(material.candidate,material.questions,remote,material.managed,row.mode);
    // 全部恢復資料必須先 COMMIT，才允許送出第一個外部寫入。
    this.save(row,'WRITING',plan);
   }catch(error){if(this.same(row).state!=='PREPARING')return this.get(proof,row.id);return this.save(row,'FAILED',{...plan,failure:{code:error instanceof AppError?error.code:'EXTERNAL_UNAVAILABLE',...(error instanceof ExportConflict?{range:error.range}:{})}});}
   try{
    if(plan.requests.length)await this.io.write(proof,row.spreadsheet_id,plan.requests);
    const remote=await this.io.read(proof,row.spreadsheet_id,row.sheet_id);this.same(row);if(!matchesPlan(remote,plan,'after'))return this.save(row,'UNCONFIRMED',plan);
    return this.complete(row,plan);
   }catch(error){return this.save(row,error instanceof ExportWriteRejected?'FAILED':'UNCONFIRMED',{...plan,...(error instanceof ExportWriteRejected?{failure:{code:error.code}}:{})});}
  });}finally{this.active.delete(row.id);}
 }
 async reconcile(proof:TabProof,id:string,acknowledgeCredentialChange:unknown=false){
  this.teacher(proof);this.recoverIdle();const row=this.row(id);this.same(row);if(row.state!=='UNCONFIRMED')return this.view(row);if(!this.sameAccount(row)&&acknowledgeCredentialChange!==true)throw new AppError('CREDENTIAL_CHANGE_CONFIRMATION_REQUIRED');
  return this.activities.documents.run(row.spreadsheet_id,row.sheet_id,async()=>{
   const plan=JSON.parse(row.recovery_plan_json) as ExportPlan;
   try{const remote=await this.io.read(proof,row.spreadsheet_id,row.sheet_id);this.teacher(proof);this.same(row);if(plan.version===1&&matchesPlan(remote,plan,'after'))return this.complete(row,plan);}
   catch{/* 無法讀取或核對仍是不明；不能宣稱沒有寫入，也不自動重送。 */}
   return this.view(this.row(id));
  });
 }
}
