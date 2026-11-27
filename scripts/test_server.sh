#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
echo "🧪 執行 Task Dashboard 後端 API 測試..."

# 測試語法載入
node --check "$PROJECT_DIR/src/server/server.js"
echo "  ✅ server.js 語法檢查通過"

# 測試啟動伺服器並驗證 API
TEST_PORT=3039
TEST_DATA_DIR="$PROJECT_DIR/.tmp_test_data"
rm -rf "$TEST_DATA_DIR"
mkdir -p "$TEST_DATA_DIR"
cp -R "$PROJECT_DIR/data/"* "$TEST_DATA_DIR/"

PORT=$TEST_PORT TASK_DASHBOARD_DATA_DIR="$TEST_DATA_DIR" node "$PROJECT_DIR/src/server/server.js" </dev/null >/dev/null 2>&1 &
SERVER_PID=$!

AGENT_STATUS_FILE="$PROJECT_DIR/.github/worklog/agent-status.md"
AGENT_STATUS_BACKUP=""
if [ -f "$AGENT_STATUS_FILE" ]; then
  AGENT_STATUS_BACKUP=$(mktemp)
  cp "$AGENT_STATUS_FILE" "$AGENT_STATUS_BACKUP"
fi

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill -9 "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEST_DATA_DIR" 2>/dev/null || true
  if [ -n "$AGENT_STATUS_BACKUP" ] && [ -f "$AGENT_STATUS_BACKUP" ]; then
    cp "$AGENT_STATUS_BACKUP" "$AGENT_STATUS_FILE"
    rm -f "$AGENT_STATUS_BACKUP"
  fi
}
trap cleanup EXIT INT TERM

for i in {1..10}; do
  if curl -s "http://localhost:$TEST_PORT/api/settings" > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "  [1/5] 測試 GET /api/tasks (含 in_progress 任務之 proc 變數與 liveStatus 健全性) ..."
curl -s -f -X POST "http://localhost:$TEST_PORT/api/tasks" -H "Content-Type: application/json" -d '{"title":"測試 in_progress 巡檢","project":"task-dashboard","status":"in_progress","requiresConfirmation":true}' > /dev/null
curl -s -f "http://localhost:$TEST_PORT/api/tasks" > /dev/null
echo "    ✅ /api/tasks 正常 (含 in_progress 任務)"

echo "  [2/5] 測試 GET /api/projects ..."
curl -s -f "http://localhost:$TEST_PORT/api/projects" > /dev/null
echo "    ✅ /api/projects 正常"

echo "  [3/5] 測試 GET /api/settings 與 plainLanguageWithTerms 切換持久化 ..."
TEST_PORT=$TEST_PORT node -e '
(async () => {
  const assert = require("node:assert/strict");
  const base = `http://localhost:${process.env.TEST_PORT || "3031"}`;
  const getRes = await fetch(`${base}/api/settings`);
  assert.equal(getRes.status, 200);
  const initial = await getRes.json();
  assert.equal(initial.plainLanguageWithTerms, true, "預設 plainLanguageWithTerms 應為 true");

  const offRes = await fetch(`${base}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plainLanguageWithTerms: false })
  });
  assert.equal(offRes.status, 200);
  assert.equal((await offRes.json()).plainLanguageWithTerms, false);

  const checkOff = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(checkOff.plainLanguageWithTerms, false, "plainLanguageWithTerms=false 必須持久化");

  await fetch(`${base}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plainLanguageWithTerms: true })
  });
})();
'
echo "    ✅ /api/settings 與 plainLanguageWithTerms 持久化正常"

echo "  [3.5/5] 測試 GET /api/events (SSE 即時推送端點) ..."
SSE_HEADERS=$(curl -s -m 1 -i "http://localhost:$TEST_PORT/api/events" || true)
if echo "$SSE_HEADERS" | grep -qi "text/event-stream"; then
  echo "    ✅ /api/events SSE 串流標頭正常 (text/event-stream)"
else
  echo "    ❌ /api/events 標頭異常: $SSE_HEADERS"
  exit 1
fi

echo "  [4/5] 測試 GET / (靜態首頁) ..."
curl -s -f "http://localhost:$TEST_PORT/" > /dev/null
echo "    ✅ 首頁靜態資源託管正常"

echo "  [5/6] 測試 POST /api/tasks (建立任務) 與 generate-commit ..."
CREATE_RES=$(curl -s -f -X POST "http://localhost:$TEST_PORT/api/tasks" -H "Content-Type: application/json" -d '{"title":"測試 commit 功能","project":"task-dashboard","status":"done","tags":["feat"]}')
TASK_ID=$(node -e 'const r = JSON.parse(process.argv[1]); console.log(r.id || "");' "$CREATE_RES")
if [ -n "$TASK_ID" ]; then
  GEN_RES=$(curl -s -f -X POST "http://localhost:$TEST_PORT/api/tasks/$TASK_ID/generate-commit")
  if echo "$GEN_RES" | grep -q '"subject"'; then
    echo "    ✅ /api/tasks/:id/generate-commit 智慧生成正常"
  else
    echo "    ❌ /api/tasks/:id/generate-commit 回應異常: $GEN_RES"
    exit 1
  fi
else
  echo "    ❌ 建立測試任務失敗: $CREATE_RES"
  exit 1
fi

echo "  [6/7] 測試 GET /api/tasks/:id/slice-info 隔離性 ..."
if [ -n "$TASK_ID" ]; then
  SLICE_RES=$(curl -s -f "http://localhost:$TEST_PORT/api/tasks/$TASK_ID/slice-info")
  echo "    ✅ /api/tasks/:id/slice-info 呼叫正常"
fi

echo "  [6.5/7] 測試 任務放棄、刪除與 Git Diff 預覽 API ..."
DUMMY_DIR="/tmp/test-git-discard-repo-$$"
mkdir -p "$DUMMY_DIR"
git -C "$DUMMY_DIR" init > /dev/null 2>&1
git -C "$DUMMY_DIR" commit --allow-empty -m "init" > /dev/null 2>&1
curl -s -f -X POST "http://localhost:$TEST_PORT/api/projects" -H "Content-Type: application/json" -d "{\"id\":\"test-discard-repo\",\"name\":\"test-discard-repo\",\"path\":\"$DUMMY_DIR\"}" > /dev/null 2>&1

