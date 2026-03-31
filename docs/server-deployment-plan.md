# MyAgent Server Deployment Plan

## Vision

Enable finance teams (and any department) to use MyAgent without local installs. One server instance per client/team, accessible via Slack and Web UI. Power users with local installs can push/pull agents between instances.

**Two independent workstreams:**
1. **Server Mode** — deploy MyAgent to a server so teams access it via browser and Slack
2. **Push/Pull Sync** — local installs can push agents to and pull from any server instance

---

## Architecture

```
POWER USER (local Mac)                    TEAM MEMBERS
├── Personal agents                       │
├── iMessage, Telegram, Slack             │ No install needed
├── Personal Claude subscription          │ Just use Slack + browser
├── Push/pull to any server               │
│                                         ▼
│   ┌─────────────────────────────────────────────────┐
└──▶│  SERVER INSTANCE (Railway/VPS)                   │◀── Team accesses
    │                                                  │
    │  MyAgent (same codebase, server mode config)     │
    │  ├── Web UI (https://team-url.com)               │
    │  ├── Slack bot (@team-bot)                        │
    │  ├── Telegram bot (optional)                      │
    │  ├── Discord bot (optional)                       │
    │  ├── ✗ No iMessage (requires local Mac)           │
    │  │                                                │
    │  ├── Executor: Anthropic Messages API (not CLI)   │
    │  ├── Auth: login gate for Web UI + API            │
    │  ├── Users: per-user conversation isolation        │
    │  └── Agents: shared across team                   │
    └──────────────────────────────────────────────────┘
```

**Key principle:** Same codebase, different config. `config.json` determines whether the instance runs in `local` mode (CLI executor, no auth) or `server` mode (API executor, auth enabled).

---

## Workstream 1: Server Mode

### Phase 1: API Executor Backend

The current executor shells out to `claude -p` which requires a personal Claude subscription logged in on the machine. The server needs to call the Anthropic Messages API directly with an API key.

- [ ] **1.1 Design executor interface**
  - Define a common interface that both CLI and API executors implement
  - Input: system prompt, user message, allowed tools, MCP config, workspace
  - Output: response text (sync) or stream of events (streaming)
  - Both executors must support: tool use, streaming, conversation persistence

- [ ] **1.2 Implement API executor (non-streaming)**
  - New file: `src/executor-api.ts`
  - Call Anthropic Messages API (`POST /v1/messages`)
  - Pass system prompt as `system` parameter
  - Map allowed tools to Anthropic tool definitions
  - Handle tool use loop (agent calls tool → execute tool → return result → continue)
  - Tool execution: implement safe sandboxed execution for Read, Write, Edit, Glob, Grep, Bash
  - Return final text response
  - Config: `anthropicApiKey` in `config.json` service section
  - Model selection: configurable per agent or global default (claude-sonnet-4-20250514)

- [ ] **1.3 Implement API executor (streaming)**
  - Same as 1.2 but using Anthropic streaming API
  - Emit `StreamEvent` objects matching the existing streaming interface
  - Support: `text`, `tool_use`, `thinking`, `status`, `done`, `error` event types
  - Handle tool use loop within the stream
  - Wire into `executeAgentStreaming()` code path

- [ ] **1.4 Tool execution sandbox**
  - Implement tool handlers that the API executor calls when the model uses tools
  - Tools to support: Read, Write, Edit, Glob, Grep, Bash, WebFetch, WebSearch
  - Bash: sandboxed execution with timeout, working directory = agent workspace
  - File tools: scoped to agent workspace + agent home directories
  - Security: prevent path traversal, command injection
  - MCP tool proxying: forward MCP tool calls to configured MCP servers

- [ ] **1.5 Conversation persistence for API executor**
  - CLI executor uses Claude's built-in session management (`--resume`)
  - API executor needs its own conversation state
  - Store message history per agent per user in `memory/sessions/`
  - Support session reset (clear history)
  - Implement context window management (truncate old messages when approaching limit)
  - Support compaction (summarize old messages to save context)

