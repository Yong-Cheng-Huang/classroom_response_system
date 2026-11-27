import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync,statSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadServiceAccount} from '../../src/server/service-account-config.js';
import {projectRoot,readConfig} from '../../src/server/config.js';
import {publicError} from '../../src/shared/errors.js';

test('服務帳戶設定缺檔可用預設；錯JSON／OAuth／非法私鑰安全拒絕，合法RSA檔限制0600',t=>{
 const dir=mkdtempSync(join(tmpdir(),'crs-sa-config-')),path=join(dir,'account.json');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 assert.equal(readConfig({}).serviceAccountFile,join(projectRoot,'data/google-service-account.json'));assert.equal(loadServiceAccount(path),null);
 for(const raw of ['bad-secret-canary',JSON.stringify({web:{client_secret:'secret-canary'}}),JSON.stringify({type:'service_account',client_email:'robot@fixture.iam.gserviceaccount.com',private_key:'secret-canary'})]){writeFileSync(path,raw);assert.throws(()=>loadServiceAccount(path),e=>{assert.equal(Reflect.get(e as object,'code'),'SERVICE_ACCOUNT_INVALID');assert.ok(!JSON.stringify(publicError(e,'safe')).includes('secret-canary'));return true;});}
 const privateKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString();writeFileSync(path,JSON.stringify({type:'service_account',client_email:'robot@fixture.iam.gserviceaccount.com',private_key:privateKey,token_uri:'https://evil.test'}),{mode:0o644});assert.deepEqual(loadServiceAccount(path),{email:'robot@fixture.iam.gserviceaccount.com',privateKey});assert.equal(statSync(path).mode&0o777,0o600);
 for(const email of ['project@appspot.gserviceaccount.com','123-compute@developer.gserviceaccount.com']){writeFileSync(path,JSON.stringify({type:'service_account',client_email:email,private_key:privateKey}));assert.equal(loadServiceAccount(path)?.email,email);}
 const link=join(dir,'link');symlinkSync(join(projectRoot,'src/server/config.ts'),link);assert.throws(()=>loadServiceAccount(link),{code:'SERVICE_ACCOUNT_INVALID'});
});
