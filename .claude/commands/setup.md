---
name: setup
description: First-time setup wizard for MyAgent. Detects platform, configures channels, creates first agent, builds and starts the service. Run this after cloning the repo.
---

# MyAgent Setup Wizard

Walk the user through setting up MyAgent from scratch. This is their first time — be friendly, clear, and handle errors gracefully.

## Prerequisites Check

Before starting, verify these are installed. If any are missing, tell the user how to install them and wait.

1. **Node.js 22+** — run `node --version`
2. **Claude Code CLI** — run `claude --version`
3. **npm dependencies** — check if `node_modules/` exists. If not, run `npm install`

## Checklist

Complete each step in order. Mark done as you go.

1. **Detect platform** — `process.platform` (darwin = Mac, win32 = Windows, linux = Linux)
2. **Check prerequisites** — Node.js, Claude Code CLI, npm install
3. **Choose channels** — ask which channels to enable
4. **Collect channel credentials** — walk through each chosen channel
5. **Generate config.json** — from template + user answers
6. **Create first agent** — name, alias, description, workspace
7. **Create agent folder** — CLAUDE.md + memory directory
8. **Build** — `npm run build`
9. **Test start** — start the service, verify it boots
10. **Install as service** (optional) — launchd (Mac) or Windows Service
11. **Verify** — health check, channel connection test

## Step 1: Welcome & Platform Detection

Detect the platform and greet the user:

```
Welcome to MyAgent! Let's get you set up.

Detected: [macOS / Windows / Linux]
Node.js: [version]
Claude Code: [version]
```

If on Windows, note that iMessage won't be available.

## Step 2: Choose Channels

Ask the user which channels they want to enable. Recommend Telegram as the easiest to start with.

Present as a simple list:
```
Which messaging channels do you want to use?

1. Telegram (recommended — easiest setup, just need a bot token)
2. Slack (needs a Slack App with Socket Mode)
3. Discord (needs a Discord Bot)
4. iMessage (macOS only, needs imsg CLI)
5. WhatsApp (needs QR code pairing, can be flaky)

Pick one or more (e.g., "1" or "1,2"):
```

## Step 3: Collect Channel Credentials

For each chosen channel, walk them through getting credentials. **One channel at a time.** Don't overwhelm.

### Telegram
```
Let's set up Telegram:
1. Open Telegram and message @BotFather
2. Send /newbot
3. Follow the prompts to name your bot
4. Copy the bot token (looks like: 123456:ABC-DEF...)

Paste your bot token:
```

If they want to use it in a group:
```
Do you want the bot in a group chat? (y/n)
If yes: Go to @BotFather → /mybots → your bot → Bot Settings → Group Privacy → Turn off
```

### Slack
```
Let's set up Slack:
1. Go to https://api.slack.com/apps and create a new app
2. Enable Socket Mode (Settings → Socket Mode → Enable)
3. Under OAuth & Permissions, add scopes: chat:write, channels:history, groups:history, im:history, files:read
4. Install the app to your workspace
5. Copy the Bot Token (starts with xoxb-)
6. Copy the App Token (starts with xapp-)

Paste your Bot Token (xoxb-...):
Paste your App Token (xapp-...):

Important: After the service starts, invite the bot to each Slack channel
where you want agents to respond. In the channel, type: /invite @yourbotname
Or go to channel settings → Integrations → Add apps.
```

### Discord
```
Let's set up Discord:
1. Go to https://discord.com/developers/applications
2. Create a new application
3. Go to Bot settings, enable Message Content Intent
4. Copy the bot token
5. Generate an invite URL: Bot scope + Send Messages + Read Message History permissions
6. Invite the bot to your server

Paste your bot token:
```

### iMessage (macOS only)
```
Let's set up iMessage:
1. Install imsg: brew install phamson02/imsg/imsg
2. Grant Full Disk Access to Terminal in System Settings → Privacy & Security
3. Test: run "imsg chats --json" — should list your chats

Done? (y/n):
```

### WhatsApp
```
WhatsApp setup requires QR code pairing:
1. We'll set this up after the service starts
2. You'll run: npx tsx src/whatsapp-login.ts
3. Scan the QR code with WhatsApp → Settings → Linked Devices → Link a Device

We'll come back to this. Moving on.
```

