# Design

## Context

動機與使用者確認範圍見proposal.md。本輪所稱移除OAuth指「老師個人帳號同意、連結與refresh token流程」；服務帳戶仍須使用Google標準伺服器憑證取得access token，不是匿名寫入。

目前 `ImportService` 已有PUBLIC／OAUTH意圖與外部I/O前後的老師／版本檢查；`ExportService` 雖有ExportIO接縫，begin仍直接依賴GoogleService的OAuth連結。前端main以googleReady控制匯入／匯出，GoogleConnection每兩秒查連結。故只換前端文案或注入write函式不足以完成替代。

現有schema v3的export_operations.recovery_plan_json可保存恢復計畫，google_connection保存OAuth參照；來源snapshot不含存取身分，公開／服務帳戶匯入不需更換題目模型。google-auth-library 11.3.4已提供JWT客戶端。現有166項單元／整合、24項Chrome及1項啟動為變更前證據，包含即將明確退出的OAuth正向案例。

公開匯入Change尚未同步主規格。此處GI08／GI09及相關PS規則以前置Change的完成版本為基準；必須先同步公開匯入，再同步本Change，不可倒序造成舊OAuth規則覆寫新規則。Propose不執行同步或歸檔。

## Goals / Non-Goals

**Goals:** 保留本機老師權限與既有資料，以單一服務帳戶存取共用文件，公開只讀獨立；寫回維持現有planExport、全批寫入及恢復語意，舊操作可安全退出OAuth。

**Non-Goals:** 不自動建立Cloud資源、上傳憑證、變更共用、網域全權委派或新增Google Drive管理scope；不提供個人OAuth備援，不刪除歷史證據或放寬D41以外的功能驗收。

## Decisions

### 1. 本機服務帳戶設定與token生命週期

新增可選 `GOOGLE_SERVICE_ACCOUNT_FILE`，預設 `APP_DATA_DIR/google-service-account.json`；公開 `GOOGLE_SHEETS_API_KEY` 保留。啟動時以realpath驗證不位於src／dist／node_modules，含symlink解析；檔案須為type=service_account、合法client_email及可解析的私鑰，後端存取權限限制0600。缺值／缺檔／內容錯誤不阻止服務啟動，但安全停用服務帳戶方式；錯誤不輸出憑證或路徑。

以既有google-auth-library的JWT能力及必要的spreadsheets scope取得token，使用驗證後的email／private_key建立客戶端；不採用檔案提供的任意token_uri、不設定subject委派、不要求openid／email或Drive scope。憑證只在啟動讀取，輪替後正常重啟；access token只在記憶體快取，併發更新合併，失敗回安全錯誤，不另存SQLite或vault。

服務帳戶Email可作非機密帳戶識別；操作固定該識別，輪替同帳戶金鑰仍可核對，換不同Email須依GE16明確確認。檔案格式正確的configured不等於Google已接受token，更不等於對任意文件可寫。

替代方案：API key不能寫回；個人OAuth已明確退出；Apps Script需額外部署／執行身分且非本輪方案。服務帳戶需每份文件共用，這是操作成本，不以公開可編輯繞過。

