# Tasks

## 1. 後端固定服務帳戶

- [x] 1.1 匯入省略方式預設SERVICE_ACCOUNT並保留明確SERVICE_ACCOUNT相容性，完成條件：服務／真HTTP測試涵蓋PUBLIC／OAUTH／null／非法值拒絕、缺配置／無權不fallback、本機角色與分頁／到期／版本／開始競爭、gid／多表／2～20組、末題失敗與原子替換、來源答案隔離；更新匯入HTTP契約，select／commit仍不得改身分，寫回API不改。（GI01、GI09、PS04）
- [x] 1.2 移除產品公開reader接線與公開key配置依賴，完成條件：只設定舊key無法匯入、未設定key但有效服務帳戶可匯入，options僅回serviceAccountConfigured且老師限定，錯誤不要求重選方式；舊公開測試改為退出或服務帳戶保護案例，探針／診斷依賴同步調整且保留歷史證據；.env.example及設定文件不要求公開key，不改實際.env／憑證／資料庫。（GI08退出、GI09、PS06、PS09）

## 2. 老師單一操作流程

- [x] 2.1 移除匯入方式選單與公開相關狀態／提示，完成條件：Chrome證明直接填網址及組數即可讀取、沒有存取方式選單或公開key／分享提示，服務帳戶缺配置有正確說明；保留多表選擇、預覽欄位、取消、替換確認與進行中限制，接續真學生作答→結果→CSV；服務帳戶Email與查看／編輯權限說明正確，README及操作指南同步。（GI10、GI01、PS04、PS09）

## 3. 整合驗收

- [x] 3.1 完成受影響回歸及規格對照，完成條件：typecheck／build／單元HTTP／完整Chrome／正式啟動／Strict Validate及diff檢查通過，記錄相較165／24／1基準的測試替代及本Change23情境對照；三模式／D31、舊未知核對、師生、搶答、結果、CSV及重啟不退化，原始requirements、主規格、已完成Change與歸檔不誤改，D41歷史數據保持；缺前置規格同步不冒稱可直接歸檔。（全部變更需求）
- [x] 3.2 完成真實唯讀服務帳戶匯入驗證，完成條件：隔離SQLite沿用已授權私有檢視者與單題／題組來源，請求省略方式且不依賴公開key，核對完整題數／子題／定位／格式、預覽與本機確認；全程僅Google GET、不寫來源或改分享、不清正式活動，保存安全證據，缺配置／權限或實測失敗不得勾選或合併；不把前輪真實寫回冒稱本輪新測試。（GI01、GI09、GI10、PS04、PS06）

## Workflow follow-up

- 本輪Propose完成後停止，使用者另行啟動Apply才實作。
- 全部5項任務及真實驗證通過後才合併原預設分支，保留功能分支；不另行要求管理者重建已可用的服務帳戶。
- 同步／歸檔另依後續流程授權，順序為add-public-guided-notes-import→replace-google-oauth-with-service-account→本Change。前置尚未同步時CLI可能提醒GI09／PS04等缺主規格，不能直接歸檔或倒序覆蓋。
