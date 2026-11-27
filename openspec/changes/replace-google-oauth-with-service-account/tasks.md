# Tasks

## 1. 服務帳戶配置與Google傳輸

- [x] 1.1 新增GOOGLE_SERVICE_ACCOUNT_FILE與安全JSON載入，完成條件：單元／啟動測試涵蓋缺檔、錯JSON、誤用OAuth JSON、非法私鑰、realpath／symlink公開目錄與0600；缺配置仍可啟動且公開匯入／CSV不受影響，.env.example只有空白路徑範例；建立繁體設定指南說明啟用Sheets API、建立服務帳戶、共用Email、組織限制及不提交憑證，不改正式.env／共用。（PS04、PS06、PS09）
- [x] 1.2 使用既有google-auth-library實作服務帳戶token取得，完成條件：合成私鑰與mock token測試證明固定Google token端點、必要spreadsheets scope、無subject委派、記憶體快取／期限／併發更新與失敗處理；不信任任意token_uri、不載入OAuth refresh token，canary不出現在錯誤或日誌；設定指南補充輪替需重啟與API key／OAuth JSON差別。（PS06、PS09）
- [x] 1.3 建立完整服務帳戶Sheets讀寫gateway，完成條件：傳輸測試涵蓋固定主機／合法ID、完整metadata／合併／格式、20秒逾時、禁止redirect與401／403／404／429／非法JSON；老師授權在token及I/O前後檢查，送出前失敗／明確拒絕與已送出未知分開，錯誤／日誌不洩密，文件列出安全錯誤與實際權限限制。（GI01、GE01、GE12、PS06）

## 2. 匯入與HTTP契約

- [x] 2.1 匯入意圖改為明確PUBLIC／SERVICE_ACCOUNT並移除OAuth epoch，完成條件：單題／混合題組、gid／多表、2～20組、原格式與答案隔離、十分快取／老師期限、跨老師拒絕、登出／版本／開始競爭、最後一題失敗與原子換場測試通過；公開及服務帳戶互不fallback，OAUTH／省略方式拒絕不讀外部，更新匯入操作文件。（GI01、GI08、GI09、PS03）
- [x] 2.2 增加老師限定Sheets狀態與匯入選項並更新新HTTP白名單，完成條件：真HTTP涵蓋匿名／學生／偽造角色／錯分頁／過期／host／origin／query／body注入拒絕，僅老師取得必要布林與共用Email；外部I/O不占命令佇列，select／commit不得偷換方式，完整文件列出新API與舊客戶端退出。（GI09、PS04、PS06、PS09）

## 3. 寫回、恢復及OAuth退出

- [x] 3.1 將寫回接線改為服務帳戶並固定access至操作JSON，完成條件：明確accessMode、新requestId與重送身分核對、PREPARING至完成／失敗／取消均保留access，三模式3×3切換與重複、D31、全題定位／人工修改、明確拒絕／已送出逾時／回覆遺失測試通過；未配置或查看者不能寫，CSV與本機結果保持；更新寫回契約文件。（GE01、GE12、GE16、PS06）
- [x] 3.2 實作舊OAuth／換服務帳戶的未知操作只讀核對，完成條件：真SQLite／HTTP測試涵蓋缺access的legacy分類、重啟PREPARING／WRITING恢復、明確acknowledgeCredentialChange、相符完成／不符或無權仍未知、缺計畫不重送、文件鎖／放棄／新場未核實隔離／舊回覆不復活；文件說明確認與安全回退限制，不載入舊OAuth或重新寫入。（GE12、GE14、GE16、PS03）
- [x] 3.3 移除個人OAuth啟動接線、端點與應用功能，完成條件：舊connect／status／connection／callback不提供OAuth功能、OAUTH／缺方式寫回拒絕；以檔案讀取spy及真資料庫升級證明不讀／刷新舊憑證、不刪JSON／vault／google_connection且活動、提交、名次、身分、序號高水位及文件管理保持；原OAuth測試改為退出／保護測試並記錄替代對照，不修改歷史migration checksum，README與舊操作指南標示新版取代範圍。（GE16、PS03、PS06、PS09）

## 4. 老師操作介面

- [x] 4.1 以學習單存取設定取代GoogleConnection並加入服務帳戶匯入，完成條件：Chrome驗證共用Email／配置提示、無連結或授權按鈕、PUBLIC／SERVICE_ACCOUNT獨立啟用、手動方式不被輪詢覆寫、候選鎖定／取消重選、失敗無fallback、完整單題與題組匯入；操作指南含查看者／編輯者差別及不需公開／OAuth測試人員。（GI01、GI08、GI09、PS04、PS09）
- [x] 4.2 寫回改依服務帳戶啟用並提供舊操作核對確認，完成條件：Chrome無個人Google連結仍完成學生作答→結束→CSV→三模式寫回，D31仍必要，legacy／換帳戶顯示目前Email及只讀確認，缺配置／無權／未知結果／放棄清楚顯示；不顯示重新OAuth文字，更新寫回與復原指南。（GE01、GE12、GE14、GE16、PS04、PS06）

## 5. 跨功能與真實Google驗收

- [x] 5.1 完成跨模組故障與升級驗收，完成條件：真程序中斷覆蓋已持久化計畫與外部送出邊界、服務帳戶輪替／換帳戶、舊活動正常及未知狀態、所有未核實範圍保持；新憑證錯誤與公開key錯誤不清資料，證據不含私鑰／token／實際key，交付規格情境與測試對照及退出OAuth的例外清單。（GI09、GE12、GE14、GE16、PS03、PS06、PS09）
- [x] 5.2 執行完整回歸與規格驗證，完成條件：typecheck／build／單元與HTTP／全Chrome／正式啟動／Strict Validate及diff檢查通過；記錄新數量與原166／24／1基準之覆蓋替代，保留師生、搶答、結果、CSV、公開匯入、D31與三模式例外；原始requirements、主規格與既有歸檔不誤改，D41歷史效能失敗不冒稱新達標。（全部變更需求）
- [x] 5.3 完成真實服務帳戶讀寫與權限驗收，完成條件：管理者於忽略版控路徑配置真正服務帳戶JSON，明確指定單題／題組可寫副本並共用，隔離SQLite且停用／不載入舊OAuth，完成私有文件匯入、真提交、三模式切換／重複與讀回格式核對、僅查看者拒絕寫入及公開匯入／CSV可用；禁止寫原始範本或自改分享，保存安全環境／結果證據，缺配置／權限／失敗不得勾選或合併。（GI01、GE01、GE12、PS04、PS06、PS09）

## Workflow follow-up

- 本輪僅Propose，完成提案後停止；使用者另行啟動Apply才實作。
- 所有13項任務、真實服務帳戶驗證及回歸成功後，才儲存並推送功能實作及合併原預設分支；缺配置時保留新分支與未完成項，不使用舊OAuth補救。
- OpenSpec同步／歸檔另依後續授權，順序固定先add-public-guided-notes-import、再本Change；不可讓前置Change晚同步而恢復已移除OAuth規則。
- Strict Validate可通過，但在公開匯入尚未同步時，CLI會提示GI08不存在、不能直接歸檔；此為已記錄的前置規格依賴，不得略過順序或宣稱本Change已可直接歸檔。
