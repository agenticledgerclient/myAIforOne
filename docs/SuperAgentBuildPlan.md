# Super Agent — Build Plan

> **Status:** Ready to Build
> **Architecture:** [CrossAgentObserverArchitecture.md](CrossAgentObserverArchitecture.md)
> **Date:** 2026-04-11
> **License Feature Flag:** `superAgents` (default: off)

---

## 0. Feature Gating — License Integration

Super agents are a licensed feature gated behind `superAgents: boolean` in the license. By default this is **off** — users must have a license with `superAgents: true` to use this feature. The code must be organized so that every entry point checks the flag before proceeding.

### 0.1 Service-level config flag
**File:** `src/config.ts`

- [ ] **0.1.1** Add `superAgentsEnabled?: boolean` to `ServiceConfig` — default `false`. This is the local kill switch. The platform checks BOTH this flag AND the license feature.
- [ ] **0.1.2** In `loadConfig()`, default `superAgentsEnabled` to `false`

### 0.2 Gate check utility
**File:** `src/license.ts`

The `isFeatureEnabled("superAgents")` function already exists. Use it at every gate point below. The pattern:

```typescript
import { isFeatureEnabled } from "./license.js";

function isSuperAgentsAllowed(config: AppConfig): boolean {
  // Both the local config flag AND the license feature must be true
  return (config.service as any).superAgentsEnabled !== false && isFeatureEnabled("superAgents");
}
```

### 0.3 Gate points (where to check)

Every place the super agent feature is exposed must check the gate. If the gate is closed, the feature is invisible — not errored, just hidden/absent.

| Gate Point | File | Behavior When Off |
|------------|------|-------------------|
| **Agent creation API** | `src/web-ui.ts` (`POST /api/agents`) | Reject with 403 if `agentClass: "super"` and feature is off |
| **Agent update API** | `src/web-ui.ts` (`PUT /api/agents/:id`) | Reject changes to `observes`/`observeScope` if feature is off |
| **Executor** | `src/executor.ts` | If agent has `agentClass: "super"` but feature is off, return "Super agents are not enabled on this platform" |
| **Org page UI** | `public/org.html` | Hide "Super Agent" option from class selector |
| **Agent dashboard UI** | `public/agent-dashboard.html` | Hide observer config / soul sections if feature is off |
| **MCP tools** | `server/mcp-server/` | `get_observed_agents`, `read_agent_file`, `search_across_agents`, etc. return error if feature is off |
| **API: observed-agents** | `src/web-ui.ts` (`GET /api/agents/:id/observed-agents`) | Return 403 if feature is off |
| **API: soul** | `src/web-ui.ts` (`GET/PUT /api/agents/:id/soul`) | Return 403 if feature is off |

### 0.4 Capabilities endpoint
**File:** `src/web-ui.ts`

