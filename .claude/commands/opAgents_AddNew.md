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
10. **Confirm & summarize** — print summary of new agent

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
| `instructions` | no | auto | Custom CLAUDE.md content. If provided, use this verbatim instead of the template. If not provided, generate from name/description using the template below. |
| `cron` | no | `[]` | Scheduled messages. Each entry: `{ schedule, message, channel, chatId }`. Schedule is cron syntax (e.g., `"0 9 * * 1-5"` = 9am weekdays). |
| `goals` | no | `[]` | Autonomous goals. Each entry: `{ id, enabled, description, successCriteria, instructions, heartbeat: { schedule }, budget: { dailyUsd }, reportTo: { channel, chatId } }` |

### Asking Flow

1. Ask for `agentId`, `name`, `description`, and `mentionAlias` together
2. Ask about `organization` — which org? Show existing orgs from config. Also ask function, title, reportsTo.
3. Ask about `workspace` — specific project or general use?
4. Ask about custom instructions — do they want to write a custom system prompt, or use the auto-generated template? If custom, collect the full text.
5. Show currently registered MCPs and ask which to attach
6. Ask about tools — full access, read-only, or custom?
7. Ask about skills — any shared skills to attach?
8. Ask about routes — which channels? Show current channel options with existing IDs for reference.
9. Ask about `claudeAccount` — show available accounts if configured
10. Ask about scheduled tasks (cron) — any recurring messages? E.g., "check deployment status every morning at 9am". Collect: frequency, time, message text, which channel to send on.
11. Ask about autonomous goals — any ongoing responsibilities? E.g., "monitor uptime and alert if down". Collect: description, success criteria, instructions, heartbeat schedule, daily budget, reporting channel.
12. Confirm all values before proceeding

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
  "goals": [
    {
      "id": "<goalId>",
      "enabled": true,
      "description": "<what the agent is responsible for>",
      "successCriteria": "<how we know it's done>",
      "instructions": "<step by step guidance>",
      "heartbeat": { "schedule": "<cron expression>" },
      "budget": { "dailyUsd": 5.00 },
      "reportTo": { "channel": "<channel>", "chatId": "<chatId>" }
    }
  ],
  "cron": [
    {
      "schedule": "<cron expression, e.g. 0 9 * * 1-5>",
      "message": "<what to tell the agent>",
      "channel": "<channel to reply on>",
      "chatId": "<chatId to reply in>"
    }
  ],
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

Omit optional fields if not set: `claudeAccount`, `mcps`, `skills`, `org`. Use empty arrays `[]` for `goals` and `cron` if none configured.

### Cron Schedule Reference

Common cron patterns for the `schedule` field:
- `"0 9 * * 1-5"` — 9am weekdays
- `"0 9 * * 1"` — 9am every Monday
- `"0 */2 * * *"` — every 2 hours
- `"*/30 * * * *"` — every 30 minutes
- `"0 18 * * *"` — 6pm daily

### Goals Reference

Goals give an agent autonomous responsibilities that run on a heartbeat schedule. Each goal execution:
- Runs the agent with the goal instructions as the prompt
- Tracks API spend against the daily budget
- Reports results to the configured channel
- The heartbeat `schedule` uses cron syntax (same as above)

## CLAUDE.md — Custom vs Template

**If the user provided custom `instructions`:** Write their text verbatim as the CLAUDE.md content. Do NOT wrap it in a template or add sections they didn't ask for.

**If no custom instructions provided:** Generate from this template:

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

## Important Notes

- **Unique aliases:** Check existing agents before confirming an alias
- **Tilde paths:** Use `~/` prefix — resolved at load time
- **Org-based folders:** Agents in an org go to `personalAgents/<Org>/<agentId>/`
- **Multi Org agents:** If agent is in multiple orgs, use `personalAgents/Multi Org/<agentId>/`
- **Same channel, multiple agents:** Differentiated by @mention alias
- **No code changes needed:** Adding an agent is config + files only
