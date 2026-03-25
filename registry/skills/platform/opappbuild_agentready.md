---
description: "Master orchestrator: make any project fully agent-ready with APIs, API docs, MCP server, and MCP docs. Delegates to child skills (/opswaggerbuilder, /opMCPcreate, /opMCPdocs) and ensures all 4 layers are built and connected. Use when setting up a new project for MCP/agent access or adding agent capabilities to an existing app."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent, Skill
argument-hint: "[project path] [phase: all|apis|apidocs|mcp|mcpdocs]"
---

# Agent-Ready App Builder

Make any project fully agent-ready by building all 4 layers of the agent integration stack. This skill **delegates** to specialized child skills — it does NOT duplicate their logic.

## Arguments
$ARGUMENTS
- `project path` — root of the target project (required)
- `phase` — which layer to build (default: `all`)
  - `all` — build everything in order
  - `apis` — just set up REST APIs with auth
  - `apidocs` — just generate API documentation (calls `/opswaggerbuilder`)
  - `mcp` — just build MCP server (calls `/opMCPcreate`)
  - `mcpdocs` — just generate MCP documentation (calls `/opappbuild_mcpdocs`)

## The 4 Layers

```
┌─────────────────────────────────────────────┐
│  Layer 4: MCP Documentation                 │
│  Interactive MCP tool docs page             │
│  Skill: /opMCPdocs                           │
├─────────────────────────────────────────────┤
│  Layer 3: MCP Server                        │
│  Bundled MCP with tool definitions + hub    │
│  Skill: /opMCPcreate                        │
├─────────────────────────────────────────────┤
│  Layer 2: API Documentation                 │
│  Interactive Swagger-style API docs page    │
│  Skill: /opswaggerbuilder                   │
├─────────────────────────────────────────────┤
│  Layer 1: REST APIs + Auth                  │
│  JWT + API Key auth, CRUD endpoints         │
│  Built directly by this skill               │
└─────────────────────────────────────────────┘
```

## Workflow

### Phase 0: Discovery
Before building anything, understand the project:
1. Read `CLAUDE.md` / `README.md` for project context
2. Check what already exists:
   - APIs? → `server/routes/` or equivalent
   - Auth? → `server/middleware/auth.ts` or similar
   - API docs? → `ApiDocsPage.tsx` or `/api-docs` route
   - MCP server? → `server/mcp-server/` directory
   - MCP docs? → `McpDocsPage.tsx` or `/mcp-docs` route
3. Identify the project's stack (Express/Fastify/Next, React/Vue, Prisma/Drizzle, etc.)
4. Identify the auth model (JWT, API keys, both, none)
5. Report findings and which layers need building

### Phase 1: REST APIs + Auth (Layer 1)
**Skip if APIs already exist.**

If the project needs APIs built from scratch:

1. **Auth middleware** — Set up dual auth (JWT Bearer + API Key):
   - `server/middleware/auth.ts` — authenticate middleware checking both methods
   - API Key: SHA-256 hashed, stored in DB, checked via `X-API-Key` header
   - JWT: `Authorization: Bearer {token}`, payload `{ userId, orgId, role }`
   - Role hierarchy: `platform_admin > admin > advanced > standard > read_only`

2. **API routes** — Create CRUD endpoints for all domain entities:
   - Follow RESTful conventions: `GET /api/{domain}`, `POST /api/{domain}`, etc.
   - All routes behind auth middleware
   - Consistent error handling and response format

3. **API Key management** — If using API keys:
   - `POST /api/api-keys` — generate new key
   - `GET /api/api-keys` — list keys (masked)
   - `DELETE /api/api-keys/:id` — revoke key
   - Keys displayed once on creation, stored as SHA-256 hash

**Reference**: Check `~/Desktop/APPs/Process & Controls/server/middleware/auth.ts` and `~/Desktop/APPs/pl-analyzer/server/middleware/auth.ts` for the proven dual-auth pattern.

### Phase 2: API Documentation (Layer 2)
**Delegate to `/opswaggerbuilder`.**

Invoke the skill with:
- The project path
- The discovered endpoints catalog
- The auth model

The skill produces an interactive `ApiDocsPage.tsx` with:
- Categorized endpoint navigation
- Request builder with live testing
- cURL generation
- Response viewer
- If API keys: companion API Key management page

### Phase 3: MCP Server (Layer 3)
**Delegate to `/opMCPcreate`.**

