# 搶答提交與排名實作紀錄

日期：2026-11-26（Asia/Taipei）。Change：build-local-classroom-response-system。

## 本階段結果

完成 8.1～8.7，累計 53／85、剩餘 32 項。正式提交 API 已開放，題組原子性、每組每題一次、權威排名、提交／結束共同排序及 requestId 重送已整合。完整學生作答表單、老師完整監看畫面及結果畫面仍由第 9～11 群組承接；不能把本階段的 API／封包測試當作那些畫面已完成。

原 docs/requirements.md 及正式 proposal／design／十份 spec 保持原樣，仍為 78 項需求、120 個情境、85 項任務；只有 tasks.md 的完成方框及實作追蹤更新。D38 仍適用重啟恢復，U02／U03 未自行定案。未執行完整 42 分頁／20 輪效能及跨功能故障驗收，也沒有寫入真實 Google Sheets。

## 提交與授權契約

`POST /api/activities/{activityId}/questions/{questionId}/submissions`，攜帶既有分頁憑證標頭。JSON 只有 requestId 與 answers；answers 的每筆只有 fieldId、text。欄位識別使用該題實際公開的 ID，單題一欄、題組一至多欄，不把範例子題數當上限。

伺服器驗證原分頁、固定期限、目前活動、學生參與及組別，送出者採資料庫暱稱快照；不接受客戶端指定角色、組別、參與者、名次或提交時間。未入組、老師、過期、舊活動、跨組／偽造與其他題欄位均拒絕。

答案使用既有共用可見字元規則：修剪頭尾空白後 1～200 字，保留中間空白與換行，完整 emoji 為一個可見字元。傳輸層先驗型別與欄位結構；空陣列／空白文字交由業務層回覆具體欄位錯誤，並不代表接受不完整答案。

新增繁體中文錯誤：INCOMPLETE_ANSWERS、ALREADY_SUBMITTED、REQUEST_ID_CONFLICT；無效文字沿用 INVALID_ANSWER。缺漏／不合法欄位的錯誤附 fieldIds，讓後續作答表單標示修正位置；只列出目前有權作答題目的欄位，不回內部 SQL、堆疊、答案或憑證。

成功資料為 `{accepted:true,requestId,submission:{questionId,senderNickname,answers}}`。accepted 表示本組有效提交已保存，不等於第一名。學生回覆不含 rank、receiveOrder、receivedAt、submittedAt 或可推知其他組提交的全域版本；老師仍透過既有授權投影查看全部提交、名次與原時間。

## 原子性、鎖定與排名

完整 HTTP 本文抵達原命令入口後、任何非同步驗證前，先以短 SQLite 交易配置持久 receiveOrder／receivedAt，再進入同一有序命令佇列。提交、老師開始及確認結束共用此入口；客戶端時間不裁定名次。

SubmissionService 在 IMMEDIATE 交易內重驗活動與參與，檢查成功重送、階段、完整且唯一的全部欄位、合法文字及本組是否已送出，再以已接受提交的 max(rank)+1 配置連續名次。提交、所有子題、送出者快照、原時間、接收序號、requestId／內容指紋及 sealed 狀態一起保存；只有 COMMIT 完成才回成功，WS 也只讀已保存投影。

沿用現有 SQLite 每組每題、每題名次與 requestId 唯一約束及不可修改觸發器。任一子題失敗整筆回滾，無效與回滾不占名次；配置過的接收序號仍保留缺口。第一名出現後其他組仍可送出第二、第三名，本組其他題亦可提交。

提交與結束的實測 A→E→B：即使 A 的驗證延遲，A 先保存，E 使用原接收時間固定結束，B 作為新的提交遭拒；重複結束不能改時間。

## requestId 與原成功結果

requestId 依目前活動及原組別命名空間識別，內容指紋由伺服器計算，包含 activityId、questionId 及依 fieldId 穩定排序的正規化答案。欄位陣列順序與已修剪的頭尾空白不形成另一筆內容；不做額外文字改寫或答案正確性判斷。

有效原組身分以相同 requestId／內容重送，直接讀原提交回覆；同組其他有效組員亦只能取得原本的本組結果，不會改送出者。不同內容或題目冒用同組 requestId 拒絕；不同 requestId 重送已提交題目亦拒絕。其他組相同 requestId 只識別該組自己的請求，不能查到原組資料。

