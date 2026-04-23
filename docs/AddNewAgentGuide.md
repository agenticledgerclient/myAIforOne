# Adding a New Agent

## 1. Create the agent directory

```bash
cp -r agents/_template agents/my-agent
```

This gives you:
```
agents/my-agent/
  CLAUDE.md        # System prompt — the agent's personality and instructions
  agent.json       # Metadata (id, name, description)
  memory/          # Conversation logs and context (auto-managed)
```

## 2. Write the agent's system prompt

Edit `agents/my-agent/CLAUDE.md` with:
- What the agent does
- What tools/MCPs it has access to
- Response style (keep short for text message channels)
- Any rules or guardrails

## 3. Add the agent to `config.json`

```json
"agents": {
  "my-agent": {
    "name": "My Agent",
    "description": "What this agent does",
    "workspace": "~/path/to/project",
    "claudeMd": "./agents/my-agent/CLAUDE.md",
    "memoryDir": "./agents/my-agent/memory",
    "mentionAliases": ["@myagent"],
    "autoCommit": false,
    "allowedTools": ["Read", "Glob", "Grep"],
    "routes": [
      {
        "channel": "imessage",
        "match": { "type": "chat_id", "value": 67 },
        "permissions": {
          "allowFrom": ["*"],
          "requireMention": true
        }
      },
      {
        "channel": "slack",
        "match": { "type": "channel_id", "value": "YOUR_CHANNEL_ID" },
        "permissions": {
          "allowFrom": ["*"],
          "requireMention": true
        }
      }
    ]
  }
}
```

### Key fields

| Field | Description |
|-------|-------------|
| `workspace` | Directory where `claude -p` runs. The agent can read/edit files here. |
| `claudeMd` | Path to the agent's system prompt (relative to project root). |
| `memoryDir` | Where conversation logs are stored (relative to project root). |
| `mentionAliases` | How users invoke this agent in group chats (e.g. `@myagent`). |
| `autoCommit` | If `true`, auto-commits and pushes any workspace changes after each response. |
| `allowedTools` | Claude Code tools the agent can use. Add MCPs separately (see below). |
| `mcps` | Optional. Array of MCP server names from the top-level `mcps` registry. See [AddNewMcpGuide.md](./AddNewMcpGuide.md). |
| `executor` | Optional. Override the platform default executor for this agent: `"claude"` (default) or `"ollama:<model>"` (e.g. `"ollama:gemma2"`). Requires `multiModelEnabled: true` in service config. |
| `boardEnabled` | Optional. Set `true` to let this agent's output appear as a widget on boards. Good for agents with periodic outputs (briefings, monitoring, reports). |
| `boardLayout` | Optional. Default widget size when added to a board: `"small"`, `"medium"` (default), or `"large"`. |
| `routes` | Which channels + chat IDs this agent listens on. Multiple agents can share a channel if they have different `mentionAliases`. |

### Route matching

The router checks agents in config order. For each agent:
1. Channel must match
2. Chat ID must match
3. If `requireMention: true`, message must contain one of the agent's `mentionAliases`

Multiple agents can share the same channel + chat ID — they're differentiated by mention alias.

## 4. Rebuild and restart

```bash
npm run build
launchctl unload ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist
launchctl load ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist
```

## 5. Discover chat IDs

```bash
# iMessage
imsg chats --limit 20 --json

# Slack — check channel ID in Slack UI (right-click channel → View channel details → bottom)

# WhatsApp — enable whatsapp, send a message, check logs for JID
```
