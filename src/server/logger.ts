import type { ErrorCode } from '../shared/errors.js';

type LogEntry = { level: 'info' | 'error'; event: '啟動完成' | '服務停止' | '操作失敗' | '啟動失敗'; operationId?: string; code?: ErrorCode };

// 只序列化白名單欄位，永不記錄請求內容、URL、密碼、token 或原始 Error。
export function createLogger(write: (line: string) => void = line => process.stdout.write(line + '\n')) {
  return (entry: LogEntry) => write(JSON.stringify({
    time: new Date().toISOString(), level: entry.level, event: entry.event,
    ...(entry.operationId ? { operationId: entry.operationId } : {}),
    ...(entry.code ? { code: entry.code } : {}),
  }));
}
export type Logger = ReturnType<typeof createLogger>;
