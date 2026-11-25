# Handoff Contract — TASK-236: 3.0 UI/UX 優化

- **Baseline**: Branch `td/TASK-236` (worktree `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-236`), HEAD `a953b48`
- **Impact**: `MEDIUM` — 調整左側專案列表手風琴互動與選取狀態刪除 icon 對比、簡化頂部控制列與階段計量列、重新配置「看板 / 按分支看」位置、強化暗黑模式線條與色塊對比，並同步更新 `scripts/test_ui_behavior.js` 斷言。
- **Constraints**:
  - 最小範圍實作，零第三方套件；僅修改本任務相關前端與測試檔案。
  - 嚴禁寫入或污染 `data/tasks.json` 或 `~/Library/Application Support/TaskDashboard/`。
  - 所有 HTML `onclick`/`onchange` 函式必須同步匯出並掛載至 `window.*`。
  - 不得執行 `git commit`，不得呼叫 Task Dashboard API 推進 TASK-236 狀態，不得啟動 `watch-task-gate.js`。
  - 保留既有 `scripts/test_ui_behavior.js` 未受本任務移除項目影響的所有檢核（如 `dark:bg-slate-800`, `dark:border-slate-600`, `--td-primary:`, `--td-status-review:`, `td-surface-well`, `td-surface-card`）。
- **Do-Not-Read**: 嚴禁讀取 `README.md`、`HARNESS.md`、`CLAUDE.md`、`docs/*`、`.github/skills/*` 或其他 build plan；嚴禁執行 GitNexus 或 `npm run harness:check`。
- **Escalation**: 資訊不足時最多額外讀取 2 次（>500 行檔案須先 `grep -n` 再切片）；仍不足即停止並回報主 Agent。

## Edit Targets & Read Allowlist

1. **`src/public/modules/state.js`**
   - Read Allowlist: `L1-66`
   - Edit:
     - 新增 `export let expandedProjectId = null;` 與 `export function setExpandedProjectId(val) { expandedProjectId = val || null; if (typeof window !== "undefined") window.expandedProjectId = expandedProjectId; }`。
     - 於 `if (typeof window !== "undefined")` 同步掛載 `window.expandedProjectId` 與 `window.setExpandedProjectId`。

2. **`src/public/style.css`**
   - Read Allowlist: `L39-95`
   - Edit:
     - 提升 `.dark` 區塊之畫布 (`--background: #0c0f14`)、凹槽 (`--sidebar: #141922`)、卡片 (`--card: #1d2430`)、內嵌面板 (`--td-panel: #252e3d`)、邊框線條 (`--border: #3a4659`)、次要文字 (`--muted-foreground: #a3b2c7`) 及立體陰影階層。
     - 新增 `.dark .td-surface-well`、`.dark .td-surface-card`、`.dark .td-surface-card:hover` 與 `.dark .td-surface-panel` 對比規則，確保暗黑模式線條與色塊層次分明。

3. **`src/public/index.html`**
   - Read Allowlist: `L15-65`, `L130-200`, `L315-390`
   - Edit:
     - 更新 Tailwind `slate` 深色階 (`700: '#354052'`, `800: '#212834'`, `900: '#161b24'`, `950: '#0c0f14'`) 及 `darkbg`/`darkcard`/`darkborder` 對應高對比色票。
     - 移除 `#sidebarFooter` 內的手動加入專案按鈕 (`<button onclick="openNewProjectModal()" ...>`，約 `L137-139`)。
     - 移除最上方控制列之 `#headerWorkflowHint` (`L162-177`)、`#searchInput` 區塊 (`L184-188`) 與 `#priorityFilter` 下拉選單 (`L190-196`)。
     - 移除任務階段篩選列之 `#stage-pill-ALL` (`全部階段`，`L345-351`)，並將外層網格由 `sm:grid-cols-5` 改為 `sm:grid-cols-4`。
     - 於階段篩選列右側（`L342` flex 容器內、4 個階段膠囊之後）新增 `<div id="boardViewToggleSlot" class="hidden flex-shrink-0 flex items-center justify-end"></div>`，作為「看板 / 按分支看」專屬位置。

4. **`src/public/modules/app.js`**
   - Read Allowlist: `L1-25`, `L670-775`, `L1055-1075`, `L1155-1249`
   - Edit:
     - 從 `./state.js` 匯入 `expandedProjectId`, `setExpandedProjectId`。
     - 新增 `toggleProjectExpand(projId, event)` 並同步匯出及掛載 `window.toggleProjectExpand`：若點擊項目已展開則收合 (`setExpandedProjectId(null)`)，否則展開該項目 (`setExpandedProjectId(projId)`) 並同時收合其餘項目（一次僅能展開一項），重繪 `renderSidebarProjects()`。
     - 更新 `filterByProject(projId)`：點選 `'ALL'` 時清空 `expandedProjectId`；點選特定專案時，若該專案已為根目錄選取且已展開則收合，否則選取該專案並展開之（僅此一項展開）。
     - 更新 `renderSidebarProjects()`：
       - 以 `expandedProjectId === p.id` 判斷 `isExpanded`，渲染手風琴箭頭 (`chevron-down` / `chevron-right`) 與 `aria-expanded="${isExpanded}"` 切換按鈕，僅於 `isExpanded` 為 true 時呼叫 `${renderProjectBranchTree(p)}`。
       - 修正專案列在 `isProjOnly` 選取狀態下的刪除按鈕 (`deleteProject`) 對比度：選取時改用高對比樣式（如 `opacity-80 group-hover/proj:opacity-100 p-1 rounded bg-black/20 hover:bg-rose-600 text-white`），未選取時為 `opacity-0 group-hover/proj:opacity-100 focus:opacity-100 p-1 text-[var(--muted-foreground)] hover:text-rose-500 hover:bg-rose-500/10 rounded`。
     - 將 `L1062-1063` 對 `searchInput` 與 `priorityFilter` 的事件綁定改為安全可選鏈 `?.addEventListener(...)`。

