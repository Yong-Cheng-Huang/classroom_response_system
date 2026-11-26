import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {exportFixture,SheetsMemory} from '../helpers/exports.js';
import {openDatabase} from '../../src/server/database.js';
import {IdentityService} from '../../src/server/identity.js';
import {ActivityService} from '../../src/server/activity.js';
import {ExportService} from '../../src/server/exports.js';

for(const mode of ['PREPARING','BEFORE_SEND','AFTER_REMOTE','COMPLETED','ABANDON_BEFORE','ABANDON_AFTER'])test('13.4 真SIGKILL匯出／放棄邊界 '+mode,{timeout:15000},async t=>{
 const f=await exportFixture(t),file=join(f.directory,'export-crash.json'),remote=join(f.directory,'remote.json');writeFileSync(remote,JSON.stringify(f.memory.source));writeFileSync(file,JSON.stringify({directory:f.directory,remote,teacher:f.teacher,activityId:f.activityId,source:f.memory.source}),{mode:0o600});const old=f.database.prepare('SELECT * FROM submissions').all();f.identity.shutdown();f.database.close();
 const child=spawn(process.execPath,['--import','tsx',resolve('tests/helpers/export-crash.ts'),f.path,file,mode],{stdio:['ignore','pipe','pipe']});t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
 let output='';await new Promise<void>((done,fail)=>{const timeout=setTimeout(()=>fail(new Error('隔離子程序未到注入點')),7000);child.stdout!.on('data',x=>{output+=x.toString();if(output.includes('CRASH_POINT')){clearTimeout(timeout);done();}});child.on('error',e=>{clearTimeout(timeout);fail(e);});child.on('exit',()=>{clearTimeout(timeout);if(!output.includes('CRASH_POINT'))fail(new Error('隔離子程序提前結束'));});});
 const stopped=new Promise<void>(done=>child.once('exit',()=>done()));child.kill('SIGKILL');await stopped;assert.equal(child.signalCode,'SIGKILL');
 const db=openDatabase(f.path);const count=(sql:string)=>(db.prepare(sql).get() as {n:number}).n;t.after(()=>{if(db.open)db.close();});assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.exec('DROP TRIGGER IF EXISTS cut_abandon');const now=()=>3000,identity=new IdentityService(db,'exports-isolated-fixture',now,true),activities=new ActivityService(db,identity,undefined,now);identity.markReady();
 const memory=new SheetsMemory(JSON.parse(readFileSync(remote,'utf8'))),service=new ExportService(db,identity,f.google,activities,now,{read:()=>memory.read(),write:async()=>{throw new Error('恢復核對不得重送');}});
 if(mode==='ABANDON_AFTER'){assert.equal(count('SELECT count(*) AS n FROM export_operations'),0);assert.equal(count('SELECT count(*) AS n FROM submissions'),0);assert.ok(count("SELECT count(*) AS n FROM document_output_management WHERE verification='UNVERIFIED'") as number>0);assert.notEqual((db.prepare('SELECT id FROM activities').get() as {id:string}).id,f.activityId);assert.throws(()=>identity.principal(f.student));}
 else{assert.deepEqual(db.prepare('SELECT * FROM submissions').all(),old);assert.equal((db.prepare('SELECT id FROM activities').get() as {id:string}).id,f.activityId);const op=service.list(f.teacher,f.activityId)[0]!;assert.equal(op.state,mode==='PREPARING'?'FAILED':mode==='COMPLETED'?'COMPLETED':'UNCONFIRMED');if(mode==='AFTER_REMOTE')assert.equal((await service.reconcile(f.teacher,op.id)).state,'COMPLETED');if(mode==='BEFORE_SEND')assert.equal((await service.reconcile(f.teacher,op.id)).state,'UNCONFIRMED');if(mode==='ABANDON_BEFORE')assert.equal(count("SELECT count(*) AS n FROM document_output_management WHERE verification='UNVERIFIED'"),0);}
 assert.equal(memory.writes,0);
});
