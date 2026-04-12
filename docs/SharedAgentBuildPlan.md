# Shared Agent — Build Plan

> **Status:** Ready to Build
> **Architecture:** [SharedAgentArchitecture.md](SharedAgentArchitecture.md)
> **Date:** 2026-04-11
> **License Feature Flag:** `sharedAgents` (default: off)

---

## Phase 0 — Feature Gating — License Integration

Shared agents are a licensed feature gated behind `sharedAgents: boolean` in the license. By default this is **off** — users must have a license with `sharedAgents: true` to use this feature. The code must be organized so that every entry point checks the flag before proceeding.

### 0.1 Service-level config flag
**File:** `src/config.ts`

- [ ] **0.1.1** Add `sharedAgentsEnabled?: boolean` to `ServiceConfig` — default `false`. This is the local kill switch. The platform checks BOTH this flag AND the license feature.
- [ ] **0.1.2** In `loadConfig()`, default `sharedAgentsEnabled` to `false`

### 0.2 Gate check utility
**File:** `src/license.ts`

The `isFeatureEnabled("sharedAgents")` function already exists. Use it at every gate point below. The pattern:

```typescript
import { isFeatureEnabled } from "./license.js";

function isSharedAgentsAllowed(config: AppConfig): boolean {
  return (config.service as any).sharedAgentsEnabled !== false && isFeatureEnabled("sharedAgents");
}
```

### 0.3 Gate points (where to check)

Every place the shared agent feature is exposed must check the gate. If the gate is closed, the feature is invisible — not errored, just hidden/absent.

| Gate Point | File | Behavior When Off |
|------------|------|-------------------|
| **Agent creation API** | `src/web-ui.ts` (`POST /api/agents`) | Reject with 403 if `storage: "drive"` or `conversationLogMode: "per-user"` and feature is off |
| **Agent update API** | `src/web-ui.ts` (`PUT /api/agents/:id`) | Reject changes to `storage`/`conversationLogMode` if feature is off |
| **Org page UI** | `public/org.html` | Hide storage/drive config, conversation log mode selector |
| **Agent dashboard UI** | `public/agent-dashboard.html` | Hide storage info panel, per-user log viewer |
| **MCP tools** | `server/mcp-server/` | `get_storage_info`, `update_storage_config`, `get_conversation_senders` return error if feature is off |
| **Auth system** | `src/web-ui.ts` | Auth middleware only activates if `service.auth.enabled` AND `sharedAgentsEnabled` (auth is a shared-agent concern) |

### 0.4 Capabilities endpoint
**File:** `src/web-ui.ts`

- [ ] **0.4.1** Update `GET /api/capabilities` to include `sharedAgents: boolean` in the response. Frontend reads this to show/hide shared-agent UI elements.

### 0.5 Frontend feature detection
**Files:** All frontend pages that reference shared agent features

- [ ] **0.5.1** On page load, call `GET /api/capabilities` (same call as super agents — one endpoint, all flags)
- [ ] **0.5.2** Conditionally show/hide shared agent UI elements (storage config, conversation log mode, auth) based on `capabilities.sharedAgents`

### 0.6 Admin settings toggle
**File:** `public/admin.html` (Settings tab, Feature Modules section)

- [ ] **0.6.1** Add "Shared Agents" toggle to the Feature Modules section (same pattern as AI Gym / Super Agents toggles)
- [ ] **0.6.2** Toggle saves `sharedAgentsEnabled` via `PUT /api/config/service`
- [ ] **0.6.3** If the license doesn't have `sharedAgents: true`, show the toggle as disabled with a "Requires license" note

### Build order note
Phase 0 must be built **first** (before Phases 1-16). Every subsequent phase wraps its code in the gate check. This ensures the feature can be built, tested, and merged without being visible to users who don't have it licensed.

---

## Phase 1 — Backend: Config & Types

### 1.1 Update AgentConfig interface
**File:** `src/config.ts` (line ~102, inside `AgentConfig` interface)

Add these fields after the existing `agentClass` field:

