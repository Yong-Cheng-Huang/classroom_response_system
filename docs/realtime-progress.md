# 即時通道與快照實作紀錄

**後續狀態：7.4～7.7 已依明確確認的 D38 完成，累計 46／85；本篇保留前次 7.1～7.3 的實作範圍，最新證據見 [恢復完成紀錄](realtime-recovery.md)。**

日期：2026-11-26（Asia/Taipei）。Change：build-local-classroom-response-system。

## 已完成範圍

完成 7.1、7.2、7.3，並依已確認的前置順序補完 4.6 的實際訂閱授權驗收；累計 42／85，剩餘 43。4.6 針對目前已開放入口，不表示第 8～12 群組功能已實作；未開放入口仍拒絕操作，各新功能接入時須繼續驗證授權。

7.4～7.7 保持未勾選。依 design 的 U01 及 tasks 的 G2 關卡，尚不能確認強制中斷在寬限截止附近的恢復資格。本次沒有實作或假設該分支，也沒有提前進入搶答提交階段。既有原生 Chrome 分頁交接回歸通過，但不表示所有強制中斷、凍結、丟棄或休眠風險已解除。

## 實作與檔案

| 檔案 | 責任 |
|---|---|
| src/server/realtime.ts | 短期票證、upgrade 授權、角色投影、可見版本與通道關閉 |
| src/server/app.ts | 接上票證 HTTP／WS；HTTP 回應完成後檢查投影，固定週期補查已提交狀態 |
| src/shared/realtime.ts | 快照契約、revision／epoch／channel 接收器 |
| src/client/realtime.ts | 同來源 WebSocket、忽略已關閉連線回覆、缺口重取快照 |
| src/client/main.tsx | 套用分流快照；使較早 HTTP 讀取回覆不能覆蓋新的 WS 狀態 |
| tests/unit/realtime.test.ts | 重複、亂序、缺口、舊 epoch／channel／活動 |
| tests/integration/realtime.test.ts | 真 HTTP、WS、SQLite 的角色、期限、分流及快照交錯 |
| tests/browser/realtime.spec.ts | 同一 Chrome 的兩老師及學生，在活動查詢停用時仍靠 WS 同步 |
| package.json | 新增 test:realtime，HTTP 測試入口包含即時通道 |

沿用 Node.js 24.22.3、TypeScript 7.0.2、React 19.3.1、ws 8.23.0、better-sqlite3 13.2.0；未安裝或更換依賴。Schema 維持 3、18 張表；票證與 socket 僅在記憶體，重啟不能沿用票證或通道版本，正式資料仍由既有 SQLite 模型取得。

## 票證與授權契約

1. `POST /api/realtime/ticket`，JSON 僅允許 `{ "scope": "activity" }` 或 `{ "scope": "lobby" }`。攜帶既有分頁證明標頭。activity 另須有效 bearer 身分；lobby 僅取得原本公開的大廳資料。
2. 回覆隨機 256-bit ticket、expiresAt 與 protocol。票證效期 10 秒、一次使用，同分頁新票證取代未使用舊票證。過期、錯誤及重用均拒絕。
3. 連線 `ws://127.0.0.1:<固定埠>/ws`，子協定為 `crs.v1` 與 `ticket.<短期票證>`。URL 不含 ticket、長效 token 或分頁秘密；後端不記錄子協定。
4. upgrade 再次檢查同來源、票證、原分頁世代、固定期限、角色及目前活動參與。角色／組別由伺服器決定；不得傳入老師或他組頻道。長效憑證不放 URL。
5. 每次檢查／快照／推送重驗權限；登出、到期、交接版本落後、離組或換場會收到繁體中文安全錯誤並關閉原通道。學生不能以 lobby scope 取得題目答案或組別結果。
6. socket 唯一允許的應用訊息是 `{ "type": "snapshot" }`；任意訂閱／組別參數或二進位訊息都拒絕。

