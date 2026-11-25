# TASK-239 Execution Plan & Handoff Contract (Round 3 — Compact Sidebar Summary & Strict Single-File Diff)

## 1. Objective & Feedback Requirements
Refine the Master-Detail Git Diff view (`#modalRightColumn`) inside `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-239`:
1. Narrow the file list column further (`#diffFileListPane`: `lg:w-64 flex-shrink-0` instead of `lg:col-span-4`, giving `#diffContentPane` `flex-1 min-w-0` maximum room).
2. Move `#diffSummaryBar` into `#diffFileListPane` (same left column, right above `#formModifiedFilesList`), and remove the `"全部檔案"` (`#btnShowAllDiffs`) and `"全部折疊"` (`#btnToggleCollapseAll`) buttons.
3. Ensure the right column (`#formDiffVisual`) strictly shows ONLY the selected single file (auto-selecting the first file even when `modifiedFiles` is omitted and parsed from `task.diff`, and fixing `filterDiffForFile` so diff body text matching cannot pull in extra files).

## 2. Edit Targets
- `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-239/src/public/index.html`
- `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-239/src/public/modules/modal.js`
- `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-239/src/public/modules/diffViewer.js`
- `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-239/scripts/test_ui_behavior.js`

## 3. Read Allowlist & Constraints
Only inspect/edit the 4 Edit Target files above inside `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-239`.
Do NOT remove exports `showAllDiffs` or `toggleCollapseAllDiffs` from `diffViewer.js` (so `app.js` imports remain unbroken). Do NOT touch `src/native/main.m`, `/Users/nelsonchung/projects/task-dashboard/`, or `data/tasks.json`.

## 4. Implementation Slices

### Slice 1 — Compact Left Sidebar with Summary Bar & No "全部檔案"/"全部折疊" (`src/public/index.html`)
Replace `#modalRightColumn`'s internal toolbar + `#diffMasterDetailGrid` (`L926-983`) with:
- `<div id="diffMasterDetailGrid" class="flex-1 min-h-0 flex flex-col lg:flex-row gap-3">`
  - **Left Column** (`<div id="diffFileListPane" class="w-full lg:w-64 flex-shrink-0 flex flex-col gap-2 min-h-0">`):
    - `<div id="diffSummaryBar" class="hidden flex-shrink-0 td-surface-panel rounded-xl px-2.5 py-2 flex flex-col gap-1.5">`:
      - Row 1: `git-compare` icon + `<span id="diffStatFilesCount">0 檔</span>`, `<span id="diffStatAdditionsBadge">+0</span>`, `<span id="diffStatDeletionsBadge">-0</span>`
      - Row 2: `<span id="diffActiveFileBadge" class="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate flex-1 min-w-0">尚未選取檔案</span>`, `<button id="btnToggleFocusMode" onclick="toggleDiffFocusMode()" ...>` (`專注檢閱`), `<button onclick="copyCurrentDiff()" ...>` (`copy` icon)
      - Do NOT include `#btnShowAllDiffs` ("全部檔案") or `#btnToggleCollapseAll` ("全部折疊") anywhere in `index.html`.
    - `<div id="formModifiedFilesList" class="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-1.5 text-xs space-y-1 font-mono overflow-y-auto custom-scrollbar min-h-0">`
  - **Right Column** (`<div id="diffContentPane" class="flex-1 min-w-0 flex flex-col min-h-0">`):
    - `#formDiffVisual` (full height & width) + `<input type="hidden" id="formDiff">`

### Slice 2 — Strict Single-File Selection & Matching (`src/public/modules/diffViewer.js`, `src/public/modules/modal.js`)
1. **`src/public/modules/diffViewer.js`**:
   - In `updateDiffSummaryBar`: format `filesEl.innerText` concisely as `` `共 ${trueFilesCount} 檔` `` so it fits cleanly inside the narrow `lg:w-64` summary bar.
   - In `filterDiffForFile(filePath)`:
     - Use null-safe `const badgeEl = document.getElementById('diffActiveFileBadge'); if (badgeEl) badgeEl.innerText = ...`.
     - Match sections STRICTLY by `sec.filePath` priority (1: exact `secPath === cleanTarget`; 2: relative path suffix `secPath.endsWith('/' + cleanTarget) || cleanTarget.endsWith('/' + secPath)`; 3: basename `secPath === baseName || secPath.endsWith('/' + baseName)`), NEVER matching `sec.lines.some(...)` body text or `sec.header.includes(...)`! Take `matched[0].fullText` so ONLY ONE file section is ever rendered on the right.
2. **`src/public/modules/modal.js`**:
   - Import `splitDiffByFiles` from `./diffViewer.js`.
   - Extract helper `resolveModifiedFileEntries(task)`: if `task.modifiedFiles` has entries, normalize them `{ path, description }`; otherwise parse `splitDiffByFiles(task.diff || '')` and map each unique non-empty `sec.filePath` to `{ path: sec.filePath, description: '' }`.
   - Populate `#formModifiedFilesList` from `resolvedFiles` (`max-w-[140px]` / `min-w-0 flex-1` cleanly truncated for narrow `lg:w-64` width).
   - In `isDiffVisibleStatus(task.status)`: if `resolvedFiles.length > 0`, call `filterDiffForFile(resolvedFiles[0].path)` so the right column defaults to showing ONLY the first selected file (falling back to `renderDiffViewer('')` only when no files and no diff exist).

### Slice 3 — Update Verification Tests (`scripts/test_ui_behavior.js`)
Update Section 24 in `scripts/test_ui_behavior.js`:
- Assert `#diffSummaryBar` sits inside `#diffFileListPane` (`summaryBarIdx > fileListPaneIdx && summaryBarIdx < contentPaneIdx`), and assert `index.html` no longer renders `btnShowAllDiffs`, `全部檔案`, `btnToggleCollapseAll`, or `全部折疊`.
- Assert `#diffFileListPane` uses `lg:w-64` (narrower width) and `#diffContentPane` uses `flex-1 min-w-0`.
- Add `24-4` testing `filterDiffForFile('src/public/index.html')` with a 2-file `currentActiveTaskDiff` where the second file (`scripts/test_ui_behavior.js`) contains `src/public/index.html` inside a `+` diff line: verify `renderDiffViewer` receives ONLY `src/public/index.html`'s diff section and NOT `scripts/test_ui_behavior.js`!

## 5. Verification Plan
Run inside `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-239`:
- `npm run harness:check && npm test` (must exit 0).
