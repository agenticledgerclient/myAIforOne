---
name: opAgents_AddNew
description: Add a new agent to the channelToAgentToClaude gateway. Gathers agent info (or accepts it inline), creates folder structure, writes system prompt, updates config.json, registers MCPs, rebuilds, and restarts the service. Use when adding a new phone-accessible Claude agent.
---

# Add New Agent — channelToAgentToClaude Gateway

Add a new agent to the phone-accessible Claude agent gateway at `~/Desktop/APPs/channelToAgentToClaude`.

## Key Paths

- **Gateway project:** `~/Desktop/APPs/channelToAgentToClaude`
- **Gateway config:** `~/Desktop/APPs/channelToAgentToClaude/config.json`
- **Default agent home:** `~/Desktop/personalAgents/<agentId>/`
- **Existing agents guide:** `~/Desktop/APPs/channelToAgentToClaude/docs/AddNewAgentGuide.md`

## Checklist

You MUST create a task for each item and complete them in order:

1. **Gather agent info** — collect all required parameters (see Info Gathering below)
2. **Create folder structure** — agent home dir, memory dir, CLAUDE.md, context.md
3. **Write system prompt** — CLAUDE.md tailored to the agent's purpose
4. **Register new MCPs** — add any new MCP servers to the gateway config `mcps` block (skip if all MCPs already registered)
5. **Add agent to config.json** — insert the agent entry into the `agents` block
6. **Validate config** — run `node -e "JSON.parse(require('fs').readFileSync('config.json','utf8'))"` to confirm valid JSON
7. **Validate config loads** — run `node -e "const {loadConfig}=require('./dist/config.js'); const c=loadConfig('./config.json'); console.log('Agent loaded:', c.agents['<agentId>'].name)"` to confirm the agent loads correctly with all paths resolved
8. **Rebuild gateway** — `cd ~/Desktop/APPs/channelToAgentToClaude && npm run build`
9. **Restart service** — ask user whether to restart now, then: `cd ~/Desktop/APPs/channelToAgentToClaude && launchctl unload ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist 2>/dev/null; launchctl load ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist` (or `npm run dev` if running manually)
10. **Confirm & summarize** — print a summary of the new agent: name, alias, routes, MCPs, tools, folder location

## Info Gathering

Collect these parameters. If the user provided them inline (e.g., `/opAgents_AddNew name=myAgent alias=@mybot`), use those values. Otherwise, ask for each one — **one question at a time**, with sensible defaults shown in brackets.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `agentId` | YES | — | Short kebab-case identifier (e.g., `my-agent`). Used as config key and folder name. |
| `name` | YES | — | Human-readable name (e.g., "My Agent") |
| `description` | YES | — | One-line description of what the agent does |
| `mentionAlias` | YES | — | The @mention trigger (e.g., `@mybot`). Must be unique across all agents. |
| `workspace` | no | `~` | Directory Claude operates in. Use `~` for general-purpose, or a specific project path. |
| `agentHome` | no | `~/Desktop/personalAgents/<agentId>/` | Where CLAUDE.md, memory, and agent files live. |
| `slackChannelId` | no | — | Slack channel ID for routing. Right-click channel > View details > bottom. |
| `imessageChatId` | no | — | iMessage chat ID. Run `imsg chats --json` to discover. |
| `whatsappJid` | no | — | WhatsApp group JID. |
| `mcps` | no | `[]` | List of MCP names to attach. Show currently registered MCPs from config.json. |
| `tools` | no | `["Read", "Edit", "Write", "Glob", "Grep", "Bash"]` | Allowed tools. For read-only agents: `["Read", "Glob", "Grep"]`. For full access add `"WebFetch", "WebSearch"`. |
| `autoCommit` | no | `false` | Auto-commit git changes after agent runs. |
| `autoCommitBranch` | no | `main` | Branch to commit to (only if autoCommit=true). |
| `requireMention` | no | `true` | Whether messages must @mention the alias to trigger this agent. |
| `allowFrom` | no | `["*"]` | Who can message this agent. `["*"]` = everyone. |
| `timeout` | no | `120000` | Max execution time in ms. |

### Asking Flow

1. Ask for `agentId`, `name`, `description`, and `mentionAlias` together (these are always needed)
2. Ask about `workspace` — is this for a specific project or general use?
3. Show currently registered MCPs from config.json and ask which to attach (plus any new ones to register)
4. Ask about tools — full access, read-only, or custom?
5. Ask about routes — which channels? Show current channel options. For each channel, ask for the ID.
6. Ask about autoCommit (only if workspace is a git repo)
7. Confirm all values before proceeding

## Folder Structure Created

