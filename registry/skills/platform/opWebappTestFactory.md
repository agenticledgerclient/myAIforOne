---
name: opWebappTestFactory
description: "Auto-generate a complete runtest/ E2E harness (Smoke, Use, Volume) for any web app. Discovers routes, endpoints, entities, AND the core product workflow. Generates CRUD tests, workflow chain tests, branch tests, and utility endpoint coverage for near-100% API coverage. Use when you want automated browser testing for any web application."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
argument-hint: [project-path]
---

# Webapp Test Factory

Auto-generate a complete Playwright E2E test harness for any web app. You (Claude) ARE the discovery engine — read the codebase, understand the app, and generate real tests.

**Three test tiers:**
- **Smoke Test** — Visit every route, assert pages load (no 404s, no crashes)
- **Use Test** — Full CRUD on every discovered entity via API endpoints + navigation + UI interactions
- **Volume Test** — Run Smoke + Use N times in a loop, stop on first failure, write JSONL index

**Output:** A `runtest/` folder in the target project with all test scripts, ready to run.

---

## Step 0: Resolve Project Path

```
PROJECT_ROOT = $ARGUMENTS or current working directory
```

- If `$ARGUMENTS` is provided, use it as the project root path
- If empty, use the current working directory
- Verify the path exists with `ls`
- Verify it looks like a web app project (has `package.json`, `requirements.txt`, `Gemfile`, or similar)

---

## Step 1: Collect User Inputs

Use `AskUserQuestion` to gather:

1. **BASE_URL** — The live URL of the running app (e.g., `https://myapp.example.com`)
2. **TEST_EMAIL** — Test account email
3. **TEST_PASSWORD** — Test account password

Also ask: "Does your app use standard login selectors? (email input, password input, submit button at /login). If not, specify your custom selectors."

Store these values for `.env` generation later.

---

## Step 2: Framework Detection

Run these checks **in parallel** (multiple Glob/Grep calls at once):

### 2a: Package Manager / Dependencies

| Check | How |
|-------|-----|
| Node.js deps | Read `{root}/package.json` — check `dependencies` + `devDependencies` for: `next`, `@remix-run/react`, `vue`, `@angular/core`, `express`, `fastify`, `hono`, `koa` |
| Python deps | Read `{root}/requirements.txt` or `{root}/pyproject.toml` — check for: `django`, `flask`, `fastapi`, `starlette` |
| Ruby deps | Read `{root}/Gemfile` — check for: `rails`, `sinatra` |

### 2b: Framework-Specific Markers

| Check | How |
|-------|-----|
| Next.js App Router | `Glob: {root}/**/app/**/page.{tsx,jsx,ts,js}` (exclude node_modules) |
| Next.js Pages Router | `Glob: {root}/**/pages/**/*.{tsx,jsx,ts,js}` (exclude node_modules, _app, _document) |
| React Router SPA | `Grep: createBrowserRouter\|BrowserRouter\|<Routes` in `*.tsx` / `*.jsx` |
| Vue Router | `Grep: createRouter\|VueRouter` in `*.ts` / `*.js` / `*.vue` |
| Angular Router | `Glob: {root}/**/app-routing.module.ts` or `Grep: RouterModule` |

### 2c: ORM / Database

| Check | How |
|-------|-----|
| Prisma | `Glob: {root}/**/schema.prisma` |
| Drizzle | `drizzle-orm` in package.json deps OR `Grep: pgTable\|mysqlTable\|sqliteTable` in `*.ts` |
| TypeORM | `typeorm` in package.json deps |
| Sequelize | `sequelize` in package.json deps |
| Django ORM | `Glob: {root}/**/models.py` |
| ActiveRecord | `Glob: {root}/app/models/*.rb` |

### 2d: Output

Print a detection summary:

```
=== Framework Detection ===
Frontend: Next.js App Router
Backend:  Express
ORM:      Drizzle
```

---

## Step 3: Route Discovery

Based on the detected frontend framework, discover all navigable routes.

**IMPORTANT:** Always exclude these directories from all searches: `node_modules/`, `.next/`, `dist/`, `build/`, `vendor/`, `__pycache__/`, `.git/`

### Next.js App Router
```
Glob: {root}/**/app/**/page.{tsx,jsx,ts,js}
```
For each match:
- Get the path relative to the `app/` directory
- Strip `page.tsx` (the file itself)
- Strip route groups: `(groupname)` segments
- Strip parallel routes: `@slotname` segments
- Convert `[param]` to `:param` (mark as parameterized)
- Skip files under `api/` directories

Example: `src/app/(dashboard)/workstreams/[id]/page.tsx` → `/workstreams/:id`

### Next.js Pages Router
```
Glob: {root}/**/pages/**/*.{tsx,jsx,ts,js}
```
- Skip `_app`, `_document`, `_error` files
- Skip `api/` directory
- Strip file extension, `index` → `/`
- Convert `[param]` to `:param`

### React SPA (React Router)
```
Grep: path:\s*["']/ in *.tsx and *.jsx files
```
Extract all `path` prop values. Also search nav/sidebar components:
```
Grep: (to|href)=["']/ in files matching *nav*, *sidebar*, *menu*, *layout*
```

### Vue Router
```
Grep: path:\s*['"]/ in **/router/**/*.{ts,js} and **/router.{ts,js}
```

### Django
```
Grep: path\(|re_path\(|url\( in **/urls.py
```
Extract the first string argument as the URL pattern.

### Rails
Read `config/routes.rb`. Look for:
- `get '/path'` → route
- `resources :entities` → standard CRUD routes
- `root 'controller#action'` → `/`

