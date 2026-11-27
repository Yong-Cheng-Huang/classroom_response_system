import {fixtureSheets} from './service-account.js';
import {readFileSync,writeFileSync,writeSync} from 'node:fs';
import {openDatabase} from '../../src/server/database.js';
import {IdentityService} from '../../src/server/identity.js';
import {ActivityService} from '../../src/server/activity.js';
import {ExportService} from '../../src/server/exports.js';
import {SheetsMemory} from './exports.js';
import {sheetFixture} from './sheets.js';
import {f2} from '../fixtures/catalog.js';
import {parseGuidedNotes} from '../../src/server/guided-notes.js';
const [path,file,mode]=process.argv.slice(2);if(!path||!file||!mode)throw new Error('缺少隔離故障參數');
const fixture=JSON.parse(readFileSync(file,'utf8')),db=openDatabase(path),now=()=>2000,identity=new IdentityService(db,'exports-isolated-fixture',now,true),activities=new ActivityService(db,identity,undefined,now),memory=new SheetsMemory(fixture.source);
identity.markReady();
const google=fixtureSheets(identity,now);
function halt():never{writeSync(1,'CRASH_POINT\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);throw new Error('不應恢復');}
const service=new ExportService(db,identity,google,activities,now,{read:async()=>{if(mode==='PREPARING')halt();return memory.read();},write:async(...args)=>{if(mode==='BEFORE_SEND')halt();await memory.write(...args);writeFileSync(fixture.remote,JSON.stringify(memory.source));if(mode==='AFTER_REMOTE')halt();}});
const result=await service.execute(service.begin(fixture.teacher,fixture.activityId,{accessMode:'SERVICE_ACCOUNT',requestId:'crash-export',mode:'INLINE',paused:true,expectedVersion:3}));
if(mode.startsWith('ABANDON')){
 db.prepare("UPDATE export_operations SET state='UNCONFIRMED' WHERE id=?").run(result.id);const approval=activities.confirmAbandonment(fixture.teacher,result.id,3,true),next=sheetFixture(f2);next.spreadsheetId='after-abandon-copy';
 if(mode==='ABANDON_BEFORE'){db.function('halt_export',halt);db.exec('CREATE TRIGGER cut_abandon BEFORE INSERT ON activities BEGIN SELECT halt_export(); END;');}
 await activities.replace(fixture.teacher,parseGuidedNotes(next,'1',2),{activityId:fixture.activityId,version:3,confirmed:true,abandonmentToken:approval.abandonmentToken});
}
halt();
