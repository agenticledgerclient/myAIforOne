# Setup Guide

Get your own phone-accessible Claude Code agents running in ~15 minutes.

> **First time?** If you don't have Node.js or Claude Code CLI installed yet, see [CLAUDE-AI-SETUP.md](CLAUDE-AI-SETUP.md) — you can paste it into claude.ai and get walked through everything step by step.

## Prerequisites

- **macOS, Windows, or Linux**
- **Node.js 22+** — `brew install node` (macOS), `winget install OpenJS.NodeJS.LTS` (Windows), or [nodejs.org](https://nodejs.org)
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code` (requires a Claude Pro/Max subscription or Anthropic API key)
- At least one messaging channel (Telegram is the easiest to start with)

## 1. Clone & Install

```bash
git clone https://github.com/YOUR_ORG/channelToAgentToClaude.git
cd channelToAgentToClaude
npm install
```

## 2. Create Your Config

```bash
cp config.example.json config.json
```

Edit `config.json` with your preferred editor. You'll fill in channel tokens and agent details in the next steps.

## 3. Set Up a Channel

Pick one or more channels. **Telegram is the easiest** — no OAuth, no app review, just a bot token.

### Telegram (recommended to start)

1. Open Telegram, message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`, follow prompts, copy the bot token
3. In `config.json`, set:
   ```json
   "telegram": {
     "enabled": true,
     "driver": "telegram",
     "config": {
       "botToken": "YOUR_TOKEN_HERE"
     }
   }
   ```
4. If using in a group: message @BotFather → `/mybots` → your bot → **Bot Settings** → **Group Privacy** → **Turn off**

### Slack

1. Create a Slack App at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable **Socket Mode** (under Settings)
3. Add Bot Token Scopes: `chat:write`, `channels:history`, `groups:history`, `im:history`, `files:read`
4. Install to your workspace
5. Copy the **Bot Token** (`xoxb-...`) and **App Token** (`xapp-...`)
6. In `config.json`:
   ```json
   "slack": {
     "enabled": true,
     "driver": "slack",
     "config": {
       "botToken": "xoxb-...",
       "appToken": "xapp-...",
       "mode": "socket"
     }
   }
   ```

### Discord

1. Create a bot at [discord.com/developers/applications](https://discord.com/developers/applications)
2. Under Bot settings, enable **Message Content Intent**
3. Generate an invite URL with `bot` scope + `Send Messages`, `Read Message History` permissions
4. Invite the bot to your server
5. Copy the bot token
6. In `config.json`:
   ```json
   "discord": {
     "enabled": true,
     "driver": "discord",
     "config": {
       "botToken": "YOUR_TOKEN_HERE"
     }
   }
   ```

### iMessage (macOS only)

Requires the `imsg` CLI tool. Install:
```bash
brew install phamson02/imsg/imsg
```
Then grant Terminal/iTerm **Full Disk Access** in System Settings → Privacy & Security → Full Disk Access.

iMessage is enabled by default in the example config.

### WhatsApp

1. Enable in config: `"whatsapp": { "enabled": true, ... }`
2. Run the pairing script: `npx tsx src/whatsapp-login.ts`
3. Scan the QR code with WhatsApp → Settings → Linked Devices → Link a Device
4. Once connected, restart the service

Note: WhatsApp sessions can expire. If you see "logged out" in logs, re-run the login script.

## 4. Create Your First Agent

The easiest path: create a general-purpose agent.

```bash
# Create agent directory
mkdir -p ~/Desktop/MyAIforOne Drive/PersonalAgents/my-agent/memory
```

Write the system prompt:
```bash
cat > ~/Desktop/MyAIforOne Drive/PersonalAgents/my-agent/CLAUDE.md << 'EOF'
# My Agent

You are a general-purpose Claude agent accessible via phone. You help with coding, research, file management, and anything else.

## Identity
- Mention alias: @myagent
- Respond when mentioned with @myagent

## Guidelines
- Keep responses concise — you're replying to phone messages
- If a task requires multiple steps, summarize what you did
- If you need clarification, ask
EOF
```

Write initial context:
```bash
echo "# My Agent Context\n\nCreated $(date +%Y-%m-%d)." > ~/Desktop/MyAIforOne Drive/PersonalAgents/my-agent/memory/context.md
```

The example config already includes this agent. Just update the route with your actual chat ID (see step 5).

### Optional: Enable Advanced Memory

For agents that benefit from long-term recall across sessions, add `"advancedMemory": true` to the agent config in `config.json`. This gives the agent automatic daily memory journals and semantic search over past conversations — no manual `/opcompact` needed. It works out of the box; if `OPENAI_API_KEY` is set, it uses OpenAI embeddings, otherwise it falls back to local TF-IDF. See [Architecture.md](Architecture.md#advanced-memory) for details.

## 5. Discover Your Chat ID

You need the chat ID for routing. The easiest way:

1. Build and start the service: `npm run build && npm start`
2. Send a message to your bot (or in the group where the bot is)
3. Check the logs: `tail -f logs/service.log`
4. Look for: `Telegram received from YourName (12345) in -67890: Hello`
5. The number after "in" is your chat ID (negative = group, positive = DM)
6. Update the `"value"` in your agent's route in `config.json`
7. Restart: Ctrl+C, then `npm start`

For Slack: right-click a channel → **View channel details** → scroll to bottom for Channel ID.

For iMessage: run `imsg chats --json` and find your chat ID.

## 6. Build & Run

```bash
npm run build
npm start
```

Send a message to your bot. You should see it process and respond.

## 7. Install as Auto-Start Service (Optional)

Create the launchd plist so the gateway starts on login and auto-restarts on crash:

```bash
cat > ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.agenticledger.channelToAgentToClaude</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(which node)</string>
    <string>$(pwd)/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(pwd)</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(pwd)/logs/launchd-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$(pwd)/logs/launchd-stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>$HOME</string>
  </dict>
</dict>
</plist>
EOF
```

**Important:** Replace the `$(...)` placeholders with actual paths before saving. Then:

```bash
launchctl load ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist
```

Check logs:
```bash
tail -f logs/service.log
```

## 8. Optional: Voice Transcription

To enable voice message transcription (Telegram voice notes → text):

1. Get an OpenAI API key from [platform.openai.com](https://platform.openai.com)
2. Add to your launchd plist's `EnvironmentVariables`:
   ```xml
   <key>OPENAI_API_KEY</key>
   <string>sk-proj-YOUR-KEY</string>
   ```
3. Or export it before running: `export OPENAI_API_KEY=sk-proj-... && npm start`

If no key is set, voice messages are silently ignored.

## 9. Optional: Add MCP Servers

MCPs give your agents access to external APIs. Register them in `config.json`:

```json
"mcps": {
  "context7": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@upstash/context7-mcp"]
  },
  "playwright": {
    "type": "stdio",
    "command": "npx",
    "args": ["@playwright/mcp@latest"]
  }
}
```

Then reference them in your agent config:
```json
"mcps": ["context7", "playwright"]
```

See `docs/AddNewMcpGuide.md` for more details.

## 10. Optional: Add Skills

Skills are instruction files from `~/.claude/commands/`. List the ones you want available to your agent:

```json
"skills": ["opcodereview", "sop_pdf", "my-custom-skill"]
```

The agent gets an index of skill names + descriptions in its system prompt, and can Read the full skill file when needed.

## Troubleshooting

### "Failed to fetch" or agent not responding
- Check `logs/service.log` for errors
- Verify the channel is enabled and tokens are correct
- Make sure the chat ID in the route matches (run with `logLevel: "debug"` to see incoming messages)

### Telegram bot not seeing group messages
- @BotFather → `/mybots` → your bot → **Bot Settings** → **Group Privacy** → **Turn off**

### WhatsApp keeps logging out
- WhatsApp sessions expire after ~14 days of inactivity
- Re-run `npx tsx src/whatsapp-login.ts` and scan the QR code
- If you get "can't link new devices", wait 15-30 minutes (rate limit)

### iMessage not working
- Ensure `imsg` is installed: `brew install phamson02/imsg/imsg`
- Grant Full Disk Access to Terminal/iTerm in System Settings
- Check that `imsg chats --json` returns data

### Agent responds but session doesn't persist
- Set `"persistent": true` in the agent config
- Check that the memory directory exists and is writable

### Web UI not accessible
- Check that `webUI.enabled` is `true` in service config
- Default port is 8080: http://localhost:8080/
- Only accessible from localhost (not exposed to the internet)
