# Marketplace Design Spec
**Date:** 2026-03-25
**Project:** channelToAgentToClaude
**Status:** Approved

---

## Overview

A marketplace for browsing, installing, and assigning MCPs, skills, and agent templates. Users discover items (from the platform or external sources), install them in one click, and optionally assign them to one or more agents via a post-install modal.

Two-step model: **install** (makes the item available system-wide, writes to `config.mcps` if needed) → **assign** (attaches it to specific agents by writing to `agents[id].mcps[]` or `agents[id].skills[]`). These are independent — install does not force assignment.

---

## 1. Registry Data Layer

### Folder Structure

```
/registry/
  mcps.json          ← all MCPs (platform + external)
  skills.json        ← all skills (platform + external)
  agents.json        ← all agent templates (platform + external)
  skills/
    platform/        ← .md files for AgenticLedger skills
    external/        ← downloaded external skill files (e.g. affaan-m)
  agents/
    platform/        ← agent CLAUDE.md + agent.json templates
    external/        ← downloaded external agent templates
```

### Entry Schema (all three types share base fields)

```json
{
  "id": "stripe",
  "name": "Stripe",
  "provider": "AgenticLedger",
  "description": "Payment processing — customers, invoices, subscriptions, charges, refunds",
  "category": "payments",
  "verified": true,
  "source": "agenticledger/platform",
  "tags": ["payments", "invoices", "billing"],
  "fetch": {
    "type": "http",
    "url": "https://stripemcp.agenticledger.ai/mcp"
  }
}
```

### fetch.type Values

| type | used by | install action |
|---|---|---|
| `http` | AgenticLedger MCPs | write full entry to `config.mcps[id]` (url + empty headers) |
| `npm` | community MCPs (e.g. GitHub MCP) | `npm install {package}`, write stdio entry to `config.mcps[id]` |
| `local` | local MCP scripts | copy file to `agents/_shared/mcps/{id}/`, write stdio entry to `config.mcps[id]` |
| `file` | skills, agent templates | copy `localPath` → destination |

### config.mcps Entry Structure by fetch.type

Every MCP must have a valid `config.mcps` entry before it can be assigned to any agent (the executor validates this at startup). Install writes this entry. Assign only writes to `agents[id].mcps[]`.

**http MCP entry (written at install):**
```json
{
  "type": "http",
  "url": "https://stripemcp.agenticledger.ai/mcp",
  "headers": {}
}
```

**npm MCP entry (written at install):**

The registry entry for npm MCPs must include `fetch.package` (the npm package name) so the install handler knows what to install:
```json
"fetch": {
  "type": "npm",
  "package": "@modelcontextprotocol/server-github",
  "args": ["-y", "@modelcontextprotocol/server-github"]
}
```

The `config.mcps` entry written at install time:
```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {}
}
```

**local MCP entry (written at install):**
```json
{
  "type": "stdio",
  "command": "node",
  "args": ["agents/_shared/mcps/{id}/index.js"],
  "env": {}
}
```

### Skills localPath

Skills and agent templates add `"localPath"` pointing to their file in the registry:
```json
"localPath": "registry/skills/platform/sop_pptx.md"
```

### verified Flag

- `true` — AgenticLedger platform items. All 47 existing MCPs and all 67 skills are verified.
- `false` — external/community items. Marked clearly in UI.

---

## 2. Registry Seeding

### MCPs
Migrate `mcp-catalog.json` → `registry/mcps.json`. Add `verified: true`, `fetch.type: "http"`, `source: "agenticledger/platform"` to each entry. Existing `requiredKeys` field retained.

### Skills — Seed Script (one-time, run at setup)
A script at `scripts/seed-registry.ts` scans `~/.claude/commands/` and generates `registry/skills.json`. Each file gets an entry with:
- `id` from filename (strip `.md`)
- `name` from first `# heading` in file, or title-cased id
- `description` from line after first heading, or empty
- `localPath` pointing to `registry/skills/platform/{id}.md`
- Files copied to `registry/skills/platform/`

The seed script is run once during setup. The registry does not auto-update when skills are added manually — re-run the script to refresh. Runtime API reads from `registry/skills.json` only (no live directory scan on every request).

### External Skills (affaan-m/everything-claude-code)
Curated set fetched once and saved to `registry/skills/external/`:
- `tdd`, `code-review`, `debug`, `plan`, `build-fix`, `verify`
- `verified: false`, `provider: "affaan-m"`
- Source tracked in `source` field for attribution and future updates
- Committed to the repo so all clones get them automatically

### Agent Templates
Initial `registry/agents.json` starts with a minimal set. New templates added manually.

**Agent template install must not write to config.json immediately** — `config.ts` throws a hard startup error if any agent has `routes.length === 0`. Draft agents are instead stored in a separate `registry/installed-drafts.json` file (outside config.json) until the user configures at least one route via the existing agent editor in `/org`. Once a route is saved, the agent editor's existing `POST /api/agents/:id` endpoint writes the full valid entry to config.json. The marketplace install step only creates the `agents/{id}/` directory, writes `agents/{id}/agent.json` with `draft: true`, and appends to `registry/installed-drafts.json`. The marketplace UI reads `installed-drafts.json` to show draft agents in an "Needs setup → Go to Org" state.

---

