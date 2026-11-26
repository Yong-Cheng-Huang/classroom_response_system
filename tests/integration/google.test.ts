import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { readFileSync,readdirSync,writeFileSync,statSync } from 'node:fs';
import { join } from 'node:path';
import { temporaryDatabase,seedActivity } from '../helpers/database.js';
import { IdentityService } from '../../src/server/identity.js';
import { GoogleService,GoogleOAuthProvider,loadGoogleClient,type GoogleProvider,type GoogleTokens,googleScopes } from '../../src/server/google.js';
import { GoogleVault } from '../../src/server/google-vault.js';
import { createApplication } from '../../src/server/app.js';
import { readConfig } from '../../src/server/config.js';
import type { TabProof } from '../../src/shared/session.js';

const password='google-fixture-only-password';
const proof=():TabProof=>({secret:randomBytes(32).toString('hex'),instanceId:randomUUID(),generation:0});
class Provider implements GoogleProvider {
  exchanges=0;refreshes=0;challenge='';verifier='';
  tokens:GoogleTokens={accessToken:'private-access-fixture',refreshToken:'private-refresh-fixture',expiresAt:999999999,scopes:[...googleScopes],account:'fixture@example.test'};
  exchangeWork:()=>Promise<GoogleTokens>=async()=>({...this.tokens});
  refreshWork:()=>Promise<GoogleTokens>=async()=>({...this.tokens,accessToken:'refreshed-private-access'});
  authorization(state:string,challenge:string){this.challenge=challenge;return'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({state});}
  async exchange(_code:string,verifier:string){this.exchanges++;this.verifier=verifier;return this.exchangeWork();}
  async refresh(){this.refreshes++;return this.refreshWork();}
}
function fixture(t:Parameters<typeof temporaryDatabase>[0]){
  const data=temporaryDatabase(t);let now=1000;
  const identity=new IdentityService(data.database,password,()=>now),vault=new GoogleVault(data.directory),provider=new Provider();
  const service=new GoogleService(data.database,identity,vault,provider,()=>now);
  const p=proof(),grant=identity.login(password,p),teacher={...p,token:grant.token,generation:grant.generation};
  const state=(p:TabProof=teacher)=>new URL(service.begin(p).authorizationUrl).searchParams.get('state')!;
  return{...data,identity,vault,provider,service,teacher,state,tick:(value:number)=>{now=value;},now:()=>now};
}

test('6.1 設定檔只接受 web 與精確回呼，錯誤不回傳原文或 client secret',t=>{
  const {directory}=temporaryDatabase(t),path=join(directory,'client.json');
  assert.equal(loadGoogleClient(path,3000),null);
  writeFileSync(path,JSON.stringify({web:{client_id:'fixture-id',client_secret:'fixture-secret',redirect_uris:['http://127.0.0.1:3000/api/google/callback']}}));
  assert.equal(loadGoogleClient(path,3000)?.clientId,'fixture-id');assert.equal(statSync(path).mode&0o777,0o600);
  const provider=new GoogleOAuthProvider(loadGoogleClient(path,3000)!);
  const url=new URL(provider.authorization('fixture-state','fixture-challenge'));
  assert.equal(url.hostname,'accounts.google.com');assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('redirect_uri'),'http://127.0.0.1:3000/api/google/callback');assert.equal(url.searchParams.has('client_secret'),false);assert.ok(url.searchParams.get('scope')?.includes(googleScopes[0]!));
  assert.throws(()=>loadGoogleClient(path,3100),{code:'GOOGLE_CONFIGURATION_INVALID'});
  writeFileSync(path,'{"private-secret":');assert.throws(()=>loadGoogleClient(path,3000),{code:'GOOGLE_CONFIGURATION_INVALID'});
});

test('6.1 state 一次性、PKCE 正確、callback 不需角色 cookie，教師仍須有效',async t=>{
  const f=fixture(t),state=f.state();assert.match(state,/^[0-9a-f]{64}$/u);
  await f.service.complete(state,'code',false);
  assert.equal(createHash('sha256').update(f.provider.verifier).digest('base64url'),f.provider.challenge);
  assert.equal(f.service.status(f.teacher).state,'CONNECTED');
  await assert.rejects(f.service.complete(state,'code',false),{code:'OAUTH_STATE_INVALID'});assert.equal(f.provider.exchanges,1);
});

