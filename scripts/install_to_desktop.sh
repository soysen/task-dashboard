#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DESKTOP_DIR="$HOME/Desktop"

echo "📦 執行建置並安裝至桌面..."
bash "$PROJECT_DIR/scripts/build_app.sh"

echo "🚚 複製 TaskDashboard.app 至 $DESKTOP_DIR ..."
rm -rf "$DESKTOP_DIR/TaskDashboard.app"
cp -R "$PROJECT_DIR/dist/TaskDashboard.app" "$DESKTOP_DIR/"

echo "🎉 安裝完成！桌面應用程式已更新為 ~/projects/task-dashboard 最新版本。"
