# channelToAgentToClaude — Architecture

## What This Is

A gateway that lets you communicate with Claude Code sessions from your phone via Slack, iMessage, Telegram, Discord, and WhatsApp. Each "agent" is a persistent Claude Code session with a defined purpose, scoped tools, MCPs, and skills — accessed by @mentioning an alias in a chat.

Everything runs as a single Node.js process on your Mac, managed by launchd.

## How It Works

```
Phone → Slack/iMessage/Telegram/Discord → internet → your Mac (gateway) → claude -p → response → back to phone
```

1. You send a message from your phone (e.g., `@agentmgr what's in my Bobby project?`)
2. The gateway service running on your Mac detects the message
3. The router checks pairing (if enabled), then matches channel + chat ID + @mention alias to an agent
4. The executor spawns `claude -p` with the agent's system prompt, workspace, MCPs, and tools
5. Long responses are automatically chunked to fit channel limits
6. The response is sent back to the originating channel
7. The process exits, but the **session persists** — next message resumes where you left off

## Channels

| Channel | Library | Auth | How it connects |
|---------|---------|------|-----------------|
| **Slack** | @slack/socket-mode | Bot + App tokens | Outbound WebSocket (no public URL needed) |
| **Telegram** | grammY | Bot token from @BotFather | Long polling (no public URL needed) |
| **iMessage** | imsg CLI | Local macOS access | Watches Messages database via JSON-RPC subprocess |
| **Discord** | discord.js | Bot token | Outbound WebSocket (no public URL needed) |
| **WhatsApp** | @whiskeysockets/baileys | QR code pairing | WhatsApp Web protocol (unofficial) |

All channels connect outbound from your Mac — no inbound ports need to be exposed to the internet.

## Agents = Scoped Sessions

An agent is not a different AI. It's the **same Claude** with different guardrails per session:

| What the agent defines | Example |
|------------------------|---------|
| **Purpose** (system prompt) | "You manage the financeiscooked show content" |
| **Workspace** (file access) | `~/Desktop/APPs/financeiscooked` |
| **MCPs** (API integrations) | financeiscooked platform API, context7 |
| **Tools** (what Claude can do) | Read, Edit, Write, Bash — or read-only |
| **Skills** (indexed instructions) | opcodereview, sop_pdf, etc. |
| **Session** (conversation memory) | Persistent UUID-based session with full history |

Multiple agents can share the same Slack channel, Telegram group, or iMessage thread — they're differentiated by their @mention alias (e.g., `@producer` vs `@oldproducer` vs `@agentmgr`).

## Session Persistence

Agents can be **persistent** or **single-shot**:

### Persistent (`"persistent": true`)
- First message generates a UUID and creates a Claude Code session via `--session-id`
- Every subsequent message resumes the session via `--resume <uuid>`
- Claude maintains full conversation history — it remembers everything you've discussed
- Session state stored by Claude Code in `~/.claude/projects/` (not configurable)
- A pointer (UUID) stored in the agent's `memory/session.json`
- Claude Code handles context compression automatically as sessions grow

### Per-Sender Sessions (`"perSenderSessions": true`)
- Each sender gets their own isolated session file (`session-<senderId>.json`)
- Useful when multiple people talk to the same agent — each gets a private conversation thread
- Requires `persistent: true` to have any effect

### Single-shot (`"persistent": false`, the default)
- Every message is a fresh Claude invocation
- Last 5 messages from `conversation_log.jsonl` injected as text context
- No session continuity beyond that

### Session Lifecycle Commands
- **`/opcompact <what to save>`** — Tell the agent to save important information to `context.md`. This context survives session resets and is injected into the system prompt of new sessions.
- **`/opreset`** — Clear the session. Deletes session file, next message starts fresh. The agent's identity (CLAUDE.md) and saved context (context.md) remain.

## Skills

Skills are markdown instruction files in `~/.claude/commands/`. In an interactive terminal session, Claude loads these via the `Skill` tool. Since `claude -p` doesn't have the `Skill` tool, the gateway uses a workaround:

1. A **skill index** (name + description + file path) is appended to the agent's system prompt
2. The skills directory is added via `--add-dir ~/.claude/commands/`
3. When a task matches a skill, the agent uses the `Read` tool to load the full skill file and follows its instructions

Configure per agent: `"skills": ["opcodereview", "sop_pdf", "opAgents_AddNew"]`

## MCPs (Model Context Protocol)

MCP servers are registered once in the top-level `mcps` block of `config.json`, then referenced by name in each agent's config. The gateway:

