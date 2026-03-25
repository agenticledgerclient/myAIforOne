---
name: opAgents_AddNew
description: Add a new agent to the channelToAgentToClaude gateway. Gathers agent info (or accepts it inline), creates folder structure, writes system prompt, updates config.json, registers MCPs, rebuilds, and restarts the service. Use when adding a new phone-accessible Claude agent.
---

# Add New Agent — MyAgent Gateway

Add a new agent to the phone-accessible Claude agent gateway at `~/Desktop/APPs/channelToAgentToClaude`.

## Key Paths

- **Gateway project:** `~/Desktop/APPs/channelToAgentToClaude`
- **Gateway config:** `~/Desktop/APPs/channelToAgentToClaude/config.json`
- **Agent homes:** `~/Desktop/personalAgents/<Organization>/<agentId>/`
- **Shared skills:** `~/Desktop/personalAgents/skills/`
- **Shared MCP keys:** `~/Desktop/personalAgents/mcp-keys/`

## Checklist

You MUST create a task for each item and complete them in order:

1. **Gather agent info** — collect all required parameters (see Info Gathering below)
2. **Create folder structure** — agentHome with all standard subdirs
3. **Write system prompt** — CLAUDE.md tailored to the agent's purpose
4. **Register new MCPs** — add any new MCP servers to the gateway config `mcps` block (skip if already registered)
5. **Add agent to config.json** — insert the agent entry into the `agents` block
6. **Validate config** — run `node -e "JSON.parse(require('fs').readFileSync('config.json','utf8'))"` to confirm valid JSON
7. **Validate config loads** — run `node -e "const {loadConfig}=require('./dist/config.js'); const c=loadConfig('./config.json'); console.log('Agent loaded:', c.agents['<agentId>'].name)"` to confirm the agent loads correctly
8. **Rebuild gateway** — `cd ~/Desktop/APPs/channelToAgentToClaude && npm run build`
9. **Restart service** — `launchctl unload ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist 2>/dev/null; launchctl load ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist`
10. **Connect MCP credentials** — if the agent has MCPs assigned, offer to set up credentials now (see MCP Credential Setup below)
11. **Confirm & summarize** — print summary of new agent

## Info Gathering

Collect these parameters. Ask **one question at a time** with defaults shown in brackets.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `agentId` | YES | — | Short kebab-case identifier (e.g., `my-agent`) |
| `name` | YES | — | Human-readable name |
| `description` | YES | — | One-line description |
| `mentionAlias` | YES | — | The @mention trigger. Must be unique across all agents. |
| `organization` | no | — | Org name (determines folder: personalAgents/<Org>/<agentId>/) |
| `function` | no | — | Department/function within the org |
| `title` | no | — | Role title (e.g., "Senior Engineer") |
| `reportsTo` | no | — | Alias of the agent this one reports to (e.g., "@cto") |
| `workspace` | no | `~` | Project/codebase the agent works ON |
| `agentHome` | no | auto | Agent's own folder. Auto: `~/Desktop/personalAgents/<Org>/<agentId>/` or `~/Desktop/personalAgents/<agentId>/` if no org |
| `persistent` | no | `true` | Remember conversations across messages |
| `streaming` | no | `true` | Real-time output in web UI |
| `advancedMemory` | no | `true` | Semantic search + daily logs + auto-compaction |
| `autonomousCapable` | no | `true` | Can have autonomous goals |
| `claudeAccount` | no | — | Which Anthropic account to use (from service.claudeAccounts) |
| `skills` | no | `[]` | Shared skills from ~/.claude/commands/ |
| `agentSkills` | no | `[]` | Agent-specific skills from agent/skills/ |
| `mcps` | no | `[]` | MCP names to attach. Show registered MCPs from config.json. |
| `tools` | no | all | Allowed tools. Default: Read, Edit, Write, Glob, Grep, Bash, WebFetch, WebSearch |
| `slackChannelId` | no | — | Slack channel ID |
| `telegramChatId` | no | — | Telegram chat ID |
| `imessageChatId` | no | — | iMessage chat ID |
| `discordChannelId` | no | — | Discord channel ID |
| `requireMention` | no | `true` | Require @mention to trigger |
| `autoCommit` | no | `false` | Auto-commit git changes after agent runs |
| `timeout` | no | `120000` | Max execution time in ms |

### Asking Flow

