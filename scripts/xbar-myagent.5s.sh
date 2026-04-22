#!/bin/bash
# MyAIforOne menu bar indicator for macOS (xbar plugin)
# Install: brew install --cask xbar
# Copy:    cp scripts/xbar-myagent.5s.sh "$HOME/Library/Application Support/xbar/plugins/"
# The .5s suffix means xbar refreshes every 5 seconds.

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

CTRL="$HOME/Desktop/APPs/channelToAgentToClaude/scripts/service-control.sh"
HEALTH=$(/usr/bin/curl -s --max-time 2 http://localhost:4888/health 2>/dev/null)

if echo "$HEALTH" | /usr/bin/grep -q '"ok":true'; then
  echo "🟢 | size=13"
else
  echo "🔴 | size=13"
fi

echo "---"

echo "Open MyAIforOne | href=http://localhost:4888/ui"
echo "---"

if echo "$HEALTH" | /usr/bin/grep -q '"ok":true'; then
  echo "Restart Service | bash=$CTRL param1=restart terminal=false refresh=true"
  echo "Stop Service | bash=$CTRL param1=stop terminal=false refresh=true"
else
  echo "Start Service | bash=$CTRL param1=start terminal=false refresh=true"
fi

echo "---"

# Start on Login toggle
PLIST="$HOME/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist"
if launchctl list 2>/dev/null | /usr/bin/grep -q "com.agenticledger.channelToAgentToClaude"; then
  echo "Start on Login ✓ | bash=/bin/bash param1=-c param2='launchctl unload \"$PLIST\"' terminal=false refresh=true"
else
  echo "Start on Login | bash=/bin/bash param1=-c param2='launchctl load \"$PLIST\"' terminal=false refresh=true"
fi
