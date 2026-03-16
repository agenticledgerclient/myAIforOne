# MyAgent — Architecture

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
5. For streaming agents, real-time status updates and text stream back via SSE
6. Long responses are automatically chunked to fit channel limits
7. The response is sent back to the originating channel
8. The process exits, but the **session persists** — next message resumes where you left off

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
| **Streaming** (real-time output) | Tool status updates + live text in Web UI |
| **Org** (team structure) | Organization, department, title, reporting chain |

Multiple agents can share the same Slack channel, Telegram group, or iMessage thread — they're differentiated by their @mention alias (e.g., `@producer` vs `@oldproducer` vs `@agentmgr`).

### Sticky Routing

After you @mention an agent, follow-up messages without a mention automatically route to the same agent for 5 minutes. This lets you have a natural conversation without typing the alias every message.

- `@bobby check the build` → routes to bobby, starts 5-min timer
- "what about the tests?" → still bobby (within 5 min)
- "looks good" → still bobby
- (5 minutes of silence) → timer expires, next message needs a mention

Each sender has their own sticky — Alice talking to `@bobby` doesn't affect Bob's messages.

Configure per channel:
```json
"telegram": {
  "config": {
    "stickyRouting": true,
    "stickyTimeoutMs": 300000
  }
}
```

Defaults: `stickyRouting: true`, `stickyTimeoutMs: 300000` (5 min). Set `stickyRouting: false` to require @mention on every message.

## Session Persistence

Agents can be **persistent**, **streaming**, or **single-shot**:

### Persistent (`"persistent": true`)
- First message generates a UUID and creates a Claude Code session via `--session-id`
- Every subsequent message resumes the session via `--resume <uuid>`
- Claude maintains full conversation history — it remembers everything you've discussed
- Session state stored by Claude Code in `~/.claude/projects/` (not configurable)
- A pointer (UUID) stored in the agent's `memory/session.json`
- Claude Code handles context compression automatically as sessions grow

### Streaming (`"streaming": true`)
- Uses `--output-format stream-json --verbose` to get real-time output
- **Web UI**: Streams text live via SSE as Claude writes. Shows tool status ("Using Read...", "Using Bash...") in the thinking indicator
- **Phone channels**: Sends typing indicators while processing. Final response sent when done
- Session management works the same as persistent (sessions are maintained)
- If `persistent` is also true, sessions resume across messages with streaming output

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

## Advanced Memory

When `"advancedMemory": true` is set on an agent, it gets a semantic long-term memory system that goes beyond basic session persistence and `context.md`. This is the recommended default for general-purpose agents.

### How It Differs from Basic Memory

| Feature | Basic (persistent session) | Advanced Memory |
|---------|---------------------------|-----------------|
| **Short-term** | Claude session history | Same — session history |
| **Long-term** | Manual `/opcompact` → `context.md` | Automatic daily journals + semantic recall |
| **Recall** | Full `context.md` injected every time | Relevant memories retrieved by similarity search |
| **Scaling** | `context.md` grows until you edit it | Old entries auto-compact; vector search stays fast |

### Daily Memory

Memories are stored as markdown files in `memory/daily/YYYY-MM-DD.md` inside the agent's memory directory. Each day gets its own file with timestamped entries.

At the start of every conversation turn, the system automatically loads **today's** and **yesterday's** daily files as immediate context, so the agent always knows what happened recently.

### Semantic Search

When the agent needs to recall something older than yesterday, it searches the memory store using a **hybrid retrieval** strategy:

1. **Cosine similarity** — vector dot-product against stored embeddings
2. **BM25 keyword scoring** — term-frequency weighting for exact-match recall
3. **Temporal decay** — recent memories get a relevance boost over older ones

The three scores are combined into a single ranking. Top results are injected into the prompt as recalled context.

### Embedding Providers

- **OpenAI** (default when `OPENAI_API_KEY` is set) — uses `text-embedding-3-small` for high-quality vectors
- **TF-IDF fallback** — if no OpenAI key is available, a local TF-IDF vectorizer generates embeddings with no external calls

### Vector Store

- **JSON** (default) — stores embeddings in a JSON file in the memory directory. Zero dependencies.
- **SQLite** (auto-upgrade) — when the JSON store grows past a threshold, it automatically migrates to SQLite for faster lookups.

### Auto-Compaction

