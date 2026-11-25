# TASK-240 Final Execution Plan & Handoff Contract (Confirmed)

## 1. Confirmed Scope & User Overrides
Implement project-aware delivery actions (**Merge + Push** / **Push + Open PR Page** + optional **Auto-Archive**) for **committed (`status === "done"`) tasks** inside `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-240`:
- **Override 1**: `tool-static-web` & `tool-static-portal` default PR target branch = **`master`**.
- **Override 2**: `plan-to-build` & `task-dashboard` default Merge+Push target branch = **`main`**.
- **Override 3**: Auto-archive defaults confirmed:
  - Category A Staging Merge+Push (`new_dev` / `develop`): `archiveAfter` defaults **`false`** (so user can verify staging and return to open Master PR).
  - Category A Master PR (`master`), Category B (`pr_push`), Category C (`merge_push`), Fallback: `archiveAfter` defaults **`true`**.
- **Override 4**: Target branch selector MUST be a **dropdown (`<select>`) populated from the repo's existing branches** so the user picks/confirms before executing.

## 2. Project Delivery Policy Matrix (`resolveProjectDeliveryPolicy`)
| Category | Matched Project IDs / Names (case-insensitive substring or exact) | Actions Supported | Default Mode | Default Target Branch | Default Auto-Archive |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **A (`staging_merge_master_pr`)** | `service-mobilecircle-inline-page` (`mobile-inline`), `fetnet-digital-f2e` (`digital-f2e`), `fetnet-eservice-f2e` (`eservice-f2e`) | 1) `merge_push` (default target: `new_dev` for `eservice-f2e` if exists else `develop`; `develop` for others)<br>2) `pr_push` (default target: `master`) | `merge_push` (with tab/toggle to `pr_push`) | `merge_push`: `new_dev` / `develop`<br>`pr_push`: `master` | `merge_push`: `false`<br>`pr_push`: `true` |
| **B (`staging_pr`)** | `tool-static-web`, `tool-static-portal` | `pr_push` (push source branch & open PR page) | `pr_push` | **`master`** (dropdown includes `master`, `develop`, other existing branches) | `true` |
| **C (`direct_merge_push`)** | `plan-to-build`, `task-dashboard` | `merge_push` (merge source branch into target if different, then `git push origin <target>`) | `merge_push` | **`main`** (fallback `defaultBranch` / `master`) | `true` |
| **Fallback (`default`)** | All other projects | `merge_push` & `pr_push` | `merge_push` | repo `defaultBranch` (`main`/`master`) | `true` |

## 3. Edit Targets & Read Allowlist
**Edit Targets** (all inside `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-240`):
1. `src/server/services/gitService.js`
2. `src/server/server.js`
3. `src/public/index.html`
4. `src/public/modules/doneDeliveryStudio.js` (new module)
5. `src/public/modules/modal.js`
6. `src/public/modules/app.js`
7. `scripts/test_server.sh`
8. `scripts/test_ui_behavior.js`

**Constraints**:
- Only read/edit files inside `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-240`. Never modify `/Users/nelsonchung/projects/task-dashboard/` or `data/tasks.json`.
- Strip embedded `user:PAT@` credentials in `sanitizeRemoteWebUrl()` and mask credentials in `git push` error strings (`maskGitCredentials()`). Never pass raw remote PATs to frontend/API responses.
- Keep `window.*` bindings and ES module exports intact. Reuse `openExternalUrl` from `utils.js` and `writeTasks` from `taskStorage.js` (setting `status = 'archived'` automatically archives via `writeTasks`).

## 4. Implementation Slices

