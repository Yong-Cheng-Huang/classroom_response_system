# Google 授權整合進度

日期：2026-11-26（Asia/Taipei）。Change：`build-local-classroom-response-system`。

後續結果：操作者已設定老師密碼並完成真實 Google 授權，6.1／6.2 已完成；隨後完成 6.3～6.8 與單題副本實際匯入，累計 38／85。完整操作及證據見 `docs/guided-notes-import.md`、`docs/evidence/google-live-authorization.json`。下文保留授權前階段的歷史記錄，不代表目前仍卡在設定或尚未實作匯入。

## 目前狀態

6.1、6.2 的程式及自動測試已建立，但**尚未取得使用者的真實 Google 授權**，兩項保持未勾選，累計仍為 30／85。正式匯入 6.3～6.8 尚未實作，沒有把模擬資料當成真實整合通過。原始需求及正式規格未修改，U01／U02／U03 仍保留。

使用者提供的 OAuth JSON 是 web client，必要欄位完整，包含固定回呼 `http://127.0.0.1:3000/api/google/callback`，檔案權限已為 600。檢查未輸出 client secret。兩份副本識別存於忽略版控的 `data/google-test-copies.json`，待授權後讀取確認範本結構與權限，尚未寫入任何外部儲存格。一般網頁工具未能讀取兩份文件，不能據此推論老師帳號的讀寫權限。

本機未有可用老師密碼設定，因此已用建立新檔才寫入的方式產生不含密碼的 `.env` 範本（權限 600），不覆寫既有檔案。需操作者自行填入 TEACHER_PASSWORD；不要求將密碼傳至對話，也沒有自動設定預設密碼。

## 建立及修改的程式

| 檔案 | 責任 |
|---|---|
| `src/server/google.ts` | 載入 client、官方 OAuth provider、一次性 state／PKCE、帳號驗證、共用連結、憑證更新及延遲回覆防護 |
| `src/server/google-vault.ts` | 擁有者限定目錄／檔案、AES-256-GCM 加密與原子寫入、伺服器端憑證參照 |
| `src/server/google-http.ts` | 老師限定管理端點；callback 驗 state 的明確例外；安全繁體中文回呼頁 |
| `src/server/config.ts`、`api.ts`、`app.ts`、`index.ts` | client 路徑配置、正式服務接線、依舊有身分驗證及命令排序 |
| `src/shared/errors.ts` | 安全的 Google 設定、授權、取消、重新授權及 state 錯誤 |
| `src/client/google.tsx`、`main.tsx`、`style.css` | 老師的連結狀態、另開 Google 授權頁及解除本機連結 |
| `tests/integration/google.test.ts` | 設定、state／PKCE、授權失效、權限、加密、更新與交錯測試 |
| `tests/browser/google.spec.ts` | 模擬 Google provider 的真 Chrome 畫面流程；不替代 Google 人工授權 |
| `playwright.config.ts`、`tests/smoke/startup.test.ts` | 測試明確指定隔離的 client 路徑，避免讀取操作者的真實 OAuth 檔案 |
| `package.json`、`package-lock.json`、`.env.example` | SDK 鎖定版本、HTTP 測試入口與配置文件 |

