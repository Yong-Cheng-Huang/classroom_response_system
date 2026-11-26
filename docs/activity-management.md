# 活動生命週期與管理實作

日期：2026-11-26（Asia/Taipei）。Change：`build-local-classroom-response-system`。

## 本次結果與範圍

依使用者確認修訂前置順序後，實作第 5 群組的 5.1～5.5。完成條件經相關測試通過後勾選，累計 30／85、剩餘 55。4.6 仍待實際訂閱授權整合；第 6 群組需要真實 Google 資源及授權，沒有假造成功。U01／U02／U03 與 G2 均未裁定或勾選。

已更新的正式規劃只有 tasks 的前置表／進度記錄及 design 的實作順序說明，內容是前一階段報告提出、使用者明確同意的修訂。原 85 項任務、每項完成條件、78 項需求、119 個情境及十份功能規格均保留；原 requirements、proposal 與人工審查報告未改。

## 檔案與責任

| 檔案 | 變更 |
|---|---|
| `src/server/activity.ts` | 老師授權活動服務、狀態／版本守衛、時間查詢、換場服務、文件互斥與後續確認意圖資料契約 |
| `src/server/api.ts` | 開始／結束實際命令，沿用完整請求入口的共同排序與角色／活動檢查 |
| `src/server/app.ts` | 正式接收序號配置器沿用可注入伺服器時鐘，便於可重現驗收；正式預設仍為 Date.now |
| `src/server/index.ts` | 注入正式 ActivityService，無測試角色或假活動入口 |
| `src/client/activity.tsx` | 伺服器時間基準計時、開始操作、原生結束確認對話框／取消 |
| `src/client/main.tsx`、`session.ts`、`style.css` | 接上老師控制與學生計時、操作錯誤及既有視覺樣式 |
| `tests/integration/activity.test.ts` | 四階段轉換矩陣、授權／版本、原子換場、時間持久化、文件互斥及真 HTTP |
| `tests/browser/identity.spec.ts` | 延續同 Chrome 正式身分測試，加入開始、取消／確認結束、兩老師固定總時長與重整 |
| `docs/google-oauth-setup.md` | 使用者要求的 Google Console、OAuth client 與可寫副本手動設定步驟，附官方來源 |
| `.env.example`、`README.md`、`docs/backend-api-contracts.md`、`docs/database.md` | 更新實際可用功能及操作說明；身分階段報告加註後續狀態 |

未新增套件或資料遷移，既有鎖定版本保持，SQLite schema 仍為 3、18 張表。

## 狀態、權限與時間

- 沒有活動資料為 EMPTY；完整成功匯入候選才建立 READY。只有老師能開始 READY，只有老師確認後能結束 RUNNING。ENDED 不能重新開啟。
- 開始與結束使用同一命令佇列；完整 HTTP 本文到達時先持久配置接收序號／伺服器時間，再執行驗證。時間不採用客戶端輸入。
- 執行時重驗雙憑證、固定期限、老師角色、當前 activityId、版本及階段；同一 SQLite 交易保存狀態／時間／遞增版本。重複或舊操作遭拒，不重設原時間。
- 開始不撤銷學生，權威模型從同一階段一次開放所有題目的敘述。學生表單及完整作答操作仍由第 9 群組承接。
- 結束按鈕開啟原生 dialog；取消不送結束命令，確認綁定當時 activityId／version。另一老師已先操作時由伺服器拒絕舊版本。
- READY 時長為零；RUNNING 依原 startedAt 與伺服器時間持續計算，停機仍計時；ENDED 依 endedAt 固定。畫面以伺服器時間與 performance.now 的時間差推進，不依賴瀏覽器 Date.now 的時區或時鐘。

目前 GET 快照仍採既有兩秒讀取，不宣稱已完成一秒即時同步、完整連線生命週期或五秒恢復；那些由第 7、13 群組驗收。

## 換場、文件互斥與待確認匯出

