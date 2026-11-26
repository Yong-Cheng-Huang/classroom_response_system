import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SqliteDatabase } from './database.js';
import type { OrderedCommandQueue } from './command-queue.js';
import type { Authenticate, Principal } from './principal.js';
import { requirePrincipal } from './principal.js';
import { projectActivity, projectLobby, type ActivityReadModel } from './projections.js';
import { identifier, parseJsonCommand, type ActivityState, type CommandName, type CommandInputs } from '../shared/contracts.js';
import { AppError } from '../shared/errors.js';
import type { IdentityService } from './identity.js';
import { assertRequestOrigin } from './identity-http.js';
import type { ActivityService } from './activity.js';
import type { GoogleService } from './google.js';
import type { ImportService } from './imports.js';
import type { ExportService } from './exports.js';
import type { SubmissionService } from './submissions.js';

export type ApiPorts = {
  authenticate?: Authenticate;
  readModel?: () => ActivityReadModel | null;
  now?: () => number;
  identity?: IdentityService;
  beforeRead?: () => void;
  activities?:ActivityService;
  google?:GoogleService;
  imports?:ImportService;
  submissions?:SubmissionService;
  exports?:ExportService;
};
type Route = { name: 'lobby' | 'view' | 'results' | CommandName; method: 'GET' | 'POST'; activityId?: string; questionId?: string };
type CurrentActivity = { id: string; state: ActivityState; version: number };

function routeFor(url: URL): Route | null {
  const parts = url.pathname.split('/').slice(1).map(part => {
    let decoded: string;
    try { decoded = decodeURIComponent(part); } catch { throw new AppError('INVALID_REQUEST'); }
    if (/[\\/]/u.test(decoded)) throw new AppError('INVALID_REQUEST');
    return decoded;
  });
  if (parts.join('/') === 'api/lobby') return { name: 'lobby', method: 'GET' };
  if (parts.join('/') === 'api/activities/current/view') return { name: 'view', method: 'GET' };
  if (parts[0] !== 'api' || parts[1] !== 'activities') return null;
  if (parts.length === 4 && ['join', 'leave', 'start', 'end', 'results'].includes(parts[3]!)) {
    const name = parts[3] as 'join' | 'leave' | 'start' | 'end' | 'results';
    return { name, method: name === 'results' ? 'GET' : 'POST', activityId: identifier(parts[2]) };
  }
  if (parts.length === 6 && parts[3] === 'questions' && parts[5] === 'submissions') {
    return { name: 'submit', method: 'POST', activityId: identifier(parts[2]), questionId: identifier(parts[4]) };
  }
  return null;
}

