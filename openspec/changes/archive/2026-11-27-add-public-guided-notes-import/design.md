# Design

## Context

現有 `ImportService` 的 begin／check 均要求 Google 連結版本有效，所有讀取也經 `GoogleService.spreadsheet` 取得 OAuth token；前端匯入按鈕由 googleReady 控制。因此只移除前端限制無法實現公開匯入。

`parseGuidedNotes` 依賴工作表合併範圍、儲存格、原內容與必要格式；原讀取分兩步取得工作表清單及指定表 B:K 的完整資料。`ImportService` 已處理意圖綁定老師、到期、活動版本、選表及確認；`ActivityService`／SQLite 已提供原子替換與未核實匯出保護。本次沿用這些契約。

本輪檢查發現 `.env` 尚無已配置的 GOOGLE_SHEETS_API_KEY，未輸出任何密鑰。真實公開 API 驗證須於後續 Apply 配置；不能把目前 OAuth JSON 當 API key。分支從34f13ab建立，預設分支與現行服務程式保持原樣。

## Goals / Non-Goals

**Goals:**

- 同一匯入流程支援公開及OAuth模式，保持現有解析、確認與資料保護。
- 公開模式不依賴老師Google帳號；寫回與私有文件仍沿用原授權。
- 模擬、真實公開API與OAuth回歸證據分列，通過後才合併功能分支。

**Non-Goals:**

- 不支援匿名寫回、服務帳戶、發布網址反查、純CSV替代解析器或自動爬取。
- 不新增schema、套件、跨活動歷史或部署架構，不更動D41政策。
- 不讓公開讀取繞過本機老師登入、意圖所有權、期限或資料可見性。

## Decisions

### 1. 後端新增獨立公開 reader

增加可選環境變數 `GOOGLE_SHEETS_API_KEY`，由後端啟動時讀取，不傳前端。新增公開Sheets reader，只向固定 `https://sheets.googleapis.com/v4/spreadsheets/<經驗證ID>` 發GET，使用 `X-Goog-Api-Key` 標頭，重用目前 fields／ranges 需求並取得合併及原格式；不送OAuth Authorization／cookies，不把金鑰放網址、回應或日誌。沿用20秒逾時與安全外部錯誤映射，不接受用戶指定任意上游主機或憑證。

選擇API reader而非發布CSV／網頁爬取，是因為後兩者無法可靠提供目前解析及後續寫回檢查所需的合併與格式。採後端header而非前端API key，是為了保留既有老師授權邊界並避免憑證出現在前端與URL。

