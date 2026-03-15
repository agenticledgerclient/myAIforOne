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

## Step 4: Generate config.json

Read `config.example.json` as the template. Fill in the user's credentials:

```javascript
// Pseudocode for what to do:
// 1. Read config.example.json
// 2. Set each channel's enabled flag based on user choices
// 3. Fill in tokens for enabled channels
// 4. Set webUI.enabled = true, port = 4888
// 5. Set a random webhookSecret
// 6. Write to config.json
```

Generate a random webhook secret: use `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`.

**Important:** Make sure config.json is NOT committed (it's in .gitignore).

## Step 5: Create First Agent

Ask the user to create their first agent:

```
Let's create your first agent — this is the Claude you'll chat with from your phone.

Agent name (e.g., "My Assistant"):
Alias — the @mention trigger (e.g., "@assistant"):
What should it do? (e.g., "General-purpose coding and research assistant"):
Workspace — directory it can access (~ for everything, or a specific path):
```

Defaults:
- Persistent: true
- Streaming: true (for web UI)
- Tools: all (Read, Edit, Write, Glob, Grep, Bash, WebFetch, WebSearch)
- MCPs: none initially

## Step 6: Create Agent Folder

Create the folder structure:
```
~/Desktop/personalAgents/<agentId>/
├── CLAUDE.md          # System prompt (generated from their description)
└── memory/
    ├── context.md     # Initial context
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

## Step 10: Install as Service (Optional)

Ask if they want it to auto-start:

### macOS
```
Want the service to start automatically when you log in? (y/n)
```

If yes, create the launchd plist:
```bash
cat > ~/Library/LaunchAgents/com.myagent.gateway.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.myagent.gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>NODE_PATH</string>
    <string>PROJECT_PATH/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>PROJECT_PATH</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>PROJECT_PATH/logs/launchd-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>PROJECT_PATH/logs/launchd-stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>USER_HOME</string>
  </dict>
</dict>
</plist>
EOF
```

Replace NODE_PATH, PROJECT_PATH, USER_HOME with actual values using `which node`, `pwd`, `$HOME`.

Then: `launchctl load ~/Library/LaunchAgents/com.myagent.gateway.plist`

### Windows
```
Want the service to start automatically? (y/n)
```

If yes: `powershell -ExecutionPolicy Bypass -File scripts/install-service-windows.ps1`

## Step 11: Summary

Print a summary of everything that was set up:

```
Setup Complete!

Platform: [macOS/Windows]
Channels: [Telegram, Slack, ...]
Agent: <name> (<alias>)
Web UI: http://localhost:4888/ui
Org Chart: http://localhost:4888/org
Service: [running / installed as auto-start]

Quick commands:
  npm start              — start manually
  npm run dev            — dev mode with auto-reload
  npm test               — run tests
  http://localhost:4888   — web dashboard

Next steps:
  - Send "@alias hello" from your phone to test
  - Visit http://localhost:4888/org to manage agents
  - Add more agents with the + New Agent button on the org page
  - See docs/Architecture.md for the full feature reference
```

## Error Handling

- If any step fails, explain what went wrong clearly
- Offer to retry or skip
- Never leave config.json in a broken state — validate JSON after every write
- If the user gets stuck on credentials, offer to skip that channel and come back later
- Always verify with `node -e "JSON.parse(require('fs').readFileSync('config.json','utf8')); console.log('Config OK')"` after modifying config
