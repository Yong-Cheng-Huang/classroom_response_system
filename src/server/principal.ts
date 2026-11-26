import type { IncomingMessage } from 'node:http';
import { AppError } from '../shared/errors.js';

type Base = { sessionId: string; expiresAt: number };
export type Principal = (Base & { role: 'TEACHER' }) |
  (Base & { role: 'STUDENT'; activityId: string; groupId: string; participantId: string });
// 只由伺服器身分模組提供，每次呼叫重新驗有效性；絕不可從 body/query 的 role 建立。
export type Authenticate = (request: IncomingMessage) => Principal | null | Promise<Principal | null>;

export function requirePrincipal(value: Principal | null, now: number): Principal {
  if (!value || !value.sessionId || !Number.isFinite(value.expiresAt) || value.expiresAt <= now
    || (value.role !== 'TEACHER' && value.role !== 'STUDENT')) throw new AppError('UNAUTHORIZED');
  return value;
}
