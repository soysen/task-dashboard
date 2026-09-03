#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"
APP_DIR="$DIST_DIR/TaskDashboard.app"

echo "🚀 開始建置 Task Dashboard 原生 macOS App..."

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# 1. 編譯 Cocoa / WebKit 原生執行檔
echo "🔨 編譯 Objective-C 原生外殼..."
clang -fobjc-arc -framework Cocoa -framework WebKit \
      -o "$APP_DIR/Contents/MacOS/TaskDashboard" \
      "$PROJECT_DIR/src/native/main.m"

# 2. 複製 App 圖示與備用 Web 資源
if [ -f "$PROJECT_DIR/assets/icon.icns" ]; then
  cp "$PROJECT_DIR/assets/icon.icns" "$APP_DIR/Contents/Resources/icon.icns"
fi

mkdir -p "$APP_DIR/Contents/Resources/web"
cp -R "$PROJECT_DIR/src" "$APP_DIR/Contents/Resources/web/"
if [ -d "$PROJECT_DIR/scripts" ]; then
  cp -R "$PROJECT_DIR/scripts" "$APP_DIR/Contents/Resources/web/"
fi
if [ -d "$PROJECT_DIR/data" ]; then
  cp -R "$PROJECT_DIR/data" "$APP_DIR/Contents/Resources/web/"
fi
cp "$PROJECT_DIR/package.json" "$APP_DIR/Contents/Resources/web/"

# 3. 建立 Info.plist
cat << 'PLIST_EOF' > "$APP_DIR/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>TaskDashboard</string>
    <key>CFBundleIconFile</key>
    <string>icon.icns</string>
    <key>CFBundleIdentifier</key>
    <string>com.antigravity.taskdashboard</string>
    <key>CFBundleName</key>
    <string>TaskDashboard</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>2.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST_EOF

echo "✅ 打包完成！獨立 App 路徑: $APP_DIR"