官方依據：[Google服務帳戶與共用設定](https://developers.google.com/workspace/guides/create-credentials)、[服務帳戶伺服器授權](https://developers.google.com/identity/protocols/oauth2/service-account)。實際Google存取仍須另行真實驗證。

### 2. Sheets傳輸與本機授權分離

以單一服務帳戶Sheets gateway取代GoogleService／GoogleOAuthProvider的業務接線，公開reader保持獨立。gateway提供狀態／accountId、完整spreadsheet讀取、batchUpdate；每次存取在token取得及外部I/O前後驗證有效本機老師，不接受客戶端role、帳戶Email、token、private key或上游主機。

只使用固定Sheets REST端點、驗證spreadsheet ID、固定Google token端點、20秒Sheets逾時、禁止外部重新導向。401／403／404／429／非法JSON／token錯誤轉安全繁體中文。read與write的故障邊界分離：尚未送出或明確拒絕可用ExportWriteRejected表示未寫入；已送出後的逾時、5xx、非法回覆或授權失效屬結果未知，不能包成確定失敗。避免修改目前三模式計畫及格式／文字安全演算法。

### 3. HTTP與老師介面

| 路由 | 新契約 |
|---|---|
| GET /api/sheets/status | 本機老師限定，僅configured／安全狀態及accountEmail；不回檔案路徑或token |
| GET /api/imports/options | 老師限定，publicConfigured與serviceAccountConfigured；兩者獨立，不做任意文件權限保證 |
| POST /api/imports/inspect | 必填accessMode=PUBLIC或SERVICE_ACCOUNT；其他輸入不變，舊OAUTH／省略拒絕並明確提示重新選擇 |
| POST /api/activities/:id/exports | 明確accessMode=SERVICE_ACCOUNT，原requestId／mode／paused／expectedVersion保留；缺方式或OAUTH拒絕，source仍由活動取得 |
| POST /api/operations/:id/reconcile | 仍只讀；舊OAuth或換帳戶時須額外acknowledgeCredentialChange=true確認，其他原核對可用空body |
| /api/google/status、connect、connection、callback | 移除原路由，不再提供OAuth或解析回呼；未匹配路由依既有404／安全錯誤處理，不回token／登入資訊 |

師生、分頁proof、到期、host／origin、query及body白名單檢查保持；外部I/O不占共用命令佇列。狀態只供老師，學生與匿名不得取得共用Email管理資訊。

GoogleConnection改為「學習單存取設定」，顯示服務帳戶Email、複製／共用為查看者或編輯者的操作說明與配置狀態，移除連結／解除／前往Google授權。匯入有兩種明確選項，配置服務帳戶時預選該方式，否則預選公開；手動選擇／預覽中不因狀態更新換方式。候選須取消才能重選。

匯出不再由googleReady控制，依服務帳戶配置、ENDED、busy／未知操作與D31確認啟用；實際寫入權限由Google裁定。舊操作或帳戶不同時，在核對前顯示目前Email及「僅讀核對、不重送」確認。CSV不依賴上述設定。

### 4. 匯入與持久化模型

沿用現有意圖token及10分鐘／老師期限上限、sessionId、活動版本、abandonmentToken；模式改為PUBLIC／SERVICE_ACCOUNT，服務帳戶意圖固定帳戶識別。沒有OAuth epoch依賴；重啟後未提交的記憶體意圖仍失效，已提交活動來源snapshot與題目不變。

全部題目／合併／原內容／格式先完整解析，最後再驗證老師、版本、狀態與確認後原子替換；保持單題、混合題組、gid、多表及2～20組完整契約。已完整取得的合法候選不因後續分享撤回而追溯改成未讀取，但後續讀寫仍須重新向Google存取。

新匯出在recovery_plan_json增加非機密access={mode:SERVICE_ACCOUNT,accountId}，從PREPARING持續保存至FAILED／WRITING／UNCONFIRMED／COMPLETED及取消。save與plan更新必須保留此欄位，不能被新plan覆蓋遺失；requestId重送核對mode與固定access，不可改成新寫入。

缺access的既有操作分類為LEGACY_OAUTH，不猜成SERVICE_ACCOUNT。舊COMPLETED／FAILED只顯示歷史狀態；重啟的PREPARING按既有未送出契約FAILED，WRITING轉UNCONFIRMED。舊／換帳戶的UNCONFIRMED只能在有效老師明確確認後，以現行服務帳戶GET原表對原計畫比對；吻合則完成，不吻合仍未知，不建立新批次、不載入舊OAuth憑證。放棄確認、文件鎖、換場、未核實隔離保持。

保留schema v3及舊google_connection／vault檔案而不讀取憑證或使用授權，不修改既有migration checksum。除非實作發現上述JSON策略不可行，否則不新增migration；若需改schema須先回報設計問題，不自行刪表。原業務表與序號高水位不因切換憑證重置。

### 5. 測試與驗收

配置／JWT測試包含缺檔、錯JSON／OAuth JSON、非法私鑰、symlink公開路徑、Google token錯誤、快取與併發更新；canary不得出現在網址、學生封包、錯誤、日誌與前端產物。只用合成私鑰與mock token，不把真實key納入測試夾具。

HTTP與整合涵蓋兩模式固定、無OAuth的私有匯入、單題／混合題組、gid／多表、來源答案隔離、原子替換、競爭／到期／登出、非法模式與任意上游拒絕。寫回覆蓋三模式3×3切換／重複、D31、全題／人工變更、4xx明確拒絕與已送出回覆遺失、進程重啟、身分變更、舊操作只讀核對／放棄／新場未核實隔離。

原OAuth正向測試因確認移除改為「舊端點不再提供功能、舊JSON／vault未讀、舊請求不靜默換身分」測試，不以跳過檔案或只刪測試代替驗證；其原本共享的身分、原子性與未知結果保護移至服務帳戶案例。原始歸檔驗收保持歷史證據。

Chrome驗證Email提示、兩種匯入與錯誤、無個人Google連結的學生→結果→CSV→三模式寫回（模擬傳輸），舊OAuthUI不再出現；完整原功能回歸及正式啟動保存。最後必須用隔離SQLite、空舊OAuth、真正服務帳戶與兩份明確授權可寫副本，完成單題／題組匯入、真實三模式切換／重複與讀回核對、僅查看者無法寫入、公開匯入仍可用；禁止寫原始範本。缺配置／未共用／失敗時不得勾選真實驗證或合併。

## Risks / Trade-offs

- [Workspace或學校限制外部共用／服務帳戶key] → 設定文件說明組織限制，真實驗收先確認；不加入網域委派或OAuth備援，若環境禁止則回報阻礙。
- [私鑰外洩] → 後端檔案0600、realpath限制、忽略版控、不接受網頁上傳與任意token端點；部署前由管理者建立與輪替，不在聊天貼key。
- [公開只讀不代表服務帳戶可寫] → UI明確區分，Google實際回應裁定； protected range亦可能拒絕，不能先宣稱可寫。
- [舊未知操作被當成新寫入] → 保留access／legacy標記，明確確認後只讀核對；無法確認可放棄且保留未核實隔離，不以更換身分清場。
- [使用舊客戶端] → OAUTH及缺accessMode拒絕並說明重新選擇；不以相容性名義靜默改用服務帳戶。
- [兩個Change覆蓋順序] → 本Change文檔明示依賴，先同步公開匯入再本Change；不回改已完成提案及歸檔。

## Migration Plan

1. 本輪只建立提案，保留新分支；下一輪明確Apply後才改程式。
2. 管理者建立服務帳戶與JSON至忽略版控的本機路徑，啟用Sheets API；老師共用明確測試副本。設定步驟在Apply建立，未知檔案路徑／測試ID是配置待辦，不是已完成事實。
3. 在隔離環境加入新gateway、改匯入／寫回及UI，再移除個人OAuth接線與端點。保留舊token檔與schema但不使用；不在啟動時刪資料或修改Google共用。
4. 用真SQLite升級／重啟驗證現場資料及legacy操作，完成全部自動化及真實服務帳戶驗收後才commit／push／合併；未過不合併。
5. 本Change同步／歸檔時依前置順序處理，須另依流程授權。原始requirements及已歸檔資料不改。
6. 回退保留資料與舊憑證，切回舊程式即可恢復舊OAuth接線；新服務帳戶操作未知結果須先以新版本核對／放棄並備份，不能讓不識別access的新舊程式交錯重送。新版本對新增JSON欄位的寫回相容須測試，不承諾任意舊版都能安全核對新操作。
