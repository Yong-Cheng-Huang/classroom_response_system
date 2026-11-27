# Design

## Context

需求與退出範圍見proposal.md。現行ImportGuidedNotes包含mode／selected／publicConfigured狀態、匯入選單與GET imports/options請求；匯入body帶accessMode。ImportService同時持有服務帳戶與PublicSheetsReader，begin拒絕未指定方式；index及config仍配置公開API key。SheetsConnection缺配置提示仍說公開匯入可用。

服務帳戶JSON、Email狀態、JWT及Sheets gateway、私有文件匯入、三模式寫回均已完成驗證；目前基準為165單元／整合、24Chrome、1啟動。本輪只收斂匯入入口，不改憑證格式、Google權限、來源snapshot或匯出恢復JSON。

## Goals / Non-Goals

**Goals:** 一個固定服務帳戶流程、老師直接填網址／組數；後端預設與前端一致，無公開fallback，既有明確SERVICE_ACCOUNT請求相容。

**Non-Goals:** 不新增Cloud設定、OAuth、替代身分、上傳憑證、匿名寫回、資料庫migration或改變D31／D41；不清現有活動、Google檔案、憑證或歷史證據。

## Decisions

### 1. 前端固定流程

刪除mode選單、手動選擇鎖定狀態、publicConfigured查詢及公開設定提示。沿用main提供的serviceAccountReady與SheetsConnection的Email／配置狀態；blocked仍依RUNNING或服務帳戶未配置判斷。檢查失敗不提示選另一種方式，僅說明服務帳戶／共用權限。

老師仍填網址與2～20組數；gid、多工作表選表、完整題數／欄位預覽、取消、待開始／已結束替換確認保持。有候選仍鎖網址與組數，取消後重填；「選工作表」是文件定位，不能誤刪成匯入方式選擇。

### 2. 伺服器預設及相容性

POST /api/imports/inspect：省略accessMode等同SERVICE_ACCOUNT，舊版明確SERVICE_ACCOUNT也接受；PUBLIC／OAUTH／null／其他值拒絕，以安全繁體中文提示只支援服務帳戶並重新整理，不能再要求選公開模式。前端新請求只送url／groupCount／必要abandonmentToken。

以現有Sheets gateway作唯一readSource，刪除ImportService的publicReader參數與分支。意圖保留固定服務帳戶帳戶識別、原老師、期限、活動版本與確認；外部I/O前後與提交時全部檢查保持。沒有新增第二條服務路徑或自動憑證探測。

GET /api/imports/options保留老師限定相容查詢，僅回serviceAccountConfigured，移除publicConfigured；新介面不再依賴此路由，GET /api/sheets/status維持目前契約。select／commit仍不接受方式欄位。本輪不改寫回API的明確SERVICE_ACCOUNT要求，避免擴大相容性範圍。

### 3. 配置與資料保護

移除index中的公開reader接線、readConfig產品公開key設定與.env.example的公開匯入配置。實際.env、API key與舊OAuth／服務帳戶檔不刪除；僅有key而無服務帳戶時不能匯入，既有活動、作答、結果與CSV仍可用。

開發用公開權限診斷如需舊reader，放於明確的測試／探針範圍，以獨立環境變數讀取，不接產品ImportService或公開HTTP入口、不在老師頁面顯示。舊公開probe應標記歷史／退役或調整為唯一服務帳戶驗證，不讓移除產品config造成工具假裝通過；歷史JSON與失敗數據保留。

無schema或snapshot變更；以前公開匯入的現有活動可依原服務帳戶權限寫回，不要求重新匯入。記憶體未提交意圖升級重啟後依原規則失效；舊PUBLIC要求拒絕，不能被省略值的相容行為掩蓋。既有未知匯出、legacy核對確認及未核實隔離均不改。

### 4. 驗收與避免不必要外部寫入

HTTP／服務整合驗證省略方式及明確SERVICE_ACCOUNT一致、已退出／非法方式拒絕、缺配置／無權不fallback、token不跨老師、期限／開始／版本競爭、末題格式錯誤及原子替換、單題／混合題組與原答案不傳學生。Chrome檢查只有網址／組數、無方式選單或公開提示，仍可多表選擇／取消／確認與學生作答→結果→CSV。

既有公開正向匯入案例改成服務帳戶資料保護案例或PUBLIC退出測試，不只刪測試。全面回歸服務帳戶設定、三模式／D31、legacy未知操作、師生、搶答、結果、CSV、重啟與建置清理；數量可因用例替代改變，須記錄對照。

真實驗證沿用已授權的私有檢視者副本及單題／題組來源，在隔離SQLite，以省略方式完成完整預覽／本機確認，證明不需公開key或模式選擇；只GET，不寫Google、改分享或重跑已完成的真實12批寫回。現有寫回演算法未改，依受影響自動化回歸驗證；不把以前證據說成此次重新寫入。

## Risks / Trade-offs

- [只留一種方式導致缺配置不能匯入] → 清楚提供服務帳戶設定及共用Email；結果／CSV不受影響，不保留隱藏公開備援。
- [舊PUBLIC客戶端] → 明確拒絕並提示重新整理；舊SERVICE_ACCOUNT相容，只有匯入省略方式合法，匯出契約不變。
- [主規格仍未同步] → 本輪基於已完成服務帳戶Change，未來同步依公開匯入→替代OAuth→本Change順序；CLI可能提示GI09／PS04等尚未存在於主規格，不可直接歸檔。
- [刪選單誤刪多表選擇或確認] → Chrome及HTTP保留gid／多表、預覽／取消與原子替換斷言。

## Migration Plan

1. 本輪僅Propose；使用者另行啟動Apply後才改應用程式。
2. 在獨立分支更新固定後端契約、移除公開接線，再簡化老師介面及設定文件；不讀出或修改憑證內容。
3. 完成受影響與全套自動化、真實唯讀服務帳戶匯入驗證，記錄原始需求／歷史證據保持；成功後才合併並正常重啟，核對現有資料。
4. 無migration，可保留資料回退程式；實際key／服務帳戶JSON未刪除。後續同步／歸檔依三個Change的前置順序另行處理。
