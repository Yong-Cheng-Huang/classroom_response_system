# Proposal

## Why

老師希望貼上學習單網址後即可匯入及寫回，不再經過個人Google帳號連結、OAuth同意與測試人員設定。使用者已明確選擇完全移除OAuth，改為公開只讀或服務帳戶存取；既有搶答、原始文件寫回與資料保護保持。

## What Changes

- **BREAKING** 移除老師OAuth連結／解除／回呼介面與後端授權流程，不再載入OAuth client JSON、刷新舊token或使用舊共用Google連結。
- 提供公開讀取及服務帳戶兩種匯入模式；私有文件可共用給服務帳戶供讀取，不必公開。公開模式沿用現有API key與完整解析。
- Sheets寫回一律使用服務帳戶；老師將原試算表共用給系統顯示的服務帳戶Email並給予編輯權限，不需連結個人Google帳號。讀取成功不保證寫入成功。
- 後端本機配置服務帳戶JSON，僅老師取得必要狀態及共用Email；私鑰／token不放前端、回應、日誌與版控。
- 保留三模式、D31暫停外部編輯、全題預檢、整批寫入、五狀態、未知結果核對及放棄後未核實隔離；舊活動／提交／名次／身分／CSV不因憑證切換清除。
- 明確處理舊OAuth請求及舊匯出記錄：不靜默轉換讀寫身分，不自動重送未知寫入，舊未知結果可由有效老師明確使用現行服務帳戶只讀核對，或沿用放棄確認流程。

## Capabilities

### New Capabilities

無。沿用目前Google文件匯入、寫回與安全能力。

### Modified Capabilities

- `guided-notes-import`：GI01、GI08、GI09改為PUBLIC／SERVICE_ACCOUNT，保留既有格式與原子性；拒絕OAUTH及舊未指定模式請求，提供清楚升級說明。
- `guided-notes-export`：GE01、GE12、GE14改為服務帳戶寫回與故障恢復；新增服務帳戶身分固定及舊操作遷移契約。
- `persistence-security`：PS03、PS04、PS06調整憑證語意，移除PS05共用OAuth連結，新增服務帳戶配置及OAuth退出規則。

## Impact

- 修改config／index／imports／exports／Google傳輸、HTTP契約、老師介面、測試與操作文件；使用既有google-auth-library，不更換技術堆疊。
- 在 `codex/service-account-sheets` 分支規劃與後續實作；原預設分支及現行服務保持。全部回歸與真實服務帳戶驗證成功後才合併，缺配置不得冒稱完成。
- 前置變更 `add-public-guided-notes-import` 已完成7/7並合併，但主規格尚未同步。本Change以其最終GI01／GI08／GI09／PS04～PS06為基準，後續同步順序必須先公開匯入、再本Change；本輪不直接同步／歸檔或修改其文件。
- 原始requirements.md、既有歸檔與效能D41不變。OAuth需求退出是本輪明確確認的替代決策，非自行刪除原始功能。
- 不自動刪除原OAuth JSON、vault或舊資料表；不再使用其憑證。管理者可另行清理，不在本輪擅自刪檔或撤銷遠端授權。
- 真實驗證須管理者另建服務帳戶JSON，且明確指定兩份可寫測試副本並共用給服務帳戶；現有OAuth JSON與公開API key皆不可替代。不得對原始範本寫入或擅自更改分享。
- 不含服務帳戶建立／金鑰下載自動化、網頁上傳私鑰、跨網路部署、網域全權委派、匿名寫入與新增歷史查詢。
