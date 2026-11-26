# 正式身分功能實作紀錄

日期：2026-11-26（Asia/Taipei）。Change：`build-local-classroom-response-system`。

後續狀態：使用者已同意本文提出的依賴修訂，已寫入 tasks／design；第 5 群組的活動管理另記於 `docs/activity-management.md`。以下「尚未開放／等待確認」保留為身分階段當時的紀錄，最新操作能力以 README 與後續紀錄為準。

## 本次範圍與狀態

本次接續 19／85 的實作進度，完成 4.1、4.2、4.3、4.4、4.5、4.7，共六項，累計 25／85。4.6 的正式 HTTP 身分驗證已接上，但即時訂閱與尚未開放的 Google／匯出入口仍未整合，故保持未完成；第 5～13 群組未勾選。原始 requirements、proposal、design、十份規格及原審查報告保持原樣。

目前可以真實老師登入／分頁登出；學生有隨機英文名字、可自行改名，並在已有 READY 活動時入組／離組。正式 Google 匯入尚未開放，因此使用者的空資料庫顯示等待匯入是預期結果，不會自動建立假活動。本次測試的題目與活動只放在臨時測試庫。

## 實作與檔案

| 檔案 | 責任 |
|---|---|
| `src/shared/session.ts` | 分頁證明、回覆與暫存鍵契約 |
| `src/shared/validation.ts` | 前後端共用 grapheme 暱稱／答案驗證、英文隨機名字 |
| `src/server/identity.ts` | 雙憑證驗證、世代交接、固定期限、密碼版本、入組／離組、失效消費端 |
| `src/server/identity-http.ts`、`http-body.ts` | 身分路由、同來源檢查、完整請求進共同命令佇列 |
| `src/server/read-model.ts` | 從真 SQLite 讀取權威資料，再經既有角色投影 |
| `src/server/api.ts`、`app.ts`、`index.ts`、`command-queue.ts` | 正式驗證器接線、COOP、正常停機排空與檢查點 |
| `src/client/session.ts` | 分頁證明保存、原頁交接、失效清理、網路失敗保留資料 |
| `src/client/main.tsx`、`style.css` | 老師登入登出、學生暱稱／選組／離組及原因畫面 |
| `database/migrations/003_identity.sql` | 三張身分表與入組暱稱不可改防護 |
| `tests/unit/validation.test.ts`、`tests/integration/identity.test.ts` | 共用驗證、真 SQLite／HTTP 權限及期限測試 |
| `tests/browser/identity.spec.ts` | 真 Chrome 持久設定檔中的正式分頁行為測試 |

## 分頁證明與安全邊界

依已通過 G1 的完整組合實作，沒有採用共用 cookie 登入、只靠 sessionStorage 或先搶鎖者取得原身分：

1. 每頁的 256-bit 第二憑證僅存在 `window.name`，sessionStorage 保存 token／generation，不保存第二憑證。
2. HTML 使用 `Cross-Origin-Opener-Policy: noopener-allow-popups`，阻止新同源 opener 取得原分頁第二憑證。
3. 每份文件另有記憶體中的 document instance。伺服器驗證雙憑證雜湊、當前 instance、generation、固定期限、撤銷原因及活動參與。
4. 重整以 SQLite CAS 交接 generation；已完成交接但回覆中斷時可驗雙憑證取得當前世代再恢復。同一交接的重試不重複加世代。
5. 原生副本沒有原第二憑證，初始化清除副本自己的 token／草稿，保留暱稱；不向伺服器撤銷原頁。關閉後還原也不承接原身分。
6. 每次受保護 HTTP 呼叫重新驗證；角色與組別由伺服器查得，不接受 body 宣告角色。Host／Origin 必須吻合實際 loopback 來源。不設可由客戶端指定測試角色的入口。

SQLite 只保存 token／第二憑證的 SHA-256。共用密碼由本機環境提供，以隨機 salt 的 scrypt 派生值辨識版本與驗證；不保存密碼原文。安全日誌仍只輸出白名單代碼，不記錄本文、密碼、token 或憑證。兩老師分頁獨立撤銷，不修改 Google 連結列。

這不是對任意同源程式碼注入、人工搬運完整雙憑證或瀏覽器外掛的安全保證；本次驗證範圍與 G1 一致。產品不需要安裝測試擴充功能。

## 身分及失效狀態

成功老師登入／學生加入即固定 `expiresAt = createdAt + 43,200,000ms`。重整、重連、正常停機不延長；到期優先於寬限。更改啟動密碼並重啟後只撤銷全部舊老師，活動、學生及提交不變。

學生入組後不得修改 nickname；READY 成功離組後才可以修改／換組。暱稱按 Intl.Segmenter 的 grapheme 修剪後為 1～20 字且禁止換行；答案為 1～200 字、可多行。重複名字不合併身分。

已確認的新活動撤銷、固定到期、GRACE 已確定屆滿分別回傳 `SESSION_ACTIVITY_CHANGED`、`SESSION_EXPIRED`、`SESSION_DISCONNECTED`。前端保留暱稱，清本分頁 token 與 `crs.draft.*`，並依 READY／RUNNING／ENDED 控制重新加入。已撤銷者不復活。

本次只完成失效狀態的驗證／消費與清理；尚未實作第 7 群組 WebSocket 心跳、實際斷線偵測與完整恢復協定。畫面目前每兩秒重新驗證身分／讀大廳；這只是目前身分畫面的讀取機制，不能當作已達成一秒同步或五秒恢復驗收。草稿測試注入合成的分頁暫存鍵以驗清理，並非宣稱已完成 9.4 作答編輯器。

正常停機會先排空命令、處理已屆滿身分，再保存檢查點；正常恢復後，已證有效者得到重新連線寬限，固定期限不變。持有有效原頁證明的請求可結束這段已知寬限。