export function createApi(database: SqliteDatabase, commands: OrderedCommandQueue, ports: ApiPorts = {}) {
  const now = ports.now ?? Date.now;
  const readCurrent = () => {
    try { return database.prepare('SELECT id,state,version FROM activities WHERE current_slot=1').get() as CurrentActivity | undefined; }
    catch { throw new AppError('DATABASE_UNAVAILABLE'); }
  };
  const authenticated = async (request: IncomingMessage) => {
    // 缺少正式身分模組時一律拒絕；沒有 body/header 的測試角色捷徑。
    const subject = ports.authenticate ? await ports.authenticate(request) : null;
    return requirePrincipal(subject, now());
  };
  const checkCurrent = (route: Route, subject: Principal | null) => {
    const current = readCurrent();
    if (route.activityId && (!current || route.activityId !== current.id)) throw new AppError('ACTIVITY_CHANGED');
    if (subject?.role === 'STUDENT') {
      if (!current || subject.activityId !== current.id) throw new AppError('ACTIVITY_CHANGED');
      const member = database.prepare(`SELECT id FROM participants
        WHERE id=? AND session_id=? AND group_id=? AND activity_id=? AND membership_state='JOINED'`)
        .get(subject.participantId, subject.sessionId, subject.groupId, subject.activityId);
      if (!member) throw new AppError('FORBIDDEN');
    }
    if (route.questionId && !database.prepare('SELECT id FROM questions WHERE id=? AND activity_id=?').get(route.questionId, current!.id)) throw new AppError('NOT_FOUND');
    return current;
  };
  const readProjection = (current: CurrentActivity | undefined) => {
    if (!ports.readModel) {
      if (!current) return null;
      throw new AppError('FEATURE_NOT_READY');
    }
    const model = ports.readModel();
    if ((model?.activity.id ?? null) !== (current?.id ?? null)
      || (model && (model.activity.version !== current?.version || model.activity.state !== current?.state))) throw new AppError('VERSION_CONFLICT');
    return model;
  };
  const send = (response: ServerResponse, data: unknown, operationId: string) => {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true, data, operationId }));
  };

  return async function handle(request: IncomingMessage, response: ServerResponse, url: URL, operationId: string): Promise<boolean> {
    const route = routeFor(url);
    if (!route) return false;
    if (request.method !== route.method) throw new AppError('METHOD_NOT_ALLOWED');
    if ([...url.searchParams].length) throw new AppError('INVALID_REQUEST');
    if (route.method === 'GET') {
      const subject = route.name === 'lobby' ? null : await authenticated(request);
      ports.beforeRead?.();
      // 同步取得目前活動與投影，避免在讀取中間 await 造成場次拼接。
      const data = database.transaction(() => {
        const current = checkCurrent(route, subject);
        const model = readProjection(current);
        return route.name === 'lobby' ? projectLobby(model, now()) : projectActivity(model, subject, now());
      })();
      send(response, data, operationId);
      return true;
    }
    const data = await new Promise<unknown>((done, fail) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.once('error', () => fail(new AppError('INVALID_REQUEST')));
      request.once('aborted', () => fail(new AppError('INVALID_REQUEST')));
      request.once('end', () => {
        // 完整請求在此直接進共用入口；解析與非同步身分驗證之前已配置持久序號。
        commands.enqueue(async receipt => {
          if(ports.identity)assertRequestOrigin(request);
          const media = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
          if (media !== 'application/json') throw new AppError('UNSUPPORTED_MEDIA');
          const name = route.name as CommandName;
          const input = parseJsonCommand(name, Buffer.concat(chunks));
          const subject = name === 'join' ? null : await authenticated(request);
          if ((name === 'start' || name === 'end') && subject?.role !== 'TEACHER') throw new AppError('FORBIDDEN');
          if ((name === 'leave' || name === 'submit') && subject?.role !== 'STUDENT') throw new AppError('FORBIDDEN');
          const current = checkCurrent(route, subject)!;
          if ('expectedVersion' in input && input.expectedVersion !== current.version) throw new AppError('VERSION_CONFLICT');
          if (name === 'join' && !database.prepare('SELECT id FROM groups WHERE activity_id=? AND id=?').get(current.id, (input as {groupId:string}).groupId)) throw new AppError('NOT_FOUND');
          if ((name === 'join' || name === 'leave' || name === 'start') && current.state !== 'READY') throw new AppError('STATE_CONFLICT');
          if (name === 'end' && current.state !== 'RUNNING') throw new AppError('STATE_CONFLICT');
          if(ports.identity&&name==='join')return ports.identity.join(current.id,(input as {groupId:string}).groupId,(input as {nickname:string}).nickname,ports.identity.proof(request,false));
          if(ports.identity&&name==='leave'){ports.identity.leave(ports.identity.proof(request));return{left:true};}
          if(ports.activities&&ports.identity&&(name==='start'||name==='end'))return ports.activities.transition(ports.identity.proof(request),current.id,(input as {expectedVersion:number}).expectedVersion,name,receipt,name==='end'?true:undefined);
          if(ports.submissions&&ports.identity&&name==='submit')return ports.submissions.submit(ports.identity.proof(request),current.id,route.questionId!,input as CommandInputs['submit'],receipt);
          // 缺少正式業務服務的測試／基礎組態不回覆假的成功。
          throw new AppError('FEATURE_NOT_READY');
        }).then(done, fail);
      });
    });
    send(response,data,operationId);
    return true;
  };
}
