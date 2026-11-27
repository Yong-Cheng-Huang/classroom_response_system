export const errorCatalog = {
  INVALID_CONFIG: { status: 500, message: '啟動設定不正確，請檢查本機設定。' },
  TEACHER_PASSWORD_REQUIRED: { status: 503, message: '尚未設定老師密碼，老師登入目前停用。' },
  FEATURE_NOT_READY: { status: 501, message: '此功能尚未開放，請等待後續階段完成。' },
  NOT_FOUND: { status: 404, message: '找不到要求的服務。' },
  METHOD_NOT_ALLOWED: { status: 405, message: '此服務不支援這個操作方式。' },
  INVALID_REQUEST: { status: 400, message: '輸入資料格式不正確，請檢查後重試。' },
  UNSUPPORTED_MEDIA: { status: 415, message: '請使用 JSON 格式傳送資料。' },
  UNAUTHORIZED: { status: 401, message: '尚未取得有效身分，無法執行此操作。' },
  INVALID_PASSWORD: {status:401,message:'老師密碼不正確，請重新輸入。'},
  INVALID_NICKNAME: {status:400,message:'暱稱須為修剪空白後的 1～20 個可見字元，且不能換行。'},
  INVALID_ANSWER: {status:400,message:'答案須為修剪空白後的 1～200 個可見字元，不能只填空白。'},
  INCOMPLETE_ANSWERS:{status:400,message:'請補齊或修正標示的作答欄位；題組全部子題須一起提交。'},
  ALREADY_SUBMITTED:{status:409,message:'本組此題已送出，不可再次提交或修改。'},
  REQUEST_ID_CONFLICT:{status:409,message:'此請求識別已用於其他提交內容，不能覆寫原結果。'},
  SESSION_EXPIRED: {status:401,message:'身分已達 12 小時期限，請重新登入或選組。'},
  SESSION_REVOKED: {status:401,message:'此分頁身分已失效，請重新登入或選組。'},
  SESSION_ACTIVITY_CHANGED: {status:401,message:'老師已建立新活動，請重新選組。'},
  SESSION_DISCONNECTED: {status:401,message:'斷線已超過寬限時間，請重新選組。'},
  SESSION_PASSWORD_CHANGED: {status:401,message:'老師密碼已更新，請重新登入。'},
  SESSION_EXISTS: {status:409,message:'此分頁已有身分，請先登出或在待開始時離開組別。'},
  STALE_DOCUMENT: {status:409,message:'分頁交接版本已更新，正在重新確認身分。'},
  RECOVERY_UNCERTAIN: {status:503,message:'非正常中斷後的身分恢復資格尚待確認，資料已保留。'},
  FORBIDDEN: { status: 403, message: '目前身分沒有執行此操作的權限。' },
  ACTIVITY_CHANGED: { status: 409, message: '活動已變更，請更新畫面後重新操作。' },
  VERSION_CONFLICT: { status: 409, message: '活動狀態已更新，請重新確認後再操作。' },
  STATE_CONFLICT: { status: 409, message: '目前活動階段無法執行此操作。' },
  REPLACEMENT_CONFIRMATION_REQUIRED: { status: 409, message: '替換活動前請先確認，舊結果將被清除。' },
  DOCUMENT_OPERATION_BUSY: { status: 409, message: '文件操作尚未完成，請稍後再建立新活動。' },
  EXPORT_RECONCILIATION_REQUIRED: { status: 409, message: '匯出結果尚待確認，請先核對，或確認放棄核對後再建立新活動。' },
  DATABASE_UNAVAILABLE: { status: 503, message: '本機資料暫時無法讀取，請稍後重試。' },
  EXTERNAL_UNAVAILABLE: { status: 502, message: '外部服務暫時無法使用，請稍後重試。' },
  PUBLIC_SHEETS_NOT_CONFIGURED:{status:503,message:'公開學習單讀取尚未配置，請管理者設定 GOOGLE_SHEETS_API_KEY，或明確改選 Google 帳號授權。'},
  PUBLIC_SHEETS_KEY_INVALID:{status:503,message:'公開讀取金鑰無效或受限，請管理者檢查 Google Sheets API 與金鑰限制。'},
  PUBLIC_SHEETS_FORBIDDEN:{status:403,message:'無法公開讀取此文件，請使用原始 Sheets 網址並將原表設為知道連結的任何人可查看。'},
  SERVICE_ACCOUNT_NOT_CONFIGURED:{status:503,message:'服務帳戶尚未配置，請管理者依設定指南配置服務帳戶檔案；公開匯入與CSV仍可使用。'},
  SERVICE_ACCOUNT_INVALID:{status:503,message:'服務帳戶憑證無效或已失效，請管理者檢查本機服務帳戶設定，不需連結個人Google。'},
  SERVICE_ACCOUNT_FORBIDDEN:{status:403,message:'服務帳戶無法讀取此文件，請將原始試算表共用給頁面顯示的服務帳戶Email。'},
  SERVICE_ACCOUNT_WRITE_FORBIDDEN:{status:403,message:'服務帳戶沒有目標範圍的編輯權限，請檢查試算表共用及保護範圍；本次整批寫入已被拒絕。'},
  SHEETS_ACCESS_MODE_REQUIRED:{status:400,message:'目前只支援服務帳戶存取，請重新整理頁面後再試。'},
  CREDENTIAL_CHANGE_CONFIRMATION_REQUIRED:{status:409,message:'此操作的原存取身分已變更，請確認以目前服務帳戶僅讀核對，系統不會重新送出寫入。'},
  GOOGLE_NOT_CONFIGURED:{status:503,message:'尚未完成本機 Google OAuth 設定，請先配置授權檔案。'},
  INVALID_SHEETS_URL:{status:400,message:'請提供有效的 Google Sheets 網址，並檢查工作表 gid。'},
  INVALID_GROUP_COUNT:{status:400,message:'組數須為 2～20 的整數。'},
  GOOGLE_SHEET_NOT_FOUND:{status:400,message:'找不到指定的工作表，請確認 gid 或重新選表。'},
  GOOGLE_DOCUMENT_FORBIDDEN:{status:403,message:'目前 Google 帳號無法讀取這份文件，請確認分享權限或重新授權。'},
  GOOGLE_DOCUMENT_NOT_FOUND:{status:404,message:'找不到這份 Google Sheets 文件，請確認網址及分享權限。'},
  GUIDED_NOTES_FORMAT:{status:400,message:'學習單格式不符：請檢查第 4 列表頭、B 欄題號、C:F 題目與 G:H 作答合併結構，以及每個子題是否完整。'},
  IMPORT_EXPIRED:{status:409,message:'匯入預覽已失效，請重新讀取文件；目前活動資料仍保留。'},
  GOOGLE_CONFIGURATION_INVALID:{status:503,message:'Google OAuth 設定不正確，請檢查本機設定及回呼網址。'},
  GOOGLE_REAUTHORIZE:{status:401,message:'Google 連結已失效或需要更新，請老師重新授權；活動資料仍保留。'},
  GOOGLE_AUTH_FAILED:{status:502,message:'Google 授權暫時無法完成，請重新連結；原活動及連結資料仍保留。'},
  GOOGLE_ACCESS_DENIED:{status:403,message:'Google 授權未完成或已取消，原活動及連結資料保持不變。'},
  OAUTH_STATE_INVALID:{status:401,message:'此授權請求已失效，請回原老師分頁重新連結 Google。'},
  EXPORT_SOURCE_CHANGED:{status:409,message:'來源或系統輸出已變更，整次匯出停止；請核對標示位置。'},
  EXPORT_UNVERIFIED:{status:409,message:'目標範圍仍未核實，不可自動覆寫或清除，須另行明確確認。'},
  EXPORT_WRITE_REJECTED:{status:400,message:'Google 已拒絕整批寫入，本次沒有修改文件。'},
  GOOGLE_DOCUMENT_WRITE_FORBIDDEN:{status:403,message:'目前 Google 帳號沒有這份文件的寫入權限，本次沒有修改文件。'},
  EXPORT_PAUSE_REQUIRED:{status:400,message:'請先確認老師與協作者自預檢至完成暫停編輯該工作表。'},
  INTERNAL_ERROR: { status: 500, message: '系統暫時無法完成操作，請稍後重試。' },
} as const;

export type ErrorCode = keyof typeof errorCatalog;

export class AppError extends Error {
  constructor(public readonly code: ErrorCode) { super(errorCatalog[code].message); }
}

export class SubmissionValidationError extends AppError {
  constructor(code:'INVALID_ANSWER'|'INCOMPLETE_ANSWERS',readonly fieldIds:readonly string[]){super(code);}
}

export function publicError(error: unknown, operationId: string) {
  const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
  return { status: errorCatalog[code].status, body: { ok: false, error: { code, message: errorCatalog[code].message,...(error instanceof SubmissionValidationError?{fieldIds:[...new Set(error.fieldIds)]}:{}) }, operationId } };
}

export class ExportConflict extends AppError {constructor(readonly range:string,code:'EXPORT_SOURCE_CHANGED'|'EXPORT_UNVERIFIED'='EXPORT_SOURCE_CHANGED'){super(code);}}
export class ExportWriteRejected extends AppError {}
