---
name: setup
description: First-time setup wizard for MyAgent. Detects platform, installs dependencies, generates minimal config, builds, starts the service, and opens the web UI. Channel setup and agent creation happen through the hub agent in the browser.
---

# MyAgent Setup Wizard

Get the user to the web UI as fast as possible. Channel setup and agent creation are handled by the hub agent in the browser — NOT in the terminal.

## Before You Start — Show the Plan

Print this overview FIRST so the user knows what's coming:

```
Welcome to MyAgent! Here's what we'll do:

  □ 1. Check prerequisites (Node.js, npm)
  □ 2. Create your MyAIforOne Drive folder
  □ 3. Generate your config
  □ 4. Register platform agents
  □ 5. Build the project
  □ 6. Start the service & open the web UI

This takes a couple of minutes. Let's go!
```

## Progress Updates

After completing each step, reprint the checklist with completed items checked off and the current step highlighted. Example after completing steps 1–3:

```
  ✅ 1. Check prerequisites
  ✅ 2. Create MyAIforOne Drive
  ✅ 3. Generate config
  → 4. Register platform agents...
  □ 5. Build the project
  □ 6. Start the service & open the web UI
```

## Step 1: Prerequisites & Platform Detection

Check these prerequisites. If any fail, help the user fix them before continuing.