1. Reads the agent's MCP list
2. Generates a temporary `.mcp.json` file with the server configs
3. Passes `--mcp-config <path> --strict-mcp-config` to `claude -p`
4. Adds `mcp__<name>__*` to the allowed tools list
5. Cleans up the temp file after execution

Since everything runs locally on your Mac, stdio MCPs (local processes like context7, playwright) and HTTP/SSE MCPs (remote servers like granola) both work.

## Features

### Response Chunking
Long responses are automatically split to fit channel limits:
- Slack: 3900 chars
- Telegram: 4096 chars
- iMessage: 3000 chars
- Discord: 2000 chars

Splits prefer newline boundaries to avoid breaking mid-sentence.

### Typing Indicators
When a message is being processed:
- **Telegram**: Sends native `typing` chat action
- **Discord**: Sends native typing indicator
- **Slack/iMessage**: Sends "On it..." text message (no native bot typing API)

### DM Pairing / Approval Codes
Optional security gate for new senders. Set in config:
```json
"service": {
  "pairingCode": "mysecretcode"
}
```
First-time senders must send the pairing code before agents will respond to them. Paired senders are persisted in `data/paired-senders.json`. If `pairingCode` is not set, all senders are allowed (controlled by route-level `allowFrom`).

### Cron / Scheduled Messages
Agents can receive scheduled messages on a cron schedule:
```json
"cron": [
  {
    "schedule": "0 9 * * 1-5",
    "message": "Give me a status update on the current episode",
    "channel": "slack",
    "chatId": "C0AFJMHKZDG"
  }
]
```
Uses standard cron expressions. The agent processes the message and replies on the specified channel.

### Web Control UI
A JSON API dashboard running on localhost:
- `GET http://localhost:8080/` — Overview: all agents, message counts, session status, uptime
- `GET http://localhost:8080/agents/:id` — Agent detail with last 20 messages
- `GET http://localhost:8080/health` — Health check

Configure in service config:
```json
"webUI": {
  "enabled": true,
  "port": 8080,
  "webhookSecret": "yoursecret"
}
```

### Webhook Triggers
External services can trigger agents via HTTP:
```bash
curl -X POST http://localhost:8080/webhook/claudeManager \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: yoursecret" \
  -d '{"text": "PR #42 was merged, update the tracker"}'
```
The agent processes the message and replies on its first configured route (or specify `channel` and `chatId` in the body to override).

Useful for: GitHub webhooks, CI/CD notifications, Railway deploy hooks, scheduled external triggers.

### Voice Note Transcription
Telegram voice messages and audio files are automatically transcribed via the OpenAI Whisper API and processed as text messages.

Requires `OPENAI_API_KEY` environment variable. If not set, voice messages are silently ignored.

The transcribed text is prefixed with `[Voice message transcription]:` so the agent knows the input was spoken, not typed.

### Media Output (File Sending)
All channel drivers support sending files back to the user:
- **Telegram**: Photos sent as photos, other files as documents
- **Slack**: Files uploaded via Slack API
- **Discord**: Files sent as message attachments

This enables agents with Playwright (screenshots), PDF skills, or file generation to send results directly in chat.

## Infrastructure

**Everything runs on your Mac as a single Node.js process.**

| Component | Where | Port | Notes |
|-----------|-------|------|-------|
| Gateway service | launchd | — | Main process: starts channels, router, executor |
| Slack connection | Outbound WSS | — | Socket Mode to Slack servers |
| Telegram connection | Outbound HTTPS | — | Long polling to Telegram API |
| iMessage watcher | Local subprocess | — | `imsg` CLI watches Messages.db |
| Discord connection | Outbound WSS | — | discord.js gateway |
| WhatsApp connection | Outbound WSS | — | Baileys protocol |
| Web UI + Webhooks | localhost | 8080 | Express server (not exposed to internet) |
| Cron scheduler | In-memory | — | node-cron timers |
| `claude -p` | Spawned per message | — | Claude Code CLI in print mode |
| MCP servers | Spawned per message | — | stdio subprocesses or HTTP calls |

**Your Mac must be on and awake** for agents to be reachable. If it sleeps or shuts down, Slack messages queue (processed on restart), Telegram messages queue (processed on restart), but iMessage messages may be missed.

## File Structure

