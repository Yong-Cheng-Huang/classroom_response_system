import { randomBytes } from 'node:crypto';
import type { SqliteDatabase } from './database.js';
import type { IdentityService } from './identity.js';
import type { GoogleService } from './google.js';
import type { ActivityService } from './activity.js';
import type { TabProof } from '../shared/session.js';
import type { PreparedActivity,ReplacementExpectation } from './activity-replacement.js';
import { parseGuidedNotes,parseSheetsUrl,type Spreadsheet } from './guided-notes.js';
import { AppError } from '../shared/errors.js';
import { PublicSheetsReader } from './public-sheets.js';
import type { ImportView } from '../shared/imports.js';

export type ImportAccessMode='PUBLIC'|'OAUTH';
type Intent={accessMode:ImportAccessMode;sessionId:string;expiresAt:number;expectation:ReplacementExpectation;spreadsheetId:string;sheetId:string|null;groupCount:number;googleRevision:number;candidate?:PreparedActivity;sheetChoices?:{id:string;title:string}[]};
export class ImportService {
  private intents=new Map<string,Intent>();
  constructor(private readonly database:SqliteDatabase,private readonly identity:IdentityService,private readonly google:GoogleService,
    private readonly activities:ActivityService,private readonly now:()=>number=Date.now,
    private readonly readSource=(proof:TabProof,id:string,params:Record<string,string>)=>google.spreadsheet(proof,id,params),
    private readonly publicReader:PublicSheetsReader=new PublicSheetsReader(undefined)){}
  private teacher(proof:TabProof){const actor=this.identity.principal(proof);if(actor.role!=='TEACHER')throw new AppError('FORBIDDEN');return actor;}
  begin(proof:TabProof,url:unknown,groupCount:unknown,abandonmentToken?:string,accessMode:unknown='OAUTH'){
    const actor=this.teacher(proof),source=parseSheetsUrl(url);
    if(accessMode!=='PUBLIC'&&accessMode!=='OAUTH')throw new AppError('INVALID_REQUEST');
    if(typeof groupCount!=='number'||!Number.isInteger(groupCount)||groupCount<2||groupCount>20)throw new AppError('INVALID_GROUP_COUNT');
    const gate=this.activities.importGate(proof,abandonmentToken);
    if(gate.status==='RUNNING')throw new AppError('STATE_CONFLICT');
    if(gate.status==='DOCUMENT_BUSY')throw new AppError('DOCUMENT_OPERATION_BUSY');
    if(gate.status==='REQUIRES_RECONCILIATION')throw new AppError('EXPORT_RECONCILIATION_REQUIRED');
    if(accessMode==='OAUTH')this.google.assertRevision(this.google.revision());
    else if(!this.publicReader.configured)throw new AppError('PUBLIC_SHEETS_NOT_CONFIGURED');
    for(const [token,intent]of this.intents)if(intent.expiresAt<=this.now())this.intents.delete(token);
    const token=randomBytes(32).toString('hex');
    const intent:Intent={accessMode,sessionId:actor.sessionId,expiresAt:Math.min(actor.expiresAt,this.now()+600000),expectation:{...gate.expectation,...(abandonmentToken?{abandonmentToken}:{})},
      spreadsheetId:source.spreadsheetId,sheetId:source.sheetId,groupCount,googleRevision:this.google.revision()};
    this.intents.set(token,intent);return{token,intent,proof};
  }
  private check(proof:TabProof,intent:Intent){
    const actor=this.teacher(proof);
    if(actor.sessionId!==intent.sessionId||intent.expiresAt<=this.now())throw new AppError('IMPORT_EXPIRED');
    if(intent.accessMode==='OAUTH')this.google.assertRevision(intent.googleRevision);
    const current=this.database.prepare('SELECT id,version,state FROM activities WHERE current_slot=1').get() as {id:string;version:number;state:string}|undefined;
    if((current?.id??null)!==intent.expectation.activityId)throw new AppError('ACTIVITY_CHANGED');
    if((current?.version??null)!==intent.expectation.version)throw new AppError('VERSION_CONFLICT');
    if(current?.state==='RUNNING')throw new AppError('STATE_CONFLICT');
  }
  options(proof:TabProof){this.teacher(proof);return{publicConfigured:this.publicReader.configured};}
  private read(proof:TabProof,intent:Intent,params:Record<string,string>){
    return intent.accessMode==='PUBLIC'?this.publicReader.spreadsheet(intent.spreadsheetId,params):this.readSource(proof,intent.spreadsheetId,params);
  }
  private find(proof:TabProof,token:string){const intent=this.intents.get(token);if(!intent)throw new AppError('IMPORT_EXPIRED');this.check(proof,intent);return intent;}
  private view(token:string,intent:Intent):ImportView{
    if(!intent.candidate)return{inspectionToken:token,stage:'SELECT_SHEET',sheets:intent.sheetChoices,groupCount:intent.groupCount,needsReplacementConfirmation:intent.expectation.activityId!==null};
    return{inspectionToken:token,stage:'READY',groupCount:intent.groupCount,questionCount:intent.candidate.questions.length,
      fieldCount:intent.candidate.questions.reduce((n,q)=>n+q.fields.length,0),needsReplacementConfirmation:intent.expectation.activityId!==null};
  }
  async inspect(work:ReturnType<ImportService['begin']>){
    const {token,intent,proof}=work;this.check(proof,intent);
    const raw=await this.read(proof,intent,{fields:'spreadsheetId,sheets(properties)'});
    this.check(proof,intent);const metadata=raw as Spreadsheet;
    if(!metadata||!Array.isArray(metadata.sheets)||!metadata.sheets.length)throw new AppError('GUIDED_NOTES_FORMAT');
    const sheets=metadata.sheets.map(s=>({id:String(s.properties.sheetId),title:s.properties.title}));
    if(intent.sheetId===null&&sheets.length>1){intent.sheetChoices=sheets;return this.view(token,intent);}
    intent.sheetId??=sheets[0]!.id;
    const selected=sheets.find(s=>s.id===intent.sheetId);if(!selected)throw new AppError('GOOGLE_SHEET_NOT_FOUND');
    return this.readCandidate(proof,token,intent,selected);
  }
  prepareSelect(proof:TabProof,token:string,sheetId:unknown){
    const intent=this.find(proof,token);
    if(typeof sheetId!=='string'||!intent.sheetChoices?.some(s=>s.id===sheetId))throw new AppError('GOOGLE_SHEET_NOT_FOUND');
    const selected=intent.sheetChoices.find(s=>s.id===sheetId)!,next=randomBytes(32).toString('hex');
    const candidate={...intent,sheetId,candidate:undefined,sheetChoices:undefined};
    this.intents.delete(token);this.intents.set(next,candidate);
    return{proof,token:next,intent:candidate,selected};
  }
  select(work:ReturnType<ImportService['prepareSelect']>){return this.readCandidate(work.proof,work.token,work.intent,work.selected);}
  private async readCandidate(proof:TabProof,token:string,intent:Intent,selected:{id:string;title:string}){
    this.check(proof,intent);
    const raw=await this.read(proof,intent,{ranges:"'"+selected.title.replaceAll("'","''")+"'!B:K",fields:'spreadsheetId,properties,sheets(properties,merges,data)'});
    this.check(proof,intent);const candidate=parseGuidedNotes(raw as Spreadsheet,selected.id,intent.groupCount);
    if(candidate.source.spreadsheetId!==intent.spreadsheetId)throw new AppError('GUIDED_NOTES_FORMAT');
    intent.sheetId=selected.id;intent.candidate=candidate;return this.view(token,intent);
  }
  async commit(proof:TabProof,token:string,confirmed:unknown){
    const intent=this.find(proof,token);
    if(typeof confirmed!=='boolean')throw new AppError('INVALID_REQUEST');
    if(!intent.candidate)throw new AppError('GUIDED_NOTES_FORMAT');
    const result=await this.activities.replace(proof,intent.candidate,{...intent.expectation,confirmed});
    this.intents.delete(token);return{activityId:result.activityId,phase:'READY' as const,committed:true};
  }
  cancel(proof:TabProof,token:string){this.find(proof,token);this.intents.delete(token);return{canceled:true};}
}
