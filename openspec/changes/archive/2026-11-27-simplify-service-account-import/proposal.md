# Proposal

## Why

目前老師仍需在公開讀取與服務帳戶之間選擇，增加操作與錯誤判斷。使用者希望只保留服務帳戶一種匯入方式，老師直接貼學習單網址、填組數即可操作。

## What Changes

- 移除老師端匯入方式選單、公開讀取選項及API key／公開分享相關提示；固定使用已配置的服務帳戶。
- 匯入請求省略accessMode時預設SERVICE_ACCOUNT；已明確指定SERVICE_ACCOUNT的舊客戶端保持相容。
- **BREAKING** 產品入口不再接受PUBLIC／OAUTH或其他方式，遇錯誤不自動改用公開API；服務帳戶缺配置或無權限時提供設定／共用說明，原活動保持。
- 保留服務帳戶Email及共用說明；匯入需可讀權限，寫回需編輯權限。公開試算表也走同一服務帳戶流程，不再要求老師公開分享或配置公開API key。
- 原有單題／題組、gid／多表、2～20組、完整預覽、取消／替換確認、原子性與資料隔離保持；CSV、三模式寫回、D31及舊未知匯出的核對規則保持。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `guided-notes-import`：修改GI01／GI09為固定服務帳戶，移除GI08公開匯入，新增GI10單一匯入入口。
- `persistence-security`：修改PS04／PS06／PS09，移除產品對公開金鑰的依賴與缺服務帳戶時可公開匯入的例外，保留憑證及角色保護。

## Impact

- 影響client/imports、sheets提示、server/imports／import-http／index／config、匯入選項狀態及相關測試、設定文件；無新套件或資料庫migration。
- 以已完成的replace-google-oauth-with-service-account為功能基準，在codex/single-service-account-import分支作業；完成回歸後才合併，現有正式資料與憑證不因模式簡化清除。
- 原始requirements、主規格及歸檔本輪不改；既有兩個Change尚未同步，未來順序固定為add-public-guided-notes-import→replace-google-oauth-with-service-account→本Change，不能倒序恢復舊選項。
- 不自動刪除.env中的舊公開key或OAuth檔案，不改Google共用或原始範本。公開匯入退出是本次明確需求，不以移除選單掩飾保留第二種產品入口。
- 歷史公開讀取驗證保留為歷史證據；開發用公開權限診斷可保留於測試／探針範圍，但不作老師匯入路徑。
- 本輪Propose不修改應用程式或啟動Apply；後續不必重做既有Cloud設定，沿用已驗證的服務帳戶及授權副本做必要驗收。
