# channelToAgentToClaude — Build Specification

> A personal agent gateway that routes messages from phone channels (iMessage, Slack, WhatsApp) to project-specific Claude Code agents on your Mac.

**Read `CONVERSATION_HISTORY.md` first** for the full design journey and architectural decisions.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Folder Structure](#3-folder-structure)
4. [Configuration Schema](#4-configuration-schema)
5. [Component Specifications](#5-component-specifications)
6. [Channel Drivers](#6-channel-drivers)
7. [Agent Execution](#7-agent-execution)
8. [Setup & Installation](#8-setup--installation)
9. [First Agent: FIC Show Agent](#9-first-agent-fic-show-agent)
10. [Future Channels: Slack & WhatsApp](#10-future-channels-slack--whatsapp)
11. [Reference: OpenClaw Patterns](#11-reference-openclaw-patterns)
12. [Testing & Validation](#12-testing--validation)

---

## 1. Overview

### What This Is

A lightweight macOS service (~300-500 lines) that:
1. Watches messaging channels (starting with iMessage via `imsg` CLI)
2. Routes incoming messages to project-specific agents based on chat ID
3. Executes tasks via `claude -p` (Claude Code CLI) in the agent's workspace
4. Sends replies back through the originating channel

### What This Is NOT

- Not a fork of OpenClaw
- Not a general-purpose chatbot framework
- Not a hosted service — runs locally on your Mac

### Core Principles

- **Agent-centric:** Each project has an agent with its own identity, skills, memory, workspace
- **Channel-fungible:** Same agent reachable from iMessage, Slack, WhatsApp — channels are pluggable
- **Simple:** `imsg` for the hard part (macOS Messages bridge), `claude -p` for the brain, thin glue in between
- **Owned:** Your code, your repo, no external framework dependencies

---

## 2. Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────┐
│  Your iPhone / Devices                              │
│  ┌──────────────┐ ┌────────────┐ ┌───────────────┐ │
│  │ iMessage     │ │ Slack      │ │ WhatsApp      │ │
│  │ Group: FIC   │ │ #fic-plan  │ │ FIC Group     │ │
│  └──────┬───────┘ └─────┬──────┘ └──────┬────────┘ │
└─────────┼───────────────┼───────────────┼───────────┘
          │               │               │
          ▼               ▼               ▼
┌─────────────────────────────────────────────────────┐
│  Mac (always-on service: channelToAgentToClaude)    │
│                                                     │
│  ┌─────────────────────────────────┐                │
│  │  Channel Drivers                │                │
│  │  ┌─────────┐ ┌─────┐ ┌───────┐ │                │
│  │  │ iMessage│ │Slack│ │WhatsApp│ │                │
│  │  │ (imsg)  │ │     │ │       │ │                │
│  │  └────┬────┘ └──┬──┘ └───┬───┘ │                │
│  └───────┼─────────┼────────┼─────┘                │
│          │         │        │                       │
│          ▼         ▼        ▼                       │
│  ┌─────────────────────────────────┐                │
│  │  Router                         │                │
│  │  (channel + chatId → agentId)   │                │
│  └──────────────┬──────────────────┘                │
│                 │                                   │
│                 ▼                                   │
│  ┌─────────────────────────────────┐                │
│  │  Agent Executor                 │                │
│  │  claude -p --cwd /workspace     │                │
│  │  --systemPrompt agent.CLAUDE.md │                │
│  └──────────────┬──────────────────┘                │
│                 │                                   │
│                 ▼                                   │
│  ┌─────────────────────────────────┐                │
│  │  Reply Dispatcher               │                │
│  │  Sends response back via        │                │
│  │  originating channel driver     │                │
│  └─────────────────────────────────┘                │
└─────────────────────────────────────────────────────┘
```

### Data Flow (Single Message)

```
1. iMessage arrives in group chat
2. imsg CLI detects it (JSON-RPC watch.subscribe notification)
3. Channel driver extracts: sender, text, chatId, isGroup, participants
4. Router matches chatId → agent config
5. Agent executor builds context:
   - System prompt from agent's CLAUDE.md
   - Memory context from agent's memory/
   - Message formatted with sender, group info, history
6. Spawns: claude -p "$FORMATTED_MESSAGE" --cwd $WORKSPACE
7. Captures claude output
8. Reply dispatcher sends response back via imsg send
9. Logs message + response to agent's memory/conversation_log.jsonl
```

---

## 3. Folder Structure

All paths below are relative to **wherever you clone this repo on your Mac** (e.g., `~/channelToAgentToClaude`).

```
channelToAgentToClaude/
├── README.md                          ← Quick start guide
├── BUILD_SPEC.md                      ← This document
├── CONVERSATION_HISTORY.md            ← Design journey
├── package.json                       ← Node.js project config
├── tsconfig.json                      ← TypeScript config
│
├── src/                               ← Service source code
│   ├── index.ts                       ← Entry point — starts service
│   ├── config.ts                      ← Load & validate config
│   ├── router.ts                      ← Route messages to agents
│   ├── executor.ts                    ← Spawn claude -p for agent
│   ├── logger.ts                      ← Logging utilities
│   │
│   ├── channels/                      ← Channel driver abstraction
│   │   ├── types.ts                   ← ChannelDriver interface
│   │   ├── imessage.ts                ← iMessage driver (via imsg CLI)
│   │   ├── slack.ts                   ← Slack driver (future)
│   │   └── whatsapp.ts               ← WhatsApp driver (future)
│   │
│   └── utils/                         ← Shared utilities
│       ├── imsg-rpc.ts                ← JSON-RPC client for imsg
│       └── message-formatter.ts       ← Format inbound messages for Claude
│
├── config.json                        ← Main config (agents, routes, channels)
│
├── agents/                            ← Agent definitions (one dir per agent)
│   ├── fic-show/                      ← Finance Is Cooked show agent
│   │   ├── CLAUDE.md                  ← Agent identity + rules
│   │   ├── memory/                    ← Persistent memory across conversations
│   │   │   ├── context.md             ← Running context file
│   │   │   └── conversation_log.jsonl ← Message history (append-only)
│   │   └── agent.json                 ← Agent metadata (name, workspace, etc.)
│   │
│   └── _template/                     ← Template for creating new agents
│       ├── CLAUDE.md
│       ├── memory/
│       │   └── .gitkeep
│       └── agent.json
│
└── scripts/                           ← Helper scripts
    ├── discover-chats.sh              ← Run imsg chats --json, pretty print
    ├── test-send.sh                   ← Test sending a message via imsg
    ├── install-service.sh             ← Install as launchd service
    └── uninstall-service.sh           ← Remove launchd service
```

---

## 4. Configuration Schema

### `config.json` — Main Configuration

```jsonc
{
  // Global settings
  "service": {
    "logLevel": "info",                // "debug" | "info" | "warn" | "error"
    "logFile": "./logs/service.log"    // Optional file logging
  },

  // Channel configurations
  "channels": {
    "imessage": {
      "enabled": true,
      "driver": "imessage",
      "config": {
        "cliPath": "imsg",             // Path to imsg binary (default: "imsg")
        "includeAttachments": false,   // Whether to process media
        "debounceMs": 2000             // Coalesce rapid messages (ms)
      }
    },
    "slack": {
      "enabled": false,                // Future: enable when ready
      "driver": "slack",
      "config": {
        "botToken": "",                // xoxb-...
        "appToken": "",                // xapp-...
        "mode": "socket"               // "socket" | "webhook"
      }
    },
    "whatsapp": {
      "enabled": false,                // Future: enable when ready
      "driver": "whatsapp",
      "config": {}
    }
  },

  // Agent definitions
  "agents": {
    "fic-show": {
      "name": "FIC Show Agent",
      "description": "Manages episode content for Finance Is Cooked YouTube show",
      "workspace": "~/repos/financeiscooked-soundboard",
      "claudeMd": "./agents/fic-show/CLAUDE.md",
      "memoryDir": "./agents/fic-show/memory",
      "skills": ["update-episode"],    // Skills available in the workspace
      "autoCommit": true,              // Auto git add/commit/push after changes
      "autoCommitBranch": "main",      // Branch to push to
      "allowedTools": [                // Claude Code tool restrictions
        "Read", "Edit", "Write",
        "Glob", "Grep", "Bash"
      ],

      // Routes: which channels/chats reach this agent
      "routes": [
        {
          "channel": "imessage",
          "match": {
            "type": "chat_id",         // "chat_id" | "chat_guid" | "chat_identifier"
            "value": 42                // Discovered via: imsg chats --json
          },
          "permissions": {
            "allowFrom": ["*"],        // "*" = anyone in the group, or list phone numbers
            "requireMention": false    // If true, agent only responds when @mentioned
          }
        }
        // Future routes:
        // { "channel": "slack", "match": { "type": "channel_id", "value": "C0ABC123" } }
        // { "channel": "whatsapp", "match": { "type": "jid", "value": "120363...@g.us" } }
      ]
    }

    // Add more agents here:
    // "agenticledger-ops": { ... },
    // "personal": { ... }
  },

  // Default agent for unmatched messages (optional)
  "defaultAgent": null                 // Set to agent ID string if you want a fallback
}
```

### `agents/{id}/agent.json` — Agent Metadata

```jsonc
{
  "id": "fic-show",
  "name": "FIC Show Agent",
  "description": "Manages episode content for Finance Is Cooked YouTube show",
  "version": "1.0.0",
  "created": "2026-02-27"
}
```

---

## 5. Component Specifications

### 5.1 Channel Driver Interface (`src/channels/types.ts`)

Every channel driver implements this interface:

```typescript
export interface InboundMessage {
  id: string;                          // Unique message ID
  channel: string;                     // "imessage" | "slack" | "whatsapp"
  chatId: string;                      // Channel-specific chat identifier
  chatType: "dm" | "group";
  sender: string;                      // Normalized sender ID (phone, user ID, etc.)
  senderName?: string;                 // Display name if available
  text: string;                        // Message body
  timestamp: number;                   // Unix ms
  isFromMe: boolean;                   // Sent by the bot/self
  isGroup: boolean;
  groupName?: string;                  // Group chat name/subject if available
  participants?: string[];             // Group members
  replyTo?: {                          // If replying to a specific message
    id: string;
    text: string;
    sender?: string;
  };
  attachments?: Array<{
    path: string;
    mimeType?: string;
  }>;
  raw: unknown;                        // Original payload from channel
}

export interface OutboundMessage {
  text: string;
  chatId: string;                      // Where to send the reply
  replyToId?: string;                  // Thread/reply to specific message
  attachments?: Array<{
    path: string;
    mimeType?: string;
  }>;
}

export interface ChannelDriver {
  readonly channelId: string;          // "imessage" | "slack" | "whatsapp"

  // Lifecycle
  start(): Promise<void>;             // Begin watching for messages
  stop(): Promise<void>;              // Graceful shutdown

  // Events
  onMessage(handler: (msg: InboundMessage) => Promise<void>): void;

  // Actions
  send(msg: OutboundMessage): Promise<void>;
}
```

### 5.2 Router (`src/router.ts`)

The router takes an `InboundMessage` and finds the matching agent.

```typescript
export interface RouteMatch {
  agentId: string;
  agentConfig: AgentConfig;
  route: RouteConfig;
}

// Matching logic:
// 1. For each agent in config.agents:
//    For each route in agent.routes:
//      If route.channel === message.channel
//      AND route.match matches message.chatId
//      → return this agent
// 2. If no match and config.defaultAgent is set → return default
// 3. If no match → return null (message ignored)

// Match types for iMessage:
//   "chat_id"         → message.chatId === String(route.match.value)
//   "chat_guid"       → message.chatId === route.match.value
//   "chat_identifier" → message.chatId === route.match.value

// Match types for Slack (future):
//   "channel_id"      → message.chatId === route.match.value

// Match types for WhatsApp (future):
//   "jid"             → message.chatId === route.match.value

// Permission check (after route match):
// 1. If route.permissions.allowFrom includes "*" → allowed
// 2. If sender is in route.permissions.allowFrom → allowed
// 3. Otherwise → blocked (log and ignore)

// Mention check (for groups):
// 1. If route.permissions.requireMention is false → process
// 2. If true → check if message contains agent name mention
//    (simple substring match against agent name)
```

### 5.3 Message Formatter (`src/utils/message-formatter.ts`)

Formats the raw message into a prompt for Claude:

```typescript
// For DMs:
// "[iMessage DM from +14425551234 at 2026-02-27T15:30:00Z]
//  Add a vibecoding segment to EP3
//  [/iMessage]"

// For groups:
// "[iMessage group 'FIC Show Planning' from +14425551234 at 2026-02-27T15:30:00Z]
//  Add a vibecoding segment to EP3
//  [/iMessage]"

// With reply context:
// "[iMessage group 'FIC Show Planning' from +14425551234 at 2026-02-27T15:30:00Z]
//  Add a vibecoding segment to EP3
//
//  [Replying to +14425555678]
//  What should we cover in EP3?
//  [/Replying]
//  [/iMessage]"

// Memory context is prepended if agent has memory/context.md:
// "[Agent Memory]
//  {contents of memory/context.md}
//  [/Agent Memory]
//
//  [Conversation History - last 5 messages]
//  {recent messages from conversation_log.jsonl}
//  [/Conversation History]
//
//  {formatted message above}"
```

### 5.4 Agent Executor (`src/executor.ts`)

Spawns `claude -p` with the agent's context:

```typescript
// Build the command:
// claude -p "$FORMATTED_MESSAGE" \
//   --cwd "$AGENT_WORKSPACE" \
//   --systemPrompt "$(cat $AGENT_CLAUDE_MD)" \
//   --allowedTools "Read,Edit,Write,Glob,Grep,Bash" \
//   --output-format text \
//   --max-turns 25

// Execution flow:
// 1. Load agent CLAUDE.md as system prompt
// 2. Load memory/context.md (if exists) — append to system prompt
// 3. Load recent conversation history from conversation_log.jsonl
// 4. Format the inbound message with history context
// 5. Spawn claude -p with formatted message
// 6. Capture stdout as the response
// 7. If autoCommit is true and files changed:
//    - cd to workspace
//    - git add -A
//    - git commit -m "Agent: {summary of change}"
//    - git push origin {autoCommitBranch}
// 8. Log message + response to conversation_log.jsonl
// 9. Return response text

// Timeout: 120 seconds (configurable per agent)
// If claude -p fails or times out, return error message to chat

// conversation_log.jsonl format (one JSON object per line):
// {"ts":"2026-02-27T15:30:00Z","from":"+1442...","text":"Add vibecoding to EP3","response":"Added...","agentId":"fic-show","channel":"imessage"}
```

### 5.5 Service Entry Point (`src/index.ts`)

```typescript
// 1. Load and validate config.json
// 2. Initialize enabled channel drivers
// 3. For each channel driver:
//    driver.onMessage(async (msg) => {
//      // Skip self-sent messages
//      if (msg.isFromMe) return;
//
//      // Route to agent
//      const match = router.resolve(msg);
//      if (!match) {
//        log.debug(`No route for ${msg.channel}:${msg.chatId}`);
//        return;
//      }
//
//      // Check permissions
//      if (!isAllowed(msg, match.route)) {
//        log.debug(`Blocked: ${msg.sender} not in allowFrom`);
//        return;
//      }
//
//      // Execute
//      log.info(`${match.agentId} ← ${msg.sender}: ${msg.text.slice(0, 80)}`);
//      const response = await executor.run(match, msg);
//
//      // Reply
//      await driver.send({
//        text: response,
//        chatId: msg.chatId,
//      });
//      log.info(`${match.agentId} → ${msg.chatId}: ${response.slice(0, 80)}`);
//    });
// 4. Start all drivers
// 5. Log: "channelToAgentToClaude running — N agents, M channels"
// 6. Handle SIGINT/SIGTERM gracefully (stop drivers, exit)
```

---

## 6. Channel Drivers

### 6.1 iMessage Driver (`src/channels/imessage.ts`) — BUILD THIS FIRST

Uses `imsg` CLI in JSON-RPC mode (same pattern as OpenClaw).

```typescript
// Lifecycle:
// start():
//   1. Probe imsg: spawn "imsg rpc --help" to verify it exists
//   2. Spawn "imsg rpc" as child process (stdin/stdout pipe)
//   3. Send JSON-RPC request: { method: "watch.subscribe", params: { attachments: false } }
//   4. Listen for notifications on stdout

// Message reception:
// imsg sends JSON-RPC notifications:
// {
//   "jsonrpc": "2.0",
//   "method": "message",
//   "params": {
//     "message": {
//       "id": 12345,
//       "sender": "+14425551234",
//       "text": "Add vibecoding to EP3",
//       "chat_id": 42,
//       "chat_guid": "iMessage;+;chat123456",
//       "chat_name": "FIC Show Planning",
//       "is_group": true,
//       "is_from_me": false,
//       "participants": ["+14425551234", "+14425555678"],
//       "created_at": "2026-02-27T15:30:00Z",
//       "reply_to_text": null,
//       "reply_to_sender": null,
//       "reply_to_id": null,
//       "attachments": []
//     }
//   }
// }

// Sending replies:
// Send JSON-RPC request:
// { method: "send", params: { text: "Added...", chat_id: 42 } }

// Debouncing:
// If multiple messages arrive from same sender in same chat within debounceMs,
// coalesce them into a single message (joined by newline).
// This prevents triggering multiple claude -p runs for rapid-fire texts.
// Implementation: per-sender-per-chat timer. On new message, reset timer.
// When timer fires, flush all buffered messages as one.

// Error handling:
// - If imsg process exits unexpectedly, attempt restart (max 3 retries)
// - If imsg is not found, log error with install instructions
// - If JSON-RPC request times out (10s), log warning
```

#### `src/utils/imsg-rpc.ts` — JSON-RPC Client

Reference implementation adapted from OpenClaw's `src/imessage/client.ts`:

```typescript
// Core class: ImsgRpcClient
//
// Constructor:
//   - cliPath: string (default "imsg")
//   - Spawns: child_process.spawn(cliPath, ["rpc"], { stdio: ["pipe","pipe","pipe"] })
//   - Reads stdout line by line (newline-delimited JSON)
//   - Maintains pending request map: Map<number, { resolve, reject, timer }>
//   - Maintains notification handler: (notification) => void
//
// Methods:
//   request<T>(method: string, params?: object, timeoutMs?: number): Promise<T>
//     - Sends: { jsonrpc: "2.0", id: nextId++, method, params }
//     - Waits for response with matching id
//     - Rejects on timeout or error response
//
//   onNotification(handler: (msg: { method: string, params: unknown }) => void)
//     - Called for any JSON-RPC message without an "id" (server push)
//
//   stop(): Promise<void>
//     - Kill child process, reject all pending requests
//
// Line parsing:
//   - Each line from stdout is JSON.parse'd
//   - If it has "id" → match to pending request
//   - If it has "method" but no "id" → notification (pass to handler)
//   - If parse fails → log warning, skip line
//
// Stderr handling:
//   - Log as warnings (imsg sometimes emits diagnostics on stderr)
```

### 6.2 Slack Driver (`src/channels/slack.ts`) — FUTURE

Reference: OpenClaw's `src/slack/` directory.

```typescript
// Two modes:
// 1. Socket Mode (recommended) — uses Slack's @slack/bolt or raw WebSocket
//    - Requires: botToken (xoxb-...) + appToken (xapp-...)
//    - Real-time message delivery
//    - No public URL needed
//
// 2. Webhook Mode — HTTP endpoint receives Slack events
//    - Requires: public URL or ngrok
//    - More complex setup
//
// Chat identification:
//   - Slack channel ID (e.g., "C0ABC123")
//   - Discovered via: Slack app settings or API
//
// Sending:
//   - Slack Web API: chat.postMessage
//
// Key difference from iMessage:
//   - Slack provides user display names natively
//   - Threading via thread_ts
//   - Rich formatting (mrkdwn)
//   - Bot must be invited to channel
//
// Implementation notes:
//   - Use @slack/web-api package for sending
//   - Use @slack/socket-mode for receiving (socket mode)
//   - Map Slack channel_id to agent routes
//   - Handle Slack's 3-second webhook response requirement (ack fast, process async)
```

### 6.3 WhatsApp Driver (`src/channels/whatsapp.ts`) — FUTURE

Reference: OpenClaw's `src/whatsapp/` directory + Clawdbot's WhatsApp config.

```typescript
// Options:
// 1. WhatsApp Business API (Cloud) — official, requires Meta business account
//    - Webhook receives messages
//    - REST API sends messages
//    - Requires public URL
//
// 2. WhatsApp Web bridge (e.g., whatsapp-web.js) — unofficial
//    - Headless browser connects to WhatsApp Web
//    - No business account needed
//    - Less stable, may break with WhatsApp updates
//
// Chat identification:
//   - WhatsApp JID: user "14425551234@s.whatsapp.net", group "120363...@g.us"
//   - Normalized to phone numbers for users
//
// Sending:
//   - Via WhatsApp Business API or whatsapp-web.js
//
// Note: Ore already has WhatsApp configured in Clawdbot on Windows.
// The WhatsApp driver here would be independent — running on Mac.
// Could potentially share the same WhatsApp number via multi-device.
```

---

## 7. Agent Execution

### 7.1 How `claude -p` Works

Claude Code's CLI supports a "print" mode that:
- Takes a prompt as argument
- Runs in a specified working directory
- Accepts a system prompt
- Has full tool access (file read/write, bash, etc.)
- Returns the response to stdout
- Exits when done

```bash
claude -p "Add a vibecoding segment to EP3 quick-updates" \
  --cwd ~/repos/financeiscooked-soundboard \
  --systemPrompt "You are the FIC Show Agent..." \
  --allowedTools "Read,Edit,Write,Glob,Grep,Bash" \
  --output-format text \
  --max-turns 25
```

### 7.2 Agent CLAUDE.md Structure

Each agent's `CLAUDE.md` is its identity and rules. Example for FIC Show:

```markdown
# FIC Show Agent

You are the show planning agent for "Finance Is Cooked" — a weekly YouTube show
about AI disrupting finance & accounting.

## What You Do

When someone in the group chat sends a message, you:
1. Understand their intent (add content, modify episodes, check status, etc.)
2. Use the update-episode skill to make changes to episode JSON files
3. Respond concisely confirming what you did

## Rules

- ALWAYS set new content status to "proposed" — never "final"
- Read EPISODE_GUIDE.md for the complete content specification
- Use standard segment IDs (cold-open, app-of-the-show, quick-updates, etc.)
- After making changes, git add + commit + push to main
- Keep responses SHORT — this goes back to a text message, not a terminal
- If the request is unclear, ask a clarifying question
- If someone says "finalize X" or "approve X", change status from "proposed" to "final"

## Response Style

- 1-3 sentences max
- No code blocks or technical details unless asked
- Confirm what you did: "Added 'Vibecoding in Finance' to EP3 quick-updates as proposed."
- If you made an error, say so honestly

## Context

- Repo: financeiscooked-soundboard
- Live site: https://ficsoundboard.netlify.app
- Episodes: public/episodes/*.json
- Images: public/episodes/ep{N}/
- Deployment: git push to main → Netlify auto-deploys in ~30 seconds
```

### 7.3 Memory Persistence

Each agent has a `memory/` directory:

**`memory/context.md`** — Running context (Claude updates this):
```markdown
## Current State
- Working on EP3 (date: 2026-03-12)
- EP2 is finalized and aired
- Cohost prefers vibecoding segments early in the show

## Recurring Preferences
- Ore likes link-type slides for news articles
- Cohost prefers gallery slides with screenshots
- Keep quick-updates to 3-4 items max
```

**`memory/conversation_log.jsonl`** — Append-only message log:
```json
{"ts":"2026-02-27T15:30:00Z","from":"+1442...","text":"Add vibecoding to EP3","response":"Added 'Vibecoding' to EP3 quick-updates as proposed.","agentId":"fic-show","channel":"imessage"}
{"ts":"2026-02-27T16:00:00Z","from":"+1442...","text":"Actually move it to take-of-the-show","response":"Moved 'Vibecoding' from quick-updates to take-of-the-show in EP3.","agentId":"fic-show","channel":"imessage"}
```

The executor loads the last N messages (configurable, default 5) from the log and includes them in the prompt so Claude has conversation continuity.

### 7.4 Auto-Commit Flow

When `autoCommit: true` in agent config:

```bash
# After claude -p completes successfully:
cd $WORKSPACE
git status --porcelain

# If there are changes:
git add -A
git commit -m "Agent(fic-show): Add vibecoding segment to EP3"
git push origin main

# Commit message format: "Agent({agentId}): {first line of claude response}"
```

---

## 8. Setup & Installation

### Prerequisites (Mac)

```bash
# 1. Install Homebrew (if not already)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Install Node.js 22+
brew install node@22

# 3. Install imsg CLI
brew install steipete/tap/imsg

# 4. Install Claude Code (if not already)
npm install -g @anthropic-ai/claude-code

# 5. Grant permissions
# System Preferences → Privacy & Security → Full Disk Access → Terminal (or iTerm)
# System Preferences → Privacy & Security → Automation → Terminal → Messages.app

# 6. Verify imsg works
imsg chats --limit 5 --json
# Should list your recent chats with IDs

# 7. Verify claude works
claude -p "Say hello" --output-format text
# Should return a greeting
```

### Project Setup

```bash
# Clone the repo
git clone https://github.com/agenticledger/channelToAgentToClaude.git
cd channelToAgentToClaude

# Install dependencies
npm install

# Build
npm run build

# Discover your iMessage chat IDs
./scripts/discover-chats.sh
# or: imsg chats --limit 20 --json | jq '.[] | {chat_id, display_name, participants}'
# Find the group chat you want to route, note the chat_id

# Edit config.json
# Set the chat_id in the fic-show agent route
# Set the workspace path to where you cloned financeiscooked-soundboard

# Test (single message, no daemon)
npm run test-message -- --agent fic-show --text "What episode are we on?"

# Start the service
npm start

# Or install as a background service (launchd)
./scripts/install-service.sh
```

### Discover iMessage Chat IDs

This is the critical setup step. Run on your Mac:

```bash
imsg chats --limit 20 --json
```

Output will look like:
```json
[
  {
    "chat_id": 42,
    "guid": "iMessage;+;chat123456789",
    "display_name": "FIC Show Planning",
    "participants": ["+14425551234", "+14425555678"],
    "last_message": "What should we cover next week?",
    "last_message_date": "2026-02-27T10:00:00Z"
  },
  {
    "chat_id": 7,
    "guid": "iMessage;-;+14425559999",
    "display_name": null,
    "participants": ["+14425559999"],
    "last_message": "Hey",
    "last_message_date": "2026-02-26T08:00:00Z"
  }
]
```

Find your group chat by participants or display_name. Use the `chat_id` (e.g., `42`) in your config.json route.

**Note:** If the group chat doesn't have a display_name, it will show as `null`. You identify it by the participants list. You CAN set a group chat name in iMessage (long-press the group → Info → Change Name), which makes discovery easier but is not required — the `chat_id` is what the config uses.

### Install as launchd Service

```bash
# scripts/install-service.sh creates:
# ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist
#
# The plist runs: node /path/to/channelToAgentToClaude/dist/index.js
# - Starts on login
# - Restarts on failure
# - Logs to ./logs/
#
# To check status:
launchctl list | grep channelToAgentToClaude
#
# To stop:
launchctl unload ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist
#
# To start:
launchctl load ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist
```

---

## 9. First Agent: FIC Show Agent

### Setup Steps

1. **Clone financeiscooked-soundboard on your Mac:**
   ```bash
   cd ~/repos
   git clone https://github.com/financeiscooked/financeiscooked-soundboard.git
   ```

2. **Create (or verify) the iMessage group chat** with your cohost

3. **Discover the chat ID:**
   ```bash
   imsg chats --json | jq '.[] | select(.participants | length > 1)'
   ```

4. **Update `config.json`** with the chat_id and workspace path

5. **Update `agents/fic-show/CLAUDE.md`** with any custom instructions

6. **Test:**
   ```bash
   npm run test-message -- --agent fic-show --text "What episodes do we have?"
   ```

7. **Start the service:**
   ```bash
   npm start
   ```

8. **Text the group chat from your phone:** "Add a segment about vibecoding to EP3"

9. **Watch the agent respond in the group chat**

### What the FIC Show Agent Can Do

(Based on the existing `update-episode` skill in the soundboard repo)

- Add slides to existing segments
- Add new segments (always as "proposed")
- Move segments from proposed → final
- Copy proposed segments between episodes
- Remove slides/segments
- Reorder slides within a segment
- Reorder segments in an episode
- Create new episodes (copy from previous, update id/title/date)
- Add link-type slides for news articles
- Add image and gallery slides
- Check current episode status

---

## 10. Future Channels: Slack & WhatsApp

### Design Principle

Each channel driver implements the `ChannelDriver` interface. Adding a channel means:
1. Create `src/channels/{channel}.ts` implementing `ChannelDriver`
2. Add channel config to `config.json`
3. Add route to agent config

No changes to router, executor, or message formatter needed.

### Slack Implementation Plan

**Reference code:** OpenClaw `src/slack/` directory

```
Dependencies: @slack/web-api, @slack/socket-mode
Auth: Bot token + App token (from Slack app dashboard)
Setup:
  1. Create Slack app at api.slack.com/apps
  2. Enable Socket Mode
  3. Add bot scopes: chat:write, channels:history, groups:history
  4. Install to workspace
  5. Invite bot to target channel
  6. Get channel ID (right-click channel → Copy link → extract ID)
```

**Config addition:**
```jsonc
{
  "channels": {
    "slack": {
      "enabled": true,
      "driver": "slack",
      "config": {
        "botToken": "xoxb-...",
        "appToken": "xapp-...",
        "mode": "socket"
      }
    }
  },
  "agents": {
    "fic-show": {
      "routes": [
        { "channel": "imessage", "match": { "type": "chat_id", "value": 42 } },
        { "channel": "slack", "match": { "type": "channel_id", "value": "C0ABC123" } }
      ]
    }
  }
}
```

### WhatsApp Implementation Plan

**Reference code:** OpenClaw `src/whatsapp/` + Clawdbot WhatsApp config

**Two options:**

1. **whatsapp-web.js** (simpler, unofficial)
   - Headless Chromium connects to WhatsApp Web
   - Scan QR code once, session persists
   - No business account needed
   - Less reliable long-term

2. **WhatsApp Cloud API** (official, requires Meta business setup)
   - Webhook receives messages
   - REST API sends messages
   - Requires business verification
   - More reliable

**Recommendation:** Start with whatsapp-web.js for speed, migrate to Cloud API if needed.

---

## 11. Reference: OpenClaw Patterns

These files in the OpenClaw repo (at `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\Openclaw\src\`) contain patterns worth referencing:

| Pattern | OpenClaw File | What to Borrow |
|---------|--------------|----------------|
| JSON-RPC client | `imessage/client.ts` | Request/response with timeout, notification handling |
| Chat ID parsing | `imessage/targets.ts` | `chat_id:`, `chat_guid:`, `chat_identifier:` prefix parsing |
| Message monitoring | `imessage/monitor/monitor-provider.ts` | Watch subscription, debouncing, group detection |
| Send messages | `imessage/send.ts` | RPC send params, attachment handling |
| Route resolution | `routing/resolve-route.ts` | Binding match hierarchy, session keys |
| Message debouncing | `auto-reply/inbound-debounce.ts` | Coalesce rapid messages per sender per chat |
| Group policy | `config/group-policy.ts` | Allowlist, open, disabled modes |
| Mention detection | `auto-reply/reply/mentions.ts` | Regex-based mention matching |
| Message formatting | `auto-reply/envelope.ts` | Structured envelope format for Claude |
| Slack integration | `slack/` directory | Socket mode setup, message handling |
| WhatsApp targets | `whatsapp/normalize.ts` | JID parsing, group detection |

**Important:** Reference these for patterns only. Do NOT import from or depend on OpenClaw packages. Copy and simplify what you need.

---

## 12. Testing & Validation

### Manual Testing

```bash
# 1. Test imsg connectivity
imsg chats --limit 5 --json

# 2. Test sending via imsg
imsg send --chat-id 42 --text "Test from channelToAgentToClaude"

# 3. Test claude -p execution
claude -p "What files are in this repo?" \
  --cwd ~/repos/financeiscooked-soundboard \
  --output-format text

# 4. Test single message through the service
npm run test-message -- --agent fic-show --text "List all episodes"

# 5. Test full flow (send from phone, check response)
npm start
# Text the group chat from your phone
# Watch logs: tail -f logs/service.log
```

### Scripts

```bash
# scripts/discover-chats.sh
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

# scripts/test-send.sh
#!/bin/bash
CHAT_ID=${1:?"Usage: test-send.sh <chat_id> [message]"}
MESSAGE=${2:-"Hello from channelToAgentToClaude"}
imsg send --chat-id "$CHAT_ID" --text "$MESSAGE"
echo "Sent to chat_id=$CHAT_ID"
```

### Validation Checklist

- [ ] `imsg` installed and working (`imsg chats --json` returns results)
- [ ] Full Disk Access granted to Terminal
- [ ] Automation permission granted (Terminal → Messages.app)
- [ ] `claude` CLI installed and authenticated
- [ ] financeiscooked-soundboard repo cloned on Mac
- [ ] config.json has correct chat_id for target group
- [ ] config.json has correct workspace path
- [ ] Agent CLAUDE.md exists and has correct instructions
- [ ] Test message works: `npm run test-message`
- [ ] Full flow works: text from phone → agent responds in group
- [ ] Auto-commit works: change appears on GitHub, Netlify deploys

---

## Package Dependencies

```jsonc
{
  "name": "channel-to-agent-to-claude",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test-message": "tsx src/test-message.ts"
  },
  "dependencies": {
    // Core (iMessage only — no heavy deps)
  },
  "devDependencies": {
    "typescript": "^5.7",
    "tsx": "^4.0",
    "@types/node": "^22"
  }
}
```

**Note:** The iMessage driver has ZERO npm dependencies — it just spawns `imsg` as a subprocess and does JSON-RPC over stdin/stdout. Slack driver will add `@slack/web-api` and `@slack/socket-mode`. WhatsApp will add `whatsapp-web.js` or REST client.

---

## Summary

**What to build first:**
1. `src/utils/imsg-rpc.ts` — JSON-RPC client (reference OpenClaw's `client.ts`)
2. `src/channels/imessage.ts` — iMessage driver using the RPC client
3. `src/router.ts` — Route messages to agents by chat ID
4. `src/executor.ts` — Spawn `claude -p` with agent context
5. `src/index.ts` — Wire it all together

**Total estimated code:** ~400-500 lines of TypeScript

**What to configure:**
1. `config.json` — Routes, agents, channels
2. `agents/fic-show/CLAUDE.md` — FIC Show Agent identity
3. Chat ID discovery via `imsg chats --json`

**What's already done:**
- `imsg` CLI handles the hard macOS/Messages bridge
- `claude -p` handles the AI execution with full tool access
- The `update-episode` skill exists in the financeiscooked repo
- Netlify auto-deploys on git push

**You're building the ~400 lines of glue in between.**
