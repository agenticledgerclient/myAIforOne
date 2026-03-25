---
description: "Audit test coverage gaps against API routes. Compares API route domains against Comprehensive Test Suite files, reports missing tests, and adds them. Use after adding features or anytime you want to check test coverage. Does NOT cover API docs or MCP — use /opappbuild_agentready_trueup for that."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent, Skill
argument-hint: "[project path] [--report-only]"
---

# Test Suite True-Up

Audit the project's test coverage against API routes, find gaps, and catch everything up.

## Arguments
$ARGUMENTS
- `project path` — root of the target project (required)
- `--report-only` — just show the gap report, don't fix anything

## Workflow

### Step 1: Inventory — API Routes (Source of Truth)
Scan `server/routes/*.ts` (or equivalent) and extract every endpoint:
- Method (GET/POST/PATCH/DELETE)
- Path
- Route group/domain

Build a master list: `{ method, path, domain }[]`

### Step 2: Inventory — Test Files
Read `Comprehensive Test Suite/` directory structure.
For each domain subfolder, list the test files and extract what endpoints they cover.
Build list: `{ domain, file, endpointsCovered[] }[]`

### Step 3: Gap Report
Print a clear report:

```
=== Test Suite True-Up Report: {Project Name} ===

API Routes:      {N} endpoints across {N} domains
Test Files:      {N} files covering {N}/{N} domains ({N} missing)
Endpoint Coverage: {N}/{N} endpoints tested ({N} missing)

--- Domains Without Test Files ---
  widgets (3 endpoints: GET/POST/DELETE)
  reports (2 endpoints: GET/POST)

--- Endpoints Without Test Coverage ---
  POST /api/widgets (widgets domain)
  DELETE /api/widgets/:id (widgets domain)
  GET /api/reports/export (reports domain)

--- Test Files Without Matching Routes (stale?) ---
  old-feature-tests.js (no matching route group)
```

If `--report-only`, stop here.

### Step 4: Fix Gaps
For each missing domain/endpoint:

1. **New domain test file** — Delegate to `/optestcreate` or create manually following existing test file patterns in the project
2. **Missing endpoint tests** — Add test cases to existing domain test files
3. **Update run-all-tests.js** — Ensure new test files are included in the runner

### Step 5: Verify Fixes
After fixing:
1. Run `node "Comprehensive Test Suite/run-all-tests.js"` — all tests pass
2. Recount inventories and confirm gaps are zero

### Step 6: Run Completion Checklist

## Completion Checklist

```
[ ] All API route domains have test files in Comprehensive Test Suite/
[ ] All API endpoints have at least one test case
[ ] run-all-tests.js includes all test files
[ ] Tests actually run and pass
[ ] Gap report shows 0 missing across all categories
```

Print the checklist with pass/fail for each item and the final gap counts.

## Tips

- This skill is idempotent — run it as many times as you want
- Run with `--report-only` first to see the damage before fixing
- Good cadence: run after every major feature, before every release
- The skill reads existing test patterns from the project to match conventions when adding new tests