1. Ask for `agentId`, `name`, `description`, and `mentionAlias` together
2. Ask about `organization` — which org? Show existing orgs from config. Also ask function, title, reportsTo.
3. Ask about `workspace` — specific project or general use?
4. Show currently registered MCPs and ask which to attach
5. Ask about tools — full access, read-only, or custom?
6. Ask about skills — any shared skills to attach?
7. Ask about routes — which channels? Show current channel options with existing IDs for reference.
8. Ask about `claudeAccount` — show available accounts if configured
9. Ask about goals — any autonomous goals to set up?
10. Confirm all values before proceeding

## Folder Structure Created

```
~/Desktop/personalAgents/<Organization>/<agentId>/    ← agentHome
├── CLAUDE.md          # System prompt
├── memory/
│   ├── context.md     # Initial context
│   └── (conversation_log.jsonl — auto-created)
├── mcp-keys/          # Per-agent API keys (override shared)
├── skills/            # Per-agent skills
├── goals/             # Budget tracking + execution logs
├── tasks.json         # Kanban task board (projects + tasks)
└── FileStorage/
    ├── Temp/          # Temporary file uploads
    └── Permanent/     # Permanent file storage
```

If no organization specified, use `~/Desktop/personalAgents/<agentId>/`.

## Config.json Entry Template

```json
"<agentId>": {
  "name": "<name>",
  "description": "<description>",
  "agentHome": "<agentHome>",
  "workspace": "<workspace>",
  "claudeMd": "<agentHome>/CLAUDE.md",
  "memoryDir": "<agentHome>/memory",
  "persistent": true,
  "streaming": true,
  "advancedMemory": true,
  "autonomousCapable": true,
  "claudeAccount": "<claudeAccount>",
  "mcps": [<mcps>],
  "skills": [<skills>],
  "mentionAliases": ["<mentionAlias>"],
  "autoCommit": false,
  "allowedTools": [<tools>],
  "timeout": <timeout>,
  "org": [
    {
      "organization": "<organization>",
      "function": "<function>",
      "title": "<title>",
      "reportsTo": "<reportsTo>"
    }
  ],
  "goals": [],
  "cron": [],
  "routes": [
    {
      "channel": "telegram",
      "match": { "type": "chat_id", "value": "<telegramChatId>" },
      "permissions": { "allowFrom": ["*"], "requireMention": true }
    },
    {
      "channel": "slack",
      "match": { "type": "channel_id", "value": "<slackChannelId>" },
      "permissions": { "allowFrom": ["*"], "requireMention": true }
    }
  ]
}
```

Omit optional fields if not set: `claudeAccount`, `mcps`, `skills`, `org`, `goals`, `cron`.

## Goal Schema

Goals are autonomous tasks that run on a schedule (via node-cron heartbeat). The agent must have `autonomousCapable: true`. Each goal entry has this structure:

```json
{
  "id": "weekly-report",
  "enabled": true,
  "description": "What the agent is responsible for achieving",
  "successCriteria": "How to determine the goal is complete (optional)",
  "instructions": "Step-by-step guidance for the agent when the goal fires (optional)",
  "heartbeat": "0 9 * * 1",
  "budget": { "maxDailyUsd": 10 },
  "reportTo": ["telegram:-5112439418", "slack:C0ALHTDD6JF"]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | YES | Kebab-case identifier (e.g., `daily-briefing`, `weekly-audit`) |
| `enabled` | YES | `true` to activate, `false` to define but not schedule |
| `description` | YES | What the agent should do when the heartbeat fires |
| `successCriteria` | no | How to know the goal was achieved |
| `instructions` | no | Step-by-step guidance — gets injected into the prompt when the goal fires |
| `heartbeat` | YES | Cron expression for when to run (e.g., `"0 9 * * 1-5"` = weekdays at 9am, `"0 6 * * 1"` = Mondays at 6am) |
| `budget` | no | `{ "maxDailyUsd": N }` — daily spend cap. Goal pauses if exceeded. |
| `reportTo` | no | Where to send results. Single channel: `"telegram:-5112439418"`. Multiple channels: `["telegram:-5112439418", "slack:C0ALHTDD6JF"]`. Results are sent to ALL listed channels. |

### How Goals Execute

1. At the scheduled heartbeat time (or via "Trigger Now"), the gateway creates a synthetic message with the goal prompt
2. The goal prompt includes: description, success criteria, instructions, and remaining budget
3. The agent executes via `executeAgent()` like any normal message
4. Results are sent to ALL `reportTo` channels (if configured)
5. Execution is logged to `<agentHome>/goals/log-YYYY-MM-DD.jsonl`
6. Budget is tracked in `<agentHome>/goals/budget-YYYY-MM-DD.json`

### Trigger Now

Goals can be triggered manually via the org page (Trigger Now button) or API:
```
POST /api/agents/<agentId>/goals/<goalId>/trigger
```
The goal executes immediately in the background and reports to configured channels. Budget rules still apply.

### Common Cron Patterns

| Pattern | Meaning |
|---------|---------|
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `0 6 * * 1` | Every Monday at 6:00 AM |
| `0 */4 * * *` | Every 4 hours |
| `0 8 * * *` | Daily at 8:00 AM |
| `0 9 1 * *` | First day of every month at 9:00 AM |

### On-demand Goals

Set `"enabled": false` to define the goal without scheduling it. The goal metadata is available in the agent's config but no heartbeat fires. The user can trigger it manually by messaging the agent.

## CLAUDE.md Template

```markdown
# <name>

