# G1 後的後端契約實作紀錄

日期：2026-11-26（Asia/Taipei）。Change：build-local-classroom-response-system。

本文件保留 2.1／2.5 完成時的 18／85 快照；後續使用者指示繼續後的 3.5 儲存驗證與最新進度見[活動原子替換紀錄](activity-replacement-storage.md)。

## 完成範圍

本階段完成任務 2.1、2.5，群組 2 的五項任務均已完成；整體更新為 **18／85，剩餘 67 項**。依原順序，3.5 的整場原子替換測試及第 4 群組正式身分功能仍未完成，不預先勾選。

2.1 建立 HTTP 路由、共用 TypeScript 輸入契約、JSON／UTF-8 檢查、方法／路徑／query 限制、活動與版本檢查、角色與參與綁定守衛。命令入口在完整本文收齊後先配置持久序號，再等待驗證；無效請求不改業務資料，已配置序號依 D35 保留缺口。

2.5 建立白名單角色投影及前端 DTO 型別。READY 學生不取得敘述，RUNNING 不取得他組作答或排名，ENDED 只加上規格允許的成功組答案，老師可取得完整提交。HTTP 回應實際呼叫同一投影介面，未以僅供展示的物件代替。

正式驗證器與權威快照載入器尚未接上。受保護路由預設拒絕，合法寫入仍為 FEATURE_NOT_READY；沒有以測試身分開後門，也沒有建立空成功回覆。因此首頁仍是基礎頁面，不代表登入、選組或搶答已開放。

## 檔案

新增：

```text
src/shared/contracts.ts
src/shared/views.ts
src/server/principal.ts
src/server/projections.ts
src/server/api.ts
tests/helpers/read-model.ts
tests/unit/contracts.test.ts
tests/unit/projections.test.ts
tests/integration/api.test.ts
docs/backend-api-contracts.md
docs/phase2-backend-contracts.md
```

更新：src/server/app.ts、src/server/command-queue.ts、src/shared/errors.ts、package.json、README.md，以及 tasks.md 中對應的任務狀態與執行紀錄。

沒有增加套件、改變版本或技術堆疊；沿用現有 TypeScript、Node HTTP、React、SQLite／better-sqlite3、ws。沒有新增 migration 或修改既有 SQL，schema 仍是版本 2。本次不改寫 requirements.md、proposal.md、design.md 或十份規格。

## 驗證

| 檢查 | 結果 |
|---|---|
| npm run typecheck | 通過。 |
| npm test | 38／38 通過，無跳過；含 15 項新增契約、投影與 HTTP 測試。 |
| npm run build | 通過，前後端建置成功。 |
| npm run test:startup | 1／1 通過；正式版同來源兩次啟停、從其他工作目錄執行及資料保存。 |
| npm run test:browser | 1／1 通過；同一 Chrome context 三分頁載入／重整，既有首頁及 API 連線正常。 |

新測試使用真 SQLite 與真 HTTP，涵蓋非法 JSON／UTF-8、客戶端偽造欄位、錯誤方法／媒體、舊活動、版本衝突、錯組／參與者／題目、到期、預設拒絕、接收序號先落盤及等待驗證不越序、部分本文與中止、投影資料公開及模型過期拒絕。業務資料不變比對涵蓋十二類資料表，接收序號依 D35 另行檢查。

投影測試將他組提交及內部版本改動後，比對 RUNNING 學生投影仍完全相同；並置入來源答案、Google 憑證、session 秘密等額外 canary 欄位，確認不會因內部模型新增欄位而意外對外公開。老師與結束後例外公開的資料另有正向斷言。

38 個單元／整合案例加上兩個啟動／瀏覽器案例，不代表所有 119 個規格情境已驗收。此階段沒有執行 G1 重複驗證、G2、Google 授權／寫入或 42 分頁效能測試，未將 U01／U02／U03 的不確定性預設為已解決。

## 操作與後續

啟動仍使用 nvm use 後 npm run dev，來源為 http://127.0.0.1:3000。正式版使用 npm run build 後 npm start。介面、輸入例子、角色欄位及未開放範圍見 [後端 API 契約](backend-api-contracts.md)。

下一步先處理任務 3.5 的完整活動替換／回滾／落盤後通知，再依原依賴整合第 4 群組的正式身分。G1 通過的第二憑證、COOP 及交接版本組合未被本次 Authenticator 介面取代，仍須在 4.2 真正實作及重驗。
