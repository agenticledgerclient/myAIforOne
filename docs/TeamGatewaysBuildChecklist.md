# Team Gateways — Build Checklist

> **Goal:** Let a local install connect to one or more remote (shared) MyAIforOne gateways ("Team Gateways") so that agents can reach MCPs hosted on those remotes. Includes migrating gateway auth from opaque bearer tokens to named API keys.
>
> **Related docs:** [SharedAgentArchitecture.md](SharedAgentArchitecture.md) · [SharedAgentBuildChecklist.md](SharedAgentBuildChecklist.md)
>
> **Status legend:** `[ ]` pending · `[~]` in progress · `[x]` done

---

## Design decisions (locked)

| | Decision |
|---|---|
| Name | **Team Gateways** |
| MCP transport from local → remote | **HTTP MCP** (Streamable HTTP). Matches `aigym-platform`. Requires adding `/mcp` endpoint to the gateway. |
| Auth credential shape | Named **API keys**. v1 has `scopes: ["*"]` only; scoped keys are a future enhancement. |
| Storage — metadata | In `config.json` under `service.apiKeys[]` and `service.teamGateways[]`. |
| Storage — remote-gateway secret (local side) | In `mcp-keys/team-{id}.env` (existing 3-level pattern, supports `.env.enc` with master password). |
| Encryption | Same `.env.enc` mechanism with `MYAGENT_MASTER_PASSWORD`. Nothing new to build. |
| Folder structure | No new folder; `team-` prefix in filename. |
| Test connection on add | Required. Refuse to save on 401 / network error. |
| Hub default | Auto-add new Team Gateway's MCP to hub on save. Other agents opt-in per-agent. |
| Backcompat | Legacy `auth.tokens[]` remain valid; they auto-migrate to `apiKeys[]` entries on first load. |
| Key format | `mai41team_` + 64 hex chars (32 random bytes). |
| Key id format | `key_` + 12 hex chars. |
| Offline remote handling | Show "offline" status on the card; no active polling. Check on user action only. |

---

## Phase 1 — API Keys system on the gateway

> **Why:** The current single-bearer-token model doesn't scale to multiple local installs connecting to the same remote gateway. API keys give us names, revoke, audit, and a path to scopes later.

### 1a — Types + config storage

- [x] Add `ApiKey` interface to `src/config.ts` (`id`, `name`, `key`, `createdAt`, `lastUsedAt?`, `scopes`)
- [x] Add `apiKeys?: ApiKey[]` to `ServiceConfig`
- [x] Runtime migration in `loadConfig`: if `auth.tokens[]` is set and `apiKeys[]` is empty, synthesize `apiKey` entries (`key_legacy`, `key_legacy_1`…) so the UI shows something useful

### 1b — CRUD endpoints

- [x] `GET /api/auth/keys` → list (returns `{id, name, preview, createdAt, lastUsedAt, scopes}`; never the full secret after creation)
- [x] `POST /api/auth/keys {name}` → create, returns full key exactly once, appends to `apiKeys[]`, persists to disk
- [x] `DELETE /api/auth/keys/:id` → revoke. Refuse to delete the last remaining key (lockout guard).

### 1c — Auth middleware migration

- [x] Introduce `matchToken(token)` helper that checks `apiKeys[]` first, falls back to legacy `auth.tokens[]`
- [x] On successful match, stamp `lastUsedAt` in memory and persist opportunistically (on `GET /api/auth/keys` and on CRUD writes)
- [x] Update `POST /api/auth/login` to return `apiKeys[0].key` (preferred) or legacy token (fallback)
- [x] Update `GET /api/auth/status` to use `matchToken()`

### 1d — Admin UI — API Keys page

- [x] Add "API Keys" section to `public/admin.html` (new top-level tab next to Settings)
- [x] Table columns: `name`, `preview`, `created`, `last used`, `actions (revoke)`
- [x] "+ New Key" button → modal with a single name input
- [x] On create: render the full key once in a modal with a Copy button and a clear "save this now, it won't be shown again" warning
- [x] Revoke confirms before deleting
- [~] Disable revoke on the last remaining key — backend refuses (400) but frontend still shows the button; should also hide UI-side
- [x] All fetches use `authFetch()` so the page works when auth is enabled

