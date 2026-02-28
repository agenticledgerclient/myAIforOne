#!/bin/bash
CHAT_ID=${1:?"Usage: test-send.sh <chat_id> [message]"}
MESSAGE=${2:-"Hello from channelToAgentToClaude"}
imsg send --chat-id "$CHAT_ID" --text "$MESSAGE"
echo "Sent to chat_id=$CHAT_ID"
