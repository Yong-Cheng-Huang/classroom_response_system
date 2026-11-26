import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir,platform,release,arch } from 'node:os';
import { join,resolve } from 'node:path';
import { openDatabase } from '../../src/server/database.js';
import { IdentityService } from '../../src/server/identity.js';
import type { TabProof } from '../../src/shared/session.js';
const temporary=mkdtempSync(join(tmpdir(),'crs-g2-'));
const modes=['before-deadline','rollback-revocation','committed-revocation','clean-before','clean-expired'] as const;
type Stored={lifecycle:string;revoked_reason:string|null;created_at:number;expires_at:number;grace_started_at:number|null;grace_deadline:number|null;state_version:number;shutdown_evidence_json:string|null;membership_state:string;running:number};
function snapshot(database:ReturnType<typeof openDatabase>):Stored{
  return database.prepare(`SELECT s.lifecycle,s.revoked_reason,s.created_at,s.expires_at,s.grace_started_at,s.grace_deadline,s.state_version,s.shutdown_evidence_json,p.membership_state,r.running
    FROM sessions s JOIN participants p ON p.session_id=s.id CROSS JOIN runtime_state r`).get() as Stored;
}
async function cut(path:string,mode:string){
  const child=spawn(process.execPath,['--import','tsx',resolve('scripts/probes/g2-worker.ts'),path,mode],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  try{
    const marker=await new Promise<{boundary:string;logicalNow:number}>((done,fail)=>{
      const timeout=setTimeout(()=>{child.kill('SIGKILL');fail(new Error('探針未於時限到達注入點'));},10000);
      child.stdout.on('data',chunk=>{stdout+=chunk.toString();if(stdout.includes('\n')){clearTimeout(timeout);try{done(JSON.parse(stdout.split('\n')[0]!));}catch{fail(new Error('探針回覆無效'));}}});
      child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
      child.once('error',error=>{clearTimeout(timeout);fail(error);});
      child.once('exit',()=>{clearTimeout(timeout);if(!stdout.includes('\n'))fail(new Error('探針未到達注入點：'+stderr));});
    });
    const stopped=new Promise<NodeJS.Signals|null>(done=>child.once('exit',(_code,signal)=>done(signal)));
    child.kill('SIGKILL');assert.equal(await stopped,'SIGKILL');return marker;
  }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
}
const cases:{模式:string;注入點:unknown;重啟前:Stored;重啟後:Stored;授權結果:string;到期優先結果?:string}[]=[];
try{
  for(const mode of modes){
    const directory=join(temporary,mode);mkdirSync(directory,{mode:0o700});const path=join(directory,'classroom.db');
    const marker=await cut(path,mode),database=openDatabase(path);
    try{
      const before=snapshot(database);assert.equal(database.pragma('integrity_check',{simple:true}),'ok');
      // 故障注入 trigger 是探針裝置，重啟後先移除；不改任何權威資料列。
      database.exec('DROP TRIGGER IF EXISTS g2_cut');
      const proof=JSON.parse(readFileSync(join(directory,'proof.json'),'utf8')) as TabProof;
      let now=60000;const identity=new IdentityService(database,'g2-isolated-fixture',()=>now,true);identity.markReady();
      let result='AUTHORIZED';try{identity.current(proof);}catch(error){result=(error as {code:string}).code;}
      const after=snapshot(database);let expires:string|undefined;
      if(mode==='before-deadline'||mode==='rollback-revocation'){
        assert.equal(result,'AUTHORIZED');assert.equal(after.membership_state,'JOINED');assert.equal(after.lifecycle,'GRACE');assert.equal(after.grace_deadline,90000);
        now=after.expires_at;try{identity.current(proof);}catch(error){expires=(error as {code:string}).code;}
        assert.equal(expires,'SESSION_EXPIRED');assert.equal(snapshot(database).membership_state,'INVALID');
      }else if(mode==='clean-before'){
        assert.equal(result,'AUTHORIZED');assert.equal(after.grace_deadline,90000);assert.equal(after.membership_state,'JOINED');
      }else{assert.equal(result,'SESSION_DISCONNECTED');assert.equal(after.membership_state,'INVALID');assert.equal(after.lifecycle,'REVOKED');}
      cases.push({模式:mode,注入點:marker,重啟前:before,重啟後:after,授權結果:result,...(expires?{到期優先結果:expires}:{})});
    }finally{database.close();}
  }
  assert.deepEqual(cases[0]!.重啟前,cases[1]!.重啟前);
  const output={日期:'2026-11-26 Asia/Taipei',環境:{node:process.version,os:platform(),release:release(),arch:arch()},
    範圍:'真子程序 SIGKILL＋真 SQLite；截止 31000ms 與停機時間使用注入時鐘，不是牆鐘 30 秒／正式 WS 或 Chrome 驗收',
    結論:'D38_BOUNDARY_PASS：依已確認最後已提交狀態政策恢復；歷史截止前後仍不可精確區分',
    相同紀錄比較:true,案例:cases};
  const destination=resolve('docs/evidence/g2-confirmed-recovery-probe.json');writeFileSync(destination,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({結果:output.結論,案例數:cases.length,相同紀錄比較:true,證據:destination},null,2));
}finally{rmSync(temporary,{recursive:true,force:true});}