test('6.1 偽造／過期 state、拒絕授權、登出及錯誤密碼版本不能完成授權',async t=>{
  const f=fixture(t);await assert.rejects(f.service.complete('bad','code',false),{code:'OAUTH_STATE_INVALID'});
  const expired=f.state();f.tick(601000);await assert.rejects(f.service.complete(expired,'code',false),{code:'OAUTH_STATE_INVALID'});
  const denied=f.state();await assert.rejects(f.service.complete(denied,null,true),{code:'GOOGLE_ACCESS_DENIED'});
  const loggedOut=f.state();f.identity.logout(f.teacher);await assert.rejects(f.service.complete(loggedOut,'code',false),{code:'OAUTH_STATE_INVALID'});
  const p=proof(),g=f.identity.login(password,p),other={...p,token:g.token,generation:g.generation},changed=f.state(other);
  new IdentityService(f.database,'changed-password',f.now);
  await assert.rejects(f.service.complete(changed,'code',false),{code:'OAUTH_STATE_INVALID'});
  assert.equal(f.provider.exchanges,0);assert.equal(f.database.prepare('SELECT * FROM google_connection').get(),undefined);
});

test('6.1 未授予 Sheets 範圍或缺少 refresh token 不替換既有共用連結',async t=>{
  const f=fixture(t);await f.service.complete(f.state(),'code',false);const original=f.database.prepare('SELECT * FROM google_connection').get();
  f.provider.tokens.scopes=['openid','email'];await assert.rejects(f.service.complete(f.state(),'code',false),{code:'GOOGLE_REAUTHORIZE'});
  f.provider.tokens.scopes=[...googleScopes];f.provider.tokens.refreshToken='';await assert.rejects(f.service.complete(f.state(),'code',false),{code:'GOOGLE_REAUTHORIZE'});
  assert.deepEqual(f.database.prepare('SELECT * FROM google_connection').get(),original);
});

test('6.1 回呼網路等待不占命令佇列，回覆回來後再驗身分及版本',async t=>{
  const f=fixture(t);let resolve!:(tokens:GoogleTokens)=>void;
  f.provider.exchangeWork=()=>new Promise(done=>{resolve=done;});const state=f.state();
  let entries=0;const callback=f.service.complete(state,'code',false,async work=>{entries++;return work();});
  await new Promise(setImmediate);assert.equal(entries,1);f.identity.logout(f.teacher);resolve(f.provider.tokens);
  await assert.rejects(callback,{code:'OAUTH_STATE_INVALID'});assert.equal(entries,2);assert.equal(f.database.prepare('SELECT * FROM google_connection').get(),undefined);
});

test('6.2 多老師共用、其中一方登出不解除，重建服務仍可讀加密憑證，學生無權限',async t=>{
  const f=fixture(t);seedActivity(f.database);f.database.exec("UPDATE activities SET state='READY',started_at=NULL");
  await f.service.complete(f.state(),'code',false);
  const other=proof(),g=f.identity.login(password,other),teacher={...other,token:g.token,generation:g.generation};
  const student=proof(),sg=f.identity.join('a','g1','學生',student),s={...student,token:sg.token,generation:sg.generation};
  for(const method of [()=>f.service.status(s),()=>f.service.begin(s),()=>f.service.disconnect(s)])assert.throws(method,{code:'FORBIDDEN'});
  f.identity.logout(f.teacher);assert.equal(f.service.status(teacher).state,'CONNECTED');
  const rebuilt=new GoogleService(f.database,f.identity,new GoogleVault(f.directory),f.provider,f.now);
  assert.equal(await rebuilt.accessToken(teacher),f.provider.tokens.accessToken);
  const row=JSON.stringify(f.database.prepare('SELECT * FROM google_connection').get());
  assert.ok(!row.includes(f.provider.tokens.accessToken));assert.ok(!row.includes(f.provider.tokens.refreshToken));
  for(const file of readdirSync(join(f.directory,'google-credentials'))){
    const path=join(f.directory,'google-credentials',file),bytes=readFileSync(path);
    assert.equal(statSync(path).mode&0o777,0o600);assert.ok(!bytes.includes(Buffer.from(f.provider.tokens.accessToken)));assert.ok(!bytes.includes(Buffer.from(f.provider.tokens.refreshToken)));
  }
  rebuilt.disconnect(teacher);await assert.rejects(rebuilt.accessToken(teacher),{code:'GOOGLE_REAUTHORIZE'});
  assert.equal((f.database.prepare('SELECT state FROM activities').get() as {state:string}).state,'READY');
});