### Fallback (Unknown Framework)
```
Grep: (to|href)=["']/ in *.tsx, *.jsx, *.vue, *.html, *.erb
```
Deduplicate, filter out external URLs (http://, https://), filter out anchor links (#), filter out asset paths (/images, /css, /js).

### Output

Split discovered routes into two lists:

**Static routes** → write to `paths.txt` (used by Smoke test):
```
/
/dashboard
/settings
/reports
/admin
```

**Parameterized routes** → note for Use test (not in paths.txt):
```
/workstreams/:id
/users/:id/edit
```

Print: `Routes discovered: {N} static, {M} parameterized`

---

## Step 4: API Endpoint Discovery

Discover all backend API endpoints with their HTTP methods.

### Express / Fastify / Hono / Koa (Node.js)

**Step 4a:** Find route prefix mounts:
```
Grep: app\.use\s*\(\s*["']/api in *.ts and *.js (exclude node_modules)
```
This finds patterns like `app.use("/api/workstreams", workstreamRouter)` — record the prefix + router variable name.

**Step 4b:** Find route handlers:
```
Grep: \.(get|post|put|patch|delete)\s*\(\s*["'] in *.ts and *.js under server/, backend/, src/server/, src/routes/, routes/
```
This finds patterns like `router.get("/", ...)` or `app.post("/api/users", ...)`.

**Step 4c:** Combine prefix + handler path to get full API paths. For each, record:
- HTTP method (GET/POST/PUT/PATCH/DELETE)
- Full path (e.g., `/api/workstreams/:id`)
- Source file and line number

### Next.js API Routes (App Router)
```
Glob: {root}/**/app/api/**/route.{ts,js}
```
For each file:
- Convert directory path to URL: `app/api/workstreams/[id]/route.ts` → `/api/workstreams/:id`
- Read the file and check which functions are exported: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`

### Next.js API Routes (Pages Router)
```
Glob: {root}/**/pages/api/**/*.{ts,js}
```
- Convert file path to URL
- Read the file to determine supported methods (check for `req.method === 'POST'` etc.)

### Django
```
Grep: (def\s+(get|post|put|patch|delete|list|create|retrieve|update|destroy|partial_update)) in **/views.py and **/viewsets.py
```
Cross-reference with `urls.py` patterns to get full paths.

### Flask / FastAPI
```
Grep: @(app|router|blueprint)\.(get|post|put|patch|delete)\s*\( in *.py
```

### Rails
Parse `config/routes.rb`:
- `resources :users` generates: GET /users, POST /users, GET /users/:id, PUT /users/:id, DELETE /users/:id
- Explicit routes: `get '/api/stats', to: 'stats#index'`

### Output

Print a table:

```
=== API Endpoints ===
GET    /api/workstreams          server/routes.ts:142
POST   /api/workstreams          server/routes.ts:198
GET    /api/workstreams/:id      server/routes.ts:156
PUT    /api/workstreams/:id      server/routes.ts:210
DELETE /api/workstreams/:id      server/routes.ts:240
GET    /api/dashboards           server/routes.ts:300
POST   /api/dashboards           server/routes.ts:350
...
Total: {N} endpoints
```

---

## Step 5: Entity / Model Discovery

Find all data entities and their fields.

### Prisma
```
Glob: {root}/**/schema.prisma
```
Read the file and parse every `model EntityName { ... }` block. Extract:
- Model name
- Field names and types
- Required vs optional fields
- Relations (@relation)

### Drizzle
```
Grep: (pgTable|mysqlTable|sqliteTable)\s*\( in *.ts (exclude node_modules)
```
Read matched files and parse table definitions. Extract:
- Table name (first argument string)
- Column names and types
- Which columns are required (`.notNull()`)

### Django
```
Grep: class\s+\w+\(models\.Model\) in **/models.py
```
Read each model class. Extract field names and types.

### Rails
```
Glob: {root}/app/models/*.rb
```
Read each model. Also check `db/schema.rb` for column definitions.

### TypeScript Interfaces (Fallback)
```
Grep: (export\s+)?(interface|type)\s+\w+(Insert|Create|Select|Update|Response) in *.ts
```
These naming patterns (e.g., `InsertUser`, `CreateWorkstreamRequest`) reveal entity shapes.

### Infer from API Paths (Last Resort)
If no schema/models found, extract entity names from API paths:
- `/api/workstreams` → entity: `workstream`
- `/api/users/:id` → entity: `user`
- `/api/invoices` → entity: `invoice`

Use minimal assumed fields: `{ name: string }` or `{ title: string }`

### Output

Print discovered entities:

```
=== Entities ===
workstream: id, name, description, orgId, createdAt (source: Drizzle schema)
dashboard:  id, name, workstreamId, layout, createdAt (source: Drizzle schema)
user:       id, email, name, role (source: Drizzle schema)
```

---

## Step 6: CRUD Mapping

Cross-reference entities (Step 5) with API endpoints (Step 4) to build a CRUD map.

### Algorithm

For each entity:
1. Find API endpoints whose path contains the entity name (singular or plural)
2. Classify by HTTP method:
   - `GET /api/{entities}` → **list**
   - `GET /api/{entities}/:id` → **read**
   - `POST /api/{entities}` → **create**
   - `PUT /api/{entities}/:id` or `PATCH /api/{entities}/:id` → **update**
   - `DELETE /api/{entities}/:id` → **delete**
3. For **create** and **update** endpoints: READ the route handler code to determine:
   - What fields does the request body expect? (Look for `req.body.fieldName` or schema validation)
   - What does the response look like? (Look for `res.json({ entity: { id, ... } })` or similar)
4. Note any foreign key relationships (e.g., dashboard requires workstreamId)

### Output

Print the CRUD map:

```
=== CRUD Map ===
workstream:
  list:   GET /api/workstreams
  create: POST /api/workstreams  → body: { name, description }  → response: { workstream: { id, ... } }
  read:   GET /api/workstreams/:id
  update: PUT /api/workstreams/:id  → body: { name, description }
  delete: DELETE /api/workstreams/:id

dashboard (depends on: workstream):
  list:   GET /api/dashboards
  create: POST /api/dashboards  → body: { name, workstreamId }  → response: { dashboard: { id, ... } }
  read:   GET /api/dashboards/:id
  delete: DELETE /api/dashboards/:id
  ⚠ No update endpoint found

user:
  list:   GET /api/users
  read:   GET /api/users/:id
  ⚠ No create/update/delete — read-only entity (skip CRUD tests)
```

Only entities with at least **create + list** (or create + read) qualify for CRUD testing.

---

## Step 7: Deep Endpoint Analysis

**CRITICAL:** For EVERY endpoint discovered in Step 4, READ the actual route handler source code. Do NOT rely solely on HTTP method and path — you must understand what each endpoint actually does.

Classify each endpoint into one or more categories:

| Category | Detection Signals |
|----------|------------------|
| **File Upload** | `request.formData()`, `formData.get('file')`, `multer`, `File` type, `multipart/form-data` |
| **Async Trigger** | Unawaited `.then().catch()`, returns 202 status, spawns background job, fire-and-forget pattern |
| **Polling Target** | GET returning a `status` field that transitions (e.g., PENDING → PROCESSING → READY) |
| **Action Endpoint** | PUT/POST with an `action` field (approve/reject/lock/assign/cancel) |
| **Bulk Operation** | Accepts `ids: string[]` array parameter |
| **Nested/Complex Body** | Request body contains arrays of objects (e.g., `mappings[]`, `thresholds[]`, `items[]`) |
| **Auth Token** | Returns a JWT or session token needed by other endpoints (e.g., POST /api/auth/login) |
| **Dependency Producer** | Response includes an `id` or data consumed by another endpoint's request |
| **Utility/Read-Only** | GET-only, no state change, informational (e.g., /api/auth/me, /api/stats) |

For each endpoint, record a **profile card**:

```
Endpoint:     POST /api/datasets
Category:     File Upload, Dependency Producer
Input:        multipart/form-data { file: File(CSV), name: string, organizationId: string }
Output:       { dataset: { id, status: "PENDING_MAPPING" }, detected: { allColumns, suggestedPeriodColumns } }
Side effects: None (synchronous)
Dependencies: organizationId (from auth context)
Produces:     dataset.id (consumed by /api/datasets/:id/mapping, /api/runs)
```

Print the classification table:

```
=== Endpoint Analysis ===
POST   /api/datasets              File Upload, Dependency Producer
POST   /api/datasets/:id/mapping  Async Trigger, Nested/Complex Body
GET    /api/datasets/:id          Polling Target
POST   /api/runs                  Async Trigger, Dependency Producer
GET    /api/flux                  Utility/Read-Only
PUT    /api/flux                  Action Endpoint
POST   /api/flux                  Bulk Operation
...
```

---

## Step 8: Workflow Discovery

### 8a: Build Dependency Graph

Using the profile cards from Step 7, build a directed graph:

- **Nodes** = endpoints (or compound nodes for async trigger + polling target pairs)
- **Edges** = data dependencies (endpoint A produces `datasetId`, endpoint B requires `datasetId`)
- **Async pairs** = a trigger endpoint (POST that returns 202 or fires background job) + its polling endpoint (GET with transitioning `status`) form a **compound node**

Example graph:
```
POST /api/templates → POST /api/datasets (needs templateId via scenario)
POST /api/datasets → [POST /api/datasets/:id/mapping + GET /api/datasets/:id] (async compound)
                   → POST /api/scenarios (needs datasetId for periods)
POST /api/scenarios → POST /api/runs (needs scenarioId + datasetId + periodIds)
POST /api/runs → [GET /api/runs (poll)] (async compound)
             → GET /api/flux (needs runId)
GET /api/flux → PUT /api/flux (needs fluxId from results)
```

### 8b: Find Core Workflow

The **core workflow = the longest dependency chain** from data entry to final result.

Rules:
1. Start from endpoints with NO inbound dependencies (root nodes) — typically file uploads or entity creation
2. Follow the longest chain of data dependencies
3. **Prefer chains containing**: file uploads → async processing → action endpoints (these indicate the main product flow)
4. If multiple chains have equal length, prefer the one with more async segments (indicates the "heavy" workflow)

Print the discovered workflow:

```
=== Core Workflow ({N} steps) ===
1. POST /api/templates            → Create analysis template
2. POST /api/datasets             → Upload CSV file (multipart)
3. POST /api/datasets/:id/mapping → Map columns (triggers async import)
4. GET  /api/datasets/:id         → Poll until status=READY
5. POST /api/scenarios            → Create scenario (nested mappings + thresholds)
6. POST /api/runs                 → Start AI analysis run (async)
7. GET  /api/runs                 → Poll until status=COMPLETED
8. GET  /api/flux                 → Verify flux results + AI summaries
9. PUT  /api/flux                 → Approve flux item
```

### 8c: Find Branches

At each node in the core workflow, check for **alternative actions**:

- **Action alternatives**: If the core workflow uses `approve`, also test `reject`, `lock`, etc.
- **Bulk variants**: If a PUT endpoint has a POST bulk counterpart, generate a bulk test
- **Error paths**: If an endpoint can return FAILED status, test that polling handles it

Print branches:

```
=== Workflow Branches ===
Branch at step 9 (PUT /api/flux):
  - Core: approve
  - Alt:  reject
  - Alt:  lock
Branch at step 3 (POST /api/datasets/:id/mapping):
  - Core: skipValidation=true
  - Alt:  skipValidation=false (may return NEEDS_CONFIRMATION)
```

### 8d: Async Segments

For each async trigger + polling pair, determine:

| Field | Value |
|-------|-------|
| Trigger endpoint | POST /api/datasets/:id/mapping |
| Polling endpoint | GET /api/datasets/:id |
| Status field path | `.status` |
| Success value | `"READY"` |
| Failure value | `"FAILED"` |
| Timeout estimate | 30s (file import) |
| Poll interval | 2s |

Common timeout estimates:
- File import/parsing: 30s
- AI/ML processing: 120s
- External API calls: 60s
- Simple background job: 15s

---

## Step 9: Test Data Planning

### File Uploads

For each File Upload endpoint from Step 7:

1. Read the handler + parser to understand the expected file format
2. Look for: column expectations, delimiter, required headers, file type validation
3. **Generate minimal test data inline** as a string variable in the test:
   - CSV: 3-4 rows with headers matching what the parser expects
   - JSON: minimal valid structure
   - If binary file required (PDF, image) → ask user via `AskUserQuestion`:
     - Option A: "Provide a path to a sample file I can reference in the test"
     - Option B: "I'll generate a minimal binary file programmatically"
     - Option C: "Skip this upload test"

Example inline CSV:
```python
csv_data = "Account,Counterparty,2024-12,2025-01\nRevenue,ACME Corp,500000,600000\nCOGS,Vendor X,200000,250000"
```

### Complex Nested Bodies

For each Nested/Complex Body endpoint:

1. Read the handler to determine the exact structure
2. Map nested ID fields to prior workflow steps (e.g., `mappings[].promptTemplateId` comes from template creation)
3. Note which fields are required vs optional

Example:
```python
scenario_body = {
    "organizationId": org_id,
    "name": f"WF Scenario {suffix}",
    "mappings": [{"promptTemplateId": template_id, "targetType": "ALL", "priority": 0}],
    "thresholds": [{"targetType": "ALL", "thresholdType": "ABSOLUTE", "absoluteValue": 1, "operator": "OR"}]
}
```

### Polling Config

For each async segment from Step 8d, define:
```python
# Example polling config
poll_url = f"/api/datasets/{dataset_id}"
status_field = "status"
success_value = "READY"
failure_value = "FAILED"
timeout_sec = 30
interval_sec = 2
```

### Auth Context

Determine authentication method by reading login/auth endpoints:

1. **Cookie-based** (most SPAs): Login via browser form, cookies auto-sent with `fetch()` — no extra work needed
2. **Bearer token**: Login response returns a JWT → extract it, pass as `Authorization: Bearer {token}` header
3. **API key**: Passed via header or query param → read from env var

If Bearer token is needed, add this after the browser login:
```python
# After browser login, also do API login to get token
auth_res = api_call(page, path="/api/auth/login", method="POST",
    body={"email": test_email, "password": test_password})
token = (auth_res.get("json") or {}).get("token", "")
```

### Ask User When Needed

Use `AskUserQuestion` ONLY when:
- Binary files required that can't be generated programmatically
- File format is ambiguous from the code
- External service configuration needed (API keys, webhooks)
- Test data requires domain-specific knowledge you can't infer from the code

---

## Step 10: Uncovered Endpoint Audit

After mapping CRUD endpoints (Step 6) and workflow endpoints (Step 8), audit ALL discovered endpoints for coverage.

### Audit Algorithm

1. Create a set of ALL endpoints from Step 4
2. Mark endpoints covered by:
   - CRUD tests (Step 6)
   - Core workflow (Step 8b)
   - Workflow branches (Step 8c)
3. For UNCOVERED endpoints, classify and act:

| Category | Action |
|----------|--------|
| **Utility/Read-Only GET** | Add to "hit every endpoint" list → call + assert `status < 500` |
| **Admin-only endpoints** | Test if current user has admin privileges; if yes include, if no mark as `# SKIPPED: requires admin role` |
| **Endpoints needing special setup** | Document gap with `# SKIPPED: requires {what}` + env var suggestion |
| **Debug/internal endpoints** | Skip with comment: `# SKIPPED: internal/debug endpoint` |
| **Webhook/callback endpoints** | Skip with comment: `# SKIPPED: webhook callback — requires external trigger` |

### Print Coverage Audit

```
=== Endpoint Coverage Audit ===
CRUD tests:     12 endpoints covered (groups, programs, scenarios, templates)
Core workflow:   9 endpoints covered (upload → map → poll → scenario → run → poll → flux → approve)
Branches:        2 endpoints covered (reject flux, lock flux)
Utility hits:    3 endpoints covered (auth/me, datasets/:id/categories, stats)
---
Total:          26/28 endpoints = 93% coverage
Skipped:         2 (webhook callback, admin-only report generation)
```

---

## Step 11: Workflow Test Generation Rules

This step defines the code patterns used in Step 12d when generating `run_use_test.py`.

### New Helper Functions

Add these helpers to the generated `run_use_test.py`, after the existing `api_call` function.

**Updated `api_call()`** — now accepts an optional `token` parameter:

```python
def api_call(page, *, path: str, method: str = "GET", body: dict | None = None, token: str = "") -> dict:
    return page.evaluate(
        """async ({path, method, body, token}) => {
          const h = { 'Content-Type': 'application/json' };
          if (token) h['Authorization'] = 'Bearer ' + token;
          const init = {
            method,
            headers: h,
            body: body ? JSON.stringify(body) : undefined,
          };
          const r = await fetch(path, init);
          const t = await r.text();
          let j = null;
          try { j = t ? JSON.parse(t) : null; } catch { j = null; }
          return { ok: r.ok, status: r.status, json: j, text: t };
        }""",
        {"path": path, "method": method, "body": body, "token": token},
    )
```

**`api_upload()`** — multipart file upload via browser FormData:

```python
def api_upload(page, *, path: str, fields: dict, file_field: str = "file",
               file_name: str = "upload.csv", file_content: str = "",
               file_type: str = "text/csv", token: str = "") -> dict:
    """Upload a file via multipart/form-data using the browser's fetch API."""
    return page.evaluate(
        """async ({path, fields, fileField, fileName, fileContent, fileType, token}) => {
          const blob = new Blob([fileContent], {type: fileType});
          const file = new File([blob], fileName, {type: fileType});
          const fd = new FormData();
          fd.append(fileField, file);
          for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
          const h = {};
          if (token) h['Authorization'] = 'Bearer ' + token;
          const r = await fetch(path, {method: 'POST', headers: h, body: fd});
          const t = await r.text();
          let j = null; try { j = JSON.parse(t); } catch {}
          return {ok: r.ok, status: r.status, json: j};
        }""",
        {"path": path, "fields": fields, "fileField": file_field,
         "fileName": file_name, "fileContent": file_content,
         "fileType": file_type, "token": token},
    )
```

**`poll_until()`** — poll GET endpoint until status reaches target:

```python
def poll_until(page, *, path: str, status_field: str = "status",
               target: str, fail_value: str = "FAILED",
               timeout_sec: int = 30, interval_sec: int = 2,
               token: str = "") -> dict:
    """Poll a GET endpoint until status_field reaches target or timeout."""
    import time as _time
    deadline = _time.time() + timeout_sec
    last_status = "UNKNOWN"
    last_data = {}
    while _time.time() < deadline:
        res = api_call(page, path=path, token=token)
        data = res.get("json") or {}
        last_status = data.get(status_field, "UNKNOWN")
        last_data = data
        if last_status == target:
            return {"ok": True, "status": last_status, "data": data}
        if last_status == fail_value:
            return {"ok": False, "status": last_status, "data": data}
        _time.sleep(interval_sec)
    return {"ok": False, "status": f"TIMEOUT (last: {last_status})", "data": last_data}
```

### Updated run_use_test.py Structure

The generated `run_use_test.py` MUST follow this structure:

```
1. Imports + helpers (api_call with token support, api_upload, poll_until)
2. Login via browser form + optional API auth token extraction
3. if mutating:
   a. Entity CRUD tests (from Step 6 — unchanged)
   b. CRUD Cleanup (reverse creation order — unchanged)
   c. === Core Workflow Test === (NEW — from Step 8b)
   d. === Workflow Branch Tests === (NEW — from Step 8c)
   e. === Utility Endpoint Hits === (NEW — from Step 10)
   f. Workflow Cleanup (reverse dependency order)
4. Navigation + UI interaction tests (unchanged)
5. Write result JSON
```

### Core Workflow Test Code Pattern

Generate the core workflow test based on the chain discovered in Step 8b:

```python
            # === Core Workflow Test ===
            # Discovered {N}-step workflow: {step1} → {step2} → ... → {stepN}
            wf_created = {}
            try:
                # --- WF Step 1: {description} ---
                {test code using api_call, api_upload, or poll_until as appropriate}
                wf_created["{id_key}"] = {extracted_id}
                log("WF: {description}", ok, f"...")

                if wf_created.get("{id_key}"):
                    # --- WF Step 2: {description} ---
                    # Each subsequent step nested inside if-check on prior step's output
                    {next step code}
            except Exception as exc:
                log("Core Workflow", False, str(exc))
```

Rules:
- Each workflow step is nested inside `if` checks on prior step's output
- Test data (CSV strings, nested objects) is defined as variables at the **top** of the workflow block
- All created IDs stored in `wf_created` dict (separate from `created` dict used by CRUD)
- File uploads use `api_upload()` helper
- Async segments use `poll_until()` helper
- The **final step VERIFIES the result** (GET the output and assert expected values are present)

### Branch Test Code Pattern

Generate branch tests for each alternative action discovered in Step 8c:

```python
            # === Workflow Branch Tests ===
            # Branch: {action} instead of {core_action} at step {N}
            try:
                # Reuse entity from core workflow if still available, or create fresh
                {branch_test_code}
                log("WF Branch: {action} {entity}", ok, f"...")
            except Exception as exc:
                log("WF Branch: {action}", False, str(exc))
```

Rules:
- Test alternative actions (reject instead of approve, lock instead of unlock)
- Test bulk operations if available (POST with `ids[]` array)
- Reuse entities from core workflow where possible, but create fresh if needed
- Each branch is a separate try/except block

### Utility Endpoint Hit Pattern

Generate utility hits for all uncovered endpoints from Step 10:

```python
            # === Utility Endpoint Hits ===
            # Hit every remaining endpoint to verify it responds (no 5xx)
            utility_endpoints = [
                ("GET", "/api/auth/me"),
                ("GET", "/api/stats"),
                ("GET", "/api/categories"),
                # ... all uncovered utility endpoints
            ]
            for method, ep_path in utility_endpoints:
                try:
                    r = api_call(page, path=ep_path, method=method, token=token)
                    ok = r.get("status", 500) < 500
                    log(f"Utility: {method} {ep_path}", ok, f"status={r.get('status')}")
                except Exception as exc:
                    log(f"Utility: {method} {ep_path}", False, str(exc))
```

For parameterized utility endpoints (e.g., `/api/datasets/:id/categories`), substitute a real ID from the workflow or CRUD test:
```python
                # Use an ID from workflow or CRUD tests
                if wf_created.get("dataset_id"):
                    r = api_call(page, path=f"/api/datasets/{wf_created['dataset_id']}/categories", token=token)
                    log("Utility: GET /api/datasets/:id/categories", r.get("status", 500) < 500, f"status={r.get('status')}")
```

### Workflow Cleanup Pattern

```python
            # === Workflow Cleanup (reverse dependency order) ===
            try:
                # Delete the root entity — cascade deletes handle children
                # Add time.sleep(1) before delete for async operations to settle
                for key, del_path in reversed([
                    ("{root_entity}_id", "/api/{root_entities}"),
                    # Only list entities that need explicit deletion
                    # Cascade-aware: if deleting parent removes children, only delete parent
                ]):
                    eid = wf_created.get(key)
                    if eid:
                        time.sleep(1)
                        r = api_call(page, path=f"{del_path}/{eid}", method="DELETE", token=token)
                        ok = bool(r.get("ok")) or r.get("status") == 404
                        if not ok:
                            log(f"WF Cleanup: {key}", False,
                                f"status={r.get('status')} (non-critical — test data is timestamped)")
                        else:
                            log(f"WF Cleanup: {key}", True, f"status={r.get('status')}")
            except Exception as exc:
                log("WF Cleanup", False, str(exc))
```

Rules:
- Delete in reverse dependency order
- Use cascade-aware deletion when available (delete parent cascades to children, so don't delete children separately)
- Mark delete failures as **non-critical** with descriptive message
- Add `time.sleep(1)` between deletes for async cleanup to settle

---

## Step 12: Generate Files

Create the `{PROJECT_ROOT}/runtest/` directory and generate all files.

### 12a: Verbatim Files

Write these files exactly as shown in the **Embedded Templates** section below:
- `runtest/common.py`
- `runtest/run_smoke_test.py`
- `runtest/run_volume_test.py`
- `runtest/requirements.txt`
- `runtest/.gitignore`
- `runtest/.env.example`

### 12b: Generated `.env`

Write `runtest/.env` with the user's provided values:
```
BASE_URL={user's URL}
TEST_EMAIL={user's email}
TEST_PASSWORD={user's password}
LOGIN_PATH=/login
EMAIL_SELECTOR=input[type='email']
PASSWORD_SELECTOR=input[type='password']
SUBMIT_SELECTOR=button[type='submit']
HEADLESS=false
SLOW_MO_MS=60
MUTATING_TESTS=false
```

Adjust `LOGIN_PATH` and selectors if the user specified custom values.

### 12c: Generated `paths.txt`

Write `runtest/paths.txt` with all discovered static routes (one per line):
```
# Auto-generated routes for {project-name}
# Generated by /opWebappTestFactory
/
/dashboard
/workstreams
/dashboards
/settings
/admin
```

Do NOT include parameterized routes (`:id`) in paths.txt — those are for the Use test.

### 12d: Generated `run_use_test.py`

This is the core deliverable. Generate it following the **Use Test Generation Rules** below.

---

## Use Test Generation Rules

Generate `run_use_test.py` dynamically based on the CRUD map (Step 6), workflow chain (Step 8), and endpoint audit (Step 10). Use the helper functions and code patterns defined in Step 11.

### Structure

The generated file MUST follow this exact structure:

```python
"""
Use Test (auto-generated): CRUD + Workflow coverage for {project-name}
Entities tested: {entity1}, {entity2}, ...
Core workflow: {workflow_description}
Generated by /opWebappTestFactory

Guidelines:
- Tests create artifacts, verify them, then clean up (production-safe).
- MUTATING_TESTS=true required for CRUD and workflow operations.
- Runs in authenticated browser context (cookies + optional Bearer token).
"""

from __future__ import annotations

import os
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from common import Step, load_dotenv, mk_run_dir, now_utc, require_env, shot, write_result

HERE = Path(__file__).resolve().parent
RUN_ROOT = HERE / "runs"


def read_paths() -> list[str]:
    p = HERE / "paths.txt"
    if not p.exists():
        return ["/dashboard", "/settings"]
    out: list[str] = []
    for raw in p.read_text(encoding="utf-8").splitlines():
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        if not s.startswith("/"):
            s = "/" + s
        out.append(s)
    return out


def prioritize_use_paths(paths: list[str], limit: int = 8) -> list[str]:
    # CUSTOMIZE: keys tuned to discovered entity names
    keys = ({tuple of discovered entity names + "dashboard", "setting"})
    def score(p: str) -> int:
        s = 0
        lp = p.lower()
        for i, k in enumerate(keys):
            if k in lp:
                s += 100 - i * 5
        s -= p.count("/") * 2
        return s
    uniq = list(dict.fromkeys(paths))
    return sorted(uniq, key=lambda p: (-score(p), p))[:limit]


def api_call(page, *, path: str, method: str = "GET", body: dict | None = None, token: str = "") -> dict:
    return page.evaluate(
        """async ({path, method, body, token}) => {
          const h = { 'Content-Type': 'application/json' };
          if (token) h['Authorization'] = 'Bearer ' + token;
          const init = {
            method,
            headers: h,
            body: body ? JSON.stringify(body) : undefined,
          };
          const r = await fetch(path, init);
          const t = await r.text();
          let j = null;
          try { j = t ? JSON.parse(t) : null; } catch { j = null; }
          return { ok: r.ok, status: r.status, json: j, text: t };
        }""",
        {"path": path, "method": method, "body": body, "token": token},
    )


def api_upload(page, *, path: str, fields: dict, file_field: str = "file",
               file_name: str = "upload.csv", file_content: str = "",
               file_type: str = "text/csv", token: str = "") -> dict:
    """Upload a file via multipart/form-data using the browser's fetch API."""
    return page.evaluate(
        """async ({path, fields, fileField, fileName, fileContent, fileType, token}) => {
          const blob = new Blob([fileContent], {type: fileType});
          const file = new File([blob], fileName, {type: fileType});
          const fd = new FormData();
          fd.append(fileField, file);
          for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
          const h = {};
          if (token) h['Authorization'] = 'Bearer ' + token;
          const r = await fetch(path, {method: 'POST', headers: h, body: fd});
          const t = await r.text();
          let j = null; try { j = JSON.parse(t); } catch {}
          return {ok: r.ok, status: r.status, json: j};
        }""",
        {"path": path, "fields": fields, "fileField": file_field,
         "fileName": file_name, "fileContent": file_content,
         "fileType": file_type, "token": token},
    )


def poll_until(page, *, path: str, status_field: str = "status",
               target: str, fail_value: str = "FAILED",
               timeout_sec: int = 30, interval_sec: int = 2,
               token: str = "") -> dict:
    """Poll a GET endpoint until status_field reaches target or timeout."""
    import time as _time
    deadline = _time.time() + timeout_sec
    last_status = "UNKNOWN"
    last_data = {}
    while _time.time() < deadline:
        res = api_call(page, path=path, token=token)
        data = res.get("json") or {}
        last_status = data.get(status_field, "UNKNOWN")
        last_data = data
        if last_status == target:
            return {"ok": True, "status": last_status, "data": data}
        if last_status == fail_value:
            return {"ok": False, "status": last_status, "data": data}
        _time.sleep(interval_sec)
    return {"ok": False, "status": f"TIMEOUT (last: {last_status})", "data": last_data}


def main() -> None:
    load_dotenv(HERE / ".env")

    base_url = require_env("BASE_URL").rstrip("/")
    test_email = require_env("TEST_EMAIL")
    test_password = require_env("TEST_PASSWORD")

    login_path = os.getenv("LOGIN_PATH", "/login")
    email_sel = os.getenv("EMAIL_SELECTOR", "input[type='email']")
    pass_sel = os.getenv("PASSWORD_SELECTOR", "input[type='password']")
    submit_sel = os.getenv("SUBMIT_SELECTOR", "button[type='submit']")

    slow_mo = int(os.getenv("SLOW_MO_MS", "60"))
    headless = os.getenv("HEADLESS", "false").lower() in ("1", "true", "yes")
    mutating = os.getenv("MUTATING_TESTS", "false").lower() in ("1", "true", "yes")

    run_dir, shots_dir = mk_run_dir(RUN_ROOT, "use_test")
    downloads_dir = run_dir / "downloads"
    downloads_dir.mkdir(parents=True, exist_ok=True)
    steps: list[Step] = []
    downloads: list[str] = []

    def log(name: str, ok: bool, note: str = "") -> None:
        steps.append(Step(name=name, passed=ok, note=note, screenshot=shot(page, shots_dir, name), at=now_utc()))
        print(("[PASS]" if ok else "[FAIL]"), name, "-", note)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless, slow_mo=slow_mo)
        context = browser.new_context(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
        page = context.new_page()

        # --- Login ---
        page.goto(f"{base_url}{login_path}", wait_until="domcontentloaded", timeout=60000)
        page.locator(email_sel).first.fill(test_email)
        page.locator(pass_sel).first.fill(test_password)
        page.locator(submit_sel).first.click(force=True)
        page.wait_for_timeout(1200)
        logged_in = page.url.startswith(base_url) and ("/login" not in page.url)
        log("Login", logged_in, page.url)
        if not logged_in:
            write_result(run_dir / "result.json", base_url=base_url, test_email=test_email, steps=steps, artifacts={})
            context.close()
            browser.close()
            return

        # --- Auth token (if Bearer auth needed — from Step 9 Auth Context) ---
        token = ""
        # CUSTOMIZE: If app uses Bearer token auth, uncomment and adapt:
        # auth_res = api_call(page, path="/api/auth/login", method="POST",
        #     body={"email": test_email, "password": test_password})
        # token = (auth_res.get("json") or {}).get("token", "")

        # --- CRUD Tests (guarded by MUTATING_TESTS) ---
        created = {}
        if mutating:
            suffix = str(int(time.time()))

            # === PER-ENTITY CRUD BLOCKS GO HERE ===
            # (see Per-Entity CRUD Block Pattern below)

            # === Cleanup (reverse creation order) ===
            # (see Cleanup Block Pattern below)

            # === Core Workflow Test ===
            # (see Core Workflow Test Code Pattern — from Step 8b discovery)
            # Uses api_upload() for file uploads, poll_until() for async segments

            # === Workflow Branch Tests ===
            # (see Branch Test Code Pattern — from Step 8c discovery)

            # === Utility Endpoint Hits ===
            # (see Utility Endpoint Hit Pattern — from Step 10 audit)

            # === Workflow Cleanup (reverse dependency order) ===
            # (see Workflow Cleanup Pattern)

        # --- Navigation + UI interaction tests ---
        use_paths = prioritize_use_paths(read_paths(), limit=8)
        for path in use_paths:
            try:
                page.goto(f"{base_url}{path}", wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(600)
                log(f"Open {path}", True, page.url)
            except Exception as exc:
                log(f"Open {path}", False, str(exc))
                continue

            btn = page.locator(
                "button:has-text('Export'), button:has-text('Download'), a:has-text('Export'), a:has-text('Download')"
            ).first
            if btn.count() > 0:
                try:
                    with page.expect_download(timeout=30000) as dl_info:
                        btn.click(force=True)
                    dl = dl_info.value
                    out = downloads_dir / f"{path.strip('/').replace('/', '_') or 'root'}_{int(time.time())}"
                    dl.save_as(str(out))
                    downloads.append(str(out))
                    log(f"Download on {path}", True, str(out))
                except Exception as exc:
                    log(f"Download on {path}", False, str(exc))

        context.close()
        browser.close()

    write_result(run_dir / "result.json", base_url=base_url, test_email=test_email, steps=steps, artifacts={"downloads": downloads})
    print(f"Result file: {run_dir / 'result.json'}")


if __name__ == "__main__":
    main()
```

### Per-Entity CRUD Block Pattern

For EACH entity in the CRUD map that has at least create + list/read, generate a block like this:

```python
            # === Entity: {EntityName} ===
            try:
                # CREATE
                {entity_var}_body = {"{field1}": f"TEST {Entity} {suffix}", "{field2}": "..."}
                res = api_call(page, path="{create_endpoint}", method="POST", body={entity_var}_body)
                {entity_var}_id = {response_extraction_code}
                ok = bool(res.get("ok")) and bool({entity_var}_id)
                created["{entity_var}_id"] = {entity_var}_id if ok else None
                log("Create {entity} (api)", ok, f"status={res.get('status')} id={{entity_var}_id}")

                if {entity_var}_id:
                    # LIST (verify it appears)
                    lst = api_call(page, path="{list_endpoint}")
                    items = {list_extraction_code}
                    found = any({match_condition} for item in items)
                    log("{Entity} in list (api)", found, f"count={len(items)}")

                    # READ by ID
                    get = api_call(page, path=f"{read_endpoint_template}")
                    log("Get {entity} by id (api)", bool(get.get("ok")), f"status={get.get('status')}")

                    # UPDATE (only if endpoint exists)
                    upd = api_call(page, path=f"{update_endpoint_template}", method="{PUT_or_PATCH}",
                        body={{"{field1}": f"UPDATED {Entity} {suffix}"}})
                    log("Update {entity} (api)", bool(upd.get("ok")), f"status={upd.get('status')}")
            except Exception as exc:
                log("{Entity} CRUD (api)", False, str(exc))
```

**Variable substitution rules:**
- `{entity_var}` — lowercase entity name (e.g., `workstream`)
- `{Entity}` — capitalized entity name (e.g., `Workstream`)
- `{create_endpoint}` — the POST endpoint path from CRUD map (e.g., `/api/workstreams`)
- `{list_endpoint}` — the GET list endpoint
- `{read_endpoint_template}` — the GET-by-ID endpoint with f-string (e.g., `/api/workstreams/{workstream_id}`)
- `{update_endpoint_template}` — the PUT/PATCH endpoint with f-string
- `{response_extraction_code}` — based on reading the route handler. Common patterns:
  - `(res.get("json") or {}).get("{entity}", {}).get("id")` for `{"entity": {"id": ...}}`
  - `(res.get("json") or {}).get("id")` for `{"id": ...}`
  - `(res.get("json") or {}).get("data", {}).get("id")` for `{"data": {"id": ...}}`
- `{list_extraction_code}` — based on response shape:
  - `(lst.get("json") or {}).get("{entities}", [])` for `{"entities": [...]}`
  - `(lst.get("json") or [])` for bare arrays
- `{match_condition}` — how to verify the created entity is in the list:
  - `item.get("{nameField}") == f"TEST {Entity} {suffix}"` for name-based matching
  - `item.get("id") == {entity_var}_id` for ID-based matching
- `{field1}, {field2}` — required fields from schema analysis. Use realistic test values.

### Cleanup Block Pattern

Generate cleanup in **reverse** creation order (respect foreign keys):

```python
            # --- Cleanup (reverse creation order) ---
            try:
                # Delete {last_entity} first (may depend on earlier entities)
                if created.get("{entity_var}_id"):
                    r = api_call(page, path=f"{delete_endpoint}/{created['{entity_var}_id']}", method="DELETE")
                    log("Delete {entity} (api)", bool(r.get("ok")) or r.get("status") == 404, f"status={r.get('status')}")
                # ... repeat for each entity in reverse order
            except Exception as exc:
                log("Cleanup (api)", False, str(exc))
```

### Entity Creation Order

If entity B depends on entity A (foreign key), create A first, B second. Delete B first, A second.

Example: If `dashboard` has `workstreamId` FK → create workstream first, dashboard second. Delete dashboard first, workstream second.

### If No CRUD Endpoints Found

If no entities qualify for CRUD testing, the Use test should ONLY contain:
- Login
- Navigation tests (the `use_paths` loop)
- Export/download button tests
- Add a comment: `# No CRUD-capable API endpoints discovered — navigation + UI interaction tests only`

---

## Step 13: Summary Report

After generating all files, print:

```
=== Webapp Test Factory Results ===
Project:    {project-name}
Framework:  {frontend} + {backend} + {orm}
Routes:     {N} static, {M} parameterized
Endpoints:  {N} API endpoints
Entities:   {N} with CRUD coverage ({entity1}, {entity2}, ...)
Workflow:   {W}-step core workflow discovered ({step1} → {step2} → ... → {stepW})
Branches:   {B} alternative paths tested
Coverage:   {X}/{Y} endpoints = {Z}%
Skipped:    {S} endpoints (documented in test comments)
Files:      9 files generated in {project}/runtest/

=== How to Run ===
cd {project}
python -m venv .venv
.venv/Scripts/pip install -r runtest/requirements.txt    # Windows
# .venv/bin/pip install -r runtest/requirements.txt      # macOS/Linux
.venv/Scripts/playwright install chromium

# Smoke test (visit all routes):
.venv/Scripts/python runtest/run_smoke_test.py

# Use test (CRUD + navigation):
MUTATING_TESTS=true .venv/Scripts/python runtest/run_use_test.py

# Volume test (repeat N times):
.venv/Scripts/python runtest/run_volume_test.py --iterations 50 --delay-seconds 30
```

---

## Edge Cases

### No API endpoints found
Generate navigation-only Use test. The test visits pages, clicks Export/Download buttons, and takes screenshots. No CRUD section, no workflow section.

### No workflow discovered
If the dependency graph from Step 8 has no chains longer than 2 steps (i.e., the app is purely CRUD with no async processing, file uploads, or action endpoints), skip the workflow test section. Add a comment in the generated test: `# No multi-step workflow discovered — CRUD + utility tests only`. Still generate utility endpoint hits for 100% coverage.

### No entities/models found
Infer entity names from API paths: `/api/invoices` → entity "invoice". Use minimal fields (`{"name": f"TEST Invoice {suffix}"}`) and mark the body with a comment: `# Fields inferred from API path — may need adjustment`.

### Framework not recognized
Use fallback grep patterns for routes and endpoints. Warn the user: "Framework not recognized — using universal discovery. Tests may need manual review."

### Non-standard login (OAuth / SSO / Magic Link)
Detect by checking:
```
Grep: passport|auth0|@auth0|oauth|saml|sso|magic.*link|passwordless in *.ts, *.js, *.py, *.rb
```
If found, ask the user via `AskUserQuestion`:
- Option A: "Provide a session cookie value (I'll inject it into the browser context)"
- Option B: "Provide custom login selectors for your auth page"
- Option C: "Skip auth-dependent tests (smoke public routes only)"

If session cookie: modify the generated scripts to use `context.add_cookies([...])` instead of the login flow.

### Monorepo (multiple apps)
If multiple `package.json` files exist in subdirectories, ask the user which app to target.

### No routes found at all
Print an error and stop:
```
ERROR: No routes or API endpoints discovered. This may happen if:
- The project uses an unsupported framework
- Source code is in an unexpected location
- The project is a library, not a web app

Please check the project path and try again.
```

---

## Embedded Templates

### `common.py` (write verbatim)

```python
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path

from playwright.sync_api import Page


def load_dotenv(dotenv_path: Path) -> None:
    """
    Minimal .env loader (no external deps).
    - KEY=VALUE
    - ignores blank lines and lines starting with '#'
    - does not override already-set environment variables
    """
    if not dotenv_path.exists():
        return
    for raw in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip("\"").strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def now_utc() -> str:
    return datetime.utcnow().isoformat() + "Z"


def mk_run_dir(run_root: Path, run_prefix: str) -> tuple[Path, Path]:
    run_id = f"{run_prefix}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
    run_dir = run_root / run_id
    shots_dir = run_dir / "screenshots"
    shots_dir.mkdir(parents=True, exist_ok=True)
    return run_dir, shots_dir


def safe_filename(label: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in label)
    return safe[:120] if safe else "step"


def shot(page: Page, folder: Path, label: str) -> str:
    out = folder / f"{safe_filename(label)}_{int(time.time() * 1000)}.png"
    page.screenshot(path=str(out), full_page=True)
    return str(out)


@dataclass
class Step:
    name: str
    passed: bool
    note: str
    screenshot: str
    at: str


def write_result(
    out_path: Path,
    *,
    base_url: str,
    test_email: str,
    steps: list[Step],
    artifacts: dict,
) -> None:
    summary = {
        "run_at_utc": now_utc(),
        "base_url": base_url,
        "email": test_email,
        "summary": {
            "total": len(steps),
            "passed": sum(1 for s in steps if s.passed),
            "failed": sum(1 for s in steps if not s.passed),
        },
        "artifacts": artifacts,
        "steps": [asdict(s) for s in steps],
    }
    out_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")


def require_env(key: str) -> str:
    v = os.getenv(key, "").strip()
    if not v:
        raise SystemExit(f"Missing required env var: {key}")
    return v
```

### `run_smoke_test.py` (write verbatim)

```python
"""
Smoke Test (repeatable): log in, then visit a list of routes and assert the app renders.

Customize:
- runtest/.env (ignored) for BASE_URL/TEST_EMAIL/TEST_PASSWORD and login selectors
- runtest/paths.txt for the routes to cover
"""

from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import sync_playwright

from common import Step, load_dotenv, mk_run_dir, now_utc, require_env, shot, write_result


HERE = Path(__file__).resolve().parent
RUN_ROOT = HERE / "runs"


def read_paths() -> list[str]:
    p = HERE / "paths.txt"
    out: list[str] = []
    for raw in p.read_text(encoding="utf-8").splitlines():
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        if not s.startswith("/"):
            s = "/" + s
        out.append(s)
    return out


def main() -> None:
    load_dotenv(HERE / ".env")

    base_url = require_env("BASE_URL").rstrip("/")
    test_email = require_env("TEST_EMAIL")
    test_password = require_env("TEST_PASSWORD")

    login_path = os.getenv("LOGIN_PATH", "/login")
    email_sel = os.getenv("EMAIL_SELECTOR", "input[type='email']")
    pass_sel = os.getenv("PASSWORD_SELECTOR", "input[type='password']")
    submit_sel = os.getenv("SUBMIT_SELECTOR", "button[type='submit']")

    slow_mo = int(os.getenv("SLOW_MO_MS", "60"))
    headless = os.getenv("HEADLESS", "false").lower() in ("1", "true", "yes")

    run_dir, shots_dir = mk_run_dir(RUN_ROOT, "smoke_test")
    steps: list[Step] = []

    def log(name: str, ok: bool, note: str = "") -> None:
        steps.append(Step(name=name, passed=ok, note=note, screenshot=shot(page, shots_dir, name), at=now_utc()))
        print(("[PASS]" if ok else "[FAIL]"), name, "-", note)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless, slow_mo=slow_mo)
        context = browser.new_context(viewport={"width": 1600, "height": 1000})
        page = context.new_page()

        # Login
        page.goto(f"{base_url}{login_path}", wait_until="domcontentloaded", timeout=60000)
        page.locator(email_sel).first.fill(test_email)
        page.locator(pass_sel).first.fill(test_password)
        page.locator(submit_sel).first.click(force=True)

        # Give SPA routers time to settle.
        page.wait_for_timeout(1200)
        logged_in = page.url.startswith(base_url) and ("/login" not in page.url)
        log("Login", logged_in, page.url)
        if not logged_in:
            write_result(run_dir / "result.json", base_url=base_url, test_email=test_email, steps=steps, artifacts={})
            context.close()
            browser.close()
            return

        # Visit routes
        for path in read_paths():
            try:
                resp = page.goto(f"{base_url}{path}", wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(600)

                status = resp.status if resp else None
                not_found = page.locator("text=/this page could not be found\\.|\\b404\\b|\\bnot found\\b/i").first
                forbidden = page.locator("text=/forbidden|access denied|not authorized|unauthorized/i").first

                is_nf = False
                is_forbidden = False
                try:
                    is_nf = not_found.count() > 0 and not_found.is_visible()
                except Exception:
                    is_nf = False
                try:
                    is_forbidden = forbidden.count() > 0 and forbidden.is_visible()
                except Exception:
                    is_forbidden = False

                ok_status = status is None or (200 <= status < 400) or status == 403
                ok = ok_status and (not is_nf)
                if is_forbidden:
                    ok = True

                note = page.url
                if status is not None:
                    note += f" status={status}"
                if is_forbidden:
                    note += " (restricted)"
                log(f"Visit {path}", ok, note)
            except Exception as exc:
                log(f"Visit {path}", False, str(exc))

        context.close()
        browser.close()

    write_result(run_dir / "result.json", base_url=base_url, test_email=test_email, steps=steps, artifacts={})
    print(f"Result file: {run_dir / 'result.json'}")


if __name__ == "__main__":
    main()
```

### `run_volume_test.py` (write verbatim)

```python
"""
Volume Test runner: repeatedly execute Smoke Test + Use Test on a cadence.

Design goals:
- Works with the bundled run_smoke_test.py + run_use_test.py (no app-specific logic here)
- Writes a JSONL index so failures are traceable
- Stops on first failure by default

Usage:
  python runtest/run_volume_test.py --iterations 500 --delay-seconds 60
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from common import load_dotenv, require_env


HERE = Path(__file__).resolve().parent
RUNS_ROOT = HERE / "runs"


def now_utc() -> str:
    return datetime.utcnow().isoformat() + "Z"


@dataclass
class TestRun:
    name: str
    ok: bool
    result_json: str
    run_id: str
    duration_sec: float


def newest_result(prefix: str) -> Path | None:
    if not RUNS_ROOT.exists():
        return None
    candidates = sorted(
        [p for p in RUNS_ROOT.glob(f"{prefix}_*/result.json") if p.is_file()],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return candidates[0] if candidates else None


def parse_ok(result_path: Path) -> tuple[bool, str]:
    try:
        j = json.loads(result_path.read_text(encoding="utf-8"))
        summ = j.get("summary") or {}
        failed = int(summ.get("failed", 0))
        passed = int(summ.get("passed", 0))
        total = int(summ.get("total", passed + failed))
        ok = failed == 0 and total > 0
        return ok, f"{passed}/{total}"
    except Exception as exc:
        return False, f"parse_failed: {exc}"


def run_script(script: Path, *, prefix: str, env: dict[str, str]) -> TestRun:
    start = time.time()
    proc = subprocess.run([sys.executable, str(script)], cwd=str(HERE.parent), env=env, text=True)
    dur = time.time() - start

    result = newest_result(prefix)
    if not result:
        return TestRun(script.name, False, "", "", dur)

    ok, _ = parse_ok(result)
    return TestRun(script.name, ok and proc.returncode == 0, str(result), result.parent.name, dur)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--iterations", type=int, default=60)
    ap.add_argument("--delay-seconds", type=int, default=60)
    ap.add_argument("--headed", action="store_true", help="Run with a visible browser (sets HEADLESS=false)")
    ap.add_argument("--continue-on-fail", action="store_true", help="Keep going after failures (not recommended)")
    args = ap.parse_args()

    load_dotenv(HERE / ".env")
    base_url = require_env("BASE_URL")
    _ = require_env("TEST_EMAIL")
    _ = require_env("TEST_PASSWORD")

    # Force headless by default for long unattended runs.
    if args.headed:
        os.environ["HEADLESS"] = "false"
    else:
        os.environ.setdefault("HEADLESS", "true")

    # Ensure slow-mo doesn't slow down unattended runs unless explicitly set.
    os.environ.setdefault("SLOW_MO_MS", "0")

    volume_id = "volume_" + datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    out_dir = RUNS_ROOT / volume_id
    out_dir.mkdir(parents=True, exist_ok=True)
    index_path = out_dir / "index.jsonl"

    env = os.environ.copy()

    smoke = HERE / "run_smoke_test.py"
    use = HERE / "run_use_test.py"
    if not smoke.exists() or not use.exists():
        raise SystemExit("Missing run_smoke_test.py or run_use_test.py next to this script.")

    print(f"[volume] base_url={base_url}")
    print(f"[volume] iterations={args.iterations} delay_seconds={args.delay_seconds} headless={env.get('HEADLESS')}")
    print(f"[volume] index={index_path}")

    for n in range(1, args.iterations + 1):
        cycle_start = now_utc()
        print(f"\n[cycle {n}/{args.iterations}] start={cycle_start}")

        smoke_run = run_script(smoke, prefix="smoke_test", env=env)
        smoke_ok, smoke_ratio = (False, "n/a")
        if smoke_run.result_json:
            smoke_ok, smoke_ratio = parse_ok(Path(smoke_run.result_json))
        print(f"[cycle {n}] smoke ok={smoke_run.ok} ratio={smoke_ratio} run={smoke_run.run_id} dur={smoke_run.duration_sec:.1f}s")

        use_run = run_script(use, prefix="use_test", env=env)
        use_ok, use_ratio = (False, "n/a")
        if use_run.result_json:
            use_ok, use_ratio = parse_ok(Path(use_run.result_json))
        print(f"[cycle {n}] use   ok={use_run.ok} ratio={use_ratio} run={use_run.run_id} dur={use_run.duration_sec:.1f}s")

        record = {
            "cycle": n,
            "at_utc": cycle_start,
            "smoke": {
                "ok": smoke_run.ok,
                "ratio": smoke_ratio,
                "result_json": smoke_run.result_json,
                "run_id": smoke_run.run_id,
                "duration_sec": round(smoke_run.duration_sec, 2),
            },
            "use": {
                "ok": use_run.ok,
                "ratio": use_ratio,
                "result_json": use_run.result_json,
                "run_id": use_run.run_id,
                "duration_sec": round(use_run.duration_sec, 2),
            },
        }
        with index_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")

        if not (smoke_run.ok and use_run.ok) and not args.continue_on_fail:
            print(f"[cycle {n}] FAIL: stopping. See index: {index_path}")
            return

        if n < args.iterations:
            time.sleep(max(0, args.delay_seconds))

    print(f"\n[volume] complete. index={index_path}")


if __name__ == "__main__":
    main()
```

### `.env.example` (write verbatim)

```
BASE_URL=https://example.com
TEST_EMAIL=test@example.com
TEST_PASSWORD=replace-me
LOGIN_PATH=/login
EMAIL_SELECTOR=input[type='email']
PASSWORD_SELECTOR=input[type='password']
SUBMIT_SELECTOR=button[type='submit']
SLOW_MO_MS=60
HEADLESS=false
MUTATING_TESTS=false
```

### `requirements.txt` (write verbatim)

```
playwright>=1.41.0
```

### `.gitignore` (write verbatim)

```
runs/
__pycache__/
*.pyc
.env
```
