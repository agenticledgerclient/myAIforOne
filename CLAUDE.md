# MyAgent

Multi-channel agent gateway — chat with Claude Code agents from your phone via Telegram, Slack, Discord, iMessage, and WhatsApp.

## First-Time Setup

Run `/setup` to get started. Creates a general-purpose agent and configures your channels.

## Adding Specialized Agents

After setup, create purpose-built agents for specific projects or roles:

- **From chat:** Message `@agentcreator` — "I need an agent for managing my React project". It creates agents through conversation, no forms needed.
- **From the Web UI:** Go to http://localhost:4888/org → click **+ New Agent** → fill out the form
- **What makes an agent specialized:**
  - **Workspace** — point it at a specific project directory instead of ~
  - **System prompt** — describe its role, expertise, and constraints in CLAUDE.md
  - **Tools** — limit to read-only (Read, Glob, Grep) for monitoring agents, or full access for builders
  - **MCPs** — give it only the API integrations it needs (e.g., a finance agent gets Stripe + QuickBooks)
  - **Advanced memory** — set `advancedMemory: true` for agents that need long-term semantic recall across sessions (daily journals + vector search)
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

### As a launchd service on macOS (auto-start on login)
```bash
launchctl load ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist
launchctl unload ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist  # stop
```

### As a Task Scheduler service on Windows (auto-start on login)
```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1    # install
schtasks /Run /TN MyAgentGateway                                                # start now
schtasks /End /TN MyAgentGateway                                                # stop
schtasks /Query /TN MyAgentGateway                                              # status
powershell -ExecutionPolicy Bypass -File scripts\uninstall-service-windows.ps1  # uninstall
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
4. Run `/opappbuild_agentready_trueup` — updates API docs, MCP tools, and MCP docs to match new endpoints
5. Run `/opappbuild_testsuite_trueup` — adds test coverage for new endpoints

## Related Projects

- **SaaS version** (`myAI41_saas`) — multi-tenant fork at `~/Desktop/APPs/myAI41_saas`, managed by `@ma41saas`. After significant architectural or API changes here, flag whether the SaaS version may need the same update.

## SaaS Port Workflow

After committing changes to the local install, **ask the user**: "Want me to create a port task for @ma41saas?" Do NOT auto-create tasks.

If yes:
1. Create a task in `~/Desktop/MyAIforOne Drive/PersonalAgents/AgenticLedger Builds/ma41saas/tasks.json` with status `approved`, owner `@ma41saas`, assignedBy `@myagentdev`
2. Include commit SHAs, affected files, and what needs adapting for SaaS (Prisma, auth, etc.)
3. Log the commits as `tasked` in the port tracking file (see below)

If no/skip:
1. Log the commits as `skipped` with a reason in the port tracking file

### Port Tracking

Track which local install commits have been flagged for SaaS porting in:
`~/Desktop/MyAIforOne Drive/PersonalAgents/AgenticLedger Builds/ma41saas/tasks/port-tracking.md`

Format:
```
| Commit | Date | Summary | Status | Task ID |
| abc1234 | 2026-04-01 | feat: view toggle | tasked | ma41saas_123 |
| def5678 | 2026-04-01 | fix: typo | skipped (cosmetic) | — |
```

When the user asks "what's outstanding?" or "what needs porting?", diff `git log` against this file to find untasked commits.
