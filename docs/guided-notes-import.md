> 現行版本只提供服務帳戶匯入，直接填網址與組數，不提供公開方式或個人Google授權。請依 [服務帳戶設定指南](google-service-account-setup.md) 操作；下列舊模式敘述及驗收數據保留作歷史紀錄。

> 新版已依使用者確認改用公開讀取／服務帳戶，個人OAuth功能退出。請先依[服務帳戶設定指南](google-service-account-setup.md)操作；本文OAuth相關操作與舊測試數據保留為歷史紀錄，不代表新版仍提供OAuth。

# Google 授權與 Guided Notes 匯入完成紀錄

日期：2026-11-26（Asia/Taipei）。Change：`build-local-classroom-response-system`。

## 本階段結果

完成 6.1～6.8，累計 38／85、剩餘 47。Google 真實授權由操作者自行完成，已驗正常程序重啟後保留老師登入與共用連結、重新解密後讀取兩份副本。正式老師頁已實際預覽單題及題組、取消兩次預覽，最後由 EMPTY 匯入單題副本：6 題、6 作答欄位、2 組、READY、零提交，沒有執行 Sheets 寫入。

2 組是本次實際匯入驗證配置，並非產品固定組數；老師仍可設定 2～20 組。沒有自行開始活動。4.6、第 7～13 群組及 U01／U02／U03／G2 保持原狀；本階段不宣稱搶答、即時同步、匯出或完整系統驗收已完成。

## 檔案

| 檔案 | 本階段責任 |
|---|---|
| `src/server/guided-notes.ts` | Google URL／gid、單題／題組／混合解析、原始內容與排版基準 |
| `src/server/imports.ts` | 老師綁定的預覽、選表、確認、期限、Google／活動版本與原子提交 |
| `src/server/import-http.ts` | 匯入 API；完整請求先進共同命令入口，長網路讀取移出佇列 |
| `src/server/google.ts` | 授權後的 Sheets GET、固定 Google 來源、角色／連結重驗及錯誤分類 |
| `src/server/api.ts`、`app.ts`、`index.ts` | 正式服務接線，沒有任意上傳候選／測試角色的公開捷徑 |
| `src/shared/imports.ts`、`errors.ts` | 安全 DTO 與繁體中文錯誤 |
| `src/client/imports.tsx`、`google.tsx`、`main.tsx`、`style.css` | 網址、組數、選表、完整預覽、確認清除提示、取消及成功後更新 |
| `src/client/env.d.ts` | Vite 型別；main 的 hot dispose 清理 React root，避免開發熱更新重複建立 root |
| `tests/helpers/sheets.ts`、`tests/unit/guided-notes.test.ts` | 範本轉換、F1／F2／F3、位置、錯誤及原始格式測試 |
| `tests/integration/imports.test.ts`、`google.test.ts` | 原子性、權限、版本、外部錯誤、舊答案私密性、命令不阻塞 |
| `tests/browser/google.spec.ts` | 同 Chrome 的授權／選表／取消／錯誤／確認換場／學生重新選組流程 |

沿用前一階段的 Google 授權檔案及 google-auth-library 11.3.4，不再新增套件。SQLite schema 維持 3、18 張表，沒有新 migration。

## 解析及資料保留

接受 HTTPS docs.google.com 的 Sheets 網址，辨識 query 或 fragment gid；有效 gid 只能選指定表，無效不猜其他表。無 gid 且單表直接解析，多表列出名稱供老師選擇。組數需為 2～20 整數；不設定題目、子題或學生人數產品上限。

依第 4 列 B 題號、C:F 題目、G:H 作答表頭與合併結構辨識。第 5 列後的題號與對應合併範圍才產生題目；標題與合併空白分隔列不計入。單題必須 C:F 與 G:H 各為同列合併；題組由 B 欄垂直合併界定，每列 C:F 題目、G 標記與 H 獨立作答格皆須完整。重複題號、缺敘述／標記、答案合併不明確或最後一題失敗，整份拒絕。

實際兩份副本與固定資料均得到：

| 資料 | 搶答單位 | 答案欄位 | 定位 |
|---|---|---|---|
| 單題 | 6 | 6 | G5:H5、G7:H7、G9:H9、G11:H11、G13:H13、G15:H15 |
| 題組混合 | 4 | 6 | H5、H6、H8、H9、G11:H11、G13:H13 |
| 合成 F3 | 60 | 140 | 包含四子題，依實際列號解析，不把兩子題當上限 |

既有答案／公式／富文字只當匯出檢查基準，保存於當前活動的來源 snapshot 與欄位 original。包含 spreadsheet／sheet 識別、題號／標記／敘述、合併、來源原值、userEnteredFormat／effectiveFormat、富文字、row／column metadata 及 spreadsheet 預設格式。沒有產生標準答案或提交；學生 DTO 不包含來源原答案及原始 snapshot。全部文字以 React 文字呈現。

原始唯讀診斷快照已清理，不建立跨場原答案檔案集合；正式來源／原格式只隨當前活動資料保存並於成功替換時清除。測試副本識別及加密 Google 憑證不屬歷史作答資料。