### 1e — Bootstrap seeding

- [x] In `src/index.ts` first-run bootstrap (runs only when `MYAGENT_DATA_DIR` is set), seed an initial `apiKeys[0]` with id `key_bootstrap`, name `Bootstrap`, key = `INITIAL_AUTH_TOKEN`, scopes `["*"]`
- [x] Keep `auth.tokens[INITIAL_AUTH_TOKEN]` for backcompat
- [x] Keep `auth.webPassword = INITIAL_AUTH_PASSWORD` for web UI login

### 1 — Tests

- [x] `Comprehensive Test Suite/api-keys/types.test.ts` — static shape + prefix format tests
- [ ] `Comprehensive Test Suite/api-keys/create-list-revoke.test.ts`
- [ ] `.../auth-middleware-legacy-backcompat.test.ts` (old `auth.tokens[]` still works)
- [ ] `.../cannot-delete-last-key.test.ts`
- [ ] `.../last-used-stamping.test.ts`

---

## Phase 2 — HTTP MCP endpoint on the gateway

> **Why:** Local installs need to reach remote gateway tools via MCP over HTTP (same model as `aigym-platform`). The existing MCP server is stdio only.

### 2a — Streamable HTTP transport

- [x] Add `/mcp` route to the gateway's Express app — implemented in dedicated `src/mcp-http.ts`
- [x] Wrap the existing MCP tool registry behind the Streamable HTTP transport from `@modelcontextprotocol/sdk`
  - **Implementation note:** Rather than importing the McpServer in-process (which would have required refactoring the 1600-line tool registry), we spawn the existing stdio MCP server as a long-lived child process and proxy `tools/list` + `tools/call` through it via `Client` + `StdioClientTransport`. Keeps the two entry points from ever drifting apart.
- [x] Session lifecycle: per-session MCP `Server` + `StreamableHTTPServerTransport` pair, kept alive in a `Map<sessionId, Session>`
- [x] Wired into `startWebUI` via new `attachExtraRoutes(app)` callback in `src/index.ts`
- [x] Shared auth helper extracted to `src/auth-helper.ts` (`isAuthEnabled`, `extractBearer`, `matchToken`) so `/mcp` and `/api/*` can never drift apart

### 2b — Auth on `/mcp`

- [x] Require Bearer API key on every `/mcp` request (reuses `matchToken()` via `auth-helper.ts`)
- [x] When auth is disabled → open (matches `/api/*` behavior). When enabled → 401 without a matching key.
- [x] Stamp `lastUsedAt` on the matched key (in-memory via `matchToken()`; disk persist happens on next `/api/auth/keys` GET or CRUD write)
- [x] POST/GET/DELETE `/mcp` all gated — new session init on POST, server-sent events on GET, session teardown on DELETE

### 2 — Tests

- [ ] `Comprehensive Test Suite/mcp-http/tool-listing.test.ts` (GET tool list returns same set as stdio server)
- [ ] `.../bearer-required.test.ts` (401 without, 200 with)
- [ ] `.../round-trip-agent-list.test.ts` (call `list_agents` via HTTP MCP against a seeded gateway)

---

## Phase 3 — Team Gateways on local side

> **Why:** Let users configure N remote gateways (one per organization/team they belong to) from their local install. Each one auto-registers as an MCP and is auto-assigned to hub.

### 3a — Types + config storage

- [x] Add `TeamGateway` interface to `src/config.ts` (`id`, `name`, `url`, `addedAt`, `lastStatus?`, `lastStatusAt?`, `lastStatusMessage?`)
- [x] Add `teamGateways?: TeamGateway[]` to `ServiceConfig`
- [x] Default empty array on config load

### 3b — CRUD endpoints

