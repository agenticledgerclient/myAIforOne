# MyAIforOne Lite — Build Checklist

## Overview

MyAIforOne Lite is a free, lightweight version of the gateway. Ships with a Hub agent + web UI chat. Users install additional agents from the remote **Agent Registry** (hosted on myaiforone.com) via chat with Hub. Revenue: free agents drive adoption → agent cap drives Pro upgrade → premium agents drive purchases.

---

## Phase 1: Agent Registry API (myaiforone.com backend)

- [ ] **1.1** Design agent package schema (CLAUDE.md, skills[], config template, required MCPs, metadata)
- [ ] **1.2** Create `/api/registry/agents` endpoint — list/search agents with category, tags, free/premium
- [ ] **1.3** Create `/api/registry/agents/:id` endpoint — return agent detail (description, capabilities, requirements)
- [ ] **1.4** Create `/api/registry/agents/:id/package` endpoint — return full installable package (CLAUDE.md, skills, config block, MCP requirements)
- [ ] **1.5** Seed registry with initial agents (convert existing templates to registry entries)
- [ ] **1.6** Add premium/free flag and license-check gate for paid agents

## Phase 2: Agent Registry Page (myaiforone.com frontend)

- [ ] **2.1** Create `/agents` route — separate page from current single-page site
- [ ] **2.2** Browsable grid layout with agent cards (name, description, category, free/premium badge)
- [ ] **2.3** Category/tag filtering and search
- [ ] **2.4** Agent detail view — full description, capabilities, required MCPs, screenshots
- [ ] **2.5** "Hire This Agent" CTA — shows paste-able Hub message: *"Please install @finance from the Agent Registry, ID: mkt_finance_v2"*
- [ ] **2.6** "Don't have MyAIforOne?" fallback CTA — links to download page
- [ ] **2.7** SEO-friendly individual agent pages (e.g., `/agents/finance-assistant`)

## Phase 3: `myaiforone-lite` MCP Server

- [x] **3.1** Create `server/mcp-server-lite/` directory with its own `index.ts` and `tsconfig.json`
- [x] **3.2** Create `lib/api-client.ts` — same pattern as full MCP, calls local gateway API + remote registry
- [x] **3.3** Implement core tools:
  - [x] `health_check` — gateway status
  - [x] `list_agents` — list installed agents
  - [x] `get_agent` — agent detail
  - [x] `get_agent_instructions` — read CLAUDE.md
  - [x] `uninstall_agent` — remove an agent
- [x] **3.4** Implement chat tools:
  - [x] `send_message` — send message to an agent
  - [x] `start_stream` — start streaming chat
  - [x] `get_chat_job_raw` — poll stream results
  - [x] `stop_chat_job` — stop running job
  - [x] `reset_session` — clear agent session
- [x] **3.5** Implement Agent Registry tools:
  - [x] `browse_agent_registry` — search/browse remote registry (calls myaiforone.com API)
  - [x] `get_agent_detail` — get full details of a specific agent by id or slug (was: `get_registry_agent`)
  - [x] `get_agent_package` — get installable package (CLAUDE.md, agent.json, skills) for an agent
  - [x] `list_categories` — list all available agent categories
  - [x] `install_agent` — fetch package from registry, create agent via local API, return needed API keys
- [x] **3.6** Implement config tools:
  - [x] `list_mcps` — list configured MCPs
  - [x] `save_mcp_key` — store API key for an MCP
  - [x] `get_service_config` — read service config
- [x] **3.7** Build step — added to `package.json` build script, compiles to `server/mcp-server-lite/dist/`
- [x] **3.8** Named `myaiforone-lite` (distinct from `myaiforone` / `myaiforone-local`)
- [x] **3.9** Template tools — `list_templates` + `deploy_template` for local template compatibility

## Phase 4: Lite Hub Agent

- [x] **4.1** Create `agents/platform/hub-lite/` directory
- [x] **4.2** Write `CLAUDE.md` — simplified Hub prompt focused on:
  - General-purpose chat assistant
  - Browsing the Agent Registry (`browse_agent_registry`)
  - Installing agents (`install_agent`)
  - Walking users through MCP API key setup (`save_mcp_key`)
  - Listing installed agents (`list_agents`)
  - No boards, no projects, no crons, no orgs, no channels