```typescript
storage?: "local" | "drive";             // default "local" — where agent data physically lives
storageProvider?: "google-drive" | "dropbox" | "onedrive" | "custom" | null;  // metadata for admin UI
conversationLogMode?: "shared" | "per-user";  // default "shared" — whether conversation logs are shared or per-sender
```

- [ ] **1.1.1** Add `storage` field to `AgentConfig` — `"local" | "drive"`, defaults to `"local"`
- [ ] **1.1.2** Add `storageProvider` field to `AgentConfig` — `"google-drive" | "dropbox" | "onedrive" | "custom" | null`
- [ ] **1.1.3** Add `conversationLogMode` field to `AgentConfig` — `"shared" | "per-user"`, defaults to `"shared"`
- [ ] **1.1.4** Update `config.example.json` — add a commented example of a shared agent entry with `storage`, `storageProvider`, `conversationLogMode`, and a non-Drive `agentHome` path

### 1.2 Verify agentHome resolution handles absolute paths
**File:** `src/config.ts` (lines 176-196)

Current resolution uses `resolveTilde()` and derives `claudeMd`/`memoryDir` from `agentHome`. Verify:

- [ ] **1.2.1** Confirm `agentHome` with an absolute path (no `~`) like `/data/shared-agents/finance-analyst` resolves correctly without tilde expansion
- [ ] **1.2.2** Confirm `claudeMd` auto-derives to `{agentHome}/CLAUDE.md` when `agentHome` is absolute
- [ ] **1.2.3** Confirm `memoryDir` auto-derives to `{agentHome}/memory` when `agentHome` is absolute
- [ ] **1.2.4** Add a unit test verifying resolution with absolute paths (no `~` prefix)

---

## Phase 2 — Backend: Authentication

**Decision:** Auth required from day 1 for shared gateway.

### 2.1 Auth system design
**File:** `src/web-ui.ts` — new middleware

Implement simple token-based auth. On first start, generate a random access token and save it. All API requests must include `Authorization: Bearer <token>` header. Web UI stores the token in localStorage after initial login.

- [ ] **2.1.1** Create auth config in `config.json` under `service` section:
  ```jsonc
  {
    "service": {
      "auth": {
        "enabled": false,          // default false (personal gateway unchanged)
        "tokens": ["<random>"],    // bearer tokens that grant access
        "webPassword": null        // optional password for web UI login
      }
    }
  }
  ```
- [ ] **2.1.2** Add `auth` fields to the service config TypeScript type in `src/config.ts`
- [ ] **2.1.3** Create auth middleware function in `src/web-ui.ts`:
  ```typescript
  function authMiddleware(req, res, next) {
    if (!config.service?.auth?.enabled) return next(); // skip if auth disabled
    // Check Bearer token from Authorization header
    // OR check session cookie (set after web UI login)
    // If neither valid → 401
  }
  ```
- [ ] **2.1.4** Apply auth middleware to all `/api/*` routes — add `app.use("/api", authMiddleware)` before route definitions
- [ ] **2.1.5** Exempt auth from: `GET /health`, `POST /api/auth/login` (the login endpoint itself)
- [ ] **2.1.6** Create `POST /api/auth/login` endpoint — accepts `{ password: string }`, returns `{ token: string }` if password matches `service.auth.webPassword`
- [ ] **2.1.7** Create `GET /api/auth/status` endpoint — returns `{ authEnabled: boolean, authenticated: boolean }` — used by web UI to decide whether to show login screen
- [ ] **2.1.8** Generate a random token on first start if `auth.enabled` is true but `tokens` array is empty — log it to console so admin can copy it

### 2.2 Web UI login screen
**Files:** All `public/*.html` pages

- [ ] **2.2.1** Create a shared login overlay/modal that checks `GET /api/auth/status` on page load
- [ ] **2.2.2** If `authEnabled: true` and not authenticated, show password form
- [ ] **2.2.3** On submit, `POST /api/auth/login` → store returned token in `localStorage`
- [ ] **2.2.4** Attach token as `Authorization: Bearer <token>` header on all subsequent `fetch()` calls
- [ ] **2.2.5** Add a shared `auth.js` script (or inline in each page) that wraps `fetch()` to auto-attach the token
- [ ] **2.2.6** Handle 401 responses globally — clear token from localStorage and show login screen

