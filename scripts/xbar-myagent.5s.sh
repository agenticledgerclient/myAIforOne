#!/bin/bash
# MyAIforOne menu bar indicator for macOS (xbar plugin)
# Install: brew install --cask xbar
# Copy:    cp scripts/xbar-myagent.5s.sh "$HOME/Library/Application Support/xbar/plugins/"
# The .5s suffix means xbar refreshes every 5 seconds.

PLIST="$HOME/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist"
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
  echo "Restart Service | bash=/bin/bash param1=-c param2='launchctl unload \"$PLIST\" 2>/dev/null; sleep 1; launchctl load \"$PLIST\"' terminal=false refresh=true"
  echo "Stop Service | bash=/bin/bash param1=-c param2='launchctl unload \"$PLIST\"' terminal=false refresh=true"
else
  echo "Start Service | bash=/bin/bash param1=-c param2='launchctl load \"$PLIST\"' terminal=false refresh=true"
fi

echo "---"

# Start on Login toggle
if launchctl list 2>/dev/null | grep -q agenticledger; then
  echo "Start on Login ✓ | bash=/bin/bash param1=-c param2='launchctl unload \"$PLIST\"' terminal=false refresh=true"
else
  echo "Start on Login | bash=/bin/bash param1=-c param2='launchctl load \"$PLIST\"' terminal=false refresh=true"
fi
