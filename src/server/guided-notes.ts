import { AppError } from '../shared/errors.js';
import type { PreparedActivity } from './activity-replacement.js';

export type GridRange={startRowIndex?:number;endRowIndex:number;startColumnIndex?:number;endColumnIndex:number};
export type Cell=Record<string,unknown>&{formattedValue?:string;userEnteredValue?:{stringValue?:string;numberValue?:number;boolValue?:boolean;formulaValue?:string}};
export type GridData={startRow?:number;startColumn?:number;rowData?:{values?:Cell[]}[];rowMetadata?:unknown[];columnMetadata?:unknown[]};
export type Sheet={properties:{sheetId:number;title:string;[key:string]:unknown};merges?:GridRange[];data?:GridData[]};
export type Spreadsheet={spreadsheetId:string;properties?:unknown;sheets:Sheet[]};
type Range={r:number;e:number;c:number;d:number};
const format=():never=>{throw new AppError('GUIDED_NOTES_FORMAT');};
function column(index:number){let value='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))value=String.fromCharCode(65+(n-1)%26)+value;return value;}
const a1=(r:number,c:number)=>column(c)+(r+1);

export function parseGuidedNotes(source:Spreadsheet,sheetId:string,groupCount:number):PreparedActivity{
  if(!Number.isInteger(groupCount)||groupCount<2||groupCount>20)throw new AppError('INVALID_GROUP_COUNT');
  const sheet=source.sheets?.find(s=>String(s.properties?.sheetId)===sheetId);if(!sheet)throw new AppError('GOOGLE_SHEET_NOT_FOUND');
  const cells=new Map<string,Cell>(),rowMeta=new Map<number,unknown>(),columnMeta=new Map<number,unknown>();let last=4;
  for(const grid of sheet.data??[]){
    const startRow=grid.startRow??0,startColumn=grid.startColumn??0;
    for(const [r,row]of (grid.rowData??[]).entries()){
      for(const [c,cell]of(row.values??[]).entries())cells.set(a1(startRow+r,startColumn+c),cell);
      last=Math.max(last,startRow+r);
    }
    (grid.rowMetadata??[]).forEach((value,i)=>rowMeta.set(startRow+i,value));
    (grid.columnMetadata??[]).forEach((value,i)=>columnMeta.set(startColumn+i,value));
  }
  const cell=(r:number,c:number)=>cells.get(a1(r,c))??{};
  const text=(r:number,c:number)=>{
    const value=cell(r,c);if(typeof value.formattedValue==='string')return value.formattedValue;
    const raw=value.userEnteredValue;return raw?.stringValue??(raw?.numberValue!==undefined?String(raw.numberValue):raw?.boolValue!==undefined?String(raw.boolValue):'');
  };
  const ranges=(sheet.merges??[]).map(m=>{const value={r:m.startRowIndex??0,e:m.endRowIndex,c:m.startColumnIndex??0,d:m.endColumnIndex};
    if(!Object.values(value).every(n=>Number.isInteger(n)&&n>=0)||value.e<=value.r||value.d<=value.c)return format();return value;});
  const covering=(r:number,c:number)=>{const found=ranges.filter(m=>m.r<=r&&r<m.e&&m.c<=c&&c<m.d);if(found.length>1)return format();return found[0];};
  const exact=(r:number,e:number,c:number,d:number)=>{const m=covering(r,c);return !!m&&m.r===r&&m.e===e&&m.c===c&&m.d===d;};
  const unmerged=(r:number,c:number)=>!covering(r,c);
  if(text(3,1).trim()!=='題號'||text(3,2).trim()!=='題目'||text(3,6).trim()!=='作答'||!exact(3,4,2,6)||!exact(3,4,6,8))return format();
  const questions:PreparedActivity['questions']=[],numbers=new Set<string>();
  for(let r=4;r<=last;){
    const number=text(r,1).trim();
    if(!number){
      if([1,2,3,4,5,6,7].some(c=>text(r,c).trim()))return format();
      r++;continue;
    }
    if(numbers.has(number))return format();numbers.add(number);
    const block=covering(r,1),group=!!block&&block.e>r+1;
    if(block&&(!group||block.r!==r||block.c!==1||block.d!==2))return format();
    const end=group?block!.e:r+1;if(end-1>last)return format();
    const fields:PreparedActivity['questions'][number]['fields']=[];
    for(let current=r;current<end;current++){
      if(current>r&&text(current,1).trim())return format();
      if(!exact(current,current+1,2,6))return format();
      const prompt=text(current,2);if(!prompt.trim())return format();
      if(group){if(!text(current,6).trim()||!unmerged(current,6)||!unmerged(current,7))return format();}
      else if(!unmerged(current,1)||!exact(current,current+1,6,8))return format();
      const first=group?7:6,lastColumn=7,answerRange=a1(current,first)+(group?'':':'+a1(current,lastColumn));
      const originalCells=Array.from({length:lastColumn-first+1},(_,i)=>({a1:a1(current,first+i),cell:cell(current,first+i),columnMetadata:columnMeta.get(first+i)??null}));
      fields.push({label:group?text(current,6):null,prompt,answerRange,original:{cells:originalCells,rowMetadata:rowMeta.get(current)??null,marker:group?cell(current,6):null}});
    }
    questions.push({number,kind:group?'GROUP':'SINGLE',fields});r=end;
  }
  if(!questions.length)return format();
  return{groupCount,questions,source:{spreadsheetId:source.spreadsheetId,sheetId,parserVersion:'guided-notes-v1',snapshot:{spreadsheetProperties:source.properties??null,sheet}}};
}

export function parseSheetsUrl(value:unknown):{spreadsheetId:string;sheetId:string|null}{
  if(typeof value!=='string')throw new AppError('INVALID_SHEETS_URL');
  let url:URL;try{url=new URL(value.trim());}catch{throw new AppError('INVALID_SHEETS_URL');}
  const match=url.pathname.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)(?:\/(?:edit|view|preview|copy))?\/?$/u);
  if(url.protocol!=='https:'||url.hostname!=='docs.google.com'||url.port||url.username||url.password||!match)throw new AppError('INVALID_SHEETS_URL');
  const fragment=new URLSearchParams(url.hash.slice(1)),query=url.searchParams;
  if(query.getAll('gid').length>1||fragment.getAll('gid').length>1)throw new AppError('INVALID_SHEETS_URL');
  const one=query.get('gid'),two=fragment.get('gid');
  if(one!==null&&two!==null&&one!==two)throw new AppError('INVALID_SHEETS_URL');
  const gid=one??two;
  if(gid!==null&&(!/^\d+$/u.test(gid)||!Number.isSafeInteger(Number(gid))||Number(gid)>2147483647))throw new AppError('INVALID_SHEETS_URL');
  return{spreadsheetId:match[1]!,sheetId:gid===null?null:String(Number(gid))};
}
