> 服務帳戶改版已完成驗證：老師不再連結個人Google。全部匯入與Sheets寫回均使用服務帳戶，匯入不再選方式或依賴公開API key；CSV保留。請參考[新版設定指南](docs/google-service-account-setup.md)。下列OAuth敘述與原階段數字為歷史驗收，服務帳戶驗證進度另行記錄。

# 課堂搶答系統

本機執行的 TypeScript／React／Node.js／SQLite 專案，目前完成基礎環境、資料庫、分頁身分、活動管理、單一服務帳戶匯入、即時同步／恢復、搶答提交、學生作答、老師管理及完整結果，累計85／85，依使用者確認D41完成紀錄型驗收；原1秒／5秒與完整60輪為後續改善目標，尚未全面達標。首頁支援老師登入、匯入、學生選組／離組、全部題目與題組作答、分頁草稿、同組提交鎖定、開始及確認結束與同步計時。老師可預覽完整題組並監看全部組別答案、名次與臺灣提交時間；學生結束後可查看成功答案、本組三種成績及成功題數；老師可於結束後使用三模式 Sheets 匯出、核對未知結果及確認放棄後換場。

## 環境與啟動

使用 Node.js **24.22.3**，npm **11.19.1**。若有 nvm：

```sh
nvm install
nvm use
npm ci
cp .env.example .env
npm run db:migrate
npm run dev
```

