# MyAgent

Multi-channel agent gateway — chat with Claude Code agents from your phone via Telegram, Slack, Discord, iMessage, and WhatsApp.

## First-Time Setup

Run `/setup` to get started. Creates a general-purpose agent and configures your channels.

## Adding Specialized Agents

After setup, create purpose-built agents for specific projects or roles:

- **From the Web UI:** Go to http://localhost:4888/org → click **+ New Agent** → fill out the form
- **From chat:** Message your general agent: "Create a new agent for managing my project X" — it knows how to do this
- **What makes an agent specialized:**
  - **Workspace** — point it at a specific project directory instead of ~
  - **System prompt** — describe its role, expertise, and constraints in CLAUDE.md
  - **Tools** — limit to read-only (Read, Glob, Grep) for monitoring agents, or full access for builders
  - **MCPs** — give it only the API integrations it needs (e.g., a finance agent gets Stripe + QuickBooks)
  - **Org placement** — assign it an organization, department, title, and reporting chain

See [docs/Architecture.md](docs/Architecture.md) for full config reference.

## Project Structure

- `src/` — TypeScript source (config, router, executor, channel drivers)
- `agents/` — Per-agent directories (CLAUDE.md system prompt, memory, agent.json)
- `config.json` — Runtime config (channels, agents, MCPs, routes). Gitignored (contains tokens).
- `config.example.json` — Template for config.json
- `docs/` — Guides for common operations

## Guides

- **Adding a new MCP server**: See [docs/AddNewMcpGuide.md](docs/AddNewMcpGuide.md)
- **Adding a new agent**: See [docs/AddNewAgentGuide.md](docs/AddNewAgentGuide.md)

## Running

```bash
npm run build          # Compile TypeScript
npm start              # Run directly
```

### As a launchd service (auto-start on login)
```bash
launchctl load ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist
launchctl unload ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist  # stop
```

## Key Architecture

- **Router** (`src/router.ts`): Matches messages by channel + chat ID + mention alias
- **Executor** (`src/executor.ts`): Spawns `claude -p` with system prompt, workspace, allowed tools, and MCP config
- **MCP Hub** (`config.json` → `mcps`): Registry of MCP servers. Agents reference them by name. Executor auto-generates temp `.mcp.json` and passes `--mcp-config --strict-mcp-config` to claude.
- **Channels**: Independent drivers for iMessage (`imsg` CLI), Slack (Socket Mode), Telegram (grammY), Discord (discord.js), WhatsApp (Baileys)
- **Web UI** (`src/web-ui.ts`): Dashboard + webhook endpoints on localhost:8080
- **Cron** (`src/cron.ts`): Scheduled message triggers via node-cron

## After Every Feature
1. Add tests to `Comprehensive Test Suite/{domain}/`
2. Run all tests: `node "Comprehensive Test Suite/run-all-tests.js"`
3. ALL tests must pass before committing
