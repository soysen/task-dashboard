#!/bin/bash
echo "🛑 關閉 Task Dashboard 伺服器 (Port 3030)..."
lsof -ti:3030 | xargs kill -9 2>/dev/null || true
pkill -f 'src/server/server.js' 2>/dev/null || true
echo "✅ 伺服器已停止"
