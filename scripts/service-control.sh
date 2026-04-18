#!/bin/bash
# Service control helper for xbar plugin
# Usage: service-control.sh [start|stop|restart]

PLIST="$HOME/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist"

case "$1" in
  start)
    launchctl load "$PLIST"
    ;;
  stop)
    launchctl unload "$PLIST"
    ;;
  restart)
    launchctl unload "$PLIST" 2>/dev/null
    sleep 1
    launchctl load "$PLIST"
    ;;
esac
