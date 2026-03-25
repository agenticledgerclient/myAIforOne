---
name: opMCPAgentLiteCreate
description: Create production MCP servers WITH a bundled AgentLite demo agent. Scaffolds MCP server + full AI chat product (Express + React + PostgreSQL). Deploy both on Railway as a single service.
---

# MCP Server + AgentLite Creator — Orphil Pattern

Create production-ready MCP servers **with a working AI chat agent** that demonstrates the MCP tools. This skill does everything `/opMCPcreate` does, PLUS scaffolds a complete AgentLite demo agent (Express backend + React frontend + PostgreSQL) that uses the MCP server.

## Reference Implementations

### MCP Servers (same as /opMCPcreate)

| Server | Path | Auth | API Type | Tools |
|--------|------|------|----------|-------|
| **NodeFortress** | `C:\Users\oreph\clawd\OrphilLLC\Clients\NodeFortress\mcp-server` | API key header | REST | 14 |
| **Lighthouse** | `C:\Users\oreph\clawd\OrphilLLC\Clients\Lighthouse\mcp-server` | None (public) | REST | 28 |
| **LightSpark SDK** | `C:\Users\oreph\clawd\OrphilLLC\Clients\LightSpark\LightsparkSDK\mcp-server` | Basic Auth | GraphQL | 37 |
| **GRID** | `C:\Users\oreph\clawd\OrphilLLC\Clients\LightSpark\GRID\mcp-server` | Basic Auth | REST | 38 |
| **Modern Treasury** | `C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\modern-treasury\mcp-server` | Basic Auth | REST | 55 |

### AgentLite Reference (THE reference for the agent portion)

| Component | Path |
|-----------|------|
| **Full AgentLite** | `C:\Users\oreph\clawd\OrphilLLC\Clients\gcp_public_datasets\agent-lite` |
| **Sibling MCP Server** | `C:\Users\oreph\clawd\OrphilLLC\Clients\gcp_public_datasets\mcp-server` |
| **Source Platform** | `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\agentinabox\agentinabox_v2` |

**When in doubt about any pattern, read the actual source files from these references.**

---

## MANDATORY: Build Checklist

**At the START of every build, create `{project-root}/BUILD_CHECKLIST.md` using this template.** This covers BOTH the MCP server AND the AgentLite agent.