```
channelToAgentToClaude/           # The gateway project
├── config.json                   # Channels, MCPs, agents, routes, web UI, cron
├── src/
│   ├── index.ts                  # Entry point — wires everything together
│   ├── config.ts                 # Config loader + validation + interfaces
│   ├── router.ts                 # Routes messages + DM pairing
│   ├── executor.ts               # Spawns claude -p, sessions, skills, commands
│   ├── web-ui.ts                 # Express server: dashboard + webhooks
│   ├── cron.ts                   # Scheduled message triggers
│   ├── channels/
│   │   ├── types.ts              # ChannelDriver interface + splitText utility
│   │   ├── imessage.ts           # iMessage driver (imsg CLI)
│   │   ├── slack.ts              # Slack driver (Socket Mode)
│   │   ├── telegram.ts           # Telegram driver (grammY + voice transcription)
│   │   ├── discord.ts            # Discord driver (discord.js)
│   │   └── whatsapp.ts           # WhatsApp driver (Baileys)
│   └── utils/
│       ├── imsg-rpc.ts           # JSON-RPC client for imsg
│       └── message-formatter.ts  # Message formatting with context + history
├── agents/                       # Agent identity files (project-scoped agents)
│   ├── _template/
│   ├── fic-show/
│   └── fic-platform/
├── data/
│   ├── whatsapp-auth/            # WhatsApp session credentials
│   └── paired-senders.json       # DM pairing store
├── docs/
│   ├── Architecture.md           # This file
│   ├── AddNewAgentGuide.md
│   └── AddNewMcpGuide.md
└── logs/
    └── service.log

~/Desktop/personalAgents/         # Agent homes (personal agents)
└── claudeManager/
    ├── CLAUDE.md                 # System prompt
    └── memory/
        ├── context.md            # Persistent context (survives resets)
        ├── session.json          # Session UUID pointer
        └── conversation_log.jsonl # Audit trail
```

## Config Reference

### Service
```json
"service": {
  "logLevel": "debug",
  "logFile": "./logs/service.log",
  "pairingCode": "optional-secret",
  "webUI": {
    "enabled": true,
    "port": 8080,
    "webhookSecret": "optional-secret"
  }
}
```

### Channel (example: Telegram)
```json
"telegram": {
  "enabled": true,
  "driver": "telegram",
  "config": {
    "botToken": "123:ABC..."
  }
}
```

### MCP Registry
```json
"mcps": {
  "context7": { "type": "stdio", "command": "npx", "args": ["-y", "@upstash/context7-mcp"] },
  "granola": { "type": "sse", "url": "https://mcp.granola.ai/mcp" }
}
```

### Agent
```json
"claudeManager": {
  "name": "Claude Manager Agent",
  "description": "General-purpose Claude agent",
  "workspace": "~",
  "claudeMd": "~/Desktop/personalAgents/claudeManager/CLAUDE.md",
  "memoryDir": "~/Desktop/personalAgents/claudeManager/memory",
  "mcps": ["context7", "playwright", "granola"],
  "persistent": true,
  "perSenderSessions": false,
  "skills": ["opcodereview", "sop_pdf"],
  "mentionAliases": ["@agentmgr"],
  "autoCommit": false,
  "allowedTools": ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"],
  "timeout": 120000,
  "cron": [
    {
      "schedule": "0 9 * * 1-5",
      "message": "Good morning. Any tasks pending?",
      "channel": "telegram",
      "chatId": "-5274444946"
    }
  ],
  "routes": [
    {
      "channel": "telegram",
      "match": { "type": "chat_id", "value": "-5274444946" },
      "permissions": { "allowFrom": ["*"], "requireMention": true }
    }
  ]
}
```

## Adding a New Agent

Use the `/opAgents_AddNew` skill, which walks through:
1. Gathering agent info (name, alias, workspace, MCPs, tools, routes)
2. Creating the folder structure
3. Writing the system prompt
4. Updating config.json
5. Rebuilding and restarting

Or see `docs/AddNewAgentGuide.md` for manual steps.

## Running

```bash
npm run build          # Compile TypeScript
npm start              # Run directly
npm run dev            # Dev mode with auto-reload
```

### As a launchd service (auto-start on login)
```bash
# Start
launchctl load ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist

# Stop
launchctl unload ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist

# Restart
launchctl unload ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist && \
sleep 1 && \
launchctl load ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist
```

## Current Agents

| Agent | Alias | Purpose | Persistent | Channels |
|-------|-------|---------|------------|----------|
| fic-show | `@oldproducer` | Manages financeiscooked show content, auto-commits to git | No | Slack, iMessage, Telegram |
| fic-platform | `@producer` | Manages the platform via MCP API tools | No | Slack, iMessage, Telegram |
| claudeManager | `@agentmgr` | General-purpose Claude with full tools + skills | Yes | Slack, iMessage, Telegram |