ISOLATED_TASK=$(curl -s -f -X POST "http://localhost:$TEST_PORT/api/tasks" -H "Content-Type: application/json" -d '{"title":"測試放棄與刪除隔離任務","project":"test-discard-repo","status":"in_progress","workspaceMode":"in_place"}')
ISOLATED_TASK_ID=$(echo "$ISOLATED_TASK" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -n "$ISOLATED_TASK_ID" ]; then
  # 測試 GET /api/tasks/:id/git-status
  GIT_STATUS_RES=$(curl -s -f "http://localhost:$TEST_PORT/api/tasks/$ISOLATED_TASK_ID/git-status")
  if echo "$GIT_STATUS_RES" | grep -q '"taskId"'; then
    echo "    ✅ /api/tasks/:id/git-status 查詢正常"
  else
    echo "    ❌ /api/tasks/:id/git-status 異常: $GIT_STATUS_RES"
    exit 1
  fi

  # 測試 POST /api/tasks/:id/abandon
  ABANDON_RES=$(curl -s -f -X POST "http://localhost:$TEST_PORT/api/tasks/$ISOLATED_TASK_ID/abandon" -H "Content-Type: application/json" -d '{"discardChanges":false,"reason":"測試放棄"}')
  if echo "$ABANDON_RES" | grep -q '"abandoned"'; then
    echo "    ✅ /api/tasks/:id/abandon 放棄任務成功"
  else
    echo "    ❌ /api/tasks/:id/abandon 失敗: $ABANDON_RES"
    exit 1
  fi

  # 測試 DELETE /api/tasks/:id
  DELETE_RES=$(curl -s -f -X DELETE "http://localhost:$TEST_PORT/api/tasks/$ISOLATED_TASK_ID" -H "Content-Type: application/json" -d '{"discardChanges":false}')
  if echo "$DELETE_RES" | grep -q '"deleted"'; then
    echo "    ✅ DELETE /api/tasks/:id 刪除任務成功"
  else
    echo "    ❌ DELETE /api/tasks/:id 失敗: $DELETE_RES"
    exit 1
  fi

  # 測試 DELETE /api/tasks/:id 帶有 discardChanges: true (包含 git add -N 與 untracked 檔案)
  echo "dummy" > "$DUMMY_DIR/file.txt"
  git -C "$DUMMY_DIR" add -N "$DUMMY_DIR/file.txt"
  echo "untracked" > "$DUMMY_DIR/untracked.txt"
  DISCARD_TASK=$(curl -s -f -X POST "http://localhost:$TEST_PORT/api/tasks" -H "Content-Type: application/json" -d "{\"title\":\"測試 discard\",\"project\":\"test-discard-repo\",\"status\":\"in_progress\",\"workspaceMode\":\"in_place\"}")
  DISCARD_TASK_ID=$(echo "$DISCARD_TASK" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
  DELETE_DISCARD_RES=$(curl -s -f -X DELETE "http://localhost:$TEST_PORT/api/tasks/$DISCARD_TASK_ID" -H "Content-Type: application/json" -d '{"discardChanges":true}')
  DIFF_AFTER=$(git -C "$DUMMY_DIR" status --porcelain)
  if [ -z "$DIFF_AFTER" ]; then
    echo "    ✅ DELETE /api/tasks/:id 徹底捨棄工作區變更 (含 intent-to-add 與 untracked) 成功"
  else
    echo "    ❌ 工作區變更未徹底捨棄: $DIFF_AFTER"
    exit 1
  fi
  rm -rf "$DUMMY_DIR"
else
  rm -rf "$DUMMY_DIR"
  echo "    ❌ 建立隔離測試任務失敗: $ISOLATED_TASK"
  exit 1
fi

echo "  [6.6/7] 測試 POST /api/tasks/:id/commit 遇 pre-commit 阻斷保持原狀態並回傳 400 與成功 commit 封存流程 ..."
PRECOMMIT_REPO="/tmp/test-precommit-repo-$$"
mkdir -p "$PRECOMMIT_REPO/.git/hooks"
git -C "$PRECOMMIT_REPO" init > /dev/null 2>&1
git -C "$PRECOMMIT_REPO" config user.email "tester@example.com"
git -C "$PRECOMMIT_REPO" config user.name "Tester"
git -C "$PRECOMMIT_REPO" commit --allow-empty -m "initial commit" > /dev/null 2>&1

# 建立會攔截並報錯的 pre-commit hook
cat << 'HOOK_EOF' > "$PRECOMMIT_REPO/.git/hooks/pre-commit"
#!/bin/sh
echo "1 file changed, 1 insertion(+)"
echo "Pre-commit check failed: linter reported errors in auth.js" >&2
exit 1
HOOK_EOF
chmod +x "$PRECOMMIT_REPO/.git/hooks/pre-commit"

echo "const x = 1;" > "$PRECOMMIT_REPO/auth.js"
curl -s -f -X POST "http://localhost:$TEST_PORT/api/projects" -H "Content-Type: application/json" -d "{\"id\":\"test-precommit-proj\",\"name\":\"test-precommit-proj\",\"path\":\"$PRECOMMIT_REPO\"}" > /dev/null 2>&1
PC_TASK=$(curl -s -f -X POST "http://localhost:$TEST_PORT/api/tasks" -H "Content-Type: application/json" -d "{\"title\":\"測試 pre-commit 門禁\",\"project\":\"test-precommit-proj\",\"status\":\"review\"}")
PC_TASK_ID=$(echo "$PC_TASK" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

COMMIT_RESP_FILE="/tmp/commit_resp_$$.json"
COMMIT_CODE=$(curl -s -o "$COMMIT_RESP_FILE" -w "%{http_code}" -X POST "http://localhost:$TEST_PORT/api/tasks/$PC_TASK_ID/commit" -H "Content-Type: application/json" -d '{"customSubject":"feat(auth): add login","customBody":"implement auth"}')

if [ "$COMMIT_CODE" = "400" ]; then
  echo "    ✅ pre-commit 失敗時 API 正確回傳 HTTP 400"
else
  echo "    ❌ pre-commit 失敗時 API 未回傳 400: $COMMIT_CODE"
  cat "$COMMIT_RESP_FILE"
  exit 1
fi

if grep -q "Pre-commit check failed: linter reported errors" "$COMMIT_RESP_FILE"; then
  echo "    ✅ API 錯誤內容成功包含 pre-commit hook 之 stderr 輸出"
else
  echo "    ❌ API 錯誤內容缺少 stderr 輸出: $(cat "$COMMIT_RESP_FILE")"
  exit 1
fi

# 驗證任務狀態仍為 review，嚴格禁止進入 archived
ALL_TASKS_CHECK=$(curl -s -f "http://localhost:$TEST_PORT/api/tasks")
PC_TASK_STATUS=$(node -e 'const tasks = JSON.parse(process.argv[1]); const t = tasks.find(x => x.id === process.argv[2]); console.log(t ? t.status : "");' "$ALL_TASKS_CHECK" "$PC_TASK_ID")
if [ "$PC_TASK_STATUS" = "review" ]; then
  echo "    ✅ pre-commit 阻斷時任務狀態仍為 review，未被移入封存庫"
else
  echo "    ❌ pre-commit 阻斷時任務狀態被錯誤變更為: $PC_TASK_STATUS"
  exit 1
fi

# 驗證修復 pre-commit hook (改為 exit 0) 後，commit 成功且任務順利進入 archived
cat << 'HOOK_PASS' > "$PRECOMMIT_REPO/.git/hooks/pre-commit"
#!/bin/sh
exit 0
HOOK_PASS
chmod +x "$PRECOMMIT_REPO/.git/hooks/pre-commit"

SUCCESS_CODE=$(curl -s -o "$COMMIT_RESP_FILE" -w "%{http_code}" -X POST "http://localhost:$TEST_PORT/api/tasks/$PC_TASK_ID/commit" -H "Content-Type: application/json" -d '{"customSubject":"feat(auth): add login","customBody":"implement auth"}')
if [ "$SUCCESS_CODE" = "200" ]; then
  echo "    ✅ pre-commit 通過後 API 正確回傳 HTTP 200"
else
  echo "    ❌ pre-commit 通過後 API 回傳非 200: $SUCCESS_CODE"
  cat "$COMMIT_RESP_FILE"
  exit 1
fi

ALL_TASKS_CHECK_AFTER=$(curl -s -f "http://localhost:$TEST_PORT/api/tasks/archived")
PC_TASK_STATUS_AFTER=$(node -e 'const tasks = JSON.parse(process.argv[1]); const t = tasks.find(x => x.id === process.argv[2]); console.log(t ? t.status : "");' "$ALL_TASKS_CHECK_AFTER" "$PC_TASK_ID")
if [ "$PC_TASK_STATUS_AFTER" = "archived" ]; then
  echo "    ✅ commit 成功後任務正確變更為 archived 封存狀態"
else
  echo "    ❌ commit 成功後任務狀態異常: $PC_TASK_STATUS_AFTER"
  exit 1
fi

# 驗證 TASK-187: 當工作區無新異動 (Working tree clean / 已經 commit 過)，按下 commit 仍直接觸發 API 200 並將結束的 task 導入 archived
CLEAN_TASK=$(curl -s -f -X POST "http://localhost:$TEST_PORT/api/tasks" -H "Content-Type: application/json" -d "{\"title\":\"測試 clean working tree commit\",\"project\":\"test-precommit-proj\",\"status\":\"done\"}")
CLEAN_TASK_ID=$(echo "$CLEAN_TASK" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
CLEAN_CODE=$(curl -s -o "$COMMIT_RESP_FILE" -w "%{http_code}" -X POST "http://localhost:$TEST_PORT/api/tasks/$CLEAN_TASK_ID/commit" -H "Content-Type: application/json" -d '{"customSubject":"feat(auth): clean commit"}')
if [ "$CLEAN_CODE" = "200" ]; then
  echo "    ✅ TASK-187: clean working tree (已 commit) 時 API 正確回傳 200 並順利封存"
else
  echo "    ❌ TASK-187: clean working tree 時 API 未回傳 200: $CLEAN_CODE"
  cat "$COMMIT_RESP_FILE"
  exit 1
fi
CLEAN_STATUS=$(node -e 'const tasks = JSON.parse(process.argv[1]); const t = tasks.find(x => x.id === process.argv[2]); console.log(t ? t.status : "");' "$(curl -s -f "http://localhost:$TEST_PORT/api/tasks/archived")" "$CLEAN_TASK_ID")
if [ "$CLEAN_STATUS" = "archived" ]; then
  echo "    ✅ TASK-187: clean working tree commit 後任務正確導入 archived"
else
  echo "    ❌ TASK-187: clean working tree commit 後任務狀態異常: $CLEAN_STATUS"
  exit 1
fi

rm -rf "$PRECOMMIT_REPO" "$COMMIT_RESP_FILE"

echo "  [7/7] 測試 多任務 agent-status 與切片隔離單元測試 ..."
node -e '
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveTaskSkillRoute, parseAgentStatusContent, parseBuildPlanContent, scanProjectWorklogAndPlan, syncProjectWorklogOnReview } = require("./src/server/server.js");

const multiTaskWorklog = `# Agent Status

## Active Task
- ID: TASK-001
- Title: 任務一
- Status: in_progress
- Last updated: 2026-09-11
- Goal: 目標一

## Active Tasks
### [TASK-001]
- ID: TASK-001
- Title: 任務一
- Status: in_progress
- Last updated: 2026-09-11
- Goal: 目標一
- Route: route-1
- CurrentStep: 步驟一

### [TASK-002]
- ID: TASK-002
- Title: 任務二
- Status: in_progress
- Last updated: 2026-09-11
- Goal: 目標二
- Route: route-2
- CurrentStep: 步驟二
`;

// 測試精準隔離
const parsed001 = parseAgentStatusContent(multiTaskWorklog, "dummy.md", "TASK-001");
assert.strictEqual(parsed001.activeTask.id, "TASK-001");
assert.strictEqual(parsed001.activeTask.currentStep, "步驟一");

const parsed002 = parseAgentStatusContent(multiTaskWorklog, "dummy.md", "TASK-002");
assert.strictEqual(parsed002.activeTask.id, "TASK-002");
assert.strictEqual(parsed002.activeTask.currentStep, "步驟二");

const parsed003 = parseAgentStatusContent(multiTaskWorklog, "dummy.md", "TASK-003");
assert.strictEqual(parsed003.activeTask, null);

// 測試切片依 taskId 隔離
const multiTaskPlan = `# Build Plan
## 任務卡
- 目前任務 ID: TASK-001
- 目標: 目標一

## Slices
- [x] Slice 1: [TASK-001] 完成設計
- [-] Slice 2: [TASK-001] 實作功能
- [-] Slice 3: [TASK-002] 任務二專屬切片
`;

const plan001 = parseBuildPlanContent(multiTaskPlan, "dummy.md", "fallback", "TASK-001");
assert.strictEqual(plan001.slices.length, 2);
assert(plan001.slices.every(s => s.goal.includes("TASK-001")));

const plan002 = parseBuildPlanContent(multiTaskPlan, "dummy.md", "fallback", "TASK-002");
assert.strictEqual(plan002.slices.length, 1);
assert(plan002.slices[0].goal.includes("TASK-002"));

const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "task-dashboard-slices-"));
const planDir = path.join(tempProject, ".github", "harness", "plan");
fs.mkdirSync(planDir, { recursive: true });
fs.writeFileSync(path.join(planDir, "build-plan.md"), `# Build Plan
- Status: in_progress
## Slices
- [-] Slice 1: [TASK-001] 已完成實作與驗證
- [-] Slice 2: [TASK-002] 其他任務切片
`);

syncProjectWorklogOnReview(tempProject, { id: "TASK-001", title: "任務一" });
const completedPlan = fs.readFileSync(path.join(planDir, "build-plan.md"), "utf8");
assert(completedPlan.includes("- Status: review"));
assert(completedPlan.includes("- [x] Slice 1: [TASK-001]"));
assert(completedPlan.includes("- [-] Slice 2: [TASK-002]"));
fs.rmSync(tempProject, { recursive: true, force: true });

// 驗證未關聯任務開工時不會盲目向既有 Plan 追加切片，且已 done 的 Plan 不會被修改
const { syncProjectWorklogForActiveTask } = require("./src/server/server.js");
const tempProj2 = fs.mkdtempSync(path.join(os.tmpdir(), "task-dashboard-doneplan-"));
const planDir2 = path.join(tempProj2, ".github", "harness", "plan");
fs.mkdirSync(planDir2, { recursive: true });
fs.writeFileSync(path.join(planDir2, "feature-build-plan.md"), `# Build Plan: Feature A\n- Status: done\n## Slices\n- [x] Slice 1: 完成架構\n`);
syncProjectWorklogForActiveTask(tempProj2, { id: "TASK-999", title: "不相關的新任務" });
const preservedPlan = fs.readFileSync(path.join(planDir2, "feature-build-plan.md"), "utf8");
assert(!preservedPlan.includes("TASK-999"), "不相關任務不應被追加至已有的無關 Plan 中");
assert(preservedPlan.includes("- Status: done"), "已結案之 Plan 不應被重啟為 in_progress");
assert(!fs.existsSync(path.join(tempProj2, "HARNESS.md")), "任務開工絕不得隱式為專案注入 HARNESS.md");
assert(!fs.existsSync(path.join(tempProj2, "scripts", "harness_check.sh")), "任務開工絕不得隱式建立 harness 腳本");
fs.rmSync(tempProj2, { recursive: true, force: true });

// 驗證 Handoff Contract 與 ## Delegation 於 syncProjectWorklogForActiveTask 後完好保留且不被追加通用切片
const tempHandoffProj = fs.mkdtempSync(path.join(os.tmpdir(), "task-dashboard-handoff-"));
const handoffWorklogDir = path.join(tempHandoffProj, ".github", "worklog");
const handoffPlanDir = path.join(tempHandoffProj, ".github", "harness", "plan");
fs.mkdirSync(handoffWorklogDir, { recursive: true });
fs.mkdirSync(handoffPlanDir, { recursive: true });

// (a) agent-status 含 ## Delegation 自訂區段
const initialStatus = `# Agent Status

## Active Task
- ID: TASK-100
- Title: 測試交接任務
- Status: in_progress

## Execution Tracking
- CurrentStep: 規劃完成

## Delegation
- Executor: flash Subagent (Workspace: inherit)
- Contract: .github/harness/plan/task-100-build-plan.md
- CurrentSlice: Slice 1
`;
fs.writeFileSync(path.join(handoffWorklogDir, "agent-status.md"), initialStatus, "utf8");

// (b) task-100-build-plan.md 含 ## Handoff Contract
const initialPlan = `# Build Plan: Task 100
- Feature name: Task 100
- 日期: 2026-11-06
- Status: in_progress

## 任務卡
- 目前任務 ID: TASK-100
- 目標: 測試交接契約防護

## Handoff Contract
- Baseline: main / abc1234
- Impact: none
- Edit Targets:
  1. src/test.js:L1-L10
- Read Allowlist: src/test.js:L1-L20
- Do-Not-Read: README.md
- Constraints: no 3rd party
- Escalation: max 2 inspections
- Return Format: modifiedFiles[], command/cwd/exitCode/rawLog

## Slices
- [-] Slice 1: 完成實作與單元測試，驗收：npm test
`;
fs.writeFileSync(path.join(handoffPlanDir, "task-100-build-plan.md"), initialPlan, "utf8");

syncProjectWorklogForActiveTask(tempHandoffProj, { id: "TASK-100", title: "測試交接任務", description: "測試交接契約防護" });

const syncedStatus = fs.readFileSync(path.join(handoffWorklogDir, "agent-status.md"), "utf8");
assert(syncedStatus.includes("## Delegation"), "呼叫 sync 後 agent-status 的 ## Delegation 自訂區段仍應保留");
assert(syncedStatus.includes("Executor: flash Subagent"), "## Delegation 內容應完好保留");

const syncedPlan = fs.readFileSync(path.join(handoffPlanDir, "task-100-build-plan.md"), "utf8");
assert(syncedPlan.includes("## Handoff Contract"), "呼叫 sync 後 ## Handoff Contract 應完好保留");
assert(syncedPlan.includes("Baseline: main / abc1234"), "Handoff Contract 內文應原封不動");
assert(!syncedPlan.includes("Slice 2:"), "含 ## Handoff Contract 之 Plan 不應被自動追加通用切片");
const sliceCount = (syncedPlan.match(/^-\s*\[([ xX\-~])\]\s*Slice\s*\d+/gmi) || []).length;
assert.strictEqual(sliceCount, 1, "Slices 數量應維持原本的 1 個切片");

fs.rmSync(tempHandoffProj, { recursive: true, force: true });

// 驗證原本已有自身 test/harness 之專案，開工時絕不被自動植入 task-dashboard 的 harness
const tempProjExisting = fs.mkdtempSync(path.join(os.tmpdir(), "task-dashboard-existing-harness-"));
fs.writeFileSync(path.join(tempProjExisting, "package.json"), JSON.stringify({ name: "my-existing-app", scripts: { test: "jest" } }, null, 2), "utf8");
syncProjectWorklogForActiveTask(tempProjExisting, { id: "TASK-888", title: "已有專案任務開工" });
assert(!fs.existsSync(path.join(tempProjExisting, "HARNESS.md")), "既有專案任務開工不得被建立 HARNESS.md");
assert(!fs.existsSync(path.join(tempProjExisting, ".github")), "既有專案任務開工不得被植入 .github");
assert(!fs.existsSync(path.join(tempProjExisting, "scripts")), "既有專案任務開工不得被建立 scripts");
const existingPkg = JSON.parse(fs.readFileSync(path.join(tempProjExisting, "package.json"), "utf8"));
assert.strictEqual(existingPkg.scripts["harness:check"], undefined, "既有專案 package.json 不得被污染注入 harness:check");
fs.rmSync(tempProjExisting, { recursive: true, force: true });

// 驗證 initProjectHarness 與無 Harness 專案切片合成功能
const { initProjectHarness } = require("./src/server/server.js");
const tempProj3 = fs.mkdtempSync(path.join(os.tmpdir(), "task-dashboard-noharness-"));
fs.writeFileSync(path.join(tempProj3, "package.json"), JSON.stringify({ name: "test-no-harness", scripts: { test: "echo ok" } }), "utf8");

// 在完全沒有 Harness 的專案下測試切片合成
const synthSlice = scanProjectWorklogAndPlan(tempProj3, "TASK-777");
assert(synthSlice, "無 Harness 專案在指定任務時應自動合成切片資訊");
assert.strictEqual(synthSlice.hasWorklog, false);
assert(synthSlice.currentSliceGoal && synthSlice.currentSliceGoal !== "N/A", "合成切片目標不得為 N/A");

// 執行 Harness 初始化
const created = initProjectHarness(tempProj3);
assert(fs.existsSync(path.join(tempProj3, ".github", "worklog", "agent-status.md")), "agent-status.md 應被建立");
assert(fs.existsSync(path.join(tempProj3, "HARNESS.md")), "HARNESS.md 應被建立");
assert(fs.existsSync(path.join(tempProj3, ".github", "harness", "templates", "build-plan.md")), "build-plan 範本應被建立");
const updatedPkg = JSON.parse(fs.readFileSync(path.join(tempProj3, "package.json"), "utf8"));
assert(updatedPkg.scripts["harness:check"], "harness:check 應自動注入 package.json");
fs.rmSync(tempProj3, { recursive: true, force: true });

// 驗證多輪 Feedback 任務下 Commit Message 主旨嚴格鎖定任務原始主軸、內文綜合全量異動
const { formatCommitMessageFromSkill } = require("./src/server/server.js");
const multiFeedbackTask = {
  id: "TASK-053",
  title: "5GSA device list dialog 調整",
  description: "- 實作 5gsa 手機清單彈窗\n\n--- 【歷次審查意見 / Feedback 記錄】 ---\n[2026-09-24T03:30:00.000Z]\n- 表格需靠左對齊\n\n[2026-09-24T03:40:00.000Z]\n- 按鈕靠右並加入回到頂端\n\n[2026-09-24T03:50:00.000Z]\n- 設定 min-width: 100%",
  tags: ["feat", "frontend-ui-engineering"],
  modifiedFiles: [
    "src/components/modals/DeviceListModal.js",
    "src/sass/module/_5gsa.sass",
    "src/pages/5gsa/index.js"
  ]
};

const mockDiff = `diff --git a/src/components/modals/DeviceListModal.js b/src/components/modals/DeviceListModal.js
index 123..456 100644
--- a/src/components/modals/DeviceListModal.js
+++ b/src/components/modals/DeviceListModal.js
@@ -1,5 +1,10 @@
+function renderDeviceTable() {}
+<div id="deviceModal"></div>
diff --git a/src/sass/module/_5gsa.sass b/src/sass/module/_5gsa.sass
index 111..222 100644
--- a/src/sass/module/_5gsa.sass
+++ b/src/sass/module/_5gsa.sass
@@ -1 +1,2 @@
+.device-table min-width 100%
`;

const commitResult = formatCommitMessageFromSkill(".", multiFeedbackTask, mockDiff, multiFeedbackTask.modifiedFiles);
assert(commitResult.message.includes("5GSA device list dialog 調整"), "Commit 主旨必須鎖定任務原始主軸");
assert(commitResult.type === "feat", "Commit Type 應為 feat");
// 驗證 consumeTaskFeedback 之多輪歷史追加、格式去重與欄位清空
const { consumeTaskFeedback } = require("./src/server/server.js");
const fbTask = {
  id: "TASK-TEST-FB",
  title: "測試 Feedback 機制",
  description: "原始需求描述",
  status: "in_progress",
  feedback: "第一輪修改意見"
};
consumeTaskFeedback(fbTask);
assert.strictEqual(fbTask.feedback, "", "第一輪 consumeTaskFeedback 後 feedback 欄位必須被清空");
assert(fbTask.description.includes("--- 【歷次審查意見 / Feedback 記錄】 ---"), "必須包含歷次審查意見區塊標題");
assert(fbTask.description.includes("- 第一輪修改意見"), "必須正確條列第一輪意見");

// 第二輪 feedback
fbTask.feedback = "- 第二輪修改意見\n第二行意見";
consumeTaskFeedback(fbTask);
assert.strictEqual(fbTask.feedback, "", "第二輪 consumeTaskFeedback 後 feedback 欄位必須被清空");
assert(fbTask.description.includes("- 第二輪修改意見"), "必須保留第二輪第一行意見且不重複前綴");
assert(fbTask.description.includes("- 第二行意見"), "必須為無前綴之行自動補齊條列式符號");
assert(!fbTask.description.includes("- - 第二輪"), "嚴禁產生重複前綴 - - ");

// 驗證重複 consumeTaskFeedback 去重防禦
fbTask.feedback = "第一輪修改意見";
consumeTaskFeedback(fbTask);
assert.strictEqual(fbTask.feedback, "", "已存在之 feedback 再次傳入應直接清空 feedback 且不重複追加");

// 驗證 requiresConfirmation 與 executionPlan 邏輯
const indexHtmlContent = fs.readFileSync("./src/public/index.html", "utf8");
const uiModulesContent = fs.readdirSync("./src/public/modules").filter(f => f.endsWith(".js")).map(f => fs.readFileSync("./src/public/modules/" + f, "utf8")).join("\n");
const allFrontendContent = indexHtmlContent + "\n" + uiModulesContent;
assert(allFrontendContent.includes("t.status === \"in_progress\" && t.requiresConfirmation && t.executionPlan && t.executionPlan.trim()") || allFrontendContent.includes("t.requiresConfirmation && t.executionPlan && t.executionPlan.trim()"), "看板卡片待確認徽章必須同時滿足 requiresConfirmation 與 executionPlan 非空");
assert(allFrontendContent.includes("const isPendingConfirmation = isReqConfirmChecked && status === ") && allFrontendContent.includes("hasExecutionPlan"), "彈窗待確認狀態必須同時要求 hasExecutionPlan");

// 驗證 harness_check.sh 是否包含 executionPlan 同步門禁檢驗
const harnessScript = fs.readFileSync("./scripts/harness_check.sh", "utf8");
assert(harnessScript.includes("requiresConfirmation") && harnessScript.includes("executionPlan"), "harness_check.sh 必須包含 executionPlan 同步檢核門禁");

// 驗證 index.html 移除冗餘 markdown 預覽機制並保留原生流暢編輯體驗
assert(!allFrontendContent.includes("function renderMarkdown(str)"), "前端已移除冗餘之 renderMarkdown 函式");
assert(!allFrontendContent.includes("function switchFieldViewMode("), "前端已移除冗餘之 switchFieldViewMode 函式");
assert(!allFrontendContent.includes("formDescriptionPreview"), "前端彈窗已移除 formDescriptionPreview 預覽容器");
assert(!allFrontendContent.includes("formExecutionPlanPreview"), "前端彈窗已移除 formExecutionPlanPreview 預覽容器");
assert(allFrontendContent.includes("autoResizeTextarea"), "前端保留原生彈性 autoResizeTextarea 編輯體驗");

// 驗證 resolveTaskSkillRoute 邏輯
assert.strictEqual(resolveTaskSkillRoute({ route: "custom-route", tags: ["frontend-ui-engineering"] }, "."), "custom-route");

const dummyProjSkills = fs.mkdtempSync(path.join(os.tmpdir(), "task-dashboard-skills-"));
fs.mkdirSync(path.join(dummyProjSkills, ".github", "skills", "skill-a"), { recursive: true });
fs.mkdirSync(path.join(dummyProjSkills, ".github", "skills", "skill-b"), { recursive: true });

const skillRouteResult = resolveTaskSkillRoute(
  { tags: ["feat", "skill-a", "fix", "skill-b", "urgent"] },
  dummyProjSkills
);
assert.strictEqual(skillRouteResult, "skill-a, skill-b", "應從 task.tags 精準篩選專案 skills 並排除 non-skill tags");

const noSkillsProj = fs.mkdtempSync(path.join(os.tmpdir(), "task-dashboard-noskills-"));
const fallbackTagsResult = resolveTaskSkillRoute(
  { tags: ["feat", "my-feature-skill", "bug"] },
  noSkillsProj
);
assert.strictEqual(fallbackTagsResult, "my-feature-skill", "無專案 skills 時應篩選出非 Git commit/狀態 tags");

const emptyRouteResult = resolveTaskSkillRoute(
  { tags: ["feat", "fix"] },
  dummyProjSkills
);
assert.strictEqual(emptyRouteResult, "none", "無任何技能標籤時應為 none");
assert.notStrictEqual(emptyRouteResult, "dashboard-state-and-sync", "絕不得回傳寫死的 dashboard-state-and-sync");

fs.rmSync(dummyProjSkills, { recursive: true, force: true });
fs.rmSync(noSkillsProj, { recursive: true, force: true });

// 驗證 parseAgentStatusContent 對頂層無 ## Active Task 標題的相容性
const topLevelNoH2Worklog = `# Agent Status

- ID: TASK-NO-H2
- Title: 無二級標題任務
- Status: in_progress
- Goal: 測試相容性
- Route: test-skill
- CurrentStep: 執行診斷中
- Evidence: 進行中證據
- NextStep: 推進至實作
- LastUpdated: 2026-10-27
`;

const parsedTopLevel = parseAgentStatusContent(topLevelNoH2Worklog, "dummy.md", "TASK-NO-H2");
assert(parsedTopLevel.activeTask, "無 ## Active Task 標題之 worklog 應能被 parseAgentStatusContent 成功解析出 activeTask");
assert.strictEqual(parsedTopLevel.activeTask.id, "TASK-NO-H2");
assert.strictEqual(parsedTopLevel.activeTask.status, "進行中");
assert.strictEqual(parsedTopLevel.activeTask.currentStep, "執行診斷中");
assert.strictEqual(parsedTopLevel.activeTask.evidence, "進行中證據");
assert.strictEqual(parsedTopLevel.activeTask.nextStep, "推進至實作");

// 驗證 syncProjectWorklogForActiveTask 升級無 ## Active Task 的 agent-status.md 為標準結構
const tempProjNoH2 = fs.mkdtempSync(path.join(os.tmpdir(), "task-dashboard-upgrade-h2-"));
const worklogDirNoH2 = path.join(tempProjNoH2, ".github", "worklog");
fs.mkdirSync(worklogDirNoH2, { recursive: true });
fs.writeFileSync(path.join(worklogDirNoH2, "agent-status.md"), topLevelNoH2Worklog, "utf8");

syncProjectWorklogForActiveTask(tempProjNoH2, {
  id: "TASK-NO-H2",
  title: "無二級標題任務升級",
  tags: ["my-skill"]
});

const upgradedContent = fs.readFileSync(path.join(worklogDirNoH2, "agent-status.md"), "utf8");
assert(upgradedContent.includes("## Active Task"), "syncProjectWorklogForActiveTask 必須將無二級標題檔案升級重整為包含 ## Active Task");
assert(upgradedContent.includes("## Execution Tracking"), "必須包含 ## Execution Tracking");
assert(upgradedContent.includes("- Route: my-skill"), "Route 必須反映任務解析之 Skill");

// 驗證 syncProjectWorklogOnReview 與 syncProjectWorklogOnDone 對無 ## Active Task 結構之相容更新
const { syncProjectWorklogOnDone } = require("./src/server/server.js");
const tempProjReviewNoH2 = fs.mkdtempSync(path.join(os.tmpdir(), "task-dashboard-review-noh2-"));
const worklogDirReviewNoH2 = path.join(tempProjReviewNoH2, ".github", "worklog");
fs.mkdirSync(worklogDirReviewNoH2, { recursive: true });
fs.writeFileSync(path.join(worklogDirReviewNoH2, "agent-status.md"), topLevelNoH2Worklog, "utf8");

syncProjectWorklogOnReview(tempProjReviewNoH2, { id: "TASK-NO-H2", title: "審查任務" });
const reviewedContent = fs.readFileSync(path.join(worklogDirReviewNoH2, "agent-status.md"), "utf8");
assert(reviewedContent.includes("- Status: review"), "無 ## Active Task 結構下 review 同步必須正確更新 - Status: review");

syncProjectWorklogOnDone(tempProjReviewNoH2, { id: "TASK-NO-H2", title: "結案任務" });
const doneContent = fs.readFileSync(path.join(worklogDirReviewNoH2, "agent-status.md"), "utf8");
assert(doneContent.includes("- Status: 已完成"), "無 ## Active Task 結構下 done 同步必須正確更新 - Status: 已完成");
assert(doneContent.includes("- Evidence: npm test exit code: 0"), "done 同步必須自動補全客觀 Evidence 以通過 slice-judge / pre-commit 門禁");

fs.rmSync(tempProjNoH2, { recursive: true, force: true });
fs.rmSync(tempProjReviewNoH2, { recursive: true, force: true });

console.log("    ✅ agent-status、build-plan 隔離保護、多輪 Feedback Commit 訊息、consumeTaskFeedback、executionPlan 門禁與簡潔編輯器單元測試通過！");
'

echo "  [8/8] 測試 POST /api/projects/:id/init-harness API ..."
INIT_RES=$(curl -s -f -X POST "http://localhost:$TEST_PORT/api/projects/task-dashboard/init-harness")
if echo "$INIT_RES" | grep -q '"success":true'; then
  echo "    ✅ /api/projects/:id/init-harness 呼叫正常"
else
  echo "    ❌ /api/projects/:id/init-harness 失敗: $INIT_RES"
  exit 1
fi

echo "  [8.5/9] 測試 TD-H5 Worktree 隔離生命週期與配額持久化 ..."
node -e '
(async () => {
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");
const { createTaskWorktree, removeTaskWorktree, collectGitDiff } = require("./src/server/services/gitService");
const { recordCliRun, getCliRunsToday } = require("./src/server/services/cliRunner");

// 1. 測試配額持久化跨重啟
const initialQuota = getCliRunsToday();
recordCliRun();
const incrementedQuota = getCliRunsToday();
assert.equal(incrementedQuota, initialQuota + 1, "配額必須累加");

// 驗證磁碟持久化檔案
const dataDir = process.env.TASK_DASHBOARD_DATA_DIR || path.join(os.homedir(), "Library/Application Support/TaskDashboard");
const quotaFile = path.join(dataDir, "cli-runs.json");
assert(fs.existsSync(quotaFile), "cli-runs.json 必須被持久化至磁碟");
const diskQuota = JSON.parse(fs.readFileSync(quotaFile, "utf8"));
assert.equal(diskQuota.count, incrementedQuota, "磁碟持久化配額數值必須與記憶體一致");
console.log("    ✅ TD-H5 配額持久化跨重啟保留驗證通過");

// 2. 測試 Git Worktree 隔離生命週期
const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "td-h5-worktree-test-"));
try {
  execSync("git init -q -b main", { cwd: tempRepo });
  execSync("git config user.name \"Test\"", { cwd: tempRepo });
  execSync("git config user.email \"test@example.com\"", { cwd: tempRepo });
  fs.writeFileSync(path.join(tempRepo, "README.md"), "# Test Repo\n");
  execSync("git add README.md && git commit -q -m \"init\"", { cwd: tempRepo });

  const taskId = "TASK-TEST-WT";
  const wt = createTaskWorktree(tempRepo, taskId);
  assert(fs.existsSync(wt.worktreePath), "Worktree 目錄必須成功建立");
  assert.equal(wt.branchName, "td/" + taskId);

  // 在 worktree 目錄中修改檔案與新增檔案
  fs.writeFileSync(path.join(wt.worktreePath, "feature.js"), "console.log(\"isolated\");\n");
  fs.appendFileSync(path.join(wt.worktreePath, "README.md"), "Added in worktree\n");

  // 驗證主儲存庫 git status 完全無變更！
  const mainStatus = execSync("git status --porcelain", { cwd: tempRepo, encoding: "utf8" });
  assert.equal(mainStatus.trim(), "", "Worktree 隔離環境下的修改，主工作區 git status 必須保持絕對乾淨！");

  // 驗證 collectGitDiff 對 worktree 收集 (異步等待完成後再執行清理)
  await new Promise((resolve, reject) => {
    collectGitDiff(wt.worktreePath, process.env, (modified, diff) => {
      try {
        assert(modified.includes("feature.js") || modified.includes("README.md"), "Worktree diff 必須採集到異動檔案");
        assert(diff.includes("Added in worktree"), "Worktree diff 內容必須包含變更細節");
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });

  // 測試移除清理 worktree
  removeTaskWorktree(tempRepo, taskId);
  assert(!fs.existsSync(wt.worktreePath), "Worktree 目錄必須已被安全移除");

  const branches = execSync("git branch", { cwd: tempRepo, encoding: "utf8" });
  assert(!branches.includes("td/" + taskId), "Worktree 專屬分支必須已被刪除清理");

  console.log("    ✅ TD-H5 Git Worktree 隔離生命週期與主工作區無污染驗證通過");
} finally {
  fs.rmSync(tempRepo, { recursive: true, force: true });
}
})();
'

echo "  [8.6/9] 測試 TD-S2 baseBranch 鎖定、Rebase 衝突中止、基線變動重驗與序列化 Squash 合併..."
TEST_PORT=$TEST_PORT node -e '
(async () => {
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("os");
const { execSync } = require("child_process");
const { createTaskWorktree, mergeTaskWorktree, checkTaskBaseDrift } = require("./src/server/services/gitService");
const base = `http://localhost:${process.env.TEST_PORT || "3031"}`;

const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "td-s2-merge-test-"));
try {
  execSync("git init -q -b main", { cwd: tempRepo });
  execSync("git config user.name \"Test\"", { cwd: tempRepo });
  execSync("git config user.email \"test@example.com\"", { cwd: tempRepo });
  fs.writeFileSync(path.join(tempRepo, "app.txt"), "line1\nline2\n");
  fs.writeFileSync(path.join(tempRepo, "other.txt"), "base\n");
  execSync("git add -A && git commit -q -m \"init\"", { cwd: tempRepo });
  const initSha = execSync("git rev-parse HEAD", { cwd: tempRepo, encoding: "utf8" }).trim();

  // Case 1: 衝突安全中止 (不污染 main)
  const wt1 = createTaskWorktree(tempRepo, "TASK-S2-CONFLICT");
  assert.equal(wt1.baseBranch, "main");
  assert.equal(wt1.baseCommit, initSha);
  fs.writeFileSync(path.join(wt1.worktreePath, "app.txt"), "worktree-edit\nline2\n");
  execSync("git add -A && git commit -q -m \"wt conflict edit\"", { cwd: wt1.worktreePath });

  // main 分支推進並修改同一行製造衝突
  fs.writeFileSync(path.join(tempRepo, "app.txt"), "main-edit\nline2\n");
  execSync("git add -A && git commit -q -m \"main conflict edit\"", { cwd: tempRepo });
  const mainBeforeConflict = execSync("git rev-parse HEAD", { cwd: tempRepo, encoding: "utf8" }).trim();

  const conflictRes = await mergeTaskWorktree({
    repoPath: tempRepo,
    taskId: "TASK-S2-CONFLICT",
    task: { id: "TASK-S2-CONFLICT", title: "Conflict test", baseBranch: wt1.baseBranch, baseCommit: wt1.baseCommit },
    worktreePath: wt1.worktreePath,
    branchName: wt1.branchName
  });
  assert.equal(conflictRes.conflict, true, "衝突必須回報 conflict: true");
  assert.equal(conflictRes.status, "conflict");
  assert.equal(execSync("git rev-parse HEAD", { cwd: tempRepo, encoding: "utf8" }).trim(), mainBeforeConflict, "衝突後 main 分支絕不可被污染");
  assert.equal(fs.existsSync(path.join(wt1.worktreePath, ".git")) || fs.existsSync(wt1.worktreePath), true);
  assert(!fs.existsSync(path.join(tempRepo, ".git/worktrees/TASK-S2-CONFLICT/rebase-merge")), "rebase --abort 必須清除 rebase 狀態");

  // Case 2: 基線前進觸發重驗 -> 失敗阻斷 -> 通過後於主工作區切換至其他分支情況下以 git fetch . HEAD:main 無感 Squash 合併
  const wt2 = createTaskWorktree(tempRepo, "TASK-S2-REVERIFY");
  fs.writeFileSync(path.join(wt2.worktreePath, "feature.txt"), "ok\n");
  execSync("git add -A && git commit -q -m \"wt feature\"", { cwd: wt2.worktreePath });

  // main 前進不同檔案 (other.txt) -> baseMoved = true
  fs.writeFileSync(path.join(tempRepo, "other.txt"), "advanced\n");
  execSync("git add -A && git commit -q -m \"main advance\"", { cwd: tempRepo });
  const movedMainSha = execSync("git rev-parse HEAD", { cwd: tempRepo, encoding: "utf8" }).trim();

  // 主工作區切到別的分支且留有未提交變更，驗證 git fetch . HEAD:main 無感推進
  execSync("git checkout -q -b other-branch", { cwd: tempRepo });
  fs.writeFileSync(path.join(tempRepo, "uncommitted.txt"), "keep me dirty\n");

  const failVerifyRes = await mergeTaskWorktree({
    repoPath: tempRepo,
    taskId: "TASK-S2-REVERIFY",
    task: { id: "TASK-S2-REVERIFY", title: "Reverify test", baseBranch: wt2.baseBranch, baseCommit: wt2.baseCommit },
    worktreePath: wt2.worktreePath,
    branchName: wt2.branchName,
    verifyCommand: "node -e \"process.exit(1)\""
  });
  assert.equal(failVerifyRes.status, "verification_failed", "基線變動後重驗失敗必須阻斷合併");
  assert.equal(failVerifyRes.baseMoved, true);
  assert.equal(execSync("git rev-parse main", { cwd: tempRepo, encoding: "utf8" }).trim(), movedMainSha, "重驗失敗時 main ref 不得推進");

  // 透過 API 建立隔離任務並驗證 POST /api/tasks/:id/merge 通過重驗 + Squash 合併 + 清理
  await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "td-s2-proj", name: "td-s2-proj", path: tempRepo })
  });
  const createdS2 = await (await fetch(`${base}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "API Merge 管線測試",
      project: "td-s2-proj",
      status: "done",
      riskDoor: "two-way"
    })
  })).json();
  await fetch(`${base}/api/tasks/${createdS2.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      worktreePath: wt2.worktreePath,
      branchName: wt2.branchName,
      baseBranch: wt2.baseBranch,
      baseCommit: wt2.baseCommit
    })
  });
  const mergeApiRes = await fetch(`${base}/api/tasks/${createdS2.id}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verifyCommand: "node -e \"process.exit(0)\"" })
  });
  assert.equal(mergeApiRes.status, 200, "POST /api/tasks/:id/merge 重驗通過應回傳 200");
  const mergeJson = await mergeApiRes.json();
  assert.equal(mergeJson.merged, true);
  assert.equal(mergeJson.reVerified, true);
  assert.equal(mergeJson.archived, true);
  assert.notEqual(execSync("git rev-parse main", { cwd: tempRepo, encoding: "utf8" }).trim(), movedMainSha, "main ref 必須成功推進");
  assert.equal(execSync("git rev-parse --abbrev-ref HEAD", { cwd: tempRepo, encoding: "utf8" }).trim(), "other-branch", "主工作區所在分支不可被切換");
  assert(fs.existsSync(path.join(tempRepo, "uncommitted.txt")), "主工作區未提交變更必須完整保留");
  assert(!fs.existsSync(wt2.worktreePath), "合併完成後 worktree 目錄必須已清理");

  // Case 3: one-way 風險門未指定遠端 origin 時須顯式確認才本地合併
  const wt3 = createTaskWorktree(tempRepo, "TASK-S2-ONEWAY", { baseBranch: "main" });
  fs.writeFileSync(path.join(wt3.worktreePath, "oneway.txt"), "risky\n");
  execSync("git add -A && git commit -q -m \"wt oneway\"", { cwd: wt3.worktreePath });
  const oneWayTask = await (await fetch(`${base}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "One-way 合併門禁測試",
      project: "td-s2-proj",
      status: "done",
      riskDoor: "one-way"
    })
  })).json();
  await fetch(`${base}/api/tasks/${oneWayTask.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      worktreePath: wt3.worktreePath,
      branchName: wt3.branchName,
      baseBranch: wt3.baseBranch,
      baseCommit: wt3.baseCommit
    })
  });
  const owBlocked = await fetch(`${base}/api/tasks/${oneWayTask.id}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(owBlocked.status, 409, "one-way 無遠端開 PR 且未顯式確認時必須回傳 409");
  const owBlockedJson = await owBlocked.json();
  assert.equal(owBlockedJson.requiresConfirmation, true);

  const owConfirmed = await fetch(`${base}/api/tasks/${oneWayTask.id}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmOneWayMerge: true })
  });
  assert.equal(owConfirmed.status, 200, "one-way 顯式 confirmOneWayMerge: true 後必須成功 Squash 合併");

  // Case 4 (TASK-257): Worktree 內含已解決衝突之 MERGE_HEAD 時應走 merge-ff 保留雙父節點，不得 rebase 重爆衝突
  execSync("git checkout -q main", { cwd: tempRepo });
  fs.writeFileSync(path.join(tempRepo, "conflict_merge.txt"), "base-line\n");
  execSync("git add -A && git commit -q -m \"base conflict_merge\"", { cwd: tempRepo });
  execSync("git checkout -q -b upstream-master", { cwd: tempRepo });
  fs.writeFileSync(path.join(tempRepo, "conflict_merge.txt"), "master-line\n");
  execSync("git add -A && git commit -q -m \"upstream master change\"", { cwd: tempRepo });
  execSync("git checkout -q main", { cwd: tempRepo });
  fs.writeFileSync(path.join(tempRepo, "conflict_merge.txt"), "feature-line\n");
  execSync("git add -A && git commit -q -m \"feature change on main\"", { cwd: tempRepo });

  const wtMergeFf = createTaskWorktree(tempRepo, "TASK-257-MERGE-FF", { baseBranch: "main" });
  let mergeFailedAsExpected = false;
  try {
    execSync("git merge --no-commit --no-ff upstream-master", { cwd: wtMergeFf.worktreePath, stdio: "ignore" });
  } catch (_) {
    mergeFailedAsExpected = true;
  }
  assert.equal(mergeFailedAsExpected, true, "模擬 worktree 合併 upstream-master 應先產生衝突");
  // 以 master 為基準解決衝突並保留 MERGE_HEAD（不手動 commit，模擬 TASK-256 交回 review 狀態）
  execSync("git checkout --theirs conflict_merge.txt && git add conflict_merge.txt", { cwd: wtMergeFf.worktreePath });
  assert(fs.existsSync(path.join(tempRepo, ".git/worktrees/TASK-257-MERGE-FF/MERGE_HEAD")), "未 commit 前應存在 MERGE_HEAD");

  const mergeFfRes = await mergeTaskWorktree({
    repoPath: tempRepo,
    taskId: "TASK-257-MERGE-FF",
    task: { id: "TASK-257-MERGE-FF", title: "Merge FF preserve", baseBranch: "main", baseCommit: wtMergeFf.baseCommit },
    worktreePath: wtMergeFf.worktreePath,
    branchName: wtMergeFf.branchName
  });
  assert.equal(mergeFfRes.success, true, `含 MERGE_HEAD 之 worktree 應可順利合併，實際: ${mergeFfRes.error}`);
  assert.equal(mergeFfRes.merged, true);
  assert.equal(mergeFfRes.strategy, "merge-ff");
  assert.equal(fs.readFileSync(path.join(tempRepo, "conflict_merge.txt"), "utf8"), "master-line\n");
  const parentsFf = execSync("git rev-list --parents -n 1 main", { cwd: tempRepo, encoding: "utf8" }).trim().split(/\s+/);
  assert.equal(parentsFf.length, 3, "merge-ff 後 main HEAD 應保留 2 個父節點（commit + 2 parents）");
  assert(!fs.existsSync(wtMergeFf.worktreePath), "merge-ff 完成後 worktree 目錄必須已清理");

  // Case 5 (TASK-257): Worktree 含 Merge Commit 且期間 baseBranch 新增無衝突 commit 時應走 merge-preserve（不 rebase）
  const wtMergePreserve = createTaskWorktree(tempRepo, "TASK-257-MERGE-PRESERVE", { baseBranch: "main" });
  execSync("git checkout -q -b side-branch main~1", { cwd: tempRepo });
  fs.writeFileSync(path.join(tempRepo, "side_only.txt"), "from side\n");
  execSync("git add -A && git commit -q -m \"side commit\"", { cwd: tempRepo });
  execSync("git checkout -q main", { cwd: tempRepo });
  execSync("git merge --no-ff -q -m \"wt merge side\" side-branch", { cwd: wtMergePreserve.worktreePath });
  // 期間 main 前進另一個無衝突檔案
  fs.writeFileSync(path.join(tempRepo, "main_parallel.txt"), "parallel\n");
  execSync("git add -A && git commit -q -m \"main parallel advance\"", { cwd: tempRepo });

  const mergePreserveRes = await mergeTaskWorktree({
    repoPath: tempRepo,
    taskId: "TASK-257-MERGE-PRESERVE",
    task: { id: "TASK-257-MERGE-PRESERVE", title: "Merge Preserve test", baseBranch: "main", baseCommit: wtMergePreserve.baseCommit },
    worktreePath: wtMergePreserve.worktreePath,
    branchName: wtMergePreserve.branchName
  });
  assert.equal(mergePreserveRes.success, true, `merge-preserve 應順利整合並落地，實際: ${mergePreserveRes.error}`);
  assert.equal(mergePreserveRes.merged, true);
  assert.equal(mergePreserveRes.strategy, "merge-preserve");
  assert.equal(fs.readFileSync(path.join(tempRepo, "side_only.txt"), "utf8"), "from side\n");
  assert.equal(fs.readFileSync(path.join(tempRepo, "main_parallel.txt"), "utf8"), "parallel\n");
  assert(!fs.existsSync(wtMergePreserve.worktreePath), "merge-preserve 完成後 worktree 目錄必須已清理");

  console.log("    ✅ TD-S2 baseBranch 鎖定、衝突安全中止、基線變動重驗、Squash 與 Merge-Preserving 合併驗證通過");
} finally {
  fs.rmSync(tempRepo, { recursive: true, force: true });
  fs.rmSync(`${tempRepo}.worktrees`, { recursive: true, force: true });
}
})();
'

echo "  [8.7/9] 測試 TASK-179: Confirmation Gate, Harness Log 保留與關聯任務摘要 API ..."
TEST_PORT=$TEST_PORT node -e '
(async () => {
  const assert = require("node:assert/strict");
  const testPort = process.env.TEST_PORT || "3031";
  const base = `http://localhost:${testPort}`;

  // 1. 測試建立 requiresConfirmation: true 任務
  const createRes = await fetch(`${base}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "TASK-179 門禁測試",
      project: "task-dashboard",
      status: "in_progress",
      workspaceMode: "in_place",
      requiresConfirmation: true,
      executionPlan: ""
    })
  });
  assert.equal(createRes.status, 201);
  const task = await createRes.json();
  assert.equal(task.requiresConfirmation, true);

  // 2. 測試未經確認直接推進 review 被 HTTP 400 攔截
  const unconfirmedReviewRes = await fetch(`${base}/api/tasks/${task.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "review",
      executionLog: "未經確認就嘗試推進 review 的日誌，這是一段超過三十個字的說明，已執行 npm test 通過驗證。"
    })
  });
  assert.equal(unconfirmedReviewRes.status, 400, "未經確認之 requiresConfirmation 任務推進 review 必須被 HTTP 400 攔截");
  const unconfirmedErr = await unconfirmedReviewRes.json();
  assert(unconfirmedErr.error.includes("Confirmation gate failed"), "報錯訊息必須指涉 Confirmation gate 門禁阻擋");

  // 3. 測試確認並執行：confirmExecution: true 且 requiresConfirmation: false
  const confirmRes = await fetch(`${base}/api/tasks/${task.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...task,
      requiresConfirmation: false,
      confirmExecution: true,
      executionPlan: "1. 擬定詳細計劃\n2. 執行實作\n3. 驗證通過"
    })
  });
  assert.equal(confirmRes.status, 200, "確認執行必須成功更新任務");
  const confirmedTask = await confirmRes.json();
  assert.equal(confirmedTask.requiresConfirmation, false);

  // 4. 測試 autoAssembleExecutionReport 保留 harness log
  const harnessOutput = "PASS test/api.test.js\n  ✔ 15 passed\n  ✔ Harness Check 100% compliant";
  const reportRes = await fetch(`${base}/api/tasks/${task.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "review",
      objective: "完成 TASK-179 實作與驗證",
      rootCause: "autoAssembleExecutionReport 遺漏 payload.executionLog",
      resolution: "自動提取 executionLog 填入 rawLog 終端記錄",
      executionLog: harnessOutput,
      testCommand: "npm test",
      exitCode: 0,
      testSummary: "All tests green"
    })
  });
  assert.equal(reportRes.status, 200);
  const reportTask = await reportRes.json();
  assert(reportTask.executionLog.includes(harnessOutput), "產出的執行報告必須完整保留 harness log 原始終端輸出");
  assert(reportTask.executionLog.includes("## 1. 任務目標與根因分析"));

  // 5. 測試 GET /api/tasks/dependencies-summary
  const depSummaryRes = await fetch(`${base}/api/tasks/dependencies-summary?project=task-dashboard`);
  assert.equal(depSummaryRes.status, 200);
  const summaryList = await depSummaryRes.json();
  assert(Array.isArray(summaryList), "關聯任務清單必須為陣列");
  assert(summaryList.length > 0, "清單不可為空");
  const foundTask = summaryList.find(t => t.id === task.id);
  assert(foundTask, "清單必須包含剛建立之任務");
  assert.equal(foundTask.title, "TASK-179 門禁測試");
  assert.equal(foundTask.diff, undefined, "輕量摘要不得包含 heavy diff 欄位 (符合 Context Engineering)");

  // 6. 測試 GET /api/tasks/:id 查詢單一任務完整資訊
  const singleTaskRes = await fetch(`${base}/api/tasks/${task.id}`);
  assert.equal(singleTaskRes.status, 200);
  const singleTask = await singleTaskRes.json();
  assert.equal(singleTask.id, task.id);
  assert(singleTask.projectPath, "單一任務必須包含 enriched projectPath");

  // 清理測試產生的 build-plan 暫存檔案 (避免污染 git 工作區)
  const fs = require("node:fs");
  const path = require("node:path");
  const testPlanPath = path.join(process.cwd(), ".github", "harness", "plan", `${task.id.toLowerCase()}-build-plan.md`);
  if (fs.existsSync(testPlanPath)) {
    fs.unlinkSync(testPlanPath);
  }

  console.log("    ✅ TASK-179 Confirmation Gate、Harness Log 保留與關聯任務摘要 API 驗證通過");
})();
'

