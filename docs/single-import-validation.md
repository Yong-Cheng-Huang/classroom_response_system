# 單一服務帳戶匯入實作驗證

Change：`simplify-service-account-import`；日期：2026-11-27（臺灣）。獨立分支：`codex/single-service-account-import`。本輪只收斂匯入入口，不修改原始需求、主規格、已完成Change、歸檔、資料庫schema或D41歷史量測。

## 產品行為

老師登入後，直接填原Google Sheets網址及2～20組數；沒有存取方式選單、公開key或公開分享提示。原表共用給頁面顯示的服務帳戶Email：只匯入可給檢視者，需要寫回則須編輯者及可寫範圍。多工作表選擇、完整預覽、取消、替換確認、進行中禁止匯入保持。

匯入HTTP省略accessMode即SERVICE_ACCOUNT，明確SERVICE_ACCOUNT相容。PUBLIC、OAUTH、null及其他非法值拒絕，不做外部讀取或憑證回退；select／commit不接受方式欄位。options保留老師限定查詢，僅回serviceAccountConfigured；前端不再查詢此選項。匯出仍明確指定SERVICE_ACCOUNT，三模式／D31／未知結果核對不變。

產品已刪除公開reader接線與readConfig公開key欄位，`.env.example`不再要求該key；實際`.env`、憑證及舊資料未刪除。舊公開reader移到`scripts/probes/helpers/`，只供診斷測試；舊公開匯入探針明確報告退出並失敗結束，不能冒稱產品可公開匯入。

## 測試替代與範圍

基準為165單元／整合、24Chrome、1正式啟動。本輪將原5個公開正向整合案例改為服務帳戶格式／原子性／身分及失效／HTTP授權／資料隔離案例；原2個公開Chrome案例改為單一匯入完整操作與缺配置／無權案例。原「公開key失敗可選服務帳戶」改為省略方式與明確方式相容、PUBLIC零讀取拒絕；原3個公開reader單元案例保留為產品配置退出及診斷工具驗證。新增1個舊key無法提供匯入的HTTP資料保持案例。沒有單純刪除保護測試。

最終總數166／24／1，結果見下方執行紀錄。Chrome使用真Chrome及真React／HTTP／隔離SQLite，Google傳輸為替身；真Google驗證另外執行。正式啟動涵蓋建置清除舊public-sheets／OAuth模組、其他工作目錄啟動、正常停機與同檔資料保持。既有測試涵蓋搶答原子性、排名、身分交接、重連、三模式、D31、legacy未知核對與CSV。這不是重做42分頁效能驗收，也沒有宣稱舊1秒／5秒／60輪已全面達標。

## 23個驗收情境對照

下表測試路徑均相對專案根目錄；同名情境依Requirement區分。