```markdown
# MCP Server + AgentLite Build Checklist — {{SERVER_NAME}}

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

## Phase 2: Scaffold MCP Server
- [ ] Directory structure created (mcp-server/)
- [ ] package.json written
- [ ] tsconfig.json written
- [ ] .env.example written
- [ ] .gitignore written
- [ ] npm install successful

## Phase 3: Implement MCP Server
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

## Phase 4: MCP Documentation
- [ ] docs/index.html created (interactive, dark theme)
- [ ] All tools represented in TOOLS array
- [ ] Search works
- [ ] Copy-to-clipboard works
- [ ] Example responses included

## Phase 5: MCP Testing
- [ ] test/test-tools.ts created
- [ ] Tests run against live API
- [ ] Pass rate: {{N}}%
- [ ] Avg response time: {{N}}ms
- [ ] Known issues documented

## Phase 6: MCP Finalize
- [ ] README.md written with Claude Desktop config
- [ ] docs/TEST-RESULTS.md created
- [ ] No secrets in git
- [ ] All files match directory structure

## Phase 7: MCP Reference Comparison (GATE 1)
- [ ] Compared against reference: {{REFERENCE_SERVER_NAME}}
- [ ] File structure matches reference
- [ ] api-client.ts follows same request() pattern
- [ ] tools.ts follows same {name, description, inputSchema, handler} pattern
- [ ] index.ts follows same ListTools + CallTool handler pattern
- [ ] hub-server.ts implements MCPServerInstance correctly
- [ ] Deviations documented and justified: {{list or "none"}}

## Phase 8: Scaffold AgentLite
- [ ] agent-lite/ directory created
- [ ] server/package.json written
- [ ] server/tsconfig.json written
- [ ] web/package.json written
- [ ] web/vite.config.ts written
- [ ] web/tsconfig.json written
- [ ] Root .gitignore covers both mcp-server/ and agent-lite/

## Phase 9: AgentLite Backend
- [ ] db/schema.ts — all tables defined (agents, conversations, messages, capabilities, tokens, documents, embeddings, api_keys)
- [ ] db/client.ts — Drizzle PG client
- [ ] db/init.ts — pgvector extension + table creation
- [ ] config/appConfig.ts — feature flags from env vars
- [ ] llm/types.ts — LLM interfaces
- [ ] llm/claudeProvider.ts — Anthropic SDK with streaming + tool use
- [ ] llm/index.ts — provider selection (Claude only)
- [ ] llm/toolExecutor.ts — tool dispatch (MCP + deep tools + memory)
- [ ] chat/chatService.ts — generateReply, streamReply, appendMessage
- [ ] session/contextBuilder.ts — system prompt builder with soul/memory
- [ ] mcp-hub/{types,registry,router,orchestrator,index}.ts — MCP hub layer
- [ ] tools/{deepTools,webSearch,webFetch}.ts — built-in tools
- [ ] memory/{defaults,documentService,memoryTools,memoryEmbedder,index}.ts
- [ ] rag/ragService.ts — pgvector semantic search
- [ ] capabilities/capabilityService.ts — AES-256 encrypted tokens
- [ ] http/app.ts — Express with CORS, security, rate limiting
- [ ] http/chatRoutes.ts — public SSE streaming chat
- [ ] http/adminRoutes.ts — auth-protected admin API
- [ ] middleware/auth.ts — API key auth
- [ ] utils/logger.ts
- [ ] index.ts — entry point (DB init → MCP register → Express start)
- [ ] index.ts imports hub-server.ts from sibling mcp-server/
- [ ] npm run build — compiles cleanly (0 TS errors)

## Phase 10: AgentLite Frontend
- [ ] main.tsx — React 19 entry
- [ ] App.tsx — routes (/, /chat, /admin, /setup)
- [ ] theme.ts — branding colors
- [ ] ChatPage.tsx — SSE streaming chat with markdown + tool display
- [ ] SetupWizard.tsx — API key + agent config wizard
- [ ] AdminPage.tsx — 3 tabs (Agent, MCP Hub, Soul/Memory)
- [ ] public/widget.js — embeddable chat iframe script
- [ ] npx vite build — builds successfully

## Phase 11: Deployment
- [ ] Dockerfile — multi-stage (web → server → production)
- [ ] Dockerfile COPY mcp-server/ works (sibling directory)
- [ ] railway.json — points to agent-lite/Dockerfile
- [ ] .env.example — all env vars documented
- [ ] README.md — quickstart + Railway deploy + widget embed

## Phase 12: AgentLite Reference Comparison (FINAL GATE)
- [ ] Compared against: `C:\Users\oreph\clawd\OrphilLLC\Clients\gcp_public_datasets\agent-lite`
- [ ] Server file structure matches reference
- [ ] Frontend file structure matches reference
- [ ] Dockerfile multi-stage pattern matches
- [ ] MCP Hub integration pattern matches (import from sibling mcp-server/)
- [ ] Feature flags pattern matches (FEATURE_SOUL_MEMORY, FEATURE_DEEP_TOOLS)
- [ ] Deviations documented: {{list or "none"}}

## Completion
- **Finished:** {{DATE}}
- **MCP tools:** {{N}}
- **MCP pass rate:** {{N}}%
- **AgentLite server files:** {{N}}
- **AgentLite frontend files:** {{N}}
- **Status:** {{COMPLETE | BLOCKED}}
```

**Rules for the checklist:**
1. Create it at the START — before writing any code
2. Update it AFTER each phase — mark items as `[x]` and fill in values
3. Phase 7 (MCP gate) and Phase 12 (AgentLite gate) are BOTH required
4. When comparing, actually READ the reference files — don't just check boxes

