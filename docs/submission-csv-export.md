# 全組提交紀錄 CSV 匯出

CSV 匯出本場所有已受理並保存的提交，包含未搶到的紀錄，不包含草稿、無效請求、同組競爭被拒請求或重送副本。每筆答案欄位一列，題組依原子題順序展開。列依來源題目順序、已保存順位及子題順序排序。

八欄固定為：題號、子題、組別、姓名、答案、搶答順位、送出時間、是否搶答成功。單題子題空白；姓名是原送出者暱稱快照，離線後仍保留。時間使用原伺服器有效提交時間與 Asia/Taipei 毫秒格式；第一名為「是」，其餘為「否」，不批改正確性。沒有提交的活動輸出只有表頭。

格式為 UTF-8 BOM、逗號、CRLF；所有欄位雙引號包覆，欄位中的雙引號加倍，保留多行文字及 emoji。公式型文字（含前置空白後的 =、+、-、@，或開頭 tab／CR／LF）僅在匯出加單引號前綴，避免 Excel 直接執行公式；不修改原資料。CSV 沒有儲存格型別，純數字文字、前導零及日期外觀仍可能受 Excel 自動判讀影響。

## 下載 API

`GET /api/activities/:activityId/submissions.csv`：必須使用有效老師分頁的既有 Authorization、X-Tab-Proof、X-Document-Instance 與 X-Session-Generation 標頭。只接受目前已結束活動，不接受 query；學生及匿名均不可下載。舊活動或階段不符回既有409錯誤，失效憑證依既有401／分頁錯誤處理，錯誤仍為繁體中文 JSON，不可存成 CSV。

成功回應為 text/csv; charset=utf-8、attachment 與 no-store。此下載不需 Google 設定，不呼叫 Google API、不配置命令接收序號；全部檔案在同一讀取快照完成後回傳，無人作答仍有表頭。

前端使用 TabSession.download(path, signal) 帶現有分頁標頭讀取 Blob，與 JSON 請求共用網路及身分失效規則。成功回應必須為 CSV；JSON 錯誤、取消或原憑證已更換不產生下載。不要直接在網址或超連結放 token。

## 老師操作

「匯出 CSV」位於「匯入 Guided Notes」區塊下方。活動結束後點「下載送出紀錄 CSV」，由瀏覽器下載 classroom-submissions-活動識別碼.csv。學生沒有入口；活動未結束不能下載。沒有 Google 連結、Google 授權失效或 Sheets 匯出待確認均不妨礙本機 CSV。

下載失敗會顯示繁體中文錯誤，可在連線及身分恢復後重試。登出、換場或身分失效會取消尚未完成的下載，不把過期回覆當成功；產生的物件網址會釋放。成功建立新活動會照原規則清除舊場，所以需要的檔案請先下載保存。

## 驗收結果

2026-11-27：本 Change 8 項需求、16 個情境均有測試對照，詳見 [驗收證據](evidence/csv-export-verification.json)。157 項單元／整合、22 項零售 Chrome headless 回歸及1項正式啟動通過，型別、建置、Strict Validate與原需求追蹤稽核通過。Chrome 真下載的 BOM、八欄與多行內容已由獨立解析器核對；尚未實際在 Excel 開啟，不以瀏覽器下載冒稱 Excel 呈現已驗證。CSV 型別與地區分隔設定限制仍適用。

本機服務已正常重啟，十個業務表雜湊前後相同、序號不倒退。沒有新增套件或 migration；原 Change 的84／85與13.3缺失保持，CSV 功能已經使用者測試確認並合併至預設分支，OpenSpec 主規格已同步、Change 已歸檔；未執行獨立 Verify 流程。

## OpenSpec 同步與歸檔

2026-11-27（Asia/Taipei）：使用者確認功能測試無問題並授權合併後，另指示同步與歸檔。已將8項需求／16個情境完整同步至 [主規格](../openspec/specs/submission-records-export/spec.md)，原 Purpose 及需求／情境內容保留；7／7任務完成的 Change 連同 metadata 原樣移至 [歸檔提案](../openspec/changes/archive/2026-11-27-add-submission-records-csv-export/proposal.md)。

主規格 Strict Validate 1／1通過；同步歸檔後全案 Strict Validate 2／2通過（CSV主規格與仍開放的原系統Change）。原系統仍84／85，13.3效能缺失未完成，沒有同步或歸檔該原系統Change，也沒有修改原 requirements.md 或系統程式。
