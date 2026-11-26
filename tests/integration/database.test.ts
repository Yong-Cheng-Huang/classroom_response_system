import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { openDatabase, loadMigrations, migrate, backupDatabase, restoreDatabase, schemaVersion } from '../../src/server/database.js';
import { createSqliteAllocator, OrderedCommandQueue } from '../../src/server/command-queue.js';
import { persistCompleteSubmission, type StoredSubmission } from '../../src/server/storage.js';
import { seedActivity, temporaryDatabase } from '../helpers/database.js';

function submission(db: ReturnType<typeof openDatabase>, id = 'submission', group = 1): StoredSubmission {
  return { id, activityId: 'a', questionId: 'q', groupId: `g${group}`, participantId: `p${group}`, senderNickname: '同名',
    ...createSqliteAllocator(db, () => 2000)(), rank: group, requestId: id, requestHash: 'hash',
    answers: [{ fieldId: 'f1', text: ' 答案一 ' }, { fieldId: 'f2', text: '答案二' }] };
}

test('3.1 遷移可重跑，重啟保留來源、混合資料定位且啟用外鍵', t => {
  const { database, path } = temporaryDatabase(t);
  seedActivity(database);
  assert.equal(schemaVersion(database), 3);
  assert.equal(database.pragma('foreign_keys', { simple: true }), 1);
  database.close();
  const reopened = openDatabase(path);
  try {
    assert.equal(schemaVersion(reopened), 3);
    assert.deepEqual(reopened.prepare('SELECT kind FROM questions ORDER BY position').all(), [{ kind: 'GROUP' }, { kind: 'SINGLE' }]);
    assert.equal((reopened.prepare('SELECT answer_range FROM question_fields WHERE id = ?').get('f2') as { answer_range: string }).answer_range, 'H6');
    assert.throws(() => reopened.prepare("INSERT INTO groups VALUES ('bad', 'missing', 1)").run());
    assert.throws(() => reopened.prepare("INSERT INTO activities(id, state, group_count) VALUES ('bad', 'ENDED', 2)").run());
    assert.equal(reopened.pragma('integrity_check', { simple: true }), 'ok');
  } finally { reopened.close(); }
});

test('3.1 遷移校驗不允許修改已套用版本', t => {
  const { database, path } = temporaryDatabase(t);
  database.prepare("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1").run();
  database.close();
  assert.throws(() => openDatabase(path), /migration_integrity/);
});

test('3.1 未知 schema 版本拒絕啟動，失敗遷移整筆回滾', t => {
  const { database, path } = temporaryDatabase(t); seedActivity(database);
  assert.throws(() => migrate(database, [...loadMigrations(), { version: 4, name: '004_test.sql', checksum: 'test', sql: 'CREATE TABLE must_rollback(id INTEGER); invalid SQL;' }]));
  assert.equal(schemaVersion(database), 3);
  assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name = 'must_rollback'").get(), undefined);
  assert.equal((database.prepare('SELECT count(*) AS n FROM activities').get() as { n: number }).n, 1);
  database.prepare("INSERT INTO schema_migrations VALUES (99, 'unknown.sql', 'unknown', 0)").run(); database.close();
  assert.throws(() => openDatabase(path), /migration_integrity/);
});

