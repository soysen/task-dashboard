#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
echo "🔍 執行 Task Dashboard Harness 診斷與規範檢核..."

# 1. 檢查檔案完整性
echo "  [1/5] 檢查關鍵架構檔案..."
FILES=(
  "package.json"
  "AGENTS.md"
  "HARNESS.md"
  "README.md"
  "src/native/main.m"
  "src/server/server.js"
  "src/public/index.html"
  "data/tasks.json"
  "data/projects.json"
  "data/settings.json"
  "scripts/build_app.sh"
  "scripts/install_to_desktop.sh"
)

for f in "${FILES[@]}"; do
  if [ ! -f "$PROJECT_DIR/$f" ]; then
    echo "❌ 缺少必要檔案: $f"
    exit 1
  fi
done
echo "    ✅ 所有核心架構檔案齊全"

# 2. 檢查 JSON 語法正確性
echo "  [2/5] 驗證 JSON 資料格式..."
node -e 'JSON.parse(require("fs").readFileSync("package.json"))'
node -e 'JSON.parse(require("fs").readFileSync("data/tasks.json"))'
node -e 'JSON.parse(require("fs").readFileSync("data/projects.json"))'
node -e 'JSON.parse(require("fs").readFileSync("data/settings.json"))'
echo "    ✅ 所有 JSON 設定與資料庫格式正常"

# 3. 檢查編譯工具鏈
echo "  [3/5] 檢查 macOS 編譯工具鏈..."
if ! command -v clang &> /dev/null; then
  echo "❌ 找不到 clang 編譯器"
  exit 1
fi
echo "    ✅ clang $(clang --version | head -n 1)"

# 4. 檢查 Node.js 執行環境
echo "  [4/5] 檢查 Node.js 環境..."
if ! command -v node &> /dev/null; then
  echo "❌ 找不到 node"
  exit 1
fi
echo "    ✅ node $(node --version)"

# 5. 驗證 tasks.json 的 Diff 完整性與合規門禁
echo "  [5/5] 檢驗 Task Diff 完整性與 3-Phase Gate 合規度..."
node -e '
const fs = require("fs");
const path = require("path");
const os = require("os");
const appSupportFile = path.join(os.homedir(), "Library/Application Support/TaskDashboard/tasks.json");
const tasksFile = fs.existsSync(appSupportFile) ? appSupportFile : "data/tasks.json";
const tasks = JSON.parse(fs.readFileSync(tasksFile, "utf8"));
for (const task of tasks) {
  if ((task.status === "review" || task.status === "done") && Array.isArray(task.modifiedFiles) && task.modifiedFiles.length > 0) {
    if (!task.diff || task.diff.includes("\n...\n") || task.diff.trim() === "...") {
      console.error(`❌ 任務 ${task.id} (${task.title}) 之 diff 內容不完整或含有截斷預設占位符！`);
      process.exit(1);
    }
  }
}
'
echo "    ✅ 所有已交付與審查中任務之 git diff 均符合全量完整度規範"

echo "🎉 Harness Check 通過！專案處於健康且合規狀態。"
