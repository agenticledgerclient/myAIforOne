---
name: opswaggerbuilder
description: Generate an interactive Swagger-like API documentation and testing page for any web application. Creates a fully functional API playground with endpoint navigation, request builder, live execution, cURL generation, and response viewer. Use when adding API docs to any project.
---

# Interactive API Docs Builder (Swagger-like)

Build a custom, interactive API documentation and testing page for any web application. This produces a Postman/Swagger-style playground that lives inside the app itself — not a static doc, but a live tool for exploring and testing the API.

## Reference Implementation

**IMPORTANT:** Before generating code, read the reference implementation for patterns and inspiration:

- **Internal file:** `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\EnterpriseWalletManager\frontend\src\app\(dashboard)\settings\api-docs\page.tsx`
- **Live example:** `https://walletmanager.agenticledger.ai/settings/api-docs` (requires login)

Read this file first to understand the full component architecture, then adapt it to the target project's stack, endpoints, and auth model.

## What Gets Built

A single-page interactive API reference with these sections:

### 1. Left Sidebar — Endpoint Navigation
- Categorized, collapsible endpoint groups (e.g., "Auth", "Users", "Wallets")
- Each endpoint shows: HTTP method badge (color-coded) + path
- Search/filter bar at top
- Overview and History quick links
- Endpoint count per category

### 2. Main Panel — Endpoint Detail + Request Builder
When an endpoint is selected:
- **Header:** Method badge, full path, summary description, auth badges (Public/JWT/API Key), required scopes
- **Request Builder Card:**
  - Auth selector (JWT token / API key / None — based on what the app supports)
  - Path parameter inputs (auto-detected from `:param` in paths, with smart autofill dropdowns where applicable)
  - Query parameter inputs (with type hints, required markers, example placeholders)
  - JSON request body editor (dark themed textarea, with "Load Example" button from schema)
  - Schema hints panel showing field types, required markers, enums
- **Execute button** — fires real API calls from the browser
- **cURL generator** — shows the equivalent curl command with copy button

### 3. Response Viewer
- Status code (color-coded: 2xx green, 4xx amber, 5xx red)
- Response time in ms
- Tabbed view: Body (formatted JSON) | Headers
- Error display with icon

### 4. Request History
- Persisted to localStorage
- Shows: method, path, status, duration, timestamp
- Click to replay — loads that endpoint back into the builder
- Clear all button

### 5. Overview Page (default landing)
- App title + description
- Auth methods explanation cards (JWT, API Key, etc.)
- Quick start grid — click a category to jump to its first endpoint
- Required headers table
- Special sections for public/unauthenticated endpoints if any

## Step-by-Step Process

### Step 1: Discover the Project

Before writing anything, understand the target app:

1. **Identify the framework** — React/Next.js, Vue, Svelte, plain HTML, etc.
2. **Find the API routes** — look for route files, controllers, or API handlers
3. **Identify auth model** — JWT, API keys, session cookies, OAuth, none
4. **Find existing UI components** — does the project use shadcn/ui, MUI, Chakra, Tailwind, etc.?
5. **Check for existing API docs** — any OpenAPI/Swagger spec, markdown docs, or Postman collections

### Step 2: Catalog All Endpoints

Build the endpoint catalog by scanning the codebase:

```typescript
// Structure for each category
interface EndpointCategory {
  name: string;        // "Authentication", "Users", "Wallets"
  slug: string;        // "auth", "users", "wallets"
  description: string; // "User authentication and session management"
  endpoints: Endpoint[];
}

interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;           // "/api/users/:id"
  summary: string;        // "Get user by ID"
  auth: string | boolean; // false = public, 'jwt', 'apikey', 'both'
  role?: string;          // "admin", "org_admin"
  scope?: string;         // "READONLY", "FULL_ACCESS"
}
```

### Step 3: Define Endpoint Schemas

For each endpoint that accepts parameters or a body:

```typescript
interface EndpointSchema {
  params?: EndpointParam[];  // path + query params
  body?: Record<string, {    // request body fields
    type: string;
    required?: boolean;
    enum?: string[];
    default?: any;
    example?: any;
    description?: string;
    autofill?: string;       // key into autofill data
  }>;
  bodyExample?: Record<string, any>; // pre-filled example
}
```

### Step 4: Build the Component

Create the API docs page matching the target project's stack:

**For Next.js / React projects:**
- Create at an appropriate route (e.g., `/settings/api-docs`, `/docs/api`, `/developer/api`)
- Use the project's existing UI component library (shadcn/ui, MUI, etc.)
- Import the project's existing API client/auth store if available

**For other frameworks:**
- Adapt the same architecture to Vue/Svelte/etc.
- Use the project's existing component system

