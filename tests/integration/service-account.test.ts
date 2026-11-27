import test from 'node:test';
import assert from 'node:assert/strict';
import {temporaryDatabase} from '../helpers/database.js';
import {IdentityService} from '../../src/server/identity.js';
import {ServiceAccountSheets,ServiceAccountTokens} from '../../src/server/service-account.js';
import {freshProof} from '../helpers/ranking.js';
import {ExportWriteRejected,publicError} from '../../src/shared/errors.js';
import {sheetFixture} from '../helpers/sheets.js';
import {f1} from '../fixtures/catalog.js';
test('服務帳戶完整傳輸、固定主機與老師授權；401／403／404／429及JSON安全處理',async t=>{
 const d=temporaryDatabase(t),identity=new IdentityService(d.database,'gateway-password'),proof=freshProof(),grant=identity.login('gateway-password',proof);Object.assign(proof,{token:grant.token,generation:grant.generation});let transport:typeof fetch=async()=>Response.json(sheetFixture(f1));
 const tokens=new ServiceAccountTokens({email:'robot@fixture.iam.gserviceaccount.com',privateKey:'只由mock使用'},Date.now,async()=>({access_token:'TOKEN_CANARY',expiry_date:Date.now()+3600000})),gateway=new ServiceAccountSheets(identity,tokens,(...args)=>transport(...args));
 assert.deepEqual(gateway.status(proof),{configured:true,accountEmail:tokens.accountId});assert.deepEqual(await gateway.spreadsheet(proof,'fixture-copy',{fields:'sheets(properties,merges,data)'}),sheetFixture(f1));
 transport=async(input,init)=>{const url=new URL(String(input));assert.equal(url.origin,'https://sheets.googleapis.com');assert.ok(!url.href.includes('TOKEN_CANARY'));assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer TOKEN_CANARY');assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');assert.ok(init.signal instanceof AbortSignal);return Response.json({spreadsheetId:'fixture-copy'});};await gateway.batchUpdate(proof,'fixture-copy',[]);
 await assert.rejects(gateway.spreadsheet(proof,'../evil',{}),{code:'INVALID_SHEETS_URL'});await assert.rejects(gateway.spreadsheet(proof,'fixture-copy',{key:'secret'}),{code:'INVALID_REQUEST'});
 for(const [status,code]of [[401,'SERVICE_ACCOUNT_INVALID'],[403,'SERVICE_ACCOUNT_FORBIDDEN'],[404,'GOOGLE_DOCUMENT_NOT_FOUND'],[429,'EXTERNAL_UNAVAILABLE']]as const){transport=async()=>Response.json({error:'TOKEN_CANARY'},{status});await assert.rejects(gateway.spreadsheet(proof,'fixture-copy',{}),{code});}
 transport=async()=>new Response('bad TOKEN_CANARY');await assert.rejects(gateway.spreadsheet(proof,'fixture-copy',{}),{code:'EXTERNAL_UNAVAILABLE'});
 for(const status of [401,403,404,429]){transport=async()=>Response.json({error:'TOKEN_CANARY'},{status});await assert.rejects(gateway.batchUpdate(proof,'fixture-copy',[]),e=>{assert.ok(e instanceof ExportWriteRejected);assert.ok(!JSON.stringify(publicError(e,'safe')).includes('TOKEN_CANARY'));return true;});}
 for(const transportResult of [async()=>{throw new Error('TOKEN_CANARY');},async()=>new Response('bad'),async()=>Response.json({},{status:500})]){transport=transportResult;await assert.rejects(gateway.batchUpdate(proof,'fixture-copy',[]),e=>{assert.ok(!(e instanceof ExportWriteRejected));return true;});}
 const timeout=AbortSignal.timeout;let duration=0;AbortSignal.timeout=ms=>{duration=ms;return AbortSignal.abort();};transport=async(_input,init)=>{init?.signal?.throwIfAborted();throw new Error();};try{await assert.rejects(gateway.spreadsheet(proof,'fixture-copy',{}),{code:'EXTERNAL_UNAVAILABLE'});assert.equal(duration,20000);}finally{AbortSignal.timeout=timeout;}
 let release!:(r:Response)=>void;transport=()=>new Promise(r=>release=r);const pending=gateway.spreadsheet(proof,'fixture-copy',{});await new Promise(r=>setImmediate(r));identity.logout(proof);release(Response.json(sheetFixture(f1)));await assert.rejects(pending,{code:'SESSION_REVOKED'});
 await assert.rejects(gateway.batchUpdate(proof,'fixture-copy',[]),e=>e instanceof ExportWriteRejected);assert.throws(()=>gateway.status(freshProof()));
});
