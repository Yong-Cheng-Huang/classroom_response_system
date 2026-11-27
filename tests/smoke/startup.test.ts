import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync,writeFileSync,mkdirSync,existsSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type AddressInfo } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { projectRoot } from '../../src/server/config.js';
import { openDatabase } from '../../src/server/database.js';

test('建置版可從其他目錄啟動，固定來源重啟並保留同一資料庫', { timeout: 20000 }, async t => {
  for(const module of ['google','google-http','google-vault'])assert.equal(existsSync(join(projectRoot,'dist/server/'+module+'.js')),false,'建置不應留舊OAuth模組');
  const directory = mkdtempSync(join(tmpdir(), 'classroom-startup-'));
  const probe = createServer();
  await new Promise<void>(done => probe.listen(0, '127.0.0.1', done));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>(done => probe.close(() => done()));
  const data = join(directory, 'data');
  const base = `http://127.0.0.1:${port}`;
  mkdirSync(data,{recursive:true});const legacy=join(data,'google-oauth-client.json'),audit=join(directory,'old-credential-read'),preload=join(directory,'audit.mjs');
  writeFileSync(legacy,JSON.stringify({web:{client_id:'OLD_CANARY',client_secret:'OLD_CANARY'}}));
  writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=fs.readFileSync;fs.readFileSync=function(...args){const path=String(args[0]);if(path===process.env.LEGACY_JSON||path.includes('google-credentials'))fs.writeFileSync(process.env.LEGACY_AUDIT,'unexpected');return original.apply(this,args);};syncBuiltinESMExports();`);
  let child: ChildProcess | undefined;
  t.after(() => { child?.kill('SIGKILL'); rmSync(directory, { recursive: true, force: true }); });
  const start = async () => {
    child = spawn(process.execPath, ['--import',preload,join(projectRoot, 'dist/server/index.js')], {
      cwd: directory, env: { ...process.env, APP_PORT: String(port), APP_DATA_DIR: data, TEACHER_PASSWORD: '',LEGACY_JSON:legacy,LEGACY_AUDIT:audit,GOOGLE_OAUTH_CLIENT_FILE:legacy,GOOGLE_SERVICE_ACCOUNT_FILE:join(data,'google-service-account.json') },
      stdio: 'ignore',
    });
    let failure: Error | undefined;
    child.once('error', error => { failure = error; });
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      assert.equal(child.exitCode, null, '伺服器不應提前結束');
      try {
        const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(300) });
        if (response.ok) return;
      } catch { /* 等待本機服務開始接受請求。 */ }
      await setTimeout(50);
    }
    throw new Error('本機服務未在期限內就緒');
  };
  const stop = async () => {
    const running = child!;
    const exited = new Promise<void>((done, fail) => running.once('exit', code => code === 0 ? done() : fail(new Error('正常停機失敗'))));
    running.kill('SIGTERM'); await exited; child = undefined;
  };
  await start();
  assert.match(await (await fetch(base)).text(), /課堂搶答系統/);
  assert.equal((await fetch(base + '/data/classroom.db')).status, 404);
  await stop();
  const first = openDatabase(join(data, 'classroom.db'));
  first.prepare("INSERT INTO document_output_management VALUES ('copy','sheet','H5','UNVERIFIED','hash',0,'{}','format')").run();
  first.prepare("INSERT INTO google_connection VALUES(1,'old-account','[]','legacy-reference','CONNECTED')").run();
  first.close();
  writeFileSync(join(data,'google-service-account.json'),'{invalid secret-canary');
  await start();
  assert.equal((await (await fetch(base + '/api/health')).json()).data.schemaVersion, 3);
  await stop();
  const reopened = openDatabase(join(data, 'classroom.db'));
  assert.equal(existsSync(audit),false,'不得讀取舊OAuth或vault');assert.ok(readFileSync(legacy,'utf8').includes('OLD_CANARY'));
  assert.equal((reopened.prepare('SELECT credential_reference FROM google_connection').get() as {credential_reference:string}).credential_reference,'legacy-reference');
  try { assert.equal((reopened.prepare('SELECT count(*) AS n FROM document_output_management').get() as { n: number }).n, 1); }
  finally { reopened.close(); }
});