```
~/Desktop/personalAgents/<agentId>/    ← agentHome (agent's own folder)
├── CLAUDE.md          # System prompt (generated from description + purpose)
├── memory/
│   ├── context.md     # Initial context doc
│   └── (conversation_log.jsonl created automatically by the gateway)
├── mcp-keys/          # Per-agent API keys (override shared keys)
├── skills/            # Per-agent skills
├── goals/             # Budget tracking and goal execution logs
│   ├── budget/        # Daily budget usage tracking per goal
│   └── logs/          # Execution logs from goal heartbeats
└── FileStorage/
    ├── Temp/          # Temporary file uploads (per-message)
    └── Permanent/     # Permanent file storage

Note: agentHome is the agent's own folder (identity, memory, files).
workspace is the project/codebase it works on (separate concept).
```

## Config.json Entry Template

```json
"<agentId>": {
  "name": "<name>",
  "description": "<description>",
  "agentHome": "<agentHome>",
  "workspace": "<workspace>",
  "claudeMd": "<agentHome>/CLAUDE.md",
  "memoryDir": "<agentHome>/memory",
  "mcps": [<mcps>],
  "mentionAliases": ["<mentionAlias>"],
  "autoCommit": <autoCommit>,
  "autoCommitBranch": "<autoCommitBranch>",
  "autonomousCapable": true,
  "allowedTools": [<tools>],
  "timeout": <timeout>,
  "goals": [
    {
      "id": "example-goal",
      "enabled": true,
      "description": "What this agent is responsible for",
      "successCriteria": "How we know it's done",
      "instructions": "Step by step guidance (optional)",
      "heartbeat": "0 9 * * 1-5",
      "budget": { "maxDailyUsd": 5.00 },
      "reportTo": "telegram:-5274444946"
    }
  ],
  "routes": [
    {
      "channel": "slack",
      "match": { "type": "channel_id", "value": "<slackChannelId>" },
      "permissions": { "allowFrom": <allowFrom>, "requireMention": <requireMention> }
    },
    {
      "channel": "imessage",
      "match": { "type": "chat_id", "value": <imessageChatId> },
      "permissions": { "allowFrom": <allowFrom>, "requireMention": <requireMention> }
    }
  ]
}
```

Only include routes for channels the user specifies. Omit `autoCommitBranch` if `autoCommit` is false. Omit `mcps` if empty. Omit `goals` if none configured.

## CLAUDE.md Template

Generate a system prompt tailored to the agent's purpose. Use this structure:

```markdown
# <name>

<description — expanded into 2-3 sentences about the agent's role and capabilities>

## Identity
- Mention alias: <mentionAlias>
- You respond when mentioned with <mentionAlias> in the configured channels

## Capabilities
- <list tools in plain English>
- <list MCPs and what they do>

## Guidelines
- Keep responses concise — you're replying to phone messages, not writing essays
- If a task requires multiple steps, summarize what you did and the outcome
- If you need clarification, ask — don't guess
<additional guidelines based on the agent's purpose>
```

## Registering New MCPs

If the user wants MCPs that aren't in the gateway config yet, add them to the top-level `mcps` block. Common patterns:

```json
// stdio — local process
"<name>": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "<package-name>"],
  "env": { "<KEY>": "<value>" }
}

// http — remote server
"<name>": {
  "type": "http",
  "url": "https://<url>",
  "headers": { "Authorization": "Bearer <token>" }
}

// sse — server-sent events
"<name>": {
  "type": "sse",
  "url": "https://<url>"
}
```

## Validation

After editing config.json, ALWAYS run both validation steps:

```bash
# 1. Valid JSON?
cd ~/Desktop/APPs/channelToAgentToClaude && node -e "JSON.parse(require('fs').readFileSync('config.json','utf8')); console.log('Valid JSON')"

# 2. Config loads correctly?
cd ~/Desktop/APPs/channelToAgentToClaude && node -e "
const {loadConfig}=require('./dist/config.js');
const c=loadConfig('./config.json');
const a=c.agents['<agentId>'];
console.log('Name:', a.name);
console.log('Workspace:', a.workspace);
console.log('ClaudeMd:', a.claudeMd);
console.log('MemoryDir:', a.memoryDir);
console.log('MCPs:', a.mcps || 'none');
console.log('Aliases:', a.mentionAliases);
console.log('Tools:', a.allowedTools);
console.log('Routes:', a.routes.length);
"
```

If either fails, fix the issue before proceeding.

## Important Notes

- **Unique aliases:** The mention alias MUST be unique across all agents. Check existing agents in config.json before confirming.
- **Tilde paths:** Use `~/` prefix for paths — the gateway resolves these to absolute paths at load time.
- **Same channel, different agents:** Multiple agents can share the same Slack channel or iMessage thread — they're differentiated by their @mention alias (requires `requireMention: true`).
- **No code changes needed:** Adding an agent is purely config + files. The gateway code handles everything generically.