| 規格／情境 | 驗證依據 |
|---|---|
| GI01 組數邊界 | integration/single-import：2及20成功，1／21／非整數／缺值拒絕 |
| GI01 文件不可讀 | integration/single-import、imports；unit/service-account：網址、403／404、逾時與原活動保持 |
| GI01 公開模式免Google登入（退出） | integration/single-import：PUBLIC／OAUTH／null等HTTP拒絕，sourceCalls仍0 |
| GI01 服務帳戶讀取私有文件 | 真實唯讀探針私有檢視者來源；Chrome/single-import直接操作 |
| GI01 舊授權請求明確退出 | integration/single-import及imports：非法拒絕、省略合法 |
| GI01 保留原授權匯入 | integration/imports：省略與明確SERVICE_ACCOUNT題數／欄位一致 |
| GI09 公開讀取與服務帳戶配置獨立 | unit/public-sheets配置退出；integration/single-import舊key缺服務帳戶HTTP503、資料保持 |
| GI09 服務帳戶候選失效與權限變動 | integration/single-import：403、登出、10分鐘到期、開始／版本競爭；service-account：帳戶變更及未知操作核對；重啟意圖不持久化 |
| GI09 不暗中更換讀取身分 | integration/single-import：跨老師commit拒絕，select／commit方式欄位拒絕，失敗不fallback |
| GI09 公開讀取期間解除Google連結（退出） | integration/google：舊端點404，PUBLIC拒絕；single-import合法候選依原老師與版本裁定 |
| GI09 OAuth讀取期間解除連結（退出） | integration/google舊端點404；未知token IMPORT_EXPIRED（imports）；重啟只建立新記憶體意圖集合 |
| GI10 老師直接匯入 | Chrome/single-import：無選單、請求省略方式、多表、預覽、真學生到CSV |
| GI10 缺配置與取消預覽 | Chrome/single-import：缺配置停用與提示、多表候選取消解鎖；integration取消不改原場 |
| PS04 首次授權與權限不足 | Chrome/single-import的403；unit/service-account與integration/service-account的無權寫入拒絕；既有活動保持 |
| PS04 公開匯入與私有資料隔離 | integration/single-import：缺配置／學生／偽造proof拒絕；來源答案不傳學生 |
| PS04 公開可編輯不代表可匿名寫回 | integration/service-account、exports及submission-csv：寫回固定服務帳戶，CSV獨立；Chrome/exports及submission-csv |
| PS06 憑證撤銷或過期 | unit/service-account：token更新／401失效；integration/service-account、export-crash：未知結果不盲目重送 |
| PS06 公開金鑰不洩漏 | unit/public-sheets；integration/single-import、google及acceptance-security：狀態白名單、角色隔離、外部canary遮蔽 |
| PS06 兩種存取方式錯誤獨立（退出） | 真實探針公開key空值仍成功；integration/single-import缺服務帳戶不讀取；無fallback |
| PS06 公開讀取錯誤與OAuth狀態獨立（退出） | integration/google及single-import：退出方式400、不讀舊憑證、不撤銷老師 |
| PS09 老師共用服務帳戶 | integration/google：兩老師共用Email，單頁登出不改配置；正式啟動同檔保持；配置每次啟動載入 |
| PS09 未配置與非法憑證檔 | unit/service-account-config；Chrome/google與single-import；startup缺配置仍可啟動 |
| PS09 舊OAuth端點與磁碟資料 | integration/google舊檔逐值保持／404；service-account legacy核對；原migration與正式資料保持核對 |

上列unit／integration／Chrome對應`tests/unit`、`tests/integration`及`tests/browser`目錄。退出行為以新語義驗證，不將歷史公開成功當作新產品能力。涉及帳戶更換、token失效、權限及未知寫回者使用隔離替身／故障注入，未撤銷真實金鑰或更改Google共用。

## 真實唯讀驗證

執行`GOOGLE_SHEETS_API_KEY='' npm run probe:single-import-live`。使用已有服務帳戶JSON、三份先前指定副本及臨時SQLite；請求省略accessMode。試算表傳輸封裝只允許白名單副本GET；服務帳戶換token的授權請求不屬試算表寫入。

結果通過：單題6題6欄、題組4題6欄、私有檢視者6題6欄；共6次GET、0次試算表寫入。對照範本完整題目／子題標記／答案定位，來源快照與原欄位格式逐值一致，預覽後本機確認成功。Google數值題號1與歷史fixture的1.0僅在驗證比對時正規化，正式解析器未改。

安全證據：[single-import-live.json](evidence/single-import-live.json)。沒有改分享、寫來源或正式活動；前輪三模式12批真實寫回證據保持，這輪未重跑，也未將其算成本輪真實寫入。

## 執行紀錄

- `npm run typecheck`：通過。
- `npm run test:browser`（含正式build）：24／24，真Chrome，無略過。
- `npm test`：166／166，無略過。
- `npm run test:startup`（再次build）：1／1，固定來源與正常重啟資料保存通過。
- 真實唯讀匯入：3／3副本通過，6 GET、0試算表寫入。
- `openspec validate simplify-service-account-import --strict`：有效（exit 0）；GI09／PS04缺主規格INFO已記錄為同步前置，不視為歸檔許可。
- 原始requirements SHA-256仍為`498bc69163997b0570963f4712d7196edd1f9e39590ec05d51e884aaa4e2f413`；主規格、原有Change、歸檔、migration與D41歷史證據均無差異。
- `git diff --check`：通過。實際憑證及舊key不納入版控。

合併及正式本機服務正常重啟另行核對；不將測試隔離資料庫當作正式資料保存證據。

## OpenSpec後續

本輪不自動同步或歸檔。主規格尚缺前置Change增補，Strict Validate的缺主規格INFO不代表可直接歸檔。之後需依`add-public-guided-notes-import`→`replace-google-oauth-with-service-account`→`simplify-service-account-import`順序處理，避免倒序恢復已退出方式。