官方依據：公開分享資料可使用 [API key](https://developers.google.com/workspace/guides/create-credentials)；[Google系統參數](https://docs.cloud.google.com/apis/docs/system-parameters)定義 X-Goog-Api-Key。API key 的實際服務支援、權限及公開原表讀取仍須真實測試，不以文件推論代替驗證。

缺金鑰視為「公開模式未配置」，服務仍可啟動，原OAuth不受影響。區分未配置、無效／受限金鑰、文件不可讀、格式不符與暫時外部錯誤；Google原始錯誤訊息不得直接轉傳。錯誤分類可用Google固定reason代碼白名單，不靠含敏感內容的任意訊息。

### 2. 匯入意圖固定 accessMode

既有 `POST /api/imports/inspect` 新增可選 `accessMode: PUBLIC | OAUTH`；省略時沿用OAUTH，非法值拒絕。沿用現有意圖token、select／commit／cancel路由及十分快取期限，意圖內保存確定模式。

- OAUTH：仍捕捉googleRevision並於前後讀取、選表及提交檢查；解除／切換Google使舊候選失效，既有測試契約保持。
- PUBLIC：讀取與檢查不要求Google連結／epoch；仍在外部I/O前後驗原本機老師、意圖期限、目前活動版本及階段。解除OAuth不能無故作廢公開意圖；老師登出或開始活動仍作廢。
- 使用既有reader注入接縫擴充mode選擇，保持既有建構與begin預設行為，避免所有OAuth測試因新參數改用公開通道。
- 變更模式需要開始新inspect。select／commit不能由body改mode；token綁定原老師，其他分頁／老師不得接管。

模式只決定讀取身分，不改來源快照資料形狀或活動表結構。選定表、原格式及內容照原機制保存，所以公開匯入後仍能於完成OAuth後執行原完整來源核對及三模式寫回，不需要migration或重新匯入。

### 3. 公開配置狀態與老師介面

新增老師限定 `GET /api/imports/options`，沿用正式分頁標頭及host／origin驗證，僅回公開reader是否配置等必要布林，不回API key或OAuth token；匿名／學生不可取得匯入管理資訊。

匯入區塊增加明確模式選擇。有可用OAuth時沿用原授權選項；尚未連結Google時可預選公開模式。使用者已手動選擇或候選已開始後，不因背景Google狀態更新自動換模式；有候選時鎖定模式，取消後才能重選。

公開模式按鈕依公開配置、階段與busy狀態決定，不以 googleReady 禁用；OAuth模式繼續依googleReady。提示使用原始Sheets編輯網址並設「知道連結的任何人可查看」，不要求可編輯、不宣稱僅發布到網路即可。缺公開設定時提供可理解說明，仍可明確使用原OAuth選項。

既有Google連結管理與Sheets寫回區塊保留；公開匯入不自動啟動Google授權，不暗中以現有OAuth補救失敗。CSV下載仍獨立。

### 4. 舊功能保護與測試

| 層級 | 完成證據 |
|---|---|
| 設定／公開reader | 缺金鑰、header傳遞、固定URL、JSON格式、401／403／404／429與逾時；金鑰不出現在回應／日誌／網址；不呼叫OAuth |
| 匯入整合 | PUBLIC無Google連結可用，單題／混合題組及原格式一致；gid、多表、非法URL、最後一題失敗、原活動原子性與2～20組 |
| 競爭與憑證 | 原老師登出／到期／活動開始／換場，公開途中解除OAuth可繼續，OAuth途中解除仍失敗，模式不可在token中改換且不自動fallback |
| Chrome | 未連結Google可貼網址匯入、錯誤提示、模式切換與候選鎖定；接續真學生作答、結果與CSV下載；原OAuth匯入／三模式匯出及師生流程回歸 |
| 真實公開API | 隔離SQLite、空Google連結、停用OAuth provider，只以API key讀取明確公開可查看的單題與題組副本；保存題數、合併與定位核對，不寫原表 |

既有157項單元／整合、22項Chrome與啟動測試是目前基準，實作後須重跑受影響全套並記錄新數量；未執行不寫成通過。真實公開API前應確認使用者授權的來源副本與公開分享狀態，不擅自把原表改公開；公開唯讀即可。OAuth回歸與公開驗證分開，避免舊連結掩蓋問題。

## Risks / Trade-offs

- [只有發布網頁，原表未公開] → 不猜原表ID或爬取；要求原始網址及公開可讀，失敗保留原活動。
- [金鑰缺失、限制錯誤或配額] → 僅停用／回報公開模式問題，不清OAuth與活動；提供設定文件並真實驗證。
- [解除連結的舊語意過於廣泛] → PS05明確限停止該OAuth授權讀寫；公開模式仍須本機老師與自己的公開讀取設定，不是繞過登出。
- [讀取期間權限被撤回] → 下一次讀取按實際Google回應失敗；已完整取得的候選可依既有版本與確認規則提交，不承諾後續仍可寫。
- [API key 不保證文件可寫] → 所有Google寫回維持OAuth、實際權限、D31及完整預檢，不新增API key寫入路徑。
- [保留既有程式可行性] → 所有變更先在功能分支，原預設分支不動；真實公開讀取與原功能回歸未通過則不合併，不放寬功能驗收。

## Migration Plan

1. 後續明確啟動Apply後，先實作可選配置及reader與測試，公開功能未配置時保留原OAuth操作。
2. 在本機忽略版控的.env設定GOOGLE_SHEETS_API_KEY，啟用其Google Cloud專案的Sheets API並限制只用必要API；不要貼金鑰到聊天或commit。配置文件須提供實際步驟。
3. 先跑隔離單元／HTTP／Chrome與既有回歸，再用授權公開可讀副本完成無OAuth真實驗證；不修改來源分享或正式活動。
4. 依使用者指示，測試全部成功後才commit／push及合併功能分支，保留來源分支與驗證紀錄；遇到缺配置或失敗則停在分支並說明，不能把它當成功合併。
5. 回復時保留既有資料庫、Google vault與OAuth設定，切回舊程式即可使用原功能；公開key設定未被舊版使用，不需要清資料。

本輪僅Propose，沒有修改.env、應用程式或正式資料庫；未執行真API、Apply或合併。API key 尚未配置是後續真實驗收的已知前提，並非已完成的證據。
