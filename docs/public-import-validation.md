# 公開 Guided Notes 實作驗證

Change：`add-public-guided-notes-import`；功能分支：`codex/public-guided-notes-import`。

新增後端可選 API key、獨立只讀 reader、固定模式的匯入意圖、老師限定配置狀態及公開／OAuth 選項。原 OAuth API 請求省略模式時維持原行為；不增加套件或 migration。CSV 與三模式 Google 寫回權限保持。

## 需求及18情境對應

下列自動測試的 Google 上游為模擬；真正無 OAuth 的公開 API 結果另列，兩者不混用。

| 需求 | 情境 | 自動驗證來源／真實驗證缺口 |
|---|---|---|
| GI01 | 組數邊界 | `tests/integration/public-imports.test.ts`：2／20成功，1／21／非整數／缺值拒絕 |
| GI01 | 文件不可讀 | 同上：URL、外部拒絕、舊活動與學生保持；`tests/unit/public-sheets.test.ts`：404／逾時／JSON |
| GI01 | 公開模式免Google登入 | 同上與 `tests/browser/public-import.spec.ts`：空連結／null provider；真實API見下節 |
| GI01 | 保留原授權匯入 | `tests/integration/imports.test.ts` 與原 `tests/browser/teacher.spec.ts`：省略模式、選表、確認、替換 |
| GI08 | 公開唯讀學習單 | 公開整合：單題／混合題組、gid／多表、合併／格式快照；公開Chrome完整作答；真實API見下節 |
| GI08 | 私有文件或公開讀取未就緒 | reader單元：缺key、401／403／404／429、非法JSON、20秒逾時；Chrome缺配置與拒絕後保留老師 |
| GI08 | 發布網址與原表網址區分 | 公開整合：pubhtml／CSV／其他主機拒絕；UI提示原表公開，文件不承諾僅發布即可讀 |
| GI09 | 公開讀取期間解除Google連結 | 公開整合：解除後候選可提交；仍拒絕他人、到期、登出及活動開始競爭 |
| GI09 | OAuth讀取期間解除連結 | 原匯入整合：解除後GOOGLE_REAUTHORIZE，不建立半個活動 |
| GI09 | 不暗中更換讀取身分 | 公開及原匯入整合：PUBLIC失敗不呼叫OAuth、默認OAuth不回退、select／commit不得加模式、他人意圖拒絕 |
| PS04 | 首次授權與權限不足 | 原 `tests/integration/google.test.ts`／`exports.test.ts`、`tests/browser/google.spec.ts`／`exports.spec.ts` |
| PS04 | 公開匯入與私有資料隔離 | 公開真HTTP：匿名／學生／偽造角色／錯分頁／到期拒絕；來源答案及key不出現在學生view |
| PS04 | 公開可編輯不代表可匿名寫回 | 公開Chrome：本機提交與CSV成功，無OAuth的Sheets寫回401；原三模式與D31回歸；不測試匿名寫入Google |
| PS05 | 共用與解除 | 原Google／Chrome共用連結測試、公開整合OAuth解除不影響PUBLIC |
| PS05 | 解除OAuth後公開讀取仍可用 | 公開整合：null provider且空連結成功，解除中仍可完成；舊OAuth拒絕不轉PUBLIC |
| PS06 | 憑證撤銷或過期 | 原Google／匯入／寫回整合及原Chrome；失效不清本機結果 |
| PS06 | 公開金鑰不洩漏 | reader單元固定主機、header、不送OAuth、redirect:error；真HTTP options僅布林，canary不出現在錯誤／日誌／學生view |
| PS06 | 公開讀取錯誤與OAuth狀態獨立 | 原匯入新增測試：PUBLIC_KEY_INVALID不撤銷有效OAuth，明確重新OAuth才呼叫原reader |

## 真實API狀態

第一次執行已配置 API key，但 Google 回覆 HTTP 400／`API_KEY_INVALID`，未取得來源資料；空 Google 連結、OAuth provider=null，外部寫入零次。保留 `docs/evidence/public-import-live-attempt-1.json` 與安全執行紀錄。這是配置失敗證據，不是功能成功證據。

修正金鑰後，已完成真正無OAuth的單題與題組驗證，任務4.2可依完成證據勾選；來源原表及分享均未修改。

第2～6次探針執行亦保留未通過紀錄：既有xlsx擷取快照以`1.0`表示API顯示的`1`；Google合併範圍含sheetId且順序不具語意；另補齊探針HTTP應用的readModel。這些修正均限驗證工具，不修改產品解析器或來源。最終比對仍完整檢查題型、每欄標記／題目／答案位置、所有合併座標，並將SQLite儲存的完整工作表及試算表格式與實際API回傳逐項比對。

最終第7次實測通過：`docs/evidence/public-import-live.json`。隔離SQLite、OAuth provider=null、空Google連結，F1為6題／6欄／21個合併範圍，F2為4題／6欄／13個合併範圍。兩者皆經正式HTTP確認匯入、本機學生提交、結束、含BOM及真作答的CSV下載，以及無OAuth的Sheets寫回401拒絕。對外僅4次GET，零寫入；輸出快照雜湊而不公開來源答案或金鑰。

## 原功能及文件保護

原始 `docs/requirements.md` 的SHA256維持 `498bc69163997b0570963f4712d7196edd1f9e39590ec05d51e884aaa4e2f413`。本 Change 不直接更改11份主規格或兩個歸檔 Change；D41紀錄型效能政策及原失敗資料保持。真實OAuth寫回的歷史證據不被冒稱本次重新實測；本次回歸採隔離Google傳輸與原Chrome流程，不向原始範本寫入。

## 自動化回歸結果

- `npm run typecheck`、`npm run build`：通過。
- `npm test`：166／166；含既有OAuth、三模式寫回／D31／故障保護、身分與排名、結果及CSV。
- 原生 Google Chrome 透過 Playwright 全套：24／24，包含新增2項公開模式流程。使用隔離Chrome程序與測試資料，非效能目標驗收。
- `npm run test:startup`：1／1；建置版跨工作目錄啟動及同檔重啟保存。
- `npm run audit:traceability`：78需求／122情境／41決策，152項原文無未對應；此為原始歸檔基準，新增18情境另見上表。
- OpenSpec Strict Validate及`git diff --check`：通過。
- 本機設定的實際key未出現在`dist/client`。`.env`與OAuth JSON仍由Git忽略。

完整執行紀錄：`docs/evidence/public-import-logs/`。新增Chrome摘要：`docs/evidence/public-import-browser.json`；畫面：`docs/evidence/public-import-ui.png`。上述Google傳輸模擬測試不代替真實公開API驗證。
