#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$DIR"

export PATH="$HOME/.nvm/versions/node/v20.18.3/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

NODE_BIN=$(which node 2>/dev/null)
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  if [ -x "$HOME/.nvm/versions/node/v20.18.3/bin/node" ]; then
    NODE_BIN="$HOME/.nvm/versions/node/v20.18.3/bin/node"
  elif [ -x "/opt/homebrew/bin/node" ]; then
    NODE_BIN="/opt/homebrew/bin/node"
  elif [ -x "/usr/local/bin/node" ]; then
    NODE_BIN="/usr/local/bin/node"
  else
    NODE_BIN="node"
  fi
fi

PID=$(lsof -ti:3030 2>/dev/null)
if [ -z "$PID" ]; then
  nohup "$NODE_BIN" "$DIR/src/server/server.js" >> "$DIR/server.log" 2>&1 &
  for i in {1..20}; do
    PID=$(lsof -ti:3030 2>/dev/null)
    if [ ! -z "$PID" ]; then
      break
    fi
    sleep 0.2
  done
fi

open "http://localhost:3030" 2>/dev/null || true
exit 0