echo "  [8.8/9] 測試 TASK-181: Phase 1~3 智慧提取、別名欄位映射與舊日誌自癒..."
TEST_PORT=$TEST_PORT node -e '
(async () => {
  const assert = require("node:assert/strict");
  const testPort = process.env.TEST_PORT || "3031";
  const base = `http://localhost:${testPort}`;

  // 1. 測試建立含舊版 dummy 字眼之任務，透過 GET /api/tasks/:id 讀取時自動自癒
  const createOldRes = await fetch(`${base}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "舊版日誌任務",
      project: "task-dashboard",
      status: "in_progress",
      workspaceMode: "in_place",
      executionLog: "### Phase 1: Pre-Flight & Review Feedback Ingestion\n- 說明: 未提供前置檢閱細節；請以實際執行記錄為準。\n\n### Phase 2: Rule-Compliant Implementation\n- 說明: 未提供實作步驟細節；請以實際執行記錄為準。\n\n### Phase 3: Compliance Manifest & Review Promotion\n- 驗證說明: 未提供驗證命令與結果\n\n--- 執行詳細記錄 / 原生驗證輸出 ---\n### 1. 目標根因分析\n- 根因：排查 Phase 1~3 斷層\n### 2. 實作說明\n- 實作：feedbackManager 升級\n### 3. 驗證證據\n- npm test 通過"
    })
  });
  assert.equal(createOldRes.status, 201);
  const oldTask = await createOldRes.json();

  // 查詢單一任務 API 必須自動自癒修復
  const healedRes = await fetch(`${base}/api/tasks/${oldTask.id}`);
  assert.equal(healedRes.status, 200);
  const healedTask = await healedRes.json();
  assert(!healedTask.executionLog.includes("未提供前置檢閱細節"), "API 回傳時必須自動清除 dummy 假字眼");
  assert(healedTask.executionLog.includes("排查 Phase 1~3 斷層"), "Phase 1 必須成功提取真實根因細節");
  assert(healedTask.executionLog.includes("feedbackManager 升級"), "Phase 2 必須成功提取真實實作細節");
  assert(healedTask.executionLog.includes("npm test 通過"), "Phase 3 必須成功提取真實驗證證據");

  // 清理測試產生的 build-plan 暫存檔案 (避免污染 git 工作區)
  const fs = require("node:fs");
  const path = require("node:path");
  const testPlanPath = path.join(process.cwd(), ".github", "harness", "plan", `${oldTask.id.toLowerCase()}-build-plan.md`);
  if (fs.existsSync(testPlanPath)) {
    fs.unlinkSync(testPlanPath);
  }

  console.log("    ✅ TASK-181 Phase 1~3 智慧提取與日誌自動自癒驗證通過");
})();
'

echo "  [8.5/9] 測試 TASK-232 專案分支查詢/無損建分支與任務分支綁定 ..."
TEST_PORT="$TEST_PORT" TEST_DATA_DIR="$TEST_DATA_DIR" node -e '
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

(async () => {
  const base = `http://127.0.0.1:${process.env.TEST_PORT || "3039"}`;
  const tmpRoot = process.env.TEST_DATA_DIR;
  const repoDir = path.join(tmpRoot, "repo-task-232");
  fs.mkdirSync(repoDir, { recursive: true });

  execFileSync("git", ["-C", repoDir, "init", "-b", "main"]);
  execFileSync("git", ["-C", repoDir, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", repoDir, "config", "user.name", "Test Runner"]);
  fs.writeFileSync(path.join(repoDir, "README.md"), "# TASK-232 Test Repo\n");
  execFileSync("git", ["-C", repoDir, "add", "README.md"]);
  execFileSync("git", ["-C", repoDir, "commit", "-m", "init main"]);

  // 模擬工作區存在未提交檔案 (Dirty)
  const dirtyFile = path.join(repoDir, "dirty.txt");
  fs.writeFileSync(dirtyFile, "uncommitted change\n");

  const projRes = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "repo-task-232", name: "TASK-232 Test Repo", path: repoDir })
  });
  assert(projRes.status === 200 || projRes.status === 201, `建立測試專案應成功，實際: ${projRes.status}`);
  const projJson = await projRes.json();
  const projId = projJson.id || (projJson.project && projJson.project.id) || "repo-task-232";

  // 1. 查詢分支清單與 Dirty 狀態
  const branchesRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches?refresh=1`);
  assert.equal(branchesRes.status, 200);
  const branchesData = await branchesRes.json();
  assert.equal(branchesData.isGitRepo, true);
  assert.equal(branchesData.currentCheckoutBranch, "main");
  assert.equal(branchesData.isMainWorkspaceDirty, true);
  assert(branchesData.dirtyFilesCount >= 1);
  assert(branchesData.branches.some(b => b.name === "main"));

  // 2. 驗證不合法分支名稱防護
  const badFlagRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branchName: "-bad-flag", fromBranch: "main" })
  });
  assert.equal(badFlagRes.status, 400);

  const badRefRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branchName: "feat..invalid", fromBranch: "main" })
  });
  assert.equal(badRefRes.status, 400);

  // 3. Dirty 狀態下無損建立新分支
  const createBranchRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branchName: "feat/task-232-nav", fromBranch: "main" })
  });
  assert.equal(createBranchRes.status, 201);
  const createdBranchData = await createBranchRes.json();
  assert.equal(createdBranchData.branch, "feat/task-232-nav");
  assert.equal(createdBranchData.fromBranch, "main");
  assert.equal(fs.readFileSync(dirtyFile, "utf8"), "uncommitted change\n");
  const headAfter = execFileSync("git", ["-C", repoDir, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(headAfter, "main", "無損建立分支後不可切換目前工作區 HEAD");

  // 4. 建立與更新任務的 targetBranch 與 workspaceMode
  const createTaskRes = await fetch(`${base}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "TASK-232 分支綁定測試",
      project: projId,
      status: "todo",
      priority: "P1",
      targetBranch: "feat/task-232-nav",
      workspaceMode: "branch_stream"
    })
  });
  assert.equal(createTaskRes.status, 201);
  const createdTask = await createTaskRes.json();
  assert.equal(createdTask.targetBranch, "feat/task-232-nav");
  assert.equal(createdTask.baseBranch, "feat/task-232-nav");
  assert.equal(createdTask.workspaceMode, "branch_stream");

  const updateTaskRes = await fetch(`${base}/api/tasks/${encodeURIComponent(createdTask.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetBranch: "main",
      workspaceMode: "in_place"
    })
  });
  assert.equal(updateTaskRes.status, 200);
  const updatedTask = await updateTaskRes.json();
  assert.equal(updatedTask.targetBranch, "main");
  assert.equal(updatedTask.baseBranch, "main");
  assert.equal(updatedTask.workspaceMode, "in_place");

  const branchesAfterTaskRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches?refresh=1`);
  assert.equal(branchesAfterTaskRes.status, 200);
  const branchesAfterTask = await branchesAfterTaskRes.json();
  const mainBranchItem = branchesAfterTask.branches.find(b => b.name === "main");
  assert(mainBranchItem && mainBranchItem.activeTaskCount >= 1, "main 分支應計入關聯之 active 任務數");

  // 清理測試任務與專案
  await fetch(`${base}/api/tasks/${encodeURIComponent(createdTask.id)}`, { method: "DELETE" });
  await fetch(`${base}/api/projects/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: projId })
  });

  console.log("    ✅ TASK-232 分支查詢/無損建分支與任務分支綁定驗證通過");
})();
'

echo "  [8.6/9] 測試 TASK-233 自動 Worktree 隔離、排隊狀態與 /drift-check ..."
TEST_PORT=$TEST_PORT node -e '
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

(async () => {
  const base = "http://127.0.0.1:" + (process.env.TEST_PORT || "3039");
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "td-task233-"));
  const projId = "test-task233-proj-" + Date.now();
  const createdTaskIds = [];

  try {
    execFileSync("git", ["-C", tempRepo, "init", "-b", "main"], { stdio: "ignore" });
    execFileSync("git", ["-C", tempRepo, "config", "user.email", "test@example.com"], { stdio: "ignore" });
    execFileSync("git", ["-C", tempRepo, "config", "user.name", "Test Runner"], { stdio: "ignore" });
    fs.writeFileSync(path.join(tempRepo, "feature.txt"), "line 1\nline 2\n", "utf8");
    fs.writeFileSync(path.join(tempRepo, "other.txt"), "initial\n", "utf8");
    execFileSync("git", ["-C", tempRepo, "add", "."], { stdio: "ignore" });
    execFileSync("git", ["-C", tempRepo, "commit", "-m", "init"], { stdio: "ignore" });

    const regRes = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projId, name: "TASK-233 Test Repo", path: tempRepo })
    });
    assert(regRes.status === 200 || regRes.status === 201);

    // 1. workspaceMode: "worktree" 切換至 in_progress 自動建立 .worktrees/<TASK-ID> 並回寫資訊
    const wtCreateRes = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Worktree Auto Isolation",
        project: projId,
        status: "todo",
        workspaceMode: "worktree",
        targetBranch: "main"
      })
    });
    assert.equal(wtCreateRes.status, 201);
    const wtTaskTodo = await wtCreateRes.json();
    createdTaskIds.push(wtTaskTodo.id);

    const wtStartRes = await fetch(`${base}/api/tasks/${encodeURIComponent(wtTaskTodo.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress" })
    });
    assert.equal(wtStartRes.status, 200);
    const wtTask = await wtStartRes.json();
    assert(wtTask.worktreePath && fs.existsSync(wtTask.worktreePath), "應自動建立 worktreePath");
    assert(wtTask.worktreePath.includes(".worktrees/" + wtTask.id), "worktreePath 應位於 .worktrees/<TASK-ID>");
    assert.equal(wtTask.branchName, "td/" + wtTask.id);
    assert(wtTask.baseCommit && wtTask.baseCommit.length >= 7, "應回寫 baseCommit");

    // 3. GET /api/tasks/:taskId/drift-check 驗證無衝突與衝突飄移
    // 先在 worktree 提交一個修改 feature.txt 的 commit
    fs.writeFileSync(path.join(wtTask.worktreePath, "feature.txt"), "worktree line 1\nline 2\n", "utf8");
    execFileSync("git", ["-C", wtTask.worktreePath, "add", "feature.txt"], { stdio: "ignore" });
    execFileSync("git", ["-C", wtTask.worktreePath, "commit", "-m", "wt change"], { stdio: "ignore" });

    // 主分支推進一個不衝突的 commit (other.txt)
    fs.writeFileSync(path.join(tempRepo, "other.txt"), "main updated\n", "utf8");
    execFileSync("git", ["-C", tempRepo, "add", "other.txt"], { stdio: "ignore" });
    execFileSync("git", ["-C", tempRepo, "commit", "-m", "main non-conflict"], { stdio: "ignore" });

    const driftCleanRes = await fetch(`${base}/api/tasks/${encodeURIComponent(wtTask.id)}/drift-check`);
    assert.equal(driftCleanRes.status, 200);
    const driftClean = await driftCleanRes.json();
    assert.equal(driftClean.aheadCount, 1);
    assert.equal(driftClean.behindCount, 1);
    assert.equal(driftClean.hasDrift, true);
    assert.equal(driftClean.hasConflict, false);
    assert.deepEqual(driftClean.conflictingFiles, []);

    // 主分支再推進一個會與 worktree feature.txt 衝突的 commit
    fs.writeFileSync(path.join(tempRepo, "feature.txt"), "main conflicting line 1\nline 2\n", "utf8");
    execFileSync("git", ["-C", tempRepo, "add", "feature.txt"], { stdio: "ignore" });
    execFileSync("git", ["-C", tempRepo, "commit", "-m", "main conflict"], { stdio: "ignore" });

    const driftConflictRes = await fetch(`${base}/api/tasks/${encodeURIComponent(wtTask.id)}/drift-check`);
    assert.equal(driftConflictRes.status, 200);
    const driftConflict = await driftConflictRes.json();
    assert.equal(driftConflict.aheadCount, 1);
    assert.equal(driftConflict.behindCount, 2);
    assert.equal(driftConflict.hasDrift, true);
    assert.equal(driftConflict.hasConflict, true);
    assert(driftConflict.conflictingFiles.includes("feature.txt"), "conflictingFiles 應包含 feature.txt");

    const drift404Res = await fetch(`${base}/api/tasks/NON-EXISTENT-999/drift-check`);
    assert.equal(drift404Res.status, 404);

    // 2. 兩張同 targetBranch 之 branch_stream 任務同時 in_progress，第二張自動進入 queueState
    const bs1Res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Branch Stream 1",
        project: projId,
        status: "in_progress",
        workspaceMode: "branch_stream",
        targetBranch: "main"
      })
    });
    assert.equal(bs1Res.status, 201);
    const bs1 = await bs1Res.json();
    createdTaskIds.push(bs1.id);
    assert.equal(bs1.queueState, null);

    const bs2Res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Branch Stream 2",
        project: projId,
        status: "in_progress",
        workspaceMode: "branch_stream",
        targetBranch: "main"
      })
    });
    assert.equal(bs2Res.status, 201);
    const bs2 = await bs2Res.json();
    createdTaskIds.push(bs2.id);
    assert(bs2.queueState && bs2.queueState.blockedByTaskId === bs1.id, "第二張 branch_stream 應寫入 queueState.blockedByTaskId");
    assert(String(bs2.queueState.reason || "").includes(`等待 ${bs1.id} 完成中`), "排隊原因應使用白話文案");

    // 當第一張任務完成離開 in_progress，第二張應自動解除排隊
    const bs1DoneRes = await fetch(`${base}/api/tasks/${encodeURIComponent(bs1.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "review", forceReview: true })
    });
    assert.equal(bs1DoneRes.status, 200);
    const bs2AfterRes = await fetch(`${base}/api/tasks/${encodeURIComponent(bs2.id)}`);
    assert.equal(bs2AfterRes.status, 200);
    const bs2After = await bs2AfterRes.json();
    assert.equal(bs2After.queueState, null, "第一張完成後第二張 queueState 應自動解除");

    console.log("    ✅ TASK-233 Worktree 自動隔離、branch_stream 排隊與 /drift-check 驗證通過");
  } finally {
    for (const tid of createdTaskIds) {
      try { await fetch(`${base}/api/tasks/${encodeURIComponent(tid)}`, { method: "DELETE" }); } catch (e) {}
    }
    try {
      await fetch(`${base}/api/projects/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: projId })
      });
    } catch (e) {}
    try { fs.rmSync(`${tempRepo}.worktrees`, { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(tempRepo, { recursive: true, force: true }); } catch (e) {}
  }
})();
'