5. **`src/public/modules/branchNavigator.js`**
   - Read Allowlist: `L1-210`
   - Edit:
     - 從 `./state.js` 匯入 `expandedProjectId`, `setExpandedProjectId`。
     - `selectProjectAndBranch(projectId, branchName, event)`：同步 `setExpandedProjectId(targetProject === "ALL" ? null : targetProject)`；若點選特定分支 (`targetBranch !== "ALL"`) 且 `groupByBranch` 為 true，則自動切回 `setGroupByBranch(false)` 以展示該分支看板。
     - `renderContextualHeaderActions()`：
       - 最上方控制列 `#contextualHeaderActions` 移除 `＋ 新建分支`、`＋ 新增任務` 與「看板 / 按分支看」；僅於 L2 非預設主幹分支且有已提交 `done` 任務時顯示 `合併回 <defaultBranch>`，其餘情況隱藏。
       - 將「看板 / 按分支看」Segmented Control 渲染至 `#boardViewToggleSlot`：只要 `currentProject !== "ALL"`（包含選取專案根目錄及任一分支）且未開啟編輯彈窗時即清楚顯示並可隨時切換，在 `currentProject === "ALL"` 時隱藏。
     - `toggleBranchGroupView(enabled)`：當切換為 `按分支看` (`true`) 且 `currentBranch !== "ALL"` 時，自動重置 `setCurrentBranch("ALL")` 並同步重繪 `renderSidebarProjects`、`renderContextualHeaderActions`、`renderKanban`、`renderMetrics`。

6. **`src/public/modules/kanban.js`**
   - Read Allowlist: `L24-63`, `L87-140`
   - Edit:
     - `renderMetrics()` (`L33`)：`stat-total` 寫入改為空值防禦 (`const totalEl = document.getElementById('stat-total'); if (totalEl) totalEl.innerText = filtered.length;`)。
     - `renderKanban()` (`L88-89`)：`searchInput` 與 `priorityFilter` 讀取改為空值防禦 (`document.getElementById('searchInput')?.value || ''` 與 `document.getElementById('priorityFilter')?.value || 'ALL'`)。

7. **`scripts/test_ui_behavior.js`**
   - Read Allowlist: `L200-250`, `L310-325`
   - Edit:
     - 更新與 TASK-236 衝突之舊斷言（移除 `stage-pill-ALL` 存在與 `headerWorkflowHint` 存在斷言），改為驗證上述項目已移除，並新增驗證：手風琴單一展開 (`expandedProjectId` / `toggleProjectExpand`)、`#boardViewToggleSlot` 於選取專案後可見且 `#contextualHeaderActions` 不含「新建分支」與「新增任務」、選取狀態刪除 icon 高對比樣式、暗黑模式 CSS 變數對比強化。

## Slices

- [ ] **Slice 1 [TASK-236]**: 更新 `state.js`、`style.css`、`index.html`（暗黑模式對比、移除頂部與列表下方冗餘元素、移除全部階段、配置 `#boardViewToggleSlot`）
  - 驗收指令: `node -e 'const fs=require("fs"); const h=fs.readFileSync("src/public/index.html","utf8"); if(h.includes("headerWorkflowHint")||h.includes("searchInput")||h.includes("priorityFilter")||h.includes("stage-pill-ALL")||h.includes("openNewProjectModal()")) process.exit(1); if(!h.includes("boardViewToggleSlot")) process.exit(1); console.log("Slice 1 HTML OK");'`
- [ ] **Slice 2 [TASK-236]**: 更新 `app.js`、`branchNavigator.js`、`kanban.js`（單項手風琴開闔、刪除 icon 對比、#boardViewToggleSlot 與頂部控制列精簡、空值防禦）
  - 驗收指令: `node --input-type=module -e 'import("./src/public/modules/state.js"); console.log("ESM syntax check");' && node --check src/public/modules/state.js && node --check src/public/modules/app.js && node --check src/public/modules/branchNavigator.js && node --check src/public/modules/kanban.js`
- [ ] **Slice 3 [TASK-236]**: 更新並執行前端測試 `scripts/test_ui_behavior.js` 與 `scripts/test_confirmation_ux.js`
  - 驗收指令: `node scripts/test_ui_behavior.js && node scripts/test_confirmation_ux.js`

## Return Format

實作完成後，請以簡潔 JSON / 列表回報：
- `modifiedFiles`: 實際異動檔案清單
- `slices`: 各切片之 `{ command, cwd, exitCode, rawLog }`
