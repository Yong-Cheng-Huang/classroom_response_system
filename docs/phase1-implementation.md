# 第一階段實作與驗收紀錄

日期：2026-11-26（Asia/Taipei）。Change：`build-local-classroom-response-system`。

## 範圍與狀態

依本次明確授權，只建立基礎環境、資料庫及必要的後端共用基礎。使用已安裝的 OpenSpec Apply Skill；沿用 D30 的 TypeScript、React、Node.js、SQLite、HTTP＋WebSocket、單一權威後端。沒有改寫原始需求、proposal、design 或十份 spec。

本階段完成 15 個任務，整體 15／85；其餘 70 個保持未完成。任務編號與 OpenSpec CLI 回讀狀態以 `tasks.md` 為準。完成的是各項明列的基礎產物，不代表任何整組業務或全系統需求已驗收。

| 任務 | 完成產物及證據 |
|---|---|
| 1.1 | 鎖定版本的 TS／React／Node／SQLite／HTTP／WebSocket 骨架；型別檢查、建置及健康介面通過。應用 WS 尚不發通道票證，未授權一律拒絕。 |
| 1.2 | 固定 `127.0.0.1`、預設 3000 埠、相對專案根的資料路徑；正式版相同來源重啟及同檔保存測試通過。 |
| 1.3 | 無預設密碼，未設定時登入被拒；設定與日誌白名單測試、忽略版控規則。正式登入仍屬 4.1。 |
| 1.4 | 可分開執行的單元、SQLite、HTTP、同 Chrome context 三分頁入口；不以此代替 G1 或 42 分頁完整驗收。 |
| 1.5 | 原範本唯讀結構快照、來源及雜湊；可寫副本 ID 必須明確配置，測試工具拒絕兩份原始範本。沒有 OAuth 憑證。 |
| 1.6 | F1／F2 快照及 F3 六十題一百四十欄生成器；42 分頁、20 輪、批次、測點、不確定度、環境欄位及最壞值程序配置。尚未執行負載驗收。 |
| 2.2 | 繁體中文安全錯誤代碼與 operationId、結構化白名單日誌；資料庫故障、外部錯誤映射與敏感資訊排除測試。 |
| 2.3 | 可注入配置器的共用有序執行器；入列先同步配置時間／序號，異步工作不越序、失敗不阻斷既有後續工作，配置失敗停止新命令。未開放提交／結束路由。 |
| 2.4 | 可注入時鐘、臺灣毫秒時間與結束後固定時長工具及測試。沒有實作活動計時同步。 |
| 3.1 | 空庫 migration、來源快照與混合單題／題組保存、外鍵、正常重啟；遷移失敗回滾、竄改與未知版本拒絕。 |
| 3.2 | 身分及參與儲存結構、固定期限、連線狀態／版本、寬限起訖與停機證據；落盤失效不可復活、重複暱稱及重啟測試。沒有恢復裁定器。 |
| 3.3 | 真 SQLite 提交／答案儲存、每組每題與每題排名唯一約束、requestId 約束、題組完整封存、跨組外鍵及整筆回滾；四個程序競爭只成功一筆。排名選定仍屬第 8 群組。 |
| 3.4 | 本場匯出五狀態與完整恢復 JSON、跨場最少文件管理及 UNVERIFIED 標記；重啟保存與活動刪除後僅保留管理資訊的測試。未建立 Sheets 寫入／核對服務。 |
| 3.6 | 升級、WAL-aware 備份、新檔回復、拒絕覆寫的實測及操作文件；Google 遠端寫入不能隨本機備份回滾。 |
| 3.7 | 真 SQLite 持久化配置器接上應用命令執行器；高水位先核對、短交易先落盤、業務回滾不回收；換場清除、重啟及落盤後 SIGKILL 不重用測試。 |

## 檔案與目錄

新增檔案清單（相對專案根目錄）：

```text
.env.example
.gitignore
.npmrc
.nvmrc
README.md
package.json
package-lock.json
tsconfig.json
tsconfig.server.json
vite.config.ts
playwright.config.ts
database/migrations/001_core.sql
database/migrations/002_integrity_guards.sql
scripts/database.ts
src/client/index.html
src/client/main.tsx
src/client/style.css
src/client/vite-env.d.ts
src/shared/errors.ts
src/server/app.ts
src/server/command-queue.ts
src/server/config.ts
src/server/database.ts
src/server/index.ts
src/server/logger.ts
src/server/storage.ts
src/server/time.ts
tests/helpers/database.ts
tests/helpers/competing-writer.ts
tests/fixtures/f1.json
tests/fixtures/f2.json
tests/fixtures/catalog.ts
tests/fixtures/benchmark.config.json
tests/unit/foundation.test.ts
tests/unit/fixtures.test.ts
tests/integration/database.test.ts
tests/integration/http.test.ts
tests/browser/foundation.spec.ts
tests/smoke/startup.test.ts
docs/database.md
docs/phase1-implementation.md
```