---

## Top-Level Project Structure

```
{{project-root}}/
├── mcp-server/                  # MCP Server (Phase 1-7)
│   ├── src/
│   │   ├── index.ts             # Standalone MCP server
│   │   ├── hub-server.ts        # AgentLite hub integration
│   │   ├── api-client.ts        # HTTP/GraphQL client
│   │   └── tools.ts             # Tool definitions
│   ├── docs/index.html
│   ├── test/test-tools.ts
│   ├── package.json
│   └── tsconfig.json
├── agent-lite/                  # AgentLite Demo Agent (Phase 8-12)
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── config/appConfig.ts
│   │   │   ├── db/{client,schema,init,date-utils}.ts
│   │   │   ├── chat/chatService.ts
│   │   │   ├── llm/{types,claudeProvider,index,toolExecutor}.ts
│   │   │   ├── mcp-hub/{types,registry,router,orchestrator,index}.ts
│   │   │   ├── tools/{deepTools,webSearch,webFetch}.ts
│   │   │   ├── memory/{defaults,documentService,memoryTools,memoryEmbedder,index}.ts
│   │   │   ├── session/contextBuilder.ts
│   │   │   ├── rag/ragService.ts
│   │   │   ├── capabilities/capabilityService.ts
│   │   │   ├── http/{app,chatRoutes,adminRoutes}.ts
│   │   │   ├── middleware/auth.ts
│   │   │   └── utils/logger.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── web/
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── theme.ts
│   │   │   ├── ChatPage.tsx
│   │   │   ├── SetupWizard.tsx
│   │   │   └── AdminPage.tsx
│   │   ├── public/widget.js
│   │   ├── index.html
│   │   ├── package.json
│   │   └── vite.config.ts
│   ├── Dockerfile
│   ├── .env.example
│   └── README.md
├── railway.json
├── .gitignore
└── BUILD_CHECKLIST.md
```

**Key architecture:** The `agent-lite/server/src/index.ts` imports the MCP server via relative path:
```typescript
const { {{serverVar}}Server } = require('../../mcp-server/src/hub-server');
```

---

## ================================================================
## PART 1: MCP SERVER (Phases 1-7)
## ================================================================

Phases 1-7 are IDENTICAL to `/opMCPcreate`. Follow the exact same patterns.

## Phase 1: Research the Target API

Before writing any code:

1. **Find the API documentation** — Swagger/OpenAPI spec, developer docs, or raw endpoint list
2. **Identify the authentication model**:
   - `none` — Public API, no credentials needed
   - `apikey` — API key sent as header (e.g., `x-api-key: KEY`)
   - `basic` — HTTP Basic Auth (`Authorization: Basic base64(id:secret)`)
   - `bearer` — Bearer token (`Authorization: Bearer TOKEN`)
3. **List ALL endpoints** — Group them by category (e.g., "Accounts", "Transactions", "Search")
4. **Identify the API type**: REST (most common) or GraphQL
5. **Note pagination patterns** — cursor-based, offset/limit, page numbers
6. **Test a few endpoints** manually to verify responses and understand data shapes

---

## Phase 2: Scaffold the Project

### MCP Server Directory Structure (MANDATORY — do not deviate)

```
mcp-server/
├── src/
│   ├── index.ts          # Standalone MCP server (Claude Desktop/Code)
│   ├── hub-server.ts     # AgentLite bundled integration
│   ├── api-client.ts     # HTTP/GraphQL client with auth
│   └── tools.ts          # Tool definitions (Zod schemas + handlers)
├── docs/
│   └── index.html        # Interactive documentation page
├── test/
│   └── test-tools.ts     # Automated test suite
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

**Two entry points, shared internals:**
- `index.ts` → standalone stdio server for Claude Desktop/Code
- `hub-server.ts` → `MCPServerInstance` class for AgentLite hub integration
- Both reuse the SAME `api-client.ts` and `tools.ts` — zero duplication

### package.json Template

```json
{
  "name": "{{SERVER_NAME}}-mcp-server",
  "version": "1.0.0",
  "description": "MCP server for {{SERVICE_NAME}} API",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "{{SERVER_NAME}}-mcp": "./dist/index.js"
  },
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