- [x] **4.3** Include starter `memory/context.md` with welcome context
- [x] **4.4** Skills are pulled down with agents — no separate skill install step
- [x] **4.5** Registry MCP integration wired:
  - [x] Registry MCP URL wired into config.lite.json (`myaiforone-registry` → `https://myaiforone.com/mcp/registry`)
  - [x] Hub-Lite CLAUDE.md updated with correct tool names and registry tools section
  - [x] Tool name reconciled: `get_registry_agent` → `get_agent_detail` (confirmed live tool name)

## Phase 5: Lite Gateway Configuration

- [x] **5.1** Create `config.lite.json` template — minimal config with:
  - `myaiforone-lite` MCP server reference
  - No channels
  - No default skills/MCPs
  - Agent cap setting (`maxAgents: 5`)
  - `edition: "lite"` flag
- [x] **5.2** Lite mode flag in service config (`service.edition: "lite"` vs `"pro"`) — added to `ServiceConfig` interface
- [x] **5.3** Enforce agent cap — `POST /api/agents` returns 403 when cap reached in Lite edition
- [x] **5.4** Service config API exposes `edition` and `maxAgents` fields
- [x] **5.5** Web UI adjustments for Lite:
  - [x] `public/lite-mode.js` — fetches edition from API, hides Pro-only nav/pages
  - [x] Hides: Boards, Projects, Automations, AI Gym, Channels tab
  - [x] Redirects away from Pro-only pages if navigated directly
  - [x] Upgrade prompt modal when agent cap hit during creation
  - [x] Script included in all 21 HTML pages
  - [x] No-op when edition is "pro" — zero impact on existing installs

## Phase 6: Lite Packaging & Distribution

- [ ] **6.1** Lite build script — strips full MCP server, channel drivers, board/project/cron code from build
- [x] **6.2** `/setup` flow for Lite — detects Lite edition, creates hub-lite agent, skips channel setup
  - [x] Edition detection at top of setup wizard (checks config.json edition or config.lite.json presence)
  - [x] Lite path: skip channels, minimal Drive folders, hub-lite agent only, myaiforone-lite MCP
  - [x] Pro path: completely unchanged
- [ ] **6.3** Installer for macOS (DMG or pkg)
- [ ] **6.4** Installer for Windows (MSI or exe via electron-builder or similar)
- [ ] **6.5** Download page on myaiforone.com with platform detection

## Phase 7: Upgrade Path (Lite → Pro)

- [x] **7.1** Upgrade mechanism — `POST /api/upgrade` endpoint swaps `myaiforone-lite` MCP for `myaiforone-local`
- [x] **7.2** Endpoint swaps hub-lite CLAUDE.md paths for full hub paths (claudeMd, agentHome, memoryDir)
- [x] **7.3** Endpoint sets `maxAgents: 0` (unlimited) and `edition: "pro"`
- [x] **7.4** Web UI auto-unlocks (lite-mode.js sees edition "pro" → no-op, all nav visible)
- [x] **7.5** All installed agents carry over — same folder structure, zero migration (verified by design)
- [x] **7.6** License key stored if provided (validation against license server is future work)
- [x] **7.7** `upgrade_to_pro` MCP tool added to Lite MCP server — Hub can trigger upgrade via chat

---

## Build Order

1. **Phase 3** — Lite MCP server (foundation everything else depends on)
2. **Phase 4** — Lite Hub agent (needs Lite MCP)
3. **Phase 5** — Lite config + Web UI tweaks (needs Hub + MCP)
4. **Phase 1** — Registry API on myaiforone.com (can parallel with 3-5)
5. **Phase 2** — Registry page on myaiforone.com (needs API)
6. **Phase 6** — Packaging (needs everything above)
7. **Phase 7** — Upgrade path (needs Lite + Pro both working)

## Naming Conventions

- **Product**: MyAIforOne Lite / MyAIforOne Pro
- **MCP Server**: `myaiforone-lite` (not `myaiforone-local`, not `myaiforone`)
- **Agent catalog**: "Agent Registry" (not "marketplace", not "store")
- **Website page**: `/agents` with heading "Agent Registry" or "View Agents"
- **Install action**: "Hire" (on website), "Install" (in Hub chat)
- **MCP tools**: `browse_agent_registry`, `install_agent`, `uninstall_agent`