## 快照與資料分流

每個 socket 原子建立訂閱與首份授權快照，中間不 await。後續更新皆為完整可見投影，含 serverEpoch、channelId、activityId 與該通道 revision。serverEpoch 每個服務實例重新產生，channelId 每次連線不同；它們不是工作階段憑證。

每 100ms 重驗既有通道的權限與已提交模型；HTTP 完成時也立即檢查。只有可見投影實際改變才送更新、遞增該通道 revision，serverNow 不用來製造業務事件。他組提交不影響學生／大廳的指紋，不產生事件、空更新或可推知他組提交的序號。這個週期是內部實作配置，不能當成 42 分頁 UI 必定 1 秒內完成的證據。

老師取得完整已提交資料，學生 READY 只取題號；RUNNING 僅本組答案及提交者、不含 rank／receiveOrder；ENDED 依 D01 公開成功組答案。完整內部來源、Google 憑證及來源既有答案不進學生 DTO。提交分流測試透過既有儲存邊界保存合成提交，不表示正式提交 API 或排名裁定已實作。

同 epoch／channel 的舊版本與重複版本忽略；update 缺版本或活動不同就重取授權快照，完整快照可跨缺口。新 socket 有自己的接收器，舊 socket 的延遲回覆不套用新連線。老師換場收到新活動 snapshot，舊學生收到失效並關閉，不繼續訂閱新活動。固定週期可以補上落盤後沒有即時通知的變動；重連取得最新完整快照，不靠永久事件歷史。

## 測試結果與界線

- `npm run typecheck` 通過；`npm run build` 通過。
- `npm test`：96／96；新增 5 項真 HTTP／WS／SQLite 整合及 1 項快照接收器測試。
- `npm run test:browser`：4／4。包含既有 Google／匯入與原生 Chrome 分頁交接回歸，以及新增即時畫面流程。
- 新 Chrome 測試讓 view HTTP 固定回覆合成 501，確認兩老師及學生實際由 WS 套用 READY／RUNNING／ENDED。這是隔離測試配置，產品端沒有關閉 HTTP 查詢。
- 儲存回滾不推成功，本組提交只通知老師／本組，其他組及大廳的事件數不變；結束後依例外公開成功答案。
- 型別／建置／Strict Validate 與任務狀態最終紀錄見 `docs/evidence/realtime-verification.json`。

測試時使用專案指定 Node 24.22.3；目前終端預設 Node 20.19.0 不在專案支援範圍，不能用它的原生 SQLite 模組結果當成專案驗收。

## 尚待處理與停止點

- **7.4／G2、U01**：尚未整合最後有效 socket 關閉→GRACE、心跳、連線世代及完整強制中斷探針。既有 IdentityService 可保存正常關機證據，並對無法判定的中斷回覆 RECOVERY_UNCERTAIN；這只是保留資料與等待判定，不是 U01 已定案政策。先確認證據／裁定需求，不能把「資料庫尚無撤銷」當成有效證明。
- **7.5**：五秒自動重連及完整恢復未驗收。前端原有 2 秒 HTTP 檢查仍保留，不能把它當成正式 WS 重連、心跳或 30 秒寬限完成。
- **7.6／7.7**：週期校時、可見性恢復、30 秒邊界／重疊連線恢復協定與 T_commit 量測尚未完成。本報告只記錄目前通道測試，不以其取代全部完成條件。
- **U02**：背景分頁在驗收範圍；真正凍結／丟棄／OS 休眠的分類仍待確認，不排除樣本、不調低門檻。
- **U03** 與完整搶答／結果畫面／匯出仍保持原任務，未修改正式需求、規格或決策。

啟動方式維持 `nvm use`、`npm run dev`；前後端同來源 `http://127.0.0.1:3000/`。修改後端須正常停止並重啟既有程序；不要刪除資料庫或憑證。人工審查本次通道實作後，再處理 G2／U01 的證據與確認。
