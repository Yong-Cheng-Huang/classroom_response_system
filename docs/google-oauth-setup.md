# Google OAuth 與 Sheets 測試資源設定

日期：2026-11-26（Asia/Taipei）。使用者已確認目前尚未配置；本文件提供手動設定步驟，不代表任務 6.1 已完成或 Google 連結已可使用。

後續進度：使用者已提供 `data/google-oauth-client.json` 及兩份測試副本，並完成老師密碼配置與真實 Google 授權；JSON 為 web client、回呼正確、檔案權限 600。6.1～6.8 已完成，詳見 `docs/guided-notes-import.md`；以下設定步驟保留供重建環境使用。

## 1. 建立專案與啟用 API

登入 [Google Cloud Console](https://console.cloud.google.com/)，建立或選取此課堂系統的測試專案。在「API 和服務 → 程式庫」搜尋 **Google Sheets API** 並啟用。使用之後要授權的老師 Google 帳號操作。[官方啟用說明](https://developers.google.com/workspace/guides/enable-apis)

## 2. 設定同意畫面與測試帳號

進入「Google Auth platform」，在 **Branding** 填寫應用名稱（例如「本機課堂搶答系統」）、支援及聯絡信箱。在 **Audience** 設定使用對象；一般個人帳號使用 External，先維持 Testing，於 Test users 加入將實際授權的老師信箱。組織帳號若受管理政策限制，須確認該帳號允許此測試應用。[官方同意畫面說明](https://developers.google.com/workspace/guides/configure-oauth-consent)

在 **Data Access** 準備 Sheets 讀寫範圍：

```text
https://www.googleapis.com/auth/spreadsheets
```

此範圍供原表讀取與後續結果寫回，屬敏感範圍；實際文件權限仍依授權帳號。範圍不能限縮至同一文件中的某一張工作表；產品仍須自行限制當初選定的表及必要儲存格。[官方 Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes)

目前後端另外請求 `openid`、`email` 以辨識共用連結的帳號，沒有請求個人資料的 profile 範圍。電子郵件只顯示於有效老師的連結狀態，不傳學生；Google ID token 由官方函式庫驗證簽章、issuer、audience 及期限後使用。

## 3. 建立 OAuth client

在 **Clients → Create client** 選 **Web application**，名稱可用「Classroom Local Backend」。此專案由 Node.js 後端接收授權回呼，採用 Web server OAuth client。[官方憑證建立說明](https://developers.google.com/workspace/guides/create-credentials)

在 **Authorized redirect URIs** 加入以下完整網址：

```text
http://127.0.0.1:3000/api/google/callback
```

這是本專案既定固定來源與 design 中的回呼路徑；若你已明確更改 APP_PORT，須使用相同埠。主機、埠與路徑必須和之後實際送出的 redirect_uri 完全相同。Google 對 localhost／loopback IP 提供本機 HTTP 例外。[官方 Web server OAuth 與 redirect URI 規則](https://developers.google.com/identity/protocols/oauth2/web-server)

目前後端流程不使用瀏覽器端 Google JavaScript 授權 SDK，Authorized JavaScript origins 可留空。

## 4. 保存 JSON

建立後下載 client JSON，保存在本機專案忽略版控的資料目錄，例如：

```text
data/google-oauth-client.json
```

在專案目錄將該檔權限限制為擁有者讀寫：

```sh
chmod 600 data/google-oauth-client.json
```

JSON 含 client secret，應只留在本機。設定後回覆檔案路徑即可，不要貼 JSON、密碼、client secret 或 token。資料目錄已被 .gitignore 排除。後端現在會讀取 `GOOGLE_OAUTH_CLIENT_FILE`，預設為 `APP_DATA_DIR/google-oauth-client.json`；仍須啟動並登入老師後，才能進行真實授權。

## 5. 建立兩份可寫測試副本

分別開啟原本的兩份範本，以 Google Sheets「檔案 → 建立副本」存至老師帳號，保留原範本結構：

- [單題範本](https://docs.google.com/spreadsheets/d/12uh5xhIx2wXFMy42KU8lN7rLFQ8GDugt9zfAFEvu-1E/edit?gid=1167716485#gid=1167716485)
- [題組範本](https://docs.google.com/spreadsheets/d/1PXXwWiBKJNpPkLRoJLMzZWsAh4Jzn2bThHTeRAiq3Hg/edit)

確認授權老師帳號能編輯副本。回覆兩份**副本**的網址，供後續真實讀寫驗證；原範本維持唯讀測試。現有 `SHEETS_TEST_SPREADSHEET_ID` 只接受明確的可寫副本，不會因公開可讀便推定可寫。

## 設定完成後需提供的資訊

1. client JSON 的本機路徑。
2. 兩份測試副本網址。
3. 確認實際授權的老師帳號已列為測試使用者。

之後實作 6.1 時仍需由你在 Google 頁面登入並同意授權，再實測多老師共用、重啟保留與撤銷。只有雲端設定完成不能將 6.1／6.2 勾選為完成；授權憑證不傳給學生。
