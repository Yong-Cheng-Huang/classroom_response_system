import { AppError } from './errors.js';

export type ActivityState = 'READY' | 'RUNNING' | 'ENDED';
export type ActivityPhase = 'EMPTY' | ActivityState;
export type CommandName = 'join' | 'leave' | 'start' | 'end' | 'submit';
export type CommandInputs = {
  join: { groupId: string; nickname: string };
  leave: Record<string, never>;
  start: { expectedVersion: number };
  end: { expectedVersion: number; confirmed: true };
  submit: { requestId: string; answers: { fieldId: string; text: string }[] };
};

function invalid(): never { throw new AppError('INVALID_REQUEST'); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid();
  return value as Record<string, unknown>;
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0020\u007f/\\?#]/u.test(value)) invalid();
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) invalid();
  return value;
}
function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid();
  return value as number;
}

// 此處是傳輸型別與必要欄位契約；可見字元及完整題組業務驗證由 4.5、8.1 承接。
export function parseCommand<N extends CommandName>(name: N, input: unknown): CommandInputs[N] {
  let result: CommandInputs[CommandName];
  switch (name) {
    case 'join': {
      const body = record(input, ['groupId', 'nickname']);
      result = { groupId: identifier(body.groupId), nickname: text(body.nickname) }; break;
    }
    case 'leave': record(input, []); result = {}; break;
    case 'start': {
      const body = record(input, ['expectedVersion']); result = { expectedVersion: version(body.expectedVersion) }; break;
    }
    case 'end': {
      const body = record(input, ['expectedVersion', 'confirmed']);
      if (body.confirmed !== true) invalid();
      result = { expectedVersion: version(body.expectedVersion), confirmed: true }; break;
    }
    case 'submit': {
      const body = record(input, ['requestId', 'answers']);
      if (!Array.isArray(body.answers)) invalid();
      const answers = body.answers.map(value => {
        const answer = record(value, ['fieldId', 'text']);
        if(typeof answer.text!=='string')invalid();
        return { fieldId: identifier(answer.fieldId), text: answer.text };
      });
      if (new Set(answers.map(answer => answer.fieldId)).size !== answers.length) invalid();
      result = { requestId: identifier(body.requestId), answers }; break;
    }
    default: return invalid();
  }
  return result as CommandInputs[N];
}

export function parseJsonCommand<N extends CommandName>(name: N, raw: Buffer | string): CommandInputs[N] {
  let input: unknown;
  try { input = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { return invalid(); }
  return parseCommand(name, input);
}