## Step 3b: Create MyAIforOne Drive

Create the personal data folder structure outside the repo. This keeps user data separate from the downloaded codebase:

```bash
mkdir -p "$HOME/Desktop/MyAIforOne Drive/PersonalAgents"
mkdir -p "$HOME/Desktop/MyAIforOne Drive/PersonalRegistry"
mkdir -p "$HOME/Desktop/MyAIforOne Drive/PersonalRegistry/skills/personal"
mkdir -p "$HOME/Desktop/MyAIforOne Drive/PersonalRegistry/prompts/personal"
```

This folder is the user's personal data root — all agents, registry items, and MCP keys live here, never in the repo.

## Step 4: Generate config.json

Read `config.example.json` as the template. Fill in the user's credentials:

```javascript
// Pseudocode for what to do:
// 1. Read config.example.json
// 2. Set each channel's enabled flag based on user choices
// 3. Fill in tokens for enabled channels
// 4. Set webUI.enabled = true, port = 4888
// 5. Set a random webhookSecret
// 6. Add defaultSkills: ["op_devbrowser"] (if the skill file exists)
// 7. Add defaultMcps: []
// 8. Add the "myaiforone" MCP entry pointing to the local MCP server:
//    "myaiforone": { "type": "stdio", "command": "node", "args": ["<PROJECT_PATH>/server/mcp-server/dist/index.js"], "env": { "MYAGENT_API_URL": "http://localhost:4888" } }
// 9. Write to config.json
```

Generate a random webhook secret: use `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`.

