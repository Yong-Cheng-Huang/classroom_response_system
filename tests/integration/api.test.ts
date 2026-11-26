import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { createApplication } from '../../src/server/app.js';
import type { ApiPorts } from '../../src/server/api.js';
import type { Principal } from '../../src/server/principal.js';
import { readConfig } from '../../src/server/config.js';
import { createLogger } from '../../src/server/logger.js';
import { seedActivity, temporaryDatabase } from '../helpers/database.js';
import { addPrivateCanaries, readModel, student, teacher } from '../helpers/read-model.js';
import type { SqliteDatabase } from '../../src/server/database.js';

async function fixture(t: TestContext, ports: ApiPorts = {}, seed = true) {
  const { database } = temporaryDatabase(t); if (seed) seedActivity(database);
  const logs: string[] = [];
  const app = createApplication(readConfig({}), database, createLogger(line => logs.push(line)), { now: () => 2000, ...ports });
  await app.listen(0); t.after(() => app.close());
  return { database, app, logs, base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` };
}
function businessRows(database: SqliteDatabase) {
  const tables = ['activities', 'sources', 'groups', 'questions', 'question_fields', 'sessions', 'participants', 'submissions', 'submission_answers', 'export_operations', 'document_output_management', 'google_connection'];
  return tables.map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() }));
}
async function post(base: string, path: string, body: unknown, extra: Record<string, string> = {}) {
  return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
}

test('2.1 真 HTTP 拒絕非法輸入、舊活動與版本，業務資料保持原樣', async t => {
  const { base, database, logs } = await fixture(t, { authenticate: () => teacher });
  const before = businessRows(database);
  const checks: [string, unknown, number, string][] = [
    ['/api/activities/old/end', { expectedVersion: 1, confirmed: true }, 409, 'ACTIVITY_CHANGED'],
    ['/api/activities/a/end', { expectedVersion: 2, confirmed: true }, 409, 'VERSION_CONFLICT'],
    ['/api/activities/a/end', { expectedVersion: 1, confirmed: false }, 400, 'INVALID_REQUEST'],
    ['/api/activities/a/start', { expectedVersion: 1, role: 'TEACHER' }, 400, 'INVALID_REQUEST'],
    ['/api/activities/a/start', { expectedVersion: 1 }, 409, 'STATE_CONFLICT'],
    ['/api/activities/a/end', { expectedVersion: 1, confirmed: true }, 501, 'FEATURE_NOT_READY'],
    ['/api/activities/a/join', { groupId: 'g1', nickname: '學生' }, 409, 'STATE_CONFLICT'],
    ['/api/activities/a%2Fother/end', { expectedVersion: 1, confirmed: true }, 400, 'INVALID_REQUEST'],
  ];
  for (const [path, body, status, code] of checks) {
    const response = await post(base, path, body); assert.equal(response.status, status);
    const value = await response.json(); assert.equal(value.error.code, code);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(JSON.stringify(value), /receiveOrder|SQL|\/Users\/|stack/);
  }
  const invalidJson = await fetch(base + '/api/activities/a/end', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"secret":"PRIVATE_TEST",' });
  assert.equal(invalidJson.status, 400);
  const media = await post(base, '/api/activities/a/end', {}, { 'Content-Type': 'text/plain' }); assert.equal(media.status, 415);
  const method = await fetch(base + '/api/activities/a/end'); assert.equal(method.status, 405);
  assert.deepEqual(businessRows(database), before);
  assert.ok((database.prepare('SELECT receive_high_water AS n FROM system_state').get() as { n: number }).n > 0);
  assert.doesNotMatch(logs.join('\n'), /PRIVATE_TEST|nickname|password|token|SQL|stack/);
});

test('2.1 沒有正式驗證器時不信任角色、Bearer 或分頁宣告；空大廳可讀', async t => {
  const { base, database } = await fixture(t, {}, false);
  const lobby = await (await fetch(base + '/api/lobby')).json();
  assert.deepEqual(lobby.data, { activityId: null, phase: 'EMPTY', canJoin: false, groups: [], serverNow: 2000 });
  const response = await fetch(base + '/api/activities/current/view', { headers: { Authorization: 'Bearer fake', 'X-Role': 'TEACHER', 'X-Tab-Secret': 'fake' } });
  assert.equal(response.status, 401);
  seedActivity(database);
  const denied = await post(base, '/api/activities/a/end', { expectedVersion: 1, confirmed: true }, { Authorization: 'Bearer fake', 'X-Role': 'TEACHER' });
  assert.equal(denied.status, 401);
  assert.equal((await fetch(base + '/api/lobby')).status, 501); // 尚未接上有效成員讀取，不虛構零人。
});

test('2.1 學生參與綁定與題目歸屬由伺服器檢查，不能換路徑操作他組', async t => {
  let subject = student;
  const { base, database } = await fixture(t, { authenticate: () => subject });
  const before = businessRows(database);
  const body = { requestId: 'r', answers: [{ fieldId: 'f1', text: '答案' }] };
  assert.equal((await post(base, '/api/activities/a/end', { expectedVersion: 1, confirmed: true })).status, 403);
  assert.equal((await post(base, '/api/activities/a/questions/unknown/submissions', body)).status, 404);
  assert.equal((await post(base, '/api/activities/old/questions/q/submissions', body)).status, 409);
  subject = { ...student, groupId: 'g2' };
  assert.equal((await post(base, '/api/activities/a/questions/q/submissions', body)).status, 403);
  subject = { ...student, expiresAt: 2000 };
  assert.equal((await post(base, '/api/activities/a/questions/q/submissions', body)).status, 401);
  subject = student;
  assert.equal((await post(base, '/api/activities/a/questions/q/submissions', body)).status, 501);
  assert.deepEqual(businessRows(database), before);
});

test('2.1 HTTP 入口先持久配置，再等待驗證；後到命令不能越序', { timeout: 8000 }, async t => {
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(done => { release = done; }); const firstEntered = new Promise<void>(done => { entered = done; });
  t.after(() => release()); const order: string[] = [];
  const { base, database } = await fixture(t, { authenticate: async request => {
    const marker = String(request.headers['x-fixture-order']); order.push(marker);
    if (marker === 'A') { entered(); await held; } return teacher;
  } });
  const input = { expectedVersion: 1, confirmed: true };
  const first = post(base, '/api/activities/a/end', input, { 'X-Fixture-Order': 'A' });
  await firstEntered;
  assert.equal((database.prepare('SELECT receive_high_water AS n FROM system_state').get() as { n: number }).n, 1);
  const second = post(base, '/api/activities/a/end', input, { 'X-Fixture-Order': 'B' });
  const deadline = Date.now() + 2000;
  while ((database.prepare('SELECT receive_high_water AS n FROM system_state').get() as { n: number }).n < 2 && Date.now() < deadline) await setTimeout(1);
  assert.equal((database.prepare('SELECT receive_high_water AS n FROM system_state').get() as { n: number }).n, 2);
  assert.deepEqual(order, ['A']); release();
  assert.deepEqual((await Promise.all([first, second])).map(response => response.status), [501, 501]);
  assert.deepEqual(order, ['A', 'B']);
});

test('2.1 完整 HTTP 本文才算命令入口，先送部分位元組不能搶先配置', async t => {
  const order: string[] = [];
  const { base, database } = await fixture(t, { authenticate: request => { order.push(String(request.headers['x-fixture-order'])); return teacher; } });
  let slow: ReturnType<typeof httpRequest>;
  const responseA = new Promise<number>((done, fail) => {
    slow = httpRequest(base + '/api/activities/a/end', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fixture-Order': 'A' } }, response => { response.resume(); response.once('end', () => done(response.statusCode!)); });
    slow.once('error', fail); slow.write('{"expectedVersion":');
  });
  t.after(() => slow.destroy());
  const responseB = await post(base, '/api/activities/a/end', { expectedVersion: 1, confirmed: true }, { 'X-Fixture-Order': 'B' });
  assert.equal(responseB.status, 501); assert.deepEqual(order, ['B']);
  assert.equal((database.prepare('SELECT receive_high_water AS n FROM system_state').get() as { n: number }).n, 1);
  slow!.end('1,"confirmed":true}'); assert.equal(await responseA, 501); assert.deepEqual(order, ['B', 'A']);
});

test('2.1 本文尚未完整就中斷不配置序號，不改業務且服務繼續可用', async t => {
  const { base, database, logs } = await fixture(t, { authenticate: () => teacher });
  const before = businessRows(database);
  const request = httpRequest(base + '/api/activities/a/end', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  request.on('error', () => undefined);
  const connected = new Promise<void>(done => request.once('socket', socket => { if (socket.connecting) socket.once('connect', done); else done(); }));
  request.write('{"expectedVersion":'); await connected;
  // 先確定伺服器收到請求，再於尚無 end 的情況中止。
  await setTimeout(10); request.destroy();
  const deadline = Date.now() + 1000;
  while (!logs.some(line => line.includes('INVALID_REQUEST')) && Date.now() < deadline) await setTimeout(1);
  assert.ok(logs.some(line => line.includes('INVALID_REQUEST')));
  assert.equal((await fetch(base + '/api/health')).status, 200);
  assert.equal((database.prepare('SELECT receive_high_water AS n FROM system_state').get() as { n: number }).n, 0);
  assert.deepEqual(businessRows(database), before);
});

test('2.5 真 HTTP 只序列化授權投影，不能用 query 取他組資料', async t => {
  const model = addPrivateCanaries(readModel()); let subject: Principal = student;
  const { base, database } = await fixture(t, { authenticate: () => subject, readModel: () => model });
  let response = await fetch(base + '/api/activities/current/view');
  assert.equal(response.status, 200); const running = await response.text();
  assert.match(running, /本組答案一/); assert.doesNotMatch(running, /OTHER_LOSER|OTHER_MEMBER|WINNER_VISIBLE|SOURCE_SECRET|SESSION_SECRET|GOOGLE_SECRET|receiveOrder|"rank"|"version"/);
  assert.equal((await fetch(base + '/api/activities/current/view?groupId=g2')).status, 400);
  assert.equal((await fetch(base + '/api/activities/old/results')).status, 409);
  model.activity.state = 'ENDED'; model.activity.endedAt = 1900;
  database.prepare("UPDATE activities SET state='ENDED',ended_at=1900").run();
  response = await fetch(base + '/api/activities/a/results'); const ended = await response.text();
  assert.equal(response.status, 200); assert.match(ended, /成功答案一/); assert.doesNotMatch(ended, /OTHER_LOSER|"rank"/);
  subject = teacher;
  const full = await (await fetch(base + '/api/activities/current/view')).text(); assert.match(full, /OTHER_LOSER_SECRET|"rank":3/);
  model.activity.version++;
  response = await fetch(base + '/api/activities/current/view'); assert.equal(response.status, 409);
  assert.doesNotMatch(await response.text(), /OTHER_LOSER|SOURCE_SECRET/);
});
