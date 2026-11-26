# 結果查詢與計分實作及驗證

日期：2026-11-26（Asia/Taipei）。Change：`build-local-classroom-response-system`。本次完成第 11 群組 11.1～11.4，累計 67／85，尚餘 18 項；第 12、13 群組保持未完成。

## 使用方式與本組計分

沿用 Node.js 24.22.3 的 `npm run dev`，開啟 http://127.0.0.1:3000。學生於待開始加入，老師開始後作答；結束時有效已入組學生自動進入 `#/results`，不能再編輯或新增提交。先前 9.5 的路由與狀態切換，現在由完整結果畫面承接。

結果逐題顯示完整題目及子題、本組成績、成功組的完整答案與提交時送出者暱稱。使用題號導覽可跳到任一題。本組三種狀態直接取自伺服器：

| 伺服器狀態 | 畫面 | 本組成功題數 |
|---|---|---|
| SUCCESS | 本組搶答成功 | 此題加 1 |
| SUBMITTED | 已送出，未搶到；另外保留本組已送出答案與送出者 | 此題加 0 |
| MISSING | 本組未作答；仍可看成功組公開答案 | 此題加 0 |

成功題數直接顯示伺服器 `successCount`，不由前端用子題數推算。四個子題的題組仍只算一題。沒有任一有效提交的題目顯示「無人搶答」，不補造成功組或答案，不把來源文件的既有文字當成本場答案。成功依有效提交順序判定，不代表正確、不比對標準答案，也沒有批改功能。

成功題會在公開答案中完整呈現本組提交；本組未搶到的題目另外列出本組完整提交，以便與成功答案對照。本組未作答不虛構空白提交。題目、暱稱及答案使用 React 純文字，保留換行，不執行 HTML。結果跨重新整理及伺服器重啟保存，直到新活動完整成功替換。身分期限與角色檢查仍有效，沒有因結束而另行延長查閱期限。

## D01 資料公開例外與角色契約

原需求 §6.1 概括禁止學生取得他組資料，§5.5 要求結束後列出成功組答案。已確認 D01／AR02 的處理為：**活動結束後，僅對有效已入組學生公開每題成功組別、完整答案及送出者，並保留本組作答；其他組未搶到的答案及完整排名仍不公開。** 這是明確例外，不將整份老師結果下載到學生後再隱藏。

| 身分與階段 | 可取得的資料 |
|---|---|
| 未登入／未入組 | 大廳階段及公開組別人數；不能取得組別結果 |
| 老師（有活動） | 完整題目、全部組別提交、答案、名次及原提交時間 |
| 學生 READY | 題號與本組成員等基礎資訊，不含敘述、來源答案或結果 |
| 學生 RUNNING | 全部題目、本組提交與送出者；無他組提交線索、答案或排名 |
| 學生 ENDED | 全部題目、每題成功組資料、本組完整提交／三種狀態及成功題數；無其他未成功答案或完整排名 |

`GET /api/activities/{id}/results` 與 `GET /api/activities/current/view` 共用既有權威投影；WebSocket 更新及重連快照亦共用同一白名單。學生回應不含數字 rank、全域活動 version、receivedAt、submittedAt、receiveOrder、requestId 或請求雜湊。每個 WS 通道有獨立 revision，別組提交不會使無權學生的通道增加可見版本；隨機 operationId 不是排名序號。

伺服器逐次驗分頁憑證、原頁證明、執行個體／世代、期限、撤銷及目前參與；不信任 `X-Role`／`X-Group-Id`。結果查詢不接受任意 groupId、role 或 includeAll 查詢參數；偽造不會擴大資料範圍。過期身分、舊活動及未登入結果查詢皆拒絕。取得 WS 票證亦不能指定他組或老師頻道。

## 實作與任務對應

