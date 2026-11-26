import type { ActivityState } from '../shared/contracts.js';
import type { ActivityView, LobbyView, OwnSubmission, QuestionView, PublicGroup } from '../shared/views.js';
import { AppError } from '../shared/errors.js';
import { formatSubmissionTime } from './time.js';
import { requirePrincipal, type Principal } from './principal.js';

export type ActivityReadModel = {
  activity: { id: string; state: ActivityState; version: number; startedAt: number | null; endedAt: number | null };
  groups: { id: string; number: number }[];
  // 上游權威端已裁定的有效成員；投影本身不判斷停機、寬限或 U01。
  participants: { id: string; sessionId: string; groupId: string; nickname: string }[];
  questions: { id: string; number: string; kind: 'SINGLE' | 'GROUP'; fields: { id: string; label: string | null; prompt: string }[] }[];
  submissions: { id: string; questionId: string; groupId: string; senderNickname: string; rank: number; receivedAt: number;
    answers: { fieldId: string; text: string }[] }[];
};

function groups(model: ActivityReadModel): PublicGroup[] {
  return model.groups.map(group => ({ id: group.id, number: group.number,
    memberCount: new Set(model.participants.filter(member => member.groupId === group.id).map(member => member.id)).size }));
}
function questions(model: ActivityReadModel): QuestionView[] {
  return model.questions.map(question => ({ id: question.id, number: question.number, kind: question.kind,
    fields: question.fields.map(field => ({ id: field.id, label: field.label, prompt: field.prompt })) }));
}
function own(submission: ActivityReadModel['submissions'][number]): OwnSubmission {
  return { questionId: submission.questionId, senderNickname: submission.senderNickname,
    answers: submission.answers.map(answer => ({ fieldId: answer.fieldId, text: answer.text })) };
}

export function projectLobby(model: ActivityReadModel | null, serverNow: number): LobbyView {
  return { activityId: model?.activity.id ?? null, phase: model?.activity.state ?? 'EMPTY', canJoin: model?.activity.state === 'READY',
    groups: model ? groups(model) : [], serverNow };
}

// 採新建白名單 DTO，不展開內部物件；同一介面可供 HTTP、未來 WS／重連快照使用。
export function projectActivity(model: ActivityReadModel | null, subject: Principal | null, serverNow: number): ActivityView {
  const principal = requirePrincipal(subject, serverNow);
  if (!model) {
    if (principal.role === 'STUDENT') throw new AppError('ACTIVITY_CHANGED');
    return { role: 'TEACHER', activityId: null, phase: 'EMPTY', serverNow };
  }
  const activity = model.activity;
  const common = { activityId: activity.id, phase: activity.state, startedAt: activity.startedAt, endedAt: activity.endedAt,
    serverNow, groups: groups(model) };
  if (principal.role === 'TEACHER') {
    return { ...common, role: 'TEACHER', version: activity.version, questions: questions(model),
      submissions: model.submissions.map(submission => ({ ...own(submission), id: submission.id, groupId: submission.groupId,
        rank: submission.rank, receivedAt: submission.receivedAt, submittedAt: formatSubmissionTime(submission.receivedAt) })) };
  }
  if (principal.activityId !== activity.id) throw new AppError('ACTIVITY_CHANGED');
  const self = model.participants.find(member => member.id === principal.participantId && member.sessionId === principal.sessionId && member.groupId === principal.groupId);
  if (!self || !model.groups.some(group => group.id === principal.groupId)) throw new AppError('FORBIDDEN');
  const members = [...new Map(model.participants.filter(member => member.groupId === principal.groupId).map(member => [member.id, member])).values()];
  const base = { ...common, role: 'STUDENT' as const, groupId: self.groupId, participantId: self.id, nickname: self.nickname,
    members: members.map(member => ({ id: member.id, nickname: member.nickname, isSelf: member.id === self.id })) };
  if (activity.state === 'READY') {
    return { ...base, phase: 'READY', questions: model.questions.map(question => ({ id: question.id, number: question.number })) };
  }
  const mine = model.submissions.filter(submission => submission.groupId === self.groupId);
  if (activity.state === 'RUNNING') return { ...base, phase: 'RUNNING', questions: questions(model), ownSubmissions: mine.map(own) };
  if (activity.state !== 'ENDED') throw new AppError('INTERNAL_ERROR');
  const results = model.questions.map(question => {
    const submission = mine.find(value => value.questionId === question.id);
    const winner = model.submissions.find(value => value.questionId === question.id && value.rank === 1);
    const winnerGroup = winner && model.groups.find(group => group.id === winner.groupId);
    if (winner && !winnerGroup) throw new AppError('INTERNAL_ERROR');
    return { questionId: question.id, status: !submission ? 'MISSING' as const : submission.rank === 1 ? 'SUCCESS' as const : 'SUBMITTED' as const,
      ownSubmission: submission ? own(submission) : null,
      winner: winner && winnerGroup ? { ...own(winner), groupId: winner.groupId, groupNumber: winnerGroup.number } : null };
  });
  return { ...base, phase: 'ENDED', questions: questions(model), results, successCount: results.filter(result => result.status === 'SUCCESS').length };
}
