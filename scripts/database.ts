import { resolve } from 'node:path';
import { openDatabase, backupDatabase, restoreDatabase, schemaVersion } from '../src/server/database.js';
import { readConfig } from '../src/server/config.js';

let database: ReturnType<typeof openDatabase> | undefined;
try {
  const config = readConfig();
  const [command, source, target] = process.argv.slice(2);
  if (command === 'restore') {
    if (!source || !target) throw new Error();
    await restoreDatabase(resolve(source), resolve(target));
    console.log('資料已回復至指定新檔；啟動前請確認本機資料目錄。');
  } else {
    database = openDatabase(config.databasePath);
    if (command === 'migrate' || command === 'status') console.log(`資料庫已就緒，schema 版本：${schemaVersion(database)}。`);
    else if (command === 'backup' && source) { await backupDatabase(database, resolve(source)); console.log('資料庫備份完成。'); }
    else throw new Error();
  }
} catch {
  console.error('資料庫操作失敗。請檢查命令參數、版本與檔案權限；備份及回復目標必須是新檔。');
  process.exitCode = 1;
} finally { database?.close(); }
