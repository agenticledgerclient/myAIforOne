---
name: opMCPfullrelease
description: "Full MCP server lifecycle: create, demo, agent hub, catalog. Creates production MCP server (Phases 1-7), adds to MCPLive demo hub (Phase 8), bundles in AgentHub (Phase 8.5), registers in PlatformAuth catalog (Phase 9). Use when building AND releasing MCP servers end-to-end."
allowed-tools: Read, Write, Edit, Glob, Grep, Task, Bash(npm:*), Bash(npx:*), Bash(node:*), Bash(git:*), Bash(curl:*), WebFetch
argument-hint: [MCP-name] [API-base-url]
---

# MCP Full Release — Create, Demo, Catalog

Complete MCP server lifecycle in one workflow. This skill creates a production MCP server (Phases 1-7), integrates it into the MCPLive demo hub (Phase 8), bundles it in AgentHub for AI agent access (Phase 8.5), and registers it in the PlatformAuth MCP catalog (Phase 9).

**Arguments:**
- `MCP-name` — The name for the MCP folder (e.g., `EnterpriseWalletManager`, `StripeMCP`)
- `API-base-url` — The target API base URL (e.g., `https://api.stripe.com/v1`)

If no arguments provided, ask the user for both values before proceeding.

---

## Key Paths

**Detect platform first** — use `process.platform` or check path separators. This skill runs on both Mac and Windows.

| Resource | Windows | Mac |
|----------|---------|-----|
| **MCP output dir** | `C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\{MCPName}\mcp-server\` | `/Users/oreph/Desktop/APPs/financestackmcps/{MCPName}/mcp-server/` |
| **MCPLive build** | `C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\MCPLive\build.js` | `/Users/oreph/Desktop/APPs/financestackmcps/MCPLive/build.js` |
| **MCPLive public** | `C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\MCPLive\public\` | `/Users/oreph/Desktop/APPs/financestackmcps/MCPLive/public/` |
| **PlatformAuth** | `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\AgenticledgerPlatformAuth` | `/Users/oreph/Desktop/APPs/agenticledger_platform/` |
| **Reference MCPs** | `C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\StripeMCP\` (and others) | `/Users/oreph/Desktop/APPs/financestackmcps/StripeMCP/` (and others) |
| **AgentHub** | `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\AgentHub` | `/Users/oreph/Desktop/APPs/agenticledger_agenthub/` |
| **AgentHub MCP servers** | `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\AgentHub\server\src\mcp-servers\` | `/Users/oreph/Desktop/APPs/agenticledger_agenthub/server/src/mcp-servers/` |
| **AgentHub index.ts** | `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\AgentHub\server\src\index.ts` | `/Users/oreph/Desktop/APPs/agenticledger_agenthub/server/src/index.ts` |
| **AgentHub ChatPage.tsx** | `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\AgentHub\web\src\ChatPage.tsx` | `/Users/oreph/Desktop/APPs/agenticledger_agenthub/web/src/ChatPage.tsx` |
| **AgentHub capabilityService** | `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\AgentHub\server\src\capabilities\capabilityService.ts` | `/Users/oreph/Desktop/APPs/agenticledger_agenthub/server/src/capabilities/capabilityService.ts` |
| **Hub servers ref** | `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\agentinabox\agentinabox_v2\server\src\mcp-hub\servers\` | `/Users/oreph/Desktop/APPs/agenticledger_agenthub/server/src/mcp-servers/billcom/hub-server.ts` |
| **Gateway** | N/A | `/Users/oreph/Desktop/APPs/channelToAgentToClaude/` |
| **.mcp.json** | `C:\Users\oreph\.mcp.json` | `/Users/oreph/.mcp.json` |
| **Exposed MCPs** | `C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\General\Exposed\` | `/Users/oreph/Desktop/APPs/financestackmcps/General/Exposed/` |

---

## MANDATORY: Build Checklist

**At the START, create `{project-root}/BUILD_CHECKLIST.md` using this template.** Update it after each phase.

```markdown
# MCP Server Full Release Checklist — {{SERVER_NAME}}