To prevent unbounded context growth, advanced memory monitors conversation length:

- **Warning at 20 messages** — the agent is nudged to summarize and save important context to daily memory
- **Forced compaction at 40 messages** — the system automatically triggers a compaction, writing a summary to daily memory and resetting the conversation

### Config Flag

Enable on any agent:
```json
"advancedMemory": true
```

No additional configuration needed. The embedding provider and vector store are auto-detected based on available environment variables and data size.

## Organization & Team Structure

Agents can be placed in an organizational hierarchy for the Org Chart dashboard:

```json
"org": [
  { "organization": "Finance Is Cooked", "function": "Content Production", "title": "Show Producer", "reportsTo": "@agentmgr" },
  { "organization": "Personal", "function": "Operations", "title": "General Manager" }
]
```

- **organization** — Which org this agent belongs to (agents can be in multiple orgs)
- **function** — Department/team label (shown as a tag on the agent card)
- **title** — Role title (shown above the agent name)
- **reportsTo** — Alias of the agent this one reports to (drives the hierarchy tree)

The Org Chart page (`/org`) visualizes this:
- Dropdown to select an organization
- Tree hierarchy driven by `reportsTo` — agents without a `reportsTo` sit at the top
- Department shown as a purple tag on each card
- Heartbeat animation on active agents (green ❤ pulsing top-right)
- "All Agents" view groups agents by organization with section headers
- Click any agent to Chat or view Config

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

## Web UI — MyAgent

Two pages served by the built-in Express server:

### Chat Page (`/ui`)
- Left sidebar: agent cards with org/department filter dropdowns
- Right panel: live chat with any agent
- Streaming agents show real-time text + tool status as Claude works
- Non-streaming agents show "Thinking..." then full response
- Session reset button for persistent agents
- Dashboard link to org page

### Org Chart Page (`/org`)
- Organization dropdown to filter by org
- Tree hierarchy visualization driven by `reportsTo`
- Animated connector lines between hierarchy levels (flowing cyan pulse)
- Agent cards show title, name, alias, department tag, message count
- Heartbeat ❤ animation on active agents
- "All Agents" view groups by organization with section headers
- **+ New Agent** button opens create form
- **Config** button opens edit modal (same form, pre-filled)
- Create/edit modals with: name, alias, workspace, persistent/streaming toggles, tool pills, MCP pills, org entries (with datalist autocomplete), routes with @mention toggle
- Light/dark mode toggle (respects system preference)

### API Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ui` | GET | Chat page |
| `/org` | GET | Org chart page |
| `/api/dashboard` | GET | All agents, channels, status, uptime |
| `/api/agents/:id` | GET | Agent detail + last 50 messages |
| `/api/agents` | POST | Create new agent (form data) |
| `/api/agents/:id` | PUT | Update existing agent |
| `/api/chat/:id` | POST | Send message, get response |
| `/api/chat/:id/stream` | POST | Send message, get SSE stream |
| `/api/mcps` | GET | List registered MCPs |
| `/webhook/:id` | POST | External webhook trigger |
| `/health` | GET | Health check |

## Features

### Response Chunking
Long responses automatically split to fit channel limits:
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
First-time senders must send the pairing code before agents respond. Paired senders persisted in `data/paired-senders.json`.

### Cron / Scheduled Messages
Agents can receive scheduled messages:
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

### Autonomous Goals

Agents with `"autonomousCapable": true` can be assigned goals — ongoing responsibilities that the agent checks on a recurring heartbeat schedule, with optional budget limits and channel reporting.

#### The `autonomousCapable` Flag

Set on the agent config to indicate whether this agent can accept goal assignments:
```json
"autonomousCapable": true
```

When `false`, the Goals tab in the Org UI is still visible but serves as documentation only — no heartbeats will fire.

#### Goal Config Fields

Each goal in the `goals` array has:

| Field | Required | Description |
|-------|----------|-------------|
| `id` | YES | Kebab-case identifier, auto-generated from description (editable) |
| `enabled` | YES | Whether the goal is active (`true`/`false`) |
| `description` | YES | What the agent is responsible for |
| `successCriteria` | no | How to determine the goal is complete |
| `instructions` | no | Step-by-step guidance for the agent |
| `heartbeat` | YES | Cron expression for check-in frequency |
| `budget` | no | `{ "maxDailyUsd": 5.00 }` — max daily spend |
| `reportTo` | no | `"channel:chatId"` — where to send results (e.g., `"telegram:-5274444946"`) |

