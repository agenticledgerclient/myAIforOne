#!/bin/bash
# MyAIforOne menu bar indicator for macOS (xbar plugin)
# Install: brew install --cask xbar
# Copy:    cp scripts/xbar-myagent.5s.sh "$HOME/Library/Application Support/xbar/plugins/"
# The .5s suffix means xbar refreshes every 5 seconds.

CTRL="$HOME/Desktop/APPs/channelToAgentToClaude/scripts/service-control.sh"
HEALTH=$(curl -s --max-time 2 http://localhost:4888/health 2>/dev/null)

if echo "$HEALTH" | grep -q "ok"; then
  echo "🟢 | size=13"
else
  echo "🔴 | size=13"
fi

echo "---"

echo "Open MyAIforOne | href=http://localhost:4888/ui"
echo "---"

if echo "$HEALTH" | grep -q "ok"; then
  echo "Restart Service | bash=$CTRL param1=restart terminal=false refresh=true"
  echo "Stop Service | bash=$CTRL param1=stop terminal=false refresh=true"
else
  echo "Start Service | bash=$CTRL param1=start terminal=false refresh=true"
fi

echo "---"

# Start on Login toggle
if launchctl list 2>/dev/null | grep -q agenticledger; then
  echo "Start on Login ✓ | bash=$CTRL param1=stop terminal=false refresh=true"
else
  echo "Start on Login | bash=$CTRL param1=start terminal=false refresh=true"
fi