**Important:** Make sure config.json is NOT committed (it's in .gitignore).

## Step 5: Create First Agent

Every setup gets a general-purpose agent. Just ask for a name and alias — everything else is pre-configured.

```
Let's create your agent — this is the Claude you'll chat with from your phone.

What do you want to call it? (default: "My Agent"):
What @mention should trigger it? (default: "@agent"):
```

That's it — just those two questions. Use defaults if they press enter.

Pre-configured settings (don't ask, just set):
- **Persistent:** true (remembers conversations)
- **Streaming:** true (live output in web UI)
- **Advanced Memory:** true (automatic daily memory journals + semantic search — set `advancedMemory: true` by default for the general agent)
- **Autonomous Capable:** true (agent can be assigned autonomous goals with heartbeat schedules — set `autonomousCapable: true` by default)
- **Workspace:** ~ (full home directory access)
- **Tools:** all (Read, Edit, Write, Glob, Grep, Bash, WebFetch, WebSearch)
- **MCPs:** none initially (they can add later from the web UI)
- **Description:** "General-purpose Claude agent accessible from phone. Helps with coding, research, file management, and anything else."

## Step 6: Create Agent Folder

Create the folder structure (this is the agent's **home** — separate from the **workspace** which is the project they work on):
```
~/Desktop/MyAIforOne Drive/PersonalAgents/<agentId>/    ← agentHome
├── CLAUDE.md          # System prompt (generated from their description)
├── memory/
│   ├── context.md     # Initial context
├── mcp-keys/          # Per-agent API keys (override shared keys)
├── skills/            # Per-agent skills
└── FileStorage/
    ├── Temp/          # Temporary file uploads (per-message)
    └── Permanent/     # Permanent file storage
    └── (conversation_log.jsonl created automatically)
```

Write the CLAUDE.md with:
```markdown
# <Agent Name>

<Description expanded to 2-3 sentences>

## Identity
- Mention alias: <alias>
- Respond when mentioned with <alias>

## Guidelines
- Keep responses concise — you're replying to phone messages
- If a task requires multiple steps, summarize what you did
- If you need clarification, ask
```

Add the agent to config.json with routes for each enabled channel.

## Step 6b: Create DemoOrg Template Agents (automatic — do NOT ask)

Every install gets 5 template agents under `DemoOrg` that demonstrate platform capabilities. Create ALL of them silently — do not ask the user anything.

For EACH agent below, create the standard folder structure:
```
~/Desktop/MyAIforOne Drive/PersonalAgents/DemoOrg/<agentId>/
├── CLAUDE.md          # System prompt (content specified below)
├── memory/
│   └── context.md     # Brief context note
├── mcp-keys/
├── skills/
├── goals/
└── FileStorage/
    ├── Temp/
    └── Permanent/
```

Add each to config.json with routes for ALL enabled channels (same chat IDs as the user's general agent). All routes use `requireMention: true` except web which uses `requireMention: false`.

### Agent 1: Agent Creator (@agentcreator)

**Demonstrates:** Skills, MCPs, conversational agent creation

**CLAUDE.md:**
```markdown
# Agent Creator

You create new agents for the MyAgent platform through natural conversation. Users describe what they need — a coding assistant, a research bot, a project manager — and you turn that into a fully configured, deployed agent. No forms, no menus, just talk.

## Identity
- Mention alias: @agentcreator
- Respond when mentioned with @agentcreator

## How You Work

When someone asks you to create an agent, have a **short natural conversation** to understand:
1. What does the agent do?
2. What should it be called?
3. Where does it work?
4. What org does it belong to?
5. What tools/MCPs does it need?
6. Which channels?

Don't ask all questions at once. Be conversational — 1-2 at a time. Infer defaults from context.

Once you have enough info, use the `/opAgents_AddNew` skill to execute. Confirm briefly before executing.

## MCP Catalog

You have access to 39 pre-hosted HTTP MCP servers via `mcp-catalog.json` in the gateway project root. Read it when suggesting MCPs. Customers bring their own API keys.

## Capabilities
- Full file system access to create agent folders and write CLAUDE.md files
- Edit config.json to register new agents
- Rebuild and restart the gateway service
- Access to the opAgents_AddNew skill for structured agent creation
- MCP catalog with 39 pre-hosted HTTP servers

## Guidelines
- Keep it conversational — you're the anti-form
- If the user gives you everything in one message, skip the conversation and just build it
- After creating an agent, give a short summary: name, alias, channels, and how to reach it
```

**Config:** `skills: ["opAgents_AddNew"]`, `mcps: ["myaiforone"]`, `timeout: 14400000`, all tools, `autonomousCapable: false`, `agentClass: "platform"`, `workspace: GATEWAY_PROJECT_PATH`

### Agent 2: Daily Digest (@digest)

**Demonstrates:** Autonomous goals, heartbeat schedule, budget tracking

**CLAUDE.md:**
```markdown
# Daily Digest

Meta-agent that monitors your agent fleet. Every morning, scans all agent folders for recent activity, open tasks, and conversation highlights. Gives you a birds-eye view of what your agents have been up to.

## Identity
- Mention alias: @digest
- Respond when mentioned with @digest

## How You Work

On your daily heartbeat (7am), scan ~/Desktop/MyAIforOne Drive/PersonalAgents/ recursively:
- Read each agent's memory/context.md and recent memory logs
- Check tasks.json for open tasks across the fleet
- Note which agents were active in the last 24-48 hours
- Highlight notable items
- Flag dormant agents

Post a concise digest to the configured channel.

You can also be asked directly: "what did @producer do yesterday?" or "any open tasks?"

## Guidelines
- Keep the digest scannable — bullets, not paragraphs
- Highlight things that need attention
- Don't report on agents with zero activity unless asked
```

**Config:** `autonomousCapable: true`, `workspace: ~/Desktop/MyAIforOne Drive/PersonalAgents`, tools: `["Read", "Glob", "Grep", "Bash"]`

**Goals:**
```json
"goals": [{
  "id": "daily-fleet-digest",
  "enabled": true,
  "description": "Scan all agent folders, read recent memory logs, check for open tasks, and produce a morning digest of fleet activity",
  "successCriteria": "Concise digest posted covering active agents, open tasks, key highlights, and dormant agents",
  "instructions": "Scan ~/Desktop/MyAIforOne Drive/PersonalAgents/ recursively. For each agent folder, read memory/context.md and any recent memory logs. Check for tasks.json or todo files. Summarize which agents were active in the last 24-48h, list open tasks across the fleet, highlight notable items, and note dormant agents.",
  "heartbeat": "0 7 * * *",
  "budget": { "maxDailyUsd": 2 },
  "reportTo": "USE_FIRST_ENABLED_CHANNEL_AND_CHAT_ID"
}]
```

### Agent 3: Crypto Price (@crypto)

**Demonstrates:** Cron scheduled messages, WebFetch tool

**CLAUDE.md:**
```markdown
# Crypto Price

Reports BTC and ETH prices every 4 hours using the free CoinGecko API. Quick, formatted price updates with 24h change.

## Identity
- Mention alias: @crypto
- Respond when mentioned with @crypto

## How You Work

On cron schedule (every 4 hours), fetch prices from:
https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true

Post a brief update like:
BTC: $67,432 (+2.3%)
ETH: $3,891 (-0.8%)

You can also be asked directly: "what's the price of BTC?" or "how's crypto doing?"

## Guidelines
- Keep updates to 2-3 lines
- Include 24h change percentage
- If the API is down, say so briefly — don't retry in a loop
```

**Config:** `autonomousCapable: false`, `workspace: ~`, tools: `["WebFetch", "Bash"]`

**Cron:**
```json
"cron": [{
  "schedule": "0 */4 * * *",
  "message": "Fetch current BTC and ETH prices from CoinGecko and post a brief update with price and 24h change",
  "channel": "USE_FIRST_ENABLED_CHANNEL",
  "chatId": "USE_FIRST_ENABLED_CHAT_ID"
}]
```

### Agent 4: Journal (@journal)

**Demonstrates:** Advanced memory, semantic search, daily logs

**CLAUDE.md:**
```markdown
# Journal

Your personal memory assistant. Send me notes, thoughts, ideas, and todos throughout the day. I remember everything and you can search it later.

## Identity
- Mention alias: @journal
- Respond when mentioned with @journal

## How You Work

When you send me a note, I acknowledge it briefly and store it. When you ask a question about past notes, I search my memory semantically.

Examples:
- "had a great call with investor X about Series A"
- "todo: follow up with Sarah about the contract"
- "idea: we should build a dashboard for MCP usage"
- Then later: "what did I note about investors?" or "what are my open todos?"

## Guidelines
- Acknowledge notes with a short confirmation (1 line)
- When recalling, cite the approximate date
- For todos, track whether they've been marked done
- Don't editorialize — store what the user says, recall it faithfully
```

**Config:** `autonomousCapable: false`, `advancedMemory: true`, `workspace: ~`, tools: `["Read", "Write", "Glob", "Grep", "Bash", "WebSearch"]`

### Agent 5: Market Watch (@market)

**Demonstrates:** WebSearch and WebFetch tools (no API keys needed)

**CLAUDE.md:**
```markdown
# Market Watch

On-demand market data assistant. Ask about stock prices, crypto markets, financial news, or economic indicators. Uses web search and public APIs — no API keys needed.

## Identity
- Mention alias: @market
- Respond when mentioned with @market

## How You Work

When asked about markets, use WebSearch to find current data and WebFetch to hit public APIs. Examples:
- "how's AAPL doing?"
- "what's the S&P 500 at?"
- "any big crypto news today?"
- "what's the EUR/USD rate?"

## Guidelines
- Keep responses concise — 3-5 lines max
- Always note that data may be delayed
- Use WebFetch for structured data (APIs), WebSearch for news
- If you can't find current data, say so rather than guessing
```

**Config:** `autonomousCapable: false`, `workspace: ~`, tools: `["WebSearch", "WebFetch", "Read", "Bash"]`

### All DemoOrg agents share:
- `persistent: true`, `streaming: true`
- `agentClass: "platform"` (hidden from /org default view, accessible via Lab and filter)
- `org: [{ "organization": "DemoOrg", "function": "Platform", "title": "<varies>", "reportsTo": "" }]`
- `timeout: 14400000`
- `autoCommit: false`

Replace `USE_FIRST_ENABLED_CHANNEL` and `USE_FIRST_ENABLED_CHAT_ID` with the actual first enabled channel and its chat ID from the user's setup.

**Do not ask the user anything for this step.** Create all 5 silently and mention them in the summary.

## Step 7: Discover Chat IDs

For channels that need chat IDs:

### Telegram
```
To find your Telegram chat ID:
1. I'll start the service temporarily
2. Send any message to your bot (or in the group with the bot)
3. Check the logs for the chat ID
4. I'll update the config with the real chat ID
```

Start the service, wait for a message, grep the log for the chat ID, update config.json, restart.

### Slack
```
To find your Slack channel ID:
Right-click the channel → View channel details → scroll to the bottom
The Channel ID looks like: C0ABC123DEF

Paste the channel ID:
```

### Discord
```
Enable Developer Mode in Discord: Settings → Advanced → Developer Mode
Right-click the channel → Copy Channel ID

Paste the channel ID:
```

### iMessage
```
Run: imsg chats --json
Find your chat and note the chat_id number.

Paste the chat ID:
```

## Step 8: Build & Start

```bash
npm run build
```

If build fails, read the error and fix it. Common issues:
- Missing dependencies → `npm install`
- TypeScript errors → usually a config.json issue

Start the service:
```bash
npm start
```

Watch the logs for successful channel connections. Expected output:
```
channelToAgentToClaude starting...
Telegram bot authenticated as @botname (12345)
channelToAgentToClaude running — 1 agent(s), N channel(s)
Web UI running on http://localhost:4888/ui
```

## Step 9: Test

Ask the user to send a test message to their bot from their phone.

Check the logs for the message. If it works:
```
Your agent is live! Send "@alias hello" from your phone and you should get a response.

Web UI: http://localhost:4888/ui
Org Chart: http://localhost:4888/org
```

If it doesn't work, troubleshoot:
- Channel not connecting → check token
- Message received but no route match → check chat ID in config
- Agent errors → check Claude Code CLI works (`claude -p "hi" --output-format text`)

## Step 10: Create Desktop Shortcut (automatic — do NOT ask)

Silently create a desktop shortcut to open the Web UI. Do not ask the user — just create it.

### macOS
```bash
APP_PATH="$HOME/Desktop/MyAgent.app"
mkdir -p "$APP_PATH/Contents/MacOS"

cat > "$APP_PATH/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>MyAgent</string>
  <key>CFBundleName</key>
  <string>MyAgent</string>
  <key>CFBundleIdentifier</key>
  <string>com.myagent.launcher</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
</dict>
</plist>
EOF

cat > "$APP_PATH/Contents/MacOS/MyAgent" << 'EOF'
#!/bin/bash
open "http://localhost:4888/ui"
EOF

chmod +x "$APP_PATH/Contents/MacOS/MyAgent"
```

### Windows
```powershell
$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut("$env:USERPROFILE\Desktop\MyAgent.lnk")
$Shortcut.TargetPath = "http://localhost:4888/ui"
$Shortcut.Description = "Open MyAgent Web UI"
$Shortcut.Save()
```

**Do not ask.** Just create the shortcut and mention it in the summary. Auto-start service and status indicator scripts are available from the Settings page if the user wants them later.

## Step 11: Summary

Print a summary of everything that was set up:

```
Setup Complete!

Platform: [macOS/Windows]
Channels: [Telegram, Slack, ...]
Agent: <name> (<alias>)
Web UI: http://localhost:4888/ui
Org Chart: http://localhost:4888/org
Desktop shortcut: Created (MyAgent.app / MyAgent.lnk)

Quick commands:
  npm start              — start manually
  npm run dev            — dev mode with auto-reload
  npm test               — run tests
  http://localhost:4888   — web dashboard

Your agents:
  1. <name> (<alias>) — your general-purpose agent
  2. Agent Creator (@agentcreator) — creates new agents through conversation
  3. Daily Digest (@digest) — morning briefing of agent fleet activity (goal: 7am daily)
  4. Crypto Price (@crypto) — BTC/ETH prices every 4 hours (cron demo)
  5. Journal (@journal) — personal memory assistant with semantic recall
  6. Market Watch (@market) — stock/crypto lookups via web search

Next steps:
  - Send "@alias hello" from your phone to test
  - Want a new agent? Message "@agentcreator I need an agent for..."
  - Visit http://localhost:4888/org to see your agent fleet
  - See docs/Architecture.md for the full feature reference
```

## Error Handling

- If any step fails, explain what went wrong clearly
- Offer to retry or skip
- Never leave config.json in a broken state — validate JSON after every write
- If the user gets stuck on credentials, offer to skip that channel and come back later
- Always verify with `node -e "JSON.parse(require('fs').readFileSync('config.json','utf8')); console.log('Config OK')"` after modifying config
