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

PORT=$TEST_PORT TASK_DASHBOARD_DATA_DIR="$TEST_DATA_DIR" node "$PROJECT_DIR/src/server/server.js" > "/tmp/server_test.log" 2>&1 &
SERVER_PID=$!

cleanup() {
  kill -9 $SERVER_PID 2>/dev/null || true
  rm -rf "$TEST_DATA_DIR" 2>/dev/null || true
}
trap cleanup EXIT

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

echo "  [5/5] 測試 POST /api/tasks (建立任務) 與 generate-commit ..."
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

echo "🎉 所有 API 整合測試順利通過！"
