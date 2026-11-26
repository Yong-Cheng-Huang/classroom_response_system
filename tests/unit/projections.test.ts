import test from 'node:test';
import assert from 'node:assert/strict';
import { projectActivity, projectLobby } from '../../src/server/projections.js';
import { addPrivateCanaries, readModel, student, teacher } from '../helpers/read-model.js';

const noSecrets = (data: unknown) => assert.doesNotMatch(JSON.stringify(data), /GOOGLE_SECRET|SOURCE_SECRET|SESSION_SECRET|original_json|token_hash|receiveOrder|requestHash/);
const noStudentRanking = (data: unknown) => assert.doesNotMatch(JSON.stringify(data), /"rank"|"version"|"receivedAt"|"submittedAt"|"sessionId"/);

test('2.5 READY 學生只有題號，未知內部欄位不隨 DTO 外洩', () => {
  const model = addPrivateCanaries(readModel()); model.activity.state = 'READY'; model.activity.startedAt = null;
  const view = projectActivity(model, student, 2000);
  assert.equal(view.role, 'STUDENT'); assert.equal(view.phase, 'READY');
  if (view.role !== 'STUDENT' || view.phase !== 'READY') throw new Error('投影角色不符');
  assert.deepEqual(view.questions, [{ id: 'q', number: '1' }, { id: 'empty', number: '2' }, { id: 'single', number: '3' }]);
  assert.equal(view.members.filter(member => member.isSelf).length, 1);
  assert.equal(view.members.filter(member => member.nickname === '同名').length, 2);
  assert.doesNotMatch(JSON.stringify(view), /QUESTION_PRIVATE|"fields"|"prompt"|"answers"|OTHER_MEMBER|OTHER_LOSER|WINNER_VISIBLE/);
  noSecrets(view); noStudentRanking(view);
});

test('2.5 RUNNING 他組提交變動不能改變本組投影或透露全域序號', () => {
  const model = addPrivateCanaries(readModel());
  const before = projectActivity(model, student, 2000);
  model.submissions = model.submissions.filter(submission => submission.groupId === 'g1'); model.activity.version = 99;
  const after = projectActivity(model, student, 2000);
  assert.deepEqual(before, after);
  assert.equal(before.role, 'STUDENT'); if (before.role !== 'STUDENT' || before.phase !== 'RUNNING') throw new Error('投影階段不符');
  assert.equal(before.questions[0]!.fields.length, 2); assert.equal(before.ownSubmissions.length, 2);
  assert.doesNotMatch(JSON.stringify(before), /OTHER_MEMBER|OTHER_LOSER|WINNER_VISIBLE/);
  noSecrets(before); noStudentRanking(before);
  before.ownSubmissions[0]!.answers[0]!.text = '修改輸出';
  assert.equal(model.submissions[0]!.answers[0]!.text, '本組答案一');
});

test('2.5 ENDED 只公開成功組與本組答案，保留三種狀態、題組只計一題', () => {
  const model = addPrivateCanaries(readModel()); model.activity.state = 'ENDED'; model.activity.endedAt = 1900;
  const view = projectActivity(model, student, 2000);
  if (view.role !== 'STUDENT' || view.phase !== 'ENDED') throw new Error('結果投影不符');
  assert.deepEqual(view.results.map(result => result.status), ['SUBMITTED', 'MISSING', 'SUCCESS']);
  assert.equal(view.successCount, 1); assert.equal(view.results[0]!.winner!.groupNumber, 2);
  assert.equal(view.results[0]!.ownSubmission!.answers.length, 2);
  assert.equal(view.results[1]!.winner, null); assert.equal(view.results[1]!.ownSubmission, null);
  assert.match(JSON.stringify(view), /成功答案一|WINNER_VISIBLE_AFTER_END/);
  assert.doesNotMatch(JSON.stringify(view), /OTHER_LOSER|OTHER_MEMBER/);
  noSecrets(view); noStudentRanking(view);
});

test('2.5 老師可見全部提交與原始臺灣時間，但沒有憑證或來源原答案', () => {
  const model = addPrivateCanaries(readModel()); const view = projectActivity(model, teacher, 2000);
  if (view.role !== 'TEACHER' || view.phase === 'EMPTY') throw new Error('老師投影不符');
  assert.equal(view.submissions.length, 4); assert.equal(view.version, 1);
  assert.match(view.submissions[0]!.submittedAt, /1970-01-01 08:00:01.500（Asia\/Taipei）/);
  assert.match(JSON.stringify(view), /OTHER_LOSER_SECRET/); noSecrets(view);
});

test('2.5 無身分、已到期、舊活動、錯組或錯參與者不能取得投影', () => {
  const model = readModel();
  assert.throws(() => projectActivity(model, null, 2000), { code: 'UNAUTHORIZED' });
  assert.throws(() => projectActivity(model, { ...teacher, expiresAt: 2000 }, 2000), { code: 'UNAUTHORIZED' });
  assert.throws(() => projectActivity(model, { ...student, activityId: 'old' }, 2000), { code: 'ACTIVITY_CHANGED' });
  assert.throws(() => projectActivity(model, { ...student, groupId: 'g2' }, 2000), { code: 'FORBIDDEN' });
  assert.throws(() => projectActivity(model, { ...student, sessionId: 'other' }, 2000), { code: 'FORBIDDEN' });
  assert.throws(() => projectActivity(null, student, 2000), { code: 'ACTIVITY_CHANGED' });
});

test('2.5 大廳只給階段與去重人數，未匯入不虛構組別', () => {
  const model = addPrivateCanaries(readModel()); model.participants.push({ ...model.participants[0]! });
  const view = projectLobby(model, 2000);
  assert.equal(view.groups[0]!.memberCount, 2); assert.equal(view.canJoin, false);
  assert.doesNotMatch(JSON.stringify(view), /nickname|questions|submissions|answers|sessionId/); noSecrets(view);
  assert.deepEqual(projectLobby(null, 2000), { activityId: null, phase: 'EMPTY', canJoin: false, groups: [], serverNow: 2000 });
});