### tsconfig.json (EXACT — do not modify)

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

## Phase 3: Implement the MCP Server

### 3.1 — api-client.ts

Choose the auth pattern that matches your API. See `/opMCPcreate` for all 4 patterns (A: No Auth, B: API Key, C: Basic Auth, D: GraphQL).

**Read the reference implementations for the exact patterns:**
- No auth → `Lighthouse/mcp-server/src/api-client.ts`
- API key → `NodeFortress/mcp-server/src/api-client.ts`
- Basic auth → `GRID/mcp-server/src/api-client.ts`
- GraphQL → `LightsparkSDK/mcp-server/src/api-client.ts`

### 3.2 — tools.ts

Every tool follows this exact structure:

```typescript
import { z } from 'zod';
import { {{ClientName}} } from './api-client.js';

export const tools = [
  {
    name: 'category_action',
    description: 'Brief description under 60 chars',
    inputSchema: z.object({
      id: z.string().describe('item ID'),
      limit: z.number().optional().describe('max results'),
    }),
    handler: async (client: {{ClientName}}, args: { id: string; limit?: number }) =>
      client.getItem(args.id, args.limit),
  },
];
```

**Tool Naming:** `category_action` (e.g., `validators_list`, `contract_get`, `quote_execute`)
**Descriptions:** Under 60 chars, action-oriented
**Zod:** Always `.describe()` every field, `.optional()` for non-required

### 3.3 — index.ts (Standalone Server)

Standard MCP SDK wiring with `ListToolsRequestSchema` + `CallToolRequestSchema` handlers.
Read any reference server's `index.ts` for the exact pattern.

**CRITICAL for 30+ tools:** Wrap `zodToJsonSchema` and add `ToolDef` interface to prevent TS2589.

### 3.4 — hub-server.ts (AgentLite Integration)

Same `MCPServerInstance` pattern as `/opMCPcreate`. The hub-server.ts is what AgentLite imports.

**Read the reference:** `C:\Users\oreph\clawd\OrphilLLC\Clients\gcp_public_datasets\mcp-server\src\hub-server.ts`

---

## Phase 4: Generate Interactive Documentation

Create `docs/index.html` — dark-themed, interactive API reference.
**Read reference:** `NodeFortress/mcp-server/docs/index.html` (gold standard)

## Phase 5: Create Test Suite

Create `test/test-tools.ts` — automated tool testing with pass/fail tracking.

## Phase 6: Build, Test, and Document

Build, test, generate README with Claude Desktop config snippet and TEST-RESULTS.md.

## Phase 7: MCP Reference Comparison (GATE 1)

Compare against closest reference server. This gate must pass before starting AgentLite.

---

## ================================================================
## PART 2: AGENTLITE DEMO AGENT (Phases 8-12)
## ================================================================

After the MCP server is complete (Phases 1-7), scaffold the AgentLite demo agent.

**THE reference implementation for ALL AgentLite files:**
`C:\Users\oreph\clawd\OrphilLLC\Clients\gcp_public_datasets\agent-lite`

**When in doubt, READ the reference files. Every file below was proven in production.**

---

## Phase 8: Scaffold AgentLite

### 8.1 — agent-lite/server/package.json

```json
{
  "name": "agent-lite-server",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "npx tsx --watch src/index.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "axios": "^1.7.9",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "drizzle-orm": "^0.38.4",
    "express": "^4.21.2",
    "express-rate-limit": "^7.5.0",
    "openai": "^4.77.3",
    "pg": "^8.13.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/node": "^22.10.5",
    "@types/pg": "^8.11.10",
    "typescript": "^5.7.3"
  }
}
```

### 8.2 — agent-lite/server/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Note:** Server uses `commonjs` (not ESNext) because it imports the sibling MCP server via `require()`.