Invoke the skill with:
- The project path
- The API type (REST or GraphQL)
- The auth model
- Point it at the API docs or endpoint catalog from Phase 2

The skill produces:
- `server/mcp-server/api-client.ts` — HTTP client with auth
- `server/mcp-server/tools/*.ts` — Tool definitions with Zod schemas
- `server/mcp-server/hub-server.ts` — Hub server for bundled mode
- `server/mcp-server/types.ts` — MCPToolDef interface
- `docs/index.html` — Standalone dark-theme docs (separate from in-app docs)
- Test suite

### Phase 4: MCP Documentation (Layer 4)
**Delegate to `/opMCPdocs`.**

Invoke the skill with:
- The project path

The skill reads the MCP tool definitions from Phase 3 and produces:
- `client/src/pages/McpDocsPage.tsx` — Interactive in-app MCP docs
- Navigation link added to sidebar
- Route added to router

### Phase 5: Integration Verification
After all layers are built:

1. **Navigation check** — Verify the app's sidebar/nav has a "Documentation" section with:
   - API Docs link → `/api-docs`
   - MCP Docs link → `/mcp-docs`

2. **Auth flow check** — Verify:
   - API Key page exists and can generate keys
   - Keys work with both API endpoints AND MCP tools
   - JWT auth works with both

3. **Coverage check** — Compare:
   - API endpoint count vs MCP tool count (should be ~1:1)
   - All CRUD operations have corresponding MCP tools
   - All MCP tools are documented in McpDocsPage

4. **Compile check** — Run `npx tsc --noEmit` to verify no TypeScript errors

5. **Report** — Print summary:
   ```
   Agent-Ready Status:
   ✓ Layer 1: {N} API endpoints with {auth model} auth
   ✓ Layer 2: API Docs page at /api-docs
   ✓ Layer 3: MCP Server with {N} tools in {N} categories
   ✓ Layer 4: MCP Docs page at /mcp-docs

   Documentation section: /api-docs, /mcp-docs
   API Key management: /settings/api-keys (or wherever)
   ```

## Key Principles

1. **Delegate, don't duplicate** — Each child skill has its own proven patterns. Call them, don't reimplement.
2. **Discover first** — Never assume what exists. Always check before building.
3. **Match the project** — Use the project's existing stack, design system, and conventions.
4. **API:MCP parity** — Every API endpoint should have a corresponding MCP tool. Every MCP tool should be documented.
5. **Dual auth everywhere** — Both JWT and API Key should work for APIs and MCP.

## Reference Projects
These projects have all 4 layers fully built:
- **Process & Controls**: `~/Desktop/APPs/Process & Controls/` — 97 API endpoints, 90+ MCP tools, both doc pages
- **pl-analyzer**: `~/Desktop/APPs/pl-analyzer/` — 100+ API endpoints, 100+ MCP tools, both doc pages

## CLAUDE.md Update
After completion, append a concise block to the project's CLAUDE.md. **Keep it tight — standing orders, not documentation.**

```markdown
## New Endpoint Checklist — MANDATORY
Every new API endpoint MUST:
1. Add tests to `Comprehensive Test Suite/{domain}/`
2. Add to ENDPOINTS[] in `ApiDocsPage.tsx`
3. Add MCP tool in `server/mcp-server/tools/{domain}.ts`
4. Add to TOOL_DOCS[] in `McpDocsPage.tsx`
5. Run tests: `node "Comprehensive Test Suite/run-all-tests.js"` — ALL must pass
```

**Rules:**
- If CLAUDE.md already has a similar checklist, UPDATE it — don't duplicate
- Never exceed 6 lines
- Imperative voice, no explanations

## Completion Checklist

After all phases, verify each item and report pass/fail:

```
[ ] Layer 1: API routes exist with auth middleware (JWT + API Key)
[ ] Layer 2: ApiDocsPage.tsx exists with ENDPOINTS[] covering all routes
[ ] Layer 3: server/mcp-server/ exists with tools covering all routes
[ ] Layer 4: McpDocsPage.tsx exists with TOOL_DOCS[] covering all tools
[ ] Navigation: sidebar has Documentation section with API Docs + MCP Docs links
[ ] Auth: API Key management page exists (create/list/revoke)
[ ] Parity: API endpoint count ≈ MCP tool count (report both)
[ ] CLAUDE.md: "New Endpoint Checklist" block present
[ ] TypeScript: `npx tsc --noEmit` passes clean
[ ] Tests: test suite runs without crashes
```

Print the checklist with pass/fail for each item.