| 任務 | 實作及證據 | 規格 |
|---|---|---|
| 11.1 | 既有 `api.ts`、`projections.ts` 角色／階段結果查詢完成整合驗證；HTTP 全角色、READY／RUNNING／ENDED、偽造標頭／參數、過期及舊活動 | AR01、AR02、AR05 |
| 11.2 | 既有伺服器投影計算本組三種狀態及成功題數，前端只呈現；單元、HTTP 整合與 Chrome 四子題只計一題 | AR03 |
| 11.3 | 新增 `src/client/results.tsx`，由 `student.tsx` 的 ENDED 分支接入；完整答案、三狀態、無人題、結束時輸入與重整／重啟 | AR02、AR03、AR04、SP07、D36 |
| 11.4 | 新增 `tests/integration/results.test.ts`、`tests/browser/results.spec.ts` 及本文件；HTTP、WS 更新／重新訂閱／重啟快照及資料洩漏回歸，明列 D01 | AR01～AR05 |

這一階段沿用已實作並經新測試核實的後端資料契約與計分，不為任務勾選另外建立重複服務。後端程式、共用型別、資料庫 schema 與 migration 沒有變更。

新增檔案：`src/client/results.tsx`、上述兩份測試、本文件、`docs/evidence/results-browser.json`、`results-verification.json`。修改：`src/client/student.tsx`、`src/client/style.css`、`package.json` 的測試命令、`README.md`、`docs/backend-api-contracts.md`、OpenSpec `tasks.md`。沒有新增套件，lockfile 不變。

## 測試與可重現方式

```sh
npm run typecheck
npm run test:results
npm test
npm run test:browser
npm run test:startup
```

`test:results` 執行既有角色投影單元測試及新增結果 HTTP／WS 整合測試；`test:http` 也已納入新增結果整合檔案。最終全套數量及結果見 `docs/evidence/results-verification.json`。

新增兩項後端整合流程：

1. 三組於單題／題組依序提交，逐角色查詢 READY／RUNNING／ENDED，驗三種成績、題組一題、HTTP current view 與 results 一致、老師全部可見、未成功答案隔離、查詢參數與角色標頭偽造、重啟及換場拒絕舊身分。
2. 無權組在其他組提交後沒有更新或通道 revision 增加；RUNNING 重新訂閱仍無他組答案，ENDED 更新及重新訂閱／重啟快照只增加成功答案，拒絕跨組票證與過期請求。

新增一項真 Chrome 完整結果流程：同一 context 的一老師、四學生、四組，四題含四子題題組；本組可同頁涵蓋成功、未搶到、未作答，成功題數分別為 1、1、1、0。第 4 組正在輸入時結束，自動進結果並失去提交表單，未作答仍能看成功答案。檢查 DOM、HTTP 及捕捉的 WS 資料均不含其他未成功答案、數字排名或來源舊答案；老師保留全部五筆。原頁重整與服務重建後，自動恢復完整結果及原成功題數，捕捉新 epoch 快照核對。

截圖為 `test-results/results-desktop.png`、`results-mobile.png`。已人工檢查四子題、公開及本組答案、純文字 HTML 外觀、換行、三種狀態及無人題；390px 無水平溢出。原始測試產物受忽略規則保護，摘要另存上述 evidence。

所有新測試使用臨時服務、合成資料及隔離 SQLite，未修改正式活動或外部 Sheets。服務重建的 Chrome 測試不是完整作業系統程序故障驗收；沿用全套既有 SIGKILL 整合案例也不代表第 13 群組全部通過。

## 保留事項

原始 `docs/requirements.md`、proposal、design 及 10 份正式規格保持原樣；任務只更新本階段四項及追蹤紀錄。資料庫維持 schema 3／18 張表，啟動方式與既有技術選型不變。

第 12 群組三模式 Sheets 匯出、匯出五狀態、核對及放棄換場仍未實作。第 13 群組 42 分頁／20 輪完整流程、效能與跨功能故障驗收仍未完成，U02 凍結／休眠與 U03 未核實範圍政策保留。本階段的資料矩陣與小規模真 Chrome 流程不能取代這些驗收。