**Key implementation details:**
- Method badge colors: GET=green, POST=blue, PUT=amber, DELETE=red, PATCH=purple
- Status colors: 2xx=green, 4xx=amber, 5xx=red
- Request body editor: dark bg (`bg-gray-900`) with green text (`text-green-400`)
- Auto-detect path params from `:paramName` patterns
- Pre-fill org IDs, user IDs from auth store when available
- Generate cURL with proper escaping and line continuation (`\`)
- Store history in localStorage (cap at 50 items)

### Step 5: Smart Autofill (Optional but Recommended)

If the app has entities the user manages (wallets, projects, teams, etc.), load them on mount and offer dropdown autofill for path parameters and body fields:

```typescript
interface AutofillData {
  [key: string]: Array<{ id: string; name: string; [key: string]: any }>;
}
```

This turns the API docs from a dumb form into a smart tool that knows about the user's actual data.

### Step 6: Wire Up Navigation

Add a link to the API docs page from:
- Settings/Developer section in the sidebar
- Any existing docs or API key management pages

## Adapting to Different Auth Models

| Auth Model | Implementation |
|---|---|
| JWT Bearer | Show "JWT Token" button, auto-use token from auth store |
| API Key header | Show "API Key" input field, send as `X-API-Key` |
| Session/Cookie | No auth UI needed, cookies sent automatically |
| OAuth | Show token input or "Login first" warning |
| No auth | Hide auth section, mark endpoints as "Public" |
| Mixed | Show auth type selector (like EWM does) |

## Method Color Scheme

```typescript
const methodColors = {
  GET:    'bg-green-100 text-green-800 border-green-200',
  POST:   'bg-blue-100 text-blue-800 border-blue-200',
  PUT:    'bg-amber-100 text-amber-800 border-amber-200',
  DELETE: 'bg-red-100 text-red-800 border-red-200',
  PATCH:  'bg-purple-100 text-purple-800 border-purple-200',
};
```

## Step 7: API Key Management Page (If App Uses API Key Auth)

If the app supports API key authentication, build a companion **API Key Management page** alongside the API docs. This lets users generate, manage, and revoke their own keys without needing a separate tool.

**Reference implementation:** `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\EnterpriseWalletManager\frontend\src\app\(dashboard)\settings\api-keys\page.tsx`

### What to Build

A settings page (e.g., `/settings/api-keys` or `/developer/keys`) with:

#### Key Generation
- "Generate New Key" button that opens a form/dialog
- Fields: **Name** (required, e.g., "CI/CD Pipeline"), **Description** (optional), **Scope** selector, **Expiration** (optional date picker or "Never")
- Scope options depend on the app — common patterns:
  - `READONLY` — GET requests only
  - `FULL_ACCESS` / `FULL_ORG_ADMIN` — all methods
  - Custom scopes as needed (e.g., `WRITE_ONLY`, `BILLING`)
- On creation, show the full key **exactly once** with a prominent copy button and warning: "Copy this key now. You won't be able to see it again."
- Key format convention: `{app_prefix}_live_{random}` (e.g., `ewm_live_abc123`, `fin_live_xyz789`)

#### Key List Table
- Columns: Name, Key prefix (masked, e.g., `ewm_live_abc1...`), Scope badge, Created date, Last used date, Expiration, Status
- Row actions: Copy prefix, Revoke/Delete (with confirmation dialog)

#### Key Details
- Click a key to see: full metadata, usage stats (last used, total requests if tracked), scope description
- Edit name/description (but NOT scope — that's immutable after creation)

#### Revocation
- Revoke button with confirmation: "Are you sure? Any integrations using this key will immediately stop working."
- Revoked keys should be visually distinct (grayed out, strikethrough, or moved to a "Revoked" section)

### Backend Requirements

The skill should also guide building the backend API for key management if it doesn't exist:

```
POST   /api/api-keys          — Generate new key (returns full key once)
GET    /api/api-keys          — List org's keys (masked)
GET    /api/api-keys/:id      — Get key details
PUT    /api/api-keys/:id      — Update name/description
DELETE /api/api-keys/:id      — Revoke key
```

**Storage pattern:**
- Store a **hashed** version of the key (bcrypt or SHA-256) — never store the raw key
- Store a **prefix** for display (first 8-12 chars)
- Include: `name`, `description`, `scope`, `organization_id`, `created_by`, `created_at`, `last_used_at`, `expires_at`, `revoked_at`

**Auth middleware pattern:**
```typescript
// Check for API key in X-API-Key header
// If found, hash it, look up in DB, validate scope + expiration
// Attach org context to request (same as JWT would)
// Update last_used_at timestamp
```

### Linking API Keys to API Docs

Wire the two pages together:
- On the API docs page, if the user selects "API Key" auth and has no keys, show a link: "No API keys yet — Generate one"
- On the API keys page, add a link: "Test your key in the API Playground"
- When a key is generated, offer to auto-fill it into the API docs request builder

## Output Checklist

After building, verify:
- [ ] All API endpoints are cataloged and categorized
- [ ] Each endpoint has method, path, summary, and auth info
- [ ] POST/PUT endpoints have body schemas with examples
- [ ] GET endpoints with query params have parameter definitions
- [ ] Path parameters auto-detected and rendered as inputs
- [ ] Auth selection works (JWT/API Key/None as applicable)
- [ ] "Send Request" fires real API calls and shows responses
- [ ] cURL command generates correctly with auth headers
- [ ] Request history saves to localStorage
- [ ] Overview page explains auth methods and lists categories
- [ ] Page is wired into the app's navigation
- [ ] Uses the project's existing component library (not a separate design system)

**If API Key auth is supported:**
- [ ] API Key management page exists with generate, list, revoke
- [ ] Key shown only once on creation with copy button + warning
- [ ] Keys stored hashed in DB, only prefix displayed in list
- [ ] Scope selection works (READONLY, FULL_ACCESS, etc.)
- [ ] Revocation works with confirmation dialog
- [ ] API docs page links to key management and vice versa
- [ ] Auth middleware validates API key, scope, and expiration