test('3.2 已失效與固定期限落盤，重啟不自動復活；暱稱可重複', t => {
  const { database, path } = temporaryDatabase(t);
  seedActivity(database);
  database.prepare("UPDATE sessions SET lifecycle = 'REVOKED', revoked_reason = '已失效' WHERE id = 's1'").run();
  database.prepare("UPDATE sessions SET lifecycle = 'GRACE', grace_started_at = 1000, grace_deadline = 31000, shutdown_evidence_json = '{}' WHERE id = 's2'").run();
  database.close();
  const reopened = openDatabase(path);
  try {
    assert.equal((reopened.prepare("SELECT lifecycle FROM sessions WHERE id = 's1'").get() as { lifecycle: string }).lifecycle, 'REVOKED');
    assert.throws(() => reopened.prepare("UPDATE sessions SET lifecycle = 'CONNECTED' WHERE id = 's1'").run(), /session_terminal/);
    assert.throws(() => reopened.prepare("UPDATE sessions SET expires_at = expires_at + 1 WHERE id = 's2'").run());
    assert.equal((reopened.prepare('SELECT count(*) AS n FROM participants WHERE nickname = ?').get('同名') as { n: number }).n, 2);
    assert.equal((reopened.prepare("SELECT grace_deadline FROM sessions WHERE id = 's2'").get() as { grace_deadline: number }).grace_deadline, 31000);
    // 刻意不執行 U01 的自動恢復裁定。
  } finally { reopened.close(); }
});

test('3.3 題組完整保存、唯一約束與答案不可改', t => {
  const { database } = temporaryDatabase(t);
  seedActivity(database);
  persistCompleteSubmission(database, submission(database));
  assert.equal((database.prepare('SELECT count(*) AS n FROM submission_answers').get() as { n: number }).n, 2);
  assert.throws(() => persistCompleteSubmission(database, submission(database, 'duplicate')), /UNIQUE/);
  const second = submission(database, 'rank-collision', 2); second.rank = 1;
  assert.throws(() => persistCompleteSubmission(database, second), /UNIQUE/);
  const otherGroup = submission(database, 'wrong-group', 2); otherGroup.participantId = 'p1';
  assert.throws(() => persistCompleteSubmission(database, otherGroup), /FOREIGN KEY/);
  assert.throws(() => database.prepare("UPDATE submission_answers SET answer_text = 'changed'").run(), /immutable/);
  assert.throws(() => database.prepare('UPDATE submissions SET rank = 3').run(), /immutable/);
  assert.equal((database.prepare('SELECT answer_text FROM submission_answers WHERE field_id = ?').get('f1') as { answer_text: string }).answer_text, '答案一');
});

test('3.3 題組中途失敗與子題不足都整筆回滾', t => {
  const { database } = temporaryDatabase(t);
  seedActivity(database);
  const invalid = submission(database); invalid.answers[1]!.text = '   ';
  assert.throws(() => persistCompleteSubmission(database, invalid), {code:'INVALID_ANSWER'});
  const incomplete = submission(database, 'incomplete'); incomplete.answers.pop();
  assert.throws(() => persistCompleteSubmission(database, incomplete), /incomplete/);
  assert.equal((database.prepare('SELECT count(*) AS n FROM submissions').get() as { n: number }).n, 0);
  assert.equal((database.prepare('SELECT count(*) AS n FROM submission_answers').get() as { n: number }).n, 0);
});

test('3.3 真 SQLite 多程序同組競爭只有一筆成功', async t => {
  const { database, path } = temporaryDatabase(t); seedActivity(database);
  const results = await Promise.all(Array.from({ length: 4 }, (_, index) => new Promise<number>((done, fail) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'tests/helpers/competing-writer.ts', path, String(index)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = ''; child.stderr.on('data', chunk => { error += chunk; });
    child.once('error', fail); child.once('exit', code => { if (code === 0 || code === 2) done(code); else fail(new Error(error)); });
  })));
  assert.equal(results.filter(code => code === 0).length, 1);
  assert.equal((database.prepare('SELECT count(*) AS n FROM submissions').get() as { n: number }).n, 1);
  assert.equal((database.prepare('SELECT count(*) AS n FROM submission_answers').get() as { n: number }).n, 2);
});