test('6.2 解除／其他老師完成連結後舊 callback 不得覆蓋或復活，取消不破壞既有連結',async t=>{
  const f=fixture(t),one=f.state(),two=f.state();await f.service.complete(one,'code',false);
  await assert.rejects(f.service.complete(two,'code',false),{code:'OAUTH_STATE_INVALID'});
  const canceled=f.state();await assert.rejects(f.service.complete(canceled,null,true),{code:'GOOGLE_ACCESS_DENIED'});assert.equal(f.service.status(f.teacher).state,'CONNECTED');
  let resolve!:(tokens:GoogleTokens)=>void;f.provider.exchangeWork=()=>new Promise(done=>{resolve=done;});
  const late=f.service.complete(f.state(),'code',false);await new Promise(setImmediate);f.service.disconnect(f.teacher);resolve(f.provider.tokens);
  await assert.rejects(late,{code:'OAUTH_STATE_INVALID'});assert.equal(f.service.status(f.teacher).state,'DISCONNECTED');
});

test('6.2 更新憑證合併並行請求、正常保存；解除期間舊更新不能復活連結',async t=>{
  const f=fixture(t);f.provider.tokens.expiresAt=2000;await f.service.complete(f.state(),'code',false);
  let resolve!:(tokens:GoogleTokens)=>void;f.provider.refreshWork=()=>new Promise(done=>{resolve=done;});
  const one=f.service.accessToken(f.teacher),two=f.service.accessToken(f.teacher);assert.equal(f.provider.refreshes,1);
  resolve({...f.provider.tokens,accessToken:'refreshed-secret',expiresAt:9999999});assert.deepEqual(await Promise.all([one,two]),['refreshed-secret','refreshed-secret']);
  f.tick(9999999);const late=f.service.accessToken(f.teacher);f.service.disconnect(f.teacher);resolve({...f.provider.tokens,expiresAt:999999999});
  await assert.rejects(late,{code:'GOOGLE_REAUTHORIZE'});assert.equal(f.service.status(f.teacher).state,'DISCONNECTED');
});

test('6.2 refresh 撤銷需重新授權，網路失敗與 vault 損壞不清活動，也不回傳外部錯誤',async t=>{
  const f=fixture(t);seedActivity(f.database);f.provider.tokens.expiresAt=2000;await f.service.complete(f.state(),'code',false);
  f.provider.refreshWork=async()=>{throw new Error('PRIVATE-remote-error');};
  await assert.rejects(f.service.accessToken(f.teacher),{code:'EXTERNAL_UNAVAILABLE'});assert.equal(f.service.status(f.teacher).state,'CONNECTED');
  f.provider.refreshWork=async()=>{throw{response:{data:{error:'invalid_grant',secret:'private'}}};};
  await assert.rejects(f.service.accessToken(f.teacher),{code:'GOOGLE_REAUTHORIZE'});assert.equal(f.service.status(f.teacher).state,'REAUTHORIZE');
  f.provider.tokens.expiresAt=999999999;await f.service.complete(f.state(),'code',false);
  const row=f.database.prepare('SELECT credential_reference AS ref FROM google_connection').get() as {ref:string};
  writeFileSync(join(f.directory,'google-credentials',row.ref+'.enc'),'corrupted');
  await assert.rejects(f.service.accessToken(f.teacher),{code:'GOOGLE_REAUTHORIZE'});assert.equal((f.database.prepare('SELECT count(*) AS n FROM activities').get() as {n:number}).n,1);
});