## Server Info
- **Target API:** {{API_NAME}}
- **API Docs:** {{API_DOCS_URL}}
- **Auth Type:** {{none | apikey | basic | bearer}}
- **API Type:** {{REST | GraphQL}}
- **Target Directory:** {{FULL_PATH}}
- **Started:** {{DATE}}

## Phase 1: Research
- [ ] API documentation found and reviewed
- [ ] Auth model identified: {{type}}
- [ ] All endpoints listed and categorized
- [ ] Pagination pattern identified
- [ ] Sample API calls tested manually
- **Endpoint count:** {{N}}
- **Categories:** {{list}}

## Phase 2: Scaffold
- [ ] Directory structure created
- [ ] package.json written
- [ ] tsconfig.json written
- [ ] .env.example written
- [ ] .gitignore written
- [ ] npm install successful

## Phase 3: Implementation
- [ ] api-client.ts — auth pattern: {{A/B/C/D}}
- [ ] api-client.ts — all {{N}} endpoint methods written
- [ ] tools.ts — all {{N}} tools defined with Zod schemas
- [ ] tools.ts — all descriptions under 60 chars
- [ ] tools.ts — all fields have .describe()
- [ ] index.ts — standalone server wiring complete
- [ ] hub-server.ts — MCPServerInstance class complete
- [ ] hub-server.ts — setTokens() matches api-client auth pattern
- [ ] hub-server.ts — singleton exported
- [ ] npm run build — compiles cleanly

## Phase 4: Documentation
- [ ] docs/index.html created (interactive, dark theme)
- [ ] All tools represented in TOOLS array
- [ ] Search works
- [ ] Copy-to-clipboard works
- [ ] Example responses included

## Phase 5: Testing
- [ ] test/test-tools.ts created
- [ ] Tests run against live API
- [ ] Pass rate: {{N}}%
- [ ] Avg response time: {{N}}ms
- [ ] Known issues documented

## Phase 6: Finalize
- [ ] README.md written with Claude Desktop config
- [ ] docs/TEST-RESULTS.md created
- [ ] No secrets in git
- [ ] All files match directory structure

## Phase 7: Reference Comparison (FINAL GATE)
- [ ] Compared against reference: {{REFERENCE_SERVER_NAME}}
- [ ] File structure matches reference
- [ ] api-client.ts follows same request() pattern
- [ ] tools.ts follows same {name, description, inputSchema, handler} pattern
- [ ] index.ts follows same ListTools + CallTool handler pattern
- [ ] hub-server.ts implements MCPServerInstance correctly
- [ ] hub-server.ts compared against AgentHub Bill.com hub-server reference
- [ ] docs/index.html has same features (sidebar, search, tool cards, copy)
- [ ] test/test-tools.ts follows same TestResult pattern
- [ ] Deviations documented and justified: {{list or "none"}}

## Phase 8: MCPLive Demo Integration
- [ ] SERVERS entry added to MCPLive build.js
- [ ] PAGE_CODES entry added to MCPLive build.js (access gate)
- [ ] npm run build executed in MCPLive
- [ ] public/{slug}/index.html generated
- [ ] public/{slug}/{slug}-mcp-server.zip created
- [ ] Landing page updated with new card
- [ ] Chat button injected in docs
- [ ] GitHub button injected in docs
- [ ] Download ZIP button injected in docs
- [ ] Committed and pushed to agenticledger/financeMCPsLive

## Phase 8.5: AgentHub Integration
- [ ] Source files copied to AgentHub/server/src/mcp-servers/{slug}/
- [ ] hub-server.ts uses per-agent token resolution (getClientForAgent + cache)
- [ ] Token fields added to BUNDLED_SERVER_TOKEN_FIELDS in capabilityService.ts
- [ ] Registration entry added to AgentHub/server/src/index.ts mcpServers array
- [ ] Quick commands added to CAPABILITY_COMMANDS in ChatPage.tsx
- [ ] Committed and pushed to agenticledger/agenticledger_agenthub (both main_dev AND main)
- [ ] Agent created via admin API (POST /api/admin/agents)
- [ ] Capability enabled via admin API (POST /api/admin/capabilities/{slug}/toggle)
- [ ] API tokens saved via admin API (POST /api/admin/capabilities/{slug}/tokens)

