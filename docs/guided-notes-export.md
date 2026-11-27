> 新版已依使用者確認改用公開讀取／服務帳戶，個人OAuth功能退出。請先依[服務帳戶設定指南](google-service-account-setup.md)操作；本文OAuth相關操作與舊測試數據保留為歷史紀錄，不代表新版仍提供OAuth。

# Guided Notes 匯出實作與驗證

2026-11-26，第 12 群組 12.1～12.12。沿用 D30 技術及既有 schema 3／18 表，沒有新增依賴、migration 或修改原始需求／正式規格。完整整合、42 分頁效能與中斷驗收仍屬第 13 群組。

## 操作與權限

老師結束活動後，在「匯出 Guided Notes」選擇只有答案、答案＋組別時間欄、答案＋格內附註行。先請老師與協作者暫停編輯該工作表，再勾選確認並預檢匯出。D31 是從預檢開始至匯出／核對完成的操作前提；系統不能強制鎖住 Google Sheets 外部編輯。未勾選、未結束、學生、失效老師、舊活動、版本衝突、未連結 Google 或沒有寫入權限都拒絕。匯出不改本機提交、名次或活動結果。

預檢會重新解析所有題目、子題、定位及合併，包括最後一題與無人題。與匯入快照及本系統最近核對的管理資訊比對；標記／題目／目標人工修改、未知歸屬或 I:K 非系統內容衝突時整次停止，沒有部分寫入；不相關的標題變更會保留。外部協作者違反 D31 的檢查後競爭無法由本機鎖排除。

| 模式 | 寫入與還原 |
|---|---|
| 只有答案 | 每題成功組 rank=1 的完整答案寫回單題 G:H 左上格或題組 H；使用字串值，`=` 開頭不變公式。 |
| 答案＋組別時間欄 | I4／J4／K4 為組別／提交時間／送出者，題組各欄共用同一提交資訊；必要時在表格末端增加欄位，不插移 B:H。 |
| 答案＋格內附註行 | 原答案下一行加入組別、送出者、Asia/Taipei 原提交時間；附註灰色 9 點，答案維持原字型字級，調整換行及列高。 |

保留框線、底色、對齊、題目與合併。三乘三切換及同模式重複不累加；只有可核對的本系統附加資訊可移除，不刪整欄。移除格內附註時還原第一次管理前的換行及列高。無人作答保留工作表原答案文字，清除可核對的舊附加資訊，不將來源舊答案當作本場成功答案。跨活動僅保留必要範圍、雜湊與排版，不提供歷史答案查詢。

## 狀態、未知結果及換場

| 狀態 | 行為 |
|---|---|
| PREPARING／準備中 | 取得文件互斥並讀取、完整預檢；可以取消，晚到讀取不得再寫。重啟後為 FAILED。 |
| WRITING／寫入中 | 完整計畫、寫前／寫後值與排版核對證據先在 SQLite COMMIT，再送單次 batchUpdate；不可取消。 |
| COMPLETED／已完成 | 讀回符合預期，管理雜湊與完成狀態同交易保存，可恢復編輯。 |
| FAILED／已失敗 | 預檢失敗、取消或 Google 明確拒絕，確認沒有寫入；可修正後重新預檢。 |
| UNCONFIRMED／待確認 | 逾時、網路／5xx、回覆不明、寫後核對不符、寫後本機保存失敗或 WRITING 重啟；可能已修改，不誤報未寫入、不盲重試。 |

同活動 requestId 冪等；不同模式重用同識別拒絕。未知結果阻擋新匯出，可重新授權及「再次核對」，讀回完整預期才完成；只看到舊內容不能推定請求未送達。Google 舊連線的遲到 401 不會撤銷後來新連結的憑證。閒置但未保存終態的操作可在儲存恢復後轉為待確認，再核對，不永久卡在寫入中。

若文件刪除或長期無權讀取，可選「放棄核對以建立新活動」，再次確認原表可能已修改、放棄不等於回滾的風險。確認意圖綁定老師工作階段、舊操作集合及活動版本，有效至老師期限或十分鐘，重啟後需重確認。確認本身不刪資料；取消或新匯入失敗保留全部舊場及完整核對資料。新匯入完整成功時，同一交易保存最少 UNVERIFIED 管理資訊、撤銷舊學生、清除舊活動與其完整匯出計畫、建立新活動。

未核實標記跨換場／重啟保存；包含 G:H 邏輯重疊及列高影響的重疊匯出不能自動覆寫／清除。其他文件不被阻擋，舊操作／回覆不得修改新場或解除標記。**沒有 U03 自動解除或人工強制覆寫功能**；U02 瀏覽器凍結／休眠也未由本階段決定。

## 實作對應

