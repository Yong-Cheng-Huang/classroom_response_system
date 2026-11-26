# 下一階段：G1 分頁身分可行性驗證

日期：2026-11-26（Asia/Taipei）。Change：`build-local-classroom-response-system`。

本文件保留初輪候選尚未通過的歷史結果。使用者同意繼續驗證後的第二候選結果，見 [window.name 與伺服器交接驗證](g1-window-name-validation.md)；請以該份後續報告辨識最新 G1 狀態。

## 結果

已依「繼續下一階段」指示執行任務 1.7 的最小 Chrome 技術驗證。目前 G1 **尚未通過（NOT_PROVEN）**，1.7、4.2 保持未完成，整體仍為 15／85。

目前以 sessionStorage、Navigation API key、導覽類型、記憶體執行個體與 Web Locks 組成的交接方向，尚不能證明重連者是原分頁。測得副本在沒有執行第一次應用腳本的情況下，仍可於重新整理後同時持有複製的暫存、相同導覽 key、reload 類型及排他鎖。不得以這些訊號直接授予原身分。

這不是「所有純網頁方案都不可能」的證明；也沒有在正式系統中實際授予副本權限。測試針對候選依據的充分性，正式登入與分頁憑證模組尚未接上。

## 方法與可重現證據

```sh
nvm use
npm run probe:g1
```

- 程式：`scripts/probes/g1.ts`。原始觀測：[`evidence/g1-probe.json`](evidence/g1-probe.json)。重跑會覆寫該觀測檔，隨機識別及時間會改變。
- 使用已安裝 Google Chrome 157.0.8103.80、Node 24.22.3、darwin／arm64；原始環境欄位的 release 是 Darwin 核心版本，不是 macOS 產品版本。
- 建立臨時 Chrome 持久設定檔，所有分頁共用該設定檔；本機探針伺服器使用隨機 loopback 埠，不占用正式 3000 埠、不讀寫應用資料庫。
- 只使用明確標示為合成資料的身分、token、草稿及交接版本，沒有真實密碼或憑證。
- 臨時測試擴充功能透過 Chrome 的 `tabs.duplicate` 觸發原生複製，不是建立新頁後手動複製 storage。CDP 與擴充功能只屬測試驅動器，沒有加入產品架構，也沒有把特權 tab ID 提供給候選網頁。
- 使用 headless Chrome；實驗所需的擴充功能除錯旗標只套用於臨時測試程序，結束關閉該程序並清除設定檔。沒有修改使用者既有 Chrome 設定，也沒有進行 U02 背景／凍結／休眠驗收。
- 命令成功退出表示實驗執行完成，**不表示 G1 通過**。關卡結果明列於 JSON 的 gate 欄位，不產生自動勾選。

## 實測觀察

| 觀察 | 結果與界限 |
|---|---|
| 原頁重新整理 | sessionStorage、history.state、導覽 key 可保留，記憶體 instanceId 改變，能持有鎖。 |
| Chrome 原生複製 | sessionStorage（含合成憑證及草稿）、history.state、導覽 key 及 entry ID 被複製。當下 navigationType 為 back_forward，沒有取得原頁持有的鎖。 |
| 副本再次重新整理 | navigationType 變為 reload，仍有相同導覽 key 及複製暫存；因此不能只依 reload 字樣認定原頁。 |
| 原頁關閉後副本重整 | 副本可取得同一個 Web Lock，仍有複製的暫存及 key；鎖只能證明目前持有，不能證明分頁來源。 |
| 副本首份文件已 commit、但應用腳本尚未送達 | 探針伺服器先送出沒有腳本的部分 HTML，確認該文件尚未執行 window.g1，再關閉原頁並對副本執行 Chrome 原生 reload。副本仍有原暫存及相同 key、顯示 reload 並取得鎖。不能假設副本一定會先跑完清除程式。 |
| 每次載入產生 instanceId | 原頁重整與副本都會產生新值；單憑新 UUID 不證明是原頁繼承。 |
| window.name | 本次原頁自訂值在原頁重整後保留，原生副本則為空。這是不同於上述可複製暫存的候選線索，尚未形成完整、可驗收的交接方案。 |

不能省略最後一列而宣稱所有瀏覽器可見訊號都相同。反之，單次 window.name 差異也不足以宣稱 IA03 全部情境已解決。

## 對照 IA03