## 3. Backend API

Three endpoints added to `src/web-ui.ts`. All reads use the in-memory `opts.config` object (not re-parsing config.json from disk) to stay consistent with what the executor sees. All writes update both config.json on disk AND `opts.config` in memory immediately.

**Note:** config.json writes follow the existing read→mutate→write pattern used throughout web-ui.ts. Concurrent rapid writes carry the same race risk as all other config writes in this codebase — a file-lock is deferred to a future refactor.

### GET `/api/marketplace/:type`
Returns all registry entries for `type` ∈ `mcps | skills | agents`, with computed status fields appended to each entry.

**installed detection:**
- skill → `existsSync(join(getPersonalAgentsDir(), "skills", "{id}.md")) || existsSync(join(homedir(), ".claude", "commands", "{id}.md"))` (checks both locations the executor uses, in order)
- MCP → `opts.config.mcps[id] !== undefined`
- agent template → `existsSync("agents/{id}/")`

**assignedTo detection:**
- Scan `opts.config.agents` — collect all agentIds where `agent.mcps.includes(id)` or `agent.skills.includes(id)`

Response shape:
```json
{
  "items": [
    {
      ...registryEntry,
      "installed": true,
      "assignedTo": ["myagent-dev", "mailcal"]
    }
  ]
}
```

### POST `/api/marketplace/install`
Body: `{ type: "skill" | "mcp" | "agent", id: string }`

**Install actions by type:**

| type | action |
|---|---|
| skill | copy `registry/skills/**/{id}.md` → `{personalAgentsSkillsDir}/{id}.md` (preferred) |
| MCP http | write full http entry to `config.mcps[id]` on disk + in `opts.config.mcps` |
| MCP npm | spawn `npm install {package}` (30s timeout), write stdio entry to `config.mcps[id]` on disk + memory |
| MCP local | copy file to `agents/_shared/mcps/{id}/`, write stdio entry to config |
| agent | copy `registry/agents/**/{id}/` → `agents/{id}/`, write `agents/{id}/agent.json` with `draft: true`, append to `registry/installed-drafts.json` (NOT config.json — see Section 2) |

Returns: `{ ok: true, item: { ...entry, installed: true }, requiresKeys: boolean }`

`requiresKeys: true` when the item is an MCP with non-empty `requiredKeys`. The frontend uses this flag to decide whether to show the key-entry step before or after the assign modal.

### POST `/api/marketplace/assign`
Body: `{ type: string, id: string, agentIds: string[] }`

For each agentId in agentIds:
- **skill** → add `id` to `opts.config.agents[agentId].skills[]` if not present; write to config.json
- **MCP** → add `id` to `opts.config.agents[agentId].mcps[]` if not present; write to config.json; if `requiredKeys` is non-empty and no key file exists at `agents/{agentId}/mcp-keys/{id}.env`, create an empty stub file so the executor does not throw — but the UI must alert the user that a real key is needed

Returns: `{ ok: true, assigned: agentIds, missingKeys: agentIds[] }`

`missingKeys` lists any agents that were assigned but have no API key yet — the frontend prompts the user to add keys for those.

---

## 4. Frontend — `/marketplace`

### Page Structure

Standalone page at `/marketplace`. Linked from the top nav. File: `public/marketplace.html`.

```
[Nav: Dashboard | Org | Marketplace | Activity]

[MCPs] [Skills] [Agents]     🔍 Search...    [All] [payments] [dev] [productivity] ...

┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│  Card    │ │  Card    │ │  Card    │ │  Card    │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
```

### Card States

**Available (not installed):**
- Name, provider, verified badge (✓ green for platform, grey label for external)
- Description, category tag
- `[+ Install]` button (indigo)

**Installed:**
- Green `✓ Installed` badge top-right
- `[Manage]` button → opens assign modal for already-installed item
- If MCP with missing keys on any agent: amber `⚠ Needs key` indicator

### Post-Install Flow

1. `POST /api/marketplace/install` called on click
2. If `requiresKeys: true` → show key-entry step first (re-uses existing key input UI pattern)
3. Post-install assign modal opens:

```
✓ Stripe MCP installed

Assign to agents now? (optional)

☐ myagent-dev
☐ mailcal
☐ buildinpublic
...

[Assign selected]   [Skip for now]
```

- Multi-select checkboxes
- "Assign selected" calls `POST /api/marketplace/assign`
- If response includes `missingKeys`, show inline alert: "Add API key for [agent] to activate"
- "Skip for now" closes modal

**Manage flow** (already-installed items): same modal, pre-checks agents that already have the item.

### Filters

- Tab filter: MCPs / Skills / Agents
- Category pills: dynamically generated from registry data
- Search: client-side filter on name + description + tags

---

## 5. Error Handling

- Install failure → toast error, card reverts to available state
- npm install timeout (>30s) → error toast with package name
- Assign failure → modal stays open, shows inline error
- Registry file missing/malformed → empty state with message
- Missing keys after assign → amber warning per-agent, not a blocking error

---

## 6. Out of Scope

- Uninstall / removing installed items
- Version management or auto-updates for external items
- User-submitted community listings
- Ratings or reviews
- Per-agent marketplace view (the assign modal covers this need)
- File-lock on config.json writes (existing technical debt, deferred)
