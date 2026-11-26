# Design

## Context

動機與範圍見 `proposal.md`。檢查時專案只有 `docs/requirements.md`、OpenSpec 設定及技能，沒有前後端、資料庫、測試或既有能力可遷移。本變更新增十份能力規格，不改寫原需求。

來源優先關係：原需求完整保留；本對話明確同意的補充用於解決歧義及列明例外；Explore 建議不能自行提升為決策。Propose 已確認技術架構 D30 及匯出期間暫停外部編輯 D31；人工審查後使用者確認六項修訂方向，另列 D32～D37。工程設計細節是實現契約的設計選擇，不冒稱為使用者逐項指定，未驗證機制與未確認的極端情況明列於關卡及 Open Questions。

範本來源與已觀察結構：
- [單題範本](https://docs.google.com/spreadsheets/d/12uh5xhIx2wXFMy42KU8lN7rLFQ8GDugt9zfAFEvu-1E/edit?gid=1167716485)：六題，作答區 G:H 合併。
- [題組範本](https://docs.google.com/spreadsheets/d/1PXXwWiBKJNpPkLRoJLMzZWsAh4Jzn2bThHTeRAiq3Hg/edit?gid=1028924918)：四個搶答單位、六個答案，前兩題各兩子題、後兩題單題；題組 G 欄為標記、H 欄為答案。
- 使用者另已確認後續文件沿用兩者結構。表頭在第 4 列，題號 B、敘述 C:F、作答 G:H；題目起始列、題數與子題數不鎖死為樣本值。

## Goals / Non-Goals

**Goals:**
- 使用伺服器權威狀態、單一接收順序與交易，實現跨分頁一致、不可重複的搶答。
- 分離身分、參與與在線狀態；以明確資料投影保護學生可見範圍。
- 分離外部文件讀取、完整預檢及一次寫入，使外部失敗不破壞本機結果。
- 讓每個原始需求、D01～D39、規格、任務與後續驗收可相互追溯。

**Non-Goals:**
- 不導入多程序分散式排名、雲端服務或共同編輯 CRDT。
- 不以瀏覽器共享 cookie、localStorage 或連線數取代分頁身分、持久化與學生人數。
- 此次不建立系統程式碼、遷移 SQL、資料庫檔、憑證或外部試算表修改。

## Decisions

### 1. 已確認決策登錄

下列 D01～D29 對應逐次問答的同意；範本結構確認獨立列於 GI03、GI04。D30、D31 為本次 Propose 明確確認。

| 決策 | 已確認內容 | 正式規格 |
|---|---|---|
| D01 | 進行中僅本組；結束後成功組答案例外公開；老師全部可見 | AR01～AR05 |
| D02 | 首次加入、離組、換組僅待開始 | SP01、SP02 |
| D03 | 斷線約 30 秒寬限，逾期失效移除，進行中不可再加入 | RR03、IA09 |
| D04 | 停機不計寬限，恢復後原有效身分重新有約 30 秒；不復活已失效者 | RR04 |
| D05 | 老師登入、學生加入起算固定 12 小時，重連重啟不延長 | IA04 |
| D06 | 待開始可確認替換，成功匯入才失效學生；開始搶答不失效 | AL03、AL04、GI06 |
| D07 | 僅留目前活動，清除舊題目答案排名成員匯出歷程；保留登入暱稱設定 | AL04、PS03 |
| D08 | 提交與結束統一排序，有效提交排名，無效不占名次，同組一次，重送一致 | SR01～SR06 |
| D09 | 草稿分頁獨立、重新整理恢復；提交鎖定，離組失效新活動關閉清除 | SP05、SP06 |
| D10 | 停機計入活動時長，重啟維持階段與原時間 | AL05 |
| D11 | 頭尾修剪、可見字元計數；暱稱 1～20 不換行，答案 1～200 可換行 | IA07、SR01 |
| D12 | Asia/Taipei、YYYY-MM-DD HH:mm:ss.SSS 並標示時區，使用原提交時間 | SR08、TC05、GE11 |
| D13 | 老師 Google 帳號 OAuth，學生免 Google，失效不丟本機資料 | PS04、PS06 |
| D14 | I:K 三欄、表頭第 4 列、題組各列同資訊、不插移原欄、衝突停止 | GE04 |
| D15 | 匯出可換模式，最後模式為準，不累加，只清系統資訊，人工修改則停止 | GE06、GE08 |
| D16 | 無人作答保留原格，不寫無人文字，仍驗證全部位置 | GE07、GE09 |
| D17 | 核對題目標記合併及目標內容，相關人工變更停止；無關標題修改保留 | GE08 |
| D18 | 附註灰色 9 點字，保留原答案字型，可換行增列高並於移除時還原 | GE05、GE06 |
| D19 | 多老師分頁共用密碼、獨立登出，同一活動，操作排序且匯入匯出不交錯 | IA02、AL06 |
| D20 | 本機設定單一老師密碼、無預設、無網頁改密碼；改密碼重啟撤銷老師 | IA01、IA05 |
| D21 | 共用單一 Google 連結、跨重啟、登出不解除、可解除且不清活動 | PS05、PS06 |
| D22 | gid 指定表，無 gid 單表直讀、多表選擇；名稱不限、原表匯出 | GI02、GE01 |
| D23 | 允許原格有答案、不提供學生或作標準答案、匯入不改來源 | GI05、SR07 |
| D24 | 清活動時例外保留最少文件輸出歸屬、核對與原排版資訊，不留歷史查詢 | PS03、GE10 |
| D25 | 驗收 2 老師＋40 學生、20 組各 2 人，不是產品人數上限 | RR02、RR07 |
| D26 | 本機正常時完成操作後 1 秒同步、計時差異至多 1 秒 | RR02 |
| D27 | 可用後有效開啟分頁 5 秒內自動重連恢復，不需人工操作 | RR05 |
| D28 | 正式驗收 macOS 當時最新穩定 Chrome；含複製分頁獨立身分 | IA03、RR07 |
| D29 | 本場無人作答留舊答案文字，但清可核對的舊系統附加資訊 | GE09 |
| D30 | TypeScript、React、Node.js、SQLite、HTTP＋WebSocket、單一權威程序 | 下述架構與任務 1、2、3、7 |
| D31 | 老師與協作者於匯出預檢至完成期間暫停外部編輯；系統仍完整檢查與整批寫入，不宣稱強制鎖表 | GE13 |
| D32 | R01：維持重整續接／副本獨立，補交接狀態與競爭情境，先設早期技術關卡，失敗回人工而非降格 | IA03、任務 1.7、4.2 |
| D33 | R02：可再次確認放棄不明匯出核對後換場；不宣稱未寫入或回滾，保留未核實範圍且禁止自動覆寫／清除 | GE14、GE15、AL03、GI06、PS03 |
| D34 | R03：明定連線／寬限／撤銷／到期與落盤邊界，補正常及強制中斷時序；證據不足的極端判準須另確認，不自創例外 | RR03、RR04、PS01、恢復關卡 G2 |
| D35 | R04：採持久化遞增接收序號，高水位跨重啟、不重用；無效請求可有缺口但不占名次 | SR04、PS01、任務 3.7、8.4 |
| D36 | R05：明列任務依賴，分開通道測試、畫面量測與結果呈現，不維持無法逐序完成的條件 | 任務依賴表、7.7、9.5、11.3、13.3 |
| D37 | R06：固定驗收資料集與批次，記錄環境、各次與最壞值；測量點明確，不放寬 1／5 秒或把驗收規模變成產品上限 | RR08、量測程序、任務 1.6、13.3 |
| D38 | G2 探針後使用者明確選 A：U01 不明中斷依最後已提交 CONNECTED／GRACE 狀態重給原分頁 30 秒；固定 12 小時、已撤銷、活動關聯與分頁證明優先。可能恢復截止已到但失效未落盤者，作為明確例外而非歷史有效證明 | RR04、PS01、7.4、7.5 |
| D39 | 第 13 階段使用者確認 U02：真正 Chrome 凍結／丟棄或 macOS 休眠另列暫停情境；一般背景維持同步與計時 1 秒、服務可用後恢復 5 秒；恢復依既有身分規則，不新增寬限或復活已失效者，保存全部量測與失敗 | RR08、13.3 |
| D40 | 使用者釐清 D37：T_apply 採正確 React DOM 首次呈現，可由授權 HTTP 讀模或 WS 更新；另列 WS revision、到達及套用，未確認不編造。同步仍 1 秒；5 秒恢復須授權 WS 快照與正確畫面皆恢復，所有原始樣本保留 | RR08、13.3 |

### 2. 系統架構與責任

```text
[React teacher tab] --+
                     +-- HTTP commands --> [Node.js authority] --> [SQLite]
[React student tabs]-+<-- WebSocket views --+       |
                                                  +--> [Google OAuth / Sheets]
```

使用 TypeScript 共用輸入型別、字元驗證及繁體中文錯誤代碼；React 處理畫面與分頁草稿，Node.js 負責所有授權與命令，SQLite 保存權威資料。前端建置與 HTTP/WebSocket 由同一本機來源提供，服務預設僅綁本機介面；固定來源與埠避免重啟後換來源造成暫存失聯。確切埠、套件與版本後續鎖定，不改變行為契約。

後端模組：身分與參與、活動與命令排序、題目與提交、角色資料投影、連線管理、Sheets 解析與匯出、OAuth 憑證保管、持久化。資料投影模組不向學生序列化完整內部資料。前端只管理輸入與顯示，不能決定角色、活動階段、組別資格、名次或成功。

替代方案：純前端 BroadcastChannel 無法作為權威裁定與伺服器持久化；只輪詢難以處理既定即時要求；SSE 可作替代推送但本次已確認 WebSocket；多程序排名增加排序成本；外部資料庫增加本機啟動負擔。本次不採這些替代方案。

### 3. 概念資料模型與儲存邊界

此處定義設計，不建立資料庫、SQL 或正式程式碼。

| 資料實體 | 核心欄位／關係 | 約束與生命週期 |
|---|---|---|
| 活動 | activityId、階段、版本、組數、開始結束時間 | 同時一個目前活動；替換時交易式清除舊場 |
| 來源快照 | spreadsheetId、sheetId、解析版本、表頭、題目基準、合併與原格式 | 只供目前活動定位與變更檢查，不把來源答案傳學生 |
| 題目 | questionId、activityId、題號、順序、類型 | 題組一個 questionId；不以顯示題號作全域識別 |
| 作答欄位 | fieldId、questionId、子題標記、敘述、順序、答案區定位 | 一題有一至多個欄位；題組原子提交 |
| 組別 | groupId、activityId、組號 | 每活動 2～20 組；不限制每組 2 人 |
| 工作階段 | sessionId、角色、憑證雜湊、建立到期、撤銷原因、密碼版本、生命週期狀態 | 隨機不可猜憑證；固定到期；不以暱稱或 cookie 辨識角色 |
| 學生參與 | participantId、sessionId、activityId、groupId、暱稱、有效狀態 | 一身分同時一組；重整不增人；提交保存送出者暱稱快照 |
| 提交 | submissionId、activityId、questionId、groupId、participantId、暱稱快照、receivedAt、receiveOrder、rank、requestId | 唯一(activityId,questionId,groupId)，唯一(questionId,rank)，不可修改 |
| 答案明細 | submissionId、fieldId、正規化文字 | 與提交同交易保存，不留部分答案 |
| 系統接收序號 | 持久化高水位、配置紀錄 | 每個進入裁定的命令先配置再執行；不隨活動替換或重啟歸零 |
| 操作／重試資訊 | operationId、活動、命令類型、狀態、請求雜湊及回覆識別；匯出含寫入前／預期範圍核對、必要原排版、確認意圖 | 本場恢復資料在寫入前落盤；放棄成功換場時清原答案與完整計畫，只保留最少管理資訊 |
| 連線租約 | sessionId、connectionId、連線世代、最後心跳、寬限截止、狀態版本、停機恢復證據 | 有效身分去重；連線集合可在記憶體重建，寬限與失效決定需保存 |
| Google 連結 | 單一帳號識別、授權範圍、受保護憑證參照、狀態 | 與老師分頁分離；不提供學生；解除清本機授權 |
| 文件輸出管理 | 文件／表識別、系統擁有範圍、內容核對雜湊、附註邊界、原字型換行列高、上次預期格式、已核實／未核實標記 | 跨活動例外保留，不保存可還原的歷史答案清單；未核實範圍不可自動覆寫或清除 |

SQLite 的提交、題組答案、唯一約束、重送識別及名次一起交易提交；活動替換亦為單一交易。排名以不可變 receiveOrder 與持久化 rank 為準，時間只供顯示。初始沒有活動即呈尚未匯入。資料庫遷移與備份策略在 Apply 建立，但正常重啟不可重建空庫。

分頁 sessionStorage 保存分頁憑證、暱稱與依活動／身分／題目隔離的草稿；預覽只為 React 分頁狀態。Google 憑證不放 sessionStorage，草稿不作組內共同編輯。

### 4. 活動狀態與操作排序

```text
EMPTY -- successful import --> READY -- start --> RUNNING -- confirmed end --> ENDED
                                |                                         |
                                +-- confirmed successful replacement <----+
```

READY 替換為新 READY，ENDED 亦只能建立新 READY；RUNNING 禁止匯入。所有命令攜帶 activityId／預期版本，執行時再驗證，不信任畫面舊狀態。取消確認不送出破壞性操作；伺服器亦檢查對應確認意圖，避免僅由前端保護。

單一程序在完整請求進入應用命令入口時，於任何非同步工作前配置 receiveOrder 與 receivedAt。此為具體伺服器接收點，不以客戶端發送時間、TCP 第一個位元組或資料庫寫入完成時間裁定。提交與確認結束使用同一有序執行器，驗證失敗仍不占名次；結束前有效提交先完成交易，之後才結束。每題 rank 為已接受提交的連續順序。

接收序號採獨立於業務回滾的持久化高水位。單一入口依抵達順序完成短暫、同步的 SQLite 序號配置交易，再把同序號命令放入有序執行器；不得先 await 非同步驗證再配置。配置失敗不得宣稱接受命令或配置後續超越命令，須先處理儲存錯誤。序號配置落盤後即使驗證失敗、業務交易回滾或尚未執行就中斷，也不回收；它可有缺口而 rank 不可因此跳號。啟動時先完成高水位恢復及一致性檢查再接受命令，保證新序號大於所有已配置／保存序號；若不一致則停止接受搶答並報錯，不猜測重排。高水位是系統設定，不隨清除舊活動歸零。時間、序號及 rank 都不提供進行中學生。

提交步驟：驗身分與權限 → 檢查既有成功 requestId（僅回覆原授權資料）→ 驗活動與組別、階段、完整題組及文字 → 交易插入提交與全部答案、唯一約束及重送紀錄 → 提交成功 → 推送。不同 requestId 的同組重送不覆寫；相同 requestId 內容不同拒絕。已結束後同一已成功請求仍可對有效原組身分回覆舊成功，不構成接受新提交。

Google 匯入先在交易外讀取完整候選快照，再進入短命令交易重驗原活動版本、確認與階段後切換；長網路讀取不阻塞搶答排序。匯出與替換取得共用活動文件操作鎖，避免本機多老師交錯；提交與結束不等待 Google 外部網路。

### 5. HTTP API 草案

下列為內部介面設計，可在不改變正式行為規格下整理路由。JSON 成功／錯誤帶 operationId、穩定錯誤代碼及繁體中文訊息，不含內部堆疊。分頁憑證透過 Authorization 傳送，不使用全瀏覽器共用角色 cookie。

| 介面 | 輸入／輸出與授權 | 規格 |
|---|---|---|
| POST /api/teacher/login | 密碼、分頁啟動識別；回該分頁憑證與固定到期 | IA01～IA05 |
| POST /api/session/logout | 撤銷目前身分；老師不解除 Google | IA02 |
| GET /api/session | 有效角色、到期與失效原因，不回秘密 | IA04、IA09 |
| GET /api/lobby | 階段、可選組與人數，不回題目敘述或答案 | SP01、SP04 |
| POST /api/activities/{id}/join | 合法暱稱、groupId、新分頁識別；僅 READY，回學生身分 | IA06、SP01 |
| POST /api/activities/{id}/leave | 本人、僅 READY，退出並更新人數 | SP02 |
| GET /api/activities/current/view | 依角色與階段投影的快照、可見版本、伺服器時間 | AR01～AR05、RR06 |
| POST /api/imports/inspect | 老師提供網址；回可選表或候選解析與驗證資訊 | GI01～GI07 |
| POST /api/imports/{token}/commit | 選表、組數、activityId、預期版本、替換確認；一次建立 | AL03、GI06 |
| POST /api/activities/{id}/start | 老師、預期版本；保存開始時間 | AL01、AL02 |
| POST /api/activities/{id}/end | 老師、預期版本、確認；共同排序並保存結束時間 | AL02、SR05 |
| POST /api/activities/{id}/questions/{qid}/submissions | 學生、requestId、全部 fieldId 答案；不接受客戶端排名 | SR01～SR08 |
| GET /api/activities/{id}/results | 老師完整／有效學生本組與成功答案；過期活動拒絕 | AR01～AR05 |
| POST /api/activities/{id}/exports | 老師、模式、requestId；操作前提提示、整批預檢、寫入與結果核對 | GE01～GE13 |
| GET /api/operations/{id} | 僅有權者查匯入匯出結果，不曝光他組資訊 | GE12、IA08 |
| POST /api/operations/{id}/reconcile | 老師重新核對或提示重新授權；只更新原操作，不改新場次 | GE12、GE14 |
| POST /api/operations/{id}/abandon-confirmation | 老師再次確認風險，回綁定舊活動版本／操作的換場確認意圖；不立即清除舊場 | GE14、GE15、AL03、GI06 |
| POST /api/google/connect | 有效老師啟動帳號授權，state 綁定該次老師意圖 | PS04～PS06 |
| GET /api/google/callback | 驗一次性 state／授權流程後保存共用連結，不把 token 放 URL 回前端 | PS04～PS06 |
| GET /api/google/status | 有效老師查看帳號連結狀態，不回 token | PS05、PS06 |
| DELETE /api/google/connection | 有效老師解除本機連結，停止後續 Sheets 存取 | PS05 |

等待／未選組狀態只能看大廳投影，不能看結束結果。離組回到未選組狀態但保留暱稱。開始後重新授權 Google 不改變學生入組限制。

### 6. WebSocket 與角色投影

WebSocket 連線以短期、一次性且綁定有效分頁的通道票證驗證，不把長效 bearer token 放在記錄網址。伺服器驗證來源與活動、角色、組別，並自行分配訂閱範圍，不讓客戶端自行加入老師或其他組頻道。

事件類型包括活動階段與時間、組別人數、本人組員、本組已提交、老師完整提交與排名、結果可見範圍、身分失效、Google 連結狀態（老師限定）。禁止在公共事件夾帶完整提交。學生投影採白名單；進行中不傳 receiveOrder、rank 或會隨他組提交變動的全域序號，避免間接洩漏他組作答。

採每個可見通道的 revision、activityId、serverEpoch 與權威快照。連線或重連先原子取得快照及訂閱銜接版本，將銜接期間事件緩衝，之後只套用同活動、同 epoch 的較新版本。舊／重複事件忽略，有缺口重新取授權快照；不要求保留所有舊事件。持久化成功後才發事件，若落盤後尚未推送就重啟，靠快照恢復。

計時由 startedAt、endedAt、serverNow 與前端單調經過時間推算，定期校時。背景分頁恢復可見及重連立即校正，不依每秒 setInterval 累加作權威。

### 7. 分頁身分、在線與重啟

工作階段憑證由伺服器隨機產生、只保存可驗證雜湊，固定 expiresAt；老師密碼以安全驗證方式處理，保存密碼版本識別以撤銷舊老師工作階段，不能把明文密碼寫入資料庫或日誌。每次命令與快照都重驗有效性，不只在連線時驗證。

sessionStorage 支援重新整理，但 opener 開啟可複製初始內容，不能單獨保證分頁隔離。[MDN sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage) 因此採「分頁啟動識別＋同來源排他持有＋伺服器連線世代」設計：原分頁持有身分使用權；複製分頁若偵測既有持有人，清除複製的憑證及草稿並建立新分頁身分，不撤銷原分頁。可用 Chrome 支援的 [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) 協助同來源排他協調，搭配導覽類型及伺服器重整交接避免重整誤判；這是需要實際 Chrome 驗證的工程機制，不把 API 可用當成分頁隔離已證明。

#### 分頁交接狀態與早期關卡 G1（R01）

分開四種識別：伺服器工作階段 sessionId、邏輯分頁 tabId、每次載入只存在該頁記憶體的 documentInstanceId，以及 connectionId。sessionStorage 的 sessionId／tabId／憑證可能一併被複製，所以 tabId 不是原分頁證明；documentInstanceId 只用於區分執行個體，也不是自行宣告即可取得身分的證明。Web Locks 排他結果只證明當下持有，不證明原分頁。

| 狀態 | 允許的行為與轉換 | 不允許的推定 |
|---|---|---|
| NEW | 初次建立獨立分頁，老師輸密碼／學生依階段加入後成為 OWNED | 不因複製的暫存憑證變成 OWNED |
| OWNED | 伺服器關聯到已驗證持有人，頁面請求有身分及執行個體脈絡 | 不以暱稱、cookie 或其他分頁可宣告欄位取代權限 |
| RELOAD_HANDOFF | 原分頁重整，舊執行個體交接到原分頁新個體；成功才替換連線世代 | 不以最先拿鎖／連線者勝出 |
| DISCONNECTED | 原持有人在寬限內可續接，connectionId 可變；重新取得權限須符合持有人證據 | 不讓副本先抵達就接手 |
| DUPLICATE | 新開／複製執行個體走 NEW，不撤銷原持有人 | 不複製組別資格、角色或草稿 |
| INVALID | 到期、撤銷、寬限超時、新活動後回未登入／選組 | 不藉新 connectionId 復活 |

候選交接流程須提出「瀏覽器可驗證的同分頁導覽證據」與「伺服器交接版本」如何關聯，明列證據取得、重整交接與副本拒絕，不只增加一個可複製 token。現在尚無實驗證明此候選能涵蓋全部 Chrome 操作；不得把上述狀態表當作已解決來源辨識。任務 1.7 在獲得未來 Apply 授權後，先用最小技術驗證檢查 IA03 全部交錯情境，產出確切演算法與證據，再開始依賴它的正式身分流程 4.2。若無法取得足夠證據、無法保留原分頁或會讓副本承接，停止相關實作並回人工，不能自動清原分頁身分或修改已確認需求。此關卡不授權本次寫任何程式。

成員以 participantId 去重，連線 connectionId 可多次變動。最後有效連線消失開始約 30 秒寬限，重疊連線的舊 disconnect 不可移除新連線學生。心跳處理瀏覽器未送 close 的情況，調度需以背景分頁測試，不以單一 unload 通知判定關閉。到期失效與撤銷寫入持久層。

啟動先讀取固定到期及已撤銷狀態，對停機前仍有效身分給恢復後約 30 秒，不將停機時間扣掉；已失效不復活，12 小時照常經過。工作階段有效分頁自動在可用後 5 秒內重連，若途中新活動則撤銷舊學生而非回舊畫面。老師也受分頁關閉、期限及登出限制。

#### 身分恢復狀態與關卡 G2（R03）

持久化的權威狀態為 CONNECTED（有效）、GRACE（一般斷線寬限）、REVOKED（含超時／登出／換場原因）、EXPIRED（固定期限到期）。保存固定 expiresAt、寬限起點與截止、狀態版本及已完成撤銷，不只保留 WebSocket 記憶體集合。斷線狀態與人數移除同一權威決定；在正常運作中每次授權都檢查固定期限及寬限，不能等未來定時器才禁止已超時操作。重疊連線的舊事件不得覆蓋新版本。

| 恢復時可證明的狀況 | 必須採取的結果 |
|---|---|
| 已有 REVOKED／EXPIRED 狀態，或現在達固定 expiresAt | 拒絕恢復，不復活；保留暱稱並顯示原因 |
| 正常關機時已處理屆滿寬限，再保存關機檢查點 | 已失效者保持失效，不能重新給寬限 |
| 正常關機檢查點證明 CONNECTED／尚未逾期 GRACE | 恢復後重新給約 30 秒，不扣停機時間 |
| 強制中斷但可證明原身分仍有效，或可證明失效已完成 | 分別依 D04 給恢復寬限，或保持失效 |
| 強制中斷恰在寬限截止附近，現有紀錄不能證明截止前已停機或截止後仍正常服務 | 依已確認 D38：最後已提交 CONNECTED／GRACE、未到固定期限、未撤銷且活動與分頁證明仍符者，服務恢復後重給 30 秒；不宣稱已證明歷史上未逾期 |

正常關機在同一裁定流程先處理當下已到期／寬限屆滿，再保存狀態及關機檢查點；重啟先恢復與檢查後才報可用。非正常中斷需要驗證的證據方案包括狀態版本、服務存活檢查點及可證明的撤銷提交；檢查點間隔不能被冒稱為精確停機時刻。關卡 G2 由任務 3.2、7.4、7.5、13.4 驗證；使用者於五案隔離探針後確認 D38，U01 採最後已提交狀態恢復。這是已確認的例外政策，不是精確停機時刻推導；仍須完成正式連線、瀏覽器與故障驗收，不因政策確認宣稱 R03 全部實驗關閉。

### 8. Google OAuth、匯入與安全匯出

一次一個共用 Google 連結，讀寫權限使用老師 Google 帳號；OAuth 與本機老師登入分離。憑證由後端受限本機儲存與作業系統保護機制保管，不放前端或版控。啟動沿用有效 refresh 資訊，授權撤銷提示重新連結，不清本機資料；解除連結停止排隊後續存取，不虛稱已回滾先前完成的外部寫入。

匯入以 spreadsheetId、sheetId、表頭與 merge ranges 解析。垂直題號區域識別題組，題組 G 保留標記、H 作答；單題 G:H 合併。若題號不唯一、子題無法完整對應、合併異常或沒有可解析題目，拒絕而不猜測。原答案及其排版只作基準，不作標準答案或學生教材資料。來源只讀不回寫識別欄。

匯出管線：提示 D31 暫停外部編輯 → 鎖定本場與文件操作 → 驗證已結束與 Google 權限 → 重新讀取必要網格、原內容與格式 → 比對所有題目（包含無人題）及系統輸出歸屬 → 構造全部三模式差異與還原項 → 保存待確認操作及內容核對雜湊 → 單次 batchUpdate → 核對遠端結果 → 保存本場結果與最少文件管理資訊 → 解鎖並通知可恢復編輯。

Google [batchUpdate](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate) 驗證子請求並原子套用同批更新，適合避免部分題目寫入，但不保證與協作者變更隔離。寫入只用必要 field masks，答案用字串值，富文字用 [textFormatRuns](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/cells)；重設字串會清除既有 runs，因此須重建答案與附註格式，不可用 note 代替。合併區僅寫左上格，不拆合併；I:K 使用原位，不插欄。附註移除時依原基準還原 wrap 與列高，避免多次匯出逐次增高。

人工修改檢查包含管理資訊曾調整的相關格式；不屬系統的 I:K 內容不覆蓋。無人題保留原答案文字，但移除可證明為系統的舊附註／I:K 資料；無原管理資訊不能單憑文字長得像附註就刪除。管理資訊保存目標範圍、不可還原的內容核對雜湊、附註起點及原格式，不保存歷史答案明文；目前活動的來源快照與匯出暫存資料於替換時清除。

SQLite 與 Google 無共用交易，不能聲稱跨服務 exactly-once。回覆遺失或崩潰於遠端完成、本機尚未確認時，先核對遠端，不盲重試。新活動前若仍待確認，提示老師完成核對或依 D33 再次確認放棄核對，不再要求舊文件一定可讀而永久阻擋。

#### 不明匯出操作狀態與換場（R02）

| 匯出狀態 | 判準與允許後續 |
|---|---|
| PREPARING／準備中 | 尚未送出，可安全取消；不宣稱已完成 |
| WRITING／寫入中 | 送出前已保存恢復計畫與預期核對，外部請求結果尚未確定；本機逾時不等於失敗 |
| COMPLETED／已完成 | 外部已確認且核對符合預期，本機保存已核實輸出管理資訊 |
| FAILED／已失敗 | 有證據確認未寫入，例如完整預檢失敗或外部明確拒絕整批；未知傳送結果不能歸類此狀態 |
| UNCONFIRMED／結果待確認 | 可能已寫入，提供重授權／核對；不能重加欄位或宣稱回滾 |

寫入前持久化 operationId、activityId、目標文件／表及全部受影響範圍、來源／預期內容與格式核對、必要原格式及實際寫入計畫；這是當前活動的可恢復作業資料，不能只存一個雜湊卻遺失恢復所需邊界。傳送前先標記 WRITING，若在標記後尚未真正傳送即中斷，仍先核對，不能猜一定未送出。清除舊活動前，已核實者保留原最少管理資訊；不明且確認放棄者保留 UNVERIFIED 範圍與必要雜湊／附註邊界／原排版，不保留歷史答案、完整寫入計畫或歷程清單。

放棄核對不是新增第五個活動階段。老師再次確認時說明可能已修改、不回滾、換場後舊結果清除與未核實範圍受保護；伺服器產生綁定 operationId、舊 activityId、版本與老師意圖的換場確認。此時不清舊場、不失效學生，也不刪核對資料。新文件完整驗證成功後，在同一替換交易驗證確認仍有效、保留最少未核實資訊並清舊場；取消或匯入失敗，原活動與 UNCONFIRMED 作業完整保留。相同確認不可重用於其他場次或其他操作。

成功換場後撤銷舊操作的自動重試資格，舊外部回覆不得更新新活動或解除 UNVERIFIED。無法撤銷已送出的外部請求，也不承諾原文件從未變更；這點在放棄提示中明說。未核實範圍可只讀匯入，但任何新匯出要寫入／清除重疊範圍都停止，不能靠目前文字「看起來沒問題」自動解除標記。其他文件不受阻擋。重新處理未核實範圍須另行明確確認；本次不提供未經確認的一鍵解除或自動接管策略，見 U03。

### 9. 已確認例外與衝突處理

| 原始文字或潛在衝突 | 正式處理 | 來源決策 |
|---|---|---|
| §6.1 概括禁止他組資料，但 §5.5 要成功組答案 | 結束後僅公開成功組別、答案與提交者；其他未成功答案不公開 | D01 |
| 關閉失效與重整保留難即時區分 | 以約 30 秒斷線寬限裁定，超時移除；不是宣稱可可靠立即偵測關閉 | D03 |
| 停機超過寬限但要求恢復 | 排除停機時間、服務恢復後重新給寬限；12 小時與已失效不例外 | D04、D05 |
| §5.6「開始新活動」可能指開始搶答 | 定義為成功匯入新場次；READY→RUNNING 不使學生失效 | D06 |
| 結束保留全部答案與新活動清除 | 結束後保留直到成功替換，無歷史封存 | D07 |
| 清除舊匯出紀錄與跨活動還原衝突 | 刪歷程但保留最少文件管理資訊；非歷史查詢 | D24 |
| 原文件保持不變與加三欄／附註衝突 | 僅允許指定 I:K 資訊及答案內附註、必要換行列高；切換時還原 | D14、D18 |
| 無人作答保留原格但舊附註會誤導 | 留原答案文字，清可核對的系統舊附加資訊 | D16、D23、D29 |
| 原文允許選組但未定義遲到與到期重入 | 僅 READY 可首次加入，RUNNING／ENDED 不得新加入 | D02、D05 |
| 40 學生及範例兩子題容易被誤當上限 | 只作驗收規模與範例，不設產品人數／題數／子題數上限 | D25、範本確認 |

### 10. 測試策略與驗收證據

- 單元測試：固定範本解析、合併範圍與混合題、可見字元及 emoji／換行邊界、角色資料投影、時間與模式差異、管理資訊核對及草稿隔離。
- 後端整合：真實 SQLite 交易、同組唯一約束、跨組排序、同毫秒、無效不占名次、結束競爭、重送不同內容、寫入失敗與落盤後斷回覆。
- 安全驗收：未登入、學生偽造角色與組別、過期身分、WebSocket 訂閱越權；檢查 HTTP、事件、快照均不含禁止資料及可推知他組提交的全域序號。
- 瀏覽器驗收：同一 Chrome 設定檔 2 老師＋40 學生（不是隔離 cookie context 冒充同瀏覽器分頁），20 組各 2；包含背景、重整、複製、關閉、重疊連線、正常斷線與停機，記錄環境版本。
- 時間驗收：正常操作完成至有權分頁顯示至多 1 秒、計時差至多 1 秒；可用後恢復至多 5 秒；約 30 秒寬限與固定 12 小時用可控時鐘測邊界並另作真瀏覽器連線驗證。不能以最終一致代替時限。
- Sheets 測試：使用經授權可寫的測試副本，不用原範例作破壞性測試；涵蓋單題、題組、混合、已有答案、三模式互切與重複、來源人工改動、無人作答、I:K 衝突、最後一題遺失、格式還原、公式外觀文字與回覆遺失。模擬 API 不能取代一次真實 OAuth／Sheets 整合。
- 重啟測試：各階段、正常重啟與強制中斷、提交前後及遠端匯出與本機確認之間；比較快照、身分期限、答案與排名，不只檢查頁面能開。
- 每一規格情境對應測試／人工步驟與證據；完成條件見 tasks。此規劃沒有執行以上系統測試，不預填通過。

#### 可重現效能驗收程序（R06）

以下具體資料量及重複次數是本次工程驗收配置，不是新增產品上限，也不冒稱使用者逐一指定每個數字。固定配置在任務 1.6 建立版本化清單；若修改資料或程序，保存新版本及原因，不用較輕負載取代失敗測試。

| 資料集 | 固定內容 | 用途 |
|---|---|---|
| F1 | 原單題範本六題、六個答案欄位 | 範本正確性與基本同步 |
| F2 | 原題組範本四題、六個答案欄位 | 題組混合與計分正確性 |
| F3 | 同範本結構的 60 題：20 單題、20 個兩子題題組、20 個四子題題組，共 140 個答案欄位 | 較多題目與多子題下的 UI、快照與提交負載 |

每個資料集使用同一 Chrome 設定檔的 2 老師＋40 學生，20 組各 2 人，記錄哪些分頁前景／背景、瀏覽器及 OS 版本、CPU、記憶體、是否觀察到頁面凍結／丟棄及節能設定，不以每人隔離 context 代替。答案包括接近 200 可見字元、換行與 emoji 的合法輸入，暱稱含同名案例。

每個資料集完整執行 20 輪，輪前回復同一初始資料與有效身分條件。每輪量測：20 組同時入組與人數更新、老師開始全部開題、40 分頁針對同題同時送出（每組兩人競爭）、再對其他題分批提交、老師確認結束。另以原已加入分頁執行背景更新、40 分頁同批重整、短暫斷線與服務恢復、停機超過 30 秒後恢復等固定批次；復原／重新建立狀態後再跑下一個案例，不能讓逾期身分污染 5 秒恢復測試。F3 所有題均驗證可用，提交批次至少涵蓋單題、兩子題、四子題三種；不必把外部 Google 延遲算成搶答命令完成後的 UI 推送時間。

量測點：T_commit 是伺服器權威狀態交易提交且允許發送事件的單調時間；T_apply 依已確認 D40，取各有權分頁首次正確 React DOM／狀態呈現的時間，可由授權 HTTP 完整讀模或 WS 更新；不是 WebSocket onmessage 時間，也不因 WS 較晚確認而漏記較早正確 DOM。WS revision、到達及實際套用時刻另外記錄，未取得時明列未確認，不編造或冒稱較早已接收；T_ready 是測試監督者確認服務已完成資料恢復、健康檢查及授權通道可用的時間；T_restored 是原分頁的授權 WS 快照及正確組別／結果／提交與計時皆已恢復的時間，不能只以 HTTP 畫面先恢復取代授權 WS 恢復。背景分頁以實際 DOM／資料呈現狀態為測點，不要求螢幕真的把隱藏頁畫出像素。

以本機測試監督者的單調時間軸對齊伺服器與瀏覽器量測，記錄時鐘校準與量測誤差；不能直接相減兩個未對齊的 performance.now。同步驗收逐次檢查 T_apply−T_commit 加量測不確定度不超過 1000ms；恢復檢查 T_restored−T_ready 加不確定度不超過 5000ms；計時器對同一伺服器基準的各頁顯示差不超過 1 秒。無法可靠校準則該筆為無效量測，須重測且保存原因，不冒充通過。

依 D40 分開輸出首次正確 DOM 的 T_apply 與 WS revision／到達／套用時刻；WS 尚未確認即明列未確認，不把兩條時間線混為同一時刻。輸出每筆操作、revision、收件角色／分頁、資料集、輪次、起訖、時差與環境，彙總最大值、失敗及無效次數。所有有效樣本都須達標，不能只用平均或百分位掩蓋超時。背景分頁不可排除；若測到凍結／OS 暫停，保存資料並依 D39 另列暫停情境，保留全部失敗，依既有身分規則驗恢復；沒有完整證據不得宣告效能通過。

### 11. 本次人工審查修訂與依賴關卡

| 審查項 | 本次文件處理 | 仍需的證據或確認 |
|---|---|---|
| R01 | 補分頁與執行個體區分、狀態、三項競爭情境及 G1 | 候選交接機制尚未實驗；1.7 未通過不得進入正式分頁身分實作 |
| R02 | GE14／GE15、AL／GI／PS／TC、操作狀態、放棄確認與未核實範圍隔離一致化 | 未來真實 Sheets 故障驗證；未核實範圍再次處理時另確認，不自動解鎖 |
| R03 | 連線／寬限／撤銷／到期、正常停機表及中斷情境 | U01 已於後續 G2 邊界探針後依 D38 確認，正式心跳／恢復及整合證據仍須補齊 |
| R04 | 持久化高水位、獨立序號配置交易、跨重啟情境 | 3.7、8.4 的真 SQLite 與強制中斷測試 |
| R05 | 明列 task 依賴，7.7 留通道測試、9.5 只導向、11.3 完整結果、13.3 畫面量測 | 任務完成後再驗依賴，不能預勾已完成 |
| R06 | RR08 與 F1～F3、20 輪、批次、時鐘與 DOM 測點、最大值程序 | 實機證據與 U02 凍結分類；不放寬既定門檻 |

修訂同意不是 Apply 授權，格式通過不是 G1／G2 通過。本次只保存規劃，原 `docs/openspec-review.md` 保留為修訂前審查紀錄，不覆寫其當時的 75／102／79 統計或結論。後續以本節和重新計數結果辨識目前版本。

## Risks / Trade-offs

- [外部協作者競爭] → 全部預檢及單次原子 batchUpdate 能阻擋已觀察變更，無法鎖住預檢與寫入間的外部編輯。D31 已確認操作前提為期間暫停外部編輯；介面明示，不宣稱強制鎖表，若違反前提仍可能存在競爭，不能偽稱完全消除風險。
- [複製與重整辨識] → 依 G1 區分可複製識別與真正交接證據，先做實際 Chrome 最小驗證；目前不宣稱候選已可行，失敗停止相關實作、不降低 IA03。
- [背景節流與本機負載] → 不以客戶端計時器作權威；量測 42 分頁，調整心跳與推送，記錄負載；不擅自放寬 1／5 秒要求。
- [本機憑證與密碼] → 作業系統保護、受限檔案與脫敏日誌，密碼變更版本撤銷老師；授權撤銷不丟活動。
- [檔案級故障與跨服務不確定] → SQLite 交易、操作狀態、重啟核對與遠端內容檢查，不能把成功 HTTP 或檔案存在當作持久化證明。
- [格式還原覆蓋人工調整] → 保存基準與本系統預期格式，只恢復可核對擁有的調整；不同則停止，不以整區清除偷渡覆蓋。
- [原答案含舊資料] → 明確依 D23、D29 保留原答案而清舊附註；畫面結果只使用本場提交，避免把舊答案當本場成功。

## Migration Plan

1. 人工審查本提案、十份規格、設計、決策與追蹤表；本次停於此步。
2. 另行明確啟動 Apply 後，依 tasks 建立鎖定版本的環境與遷移；不預先建立空資料庫。
   在正式分頁身分流程之前完成 G1；恢復邊界依 G2／D38 實作驗證；其他未決政策不能由完整 Apply 指示自行選定。
3. 首次啟動配置老師密碼、固定本機來源及 Google OAuth；以測試文件驗證，不能拿原範例直接試寫。
4. 依功能次序逐段完成測試，最後執行 42 分頁及真實 Sheets 整合。
   2026-11-26 使用者已確認解除 4.6／7.1 的循環前置：第 5、6 群組以前置的群組 3、4.1～4.5、4.7 及 4.6 已驗證的 HTTP／共用授權部分開始；第 7 群組以前述身分基礎及群組 3、5、6 為前置，7.1 的實際訂閱授權通過後才可完成 4.6。各新增入口仍須立即驗證授權，不以關閉通道代替訂閱驗收。僅調整順序，保留原功能、完成條件及 U01／U02／U03 關卡；詳見 tasks 前置表。
5. 回復策略：版本化遷移前備份本機資料；失敗恢復上一版程式與相容備份，不清空活動。對已完成的 Sheets 寫入不能假稱由本機回滾撤銷；需用管理資訊核對後由明確授權的恢復流程處理。

## Open Questions

### U01 非正常中斷於寬限截止附近的裁定（已確認 D38）

2026-11-26，五案真子程序 SIGKILL／SQLite 與注入時鐘探針顯示，截止前中斷與撤銷 COMMIT 前中斷可留下相同權威狀態。證據見專案根目錄 `docs/g2-recovery-review.md` 及 `docs/evidence/g2-recovery-probe.json`；這不是 Chrome／牆鐘 30 秒完整驗收。

使用者明確選擇 A：非正常中斷無法區分截止前後時，以最後已提交狀態為恢復裁定依據。最後為 CONNECTED／GRACE、固定 12 小時未到、沒有登出／新活動／密碼變更等撤銷，且原分頁仍能提供合法分頁證明與活動關聯者，自服務恢復可用起重新給 30 秒重連。已提交 REVOKED／EXPIRED、已到固定期限或舊活動者一律不恢復；不延長 expiresAt、不改原組別或提交。已保留為 UNRESOLVED_RESTART 的舊版本紀錄亦依同一已提交狀態及優先檢查處理，不繼續無限等待未決政策。

明確代價：寬限已實際屆滿、撤銷尚未 COMMIT 就中斷者可能獲得恢復機會。這是 D38 的特定例外，不以「沒有撤銷列」冒稱已證明歷史上未逾期；一般正常運作仍依約 30 秒寬限失效。固定期限、已落盤失效、原分頁隔離及活動識別都優先，副本不得接手。正常關機仍先裁定屆滿再保存檢查點。

U01 政策已定案，7.4／7.5 必須依上述分支實作與測試後才能勾選；G2 不因人工選定政策自動通過。U02／U03 保持待決。

### U02 凍結／丟棄頁面或作業系統休眠的驗收分類（已確認 D39）

2026-11-26 使用者確認：真正 Chrome 凍結／丟棄或 macOS 休眠另列暫停情境。一般背景分頁仍完整納入正常運作驗收，維持同步與計時 1 秒、服務恢復可用後有效分頁恢復 5 秒；不以 hidden 狀態當作凍結，不排除一般背景樣本。暫停情境保存實際狀態、起訖及全部觀察，不將暫停中的時差混稱正常時限通過，也不刪除先前失敗。

解除暫停後依既有固定 12 小時、已撤銷、活動關聯、原分頁證明與 RR03／RR04／D38 規則驗證；不新增保證仍有效、額外寬限或自動復活政策。分類已確認不等於凍結、丟棄或 OS 休眠實驗已通過。F1～F3 與 20 輪仍為既定配置，不改產品容量或量測門檻。此前 U02 待決的歷史紀錄保留供追溯，以本節為目前決策。

### U03 未核實範圍再次處理的另行確認

已確認的當前行為是 GE15 停止自動寫入／清除，允許其他文件與新活動繼續。若未來要接管、重新建立基準、解除隔離或修改該舊範圍，必須另取得針對該範圍的明確指示；本次不建立自動解除功能。此項不阻擋實作目前的隔離與放棄換場流程，也不恢復歷史答案查詢。

### 可延後且不改變規格的設定細節

- Node.js／React／SQLite 驅動、HTTP 與 WebSocket 函式庫、測試工具的確切版本與套件；架構已確認，不得自行換成其他技術。
- 固定本機埠、資料路徑、憑證保護機制的實際配置，以及 Google Cloud 專案、OAuth client、redirect URI、授權範圍與可寫測試文件。須在後續環境任務驗證，不把公開範例可讀誤當 OAuth 可寫已成立。
- 驗收時的 macOS／Chrome 版本與機器資源，最大題數／子題數的量測資料；未確認上限前不自行設產品上限。
- 灰色附註的精確色碼與非關鍵視覺樣式，維持灰色、9 點、原答案字型及完整可讀等已確認契約。

## Traceability

以下逐條對照以本次讀取的 `docs/requirements.md` 行號與原文為基準；重複文字仍分別保留，不用章節概述掩蓋個別需求。原檔 SHA-256：`498bc69163997b0570963f4712d7196edd1f9e39590ec05d51e884aaa4e2f413`。

規格 ID 的完整 Given／When／Then 位於各 spec；任務編號於 tasks。D31 已確認外部編輯操作前提；文件覆蓋不等於已完成實作驗收。

| 原需求行號 | 原始需求文字 | 規格需求 ID（含情境） | 任務群組 |
|---|---|---|---|
| L4 | 本專案為課堂搶答系統，目的是將使用 Google Sheets Guided Notes（學習單）的課堂活動搬到線上，讓學生以組別為單位進行搶答。 | [SP01](specs/student-participation/spec.md)、[SR07](specs/submission-ranking/spec.md)、[PS08](specs/persistence-security/spec.md) | 9／8／3、4、13 |
| L6 | 系統僅在本機執行，同一台電腦可以透過多個瀏覽器分頁，分別扮演老師與不同組別的學生。每個分頁的登入身分獨立。 | [IA03](specs/identity-access/spec.md)、[RR07](specs/realtime-recovery/spec.md) | 4／7 |
| L9 | 搶答成功以伺服器最先收到的提交為準。 | [SR04](specs/submission-ranking/spec.md) | 8 |
| L10 | 系統不判斷答案正確與否。 | [SR07](specs/submission-ranking/spec.md) | 8 |
| L11 | 老師不負責批改答案。 | [SR07](specs/submission-ranking/spec.md) | 8 |
| L12 | 學生以組別為單位進行搶答與計分。 | [SR03](specs/submission-ranking/spec.md)、[AR03](specs/activity-results/spec.md) | 8／11 |
| L13 | 所有權限由伺服器驗證。 | [IA08](specs/identity-access/spec.md) | 4 |
| L14 | 使用者介面與錯誤訊息統一使用繁體中文。 | [PS07](specs/persistence-security/spec.md) | 3、4、13 |
| L17 | 使用密碼登入。 | [IA01](specs/identity-access/spec.md) | 4 |
| L18 | 可以匯入 Guided Notes。 | [GI01](specs/guided-notes-import/spec.md) | 6 |
| L19 | 可以開始及結束搶答。 | [AL02](specs/activity-lifecycle/spec.md) | 5 |
| L20 | 可以查看所有組別的作答結果。 | [TC03](specs/teacher-console/spec.md) | 10 |
| L21 | 可以匯出搶答成功答案至原始文件。 | [GE01](specs/guided-notes-export/spec.md)、[GE02](specs/guided-notes-export/spec.md) | 12 |
| L23 | 不需要密碼。 | [IA06](specs/identity-access/spec.md) | 4 |
| L24 | 透過選擇組別加入活動。 | [SP01](specs/student-participation/spec.md) | 9 |
| L25 | 每位學生設定自己的暱稱。 | [IA06](specs/identity-access/spec.md) | 4 |
| L26 | 作答及計分以組別為單位。 | [SR03](specs/submission-ranking/spec.md)、[AR03](specs/activity-results/spec.md) | 8／11 |
| L28 | 身分只在登入的瀏覽器分頁有效。 | [IA03](specs/identity-access/spec.md) | 4 |
| L29 | 重新整理及伺服器重啟後，身分仍然有效。 | [IA03](specs/identity-access/spec.md)、[PS01](specs/persistence-security/spec.md)、[RR04](specs/realtime-recovery/spec.md) | 4／3、4、13／7 |
| L30 | 關閉分頁後身分失效。 | [RR03](specs/realtime-recovery/spec.md) | 7 |
| L31 | 身分最長有效時間為 12 小時。 | [IA04](specs/identity-access/spec.md) | 4 |
| L32 | 伺服器必須驗證所有角色權限。 | [IA08](specs/identity-access/spec.md) | 4 |
| L35 | 活動包含四個階段： | [AL01](specs/activity-lifecycle/spec.md) | 5 |
| L37 | 尚未匯入 | [AL01](specs/activity-lifecycle/spec.md) | 5 |
| L38 | 待開始 | [AL01](specs/activity-lifecycle/spec.md) | 5 |
| L39 | 搶答進行中 | [AL01](specs/activity-lifecycle/spec.md) | 5 |
| L40 | 已結束 | [AL01](specs/activity-lifecycle/spec.md) | 5 |
| L42 | 匯入文件後進入待開始階段。 | [AL01](specs/activity-lifecycle/spec.md) | 5 |
| L43 | 老師開始搶答後，所有題目同時開放。 | [AL02](specs/activity-lifecycle/spec.md)、[SP04](specs/student-participation/spec.md) | 5／9 |
| L44 | 各組可以自由選擇題目作答。 | [AL02](specs/activity-lifecycle/spec.md)、[SP04](specs/student-participation/spec.md) | 5／9 |
| L45 | 老師結束搶答後，活動進入已結束階段。 | [AL01](specs/activity-lifecycle/spec.md) | 5 |
| L46 | 已結束的活動不可重新開啟。 | [AL01](specs/activity-lifecycle/spec.md) | 5 |
| L47 | 必須重新匯入文件才能開始新的一場。 | [AL01](specs/activity-lifecycle/spec.md) | 5 |
| L48 | 新活動會清除舊作答紀錄。 | [AL04](specs/activity-lifecycle/spec.md)、[IA09](specs/identity-access/spec.md) | 5／4 |
| L49 | 新活動要求所有學生重新選組。 | [AL04](specs/activity-lifecycle/spec.md)、[IA09](specs/identity-access/spec.md) | 5／4 |
| L50 | 活動階段改變時，所有分頁必須即時同步。 | [RR01](specs/realtime-recovery/spec.md) | 7 |
| L53 | 使用密碼登入老師帳號。 | [IA01](specs/identity-access/spec.md) | 4 |
| L54 | 提供登出功能。 | [IA02](specs/identity-access/spec.md) | 4 |
| L55 | 未登入的使用者不得執行老師操作。 | [IA08](specs/identity-access/spec.md) | 4 |
| L57 | 老師貼上 Google Sheets 網址。 | [GI01](specs/guided-notes-import/spec.md) | 6 |
| L58 | 老師設定組數，範圍為 2～20 組。 | [GI01](specs/guided-notes-import/spec.md) | 6 |
| L59 | 系統解析文件內容，自動找出題目及填空格。 | [GI03](specs/guided-notes-import/spec.md) | 6 |
| L60 | 支援單題及題組。 | [GI04](specs/guided-notes-import/spec.md)、[SR02](specs/submission-ranking/spec.md) | 6／8 |
| L61 | 一個題組視為一題，所有子題必須一起作答。 | [GI04](specs/guided-notes-import/spec.md)、[SR02](specs/submission-ranking/spec.md) | 6／8 |
| L62 | 文件格式錯誤時拒絕匯入，並提供繁體中文錯誤說明。 | [GI03](specs/guided-notes-import/spec.md) | 6 |
| L63 | 匯入失敗時，原本資料必須保持不變。 | [GI06](specs/guided-notes-import/spec.md) | 6 |
| L64 | 搶答進行中禁止匯入。 | [AL03](specs/activity-lifecycle/spec.md) | 5 |
| L65 | 活動已結束時重新匯入，必須先取得老師確認。 | [AL03](specs/activity-lifecycle/spec.md) | 5 |
| L67 | 老師可以點擊題號預覽題目敘述。 | [TC01](specs/teacher-console/spec.md) | 10 |
| L68 | 題組預覽必須列出所有子題。 | [TC01](specs/teacher-console/spec.md) | 10 |
| L69 | 再次點擊相同題號可以關閉預覽。 | [TC01](specs/teacher-console/spec.md) | 10 |
| L70 | 同一時間只能預覽一題。 | [TC01](specs/teacher-console/spec.md) | 10 |
| L71 | 預覽狀態只影響目前分頁。 | [TC01](specs/teacher-console/spec.md) | 10 |
| L73 | 老師可以開始搶答。 | [AL02](specs/activity-lifecycle/spec.md) | 5 |
| L74 | 開始後所有題目同時開放。 | [AL02](specs/activity-lifecycle/spec.md) | 5 |
| L75 | 老師結束活動前必須再次確認。 | [AL02](specs/activity-lifecycle/spec.md) | 5 |
| L76 | 活動結束後不可重新開始。 | [AL01](specs/activity-lifecycle/spec.md) | 5 |
| L78 | 開始搶答後計時器持續運作。 | [AL05](specs/activity-lifecycle/spec.md) | 5 |
| L79 | 結束後停止並保留總時長。 | [AL05](specs/activity-lifecycle/spec.md) | 5 |
| L80 | 重新整理或開啟其他分頁，必須顯示正確時間。 | [AL05](specs/activity-lifecycle/spec.md) | 5 |
| L81 | 計時依據伺服器保存的活動開始及結束時間。 | [AL05](specs/activity-lifecycle/spec.md) | 5 |
| L83 | 即時顯示每題各組提交狀況。 | [TC03](specs/teacher-console/spec.md) | 10 |
| L84 | 依伺服器收到提交的先後順序排名。 | [SR04](specs/submission-ranking/spec.md) | 8 |
| L85 | 顯示名次、組別及提交者暱稱。 | [TC03](specs/teacher-console/spec.md) | 10 |
| L86 | 第一名顯示「搶答成功」。 | [TC03](specs/teacher-console/spec.md) | 10 |
| L87 | 每筆提交可以查看提交時間。 | [TC03](specs/teacher-console/spec.md) | 10 |
| L88 | 活動結束後保留所有組別答案。 | [TC04](specs/teacher-console/spec.md) | 10 |
| L89 | 沒有任何組別作答的題目顯示「無人搶答」。 | [TC04](specs/teacher-console/spec.md) | 10 |
| L91 | 只有活動結束後才能匯出。 | [GE01](specs/guided-notes-export/spec.md)、[GE02](specs/guided-notes-export/spec.md) | 12 |
| L92 | 將每題搶答成功組別的答案寫回原始文件填空格。 | [GE01](specs/guided-notes-export/spec.md)、[GE02](specs/guided-notes-export/spec.md) | 12 |
| L93 | 其他原始文件內容必須保持不變。 | [GE03](specs/guided-notes-export/spec.md)、[GE05](specs/guided-notes-export/spec.md)、[GE06](specs/guided-notes-export/spec.md)、[GE08](specs/guided-notes-export/spec.md) | 12 |
| L94 | 支援三種匯出模式： | [GE03](specs/guided-notes-export/spec.md)、[GE04](specs/guided-notes-export/spec.md)、[GE05](specs/guided-notes-export/spec.md) | 12 |
| L95 | 只有答案。 | [GE03](specs/guided-notes-export/spec.md)、[GE04](specs/guided-notes-export/spec.md)、[GE05](specs/guided-notes-export/spec.md) | 12 |
| L96 | 答案＋組別時間欄，額外增加組別、提交時間、送出者三欄。 | [GE03](specs/guided-notes-export/spec.md)、[GE04](specs/guided-notes-export/spec.md)、[GE05](specs/guided-notes-export/spec.md) | 12 |
| L97 | 答案＋格內附註行，在答案下方以灰色小字記錄組別、送出者及時間。 | [GE03](specs/guided-notes-export/spec.md)、[GE04](specs/guided-notes-export/spec.md)、[GE05](specs/guided-notes-export/spec.md) | 12 |
| L98 | 可以重複匯出，結果必須一致。 | [GE06](specs/guided-notes-export/spec.md) | 12 |
| L99 | 如果有任何一題在文件中找不到對應位置，整次匯出不得寫入任何資料。 | [GE07](specs/guided-notes-export/spec.md) | 12 |
| L102 | 第一次進入系統時設定暱稱。 | [IA06](specs/identity-access/spec.md) | 4 |
| L103 | 預設產生隨機英文名字。 | [IA06](specs/identity-access/spec.md) | 4 |
| L104 | 提供更換隨機名字功能。 | [IA06](specs/identity-access/spec.md) | 4 |
| L105 | 學生可以自行修改暱稱。 | [IA06](specs/identity-access/spec.md) | 4 |
| L106 | 暱稱長度為 1～20 字。 | [IA07](specs/identity-access/spec.md) | 4 |
| L107 | 暱稱可以重複。 | [IA06](specs/identity-access/spec.md) | 4 |
| L108 | 重新整理後保留暱稱。 | [IA06](specs/identity-access/spec.md) | 4 |
| L109 | 加入組別後必須先離開組別才能修改暱稱。 | [IA06](specs/identity-access/spec.md) | 4 |
| L111 | 老師尚未匯入文件時顯示等待訊息。 | [SP01](specs/student-participation/spec.md) | 9 |
| L112 | 匯入後顯示所有可加入組別。 | [SP01](specs/student-participation/spec.md) | 9 |
| L113 | 即時顯示各組已加入人數。 | [SP01](specs/student-participation/spec.md) | 9 |
| L115 | 顯示目前組別。 | [SP03](specs/student-participation/spec.md) | 9 |
| L116 | 顯示自己的暱稱。 | [SP03](specs/student-participation/spec.md) | 9 |
| L117 | 顯示活動階段。 | [SP03](specs/student-participation/spec.md) | 9 |
| L118 | 顯示與老師端同步的搶答計時。 | [SP03](specs/student-participation/spec.md) | 9 |
| L119 | 顯示目前組別所有成員。 | [SP03](specs/student-participation/spec.md) | 9 |
| L120 | 標示目前登入的學生。 | [SP03](specs/student-participation/spec.md) | 9 |
| L121 | 只有待開始階段可以離開組別及更換組別。 | [SP02](specs/student-participation/spec.md) | 9 |
| L122 | 關閉分頁後約 30 秒將學生從成員名單移除。 | [RR03](specs/realtime-recovery/spec.md) | 7 |
| L123 | 重新整理不得重複計算人數。 | [SP03](specs/student-participation/spec.md) | 9 |
| L125 | 待開始階段只顯示題號。 | [SP04](specs/student-participation/spec.md) | 9 |
| L126 | 搶答開始後才顯示題目敘述。 | [SP04](specs/student-participation/spec.md) | 9 |
| L127 | 所有題目同時顯示。 | [SP04](specs/student-participation/spec.md) | 9 |
| L128 | 學生可以自由選擇任一題作答。 | [SP04](specs/student-participation/spec.md) | 9 |
| L129 | 題組必須填寫所有子題才能提交。 | [SR02](specs/submission-ranking/spec.md) | 8 |
| L130 | 每個答案長度必須為 1～200 字。 | [SR01](specs/submission-ranking/spec.md) | 8 |
| L131 | 不得提交空白答案。 | [SR01](specs/submission-ranking/spec.md) | 8 |
| L132 | 每組每題只能提交一次。 | [SR03](specs/submission-ranking/spec.md) | 8 |
| L133 | 提交後不得修改。 | [SR03](specs/submission-ranking/spec.md) | 8 |
| L134 | 同組其他學生畫面即時顯示「已送出（送出者）」。 | [SP06](specs/student-participation/spec.md) | 9 |
| L135 | 活動結束前不得看到名次。 | [AR01](specs/activity-results/spec.md)、[AR02](specs/activity-results/spec.md) | 11 |
| L136 | 活動結束前不得看到其他組別作答狀況。 | [AR01](specs/activity-results/spec.md)、[AR02](specs/activity-results/spec.md) | 11 |
| L137 | 尚未提交的輸入內容在重新整理後必須保留。 | [SP05](specs/student-participation/spec.md) | 9 |
| L139 | 活動結束後自動切換結果畫面。 | [SP07](specs/student-participation/spec.md) | 9 |
| L140 | 列出每題搶答成功的組別、答案及提交者。 | [AR02](specs/activity-results/spec.md) | 11 |
| L141 | 顯示本組每題成績： | [AR03](specs/activity-results/spec.md) | 11 |
| L142 | 本組搶答成功 | [AR03](specs/activity-results/spec.md) | 11 |
| L143 | 已送出，未搶到 | [AR03](specs/activity-results/spec.md) | 11 |
| L144 | 本組未作答 | [AR03](specs/activity-results/spec.md) | 11 |
| L145 | 顯示本組搶答成功的題數。 | [AR03](specs/activity-results/spec.md) | 11 |
| L146 | 不得顯示其他組別未搶到的答案。 | [AR02](specs/activity-results/spec.md)、[AR05](specs/activity-results/spec.md) | 11 |
| L148 | 老師開始新活動時，學生身分自動失效。 | [AL04](specs/activity-lifecycle/spec.md)、[IA09](specs/identity-access/spec.md) | 5／4 |
| L149 | 身分過期時自動回到選組畫面。 | [IA09](specs/identity-access/spec.md) | 4 |
| L150 | 清楚說明身分失效原因。 | [IA09](specs/identity-access/spec.md) | 4 |
| L151 | 保留學生暱稱。 | [IA09](specs/identity-access/spec.md) | 4 |
| L154 | 所有權限由伺服器驗證。 | [IA08](specs/identity-access/spec.md) | 4 |
| L155 | 學生只能取得自己組別的作答資料。 | [AR01](specs/activity-results/spec.md)、[AR02](specs/activity-results/spec.md) | 11 |
| L156 | 活動結束前，學生不得取得其他組別的作答資料。 | [AR01](specs/activity-results/spec.md)、[AR02](specs/activity-results/spec.md) | 11 |
| L157 | 伺服器不得將其他組別資料傳送給學生。 | [AR01](specs/activity-results/spec.md)、[AR02](specs/activity-results/spec.md) | 11 |
| L158 | 老師與學生權限必須明確區隔。 | [IA08](specs/identity-access/spec.md) | 4 |
| L160 | 以伺服器收到提交的順序判定名次。 | [SR04](specs/submission-ranking/spec.md) | 8 |
| L161 | 不採用客戶端時間作為排名依據。 | [SR04](specs/submission-ranking/spec.md) | 8 |
| L162 | 多組同時提交時，只能有一組取得第一名。 | [SR04](specs/submission-ranking/spec.md) | 8 |
| L163 | 每組每題只能成功提交一次。 | [SR03](specs/submission-ranking/spec.md) | 8 |
| L165 | 活動階段即時同步。 | [RR01](specs/realtime-recovery/spec.md) | 7 |
| L166 | 組別人數即時同步。 | [RR01](specs/realtime-recovery/spec.md) | 7 |
| L167 | 組別成員名單即時同步。 | [RR01](specs/realtime-recovery/spec.md) | 7 |
| L168 | 作答提交狀況即時同步。 | [RR01](specs/realtime-recovery/spec.md) | 7 |
| L169 | 計時器在各分頁保持一致。 | [RR02](specs/realtime-recovery/spec.md) | 7 |
| L171 | 斷線後自動重新連線。 | [RR05](specs/realtime-recovery/spec.md)、[RR06](specs/realtime-recovery/spec.md) | 7 |
| L172 | 重新連線後回到正確畫面。 | [RR05](specs/realtime-recovery/spec.md)、[RR06](specs/realtime-recovery/spec.md) | 7 |
| L173 | 伺服器重啟後保留題目。 | [PS01](specs/persistence-security/spec.md) | 3、4、13 |
| L174 | 伺服器重啟後保留作答紀錄。 | [PS01](specs/persistence-security/spec.md) | 3、4、13 |
| L175 | 伺服器重啟後保留名次。 | [PS01](specs/persistence-security/spec.md) | 3、4、13 |
| L176 | 各分頁不需要重新操作即可恢復。 | [RR05](specs/realtime-recovery/spec.md)、[RR06](specs/realtime-recovery/spec.md) | 7 |
| L178 | 所有使用者可見錯誤訊息使用繁體中文。 | [PS07](specs/persistence-security/spec.md) | 3、4、13 |
| L179 | 錯誤訊息必須容易理解。 | [PS07](specs/persistence-security/spec.md) | 3、4、13 |
| L180 | 不得向使用者暴露內部程式細節、資料庫錯誤或敏感資訊。 | [PS07](specs/persistence-security/spec.md) | 3、4、13 |
| L182 | 本系統以本機執行為主要環境。 | [RR07](specs/realtime-recovery/spec.md) | 7 |
| L183 | 必須支援同一台電腦的多瀏覽器分頁測試。 | [RR07](specs/realtime-recovery/spec.md) | 7 |
| L184 | 老師及多個學生分頁必須能同時操作。 | [RR07](specs/realtime-recovery/spec.md) | 7 |
| L185 | 所有搶答結果以伺服器資料為準。 | [SR04](specs/submission-ranking/spec.md)、[PS01](specs/persistence-security/spec.md) | 8／3、4、13 |
| L186 | 所有功能必須經過測試與驗收。 | [PS08](specs/persistence-security/spec.md) | 3、4、13 |
| L187 | 不得自行刪減上述功能。 | [PS08](specs/persistence-security/spec.md) | 3、4、13 |
| L188 | 若需求有不明確之處，應先提出問題並記錄決策，不得擅自假設。 | [PS08](specs/persistence-security/spec.md) | 3、4、13 |

### 人工審查補充的需求對應

| 新增需求 | 來源修訂 | 情境與任務 |
|---|---|---|
| RR08 | R06／D37 | 固定負載與背景量測情境；1.6、13.3 |
| GE14 | R02／D33 | 永久無法核對、取消或新匯入失敗、已知未寫入與未知區分；12.8～12.10、12.12 |
| GE15 | R02／D33 | 未核實文件重用、舊操作晚到；3.4、12.11、12.12、13.4 |

### 修訂後規劃檢查結果（2026-11-26）

- 保留原需求 152 個內容列及原文字，逐條來源對照仍完整；原需求 SHA-256 未變。
- 目前為 10 份新能力、78 個 ADDED Requirements、119 個 Given／When／Then 情境、13 群組 85 個未勾選任務；每需求至少一情境及一任務引用，每任務都有完成條件。
- 原 D01～D31 保留，新增 D32～D37 對應已確認修訂方向；具體工程驗收配置與未確認政策分開記錄。
- R02、R04、R05 已補文件契約與依賴；R01 保留 G1 可行性關卡，R03 保留 G2／U01，R06 有固定程序但 U02 分類及實機驗證尚未完成。不能宣稱六項風險全部經實驗關閉。
- 原審查報告為修訂前版本，維持原內容；本次沒有改原需求、審查報告、設定、中繼資料或實作檔。
- 本次只完成規劃修訂與格式／引用／來源一致性檢查；未執行 Apply、G1／G2 實驗、功能／負載測試、Google 授權或寫入。最終 CLI 嚴格驗證結果以本次工具輸出為準。
