import { createHash } from 'node:crypto';
import { parseGuidedNotes,type Cell,type Spreadsheet,type Sheet } from './guided-notes.js';
import type { ExportMode } from '../shared/exports.js';
import { ExportConflict } from '../shared/errors.js';
import type { PreparedActivity } from './activity-replacement.js';
import { formatSubmissionTime } from './time.js';

type ObjectValue=Record<string,unknown>;
export type Managed={spreadsheet_id:string;sheet_id:string;range_key:string;verification:'VERIFIED'|'UNVERIFIED';content_hash:string;annotation_start:number|null;original_format_json:string;expected_format_hash:string};
export type OriginalFormat={format:ObjectValue;runs:unknown[];row:number;column:number;rowSize:number;wrap:unknown;font:ObjectValue;columns:number[]};
export type CellChange={key:string;before:Cell;after:Cell;fields:string;original:OriginalFormat;annotationStart:number|null;rowSizeBefore:number;rowSizeAfter:number};
export type ExportPlan={version:1;spreadsheetId:string;sheetId:string;changes:CellChange[];requests:unknown[];cancelled?:boolean;failure?:{code:string;range?:string}};
export type WinningQuestion={number:string;kind:'SINGLE'|'GROUP';fields:{id:string;label:string|null;prompt:string;answerRange:string}[];winner?:{groupNumber:number;sender:string;receivedAt:number;answers:{fieldId:string;text:string}[]}};
const record=(value:unknown):ObjectValue=>value&&typeof value==='object'&&!Array.isArray(value)?value as ObjectValue:{};
const canon=(value:unknown):unknown=>Array.isArray(value)?value.map(canon):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canon(v)])):value;
export const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canon(value))).digest('hex');
export const valueHash=(cell:Cell)=>hash(cell.userEnteredValue??{});
// Google 會省略 startIndex=0、補回舊式色彩欄位，並以 8-bit 色彩回傳。
// 正規化等價表示後核對，仍保留字型、字級、樣式及每個色彩位元組。
function formatValue(value:unknown):unknown{
 if(Array.isArray(value))return value.map(formatValue);
 if(!value||typeof value!=='object')return value;
 const object={...value as Record<string,unknown>};if(object.foregroundColorStyle!==undefined)delete object.foregroundColor;if(object.backgroundColorStyle!==undefined)delete object.backgroundColor;if(object.colorStyle!==undefined)delete object.color;
 return Object.fromEntries(Object.entries(object).map(([key,v])=>[key,key==='rgbColor'?Object.fromEntries(['red','green','blue','alpha'].filter(k=>k!=='alpha'||record(v)[k]!==undefined).map(k=>[k,Math.round(Number(record(v)[k]??0)*255)])):formatValue(v)]));
}
export const formatHash=(cell:Cell,rowSize:number)=>hash({format:formatValue(cell.userEnteredFormat??{}),runs:(cell.textFormatRuns as {startIndex?:number}[]??[]).map(run=>({...formatValue(run) as object,startIndex:run.startIndex??0})),rowSize});
export function coordinates(key:string){const m=key.match(/^([A-Z]+)(\d+)$/u);if(!m)throw new ExportConflict(key);return{r:Number(m[2])-1,c:[...m[1]!].reduce((n,v)=>n*26+v.charCodeAt(0)-64,0)-1};}
export function sheetGrid(sheet:Sheet){
 const cells=new Map<string,Cell>(),rows=new Map<number,number>(),columns=new Map<number,number>();
 const a1=(r:number,c:number)=>{let name='';for(let n=c+1;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name+(r+1);};
 for(const grid of sheet.data??[]){const r=grid.startRow??0,c=grid.startColumn??0;(grid.rowData??[]).forEach((row,i)=>(row.values??[]).forEach((cell,j)=>cells.set(a1(r+i,c+j),cell)));(grid.rowMetadata??[]).forEach((meta,i)=>{const n=record(meta).pixelSize;if(typeof n==='number')rows.set(r+i,n);});(grid.columnMetadata??[]).forEach((meta,i)=>{const n=record(meta).pixelSize;if(typeof n==='number')columns.set(c+i,n);});}
 return{cell:(key:string)=>cells.get(key)??{},row:(r:number)=>rows.get(r)??21,column:(c:number)=>columns.get(c)??100};
}
const shape=(questions:PreparedActivity['questions'])=>questions.map(q=>({number:q.number,kind:q.kind,fields:q.fields.map(f=>({label:f.label,prompt:f.prompt,answerRange:f.answerRange}))}));
export function planExport(source:PreparedActivity,questions:WinningQuestion[],remote:Spreadsheet,managed:Managed[],mode:ExportMode):ExportPlan{
 const id=source.source.sheetId,sheet=remote.sheets.find(s=>String(s.properties.sheetId)===id);if(!sheet||remote.spreadsheetId!==source.source.spreadsheetId)throw new ExportConflict('工作表');
 let fresh:PreparedActivity;try{fresh=parseGuidedNotes(remote,id,source.groupCount);}catch{throw new ExportConflict('B:H 題目與合併結構');}
 if(hash(shape(fresh.questions))!==hash(shape(source.questions)))throw new ExportConflict('B:H 全部題目');
 const priorSnapshot=record(source.source.snapshot),oldSheet=priorSnapshot.sheet as Sheet|undefined;if(!oldSheet)throw new ExportConflict('來源快照');
 const grid=sheetGrid(sheet),baseline=sheetGrid(oldSheet),changes:CellChange[]=[];
 const entries=new Map(managed.map(m=>[m.range_key,m]));
 const targetKeys=new Set<string>(['I4','J4','K4']);for(const q of questions)for(const f of q.fields){const key=f.answerRange.split(':')[0]!;targetKeys.add(key);const row=coordinates(key).r+1;for(const c of ['I','J','K'])targetKeys.add(c+row);}
 // 舊管理區仍須核對，移除與還原不能猜測歸屬；未核實重疊一律停止。
 const protectedTargets=new Set(targetKeys);for(const q of questions)for(const f of q.fields)if(f.answerRange.includes(':'))protectedTargets.add(f.answerRange.split(':')[1]!);
 for(const m of managed)if(m.verification==='UNVERIFIED'){
  const prior=coordinates(m.range_key),width=m.range_key.startsWith('G')?2:1;
  if([...protectedTargets].some(key=>{const p=coordinates(key);return p.r===prior.r&&p.c>=prior.c&&p.c<prior.c+width;}))throw new ExportConflict(m.range_key,'EXPORT_UNVERIFIED');
 }
 const effectiveDefault=record(record(remote.properties).defaultFormat);
 function add(key:string,text:string|undefined,inlineNote?:string){
  const before=structuredClone(grid.cell(key)),position=coordinates(key),prior=entries.get(key);
  if(prior){if(prior.verification!=='VERIFIED')throw new ExportConflict(key,'EXPORT_UNVERIFIED');if(valueHash(before)!==prior.content_hash||formatHash(before,grid.row(position.r))!==prior.expected_format_hash)throw new ExportConflict(key);}
  else if(hash({value:before.userEnteredValue??{},format:before.userEnteredFormat??{},runs:before.textFormatRuns??[]})!==hash({value:baseline.cell(key).userEnteredValue??{},format:baseline.cell(key).userEnteredFormat??{},runs:baseline.cell(key).textFormatRuns??[]}))throw new ExportConflict(key);
  const format=record(before.userEnteredFormat),effective=record(before.effectiveFormat),font=record(effective.textFormat??format.textFormat??effectiveDefault.textFormat);
  const original:OriginalFormat=prior?JSON.parse(prior.original_format_json):{format:structuredClone(format),runs:structuredClone(before.textFormatRuns as unknown[]??[]),row:position.r,column:position.c,rowSize:grid.row(position.r),wrap:format.wrapStrategy??null,font,columns:[grid.column(position.c),grid.column(position.c+1)]};
  let base=text;
  if(base===undefined){const current=before.userEnteredValue?.stringValue;if(prior?.annotation_start!==null&&prior?.annotation_start!==undefined){if(typeof current!=='string')throw new ExportConflict(key);base=current.slice(0,prior.annotation_start);}else return;}
  const after=structuredClone(before),inline=inlineNote!==undefined,answer=inline?base+'\n'+inlineNote:base;
  after.userEnteredValue=answer===''?{}:{stringValue:answer};delete after.formattedValue;delete after.effectiveValue;
  let fields='userEnteredValue,textFormatRuns';
  const baseFont=original.font;
  after.textFormatRuns=inline?[{startIndex:0,format:baseFont},{startIndex:base.length+1,format:{fontFamily:baseFont.fontFamily??'Arial',fontSize:9,foregroundColorStyle:{rgbColor:{red:127/255,green:127/255,blue:127/255}}}}]:[];
  let rowSizeAfter=grid.row(position.r);
  if(inline||prior?.annotation_start!==null&&prior?.annotation_start!==undefined){
   const next=structuredClone(format);if(inline)next.wrapStrategy='WRAP';else if(original.wrap===null)delete next.wrapStrategy;else next.wrapStrategy=original.wrap;
   after.userEnteredFormat=next;fields+=',userEnteredFormat.wrapStrategy';
   // 保守按每個 Unicode code point 的兩個字寬預留空間，避免合併格自動列高不可靠。
   const width=Math.max(1,original.columns.slice(0,key.startsWith('G')?2:1).reduce((a,b)=>a+b,0)-12),fontSize=typeof baseFont.fontSize==='number'?baseFont.fontSize:12;
   const lines=(value:string,size:number)=>value.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil([...line].length*size*2/width)),0);
   rowSizeAfter=inline?Math.max(original.rowSize,Math.ceil(lines(base,fontSize)*fontSize*1.8+lines(inlineNote!,9)*18+12)):original.rowSize;
  }
  changes.push({key,before,after,fields,original,annotationStart:inline?base.length:null,rowSizeBefore:grid.row(position.r),rowSizeAfter});
 }
 // 驗證全部答案，包含無人題；合併格只對左上格寫入。
 for(const q of questions)for(const field of q.fields){const key=field.answerRange.split(':')[0]!,prior=entries.get(key);const current=grid.cell(key);
  if(!prior&&valueHash(current)!==valueHash(baseline.cell(key)))throw new ExportConflict(key);
  const answer=q.winner?.answers.find(a=>a.fieldId===field.id)?.text;if(q.winner&&answer===undefined)throw new ExportConflict(key);
  const note=q.winner&&mode==='INLINE'?`組別：第 ${q.winner.groupNumber} 組｜送出者：${q.winner.sender}｜提交時間：${formatSubmissionTime(q.winner.receivedAt)}`:undefined;
  add(key,answer,note);
  // 單題 G:H 右格也須核對，不能只驗左上格。
  if(field.answerRange.includes(':')&&(hash(grid.cell('H'+(coordinates(key).r+1)).userEnteredValue??{})!==hash(baseline.cell('H'+(coordinates(key).r+1)).userEnteredValue??{})||formatHash(grid.cell('H'+(coordinates(key).r+1)),0)!==formatHash(baseline.cell('H'+(coordinates(key).r+1)),0)))throw new ExportConflict(field.answerRange);
 }
 const columnKeys=[...targetKeys].filter(key=>/^[IJK]/u.test(key));
 for(const key of columnKeys){if(mode!=='COLUMNS'&&!entries.has(key))continue;const p=coordinates(key);if((sheet.merges??[]).some(m=>(m.startRowIndex??0)<=p.r&&p.r<m.endRowIndex&&(m.startColumnIndex??0)<=p.c&&p.c<m.endColumnIndex))throw new ExportConflict(key);
  const prior=entries.get(key),value=grid.cell(key).userEnteredValue;
  if(!prior&&value&&Object.keys(value).length)throw new ExportConflict(key);
  let text='';if(mode==='COLUMNS'){
   if(p.r===3)text=['組別','提交時間','送出者'][p.c-8]!;
   else{const q=questions.find(q=>q.fields.some(f=>coordinates(f.answerRange.split(':')[0]!).r===p.r));const w=q?.winner;if(w)text=p.c===8?`第 ${w.groupNumber} 組`:p.c===9?formatSubmissionTime(w.receivedAt):w.sender;}
  }
  if(mode==='COLUMNS'||prior)add(key,text);
 }
 // 清除可核對的舊附加資訊；舊答案文字不因此刪除。
 for(const m of managed)if(!targetKeys.has(m.range_key)&&m.verification==='VERIFIED'){
  if(/^[IJK]/u.test(m.range_key))add(m.range_key,'');else if(m.annotation_start!==null)add(m.range_key,undefined);
 }
 for(const m of managed)if(m.verification==='UNVERIFIED'&&changes.some(c=>c.rowSizeAfter!==c.rowSizeBefore&&c.original.row===coordinates(m.range_key).r))throw new ExportConflict(m.range_key,'EXPORT_UNVERIFIED');
 const columnCount=Number(record(sheet.properties.gridProperties).columnCount);if(Number.isFinite(columnCount))for(const m of managed)if(coordinates(m.range_key).c>=columnCount)throw new ExportConflict(m.range_key);
 const requests:unknown[]=changes.map(change=>{const p=coordinates(change.key);return{updateCells:{range:{sheetId:Number(id),startRowIndex:p.r,endRowIndex:p.r+1,startColumnIndex:p.c,endColumnIndex:p.c+1},rows:[{values:[Object.fromEntries(change.fields.split(',').map(f=>f.split('.')[0]!).filter((f,i,a)=>a.indexOf(f)===i).map(f=>[f,change.after[f]??(f==='textFormatRuns'?[]:{})]))]}],fields:change.fields}};});
 if(mode==='COLUMNS'&&Number.isInteger(columnCount)&&columnCount<11)requests.unshift({appendDimension:{sheetId:Number(id),dimension:'COLUMNS',length:11-columnCount}});
 const rows=new Map<number,number>();for(const c of changes)if(c.rowSizeAfter!==c.rowSizeBefore)rows.set(c.original.row,Math.max(rows.get(c.original.row)??0,c.rowSizeAfter));
 for(const [row,size]of rows)requests.push({updateDimensionProperties:{range:{sheetId:Number(id),dimension:'ROWS',startIndex:row,endIndex:row+1},properties:{pixelSize:size},fields:'pixelSize'}});
 for(const c of changes)c.rowSizeAfter=rows.get(c.original.row)??c.rowSizeAfter;
 return{version:1,spreadsheetId:remote.spreadsheetId,sheetId:id,changes,requests};
}
export function matchesPlan(remote:Spreadsheet,plan:ExportPlan,side:'before'|'after'){
 const sheet=remote.sheets.find(s=>String(s.properties.sheetId)===plan.sheetId);if(!sheet)return false;const grid=sheetGrid(sheet);
 return plan.changes.every(c=>valueHash(grid.cell(c.key))===valueHash(c[side])&&formatHash(grid.cell(c.key),grid.row(c.original.row))===formatHash(c[side],side==='before'?c.rowSizeBefore:c.rowSizeAfter));
}