---

## Phase 3 — Backend: Per-User Conversation Logging

### 3.1 Update conversation log write path
**File:** `src/executor.ts`

The conversation log is written at two locations (sync executor ~line 1394-1404, streaming executor ~line 1516). Both append to `{memoryDir}/conversation_log.jsonl`.

- [ ] **3.1.1** Find the conversation log write in the **sync executor** path. Before appending, check `agentConfig.conversationLogMode`:
  ```typescript
  const logFileName = agentConfig.conversationLogMode === "per-user"
    ? `conversation_log_${msg.sender.replace(/[^a-zA-Z0-9_-]/g, "_")}.jsonl`
    : "conversation_log.jsonl";
  const logPath = join(memoryDir, logFileName);
  appendFileSync(logPath, JSON.stringify(entry) + "\n");
  ```
- [ ] **3.1.2** Apply the same change to the **streaming executor** path (second location where conversation log is written)
- [ ] **3.1.3** Ensure the `msg.sender` / `senderId` value is available and sanitized for use as a filename (replace special chars with `_`)
- [ ] **3.1.4** Verify the existing conversation log **read paths** (advanced memory, cost tracking, `/api/agents/:id/logs`) also respect `conversationLogMode`:
  - If mode is `"shared"` → read `conversation_log.jsonl` (unchanged)
  - If mode is `"per-user"` → read the current sender's log file, OR aggregate all per-user logs when needed (e.g., for admin views)

### 3.2 Update conversation log read paths
**File:** `src/executor.ts` — system prompt building, advanced memory loading

- [ ] **3.2.1** Find where conversation log is loaded into the system prompt / context for advanced memory. When `conversationLogMode === "per-user"`, load only the current sender's log file
- [ ] **3.2.2** Find where conversation log is read for the daily journal / activity digest. When `conversationLogMode === "per-user"`, aggregate ALL per-user log files for the daily summary (the daily journal should still reflect all activity)

### 3.3 Update API log endpoints
**File:** `src/web-ui.ts`

- [ ] **3.3.1** Update `GET /api/agents/:agentId/logs` — if `conversationLogMode === "per-user"`:
  - Default: return aggregated logs from all per-user files (sorted by timestamp)
  - Accept optional `?sender=<senderId>` query param to filter to one user's logs
- [ ] **3.3.2** Update cost tracking (`GET /api/agents/:agentId/cost`) — aggregate costs across all per-user log files when mode is `"per-user"`

---

## Phase 4 — Backend: Agent Creation for Shared Agents

### 4.1 Update POST /api/agents
**File:** `src/web-ui.ts` (lines ~2587-2748)

