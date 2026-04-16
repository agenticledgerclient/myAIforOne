# Shared Agents — Build Checklist

> **Status:** In Progress
> **Architecture:** [SharedAgentArchitecture.md](SharedAgentArchitecture.md)
> **Build Plan (detailed):** [SharedAgentBuildPlan.md](SharedAgentBuildPlan.md)
> **Date:** 2026-04-16
>
> **Key decisions from planning session:**
> - `shared: true` flag on agent config (simple boolean, not complex storage/storageProvider)
> - `SharedAgents/` folder root mirrors `PersonalAgents/` hierarchy (org/ → agent-id/)
> - Google Drive = user sets up Drive for Desktop + designates folder. We build nothing for sync.
> - Railway storage = Railway Volume (persistent disk). Zero code change — just an absolute path.
> - Google Drive mounting on Railway is OUT OF SCOPE for initial build.
> - Feature flag OFF by default. Both `sharedAgentsEnabled: true` in config AND license required.

---

## Phase 0 — Feature Gate *(must be first)*
- [ ] Add `sharedAgentsEnabled?: boolean` to `ServiceConfig` in `src/config.ts`, default `false`
- [ ] Add `isSharedAgentsAllowed(config)` gate utility in `src/license.ts`
- [ ] Update `GET /api/capabilities` to include `sharedAgents: boolean`
- [ ] Add "Shared Agents" toggle to Admin Settings → Feature Modules (same pattern as AI Gym toggle)
- [ ] Frontend: on page load, call capabilities endpoint and hide all shared-agent UI if `sharedAgents: false`

---

## Phase 1 — Config & Types
- [ ] Add `shared?: boolean` to `AgentConfig` in `src/config.ts`
- [ ] Add `conversationLogMode?: "shared" | "per-user"` to `AgentConfig`, default `"shared"`
- [ ] Update `agentHome` resolution: when `shared: true`, default home is `~/Desktop/MyAIforOne Drive/SharedAgents/<org>/<agentId>` instead of `PersonalAgents/<org>/<agentId>`
- [ ] Update `config.example.json` with a commented shared agent example

---

## Phase 2 — Auth Backend
- [ ] Add `auth: { enabled, tokens[], webPassword }` to `ServiceConfig` and `config.example.json`, default `enabled: false`
- [ ] Create `authMiddleware` in `src/web-ui.ts` — checks Bearer token, skips if auth disabled
- [ ] Apply `authMiddleware` to all `/api/*` routes
- [ ] Exempt: `GET /health`, `POST /api/auth/login`, `GET /api/auth/status`
- [ ] Implement `POST /api/auth/login` — accepts password, returns token
- [ ] Implement `GET /api/auth/status` — returns `{ authEnabled, authenticated }`

---

## Phase 3 — Per-User Conversation Logging
- [ ] Sync executor path (`src/executor.ts`): when `conversationLogMode === "per-user"`, write to `conversation_log_<senderId>.jsonl`
- [ ] Same change in streaming executor path
- [ ] Update `GET /api/agents/:id/logs` — aggregate all per-user log files; support `?sender=` filter
- [ ] Update cost tracking to aggregate across per-user log files
- [ ] Update advanced memory loading: per-user mode loads only current sender's log into context

---

## Phase 4 — Agent Creation API
- [ ] `POST /api/agents`: when `shared: true`, create `agentHome` under `SharedAgents/<org>/<id>` (same folder structure)
- [ ] `POST /api/agents`: accept and persist `shared`, `conversationLogMode` fields
- [ ] `PUT /api/agents/:id`: allow updating `conversationLogMode`, block changing `agentHome` after creation
- [ ] `GET /api/agents` and `GET /api/agents/:id`: return `shared`, `conversationLogMode` fields

---

## Phase 5 — Frontend: Agent Creation Modal (`public/org.html`)
- [ ] Add "Shared Agent" toggle to creation modal Config tab (hidden if `capabilities.sharedAgents === false`)
- [ ] When shared: show `conversationLogMode` selector (Shared / Per-User)
- [ ] Show a "Shared" badge on agent cards for shared agents
- [ ] Include `shared`, `conversationLogMode` in `saveAgent()` POST body

---

## Phase 6 — Frontend: Agent Dashboard (`public/agent-dashboard.html`)
- [ ] Show "Shared Agent" indicator and `conversationLogMode` badge in agent header
- [ ] When `conversationLogMode === "per-user"`: show sender filter dropdown in conversation logs view

---

## Phase 7 — Web UI Auth
- [ ] Create `public/auth.js` — checks `/api/auth/status` on load, shows login overlay if needed, stores token in localStorage, exports `authFetch()`
- [ ] Add `<script src="/auth.js">` to all `public/*.html` pages
- [ ] Replace all `fetch("/api/...")` calls across all pages with `authFetch()`
- [ ] Create login UI (centered card, dark theme CSS variables, password input)

---

## Phase 8 — MCP Tools
- [ ] Add `get_storage_info` tool — returns `shared`, `conversationLogMode`, `agentHome` for an agent
- [ ] Add `update_storage_config` tool — update `conversationLogMode` on an agent
- [ ] Add `get_conversation_senders` tool — list unique senders with message counts (per-user mode)
- [ ] Add `get_conversation_log` tool — read log with optional `?sender=` filter
- [ ] Verify `create_agent`, `update_agent`, `get_agent` MCP tools pass through new fields

---

## Phase 9 — Tests (`Comprehensive Test Suite/shared-agent/`)
- [ ] `feature-gate.test.ts` — feature off: shared-agent UI hidden, API returns 403; feature on: works
- [ ] `config.test.ts` — `shared: true` resolves `agentHome` to `SharedAgents/` path; defaults correct
- [ ] `api-crud.test.ts` — create shared agent, verify fields persist; `agentHome` cannot change after creation
- [ ] `conversation-log-shared.test.ts` — two senders, one log file, both appear
- [ ] `conversation-log-peruser.test.ts` — two senders, two log files; aggregation and `?sender=` filter work
- [ ] `auth.test.ts` — auth disabled: open; auth enabled: 401 without token, accessible with token; `/health` always open
- [ ] `cost-aggregation.test.ts` — per-user mode aggregates costs across all sender log files
- [ ] `mcp-tools.test.ts` — all 4 new MCP tools return correct data
- [ ] Run full suite: `node "Comprehensive Test Suite/run-all-tests.js"` — all pass

---

## Phase 10 — Docs & Agent Prompts
- [ ] Update `public/api-docs.html` — add auth endpoints, new agent fields, `?sender=` param
- [ ] Update `public/mcp-docs.html` — add 4 new MCP tools
- [ ] Update `docs/user-guide.md` — shared agents section, auth setup, deployment options
- [ ] Update `agents/platform/hub/CLAUDE.md` — new MCP tools, shared agent creation guidance
- [ ] Update `agents/platform/agentcreator/CLAUDE.md` — detect team intent, ask about `conversationLogMode`

---

## Phase 11 — Trueup & Release
- [ ] Run `/opappbuild_agentready_trueup`
- [ ] Run `/opappbuild_testsuite_trueup`
- [ ] Commit + push to both remotes (`origin` and `client`)
- [ ] Ask: create port task for `@ma41saas`?
