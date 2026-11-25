# TASK-239 Execution Plan & Handoff Contract (Round 4 — 25%-30% Width & Filename-First File List)

## 1. Objective & Feedback Correction
Refine `#diffFileListPane` and `.mod-file-item` rendering inside `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-239`:
1. Set `#diffFileListPane` desktop width to **`lg:w-[28%]`** (25%–30% range) with `lg:min-w-[230px] flex-shrink-0` while `#diffContentPane` takes `flex-1 min-w-0`.
2. Render each file list item in `#formModifiedFilesList` with the **filename (`baseName`) prominently on the first line** and the **directory path (`dirPath`) in small text below the filename** (instead of a single truncated full-path string).

## 2. Edit Targets
- `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-239/src/public/index.html`
- `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-239/src/public/modules/modal.js`
- `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-239/scripts/test_ui_behavior.js`

## 3. Read Allowlist & Constraints
Only inspect/edit the 3 Edit Target files above inside `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-239`.
Do NOT touch `src/native/main.m`, `/Users/nelsonchung/projects/task-dashboard/`, or `data/tasks.json`.

## 4. Implementation Slices

### Slice 1 — Set `#diffFileListPane` Width to 28% (`src/public/index.html`)
- At `src/public/index.html` around `L932`:
  Change `<div id="diffFileListPane" class="w-full lg:w-64 flex-shrink-0 flex flex-col gap-2 min-h-0">` to:
  `<div id="diffFileListPane" class="w-full lg:w-[28%] lg:min-w-[230px] flex-shrink-0 flex flex-col gap-2 min-h-0">`

### Slice 2 — Filename-First + Small Path Below Rendering (`src/public/modules/modal.js`)
- In `renderModifiedFilesList(task, modFilesList)` (`L45-83`):
  - Split `filePath` cleanly:
    ```js
    const lastSlashIdx = filePath.lastIndexOf('/');
    const fileName = lastSlashIdx >= 0 ? filePath.slice(lastSlashIdx + 1) : filePath;
    const dirPath = lastSlashIdx > 0 ? filePath.slice(0, lastSlashIdx) : '';
    ```
  - Remove restrictive `max-w-[140px]` on the left content wrapper (`class="min-w-0 flex-1"`).
  - First row inside item: `${statusBadge}` + `<span class="text-indigo-600 dark:text-indigo-300 font-semibold truncate text-xs font-mono">${escapeHtml(fileName)}</span>` (with `linesStat` on the right).
  - Second row (when `dirPath` is non-empty): `<div class="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate mt-0.5 pl-5">${escapeHtml(dirPath)}</div>`.
  - Keep `data-path="${escapeHtml(filePath)}"`, `title="${escapeHtml(filePath)}"`, and `onclick="filterDiffForFile('${escapeHtml(filePath)}')"` intact, and keep optional `descHtml` (`pl-5`) if `desc` is present.

### Slice 3 — Update Regression Tests (`scripts/test_ui_behavior.js`)
- Update Section 24 (`L954`): assert `#diffFileListPane` uses `lg:w-[28%]` and `flex-shrink-0`.
- Extend `24-4`: test `renderModifiedFilesList` with `src/public/modules/modal.js` and verify `modal.js` renders prominently as the main label while `src/public/modules` renders in small `text-[10px]` text below it.

## 5. Verification Plan
Run inside `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-239`:
- `npm run harness:check && npm test` (must exit 0).
