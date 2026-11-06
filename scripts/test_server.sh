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

echo "  [3/5] 測試 GET /api/settings ..."
curl -s -f "http://localhost:$TEST_PORT/api/settings" > /dev/null
echo "    ✅ /api/settings 正常"

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
if [ -n "$TASK_ID" ]; then
  # 測試 GET /api/tasks/:id/git-status
  GIT_STATUS_RES=$(curl -s -f "http://localhost:$TEST_PORT/api/tasks/$TASK_ID/git-status")
  if echo "$GIT_STATUS_RES" | grep -q '"taskId"'; then
    echo "    ✅ /api/tasks/:id/git-status 查詢正常"
  else
    echo "    ❌ /api/tasks/:id/git-status 異常: $GIT_STATUS_RES"
    exit 1
  fi

  # 測試 POST /api/tasks/:id/abandon
  ABANDON_RES=$(curl -s -f -X POST "http://localhost:$TEST_PORT/api/tasks/$TASK_ID/abandon" -H "Content-Type: application/json" -d '{"discardChanges":false,"reason":"測試放棄"}')
  if echo "$ABANDON_RES" | grep -q '"abandoned"'; then
    echo "    ✅ /api/tasks/:id/abandon 放棄任務成功"
  else
    echo "    ❌ /api/tasks/:id/abandon 失敗: $ABANDON_RES"
    exit 1
  fi

  # 測試 DELETE /api/tasks/:id
  DELETE_RES=$(curl -s -f -X DELETE "http://localhost:$TEST_PORT/api/tasks/$TASK_ID" -H "Content-Type: application/json" -d '{"discardChanges":false}')
  if echo "$DELETE_RES" | grep -q '"deleted"'; then
    echo "    ✅ DELETE /api/tasks/:id 刪除任務成功"
  else
    echo "    ❌ DELETE /api/tasks/:id 失敗: $DELETE_RES"
    exit 1
  fi

  # 測試 DELETE /api/tasks/:id 帶有 discardChanges: true (包含 git add -N 與 untracked 檔案)
  DUMMY_DIR="/tmp/test-git-discard-repo-$$"
  mkdir -p "$DUMMY_DIR"
  git -C "$DUMMY_DIR" init > /dev/null 2>&1
  git -C "$DUMMY_DIR" commit --allow-empty -m "init" > /dev/null 2>&1
  echo "dummy" > "$DUMMY_DIR/file.txt"
  git -C "$DUMMY_DIR" add -N "$DUMMY_DIR/file.txt"
  echo "untracked" > "$DUMMY_DIR/untracked.txt"
  curl -s -f -X POST "http://localhost:$TEST_PORT/api/projects" -H "Content-Type: application/json" -d "{\"id\":\"test-discard-repo\",\"name\":\"test-discard-repo\",\"path\":\"$DUMMY_DIR\"}" > /dev/null 2>&1
  DISCARD_TASK=$(curl -s -f -X POST "http://localhost:$TEST_PORT/api/tasks" -H "Content-Type: application/json" -d "{\"title\":\"測試 discard\",\"project\":\"test-discard-repo\",\"status\":\"in_progress\"}")
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

echo "  [9/9] 測試 前端核心互動邏輯與狀態防線 ..."
node "$PROJECT_DIR/scripts/test_ui_behavior.js"
node "$PROJECT_DIR/scripts/test_confirmation_ux.js"
node "$PROJECT_DIR/scripts/test_plan_html_ux.js"
node "$PROJECT_DIR/scripts/test_execution_logs.js"

echo "🎉 所有後端 API 整合測試與前端核心狀態防線測試順利通過！"

kill -9 $SERVER_PID 2>/dev/null || true
rm -rf "$TEST_DATA_DIR" 2>/dev/null || true
exit 0