## 原子匯入與競爭

預覽 token 為隨機 256-bit 值，僅保留在伺服器記憶體，綁定老師 session、固定期限、原 activityId／version、Google 連結世代與完整候選。預覽最多十分鐘且不超過老師 12 小時期限，重整／重啟後可重新讀取，不自動提交。其他老師不能使用該 token；選表另換 token，舊選擇不能覆蓋新候選。

讀取與解析全在活動交易外，metadata／GridData 網路等待不占搶答／開始／結束的共同命令佇列。每次網路返回後重驗老師、Google 連結與原活動版本。最後提交重新驗全部資格，再由第 5 群組的文件互斥與同交易替換執行；只有 COMMIT 成功才回覆新活動 READY。

取消預覽不建立活動，也不失效學生。READY／ENDED 已有活動時，必須閱讀清除提示並按「確認替換並匯入」；單純讀取、缺確認、格式／網路錯誤、授權失效、別的老師先開始／換場均不提前清除。新活動完整成功才撤銷舊學生、清舊場資料，保留老師、Google、設定及最少文件輸出管理資訊。

UNCONFIRMED 匯出仍經第 5 群組的明確核對／放棄確認介面處理；真正的放棄簽發、跨場未核實隔離與晚到寫入回覆整合保留給 12.10／12.11，不接受匯入本文自行宣告「已放棄」。此限制不是另訂永久禁止換場政策，也沒有自行解除 U03。

## API

| 方法／路徑 | 輸入／結果 |
|---|---|
| POST `/api/imports/inspect` | `{url,groupCount}`；回 SELECT_SHEET 選項或完整 READY 預覽 |
| POST `/api/imports/{token}/select` | `{sheetId}`；解析選定表並換新預覽 token |
| POST `/api/imports/{token}/commit` | `{confirmed}`；既有活動需 true，成功回新 activityId／READY |
| POST `/api/imports/{token}/cancel` | `{}`；取消當前預覽，原活動不變 |

四個入口都使用既有雙憑證／文件／世代驗證；不接受客戶端題目、答案、原始格式或角色宣告。學生／匿名請求拒絕。回傳預覽只有表名、題數、欄位數、組數與是否需確認，不包含 Google token 或原答案。

## 老師操作

1. 設定本機老師密碼及 OAuth JSON，執行 `npm run dev`，進入 http://127.0.0.1:3000 並登入老師。
2. 首次點「連結 Google」及「前往 Google 授權」，自行選帳號、同意後返回原頁；分頁登出不解除共用連結。
3. 在「匯入 Guided Notes」貼文件網址，填 2～20 組，點「讀取學習單」。無 gid 且多表時先選表，再點「讀取工作表」。
4. 檢查完整解析題數與欄位數；取消則原場不變。已有活動時，確認舊結果清除提醒後才能替換。
5. 成功後進入「待開始」，學生重新選組。RUNNING 時匯入入口停用，直接呼叫亦被伺服器拒絕。
6. 顯示 Google 重新授權時保留原活動，重新連結後重新讀取；若預覽過期、活動版本改變或程序重啟，重新讀取並確認當前場次。
7. 沒有讀取權限／文件不存在時檢查老師帳號及分享權限；範本錯誤時檢查第 4 列表頭、B 合併、C:F 敘述、G 子題標記與 G:H／H 作答位置。不要透過刪庫處理錯誤。

匯入全程只用 Sheets GET，未驗寫入權限，不因讀取成功就宣稱可匯出。Google 授權建立及本機保護另見 `docs/google-integration-progress.md`，外部匯出與 D31 前提仍由第 12 群組實作。

## 驗證證據

- `npm run typecheck`、前後端建置通過。
- `npm test`：90／90，包含完整格式、2／20 邊界、多表／gid、原值／格式、四子題、最後一題失敗、取消、版本競爭、角色、解除交錯、HTTP 長讀取不阻塞與原答案不洩漏。
- Chrome 三項流程通過；新增的匯入 UI 情境使用替身來源及真 SQLite／HTTP，與真 Google 證據分開記錄。
- 真 Google OAuth、兩份副本唯讀 GET、正常程序重啟見 `docs/evidence/google-live-authorization.json`。
- 真老師頁的兩份完整預覽／取消、單題實際原子匯入及 DB 數量核對見 `docs/evidence/guided-notes-live-import.json`。
- `test-results/import-ready.png` 為合成帳號／來源的畫面截圖；未將其冒充真實 Google 授權證據。
- Strict Validate 通過，CLI 確認 38／85；最終任務狀態及實作版本雜湊見 [本階段驗證摘要](evidence/guided-notes-import-verification.json)。原始 requirements SHA-256 保持 `498bc69163997b0570963f4712d7196edd1f9e39590ec05d51e884aaa4e2f413`，正式規格維持 78 項需求、119 個情境。

尚未執行 42 分頁效能、G2／U01 判準、凍結／休眠分類或三模式匯出驗收；不使用本階段測試替代那些完成條件。