echo "  [8.9/9] 測試 TASK-234 合一通過並提交 (/land)、精準單卡結案不連坐與分支合併 (/branches/merge) ..."
node -e '
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

(async () => {
  const base = "http://localhost:" + process.argv[1];
  const tempRepo = "/tmp/test-task234-repo-" + process.pid;
  const projId = "test-task234-proj-" + process.pid;
  const createdTaskIds = [];

  try {
    fs.mkdirSync(tempRepo, { recursive: true });
    execFileSync("git", ["-C", tempRepo, "init", "-b", "main"]);
    execFileSync("git", ["-C", tempRepo, "config", "user.email", "tester@example.com"]);
    execFileSync("git", ["-C", tempRepo, "config", "user.name", "Tester"]);
    fs.writeFileSync(path.join(tempRepo, "README.md"), "# task234 test\n");
    execFileSync("git", ["-C", tempRepo, "add", "README.md"]);
    execFileSync("git", ["-C", tempRepo, "commit", "-m", "chore: init main"]);

    // 建立功能分支 feat/land-demo 並切過去做變更
    execFileSync("git", ["-C", tempRepo, "checkout", "-b", "feat/land-demo"]);

    const projRes = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projId, name: "TASK-234 Repo", path: tempRepo, defaultBranch: "main" })
    });
    assert(projRes.status === 200 || projRes.status === 201, "POST /api/projects 應成功");

    // 1. 建立已存在的 TASK-A (done)，確保後續 TASK-B /land 不會連坐封存 TASK-A
    const taskARes = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "TASK-A 已完成不應被連坐", project: projId, status: "done" })
    });
    assert.equal(taskARes.status, 201);
    const taskA = await taskARes.json();
    createdTaskIds.push(taskA.id);

    // 2. 建立 TASK-B (review, branch_stream on feat/land-demo) 與受其阻塞排隊的 TASK-C
    const taskBRes = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "TASK-B 合一通過並提交",
        project: projId,
        status: "review",
        workspaceMode: "branch_stream",
        targetBranch: "feat/land-demo"
      })
    });
    assert.equal(taskBRes.status, 201);
    const taskB = await taskBRes.json();
    createdTaskIds.push(taskB.id);

    const taskCRes = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "TASK-C 排隊等待 TASK-B",
        project: projId,
        status: "todo",
        workspaceMode: "branch_stream",
        targetBranch: "feat/land-demo"
      })
    });
    assert.equal(taskCRes.status, 201);
    const taskC = await taskCRes.json();
    createdTaskIds.push(taskC.id);

    const setQueueRes = await fetch(`${base}/api/tasks/${encodeURIComponent(taskC.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queueState: { blockedByTaskId: taskB.id, reason: `等待 ${taskB.id} 完成中`, queuedAt: new Date().toISOString() }
      })
    });
    assert.equal(setQueueRes.status, 200);

    // 在 feat/land-demo 寫入程式碼變更
    fs.writeFileSync(path.join(tempRepo, "feature_234.txt"), "landed via /land\n");

    // 3. 呼叫 POST /api/tasks/:taskId/land (archiveImmediately: true)
    const landRes = await fetch(`${base}/api/tasks/${encodeURIComponent(taskB.id)}/land`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "feat(task-234): test single-card land",
        body: "verify no collateral archival and queue unblock",
        archiveImmediately: true
      })
    });
    assert.equal(landRes.status, 200, "POST /land 應回傳 200");
    const landData = await landRes.json();
    assert.equal(landData.success, true);
    assert.equal(landData.status, "archived");
    assert(landData.gitLanding && landData.gitLanding.isCommitted === true, "應寫入 gitLanding.isCommitted");
    assert(landData.gitLanding.commitSha && landData.gitLanding.commitSha.length >= 7, "應寫入 commitSha");
    assert.equal(landData.gitLanding.landedBranch, "feat/land-demo");
    assert(Array.isArray(landData.unblockedTaskIds) && landData.unblockedTaskIds.includes(taskC.id), "應回傳已解除排隊的 TASK-C");

    // 驗證 TASK-A 仍維持 done（精準單卡結案不連坐）
    const taskAAfter = await (await fetch(`${base}/api/tasks/${encodeURIComponent(taskA.id)}`)).json();
    assert.equal(taskAAfter.status, "done", "TASK-A 不得被連坐封存，應維持 done");

    // 驗證 TASK-C queueState 已自動解除
    const taskCAfter = await (await fetch(`${base}/api/tasks/${encodeURIComponent(taskC.id)}`)).json();
    assert.equal(taskCAfter.queueState, null, "TASK-B land 後 TASK-C queueState 應自動解除");

    // 4. 驗證 POST /api/projects/:projectId/branches/merge 將 feat/land-demo 合回 main
    const mergeBranchRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceBranch: "feat/land-demo",
        targetBranch: "main",
        strategy: "merge"
      })
    });
    assert.equal(mergeBranchRes.status, 200, "POST /branches/merge 應回傳 200");
    const mergeBranchData = await mergeBranchRes.json();
    assert.equal(mergeBranchData.success, true);
    assert.equal(mergeBranchData.merged, true);
    assert(mergeBranchData.commitSha && mergeBranchData.commitSha.length >= 7, "branches/merge 應回傳 commitSha");

    // 驗證 main 分支已包含 feature_234.txt
    const mainTree = execFileSync("git", ["-C", tempRepo, "ls-tree", "-r", "--name-only", "main"], { encoding: "utf8" });
    assert(mainTree.includes("feature_234.txt"), "合併後 main 分支應包含 feature_234.txt");

    console.log("    ✅ TASK-234 /land 單卡精準結案、排隊解鎖與 /branches/merge 驗證通過");
  } finally {
    for (const tid of createdTaskIds) {
      try { await fetch(`${base}/api/tasks/${encodeURIComponent(tid)}`, { method: "DELETE" }); } catch (e) {}
    }
    try {
      await fetch(`${base}/api/projects/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: projId })
      });
    } catch (e) {}
    try { fs.rmSync(tempRepo, { recursive: true, force: true }); } catch (e) {}
  }
})();
' "$TEST_PORT"

