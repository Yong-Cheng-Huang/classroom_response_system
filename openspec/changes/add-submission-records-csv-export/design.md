# Design

## Context

目前實作為 TypeScript／React／Node.js／SQLite，HTTP 與 WebSocket 共用本機來源。`src/server/read-model.ts` 已從 SQLite 讀取全部 sealed 提交；`src/server/projections.ts` 的老師投影包含題目順序、子題標記、組號、送出者暱稱、rank、receivedAt 與完整答案，學生投影刻意限縮。

`src/client/main.tsx` 在老師分頁串接 Google 連結、活動管理、Sheets 匯出與 `ImportGuidedNotes`。`src/client/session.ts` 目前的 request 方法只解析 JSON，不能直接供檔案下載；直接使用普通超連結會缺少分頁授權標頭。

現有三模式 Sheets 匯出屬外部寫入；CSV 是本機下載，不建立另一個 Google 匯出操作。基準 Change `build-local-classroom-response-system` 仍為84／85，13.3缺失保留。主規格尚未同步，這次以獨立新增能力描述，不擅自封存基準 Change。

已明確確認的新增需求：匯入區塊下方、全部組別送出紀錄、指定八欄、Excel 可開啟；使用者另確認僅活動結束後可下載。其餘本節為本次提案的具體設計選擇，不冒稱已於先前 D01～D40 確認。

## Goals / Non-Goals

**Goals:**

- 在既有權限及已結束活動快照上提供完整 CSV，不依賴 Google 狀態。
- 讓檔案內容可測、下載錯誤沿用既有分頁身分處理，不將敏感標頭放網址。
- 保持匯出純讀取，無 migration、新套件或跨活動歷史保存。

**Non-Goals:**

- 不蒐集真實姓名、不紀錄被拒 HTTP 嘗試，不新增正確性評分或重新排名。
- 不製作 XLSX，不變更三模式 Sheets 匯出、D31、Google OAuth 或原本效能門檻。
- 不以本次 CSV 測試把原 13.3 標為完成。

## Decisions

### 1. 由權威後端產生 CSV

新增 `GET /api/activities/:activityId/submissions.csv`，整合於現有活動路由。依現有正式身分驗證取得有效老師，進入同步 SQLite 讀取交易再確認目前場次及 ENDED，使用既有讀模與老師投影組合匯出資料，不使用學生投影、不信任瀏覽器上次取得的資料。

選擇後端下載而非前端直接匯出已顯示的 view，是為了讓每次下載都驗權限、活動與階段，避免把前端過期快照當作最新結果。選擇純 CSV 序列化模組，避免用大型試算表套件處理八欄文字。

成功回覆：`Content-Type: text/csv; charset=utf-8`、`Content-Disposition: attachment; filename="classroom-submissions-<activityId>.csv"`、`Cache-Control: no-store`。檔名使用經驗證的活動 UUID，不放姓名或來源網址；錯誤保持現有 JSON 錯誤契約。方法錯誤、任意 query、舊場、非 ENDED、匿名、學生及失效證明皆拒絕。

身分驗證可能按原機制進行必要的到期／撤銷裁定；CSV 業務本身不配置接收序號、不變更活動或匯出管理資料。全部檔案內容在交易快照內取齊並完成序列化後回傳，不讓中途例外產生看似成功的部分 CSV。產生的 Buffer 只存記憶體，不另寫伺服器歷史檔。

### 2. 資料列與八欄映射

| CSV 欄位 | 來源及表示 |
|---|---|
| 題號 | 來源題號字串，沿用 questions 的位置排序 |
| 子題 | 欄位原 label，單題為空字串 |
| 組別 | 保存的組號，顯示「第 N 組」 |
| 姓名 | submissions.senderNickname 暱稱快照，不查目前在線名單 |
| 答案 | 每個欄位的已保存答案文字 |
| 搶答順位 | 已保存 rank，題組各列相同 |
| 送出時間 | 沿用 `formatSubmissionTime(receivedAt)` 的臺灣時區與毫秒 |
| 是否搶答成功 | rank === 1 為「是」，其餘「否」；不比對來源答案 |

外層按題目位置，再按提交順位，再按欄位位置展開；用 fieldId 找答案而非假設 answers 陣列恰為欄位順序。全部 sealed 提交均保留，包含失去即時身分但已有提交的送出者。題目未作答或組別未提交不補造列；零提交下載只有表頭。資料沒變時多次下載內容應相同。

### 3. CSV 格式及公式型文字