### Slice 1 — Git URL Sanitization, Policy Resolver, & Push (`src/server/services/gitService.js`)
Add cohesive helpers and export them at bottom of `gitService.js`:
1. `maskGitCredentials(text)`: replaces `https://[^:@/\s]+:[^@/\s]+@` with `https://***@`.
2. `sanitizeRemoteWebUrl(remoteUrl)`:
   - Converts `https://user:token@dev.azure.com/org/proj/_git/repo(.git)` -> `https://dev.azure.com/org/proj/_git/repo`
   - Converts `git@ssh.dev.azure.com:v3/org/proj/repo` -> `https://dev.azure.com/org/proj/_git/repo`
   - Converts `https://user:token@github.com/owner/repo.git` or `git@github.com:owner/repo.git` -> `https://github.com/owner/repo`
   - Strips trailing `.git` and `/`.
3. `buildPullRequestUrl(remoteUrl, sourceBranch, targetBranch)`:
   - Uses `sanitizeRemoteWebUrl(remoteUrl)`. Returns `''` if empty/invalid.
   - Azure DevOps (`dev.azure.com` or `visualstudio.com`): `${webUrl}/pullrequestcreate?sourceRef=${encodeURIComponent(src)}&targetRef=${encodeURIComponent(tgt)}`
   - GitHub (`github.com`): `${webUrl}/compare/${encodeURIComponent(tgt)}...${encodeURIComponent(src)}?expand=1`
   - Fallback (e.g. GitLab or other HTTPS host): `${webUrl}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(src)}&merge_request[target_branch]=${encodeURIComponent(tgt)}` (or `${webUrl}` if unrecognized).
4. `getRemoteOriginUrl(repoPath)`: runs `git -C <cleanRepo> remote get-url origin` safely (returns `''` on failure).
5. `listAllBranchNames(repoPath)`: collects deduplicated branch names combining local branches (`getProjectBranches(repoPath, [], { refresh: false }).branches.map(b => b.name)`) and remote `origin/*` refs (`git for-each-ref --format=%(refname:short) refs/remotes/origin`, stripping `origin/` and skipping `HEAD`).
6. `pushBranchToRemote(repoPath, branchName, options = {})`:
   - Verifies repo has `origin` remote (`no_remote` error if missing).
   - Runs `git -C <cleanRepo> push -u origin <branchName>` (`customEnv`, timeout 30000). On error, returns `{ success: false, pushed: false, status: 'push_failed', error: maskGitCredentials(errMsg) }`.
   - Clears branch cache and returns `{ success: true, pushed: true, branch: branchName, remote: 'origin' }`.
7. Update `mergeFeatureBranch`:
   - If `refs/heads/${tgt}` is missing locally while `refs/remotes/origin/${tgt}` exists, safely create local tracking branch `git branch <tgt> origin/${tgt}` before merging.
   - Support `options.pushTarget === true`: after successful merge (or `alreadyUpToDate`), invoke `pushBranchToRemote(cleanRepo, tgt, { customEnv })`. If push fails, return `{ success: false, merged: true, pushed: false, status: 'push_failed', commitSha, error }`. Otherwise include `pushed: true`.
8. `resolveProjectDeliveryPolicy(projectId, repoPath)`:
   - Inspects `projectId`, `listAllBranchNames(repoPath)`, `getProjectBranches(repoPath, [], { refresh: false }).defaultBranch`, and `getRemoteOriginUrl(repoPath)`.
   - Returns `{ category, allowMergePush, allowPrPush, defaultAction, defaultMergeTarget, defaultPrTarget, archiveDefaults: { merge_push, pr_push }, availableBranches, defaultSourceBranch, provider }`.

### Slice 2 — Server API Endpoints (`src/server/server.js`)
Import the new helpers from `./services/gitService` and implement 2 routes before generic `/api/tasks/:id` matching:
1. `GET /api/tasks/:id/delivery-options`:
   - Finds task in `readTasks()`. Resolves `proj` & `repoPath`.
   - Computes `policy = resolveProjectDeliveryPolicy(task.project || proj?.id, repoPath)`.
   - Determines `sourceBranch = task.gitLanding?.landedBranch || task.branchName || task.targetBranch || task.baseBranch || policy.defaultSourceBranch`.
   - Returns `{ success: true, taskId, projectId, sourceBranch, gitLanding: task.gitLanding || null, ...policy }`.
