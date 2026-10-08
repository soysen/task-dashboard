---
name: debugging-and-error-recovery
description: "系統性診斷並修復 Task Dashboard 系統錯誤（後端 Node.js API、前端 DOM 互動、macOS 原生外殼、FSEvents 哨兵）。使用時機：遭遇語法錯誤、測試紅燈、API 異常回傳或進程終止時觸發。"
argument-hint: "描述遇到的錯誤或報錯內容，例如：watch-task-gate 喚醒異常或 API 回傳 500"
user-invocable: true
freedom: high
models-tested: [flash, sonnet, opus]
---

# 除錯與錯誤恢復 (Debugging & Error Recovery)

## 目錄
1. [硬性規則 (Must)](#硬性規則-must)
2. [適用時機與豁免規則](#適用時機與豁免規則)
3. [除錯六步驟 (Root-Cause Flow)](#除錯六步驟-root-cause-flow)
4. [常見情境排查指南](#常見情境排查指南)
5. [完成前檢核](#完成前檢核)

## 硬性規則 (Must)
1. **[MUST] 嚴禁憑感覺猜測 (No Vibe Debugging)**：在取得精確報錯訊息、HTTP 狀態碼或 Traceback 前，禁止盲目修改任何後端或前端代碼。
2. **[MUST] 穩定重現優先 (Reproduction Mandatory)**：先以最小測試案例、curl 請求或重現腳本確認錯誤存在，修復後以同一案例驗證。
3. **[MUST] 治本不治標 (No Symptom Patching)**：嚴禁使用空 catch 吞掉異常或給予不合規的 mock fallback；修復必須直指 Root Cause。
4. **[MUST] 大檔切片檢索與防迴圈 (Anti-Loop & Fast-Track)**：面對 `index.html` 或 `server.js` 嚴禁整檔全覽；一律以 `grep -n` 定位後切片檢視，相同區塊檢索上限 2 次。

## 適用時機與豁免規則
- **適用時機**：執行 `npm test` 或 `npm run harness:check` 遭遇紅燈；後端 HTTP API 拋錯；哨兵進程異常退出；前端 Modal/看板渲染異常。
- **豁免規則**：單純文檔修正或已知預期行為微調，無需進入完整除錯循環。

## 除錯六步驟 (Root-Cause Flow)

```text
1. REPRODUCE → 穩定重現（透過 curl、單元測試或 scripts/test_server.sh 執行）
2. LOCALIZE  → 檢查 Call-stack 與錯誤日誌，以 grep -n 精準定位到具體程式行
3. REDUCE    → 隔離出最小問題邏輯
4. FIX       → 針對根本原因修復，遵循目錄架構與狀態機規則
5. GUARD     → 補充或更新測試案例（scripts/test_server.sh），防止退化
6. VERIFY    → 執行 npm test 與 npm run harness:check 確保 100% 綠燈
```

## 常見情境排查指南

### 1. 後端 API 或伺服器異常
- 檢查 Node.js 語法：`node -c src/server/server.js`。
- 檢查路由與 JSON 解析是否在 try-catch 中妥善回傳 status code。
- 檢查資料庫讀寫路徑是否為 `resolveDataDir()` 所指向的真實路徑。

### 2. 前端面板畫面或腳本錯誤
- 檢查 `index.html` 內的 `<script>` 區塊語法：使用 `node -e "..."` 驗證語法完整性。
- 檢查全域事件綁定、DOM ID 是否唯一且存在。

### 3. 哨兵與背景進程喚醒
- 檢查目標監控檔案是否存在：`tasks.json`。
- 檢查 `watch-task-gate.js` 的 `fs.watch` 或檔案輪巡機制是否保持在背景守候。

## 完成前檢核
- [ ] 錯誤已被重現且有具體修復依據，非暫時性治標。
- [ ] 執行 `npm test` 與 `npm run harness:check` 確保 100% 綠燈。
- [ ] 無遺留除錯用 `console.log` 或未清理之臨時測試檔案。
- [ ] 符合大檔切片讀取規範，未造成上下文膨脹。
