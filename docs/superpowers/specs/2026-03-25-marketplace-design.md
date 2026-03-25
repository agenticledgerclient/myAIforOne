# Marketplace Design Spec
**Date:** 2026-03-25
**Project:** channelToAgentToClaude
**Status:** Approved

---

## Overview

A marketplace for browsing, installing, and assigning MCPs, skills, and agent templates. Users discover items (from the platform or external sources), install them in one click, and optionally assign them to one or more agents via a post-install modal.

Two-step model: **install** (makes the item available system-wide) → **assign** (attaches it to specific agents). These are independent — install does not force assignment.

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
| `http` | AgenticLedger MCPs | no download — URL stored in config when assigned |
| `npm` | community MCPs (e.g. GitHub MCP) | `npm install {package}` |
| `local` | local MCP scripts | file copy |
| `file` | skills, agent templates | copy `localPath` → destination |

Skills and agent templates add:
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

### Skills
Auto-generate `registry/skills.json` by scanning `~/.claude/commands/`. Each file gets an entry with:
- `id` from filename (strip `.md`)
- `name` from first heading in file or title-cased id
- `description` from file frontmatter or second line
- `localPath` pointing to `registry/skills/platform/{id}.md`
- Files copied to `registry/skills/platform/`

### External Skills (affaan-m/everything-claude-code)
Curated set fetched and saved to `registry/skills/external/`:
- `tdd`, `code-review`, `debug`, `plan`, `build-fix`, `verify`
- `verified: false`, `provider: "affaan-m"`
- Source tracked in `source` field for attribution and future updates

### Agent Templates
Initial `registry/agents.json` with `_template` entry. Expanded manually as templates are built.

---

## 3. Backend API

Four endpoints added to `src/web-ui.ts`:

### GET `/api/marketplace/:type`
Returns all items for `type` ∈ `mcps | skills | agents`.

Each item includes computed fields:
- `installed: boolean` — whether the item is available in the system
- `assignedTo: string[]` — list of agent IDs that have this item assigned

**Installed detection:**
- skill → `existsSync("~/.claude/commands/{id}.md")`
- MCP http → always `true` (URL-based, no install step needed)
- MCP npm → check if package directory exists in node_modules
- agent template → `existsSync("agents/{id}/")`

### POST `/api/marketplace/install`
Body: `{ type: "skill" | "mcp" | "agent", id: string }`

Actions by type:
- **skill** → copy `registry/skills/**/{id}.md` to `~/.claude/commands/{id}.md`
- **MCP http** → no-op (already available), return `{ ok: true, alreadyAvailable: true }`
- **MCP npm** → spawn `npm install {package}`, update config.json mcps block
- **agent** → copy template files to `agents/{id}/`, add stub entry to config.json

Returns: `{ ok: true, item: { ...entry, installed: true } }`

### POST `/api/marketplace/assign`
Body: `{ type: string, id: string, agentIds: string[] }`

For each agentId in agentIds:
- **skill** → add `id` to agent's `skills[]` in config.json if not already present
- **MCP** → add `id` to agent's `mcps[]` in config.json if not already present, copy requiredKeys stub to agent's `mcp-keys/` dir if needed

Returns: `{ ok: true, assigned: agentIds }`

### GET `/api/marketplace/installed`
Returns a summary: all installed items grouped by type, each with `assignedTo[]` list.

---

## 4. Frontend — `/marketplace`

### Page Structure

Standalone page at `/marketplace`. Nav matches existing pages.

```
[Nav: Dashboard | Org | Marketplace | Activity]

[MCPs] [Skills] [Agents]          🔍 Search...    [All] [payments] [dev] [productivity] ...

┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│  Card    │ │  Card    │ │  Card    │ │  Card    │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
```

### Card States

**Available (not installed):**
- Name, provider, verified badge (✓ green for platform, grey for external)
- Description, category tag
- `[+ Install]` button (indigo)

**Installed:**
- Green `✓ Installed` badge top-right
- `[Manage]` button → opens assign modal for already-installed item

### Post-Install Assign Modal

Triggered automatically after successful install. Also accessible via "Manage" on installed cards.

```
✓ Stripe MCP installed

Assign to agents now? (optional)

☐ myagent-dev
☐ mailcal
☐ buildinpublic
☐ ailead
...

[Assign selected]   [Skip for now]
```

- Multi-select checkboxes
- Pre-checks agents that already have the item assigned (for "Manage" flow)
- "Assign selected" calls `POST /api/marketplace/assign`
- "Skip for now" closes modal, item remains installed but unassigned

### Filters

- Tab filter: MCPs / Skills / Agents
- Category pills: dynamically generated from registry data
- Search: client-side filter on name + description + tags

---

## 5. Error Handling

- Install failure → toast error, card reverts to available state
- Assign failure → modal stays open, shows error inline
- Registry file missing → marketplace shows empty state with explanation
- npm install timeout → 30s timeout, clear error message

---

## 6. What Is Not In Scope

- Uninstall (removing an installed item) — future feature
- Version management / updates for external items
- User-submitted community listings
- Ratings or reviews
- Per-agent marketplace (browsing from inside an agent config) — assign modal covers this need
