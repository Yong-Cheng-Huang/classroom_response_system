import {fixtureSheets} from './service-account.js';
import type { TestContext } from 'node:test';
import { temporaryDatabase } from './database.js';
import { sheetFixture } from './sheets.js';
import { f1,f2 } from '../fixtures/catalog.js';
import { IdentityService } from '../../src/server/identity.js';
import { ActivityService } from '../../src/server/activity.js';
import { ExportService,type ExportIO } from '../../src/server/exports.js';
import { parseGuidedNotes,type Spreadsheet,type Cell } from '../../src/server/guided-notes.js';
import { replacePreparedActivity } from '../../src/server/activity-replacement.js';
import { SubmissionService } from '../../src/server/submissions.js';
import { createSqliteAllocator } from '../../src/server/command-queue.js';
import { freshProof } from './ranking.js';
import { coordinates } from '../../src/server/export-plan.js';

export class SheetsMemory {
 writes=0;readable=true;beforeWrite:()=>void=()=>{};afterWrite:()=>void=()=>{};
 constructor(public source:Spreadsheet){}
 cell(key:string):Cell{const p=coordinates(key),grid=this.source.sheets[0]!.data![0]!;grid.rowData??=[];while(grid.rowData.length<=p.r)grid.rowData.push({values:[]});const row=grid.rowData[p.r]!;row.values??=[];while(row.values.length<=p.c)row.values.push({});return row.values[p.c]!;}
 async read(){if(!this.readable)throw new Error('隔離讀取失敗');return structuredClone(this.source);}
 async write(_proof:unknown,_id:string,requests:unknown[]){
  this.beforeWrite();const source=structuredClone(this.source);try{
   for(const raw of requests){const request=raw as {appendDimension?:{dimension:string;length:number};updateCells?:{range:{startRowIndex:number;startColumnIndex:number};rows:{values:Cell[]}[];fields:string};updateDimensionProperties?:{range:{startIndex:number};properties:{pixelSize:number}}};
    if(request.appendDimension){const grid=this.source.sheets[0]!.properties.gridProperties as {columnCount:number};grid.columnCount+=request.appendDimension.length;}
    if(request.updateCells){const u=request.updateCells,key=String.fromCharCode(65+u.range.startColumnIndex)+(u.range.startRowIndex+1),cell=this.cell(key),after=u.rows[0]!.values[0]!;
     for(const field of u.fields.split(',')){if(field==='userEnteredFormat.wrapStrategy'){const format=cell.userEnteredFormat as Record<string,unknown>??{};const next=(after.userEnteredFormat as Record<string,unknown>??{}).wrapStrategy;if(next===undefined)delete format.wrapStrategy;else format.wrapStrategy=next;cell.userEnteredFormat=format;}else if(field==='userEnteredValue'){cell.userEnteredValue=structuredClone(after.userEnteredValue??{});delete cell.textFormatRuns;}else cell[field]=structuredClone(after[field]);}
     delete cell.formattedValue;
    }
    if(request.updateDimensionProperties){const u=request.updateDimensionProperties,grid=this.source.sheets[0]!.data![0]!;grid.rowMetadata??=[];while(grid.rowMetadata.length<=u.range.startIndex)grid.rowMetadata.push({pixelSize:24});grid.rowMetadata[u.range.startIndex]={pixelSize:u.properties.pixelSize};}
   }
  }catch(error){this.source=source;throw error;}
  this.writes++;this.afterWrite();
 }
}
export async function exportFixture(t:TestContext,grouped=false,configure?:(memory:SheetsMemory)=>void){
 const data=temporaryDatabase(t),now=()=>1000,password='exports-isolated-fixture',identity=new IdentityService(data.database,password,now),activities=new ActivityService(data.database,identity,undefined,now);
 const p=freshProof(),grant=identity.login(password,p),teacher={...p,token:grant.token,generation:grant.generation};
 const google=fixtureSheets(identity,now);
 const memory=new SheetsMemory(sheetFixture(grouped?f2:f1));configure?.(memory);const initial=await replacePreparedActivity(data.database,parseGuidedNotes(memory.source,'1',2),{activityId:null,version:null,confirmed:false});
 const allocator=createSqliteAllocator(data.database,now),submissions=new SubmissionService(data.database,identity),group=data.database.prepare('SELECT id FROM groups ORDER BY number LIMIT 1').get() as {id:string};
 const studentProof=freshProof(),studentGrant=identity.join(initial.activityId,group.id,'=甲👨‍👩‍👧‍👦',studentProof),student={...studentProof,token:studentGrant.token,generation:studentGrant.generation};
 activities.transition(teacher,initial.activityId,1,'start',allocator());
 const questions=data.database.prepare('SELECT id FROM questions ORDER BY position').all() as {id:string}[];
 for(const q of questions.slice(0,questions.length-1)){const fields=data.database.prepare('SELECT id FROM question_fields WHERE question_id=? ORDER BY position').all(q.id) as {id:string}[];submissions.submit(student,initial.activityId,q.id,{requestId:q.id,answers:fields.map((f,i)=>({fieldId:f.id,text:'=不是公式\n答案👨‍👩‍👧‍👦'+i}))},allocator());}
 activities.transition(teacher,initial.activityId,2,'end',allocator(),true);
 const io:ExportIO={read:()=>memory.read(),write:(...args)=>memory.write(...args)};
 const service=new ExportService(data.database,identity,google,activities,now,io);
 let count=0;const run=(mode:'ANSWERS'|'COLUMNS'|'INLINE')=>service.execute(service.begin(teacher,initial.activityId,{accessMode:'SERVICE_ACCOUNT',requestId:'export-'+(++count),mode,paused:true,expectedVersion:3}));
 return{...data,identity,activities,google,teacher,student,service,memory,io,run,now,activityId:initial.activityId,source:()=>parseGuidedNotes(memory.source,'1',2)};
}
