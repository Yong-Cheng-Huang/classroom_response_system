# G1 第二候選驗證：分頁第二憑證與交接版本

日期：2026-11-26（Asia/Taipei）。Change：`build-local-classroom-response-system`。

## 結果

**G1 最小技術關卡通過，可以完成任務 1.7；正式身分任務 4.2 尚未實作。**

通過的是下列組合，不能簡化成「window.name 可以當分頁 ID」：

1. 32 位元組隨機第二憑證只留在 window.name，不放進會被複製的 sessionStorage。
2. 每份應用 HTML 都使用 `Cross-Origin-Opener-Policy: noopener-allow-popups`，阻止已載入的同源 opener／新頁互相取得 Window 參照。
3. 伺服器核對 session token 與第二憑證的 SHA-256，角色／組別取自伺服器資料，不相信請求宣告。
4. SQLite 交易保存交接 generation 與當前 documentInstanceId；舊世代不能執行操作或覆蓋新持有人。

Chrome 157.0.8103.80 的 headless 與有視窗模式，各執行 3 輪、每輪 13 項檢查，均為 **39／39**。兩模式合計 78 項檢查，包含 72 項候選檢查及 6 項故意移除 COOP 的負對照；負對照成功重現不安全行為才算檢查通過。這不是 78 項正式需求或 119 個情境的全系統驗收。

## 可重現方式與證據

```sh
nvm use
npm run probe:g1:window-name -- --rounds=3
npm run probe:g1:window-name -- --headed --rounds=3
```

- [Headless 原始結果](evidence/g1-window-name-headless.json)。
- [有視窗 Chrome 原始結果](evidence/g1-window-name-headed.json)。
- [完成版本與結果 SHA-256 清單](evidence/g1-window-name-manifest.json)，對照三份工具原始碼、鎖定套件及兩份最終結果。
- 驅動器：`scripts/probes/g1-window-name.ts`。
- 候選瀏覽器端：`scripts/probes/g1-candidate-client.ts`。
- 候選權威端：`scripts/probes/g1-candidate-server.ts`。

使用 Node 24.22.3、darwin／arm64，實際版本與核心版本記於 JSON。每個模式使用一個臨時 Chrome 持久設定檔，所有老師與學生頁面共用該設定檔，不使用每位學生獨立 context。沒有關閉背景計時節流或停用 back-forward cache 來取得本次結果；也沒有執行 U02 的凍結／休眠驗收。

測試擴充功能只呼叫 Chrome 的原生 tabs.duplicate 及 sessions.restore，不將其 tab ID 提供給產品候選，也沒有要求產品安裝擴充功能。沒有以新頁加手動 storage 複製冒充原生副本；有視窗模式由相同原生 API 驅動，未宣稱人工點選 Chrome 選單。

伺服器只綁臨時 loopback 埠，資料庫與設定檔均為臨時檔，結束清除。身分由測試 fixture 建立，沒有實作正式密碼登入、入組服務或正式 Google 授權。JSON 不記錄第二憑證、token 或其雜湊，只有合成身分識別、結果與狀態轉移。

## 確切候選演算法

### 瀏覽器端

首次載入先檢查 window.name 是否為本系統前綴與 64 個十六進位字元；格式不符時，先移除複製的 session token／草稿，再以 crypto.getRandomValues 產生新的 256-bit 第二憑證，寫入 window.name。這是新頁流程，不授予身分。合法格式本身也不是授權證明，仍須由伺服器核對。

只有 fixture 模擬成功登入／加入後，才把 token 與最後確認 generation 存入 sessionStorage。每次文件載入另產生只在記憶體中的 documentInstanceId。重新整理以 session token、window.name 第二憑證、預期 generation 與新的 instanceId 要求交接；不依導覽類型、最先拿鎖或最先連線判定來源。

當副本的 window.name 沒有原第二憑證，會走 DUPLICATE→NEW，清除副本自己的憑證與草稿，不向伺服器撤銷原頁。即使首次腳本尚未執行就再重整，原生副本仍沒有原第二憑證，不能藉 reload 類型與複製 token 承接。