新增依賴 `google-auth-library` **11.3.4**；原 TypeScript／React／Node.js／SQLite／HTTP＋WebSocket 架構不變，其他既有直接套件版本維持。採用官方函式庫處理 code exchange、ID token 驗證及 refresh，符合 [Google Web server OAuth 建議](https://developers.google.com/identity/protocols/oauth2/web-server)。SQLite schema 維持 3、18 張表，沒有新增 migration。

## 協定與權限

- POST `/api/google/connect`：有效老師以空 JSON 物件發起，回公開授權網址；不回 client secret 或 Google token。
- GET `/api/google/status`：有效老師取得 configured、state、account，不回憑證參照、scope 暫存或 token。
- DELETE `/api/google/connection`：有效老師以空 JSON 物件解除本機連結，不改活動與結果。
- GET `/api/google/callback`：以一次性 state 驗證老師授權意圖，不要求瀏覽器共用角色 cookie；其他管理入口仍須雙憑證、世代、當前文件與期限驗證。

state 使用 256-bit 隨機值，伺服器只以 SHA-256 作索引，綁定老師 session、當前 Google 連結參照、程序世代及最長十分鐘且不超過老師固定期限的有效時間。搭配 PKCE S256。callback claim 即消費 state，換 code 的網路工作在共同命令佇列之外；回來後再進短命令重驗老師、期限、密碼版本及連結版本。老師登出、密碼變更、解除／另一授權完成後，舊回覆不得復活或覆蓋連結。未完成意圖不跨程序重啟恢復，需重新發起授權；已完成共用連結則由持久化資料恢復。

要求 Sheets 讀寫、openid、email；後兩者供識別連結帳號，不請求 profile。Google ID token 交由 SDK 驗證 issuer／audience／簽章與期限。只有老師狀態畫面顯示帳號。必要 Sheets 範圍或 refresh token 未取得時不替換舊連結，不假稱跨重啟授權已成立。

授權連結使用另開分頁、noopener／noreferrer，原老師頁不離開本機來源，保留 G1 第二憑證。原頁以受保護端點讀連結狀態，不以 popup 傳回的角色或 cookie 當作老師證明。

callback 不反射 code、state、error_description 或其他 query，錯誤只用白名單中文訊息；使用 no-referrer、no-store 與限制內容安全政策，日誌只記操作識別／安全代碼。可選 issuer 參數若存在，須為 Google 的 HTTPS issuer。

## 憑證保存與解除

SQLite google_connection 只保留帳號、scope、隨機檔案參照與 CONNECTED／REAUTHORIZE。Google access／refresh token 在 `APP_DATA_DIR/google-credentials/` 加密保存；目錄 700、檔案及金鑰 600，使用隨機 nonce、GCM 驗證標記、暫存檔 fsync／rename。金鑰由本機檔案權限保護，沒有宣稱使用 macOS Keychain 或可抵禦本機帳號被接管。

更新憑證合併並行請求，保存前確認原連結未被替換／解除；解除期間的晚到更新不會重新建立連結。Google 明確 invalid_grant 改為 REAUTHORIZE；一般網路失敗保留原連結，活動均不清除。受保護呼叫在更新完成後仍重新驗老師。

「解除本機連結」清除本機引用及憑證，停止後續取得 token；不宣稱已撤銷 Google 帳號端對該應用的全部權限，也不虛稱已取消先前送出的外部請求。完整 Sheets 請求入口仍須在第 6／12 群組接入時驗證連結與老師資格。

SQLite 備份本身不包含上述金鑰及加密檔；若另行回復資料而未保留相符憑證，需重新授權，本機活動仍保留。不可把金鑰或 client JSON 放入前端、版控或一般錯誤回應。

## 驗證與未完成項

- 型別與建置通過。
- 單元／整合測試共 78 項，全部通過；新增 Google 測試十項。
- Chrome 測試共三項，全部通過；新增畫面測試使用測試 provider，驗另開頁不丟老師身分、兩老師共用、分頁登出不解除及明確解除。
- 建置版啟動／正常重啟測試通過。
- OpenSpec Strict Validate 通過，CLI 進度確認 30／85、剩餘 55；去除設定與憑證內容的驗證摘要及實作雜湊見 [授權前驗證紀錄](evidence/google-preauthorization-verification.json)。
- 測試涵蓋 state 重送／過期／偽造、PKCE、密碼版本、登出及晚到回覆、缺必要範圍／refresh token、學生與匿名拒絕、共用／重建服務、加密檔／DB 無明文 token、並行 refresh、解除交錯、invalid_grant、一般網路錯誤、憑證損壞及 callback 注入。
- `test-results/google-connected.png` 為合成帳號的畫面截圖，已目視檢查；不是使用者真實 Google 帳號的授權證據。

真實 Google 授權、真正服務程序重啟後存取兩份副本，以及副本結構與權限尚未驗證。6.1／6.2 保持未完成；6.3～6.8 尚未開始。完整全入口授權 4.6 仍待後續訂閱及管理入口整合。

## 接續操作

1. 操作者在 `.env` 自行填入 TEACHER_PASSWORD，僅回覆「已設定」，不要傳密碼。
2. 重新啟動本機服務，在固定來源登入老師。
3. 點「連結 Google」，再點「前往 Google 授權（另開分頁）」，由操作者在 Google 頁面選帳號並同意。
4. 實測 callback、兩老師共用及重啟保存，再透過授權帳號驗兩份副本；完成條件通過後才勾任務。

尚未為真實授權產生成功證據，也未要求公開文件或將私人檔案改成公開。