已保存的成功請求先於新提交的階段限制辨識，因此結束或重啟後仍可回原成功資料；權限、固定期限及活動關聯仍優先，舊／失效身分不可藉重送取資料。答案、送出者、時間與名次不更新。成功換場清掉舊提交與指紋，新活動重新從該題第一名開始，但系統接收序號不歸零。

來源既有答案完全不參與裁定。收到的原有效提交時間持久不變，老師投影仍為 Asia/Taipei、YYYY-MM-DD HH:mm:ss.SSS 並標示時區；不改成重試或匯出時間。真正 Sheets 匯出驗證仍在第 12 群組。

## 測試結果

| 檢查 | 結果與界線 |
|---|---|
| npm test | 111／111；含本階段新增 10 項整合／故障案例 |
| 題組與競爭 | 欄位缺漏、空白、200／201 emoji 邊界、最後子題失敗、同組兩人、跨組後續名次及其他題 |
| 排序與恢復 | 同毫秒、無效缺口、A→E→B 延遲驗證、重建後第三名、換場後新第一名及系統序號延續 |
| 重送 | 同組正規化內容、他組隔離、不同內容、結束後、正常重建、過期拒絕，以及真 HTTP 回覆本文未讀即中斷 |
| 真 SIGKILL | 兩案：題組 COMMIT 前強制中斷整筆回滾；COMMIT 後尚未傳送回覆強制中斷，原成功可取回且不重複保存 |
| WS | 寫入失敗無成功事件；老師完整，本組必要，其他組不收到提交事件或版本變動；學生無名次／時間外洩 |
| npm run test:browser | 6／6；新增同 Chrome 兩老師、四學生、三組的真 HTTP／WS／SQLite 提交與重建流程，保留原生背景、分頁交接及 Google 替身回歸 |
| 型別、建置及啟動 | typecheck／build 通過，建置啟動 1／1 |
| Strict Validate | 通過；最終任務與實作雜湊見 evidence/ranking-verification.json |

故障子程序使用臨時 SQLite、合成身分及固定時鐘，SIGKILL／WAL 回滾是真實執行。COMMIT 邊界注入於正式 SubmissionService 與儲存交易，沒有把服務本身的邊界探針冒充成整個 HTTP 伺服器程序中斷。另有真 HTTP 測試在已確認落盤、收到回覆標頭後直接中斷本文，不消費成功資料，再以相同 requestId 取得原成功。

瀏覽器測試透過現有登入、選組及活動畫面取得真分頁授權，再直接呼叫提交 API、檢查 WS 投影；沒有新增測試專用產品按鈕，也沒有假裝完整作答表單或完整監看畫面已存在。Node HTTP 測試使用明確關閉連線的測試客戶端，避免重建服務時沿用已關閉的連線；沒有盲目自動重送 POST 掩蓋結果不明。

證據：[Chrome 流程](evidence/ranking-browser.json)、[本階段驗證摘要](evidence/ranking-verification.json)。此處不是 42 分頁正式效能報告，U02 凍結／休眠分類與 U03 未核實範圍處理仍待確認。

## 檔案、資料庫與操作

新增：src/server/submissions.ts、src/shared/submissions.ts、tests/helpers/ranking.ts、tests/helpers/submission-crash.ts、tests/integration/submissions.test.ts、tests/integration/submission-crash.test.ts、tests/browser/ranking.spec.ts、本報告與上述證據。

修改：src/server/api.ts、src/server/index.ts、src/shared/contracts.ts、src/shared/errors.ts、package.json、README／API／資料庫說明及 tasks.md 完成狀態。其餘正式規劃文件不改寫。

沿用現有 submissions／submission_answers／receive_orders／system_state 等表，Schema 維持 3、18 表，無新 migration，無歷史答案集合。套件仍為 Node.js 24.22.3、TypeScript 7.0.2、React 19.3.1、ws 8.23.0、better-sqlite3 13.2.0 等鎖定版本，未安裝新依賴。

```sh
nvm use
npm run dev
# 前後端同來源：http://127.0.0.1:3000/
# 以下測試另開終端執行
npm run test:ranking
npm test
npm run test:browser
```

本機服務正常重啟載入新版，不對目前實際課堂資料送出測試答案、不改活動階段、不替換來源，也不寫入外部 Sheets。本階段結束後停止，下一階段為學生端操作任務。