**U01 未定案。** 非正常停止且現有記錄無法證明資格者只標示待驗證並回覆 `RECOVERY_UNCERTAIN`；不撤銷、不擅給額外寬限、不恢復授權，不宣稱這是 U01 的正式解法。資料保留，但相關人數／活動投影暫不提供，以免把未知身分當成有效或失效。本次測試只驗不擅自裁定；G2、7.4、7.5、13.4 均保留未完成。U02 凍結／休眠及 U03 未核實範圍亦未決定。

## API

沿用既有安全 envelope，使用 `Authorization: Bearer …`、`X-Tab-Proof`、`X-Document-Instance`、`X-Session-Generation`；憑證不放 URL。

| 方法／路徑 | 已實作行為 |
|---|---|
| POST `/api/teacher/login` | `{password}`；無設定 503、錯誤 401，成功回 token／generation／SessionView |
| GET `/api/session` | 當前文件的有效身分與固定期限；不回秘密 |
| POST `/api/session/resume` | `{}`；雙憑證、CAS 交接及冪等恢復；不延長期限 |
| GET `/api/session/ownership` | 雙憑證有效者才取得 generation，供交接回覆遺失恢復 |
| POST `/api/session/logout` | `{}`；僅撤銷本老師分頁，不解除 Google |
| PATCH `/api/session/nickname` | 有效身分直接修改一律拒絕，改名在未入組本地畫面完成 |
| POST `/api/activities/{id}/join` | READY、合法 nickname／groupId；真實建立學生及參與 |
| POST `/api/activities/{id}/leave` | READY、本人；離組並撤銷原憑證 |
| GET `/api/lobby`、`/api/activities/current/view`、`/api/activities/{id}/results` | 真資料及既有安全投影；後兩者每次驗正式身分 |

開始、結束、提交仍由後續任務實作，授權守衛通過也不偽造業務成功；WebSocket 目前拒絕全部應用訂閱。Google、匯入、匯出 API 尚未開放。

## 測試與完成條件

- `npm run typecheck` 通過。
- `npm test`：59／59 通過，涵蓋原 47 項及新增 12 項。
- `npm run test:startup`：1／1，從不同工作目錄啟動、正常關機、同檔恢復與 schema 3。
- `npm run test:browser`：2／2，包含原基礎畫面測試與正式身分完整流程；使用實際安裝的 Chrome。
- `CRS_HEADED=1 npm run test:browser`：同一正式流程另外使用有視窗 Chrome；兩模式均須實際通過才完成 4.2。
- OpenSpec strict validation 通過，CLI 最終確認 25／85、剩餘 60；14 份原始需求／提案／設計／規格／審查文件雜湊均未變。版本、兩種 Chrome 模式結果及實作雜湊見 [驗證證據](evidence/identity-verification.json)。未新增套件或更換鎖定版本。

新增測試包括：兩老師獨立登出與 Google 列不變；錯密碼／缺值；雙憑證雜湊與世代；固定 12 小時；密碼更新保留真提交／答案；同名／入組拒改／離換組；文字及 emoji 全部邊界；換場／到期／已確定斷線屆滿原因；未知中斷不裁定；HTTP 偽造角色、來源、他組與舊活動；日誌不含秘密。另驗第二次啟動因固定埠占用失敗時，不得撤銷仍在運作的原服務身分或改寫其停機證據；正式啟動在取得監聽埠後才執行密碼版本撤銷／恢復。

Chrome 測試使用同一持久設定檔建立兩老師及兩組學生。測試專用擴充功能只呼叫原生 `tabs.duplicate`／`sessions.restore`，不把 tab ID 提供產品。涵蓋正常重整、交接已落盤但回覆截斷、副本先於原頁交接、正常重啟後副本先到、首次腳本尚未執行的副本在原頁關閉後重整、關閉後還原、進行中副本不能加入、失效清 token／草稿／保留暱稱。桌面與 390px 畫面截圖在忽略版控的 `test-results/`，已目視檢查兩種寬度，沒有水平溢位。不是 42 分頁效能驗收。

## 操作

1. 使用 Node 24.22.3；在 `.env` 設定非空的 `TEACHER_PASSWORD`（不要貼到聊天或版控）。
2. 停止舊的 dev 服務，重新執行 `npm run dev`；啟動自動套用 migration 003。瀏覽 `http://127.0.0.1:3000`。
3. 點選「老師登入」，輸入本機密碼；可另開老師分頁，登出只影響當前頁。
4. 學生新頁可設定暱稱；無活動時等待，READY 才可選組。Google 匯入尚未完成，沒有提供正式種子資料捷徑。
5. 不要刪資料庫處理恢復待驗證訊息；先保留現場，依 U01／G2 後續審查決定。

## 需人工確認的任務依賴問題

目前 tasks 的群組 5、6 要求群組 4 完成；群組 7 要求群組 3～6 完成。然而 4.6 完成條件包含「每命令、查詢及訂閱的授權」，實際訂閱的票證與通道在 7.1。嚴格按全群組完成才開始，形成 4.6 → 7.1 → 群組 5／6 → 群組 4 的循環。

本次沒有用「WebSocket 一律拒絕」代替正式訂閱授權驗收，也不擅自更改依賴或削減 4.6。4.6 保持未完成，尚未繼續第 5／6 群組。

建議人工確認後只調整前置順序，不刪任何驗收：群組 5／6 以前置的 4.1～4.5、4.7 及已完成驗證的 HTTP／共用授權部分開始；4.6 的最終勾選保留至 7.1 實際訂閱授權整合通過。群組 7 的前置亦須同步明列此例外。這是修訂建議，尚未寫回正式 tasks／design 或視為已確認。