Example:
```json
"goals": [
  {
    "id": "monitor-deploy-health",
    "enabled": true,
    "description": "Monitor production deployment health",
    "successCriteria": "All services returning 200 on health checks",
    "instructions": "1. Check /health on each service\n2. If any fail, report immediately\n3. If all pass, log success silently",
    "heartbeat": "0 9 * * 1-5",
    "budget": { "maxDailyUsd": 2.00 },
    "reportTo": "slack:C0AFJMHKZDG"
  }
]
```

#### Heartbeat System

The `heartbeat` field uses the same cron expression format as scheduled messages. The Org UI provides a human-friendly picker (Every Day/Weekday/Week/Hour at HH:MM AM/PM) that converts to cron syntax.

When a heartbeat fires, the agent receives the goal description + instructions as a message and processes it like any other task. Results are sent to the `reportTo` channel if configured.

#### Budget Tracking

When `budget.maxDailyUsd` is set, the agent tracks spending in `agentHome/goals/budget/`. If the daily limit is reached, the goal pauses until the next day. Budget files are stored per-goal per-day.

#### Channel Reporting

The `reportTo` field follows the format `"channel:chatId"` (e.g., `"telegram:-5274444946"` or `"slack:C0AFJMHKZDG"`). When set, goal execution results are sent to that channel/chat instead of (or in addition to) the agent's default routes.

#### Three States

An autonomous-capable agent with goals can be in one of three states:

| State | Condition | Behavior |
|-------|-----------|----------|
| **Not Capable** | `autonomousCapable: false` | Goals are config-only, no heartbeats fire |
| **Idle** | `autonomousCapable: true`, no enabled goals | Agent responds to messages only, no autonomous activity |
| **Active** | `autonomousCapable: true`, 1+ enabled goals | Agent responds to messages AND executes goals on heartbeat schedules |

### Webhook Triggers
External services can trigger agents via HTTP:
```bash
curl -X POST http://localhost:4888/webhook/claudeManager \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: yoursecret" \
  -d '{"text": "PR #42 was merged, update the tracker"}'
```

### Voice Note Transcription
Telegram voice messages and audio files automatically transcribed via OpenAI Whisper API. Requires `OPENAI_API_KEY` environment variable. If not set, voice messages are silently ignored.

### Media Output (File Sending)
All channel drivers support sending files back:
- **Telegram**: Photos as photos, other files as documents
- **Slack**: Files uploaded via Slack API
- **Discord**: Files as message attachments

## Infrastructure

**Everything runs on your Mac as a single Node.js process.**

| Component | Where | Port | Notes |
|-----------|-------|------|-------|
| Gateway service | launchd | — | Main process: channels, router, executor |
| Slack connection | Outbound WSS | — | Socket Mode to Slack servers |
| Telegram connection | Outbound HTTPS | — | Long polling to Telegram API |
| iMessage watcher | Local subprocess | — | `imsg` CLI watches Messages.db |
| Discord connection | Outbound WSS | — | discord.js gateway |
| WhatsApp connection | Outbound WSS | — | Baileys protocol |
| Web UI + API + Webhooks | localhost | 4888 | Express server (not exposed to internet) |
| Cron scheduler | In-memory | — | node-cron timers |
| `claude -p` | Spawned per message | — | Claude Code CLI in print mode |
| MCP servers | Spawned per message | — | stdio subprocesses or HTTP calls |

**Your Mac must be on and awake** for agents to be reachable.

## File Structure

