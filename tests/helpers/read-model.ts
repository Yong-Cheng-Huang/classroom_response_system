import type { ActivityReadModel } from '../../src/server/projections.js';
import type { Principal } from '../../src/server/principal.js';

export const teacher: Extract<Principal, {role:'TEACHER'}> = { role: 'TEACHER', sessionId: 'teacher-session', expiresAt: 43200000 };
export const student: Extract<Principal, {role:'STUDENT'}> = { role: 'STUDENT', sessionId: 's1', expiresAt: 43200000, activityId: 'a', groupId: 'g1', participantId: 'p1' };

export function readModel(): ActivityReadModel {
  return {
    activity: { id: 'a', state: 'RUNNING', version: 1, startedAt: 1000, endedAt: null },
    groups: [{ id: 'g1', number: 1 }, { id: 'g2', number: 2 }, { id: 'g3', number: 3 }],
    participants: [
      { id: 'p1', sessionId: 's1', groupId: 'g1', nickname: '同名' },
      { id: 'p11', sessionId: 's11', groupId: 'g1', nickname: '同名' },
      { id: 'p2', sessionId: 's2', groupId: 'g2', nickname: 'OTHER_MEMBER' },
      { id: 'p3', sessionId: 's3', groupId: 'g3', nickname: 'OTHER_MEMBER_3' },
    ],
    questions: [
      { id: 'q', number: '1', kind: 'GROUP', fields: [
        { id: 'f1', label: '（1）', prompt: 'QUESTION_PRIVATE_BEFORE_START' },
        { id: 'f2', label: '（2）', prompt: '第二個子題' },
      ] },
      { id: 'empty', number: '2', kind: 'SINGLE', fields: [{ id: 'fe', label: null, prompt: '無人題目' }] },
      { id: 'single', number: '3', kind: 'SINGLE', fields: [{ id: 'f3', label: null, prompt: '單題敘述' }] },
    ],
    submissions: [
      { id: 'ours', questionId: 'q', groupId: 'g1', senderNickname: '同名', rank: 2, receivedAt: 1500,
        answers: [{ fieldId: 'f1', text: '本組答案一' }, { fieldId: 'f2', text: '本組答案二' }] },
      { id: 'winner', questionId: 'q', groupId: 'g2', senderNickname: 'WINNER_VISIBLE_AFTER_END', rank: 1, receivedAt: 1200,
        answers: [{ fieldId: 'f1', text: '成功答案一' }, { fieldId: 'f2', text: '成功答案二' }] },
      { id: 'loser', questionId: 'q', groupId: 'g3', senderNickname: 'OTHER_LOSER', rank: 3, receivedAt: 1700,
        answers: [{ fieldId: 'f1', text: 'OTHER_LOSER_SECRET' }, { fieldId: 'f2', text: 'OTHER_LOSER_SECRET_2' }] },
      { id: 'own-win', questionId: 'single', groupId: 'g1', senderNickname: '同名', rank: 1, receivedAt: 1800,
        answers: [{ fieldId: 'f3', text: '本組成功答案' }] },
    ],
  };
}

export function addPrivateCanaries(model: ActivityReadModel) {
  Object.assign(model, { googleToken: 'GOOGLE_SECRET', sourceSnapshot: 'SOURCE_SECRET' });
  Object.assign(model.activity, { receiveOrder: 12345 });
  for (const question of model.questions) for (const field of question.fields) Object.assign(field, { originalAnswer: 'SOURCE_SECRET', original_json: '{}' });
  for (const member of model.participants) Object.assign(member, { token_hash: 'SESSION_SECRET' });
  for (const submission of model.submissions) Object.assign(submission, { receiveOrder: 54321, requestHash: 'SESSION_SECRET' });
  return model;
}
