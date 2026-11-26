import type { SqliteDatabase } from './database.js';
import { normalizeAnswer } from '../shared/validation.js';

export type StoredSubmission = {
  id: string; activityId: string; questionId: string; groupId: string; participantId: string;
  senderNickname: string; receivedAt: number; receiveOrder: number; rank: number;
  requestId: string; requestHash: string; answers: { fieldId: string; text: string }[];
};

// 儲存邊界只負責一致落盤；角色、階段、名次裁定及重送流程留待後續階段。
export function persistCompleteSubmission(database: SqliteDatabase, submission: StoredSubmission) {
  database.transaction(() => {
    database.prepare(`INSERT INTO submissions
      (id, activity_id, question_id, group_id, participant_id, sender_nickname, received_at, receive_order, rank, request_id, request_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      submission.id, submission.activityId, submission.questionId, submission.groupId, submission.participantId,
      submission.senderNickname, submission.receivedAt, submission.receiveOrder, submission.rank,
      submission.requestId, submission.requestHash,
    );
    const insert = database.prepare('INSERT INTO submission_answers VALUES (?, ?, ?, ?, ?)');
    for (const answer of submission.answers) {
      const text = normalizeAnswer(answer.text);
      insert.run(submission.id, submission.activityId, submission.questionId, answer.fieldId, text);
    }
    database.prepare('UPDATE submissions SET sealed = 1 WHERE id = ?').run(submission.id);
  }).immediate();
}
