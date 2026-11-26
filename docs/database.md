# 第一階段資料庫操作與結構

## 初始化與 migration

SQLite 預設位於專案的 `data/classroom.db`，檔案不進版控。首次啟動或執行 `npm run db:migrate` 都會初始化，之後只套用尚未執行的 migration。`npm run db:status` 顯示目前版本。

`database/migrations/001_core.sql` 建立基礎資料結構；`002_integrity_guards.sql` 建立不可復活、固定期限與提交完整性防護。`schema_migrations` 保存版本、檔名、SHA-256 及套用時間，已套用檔案不得改寫；後續改結構必須新增 migration。啟動會拒絕未知、缺號／次序不符或校驗不同的已套用版本，失敗遷移交易回滾。

後續正式身分實作新增 `003_identity.sql`，目前 schema **3**、共 **18** 張表；原 001／002 保持原樣。003 新增密碼版本／salt、分頁雙憑證綁定／交接與程序檢查點，並禁止 JOINED 成員直接改暱稱。

連線開啟 foreign_keys、WAL、synchronous=FULL 與 5000ms busy timeout。新資料夾權限 0700、資料庫檔案 0600。啟動先遷移及核對接收序號，完成後才提供健康回應。這只證明資料儲存可用，不代表活動或學生身分恢復流程已完成。

## Schema

| 資料表 | 關鍵欄位／約束 |
|---|---|
| schema_migrations | 版本主鍵、名稱、校驗、套用時間 |
| system_state | 單例、接收序號高水位，不因換場清除 |
| receive_orders | 已配置序號主鍵；不含舊答案、活動或送出者資料 |
| activities | 唯一 current_slot、READY／RUNNING／ENDED、2～20 組、版本與合法開始結束時間；沒有資料表示尚未匯入 |
| sources | 活動外鍵、試算表／工作表、解析版本、來源快照 JSON |
| groups | 活動與組號唯一、組號 1～20、跨活動複合外鍵支援 |
| questions | 活動題號／位置唯一、SINGLE／GROUP |
| question_fields | 題目外鍵、欄位順序唯一、敘述、子題標記、答案範圍及原格式 JSON |
| sessions | token_hash 唯一、角色、固定 12 小時、密碼版本、CONNECTED／GRACE／REVOKED／EXPIRED、寬限起訖／版本／停機證據 |
| identity_settings | 單例、隨機 salt 與 scrypt 密碼版本；無密碼原文 |
| tab_bindings | session_id 主鍵及外鍵、第二憑證 SHA-256、generation、當前 document_instance_id |
| runtime_state | 單例、程序執行檢查點；不能當成精確停機時刻 |
| participants | 工作階段唯一、活動／組別外鍵、可重複暱稱、參與狀態 |
| submissions | 活動／題／組唯一、每題 rank 唯一、receive_order 唯一且有配置證據、組內 request_id 唯一、送出者快照及 sealed |
| submission_answers | 提交／欄位主鍵；複合外鍵確保答案欄位屬同一活動題目 |
| export_operations | 本場外鍵、五種匯出狀態、寫入前／預期範圍及必要格式恢復計畫 JSON；換場清除 |
| document_output_management | 文件／表／範圍主鍵、VERIFIED／UNVERIFIED、內容及格式核對、附註邊界、原排版；跨場保留，不含歷史答案欄位 |
| google_connection | 單例、帳號識別、授權範圍與後續受保護憑證的參照；不保存 Google 密碼或明文 token |

目前沒有資料庫種子學生、預設老師密碼或自動建立活動。JSON 恢復資料屬後端內部欄位，不可經未授權 API 回傳；跨活動管理只能存必要雜湊、位置與排版，不能把答案塞進格式 JSON 當歷史保存。

## 交易與資料保護

`persistCompleteSubmission` 是內部儲存邊界，透過一筆 SQLite 交易寫提交及全部答案、封存；欄位缺漏、空白、超長、外鍵或唯一約束失敗會整筆回滾。sealed 提交及答案不可更新；清除活動時才允許依外鍵清除該場資料。這不提供學生作答 API，也不決定角色、階段、正確性、排名或重送結果；上述業務仍在後續任務。

工作階段的 REVOKED／EXPIRED 不可更新回 CONNECTED／GRACE，建立與到期時間不可延長。資料庫可以保存斷線與證據，但沒有自動恢復、額外寬限或 U01 預設裁定。

正式身分服務已接入固定期限、密碼變更撤銷及正常停機檢查點；未知強制中斷不自動裁定有效／失效。完整連線生命週期及 G2 仍由第 7 群組承接，詳見[身分實作紀錄](identity-implementation.md)。