ActivityService.replace 只供後端使用，接收已完整解析的候選；沒有建立允許瀏覽器任意提交題目／原始快照的測試捷徑。先驗老師與當前操作資格，再取得文件互斥，在正式原子替換邊界內重驗活動／版本／確認並提交。完整來源讀取與匯入 HTTP 由 6.7 接入，本階段依已確認前置表以固定解析候選測交易。

成功才清除舊題目、組別、成員、答案、名次、場次匯出歷程；保留有效老師、啟動設定、Google 連結與最少文件管理資訊。舊學生的失效清理沿用第 4 群組；通知只在 COMMIT 後，不能因通知失敗把成功換場回報為回滾。最後欄位失敗、未確認、舊版本或非老師均不清原場。

DocumentOperations 在單一權威程序內對「試算表／工作表」保持互斥，跨 await 期間其他同文件操作遭拒，失敗也會釋放；其他文件不受該鎖影響。既有 PREPARING／WRITING 持久狀態亦阻止換場；此程序鎖不是外部 Google 協作者鎖，不能取代 D31 或跨重啟匯出狀態。

ReplacementGate 區分 AVAILABLE、CONFIRM_REPLACEMENT、RUNNING、DOCUMENT_BUSY、REQUIRES_RECONCILIATION。未確認匯出回傳核對或「請求再次確認放棄」的下一步，confirmationRequests 綁定 operationId／activityId／expectedVersion；只提供 id／state，不洩漏匯出計畫。這些資料是顯示確認的請求輸入，**不是已放棄證明或可清除資料的票證**。

依 5.5 原完成條件，真正放棄意圖簽發／驗證、原子換場及 UNVERIFIED 跨場隔離的完整整合仍由 12.10／12.11 承接；兩項保持未完成。目前不能跳過核對任意刪除 UNCONFIRMED，也未把暫時缺少該整合改寫成產品永久禁止換場的政策。

## 驗證

- 型別檢查與前後端建置通過。
- `npm test`：68／68，較前一階段增加九項活動測試。
- `npm run test:browser`：2／2，基礎頁面及同一 Chrome 正式身分／活動流程。
- 有視窗 Chrome 另跑相同流程；保存去除設定內容的驗證摘要於 `docs/evidence/activity-verification.json`。
- 建置版啟動／正常停機／同檔恢復：1／1。
- OpenSpec strict validation 及 CLI 任務狀態另行核對。

活動測試涵蓋 EMPTY／READY／RUNNING／ENDED 與開始／結束／匯入的完整轉換矩陣、學生越權、固定期限、版本競爭、取消／重複結束、最後欄位寫入失敗、成功換場清除／保留邊界、獨立 SQLite 連線驗 COMMIT 後通知、各階段資料庫關閉重開、互斥跨 await 與異常釋放、待確認匯出的下一步契約及真 HTTP 共同命令入口。保留既有 SIGKILL、資料持久化與分頁交接回歸。

Chrome 另驗老師開始後原學生仍有效，副本不能加入；12 小時到期後老師重新登入，取消結束仍 RUNNING，確認後兩老師顯示同一固定總時長，重整及伺服器時間前進後仍不累加。截圖 `test-results/activity-ended.png` 已目視檢查。這不是 42 分頁、Google 整合或效能驗收。

## 操作及停止點

停止舊服務後 `npm run dev`，固定網址 `http://127.0.0.1:3000`。老師密碼仍由 .env 設定。已有 READY 活動時，老師可開始、取消／確認結束；空資料庫仍等待匯入，不自動建立假活動。正式 Google 匯入尚未開放。

使用者已確認尚未配置 Google 資源，請依 [Google OAuth 設定步驟](google-oauth-setup.md) 準備 client JSON、本機回呼與兩份可寫範本副本。6.1 要求測試帳號完成真實授權，外部資源未就緒前不能勾選或以模擬冒充；6.1～6.8 仍未勾選，待資源提供後接續。沒有跳過原任務或更換為 service account。