### 8.3 — agent-lite/web/package.json

```json
{
  "name": "agent-lite-web",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^9.0.3",
    "remark-gfm": "^4.0.0",
    "wouter": "^3.7.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.3",
    "vite": "^6.0.0"
  }
}
```

### 8.4 — agent-lite/web/vite.config.ts

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../server/public'),
    emptyOutDir: true,
  },
});
```

**Key:** Vite builds to `../server/public` so Express serves the frontend in production.

---

## Phase 9: AgentLite Backend

Build the backend by reading each file from the reference implementation. The files are organized into layers:

### Layer 1: Database (read from reference first)
- `db/schema.ts` — Drizzle table definitions (agents, conversations, messages, capabilities, capability_tokens, agent_capabilities, agent_documents, agent_memory_embeddings, agent_api_keys)
- `db/client.ts` — PG-only Drizzle client (~12 lines)
- `db/init.ts` — Creates pgvector extension, tables, indexes
- `db/date-utils.ts` — Simple `dbNow()` helper

### Layer 2: LLM + Chat
- `llm/types.ts` — LLMMessage, LLMProvider, GenerateOptions, StreamOptions, Tool, ToolCall interfaces
- `llm/claudeProvider.ts` — Anthropic SDK with per-agent API key support, tool use, streaming
- `llm/index.ts` — `getProviderForModel()` returns Claude provider
- `llm/toolExecutor.ts` — Dispatches tool calls to MCP Hub, deep tools, or memory tools
- `chat/chatService.ts` — `generateReply()`, `streamReply()`, `startConversation()`, `ensureDefaultAgent()`
- `session/contextBuilder.ts` — Builds system prompt with optional soul.md + memory injection

### Layer 3: MCP Hub
- `mcp-hub/types.ts` — MCPServerInstance, MCPTool, MCPResponse, HubConfig
- `mcp-hub/registry.ts` — Server registration and tool lookup
- `mcp-hub/router.ts` — Routes tool calls to correct server
- `mcp-hub/orchestrator.ts` — Central orchestration, singleton `getOrchestrator()`
- `mcp-hub/index.ts` — Barrel export

### Layer 4: Tools + Memory + RAG
- `tools/webSearch.ts` — Brave Search API
- `tools/webFetch.ts` — URL fetch + HTML-to-text
- `tools/deepTools.ts` — Barrel: `DEEP_TOOLS`, `getDeepToolDefinitions`, `isDeepTool`, `executeDeepTool`
- `memory/defaults.ts` — Default soul.md/memory.md/context.md templates
- `memory/memoryTools.ts` — 4 LLM-callable tools: `memory__read/write/search/append`
- `memory/documentService.ts` — PG CRUD for agent documents
- `memory/memoryEmbedder.ts` — Incremental re-embedding with SHA-256 hashing
- `memory/index.ts` — Barrel export
- `rag/ragService.ts` — pgvector semantic search

### Layer 5: HTTP API
- `middleware/auth.ts` — X-API-Key header or api_key query param
- `http/chatRoutes.ts` — POST /start, GET /:id, POST /:id/message, POST /:id/stream (SSE)
- `http/adminRoutes.ts` — Agent CRUD, model list, capabilities, tokens, documents, MCP Hub status
- `http/app.ts` — Express with CORS, security headers, rate limiting, static serving, SPA fallback
- `capabilities/capabilityService.ts` — AES-256-GCM encrypted token storage, per-agent API keys

### Layer 6: Config + Entry Point
- `config/appConfig.ts` — Feature flags: `FEATURE_SOUL_MEMORY`, `FEATURE_DEEP_TOOLS`
- `utils/logger.ts` — Structured JSON logger
- `index.ts` — Entry point:

```typescript
// Entry point pattern:
// 1. Load dotenv
// 2. Init database (create tables, pgvector extension)
// 3. Import sibling MCP server's hub-server.ts
// 4. Set tokens and register with orchestrator
// 5. Seed default capabilities
// 6. Start Express on PORT (default 4000)

