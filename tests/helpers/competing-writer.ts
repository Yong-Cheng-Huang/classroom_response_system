import { openDatabase } from '../../src/server/database.js';
import { createSqliteAllocator } from '../../src/server/command-queue.js';
import { persistCompleteSubmission } from '../../src/server/storage.js';

const database = openDatabase(process.argv[2]!);
try {
  const id = `race-${process.argv[3]}`;
  persistCompleteSubmission(database, { id, activityId: 'a', questionId: 'q', groupId: 'g1', participantId: 'p1',
    senderNickname: '同名', ...createSqliteAllocator(database)(), rank: 1, requestId: id, requestHash: id,
    answers: [{ fieldId: 'f1', text: '競爭答案一' }, { fieldId: 'f2', text: '競爭答案二' }] });
} catch (error) {
  if (error instanceof Error && error.message.includes('UNIQUE')) process.exitCode = 2;
  else { console.error('非預期測試錯誤'); process.exitCode = 1; }
} finally { database.close(); }
