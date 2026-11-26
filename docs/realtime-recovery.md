# 即時同步與斷線恢復完成紀錄

日期：2026-11-26（Asia/Taipei）。Change：build-local-classroom-response-system。

## 本階段結果

本次完成 7.4～7.7，與前次 7.1～7.3 合計完成第 7 群組；累計 46／85，剩餘 39。未開始第 8 群組搶答與排名。這是目前通道、身分生命週期及基礎畫面的驗證，不代表 42 分頁、F1～F3／20 輪或完整結果畫面驗收已完成。

使用者在 G2 邊界探針後明確選擇 A，登錄 **D38**：無法判斷截止前後的非正常中斷，以最後已提交 CONNECTED／GRACE 狀態為依據，服務可用後為合法原分頁重新提供 30 秒；已撤銷、固定 12 小時到期、舊活動與不合法分頁證明不恢復。例外可能讓剛逾期但撤銷未落盤者恢復，不宣稱消除了歷史時刻的不確定性。

已同步 proposal.md、design.md、RR04／PS01 與 tasks.md；需求仍為 78 項，新增一個 D38 驗收情境後為 120 個情境，任務仍為 85 項。原 docs/requirements.md 未修改。U02／U03 保持待確認，沒有新增凍結／休眠排除規則或未核實範圍自動解除。

## 連線與持久化

- 有效通道以工作階段、文件執行個體及交接世代關聯。最後一條有效通道斷開才保存 GRACE 起訖與狀態版本；同世代重疊通道不重複計人，舊世代 close 不能撤掉新世代。
- 寬限為 30000ms。HTTP 查詢與重試不延長寬限，不假稱 WS 已連線；只有通過身分檢查的實際通道建立才轉回 CONNECTED。原分頁交接若尚未接通，保持有界寬限。
- 每 100ms 檢查到期及已提交狀態，即使所有通道已關閉也會保存寬限屆滿與成員移除。每次授權仍即時檢查到期／寬限，不等待掃描才拒絕。
- 原生 WebSocket ping 每 2 秒檢查，等待 pong 超過 6 秒則判定通道失聯，再自伺服器偵測點開始寬限。一般分頁 close 直接開始寬限；沉默網路故障包含偵測延遲，不能宣稱知道實體斷線的精確時刻。ping/pong 由瀏覽器網路層處理，不依背景 JavaScript timer。
- 正常停止不將關閉伺服器通道誤算成新的正常斷線；依原停機流程先處理已屆滿寬限，再保存正常關機證據。啟動依 D38、撤銷、活動及固定期限裁定，重新給恢復寬限；保存 policy:D38 與恢復時間，expiresAt 不變。舊版 UNRESOLVED_RESTART 紀錄也依已確認政策處理。
- 連線集合、一次票證、原生心跳與 channelId 為記憶體資料；交接世代、寬限、失效、成員及恢復裁定沿用既有 SQLite 表。Schema 仍為 3、18 張表，沒有新增 migration、資料庫重建或歷史答案集合。

## 自動恢復與計時

前端使用一次票證重新建立 socket；失敗每 500ms 嘗試，單次票證／首份快照等待逾 3000ms 取消重試（第 13 階段由原 1500ms 調整，以避免多分頁票證排隊反覆被取消；5 秒恢復驗收門檻不變）。舊請求及 socket 回覆以本地嘗試世代隔離；每次新連線重新建立快照接收器，不沿用舊 serverEpoch／channelId。原 HTTP 查詢仍可用，但不拿輪詢當作 WS 恢復的證明。

連線中斷顯示自動恢復提示，伺服器回覆的到期／換場等原因保留。可見性恢復與 online 事件立即取授權快照並校時。斷線期間老師結束，重連直接套用 ENDED 與本組狀態；完整學生結果介面仍由 9.5／11.3 承接。

socket 另接受 `{type:"clock",requestId:"UUID"}`，重新授權後只回該 requestId 與 serverNow，不增加業務 revision，也不透露其他組提交。前端以往返中點估計伺服器時間，每秒更新樣本，以 performance.now 推算，不用客戶端 Date.now 或累加 timer 作權威。開始時間不因停機改變，結束後以原 endedAt 停止。

## 測試與證據