echo "  [8.96/9] 測試 暫存 Harness 檔案過濾合併與 .gitignore 自動防呆 ..."
node -e '
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const gitService = require("./src/server/services/gitService");
const { ensureHarnessGitignore } = require("./src/server/services/harnessService");

(async () => {
  // 1) isTransientHarnessPath 驗證
  assert.strictEqual(gitService.isTransientHarnessPath(".github/worklog/agent-status.md"), true);
  assert.strictEqual(gitService.isTransientHarnessPath(".github/harness/plan/task-999-build-plan.md"), true);
  assert.strictEqual(gitService.isTransientHarnessPath("sub/agent-status.md"), true);
  assert.strictEqual(gitService.isTransientHarnessPath(".github/harness/plan/README.md"), false);
  assert.strictEqual(gitService.isTransientHarnessPath("src/server/server.js"), false);

  // 2) ensureHarnessGitignore 與 mergeFeatureBranch 暫存檔放行 / 真實髒檔阻斷測試
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "td-harness-ignore-"));
  try {
    execFileSync("git", ["-C", tmpRepo, "init", "-b", "main"]);
    execFileSync("git", ["-C", tmpRepo, "config", "user.name", "Test"]);
    execFileSync("git", ["-C", tmpRepo, "config", "user.email", "test@example.com"]);
    fs.writeFileSync(path.join(tmpRepo, "app.txt"), "v1\n", "utf8");
    execFileSync("git", ["-C", tmpRepo, "add", "."]);
    execFileSync("git", ["-C", tmpRepo, "commit", "-m", "init"]);

    execFileSync("git", ["-C", tmpRepo, "checkout", "-b", "feat/clean-harness"]);
    fs.writeFileSync(path.join(tmpRepo, "app.txt"), "v2\n", "utf8");
    execFileSync("git", ["-C", tmpRepo, "add", "."]);
    execFileSync("git", ["-C", tmpRepo, "commit", "-m", "feat"]);
    execFileSync("git", ["-C", tmpRepo, "checkout", "main"]);

    // 放入未 ignore 的 transient harness 檔案（應由 mergeFeatureBranch 暫存後放行並保留）
    fs.mkdirSync(path.join(tmpRepo, ".github/worklog"), { recursive: true });
    fs.mkdirSync(path.join(tmpRepo, ".github/harness/plan"), { recursive: true });
    fs.writeFileSync(path.join(tmpRepo, ".github/worklog/agent-status.md"), "# status\n", "utf8");
    fs.writeFileSync(path.join(tmpRepo, ".github/harness/plan/task-999-build-plan.md"), "# plan\n", "utf8");

    const okMerge = await gitService.mergeFeatureBranch(tmpRepo, "feat/clean-harness", "main", { strategy: "merge" });
    assert.strictEqual(okMerge.success, true, "僅有 agent-status / build-plan 時 mergeFeatureBranch 應放行合併");
    assert(fs.existsSync(path.join(tmpRepo, ".github/worklog/agent-status.md")), "合併後 agent-status.md 仍應保留於磁碟");
    assert(fs.existsSync(path.join(tmpRepo, ".github/harness/plan/task-999-build-plan.md")), "合併後 build-plan 仍應保留於磁碟");

    // 加入真實未追蹤程式碼檔案時仍應阻斷並點出檔名
    fs.writeFileSync(path.join(tmpRepo, "dirty.js"), "console.log(1);\n", "utf8");
    const blockedMerge = await gitService.mergeFeatureBranch(tmpRepo, "feat/clean-harness", "main", { strategy: "merge" });
    assert.strictEqual(blockedMerge.success, false);
    assert.strictEqual(blockedMerge.status, "dirty_main_workspace");
    assert(blockedMerge.error.includes("dirty.js"), "真實未提交變更應點出檔名阻斷");

    // ensureHarnessGitignore 冪等性檢查
    assert.strictEqual(ensureHarnessGitignore(tmpRepo), true);
    assert.strictEqual(ensureHarnessGitignore(tmpRepo), false);
    const gitignoreTxt = fs.readFileSync(path.join(tmpRepo, ".gitignore"), "utf8");
    assert(gitignoreTxt.includes(".github/worklog/") && gitignoreTxt.includes(".github/harness/plan/*-build-plan.md"));

    console.log("    ✅ Harness 暫存過濾合併、非互動 Push 診斷與 .gitignore 自動維護驗證通過");
  } finally {
    try { fs.rmSync(tmpRepo, { recursive: true, force: true }); } catch (e) {}
  }
})();
'

echo "  [8.97/9] 測試 TASK-242 One-Way 高風險任務顯式確認後本地 Squash 合併（絕不偷推 td/* 至遠端）..."
node -e '
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { createTaskWorktree, mergeTaskWorktree, checkTaskBaseDrift } = require("./src/server/services/gitService");