- [ ] **1.6 Executor selection in config**
  - Add `service.executorBackend: "cli" | "api"` to config schema
  - Add `service.anthropicApiKey` for API mode
  - Add `service.defaultModel` for API mode (default: claude-sonnet-4-20250514)
  - Per-agent model override: `agent.model` field
  - Router selects executor based on config at startup
  - CLI mode: current behavior, no changes
  - API mode: use new executor, requires API key

- [ ] **1.7 Test API executor end-to-end**
  - Unit tests for tool execution handlers
  - Integration test: send message → get response with tool use
  - Streaming test: verify event stream matches expected format
  - Compare output quality: CLI vs API on same prompts
  - Verify MCP tool proxying works
  - Test conversation persistence across messages

---

### Phase 2: Authentication & User Identity

The Web UI and API need login protection. Team members need individual identities so conversations are isolated.

- [ ] **2.1 Auth middleware design**
  - Decide auth method: invite code (simple) vs OAuth/SSO (enterprise)
  - Start with invite code + session cookie (simplest viable)
  - Admin generates invite codes, team members redeem to create account
  - Session stored server-side (in-memory + file-backed)
  - All API routes protected except: `/health`, `/login`, `/api/auth/*`

- [ ] **2.2 User model**
  - User record: `{ id, name, email, role, createdAt }`
  - Roles: `admin` (full access, create agents, manage users) and `user` (chat, browse)
  - Store in `data/users.json` (file-based, no database dependency)
  - Admin user created during setup

- [ ] **2.3 Login flow**
  - `GET /login` — login page (HTML)
  - `POST /api/auth/login` — validate invite code or credentials, set session cookie
  - `POST /api/auth/logout` — clear session
  - `GET /api/auth/me` — return current user info
  - Session cookie: `HttpOnly`, `SameSite=Strict`, configurable expiry
  - Rate limiting on login attempts

- [ ] **2.4 Auth middleware implementation**
  - Express middleware: check session cookie on every request
  - Skip auth for: static assets, `/health`, `/login`, `/api/auth/*`
  - Attach `req.user` to authenticated requests
  - Return 401 for unauthenticated API calls
  - Redirect to `/login` for unauthenticated page loads

- [ ] **2.5 Admin panel**
  - `/admin` page (admin role only)
  - Manage users: list, invite, deactivate
  - Generate invite codes
  - View system status, active sessions
  - Can be a simple addition to the existing settings page

- [ ] **2.6 Wire user identity to messages**
  - Web UI: attach authenticated user ID to chat messages
  - Slack: map Slack user ID to platform user (auto-create on first message)
  - Telegram: map Telegram user ID to platform user
  - `InboundMessage.sender` populated with actual user identity
  - Conversation logs tagged with user ID

- [ ] **2.7 Per-user conversation isolation**
  - `perSenderSessions` flag already exists in executor
  - Enable by default in server mode
  - Each user gets their own conversation history with each agent
  - Agent sees: "Message from [User Name]:" prefix (optional, configurable)
  - Conversation log stored per user: `memory/sessions/{userId}/conversation_log.jsonl`

- [ ] **2.8 Auth configuration**
  - Add to config schema:
    ```json
    "auth": {
      "enabled": true,
      "method": "invite-code",
      "sessionSecret": "random-secret",
      "sessionMaxAge": 86400000,
      "adminEmail": "admin@company.com"
    }
    ```
  - Auth disabled by default (local mode)
  - Auth enabled when `service.mode === "server"` or `auth.enabled === true`

---

### Phase 3: Server Deployment

Get MyAgent running on Railway with the new server mode features.

- [ ] **3.1 Railway deployment config**
  - `Dockerfile` or `nixpacks.toml` for Railway
  - Build step: `npm run build`
  - Start command: `npm start`
  - Environment variables: `ANTHROPIC_API_KEY`, `SESSION_SECRET`, `PORT`
  - Health check: `GET /health`