## Phase 8.7: Claude Code Registration
- [ ] dist/index.js exists (npm install && npm run build if needed)
- [ ] .env.example reviewed for required env vars
- [ ] Entry added to C:\Users\oreph\.mcp.json
- [ ] Naming convention: {{slug}}-mcp (kebab-case + -mcp suffix)

## Phase 9: PlatformAuth Catalog Registration
- [ ] POST /api/mcp-servers/admin/register called (X-API-Key auth)
- [ ] MCP appears in catalog at /mcp-servers/{slug}
- [ ] All metadata correct (category, toolCount, URLs, tags)
- **Note:** docsUrl/downloadUrl domain must be `financemcps.agenticledger.ai` (NOT mcplive)
- **Auth:** Uses PLATFORM_ADMIN_API_KEY env var via X-API-Key header

## Phase 10: Release Summary
- [ ] BUILD_CHECKLIST.md fully updated
- [ ] All 5 outputs verified (MCP code, MCPLive demo, AgentHub bundle, Claude Code .mcp.json, PlatformAuth catalog)

## Completion
- **Finished:** {{DATE}}
- **Total tools:** {{N}}
- **Pass rate:** {{N}}%
- **Status:** {{COMPLETE | BLOCKED}}
```

---

## Phases 1-7: MCP Server Creation

Follow the exact same workflow as `/opMCPcreate`. The full instructions for each phase are below.

### Reference Implementations

Before building, study these production servers for patterns:

| Server | Path | Auth | API Type | Tools |
|--------|------|------|----------|-------|
| **NodeFortress** | `C:\Users\oreph\clawd\OrphilLLC\Clients\NodeFortress\mcp-server` | API key header | REST | 14 |
| **Lighthouse** | `C:\Users\oreph\clawd\OrphilLLC\Clients\Lighthouse\mcp-server` | None (public) | REST | 28 |
| **LightSpark SDK** | `C:\Users\oreph\clawd\OrphilLLC\Clients\LightSpark\LightsparkSDK\mcp-server` | Basic Auth | GraphQL | 37 |
| **GRID** | `C:\Users\oreph\clawd\OrphilLLC\Clients\LightSpark\GRID\mcp-server` | Basic Auth | REST | 38 |
| **Modern Treasury** | `C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\modern-treasury\mcp-server` | Basic Auth | REST | 55 |

**When in doubt about any pattern, read the actual source files from these servers.**

---

### Phase 1: Research the Target API

1. **Find the API documentation** — Swagger/OpenAPI spec, developer docs, or raw endpoint list
2. **Identify the authentication model**: `none`, `apikey`, `basic`, `bearer`
3. **List ALL endpoints** — Group by category
4. **Identify API type**: REST or GraphQL
5. **Note pagination patterns** — cursor, offset/limit, page numbers
6. **Test a few endpoints** manually to verify responses

---

### Phase 2: Scaffold the Project

**Directory Structure (MANDATORY):**

```
{MCPName}/
└── mcp-server/
    ├── src/
    │   ├── index.ts          # Standalone MCP server (stdio)
    │   ├── hub-server.ts     # Agent-in-a-Box hub integration
    │   ├── api-client.ts     # HTTP client with auth
    │   └── tools.ts          # Tool definitions (Zod + handlers)
    ├── docs/
    │   └── index.html        # Interactive documentation
    ├── test/
    │   └── test-tools.ts     # Test suite
    ├── package.json
    ├── tsconfig.json
    ├── .env.example
    ├── .gitignore
    └── README.md
```

**package.json Template:**
```json
{
  "name": "{{SERVER_NAME}}-mcp-server",
  "version": "1.0.0",
  "description": "MCP server for {{SERVICE_NAME}} API",
  "type": "module",
  "main": "dist/index.js",
  "bin": { "{{SERVER_NAME}}-mcp": "./dist/index.js" },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch",
    "test": "npx tsx test/test-tools.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.22.4",
    "zod-to-json-schema": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "typescript": "^5.3.0",
    "tsx": "^4.21.0"
  }
}
```

**tsconfig.json (EXACT):**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

### Phase 3: Implement the Server

#### 3.1 — api-client.ts

Choose the auth pattern that matches:

**Pattern A: No Auth** — Reference: `Lighthouse/mcp-server/src/api-client.ts`
**Pattern B: API Key Header** — Reference: `NodeFortress/mcp-server/src/api-client.ts`
**Pattern C: HTTP Basic Auth** — Reference: `GRID/mcp-server/src/api-client.ts`
**Pattern D: GraphQL** — Reference: `LightsparkSDK/mcp-server/src/api-client.ts`

Read the reference file for the chosen pattern and follow it exactly. Key rules:
- One method per API endpoint
- Always `encodeURIComponent()` for path parameters
- Generic `request<T>()` method — never duplicate HTTP logic
- Throw meaningful errors with status codes

#### 3.2 — tools.ts

```typescript
import { z } from 'zod';
import { {{ClientName}} } from './api-client.js';

interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  handler: (client: {{ClientName}}, args: any) => Promise<any>;
}

export const tools: ToolDef[] = [
  {
    name: 'category_action',
    description: 'Brief description under 60 chars',
    inputSchema: z.object({
      id: z.string().describe('item ID'),
      limit: z.number().optional().describe('max results'),
    }),
    handler: async (client, args) => client.getItem(args.id, args.limit),
  },
];
```

**Naming:** `category_list`, `category_get`, `category_create`, `category_update`, `category_delete`

#### 3.3 — index.ts

Standard MCP server wiring. Read the reference implementation for the matching auth pattern.

**CRITICAL for 30+ tools:** Wrap zodToJsonSchema to avoid TS2589:
```typescript
import { zodToJsonSchema as _zodToJsonSchema } from 'zod-to-json-schema';
function zodToJsonSchema(schema: any): any { return _zodToJsonSchema(schema); }
```

#### 3.4 — hub-server.ts

Implements `MCPServerInstance` for AgentHub integration. **MUST use the per-agent token resolution pattern.**

**Reference:** `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\AgentHub\server\src\mcp-servers\billcom\hub-server.ts`

**Required elements:**
- `MCPToolContext` interface with `agentId?: string`
- `getClientForAgent(agentId)` — loads tokens from DB via `capabilityService.getCapabilityTokens(agentId, '{slug}')`
- `agentClients` Map with 10-minute cache TTL
- `executeTool(name, args, context?)` — resolves per-agent client from context, falls back to `setTokens()` singleton
- `setTokens()` must match the api-client constructor pattern
- Export a singleton

**Note:** When integrating into AgentHub (Phase 8.5), you must also add token field definitions to `capabilityService.ts` `BUNDLED_SERVER_TOKEN_FIELDS`. See Phase 8.5 for details.

---

### Phase 4: Generate Interactive Documentation

Create `docs/index.html` — dark-themed, interactive API reference.

**Must include:** sidebar with search, hero section with stats, tool cards with parameter tables, copy-to-clipboard, collapsible example responses.

**For the exact HTML/CSS/JS pattern, read:**
`C:\Users\oreph\clawd\OrphilLLC\Clients\NodeFortress\mcp-server\docs\index.html`

---

### Phase 5: Create Test Suite

Create `test/test-tools.ts` following the `TestResult` pattern from reference implementations. Run against live API, document pass rate and response times.

---

### Phase 6: Finalize

- README.md with Claude Desktop config snippet
- docs/TEST-RESULTS.md with test results
- Verify no secrets in any committed files

---

### Phase 7: Reference Comparison (FINAL GATE)

1. Pick closest reference server by auth/API type
2. Read and compare all source files against reference
3. Compare hub-server.ts against AgentHub Bill.com hub-server (`AgentHub/server/src/mcp-servers/billcom/hub-server.ts`)
4. Document any deviations
5. Update BUILD_CHECKLIST.md

**Only after Phase 7 is complete proceed to Phase 8.**

---

## Phase 8: MCPLive Demo Integration (NEW)

After the MCP server is built and tested, add it to the MCPLive demo hub.

### Step 1: Add to SERVERS Registry

**File:** `C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\MCPLive\build.js`

Read the current file and add a new entry to the `SERVERS` array (before the GCP entry which is always last):

```javascript
{
  slug: '{{kebab-case-slug}}',
  name: '{{Display Name}} MCP Server',
  folder: '{{MCPFolderName}}',
  agentSlug: '{{kebab-case-slug}}-agent',
  githubUrl: 'https://github.com/agenticledger/financeMCPsLive/tree/main/public/{{kebab-case-slug}}',
  category: '{{Category}}',
  toolCount: {{N}},
  description: '{{Short description of capabilities}}',
},
```

**Field rules:**
- `slug` — kebab-case, used as URL path (`/enterprise-wallet-manager/`)
- `folder` — exact folder name in FinanceStackMCPs directory
- `agentSlug` — used for AgentHub chat link
- `category` — match existing categories where possible (Payments, Accounting, Banking, etc.) or create new
- `toolCount` — actual number from tools.ts
- `description` — short, comma-separated list of capabilities

### Step 1.5: Add Access Gate Code

In the same `build.js` file, add a `PAGE_CODES` entry for the new server. This defines per-page access codes that unlock the GitHub + Download buttons (separate from the master code).

Find the `PAGE_CODES` object and add:

```javascript
'{{kebab-case-slug}}':         ['{{SLUG_UPPER}}1'],
```

Example: `'bitwave': ['BIT1']`, `'stripe': ['STRIPE1']`

You can add multiple codes per page for different clients: `['CODE1', 'CODE2']`

**Access gate system:**
- GitHub + Download buttons are hidden by default on all pages
- Master code (`AGENTICLEDGER`) unlocks all pages globally
- Per-page codes unlock only that specific page
- Codes are SHA-256 hashed at build time (plain text never in deployed HTML)
- Lock icon in bottom-left corner of every page opens the unlock modal
- Unlock state persists in localStorage

### Step 2: Run MCPLive Build

```bash
cd "C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\MCPLive"
npm run build
```

This will:
1. Copy `{MCPFolderName}/mcp-server/docs/index.html` to `public/{slug}/index.html`
2. Inject light/dark mode toggle CSS
3. Inject hero buttons (Chat with AI Agent, View on GitHub, Download MCP Code)
4. Inject AgentHub widget script
5. Create ZIP archive at `public/{slug}/{slug}-mcp-server.zip`
6. Regenerate landing page at `public/index.html` with new card

### Step 3: Verify

1. Check `public/{slug}/index.html` exists and is valid HTML
2. Check `public/{slug}/{slug}-mcp-server.zip` exists
3. Open `public/index.html` in browser — new card should appear
4. Open `public/{slug}/index.html` — verify injected buttons are present:
   - "Chat with AI Agent" button links to `https://agenthubdesk.agenticledger.ai/chat/{agentSlug}`
   - "View on GitHub" button links to the correct repo URL
   - "Download MCP Code" button links to the ZIP file
