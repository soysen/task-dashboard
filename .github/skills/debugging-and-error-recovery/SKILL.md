---
name: debugging-and-error-recovery
description: "系統性診斷並修復 Task Dashboard 系統錯誤（後端 Node.js API、前端 DOM 互動、macOS 原生外殼、FSEvents 哨兵）。"
argument-hint: "描述遇到的錯誤或報錯內容，例如：watch-task-gate 喚醒異常或 API 回傳 500"
user-invocable: true
---

# 除錯與錯誤恢復 (Debugging & Error Recovery)

## 核心原則與絕對邊界

> **[Task Dashboard 除錯鐵律]**：
> 1. **嚴禁憑感覺猜測 (No Vibe Debugging)**：在取得精確報錯訊息、HTTP 狀態碼或終端 Traceback 前，禁止盲目修改後端或前端程式碼。
> 2. **重現優先 (Reproduction Mandatory)**：先以最小 curl 指令、單元測試腳本或明確操作步驟穩定重現錯誤。
> 3. **治本不治標 (No Symptom Patching)**：嚴禁使用空 catch 吞掉異常或隨便給予假資料 fallback。修復必須針對 Root Cause。
> 4. **大檔掃描與 Token 節約防迴圈 (Anti-Loop & Fast-Track)**：
>    - `src/public/index.html` 與 `src/server/server.js` 均為長檔案（> 4000 行），**嚴禁整檔閱讀或連續翻頁**。
>    - 一律先使用 `grep -n` 定位目標行，以切片檢索前後 30-50 行。
>    - 相同目標檢索上限為 2 次，確認問題後立即進入實作與測試驗證，嚴防原地陷入循環。

## 適用時機

- 執行 `npm test` 或 `npm run harness:check` 遭遇紅燈或語法錯誤。
- 後端 HTTP API（`/api/tasks`, `/api/projects` 等）拋出 400/404/500 錯誤。
- 哨兵腳本（`watch-task-gate.js`）無法正確感應檔案異動或意外退出。
- 前端面板 Modal 彈窗或 Kanban 卡片狀態顯示不一致。

## 除錯六步驟 (Root-Cause Recovery Flow)

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
