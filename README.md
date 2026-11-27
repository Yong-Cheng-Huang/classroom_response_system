> 現行版本只使用服務帳戶匯入與寫回Google Sheets，老師不需個人Google授權，也沒有匯入方式選單。首次使用請先完成下方「使用前配置」。後段各階段進度與舊驗收敘述保留為歷史紀錄。

# 課堂搶答系統

本機執行的 TypeScript／React／Node.js／SQLite 專案，目前完成基礎環境、資料庫、分頁身分、活動管理、單一服務帳戶匯入、即時同步／恢復、搶答提交、學生作答、老師管理及完整結果，累計85／85，依使用者確認D41完成紀錄型驗收；原1秒／5秒與完整60輪為後續改善目標，尚未全面達標。首頁支援老師登入、匯入、學生選組／離組、全部題目與題組作答、分頁草稿、同組提交鎖定、開始及確認結束與同步計時。老師可預覽完整題組並監看全部組別答案、名次與臺灣提交時間；學生結束後可查看成功答案、本組三種成績及成功題數；老師可於結束後使用三模式 Sheets 匯出、核對未知結果及確認放棄後換場。

## 使用前配置

每套本機安裝都需要由安裝者或管理者完成以下配置。老師使用已配置好的系統時，只需取得本機老師登入密碼，並將學習單共用給頁面顯示的服務帳戶Email，不必自己建立服務帳戶。

| 項目 | 誰負責／何時需要 | 配置內容 |
|---|---|---|
| 執行環境 | 安裝者，首次安裝 | 安裝Node.js 24.22.3（含npm），執行`npm ci`安裝鎖定依賴；準備Chrome供本機多分頁操作。SQLite由專案套件提供，不需另建資料庫伺服器。 |
| 本機設定 | 管理者，首次安裝 | 將`.env.example`複製為`.env`，設定非空的`TEACHER_PASSWORD`。已存在`.env`時直接編輯，不覆蓋原設定；程式沒有預設老師密碼。 |
| Google服務帳戶 | 管理者，使用Sheets匯入／寫回前 | 在自己的Google Cloud專案啟用Google Sheets API，建立服務帳戶及JSON金鑰；這是服務帳戶JSON，不是OAuth client JSON或API key。正式使用建議與開發測試帳戶分開。 |
| 憑證檔案 | 管理者，啟動前 | 將JSON放在`data/google-service-account.json`；其他路徑需設定`GOOGLE_SERVICE_ACCOUNT_FILE`。憑證只存後端安全目錄，不放src／dist／node_modules，不提交Git或分發給使用網站的老師。詳細限制見[設定指南](docs/google-service-account-setup.md)。 |
| 學習單權限 | 老師，每份來源文件 | 登入後按「複製服務帳戶Email」，至原始試算表共用給該Email。只匯入給「檢視者」；需要寫回給「編輯者」，並確認目標範圍可寫。文件可以保持私有。 |
| 學習單格式 | 老師，匯入前 | 使用既有單題／題組範本結構，提供原始`docs.google.com/spreadsheets/d/...`網址，設定2～20組；多工作表時選定要用的表。發布網頁或CSV輸出網址不能作匯入來源。 |
| 資料與啟動 | 安裝者，首次安裝 | 資料目錄需可寫，執行`npm run db:migrate`後啟動；預設埠3000需可用。需要保留活動時請保存原`data/`並依[資料庫指南](docs/database.md)備份，勿刪庫重建。 |
| 網路及匯出前提 | 管理者／老師，操作時 | Sheets操作需要連外至Google；寫回僅活動結束後開放，老師與協作者須從預檢到完成暫停編輯。系統不能強制鎖住外部協作者。CSV也僅結束後下載，但不需Google憑證。 |

`.env`的最小設定示意（請自行替換老師密碼，不要將真實密碼貼到聊天或提交Git）：

```dotenv
TEACHER_PASSWORD=請替換成自己的老師登入密碼
# 使用預設data/google-service-account.json時不必設定以下路徑
# GOOGLE_SERVICE_ACCOUNT_FILE=/安全目錄/google-service-account.json
```

「複製服務帳戶Email」會取得**目前這套後端載入的JSON所屬帳戶**，不是固定內建帳戶。若沿用原測試JSON，就會複製原測試帳戶；GitHub不包含該私鑰，新安裝者需自行配置或由管理者提供安全的後端配置。更換JSON或`.env`後需正常重啟，確認頁面Email正確，再共用學習單。

不需要個人Google登入、OAuth client、OAuth測試人員或`GOOGLE_SHEETS_API_KEY`。服務帳戶缺配置時不能匯入或寫回，但既有活動、搶答、結果及CSV仍可用。此版本只綁定`127.0.0.1`，目前供同一台電腦的多分頁使用；其他電腦不能直接連線，公開部署不屬於目前啟動方式。

## 環境與啟動

使用 Node.js **24.22.3**，npm **11.19.1**。若有 nvm：

```sh
nvm install
nvm use
npm ci
# 僅首次建立；已有.env請直接編輯，勿覆蓋
cp .env.example .env
# 繼續前：設定.env的TEACHER_PASSWORD，並放好服務帳戶JSON
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
| `SHEETS_TEST_SPREADSHEET_ID` | 僅開發者真實寫入探針使用；一般操作不需設定，測試必須另備副本 |

`.env`、資料庫、備份、測試產物與憑證不得提交版控。資料目錄不能置於 `src/`、`dist/` 或 `node_modules/`，避免被網頁服務讀取。在 `.env` 設定非空的 `TEACHER_PASSWORD`，重新啟動後即可使用「老師登入」。沒有預設密碼。老師登出只影響當前分頁；修改啟動密碼並重啟會撤銷全部舊老師身分。

空資料庫會顯示「等待老師匯入活動」，不會自動建立種子活動。老師先將原表共用給頁面顯示的服務帳戶Email（匯入給檢視者，需要寫回給編輯者），再直接貼單題／題組範本網址、設定 2～20 組、選表並確認匯入。沒有方式選單，也不必將文件公開。舊公開API key不再供產品匯入使用。若舊 dev 服務仍在執行，須先停止再重新 `npm run dev`，才會載入新的後端。

舊版個人OAuth設定已退出；舊驗收保留於歷史文件，不作現行配置步驟。服務帳戶私鑰只由後端讀取，token只在後端記憶體快取，學生不取得Google憑證。

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
- [歷史Google OAuth設定（現行版本已退出）](docs/google-oauth-setup.md)。
- [服務帳戶設定與現行HTTP契約](docs/google-service-account-setup.md)。

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

## OpenSpec同步與歸檔

公開匯入、以服務帳戶取代OAuth、單一服務帳戶匯入三個已完成Change已依相依順序同步並歸檔。現行主規格位於`openspec/specs/`；歷史提案保留於`openspec/changes/archive/`，其中舊公開／OAuth流程不代表現行功能。詳見[同步歸檔紀錄](docs/openspec-service-account-archive.md)。
