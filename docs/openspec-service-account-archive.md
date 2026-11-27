# 服務帳戶系列Change同步與歸檔紀錄

日期：2026-11-27（臺灣）。依使用者確認，功能測試成功後合併原預設分支、同步主規格、歸檔並補齊README使用前配置。

## 分支與合併

原預設分支為`codex/initial-functional-commits`，不是`main`。單一服務帳戶匯入功能先前已以`7b6d583`提交，並以`12dbf46`合併及推送；本輪確認功能分支已包含於預設分支，不建立重複合併。`codex/single-service-account-import`保留供追溯。

## 同步與歸檔結果

| 順序 | Change | 完成任務 | 歸檔路徑 |
|---|---|---|---|
| 1 | add-public-guided-notes-import | 7／7 | [公開匯入歷史](../openspec/changes/archive/2026-11-27-add-public-guided-notes-import/) |
| 2 | replace-google-oauth-with-service-account | 13／13 | [服務帳戶替代OAuth](../openspec/changes/archive/2026-11-27-replace-google-oauth-with-service-account/) |
| 3 | simplify-service-account-import | 5／5 | [單一服務帳戶匯入](../openspec/changes/archive/2026-11-27-simplify-service-account-import/) |

三個Change的全部artifacts完成，沒有未完成任務。依相依順序同步七份delta到三份主規格，每次同步後執行主規格Strict Validate及內容比對，確認成功才移動Change。19份歸檔檔案（含隱藏的.openspec.yaml）與移動前逐位元組一致，歷史提案、設計、情境與驗收紀錄未重寫。

- `guided-notes-import`：固定服務帳戶，省略方式預設SERVICE_ACCOUNT，保留明確SERVICE_ACCOUNT相容性，PUBLIC／OAUTH拒絕；移除GI08，新增GI10；GI02～GI07完整解析與原子性要求保持。
- `persistence-security`：PS04重新命名為Google文件存取身分；移除PS05個人OAuth連結，新增PS09共用服務帳戶配置，更新憑證保護及最少資料保留要求。PS03保留舊公開設定的文字由較新的PS06／PS09約束：磁碟舊設定不自動刪除，但不啟用產品公開匯入。
- `guided-notes-export`：更新服務帳戶寫回資格、失敗及待確認恢復；新增GE16固定寫回身分與舊未知操作只讀核對。三模式、D31、原文／格式保護與整批寫入規則保持。

現行主規格共有11份、89項需求、162個情境。主規格保留原Purpose、未涉及的需求與情境，沒有delta操作標題；舊公開／個人OAuth行為只作歸檔歷史，不代表目前仍提供。原始`docs/requirements.md`保持不變。

## README使用前配置

新增安裝者／管理者與老師的責任表，說明Node／npm／Chrome、依賴安裝、.env及老師密碼、Google Sheets API與服務帳戶JSON、後端憑證路徑、每份學習單的查看／編輯共用、範本網址與2～20組、SQLite初始化與保存、Google連外及D31匯出前提。

明確說明複製Email來自目前後端載入的JSON，沿用測試JSON仍會顯示測試帳戶；GitHub不包含私鑰。老師使用已配置的系統不必各自建立帳戶；每套獨立安裝仍須由安裝者或管理者配置。不需OAuth client、測試人員或公開API key。此版僅支援本機127.0.0.1多分頁，未將公開部署寫成既有能力。

## 驗證與範圍

- 每次同步後`openspec validate --specs --strict`：11／11通過；最後驗證同樣通過。
- `openspec list --json`：沒有活動中的Change。
- 原始需求追溯稽核：152列原始內容、78項基礎需求、122個基礎情境、41項決策，未對應原文0。這是原系統基準的統計，不等於上述包含後續功能的現行主規格總數。
- 原始requirements SHA-256仍為`498bc69163997b0570963f4712d7196edd1f9e39590ec05d51e884aaa4e2f413`；既有歸檔、歷史證據與D41量測未變。
- 歸檔原檔、未受影響規格區塊與最新delta逐值比對通過；README與本紀錄的本機連結檢查、`git diff --check`通過。
- 本輪只修改文件、同步規格及移動歸檔，未改src／tests／套件／migration，未變更.env、憑證、正式資料或Google分享。沒有重新啟動服務或重跑外部寫入。

功能回歸沿用合併前已完成的166單元／整合、24Chrome、1正式啟動及三份真實唯讀匯入驗證，詳見[單一匯入驗證](single-import-validation.md)。該文件的「尚未歸檔」敘述為當時狀態，本紀錄為後續完成結果；未將歷史量測未達標改寫為達標。
