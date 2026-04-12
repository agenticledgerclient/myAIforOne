# MyAgent

Multi-channel agent gateway — chat with Claude Code agents from your phone via Telegram, Slack, Discord, iMessage, and WhatsApp.

## What It Does

```
Your Phone (Telegram, Slack, iMessage, Discord, WhatsApp)
    → Gateway routes message by @mention alias
    → Agent runs claude -p in its workspace
    → Real-time streaming response sent back
    → Web UI at localhost:4888 for dashboard + chat
```

Each agent has its own identity, workspace, system prompt, memory, tools, and MCP integrations. One service, unlimited agents, all channels.

## Features

- **Multi-channel** — Telegram, Slack, Discord, iMessage, WhatsApp, Web UI
- **Persistent sessions** — agents remember conversations across messages
- **Real-time streaming** — token-by-token output in the web UI
- **Advanced memory** — semantic search + daily journals + auto-compaction
- **39 pre-hosted MCPs** — Stripe, QuickBooks, HubSpot, and more. Bring your API key, use our servers.
- **Autonomous goals** — agents with heartbeat schedules and budget tracking
- **Cron schedules** — recurring tasks (price alerts, daily reports, monitoring)
- **Org chart** — organize agents by department with reporting hierarchies
- **Task kanban** — assign and track work across agents
- **Agent Creator** — create new agents through conversation, no forms

## Getting Started

### Fastest path (have Node.js?)

```bash
npx myaiforone
```

One command. It checks for Claude Code CLI (installs if missing), authenticates, builds, and launches. If anything fails, it tells you exactly what to paste into Claude for help.

### New to the command line?

Open [claude.ai](https://claude.ai) and share the contents of [docs/CLAUDE-AI-SETUP.md](docs/CLAUDE-AI-SETUP.md). Claude will walk you through installing Node.js, Claude Code CLI, and everything else — step by step, conversationally.

### Manual setup

```bash
git clone https://github.com/agenticledgerclient/myAIforOne.git
cd myAIforOne
npm install
```

Then open Claude Code in this directory and run `/setup`. It walks you through:

1. Connecting your channels (Telegram, Slack, etc.)
2. Creating your first agent
3. Auto-creating 5 template agents that demonstrate every feature
4. Starting the service

After setup, you'll have 6 agents ready to go:

| Agent | Alias | What it does |
|-------|-------|-------------|
| Your Agent | `@yourname` | General-purpose assistant |
| Agent Creator | `@agentcreator` | Creates new agents through conversation |
| Daily Digest | `@digest` | Morning briefing of agent fleet activity |
| Crypto Price | `@crypto` | BTC/ETH prices every 4 hours |
| Journal | `@journal` | Personal memory with semantic recall |
| Market Watch | `@market` | Stock/crypto lookups via web search |

## Web UI

```
http://localhost:4888/ui     — Chat with agents
http://localhost:4888/org    — Org chart + agent management
http://localhost:4888/tasks  — Kanban task board
```

## Adding Agents

Message `@agentcreator`:

> "I need a coding agent for my React project at ~/Desktop/myapp"

It asks a few questions, then creates the agent — folder structure, system prompt, config, channels — and restarts the service. No forms.

## MCP Integrations

39 HTTP MCP servers are pre-registered. To connect one to an agent:

1. Get your API key for the service (e.g., Stripe secret key)
2. Tell `@agentcreator` to attach it, or add it via the web UI
3. The MCP server runs on our infrastructure — you just provide the key

See `mcp-catalog.json` for the full list with categories and required keys.

## Documentation

- [Architecture Reference](docs/Architecture.md) — full platform documentation
- [Add New Agent Guide](docs/AddNewAgentGuide.md) — manual agent creation
- [Add New MCP Guide](docs/AddNewMcpGuide.md) — connecting MCP servers

## Running as a Service

### macOS (launchd)
The `/setup` wizard offers to install this automatically. Or manually:
```bash
npm start                    # Run directly
# Or install as auto-start service — see /setup
```

## Licensing

MyAIforOne requires a license key to activate agents. When you first open the web UI, a license activation popup will appear. Enter your key (`MA1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) to activate. You can also enter it later in Admin → Settings → License.

Without a license key, you can browse the web UI but agents won't execute.

## License

MIT