| 檢查 | 結果／範圍 |
|---|---|
| 型別、建置 | npm run typecheck／build 通過 |
| 單元／整合 | 101／101；包含重疊世代、30 秒前後、HTTP 不延長、無 pong、legacy 待確認、D38 及單調校時 |
| 整套 Chrome | 5／5；含原生副本／交接、Google 替身匯入與本階段原生背景流程 |
| 有視窗覆核 | 加強後恢復流程 1／1；須收到新連線 ENDED 快照才記錄恢復完成 |
| 建置啟動 | 1／1；固定來源重啟、同一資料庫保存 |
| G2 截止探針 | 五案真 SIGKILL／SQLite；注入邏輯時鐘，依 D38 驗證恢復與不復活 |
| Strict Validate | 通過；最終任務狀態與版本雜湊見 recovery-verification.json |

首次背景測試發現 Playwright 預設焦點模擬會讓非前景頁仍為 visible；該結果不能作真正背景證據。最終使用隔離設定檔直接啟動原生 Chrome，再以 connectOverCDP(noDefaults:true) 連接；不關閉背景節流，不模擬 visibilityState，實際確認學生頁 hidden。測試專用 Chrome、設定檔及暫存 DB 完成後清除，不接管日常 Chrome。

正式保留的測試資料：

- [確認前 G2 觀測](evidence/g2-recovery-probe.json)：保留 NOT_PROVEN，說明紀錄不足，沒有倒填成已知歷史。
- [D38 確認後 G2 探針](evidence/g2-confirmed-recovery-probe.json)：五個 COMMIT／關機邊界，以及固定 12 小時優先。
- [有視窗 Chrome 恢復](evidence/recovery-browser-headed.json)、[無視窗 Chrome 恢復](evidence/recovery-browser-headless.json)：每次版本、實際 hidden、關閉移除、恢復與計時差。
- [通道協定量測](evidence/recovery-protocol.json)：同 Node 單調時間軸的 T_commit、revision、授權快照恢復觀測；T_commit 設在 SQLite UPDATE 返回後，表示提交已完成。T_protocol／T_snapshot 是協定接收，不是 DOM 的 T_apply／完整 UI 恢復證據。
- [最終驗證摘要](evidence/recovery-verification.json)：任務進度、測試與實作版本。

Chrome 流程使用真 30 秒等待測關閉移除；停機超過 30 秒則使用注入伺服器時鐘。瀏覽器測試中的無正常檢查點服務重建不是 SIGKILL，真正子程序 SIGKILL 另由 G2 探針驗證。每次保存實際安裝 Chrome 版本；過程中 Chrome 版本有變動，不把不同次執行視為同一環境。尚未據此宣稱它是正式驗收當時的最新穩定版。

以上樣本不是 42 分頁效能報告；正式 T_commit／T_apply 校準、誤差、F1～F3 各 20 輪、全部失敗與最壞值仍在 13.3。G2 已驗本階段的已確認分支與 D38 例外，13.4 跨功能故障整合仍未完成。U02 凍結／丟棄／OS 休眠不排除樣本、不放寬門檻，待正式驗收前另確認。

## 檔案與操作

新增：src/client/clock.ts、scripts/probes/g2.ts、scripts/probes/g2-worker.ts、tests/unit/clock.test.ts、tests/browser/recovery.spec.ts、tests/helpers/native-chrome.ts，以及本報告、G2 審查報告與上述證據。

修改：src/server/identity.ts、src/server/realtime.ts、src/client/realtime.ts、src/client/session.ts、src/client/main.tsx、src/client/activity.tsx；identity／realtime 整合測試、package.json、README／相關操作說明；以及經確認的五份 OpenSpec 規劃檔。前次已完成的 7.1～7.3 保持，沒有新增搶答提交功能。

沿用 Node.js 24.22.3、TypeScript 7.0.2、React 19.3.1、ws 8.23.0、better-sqlite3 13.2.0、Playwright 1.65.1；未安裝新依賴。完整鎖定版本見 package-lock.json。

```sh
nvm use
npm run dev
# 同來源前後端：http://127.0.0.1:3000/
# 以下測試另開終端執行
npm run test:realtime
npm run probe:g2
npm run test:browser
# 原生有視窗恢復驗證（先建置）：
npm run build
CRS_HEADED=1 npx playwright test tests/browser/recovery.spec.ts
```

實際服務已正常重啟載入新版，沒有開始／結束／替換目前活動或寫入外部 Sheets。後續為第 8 群組搶答與排名；本階段結束後停止等待人工審查。
