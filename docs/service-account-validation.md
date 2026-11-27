# 服務帳戶替代OAuth驗證

Change：replace-google-oauth-with-service-account；分支：codex/service-account-sheets。

本輪依使用者明確決策移除個人OAuth介面、端點、client JSON載入／refresh token與vault實作，保留磁碟原憑證、google_connection表及schema v3。服務帳戶使用Google標準伺服器JWT/token授權，不是匿名寫入。原始需求、11份主規格、既有歸檔與D41歷史失敗不修改。

## 規格與37情境對照

| 需求 | 情境 | 驗證來源 |
|---|---|---|
| GI01 | 組數邊界 | imports／public-imports整合及teacher Chrome，2／20合法，1／21／非整數／缺值拒絕 |
| GI01 | 文件不可讀 | gateway與公開reader傳輸錯誤、舊活動保持測試 |
| GI01 | 公開模式免Google登入 | public-imports整合、public-import Chrome及真實公開API |
| GI01 | 服務帳戶讀取私有文件 | imports整合及真實檢視者私有副本完整匯入6題6欄 |
| GI01 | 舊授權請求明確退出 | google退出整合與imports明確方式檢查 |
| GI01 | 保留原授權匯入 | 原格式／原子性測試改為服務帳戶；舊OAUTH拒絕，不保留個人連結功能 |
| GI08 | 公開唯讀學習單 | public-imports整合、public-import Chrome、公開API完整範本讀取 |
| GI08 | 私有文件或公開讀取未就緒 | public-sheets單元／public-imports整合：缺key、外部錯誤及不fallback |
| GI08 | 發布網址與原表網址區分 | URL單元與公開整合拒絕pubhtml／CSV／其他主機，UI說明原表公開 |
| GI09 | 公開讀取與服務帳戶配置獨立 | PUBLIC在null服務帳戶成功，錯誤不清老師或其他憑證 |
| GI09 | 服務帳戶候選失效與權限變動 | imports整合：登出、期限、版本、開始競爭；重啟記憶體意圖失效 |
| GI09 | 不暗中更換讀取身分 | 明確方式／select／commit白名單、他人token拒絕與不fallback |
| GI09 | 公開讀取期間解除Google連結 | 舊解除端點404，PUBLIC不使用OAuth；退役及公開獨立案例 |
| GI09 | OAuth讀取期間解除連結 | 舊OAUTH請求拒絕、端點退役、重啟不載入舊憑證；不延續舊意圖 |
| GE01 | 階段與權限 | exports整合與HTTP：學生／未結束／缺方式／缺配置拒絕 |
| GE01 | 私有文件無個人Google連結寫回 | 服務帳戶Chrome無個人連結完成原表三模式；真實兩副本12批寫入核對；私有查看副本只匯入不寫入 |
| GE01 | 服務帳戶只有查看權限 | 真實私有檢視者副本可讀、Google明確拒絕空寫入批次，不改儲存格 |
| GE12 | 外部已寫入但回覆遺失 | 原exports／export-crash真程序SIGKILL與只讀核對，不重送 |
| GE12 | 寫入前後故障分類 | service-account gateway傳輸：4xx明確拒絕／5xx、逾時、非法回覆未知 |
| GE14 | 原文件永久無法核對後建立新活動 | 原exports及Chrome放棄確認、文件鎖與新場未核實隔離 |
| GE14 | 取消放棄或新文件匯入失敗 | 原exports／activity-replacement及Chrome，不提前清場 |
| GE14 | 已確認沒有寫入與結果不明分開顯示 | exports／export-crash：PREPARING、WRITING、未送出與回覆遺失狀態 |
| GE16 | 明確的新寫回與重送識別 | exports：accessMode、requestId、固定access、取消／失敗仍保存 |
| GE16 | 舊OAuth未知結果遷移 | exports legacy缺access需ack，吻合完成，缺計畫／不符未知；Chrome明確確認只讀 |
| GE16 | 重啟與帳戶更換 | exports新帳戶需ack、同帳戶新金鑰不需ack；真SIGKILL計畫及access恢復 |
| PS03 | 舊資料不可查但文件仍可重用 | 原activity-replacement／exports及同檔重啟，不修改原活動契約 |
| PS03 | 未核實標記跨重啟保存 | exports／export-crash／startup，換帳戶不解除未核實保護 |
| PS04 | 首次授權與權限不足 | service-account配置／傳輸測試與真實viewer拒寫，不提供個人OAuth |
| PS04 | 公開匯入與私有資料隔離 | public-imports及acceptance-security真HTTP，學生／匿名／偽造角色與錯分頁拒絕 |
| PS04 | 公開可編輯不代表可匿名寫回 | public-import Chrome：服務帳戶缺配置時拒寫，CSV可下載；真實服務帳戶實際權限裁定 |
| PS06 | 憑證撤銷或過期 | JWT快取／併發更新／失效清快取、gateway401／403與未知寫入分類 |
| PS06 | 公開金鑰不洩漏 | canary及固定URL／header、原投影、HTTP錯誤／日誌遮蔽；實際key與私鑰不得進前端或版控 |
| PS06 | 兩種存取方式錯誤獨立 | public-imports及imports錯誤不fallback／不清另一配置及老師 |
| PS06 | 公開讀取錯誤與OAuth狀態獨立 | 舊憑證已退役且不讀，公開錯誤不影響服務帳戶，明確重選才讀 |
| PS09 | 老師共用服務帳戶 | sheets/status HTTP、服務帳戶Chrome與其他老師登出互不影響 |
| PS09 | 未配置與非法憑證檔 | config單元及正式啟動：缺檔／錯JSON／OAuth JSON／非法key／symlink／0600 |
| PS09 | 舊OAuth端點與磁碟資料 | 舊路由404、舊JSON不刪、啟動檔案讀取spy、原google_connection參照保持 |