// CRITICAL: Import the sibling MCP server
const { {{serverVar}}Server } = require('../../mcp-server/src/hub-server');
{{serverVar}}Server.setTokens({
  token1: process.env.{{TOKEN1_ENV}},
  token2: process.env.{{TOKEN2_ENV}},
});
await orchestrator.registerServer({{serverVar}}Server);
```

**After building all files:** Run `npx tsc --noEmit` to verify 0 TypeScript errors.

---

## Phase 10: AgentLite Frontend

### 10.1 — Entry Files
- `web/index.html` — Standard Vite HTML entry with `<div id="root">`
- `web/src/main.tsx` — `createRoot(document.getElementById('root')!).render(<App />)`
- `web/src/theme.ts` — Brand colors (primary, accent, backgrounds)

### 10.2 — App.tsx (Router)

Routes with wouter:
- `/` → redirect to `/chat` or `/setup` based on setup status
- `/chat` → `ChatPage`
- `/admin` → `AdminPage` (lazy loaded)
- `/setup` → `SetupWizard` (lazy loaded)

Checks `/api/setup/status` on mount to determine if setup is complete.

### 10.3 — ChatPage.tsx (~300-600 lines)

Full-page SSE streaming chat:
- POST to `/api/chat/start` to create conversation
- POST to `/api/chat/:id/stream` for SSE streaming
- Parse SSE events: `start`, `delta`, `thinking`, `tool`, `end`, `error`
- Render messages with `react-markdown` + `remark-gfm`
- Show tool execution indicators (thinking, tool name)
- Auto-scroll, input with Enter to send

### 10.4 — SetupWizard.tsx (~200-400 lines)

2-step wizard:
1. **Step 1:** Enter Anthropic API key (saved via admin API)
2. **Step 2:** Configure agent name, description, default model

### 10.5 — AdminPage.tsx (~500-1200 lines)

3-tab admin panel:
1. **Agent Settings** — Name, description, instructions, model selector
2. **MCP Hub** — Capability toggle, token configuration, tool test panel
3. **Soul & Memory** — Edit soul.md/memory.md/context.md (only if `FEATURE_SOUL_MEMORY=true`)

### 10.6 — Widget Embed Script

`web/public/widget.js` — Embeddable chat widget (~120 lines):
```html
<script src="https://your-domain.railway.app/widget.js" data-agent-id="default"></script>
```

**After building:** Run `npx vite build` to verify frontend builds successfully.

---

## Phase 11: Deployment

### 11.1 — Dockerfile (Multi-Stage)

```dockerfile
# Stage 1: Build React frontend
FROM node:20-alpine AS web-builder
WORKDIR /app/web
COPY agent-lite/web/package*.json ./
RUN npm ci
COPY agent-lite/web/ ./
RUN npm run build

# Stage 2: Build Express server
FROM node:20-alpine AS server-builder
WORKDIR /app/server
COPY agent-lite/server/package*.json ./
RUN npm ci
COPY agent-lite/server/ ./
COPY --from=web-builder /app/server/public ./public
COPY mcp-server/ /mcp-server/
WORKDIR /mcp-server
RUN npm ci
WORKDIR /app/server
RUN npm run build