```
channelToAgentToClaude/           # The gateway project
├── config.json                   # Channels, MCPs, agents, routes, web UI, cron (gitignored)
├── config.example.json           # Template for new installs
├── src/
│   ├── index.ts                  # Entry point — wires everything together
│   ├── config.ts                 # Config loader + validation + interfaces
│   ├── router.ts                 # Routes messages + DM pairing
│   ├── executor.ts               # Spawns claude -p, sessions, streaming, skills, commands
│   ├── web-ui.ts                 # Express server: UI pages, API, chat, webhooks
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
├── public/
│   ├── index.html                # Chat UI page
│   └── org.html                  # Org chart page
├── agents/                       # Agent identity files (project-scoped agents)
│   ├── _template/
│   ├── fic-show/
│   └── fic-platform/
├── Comprehensive Test Suite/     # 7 test files, 43 tests
│   ├── run-all-tests.js
│   ├── config/
│   ├── router/
│   ├── executor/
│   ├── web-ui/
│   ├── cron/
│   ├── types/
│   └── message-formatter/
├── data/
│   ├── whatsapp-auth/            # WhatsApp session credentials
│   └── paired-senders.json       # DM pairing store
├── docs/
│   ├── Architecture.md           # This file
│   ├── Setup.md                  # Setup guide for new installs
│   ├── AddNewAgentGuide.md
│   └── AddNewMcpGuide.md
└── logs/
    └── service.log

~/Desktop/personalAgents/         # Agent homes (personal agents)
└── claudeManager/
    ├── CLAUDE.md                 # System prompt
    ├── memory/
    │   ├── context.md            # Persistent context (survives resets)
    │   ├── session.json          # Session UUID pointer
    │   └── conversation_log.jsonl # Audit trail
    └── goals/                    # Budget tracking and goal execution logs
        ├── budget/               # Daily budget usage per goal
        └── logs/                 # Execution logs from goal heartbeats
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
    "port": 4888,
    "webhookSecret": "optional-secret"
  }
}
```

### Channels
```json
"telegram": {
  "enabled": true,
  "driver": "telegram",
  "config": { "botToken": "123:ABC..." }
},
"slack": {
  "enabled": true,
  "driver": "slack",
  "config": { "botToken": "xoxb-...", "appToken": "xapp-...", "mode": "socket" }
},
"discord": {
  "enabled": false,
  "driver": "discord",
  "config": { "botToken": "..." }
},
"imessage": {
  "enabled": true,
  "driver": "imessage",
  "config": { "cliPath": "imsg", "debounceMs": 2000 }
},
"whatsapp": {
  "enabled": false,
  "driver": "whatsapp",
  "config": { "authDir": "./data/whatsapp-auth" }
}
```

### MCP Registry
```json
"mcps": {
  "context7": { "type": "stdio", "command": "npx", "args": ["-y", "@upstash/context7-mcp"] },
  "playwright": { "type": "stdio", "command": "npx", "args": ["@playwright/mcp@latest"] },
  "granola": { "type": "sse", "url": "https://mcp.granola.ai/mcp" }
}
```

### Agent (full example)
```json
"claudeManager": {
  "name": "Claude Manager Agent",
  "description": "General-purpose Claude agent",
  "workspace": "~",
  "claudeMd": "~/Desktop/personalAgents/claudeManager/CLAUDE.md",
  "memoryDir": "~/Desktop/personalAgents/claudeManager/memory",
  "mcps": ["context7", "playwright", "granola"],
  "persistent": true,
  "streaming": true,
  "advancedMemory": true,
  "perSenderSessions": false,
  "skills": ["opcodereview", "sop_pdf"],
  "mentionAliases": ["@agentmgr"],
  "autoCommit": false,
  "allowedTools": ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"],
  "timeout": 120000,
  "org": [
    { "organization": "Finance Is Cooked", "function": "Operations", "title": "Chief of Staff" },
    { "organization": "Personal", "function": "Operations", "title": "General Manager" }
  ],
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

Three ways:

1. **Web UI**: Go to `/org` → click **"+ New Agent"** → fill out the form
2. **Chat**: Message `@agentmgr` with "create a new agent" (uses the `/opAgents_AddNew` skill)
3. **Manual**: See `docs/AddNewAgentGuide.md` or `docs/Setup.md`

## Running

```bash
npm run build          # Compile TypeScript
npm start              # Run directly
npm run dev            # Dev mode with auto-reload
npm test               # Run test suite (43 tests)
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

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Language** | TypeScript 5.7 |
| **Runtime** | Node.js 22+ |
| **iMessage** | `imsg` CLI (JSON-RPC) |
| **Slack** | @slack/socket-mode, @slack/web-api |
| **Telegram** | grammY |
| **Discord** | discord.js |
| **WhatsApp** | @whiskeysockets/baileys |
| **Web UI** | Express + vanilla HTML/CSS/JS (no framework) |
| **Voice** | OpenAI Whisper API |
| **Scheduling** | node-cron |
| **AI Engine** | `claude -p` (Claude Code CLI) |
| **Service** | launchd (macOS native) |
| **Tests** | Node.js built-in test runner |