- [ ] **0.4.1** Update `GET /api/capabilities` (or create if it doesn't exist) to include `superAgents: boolean` in the response. The frontend reads this to show/hide UI elements.

```typescript
app.get("/api/capabilities", (_req, res) => {
  res.json({
    superAgents: isSuperAgentsAllowed(opts.config),
    sharedAgents: isSharedAgentsAllowed(opts.config),
    // ... other feature flags
  });
});
```

### 0.5 Frontend feature detection
**Files:** All frontend pages that reference super agents

- [ ] **0.5.1** On page load, call `GET /api/capabilities`. Cache the result.
- [ ] **0.5.2** Conditionally show/hide super agent UI elements based on `capabilities.superAgents`
- [ ] **0.5.3** The class selector in org.html only shows "Super Agent" option if `capabilities.superAgents === true`

### 0.6 Admin settings toggle
**File:** `public/admin.html` (Settings tab, Feature Modules section)

- [ ] **0.6.1** Add "Super Agents" toggle to the Feature Modules section (same pattern as AI Gym toggle)
- [ ] **0.6.2** Toggle saves `superAgentsEnabled` via `PUT /api/config/service`
- [ ] **0.6.3** If the license doesn't have `superAgents: true`, show the toggle as disabled with a "Requires license" note

### Build order note
Phase 0 must be built **first** (before Sections 1-16). Every subsequent section wraps its code in the gate check. This ensures the feature can be built, tested, and merged without being visible to users who don't have it licensed.

---

## 1. Backend — Config & Types

- [ ] **1.1** Add `"super"` to `agentClass` union type in `src/config.ts`
- [ ] **1.2** Add `observes` field to `AgentConfig` — `{ agents: string[] | "*", exclude?: string[] }`
- [ ] **1.3** Add `observeScope` field to `AgentConfig` — `{ memory, conversationLog, dailyJournals, context, vectors, tasks, goals, fileStorage, skills, claudeMd, soulMd }` (all booleans)
- [ ] **1.4** Add `observeScopeOverrides` field to `AgentConfig` — `Record<string, Partial<ObserveScope>>` for per-agent overrides
- [ ] **1.5** Update `config.example.json` with a commented super agent example entry

## 2. Backend — Executor (`src/executor.ts`)

- [ ] **2.1** Add `agentClass === "super"` branch for soul.md prepend (single soul file at `agentHome/soul.md`, not trainer-based like gym)
- [ ] **2.2** Add soul.md prepend in the streaming executor path (second location, same pattern as gym)
- [ ] **2.3** When `agentClass === "super"`, set workspace to the super agent's Drive folder (`SuperAgents/<id>/`)
- [ ] **2.4** Build observed-agents path list from `observes` config — resolve each observed agent's `agentHome` to full Drive path
- [ ] **2.5** Generate system prompt section listing accessible paths per observed agent (filtered by `observeScope` + `observeScopeOverrides`)
- [ ] **2.6** Inject the observed-agents context into the system prompt (after soul.md, before CLAUDE.md content)

## 3. Backend — Drive Folder Setup

- [ ] **3.1** When creating a super agent, create `SuperAgents/<id>/` folder in Drive with standard structure: `CLAUDE.md`, `memory/`, `memory/daily/`, `FileStorage/`, `goals/`, `skills/`, `tasks.json`
- [ ] **3.2** Ensure agent creation flow (both API and MCP) resolves `agentHome: "SuperAgents/<id>"` relative to Drive root
- [ ] **3.3** If soul.md content is provided at creation time, write it to `SuperAgents/<id>/soul.md`

## 4. Backend — Web UI Server (`src/web-ui.ts`)

- [ ] **4.1** Update `POST /api/agents` — accept `observes`, `observeScope`, `observeScopeOverrides` fields; default `agentClass` to `"super"` when `observes` is present
- [ ] **4.2** Update `PUT /api/agents/:id` — allow updating `observes`, `observeScope`, `observeScopeOverrides`
- [ ] **4.3** Update `GET /api/agents/:id` — return observer config fields in response
- [ ] **4.4** Update `GET /api/agents` — include `agentClass` badge/filter support for `"super"`
- [ ] **4.5** Add `GET /api/agents/:id/observed-agents` — returns list of observed agent IDs with their `agentHome` paths and resolved scope
- [ ] **4.6** Add `PUT /api/agents/:id/soul` — read/write soul.md content for a super agent
- [ ] **4.7** Add `GET /api/agents/:id/soul` — return soul.md content (or 404 if none)

---

## 5. Frontend — Org Page (`public/org.html`)

- [ ] **5.1** Add "Super Agent" option to agent class selector in creation modal
- [ ] **5.2** When "Super Agent" selected, show observer config section: multi-select of agents to observe (with "All" toggle)
- [ ] **5.3** Add observe scope checkboxes (memory, conversationLog, dailyJournals, context, vectors, tasks, goals, fileStorage, skills, claudeMd, soulMd) with sensible defaults
- [ ] **5.4** Add per-agent scope override UI (expandable per-agent section under the agent multi-select)
- [ ] **5.5** Add soul.md text editor field (optional, collapsible section)
- [ ] **5.6** Show "Super Agent" class badge on agent cards in the agent list

## 6. Frontend — Agent Dashboard (`public/agent-dashboard.html`)

- [ ] **6.1** Add "Observed Agents" panel for super agents — shows which agents are being observed with scope summary
- [ ] **6.2** Add "Soul" tab/section — displays soul.md content with inline editor (save button calls `PUT /api/agents/:id/soul`)
- [ ] **6.3** Add "Observer Config" section — edit `observes`, `observeScope`, `observeScopeOverrides` inline

## 7. Frontend — Home/Chat Pages

- [ ] **7.1** Super agents appear in agent sidebar on `home.html` / `home2.html` like any other agent (no special handling needed — verify this works)
- [ ] **7.2** If the super agent has a soul.md, show a subtle indicator (e.g., soul icon) next to agent name in sidebar

---

## 8. APIs (New Endpoints)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/agents/:id/observed-agents` | List observed agents with resolved scope |
| `GET` | `/api/agents/:id/soul` | Get soul.md content |
| `PUT` | `/api/agents/:id/soul` | Update soul.md content |

**Updated endpoints** (existing, adding super agent fields):

| Method | Endpoint | Change |
|--------|----------|--------|
| `POST` | `/api/agents` | Accept `observes`, `observeScope`, `observeScopeOverrides`, `soul` |
| `PUT` | `/api/agents/:id` | Accept same new fields |
| `GET` | `/api/agents/:id` | Return same new fields |
| `GET` | `/api/agents` | Return `agentClass` for filtering |

## 9. MCP Tools (New)

New tools to add to the `myaiforone` MCP server:

- [ ] **9.1** `get_observed_agents` — List which agents a super agent can see + their current status. Params: `agentId`
- [ ] **9.2** `read_agent_file` — Read a specific file from an observed agent's folder (scope-checked against config). Params: `observerAgentId`, `targetAgentId`, `filePath`
- [ ] **9.3** `search_across_agents` — Semantic search across all observed agents' memory/conversation logs. Params: `agentId`, `query`, `scope?` (memory, conversations, journals)
- [ ] **9.4** `get_cross_agent_timeline` — Merged timeline of events across observed agents (conversations, tasks, goals). Params: `agentId`, `since?`, `limit?`
- [ ] **9.5** `get_agent_activity_summary` — Activity stats for one or all observed agents (message counts, task completions, last active). Params: `agentId`, `targetAgentId?` (omit for all)
- [ ] **9.6** `update_soul` — Update a super agent's soul.md. Params: `agentId`, `content`
- [ ] **9.7** `get_soul` — Read a super agent's soul.md. Params: `agentId`

---

## 10. API Docs (`public/api-docs.html` / Swagger)

- [ ] **10.1** Add new endpoints to API docs page: `GET/PUT /api/agents/:id/soul`, `GET /api/agents/:id/observed-agents`
- [ ] **10.2** Update existing endpoint docs: `POST /api/agents` and `PUT /api/agents/:id` with new fields
- [ ] **10.3** Add "Super Agent" section to API docs explaining the observer config schema

## 11. MCP Docs (`public/mcp-docs.html`)

- [ ] **11.1** Add all new MCP tools to the MCP docs page: `get_observed_agents`, `read_agent_file`, `search_across_agents`, `get_cross_agent_timeline`, `get_agent_activity_summary`, `update_soul`, `get_soul`
- [ ] **11.2** Add "Super Agent Tools" category grouping in the MCP docs navigation

---

## 12. User Guide Update (`docs/user-guide.md`)

- [ ] **12.1** Add "Super Agents" section — what they are, how they differ from standard agents
- [ ] **12.2** Document creation flow — via Org page, @agentcreator, and MCP
- [ ] **12.3** Document observer config — how to select agents, set scope, add per-agent overrides
- [ ] **12.4** Document soul.md — what it is, how to write one, how to edit via dashboard
- [ ] **12.5** Document templates — ME, Advisor, Archivist, Auditor, Team Lead, Custom
- [ ] **12.6** Add super agent entries to the API reference section
- [ ] **12.7** Add super agent MCP tools to the MCP tools reference section

---

## 13. Hub Agent CLAUDE.md Update (`agents/platform/hub/CLAUDE.md`)

- [ ] **13.1** Add new MCP tools to Hub's tool reference: `get_observed_agents`, `read_agent_file`, `search_across_agents`, `get_cross_agent_timeline`, `get_agent_activity_summary`, `update_soul`, `get_soul`
- [ ] **13.2** Add instructions for creating super agents (class, observes config, soul.md)
- [ ] **13.3** Add super agent management guidance — when a user asks to "create an agent that watches my other agents", Hub should know to set `agentClass: "super"`

## 14. @agentcreator CLAUDE.md Update (`agents/platform/agentcreator/CLAUDE.md`)

- [ ] **14.1** Add super agent creation flow — detect cross-agent intent, set class to `"super"`, prompt for observed agents and scope
- [ ] **14.2** Add soul.md generation guidance — when creating a super agent, offer to write a soul based on the user's described personality
- [ ] **14.3** Add template awareness — ME, Advisor, Archivist, Auditor, Team Lead presets

## 15. MCP Config Mapping

- [ ] **15.1** Ensure super agents get `myaiforone` MCP auto-attached (same as platform agents) so they have access to cross-agent tools
- [ ] **15.2** Verify super agents can also have user-configured MCPs on top (additive, not replacing)

---

## 16. Comprehensive Test Suite

### `Comprehensive Test Suite/super-agent/`

- [ ] **16.1** `config.test.ts` — Validate `agentClass: "super"` is accepted, `observes` / `observeScope` / `observeScopeOverrides` parse correctly, defaults work
- [ ] **16.2** `executor.test.ts` — Verify soul.md prepend for super agents, observed-agents path resolution, system prompt injection with scope filtering
- [ ] **16.3** `api-crud.test.ts` — Create/read/update/delete super agent via API, verify observer fields persist and return correctly
- [ ] **16.4** `api-soul.test.ts` — `GET/PUT /api/agents/:id/soul` — create, read, update, delete soul.md
- [ ] **16.5** `api-observed-agents.test.ts` — `GET /api/agents/:id/observed-agents` — returns correct list filtered by config
- [ ] **16.6** `scope-filtering.test.ts` — Verify `observeScope` correctly includes/excludes paths, `observeScopeOverrides` per-agent overrides work
- [ ] **16.7** `super-to-super.test.ts` — Super agent observing another super agent works correctly
- [ ] **16.8** `mcp-tools.test.ts` — All 7 new MCP tools return correct data, respect scope permissions
- [ ] **16.9** `drive-folder.test.ts` — Super agent creation creates correct folder structure in `SuperAgents/`

### Existing test updates

- [ ] **16.10** Update `web-ui/all-endpoints.test.ts` — add new endpoints to the comprehensive endpoint test
- [ ] **16.11** Update `config/config.test.ts` — add super agent class to config validation tests

---

## Build Order (Recommended)

1. **Feature gating** (Section 0) — gate check utility, capabilities endpoint, admin toggle. MUST BE FIRST.
2. **Config & types** (Section 1) — foundation everything else depends on
3. **Drive folder setup** (Section 3) — needed before executor can resolve paths
4. **Executor** (Section 2) — soul.md + observed-agents system prompt (wrap in gate check)
5. **API endpoints** (Sections 4, 8) — backend routes for create/update/read (wrap in gate check)
6. **MCP tools** (Section 9) — cross-agent query tools (wrap in gate check)
7. **Frontend — Org page** (Section 5) — creation UI (conditional on capabilities.superAgents)
8. **Frontend — Dashboard** (Section 6) — management UI (conditional on capabilities.superAgents)
9. **Frontend — Home** (Section 7) — verify chat works
10. **Tests** (Section 16) — validate everything INCLUDING feature gate on/off behavior
11. **Docs** (Sections 10–14) — API docs, MCP docs, user guide, agent CLAUDE.md updates
12. **MCP mapping** (Section 15) — verify MCP auto-attachment

### Critical path notes for the building agent:
- **Feature is OFF by default.** `superAgentsEnabled: false` in config, `superAgents: false` in license. Both must be true for the feature to be visible.
- **When the feature is off**, all super agent UI elements are hidden, all super agent API endpoints return 403, executor rejects super agent execution. The feature is invisible to unlicensed users.
- **When the feature is on**, everything works as described in Sections 1-16.
- **The capabilities endpoint** (`GET /api/capabilities`) is the single source of truth for the frontend. All feature visibility decisions flow from this endpoint.
- **Test both states** — every test file should have cases for feature-on and feature-off behavior.
