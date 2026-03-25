---
name: opMCPAddTools
description: "Add new tools to an existing MCP server. Updates api-client, tools, tests, docs, AgentHub copy, and MCPLive demo. Use when new API endpoints need to be added to an already-released MCP server."
allowed-tools: Read, Write, Edit, Glob, Grep, Task, Bash(npm:*), Bash(npx:*), Bash(node:*), Bash(git:*), Bash(curl:*), WebFetch
argument-hint: [MCP-name] [description-of-new-endpoints]
---

# MCP Add Tools — Extend an Existing MCP Server

Add new tools to an already-released MCP server. This skill handles the 6-file update pattern plus downstream sync to AgentHub and MCPLive.

**Arguments:**
- `MCP-name` — The existing MCP folder name (e.g., `EnterpriseWalletManager`, `StripeMCP`)
- `description-of-new-endpoints` — What new endpoints to add (or ask the user)

If no arguments provided, ask the user for both values before proceeding.

---

## Key Paths

| Resource | Path |
|----------|------|
| **MCP source dir** | `C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\{MCPName}\mcp-server\` |
| **api-client.ts** | `{MCP source dir}\src\api-client.ts` |
| **tools.ts** | `{MCP source dir}\src\tools.ts` |
| **test-tools.ts** | `{MCP source dir}\test\test-tools.ts` |
| **docs/index.html** | `{MCP source dir}\docs\index.html` |
| **MCPLive** | `C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\MCPLive\` |
| **AgentHub MCP dir** | `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\AgentHub\server\src\mcp-servers\{slug}\` |

**Git repos (IMPORTANT — commit to these, NOT agenticportal):**

| Repo | Git Remote | Branch |
|------|-----------|--------|
| **MCPLive** | `agenticledger/financeMCPsLive` | `main` |
| **AgentHub** | `agenticledger/agenticledger_agenthub` | `main_dev` + merge to `main` |

The MCP source code at `FinanceStackMCPs/{MCPName}/mcp-server/` lives inside the `clawd` directory which is the `oregpt/agenticportal` repo. **Do NOT commit MCP changes to agenticportal.** The source files are the working copy — downstream copies in MCPLive and AgentHub are the committed artifacts.

---

## Phase 1: Inventory

Before writing any code, understand what exists and what's being added.

### Step 1: Read the existing files

Read all 4 source files to understand current tool count, categories, and patterns:

```
{MCP source dir}/src/api-client.ts   — existing API methods
{MCP source dir}/src/tools.ts        — existing tool definitions
{MCP source dir}/test/test-tools.ts  — existing test args + categories
{MCP source dir}/docs/index.html     — existing TOOLS array + hero stats
```

### Step 2: List the new endpoints

Get from the user or from context:
- New API endpoints (method, path, params, body)
- Which category they belong to (new or existing)
- Which are read-only vs write/destructive

### Step 3: Determine the slug

The slug is the kebab-case name used in AgentHub and MCPLive paths. Find it by checking:
- `AgentHub/server/src/mcp-servers/{slug}/` — folder name
- `MCPLive/build.js` — `slug` field in SERVERS entry

**Output:** A clear list like:
```
Adding N new tools in M categories:
- category_action_1 (read)
- category_action_2 (write)
- ...
Current: X tools, Y categories
After: X+N tools, Y+M categories
```

---

## Phase 2: Edit Source Files (4 files)

Edit all 4 files in the MCP source directory. Follow existing patterns exactly.

### 2.1 — api-client.ts

Add new methods following the existing pattern in the file. Rules:
- One method per API endpoint
- `encodeURIComponent()` for all path parameters
- Match the existing section comment style (`// === Category ===`)
- Place new methods in logical order (group by category)
- Method signatures should match the backend API exactly

**Example pattern:**
```typescript
// === New Category ===

async listItems(parentId: string) {
  return this.request<any>(`/parent/${encodeURIComponent(parentId)}/items`);
}

async createItem(parentId: string, data: { name: string; type: string }) {
  return this.request<any>(`/parent/${encodeURIComponent(parentId)}/items`, { method: 'POST', body: data });
}

async deleteItem(parentId: string, itemId: string) {
  return this.request<any>(
    `/parent/${encodeURIComponent(parentId)}/items/${encodeURIComponent(itemId)}`,
    { method: 'DELETE' }
  );
}
```

### 2.2 — tools.ts

Add new tool entries following the existing pattern. Rules:
- Tool name format: `category_action` (e.g., `signatories_list`, `notifications_mark_read`)
- Description MUST be under 60 characters
- Every field MUST have `.describe('...')`
- Use `z.enum([...])` for fields with known values
- Group tools under comment headers: `// ═══ CATEGORY ═══`
- Handler destructures args and calls the matching api-client method
- **IMPORTANT:** `z.record()` requires TWO args: `z.record(z.string(), z.any())` — NOT `z.record(z.any())`. AgentHub's Zod version enforces this and will fail TS2554 on build if missing the key schema.

**Example pattern:**
```typescript
// ═══════════════════════════════════════
// NEW CATEGORY
// ═══════════════════════════════════════

{
  name: 'category_list',
  description: 'List items for a parent',       // <60 chars
  inputSchema: z.object({
    parent_id: z.string().describe('parent ID'),
    status: z.enum(['active', 'archived']).optional().describe('filter by status'),
  }),
  handler: async (client, args) => client.listItems(args.parent_id),
},
{
  name: 'category_create',
  description: 'Create a new item',
  inputSchema: z.object({
    parent_id: z.string().describe('parent ID'),
    name: z.string().describe('item name'),
    type: z.enum(['typeA', 'typeB']).describe('item type'),
  }),
  handler: async (client, args) => {
    const { parent_id, ...data } = args;
    return client.createItem(parent_id, data);
  },
},
```