5. Search on landing page finds the new MCP

### Step 4: Commit & Push MCPLive

```bash
cd "C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\MCPLive"
git add build.js public/index.html "public/{{slug}}/"
git commit -m "Add {{Display Name}} MCP Server ({{N}} tools) to MCPLive"
git push origin main
```

**Repo:** `agenticledger/financeMCPsLive` (agenticledger GitHub — Cloudflare Pages auto-deploys from push)

### Step 5: Update Checklist

Mark all Phase 8 items in BUILD_CHECKLIST.md.

---

## Phase 8.5: AgentHub Integration (NEW)

Add the MCP server to the AgentHub project so it's available as a bundled server for AI agents.

**Repo:** `agenticledger/agenticledger_agenthub` (git remote at `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\AgentHub`)

### Step 1: Copy Source Files

Copy the 3 core files from the MCP server into AgentHub:

```
{MCPName}/mcp-server/src/api-client.ts  ->  AgentHub/server/src/mcp-servers/{slug}/api-client.ts
{MCPName}/mcp-server/src/tools.ts       ->  AgentHub/server/src/mcp-servers/{slug}/tools.ts
{MCPName}/mcp-server/src/hub-server.ts  ->  AgentHub/server/src/mcp-servers/{slug}/hub-server.ts
```

Where `{slug}` is the kebab-case name (e.g., `enterprise-wallet-manager`, `stripe`, `xero`).

### Step 2: Register in index.ts

**File:** `AgentHub/server/src/index.ts`

Add a new entry to the `mcpServers` array:

```javascript
{ module: './mcp-servers/{{slug}}/hub-server', exportName: '{{exportName}}', label: '{{slug}}' },
```