- [ ] **3.2 Config for server mode**
  - `config.server-example.json` — template for server deployments
  - Pre-configured: `executorBackend: "api"`, `auth.enabled: true`
  - Channels: Slack + web enabled, iMessage disabled
  - No personal agents dir (agents defined in config or created via UI)
  - `personalAgentsDir` points to a server-local directory

- [ ] **3.3 Setup wizard for server mode**
  - Detect `--server` flag or `SERVICE_MODE=server` env var
  - Skip iMessage setup
  - Prompt for Anthropic API key
  - Generate admin invite code
  - Generate session secret
  - Create initial admin user

- [ ] **3.4 Static asset serving**
  - Ensure all Web UI pages work when served from Railway URL
  - No hardcoded `localhost` references in frontend
  - API URLs use relative paths (already the case)
  - WebSocket/SSE connections use same origin

- [ ] **3.5 File storage on server**
  - Agent home directories: `/app/agents/` on Railway
  - File uploads: `/app/data/uploads/`
  - Conversation logs: `/app/data/logs/`
  - Persistent volume on Railway for data directory
  - Or: use Railway's persistent storage

- [ ] **3.6 Slack bot setup for server**
  - Document: create Slack app, get bot token + app token
  - Bot connects via Socket Mode from the server
  - Multiple agents in same workspace, mention-routing
  - Team members just `@mention` the bot in any channel