# Stage 3: Production
FROM node:20-alpine
WORKDIR /app
COPY --from=server-builder /app/server/dist ./dist
COPY --from=server-builder /app/server/public ./public
COPY --from=server-builder /app/server/node_modules ./node_modules
COPY --from=server-builder /app/server/package.json ./
COPY --from=server-builder /mcp-server /mcp-server
EXPOSE 4000
CMD ["node", "dist/index.js"]
```

**CRITICAL:** The Dockerfile's build context is the REPO ROOT (not `agent-lite/`). This is why it can COPY both `agent-lite/` and `mcp-server/`.

### 11.2 — railway.json (at repo root)

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "agent-lite/Dockerfile"
  },
  "deploy": {
    "startCommand": "node dist/index.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### 11.3 — Railway Setup

**Resources needed:**
| Resource | Type | Notes |
|----------|------|-------|
| Web Service | Railway Service | Express serves API + React SPA + MCP Hub in-process |
| PostgreSQL | Railway Plugin or External | MUST have pgvector (regular Railway Postgres does NOT have it) |

**Required env vars:**

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL with pgvector connection string |
| `NODE_ENV` | Yes | `production` |
| `ADMIN_API_KEY` | Yes | Admin API authentication key |
| `FEATURE_SOUL_MEMORY` | No | `true` to enable soul/memory (default: false) |
| `FEATURE_DEEP_TOOLS` | No | `true` to enable web search/fetch (default: true) |
| `BRAVE_API_KEY` | No | For web search tool |
| `ANTHROPIC_API_KEY` | No | Can be set per-agent in admin UI instead |
| `{{TOKEN1_ENV}}` | No | MCP server credential 1 (can be set in UI) |
| `{{TOKEN2_ENV}}` | No | MCP server credential 2 (can be set in UI) |

**Railway service settings:**
- `rootDirectory`: `""` (empty — repo root, NOT `agent-lite/`)
- `dockerfilePath`: `agent-lite/Dockerfile`
- Generate a Railway domain for the service

### 11.4 — .env.example + README

Document all env vars, quickstart guide, Railway deploy steps, and widget embed instructions.

---

## Phase 12: AgentLite Reference Comparison (FINAL GATE)

This is the FINAL step. **Do NOT skip this.**

1. **Read these files from the reference:**
   - `C:\Users\oreph\clawd\OrphilLLC\Clients\gcp_public_datasets\agent-lite\server\src\index.ts`
   - `C:\Users\oreph\clawd\OrphilLLC\Clients\gcp_public_datasets\agent-lite\server\src\chat\chatService.ts`
   - `C:\Users\oreph\clawd\OrphilLLC\Clients\gcp_public_datasets\agent-lite\server\src\llm\claudeProvider.ts`
   - `C:\Users\oreph\clawd\OrphilLLC\Clients\gcp_public_datasets\agent-lite\server\src\http\app.ts`
   - `C:\Users\oreph\clawd\OrphilLLC\Clients\gcp_public_datasets\agent-lite\web\src\ChatPage.tsx`
   - `C:\Users\oreph\clawd\OrphilLLC\Clients\gcp_public_datasets\agent-lite\web\src\AdminPage.tsx`
   - `C:\Users\oreph\clawd\OrphilLLC\Clients\gcp_public_datasets\agent-lite\Dockerfile`

2. **Verify your implementation matches:**
   - Same DB schema tables and columns
   - Same MCP Hub integration pattern (import from sibling, setTokens, registerServer)
   - Same SSE streaming pattern in chatRoutes
   - Same feature flag gating for soul/memory
   - Same Dockerfile multi-stage pattern with sibling mcp-server COPY
   - Same admin API shape (routes, request/response format)

3. **Document any deviations** in BUILD_CHECKLIST.md

4. **Mark completion** — fill in dates, counts, status

---

## Workflow Summary

```
=== PART 1: MCP SERVER ===
Phase 1:  Research API          → Update checklist
Phase 2:  Scaffold MCP server   → Update checklist
Phase 3:  Implement server      → Update checklist
Phase 4:  Generate docs         → Update checklist
Phase 5:  Create & run tests    → Update checklist
Phase 6:  Finalize MCP          → Update checklist
Phase 7:  MCP reference compare → Update checklist → GATE 1 ✓

=== PART 2: AGENTLITE DEMO ===
Phase 8:  Scaffold AgentLite    → Update checklist
Phase 9:  Build backend         → Update checklist
Phase 10: Build frontend        → Update checklist
Phase 11: Deployment config     → Update checklist
Phase 12: AgentLite compare     → Update checklist → FINAL GATE ✓
```

Every phase ends with updating `BUILD_CHECKLIST.md`. The checklist IS the deliverable tracker.
