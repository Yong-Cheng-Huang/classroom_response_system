import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {temporaryDatabase} from '../helpers/database.js';
test('13.4 未授權WebSocket交接遭ECONNRESET，伺服器仍存活且健康檢查可用',{timeout:10000},async t=>{
 const f=temporaryDatabase(t);f.database.close();const child=spawn(process.execPath,['--import','tsx',resolve('tests/helpers/upgrade-reset.ts'),f.path],{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout!.on('data',s=>out+=s);child.stderr!.on('data',s=>err+=s);t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});const code=await new Promise<number|null>((done,fail)=>{child.once('error',fail);child.once('exit',done);});assert.equal(code,0,err);assert.match(out,/UPGRADE_RESET_HANDLED/);
});
