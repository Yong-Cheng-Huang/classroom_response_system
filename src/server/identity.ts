import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { SqliteDatabase } from './database.js';
import type { Principal } from './principal.js';
import type { SessionGrant, SessionView, TabProof } from '../shared/session.js';
import { AppError } from '../shared/errors.js';
import { normalizeNickname } from '../shared/validation.js';

const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const hex=/^[0-9a-f]{64}$/u,uuid=/^[0-9a-f]{8}-[0-9a-f-]{27}$/u;
type Row={id:string;role:'TEACHER'|'STUDENT';created_at:number;expires_at:number;lifecycle:string;revoked_reason:string|null;
  password_version:string|null;grace_deadline:number|null;shutdown_evidence_json:string|null;
  generation:number;document_instance_id:string|null};
type Member={id:string;activity_id:string;group_id:string;nickname:string;membership_state:string};

export class IdentityService {
  private passwordVersion:string|null=null;
  private salt:string;
  private ready:boolean;
  constructor(private readonly database:SqliteDatabase,private readonly password:string|undefined,
    private readonly now:()=>number=Date.now,private readonly manageRuntime=false) {
    let settings=database.prepare('SELECT password_salt,password_version FROM identity_settings WHERE id=1').get() as {password_salt:string;password_version:string|null}|undefined;
    if(!settings){settings={password_salt:randomBytes(32).toString('hex'),password_version:null};database.prepare('INSERT INTO identity_settings VALUES(1,?,NULL)').run(settings.password_salt);}
    this.salt=settings.password_salt;
    this.passwordVersion=password?this.passwordDigest(password).toString('hex'):null;
    this.ready=!manageRuntime;
    // 正式服務須先取得固定監聽埠，才可撤銷舊身分或更新停機證據。
    // 否則第二個啟動失敗的程序可能改到仍在運作的第一個程序。
    if(!manageRuntime)this.synchronizePassword();
  }
  private synchronizePassword(){
    const settings=this.database.prepare('SELECT password_version FROM identity_settings WHERE id=1').get() as {password_version:string|null};
    if(settings.password_version!==this.passwordVersion) this.database.transaction(()=>{
      this.database.prepare(`UPDATE sessions SET lifecycle='REVOKED',revoked_reason='PASSWORD_CHANGED',state_version=state_version+1
        WHERE role='TEACHER' AND lifecycle IN ('CONNECTED','GRACE')`).run();
      this.database.prepare('UPDATE identity_settings SET password_version=? WHERE id=1').run(this.passwordVersion);
    }).immediate();
  }
  private passwordDigest(value:string){return scryptSync(value,this.salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024});}
  private rows(){return this.database.prepare(`SELECT s.*,b.generation,b.document_instance_id FROM sessions s JOIN tab_bindings b ON b.session_id=s.id`).all() as Row[];}
  private uncertain(row:Row){return row.shutdown_evidence_json?JSON.parse(row.shutdown_evidence_json)?.kind==='UNRESOLVED_RESTART':false;}
  markReady(){
    if(this.ready)return;
    const now=this.now();
    this.database.transaction(()=>{
      this.synchronizePassword();
      const prior=this.database.prepare('SELECT running FROM runtime_state WHERE id=1').get() as {running:number};
      for(const row of this.rows()){
        if(!['CONNECTED','GRACE'].includes(row.lifecycle))continue;
        if(row.expires_at<=now){this.expire(row.id);continue;}
        // D38：最後已提交狀態是已確認的裁定政策，不宣稱可精確推導停機時刻。
        if(row.role==='STUDENT'){
          try{this.member(row);}catch(error){if(error instanceof AppError&&error.code==='SESSION_ACTIVITY_CHANGED')continue;throw error;}
        }
        const evidence=row.shutdown_evidence_json?JSON.parse(row.shutdown_evidence_json) as {kind?:string}:null;
        const clean=prior.running===0&&evidence?.kind==='CLEAN_SHUTDOWN';
        this.database.prepare(`UPDATE sessions SET lifecycle='GRACE',grace_started_at=?,grace_deadline=?,state_version=state_version+1,
          shutdown_evidence_json=? WHERE id=?`).run(now,now+30000,JSON.stringify({kind:clean?'CLEAN_RESTORED':'COMMITTED_STATE_RESTORED',policy:'D38',restoredAt:now}),row.id);
      }
      this.database.prepare('UPDATE runtime_state SET running=1 WHERE id=1').run();
    }).immediate();
    this.ready=true;
  }
  shutdown(){
    if(!this.manageRuntime||!this.ready)return;
    this.database.transaction(()=>{
      this.sweep();
      for(const row of this.rows())if(['CONNECTED','GRACE'].includes(row.lifecycle)&&!this.uncertain(row))
        this.database.prepare('UPDATE sessions SET shutdown_evidence_json=? WHERE id=?').run(JSON.stringify({kind:'CLEAN_SHUTDOWN',at:this.now(),stateVersion:(this.database.prepare('SELECT state_version AS v FROM sessions WHERE id=?').get(row.id) as {v:number}).v}),row.id);
      this.database.prepare('UPDATE runtime_state SET running=0 WHERE id=1').run();
    }).immediate();
  }
  private expire(id:string){
    this.database.transaction(()=>{
      this.database.prepare("UPDATE sessions SET lifecycle='EXPIRED',revoked_reason='EXPIRED',state_version=state_version+1 WHERE id=? AND lifecycle IN ('CONNECTED','GRACE')").run(id);
      this.database.prepare("UPDATE participants SET membership_state='INVALID' WHERE session_id=? AND membership_state='JOINED'").run(id);
    })();
  }
  sweep(){
    const now=this.now();
    this.database.transaction(()=>{
      for(const row of this.rows()){
        if(!['CONNECTED','GRACE'].includes(row.lifecycle))continue;
        if(row.expires_at<=now){this.expire(row.id);continue;}
        if(!this.ready||this.uncertain(row))continue;
        if(row.lifecycle==='GRACE'&&row.grace_deadline!==null&&row.grace_deadline<=now)this.revoke(row.id,'DISCONNECTED');
      }
    })();
  }
  assertPresenceKnown(){
    if(this.rows().some(row=>row.role==='STUDENT'&&['CONNECTED','GRACE'].includes(row.lifecycle)&&this.uncertain(row)))throw new AppError('RECOVERY_UNCERTAIN');
  }
  proof(request:IncomingMessage,tokenRequired=true):TabProof {
    const header=(name:string)=>{const value=request.headers[name];return typeof value==='string'?value:undefined;};
    const secret=header('x-tab-proof'),instanceId=header('x-document-instance'),generationText=header('x-session-generation');
    const authorization=header('authorization');const token=authorization?.startsWith('Bearer ')?authorization.slice(7):undefined;
    if(!secret||!hex.test(secret)||!instanceId||!uuid.test(instanceId)||!generationText||!/^\d+$/u.test(generationText))throw new AppError('UNAUTHORIZED');
    const generation=Number(generationText);
    if(!Number.isSafeInteger(generation)||generation<0||(tokenRequired&&(!token||!hex.test(token))))throw new AppError('UNAUTHORIZED');
    return{secret,instanceId,generation,...(token?{token}:{})};
  }
  private paired(proof:TabProof):Row {
    if(!proof.token||!hex.test(proof.token)||!hex.test(proof.secret)||!uuid.test(proof.instanceId))throw new AppError('UNAUTHORIZED');
    const row=this.database.prepare(`SELECT s.*,b.generation,b.document_instance_id FROM sessions s JOIN tab_bindings b ON b.session_id=s.id
      WHERE s.token_hash=? AND b.secret_hash=?`).get(digest(proof.token),digest(proof.secret)) as Row|undefined;
    if(!row)throw new AppError('UNAUTHORIZED');
    if(row.expires_at<=this.now()){if(!['REVOKED','EXPIRED'].includes(row.lifecycle))this.expire(row.id);throw new AppError('SESSION_EXPIRED');}
    if(row.lifecycle==='EXPIRED')throw new AppError('SESSION_EXPIRED');
    if(row.lifecycle==='REVOKED')throw new AppError(row.revoked_reason==='PASSWORD_CHANGED'?'SESSION_PASSWORD_CHANGED':row.revoked_reason==='DISCONNECTED'?'SESSION_DISCONNECTED':row.revoked_reason==='活動已更新，請重新選組。'?'SESSION_ACTIVITY_CHANGED':'SESSION_REVOKED');
    if(!this.ready||this.uncertain(row))throw new AppError('RECOVERY_UNCERTAIN');
    if(row.role==='TEACHER'&&(!this.passwordVersion||row.password_version!==this.passwordVersion)){this.revoke(row.id,'PASSWORD_CHANGED');throw new AppError('SESSION_PASSWORD_CHANGED');}
    if(row.lifecycle==='GRACE'&&row.grace_deadline!==null&&row.grace_deadline<=this.now()){this.revoke(row.id,'DISCONNECTED');throw new AppError('SESSION_DISCONNECTED');}
    if(row.role==='STUDENT')this.member(row);
    return row;
  }
  private member(row:Row):Member {
    const member=this.database.prepare('SELECT * FROM participants WHERE session_id=?').get(row.id) as Member|undefined;
    const current=this.database.prepare('SELECT id FROM activities WHERE current_slot=1').get() as {id:string}|undefined;
    if(!member||member.membership_state!=='JOINED'||member.activity_id!==current?.id){this.revoke(row.id,'活動已更新，請重新選組。');throw new AppError('SESSION_ACTIVITY_CHANGED');}
    return member;
  }
  private view(row:Row):SessionView {
    const base={role:row.role,expiresAt:row.expires_at,createdAt:row.created_at};
    if(row.role==='TEACHER')return base;
    const member=this.member(row);return{...base,activityId:member.activity_id,groupId:member.group_id,participantId:member.id,nickname:member.nickname};
  }
  principal(proof:TabProof):Principal {
    const row=this.paired(proof);
    if(row.generation!==proof.generation||row.document_instance_id!==proof.instanceId)throw new AppError('STALE_DOCUMENT');

    if(row.role==='TEACHER')return{role:'TEACHER',sessionId:row.id,expiresAt:row.expires_at};
    const member=this.member(row);return{role:'STUDENT',sessionId:row.id,expiresAt:row.expires_at,activityId:member.activity_id,groupId:member.group_id,participantId:member.id};
  }
  channelConnected(proof:TabProof){
    const subject=this.principal(proof);
    this.database.prepare("UPDATE sessions SET lifecycle='CONNECTED',grace_started_at=NULL,grace_deadline=NULL,state_version=state_version+1 WHERE id=? AND lifecycle='GRACE'").run(subject.sessionId);
    return subject;
  }
  channelDisconnected(owner:{sessionId:string;generation:number;instanceId:string}){
    const now=this.now();
    this.database.transaction(()=>{
      const row=this.database.prepare(`SELECT s.*,b.generation,b.document_instance_id FROM sessions s JOIN tab_bindings b ON b.session_id=s.id WHERE s.id=?`).get(owner.sessionId) as Row|undefined;
      if(!row||row.generation!==owner.generation||row.document_instance_id!==owner.instanceId||row.lifecycle!=='CONNECTED')return;
      if(row.expires_at<=now){this.expire(row.id);return;}
      if(this.uncertain(row)||!this.ready)return;
      this.database.prepare("UPDATE sessions SET lifecycle='GRACE',grace_started_at=?,grace_deadline=?,state_version=state_version+1 WHERE id=? AND lifecycle='CONNECTED'").run(now,now+30000,row.id);
    }).immediate();
  }
  current(proof:TabProof){this.principal(proof);return this.view(this.paired(proof));}
  ownership(proof:TabProof){const row=this.paired(proof);return{generation:row.generation};}
  resume(proof:TabProof){
    // 非法／失效判定先於交易，已完成的到期撤銷不可被後續錯誤回滾。
    this.paired(proof);
    return this.database.transaction(()=>{
      const row=this.paired(proof);
      if(row.document_instance_id!==proof.instanceId){
        if(row.generation!==proof.generation)throw new AppError('STALE_DOCUMENT');
        this.database.prepare('UPDATE tab_bindings SET generation=generation+1,document_instance_id=? WHERE session_id=? AND generation=?').run(proof.instanceId,row.id,row.generation);
        row.generation++;
      }else if(proof.generation!==row.generation&&proof.generation!==row.generation-1)throw new AppError('STALE_DOCUMENT');
      // HTTP 交接不宣稱 WS 已連線；既有寬限不被輪詢／重試延長。
      if(row.document_instance_id!==proof.instanceId&&row.lifecycle==='CONNECTED')this.database.prepare("UPDATE sessions SET lifecycle='GRACE',grace_started_at=?,grace_deadline=?,state_version=state_version+1 WHERE id=?").run(this.now(),this.now()+30000,row.id);
      return{generation:row.generation,session:this.view(row)};
    }).immediate();
  }
  private existing(secret:string){return this.database.prepare(`SELECT s.id,s.role FROM sessions s JOIN tab_bindings b ON b.session_id=s.id
    WHERE b.secret_hash=? AND s.lifecycle IN ('CONNECTED','GRACE')`).get(digest(secret)) as {id:string;role:string}|undefined;}
  private issue(role:'TEACHER'|'STUDENT',proof:TabProof,member?:{activityId:string;groupId:string;nickname:string}):SessionGrant {
    if(!hex.test(proof.secret)||!uuid.test(proof.instanceId))throw new AppError('INVALID_REQUEST');
    const id=randomUUID(),token=randomBytes(32).toString('hex'),now=this.now();
    this.database.prepare(`INSERT INTO sessions(id,token_hash,role,created_at,expires_at,lifecycle,password_version,shutdown_evidence_json)
      VALUES(?,?,?,?,?,'CONNECTED',?,?)`).run(id,digest(token),role,now,now+43200000,role==='TEACHER'?this.passwordVersion:null,JSON.stringify({kind:'LIVE'}));
    this.database.prepare('INSERT INTO tab_bindings VALUES(?,?,1,?)').run(id,digest(proof.secret),proof.instanceId);
    if(member)this.database.prepare("INSERT INTO participants VALUES(?,?,?,?,?,'JOINED')").run(randomUUID(),member.activityId,member.groupId,id,member.nickname);
    const row=this.database.prepare(`SELECT s.*,b.generation,b.document_instance_id FROM sessions s JOIN tab_bindings b ON b.session_id=s.id WHERE s.id=?`).get(id) as Row;
    return{token,generation:1,session:this.view(row)};
  }
  login(password:unknown,proof:TabProof){
    if(!this.passwordVersion||!this.password)throw new AppError('TEACHER_PASSWORD_REQUIRED');
    if(typeof password!=='string'||!timingSafeEqual(this.passwordDigest(password),Buffer.from(this.passwordVersion,'hex')))throw new AppError('INVALID_PASSWORD');
    this.sweep();
    return this.database.transaction(()=>{
      const existing=this.existing(proof.secret);
      if(existing?.role==='STUDENT')throw new AppError('SESSION_EXISTS');
      if(existing)this.revoke(existing.id,'RELOGIN');
      return this.issue('TEACHER',proof);
    }).immediate();
  }
  join(activityId:string,groupId:string,nickname:unknown,proof:TabProof){
    const name=normalizeNickname(nickname);this.sweep();
    return this.database.transaction(()=>{
      const current=this.database.prepare('SELECT id,state FROM activities WHERE current_slot=1').get() as {id:string;state:string}|undefined;
      if(current?.id!==activityId)throw new AppError('ACTIVITY_CHANGED');
      if(current.state!=='READY')throw new AppError('STATE_CONFLICT');
      if(this.existing(proof.secret))throw new AppError('SESSION_EXISTS');
      if(!this.database.prepare('SELECT id FROM groups WHERE id=? AND activity_id=?').get(groupId,activityId))throw new AppError('NOT_FOUND');
      return this.issue('STUDENT',proof,{activityId,groupId,nickname:name});
    }).immediate();
  }
  leave(proof:TabProof){
    const principal=this.principal(proof);if(principal.role!=='STUDENT')throw new AppError('FORBIDDEN');
    this.database.transaction(()=>{
      const current=this.database.prepare('SELECT state FROM activities WHERE id=?').get(principal.activityId) as {state:string};
      if(current.state!=='READY')throw new AppError('STATE_CONFLICT');
      this.database.prepare("UPDATE participants SET membership_state='LEFT' WHERE session_id=?").run(principal.sessionId);
      this.revoke(principal.sessionId,'LEFT');
    }).immediate();
  }
  logout(proof:TabProof){const principal=this.principal(proof);if(principal.role!=='TEACHER')throw new AppError('FORBIDDEN');this.revoke(principal.sessionId,'LOGOUT');}
  private revoke(id:string,reason:string){
    this.database.transaction(()=>{
      this.database.prepare("UPDATE sessions SET lifecycle='REVOKED',revoked_reason=?,state_version=state_version+1 WHERE id=? AND lifecycle IN ('CONNECTED','GRACE')").run(reason,id);
      this.database.prepare("UPDATE participants SET membership_state='INVALID' WHERE session_id=? AND membership_state='JOINED'").run(id);
    })();
  }
}