2. `POST /api/tasks/:id/deliver`:
   - Body: `{ mode: 'merge_push' | 'pr_push', sourceBranch, targetBranch, strategy, deleteSourceBranch, archiveAfter }`.
   - Validates task exists (`status === 'done'`, 400 otherwise), validates `mode`, `sourceBranch`, `targetBranch`.
   - If `mode === 'merge_push'`:
     - If `sourceBranch === targetBranch`: run `pushBranchToRemote(repoPath, targetBranch, { customEnv: buildCustomEnv() })`.
     - Else: run `mergeFeatureBranch(repoPath, sourceBranch, targetBranch, { strategy, deleteSourceBranch, pushTarget: true, customEnv: buildCustomEnv() })`.
     - On conflict/dirty workspace return 409; on push failure return 502/400 with `{ success: false, error }`.
   - If `mode === 'pr_push'`:
     - Run `pushBranchToRemote(repoPath, sourceBranch, { customEnv: buildCustomEnv() })`.
     - Compute `prUrl = buildPullRequestUrl(getRemoteOriginUrl(repoPath), sourceBranch, targetBranch)`.
     - Fail with 400/502 if push fails or `prUrl` cannot be constructed (never fail silently).
   - Re-read `tasks`, update target task:
     - `task.gitLanding = { ...(task.gitLanding || {}), pushedRemote: true, pushedBranch: mode === 'merge_push' ? targetBranch : sourceBranch, prUrl: prUrl || task.gitLanding?.prUrl || '', deliveredAt: nowIso, deliveryMode: mode, deliveryTargetBranch: targetBranch }`
     - `task.mergeStatus = mode === 'pr_push' ? 'pr_ready' : 'merged'`
     - If `prUrl`: `task.prUrl = prUrl`
     - If `archiveAfter === true`: `task.status = 'archived'`
     - `task.updatedAt = nowIso`
   - `writeTasks(freshTasks)`, clear caches (`gitProjectsStatusCache`, `clearProjectBranchCache(repoPath)`), `appendTaskEvent`, `broadcastSse('task-update', ...)`, return HTTP 200 `{ success: true, taskId, mode, sourceBranch, targetBranch, pushed: true, prUrl, archived: archiveAfter === true, commitSha, task }`.

### Slice 3 — Done Modal Delivery Panel UI (`index.html`, `doneDeliveryStudio.js`, `modal.js`, `app.js`)
1. **`src/public/index.html`**:
   - Add `<div id="doneDeliveryStudioPanel" class="hidden flex-shrink-0"></div>` immediately after `#reviewLandStudioPanel` inside `<form id="taskForm">`.