第一個位元組序列為 UTF-8 BOM（EF BB BF）；其後第一列為固定八欄表頭，不加入 sep= 或額外說明列。欄位一律雙引號包覆，內部引號加倍，紀錄分隔為 CRLF，欄位內的原換行保留，不以逗號或換行直接 split 驗證。

對題號、子題、姓名及答案等外部文字，在跳過前置空白後遇到 `=`、`+`、`-`、`@`，或以 tab／CR／LF 控制字元開頭時，於匯出文字前加單引號，再進行 CSV quoting。此為匯出層安全轉換，不回寫資料庫。其餘文字保留原文；順位為可信正整數，成功為固定文字。

CSV 無法像 XLSX 指定儲存格型別；Excel 自動推斷可能改變純數字型文字的呈現。此次採標準 CSV 與 BOM，不以公式包裹文字來強制格式；若要保證所有型別與前導零的視覺格式，屬後續 XLSX 能力，不能聲稱 CSV 可完整取代。

### 4. 分頁授權下載與介面

新增獨立 CSV 下載元件，位於 `ImportGuidedNotes` 之後，與 Google blocked 狀態分離。文字說明包含「下載所有組別已送出的答案，含未搶到紀錄」、「活動結束後可下載」及「姓名為送出者暱稱」。未結束時禁用；已結束即使零提交亦可下載表頭。

在 TabSession 增加帶既有 headers 的檔案請求能力，與 JSON request 共用失效代碼處理，維持 token／第二憑證／document generation 規則。只在成功且 CSV Content-Type 正確時讀 Blob，以 object URL 及 download 觸發儲存；不建立帶 token 的 URL、不用普通未授權超連結。

使用 busy 防重入及 AbortController，於元件卸載、活動更換或身分失效時取消下載；回覆後再核對原活動與原授權仍有效才觸發下載，釋放 object URL。錯誤訊息用繁體中文；JSON 錯誤不另存 CSV。健康恢復後允許重試，不能清原活動或作答。下載不強制重新執行匯入或 Google 連結。

### 5. 測試與需求對應

| 範圍 | 核對重點 | 規格 |
|---|---|---|
| 純序列化單元 | 八欄、單題／題組、非第一名、同毫秒、原暱稱、順序、BOM、引號／多行／emoji、公式安全、零列 | CSV02～CSV05 |
| HTTP 整合 | 真老師／學生與雙證明矩陣、已結束限制、舊活動、query、Google 未配置、回應標頭、資料不變及重啟內容一致 | CSV01、CSV02、CSV04、CSV06、CSV07 |
| Chrome 流程 | 真按鈕位置、已結束啟用、學生無入口、實際 download 事件與檔案 bytes、未連結 Google、錯誤與延遲回覆 | CSV01、CSV05、CSV08 |
| 回歸與文件 | 原 Sheets 匯入匯出、老師／學生／結果及身分測試不退步；操作指南及驗收紀錄保留原13.3缺失 | CSV01～CSV08 |

以可處理 quoted multiline 的獨立 CSV 解析方式核對八欄與列數，不能使用與序列化實作相同的簡單字串拼接假裝測試。以隔離 SQLite 及測試設定檔驗收，不寫正式資料庫或真實 Sheets。若環境沒有 Excel，明確記錄「編碼與結構驗證通過，尚未實際 Excel 開啟」，不得用 Chrome 下載代替人工 Excel 呈現證據。

## Risks / Trade-offs

- [CSV 公式型輸入] → 匯出時文字安全前綴與單元／下載檔核對；原文只在資料庫保留不變。
- [姓名被誤解為全組成員或真實姓名] → 明列送出者暱稱快照，離線仍保留、不另蒐集真實姓名。
- [換場與延遲下載] → 明確 activityId、同一讀取交易、前端取消及過期回覆核對；不新增歷史查詢。
- [兩個開放 Change 的依賴] → 以基準 Change 的已實作 API／投影為依據，本 Change 只新增 CSV；原 13.3 仍未通過，未同步／封存前不能宣稱全案驗收完成。
- [Excel 型別推斷與地區設定] → BOM、標準逗號 CSV 與特殊字元測試；若使用者 Excel 使用不同分隔設定，需以 Excel 匯入功能選逗號，不保證所有平台／版本自動判斷相同。

## Migration Plan

後續明確啟動 Apply 後，按 tasks 執行序列化、授權路由、下載支援、介面及回歸。不變更 schema，不需要轉換既有提交；更新後已存在的已結束活動即可下載。回退此新增路由與元件即可，不清資料庫或 Google 連結。

本輪只建立 planning artifacts，沒有實作或啟用新入口。完成後等待人工審查，不自動 Apply、Sync、Archive 或推送新程式。
