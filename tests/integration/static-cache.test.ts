import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../../src/server/database.js';
import {createApplication} from '../../src/server/app.js';
import {readConfig} from '../../src/server/config.js';

test('13.3 雜湊公開程式資源可快取；首頁、API及不存在資源仍no-store',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'crs-static-cache-')),database=openDatabase(join(directory,'test.db')),app=createApplication(readConfig({APP_DATA_DIR:directory}),database,()=>{}),address=await app.listen(0);assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 try{const html=await fetch(base),text=await html.text();assert.equal(html.headers.get('cache-control'),'no-store');const asset=text.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];assert.ok(asset,'先建置前端再執行測試');const response=await fetch(base+asset);assert.equal(response.status,200);await response.text();assert.equal(response.headers.get('cache-control'),'public, max-age=31536000, immutable');for(const path of ['/api/health','/assets/不存在-12345678.js']){const r=await fetch(base+path);await r.text();assert.equal(r.headers.get('cache-control'),'no-store');}}
 finally{await app.close();database.close();rmSync(directory,{recursive:true,force:true});}
});