- [x] `GET /api/team-gateways` → list, includes `lastStatus`
- [x] `POST /api/team-gateways/test {url, apiKey}` → hit `{url}/api/capabilities` with Bearer + 8s timeout; returns `{ok, platform, sharedAgents}` or `{ok:false, error, status}`. Does NOT save.
- [x] `POST /api/team-gateways {name, url, apiKey}` → runs the probe, saves on success, returns full entity. Refuses duplicate ids (409).
- [x] `DELETE /api/team-gateways/:id` → removes metadata, MCP registry entry, the `.env` file, and strips the MCP from **every** agent's `mcps[]` array (not just hub)
- [x] `POST /api/team-gateways/:id/resync` → reads key back from `.env`, re-probes, updates `lastStatus` / `lastStatusMessage` / `lastStatusAt`
  - **Note:** Endpoint is named `/resync` in code; checklist previously said `/recheck`. Frontend uses `/resync`.

### 3c — Auto-register as HTTP MCP

- [x] On successful save: write `mcp-keys/team-{id}.env` with `TEAM_{ID}_KEY={apiKey}` (uses existing keystore so `.env.enc` + `MYAGENT_MASTER_PASSWORD` work for free)
- [x] Append to `config.mcps`:
  ```jsonc
  "team-{id}": {
    "type": "http",
    "url": "{url}/mcp",
    "headers": { "Authorization": "Bearer ${TEAM_{ID}_KEY}" }
  }
  ```
- [x] Persist to `config.json` via new `persistFullConfig()` helper (saves apiKeys + teamGateways + mcps + agents in one write)
- [x] On delete: removes the MCP entry and the `.env` file

### 3d — Auto-assign to hub

- [x] On successful save: if `config.agents.hub` exists, appends `team-{id}` to `hub.mcps` (no-op if already present)
- [x] On delete: strips `team-{id}` from every agent's `mcps[]` array (hub and any other agents that opted in)

### 3 — Tests

- [ ] `Comprehensive Test Suite/team-gateways/crud.test.ts`
- [ ] `.../test-connection.test.ts` (mock remote; 200, 401, network error)
- [ ] `.../auto-register-mcp.test.ts` (after add, MCP entry present in config)
- [ ] `.../auto-assign-hub.test.ts` (hub gets the new MCP)
- [ ] `.../delete-cleans-everywhere.test.ts` (config, mcp entry, mcp-keys file, all agent mcp arrays)

---

## Phase 4 — Admin → Team Gateways UI

> **Why:** Visual layer for Phase 3. User should never have to touch `config.json` directly.

- [x] New tab "Team Gateways" added to `public/admin.html` (also added an "API Keys" tab alongside)
- [x] Nav entry from Admin top nav bar (between Settings and Updates)
- [x] Card grid of connected gateways. Each card shows: name, URL, status pill (OK / OFFLINE / UNAUTHORIZED / ERROR). Empty state copy points to the "+ Connect Team Gateway" button.
- [x] "+ Connect Team Gateway" button → modal with 3 fields (Display name, Gateway URL, API key) + "Test Connection" button
- [x] "Test Connection" button hits `POST /api/team-gateways/test` and shows inline result (platform name + sharedAgents state); **Save is disabled + greyed out until Test passes**
- [x] Per-card actions: Test (resync), Disconnect (delete with confirm)
- [ ] Per-card "# of agents using it" indicator — backend provides the data; frontend not rendered yet
- [ ] Edit action (rename / rotate key) — not yet; users can disconnect + reconnect as a workaround
- [x] Empty state with explainer copy
- [x] Respect auth: all fetches go through `authFetch()`

### 4 — Tests

- [ ] Smoke: `Comprehensive Test Suite/team-gateways/ui-smoke.test.ts` (page loads, card renders)
- [ ] Playwright: happy path connect flow with a stub gateway
- [ ] Playwright: invalid-key flow shows error and blocks save

---

## Phase 5 — Deploy + wire up

> **Why:** Prove the full round trip with the existing Railway deployment before declaring done.