### 伺服器端

測試 fixture 在取得合法登入／加入的前提下，建立唯一身分並綁定 token hash、第二憑證 hash、角色、組別及固定 expiresAt。這項 fixture 不代替任務 4.1／4.4 的正式流程。

交接交易先驗兩份憑證及固定期限，再核對預期 generation。新 instanceId 只有在版本吻合時，才以同一 SQLite 交易增加 generation 並替換當前執行個體；同一當前 instanceId 的原交接重試不重複增加版本。版本落後的舊文件不得覆寫新文件。

若交接已落盤但回覆無法解析，原頁仍持有兩份憑證，可先取得權威版本，再以 CAS 重試交接。取得版本也須驗兩份憑證。實際操作除驗憑證外，還必須吻合當前 generation 及 instanceId；不能只驗 token。

### 原型 HTTP 契約

| 路徑 | 權威端規則 |
|---|---|
| POST /resume | 驗兩份憑證、期限、交接版本；同交易保存新世代／執行個體；失敗不撤銷原頁。 |
| POST /status | 僅雙憑證有效者取得交接版本；供回覆截斷後重新交接。 |
| POST /action | 雙憑證、當前世代與執行個體均吻合才接受；角色及組別由伺服器資料提供。 |
| POST /join | 只用於驗證活動 RUNNING 時副本無法新加入；不是正式入組 API。 |

以上路徑只存在於隔離探針，沒有加入正式應用伺服器。

## 狀態轉移

| 起始狀態／事件 | 轉移及權威行為 |
|---|---|
| 首次新頁，沒有已綁定雙憑證 | NEW；不取得角色。 |
| 原生副本有複製 token、沒有原第二憑證 | DUPLICATE→NEW；只清副本資料，不動原頁。 |
| fixture 模擬完成登入／入組 | NEW→RELOAD_HANDOFF→OWNED；伺服器綁定兩份憑證。 |
| 原頁重整 | RELOAD_HANDOFF→OWNED；增加世代、保留原身分與草稿。 |
| 有效原文件再次連到重開的服務 | 維持同身分及當前世代，不增加合成身分筆數。 |
| 交接已保存、回覆截斷 | RELOAD_HANDOFF→DISCONNECTED；重整後以雙憑證核對版本，再恢復 OWNED。 |
| 錯誤證明、撤銷或固定期限不符 | INVALID；不得靠新 instanceId 復活。期限／撤銷完整服務仍屬後續任務。 |
| 舊世代操作／延遲交接 | 拒絕，不改新持有人。 |

JSON 的 transitions 保留實際瀏覽器轉移。這裡的 DISCONNECTED 是探針回覆故障狀態，不是 G2 寬限政策實作。

## IA03 情境對照

| IA03 情境 | 原型證據 |
|---|---|
| 同 Chrome 老師／不同組隔離及重整 | 同一設定檔的兩個合成老師與兩組學生，各連續重整三次，身分、角色、組別及草稿不互換。 |
| 複製學生分頁 | 老師與學生分別驗原生副本為 NEW、無原憑證／草稿，進行中加入回覆 403；原頁操作仍成功。 |
| 原頁重整與副本同時競爭 | 原頁新文件 commit 後暫停腳本，讓副本先完成；副本不動原租約，原頁續載後成功交接，世代只增加一次。 |
| 副本先於原頁恢復或服務重開後先到達 | 老師／學生各驗 SQLite 及 HTTP 服務重開、來源不變；副本先載入及偽造證明仍拒絕，原文件之後恢復原身分，合成身分筆數不增加。 |
| 原頁關閉後副本不得接手 | 驗已完成初始化的副本，以及首份腳本尚未執行的副本；原頁關閉後重整皆無原身分或草稿。 |

