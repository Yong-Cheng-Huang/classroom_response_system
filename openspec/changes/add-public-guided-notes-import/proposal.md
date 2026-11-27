# Proposal

## Why

目前 Guided Notes 匯入必須先連結 Google，即使學習單已公開可讀，老師仍需完成 OAuth。新增公開讀取模式，讓老師直接貼原始 Google Sheets 網址匯入，並保留既有 OAuth 匯入、三模式寫回與 CSV 下載，供使用者在獨立分支驗證後合併。

## What Changes

- 新增「公開學習單（免 Google 登入）」匯入選項，以後端一次設定的 API key 讀取公開分享文件；老師仍以本機密碼登入，不需 Google 登入或 OAuth 測試人員資格。
- 保留「Google 帳號授權」匯入，舊版未指定模式的請求維持 OAuth 行為，私有文件仍可透過原授權讀取。
- 公開模式取得現有解析所需的題目、合併範圍、儲存格與格式，不以純 CSV 或發布頁爬取取代現有解析器；gid、選表、2～20組、完整驗證與原子換場規則沿用。
- 「知道連結的任何人可查看」即可，不要求可編輯。只接受原始 Sheets 網址；僅發布到網路但原表未公開分享時，提示權限問題，不保證可讀。
- 公開模式只讀、不自動要求 OAuth、不暗中改用已連結帳號；既有 OAuth 連結變動不使公開模式候選無故失效。
- Sheets 寫回仍須老師 OAuth 與實際寫入權限，公開可編輯不能取代授權；CSV 下載保持不依賴 Google。

## Capabilities

### New Capabilities

無。沿用現有匯入與憑證安全能力，不另建立重複的匯入規格。

### Modified Capabilities

- `guided-notes-import`：GI01 增加兩種匯入模式；新增公開讀取、模式固定與相容性契約。
- `persistence-security`：PS04、PS05、PS06 區分公開讀取與 Google 帳號授權存取，維持本機角色驗證、私有匯入及寫回保護。

## Impact

- 影響後端設定／公開 Sheets reader／匯入意圖、HTTP 契約、老師匯入介面與測試；採用既有 TypeScript、React、Node.js、SQLite，不增加服務帳戶、套件或資料庫 migration。
- 原始 requirements.md、既有11份主規格及兩個已歸檔 Change 在本輪不直接修改；新增本 Change 的規格差異，後續依流程實作與同步。
- 在 `codex/public-guided-notes-import` 分支工作，預設分支保持既有可用版本；依使用者要求，完成自動化、真實公開讀取與原功能回歸後才合併，未通過不合併。
- API key 與可公開讀取測試副本是後續真實整合驗證的配置前提；不得把模擬 API 或 OAuth 已連結時成功讀取冒稱免 OAuth 實測。
- 不新增匿名寫回、服務帳戶寫回、發布網址反查原表、網頁爬取、雲端部署或跨裝置能力；D41紀錄型效能驗收政策保持。