- [ ] Build + commit + push all changes to both `origin` and `client`
- [ ] Run `/opappbuild_testsuite_trueup` to add any missing tests against new endpoints
- [ ] Run full `Comprehensive Test Suite/run-all-tests.js` — all green
- [ ] Railway auto-deploys the gateway from `main`
- [ ] Validate on the Railway gateway:
  - [ ] `GET /health` returns 200
  - [ ] `GET /api/capabilities` requires auth
  - [ ] `GET /mcp` requires auth (Phase 2)
  - [ ] `/api/auth/keys` shows the bootstrap key with preview
- [ ] From local Mac: connect the Railway gateway as the first Team Gateway (name "AgenticLedger HQ")
- [ ] From local `@hub`: "list agents on AgenticLedger HQ" → returns expected list
- [ ] From local `@hub`: "create a shared agent `test-bot` on AgenticLedger HQ" → agent appears on Railway

---

## Non-goals (explicit, so we don't drift)

- Scoped API keys (`agents:read` etc.) — data model anticipates them, but v1 ships with `["*"]` only
- RBAC for web UI — single admin password is enough for v1
- Cross-gateway agent browser in local UI (the "Option A" gateway picker) — tracked separately as the "UX beyond MCP" follow-up
- Polling remote gateway status in the background — on-demand only
- Encrypting `teamGateways[]` metadata — URL and name are not secrets; only the API key (stored in `mcp-keys/*.env`) needs encryption

---

## Open questions carried forward

| # | Question | Decision |
|---|----------|----------|
| 1 | What happens if local install disconnects a Team Gateway that other agents (not just hub) opted into? | Remove the MCP from every agent that referenced it + delete the `.env` file. |
| 2 | What if the same user has two local installs (MacBook + iMac) connecting to the same gateway? | Each install issues its own API key (named per device). Gateway sees distinct `lastUsedAt` per key. Perfect. |
| 3 | Rate limiting on the gateway? | **Deferred** to a later phase. |
| 4 | Multi-gateway UI browser (switch "context" between gateways in the local UI)? | **Deferred** — tracked as the "UX beyond MCP" follow-up. |

---

## Progress snapshot (updated 2026-04-16 after continued build)

### Built and compiling
- **Phase 1** (API Keys):
  - 1a types + storage — `src/config.ts`
  - 1b CRUD — `GET/POST/DELETE /api/auth/keys` in `src/web-ui.ts`
  - 1c auth middleware — `matchToken()` with legacy `auth.tokens[]` fallback
  - 1d Admin UI — full "API Keys" tab in `public/admin.html` (table, + New Key modal, one-time secret reveal + copy)
  - 1e bootstrap — `src/index.ts` seeds `key_bootstrap` from `INITIAL_AUTH_TOKEN`
- **Phase 2** (HTTP MCP): `/mcp` Streamable HTTP endpoint in `src/mcp-http.ts` + shared `src/auth-helper.ts`. Mounted via new `attachExtraRoutes` hook in `src/web-ui.ts`.
- **Phase 3** (Team Gateways backend): 3a types, 3b CRUD (list/test/create/resync/delete), 3c auto-register HTTP MCP + write `mcp-keys/team-{id}.env`, 3d auto-assign to hub + strip from all agents on disconnect.
- **Phase 4** (Team Gateways UI): tab + card grid + Connect modal + Test Connection gating + resync/disconnect actions.
- Tests scaffold: `Comprehensive Test Suite/api-keys/types.test.ts`; empty dirs present for `team-gateways/` and `mcp-http/`.
- Full `npm run build` passes.

### Remaining
- **Phase 1 tests**: create/list/revoke, legacy backcompat, cannot-delete-last-key, last-used stamping
- **Phase 2 tests**: tool-listing, bearer-required, round-trip agent list
- **Phase 3 tests**: crud, test-connection, auto-register-mcp, auto-assign-hub, delete-cleans-everywhere
- **Phase 4 tests**: smoke + Playwright
- **Phase 4 UI gaps**: per-card "# agents using", Edit (rename / rotate key), revoke-last-key lockout guard on frontend
- **Phase 5**: run `/opappbuild_testsuite_trueup`, run full suite, commit + push both remotes, Railway redeploy + end-to-end validation from local Mac
