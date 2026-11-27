# Proposal

## Why

目前老師只能將每題第一名答案寫回 Google Sheets，無法下載全部組別的提交明細供 Excel 整理。新增不依賴 Google 連結的本機 CSV 匯出，保存第一名及後續名次的完整作答紀錄。

## What Changes

- 老師端「匯入 Guided Notes」區塊下方增加「匯出 CSV」區塊及下載按鈕。使用者已確認僅活動結束後開放。
- 匯出目前活動全部已受理、已保存的組別提交，包含未搶到的提交；每筆答案欄位一列，題組各子題分列。
- 八欄依序為「題號、子題、組別、姓名、答案、搶答順位、送出時間、是否搶答成功」。原提問的「子堤」按「子題」處理；姓名沿用系統已有的送出者暱稱，不新增真實姓名蒐集。
- 使用 UTF-8 BOM、逗號及 CRLF，保留多行中文／emoji，正確處理引號及公式型文字，供 Excel 直接開啟。
- 後端驗證老師分頁身分與目前活動，從同一讀取交易產生檔案；不呼叫 Google、不改寫作答資料。

## Capabilities

### New Capabilities

- `submission-records-export`：目前活動所有已受理提交的 CSV 下載、固定欄位語意、Excel 相容、安全與老師權限。

### Modified Capabilities

無。現有 Guided Notes 匯出仍限結束後且維持三模式寫回；CSV 為結束後的獨立下載能力，不更動任何原功能。

## Impact

- 現有正式主規格尚未同步（`openspec list --specs` 為空），實作基準為仍開放的 `build-local-classroom-response-system` Change，特別是 TC02～TC05、SR02～SR08、PS01／PS06；不得重建或重複宣告其既有能力。
- 預計影響老師頁面入口、帶分頁證明的檔案下載、HTTP API 與純 CSV 序列化；沿用 TypeScript、React、Node.js、SQLite，不新增套件或 migration。
- 不修改 `docs/requirements.md`、原 Change 決策或任務完成狀態。原 Change 的 13.3 效能缺失仍為未完成。
- 不保存被拒絕／無效 HTTP 請求，不建立歷史活動查詢、不補造未作答紀錄，不提供學生下載，不新增 XLSX 或重新設計 Google 授權。
- 本提案完成後停於人工審查；後續明確啟動 Apply 才實作、測試及更新任務。