補充驗證包含：原頁關閉後用 Chrome sessions.restore 還原仍走 NEW、舊世代拒絕、偽造角色／組別不改權威角色、錯誤第二憑證不撤銷原頁、交接回覆截斷後固定 expiresAt 不延長。

服務重開測的是同一探針程序內關閉／重建 HTTP listener、關閉／重開 SQLite，而非宣稱已完成正式伺服器程序的全部重啟驗收。它驗證持有人證明與世代讀寫，不取代任務 7.5、13.4 的完整故障整合。

## 為何 COOP 不能省略

負對照刻意移除 COOP，同源新頁可透過 opener 讀取原頁兩份憑證，提出新 instanceId 後被原型權威端接受，原執行個體後續遭拒。這證明單靠 window.name 的隨機內容與 SQL 雜湊核對，仍不構成本次所需的分頁隔離。

套用 noopener-allow-popups 後，受測同源新頁在載入後沒有 opener 參照，且未取得原權限。其行為依據見 [HTML Standard 的 COOP 定義](https://html.spec.whatwg.org/multipage/browsers.html#cross-origin-opener-policies)。標準也指出這不是抵禦任意同源程式碼執行的完整安全邊界；本次不聲稱能防範同源 XSS 或操作者手動搬移完整有效憑證。正式實作仍須遵守 PS07 的純文字呈現及輸入安全要求。

此候選使用在受測 Chrome 操作中不被原生副本繼承的秘密與伺服器核對，不是瀏覽器提供的簽章身分證明。其他瀏覽器與後續 Chrome 行為不能由本次結果自動推定。

## 工具開發紀錄與限制

首次工具試跑曾因 fixture 的 evaluate 表達式未實際呼叫而未建立合成身分；修正後才進行候選判定。另發現直接斷掉交接 HTTP 回覆可能被 Chrome 自動重送，故改成已落盤後送出截斷 JSON，確定命中前端無法確認交接的故障點，而非假設網路一定不重試。

重複重開測試服務的工具開發試跑曾卡住，終止兩次試跑後，於測試服務停止時明確關閉所有連線，並替 Node 測試請求設定 timeout，再重新執行完整輪次。保存的[有視窗工具中止紀錄](evidence/g1-window-name-headed-tool-trial.json) 為 22／36，包含工具遭終止後的錯誤，不是通過證據。最終結果採用修正後完整的兩份 39／39 記錄，沒有把工具中止解釋為 U02 已解決。

本次沒有正式 WebSocket、老師密碼驗證、學生選組／成員服務、Google OAuth 或 Sheets 整合。COOP 對未來 Google 回呼與 popup 溝通的影響，須於任務 6.1 驗證，不得預設 callback 能使用 opener。正式 4.2 必須整合完整憑證保護、世代與所有命令授權，再依原規格重驗，不可只搬用 window.name 字串。

U01 強制中斷與寬限截止附近的證據不足、U02 凍結／丟棄／休眠及時限分類、U03 未核實範圍重新處理全部保留。本次沒有裁定以上政策，亦未進行 42 分頁或 1 秒／5 秒效能驗收。

## 任務與後續

任務 1.7 的最小候選、確切轉移、實際 Chrome 交錯測試及證據已建立，更新後整體為 16／85；4.2 及其他業務任務仍未完成。下一步須依原依賴先完成 2.1／2.5 等後端契約，再進入正式身分整合，不能以本報告代替那些任務。

原始需求、既有人工審查、proposal、design、十份 spec、正式應用程式與 migration 沒有修改。本次僅增加隔離驗證工具與紀錄、補充 README／任務追蹤。先前[初輪失敗紀錄](g1-tab-identity-review.md)保留，該輪結論不被改寫為通過。

最終檢查：TypeScript 型別檢查、既有 23／23 單元與整合測試、前後端建置及 OpenSpec strict validation 全部通過。14 份原需求／審查／正式規劃檔案與保護基準的 SHA-256 相同。CLI 逐項回讀確認 1.7 已完成、4.2 尚未完成，進度為 16／85、剩餘 69 項。