### 2.3 — test/test-tools.ts

Three sections to update:

**A. SKIP_WRITE_TOOLS** — Add any new write/destructive tools:
```typescript
const SKIP_WRITE_TOOLS = new Set([
  // ... existing entries ...
  'category_create',
  'category_delete',
]);
```

**B. getTestArgs()** — Add a case for every new tool:
```typescript
// === New Category ===
case 'category_list':
  return { parent_id: FAKE_ID };
case 'category_create':
  return { parent_id: FAKE_ID, name: 'Test Item', type: 'typeA' };
case 'category_delete':
  return { parent_id: FAKE_ID, item_id: FAKE_ID };
```

Use existing constants (`FAKE_ID`, `FAKE_ORG_ID`, `FAKE_ENTITY_ID`, `VITALIK`) for test args.

**C. getCategory()** — Add new category prefix mappings:
```typescript
if (toolName.startsWith('category_')) return 'Category';
```

Place new entries BEFORE the `return 'Other'` fallback. Order matters for prefix matching — more specific prefixes first.

### 2.4 — docs/index.html

Two sections to update:

**A. Hero stats** — Update the tool count and category count in the hero section:
```html
<div class="hero-stat-value">58</div>  <!-- was 42 -->
<div class="hero-stat-label">Tools</div>
...
<div class="hero-stat-value">14</div>  <!-- was 10 -->
<div class="hero-stat-label">Categories</div>
```

**B. TOOLS array** — Add new tool objects following the existing pattern:
```javascript
// ── New Category ─────────────────────────────────────
{ name: 'category_list', category: 'New Category', description: 'List items for a parent', params: [
  { name: 'parent_id', type: 'string', required: true, placeholder: 'item_abc123' },
  { name: 'status', type: 'string', required: false, placeholder: 'active' }
], example: { success: true, data: [{ id: "item_001", name: "Example", status: "active" }] } },
```

Place new entries in the same position relative to existing categories as in tools.ts.

---

## Phase 3: TypeScript Compile Check

After all 4 files are edited, verify the MCP server compiles:

```bash
cd "{MCP source dir}"
npx tsc --noEmit
```

**Must pass with zero errors before proceeding.**

---

## Phase 4: Sync Downstream (AgentHub + MCPLive)

### 4.1 — Copy to AgentHub

Copy the updated `api-client.ts` and `tools.ts` to the AgentHub MCP server directory:

```bash
cp "{MCP source dir}/src/api-client.ts" "{AgentHub MCP dir}/api-client.ts"
cp "{MCP source dir}/src/tools.ts" "{AgentHub MCP dir}/tools.ts"
```

**Note:** `index.ts` and `hub-server.ts` do NOT need updating — they auto-iterate the tools array.

### 4.2 — Rebuild MCPLive

```bash
cd "C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\MCPLive"
node build.js
```

This regenerates `public/{slug}/index.html` from the updated `docs/index.html`.

---

## Phase 5: Commit & Push

### 5.1 — MCPLive

```bash
cd "C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\MCPLive"
git add "public/{slug}/index.html"
git commit -m "Update {Name} MCP docs: add N new tools (categories)"
git push origin main
```

### 5.2 — AgentHub

```bash
cd "C:\Users\oreph\Documents\AgenticLedger\Custom Applications\AgentHub"
git add "server/src/mcp-servers/{slug}/api-client.ts" "server/src/mcp-servers/{slug}/tools.ts"
git commit -m "Update {Name} MCP server: add N new tools for {feature}"
git push origin main_dev
git checkout main && git merge main_dev && git push origin main && git checkout main_dev
```

### 5.3 — PlatformAuth Catalog (optional)

If the tool count changed significantly, update the catalog entry:

```bash
curl -X PUT {PLATFORM_URL}/api/mcp-servers/admin/{slug} \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk-admin-7b77c80465b3f7065f6163aeec1fc68218990167d9f75b3d" \
  -d '{"toolCount": NEW_COUNT}'
```

---

## Phase 6: Verify

1. TypeScript compilation passed (Phase 3)
2. MCPLive build succeeded (Phase 4.2)
3. AgentHub files match source (Phase 4.1)
4. Both repos pushed (Phase 5)
5. Report summary to user:

```
MCP Tool Update Complete — {MCP Name}
  Added:      N new tools in M categories
  Total:      X tools, Y categories
  MCPLive:    pushed to agenticledger/financeMCPsLive (main)
  AgentHub:   pushed to agenticledger/agenticledger_agenthub (main_dev + main)
  Compile:    PASS
```

---

## Quick Reference: File Edit Checklist

| # | File | What to add |
|---|------|-------------|
| 1 | `src/api-client.ts` | New async methods (one per endpoint) |
| 2 | `src/tools.ts` | New tool entries with Zod schemas |
| 3 | `test/test-tools.ts` | SKIP_WRITE_TOOLS + getTestArgs() + getCategory() |
| 4 | `docs/index.html` | TOOLS array entries + hero stats update |
| 5 | AgentHub `api-client.ts` | Copy of #1 |
| 6 | AgentHub `tools.ts` | Copy of #2 |

Files that do NOT need editing:
- `src/index.ts` — auto-iterates tools array
- `src/hub-server.ts` — auto-iterates tools array
- `MCPLive/build.js` — only needs editing when adding a NEW server, not new tools