另更新 `openspec/changes/build-local-classroom-response-system/tasks.md` 的執行狀態及本階段紀錄。安裝／建置／測試產生的 `node_modules/`、`dist/`、`data/classroom.db`、`test-results/` 均排除版控。預設資料庫完成初始化，目前 schema 版本 2；不建立種子活動、學生或答案。

## 套件與資料庫

確切套件版本見 [README](../README.md) 版本表及 `package-lock.json`。Node 24.22.3、npm 11.19.1 已用於本次驗證；Node 透過 nvm 並存安裝，未切換使用者的預設 Node。前端及後端共用一個本機 HTTP 來源，開發 HMR 使用同一伺服器。

SQLite 實測版本 3.54.1；15 張表、兩個 migration，結構及主要約束見 [資料庫操作與結構](database.md)。包括活動／來源／題目／欄位／組別、工作階段／參與、提交／答案、接收序號、匯出狀態／文件管理及 Google 連結參照；沒有歷史答案查詢介面。Google 憑證保護及 OAuth 服務尚未實作，資料表只預留受保護憑證參照。

## 測試結果

| 命令 | 本次結果 |
|---|---|
| `npm run typecheck` | 通過，前後端及測試 TypeScript 型別檢查。 |
| `npm test` | 23／23 通過，無跳過。含單元、真 SQLite 交易／多程序競爭／SIGKILL、HTTP 及 WS 未授權拒絕。 |
| `npm run build` | 通過，Node 產物與 React 靜態產物建置成功。 |
| `npm run db:migrate`、`npm run db:status` | 通過，重跑維持 schema 版本 2。 |
| `npm run test:browser` | 1／1 通過；同一 Chrome context 三分頁載入／重整、同來源健康介面，截圖已檢視。 |
| `npm run test:startup` | 1／1 通過；含重新建置、正式版兩次啟停、相同來源、非專案工作目錄、靜態頁面、拒絕資料庫下載及資料保存。 |

以上共 25 個測試案例，不是 119 個規格情境的全面驗收。沒有執行 Google 授權／寫入、G1、G2、42 分頁完整流程或 1 秒／5 秒效能驗收。

測試環境：macOS 27.2.1、arm64、8 GiB 記憶體、Google Chrome 157.0.8103.80；瀏覽器測試使用 headless Chrome。這項環境紀錄不代表已量測完整課堂負載。

OpenSpec strict validation 通過。CLI 逐項確認勾選後的進度為 15／85、剩餘 70；原始需求、既有人工審查報告、proposal、design 及十份 spec 的 14 個檔案均比對實作前 SHA-256，內容完全相同。正式規格仍是 78 項需求、119 個驗收情境。

## 啟動

```sh
nvm use
npm ci
cp .env.example .env
npm run db:migrate
npm run dev
```

開啟 `http://127.0.0.1:3000`，同一個命令提供前後端。正式版用 `npm run build` 後 `npm start`；先停止開發版，避免占用同埠。設定、測試及備份的完整操作見 README 與資料庫文件。

## 尚未完成與保留關卡

- 1.7：G1 尚未驗證；三分頁能載入不證明重整續接／複製分頁辨識。沒有選用任何正式交接方案，4.2 仍須等待 G1 證據。
- 2.1、2.5：正式活動 API 輸入與識別檢查、角色資料投影尚未實作。
- 3.5：尚未整合新活動替換、身分撤銷及成功落盤後推送，保持未完成。單一題組交易回滾不等同整場替換已完成。
- 4.1～13.6：正式身分、活動、Sheets、同步、搶答、學生／老師畫面、結果及整合驗收皆保留後續工作；不因本階段建表而勾選。

本次依使用者指定只做基礎層；沒有宣稱群組 1～3 全部通過，亦沒有越過 G1 實作正式身分，或越過 G2 實作身分恢復。原任務依賴仍保留，下一階段必須先檢查對應前置條件。

U01 必須確認的情況：程序在寬限截止附近強制中斷，既有證據不足以判斷截止前已停機或截止後仍服務但撤銷未落盤。本階段只保存證據欄位，不替它決定失效或復活。序號 SIGKILL 測試與此身分政策無關。

U02 的凍結／丟棄分頁、OS 休眠分類及效能樣本處理保持未確認；U03 未核實匯出範圍重新處理仍須另行確認。D31 暫停外部編輯的前提不變。本階段沒有更換堆疊或發現阻止基礎層完成的技術障礙，也不宣稱以上風險已關閉。

第一階段結束後停止，等待人工確認，不繼續業務實作。
