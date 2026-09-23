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

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill -9 "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEST_DATA_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for i in {1..10}; do
  if curl -s "http://localhost:$TEST_PORT/api/settings" > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# 測試 API 響應
echo "  [1/5] 測試 GET /api/tasks ..."
curl -s -f "http://localhost:$TEST_PORT/api/tasks" > /dev/null
echo "    ✅ /api/tasks 正常"

echo "  [2/5] 測試 GET /api/projects ..."
curl -s -f "http://localhost:$TEST_PORT/api/projects" > /dev/null
echo "    ✅ /api/projects 正常"

echo "  [3/5] 測試 GET /api/settings ..."
curl -s -f "http://localhost:$TEST_PORT/api/settings" > /dev/null
echo "    ✅ /api/settings 正常"

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

echo "  [7/7] 測試 多任務 agent-status 與切片隔離單元測試 ..."
node -e '
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseAgentStatusContent, parseBuildPlanContent, scanProjectWorklogAndPlan, syncProjectWorklogOnReview } = require("./src/server/server.js");

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
fs.rmSync(tempProj2, { recursive: true, force: true });

console.log("    ✅ agent-status 與 build-plan 多任務 taskId 隔離、done 保護及 review 完成回寫測試通過！");
'

echo "🎉 所有 API 整合測試與隔離單元測試順利通過！"

kill -9 $SERVER_PID 2>/dev/null || true
rm -rf "$TEST_DATA_DIR" 2>/dev/null || true
exit 0
