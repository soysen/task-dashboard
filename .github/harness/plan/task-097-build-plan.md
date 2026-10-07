# Build Plan: [TASK-097] 執行紀錄回到缺乏細節的呈現

- Status: done
- Skill Route: dashboard-state-and-sync
- Feature Name: 執行紀錄回到缺乏細節的呈現

## 任務卡 (Task Card)

- 目前任務 ID: TASK-097
- 目標: 執行紀錄與 log 的呈現只有回報工作，看不到執行細節，應該修正
- 路由: dashboard-state-and-sync
- 範圍 (In/Out): In: 依執行計劃實作 / Out: 跨專案副作用
- 驗收標準: 執行計劃步驟實作與驗證完成
- 驗證證據: node scripts/test_execution_logs.js 七種 CLI 情境通過；隔離 HOME 的 npm test 與 npm run harness:check 均 exit 0。
- 阻塞/恢復入口: .github/worklog/agent-status.md

## Slices
- [x] Slice 1: [TASK-097] 重現通用模板無證據宣稱完成，確認 CLI 回填僅保留末端 2000 字元、即時緩衝上限 100KB。
- [x] Slice 2: [TASK-097] 日誌落盤後保存本輪完整輸出、退出碼與 Signal；保留早期錯誤與每輪重試輸出；日誌 I/O 失敗不得視為成功。
- [x] Slice 3: [TASK-097] 中性階段提示、保留原始空白與格式化冪等性；強化 CLI / Desktop 回饋提示及相關文件。
- [x] Slice 4: [TASK-097] 超過 100KB 的多行 Unicode / HTML 字元、stdout/stderr、失敗三輪重試、待確認、空輸出與日誌寫入失敗驗證通過；API 保存內容逐字比對通過。

## 風險與驗收

- 刷新索引後，executeTaskWithCliAgent、formatStructuredExecutionLog 與 server 的 upstream impact 均為 LOW；前端 rejectTaskWithFeedback 未被索引，為 UNKNOWN，文字搜尋確認由退回按鈕呼叫，僅修改提示內容。
- 全量 detect-changes 評估為 HIGH（11 個相關服務流程），不代表零風險；索引流程分析另有截斷警告，不宣稱圖譜覆蓋完整。以隔離 CLI / API 回歸及既有完整測試補足實際路徑驗證。
- 未重新啟動正式後端、未編譯原生外殼；新增後端行為於後端重新啟動後生效。舊任務缺失的歷史輸出無法補造。