- [ ] **4.1.1** Accept new fields in request body: `storage`, `storageProvider`, `conversationLogMode`
- [ ] **4.1.2** When `storage === "drive"` or when `agentHome` is an absolute path (not starting with `~`):
  - Use the provided `agentHome` directly (don't prepend `PersonalAgents/`)
  - Still create the standard folder structure at that path: `memory/`, `memory/daily/`, `FileStorage/Temp`, `FileStorage/Permanent`, `skills/`, `mcp-keys/`
  - Write `tasks.json`, `CLAUDE.md`, `context.md` as usual
- [ ] **4.1.3** When `storage === "local"` and `agentHome` is not provided, use existing default: `~/Desktop/MyAIforOne Drive/PersonalAgents/{agentId}`
- [ ] **4.1.4** Persist `storage`, `storageProvider`, `conversationLogMode` in the agent's config entry in `config.json`

### 4.2 Update PUT /api/agents/:id
**File:** `src/web-ui.ts` (lines ~2757+)

- [ ] **4.2.1** Allow updating `storage`, `storageProvider`, `conversationLogMode` fields
- [ ] **4.2.2** Do NOT allow changing `agentHome` after creation (too risky — could orphan data). Return error if `agentHome` is different from existing.

### 4.3 Update GET /api/agents and GET /api/agents/:id
**File:** `src/web-ui.ts`

- [ ] **4.3.1** Return `storage`, `storageProvider`, `conversationLogMode` fields in agent response
- [ ] **4.3.2** Add `storageDisplay` computed field for UI: `"Server (local)"`, `"Google Drive"`, `"Dropbox"`, etc.

---

## Phase 5 — Frontend: Agent Creation Modal

### 5.1 Update Org Page creation modal
**File:** `public/org.html` (lines ~1075-1415, the agent creation modal)

- [ ] **5.1.1** Add **Storage** section to the "Config" tab (after workspace field):
  ```html
  <label>Storage Location</label>
  <select id="f-storage">
    <option value="local">Server (Local Filesystem)</option>
    <option value="drive">Cloud Drive (Google Drive, Dropbox, etc.)</option>
  </select>
  ```
- [ ] **5.1.2** When `storage === "drive"`, show additional fields:
  ```html
  <label>Storage Provider</label>
  <select id="f-storageProvider">
    <option value="google-drive">Google Drive</option>
    <option value="dropbox">Dropbox</option>
    <option value="onedrive">OneDrive</option>
    <option value="custom">Custom</option>
  </select>

  <label>Agent Home Path (absolute path to mounted drive folder)</label>
  <input id="f-agentHome-custom" placeholder="/mnt/gdrive/SharedAgents/my-agent" />
  ```
- [ ] **5.1.3** When `storage === "local"`, keep existing auto-generated `agentHome` behavior (read-only display)
- [ ] **5.1.4** Add **Conversation Log Mode** toggle:
  ```html
  <label>Conversation Logs</label>
  <select id="f-conversationLogMode">
    <option value="shared">Shared (all users see same log)</option>
    <option value="per-user">Per-User (separate log per person)</option>
  </select>
  ```
- [ ] **5.1.5** Update `saveAgent()` function (lines ~3739-3844) to include `storage`, `storageProvider`, `conversationLogMode`, and optionally `agentHome` (when custom) in the POST body

### 5.2 Agent list badges
**File:** `public/org.html`

- [ ] **5.2.1** Show a storage indicator on agent cards — e.g., a small cloud icon for `storage: "drive"` agents, or a "Shared" badge if `conversationLogMode` is set
- [ ] **5.2.2** If `storage` is present in agent config, display it in the agent card subtitle (e.g., "Standard · Google Drive")

---

## Phase 6 — Frontend: Agent Dashboard Updates

### 6.1 Storage info panel
**File:** `public/agent-dashboard.html`

- [ ] **6.1.1** Add "Storage" info row to the agent header/config section showing: storage type, provider, agentHome path
- [ ] **6.1.2** Add "Conversation Mode" indicator: "Shared" or "Per-User" badge

### 6.2 Per-user log viewer
**File:** `public/agent-dashboard.html`

- [ ] **6.2.1** When `conversationLogMode === "per-user"`, add a sender filter dropdown to the logs/conversation section
- [ ] **6.2.2** Populate dropdown from unique senders in the log data (call `GET /api/agents/:id/logs` which returns aggregated data with sender field)
- [ ] **6.2.3** Default to "All Users" view, allow filtering to specific sender

---

## Phase 7 — Frontend: Web UI Auth Integration

### 7.1 Auth wrapper for all pages
**Files:** All `public/*.html` pages

- [ ] **7.1.1** Create `public/auth.js` — shared script that:
  1. On load: calls `GET /api/auth/status`
  2. If `authEnabled && !authenticated`: shows login overlay
  3. Stores token in `localStorage` on successful login
  4. Exports `authFetch()` wrapper that adds `Authorization` header to all requests
- [ ] **7.1.2** Include `<script src="/auth.js"></script>` in every HTML page before other scripts
- [ ] **7.1.3** Replace all `fetch("/api/...")` calls across all pages with `authFetch("/api/...")` (or monkey-patch `window.fetch`)
- [ ] **7.1.4** Create login UI — simple centered card with password input + submit button, matching existing dark theme CSS variables

**List of pages to update** (add auth.js include):
- [ ] `public/home.html`
- [ ] `public/home2.html`
- [ ] `public/org.html`
- [ ] `public/admin.html`
- [ ] `public/lab.html`
- [ ] `public/library.html`
- [ ] `public/marketplace.html`
- [ ] `public/monitor.html`
- [ ] `public/tasks.html`
- [ ] `public/projects.html`
- [ ] `public/gym.html`
- [ ] `public/agent-dashboard.html`
- [ ] `public/settings.html`
- [ ] `public/api-docs.html`
- [ ] `public/mcp-docs.html`
- [ ] `public/user-guide.html`
- [ ] `public/changelog.html`

---

## Phase 8 — APIs (Summary of New/Updated Endpoints)

### New endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/auth/login` | Authenticate with password, return bearer token |
| `GET` | `/api/auth/status` | Check if auth is enabled and whether current request is authenticated |

### Updated endpoints

| Method | Endpoint | Change |
|--------|----------|--------|
| `POST` | `/api/agents` | Accept `storage`, `storageProvider`, `conversationLogMode`; support custom `agentHome` for drive storage |
| `PUT` | `/api/agents/:id` | Accept `storage`, `storageProvider`, `conversationLogMode` updates |
| `GET` | `/api/agents/:id` | Return new fields in response |
| `GET` | `/api/agents` | Return new fields + storage display label for each agent |
| `GET` | `/api/agents/:agentId/logs` | Support `?sender=` filter; aggregate per-user logs when `conversationLogMode === "per-user"` |
| `GET` | `/api/agents/:agentId/cost` | Aggregate costs across per-user log files |

- [ ] **8.1** Implement `POST /api/auth/login`
- [ ] **8.2** Implement `GET /api/auth/status`
- [ ] **8.3** Update `POST /api/agents` with new fields
- [ ] **8.4** Update `PUT /api/agents/:id` with new fields
- [ ] **8.5** Update `GET /api/agents/:id` response
- [ ] **8.6** Update `GET /api/agents` response
- [ ] **8.7** Update `GET /api/agents/:agentId/logs` for per-user mode
- [ ] **8.8** Update `GET /api/agents/:agentId/cost` for per-user mode

---

## Phase 9 — MCP Tools

### New tools to add to `myaiforone` MCP server

- [ ] **9.1** `get_storage_info` — Returns an agent's storage config (storage type, provider, agentHome path, conversationLogMode). Params: `agentId`
- [ ] **9.2** `update_storage_config` — Update an agent's `storage`, `storageProvider`, or `conversationLogMode`. Params: `agentId`, `storage?`, `storageProvider?`, `conversationLogMode?`
- [ ] **9.3** `get_conversation_senders` — For agents with `conversationLogMode: "per-user"`, returns list of unique senders with message counts and last active timestamp. Params: `agentId`
- [ ] **9.4** `get_conversation_log` — Read conversation log with optional sender filter. Params: `agentId`, `sender?` (filter to one user), `since?` (ISO date), `limit?` (max entries)

### Existing tools to verify compatibility

- [ ] **9.5** Verify `create_agent` MCP tool passes through `storage`, `storageProvider`, `conversationLogMode` fields when creating agents
- [ ] **9.6** Verify `update_agent` MCP tool passes through the new fields
- [ ] **9.7** Verify `get_agent` MCP tool returns the new fields

---

## Phase 10 — API Docs Update

**File:** `public/api-docs.html` (or generated Swagger page)

- [ ] **10.1** Add auth section: `POST /api/auth/login`, `GET /api/auth/status`
- [ ] **10.2** Update `POST /api/agents` docs with new fields: `storage`, `storageProvider`, `conversationLogMode`, custom `agentHome`
- [ ] **10.3** Update `PUT /api/agents/:id` docs with new fields
- [ ] **10.4** Update `GET /api/agents/:id` docs — new fields in response
- [ ] **10.5** Update `GET /api/agents/:agentId/logs` docs — new `?sender=` query param
- [ ] **10.6** Add "Shared Agents" section explaining storage config and conversation log modes

## Phase 11 — MCP Docs Update

**File:** `public/mcp-docs.html`

- [ ] **11.1** Add new MCP tools to docs: `get_storage_info`, `update_storage_config`, `get_conversation_senders`, `get_conversation_log`
- [ ] **11.2** Update `create_agent` tool docs with new fields
- [ ] **11.3** Update `update_agent` tool docs with new fields
- [ ] **11.4** Add "Shared Agent Tools" category grouping

---

## Phase 12 — User Guide Update

**File:** `docs/user-guide.md`

- [ ] **12.1** Add "Shared Agents" section — what they are, hybrid model (personal gateway stays, shared gateway for teams)
- [ ] **12.2** Document per-agent storage config — local vs Drive, how to set agentHome for mounted Drive paths
- [ ] **12.3** Document conversation log modes — shared vs per-user, when to use each
- [ ] **12.4** Document auth setup — how to enable auth, set password, get bearer token
- [ ] **12.5** Document deployment options — light (Mac), medium (VPS), with Google Drive mount example
- [ ] **12.6** Add new API endpoints to API reference section
- [ ] **12.7** Add new MCP tools to MCP tools reference section

---

## Phase 13 — Hub Agent CLAUDE.md Update

**File:** `agents/platform/hub/CLAUDE.md`

- [ ] **13.1** Add new MCP tools to Hub's tool reference: `get_storage_info`, `update_storage_config`, `get_conversation_senders`, `get_conversation_log`
- [ ] **13.2** Add instructions for creating shared agents — when user says "create a shared agent" or "create an agent for my team", Hub should set `storage` and `conversationLogMode` appropriately
- [ ] **13.3** Add guidance on storage choice: "local" for agents where server holds data, "drive" for agents where team controls their own data via Google Drive

## Phase 14 — @agentcreator CLAUDE.md Update

**File:** `agents/platform/agentcreator/CLAUDE.md`

- [ ] **14.1** Add shared agent creation flow — detect team/shared intent, ask about storage preference and conversation log mode
- [ ] **14.2** Add guidance on agentHome paths — when `storage: "drive"`, prompt for the mounted drive path

---

## Phase 15 — Comprehensive Test Suite

### `Comprehensive Test Suite/shared-agent/`

- [ ] **15.1** `config.test.ts` — Validate `storage`, `storageProvider`, `conversationLogMode` fields parse correctly in AgentConfig. Test defaults (`storage: "local"`, `conversationLogMode: "shared"`). Test `agentHome` resolution with absolute paths (no `~`).

- [ ] **15.2** `api-crud.test.ts` — Create agent with `storage: "drive"`, `storageProvider: "google-drive"`, custom `agentHome`, `conversationLogMode: "per-user"`. Verify all fields persist in GET response. Update `conversationLogMode` via PUT. Verify `agentHome` cannot be changed after creation.

- [ ] **15.3** `conversation-log-shared.test.ts` — Create agent with `conversationLogMode: "shared"`. Send messages from two different senders. Verify both appear in single `conversation_log.jsonl`. Verify `GET /api/agents/:id/logs` returns both senders' messages interleaved by timestamp.

- [ ] **15.4** `conversation-log-peruser.test.ts` — Create agent with `conversationLogMode: "per-user"`. Send messages from two different senders. Verify separate log files exist (`conversation_log_sender1.jsonl`, `conversation_log_sender2.jsonl`). Verify `GET /api/agents/:id/logs` returns aggregated logs. Verify `GET /api/agents/:id/logs?sender=sender1` returns only sender1's logs.

- [ ] **15.5** `storage-config.test.ts` — Verify `storage: "local"` creates folders at default Drive path. Verify `storage: "drive"` with custom `agentHome` creates folders at the specified absolute path. Verify folder structure is identical in both cases (memory/, FileStorage/, skills/, etc.).

- [ ] **15.6** `auth.test.ts` — When `auth.enabled: false`, all endpoints accessible without token. When `auth.enabled: true`, endpoints return 401 without token. `POST /api/auth/login` with correct password returns token. Endpoints accessible with valid bearer token. Invalid token returns 401. `GET /health` is always accessible (no auth). `GET /api/auth/status` returns correct state.

- [ ] **15.7** `cost-aggregation.test.ts` — For `conversationLogMode: "per-user"`, verify `GET /api/agents/:id/cost` aggregates costs from all per-user log files correctly.

- [ ] **15.8** `mcp-tools.test.ts` — Test `get_storage_info` returns correct storage config. Test `update_storage_config` changes `conversationLogMode`. Test `get_conversation_senders` returns sender list with counts. Test `get_conversation_log` with and without sender filter.

### Existing test updates

- [ ] **15.9** Update `web-ui/all-endpoints.test.ts` — add `POST /api/auth/login`, `GET /api/auth/status` to endpoint inventory
- [ ] **15.10** Update `config/config.test.ts` — add shared agent fields to config validation tests

---

## Phase 16 — Port Tracking & SaaS Flag

- [ ] **16.1** After committing, ask user if they want to create a port task for `@ma41saas` — shared agent infrastructure is highly relevant to the SaaS version

---

## Build Order (Recommended for Overnight Agent)

The agent should execute phases in this order to avoid dependency issues:

```
0. Phase 0  — Feature Gating (gate check utility, capabilities endpoint, admin toggle). MUST BE FIRST.
1. Phase 1  — Config & Types (foundation — everything depends on this)
2. Phase 2  — Auth backend (middleware before other API changes — wrap in gate check)
3. Phase 3  — Per-user conversation logging (executor changes — wrap in gate check)
4. Phase 4  — Agent creation/update API changes (wrap in gate check)
5. Phase 9  — MCP tools (depends on API being done — wrap in gate check)
6. Phase 7  — Web UI auth integration (depends on auth backend — conditional on capabilities.sharedAgents)
7. Phase 5  — Frontend creation modal (depends on API accepting new fields — conditional on capabilities.sharedAgents)
8. Phase 6  — Frontend dashboard updates (conditional on capabilities.sharedAgents)
9. Phase 8  — Verify all API endpoints (integration check)
10. Phase 15 — Tests (validate everything INCLUDING feature gate on/off behavior)
11. Phase 10 — API docs
12. Phase 11 — MCP docs
13. Phase 12 — User guide
14. Phase 13 — Hub CLAUDE.md
15. Phase 14 — @agentcreator CLAUDE.md
16. Phase 16 — Port tracking
```

### Critical path notes for the building agent:
- **Feature is OFF by default.** `sharedAgentsEnabled: false` in config, `sharedAgents: false` in license. Both must be true for the feature to be visible.
- **When the feature is off**, all shared agent UI elements are hidden (storage config, conversation log mode, auth), all shared-agent-specific API fields return 403, the auth system doesn't activate. The feature is invisible to unlicensed users.
- **When the feature is on**, everything works as described in Phases 1-16.
- **Do NOT modify existing personal agent behavior.** All changes must be backward-compatible. When `storage` is undefined, everything works exactly as before.
- **`conversationLogMode` defaults to `"shared"`** — which is identical to current behavior (single log file).
- **`auth.enabled` defaults to `false`** — personal gateways are unaffected.
- **The capabilities endpoint** (`GET /api/capabilities`) is the single source of truth for the frontend. All feature visibility decisions flow from this endpoint.
- **Test both states** — every test file should have cases for feature-on and feature-off behavior.
- **Test after each phase** before moving to the next. Run `node "Comprehensive Test Suite/run-all-tests.js"` after Phases 0-4 and again after Phase 15.
- **Theme compliance:** All new UI elements must use CSS variables (`var(--bg-primary)`, `var(--text-primary)`, etc.) — never hardcode colors.
- **After all code changes:** Run `/opappbuild_agentready_trueup` and `/opappbuild_testsuite_trueup` per CLAUDE.md standing orders.