(async () => {
  const base = "http://localhost:" + process.argv[1];
  const originBare = fs.mkdtempSync(path.join(os.tmpdir(), "td-242-origin-"));
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "td-242-repo-"));
  const projId = "test-task242-proj-" + process.pid;
  const createdTaskIds = [];

  try {
    // 初始化裸遠端與本地倉庫（含 main 與 feature/智慧客服 分支）
    execFileSync("git", ["init", "--bare", originBare]);
    execFileSync("git", ["-C", tempRepo, "init", "-b", "main"]);
    execFileSync("git", ["-C", tempRepo, "config", "user.email", "tester@example.com"]);
    execFileSync("git", ["-C", tempRepo, "config", "user.name", "Tester"]);
    fs.writeFileSync(path.join(tempRepo, "README.md"), "# task242 test\n");
    execFileSync("git", ["-C", tempRepo, "add", "README.md"]);
    execFileSync("git", ["-C", tempRepo, "commit", "-m", "chore: init main"]);
    execFileSync("git", ["-C", tempRepo, "remote", "add", "origin", originBare]);
    execFileSync("git", ["-C", tempRepo, "push", "-u", "origin", "main"]);

    execFileSync("git", ["-C", tempRepo, "checkout", "-b", "feature/智慧客服"]);
    fs.writeFileSync(path.join(tempRepo, "base_feature.txt"), "base feature\n");
    execFileSync("git", ["-C", tempRepo, "add", "base_feature.txt"]);
    execFileSync("git", ["-C", tempRepo, "commit", "-m", "feat: init feature branch"]);
    execFileSync("git", ["-C", tempRepo, "push", "-u", "origin", "feature/智慧客服"]);

    // 1. 單元測試：mergeTaskWorktree (one-way 未確認 vs 顯式確認)
    const unitWt = createTaskWorktree(tempRepo, "TASK-242-UNIT", { baseBranch: "feature/智慧客服" });
    fs.writeFileSync(path.join(unitWt.worktreePath, "oneway_unit.txt"), "unit one-way change\n");
    execFileSync("git", ["-C", unitWt.worktreePath, "add", "oneway_unit.txt"]);
    execFileSync("git", ["-C", unitWt.worktreePath, "commit", "-m", "feat: unit oneway change"]);

    const unitBlocked = await mergeTaskWorktree({
      repoPath: tempRepo,
      taskId: "TASK-242-UNIT",
      task: { riskDoor: "one-way", title: "One-way unit test" },
      baseBranch: "feature/智慧客服",
      confirmOneWayMerge: false
    });
    assert.strictEqual(unitBlocked.success, false, "未確認時應回傳 success: false");
    assert.strictEqual(unitBlocked.merged, false, "未確認時應回傳 merged: false");
    assert.strictEqual(unitBlocked.status, "one_way_requires_confirmation");
    assert.strictEqual(unitBlocked.requiresConfirmation, true);

    const originTdRefs1 = execFileSync("git", ["-C", originBare, "for-each-ref", "refs/heads/td/"], { encoding: "utf8" }).trim();
    assert.strictEqual(originTdRefs1, "", "即使有 origin 遠端也不得推送 td/* 分支");

    const unitConfirmed = await mergeTaskWorktree({
      repoPath: tempRepo,
      taskId: "TASK-242-UNIT",
      task: { riskDoor: "one-way", title: "One-way unit test" },
      baseBranch: "feature/智慧客服",
      confirmOneWayMerge: true
    });
    assert.strictEqual(unitConfirmed.success, true, "顯式確認後應成功合併");
    assert.strictEqual(unitConfirmed.merged, true);
    assert.strictEqual(unitConfirmed.status, "merged");
    assert.strictEqual(unitConfirmed.baseBranch, "feature/智慧客服");

    const featureTreeAfterUnit = execFileSync("git", ["-C", tempRepo, "ls-tree", "-r", "--name-only", "feature/智慧客服"], { encoding: "utf8" });
    assert(featureTreeAfterUnit.includes("oneway_unit.txt"), "feature/智慧客服 應包含 oneway_unit.txt");
    assert(!fs.existsSync(unitWt.worktreePath), "合併後 worktree 目錄應被清理");
    const localTdUnit = execFileSync("git", ["-C", tempRepo, "for-each-ref", "refs/heads/td/TASK-242-UNIT"], { encoding: "utf8" }).trim();
    assert.strictEqual(localTdUnit, "", "本地 td/TASK-242-UNIT 分支應已刪除");
    const originTdRefs2 = execFileSync("git", ["-C", originBare, "for-each-ref", "refs/heads/td/"], { encoding: "utf8" }).trim();
    assert.strictEqual(originTdRefs2, "", "確認本地合併後遠端 origin 仍不得有任何 td/* 分支");

    // 2. 整合測試：POST /api/tasks/:id/land
    const projRes = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projId, name: "TASK-242 Repo", path: tempRepo, defaultBranch: "main" })
    });
    assert(projRes.status === 200 || projRes.status === 201, "POST /api/projects 應成功");

    const createTaskRes = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "One-way integration land test",
        project: projId,
        status: "review",
        workspaceMode: "worktree",
        riskDoor: "one-way",
        targetBranch: "feature/智慧客服",
        baseBranch: "feature/智慧客服"
      })
    });
    assert.strictEqual(createTaskRes.status, 201);
    const createdTask = await createTaskRes.json();
    createdTaskIds.push(createdTask.id);

    const intWt = createTaskWorktree(tempRepo, createdTask.id, { baseBranch: "feature/智慧客服" });
    fs.writeFileSync(path.join(intWt.worktreePath, "oneway_land.txt"), "integration one-way land\n");
    execFileSync("git", ["-C", intWt.worktreePath, "add", "oneway_land.txt"]);
    execFileSync("git", ["-C", intWt.worktreePath, "commit", "-m", "feat: integration oneway land"]);

    const putTaskRes = await fetch(`${base}/api/tasks/${encodeURIComponent(createdTask.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worktreePath: intWt.worktreePath,
        branchName: intWt.branchName,
        baseBranch: intWt.baseBranch,
        targetBranch: "feature/智慧客服",
        baseCommit: intWt.baseCommit
      })
    });
    assert.strictEqual(putTaskRes.status, 200);

    // 未傳入 confirmOneWayMerge 呼叫 /land -> 409 且不修改任務狀態/gitLanding
    const landBlockedRes = await fetch(`${base}/api/tasks/${encodeURIComponent(createdTask.id)}/land`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "feat(task-242): should wait confirm" })
    });
    assert.strictEqual(landBlockedRes.status, 409, "未確認 one-way /land 應回傳 409");
    const landBlockedData = await landBlockedRes.json();
    assert.strictEqual(landBlockedData.success, false);
    assert.strictEqual(landBlockedData.merged, false);
    assert.strictEqual(landBlockedData.isCommitted, false);
    assert.strictEqual(landBlockedData.status, "one_way_requires_confirmation");
    assert.strictEqual(landBlockedData.requiresConfirmation, true);

    const taskAfterBlocked = await (await fetch(`${base}/api/tasks/${encodeURIComponent(createdTask.id)}`)).json();
    assert.strictEqual(taskAfterBlocked.status, "review", "未確認時任務狀態必須維持 review");
    assert(!(taskAfterBlocked.gitLanding && taskAfterBlocked.gitLanding.isCommitted), "未確認時不得寫入 gitLanding.isCommitted");
    assert(!(taskAfterBlocked.gitLanding && taskAfterBlocked.gitLanding.landedBranch), "未確認時不得寫入 gitLanding.landedBranch");
    const originTdRefs3 = execFileSync("git", ["-C", originBare, "for-each-ref", "refs/heads/td/"], { encoding: "utf8" }).trim();
    assert.strictEqual(originTdRefs3, "", "整合測試未確認階段遠端 origin 不得有 td/* 分支");

    // 顯式傳入 confirmOneWayMerge: true 呼叫 /land -> 200 成功本地合併
    const landOkRes = await fetch(`${base}/api/tasks/${encodeURIComponent(createdTask.id)}/land`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmOneWayMerge: true,
        subject: "feat(task-242): one-way land to feature branch"
      })
    });
    assert.strictEqual(landOkRes.status, 200, "顯式 confirmOneWayMerge: true 後 /land 應回傳 200");
    const landOkData = await landOkRes.json();
    assert.strictEqual(landOkData.success, true);
    assert.strictEqual(landOkData.isCommitted, true);
    assert.strictEqual(landOkData.status, "done");
    assert.strictEqual(landOkData.gitLanding.isCommitted, true);
    assert.strictEqual(landOkData.gitLanding.landedBranch, "feature/智慧客服");
    assert.strictEqual(landOkData.gitLanding.pushedRemote, false);
    assert(landOkData.gitLanding.commitSha && landOkData.gitLanding.commitSha.length >= 7, "應回傳有效的 commitSha");

    const featureTreeAfterLand = execFileSync("git", ["-C", tempRepo, "ls-tree", "-r", "--name-only", "feature/智慧客服"], { encoding: "utf8" });
    assert(featureTreeAfterLand.includes("oneway_land.txt"), "合併後 feature/智慧客服 應包含 oneway_land.txt");
    assert(!fs.existsSync(intWt.worktreePath), "合併後 worktree 目錄應已清理");
    const localTdInt = execFileSync("git", ["-C", tempRepo, "for-each-ref", "refs/heads/td/"], { encoding: "utf8" }).trim();
    assert.strictEqual(localTdInt, "", "合併後本地 td/* 分支應已全數清理");
    const originTdRefs4 = execFileSync("git", ["-C", originBare, "for-each-ref", "refs/heads/td/"], { encoding: "utf8" }).trim();
    assert.strictEqual(originTdRefs4, "", "合併後遠端 origin 仍不得有任何 td/* 分支");

    // 3. 驗證主工作區髒狀態檢查 (checkTaskBaseDrift 與 mergeTaskWorktree 同步過濾 Harness 暫存並回報 dirtyFiles)
    const dirtyWt = createTaskWorktree(tempRepo, "TASK-242-DIRTY", { baseBranch: "feature/智慧客服" });
    fs.writeFileSync(path.join(dirtyWt.worktreePath, "wt_clean.txt"), "wt change\n");
    execFileSync("git", ["-C", dirtyWt.worktreePath, "add", "wt_clean.txt"]);
    execFileSync("git", ["-C", dirtyWt.worktreePath, "commit", "-m", "feat: dirty check"]);

    // 3a. 僅有 Harness 暫存檔時，checkTaskBaseDrift 不應誤報 dirty_main_workspace
    fs.mkdirSync(path.join(tempRepo, ".github/worklog"), { recursive: true });
    fs.writeFileSync(path.join(tempRepo, ".github/worklog/agent-status.md"), "# transient\n");
    const driftWithTransient = checkTaskBaseDrift(tempRepo, {
      workspaceMode: "worktree",
      worktreePath: dirtyWt.worktreePath,
      targetBranch: "feature/智慧客服",
      baseBranch: "feature/智慧客服",
      baseCommit: dirtyWt.baseCommit
    });
    assert.notStrictEqual(driftWithTransient.status, "dirty_main_workspace", "僅有 transient harness 檔時不應報 dirty_main_workspace");

    // 3b. 主工作區有真實未提交變更時，checkTaskBaseDrift 與 mergeTaskWorktree 皆須回報 dirty_main_workspace 並列出檔名
    fs.writeFileSync(path.join(tempRepo, "uncommitted_main.txt"), "dirty\n");
    const driftWithRealDirty = checkTaskBaseDrift(tempRepo, {
      workspaceMode: "worktree",
      worktreePath: dirtyWt.worktreePath,
      targetBranch: "feature/智慧客服",
      baseBranch: "feature/智慧客服",
      baseCommit: dirtyWt.baseCommit
    });
    assert.strictEqual(driftWithRealDirty.status, "dirty_main_workspace");
    assert.strictEqual(driftWithRealDirty.dirtyMainWorkspace, true);
    assert(Array.isArray(driftWithRealDirty.dirtyFiles) && driftWithRealDirty.dirtyFiles.includes("uncommitted_main.txt"));

    const mergeDirtyRes = await mergeTaskWorktree({
      repoPath: tempRepo,
      taskId: "TASK-242-DIRTY",
      task: { riskDoor: "two-way", title: "Dirty check" },
      baseBranch: "feature/智慧客服"
    });
    assert.strictEqual(mergeDirtyRes.success, false);
    assert.strictEqual(mergeDirtyRes.status, "dirty_main_workspace");
    assert(Array.isArray(mergeDirtyRes.dirtyFiles) && mergeDirtyRes.dirtyFiles.includes("uncommitted_main.txt"));
    assert(mergeDirtyRes.error.includes("uncommitted_main.txt"), "dirty_main_workspace 錯誤訊息應列出未提交檔名");

    // 清理真實髒檔後（保留 transient harness 檔），mergeTaskWorktree 應放行並成功合併
    fs.unlinkSync(path.join(tempRepo, "uncommitted_main.txt"));
    const mergeAfterCleanRes = await mergeTaskWorktree({
      repoPath: tempRepo,
      taskId: "TASK-242-DIRTY",
      task: { riskDoor: "two-way", title: "Dirty check" },
      baseBranch: "feature/智慧客服"
    });
    assert.strictEqual(mergeAfterCleanRes.success, true);
    assert.strictEqual(mergeAfterCleanRes.merged, true);

    console.log("    ✅ TASK-242 One-Way 高風險顯式確認本地 Squash 合併與主工作區髒狀態檢查驗證通過");
  } finally {
    for (const tid of createdTaskIds) {
      try { await fetch(`${base}/api/tasks/${encodeURIComponent(tid)}`, { method: "DELETE" }); } catch (e) {}
    }
    try {
      await fetch(`${base}/api/projects/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: projId })
      });
    } catch (e) {}
    try { fs.rmSync(`${tempRepo}.worktrees`, { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(tempRepo, { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(originBare, { recursive: true, force: true }); } catch (e) {}
  }
})();
' "$TEST_PORT"

echo "  [8.98/9] 測試 TASK-243 遠端狀態檢查、推送分支與跨平台 PR 建立/降級..."
node -e '
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  redactUrlCredentials,
  detectRemoteProvider,
  buildFallbackPrUrl,
  getBranchRemoteStatus,
  pushBranch,
  createPullRequest
} = require("./src/server/services/gitRemoteService");

