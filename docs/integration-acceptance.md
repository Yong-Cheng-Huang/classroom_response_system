# 第 13 階段整合驗收報告

Change：`build-local-classroom-response-system`。目前 **85／85，依D41完成紀錄型驗收**。使用者於2026-11-27明確同意「既有量測、功能測試及缺失紀錄齊備即完成」，原1秒／5秒與完整60輪改列後續改善目標，**原效能目標仍未全面達標**；本Change已同步主規格並歸檔，沒有執行獨立Verify。

## 需求與決策保留

原始 `docs/requirements.md` 逐字保留，SHA-256：`498bc69163997b0570963f4712d7196edd1f9e39590ec05d51e884aaa4e2f413`。[追蹤表](integration-traceability.md)及[完整 JSON](evidence/integration-traceability.json)核對 L4～L188 的 152 列內容，對應 78 項需求、122 個情境、D01～D41，未對應原文為零。每個情境列出 Given／When／Then、實際測試或階段證據；索引存在不代表所有時限已通過。

D39：真正 Chrome 凍結／丟棄及 macOS 休眠另列暫停，一般背景維持同步與計時 1 秒、有效分頁恢復 5 秒。恢復仍依原分頁證明、固定 12 小時、撤銷及活動規則，不新增寬限，不復活失效身分，不刪失敗樣本。D40 進一步確認首次正確 DOM 測點與 WS 時刻另列，已授權修訂 proposal、design、RR08、13.1／13.3 及量測設定版本 3。其他受保護規格與套件鎖定檔未改，見 [雜湊核對](evidence/integration-protected-files.json)。U03 仍僅維持未核實範圍隔離。

## 13.1 追蹤稽核：完成

原文、規格、決策與功能證據逐條建立關聯。G1 原生副本／交接及歷史 NOT_PROVEN 並列；G2 本階段重跑五案，依 D38 通過，不宣稱能精確推導所有歷史寬限截止前後。RR02／RR05／RR07／RR08／PS08 的完整整合或補充環境缺口另外明列，未以早期回歸取代。

## 13.2 同一 Chrome 42 分頁完整流程：完成

[acceptance-42.json](evidence/acceptance-42.json)記錄真實 Google 題組匯入，20 組各 2 人、同名成員、40 筆同題表單競爭產生 20 成功／20 拒絕、唯一名次 1～20、第二老師結束及 40 學生結果，三模式依序完成，原表題組附註 9 點。使用隔離 SQLite、授權的臨時加密副本與探針新建的私有 Sheets；原範本與使用者來源副本沒有作測試寫入。

