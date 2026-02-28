#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLIST_NAME="com.agenticledger.channelToAgentToClaude"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
NODE_PATH="$(which node)"

echo "Installing channelToAgentToClaude as launchd service..."
echo "  Project: $PROJECT_DIR"
echo "  Node: $NODE_PATH"
echo "  Plist: $PLIST_PATH"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${PROJECT_DIR}/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${PROJECT_DIR}/logs/launchd-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${PROJECT_DIR}/logs/launchd-stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
PLIST

echo "Loading service..."
launchctl load "$PLIST_PATH"
echo "Done! Service installed and running."
echo ""
echo "Check status:  launchctl list | grep channelToAgentToClaude"
echo "View logs:     tail -f ${PROJECT_DIR}/logs/launchd-stdout.log"
echo "Stop:          launchctl unload ${PLIST_PATH}"