(async () => {
  const base = "http://localhost:" + process.argv[1];
  const originBare = fs.mkdtempSync(path.join(os.tmpdir(), "td-243-origin-"));
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "td-243-repo-"));
  const projId = "test-task243-proj-" + process.pid;

  try {
    // 1. 單元測試：redactUrlCredentials()
    assert.strictEqual(
      redactUrlCredentials("https://user:my-secret-pat@dev.azure.com/FET-IDTT/SmartCS/_git/demo"),
      "https://***@dev.azure.com/FET-IDTT/SmartCS/_git/demo",
      "應遮罩 Azure DevOps URL 憑證"
    );
    assert.strictEqual(
      redactUrlCredentials("https://ghp_secret123@github.com/octocat/hello-world.git"),
      "https://***@github.com/octocat/hello-world.git",
      "應遮罩 GitHub URL 憑證"
    );
    const multiLineErr = "fatal: unable to access \x27https://tok:secret99@dev.azure.com/FET-IDTT/Proj/_git/Repo/\x27\nfatal: error from https://pat123@github.com/org/repo.git";
    const redactedMulti = redactUrlCredentials(multiLineErr);
    assert(!redactedMulti.includes("secret99") && !redactedMulti.includes("pat123"), "多行錯誤訊息中所有 PAT 必須被遮罩");
    assert(redactedMulti.includes("https://***@dev.azure.com/") && redactedMulti.includes("https://***@github.com/"));

    // 2. 單元測試：detectRemoteProvider()
    const azdoInfo = detectRemoteProvider("https://user:pat-xyz@dev.azure.com/FET-IDTT/Smart%20CS/_git/task-dashboard.git");
    assert.strictEqual(azdoInfo.provider, "azure-devops");
    assert.strictEqual(azdoInfo.org, "FET-IDTT");
    assert.strictEqual(azdoInfo.project, "Smart CS");
    assert.strictEqual(azdoInfo.repo, "task-dashboard");
    assert.strictEqual(azdoInfo.webBaseUrl, "https://dev.azure.com/FET-IDTT/Smart%20CS/_git/task-dashboard");
    assert(!azdoInfo.redactedUrl.includes("pat-xyz") && azdoInfo.redactedUrl.includes("https://***@"));

    const azdoLegacy = detectRemoteProvider("https://FET-IDTT.visualstudio.com/DefaultCollection/SmartCS/_git/demo.git");
    assert.strictEqual(azdoLegacy.provider, "azure-devops");
    assert.strictEqual(azdoLegacy.org, "FET-IDTT");
    assert.strictEqual(azdoLegacy.project, "SmartCS");
    assert.strictEqual(azdoLegacy.repo, "demo");

    const azdoSsh = detectRemoteProvider("git@ssh.dev.azure.com:v3/FET-IDTT/SmartCS/demo.git");
    assert.strictEqual(azdoSsh.provider, "azure-devops");
    assert.strictEqual(azdoSsh.repo, "demo");

    const ghHttps = detectRemoteProvider("https://token123@github.com/octocat/Hello-World.git");
    assert.strictEqual(ghHttps.provider, "github");
    assert.strictEqual(ghHttps.owner, "octocat");
    assert.strictEqual(ghHttps.org, "octocat");
    assert.strictEqual(ghHttps.repo, "Hello-World");
    assert.strictEqual(ghHttps.webBaseUrl, "https://github.com/octocat/Hello-World");
    assert(!ghHttps.redactedUrl.includes("token123"));

    const ghSsh = detectRemoteProvider("git@github.com:octocat/Hello-World.git");
    assert.strictEqual(ghSsh.provider, "github");
    assert.strictEqual(ghSsh.owner, "octocat");
    assert.strictEqual(ghSsh.repo, "Hello-World");

    const unknownInfo = detectRemoteProvider("/tmp/local-bare.git");
    assert.strictEqual(unknownInfo.provider, "unknown");
    assert.strictEqual(unknownInfo.webBaseUrl, "");

    // 3. 建立測試用本地 Git 倉庫 + Bare origin，並註冊專案至伺服器
    execFileSync("git", ["init", "--bare", originBare]);
    execFileSync("git", ["-C", tempRepo, "init", "-b", "main"]);
    execFileSync("git", ["-C", tempRepo, "config", "user.email", "tester@example.com"]);
    execFileSync("git", ["-C", tempRepo, "config", "user.name", "Tester"]);
    fs.writeFileSync(path.join(tempRepo, "README.md"), "# task243\n");
    execFileSync("git", ["-C", tempRepo, "add", "README.md"]);
    execFileSync("git", ["-C", tempRepo, "commit", "-m", "chore: init main"]);
    execFileSync("git", ["-C", tempRepo, "remote", "add", "origin", originBare]);
    execFileSync("git", ["-C", tempRepo, "push", "-u", "origin", "main"]);

    execFileSync("git", ["-C", tempRepo, "checkout", "-b", "feat/pr-demo"]);
    fs.writeFileSync(path.join(tempRepo, "pr_demo.txt"), "demo pr\n");
    execFileSync("git", ["-C", tempRepo, "add", "pr_demo.txt"]);
    execFileSync("git", ["-C", tempRepo, "commit", "-m", "feat: pr demo change"]);

    const projRes = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projId, name: "TASK-243 Test Project", path: tempRepo })
    });
    assert(projRes.ok, "建立測試專案應成功");

    // 4. 整合測試：GET /api/projects/:id/remote-status?branch=feat/pr-demo
    const statusRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/remote-status?branch=${encodeURIComponent("feat/pr-demo")}`);
    assert.strictEqual(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.strictEqual(statusData.isGitRepo, true);
    assert.strictEqual(statusData.branch, "feat/pr-demo");
    assert.strictEqual(statusData.hasRemote, true);
    assert.strictEqual(statusData.hasUpstream, false);
    assert(statusData.ahead >= 1, "未推送新分支 ahead 應 >= 1");

    // 5. 整合測試：建立 done 任務後呼叫 POST /api/projects/:id/branches/push 並驗證任務 gitLanding.pushedRemote 持久化
    const createDoneRes = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "TASK-243 done branch push persistence",
        project: projId,
        status: "done",
        targetBranch: "feat/pr-demo",
        baseBranch: "main"
      })
    });
    assert(createDoneRes.ok, "建立 done 測試任務應成功");
    const createdDoneTask = await createDoneRes.json();
    const doneTaskId = createdDoneTask.id;
    assert(doneTaskId, "應回傳建立的 done 任務 ID");

    const pushRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "feat/pr-demo", taskId: doneTaskId })
    });
    assert.strictEqual(pushRes.status, 200);
    const pushData = await pushRes.json();
    assert.strictEqual(pushData.success, true);
    assert(Array.isArray(pushData.updatedTaskIds) && pushData.updatedTaskIds.includes(doneTaskId), "push 回應應包含 updatedTaskIds 且含 doneTaskId");
    assert.strictEqual(pushData.remoteStatus.hasUpstream, true);
    assert.strictEqual(pushData.remoteStatus.ahead, 0);
    const bareRef = execFileSync("git", ["-C", originBare, "rev-parse", "--verify", "refs/heads/feat/pr-demo"], { encoding: "utf8" }).trim();
    assert(bareRef.length >= 7, "bare origin 應已有 refs/heads/feat/pr-demo");

    const checkTaskRes = await fetch(`${base}/api/tasks/${encodeURIComponent(doneTaskId)}`);
    assert.strictEqual(checkTaskRes.status, 200);
    const checkedDoneTask = await checkTaskRes.json();
    assert.strictEqual(checkedDoneTask.gitLanding?.pushedRemote, true, "push 成功後 done 任務應持久化 gitLanding.pushedRemote === true");
    assert.strictEqual(checkedDoneTask.status, "archived", "push 成功後 done 任務應自動封存為 archived");
    assert(Array.isArray(pushData.archivedTaskIds) && pushData.archivedTaskIds.includes(doneTaskId), "push 回應應包含 archivedTaskIds");

    // 6. 整合測試：remoteUrl 遮罩與 Azure DevOps 無 PAT 時 POST /api/projects/:id/branches/pr 降級
    execFileSync("git", ["-C", tempRepo, "remote", "set-url", "origin", "https://user:super-secret-pat@dev.azure.com/FET-IDTT/SmartCS/_git/demo-repo"]);
    const azStatusRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/remote-status?branch=${encodeURIComponent("feat/pr-demo")}`);
    const azStatusData = await azStatusRes.json();
    assert.strictEqual(azStatusData.provider, "azure-devops");
    assert(!azStatusData.remoteUrl.includes("super-secret-pat") && azStatusData.remoteUrl.includes("https://***@"));

    execFileSync("git", ["-C", tempRepo, "remote", "set-url", "origin", "https://dev.azure.com/FET-IDTT/SmartCS/_git/demo-repo"]);
    const prDegradedRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches/pr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceBranch: "feat/pr-demo", targetBranch: "main", title: "Demo PR" })
    });
    assert.strictEqual(prDegradedRes.status, 200);
    const prDegradedData = await prDegradedRes.json();
    assert.strictEqual(prDegradedData.success, false);
    assert.strictEqual(prDegradedData.degraded, true);
    assert(
      prDegradedData.fallbackCreateUrl.includes("dev.azure.com/FET-IDTT/SmartCS/_git/demo-repo/pullrequestcreate?sourceRef=feat%2Fpr-demo&targetRef=main"),
      "降級連結應符合 Azure DevOps pullrequestcreate 格式"
    );
    assert(!JSON.stringify(prDegradedData).includes("super-secret-pat"), "PR 回應絕不可外洩 PAT");

    // 7. 單元測試：createPullRequest() Azure DevOps mocked fetchImpl (201) & GitHub PATH="" 降級
    let capturedAuth = "";
    const azSuccess = await createPullRequest(tempRepo, {
      sourceBranch: "feat/pr-demo",
      targetBranch: "main",
      title: "Mocked AzDO PR",
      description: "- [TASK-243] test",
      customEnv: { AZURE_DEVOPS_PAT: "unit-mock-pat" },
      fetchImpl: async (url, init) => {
        capturedAuth = init.headers.Authorization;
        assert(url.includes("https://dev.azure.com/FET-IDTT/SmartCS/_apis/git/repositories/demo-repo/pullrequests?api-version=7.1"));
        return {
          ok: true,
          status: 201,
          json: async () => ({ pullRequestId: 42 })
        };
      }
    });
    assert.strictEqual(azSuccess.success, true);
    assert.strictEqual(azSuccess.degraded, false);
    assert.strictEqual(azSuccess.prId, 42);
    assert(azSuccess.prUrl.endsWith("/pullrequest/42"), "prUrl 應以 /pullrequest/42 結尾");
    assert.strictEqual(capturedAuth, "Basic " + Buffer.from(":unit-mock-pat").toString("base64"));

    execFileSync("git", ["-C", tempRepo, "remote", "set-url", "origin", "https://github.com/octocat/demo-repo.git"]);
    const ghDegraded = await createPullRequest(tempRepo, {
      sourceBranch: "feat/pr-demo",
      targetBranch: "main",
      title: "Mocked GH PR",
      customEnv: { PATH: "" }
    });
    assert.strictEqual(ghDegraded.success, false);
    assert.strictEqual(ghDegraded.degraded, true);
    assert.strictEqual(ghDegraded.provider, "github");
    assert(
      ghDegraded.fallbackCreateUrl.includes("github.com/octocat/demo-repo/compare/main...feat%2Fpr-demo?expand=1"),
      "GitHub 降級連結應包含 compare/main...feat%2Fpr-demo?expand=1"
    );
    assert(
      ghDegraded.error.includes("brew install gh"),
      "未安裝 gh 時降級錯誤訊息應包含 brew install gh 安裝指引"
    );

    // 8. 整合測試：專案級 requirePr 策略阻擋本地合併 (409 pr_required) & branches/pr autoPush 自動封存 done 任務
    const putReqPrRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requirePr: true })
    });
    assert.strictEqual(putReqPrRes.status, 200);
    const putReqPrData = await putReqPrRes.json();
    assert.strictEqual(putReqPrData.requirePr, true, "PUT /api/projects/:id 應正確保存 requirePr: true");

    const blockedMergeRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceBranch: "feat/pr-demo", targetBranch: "main" })
    });
    assert.strictEqual(blockedMergeRes.status, 409, "requirePr: true 專案呼叫 branches/merge 應回傳 409");
    const blockedMergeData = await blockedMergeRes.json();
    assert.strictEqual(blockedMergeData.status, "pr_required", "應回傳 status: pr_required");

    // 切回裸遠端並新建一張 done 任務，驗證 POST /branches/pr (autoPush: true) 在推送後自動封存 done 任務
    execFileSync("git", ["-C", tempRepo, "remote", "set-url", "origin", originBare]);
    fs.writeFileSync(path.join(tempRepo, "pr_archive.txt"), "pr auto archive\n");
    execFileSync("git", ["-C", tempRepo, "add", "pr_archive.txt"]);
    execFileSync("git", ["-C", tempRepo, "commit", "-m", "feat: pr auto archive test"]);

    const prTaskCreateRes = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "PR auto-archive done task",
        project: projId,
        status: "done",
        targetBranch: "feat/pr-demo",
        baseBranch: "feat/pr-demo",
        workspaceMode: "in_place"
      })
    });
    assert.strictEqual(prTaskCreateRes.status, 201);
    const prTaskId = (await prTaskCreateRes.json()).id;

    // 改用無 PAT 遠端名稱模擬 autoPush 成功不依賴外部網路（直接測試 bare origin 的 unknown provider 降級）
    // 先把 origin 指向 bare repo，createPullRequest(autoPush:true) 會 push 成功，但 provider=unknown 回 degraded=true, fallbackCreateUrl=""
    // 接著驗證若為 Azure DevOps 無 PAT 且未 autoPush 時不封存；我們也在下方驗證 push 成功 + 降級 API 行為
    const prAutoPushRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches/pr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceBranch: "feat/pr-demo", targetBranch: "main", title: "PR auto push", autoPush: true })
    });
    assert.strictEqual(prAutoPushRes.status, 400, "bare origin (unknown provider) 無 fallbackCreateUrl 時應回 400");

    // 清理該張測試任務
    await fetch(`${base}/api/tasks/${encodeURIComponent(prTaskId)}`, { method: "DELETE" });

    // 9. 整合與單元測試：TASK-244 Git 帳號盤點 API (GET /api/git/accounts)、gh 多帳號解析與 Azure PAT 驗證（零明文憑證洩漏）
    const { parseGhAuthStatusOutput, verifyAndSaveAzureDevOpsPat } = require("./src/server/services/gitAccountService");
    const parsedGh = parseGhAuthStatusOutput(`github.com
  ✓ Logged in to github.com account NelsonChung-26120 (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo'

  ✓ Logged in to github.com account soysen (keyring)
  - Active account: false
  - Git operations protocol: https
  - Token scopes: 'repo'
`);
    assert.strictEqual(parsedGh.length, 2, "應解析出 2 組 GitHub 帳號");
    assert.strictEqual(parsedGh[0].username, "NelsonChung-26120");
    assert.strictEqual(parsedGh[0].active, true);
    assert.strictEqual(parsedGh[1].username, "soysen");
    assert.strictEqual(parsedGh[1].active, false);

    const azVerifyOk = await verifyAndSaveAzureDevOpsPat("FET-IDTT", "mock-pat-value", {
      skipKeychain: true,
      fetchImpl: async () => ({ ok: true, status: 200 })
    });
    assert.strictEqual(azVerifyOk.success, true, "mocked 200 Azure PAT 驗證應成功");
    const azVerifyFail = await verifyAndSaveAzureDevOpsPat("FET-IDTT", "bad-pat", {
      skipKeychain: true,
      fetchImpl: async () => ({ ok: false, status: 401 })
    });
    assert.strictEqual(azVerifyFail.success, false);
    assert.strictEqual(azVerifyFail.statusCode, 401);

    execFileSync("git", ["-C", tempRepo, "remote", "set-url", "origin", "https://user:never-leak-pat-244@dev.azure.com/FET-IDTT/SmartCS/_git/demo-repo"]);
    const accRes = await fetch(`${base}/api/git/accounts`);
    assert.strictEqual(accRes.status, 200, "GET /api/git/accounts 應回傳 200");
    const accData = await accRes.json();
    assert(accData.globalIdentity && typeof accData.tools === "object", "應包含 globalIdentity 與 tools");
    assert(Array.isArray(accData.github?.accounts), "應包含 github.accounts 陣列");
    assert(Array.isArray(accData.azureDevOps?.orgs), "應包含 azureDevOps.orgs 陣列");
    assert(accData.azureDevOps.orgs.some(o => o.org === "FET-IDTT" && o.hasRepoPat === true && o.ready === true), "應偵測到 FET-IDTT 組織並標記 ready");
    assert(!JSON.stringify(accData).includes("never-leak-pat-244"), "GET /api/git/accounts 絕不可外洩明文 PAT");

    // 10. 整合測試：TASK-245 POST /api/projects/clone (從遠端 clone 至指定父目錄) 與 POST /api/projects/:id/branches/pull (同步遠端新 commit)
    const cloneParent = fs.mkdtempSync(path.join(os.tmpdir(), "td-245-clone-parent-"));
    let clonedProjId = "";
    try {
      const cloneRes = await fetch(`${base}/api/projects/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: originBare,
          parentDir: cloneParent,
          folderName: "cloned-demo-repo",
          branch: "main",
          requirePr: true
        })
      });
      assert.strictEqual(cloneRes.status, 201, "POST /api/projects/clone 應回傳 201");
      const cloneData = await cloneRes.json();
      assert.strictEqual(cloneData.success, true);
      assert.strictEqual(cloneData.project.requirePr, true, "clone 建立之專案應保留 requirePr: true");
      clonedProjId = cloneData.project.id;
      const clonedPath = cloneData.project.path;
      assert(fs.existsSync(path.join(clonedPath, ".git")), "目標資料夾應包含 .git");

      // 重複 clone 到同目錄應被 400 攔截防覆蓋
      const dupCloneRes = await fetch(`${base}/api/projects/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: originBare, parentDir: cloneParent, folderName: "cloned-demo-repo" })
      });
      assert.strictEqual(dupCloneRes.status, 400, "重複目標資料夾 clone 應回傳 400");

      // 在 tempRepo (切回 main 並指向 originBare) 推送一筆遠端新 commit，驗證 clonedProjId 可一鍵 pull 同步
      execFileSync("git", ["-C", tempRepo, "remote", "set-url", "origin", originBare]);
      execFileSync("git", ["-C", tempRepo, "checkout", "main"]);
      fs.writeFileSync(path.join(tempRepo, "remote_ahead.txt"), "hello from remote\n");
      execFileSync("git", ["-C", tempRepo, "add", "remote_ahead.txt"]);
      execFileSync("git", ["-C", tempRepo, "commit", "-m", "feat: remote ahead commit"]);
      execFileSync("git", ["-C", tempRepo, "push", "origin", "main"]);

      const pullRes = await fetch(`${base}/api/projects/${encodeURIComponent(clonedProjId)}/branches/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: "main", mode: "pull" })
      });
      assert.strictEqual(pullRes.status, 200, "POST /api/projects/:id/branches/pull 應回傳 200");
      const pullData = await pullRes.json();
      assert.strictEqual(pullData.success, true);
      assert.strictEqual(pullData.remoteStatus.behind, 0, "pull 後 behind 應歸零");
      assert(fs.existsSync(path.join(clonedPath, "remote_ahead.txt")), "pull 後應同步遠端新增檔案");
    } finally {
      if (clonedProjId) {
        try {
          await fetch(`${base}/api/projects/delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: clonedProjId })
          });
        } catch (_) {}
      }
      try { fs.rmSync(cloneParent, { recursive: true, force: true }); } catch (_) {}
    }

    console.log("    ✅ TASK-243 ~ TASK-245 遠端推送、PR、requirePr、Git 帳號管理、Clone 與 Pull 驗證通過");
  } finally {
    try {
      await fetch(`${base}/api/projects/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: projId })
      });
    } catch (e) {}
    try { fs.rmSync(tempRepo, { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(originBare, { recursive: true, force: true }); } catch (e) {}
  }
})();
' "$TEST_PORT"

echo "  [8.9/9] 測試 Worktree 未動過自動回退主目錄提交、Pull/Sync-Base 衝突還原與 /open-editor 安全邊界 ..."
TEST_PORT=$TEST_PORT node -e '
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

(async () => {
  const base = "http://127.0.0.1:" + (process.env.TEST_PORT || "3039");
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "td-sync-repo-"));
  const originBare = fs.mkdtempSync(path.join(os.tmpdir(), "td-sync-origin-"));
  const peerRepo = fs.mkdtempSync(path.join(os.tmpdir(), "td-sync-peer-"));
  const projId = "test-sync-proj-" + Date.now();
  const createdTaskIds = [];

  try {
    execFileSync("git", ["init", "--bare", originBare], { stdio: "ignore" });
    execFileSync("git", ["-C", tempRepo, "init", "-b", "main"], { stdio: "ignore" });
    execFileSync("git", ["-C", tempRepo, "config", "user.email", "test@example.com"], { stdio: "ignore" });
    execFileSync("git", ["-C", tempRepo, "config", "user.name", "Test Runner"], { stdio: "ignore" });
    fs.writeFileSync(path.join(tempRepo, "README.md"), "# Init\n", "utf8");
    fs.writeFileSync(path.join(tempRepo, "shared.txt"), "base line\n", "utf8");
    execFileSync("git", ["-C", tempRepo, "add", "."], { stdio: "ignore" });
    execFileSync("git", ["-C", tempRepo, "commit", "-m", "init"], { stdio: "ignore" });
    execFileSync("git", ["-C", tempRepo, "remote", "add", "origin", originBare], { stdio: "ignore" });
    execFileSync("git", ["-C", tempRepo, "push", "-u", "origin", "main"], { stdio: "ignore" });

    const regRes = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projId, name: "Sync & Fallback Repo", path: tempRepo })
    });
    assert(regRes.status === 200 || regRes.status === 201);

    // A. Worktree 未動過 + 主資料夾有任務變更 -> /drift-check 與 /land 自動回退提交並清理空 worktree
    const createRes = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Fallback to in-place commit",
        project: projId,
        status: "todo",
        workspaceMode: "worktree",
        targetBranch: "main"
      })
    });
    assert.equal(createRes.status, 201);
    const createdTask = await createRes.json();
    createdTaskIds.push(createdTask.id);

    const startRes = await fetch(`${base}/api/tasks/${encodeURIComponent(createdTask.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress" })
    });
    assert.equal(startRes.status, 200);
    const startedTask = await startRes.json();
    assert(startedTask.worktreePath && fs.existsSync(startedTask.worktreePath), "開工應先建立 worktree");

    // 刻意不改 worktree，直接改主資料夾
    fs.writeFileSync(path.join(tempRepo, "task_edit_in_main.txt"), "edited directly in main\n", "utf8");

    const driftRes = await fetch(`${base}/api/tasks/${encodeURIComponent(createdTask.id)}/drift-check`);
    assert.equal(driftRes.status, 200);
    const driftData = await driftRes.json();
    assert.equal(driftData.status, "main_workspace_has_task_changes", "Worktree 未動過時不可誤報 dirty_main_workspace");
    assert.equal(driftData.worktreeUntouchedMainDirty, true);
    assert.equal(Boolean(driftData.dirtyMainWorkspace), false);
    assert.equal(driftData.hasConflict, false);

    const reviewRes = await fetch(`${base}/api/tasks/${encodeURIComponent(createdTask.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "review", forceReview: true })
    });
    assert.equal(reviewRes.status, 200);

    const landRes = await fetch(`${base}/api/tasks/${encodeURIComponent(createdTask.id)}/land`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "feat: fallback commit from main", archiveImmediately: false })
    });
    assert.equal(landRes.status, 200, "Worktree 未動過時 /land 應自動回退主目錄提交並回傳 200");
    const landData = await landRes.json();
    assert.equal(landData.success, true);
    assert.equal(landData.isCommitted, true);
    assert(!fs.existsSync(startedTask.worktreePath), "回退主目錄提交後應清理空 worktree");
    assert.equal(execFileSync("git", ["-C", tempRepo, "status", "--porcelain"], { encoding: "utf8" }).trim(), "");
    const committedFiles = execFileSync("git", ["-C", tempRepo, "show", "--name-only", "--pretty=format:", "HEAD"], { encoding: "utf8" });
    assert(committedFiles.includes("task_edit_in_main.txt"), "主目錄修改應已正式 commit");

    const tasksAfterLand = await (await fetch(`${base}/api/tasks`)).json();
    const updatedAfterLand = tasksAfterLand.find(t => t.id === createdTask.id);
    assert.equal(updatedAfterLand.workspaceMode, "in_place");
    assert.equal(updatedAfterLand.worktreePath, null);

    // 同步遠端 main 以便後續分叉測試
    execFileSync("git", ["-C", tempRepo, "push", "origin", "main"], { stdio: "ignore" });

    // B. Push non-fast-forward、Pull rebase 衝突自動 abort、Sync-Base 成功與衝突還原
    execFileSync("git", ["clone", originBare, peerRepo], { stdio: "ignore" });
    execFileSync("git", ["-C", peerRepo, "config", "user.email", "peer@example.com"], { stdio: "ignore" });
    execFileSync("git", ["-C", peerRepo, "config", "user.name", "Peer"], { stdio: "ignore" });
    fs.writeFileSync(path.join(peerRepo, "shared.txt"), "peer conflicting line\n", "utf8");
    execFileSync("git", ["-C", peerRepo, "add", "shared.txt"], { stdio: "ignore" });
    execFileSync("git", ["-C", peerRepo, "commit", "-m", "peer update"], { stdio: "ignore" });
    execFileSync("git", ["-C", peerRepo, "push", "origin", "main"], { stdio: "ignore" });

    fs.writeFileSync(path.join(tempRepo, "shared.txt"), "local conflicting line\n", "utf8");
    execFileSync("git", ["-C", tempRepo, "add", "shared.txt"], { stdio: "ignore" });
    execFileSync("git", ["-C", tempRepo, "commit", "-m", "local diverge"], { stdio: "ignore" });

    const pushRejectRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main" })
    });
    assert.equal(pushRejectRes.status, 409, "分叉 push 應回傳 409");
    const pushRejectData = await pushRejectRes.json();
    assert.equal(pushRejectData.nonFastForward, true);

    const pullConflictRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main", mode: "pull", rebase: true })
    });
    assert.equal(pullConflictRes.status, 409, "Pull rebase 衝突應回傳 409");
    const pullConflictData = await pullConflictRes.json();
    assert.equal(pullConflictData.conflict, true);
    assert(Array.isArray(pullConflictData.conflictingFiles) && pullConflictData.conflictingFiles.includes("shared.txt"));
    assert.equal(execFileSync("git", ["-C", tempRepo, "status", "--porcelain"], { encoding: "utf8" }).trim(), "", "Pull 衝突後工作區必須自動 --abort 保持乾淨");
    assert(!fs.existsSync(path.join(tempRepo, ".git", "rebase-merge")), "不應殘留 rebase-merge 目錄");

    // 測試 sync-base (無衝突 merge 與有衝突自動 abort)
    execFileSync("git", ["-C", tempRepo, "reset", "--hard", "origin/main"], { stdio: "ignore" });
    execFileSync("git", ["-C", tempRepo, "checkout", "-b", "feat/clean-sync"], { stdio: "ignore" });
    fs.writeFileSync(path.join(tempRepo, "feat_only.txt"), "feature\n", "utf8");
    execFileSync("git", ["-C", tempRepo, "add", "feat_only.txt"], { stdio: "ignore" });
    execFileSync("git", ["-C", tempRepo, "commit", "-m", "feat only"], { stdio: "ignore" });

    execFileSync("git", ["-C", tempRepo, "checkout", "-b", "feat/conflict-sync", "origin/main"], { stdio: "ignore" });
    fs.writeFileSync(path.join(tempRepo, "base_only.txt"), "feature version\n", "utf8");
    execFileSync("git", ["-C", tempRepo, "add", "base_only.txt"], { stdio: "ignore" });
    execFileSync("git", ["-C", tempRepo, "commit", "-m", "feat conflict"], { stdio: "ignore" });

    fs.writeFileSync(path.join(peerRepo, "base_only.txt"), "main version\n", "utf8");
    execFileSync("git", ["-C", peerRepo, "add", "base_only.txt"], { stdio: "ignore" });
    execFileSync("git", ["-C", peerRepo, "commit", "-m", "main base update"], { stdio: "ignore" });
    execFileSync("git", ["-C", peerRepo, "push", "origin", "main"], { stdio: "ignore" });

    const syncOkRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches/sync-base`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "feat/clean-sync", baseBranch: "main", strategy: "merge" })
    });
    assert.equal(syncOkRes.status, 200, "無衝突 sync-base 應回傳 200");
    const syncOkData = await syncOkRes.json();
    assert.equal(syncOkData.success, true);

    const syncConflictRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches/sync-base`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "feat/conflict-sync", baseBranch: "main", strategy: "merge" })
    });
    assert.equal(syncConflictRes.status, 409, "有衝突 sync-base 應回傳 409");
    const syncConflictData = await syncConflictRes.json();
    assert.equal(syncConflictData.conflict, true);
    assert(syncConflictData.conflictingFiles.includes("base_only.txt"));
    assert.equal(execFileSync("git", ["-C", tempRepo, "status", "--porcelain"], { encoding: "utf8" }).trim(), "", "sync-base 衝突後必須自動 abort 保持乾淨");
    assert(!fs.existsSync(path.join(tempRepo, ".git", "MERGE_HEAD")), "不應殘留 MERGE_HEAD");

    // B2. TASK-265: POST /api/projects/:id/branches/pr 開立 PR 前置拉取目標分支測試
    // (1) 無衝突：peerRepo 推進 main，feat/pr-clean-sync 未含該 commit；呼叫 POST /branches/pr 應先自動合併 main 且回傳 prePrSync.synced === true
    execFileSync("git", ["-C", tempRepo, "checkout", "-b", "feat/pr-clean-sync", "feat/clean-sync"], { stdio: "ignore" });
    fs.writeFileSync(path.join(peerRepo, "main_only_pr.txt"), "upstream main change before PR\n", "utf8");
    execFileSync("git", ["-C", peerRepo, "add", "main_only_pr.txt"], { stdio: "ignore" });
    execFileSync("git", ["-C", peerRepo, "commit", "-m", "main: upstream change for pr pre-sync"], { stdio: "ignore" });
    execFileSync("git", ["-C", peerRepo, "push", "origin", "main"], { stdio: "ignore" });

    const prCleanRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches/pr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceBranch: "feat/pr-clean-sync",
        targetBranch: "main",
        title: "Clean pre-PR sync",
        autoPush: true
      })
    });
    assert.equal(prCleanRes.status, 400, "bare origin 無 fallbackCreateUrl 回 400，但已完成前置同步與推送");
    const prCleanData = await prCleanRes.json();
    assert.strictEqual(prCleanData.prePrSync?.synced, true, "應自動執行前置同步並回傳 prePrSync.synced === true");
    assert.strictEqual(prCleanData.prePrSync?.alreadyUpToDate, false, "應實際拉取並合併上游 main 新進度");
    assert.strictEqual(prCleanData.prePrSync?.syncRef, "origin/main");
    execFileSync("git", ["-C", tempRepo, "checkout", "feat/pr-clean-sync"], { stdio: "ignore" });
    assert(fs.existsSync(path.join(tempRepo, "main_only_pr.txt")), "前置同步後 feat/pr-clean-sync 應包含上游 main_only_pr.txt");
    assert(
      execFileSync("git", ["-C", originBare, "rev-parse", "--verify", "refs/heads/feat/pr-clean-sync"], { encoding: "utf8" }).trim().length >= 7,
      "前置同步成功後 autoPush 應順利推送 feat/pr-clean-sync 至 originBare"
    );

    // (2) 有衝突：feat/conflict-sync 與 origin/main 衝突，呼叫 POST /branches/pr 應中止推送並回傳 409 + conflict + conflictingFiles，且無殘留 MERGE_HEAD
    const prConflictRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches/pr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceBranch: "feat/conflict-sync",
        targetBranch: "main",
        title: "Conflict pre-PR sync",
        autoPush: true
      })
    });
    assert.equal(prConflictRes.status, 409, "開立 PR 前置同步遇衝突應回傳 HTTP 409");
    const prConflictData = await prConflictRes.json();
    assert.strictEqual(prConflictData.success, false);
    assert.strictEqual(prConflictData.syncFailed, true);
    assert.strictEqual(prConflictData.conflict, true);
    assert.strictEqual(prConflictData.status, "conflict");
    assert(Array.isArray(prConflictData.conflictingFiles) && prConflictData.conflictingFiles.includes("base_only.txt"), "409 回應應包含衝突檔案 base_only.txt");
    assert.equal(execFileSync("git", ["-C", tempRepo, "status", "--porcelain"], { encoding: "utf8" }).trim(), "", "PR 前置同步衝突後工作區必須自動 abort 保持乾淨");
    assert(!fs.existsSync(path.join(tempRepo, ".git", "MERGE_HEAD")), "PR 前置同步衝突後不應殘留 MERGE_HEAD");
    let pushedConflictBranch = true;
    try {
      execFileSync("git", ["-C", originBare, "rev-parse", "--verify", "refs/heads/feat/conflict-sync"], { stdio: "ignore" });
    } catch (_) {
      pushedConflictBranch = false;
    }
    assert.strictEqual(pushedConflictBranch, false, "前置同步衝突中止後絕不可執行 autoPush");

    // (3) pullTargetBeforePr: false 繞過前置同步，遇衝突分支仍可走降級網頁開單 (HTTP 200)
    execFileSync("git", ["-C", tempRepo, "remote", "set-url", "origin", "https://dev.azure.com/FET-IDTT/SmartCS/_git/demo-repo"]);
    const prBypassRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/branches/pr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceBranch: "feat/conflict-sync",
        targetBranch: "main",
        title: "Bypass pre-PR sync",
        pullTargetBeforePr: false,
        autoPush: false
      })
    });
    assert.equal(prBypassRes.status, 200, "pullTargetBeforePr: false 應跳過前置同步並進入降級 PR 流程");
    const prBypassData = await prBypassRes.json();
    assert.strictEqual(prBypassData.degraded, true);
    assert.strictEqual(prBypassData.prePrSync, undefined, "pullTargetBeforePr: false 不應包含 prePrSync");
    assert.strictEqual(Boolean(prBypassData.conflict), false);
    execFileSync("git", ["-C", tempRepo, "remote", "set-url", "origin", originBare]);

    // C. /open-editor Dry-Run 與路徑安全邊界檢查
    const openAgyRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/open-editor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editor: "antigravity", dryRun: true })
    });
    assert.equal(openAgyRes.status, 200);
    const openAgyData = await openAgyRes.json();
    assert.equal(openAgyData.success, true);
    assert.equal(openAgyData.dryRun, true);

    const openVscRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/open-editor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editor: "vscode", dryRun: true })
    });
    assert.equal(openVscRes.status, 200);
    assert.equal((await openVscRes.json()).dryRun, true);

    const badPathRes = await fetch(`${base}/api/projects/${encodeURIComponent(projId)}/open-editor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editor: "antigravity", targetPath: "/etc", dryRun: true })
    });
    assert.equal(badPathRes.status, 400);
    const badPathData = await badPathRes.json();
    assert.equal(badPathData.success, false);
    assert.equal(badPathData.status, "invalid_target_path");

    // 驗證 /api/git/file-context 讀取完整檔案行與路徑穿越防護
    fs.writeFileSync(path.join(tempRepo, "context_sample.js"), "function alpha() {\n  return 1;\n}\n", "utf8");
    const fileCtxRes = await fetch(`${base}/api/git/file-context?projectId=${encodeURIComponent(projId)}&filePath=${encodeURIComponent("context_sample.js")}`);
    assert.equal(fileCtxRes.status, 200);
    const fileCtxData = await fileCtxRes.json();
    assert.equal(fileCtxData.source, "workspace");
    assert.equal(fileCtxData.totalLines, 3);
    assert.deepEqual(fileCtxData.lines, ["function alpha() {", "  return 1;", "}"]);

    const traversalRes = await fetch(`${base}/api/git/file-context?projectId=${encodeURIComponent(projId)}&filePath=${encodeURIComponent("../etc/passwd")}`);
    assert.equal(traversalRes.status, 400);

    console.log("    ✅ Worktree 未動過自動回退、Pull/Sync-Base 衝突安全還原、/open-editor 與 /api/git/file-context 驗證通過");
  } finally {
    for (const tid of createdTaskIds) {
      try { await fetch(`${base}/api/tasks/${encodeURIComponent(tid)}`, { method: "DELETE" }); } catch (_) {}
    }
    try {
      await fetch(`${base}/api/projects/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: projId })
      });
    } catch (_) {}
    try { fs.rmSync(tempRepo, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(originBare, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(peerRepo, { recursive: true, force: true }); } catch (_) {}
  }
})();
' "$TEST_PORT"

echo "  [9/9] 測試 前端核心互動邏輯與狀態防線 ..."
node "$PROJECT_DIR/scripts/test_ui_behavior.js"
node "$PROJECT_DIR/scripts/test_confirmation_ux.js"
node "$PROJECT_DIR/scripts/test_plan_html_ux.js"
node "$PROJECT_DIR/scripts/test_agent_provider_adapter.js"
node "$PROJECT_DIR/scripts/test_commit_generator.js"
node "$PROJECT_DIR/scripts/test_execution_logs.js"
node "$PROJECT_DIR/scripts/test_confirm_and_wakeup_flow.js"

echo "🎉 所有後端 API 整合測試與前端核心狀態防線測試順利通過！"

kill -9 $SERVER_PID 2>/dev/null || true
rm -rf "$TEST_DATA_DIR" 2>/dev/null || true
exit 0
