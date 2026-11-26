# G2 身分恢復邊界驗證與 U01 待確認建議

**後續狀態：使用者已明確選 A，登錄 D38 並完成本階段恢復實作。以下保留確認前的探針觀測及候選比較；最新結果見 [恢復完成紀錄](realtime-recovery.md)。現在 `npm run probe:g2` 產生 D38 確認後的 `g2-confirmed-recovery-probe.json`，不覆寫以下確認前的原始證據。**

日期：2026-11-26（Asia/Taipei）。Change：build-local-classroom-response-system。進度維持 42／85；本次探針不是 7.4／7.5 已完成的證據。

## 實際執行結果

使用 Node.js 24.22.3、真子程序 SIGKILL、真 SQLite WAL／FULL 交易與現有 IdentityService，完成五種隔離故障注入。程式在系統臨時目錄建立合成活動、合成分頁憑證與資料庫，完成後刪除；不讀寫正式 data/、不操作目前活動、不存取 Google。

寬限起點 1000ms、截止 31000ms、恢復 60000ms 均使用注入時鐘。SIGKILL 及 SQLite 回滾是真實執行，但沒有等待牆鐘 30 秒，也不是 Chrome／完整 WebSocket 生命週期驗收。GRACE 狀態由探針直接建立，正式最後有效 socket 斷線轉換仍待 7.4。故障注入用 trigger 於重啟後先移除，再驗正式身分恢復；未修改權威資料列。

| 案例 | 中斷點 | 已保存狀態 | 目前恢復結果 |
|---|---|---|---|
| before-deadline | 邏輯時間 30999ms，尚未進撤銷交易 | GRACE、JOINED、running=1 | RECOVERY_UNCERTAIN，未自動恢復或撤銷 |
| rollback-revocation | 邏輯時間 31000ms，撤銷交易 COMMIT 前強制中斷 | 交易回滾，仍 GRACE、JOINED、running=1 | RECOVERY_UNCERTAIN，未自動恢復或撤銷 |
| committed-revocation | 截止後撤銷及成員移除 COMMIT 完成 | REVOKED、INVALID | SESSION_DISCONNECTED，不復活 |
| clean-before | 截止前正常關機檢查點已保存，再切斷程序 | CLEAN_SHUTDOWN、GRACE、running=0 | 可恢復同一身分，不延長固定期限 |
| clean-expired | 正常關機先保存截止撤銷，再切斷程序 | REVOKED、INVALID、running=0 | SESSION_DISCONNECTED，不復活 |

前兩案的生命週期、撤銷原因、建立／到期、寬限起訖、state_version、停機證據、成員狀態及 runtime running，逐欄比較完全相同。比較不含各案例隨機產生的身分 ID／憑證雜湊，亦不宣稱整個資料庫逐位元相同。兩案再推進至固定 12 小時，皆為 SESSION_EXPIRED 且成員移除。

原始證據：[g2-recovery-probe.json](evidence/g2-recovery-probe.json)。重現命令：`nvm use` 後執行 `npm run probe:g2`。探針結果 NOT_PROVEN 表示現有紀錄不能精確辨別 U01 歷史，不表示 SQLite 原子性失敗。

## 能確定與不能確定的界線

已 COMMIT 的失效不復活；正常關機檢查點可區分已到期與仍有效；固定 12 小時仍優先。這些已確認契約在本次隔離測試成立。

目前紀錄不能區分「截止前程序已停機」與「截止時已嘗試撤銷，但交易尚未落盤就停止」。增加有限頻率存活檢查點只能縮小觀測區間；在相鄰持久紀錄之間仍可能停止，不能據此宣稱精確停機時刻已知。這是從上述觀測與記錄邊界作出的工程分析，不是已執行所有候選方案後的普遍實驗證明。

因此 G2 仍為部分驗證，U01 仍待人工裁定。本次不將「沒有撤銷列」冒充為歷史上確定有效，也不把尚未 COMMIT 的決定當成已保存失效。

## 提供人工確認的候選政策

以下均為**建議，尚未確認，未寫入正式規格或產品恢復流程**。

### A．以最後已提交狀態作為不明中斷的恢復依據（建議）

僅針對無法證明截止前後的非正常中斷：固定 12 小時未到、未因登出／新活動／密碼變更等撤銷、最後已提交狀態仍為 CONNECTED 或 GRACE 的原分頁，服務恢復後重新給 30 秒重連時間；已提交 REVOKED／EXPIRED 及到期者一律不恢復。組別、答案、排名及原到期時間不變，不能藉副本接手。

代價：如 rollback-revocation，實際已到寬限但尚未保存失效者也可能取得恢復機會。這必須是明確同意的 U01 例外政策，不能說成現有紀錄已證明它從未逾期。一般正常運作仍照 30 秒，不能無限延後正常斷線失效。

此建議適合本機課堂避免一次非正常停止讓原分頁全部卡在不確定狀態。確認後須更新正式設計、RR04／PS01 的例外與驗收情境、7.4／7.5 完成條件及本報告狀態，再實作；既有 D03／D04 的可證分支與其他限制維持。

### B．不明者維持待確認，不自動授權

保留目前 RECOVERY_UNCERTAIN 行為：不清資料、不裁定有效或永久失效；等待個案證據或後續另外確認的處理方式。

代價：不明的原分頁不能達到五秒自動恢復，目前有不明學生時大廳／活動投影亦會暫停，避免假造人數。若要建立人工核准介面或更細的處理權限，須另定完整規格，不能只說人工處理便宣稱功能完成。選此項仍須明確記錄 U01 例外，相關完整驗收不能預勾。

## 本次停止規則

正式設計 Open Questions／U01 要求「不能消除時，將可證範圍與可選政策交人工決定，不預設復活或預設失效」。Apply Skill 要求「If task is ambiguous, pause and ask before implementing」。本報告及探針提供可審查結果，尚未選 A 或 B；7.4、7.5 及最終恢復驗收維持未完成。U02 凍結／丟棄／休眠與 U03 未核實範圍也未裁定。

後續只有在收到明確政策選擇後，才更新正式規劃文件並實作該分支；「繼續」不推定為同意 A。