開啟 [http://127.0.0.1:3000](http://127.0.0.1:3000)。同一個命令啟動 Node.js 後端及 Vite React 前端，兩者使用相同來源；不另開第二個前端埠。服務只綁定 `127.0.0.1`，不供其他電腦連入。開發伺服器停止使用 Ctrl+C。

建置後啟動：

```sh
npm run build
npm start
```

建置版仍是同一個網址，沿用相同 SQLite 檔案，不會重建空庫。原本的開發伺服器須先停止；埠占用時啟動失敗，不自動跳到其他埠。

## 設定

| 設定 | 預設／行為 |
|---|---|
| `APP_PORT` | `3000`，固定啟動埠 |
| `APP_DATA_DIR` | 專案根目錄下 `data/`，相對路徑不受啟動工作目錄影響 |
| `TEACHER_PASSWORD` | 無預設值；未設定或全空白時老師登入停用，回傳繁體中文說明 |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | 可選；預設`APP_DATA_DIR/google-service-account.json`，所有匯入與Sheets寫回使用 |
| `SHEETS_TEST_SPREADSHEET_ID` | 真實寫入測試使用的明確可寫副本；匯出探針另外建立私有隔離副本 |

`.env`、資料庫、備份、測試產物與憑證不得提交版控。資料目錄不能置於 `src/`、`dist/` 或 `node_modules/`，避免被網頁服務讀取。在 `.env` 設定非空的 `TEACHER_PASSWORD`，重新啟動後即可使用「老師登入」。沒有預設密碼。老師登出只影響當前分頁；修改啟動密碼並重啟會撤銷全部舊老師身分。

空資料庫會顯示「等待老師匯入活動」，不會自動建立種子活動。老師先將原表共用給頁面顯示的服務帳戶Email（匯入給檢視者，需要寫回給編輯者），再直接貼單題／題組範本網址、設定 2～20 組、選表並確認匯入。沒有方式選單，也不必將文件公開。舊公開API key不再供產品匯入使用。若舊 dev 服務仍在執行，須先停止再重新 `npm run dev`，才會載入新的後端。

歷史版本的Google個人授權及兩份副本讀取曾完成驗證，包含正常重啟及單題實際匯入；第一次配置新環境仍須操作者自行在 Google 頁面同意。client JSON 路徑由 `GOOGLE_OAUTH_CLIENT_FILE` 設定，預設為 `APP_DATA_DIR/google-oauth-client.json`；token 只由後端加密保存在資料目錄，學生不取得憑證。

## 測試

單一服務帳戶流程及本輪驗收見 [驗證紀錄](docs/single-import-validation.md)。

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
npm run test:startup
```

- `test:unit`：設定、錯誤與日誌白名單、純有序執行器、時間及固定測試資料。
- `test:db`：真 SQLite 遷移、約束、活動替換／撤銷／回滾、多程序競爭、SIGKILL、保存、備份及序號。
- `test:http`：本機 HTTP、健康檢查、輸入契約、活動／角色守衛、命令入口排序、資料投影、錯誤遮蔽與未授權 WebSocket 拒絕。
- `test:browser`：先建置，使用已安裝的 Google Chrome 檢查同來源 React，另以一個臨時持久設定檔測正式老師／學生、原生分頁複製與重整交接、正常重啟及失效清理。測試服務與資料均隔離，截圖在忽略版控的 `test-results/`。加 `CRS_HEADED=1` 可另跑有視窗身分測試；不是 42 分頁效能驗收。
- `test:startup`：重新建置，從其他工作目錄啟動正式版兩次，驗固定來源、靜態頁面、正常停機及同檔資料保存。

沒有設定 Google 授權也能執行全部第一階段測試。F1、F2 為唯讀擷取的來源結構快照；F3 是六十題、一百四十欄的合成資料。測試工具拒絕以兩份原範本作寫入目標。量測程序設定於 `tests/fixtures/benchmark.config.json`；固定資料量不是產品容量上限。

## 資料庫與操作文件

- [資料庫結構、migration、備份回復](docs/database.md)。
- [第一階段實作與驗收紀錄](docs/phase1-implementation.md)。
- [G1 後的後端契約實作紀錄](docs/phase2-backend-contracts.md)。
- [HTTP 輸入與角色資料契約](docs/backend-api-contracts.md)。
- [活動原子替換與故障驗證](docs/activity-replacement-storage.md)。
- [正式身分實作、操作、測試與待確認依賴](docs/identity-implementation.md)。
- [活動生命週期、換場服務與驗證](docs/activity-management.md)。
- [Google OAuth 與可寫 Sheets 副本設定步驟](docs/google-oauth-setup.md)。
- [Google 授權實作與初期驗證紀錄](docs/google-integration-progress.md)。
- [公開匯入歷史紀錄（功能已退出）](docs/public-guided-notes.md)。
- [Guided Notes 匯入操作與完整階段驗證](docs/guided-notes-import.md)。
- [學生作答、草稿、提交確認與階段驗證](docs/student-participation.md)。
- [老師管理、題目預覽與完整提交監看](docs/teacher-console.md)。
- [結果查詢、本組成績與 D01 資料公開例外](docs/activity-results.md)。
- [Guided Notes 三模式匯出、核對與放棄換場](docs/guided-notes-export.md)。

- [原始需求](docs/requirements.md)，保持原樣。
- [已歸檔 OpenSpec 任務](openspec/changes/archive/2026-11-27-build-local-classroom-response-system/tasks.md)。

## 鎖定套件

所有直接依賴使用確切版本，完整相依關係見 `package-lock.json`。

| 用途 | 套件／版本 |
|---|---|
| 前端 | React／React DOM 19.3.1 |
| 前端建置 | Vite 8.3.8、@vitejs/plugin-react 6.3.0 |
| 語言／執行 | TypeScript 7.0.2、tsx 4.23.15 |
| SQLite 驅動 | better-sqlite3 13.2.0，實測 SQLite 3.54.1 |
| WebSocket 基礎 | ws 8.23.0 |
| Google 服務帳戶 JWT | google-auth-library 11.3.4 |
| 瀏覽器測試 | @playwright/test 1.65.1 |
| 型別 | @types/node 24.19.4、@types/react 19.3.3、@types/react-dom 19.3.0、@types/better-sqlite3 9.6.0、@types/ws 8.18.2 |

G1 第二候選已整合至正式身分，驗證與限制見身分實作紀錄。U01 已經 G2 探針及人工確認登錄 D38，非正常中斷依最後已提交狀態恢復；U02 凍結／休眠與 U03 未核實範圍政策仍保留，42 分頁完整驗收尚未完成。

## G1 技術驗證

`npm run probe:g1` 使用臨時 Chrome 設定檔及合成識別重現原生分頁複製，輸出 `docs/evidence/g1-probe.json`。這是初輪工具，其結果保留為 NOT_PROVEN；命令成功代表實驗執行完成，不代表 G1 通過。方法、觀察與限制見 [初輪 G1 驗證報告](docs/g1-tab-identity-review.md)。測試擴充功能只負責觸發原生複製，不是產品所需元件。

後續第二候選已通過 G1 最小技術驗證，詳見 [分頁第二憑證與交接驗證](docs/g1-window-name-validation.md)。可執行 `npm run probe:g1:window-name -- --rounds=3`，有視窗 Chrome 則加 `--headed`。此候選需要 window.name 第二憑證、COOP 隔離及伺服器交接版本完整組合。原驗證報告保留當時狀態；正式整合另見身分實作紀錄。前一段的 NOT_PROVEN 是初輪探針結果。

## 即時通道進度

已完成 4.6、7.1～7.7，累計 46／85：短期票證、角色分流、版本快照、原生心跳、持久化 30 秒寬限、D38 恢復、自動重連與計時校正。詳見[恢復完成紀錄](docs/realtime-recovery.md)。可用 `npm run test:realtime` 執行通道／校時測試、`npm run probe:g2` 重現隔離邊界。42 分頁效能、匯出及完整整合驗收仍待後續。

## 搶答提交與排名進度

第 8 群組 8.1～8.7 已完成，累計 53／85。正式提交 API 支援完整題組、每組每題一次、伺服器順位及 requestId 重送，與確認結束共用排序；學生回覆不洩漏他組答案、名次或時間。學生作答表單已由第 9 群組接入，老師完整監看已由第 10 群組完成。執行 `npm run test:ranking` 可驗證本階段，詳見[搶答實作紀錄](docs/submission-ranking.md)。

## 學生端進度

第 9 群組 9.1～9.6 已完成，累計 59／85。學生可自由選題、填寫完整題組、保留各分頁草稿，送出中斷後沿用原 requestId 確認；同組他人先送出會鎖定該題，結束自動切入 `#/results`。完整結果內容已由 11.3 承接。型別、建置、114 項單元／整合、九項 Chrome 流程及一項正式啟動測試通過，詳見[學生操作與驗證](docs/student-participation.md)。U02／U03 及第 12、13 群組保持未完成。

## 老師端進度

第 10 群組 10.1～10.4 已完成，累計 63／85。預覽僅影響目前老師分頁，監看逐題顯示全部組別狀況、完整答案及伺服器名次；結束後保留未搶到的答案與無人題。相同毫秒的提交仍為不同名次，原時間標示 Asia/Taipei。型別、建置、114 項單元／整合、11 項 Chrome 流程及一項啟動測試通過；詳見[老師操作與驗證](docs/teacher-console.md)。三模式匯出與放棄核對畫面保留於第 12 群組，U02／U03 不變。

## 結果查詢與計分進度

第 11 群組 11.1～11.4 已完成，累計 67／85。學生結束後自動查看各題成功組、完整答案與送出者、本組三種成績及成功題數；題組只計一題，無人題不套來源舊答案。D01 僅公開成功組資料，其他組未成功答案及完整排名仍不公開。116 項單元／整合、12 項 Chrome 流程、一項啟動、型別、建置及 Strict Validate 通過；可用 `npm run test:results` 執行八項投影／結果重點測試，詳見[結果操作與驗證](docs/activity-results.md)。匯出、第 13 群組及 U02／U03 保留。


## Guided Notes 匯出進度

第 12 群組 12.1～12.12 已完成，累計 79／85。老師於結束後確認 D31 暫停外部編輯，可選只有答案、I:K 組別時間欄或灰色 9 點格內附註。全題預檢、三模式還原、五狀態、未知核對不重送、確認放棄後原子換場及未核實隔離均已接入。原生 Sheets 長答案／附註已核對；真實兩副本矩陣與故障注入證據見[匯出操作與驗證](docs/guided-notes-export.md)。執行 `npm run test:exports` 可跑 14 項重點整合測試。

目前 130 項單元／整合、13 項 Chrome 流程、一項正式啟動、型別、建置及 Strict Validate 通過。上述各階段數字保留歷史進度；第 13 群組六項完整整合任務仍未執行，U02／U03 保留，不宣稱整體專案驗收完成。

## 第 13 階段整合驗收

完成 13.1、13.2、13.4、13.5、13.6：原始需求逐條追蹤、同一原生 Chrome 2 老師＋40 學生真 Sheets 完整流程、中斷及跨功能權限驗收。13.6已整理交付與缺失；13.3依D41紀錄型驗收完成，原固定效能目標仍未全面達標。完整證據、歷史失敗與缺失見 [整合驗收報告](docs/integration-acceptance.md)及 [本機操作指南](docs/local-operation-guide.md)。前面各階段的計數是歷史紀錄。

U02 已確認為 D39：真正凍結／丟棄／OS 休眠另列暫停，一般背景仍納入紀錄、恢復依原身分規則；數值門檻依D41改列後續目標。U03 解除政策未確認，未核實範圍保持隔離。D37 的實際 DOM 與 WS 關聯已由使用者確認為 D40：首次正確DOM記T_apply、WS另列，1／5秒比較基準保持；本階段依D41採紀錄型驗收。

`npm run probe:performance` 執行 F1～F3 各 20 輪固定程序，至少半小時，使用隔離庫及 Chrome 設定檔、保存逐筆誤差及全部失敗。`CRS_PERF_DIAGNOSTIC=join`／`submit` 只是分段診斷，不能替代正式驗收。新增觀測器證明 HTTP 完整讀模可能早於 WS 在 React 呈現，歷史 WS 關聯超時不能全部直接歸因畫面超時，原始數值仍完整保留。正式 60 輪尚未完成，沒有進行 Verify、規格同步或封存。

## 全組提交紀錄 CSV

老師可在「匯入 Guided Notes」下方下載本場所有組別的已受理提交，含未搶到紀錄。僅活動結束後開放，不需 Google 連結；題組每個子題一列，提供題號、子題、組別、姓名（送出者暱稱）、答案、搶答順位、送出時間及是否搶答成功。CSV 採 UTF-8 BOM 供 Excel 開啟；格式與限制見 [CSV 匯出說明](docs/submission-csv-export.md)，驗收見 [證據](docs/evidence/csv-export-verification.json)。CSV為獨立Change；原系統現依D41完成85／85，原效能缺失仍保留。

CSV 的8項需求／16個情境已同步至 [主規格](openspec/specs/submission-records-export/spec.md)，7／7任務完成並經人工測試確認的 Change 已 [歸檔](openspec/changes/archive/2026-11-27-add-submission-records-csv-export/proposal.md)。原系統Change已依D41完成紀錄型驗收並歸檔，未把舊效能目標改稱達標。

D41 的確認內容、18次歷史效能程序、缺失與後續目標見 [紀錄型驗收證據](docs/evidence/performance-acceptance-policy.json)及 [整合驗收報告](docs/integration-acceptance.md)。原始需求與原始量測數據保留，所有主規格位於 openspec/specs/。