Where `{{exportName}}` is the singleton export name from hub-server.ts (e.g., `ewmServer`, `stripeServer`).

### Step 3: Register Token Fields in capabilityService.ts

**File:** `AgentHub/server/src/capabilities/capabilityService.ts`

Add token field definitions to `BUNDLED_SERVER_TOKEN_FIELDS` so the admin panel can save/load credentials:

```typescript
'{{slug}}': [
  { name: 'token1', label: '{{Primary credential label}}', required: true },
  { name: 'token2', label: '{{Secondary credential label (optional)}}', required: false },
],
```

Without this entry, the admin panel cannot persist tokens and agents will get "Server not configured" errors.

### Step 4: Add Quick Commands

**File:** `AgentHub/web/src/ChatPage.tsx`

Add a new entry to `CAPABILITY_COMMANDS` with 10-15 quick action prompts relevant to the MCP's tools:

```typescript
'{{slug}}': {
  icon: '{{emoji}}',
  name: '{{Display Name}}',
  color: '{{hex color}}',
  commands: [
    { label: '{{Short label}}', prompt: '{{Full prompt text}}', category: 'query' },
    // ... 10-15 commands covering the main tool categories
  ],
},
```

**Categories:** `query` (read data), `action` (write/modify), `analysis` (aggregate/summarize)

### Step 5: Validate Quick Command Filtering (MANDATORY)

Before committing, verify the lightning button will show ONLY this agent's commands — not all commands.

**The filtering logic in ChatPage.tsx is DB-driven (no hardcoded slug maps):**
1. When a chat starts, the backend queries the `ai_agent_capabilities` table for the agent's enabled capabilities
2. The `/api/chat/start` response includes `enabledCapabilities[]` (array of capability IDs like `["tres-finance"]`)
3. The frontend filters `CAPABILITY_COMMANDS` to only show entries whose key is in `enabledCapabilities`
4. If no capabilities are enabled, the lightning button is hidden (empty commands = button not shown)

**Validation checklist:**
1. Confirm the capability ID key in `CAPABILITY_COMMANDS` **exactly matches** the `label` used when registering the MCP server in `index.ts` (the `label` field becomes the `capabilityId` in the DB)
2. Confirm the agent will be created and the capability enabled via the admin API (Step 7) — this is what populates the DB
3. Verify the key in `CAPABILITY_COMMANDS` matches what will be passed to the `/api/admin/capabilities/{{slug}}/toggle` endpoint

```bash
# Verify: capability key exists in CAPABILITY_COMMANDS
grep "'{{slug}}':" AgentHub/web/src/ChatPage.tsx
# Verify: server label in index.ts matches
grep "label: '{{slug}}'" AgentHub/server/src/index.ts
```

**Common failure modes:**
- `CAPABILITY_COMMANDS` key is `'{{slug}}-mcp'` but index.ts label is `'{{slug}}'` → no match, no commands shown
- Admin API capability toggle not called (Step 7b skipped) → DB has no enabled capabilities → no commands shown
- Capability enabled for wrong agent ID → commands show on wrong agent

**The capability ID MUST be consistent across all 3 places:**
1. `label` field in the `mcpServers` array in `AgentHub/server/src/index.ts`
2. Key in `CAPABILITY_COMMANDS` in `ChatPage.tsx`
3. The `{{slug}}` used in admin API calls: `/api/admin/capabilities/{{slug}}/toggle`

### Step 6: Commit & Push (single commit, BOTH environments)

**AgentHub has two deploy branches** (the only repo with this setup):
- `main_dev` → dev (`agent-hub-web-dev.up.railway.app`) — auto-deploys
- `main` → production (`agenthubdesk.agenticledger.ai`) — auto-deploys

**Always push to both** so dev and production stay in sync:

```bash
cd "C:\Users\oreph\Documents\AgenticLedger\Custom Applications\AgentHub"
git checkout main_dev
git add server/src/index.ts server/src/capabilities/capabilityService.ts "server/src/mcp-servers/{{slug}}/" web/src/ChatPage.tsx
git commit -m "Add {{Display Name}} MCP server ({{N}} tools) + quick commands"
git push origin main_dev
git checkout main
git merge main_dev
git push origin main
git checkout main_dev
```

