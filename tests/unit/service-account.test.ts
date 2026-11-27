import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createServiceJwt,ServiceAccountTokens,sheetsScope} from '../../src/server/service-account.js';
import {publicError} from '../../src/shared/errors.js';
const config={email:'robot@fixture.iam.gserviceaccount.com',privateKey:generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({format:'pem',type:'pkcs8'}).toString()};
test('真正JWT使用固定token端點、唯一Sheets scope、無委派；忽略外部token_uri',async()=>{
 const jwt=createServiceJwt(config);let calls=0;
 jwt.transporter.defaults.fetchImplementation=async(input,init)=>{calls++;assert.equal(String(input),'https://oauth2.googleapis.com/token');const body=new URLSearchParams(String(init?.body)),parts=body.get('assertion')!.split('.'),claims=JSON.parse(Buffer.from(parts[1]!,'base64url').toString());assert.equal(claims.iss,config.email);assert.equal(claims.aud,'https://oauth2.googleapis.com/token');assert.equal(claims.scope,sheetsScope);assert.ok(!claims.sub);return Response.json({access_token:'TOKEN_CANARY',token_type:'Bearer',expires_in:3600});};
 assert.equal((await jwt.authorize()).access_token,'TOKEN_CANARY');assert.equal(calls,1);assert.equal(jwt.subject,undefined);assert.equal(jwt.transporter.defaults.maxRedirects,0);
});
test('服務帳戶token記憶體快取、併發合併、到期更新與錯誤遮蔽',async()=>{
 let now=1000,calls=0;const tokens=new ServiceAccountTokens(config,()=>now,async()=>{calls++;return{access_token:'TOKEN_'+calls,expiry_date:now+120000};});assert.deepEqual(await Promise.all([tokens.token(),tokens.token(),tokens.token()]),['TOKEN_1','TOKEN_1','TOKEN_1']);assert.equal(calls,1);assert.equal(await tokens.token(),'TOKEN_1');now+=60001;assert.equal(await tokens.token(),'TOKEN_2');assert.equal(calls,2);
 await assert.rejects(new ServiceAccountTokens(null).token(),{code:'SERVICE_ACCOUNT_NOT_CONFIGURED'});
 for(const authorize of [async()=>{throw new Error('PRIVATE_KEY_CANARY');},async()=>({access_token:'SECRET',expiry_date:0})])await assert.rejects(new ServiceAccountTokens(config,()=>now,authorize).token(),error=>{assert.equal(Reflect.get(error as object,'code'),'SERVICE_ACCOUNT_INVALID');assert.ok(!JSON.stringify(publicError(error,'safe')).includes('CANARY'));return true;});
});
test('Google拒絕token後下次重新取得，失敗不保留壞token',async()=>{
 let calls=0;const tokens=new ServiceAccountTokens(config,Date.now,async()=>({access_token:'FRESH_'+(++calls),expiry_date:Date.now()+3600000}));assert.equal(await tokens.token(),'FRESH_1');tokens.invalidate();assert.equal(await tokens.token(),'FRESH_2');assert.equal(calls,2);
});
