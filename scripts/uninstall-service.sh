#!/bin/bash
set -e

PLIST_NAME="com.agenticledger.channelToAgentToClaude"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"

echo "Uninstalling channelToAgentToClaude service..."

if [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm "$PLIST_PATH"
  echo "Service removed."
else
  echo "Service plist not found at $PLIST_PATH — nothing to uninstall."
fi
