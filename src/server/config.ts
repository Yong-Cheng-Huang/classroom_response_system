import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../shared/errors.js';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const portText = env.APP_PORT ?? '3000';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new AppError('INVALID_CONFIG');
  const dataDir = resolve(projectRoot, env.APP_DATA_DIR || 'data');
  for (const directory of ['src', 'dist', 'node_modules']) {
    const forbidden = resolve(projectRoot, directory);
    if (dataDir === forbidden || dataDir.startsWith(forbidden + sep)) throw new AppError('INVALID_CONFIG');
  }
  const teacherPassword = env.TEACHER_PASSWORD?.trim() ? env.TEACHER_PASSWORD : undefined;
  return Object.freeze({ host: '127.0.0.1' as const, port, dataDir, databasePath: resolve(dataDir, 'classroom.db'), teacherPassword,serviceAccountFile:resolve(projectRoot,env.GOOGLE_SERVICE_ACCOUNT_FILE||resolve(dataDir,'google-service-account.json')) });
}

export type AppConfig = ReturnType<typeof readConfig>;