test('6.3 Sheets 請求固定為 Google GET，區分無權限／不存在／網路失敗且不回傳原始錯誤',async t=>{
  const f=fixture(t);await f.service.complete(f.state(),'code',false);
  const value=await f.service.spreadsheet(f.teacher,'copy',{fields:'spreadsheetId'},async(input,options)=>{
    assert.equal(new URL(String(input)).origin,'https://sheets.googleapis.com');assert.ok(!options?.method||options.method==='GET');assert.equal(new Headers(options?.headers).get('authorization'),'Bearer '+f.provider.tokens.accessToken);
    return new Response(JSON.stringify({spreadsheetId:'copy'}));
  });assert.deepEqual(value,{spreadsheetId:'copy'});
  for(const [status,code]of [[403,'GOOGLE_DOCUMENT_FORBIDDEN'],[404,'GOOGLE_DOCUMENT_NOT_FOUND'],[500,'EXTERNAL_UNAVAILABLE']] as const)await assert.rejects(f.service.spreadsheet(f.teacher,'copy',{},async()=>new Response('PRIVATE',{status})),{code});
  await assert.rejects(f.service.spreadsheet(f.teacher,'copy',{},async()=>{throw new Error('PRIVATE');}),{code:'EXTERNAL_UNAVAILABLE'});
});
test('6.3 解除發生在資料本文讀取期間，晚到資料不能成為有效的匯入來源',async t=>{
  const f=fixture(t);await f.service.complete(f.state(),'code',false);let release!:(value:unknown)=>void;
  const pending=f.service.spreadsheet(f.teacher,'copy',{},async()=>({ok:true,status:200,json:()=>new Promise(resolve=>{release=resolve;})}) as Response);
  await new Promise(setImmediate);f.service.disconnect(f.teacher);release({spreadsheetId:'copy'});await assert.rejects(pending,{code:'GOOGLE_REAUTHORIZE'});
});

test('6.1／6.2 真 HTTP：學生／匿名拒絕，callback HTML 不反射 query／token，普通資料無憑證',async t=>{
  const f=fixture(t);seedActivity(f.database);f.database.exec("UPDATE activities SET state='READY',started_at=NULL");
  const student=proof(),g=f.identity.join('a','g1','學生',student),s={...student,token:g.token,generation:g.generation};
  const app=createApplication(readConfig({TEACHER_PASSWORD:password}),f.database,()=>{},{identity:f.identity,google:f.service,now:f.now});
  const address=await app.listen(0);assert.ok(address&&typeof address==='object');t.after(()=>app.close());const base=`http://127.0.0.1:${address.port}`;
  async function call(path:string,p?:TabProof,method='GET'){
    return fetch(base+path,{method,headers:{...(p?{Authorization:'Bearer '+p.token,'X-Tab-Proof':p.secret,'X-Document-Instance':p.instanceId,'X-Session-Generation':String(p.generation)}:{}),...(method==='GET'?{}:{'Content-Type':'application/json'})},body:method==='GET'?undefined:'{}'});
  }
  for(const [path,method]of [['/api/google/status','GET'],['/api/google/connect','POST'],['/api/google/connection','DELETE']]){
    assert.equal((await call(path!,undefined,method)).status,401);assert.equal((await call(path!,s,method)).status,403);
  }
  const begin=await(await call('/api/google/connect',f.teacher,'POST')).json();const state=new URL(begin.data.authorizationUrl).searchParams.get('state');
  assert.equal((await call('/api/google/callback?state='+state+'&code=fixture-code&iss=https%3A%2F%2Fevil.test')).status,401);
  const callback=await call('/api/google/callback?state='+state+'&code=fixture-code&iss=https%3A%2F%2Faccounts.google.com');assert.equal(callback.status,200);assert.equal(callback.headers.get('referrer-policy'),'no-referrer');
  assert.ok(!(await callback.text()).includes('fixture-code'));const status=await(await call('/api/google/status',f.teacher)).json();assert.equal(status.data.state,'CONNECTED');
  assert.ok(!JSON.stringify(status).includes(f.provider.tokens.refreshToken));assert.ok(!JSON.stringify(status).includes('credential_reference'));
  const invalid=await call('/api/google/callback?state='+state+'&error=%3Cscript%3Ebad%3C/script%3E');assert.equal(invalid.status,401);assert.ok(!(await invalid.text()).includes('<script>bad'));
  const canceled=new URL((await(await call('/api/google/connect',f.teacher,'POST')).json()).data.authorizationUrl).searchParams.get('state');
  const denied=await call('/api/google/callback?state='+canceled+'&error=access_denied&error_description=%3Cscript%3Ebad%3C/script%3E');assert.equal(denied.status,403);assert.ok(!(await denied.text()).includes('<script>bad'));
  assert.equal((await(await call('/api/google/status',f.teacher)).json()).data.state,'CONNECTED');
});