1. **Node.js 22+** — run `node --version`. If missing or too old, direct them to `brew install node` (macOS), `winget install nodejs` (Windows), or [nodejs.org](https://nodejs.org).
2. **npm dependencies** — check if `node_modules/` exists. If not, run `npm install`.

Note: Claude Code CLI is already proven to work — the user is running this wizard inside it. No need to check.

**Claude is optional.** If the user says they won't use Claude (they plan to use Venice, Ollama, or another provider), skip any Claude auth steps and continue. They can add provider API keys in Admin → Settings after setup.

Detect platform via `process.platform` (darwin = Mac, win32 = Windows, linux = Linux).

After checks pass, print:

```
  ✅ 1. Check prerequisites — Node.js [version], [macOS/Windows/Linux]
  → 2. Create MyAIforOne Drive...
  □ 3. Generate config
  □ 4. Register platform agents
  □ 5. Build the project
  □ 6. Start the service & open the web UI
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
mkdir -p "$HOME/Desktop/MyAIforOne Drive/PlatformUtilities"/{hub,agentcreator,skillcreator,appcreator,promptcreator,gym}/{memory,FileStorage/Temp,FileStorage/Permanent}
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
@("hub","agentcreator","skillcreator","appcreator","promptcreator","gym") | ForEach-Object {
  New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\Desktop\MyAIforOne Drive\PlatformUtilities\$_\memory" | Out-Null
  New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\Desktop\MyAIforOne Drive\PlatformUtilities\$_\FileStorage\Temp" | Out-Null
  New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\Desktop\MyAIforOne Drive\PlatformUtilities\$_\FileStorage\Permanent" | Out-Null
}
```

Print progress after completion.

## Step 3: Generate config.json

Read `config.example.json` as the template. Generate a MINIMAL config:

1. **No channels enabled** — channels will be configured via the hub agent in the browser
2. Set `webUI.enabled = true`, port = 4888
3. Generate a random webhook secret: `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`
4. Add `defaultMcps: []`
5. Add `defaultSkills` with all platform skills from `registry/skills/platform/` — scan the directory and include every `.md` filename (without extension). This gives every agent access to all platform skills automatically.
6. Add the `myaiforone-local` MCP entry pointing to the local MCP server:
   ```json
   "myaiforone-local": {
     "type": "stdio",
     "command": "node",
     "args": ["<PROJECT_PATH>/server/mcp-server/dist/index.js"],
     "env": { "MYAGENT_API_URL": "http://localhost:4888" }
   }
   ```
7. Add the `aigym` MCP entry for the AI Gym platform (public access, no auth needed):
   ```json
   "aigym": {
     "type": "streamable-http",
     "url": "https://aigym.agenticledger.ai/mcp"
   }
   ```
8. Write to config.json

**Important:** config.json is in .gitignore — never commit it.

Print progress after completion.

## Step 4: Register Platform Agents (silent — do NOT ask)

Register these agents in config.json. Do NOT ask the user — just do it silently.

### Hub Agent
The hub is the default group/router agent. Register it with:
- `agentId`: `hub`
- `name`: `Hub`
- `description`: "The primary AI interface — handles all platform operations through natural conversation."
- `agentHome`: `~/Desktop/MyAIforOne Drive/PlatformUtilities/hub`
- `claudeMd`: `agents/platform/hub/CLAUDE.md`
- `memoryDir`: `~/Desktop/MyAIforOne Drive/PlatformUtilities/hub/memory`
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
  "agentHome": "~/Desktop/MyAIforOne Drive/PlatformUtilities/AGENT_ID",
  "claudeMd": "agents/platform/AGENT_ID/CLAUDE.md",
  "memoryDir": "~/Desktop/MyAIforOne Drive/PlatformUtilities/AGENT_ID/memory",
  "allowedTools": ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"],
  "timeout": 14400000,
  "autoCommit": false,
  "routes": [],
  "org": [{ "organization": "Platform Creators", "function": "Lab", "title": "Creator Agent", "reportsTo": "" }]
}
```

### Gym Agent

Register the AI Gym Coach. It's always registered but only active when `gymEnabled: true` in service config.

Read the reference config from `agents/platform/gym/agent.json` and register it with these path overrides:
```json
{
  "agentHome": "~/Desktop/MyAIforOne Drive/PlatformUtilities/gym",
  "claudeMd": "agents/platform/gym/CLAUDE.md",
  "memoryDir": "~/Desktop/MyAIforOne Drive/PlatformUtilities/gym/memory"
}
```

All other fields (name, description, agentClass, allowedTools, mcps, org, etc.) come directly from `agents/platform/gym/agent.json`.

Note: PlatformUtilities directories for all platform agents (including gym) are created in Step 2.

Print progress after completion.

## Step 5: Validate & Build

```bash
node -e "JSON.parse(require('fs').readFileSync('config.json','utf8')); console.log('Config OK')"
npm run build
```

Print progress after completion.

## Step 6: Start the Service & Open Browser

### macOS / Linux
```bash
npm start &
```

### Windows
```powershell
Start-Process -NoNewWindow npm -ArgumentList "start"
```

Wait for the log: `channelToAgentToClaude running — X agent(s), 0 channel(s)`

### Create Desktop Shortcut (silent — do NOT ask)

#### macOS
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
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

# Check if already running
if curl -s --max-time 2 http://localhost:4888/health 2>/dev/null | grep -q "ok"; then
    open "http://localhost:4888"
    exit 0
fi

# Not running — try launchctl first
PLIST="$HOME/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist"
if [ -f "$PLIST" ]; then
    launchctl load "$PLIST" 2>/dev/null
else
    # Fallback: start via npx (detached)
    nohup npx myaiforone@latest > /dev/null 2>&1 &
fi

# Wait for health (up to 30s)
for i in $(seq 1 30); do
    if curl -s --max-time 2 http://localhost:4888/health 2>/dev/null | grep -q "ok"; then
        open "http://localhost:4888"
        exit 0
    fi
    sleep 1
done

# Timeout — open anyway, user will see loading
open "http://localhost:4888"
EOF

chmod +x "$APP_PATH/Contents/MacOS/AIforOne"
```

#### Windows
```powershell
$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut("$env:USERPROFILE\Desktop\AIforOne.lnk")
$Shortcut.TargetPath = "http://localhost:4888"
$Shortcut.Description = "Open AIforOne Web UI"
$Shortcut.Save()
```

### Open Browser

Open the monitor page directly:
- macOS: `open http://localhost:4888/monitor`
- Windows: `start http://localhost:4888/monitor`

### Final Output

Print the completed checklist and summary:

```
  ✅ 1. Check prerequisites
  ✅ 2. Create MyAIforOne Drive
  ✅ 3. Generate config
  ✅ 4. Register platform agents
  ✅ 5. Build the project
  ✅ 6. Start the service & open the web UI

Setup complete!

  Web UI:  http://localhost:4888
  Monitor: http://localhost:4888/monitor

The browser should have opened to the Monitor page.
Click "Start Setup" and the hub agent will walk you through
connecting messaging channels and creating your first agent.

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
- Update the checklist to show which step failed with an X mark
