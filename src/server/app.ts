import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { RealtimeService } from './realtime.js';
import type { AppConfig } from './config.js';
import { projectRoot } from './config.js';
import type { SqliteDatabase } from './database.js';
import { schemaVersion } from './database.js';
import type { Logger } from './logger.js';
import { createLogger } from './logger.js';
import { AppError, publicError } from '../shared/errors.js';
import { OrderedCommandQueue, createSqliteAllocator } from './command-queue.js';
import { createApi, type ApiPorts } from './api.js';
import { identityHttp } from './identity-http.js';
import { sheetsHttp } from './sheets-http.js';
import {ServiceAccountSheets,ServiceAccountTokens} from './service-account.js';
import { exportHttp } from './export-http.js';
import { importHttp } from './import-http.js';

type Middleware = (request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => void;
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

export function createApplication(config: AppConfig, database: SqliteDatabase, logger: Logger = createLogger(), ports: ApiPorts = {}) {
  let middleware: Middleware | undefined;
  const commands = new OrderedCommandQueue(createSqliteAllocator(database,ports.now));
  const realtime = new RealtimeService(ports,commands);
  const api = createApi(database, commands, ports);
  const sessions=ports.identity?identityHttp(ports.identity,commands):undefined;
  const sheets=ports.identity?sheetsHttp(ports.sheets??new ServiceAccountSheets(ports.identity,new ServiceAccountTokens(null)),ports.identity):undefined;
  const imports=ports.identity&&ports.imports?importHttp(ports.imports,ports.identity,commands):undefined;

  const exports=ports.identity&&ports.exports&&ports.activities?exportHttp(ports.exports,ports.identity,ports.activities,commands):undefined;

  const server = createServer((request, response) => {
    const operationId = randomUUID();
    // 靜態資源及唯讀輪詢不重掃全部通道；固定100ms授權／狀態檢查照常執行。
    if(request.url?.startsWith('/api/')&&request.method!=='GET'&&request.method!=='HEAD')response.once('finish',()=>realtime.requestFlush());
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Opener-Policy','noopener-allow-popups');
    const sendError = (error: unknown) => {
      if (response.headersSent) { response.destroy(); return; }
      const result = publicError(error, operationId);
      logger({ level: 'error', event: '操作失敗', operationId, code: result.body.error.code });
      response.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(result.body));
    };

    void (async () => {
      const url = new URL(request.url ?? '/', `http://${config.host}:${config.port}`);
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/health') {
          if (request.method !== 'GET') throw new AppError('METHOD_NOT_ALLOWED');
          let version: number;
          try { version = schemaVersion(database); }
          catch { throw new AppError('DATABASE_UNAVAILABLE'); }
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ ok: true, data: { service: '課堂搶答系統', schemaVersion: version, phase: 1 }, operationId }));
          return;
        }
        if (url.pathname === '/api/teacher/login') {
          if (request.method !== 'POST') throw new AppError('METHOD_NOT_ALLOWED');
          if (!config.teacherPassword) throw new AppError('TEACHER_PASSWORD_REQUIRED');
          if(!sessions)throw new AppError('FEATURE_NOT_READY');
        }
        if(await realtime.http(request,response,url,operationId))return;
        if(sessions&&await sessions(request,response,url,operationId))return;
        if(sheets&&await sheets(request,response,url,operationId))return;
        if(imports&&await imports(request,response,url,operationId))return;
        if(exports&&await exports(request,response,url,operationId))return;
        if (await api(request, response, url, operationId)) return;
        throw new AppError('NOT_FOUND');
      }
      if (url.pathname === '/ws') throw new AppError('UNAUTHORIZED');
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new AppError('METHOD_NOT_ALLOWED');
      if (middleware) {
        middleware(request, response, error => sendError(error ?? new AppError('NOT_FOUND')));
        return;
      }
      const clientDir = resolve(projectRoot, 'dist/client');
      const decoded = decodeURIComponent(url.pathname);
      const target = resolve(clientDir, '.' + decoded);
      if (target !== clientDir && !target.startsWith(clientDir + sep)) throw new AppError('NOT_FOUND');
      const path = decoded === '/' ? resolve(clientDir, 'index.html') : target;
      let contents: Buffer;
      try { contents = await readFile(path); } catch { throw new AppError('NOT_FOUND'); }
      // 僅內容雜湊命名的公開建置資源可長期快取；首頁、API與錯誤仍no-store。
      if(/^\/assets\/[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/u.test(decoded))response.setHeader('Cache-Control','public, max-age=31536000, immutable');
      response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : contents);
    })().catch(sendError);
  });

  server.on('upgrade', (request, socket, head) => {
    // HTTP交接後不再由HTTP解析器代管錯誤；拒絕／中斷連線不能使程序崩潰。
    socket.on('error',()=>socket.destroy());
    // HMR 的 upgrade 交給 Vite；應用程式通道由短效票證驗證。
    let pathname: string;
    try { pathname = new URL(request.url ?? '/', `http://${config.host}:${config.port}`).pathname; }
    catch { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    if(pathname==='/ws'){realtime.upgrade(request,socket,head);return;}
    if (!middleware) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    }
  });

  return {
    server,
    commands,
    setMiddleware(value: Middleware) { middleware = value; },
    async listen(port = config.port) {
      await new Promise<void>((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(port, config.host, () => { server.off('error', reject); resolveListen(); });
      });
      return server.address();
    },
    async close() {
      realtime.close();
      const closed=new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));
      server.closeAllConnections();
      await commands.drain();await closed;
    },
  };
}
