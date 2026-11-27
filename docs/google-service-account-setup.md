# Google服務帳戶設定

新版改用服務帳戶，老師不需要連結個人Google或加入OAuth測試人員。公開匯入仍可只用原API key；私有匯入與所有Sheets寫回使用服務帳戶。此JSON不是原OAuth client JSON，也不是API key。

## 管理者設定

1. 在Google Cloud Console選擇專案，在「API和服務→程式庫」啟用Google Sheets API。
2. 在「IAM與管理→服務帳戶」建立服務帳戶。只為共用試算表存取不需另加Cloud專案管理者角色，也不需網域全權委派。
3. 進入服務帳戶「金鑰→新增金鑰→建立新金鑰→JSON」，將檔案保存至本機專案的 `data/google-service-account.json`。不要貼上聊天或提交Git。若組織禁止建立金鑰／共用給外部帳戶，請先由管理者處理限制，不要自行開放原始文件。
4. 如使用其他安全路徑，在忽略版控的 `.env` 設定 `GOOGLE_SERVICE_ACCOUNT_FILE=完整路徑`。不可放在src、dist、node_modules或其symlink目標；後端限制檔案權限0600。
5. 重新啟動服務。檔案缺少／格式錯誤只停用服務帳戶，不清除活動，也不影響有效公開讀取、結果或CSV。

JSON只在啟動載入；輪替同服務帳戶金鑰後需重啟，舊金鑰撤銷由管理者另外操作。token只在後端記憶體快取與更新，不存前端或SQLite。舊OAuth JSON、vault及資料表不再使用，但不會自動刪除；如需清理由管理者自行處理，程式不代為撤銷遠端授權。

## 老師使用

在老師頁面取得服務帳戶Email，於原試算表「共用」加入該Email：只匯入可給檢視者；需要寫回請給編輯者，並確認作答範圍未受額外保護。私有文件不必公開，公開可編輯也不代表API匿名可寫。

明確選「服務帳戶」匯入；若使用公開方式，原表仍須設「知道連結的任何人可查看」，並配置原公開API key。兩種方式失敗不自動互相替代，有預覽須取消後重選。活動結束後才可寫回，仍須確認老師與協作者自預檢到完成暫停編輯（D31），保持全部定位核對、三模式與整批寫入。

## 舊操作與錯誤

缺配置／私鑰無效請管理者檢查JSON；無法讀取請檢查共用，寫入被拒絕請檢查編輯權限與保護範圍。Google限流、20秒逾時或外部回覆錯誤可稍後操作，請勿將私鑰或token貼入錯誤回報。

寫入可能已送出而中斷時保持「結果待確認」，不直接重送。舊OAuth操作或更換服務帳戶後核對，需要明確確認使用目前Email只讀核對原計畫；核對無法完成可依原流程放棄並保留未核實範圍。不得以改憑證清除未知狀態或重複寫入。

正式驗證只使用另行指定、已共用的可寫測試副本；原始兩份範本僅可讀取，禁止用作寫入目標。需另有僅查看權限來源驗證無法寫入。不自動修改Google分享或建立Cloud資源。

參考：[Google憑證與文件共用](https://developers.google.com/workspace/guides/create-credentials)、[服務帳戶伺服器授權](https://developers.google.com/identity/protocols/oauth2/service-account)。

## HTTP升級契約

老師需帶正式token及分頁proof，host／origin與輸入白名單不變。`GET /api/sheets/status`僅回configured與accountEmail；`GET /api/imports/options`回publicConfigured及serviceAccountConfigured，不保證任意文件權限。

`POST /api/imports/inspect`必填`accessMode: PUBLIC | SERVICE_ACCOUNT`，其餘url／groupCount／abandonmentToken不變；select／commit不能改方式。`POST /api/activities/:id/exports`必填`accessMode: SERVICE_ACCOUNT`，保留requestId／mode／paused／expectedVersion，目標只取活動原始來源。OAUTH與舊缺方式請求明確拒絕，請更新頁面重新選擇，不靜默換身分。

新操作在原恢復JSON保存服務帳戶方式及Email，取消／失敗／未知／完成均保持；同requestId不得偷換帳戶或模式。`POST /api/operations/:id/reconcile`對原帳戶用空JSON即可；舊OAuth記錄或換帳戶時須明確`acknowledgeCredentialChange: true`，僅GET原表核對，不新增寫入。缺恢復計畫或內容不符仍未知。舊`/api/google/status`、`connect`、`connection`、`callback`路由已移除，回404，不解讀授權回呼。

schema維持v3，不刪舊google_connection表／vault／OAuth JSON、不改舊migration checksum。憑證改變不清活動；只有原規則的成功完整換場才清舊場並保留最少未核實輸出管理資訊。

## 真實驗收指令

```sh
SERVICE_ACCOUNT_TEST_SPREADSHEET_IDS='可寫副本ID1,可寫副本ID2' \
SERVICE_ACCOUNT_VIEWER_SPREADSHEET_ID='僅檢視副本ID' \
npm run probe:service-account-live
```

此指令會實際寫入兩份指定副本的測試答案與附註，三模式加重複合計12個成功批次，必須使用另備的測試副本並暫停協作者編輯。檢視者副本只做讀取／匯入及預期被拒絕的空寫入批次，不改儲存格；原始範本禁止作寫入目標。每輪請準備乾淨的測試副本，不能清除未核實標記以盲目重跑。證據在`docs/evidence/service-account-live.json`，不含私鑰或token。