2. **`src/public/modules/doneDeliveryStudio.js`** (modeled cleanly after `reviewLandStudio.js`):
   - `initDoneDeliveryPanel(task)`:
     - Hides panel if `!task || task.status !== 'done' || isOpenedFromArchive`.
     - Shows panel below `#modalFormGrid` (while keeping `#modalStandardFooter` visible so `btnArchiveTaskModal` and `btnSubmitTask` stay working for existing tests & users!).
     - Fetches `/api/tasks/${encodeURIComponent(task.id)}/delivery-options` (with immediate fallback skeleton using local `projectBranchesMap` while loading so UI never flickers blank).
     - Renders:
       - Action mode buttons matching `policy`:
         - For Category A (`staging_merge_master_pr`) & Fallback: two segmented buttons **`合併並 Push`** (`mode='merge_push'`) & **`Push 並開 PR`** (`mode='pr_push'`).
         - For Category B (`staging_pr`): **`Push 並開 PR`** badge/pill (`mode='pr_push'`).
         - For Category C (`direct_merge_push`): **`合併回主幹並 Push`** badge/pill (`mode='merge_push'`).
       - Explicit Branch Dropdowns (per Override 4):
         - Source branch selector `#doneDeliverySourceBranch` (populated from `availableBranches` with `sourceBranch` selected).
         - Target branch selector `#doneDeliveryTargetBranch` (populated from `availableBranches` with the active mode's default target pre-selected: `new_dev`/`develop` vs `master` vs `main`).
       - Options drawer/inline controls: `#doneDeliveryStrategy` (`merge`/`squash`/`rebase`, shown for `merge_push` when `src !== tgt`), `#doneDeliveryDeleteSource` checkbox, `#doneDeliveryArchiveAfter` checkbox (preset per active mode's `archiveDefaults`), and error box `#doneDeliveryErrorBox`.
       - Primary execute button `#btnDoneDeliverSubmit` (calls `submitDoneDelivery(event)`) + if `task.gitLanding?.prUrl` already exists, secondary button **"開啟已建立 PR"** calling `openExternalUrl(task.gitLanding.prUrl, event)`.
   - Clicking `submitDoneDelivery`: calls `POST /api/tasks/:id/deliver`; on success, if `data.prUrl`, calls `openExternalUrl(data.prUrl)`, shows toast, closes modal (`if (data.archived) window.closeModal?.()`), and awaits `loadData()`. On failure, renders error in `#doneDeliveryErrorBox` and preserves modal state.
   - Export and attach `initDoneDeliveryPanel`, `selectDoneDeliveryMode`, `submitDoneDelivery`, `toggleDoneDeliveryOptions` on `window.*`.
3. **`src/public/modules/modal.js` & `src/public/modules/app.js`**:
   - In `modal.js`: import `initDoneDeliveryPanel` from `./doneDeliveryStudio.js`; call it inside `updateModalButtonState()` cleanly (with `typeof initDoneDeliveryPanel === 'function'` guard for VM tests!) right next to `initReviewLandPanel`: pass `task` when `taskId && status === 'done' && !isOpenedFromArchive`, else `null`!
   - In `app.js`: import from `./doneDeliveryStudio.js` and bind on `window.*` if needed.

### Slice 4 — Automated Tests (`scripts/test_server.sh`, `scripts/test_ui_behavior.js`)
1. Add backend tests inside `scripts/test_server.sh` (or dedicated test script called by `test_server.sh`):
   - Unit assertions for `sanitizeRemoteWebUrl`, `buildPullRequestUrl` (Azure DevOps PAT stripping + `pullrequestcreate`, GitHub SSH/HTTPS + `compare`), and `resolveProjectDeliveryPolicy` covering A (`fetnet-eservice-f2e` -> `new_dev` / `master`), B (`tool-static-web` -> `master`), C (`task-dashboard` / `plan-to-build` -> `main`).
   - End-to-end HTTP integration tests using temp bare remote repo (`git init --bare`):
     - `GET /api/tasks/:id/delivery-options` returns policy & existing branch list.
     - `POST /api/tasks/:id/deliver` with `mode: 'merge_push', archiveAfter: true` merges `feat/demo` into `main`, pushes to bare remote (`git -C bare rev-parse main` matches), and archives task.
     - `POST /api/tasks/:id/deliver` with `mode: 'pr_push'` pushes branch to bare remote, returns clean `prUrl` (no PAT), and updates `gitLanding.pushedRemote = true`.
2. Add Section 25 in `scripts/test_ui_behavior.js`:
   - Verify `index.html` contains `id="doneDeliveryStudioPanel"`.
   - Verify `doneDeliveryStudio.js` renders A/B/C policy modes, `<select id="doneDeliveryTargetBranch">` populated with existing branches (`master`, `main`, `develop`, `new_dev`), `archiveAfter` default toggle (`false` on Category A `merge_push`, `true` on Category A `pr_push` & B/C), and opens `prUrl` via `openExternalUrl`.
   - Verify `updateModalButtonState()` passes active `done` task to `initDoneDeliveryPanel`.

## 5. Verification Plan
Run inside `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-240`:
- `npm run harness:check && npm test` (must exit 0).
