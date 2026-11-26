import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, parseJsonCommand, identifier } from '../../src/shared/contracts.js';

test('2.1 輸入契約拒絕錯誤結構、未確認結束及客戶端權限／排名欄位', () => {
  for (const input of [null, [], 'x', {}, { expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: '1' }, { expectedVersion: 1, role: 'TEACHER' }, { expectedVersion: 1, activityId: 'other' }]) {
    assert.throws(() => parseCommand('start', input), { code: 'INVALID_REQUEST' });
  }
  assert.throws(() => parseCommand('end', { expectedVersion: 1, confirmed: false }), { code: 'INVALID_REQUEST' });
  assert.throws(() => parseJsonCommand('start', '{broken'), { code: 'INVALID_REQUEST' });
  const badUtf8 = Buffer.concat([Buffer.from('{"groupId":"g1","nickname":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]);
  assert.throws(() => parseJsonCommand('join', badUtf8), { code: 'INVALID_REQUEST' });
  assert.throws(() => parseCommand('leave', { groupId: 'g2' }), { code: 'INVALID_REQUEST' });
  assert.throws(() => parseCommand('submit', { requestId: 'r', rank: 1, answers: [{ fieldId: 'f', text: '答案' }] }), { code: 'INVALID_REQUEST' });
  assert.throws(() => parseCommand('submit', { requestId: 'r', answers: [{ fieldId: 'f', text: '答案' }, { fieldId: 'f', text: '另一答案' }] }), { code: 'INVALID_REQUEST' });
  assert.throws(() => parseCommand('join', { groupId: 'g1', nickname: '   ' }), { code: 'INVALID_REQUEST' });
  for (const id of ['', '../a', 'a/b', 'a\\b', 'a?b', 'a#b', '\0']) assert.throws(() => identifier(id), { code: 'INVALID_REQUEST' });
});

test('2.1 合法契約保留文字與可變欄位數，不接受客戶端時間作排序依據', () => {
  const answers = Array.from({ length: 140 }, (_, i) => ({ fieldId: 'f' + i, text: ' =文字\n👨‍👩‍👧‍👦 ' }));
  assert.deepEqual(parseCommand('submit', { requestId: 'request-1', answers }), { requestId: 'request-1', answers });
  assert.deepEqual(parseCommand('end', { expectedVersion: 1, confirmed: true }), { expectedVersion: 1, confirmed: true });
  assert.deepEqual(parseCommand('leave', {}), {});
  assert.deepEqual(parseJsonCommand('join', Buffer.from('{"groupId":"g1","nickname":"學生😀"}')), { groupId: 'g1', nickname: '學生😀' });
  assert.throws(() => parseCommand('submit', { requestId: 'r', receivedAt: -1, answers }), { code: 'INVALID_REQUEST' });
});