- [ ] **3.7 Deploy and verify**
  - Deploy to Railway
  - Verify: Web UI accessible at Railway URL
  - Verify: Slack bot connects and routes messages
  - Verify: Agent execution works via API executor
  - Verify: Auth gate works (can't access without login)
  - Verify: Per-user conversation isolation
  - Verify: File uploads work
  - Verify: Streaming works in Web UI

- [ ] **3.8 Deploy script/skill**
  - Create `/deploy-server` skill that automates Railway deployment
  - Handles: git push, Railway project setup, env vars, domain
  - Can be run from local install to deploy a new server instance

---

## Workstream 2: Push/Pull Sync

Enable power users to push agents/skills/prompts to server instances and pull from them.

### Phase 4: Remote Registry

- [ ] **4.1 Remotes config**
  - Add `remotes` section to `config.json`:
    ```json
    "remotes": {
      "finance-team": {
        "url": "https://finance-agents.up.railway.app",
        "apiKey": "server-api-key-here"
      },
      "bastion": {
        "url": "https://bastion-agents.up.railway.app",
        "apiKey": "another-key"
      }
    }
    ```
  - API key used for authenticating push/pull requests

- [ ] **4.2 Export API (server-side)**
  - `GET /api/marketplace/export/:type/:id` — export an agent, skill, prompt, or app
  - Returns a JSON package:
    ```json
    {
      "type": "agent",
      "id": "tax-analyst",
      "config": { ... },
      "claudeMd": "# Tax Analyst\n...",
      "skills": [{ "name": "skill-name", "content": "..." }],
      "prompts": [{ "name": "prompt-name", "content": "..." }]
    }
    ```
  - Strips: routes, conversation history, memory, API keys
  - Keeps: CLAUDE.md, config (tools, MCPs, timeout, org), skills content

- [ ] **4.3 Import API (server-side)**
  - `POST /api/marketplace/import` — import an agent/skill/prompt package
  - Validates the package
  - Creates agent directory, writes CLAUDE.md, registers in config
  - Generates default web route for imported agent
  - Returns: created agent ID, alias
  - Auth: requires admin role

- [ ] **4.4 Push command (local-side)**
  - `/push @agent-name to remote-name` — push agent to a remote server
  - Packages: agent config + CLAUDE.md + skills + prompts
  - Calls `POST /api/marketplace/import` on the remote
  - Confirms: "Pushed @tax-analyst to finance-team (https://...)"
  - Also support: `/push skill:name to remote-name`, `/push prompt:name to remote-name`

- [ ] **4.5 Pull command (local-side)**
  - `/pull @agent-name from remote-name` — pull agent from remote server
  - Calls `GET /api/marketplace/export/agent/:id` on the remote
  - Installs locally: creates directory, writes CLAUDE.md, adds to config
  - Generates local routes (web by default)
  - Confirms: "Pulled @tax-analyst from finance-team, available at @tax-analyst"
  - Also support: `/pull skill:name from remote-name`, `/pull prompt:name from remote-name`

- [ ] **4.6 Browse remote marketplace**
  - `/browse remote-name` — list all agents/skills on a remote
  - Calls `GET /api/marketplace/agents`, `/api/marketplace/skills`, etc.
  - Displays as a table in chat
  - Or: add a "Remote" tab to the web UI marketplace page

- [ ] **4.7 Sync status**
  - Track which agents were pushed from where
  - Show in agent config: "Synced from: finance-team (last push: 2026-03-31)"
  - Detect drift: local version differs from remote
  - No auto-sync — always explicit push/pull

---

## Workstream 3: Multi-Instance Management

For power users managing multiple server instances.

### Phase 5: Admin Tools

- [ ] **5.1 Remote health check**
  - `/status remote-name` — check if remote is healthy
  - Calls `GET /health` on the remote
  - Shows: status, agent count, uptime, version

- [ ] **5.2 Multi-remote push**
  - `/push @agent-name to all` — push to all configured remotes
  - Confirmation before executing
  - Report: pushed to N remotes, M succeeded, K failed

- [ ] **5.3 Remote management in Web UI**
  - Settings page: manage remotes (add, remove, test connection)
  - Marketplace page: toggle between "Local" and remote registries
  - Visual indicator: which agents exist on which remotes

---

## Build Order (Recommended)

```
Phase 1: API Executor          ← Unblocks everything
  └── 1.1-1.7 (2-3 days)

Phase 2: Auth & Users           ← Required before sharing with team
  └── 2.1-2.8 (1-2 days)

Phase 3: Deploy to Railway      ← Team goes live
  └── 3.1-3.8 (1 day)

--- Team can use the server at this point ---

Phase 4: Push/Pull              ← Power user convenience
  └── 4.1-4.7 (1 day)

Phase 5: Multi-Instance         ← Scale to multiple clients
  └── 5.1-5.3 (0.5 day)
```

**MVP (team goes live): Phases 1-3**
**Full vision: Phases 1-5**

---

## Config Changes Summary

### Local mode (current, unchanged)
```json
{
  "service": {
    "executorBackend": "cli",
    "mode": "local"
  }
}
```

### Server mode (new)
```json
{
  "service": {
    "executorBackend": "api",
    "mode": "server",
    "anthropicApiKey": "sk-ant-...",
    "defaultModel": "claude-sonnet-4-20250514",
    "auth": {
      "enabled": true,
      "method": "invite-code",
      "sessionSecret": "random-64-char-string",
      "sessionMaxAge": 86400000
    }
  },
  "remotes": {}
}
```

---

## Open Questions

1. **MCP servers on the server** — MCPs that use `stdio` transport (local process) work fine. MCPs that need user-specific API keys (Stripe, QuickBooks) — do we use one shared key per MCP, or per-user keys?

2. **Agent creation permissions** — on the server, can any user create agents via the Lab? Or only admins? Recommendation: admin-only for agent creation, all users can chat.

3. **Billing/usage tracking** — with a shared API key, should we track per-user token usage? Not MVP but good to plan for.

4. **Data persistence on Railway** — Railway containers are ephemeral by default. Need persistent volume for agent data, conversation logs, and user database.

5. **WebSocket/SSE behind Railway proxy** — verify streaming works through Railway's proxy. May need specific headers or configuration.

6. **Model access** — API key may not have access to all models. Need fallback logic if requested model isn't available.

7. **Rate limiting** — Anthropic API has rate limits. Need queue/throttle for concurrent agent executions on the server.
