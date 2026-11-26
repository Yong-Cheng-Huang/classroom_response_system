import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from './database.js';
import { AppError } from '../shared/errors.js';
import { type ExportPlan,valueHash,formatHash } from './export-plan.js';

// 只接收已完成外部讀取／解析的候選；正式範本驗證由第 6 群組完成。
export type PreparedActivity = {
  groupCount: number;
  source: { spreadsheetId: string; sheetId: string; parserVersion: string; snapshot: unknown };
  questions: { number: string; kind: 'SINGLE' | 'GROUP'; fields: {
    label: string | null; prompt: string; answerRange: string; original: unknown;
  }[] }[];
};
export type ReplacementExpectation = { activityId: string | null; version: number | null; confirmed: boolean;abandonmentToken?:string };
export type ReplacementNotice = Readonly<{ activityId: string; previousActivityId: string | null }>;

function nonempty(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new AppError('INVALID_REQUEST');
}
function json(value: unknown): string {
  let text: string | undefined;
  try { text = JSON.stringify(value); } catch { throw new AppError('INVALID_REQUEST'); }
  if (text === undefined) throw new AppError('INVALID_REQUEST'); return text;
}
function prepare(candidate: PreparedActivity) {
  if (!candidate || !Number.isInteger(candidate.groupCount) || candidate.groupCount < 2 || candidate.groupCount > 20
    || !candidate.source || !Array.isArray(candidate.questions) || !candidate.questions.length) throw new AppError('INVALID_REQUEST');
  nonempty(candidate.source.spreadsheetId); nonempty(candidate.source.sheetId); nonempty(candidate.source.parserVersion);
  const numbers = new Set<string>();
  const questions = candidate.questions.map(question => {
    if (!question) throw new AppError('INVALID_REQUEST');
    nonempty(question.number);
    if (numbers.has(question.number) || !['SINGLE', 'GROUP'].includes(question.kind) || !Array.isArray(question.fields) || !question.fields.length
      || (question.kind === 'SINGLE' && question.fields.length !== 1)) throw new AppError('INVALID_REQUEST');
    numbers.add(question.number);
    return { id: randomUUID(), number: question.number, kind: question.kind, fields: question.fields.map(field => {
      if (!field) throw new AppError('INVALID_REQUEST');
      nonempty(field.prompt); nonempty(field.answerRange);
      if (field.label !== null && typeof field.label !== 'string') throw new AppError('INVALID_REQUEST');
      return { id: randomUUID(), label: field.label, prompt: field.prompt, answerRange: field.answerRange, originalJson: json(field.original) };
    }) };
  });
  return { groupCount: candidate.groupCount, questions, source: { spreadsheetId: candidate.source.spreadsheetId,
    sheetId: candidate.source.sheetId, parserVersion: candidate.source.parserVersion, snapshotJson: json(candidate.source.snapshot) } };
}