**Before pushing**, always `git fetch origin` and check for remote changes on both branches — another agent may be working on this repo concurrently.

### Step 7: Create Agent via Admin API

Use the AgentHub admin API to create the agent, enable the capability, and save tokens programmatically.

**Auth:** `X-API-Key: sk-admin-7b77c80465b3f7065f6163aeec1fc68218990167d9f75b3d`

**Base URL:** `https://agenthubdesk.agenticledger.ai`

#### 6a. Create the agent

```bash
curl -X POST https://agenthubdesk.agenticledger.ai/api/admin/agents \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk-admin-7b77c80465b3f7065f6163aeec1fc68218990167d9f75b3d" \
  -d '{
    "name": "{{Display Name}}",
    "slug": "{{agentSlug}}",
    "description": "{{Short description of MCP capabilities}}",
    "defaultModel": "claude-sonnet-4-5-20250929"
  }'
```

Save the returned `agent.id` (format: `agent-{{agentSlug}}`).

#### 6b. Enable the MCP capability

```bash
curl -X POST https://agenthubdesk.agenticledger.ai/api/admin/capabilities/{{slug}}/toggle \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk-admin-7b77c80465b3f7065f6163aeec1fc68218990167d9f75b3d" \
  -d '{"enabled": true, "agentId": "agent-{{agentSlug}}"}'
```

#### 6c. Save API tokens

```bash
curl -X POST https://agenthubdesk.agenticledger.ai/api/admin/capabilities/{{slug}}/tokens \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk-admin-7b77c80465b3f7065f6163aeec1fc68218990167d9f75b3d" \
  -d '{"token1": "{{API_KEY_OR_TOKEN}}", "agentId": "agent-{{agentSlug}}"}'
```

If the API requires multiple tokens (e.g., client ID + secret), include `token2`, `token3` etc. matching the fields defined in `BUNDLED_SERVER_TOKEN_FIELDS`.

**If the API key is rejected**, the service may have been redeployed without the env var. Use `/opDeployPaths` to re-set it via Railway API.

### Step 8: Update Checklist

Mark all Phase 8.5 items in BUILD_CHECKLIST.md.

---

## Phase 8.7: Claude Code Registration

Register the MCP server in Claude Code's `.mcp.json` so it's available as a local tool server.

**Prereq:** The MCP server is already built in `C:/Users/oreph/clawd/OrphilLLC/Clients/FinanceStackMCPs/{{MCPFolderName}}/mcp-server/`

### Step 1: Verify the server is built

```bash
ls C:/Users/oreph/clawd/OrphilLLC/Clients/FinanceStackMCPs/{{MCPFolderName}}/mcp-server/dist/
```

Confirm `index.js` exists in `dist/`. If not, run:
```bash
cd "C:/Users/oreph/clawd/OrphilLLC/Clients/FinanceStackMCPs/{{MCPFolderName}}/mcp-server" && npm install && npm run build
```

### Step 2: Read the env vars it needs

```bash
cat {{MCPFolderName}}/mcp-server/.env.example
```

Note every env var name (e.g. `SMARTSHEET_API_KEY`).

### Step 3: Read the current .mcp.json

Read `C:\Users\oreph\.mcp.json`

### Step 4: Add a new entry to the mcpServers object

**Pattern (every server follows this exactly):**

```json
"{{slug}}-mcp": {
  "type": "stdio",
  "command": "node",
  "args": [
    "C:/Users/oreph/clawd/OrphilLLC/Clients/FinanceStackMCPs/{{MCPFolderName}}/mcp-server/dist/index.js"
  ],
  "env": {
    "ENV_VAR_FROM_STEP_2": "placeholder"
  }
}
```

**Naming convention:** lowercase kebab-case + `-mcp` suffix. E.g.:
- SmartsheetsMCP → `smartsheets-mcp`
- ModernTreasury → `modern-treasury-mcp`
- FireblocksMCP → `fireblocks-mcp`

### Step 5: Edit .mcp.json

Use the Edit tool to insert the new entry before the closing `}` of the `mcpServers` object. Add a comma after the previous last entry.

That's it — 5 steps. No build, no code changes — just wire the existing `dist/index.js` into `.mcp.json` with the right env vars set to `"placeholder"`.

