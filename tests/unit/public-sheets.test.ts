import test from 'node:test';
import assert from 'node:assert/strict';
import {readConfig} from '../../src/server/config.js';
import {PublicSheetsReader} from '../../scripts/probes/helpers/public-sheets.js';
import {publicError} from '../../src/shared/errors.js';
import {sheetFixture} from '../helpers/sheets.js';
import {f1} from '../fixtures/catalog.js';
const key='PUBLIC_KEY_CANARY';
test('公開金鑰已退出產品配置，缺值或舊值不影響啟動',()=>{
 for(const env of [{},{GOOGLE_SHEETS_API_KEY:''},{GOOGLE_SHEETS_API_KEY:'  '}])assert.equal(Object.hasOwn(readConfig(env),'googleSheetsApiKey'),false);
 assert.equal(Object.hasOwn(readConfig({GOOGLE_SHEETS_API_KEY:key}),'googleSheetsApiKey'),false);
 assert.equal(readConfig({}).port,3000);
});
test('公開 reader 固定端點、header 金鑰、無 OAuth，完整格式不遺失',async()=>{
 const fixture=sheetFixture(f1);let calls=0;
 const reader=new PublicSheetsReader(key,async(input,init)=>{
  calls++;const url=new URL(String(input));assert.equal(url.origin,'https://sheets.googleapis.com');assert.equal(url.pathname,'/v4/spreadsheets/fixture-copy');assert.ok(!url.href.includes(key));assert.equal(url.searchParams.get('fields'),'spreadsheetId,properties,sheets(properties,merges,data)');
  assert.deepEqual(init?.headers,{'X-Goog-Api-Key':key});assert.equal(init?.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);
  return Response.json(fixture);
 });
 assert.equal(reader.configured,true);assert.deepEqual(await reader.spreadsheet('fixture-copy',{fields:'spreadsheetId,properties,sheets(properties,merges,data)',ranges:"'sheet'!B:K"}),fixture);
 for(const id of ['../evil','https://evil.test','a?key=x',''])await assert.rejects(reader.spreadsheet(id,{}),{code:'INVALID_SHEETS_URL'});
 await assert.rejects(reader.spreadsheet('fixture-copy',{key:'injection'}),{code:'INVALID_REQUEST'});assert.equal(calls,1);
 await assert.rejects(new PublicSheetsReader(undefined).spreadsheet('fixture-copy',{}),{code:'PUBLIC_SHEETS_NOT_CONFIGURED'});
});
test('公開 reader 外部錯誤安全映射、不洩密；逾時固定20秒',async()=>{
 for(const [status,reason,code]of [[401,'','PUBLIC_SHEETS_KEY_INVALID'],[403,'','PUBLIC_SHEETS_FORBIDDEN'],[403,'API_KEY_SERVICE_BLOCKED','PUBLIC_SHEETS_KEY_INVALID'],[400,'API_KEY_INVALID','PUBLIC_SHEETS_KEY_INVALID'],[404,'','GOOGLE_DOCUMENT_NOT_FOUND'],[429,'','EXTERNAL_UNAVAILABLE']]as const){
  const reader=new PublicSheetsReader(key,async()=>Response.json({error:{message:key,details:[{reason}]}},{status}));
  await assert.rejects(reader.spreadsheet('fixture-copy',{}),error=>{assert.equal(Reflect.get(error as object,'code'),code);assert.ok(!JSON.stringify(publicError(error,'safe')).includes(key));return true;});
 }
 await assert.rejects(new PublicSheetsReader(key,async()=>new Response('{bad')).spreadsheet('fixture-copy',{}),{code:'EXTERNAL_UNAVAILABLE'});
 const original=AbortSignal.timeout;let duration=0;AbortSignal.timeout=ms=>{duration=ms;return AbortSignal.abort();};
 try{await assert.rejects(new PublicSheetsReader(key,async(_input,init)=>{init?.signal?.throwIfAborted();throw new Error(key);}).spreadsheet('fixture-copy',{}),{code:'EXTERNAL_UNAVAILABLE'});assert.equal(duration,20000);}finally{AbortSignal.timeout=original;}
});
