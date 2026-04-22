#!/bin/bash
# Service control helper for xbar plugin and CLI
# Usage: service-control.sh [start|stop|restart]

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

PROJECT_DIR="$HOME/Desktop/APPs/channelToAgentToClaude"
PLIST="$HOME/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist"
LOG_DIR="$PROJECT_DIR/logs"
PID_FILE="$LOG_DIR/service.pid"

is_running() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    return 0
  fi
  # Also check by port
  if lsof -i :4888 -sTCP:LISTEN >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

do_stop() {
  # Try launchctl first
  launchctl unload "$PLIST" 2>/dev/null
  # Kill by PID file
  if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null
    rm -f "$PID_FILE"
  fi
  # Kill by port as fallback
  lsof -ti :4888 | xargs kill 2>/dev/null
}

do_start() {
  if is_running; then
    return 0
  fi
  mkdir -p "$LOG_DIR"
  # Try launchctl first
  if launchctl load "$PLIST" 2>/dev/null; then
    sleep 2
    if is_running; then
      return 0
    fi
    launchctl unload "$PLIST" 2>/dev/null
  fi
  # Fallback: start directly
  cd "$PROJECT_DIR"
  nohup /opt/homebrew/bin/node dist/index.js \
    >> "$LOG_DIR/launchd-stdout.log" \
    2>> "$LOG_DIR/launchd-stderr.log" &
  echo $! > "$PID_FILE"
}

case "$1" in
  start)
    do_start
    ;;
  stop)
    do_stop
    ;;
  restart)
    do_stop
    sleep 1
    do_start
    ;;
esac
