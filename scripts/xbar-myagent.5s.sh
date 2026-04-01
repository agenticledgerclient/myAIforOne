#!/bin/bash
# MyAgent menu bar status indicator for macOS (xbar plugin)
# Install: brew install --cask xbar
# Copy:    cp scripts/xbar-myagent.5s.sh "$HOME/Library/Application Support/xbar/plugins/"
# The .5s suffix means xbar refreshes every 5 seconds.

PID=$(launchctl list 2>/dev/null | grep agenticledger | awk '{print $1}')
if [ -n "$PID" ] && [ "$PID" != "-" ]; then
  DATA=$(curl -s --max-time 2 http://localhost:4888/api/dashboard 2>/dev/null)
  AGENTS=$(echo "$DATA" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('agents',[])))" 2>/dev/null)
  UPTIME=$(echo "$DATA" | python3 -c "import sys,json; u=int(json.load(sys.stdin).get('uptime',0)); h=u//3600; m=(u%3600)//60; print(f'{h}h {m}m' if h else f'{m}m')" 2>/dev/null)
  echo "🟢 ${AGENTS:-?} | size=13"
else
  echo "🔴 Down | size=13"
fi
echo "---"
echo "MyAgent Gateway | size=14 color=white"
echo "---"
if [ -n "$PID" ] && [ "$PID" != "-" ]; then
  echo "Status: Running (PID $PID) | color=green"
  echo "Agents: ${AGENTS:-?} | color=white"
  echo "Uptime: ${UPTIME:-?} | color=#888888"
  echo "---"
  echo "Open Web UI | href=http://localhost:4888/ui"
  echo "Open Org Chart | href=http://localhost:4888/org"
  echo "Open Tasks | href=http://localhost:4888/tasks"
  echo "Open Channels | href=http://localhost:4888/channels"
  echo "---"
  echo "Restart Service | bash=/bin/bash param1=-c param2='launchctl unload ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist 2>/dev/null; launchctl load ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist' terminal=false refresh=true"
  echo "Stop Service | bash=/bin/bash param1=-c param2='launchctl unload ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist' terminal=false refresh=true"
else
  echo "Status: Stopped | color=red"
  echo "---"
  echo "Start Service | bash=/bin/bash param1=-c param2='launchctl load ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist' terminal=false refresh=true"
fi