`createSqliteAllocator` 先以獨立短交易配置並保存接收序號，再由有序執行器排工作；業務失敗不回收序號。高水位小於配置或提交證據時拒絕啟動／配置，不猜測修復。序號可有缺口，不能把缺口當名次。正式開始／結束命令已接入同一佇列；提交及其與結束的完整整合仍由第 8 群組承接。

後續已完成任務 3.5 的內部原子替換儲存邊界：同交易撤銷舊學生、清舊資料、建立全部新場，且只有 COMMIT 後才通知，含真程序 SIGKILL 驗證。詳見[活動替換與故障驗證](activity-replacement-storage.md)。正式匯入、授權、確認意圖及 WebSocket 整合仍由 5.3／6.7／12.10 等原任務承接，不能將儲存邊界完成當成全流程完成。

第 5 群組已新增老師授權、版本檢查及文件互斥的活動服務；尚待第 6 群組接入真實 Google 來源與匯入 HTTP、第 12 群組接入放棄／隔離意圖。Schema 維持 3、18 張表，詳見[活動管理紀錄](activity-management.md)。

Google 授權程式新增資料目錄中的 `google-credentials/`，以 700／600 權限及 AES-GCM 保存 token；SQLite 只有隨機檔案參照。這些金鑰及加密檔不包含在純 SQLite 備份中，若未保留相符資料需重新授權，不清活動；首次真實授權仍待驗證，詳見[Google 整合進度](google-integration-progress.md)。

後續第 6 群組已通過真實 Google 授權、正常重啟讀取與實際匯入；目前活動的來源／格式基準沿用 sources 及 question_fields，沒有新增 schema。此前「尚待第 6 群組／首次授權」是當時進度，最新證據與清除界線見[匯入完成紀錄](guided-notes-import.md)。

## 備份與回復

以下命令須在專案目錄、Node.js 24.22.3 下執行。備份以 SQLite backup API 包含 WAL 中已提交資料，不直接複製單一主檔。

```sh
npm run db:backup -- backups/first-stage.db
npm run db:restore -- backups/first-stage.db data/restored/classroom.db
```

目標必須是尚不存在的新檔，工具拒絕覆寫。回復會檢查 SQLite 完整性及已知 migration，來源保持不變；再次啟動可升級較舊的已知版本。

要改用回復資料，先停止服務，將 `.env` 的 `APP_DATA_DIR` 指向 `./data/restored`，再啟動並核對。不要在服務運行中替換資料庫檔，不使用刪庫方式修復錯誤。備份可能包含學生答案，須放在私有本機目錄，不提交版控。

本機備份與回復不會回滾已完成的 Google Sheets 寫入。日後完整身分及 Sheets 流程完成後，還須驗證備份回復與外部文件／既有分頁的整體行為；本階段只實際驗證資料庫版本升級、備份與新檔回復。

## 第 7 群組恢復更新

U01 已經人工確認採 D38，依最後已提交狀態處理不明中斷；已保存失效、固定到期及舊活動優先。連線世代沿用 tab_bindings，GRACE／撤銷與恢復證據沿用 sessions，Schema 仍為 3／18 表。此前 U01 未定與未知中斷暫停的文字為歷史階段；新證據及可重現命令見 [恢復完成紀錄](realtime-recovery.md)。

## 第 8 群組提交更新

正式提交已接上既有封存完整答案交易與唯一約束：每組每題一次、每題唯一名次、當前活動／組別 requestId 冪等；原時間、指紋、名次與全部子題一致保存。真 SIGKILL 驗證 COMMIT 前回滾與 COMMIT 後原成功恢復，跨重建及換場序號不重用。Schema 仍為 3／18 表；本階段未新增 migration 或依賴，見[搶答提交與排名](submission-ranking.md)。

## 第 12 群組匯出更新

沿用 schema 3／18 表，沒有新增 migration。`export_operations` 在傳送前保存 WRITING 與完整計畫（目標、寫前／寫後、原格式／列高及批次），僅保留於當前活動；已完成與管理資訊同交易保存。啟動時 PREPARING→FAILED、WRITING→UNCONFIRMED，後者先讀回核對，不重送。儲存恢復後亦可處理未落盤終態的閒置操作。

`document_output_management` 的 VERIFIED 保存內容／格式雜湊、附註邊界與原排版；放棄核對並成功換場時，同交易改存最少 UNVERIFIED 資訊，再刪除舊場完整計畫與答案。管理資訊不含歷史答案，跨換場／重啟保留；重疊匯出不能自動覆寫或解除，其他文件不被阻擋。U03 解除政策尚未確認。Google 外部寫入與 SQLite 無跨服務交易，未知結果不能猜未寫入；備份回復不能回滾 Sheets。詳見 [匯出狀態與驗證](guided-notes-export.md)。
