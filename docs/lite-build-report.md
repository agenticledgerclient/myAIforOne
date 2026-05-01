# MyAIforOne Lite — Build Report

**Date:** 2026-04-30
**Status:** Phases 3-5 complete. Phases 1-2 spec'd for site agent. Phases 6-7 pending.

---

## What Was Built

### Phase 3: `myaiforone-lite` MCP Server ✅

**Files created:**
- `server/mcp-server-lite/index.ts` — 18-tool MCP server
- `server/mcp-server-lite/lib/api-client.ts` — API client for local gateway + remote registry
- `server/mcp-server-lite/tsconfig.json` — TypeScript config
- `server/mcp-server-lite/dist/` — Compiled output

**Tool inventory (18 tools):**

| Category | Tools |
|----------|-------|
| Health | `health_check` |
| Agents | `list_agents`, `get_agent`, `get_agent_instructions`, `uninstall_agent` |
| Chat | `send_message`, `start_stream`, `get_chat_job_raw`, `stop_chat_job`, `reset_session` |
| Agent Registry | `browse_agent_registry`, `get_registry_agent`, `install_agent` |
| MCP Keys | `list_mcps`, `save_mcp_key` |
| Config | `get_service_config` |
| Templates | `list_templates`, `deploy_template` |

**Key design decisions:**
- Named `myaiforone-lite` (distinct from `myaiforone-local` for clean upgrade path)
- API client supports two base URLs: local gateway (`MYAGENT_API_URL`) and remote registry (`MYAGENT_REGISTRY_URL`)
- `install_agent` fetches the full package from registry, then calls local `create_agent` API — no direct file manipulation
- Auth tokens only attached to local gateway calls, not registry calls

---

### Phase 4: Lite Hub Agent ✅

**Files created:**
- `agents/platform/hub-lite/CLAUDE.md` — Simplified system prompt (~3KB vs full hub's ~6.5KB)
- `agents/platform/hub-lite/memory/context.md` — Starter context

**Hub Lite capabilities:**
- General-purpose chat assistant
- Browse and install agents from the Agent Registry
- Walk users through MCP API key setup after install
- Parse paste-able install commands from myaiforone.com
- Send messages to installed agents on behalf of the user
- Upsell Pro features when user asks about boards/projects/crons/etc.

**What Hub Lite does NOT do (Pro only):**
- Boards, Projects, Automations, Organizations, Channels
- Advanced memory, wiki sync, heartbeats
- Agent creation from scratch (only from Registry or templates)

---

### Phase 5: Lite Gateway Configuration ✅

**Files created/modified:**

| File | Change |
|------|--------|
| `config.lite.json` | NEW — Minimal config template: edition "lite", maxAgents 5, myaiforone-lite MCP only, no channels, no default skills |
| `src/config.ts` | MODIFIED — Added `edition` ("lite" \| "pro") and `maxAgents` to `ServiceConfig` interface |
| `src/web-ui.ts` | MODIFIED — Service config API returns `edition` and `maxAgents`; agent creation enforces cap with 403 + `upgradeRequired` flag |
| `public/lite-mode.js` | NEW — Frontend edition detection, hides Pro-only nav items, redirects from Pro pages, upgrade prompt modal |
| `package.json` | MODIFIED — Build script includes Lite MCP compilation; `config.lite.json` added to files array |
| All 21 HTML pages | MODIFIED — Include `lite-mode.js` script |

**Agent cap enforcement:**
- `POST /api/agents` checks `edition === "lite"` and `maxAgents > 0`
- Returns `{ error: "Agent limit reached (5)...", upgradeRequired: true }` with 403 status
- Frontend catches `upgradeRequired` and shows styled upgrade modal

**Web UI Lite behavior:**
- Hides: Boards, Projects, Automations sub-nav links, AI Gym toggle, Channels admin tab, Boards gear button
- Redirects: Direct navigation to `/boards`, `/projects`, `/automations`, `/gym` redirects to home
- Keeps: Home, Chat, Agents list, Library, Lab, Monitor, Admin/Settings
- No-op in Pro: When `edition !== "lite"`, the script does nothing — zero impact on existing installs

---

## What Was Spec'd (for site agent)

### Phases 1-2: Agent Registry API + Page

**Detailed instructions document:** `docs/agent-registry-site-build.md`

This document provides the myaiforone.com site agent with everything needed to build:

1. **Agent Registry API** (3 endpoints):
   - `GET /api/registry/agents` — Browse/search with category, tier, pagination
   - `GET /api/registry/agents/:id` — Agent detail
   - `GET /api/registry/agents/:id/package` — Full installable package JSON

2. **Agent Registry Page** (`/agents`):
   - Browsable card grid with category filters and search
   - Agent detail view with capabilities, requirements, screenshots
   - "Hire This Agent" CTA with paste-able Hub message + clipboard copy
   - "Don't have MyAIforOne?" download fallback
   - SEO-friendly slugged URLs per agent

3. **Complete package schema** — Every field documented with types and descriptions
4. **10 seed categories** and **10 starter agent archetypes**
5. **Naming conventions** — "Agent Registry" (not marketplace), "Hire" (on web), "Install" (in app)

---

## What Remains

| Phase | Items | Notes |
|-------|-------|-------|
| **1** | Agent Registry API | Hand `docs/agent-registry-site-build.md` to the site agent |
| **2** | Agent Registry Page | Same doc covers both phases |
| **6.1** | Lite build script | Strip unnecessary code from Lite builds |
| **6.2** | `/setup` flow for Lite | Detect edition, create hub-lite, skip channel setup |
| **6.3** | macOS installer | DMG or pkg |
| **6.4** | Windows installer | MSI or exe |
| **6.5** | Download page | Platform detection on myaiforone.com |
| **7.1** | Upgrade: swap MCP | `myaiforone-lite` → `myaiforone-local` |
| **7.2** | Upgrade: swap Hub | hub-lite CLAUDE.md → full hub CLAUDE.md |
| **7.3** | Remove agent cap | Set maxAgents to 0 or remove edition flag |
| **7.4** | Enable full UI | All nav items visible |
| **7.5** | Agent migration | Zero migration needed — same folder structure |
| **7.6** | License validation | Check against license server |

---

## File Summary

### New files (8):
```
server/mcp-server-lite/index.ts
server/mcp-server-lite/lib/api-client.ts
server/mcp-server-lite/tsconfig.json
server/mcp-server-lite/dist/          (compiled output)
agents/platform/hub-lite/CLAUDE.md
agents/platform/hub-lite/memory/context.md
config.lite.json
public/lite-mode.js
docs/agent-registry-site-build.md
docs/lite-build-report.md            (this file)
```

### Modified files (4 + 21 HTML):
```
package.json                          (build script, files array)
src/config.ts                         (ServiceConfig interface)
src/web-ui.ts                         (service config API, agent cap)
public/*.html                         (21 pages — lite-mode.js include)
```

### Build status:
- `npm run build` — **Clean** (all 3 TypeScript compilations pass)
- No runtime errors introduced — Lite mode is opt-in via `edition: "lite"` in config
- Existing Pro installs are unaffected (edition defaults to "pro")
