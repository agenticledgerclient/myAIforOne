---
description: "Audit and catch up a project's API docs, MCP tools, MCP docs, and api-client methods. Compares API routes against docs and MCP coverage, reports gaps, and fixes them. Use after adding features or anytime you want to see how far behind documentation is. Does NOT cover tests — use /opappbuild_testsuite_trueup for that."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent, Skill
argument-hint: "[project path] [--report-only]"
---

# Agent-Ready True-Up

Audit the project's agent-readiness layers, find gaps, and catch everything up.

## Arguments
$ARGUMENTS
- `project path` — root of the target project (required)
- `--report-only` — just show the gap report, don't fix anything

## What This Checks

Four inventories compared against each other:

```
┌─────────────────┐     ┌──────────────────┐
│  API Routes     │ ──► │  API Docs Page   │
│  (source of     │     │  (ENDPOINTS[])   │
│   truth)        │     └──────────────────┘
│                 │     ┌──────────────────┐     ┌─────────────────┐
│                 │ ──► │  MCP Tools       │ ──► │  MCP Docs Page  │
│                 │     │  (tools/*.ts)    │     │  (TOOL_DOCS[])  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## Workflow

### Step 1: Inventory — API Routes (Source of Truth)
Scan `server/routes/*.ts` (or equivalent) and extract every endpoint:
- Method (GET/POST/PATCH/DELETE)
- Path
- Route group/domain

Build a master list: `{ method, path, domain }[]`

### Step 2: Inventory — API Docs
Read `client/src/pages/ApiDocsPage.tsx` and extract the `ENDPOINTS` array.
Build list of documented endpoints: `{ method, path, group }[]`

**Gap: routes without API docs entries.**

### Step 3: Inventory — MCP Tools
Read `server/mcp-server/tools/*.ts` and extract all tool definitions.
Build list: `{ name, file, hasHandler }[]`

Also read `server/mcp-server/api-client.ts` for method coverage.

**Gap: routes without MCP tools, MCP tools without api-client methods.**

### Step 4: Inventory — MCP Docs
Read `client/src/pages/McpDocsPage.tsx` and extract the `TOOL_DOCS` array.
Build list of documented tools: `{ name, category }[]`

**Gap: MCP tools without docs entries.**

### Step 5: Gap Report
Print a clear report:

```
=== True-Up Report: {Project Name} ===

API Routes:      {N} endpoints across {N} domains
API Docs:        {N}/{N} documented ({N} missing)
MCP Tools:       {N}/{N} covered ({N} missing)
MCP Docs:        {N}/{N} documented ({N} missing)

--- Missing API Docs ---
  POST /api/widgets (widgets domain)
  DELETE /api/widgets/:id (widgets domain)

--- Missing MCP Tools ---
  POST /api/widgets → needs widget_create tool
  DELETE /api/widgets/:id → needs widget_delete tool

--- Missing MCP Docs ---
  widget_create (tools/widgets.ts)
  widget_delete (tools/widgets.ts)

--- Missing API Client Methods ---
  createWidget() for POST /api/widgets
  deleteWidget() for DELETE /api/widgets/:id
```

If `--report-only`, stop here.

### Step 6: Fix Gaps
For each gap category, fix in order:

1. **API Docs** — Add missing entries to `ENDPOINTS[]` in `ApiDocsPage.tsx`
2. **MCP api-client** — Add missing methods to `api-client.ts`
3. **MCP Tools** — Add missing tool definitions to appropriate `tools/*.ts` file
4. **MCP hub-server** — Update imports/ALL_TOOLS if new tool files were created
5. **MCP Docs** — Add missing entries to `TOOL_DOCS[]` in `McpDocsPage.tsx`

### Step 7: Verify Fixes
After fixing:
1. Run `npx tsc --noEmit` — no TypeScript errors
2. Recount inventories and confirm gaps are zero

### Step 8: Run Completion Checklist

## Completion Checklist

```
[ ] All API routes have API Docs entries (ENDPOINTS[])
[ ] All API routes have MCP tools (tools/*.ts)
[ ] All MCP tools have api-client methods
[ ] All MCP tools have MCP Docs entries (TOOL_DOCS[])
[ ] hub-server.ts imports match tool files on disk
[ ] TypeScript compiles clean (npx tsc --noEmit)
[ ] Gap report shows 0 missing across all categories
```

Print the checklist with pass/fail for each item and the final gap counts.

## Tips

- This skill is idempotent — run it as many times as you want
- Run with `--report-only` first to see the damage before fixing
- Good cadence: run after every major feature, before every release
- The skill reads existing patterns from the project's docs/tools to match conventions when adding new entries
