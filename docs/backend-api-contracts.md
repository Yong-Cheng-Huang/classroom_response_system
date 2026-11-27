> 現行Google契約以 [服務帳戶設定指南的HTTP升級契約](google-service-account-setup.md#http升級契約) 為準：匯入省略accessMode即SERVICE_ACCOUNT，明確SERVICE_ACCOUNT相容，PUBLIC／OAUTH／null拒絕；options僅回serviceAccountConfigured，select／commit不接受方式欄位。寫回仍必填SERVICE_ACCOUNT。下列早期進度保留為歷史。

# 後端 HTTP 契約與角色投影

對應 OpenSpec 任務 2.1、2.5。這是後端入口及共用投影層；正式身分與各項業務服務仍依原任務完成。本文件不取代原規格。

## 介面目前可用程度

後續身分實作已接上正式驗證器與真 SQLite 模型：老師可登入／分頁登出，學生可 READY 入組／離組。每次受保護讀寫均驗雙憑證、當前執行個體／世代、期限、撤銷及活動參與；不能用 Bearer 假字串、角色標頭或 JSON 角色欄位取得權限。新增身分端點與錯誤見[身分實作紀錄](identity-implementation.md)。

開始／結束已接上正式 ActivityService，通過檢查後交易保存階段、版本及原始接收時間。提交仍回覆 501 FEATURE_NOT_READY，不會偽造成功。大廳已有正式模型，但若存在尚不能裁定資格的非正常中斷學生，回覆 503 RECOVERY_UNCERTAIN，不假造人數或任意裁定 U01。

原契約測試可透過建構時的 ApiPorts 注入可信替身；正式 index.ts 注入真 IdentityService 與 SQLite 模型，沒有 fixture、環境變數、URL 或標頭可切換測試角色。

## 格式與回應

- 來源沿用固定本機 HTTP 位址，預設 `http://127.0.0.1:3000`。
- 本文使用 application/json，UTF-8 解碼失敗或 JSON 格式不合法回覆 400。本文不得為陣列、null 或字串。
- 已建立的輸入契約採必要欄位與欄位白名單，禁止附加 role、rank、receivedAt、其他 groupId 等未定義欄位。
- 本階段所有下列路由都不接受 query。用 groupId／role 等 query 試圖改變查詢範圍會被拒絕。
- ID 是非空的不透明字串，不接受空白、控制字元及路徑分隔符；已編碼的斜線與無效 percent encoding 亦拒絕。不以題數或子題數作固定限制。
- expectedVersion 須為大於零的安全整數。結束的 confirmed 必須是 true，false 不代表執行結束。

成功外框：

```json
{"ok":true,"data":{"activityId":null,"phase":"EMPTY","canJoin":false,"groups":[],"serverNow":2000},"operationId":"隨機操作識別"}
```

錯誤外框：

```json
{"ok":false,"error":{"code":"ACTIVITY_CHANGED","message":"活動已變更，請更新畫面後重新操作。"},"operationId":"隨機操作識別"}
```

operationId 是隨機識別，不是接收序號。回應為 JSON，附 Cache-Control: no-store 與 X-Content-Type-Options: nosniff，不回傳堆疊、SQL、原始例外、憑證或接收序號。

| HTTP 狀態 | 主要代碼與用途 |
|---|---|
| 400 | INVALID_REQUEST：型別、必要欄位、未知欄位、JSON／UTF-8 或查詢格式不合法。 |
| 401 | UNAUTHORIZED：缺少驗證器、沒有有效身分或已達到期時間。 |
| 403 | FORBIDDEN：角色不符，或學生參與與活動／組別／session 綁定不符。 |
| 404 | NOT_FOUND：路由、目前活動中的題目或組別不存在。 |
| 405 | METHOD_NOT_ALLOWED：路徑已知但方法不符。 |
| 409 | ACTIVITY_CHANGED、VERSION_CONFLICT、STATE_CONFLICT：場次、版本或階段不符。 |
| 415 | UNSUPPORTED_MEDIA：命令本文不是 JSON。 |
| 501 | FEATURE_NOT_READY：入口檢查已建立，對應業務或權威快照尚未接上。 |
| 500／503 | 安全的內部或資料庫不可用說明；不暴露原始錯誤。 |

## 本階段建立的路由

| 方法與路徑 | 輸入 | 本層檢查／責任 |
|---|---|---|
| GET /api/lobby | 無 query、無本文 | 公開投影；無活動為 EMPTY，正式模型遇未知恢復資格回 503。 |
| GET /api/activities/current/view | 無 query | 有效身分、學生參與綁定、當前模型一致性，使用共用白名單投影。 |
| GET /api/activities/{activityId}/results | 無 query | 同上，加上路徑場次檢查；各階段依角色投影，不提前公開他組排名。 |
| POST /api/activities/{activityId}/join | groupId、nickname | 型別、共用暱稱規則、組別屬當前活動、READY、獨立分頁證明；真實建立身分／參與。 |
| POST /api/activities/{activityId}/leave | 空物件 | 有效學生與參與、當前活動及 READY；離組並撤銷原身分。 |
| POST /api/activities/{activityId}/start | expectedVersion | 有效老師、當前活動、版本及 READY；同交易保存 RUNNING、開始時間及遞增版本，不撤銷學生。 |
| POST /api/activities/{activityId}/end | expectedVersion、confirmed=true | 有效老師、當前活動、版本及 RUNNING；同交易保存 ENDED、結束時間及遞增版本，不清作答。 |
| POST /api/activities/{activityId}/questions/{questionId}/submissions | requestId、answers 陣列 | 有效學生、參與綁定、當前活動與題目、欄位型別及不重複 fieldId；保存／排名仍未實作。 |

提交的 answers 每項為 `{ "fieldId": "…", "text": "…" }`。文字原樣交給後續業務驗證，不在傳輸層靜默修剪；完整可見字元邊界及跨前後端正規化由 4.5 承接，題組是否全部作答、欄位歸屬及完整提交由 8.1～8.3 承接。沒有用範例的兩個子題或 140 個欄位設定產品上限。

傳輸層不在 submit 入口預先拒絕 ENDED：後續 8.6 必須先辨識已成功 requestId 的原結果，再處理新提交的階段限制，避免違反 SR06。這不代表目前允許結束後新增作答；目前任何合法提交都仍為 501，沒有保存行為。

原有 GET /api/health 保留。POST /api/teacher/login 未設定密碼為 503，設定後驗真密碼並簽發分頁身分；其他方法回 405。Google 的 connect／status／connection／callback 已完成真實授權驗證，匯入 inspect／select／commit／cancel 已接正式服務；介面及驗證見 [匯入操作紀錄](guided-notes-import.md)。匯出仍在後續任務建立，沒有以空成功回覆代替。

## 接收順序與拒絕不變性

已識別的 POST 命令在完整本文 end 事件中直接呼叫共用 OrderedCommandQueue，先以真 SQLite 獨立交易保存 receiveOrder／receivedAt，再解析 JSON、等待身分驗證及檢查業務前置。前一個完整命令即使驗證較慢，後一個也只能先配置序號、不能越過它執行。

先送出部分 HTTP 位元組但尚未完成本文，不算進入命令入口；其他先完成本文的命令可以先配置。若本文中止，不配置序號。未知路由、方法或路徑／query 在入口前即拒絕時，也不宣稱已進入排序。

已配置後才發現不合法、無權限、舊場次或未開放者，接收序號不回收，符合 D35。所謂「拒絕不改資料」指活動、題目、組別、身分、參與、答案、排名及文件管理等業務資料不變；不要求把已配置序號回滾或改成名次。學生回應不包含此序號。

## 角色投影契約

前端 DTO 型別在 src/shared/views.ts；傳輸輸入型別與解析器在 src/shared/contracts.ts。

| 身分／階段 | 公開欄位 |
|---|---|
| 無身分大廳 | activityId、phase、canJoin、各組 id／number／去重 memberCount、serverNow；無題目或作答。 |
| 老師／EMPTY | role、activityId=null、phase=EMPTY、serverNow。 |
| 老師／有活動 | 階段與時間、活動 version、各組人數、完整題目與子題、全部提交答案／rank／原時間與臺灣時間字串。 |
| 學生共通 | 本場階段與開始／結束時間、各組公開人數、本組 id／本人 participantId／暱稱、本組成員及 isSelf、serverNow。 |
| 學生／READY | questions 只含 id、number；不包含 kind、fields、prompt、來源答案或提交。 |
| 學生／RUNNING | 全部題目敘述及子題，ownSubmissions 僅本組問題／送出者／答案；不包含 rank、全域 version、接收序號及他組提交。 |
| 學生／ENDED | results 逐題含 ownSubmission、唯一 winner 及本組 SUCCESS／SUBMITTED／MISSING 狀態；successCount 按搶答單位計算。無人題 winner=null，不用來源舊答案補值。 |

學生結果狀態分別對應「本組搶答成功」「已送出，未搶到」「本組未作答」。winner 只包含成功組別、完整答案及送出者，不含其他組未成功答案或完整排名。題組多個答案共用一個結果，不依子題數計分。

所有輸出均逐欄新建；不展開原始內部物件。來源快照、原格式、Google token、sessionId、token hash、requestHash 等不會被序列化。學生連本組數字 rank 也不提供，以避免介面不必要地依賴內部名次。

## 上游模組的責任

ApiPorts.authenticate 每個受保護請求都重新執行，正式身分模組已驗證 G1 雙憑證、執行個體與世代、期限、撤銷及已知連線資格；不能從客戶端 role／groupId 建立 Principal。本層另外檢查學生的 participantId、sessionId、groupId 與目前 SQLite 參與資料吻合。即時通道與後續管理入口尚待整合，4.6 全入口授權保持未完成。

ApiPorts.readModel 必須同步提供同場次、同活動版本／階段的權威模型，並提供已由上游裁定有效的成員。HTTP 在同一讀交易中核對活動與模型；不符就拒絕，不混合舊場與新場。投影本身不猜測斷線寬限或停機恢復，不用「資料庫仍有參與列」推定 U01 有效。

學生 DTO 不含全域版本，投影層也沒有自行建立 WebSocket revision／epoch；後續 7.2、7.3 必須按可見通道銜接快照，不能把內部資料或全域序號直接廣播。結果查詢、UI、自動導向及完整驗收仍留在其原任務。

## 即時通道更新（2026-11-26）

7.1～7.3 已實作：新增 `POST /api/realtime/ticket` 與一次性短效子協定票證的 `/ws`，每個通道採獨立 revision／serverEpoch／channelId，使用同一白名單角色投影；前述「後續 7.2、7.3」屬先前進度。契約、授權、測試及未完成的連線生命週期見[即時通道實作紀錄](realtime-progress.md)。4.6 的實際訂閱授權已補驗；往後新增命令仍須逐一驗權限，未開放的功能不因此變成可用。

### 心跳、恢復與校時更新

7.4～7.7 已完成，U01 依使用者明確選擇的 D38；既有截止未知暫停文字是確認前狀態。WS 可送 `{type:"clock",requestId:"UUID"}` 取得授權後的 serverNow，不影響業務 revision。HTTP 查詢／交接不延長寬限，實際合法通道建立才轉 CONNECTED；詳細持久化邊界、重連與測試限制見 [恢復完成紀錄](realtime-recovery.md)。

## 第 8 群組提交更新

正式組態已接上 SubmissionService，提交 API 不再回 501。只有缺少業務服務的隔離基礎測試組態仍回 FEATURE_NOT_READY；此前「提交尚未實作」為歷史進度。成功只回本組 accepted／requestId／questionId／senderNickname／answers，不含排名與時間。完整題組、欄位錯誤 fieldIds、409 ALREADY_SUBMITTED／REQUEST_ID_CONFLICT、結束後成功重送及交易順序見[搶答提交與排名](submission-ranking.md)。

## 結果查詢與畫面更新（第 11 群組）

11.1～11.4 已完成。`GET /api/activities/{id}/results` 與 current view 按同一角色／階段白名單回覆；新整合測試核對 HTTP、WS 更新與重新訂閱／重啟快照。學生完整結果頁已接上 9.5 的導向，三種成績及成功題數使用伺服器資料。D01 明確允許結束後向有效已入組學生公開成功組答案及送出者，其他未成功答案及完整排名仍不公開；沒有修改既有資料投影。詳見[結果操作、資料範圍及驗證](activity-results.md)。前述結果 UI 尚待實作的文字屬較早進度，完整整合與 42 分頁驗收仍待第 13 群組。

## 第 12 群組：匯出與放棄核對

以下皆需同來源、有效老師、目前 ENDED 活動；學生拒絕。回覆沿用 `{ok,data,operationId}`，匯出 DTO 只含 id、activityId、mode、state、message、updatedAt，不公開恢復計畫、來源快照或憑證。

| 方法／路徑 | 本文／用途 |
|---|---|
| GET `/api/activities/{id}/exports` | 列出本場匯出狀態。 |
| POST `/api/activities/{id}/exports` | `{requestId,mode,paused:true,expectedVersion}`；mode 為 ANSWERS／COLUMNS／INLINE，D31 必須確認。 |
| GET `/api/operations/{id}` | 查詢當前活動操作；舊場刪除後為 NOT_FOUND。 |
| POST `/api/operations/{id}/cancel` | `{}`；僅 PREPARING 可取消，晚到預檢不能寫。 |
| POST `/api/operations/{id}/reconcile` | `{}`；UNCONFIRMED 重新讀回核對，不重送批次。 |
| POST `/api/operations/{id}/abandon-confirmation` | `{confirmed:true,expectedVersion}`；取得短效 abandonmentToken，確認本身不刪舊場。 |

匯入檢查入口可帶 abandonmentToken，提交替換時重驗同老師、活動／版本及未核實操作集合；成功才同交易隔離必要資訊並清舊場。取消／新匯入失敗保持舊場。外部讀寫在有序命令佇列外等待，持有文件操作互斥；開始／確認等業務仍走原佇列。匯出失敗狀態透過安全 DTO 說明範圍，不回傳 Google 內部錯誤本文。D31、五狀態、未知結果及未核實隔離見 [匯出實作紀錄](guided-notes-export.md)。