## OAuth測試替代與例外

原12項Google整合與1項OAuth Chrome流程依已確認決策退出，不能再要求連結成功。舊設定型態／scope／錯憑證驗證改由service-account-config及JWT測試；state／PKCE／callback／取消／解除改為舊端點404且不使用舊憑證；共用與登出改為共用Email及本機角色隔離；並行refresh／撤銷改為token記憶體更新／失效；GET端點、錯誤與I/O後再驗身分移至gateway整合；HTTP／學生保護移至status與acceptance-security。相關舊原子性、文件鎖及未知結果保護仍由新匯入／寫回／故障測試覆蓋，不以跳過測試冒稱功能保持。

舊未指定匯入／寫回方式及OAUTH明確拒絕，必須更新頁面。舊UNKNOWN或換帳戶需額外確認才能只讀核對；原恢復計畫缺失或不吻合仍未知，可依原流程放棄而保留未核實範圍。OAuth憑證檔／原授權不自動刪除／撤銷；本輪不更改真實Google分享。兩份可寫副本已依授權寫入測試答案，原始兩範本未寫入。

## 真實Google結果

`docs/evidence/service-account-live.json`：不載入OAuth，不接觸正式SQLite。兩份已授權副本分別6題6欄與4題6欄，每份三模式及重複共6批，合計12批；每次讀回核對，其他工作表不變；CSV包含真提交與UTF8 BOM。另提供的私有檢視者副本，公開API拒絕而服務帳戶可完整匯入6題6欄；Google拒絕空寫入批次，未修改其內容。公開原始範本僅GET讀取且解析成功。

此真實探針使用正式服務層；Chrome及跨分頁HTTP流程使用隔離傳輸替身，兩者證據分列，不宣稱真實Google提供本機分頁身分認證。

## 自動化狀態

第一次全套並行測試遇到故障注入子程序／Chrome啟動逾時，已保留失敗及中斷紀錄；不將其當成功。為避免多套重型測試相互競爭，npm test改為單檔序列執行；沒有放寬原逾時、功能斷言或D41以外門檻。序列全套163項曾全部通過，後續新增token失效及同帳戶輪替兩項將再完整回歸。第二次Chrome發現匯入選項文字已更新但HTML值仍為OAUTH，手動選SERVICE_ACCOUNT逾時；已修正為正確值，保留失敗證據並重跑。Chrome全套及最新最終數量待執行完成後補記。


## 最終驗證結果

- 型別與建置通過；原生Chrome完整24／24通過，正式啟動1／1通過。
- 單元／整合完整165／165通過；相較原166項，12項OAuth案例改為2項退出／權限案例，新增服務帳戶載入1項、JWT3項、gateway1項及匯出身分／legacy4項，淨減1項但原保護功能有替代對照。最後另補驗預設Compute／App Engine服務帳戶Email格式，設定目標測試通過。
- schema維持3，啟動以檔案讀取spy確認未讀舊OAuth／vault，保留磁碟原檔、舊連結參照與未核實管理資訊；原業務及故障／競爭案例持續通過。
- 原始需求SHA256保持`498bc69163997b0570963f4712d7196edd1f9e39590ec05d51e884aaa4e2f413`。原始152項內容全部對應，歷史基準78需求／122情境／41決策；本Change37情境另見上表。
- Strict Validate通過；CLI仍提醒前置GI08尚未同步主規格，不能直接歸檔。本輪不執行同步／歸檔，後續順序先公開匯入、再本Change。
- 實際API key與私鑰未出現在前端產物；.env與data服務帳戶JSON均由Git忽略。最終提交前已掃描暫存差異，未發現實際API key、私鑰或其JSON跳脫文字，不輸出敏感內容。

全部失敗、中斷、修正與最終成功紀錄在`docs/evidence/service-account-logs/`；未以模擬測試替代真實Google結果，未重寫舊效能失敗數據或聲稱D41原目標達標。

提交前另確認tsc會保留被刪除來源的舊編譯檔，已在build先清除dist/server再編譯；啟動測試新增斷言google／google-http／google-vault三個舊輸出不存在。此清理不接觸data、備份或憑證，重新建置與正式啟動1／1通過。
