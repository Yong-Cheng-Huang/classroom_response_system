import { readConfig } from './config.js';
import { openDatabase } from './database.js';
import { createApplication } from './app.js';
import { createLogger } from './logger.js';
import { AppError } from '../shared/errors.js';
import { IdentityService } from './identity.js';
import { assertRequestOrigin } from './identity-http.js';
import { readActivityModel } from './read-model.js';
import { ActivityService } from './activity.js';
import { loadServiceAccount } from './service-account-config.js';
import { ServiceAccountSheets,ServiceAccountTokens } from './service-account.js';
import { PublicSheetsReader } from './public-sheets.js';
import { ImportService } from './imports.js';
import { ExportService } from './exports.js';
import { SubmissionService } from './submissions.js';

const logger = createLogger();
let database: ReturnType<typeof openDatabase> | undefined;
let identity:IdentityService|undefined;
try {
  const config = readConfig();
  database = openDatabase(config.databasePath);
  identity=new IdentityService(database,config.teacherPassword,Date.now,true);
  const activeDatabase=database,activeIdentity=identity;
  let account:ReturnType<typeof loadServiceAccount>=null;
  try{account=loadServiceAccount(config.serviceAccountFile);}catch{logger({level:'error',event:'操作失敗',code:'SERVICE_ACCOUNT_INVALID'});}
  const activities=new ActivityService(activeDatabase,activeIdentity);
  const sheets=new ServiceAccountSheets(activeIdentity,new ServiceAccountTokens(account));
  const app = createApplication(config, database, logger,{
    identity:activeIdentity,
    submissions:new SubmissionService(activeDatabase,activeIdentity),
    exports:new ExportService(activeDatabase,activeIdentity,sheets,activities),
    activities,sheets,imports:new ImportService(activeDatabase,activeIdentity,sheets,activities,Date.now,undefined,new PublicSheetsReader(config.googleSheetsApiKey)),
    authenticate:request=>{assertRequestOrigin(request);return activeIdentity.principal(activeIdentity.proof(request));},
    beforeRead:()=>activeIdentity.sweep(),
    readModel:()=>readActivityModel(activeDatabase,activeIdentity),
  });
  let vite: { close(): Promise<void> } | undefined;
  if (process.argv.includes('--dev')) {
    const { createServer } = await import('vite');
    const development = await createServer({ server: { middlewareMode: true, ws: { server: app.server } }, appType: 'spa' });
    app.setMiddleware(development.middlewares);
    vite = development;
  }
  await app.listen();
  identity.markReady();
  logger({ level: 'info', event: '啟動完成' });
  if (!config.teacherPassword) logger({ level: 'info', event: '啟動完成', code: 'TEACHER_PASSWORD_REQUIRED' });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try { await vite?.close(); await app.close(); identity?.shutdown();database?.close(); logger({ level: 'info', event: '服務停止' }); }
    catch { logger({ level: 'error', event: '操作失敗', code: 'INTERNAL_ERROR' }); process.exitCode = 1; }
  };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
} catch (error) {
  if (database?.open) database.close();
  logger({ level: 'error', event: '啟動失敗', code: error instanceof AppError ? error.code : 'INTERNAL_ERROR' });
  process.exitCode = 1;
}
