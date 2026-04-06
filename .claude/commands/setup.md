---
name: setup
description: First-time setup wizard for MyAgent. Detects platform, installs dependencies, generates minimal config, builds, starts the service, and opens the web UI. Channel setup and agent creation happen through the hub agent in the browser.
---

# MyAgent Setup Wizard

Get the user to the web UI as fast as possible. Channel setup and agent creation are handled by the hub agent in the browser — NOT in the terminal.

## Prerequisites Check

Before starting, verify these are installed. If any are missing, tell the user how to install them and wait.

1. **Node.js 22+** — run `node --version`
2. **Claude Code CLI** — run `claude --version`
3. **npm dependencies** — check if `node_modules/` exists. If not, run `npm install`

## Checklist

Complete each step in order. Mark done as you go.

1. **Detect platform** — `process.platform` (darwin = Mac, win32 = Windows, linux = Linux)
2. **Check prerequisites** — Node.js, Claude Code CLI, npm install
3. **Create MyAIforOne Drive** — personal data folder structure
4. **Generate config.json** — minimal config with web UI only
5. **Register platform agents** — hub + 4 creator agents
6. **Build** — `npm run build`
7. **Start** — start the service
8. **Create desktop shortcut** — silently
9. **Open browser** — launch the web UI
10. **Done** — user continues in the browser

## Step 1: Welcome & Platform Detection

```
Welcome to MyAgent! Let's get you set up.

Detected: [macOS / Windows / Linux]
Node.js: [version]
Claude Code: [version]

This will take a couple of minutes.
```

If on Windows, note that iMessage won't be available.

## Step 2: Create MyAIforOne Drive

Create the personal data folder structure outside the repo:

### macOS / Linux
```bash
mkdir -p "$HOME/Desktop/MyAIforOne Drive/PersonalAgents"
mkdir -p "$HOME/Desktop/MyAIforOne Drive/PersonalRegistry"
mkdir -p "$HOME/Desktop/MyAIforOne Drive/PersonalRegistry/skills/personal"
mkdir -p "$HOME/Desktop/MyAIforOne Drive/PersonalRegistry/prompts/personal"
```

### Windows
```powershell
$dirs = @(
  "$env:USERPROFILE\Desktop\MyAIforOne Drive\PersonalAgents",
  "$env:USERPROFILE\Desktop\MyAIforOne Drive\PersonalRegistry",
  "$env:USERPROFILE\Desktop\MyAIforOne Drive\PersonalRegistry\skills\personal",
  "$env:USERPROFILE\Desktop\MyAIforOne Drive\PersonalRegistry\prompts\personal"
)
$dirs | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }
```

## Step 3: Generate config.json

Read `config.example.json` as the template. Generate a MINIMAL config:

1. **No channels enabled** — channels will be configured via the hub agent in the browser
2. Set `webUI.enabled = true`, port = 4888
3. Generate a random webhook secret: `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`
4. Add `defaultMcps: []`
5. Add `defaultSkills: ["op_devbrowser"]` (if the skill file exists)
6. Add the `myaiforone-local` MCP entry pointing to the local MCP server:
   ```json
   "myaiforone-local": {
     "type": "stdio",
     "command": "node",
     "args": ["<PROJECT_PATH>/server/mcp-server/dist/index.js"],
     "env": { "MYAGENT_API_URL": "http://localhost:4888" }
   }
   ```
7. Write to config.json

**Important:** config.json is in .gitignore — never commit it.

## Step 4: Register Platform Agents (silent — do NOT ask)

Register these agents in config.json. Do NOT ask the user — just do it silently.

### Hub Agent
The hub is the default group/router agent. Register it with:
- `agentId`: `hub`
- `name`: `Hub`
- `description`: "The primary AI interface — handles all platform operations through natural conversation."
- `agentHome`: `<PROJECT_PATH>/agents/platform/hub`
- `claudeMd`: `<PROJECT_PATH>/agents/platform/hub/CLAUDE.md`
- `workspace`: `<PROJECT_PATH>`
- `persistent`: true, `streaming`: true
- `subAgents`: `"*"` (routes to all agents)
- `mcps`: `["myaiforone-local"]`
- `allowedTools`: all tools
- `routes`: web route only
- `agentClass`: `"platform"`

