# Tasks

## 1. CSV 資料序列化

- [x] 1.1 建立純 CSV 序列化與欄位映射，完成條件：單元測試驗證八欄順序、全組第一名與後續名次、單題空子題、四子題分列、原暱稱快照、原時間、同毫秒名次、題目／順位／子題排序、零提交及重複輸出一致；同步記錄欄位語意。（CSV02、CSV03、CSV04）
- [x] 1.2 加入 UTF-8 BOM、完整 quoting、CRLF 與公式型文字安全轉換，完成條件：以可處理 quoted multiline 的獨立解析器核對中文／emoji／逗號／引號／多行、八欄及列數；涵蓋前置空白與控制字元的公式型輸入，資料庫原文不變，文件說明安全前綴及 CSV 型別限制。（CSV05）

## 2. 老師限定下載 API

- [x] 2.1 整合 GET /api/activities/:activityId/submissions.csv 與同場讀取交易，完成條件：真 HTTP 整合測試證明有效老師在 ENDED 取得正確標頭與完整檔案、無 Google 設定仍可用、只回表頭亦合法；匿名／學生／偽造角色／錯分頁／過期／撤銷／舊場／非結束／錯誤方法／query 皆拒絕且無資料洩漏；文件列 API 與錯誤契約。（CSV01、CSV02、CSV06）
- [x] 2.2 補快照、持久化與非干擾整合驗證，完成條件：測試換場前後不拼接、冪等重送與被拒請求不重複輸出、重啟同資料檔案內容一致、離線送出者仍保留暱稱；下載前後提交／答案／排名／時間／高水位／Google 匯出管理資料不變，Sheets 待確認或隔離不阻擋 CSV 且無外部 API 呼叫。（CSV02、CSV03、CSV04、CSV07）

## 3. 分頁下載與老師介面

- [x] 3.1 在 TabSession 增加授權檔案請求及失效處理，完成條件：測試確認沿用正式標頭、不把憑證放 URL、JSON 錯誤不下載、錯誤使用繁體中文、網路恢復可重試、取消不破壞原身分，既有 JSON request／重連行為不退步；記錄下載介面契約。（CSV06、CSV08）
- [x] 3.2 將獨立 CSV 區塊置於匯入 Guided Notes 下方，完成條件：Chrome 實際下載檔驗證位置、固定八欄、全部組別、單題／題組、成功是／否、BOM、多行與中文；未結束禁用、學生無入口、未連結 Google 仍可下載，零提交有表頭；故障與延遲回覆測試涵蓋重試、登出／換場取消及 object URL 釋放，操作指南同步更新。（CSV01、CSV02、CSV03、CSV04、CSV05、CSV08）

## 4. 跨功能驗收

- [x] 4.1 完成新增能力與既有系統回歸，完成條件：型別檢查、建置、CSV 單元／HTTP／Chrome 測試與受影響的身分、老師／學生／結果、Sheets 匯入匯出測試通過；交付紀錄逐一對應 CSV01～CSV08 及16個情境、記錄實際 Excel 開啟是否驗證及其限制，Strict Validate 通過，確認原 requirements、基準 Change 任務與13.3缺失未改；不以本 Change 通過宣告原固定效能完成。（CSV01～CSV08）

## Workflow follow-up

- Propose 已完成；使用者於2026-11-27明確啟動 Apply，本 Change 七項任務已依完成條件與最新 CLI 來源位置逐項核對、測試並勾選。
- 保留 build-local-classroom-response-system 的84／85與13.3未完成；本 Change 不自動同步或封存任何規格。
- 本 Change 完成實作及審查後，再依使用者指示處理 commit／push、Verify 或 Archive，不因既有 GitHub 遠端自動發布未實作提案。