| 情境 | 本次狀態 |
|---|---|
| 同瀏覽器老師／不同組各自保留 | 尚未實作正式身分，未完成此功能驗收；第一階段三頁連線測試不算此項。 |
| 複製學生分頁不得承接 | 已驗證 Chrome 會複製候選暫存；未建立獲證交接方案，不能判通過。 |
| 原頁重整與副本同時競爭 | 已建立文件 commit 後、首次應用腳本前的確定性時序探針，顯示清除腳本與鎖不足；完整伺服器交接競爭仍待驗證。 |
| 副本先於原頁重連／重啟後先連 | 未建立正式交接／恢復協定，未通過；不得用先抵達者取得權限。 |
| 原頁關閉後副本不得接手 | 已觀察副本能取得相同候選依據；若只以此判定會有接手風險，未通過。沒有對正式系統執行權限接管。 |

## 停止依據

[設計文件](../openspec/changes/build-local-classroom-response-system/design.md) 的 G1 段落明定：「若無法取得足夠證據、無法保留原分頁或會讓副本承接，停止相關實作並回人工」。任務 1.7 亦明定失敗記錄後停止相關正式實作，4.2 須先取得 G1 證據。

[OpenSpec Apply Skill](../.agents/skills/openspec-apply-change/SKILL.md) 要求只有完整完成指定行為才勾選；遇到設計問題或需要縮減規格才能實現時，須提出並暫停。本次依既有關卡保留需求，沒有自行放寬副本隔離、強制原頁重新登入或把先拿鎖當成原頁。

CLI 的 state 仍為 ready，表示規劃與追蹤文件足以啟動 Apply，不代表 G1 已經通過；本次停止來自任務及設計中的實作前置條件。

## 建議人工決定的下一步

優先保留現有技術堆疊與 IA03 行為，另就 **window.name 作為不放入 sessionStorage 的第二份分頁憑證**進行候選驗證。這是尚未採用的方向，不能只把 window.name 當成可自行宣告的角色或分頁 ID。

進一步驗證至少需涵蓋：高熵憑證的伺服器核對及交接版本、原頁多次重整、原生副本與 opener 新頁、首份腳本未執行、重整與複製交錯、副本先恢復、原頁關閉、關閉後還原、正常服務重啟，以及偽造欄位不能撤銷原持有人。須記錄 Chrome 實機結果；關閉後還原等行為若與既有要求衝突，要先回人工釐清。不得以此預設 U01 或 U02 政策。

若此方向仍不足，再提出需要新增瀏覽器端可信元件的架構替代方案供審查；本次未決定加入產品擴充功能，也沒有修訂正式設計或規格。現在沒有足夠證據建議直接執行 4.2。

## 本次檔案與驗證

新增探針程式、本報告及原始觀測 JSON；package.json 新增 probe:g1，README 加入重現入口，tasks.md 只追加實作紀錄，不勾選未完成任務。應用程式、SQL migrations、原始需求及正式規格保持原樣。

最終檢查：TypeScript 型別檢查通過、探針完成並輸出 NOT_PROVEN、既有 23／23 單元與整合測試通過、前後端建置通過、OpenSpec strict validation 通過。CLI 回讀確認仍為 15／85，1.7 與 4.2 未勾選。原始需求、既有審查、proposal、design 及十份 spec 共 14 檔的 SHA-256 與第一階段保護基準完全相同。本報告不把探針成功執行計為新增功能任務通過。

## 技術資料來源

- 測試的 tabs.duplicate 由 [Chromium 擴充功能實作](https://chromium.googlesource.com/chromium/src/+/b254bab244c990b50c816f3e8a8ba5f038aaa9e9/chrome/browser/extensions/api/tabs/tabs_api_non_android.cc) 呼叫原生 DuplicateTabAt；本報告仍只把實際執行的 headless 操作當本次證據，不冒稱已人工操作 Chrome 選單。
- 測試擴充功能的載入方式見 [Chrome DevTools Protocol Extensions.loadUnpacked](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/#method-loadUnpacked)。這是測試控制介面，不是正式產品介面。
- [Navigation API 提案](https://github.com/WICG/navigation-api/blob/main/README.md) 說明 key／id 是瀏覽器產生的歷史項目識別，不能僅因由瀏覽器產生，就推論具有分頁不可複製性；本次原生複製觀測是判斷依據。
