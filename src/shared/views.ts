import type { ActivityPhase, ActivityState } from './contracts.js';

export type PublicGroup = { id: string; number: number; memberCount: number };
export type LobbyView = { activityId: string | null; phase: ActivityPhase; canJoin: boolean; groups: PublicGroup[]; serverNow: number };
export type QuestionNumber = { id: string; number: string };
export type QuestionView = QuestionNumber & { kind: 'SINGLE' | 'GROUP'; fields: { id: string; label: string | null; prompt: string }[] };
export type OwnSubmission = { questionId: string; senderNickname: string; answers: { fieldId: string; text: string }[] };
export type WinnerView = OwnSubmission & { groupId: string; groupNumber: number };
export type OwnResult = { questionId: string; status: 'SUCCESS' | 'SUBMITTED' | 'MISSING'; ownSubmission: OwnSubmission | null; winner: WinnerView | null };
type ActiveBase = { activityId: string; phase: ActivityState; startedAt: number | null; endedAt: number | null; serverNow: number; groups: PublicGroup[] };
type StudentBase = ActiveBase & { role: 'STUDENT'; groupId: string; participantId: string; nickname: string;
  members: { id: string; nickname: string; isSelf: boolean }[] };
export type StudentView = StudentBase & (
  { phase: 'READY'; questions: QuestionNumber[] } |
  { phase: 'RUNNING'; questions: QuestionView[]; ownSubmissions: OwnSubmission[] } |
  { phase: 'ENDED'; questions: QuestionView[]; results: OwnResult[]; successCount: number }
);
export type TeacherView = ActiveBase & { role: 'TEACHER'; version: number; questions: QuestionView[];
  submissions: (OwnSubmission & { id: string; groupId: string; rank: number; receivedAt: number; submittedAt: string })[] };
export type EmptyTeacherView = { role: 'TEACHER'; activityId: null; phase: 'EMPTY'; serverNow: number };
export type ActivityView = StudentView | TeacherView | EmptyTeacherView;