環境 Apple M2、8 GiB、macOS 27.2.1；同一原生有視窗設定檔恰 2 老師＋40 學生。使用官方 Stable 安裝程式實際提供的零售 Chrome **158.0.8127.89**，簽章與安裝程式雜湊見 [環境證據](evidence/chrome-retail-environment.json)。未覆寫使用者原 Chrome。[Google 發布紀錄](https://versionhistory.googleapis.com/v1/chrome/platforms/mac/channels/stable/versions/all/releases?filter=endtime=none)有不同分批群組，不將數字最大的試放版本冒稱已安裝版本。

前期載入、輸入、連線池屏障、舊匯出狀態斷言及清理失敗全部保留。成功輪最後清理 ENOTEMPTY 導致原 CLI exit 1；功能通過與清理更正分列於 [cleanup 證據](evidence/acceptance-42-cleanup.json)，不能聲稱原命令 exit 0。Playwright／測試版先前試跑不冒充本輪原生零售版證據。

## 13.3 紀錄型驗收：依D41完成；原效能目標未全面達標

設定仍為 F1～F3 各 20 輪、42 分頁、20 組及全部固定批次，沒有放寬 1／5 秒或以資料量當產品上限。[量測方法](performance-measurement.md)及 [最新程序摘要](evidence/performance-acceptance.json)說明時間軸、誤差及保存方式；全部歷史嘗試在 `docs/evidence/performance/`，不能合併不同版本的單輪成功充作同版完整 60 輪。

F3 單輪開始預檢曾取得 42 筆有效樣本，最壞上界約 578ms，僅為工具預檢。固定程序另有重整約 10.6 秒、WS 關聯呈現逾 1 秒、計時 DOM 約 1.096 秒及觀測／啟動前置失敗，均保留。採計時脈衝的試跑曾完整通過一輪 F1，計時差最壞約 332ms、恢復約 2.64 秒。D40 正式程序 `2026-11-26T17-54-50-059Z` 也通過一輪 F1，第二輪停於重整；未執行完整 F2／F3。

### T_apply 觀測界線

受控真 Chrome 測試重現：HTTP 完整讀模已在 React DOM 正確呈現時，WS 快照可能尚未到達。原觀測器只保存與 WS 快照相符的 React commit，會漏掉較早的 HTTP 呈現。因此，歷史數據能證明 WS 關聯套用較晚，**不能單獨證明每一筆實際畫面較晚**；先前過於確定的歸因已更正，數據不改寫，見 [更正紀錄](evidence/performance-measurement-errata.json)。

新增獨立 DOM 時間線、HTTP／WS 收送與 React 時刻；使用者已明確確認 D40：T_apply 採實際正確 DOM 首次呈現，另列 WS revision／到達／套用時間；同步與計時 1 秒不變，5 秒恢復仍須授權 WS 快照、正確角色／組別／成員／提交／畫面及計時皆恢復。已同步正式 artifact 與工具，歷史資料保留；此為D40當時的完成標準；現依使用者確認D41改採紀錄型驗收，完整60輪保留為後續目標。

### 逐頁恢復測點與未達標

舊程序將「全部重整與校準後」的計時核對時間與每頁 WS 套用時間取最大值，會把全體等待算進較早已恢復的分頁。已改為使用逐頁 React commit 保存的計時值及觀測區間，對齊伺服器基準核對當時的誤差；另保留較晚全體計時檢查，不以它延後 T_restored。新增回歸確保後續核對不能延後個別時刻，也不掩蓋真超時／錯誤計時。

| 程序 | 結果與判讀 |
|---|---|
| D40 正式程序 17:54 | F1 第一輪完成；第二輪重整的舊測點報 40 筆超時，不能全當真實逐頁超時。最慢實際 WS／DOM 仍約 5594ms；首頁 requestStart 約 5199ms。 |
| 修正測點後 18:12 分段診斷 | F1 重整仍 9 頁超過 5 秒，最壞上界 **5268.13ms**；不是完整 60 輪。 |
| 18:14 首頁快取比較 | 入組已有 105 筆同步超過 1 秒，最壞 **1937.52ms**，未走到重整，不能判定快取改善或造成該結果；試驗性產品修改已撤回。 |

見[診斷界線](evidence/performance-diagnosis.json)、[全部嘗試](evidence/performance-attempts.json)與[測點更正](evidence/performance-measurement-errata.json)。根因尚未定位，首頁 I/O、Node 事件迴圈／持久化負載與 Chrome 導覽排隊仍是待驗假說。普通背景前置已成立，沒有證據可把這些超時歸類為 D39 暫停。**13.3依D41完成紀錄型驗收；上述原效能缺失與未執行輪次仍保留。**

### 已修正並有回歸的路徑

| 路徑 | 修正與證據 |
|---|---|
| 整場讀模 | F3 SELECT 67→8，保留完整題目、欄位、答案及排序；固定查詢數與內容測試。 |
| 推送批次 | 7 通道讀模與 presence callback 各 7→1，仍逐通道驗權限 7 次，下一批不保留模型快取。 |
| 突發回覆 | 靜態／唯讀回覆不重掃全通道；突發寫入於 25ms 合併，100ms 授權檢查保持。 |
| 靜態快取 | 僅公開雜湊 JS／CSS immutable；首頁、API、錯誤仍 no-store。 |
| raw upgrade | 真 HTTP 子程序重現 ECONNRESET 崩潰，修正後健康檢查仍可用，不放寬授權。 |
| 握手 | 原 1.5 秒 watchdog 會取消排隊 1.8 秒但有效的票證，改 3 秒後回歸通過，恢復門檻仍 5 秒。 |
| 身分續接 | initialize 完成才申請第一條正確角色通道，學生重整不先開大廳再取消。 |
| 輪詢 | 健康 WS 不重複讀畫面；斷線或身分待恢復仍輪詢，且不重疊輪詢。首次調整漏掉 HTTP 單獨失敗，兩個既有重試案例揭露後修正；失敗與修正證據保留。 |
| 計時 | 每 500ms 於有效活動通道送輕量脈衝，不增 revision；沿用 RTT／單調時鐘錨點，喚醒 DOM 訂閱，不以傳輸延遲重設錨點；到期停止。受控停止頁面 interval 的 Chrome 故障測試通過。 |

計時器故障注入不是正式效能環境。所有正式程序維持 Chrome 背景／省電設定。觀測到較高 swap 使用量但未證明其為根因，見 [環境觀測](evidence/performance-memory-observation.json)。

### D39 與背景前置

[受控凍結證據](evidence/paused-browser.json)另列真 Chrome 凍結／解除、正確結果及固定 12 小時不復活。未主動讓使用者 OS 休眠，未實驗真正丟棄，不把普通 timeout／hidden 直接當凍結。

早期補充三分頁案例同時回報 visible，原始失敗及診斷保留，不能當背景通過或產品恢復失敗。使用者確認 Mac 已解鎖且 Chrome 可操作後，原生三頁診斷實際為 1 visible／2 hidden，補充有視窗恢復案例通過：[結果](evidence/recovery-headed-d40.json)、[日誌](evidence/integration-logs/recovery-headed-d40.log)。正常恢復約 865ms，網路恢復後結束快照約 118ms，背景 7.5 秒；不代表完整 42 分頁／60 輪通過。環境改變前後有差異，不推定鎖定為唯一原因。先前整套有視窗測試的背景前置失敗紀錄仍保留；補充通過不改寫該套命令的 exit code。結果 JSON 的歷史 `OS` 欄是 Darwin kernel 27.2.0，正式環境另以 sw_vers 記 macOS 27.2.1。

## 13.4 中斷整合：完成

新增 10 個真 SIGKILL 案例：四階段 HTTP 程序，以及匯出 PREPARING、送出前、外部完成本機未確認、已完成、放棄換場 COMMIT 前／後；核對提交、名次、原時間、固定期限、序號及完整舊場／新場。另覆核題組 COMMIT 前後、30 秒／12 小時、密碼變更、撤銷及舊活動與 G2。見 [故障證據](evidence/integration-faults.json)。

跨 60 秒停機使用可控伺服器時鐘，不冒稱牆鐘停機 60 秒；匯出故障子程序用隔離持久 JSON 模擬外部提交，不冒稱真 Google 程序 SIGKILL。真 Sheets 批次／回覆遺失的第 12 階段證據與本次真 42 分頁流程分開記錄。

## 13.5 跨功能權限：完成

15 個老師入口 × 匿名／學生偽造／錯分頁第二證明，共 45 次拒絕；使用有效匯入意圖及匯出操作，活動、答案、名次、Google 與管理資訊不變，無外部寫入。再驗他組、舊場、query、白名單 DTO／日誌、固定期限、原生副本、世代交接及重連。未以按鈕 disabled 代替伺服器權限；學生不取得 Google token、內部計畫或他組未成功答案。新增計時脈衝到期停止測試亦通過。

## 13.6 操作交付與目前檢查：完成（保留效能缺失）

[本機操作指南](local-operation-guide.md)涵蓋啟動、密碼、Google、備份／回復、原身分重連、三模式匯出、未知結果與 D31 暫停外部編輯前提。沒有新增套件、schema 或 migration。最新單元／整合 **149 項通過**；本次完整零售版 headless Chrome **18 項通過**，正式啟動 **1 項通過**，型別、建置與 Strict Validate 通過，見[交付彙整](evidence/integration-verification.json)及實際日誌；失敗嘗試與有視窗補充結果分列。

```sh
npm run typecheck
npm test
npm run test:browser
npm run test:startup
npm run audit:traceability
```

`probe:acceptance42` 會建立私有 Sheets 並實際寫入，不是唯讀檢查。`probe:performance` 未設定診斷旗標才是完整固定程序；`CRS_PERF_DIAGNOSTIC=join`／`submit`／`reload` 僅分段診斷，不能勾完整驗收。`probe:performance-preflight` 只是 F3 工具預檢。所有測試使用自己的資料庫與 Chrome 設定檔。

已正常重啟本機服務，先前十個業務資料表內容雜湊前後相同，包含活動、題目、答案、名次、Google 連結及匯出管理，序號未倒退；[保存證據](evidence/integration-production-preservation.json)記錄該次重啟。續作後又正常重啟並核對十個業務表內容相同、序號不倒退，含目前保留的續接／輪詢／計時修正，見[最新重啟保存](evidence/integration-production-current.json)。本次最後僅修正測試工具與文件，首頁快取試驗已撤回；目前 3000 健康檢查 schema 3 可用。

## 後續改善與已知限制（D41非歸檔阻擋）

| 項目 | 狀態與下一步 |
|---|---|
| D40 已確認 | 首次正確DOM與WS時間線分列；原門檻為後續目標，完整程序未通過。 |
| 13.3 固定時限 | 同版60輪尚未完成，依D41改列後續改善；現階段核對既有數據、失敗與未執行輪次，沒有補算通過。 |
| 有視窗補充前置 | 解鎖確認後實際 hidden 前置成立，個別恢復補充通過；不能取代 42 分頁效能驗收。 |
| 真正丟棄／OS 休眠 | 未主動實驗，依 D39 分列，不宣稱已通過。 |
| U03 | 解除未核實範圍政策仍未確認，既有隔離繼續有效。 |

最新任務、測試、原需求與檔案雜湊見 [交付彙整](evidence/integration-verification.json)。原始需求與原始樣本完整保留；D41為使用者明確確認的驗收放寬，不刪功能、不改技術堆疊。

## D41 完成紀錄（2026-11-27）

[決策與核對清單](evidence/performance-acceptance-policy.json)記錄8類完成條件與18次歷史程序。既有功能回歸為157項單元／整合、22項Chrome與1項啟動通過（見CSV交付日誌），真Google42頁功能流程通過及原清理exit 1界線保持。此次沒有重跑或重分類舊效能樣本，沒有改寫1.94秒、5.27秒等原數據。

D41只取消數值與完整60輪作為本版結案阻擋；身分隔離、期限、恢復裁定、每組每題一次、交易原子性、學生資料可見性與持久化契約仍須成立。完整原目標驗證、效能瓶頸定位、真正丟棄與OS休眠列為後續改善，不以任務勾選冒稱已實驗。

## 歸檔與驗證

原系統Change已歸檔至 [提案](../openspec/changes/archive/2026-11-27-build-local-classroom-response-system/proposal.md)；14份規劃檔與metadata完整保留。10份主規格已同步，連同既有CSV共11份規格通過Strict Validate；歸檔後追蹤稽核仍可執行，152列原文／78需求／122情境／41決策未遺漏。見 [歸檔驗證](evidence/d41-logs/archive-validation.json)與 [稽核日誌](evidence/d41-logs/traceability.log)。此次未重跑應用程式或效能測試，原始數據、測試及資料庫schema均未改；僅維護稽核工具使其可讀歸檔設計。
