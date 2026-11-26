import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { f1, f2, syntheticF3, writableTestSpreadsheetId } from '../fixtures/catalog.js';

test('1.5 唯讀來源與原始範本結構固定，寫入測試必須另指定副本', () => {
  assert.equal(Object.keys(f1.cells).filter(key => /^B\d+$/.test(key) && Number(key.slice(1)) >= 5).length, 6);
  assert.ok(f1.merges.includes('G5:H5'));
  assert.equal(f2.cells.G5, '（1）');
  assert.ok(f2.merges.includes('B5:B6'));
  for (const value of [undefined, f1.sourceSpreadsheetId, f2.sourceSpreadsheetId]) assert.throws(() => writableTestSpreadsheetId(value));
  assert.equal(writableTestSpreadsheetId('explicit-test-copy'), 'explicit-test-copy');
});

test('1.6 F3 是60題140欄位，固定42分頁20輪且追蹤已確認政策', () => {
  const f3 = syntheticF3();
  assert.equal(Object.keys(f3.cells).filter(key => /^B\d+$/.test(key) && Number(key.slice(1)) >= 5).length, 60);
  assert.equal(Object.keys(f3.cells).filter(key => /^C\d+$/.test(key) && Number(key.slice(1)) >= 5).length, 140);
  const config = JSON.parse(readFileSync(new URL('../fixtures/benchmark.config.json', import.meta.url), 'utf8'));
  assert.equal(config.teacherTabs + config.studentTabs, 42);
  assert.equal(config.roundsPerDataset, 20);
  assert.deepEqual(config.measurements, ['T_commit', 'T_apply', 'T_ready', 'T_restored']);
  assert.equal(config.limitsMs.sync, 1000);
  assert.equal(config.limitsMs.recovery, 5000);
  assert.deepEqual(config.unresolved, []);
  assert.match(config.resolved.U01, /D38/);
  assert.match(config.resolved.U02, /D39/);
  assert.equal(config.appliedPolicy.decision,'D40');
  assert.deepEqual(config.wsMeasurements,['WS_revision','T_ws_arrival','T_ws_apply']);
  assert.deepEqual(config.pausedScenarios, ['Chrome凍結','Chrome丟棄','macOS休眠']);
});
