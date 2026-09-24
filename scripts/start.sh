#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

find_working_node() {
  if command -v node &>/dev/null && node -v &>/dev/null; then
    command -v node
    return 0
  fi
  for cand in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.local/bin/node"; do
    if [ -x "$cand" ] && "$cand" -v &>/dev/null; then
      echo "$cand"
      return 0
    fi
  done
  if [ -d "$HOME/.nvm/versions/node" ]; then
    for cand in $(ls -rd "$HOME/.nvm/versions/node"/*/bin/node 2>/dev/null); do
      if [ -x "$cand" ] && "$cand" -v &>/dev/null; then
        echo "$cand"
        return 0
      fi
    done
  fi
  echo "node"
}

NODE_BIN=$(find_working_node)

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
