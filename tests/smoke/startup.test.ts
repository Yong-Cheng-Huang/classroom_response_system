import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type AddressInfo } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { projectRoot } from '../../src/server/config.js';
import { openDatabase } from '../../src/server/database.js';

test('建置版可從其他目錄啟動，固定來源重啟並保留同一資料庫', { timeout: 20000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'classroom-startup-'));
  const probe = createServer();
  await new Promise<void>(done => probe.listen(0, '127.0.0.1', done));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>(done => probe.close(() => done()));
  const data = join(directory, 'data');
  const base = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  t.after(() => { child?.kill('SIGKILL'); rmSync(directory, { recursive: true, force: true }); });
  const start = async () => {
    child = spawn(process.execPath, [join(projectRoot, 'dist/server/index.js')], {
      cwd: directory, env: { ...process.env, APP_PORT: String(port), APP_DATA_DIR: data, TEACHER_PASSWORD: '',GOOGLE_OAUTH_CLIENT_FILE:join(directory,'no-google-client.json') },
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
  first.close();
  await start();
  assert.equal((await (await fetch(base + '/api/health')).json()).data.schemaVersion, 3);
  await stop();
  const reopened = openDatabase(join(data, 'classroom.db'));
  try { assert.equal((reopened.prepare('SELECT count(*) AS n FROM document_output_management').get() as { n: number }).n, 1); }
  finally { reopened.close(); }
});