<description — expanded into 2-3 sentences about the agent's role>

## Identity
- Mention alias: <mentionAlias>
- Respond when mentioned with <mentionAlias>

## Capabilities
- <list tools in plain English>
- <list MCPs and what they do>

## Guidelines
- Keep responses concise — you're replying to phone messages
- If a task requires multiple steps, summarize what you did
- If you need clarification, ask
<additional guidelines based on purpose>
```

## Validation

After editing config.json, ALWAYS validate:

```bash
cd ~/Desktop/APPs/channelToAgentToClaude
node -e "JSON.parse(require('fs').readFileSync('config.json','utf8')); console.log('Valid JSON')"
node -e "const {loadConfig}=require('./dist/config.js'); const c=loadConfig('./config.json'); const a=c.agents['<agentId>']; console.log('Name:', a.name, 'Home:', a.agentHome, 'Routes:', a.routes.length)"
```

## MCP Credential Setup

After the agent is created and the service restarted, if the agent has MCPs assigned, offer to connect credentials.

### Step 1: Check which MCPs need credentials

Read `mcp-catalog.json` to find `requiredKeys` for each assigned MCP. MCPs with empty `requiredKeys` (like Lighthouse) don't need setup.

### Step 2: For each MCP that needs credentials, ask the user

**For OAuth MCPs** (Google services — gmail, googlecalendar, googledrive, googlesheets, googledocs, youtube):
1. Ask: "Want to connect a Google account for [MCP name]?"
2. If yes, tell them to visit the authorize URL: `https://[slug]mcp.agenticledger.ai/authorize`
3. After they authorize, ask them to paste the refresh token
4. Save to `<agentHome>/mcp-keys/<mcp-name>.env` as `<ENV_VAR>=<token>`

**For key-based MCPs** (Stripe, Smartsheet, etc.):
1. Ask: "Do you have the API key for [MCP name]?"
2. If yes, save to `<agentHome>/mcp-keys/<mcp-name>.env` as `<ENV_VAR>=<key>`
3. If no, tell them they can add it later from the org page (Config → MCP Connections)

### Step 3: Multi-account support

If the user wants multiple accounts for the same MCP (e.g., 3 Gmail accounts):
1. Ask for a label for each account (e.g., "Work", "Personal", "Client")
2. Ask for a description (e.g., email address)
3. For each account, use the connections API:
   ```bash
   curl -s -X POST http://localhost:4888/api/agents/<agentId>/mcp-connections \
     -H "Content-Type: application/json" \
     -d '{"baseMcp":"gmail","label":"Work","envVar":"GMAIL_WORK","value":"<token>","description":"ore@agenticledger.ai"}'
   ```
   This creates a named instance (e.g., `gmail-work`) in config.json, saves the key, and stores metadata for the executor to inject into the agent's system prompt.
4. The agent will automatically see an MCP Account Mapping table in its system prompt showing which MCP instance maps to which account.

### Step 4: Skip option

If the user doesn't want to set up credentials now, that's fine. Tell them:
"You can connect MCP credentials anytime from the org page — open the agent's Config and use the MCP Connections section."

## Important Notes

- **Unique aliases:** Check existing agents before confirming an alias
- **Tilde paths:** Use `~/` prefix — resolved at load time
- **Org-based folders:** Agents in an org go to `personalAgents/<Org>/<agentId>/`
- **Multi Org agents:** If agent is in multiple orgs, use `personalAgents/Multi Org/<agentId>/`
- **Same channel, multiple agents:** Differentiated by @mention alias
- **No code changes needed:** Adding an agent is config + files only