test('3.4 本場恢復資料與跨場最少未核實管理分離', t => {
  const { database, path } = temporaryDatabase(t); seedActivity(database);
  database.exec(`INSERT INTO export_operations VALUES ('op', 'a', 'copy', 'sheet', 'INLINE', 'UNCONFIRMED', '{"before":{},"expected":{},"ranges":["H5"]}', 'hash', 0, 0);
    INSERT INTO document_output_management VALUES ('copy', 'sheet', 'H5', 'UNVERIFIED', 'hash', 4, '{"wrap":"WRAP","height":40}', 'format-hash');`);
  database.close();
  const reopened = openDatabase(path);
  try {
    assert.equal((reopened.prepare('SELECT state FROM export_operations').get() as { state: string }).state, 'UNCONFIRMED');
    reopened.prepare("DELETE FROM activities WHERE id = 'a'").run();
    assert.equal((reopened.prepare('SELECT count(*) AS n FROM export_operations').get() as { n: number }).n, 0);
    assert.equal((reopened.prepare('SELECT verification FROM document_output_management').get() as { verification: string }).verification, 'UNVERIFIED');
    const columns = reopened.pragma('table_info(document_output_management)') as { name: string }[];
    assert.ok(!columns.some(column => ['answers', 'answer_text', 'recovery_plan_json'].includes(column.name)));
  } finally { reopened.close(); }
});

test('3.6 舊版本升級及 WAL 備份回復至新檔，拒絕覆寫', async t => {
  const { database, directory } = temporaryDatabase(t); database.close();
  const legacyPath = join(directory, 'legacy.db');
  const legacy = openDatabase(legacyPath, loadMigrations().slice(0, 1));
  seedActivity(legacy); legacy.close();
  const upgraded = openDatabase(legacyPath);
  const backupPath = join(directory, 'backup.db');
  try { assert.equal(schemaVersion(upgraded), 3); await backupDatabase(upgraded, backupPath); }
  finally { upgraded.close(); }
  const restoredPath = join(directory, 'restored.db');
  await restoreDatabase(backupPath, restoredPath);
  await assert.rejects(restoreDatabase(backupPath, restoredPath), /target_exists/);
  const restored = openDatabase(restoredPath);
  try {
    assert.equal((restored.prepare('SELECT count(*) AS n FROM question_fields').get() as { n: number }).n, 3);
    assert.equal(schemaVersion(restored), 3);
    assert.equal(statSync(restoredPath).mode & 0o777, 0o600);
  } finally { restored.close(); }
  assert.ok(readFileSync(backupPath).length > 0);
});

test('3.7 持久序號在業務回滾、重啟與清場後不重用', async t => {
  const { database, path } = temporaryDatabase(t); seedActivity(database);
  const queue = new OrderedCommandQueue(createSqliteAllocator(database, () => 99));
  await assert.rejects(queue.enqueue(() => database.transaction(() => { throw new Error('rollback'); })()), /rollback/);
  assert.equal((await queue.enqueue(receipt => receipt)).receiveOrder, 2);
  database.prepare("DELETE FROM activities WHERE id = 'a'").run(); database.close();
  const reopened = openDatabase(path);
  try { assert.equal(createSqliteAllocator(reopened)().receiveOrder, 3); }
  finally { reopened.close(); }
});

test('3.7 高水位與配置證據不一致時拒絕啟動', t => {
  const { database, path } = temporaryDatabase(t);
  createSqliteAllocator(database)();
  database.prepare('UPDATE system_state SET receive_high_water = 0').run(); database.close();
  assert.throws(() => openDatabase(path), /receive_order_integrity/);
});

test('3.7 序號配置落盤後程序被強制終止也不重用', async t => {
  const { database, path } = temporaryDatabase(t);
  const script = `import { openDatabase } from './src/server/database.ts';
    import { createSqliteAllocator } from './src/server/command-queue.ts';
    const db = openDatabase(process.argv[1]); createSqliteAllocator(db)();
    process.send('已落盤'); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, path], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await new Promise<void>((done, fail) => {
    child.once('error', fail);
    child.once('message', () => child.kill('SIGKILL'));
    child.once('exit', (_code, signal) => signal === 'SIGKILL' ? done() : fail(new Error('未完成落盤後中斷')));
  });
  assert.equal(createSqliteAllocator(database)().receiveOrder, 2);
  // 僅驗接收序號 durability，沒有裁定 U01 的學生寬限恢復。
});
