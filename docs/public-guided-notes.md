> 現行版本只提供服務帳戶匯入，直接填網址與組數，不提供公開方式或個人Google授權。請依 [服務帳戶設定指南](google-service-account-setup.md) 操作；下列舊模式敘述及驗收數據保留作歷史紀錄。

> 新版已依使用者確認改用公開讀取／服務帳戶，個人OAuth功能退出。請先依[服務帳戶設定指南](google-service-account-setup.md)操作；本文OAuth相關操作與舊測試數據保留為歷史紀錄，不代表新版仍提供OAuth。

# 公開學習單匯入

老師仍須登入本機老師身分。公開讀取不需老師登入 Google；原私有文件 OAuth 匯入、Google Sheets 寫回及 CSV 下載仍保留。公開可查看即可，不必開放編輯；公開可編輯也不能取代寫回所需的 OAuth 授權。

## 管理者一次設定

1. 在 Google Cloud Console 選擇專案，於「API 和服務 → 程式庫」啟用 Google Sheets API。
2. 於「API 和服務 → 憑證 → 建立憑證 → API 金鑰」建立金鑰。API 限制選 Google Sheets API；若設定 IP 限制，須使用後端對外連線的 IP。瀏覽器 HTTP referrer 限制不適用本機 Node.js 後端。
3. 在不入版控的本機 `.env` 新增 `GOOGLE_SHEETS_API_KEY=你的金鑰`。這不是 OAuth JSON 裡的 client secret。不要將金鑰貼進聊天、截圖、網址或提交 Git。
4. 重新啟動服務。此設定可省略；缺值或空值只停用公開匯入，不影響啟動與既有 OAuth。

參考：[Google 憑證說明](https://developers.google.com/workspace/guides/create-credentials)、[Google 系統參數](https://docs.cloud.google.com/apis/docs/system-parameters)。

## 老師操作

原始試算表的「共用」設為「知道連結的任何人／檢視者」。選擇「公開學習單（免 Google 登入）」並貼 `https://docs.google.com/spreadsheets/d/文件ID/edit` 原始網址，填入 2～20 組；可包含 gid，否則多工作表會要求選表。完整預覽確認後才建立／替換活動。有預覽時模式鎖定，取消後才能更換。若尚有未核實匯出，仍須依既有流程處理。

僅「發布到網路」不等於原表對 API 公開。發布頁、`/d/e/…/pubhtml` 或 CSV 輸出網址不支援；不爬取或反查原表。公開匯入只讀取原內容、合併與必要格式，不修改 Google 文件。

## 錯誤與限制

- 未配置：管理者設定金鑰，或明確改選原 Google 帳號授權模式。
- 金鑰無效／受限：檢查 API 啟用、API 與應用程式限制。
- 無法公開讀取：確認原始網址與原表公開分享；私有文件請明確選 OAuth。
- 找不到文件：核對 ID／分享；限流、20秒逾時或其他外部失敗可稍後重試。
- 格式不符：沿用既有 Guided Notes 兩份範本結構，含合併儲存格與完整子題。

公開失敗不自動切換 OAuth、不撤銷本機登入或 Google 連結、不替換原活動。解除 Google 後仍可公開讀取；私有匯入與寫回需重新授權。活動結束後 CSV 不需 Google。

## HTTP 契約

老師以正式分頁身分呼叫 `GET /api/imports/options`，只取得 `publicConfigured` 布林。`POST /api/imports/inspect` 新增可選 `accessMode: PUBLIC | OAUTH`；省略維持 OAUTH。其餘 url／groupCount／abandonmentToken 與既有 select／commit／cancel 契約相同。意圖固定模式、老師、期限及活動版本；select／commit 不接受 accessMode。外部讀取不占共用命令佇列；兩種模式都在 I/O 前後檢查本機授權。

## 真實公開驗證

執行 `npm run probe:public-import-live`。探針僅 GET 使用者提供的兩份原始公開範本，使用臨時 SQLite、空 Google 連結與停用的 OAuth provider，經正式 HTTP 匯入、學生提交、結束、CSV 下載及拒絕未授權寫回；不更改來源或分享。證據寫入 `docs/evidence/public-import-live.json`，不包含金鑰。需先配置有效 API key；失敗不算通過，也不應合併功能分支。