| 任務 | 主要檔案與證據 |
|---|---|
| 12.1、12.8 | `src/server/exports.ts`、`export-http.ts`、`src/shared/exports.ts`、`src/client/exports.tsx`：權限、D31、五狀態、安全 DTO、輪詢。 |
| 12.2～12.7 | `src/server/export-plan.ts`：全題預檢、三模式、原格式／列高、無人題、跨場管理、UTF-16 附註邊界。 |
| 12.9 | `src/server/google.ts`、`exports.ts`：單次整批寫入、明確拒絕與未知分流、持久化及讀回核對。 |
| 12.10～12.11 | `activity.ts`、`activity-replacement.ts`、`imports.ts`／`import-http.ts`、前端匯入／匯出：確認意圖、原子換場及 UNVERIFIED。 |
| 12.12 | `tests/integration/exports.test.ts`、`tests/browser/exports.spec.ts`、`scripts/probes/exports-live.ts`、`exports-live-boundaries.ts`、本文件及 evidence。 |

Google 會省略零索引、補回舊式色彩欄位及量化色彩；核對將等價格式正規化，仍保留字型、字級、樣式、色彩位元組及列高。首輪真實測試因此停在待確認，修正後另建兩份副本重跑；首輪失敗證據保留，沒有對未知操作盲目重送。Google 批次與文字格式資料定義見[官方批次說明](https://developers.google.com/workspace/sheets/api/guides/batch)及[儲存格格式參考](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/cells)。

## 驗證與限制

- `npm run test:exports`：14 項 SQLite／服務／真 HTTP 整合測試，含兩範本三乘三＋重複、格式還原、無人題、整次零寫入、冪等、五狀態、SQLite 關閉重開、本機狀態保存失敗、舊授權回覆、取消晚到、放棄換場、未核實重疊及其他文件。
- `npm run test:browser`：完整 Chrome 套件含新增匯出流程；2 老師＋學生，三模式／D31、取消預檢、未知核對、放棄確認及取消、新匯入失敗／成功、撤銷舊學生與 390px 無水平溢出。Google 在這個測試使用記憶體替身，不能據此宣稱真實 Sheets 成功。
- 真實 Google 另以已授權帳戶、新建私有測試副本及隔離 SQLite 驗證，正式活動未作測試資料。兩份完整矩陣共 62 次批次，另有真實副本邊界測試。詳見 [exports-live.json](evidence/exports-live.json) 與 [exports-live-boundaries.json](evidence/exports-live-boundaries.json)。
- 副本：[單題](https://docs.google.com/spreadsheets/d/1lJncXLLFA0mwMEBe05WdT-UYR2vG8TS0iTvbA20Y4BY/edit)、[題組](https://docs.google.com/spreadsheets/d/1HLeHYQ6W2rxZSwRGHVtcQ3vI6hb1a6UesR9M7XH6oNQ/edit)。原始兩份範本及使用者提供的來源副本未被寫入。單題後續邊界測試留有長答案及格內附註；題組矩陣最終為純答案模式。
- 完整 Chrome 首輪 12 通過／1 失敗：既有 Google 登入案例等待「老師登入」按鈕逾時，失敗時畫面已為老師登入狀態；單獨重跑與第二輪完整 13 項皆通過，紀錄位於 `docs/evidence/export-logs/`。沒有據此改動產品身分機制，保留初輪與重跑紀錄；原因尚未確定，不宣稱已修復這次間歇性失敗。
- 原生 Chrome 登入後核對首輪隔離副本的長答案（140 字測試文字、emoji）與完整時間附註，均在擴展列高中可見；API 另核對單題及題組 9 點灰色與原字型。首輪副本仍保留當時未核實結果，見 [initial-attempt](evidence/exports-live-initial-attempt.json)。
- 真實遠端提交後回覆遺失由本機注入；永久失權由讀取層注入 403，沒有真的撤銷 Google 授權或刪除文件。SQLite 儲存錯誤由觸發器注入，關庫重開驗恢復；完整程序強制中斷矩陣仍屬 13.4。
- 真實 Sheets PDF 預覽下載成功且文字包含長答案／附註，但高列造成分頁不佳，**不宣稱 PDF 列印排版驗收通過**。PDF 不是本階段產品匯出格式；原生 Sheets 才是此次顯示核對目標。

`npm run probe:exports-live` 會建立兩份新的私有測試試算表並實際寫入；需先有本機 Google 授權，耗時數分鐘，產生新的測試證據。`npm run probe:exports-live-boundaries` 只允許前一探針記錄且通過的兩份新副本，會人工修改／還原測試格及寫入長答案。請勿將這些命令視為唯讀健康檢查。探針複製加密授權至臨時目錄並於結束清理，不輸出 token；副本與原生畫面不代表正式活動已被匯出。

本階段總驗證結果、版本及不可變來源雜湊見 [export-verification.json](evidence/export-verification.json)。目前正式活動與 Google 連結保留；服務更新後使用原網址 `http://127.0.0.1:3000`。
