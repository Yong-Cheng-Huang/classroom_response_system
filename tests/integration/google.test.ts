import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {publicImportFixture,publicHeaders,freshPublicProof,publicUrl} from '../helpers/public-import.js';
import {fixtureSheets} from '../helpers/service-account.js';
import {createApplication} from '../../src/server/app.js';
import {readConfig} from '../../src/server/config.js';

test('個人OAuth端點退出，舊JSON／vault／連結原檔不刪、不讀、不刷新',async t=>{
 const f=await publicImportFixture();t.after(f.close);const dir=readConfig({APP_DATA_DIR:'.'}).dataDir;
 const filename=join(dir,'src/server/index.ts'),source=readFileSync(filename,'utf8');assert.doesNotMatch(source,/GoogleOAuthProvider|GoogleVault|loadGoogleClient|googleClientFile/);
 const old=join(f.database.name.replace(/\/[^/]+$/u,''),'google-oauth-client.json');writeFileSync(old,'PRIVATE_OLD_OAUTH_CANARY');
 const before=readFileSync(old,'utf8');for(const [path,method]of [['status','GET'],['connect','POST'],['connection','DELETE'],['callback?code=PRIVATE_CANARY&state=anything','GET']]as const){const r=await fetch(f.base+'/api/google/'+path,{method,headers:publicHeaders(f.proof),...(method==='POST'?{body:'{}'}:{})});assert.equal(r.status,404);assert.ok(!(await r.text()).includes('PRIVATE'));}assert.equal(readFileSync(old,'utf8'),before);assert.equal(f.database.prepare('SELECT * FROM google_connection').get(),undefined);
 const denied=await fetch(f.base+'/api/imports/inspect',{method:'POST',headers:publicHeaders(f.proof),body:JSON.stringify({url:publicUrl,groupCount:2,accessMode:'OAUTH'})});assert.equal(denied.status,400);assert.equal((await denied.json()).error.code,'SHEETS_ACCESS_MODE_REQUIRED');
});
test('共用服務帳戶Email管理僅有效老師取得；登出不改他頁配置，host／query／角色拒絕',async t=>{
 const f=await publicImportFixture();t.after(f.close);const sheets=fixtureSheets(f.identity,f.now),app=createApplication(readConfig({TEACHER_PASSWORD:f.password}),f.database,()=>{},{identity:f.identity,sheets,now:f.now});const address=await app.listen(0);assert.ok(address&&typeof address==='object');t.after(()=>app.close());const base='http://127.0.0.1:'+address.port;
 const get=(headers:Record<string,string>,suffix='')=>fetch(base+'/api/sheets/status'+suffix,{headers});assert.equal((await get({})).status,401);assert.equal((await get({...publicHeaders(f.proof),'X-Document-Instance':'wrong'})).status,401);assert.equal((await get(publicHeaders(f.proof),'?role=TEACHER')).status,400);assert.equal((await get({...publicHeaders(f.proof),Origin:'http://evil.test'})).status,403);
 const a=await get(publicHeaders(f.proof));assert.deepEqual((await a.json()).data,{configured:true,accountEmail:'robot@fixture.iam.gserviceaccount.com'});
 const proof=freshPublicProof(),g=f.identity.login(f.password,proof);Object.assign(proof,{token:g.token,generation:g.generation});f.identity.logout(f.proof);assert.equal((await get(publicHeaders(proof))).status,200);f.setTime(43201001);assert.equal((await get(publicHeaders(proof))).status,401);
});
