import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readConfig, projectRoot } from '../../src/server/config.js';
import { AppError, publicError } from '../../src/shared/errors.js';
import { createLogger } from '../../src/server/logger.js';
import { OrderedCommandQueue } from '../../src/server/command-queue.js';
import { elapsedMilliseconds, formatSubmissionTime } from '../../src/server/time.js';

test('1.2／1.3 固定本機來源、資料路徑與無預設密碼', () => {
  const config = readConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
  assert.equal(config.databasePath, resolve(projectRoot, 'data/classroom.db'));
  assert.equal(config.teacherPassword, undefined);
  assert.equal(readConfig({ TEACHER_PASSWORD: '   ' }).teacherPassword, undefined);
  assert.equal(readConfig({ APP_PORT: '3101' }).port, 3101);
  for (const port of ['0', '80', '65536', 'abc', '3000.5', '']) assert.throws(() => readConfig({ APP_PORT: port }), AppError);
  for (const path of ['src/client/data', 'dist/client/data', 'node_modules/data']) assert.throws(() => readConfig({ APP_DATA_DIR: path }), AppError);
});

test('2.2 內部與外部錯誤只回傳白名單繁體中文', () => {
  const secret = 'token=秘密資料; SELECT * FROM sessions; stack';
  for (const error of [new Error(secret), new AppError('DATABASE_UNAVAILABLE'), new AppError('EXTERNAL_UNAVAILABLE')]) {
    const response = publicError(error, 'safe-operation');
    assert.equal(response.body.ok, false);
    assert.match(response.body.error.message, /[\u4e00-\u9fff]/);
    assert.ok(!JSON.stringify(response).includes(secret));
    assert.ok(!('stack' in response.body));
  }
});

test('1.3／2.2 日誌不序列化額外敏感欄位', () => {
  const lines: string[] = [];
  const log = createLogger(line => lines.push(line));
  const entry = { level: 'error' as const, event: '操作失敗' as const, operationId: 'request', password: 'secret-password', token: 'secret-token', error: new Error('secret-stack') };
  log(entry);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]!).event, '操作失敗');
  assert.doesNotMatch(lines[0]!, /secret|password|token|stack/);
});

test('2.3 序號在工作執行前同步配置，非同步交錯不越序', async () => {
  let high = 0;
  const log: number[] = [];
  const queue = new OrderedCommandQueue(() => ({ receiveOrder: ++high, receivedAt: 1000 }));
  const first = queue.enqueue(async receipt => { await new Promise(resolve => setTimeout(resolve, 15)); log.push(receipt.receiveOrder); throw new Error('invalid'); });
  const rejected = assert.rejects(first, /invalid/);
  const second = queue.enqueue(receipt => { log.push(receipt.receiveOrder); return receipt; });
  assert.equal(high, 2);
  await rejected;
  assert.equal((await second).receiveOrder, 2);
  assert.deepEqual(log, [1, 2]);
});

test('2.3 配置失敗後停止後續命令，不讓後續工作超越', async () => {
  let calls = 0;
  const queue = new OrderedCommandQueue(() => { calls++; throw new Error('disk'); });
  await assert.rejects(queue.enqueue(() => assert.fail()), /disk/);
  await assert.rejects(queue.enqueue(() => assert.fail()), /unavailable/);
  assert.equal(calls, 1);
});

test('2.4 臺灣時間至毫秒、可控計時與固定結束總時長', () => {
  assert.equal(formatSubmissionTime(Date.UTC(2026, 10, 26, 0, 1, 2, 3)), '2026-11-26 08:01:02.003（Asia/Taipei）');
  assert.equal(elapsedMilliseconds(null, null, () => 9000), 0);
  assert.equal(elapsedMilliseconds(1000, null, () => 5000), 4000);
  assert.equal(elapsedMilliseconds(1000, 3000, () => 9000), 2000);
  assert.equal(elapsedMilliseconds(1000, null, () => 50000), 49000);
});
