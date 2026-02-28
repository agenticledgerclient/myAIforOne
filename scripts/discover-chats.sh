#!/bin/bash
echo "Discovering iMessage chats..."
imsg chats --limit 30 --json | python3 -c "
import json, sys
chats = json.load(sys.stdin)
for c in chats:
    name = c.get('display_name') or '(unnamed)'
    cid = c.get('chat_id', '?')
    participants = ', '.join(c.get('participants', []))
    print(f'  chat_id: {cid:>5}  name: {name:<30}  participants: {participants}')
"
