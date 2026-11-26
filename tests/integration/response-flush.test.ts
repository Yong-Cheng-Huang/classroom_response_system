import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../../src/server/database.js';
import {createApplication} from '../../src/server/app.js';
import {readConfig} from '../../src/server/config.js';
import {RealtimeService} from '../../src/server/realtime.js';

test('13.3 靜態資源及唯讀回覆不觸發全通道推送掃描；突發寫入於25ms合併通知',async t=>{
 t.mock.timers.enable({apis:['setInterval','setTimeout']});
 const calls=t.mock.method(RealtimeService.prototype,'flush',()=>{}),directory=mkdtempSync(join(tmpdir(),'crs-response-flush-')),database=openDatabase(join(directory,'test.db'));
 const app=createApplication(readConfig({APP_DATA_DIR:directory}),database,()=>{});const address=await app.listen(0);assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 try{for(const path of ['/','/api/health','/missing-asset.js','/api/lobby']){const response=await fetch(base+path);await response.text();}assert.equal(calls.mock.callCount(),0);const response=await fetch(base+'/api/missing',{method:'POST'});await response.text();for(let i=0;i<4;i++){const r=await fetch(base+'/api/missing',{method:'POST'});await r.text();}assert.equal(calls.mock.callCount(),0);t.mock.timers.tick(25);assert.equal(calls.mock.callCount(),1);}
 finally{await app.close();database.close();rmSync(directory,{recursive:true,force:true});}
});