### Step 6: Update Checklist

Mark all Phase 8.7 items in BUILD_CHECKLIST.md.

---

## Phase 9: PlatformAuth Catalog Registration (NEW)

Register the MCP server in the AgenticLedger platform's MCP marketplace.

**Auth:** `X-API-Key: sk-admin-7b77c80465b3f7065f6163aeec1fc68218990167d9f75b3d`

**Base URL:** `https://agenticledger.ai`

### Step 1: Register the MCP Server

```bash
curl -X POST {PLATFORM_URL}/api/mcp-servers/admin/register \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk-admin-7b77c80465b3f7065f6163aeec1fc68218990167d9f75b3d" \
  -d '{
    "name": "{{Display Name}} MCP Server",
    "category": "{{Category}}",
    "description": "{{Full description of the MCP server capabilities}}",
    "authType": "{{Bearer Token | OAuth 2.0 | API Key | Basic Auth | None}}",
    "testStatus": "built",
    "toolCount": {{N}},
    "docsUrl": "https://financemcps.agenticledger.ai/{{slug}}/",
    "githubUrl": "https://github.com/agenticledger/financeMCPsLive/tree/main/public/{{slug}}",
    "downloadUrl": "https://financemcps.agenticledger.ai/{{slug}}/{{slug}}-mcp-server.zip",
    "agentChatUrl": "https://agenthubdesk.agenticledger.ai/chat/{{agentSlug}}",
    "tags": ["{{tag1}}", "{{tag2}}", "{{tag3}}"]
  }'
```

**Registration fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | YES | Display name (must be unique) |
| `category` | No | Payments, Accounting, ERP, Banking, Crypto, Data, Compliance, Tax, HR, etc. |
| `description` | No | What the server does |
| `authType` | No | Bearer Token, OAuth 2.0, API Key, Basic Auth, None |
| `testStatus` | No | draft, built, tested |
| `toolCount` | No | Number of tools |
| `docsUrl` | No | MCPLive documentation URL |
| `githubUrl` | No | Source code URL |
| `downloadUrl` | No | ZIP download URL |
| `agentChatUrl` | No | AgentHub chat URL |
| `iconUrl` | No | Server icon/logo |
| `tags` | No | Array of keyword tags |

### Step 2: Verify

Confirm the MCP appears in the catalog:
```bash
curl {PLATFORM_URL}/api/mcp-servers?search={{name}}
```

### Step 3: Update Checklist

Mark all Phase 9 items in BUILD_CHECKLIST.md.

**Note:** If the API key is rejected, the service may have been redeployed without the env var. Use `/opDeployPaths` to re-set it via Railway API.

---

## Phase 10: Release Summary (NEW)

Final wrap-up:

1. **Update BUILD_CHECKLIST.md** — ensure all phases are marked complete or documented as blocked
2. **Summarize the release** to the user:
   - MCP server location and tool count
   - MCPLive demo URL (`https://financemcps.agenticledger.ai/{{slug}}/`)
   - AgentHub agent URL (`https://agenthubdesk.agenticledger.ai/chat/{{agentSlug}}`)
   - PlatformAuth catalog status
   - Any known issues or follow-ups

---

## Workflow Summary

```
Phase 1:    Research API              -> Update checklist
Phase 2:    Scaffold project          -> Update checklist
Phase 3:    Implement server          -> Update checklist
Phase 4:    Generate docs             -> Update checklist
Phase 5:    Create & run tests        -> Update checklist
Phase 6:    Finalize (README, etc.)   -> Update checklist
Phase 7:    Compare to reference      -> Update checklist -> MCP SERVER DONE
Phase 8:    Add to MCPLive            -> Update checklist -> DEMO LIVE
Phase 8.5:  Add to AgentHub           -> Update checklist -> AGENT BUNDLED
Phase 8.7:  Register in Claude Code   -> Update checklist -> LOCAL MCP READY
Phase 9:    Register in PlatformAuth  -> Update checklist -> CATALOG LISTED
Phase 10:   Release summary           -> Update checklist -> FULLY RELEASED
```

Every phase ends with updating `BUILD_CHECKLIST.md`. The checklist IS the deliverable tracker.