Set `"defaultAgent": "hub"` at the top level of config.json.

### 4 Creator Agents

| agentId | name | skills | CLAUDE.md |
|---------|------|--------|-----------|
| `agentcreator` | Agent Creator | `["opAgents_AddNew"]` | `agents/platform/agentcreator/CLAUDE.md` |
| `skillcreator` | Skill Creator | `["MyAgentSkillCreate"]` | `agents/platform/skillcreator/CLAUDE.md` |
| `appcreator` | App Creator | `["ai41_app_build"]` | `agents/platform/appcreator/CLAUDE.md` |
| `promptcreator` | Prompt Creator | `[]` | `agents/platform/promptcreator/CLAUDE.md` |

All 4 share these settings:
```json
{
  "agentClass": "platform",
  "persistent": true,
  "streaming": true,
  "mcps": ["myaiforone-local"],
  "workspace": "PROJECT_PATH",
  "agentHome": "PROJECT_PATH/agents/platform/AGENT_ID",
  "claudeMd": "PROJECT_PATH/agents/platform/AGENT_ID/CLAUDE.md",
  "memoryDir": "PROJECT_PATH/agents/platform/AGENT_ID/memory",
  "allowedTools": ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"],
  "timeout": 14400000,
  "autoCommit": false,
  "routes": [],
  "org": [{ "organization": "Platform Creators", "function": "Lab", "title": "Creator Agent", "reportsTo": "" }]
}
```

Create memory directories:
- **macOS / Linux:** `mkdir -p agents/platform/{hub,agentcreator,skillcreator,appcreator,promptcreator}/memory`
- **Windows:** `@("hub","agentcreator","skillcreator","appcreator","promptcreator") | ForEach-Object { New-Item -ItemType Directory -Force -Path "agents\platform\$_\memory" | Out-Null }`

## Step 5: Validate & Build

```bash
node -e "JSON.parse(require('fs').readFileSync('config.json','utf8')); console.log('Config OK')"
npm run build
```

## Step 6: Start the Service

### macOS / Linux
```bash
npm start &
```

### Windows
```powershell
Start-Process -NoNewWindow npm -ArgumentList "start"
```

Wait for the log: `channelToAgentToClaude running — X agent(s), 0 channel(s)`

## Step 7: Create Desktop Shortcut (silent — do NOT ask)

### macOS
```bash
APP_PATH="$HOME/Desktop/AIforOne.app"
mkdir -p "$APP_PATH/Contents/MacOS"

cat > "$APP_PATH/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>AIforOne</string>
  <key>CFBundleName</key>
  <string>AIforOne</string>
  <key>CFBundleIdentifier</key>
  <string>com.aiforone.launcher</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
</dict>
</plist>
EOF

cat > "$APP_PATH/Contents/MacOS/AIforOne" << 'EOF'
#!/bin/bash
open "http://localhost:4888"
EOF

chmod +x "$APP_PATH/Contents/MacOS/AIforOne"
```

### Windows
```powershell
$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut("$env:USERPROFILE\Desktop\AIforOne.lnk")
$Shortcut.TargetPath = "http://localhost:4888"
$Shortcut.Description = "Open AIforOne Web UI"
$Shortcut.Save()
```

## Step 8: Open Browser & Summary

Open the monitor page directly:
- macOS: `open http://localhost:4888/monitor`
- Windows: `start http://localhost:4888/monitor`

Print the summary:

```
Setup Complete!

Platform: [macOS/Windows]
Web UI: http://localhost:4888

The browser should have opened to the Monitor page.
It shows your setup checklist — click "Start Setup" and the hub agent
will walk you through connecting messaging channels and creating your first agent.

Quick commands:
  npm start              — start manually
  npm run dev            — dev mode with auto-reload
  http://localhost:4888   — web dashboard

The Settings page (http://localhost:4888/admin) has options
for auto-starting the service on login.
```

## Error Handling

- If any step fails, explain what went wrong clearly
- Offer to retry or skip
- Never leave config.json in a broken state
- Always validate JSON after every write