// 不在外層交易內呼叫，否則 SAVEPOINT 成功不能當作持久提交成功。
// 此內部儲存邊界未接 HTTP；老師授權、文件鎖、確認意圖由後續服務提供。
export async function replacePreparedActivity(database: SqliteDatabase, candidate: PreparedActivity, expectation: ReplacementExpectation,
  afterCommit?: (notice: ReplacementNotice) => void | Promise<void>,abandonment?:{operationIds:string[];activityId:string;version:number}) {
  if (database.inTransaction) throw new AppError('INTERNAL_ERROR');
  const prepared = prepare(candidate); // 全部候選可序列化後才碰原活動。
  let result: ReplacementNotice & { invalidatedSessionIds: string[] };
  try {
    result = database.transaction(() => {
      const current = database.prepare('SELECT id,state,version FROM activities WHERE current_slot=1').get() as {id:string;state:string;version:number}|undefined;
      if ((current?.id ?? null) !== expectation.activityId) throw new AppError('ACTIVITY_CHANGED');
      if ((current?.version ?? null) !== expectation.version) throw new AppError('VERSION_CONFLICT');
      if (current?.state === 'RUNNING') throw new AppError('STATE_CONFLICT');
      if (current && expectation.confirmed !== true) throw new AppError('REPLACEMENT_CONFIRMATION_REQUIRED');
      let invalidatedSessionIds: string[] = [];
      if (current) {
        const exports = database.prepare('SELECT id,state,recovery_plan_json,spreadsheet_id,sheet_id FROM export_operations WHERE activity_id=?').all(current.id) as {id:string;state:string;recovery_plan_json:string;spreadsheet_id:string;sheet_id:string}[];
        if (exports.some(operation => operation.state === 'PREPARING' || operation.state === 'WRITING')) throw new AppError('DOCUMENT_OPERATION_BUSY');
        const unknown=exports.filter(operation=>operation.state==='UNCONFIRMED');
        if(unknown.length){
          if(!abandonment||abandonment.activityId!==current.id||abandonment.version!==current.version||unknown.length!==abandonment.operationIds.length||unknown.some(op=>!abandonment.operationIds.includes(op.id)))throw new AppError('EXPORT_RECONCILIATION_REQUIRED');
          const save=database.prepare(`INSERT INTO document_output_management VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(spreadsheet_id,sheet_id,range_key) DO UPDATE SET verification='UNVERIFIED',content_hash=excluded.content_hash,annotation_start=excluded.annotation_start,original_format_json=excluded.original_format_json,expected_format_hash=excluded.expected_format_hash`);
          for(const op of unknown){const plan=JSON.parse(op.recovery_plan_json) as ExportPlan;if(plan.version!==1||!Array.isArray(plan.changes))throw new AppError('EXPORT_RECONCILIATION_REQUIRED');
            for(const c of plan.changes)save.run(op.spreadsheet_id,op.sheet_id,c.key,'UNVERIFIED',valueHash(c.after),c.annotationStart,JSON.stringify(c.original),formatHash(c.after,c.rowSizeAfter));}
        }
        invalidatedSessionIds = (database.prepare(`SELECT DISTINCT s.id FROM sessions s JOIN participants p ON p.session_id=s.id
          WHERE p.activity_id=? AND s.role='STUDENT' AND s.lifecycle IN ('CONNECTED','GRACE')`).all(current.id) as {id:string}[]).map(row=>row.id);
        database.prepare(`UPDATE sessions SET lifecycle='REVOKED',revoked_reason='活動已更新，請重新選組。',
          state_version=state_version+1,grace_started_at=NULL,grace_deadline=NULL
          WHERE role='STUDENT' AND lifecycle IN ('CONNECTED','GRACE')
          AND id IN (SELECT session_id FROM participants WHERE activity_id=?)`).run(current.id);
        database.prepare('DELETE FROM activities WHERE id=?').run(current.id);
      }
      const activityId = randomUUID();
      database.prepare("INSERT INTO activities(id,state,group_count) VALUES (?,'READY',?)").run(activityId, prepared.groupCount);
      database.prepare('INSERT INTO sources VALUES (?,?,?,?,?)').run(activityId, prepared.source.spreadsheetId,
        prepared.source.sheetId, prepared.source.parserVersion, prepared.source.snapshotJson);
      const group = database.prepare('INSERT INTO groups VALUES (?,?,?)');
      for (let number=1;number<=prepared.groupCount;number++) group.run(randomUUID(),activityId,number);
      const question = database.prepare('INSERT INTO questions VALUES (?,?,?,?,?)');
      const field = database.prepare('INSERT INTO question_fields VALUES (?,?,?,?,?,?,?,?)');
      prepared.questions.forEach((value,position)=>{
        question.run(value.id,activityId,value.number,position,value.kind);
        value.fields.forEach((item,index)=>field.run(item.id,activityId,value.id,index,item.label,item.prompt,item.answerRange,item.originalJson));
      });
      return { activityId, previousActivityId: current?.id ?? null, invalidatedSessionIds };
    }).immediate();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('DATABASE_UNAVAILABLE');
  }
  // COMMIT 已完成；通知錯誤不能把已成功換場誤報為交易失敗。
  let notification: 'NOT_REQUESTED' | 'DISPATCHED' | 'PENDING' = 'NOT_REQUESTED';
  if (afterCommit) {
    try { await afterCommit(Object.freeze({ activityId: result.activityId, previousActivityId: result.previousActivityId })); notification='DISPATCHED'; }
    catch { notification='PENDING'; }
  }
  return { ...result, committed: true as const, notification };
}
