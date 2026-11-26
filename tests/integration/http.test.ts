import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { createApplication } from '../../src/server/app.js';
import { readConfig } from '../../src/server/config.js';
import { createLogger } from '../../src/server/logger.js';
import { temporaryDatabase } from '../helpers/database.js';

test('1.1／1.2／1.3／2.2 HTTP 健康、固定來源、未設定登入與未知路由', async t => {
  const { database } = temporaryDatabase(t);
  const lines: string[] = [];
  const app = createApplication(readConfig({}), database, createLogger(line => lines.push(line)));
  await app.listen(0); t.after(() => app.close());
  const address = app.server.address() as AddressInfo;
  assert.equal(address.address, '127.0.0.1');
  assert.equal((await app.commands.enqueue(receipt => receipt)).receiveOrder, 1);
  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).data.schemaVersion, 3);
  const login = await fetch(base + '/api/teacher/login', { method: 'POST', body: JSON.stringify({ password: 'sensitive-password' }) });
  assert.equal(login.status, 503);
  assert.equal((await login.json()).error.code, 'TEACHER_PASSWORD_REQUIRED');
  const missing = await fetch(base + '/api/missing?token=sensitive-token');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('cache-control'), 'no-store');
  assert.equal((await missing.json()).error.message, '找不到要求的服務。');
  const wrongMethod = await fetch(base + '/api/health', { method: 'POST' });
  assert.equal(wrongMethod.status, 405);
  assert.doesNotMatch(lines.join('\n'), /sensitive|password|token|SELECT|stack/);
});

test('2.2 資料庫失敗只回傳安全中文，不暴露例外或本機路徑', async t => {
  const { database } = temporaryDatabase(t);
  const app = createApplication(readConfig({}), database, createLogger(() => undefined));
  await app.listen(0); t.after(() => app.close());
  database.close();
  const address = app.server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, 'DATABASE_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(body), /closed|SQL|sqlite|\/Users\/|stack/);
});

test('1.1 WebSocket 基礎通道尚未授權時一律拒絕', async t => {
  const { database } = temporaryDatabase(t);
  const app = createApplication(readConfig({}), database, createLogger(() => undefined));
  await app.listen(0); t.after(() => app.close());
  const address = app.server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    socket.once('open', () => { socket.close(); reject(new Error('不應授權未登入通道')); });
    socket.once('error', error => { assert.match(error.message, /401/); resolve(); });
  });
});
