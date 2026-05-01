# Agent Registry: API + Page Build Instructions

> **Owner:** myaiforone.com site agent
> **Priority:** API first, then page UI
> **Date:** 2026-04-30

---

## Table of Contents

1. [Background](#background)
2. [Architecture Overview](#architecture-overview)
3. [Agent Package Schema](#agent-package-schema)
4. [Phase 1: Agent Registry API](#phase-1-agent-registry-api)
5. [Phase 2: Agent Registry Page](#phase-2-agent-registry-page)
6. [Seeding the Registry](#seeding-the-registry)
7. [Naming & Terminology](#naming--terminology)
8. [CORS & Security](#cors--security)
9. [Checklist](#checklist)

---

## Background

MyAIforOne is a personal AI agent gateway app available as a free "Lite" version and a paid "Pro" version. Users install agents from a remote **Agent Registry** hosted on myaiforone.com. The Lite app ships with a Hub agent that can browse and install agents from the registry via MCP tools that call the myaiforone.com API.

### The Install Flow

```
User browses agents on myaiforone.com/agents
  OR asks their Hub agent to search the registry
        |
        v
Website: "Hire This Agent" shows a paste-able message for Hub
        |
        v
Hub calls browse_agent_registry
  -> hits GET /api/registry/agents on myaiforone.com
        |
        v
Hub calls install_agent
  -> hits GET /api/registry/agents/:id/package on myaiforone.com
  -> receives full agent package JSON
  -> creates agent locally on user's machine
```

The website serves two purposes:
1. **Human-browsable catalog** -- users discover agents on the web page
2. **Machine-readable API** -- the Hub agent calls the same API endpoints programmatically

---

## Architecture Overview

```
myaiforone.com
├── /agents                     <-- NEW page (Agent Registry)
├── /api/registry/agents        <-- NEW API (browse/search)
├── /api/registry/agents/:id    <-- NEW API (detail)
├── /api/registry/agents/:id/package  <-- NEW API (installable package)
└── data/registry/agents/       <-- JSON file store (one file per agent)
```

The registry is a simple read-only catalog. Each agent is stored as a single JSON file on disk. The API projects different subsets of that file for list, detail, and package endpoints.

---

## Agent Package Schema

This is the **source of truth** for each agent in the registry. Store one JSON file per agent at `data/registry/agents/{registryId}.json`.

```json
{
  "registryId": "mkt_finance_v2",
  "slug": "finance-assistant",
  "agentId": "finance",
  "name": "Finance Assistant",
  "alias": "@finance",
  "description": "Personal finance tracker with Stripe and QuickBooks integration",
  "shortDescription": "Track expenses, generate invoices, reconcile bank accounts",
  "category": "Finance & Accounting",
  "tags": ["finance", "accounting", "invoicing"],
  "tier": "free",
  "version": "1.0.0",
  "author": "MyAIforOne",
  "icon": "💰",
  "previewImage": "https://myaiforone.com/assets/agents/finance-preview.png",
  "capabilities": [
    "Track expenses",
    "Generate invoices",
    "Bank reconciliation",
    "Financial reports"
  ],
  "requirements": "Requires Stripe and/or QuickBooks API keys",
  "claudeMd": "# Finance Assistant\n\nYou are @finance — a personal finance...",
  "skills": [
    {
      "id": "reconcile",
      "name": "Bank Reconciliation",
      "content": "# Reconciliation Skill\n..."
    }
  ],
  "tools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
  "mcps": ["stripe", "quickbooks"],
  "requiredMcpKeys": [
    {
      "mcpName": "stripe",
      "envVar": "STRIPE_API_KEY",
      "label": "Stripe API Key",
      "helpUrl": "https://dashboard.stripe.com/apikeys"
    },
    {
      "mcpName": "quickbooks",
      "envVar": "QBO_ACCESS_TOKEN",
      "label": "QuickBooks Access Token",
      "helpUrl": "https://developer.intuit.com"
    }
  ],
  "persistent": true,
  "streaming": true,
  "organization": "Finance",
  "function": "Accounting",
  "title": "Finance Assistant",
  "memorySeeds": {
    "context.md": "# Finance Assistant Context\n\nThis agent manages..."
  }
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `registryId` | string | yes | Unique registry identifier (e.g. `mkt_finance_v2`) |
| `slug` | string | yes | URL-safe slug for SEO URLs (e.g. `finance-assistant`) |
| `agentId` | string | yes | Local agent ID used when installed |
| `name` | string | yes | Display name |
| `alias` | string | yes | Chat alias (e.g. `@finance`) |
| `description` | string | yes | Full description (1-3 paragraphs) |
| `shortDescription` | string | yes | One-liner for card display (under 100 chars) |
| `category` | string | yes | One of the predefined categories |
| `tags` | string[] | yes | Searchable tags |
| `tier` | string | yes | `"free"` or `"premium"` (all `"free"` for now) |
| `version` | string | yes | Semver version string |
| `author` | string | yes | Author name |
| `icon` | string | yes | Emoji icon |
| `previewImage` | string | no | URL to preview screenshot |
| `capabilities` | string[] | yes | List of what the agent can do (shown as tags/bullets) |
| `requirements` | string | no | Human-readable requirements text |
| `claudeMd` | string | yes | Full CLAUDE.md system prompt content |
| `skills` | object[] | no | Array of skill objects with `id`, `name`, `content` |
| `tools` | string[] | yes | Allowed Claude tools |
| `mcps` | string[] | no | MCP server names the agent needs |
| `requiredMcpKeys` | object[] | no | API keys the user must provide to use MCP integrations |
| `persistent` | boolean | no | Whether agent keeps session state |
| `streaming` | boolean | no | Whether agent supports streaming |
| `organization` | string | no | Org placement |
| `function` | string | no | Department/function |
| `title` | string | no | Job title |
| `memorySeeds` | object | no | Files to create in agent's memory directory on install |

---

## Phase 1: Agent Registry API

Build these three endpoints. They all read from the same JSON file store -- they just return different projections of the data.

### Endpoint 1: Browse/Search Agents

```
GET /api/registry/agents
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | — | Free-text search (matches name, description, tags, capabilities) |
| `category` | string | — | Filter by exact category name |
| `tier` | string | — | Filter by tier: `free` or `premium` |
| `page` | number | 1 | Page number (1-indexed) |
| `limit` | number | 24 | Results per page (max 100) |

**Response:**

```json
{
  "agents": [
    {
      "registryId": "mkt_finance_v2",
      "slug": "finance-assistant",
      "name": "Finance Assistant",
      "alias": "@finance",
      "shortDescription": "Track expenses, generate invoices, reconcile bank accounts",
      "category": "Finance & Accounting",
      "tags": ["finance", "accounting", "invoicing"],
      "tier": "free",
      "icon": "💰",
      "previewImage": "https://myaiforone.com/assets/agents/finance-preview.png",
      "capabilities": ["Track expenses", "Generate invoices", "Bank reconciliation", "Financial reports"],
      "author": "MyAIforOne",
      "version": "1.0.0"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 24,
  "categories": [
    "Finance & Accounting",
    "Project Management",
    "Development & DevOps",
    "Marketing & Content",
    "Sales & CRM",
    "HR & Operations",
    "Data & Analytics",
    "Communication",
    "Personal Productivity",
    "Industry-Specific"
  ]
}
```

**Notes:**
- The `agents` array contains **summary fields only** -- no `claudeMd`, no `skills` content, no `memorySeeds`.
- Always return the `categories` array so the UI can render category chips without a separate call.
- Search (`q`) should be case-insensitive and match across `name`, `description`, `shortDescription`, `tags`, and `capabilities`.

### Endpoint 2: Agent Detail

```
GET /api/registry/agents/:id
```

The `:id` can be either the `registryId` or the `slug` -- support both for flexibility.

**Response:**

```json
{
  "registryId": "mkt_finance_v2",
  "slug": "finance-assistant",
  "agentId": "finance",
  "name": "Finance Assistant",
  "alias": "@finance",
  "description": "Personal finance tracker with Stripe and QuickBooks integration",
  "shortDescription": "Track expenses, generate invoices, reconcile bank accounts",
  "category": "Finance & Accounting",
  "tags": ["finance", "accounting", "invoicing"],
  "tier": "free",
  "version": "1.0.0",
  "author": "MyAIforOne",
  "icon": "💰",
  "previewImage": "https://myaiforone.com/assets/agents/finance-preview.png",
  "capabilities": ["Track expenses", "Generate invoices", "Bank reconciliation", "Financial reports"],
  "requirements": "Requires Stripe and/or QuickBooks API keys",
  "requiredMcpKeys": [
    {
      "mcpName": "stripe",
      "envVar": "STRIPE_API_KEY",
      "label": "Stripe API Key",
      "helpUrl": "https://dashboard.stripe.com/apikeys"
    },
    {
      "mcpName": "quickbooks",
      "envVar": "QBO_ACCESS_TOKEN",
      "label": "QuickBooks Access Token",
      "helpUrl": "https://developer.intuit.com"
    }
  ],
  "tools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
  "mcps": ["stripe", "quickbooks"],
  "persistent": true,
  "streaming": true,
  "organization": "Finance",
  "function": "Accounting",
  "title": "Finance Assistant",
  "skills": [
    { "id": "reconcile", "name": "Bank Reconciliation" }
  ]
}
```

**Notes:**
- Returns everything EXCEPT `claudeMd`, `skills[].content`, and `memorySeeds` -- those are reserved for the package endpoint.
- Skills are listed with `id` and `name` only (no `content`).
- The `requiredMcpKeys` are included here so the detail page can show users what API keys they will need before installing.

### Endpoint 3: Full Installable Package

```
GET /api/registry/agents/:id/package
```

**Response:** The complete package JSON exactly as stored on disk (full schema from the [Agent Package Schema](#agent-package-schema) section above). This includes `claudeMd`, `skills` with full `content`, `memorySeeds`, and all configuration.

**Notes:**
- This is what the Hub agent's `install_agent` MCP tool calls to get everything needed to recreate the agent locally.
- For premium agents (future): check license/payment before returning. For now, all agents return freely.
- The `:id` can be either `registryId` or `slug`.

### Error Responses

Use standard HTTP status codes:

```json
// 404
{ "error": "Agent not found", "registryId": "nonexistent_id" }

// 400
{ "error": "Invalid query parameter", "details": "limit must be between 1 and 100" }
```

### Data Storage

Start with a simple JSON file store:

```
data/
  registry/
    agents/
      mkt_finance_v2.json
      mkt_projectmgr_v1.json
      mkt_devops_v1.json
      ...
```

On server start, load all JSON files into memory. Serve from memory for fast reads. If you need to add/update agents later, a simple file watcher or restart will pick up changes.

If the site already uses a database, that works too -- the schema above maps cleanly to a single table/collection.

---

## Phase 2: Agent Registry Page

### URL Structure

| URL | Purpose |
|-----|---------|
| `/agents` | Registry browse/search page |
| `/agents/:slug` | Individual agent detail page (SEO-friendly) |

These are NEW pages, separate from the existing single-page landing content.

### Navigation

Add **"Agents"** to the site's main navigation bar, next to existing items. This link goes to `/agents`.

---

### Browse Page (`/agents`)

#### Layout (top to bottom)

```
┌─────────────────────────────────────────────────────────────┐
│  [Site Nav]                              ... | Agents | ... │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Agent Registry                                             │
│  Discover and hire AI agents for your workflow              │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  🔍 Search agents...                                  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  [All] [Finance] [Project Mgmt] [Dev & DevOps] [Marketing] │
│  [Sales] [HR & Ops] [Data] [Communication] [Productivity]  │
│  [Industry]                                                 │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ 💰       │  │ 📋       │  │ 🔧       │  │ 📊       │   │
│  │ Finance  │  │ Project  │  │ DevOps   │  │ Analytics │   │
│  │ Asst.    │  │ Manager  │  │ Engineer │  │ Agent    │   │
│  │          │  │          │  │          │  │          │   │
│  │ Track    │  │ Manage   │  │ CI/CD,   │  │ Data     │   │
│  │ expenses │  │ tasks &  │  │ deploy,  │  │ insights │   │
│  │ & inv... │  │ sprint.. │  │ monit... │  │ & repo.. │   │
│  │          │  │          │  │          │  │          │   │
│  │ [Free]   │  │ [Free]   │  │ [Free]   │  │ [Free]   │   │
│  │ Finance  │  │ Project  │  │ Dev &    │  │ Data &   │   │
│  │          │  │ Mgmt     │  │ DevOps   │  │ Analytics│   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  ...     │  │  ...     │  │  ...     │  │  ...     │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                             │
│                    [Load More] or pagination                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Agent Card Anatomy

Each card shows:

1. **Icon** (emoji, large) -- top-left
2. **Name** -- bold heading
3. **Short description** -- 1-2 lines, truncated with ellipsis
4. **Capability tags** -- first 2-3 capabilities as small pills/badges
5. **Tier badge** -- "Free" (green) or "Premium" (gold) -- bottom area
6. **Category badge** -- subtle label at bottom

#### Responsive Grid

| Viewport | Columns |
|----------|---------|
| Desktop (1200px+) | 4 columns |
| Tablet (768-1199px) | 2 columns |
| Mobile (<768px) | 1 column (full width cards) |

#### Interactions

- **Search bar**: Debounced (300ms), calls `GET /api/registry/agents?q=...`
- **Category chips**: Horizontal scrollable on mobile. Click to filter. "All" chip resets filter. Active chip is visually highlighted.
- **Card click**: Navigate to `/agents/:slug` (agent detail page)
- **Pagination**: Either "Load More" button (appends) or traditional page numbers -- pick whichever matches the site's existing pattern.

---

### Agent Detail Page (`/agents/:slug`)

Can be implemented as a separate page OR as a modal/drawer over the browse page. A separate page is preferred for SEO.

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [Site Nav]                                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ← Back to Agent Registry                                  │
│                                                             │
│  💰 Finance Assistant                          [Free]       │
│  @finance  ·  v1.0.0  ·  by MyAIforOne                     │
│  Finance & Accounting                                       │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │               [Preview Image / Screenshot]             │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ── Description ──────────────────────────────────────────  │
│  Personal finance tracker with Stripe and QuickBooks        │
│  integration. Manages expense tracking, invoice generation, │
│  bank reconciliation, and financial reporting.              │
│                                                             │
│  ── Capabilities ─────────────────────────────────────────  │
│  ✓ Track expenses                                           │
│  ✓ Generate invoices                                        │
│  ✓ Bank reconciliation                                      │
│  ✓ Financial reports                                        │
│                                                             │
│  ── Required API Keys ────────────────────────────────────  │
│  • Stripe API Key  [Get key →]                              │
│  • QuickBooks Access Token  [Get key →]                     │
│                                                             │
│  ── Tools & Integrations ─────────────────────────────────  │
│  Tools: Read, Write, Edit, Bash, Glob, Grep                │
│  MCP Integrations: Stripe, QuickBooks                       │
│                                                             │
│          ┌─────────────────────────────┐                    │
│          │     Hire This Agent  →      │                    │
│          └─────────────────────────────┘                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Sections

1. **Header**: Icon, name, alias, version, author, category badge, tier badge
2. **Preview image**: If `previewImage` exists, show it prominently
3. **Description**: Full `description` text, rendered as markdown if it contains formatting
4. **Capabilities**: Bulleted/check-marked list from the `capabilities` array
5. **Required API Keys**: Render from `requiredMcpKeys`. Each item shows the `label` with a link to `helpUrl`. If empty, show "No API keys required"
6. **Tools & Integrations**: List the `tools` and `mcps` arrays
7. **Hire CTA**: Large primary-color button at the bottom

---

### "Hire This Agent" CTA Behavior

When the user clicks the "Hire This Agent" button, show a **modal** with:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Hire Finance Assistant                                     │
│                                                             │
│  Open your MyAIforOne app and send this message to @hub:    │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Please install @finance from the Agent Registry,       │ │
│  │ ID: mkt_finance_v2                                     │ │
│  └────────────────────────────────────────────────────────┘ │
│                                            [Copy to clipboard] │
│                                                             │
│  ─────────────── or ──────────────────────                  │
│                                                             │
│  Don't have MyAIforOne yet?                                 │
│  Download the free app →                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Implementation details:**
- The message text is: `Please install @{alias} from the Agent Registry, ID: {registryId}`
- "Copy to clipboard" uses the Clipboard API (`navigator.clipboard.writeText()`)
- Show a brief "Copied!" confirmation after clicking
- The "Download the free app" link points to the download section of the main myaiforone.com page (e.g. `/#download` or wherever the download CTA lives)

---

## Seeding the Registry

### Categories

Seed these 10 categories:

1. Finance & Accounting
2. Project Management
3. Development & DevOps
4. Marketing & Content
5. Sales & CRM
6. HR & Operations
7. Data & Analytics
8. Communication
9. Personal Productivity
10. Industry-Specific

### Initial Agents

The local MyAIforOne install has a template system at `GET /api/templates`. Many existing templates can be converted to registry entries.

**To populate the registry:**

1. Start with 5-10 hand-crafted agent packages that cover a spread of categories
2. Each needs a complete JSON file following the schema above
3. Ensure each has a unique `registryId`, a URL-safe `slug`, and a `shortDescription`
4. Every agent should be `"tier": "free"` for now

**Suggested starter agents** (create registry entries for these archetypes):

| registryId | name | category |
|-------------|------|----------|
| `mkt_finance_v1` | Finance Assistant | Finance & Accounting |
| `mkt_projectmgr_v1` | Project Manager | Project Management |
| `mkt_devops_v1` | DevOps Engineer | Development & DevOps |
| `mkt_contentwriter_v1` | Content Writer | Marketing & Content |
| `mkt_salesrep_v1` | Sales Assistant | Sales & CRM |
| `mkt_hrassistant_v1` | HR Assistant | HR & Operations |
| `mkt_dataanalyst_v1` | Data Analyst | Data & Analytics |
| `mkt_commsmanager_v1` | Communications Manager | Communication |
| `mkt_todobot_v1` | Personal Task Manager | Personal Productivity |
| `mkt_legalreviewer_v1` | Legal Document Reviewer | Industry-Specific |

For each, write a realistic `claudeMd` system prompt, plausible `capabilities`, appropriate `tools`, and relevant `mcps`/`requiredMcpKeys`.

---

## Naming & Terminology

Use these terms consistently across the API, UI, and copy:

| Context | Term | NOT |
|---------|------|-----|
| The feature | Agent Registry | marketplace, store, catalog |
| Web action | Hire | buy, install, download |
| App action | Install | hire, deploy |
| CTA button | Hire This Agent | Get, Download, Add |
| Page title | Agent Registry | Agent Store, Marketplace |

---

## CORS & Security

- The local Lite app's Hub agent calls these API endpoints via **server-side fetch** (from the MCP executor on localhost:4888), so CORS is NOT an issue for the primary install flow.
- Set standard CORS headers anyway for future browser-based features:
  ```
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, OPTIONS
  Access-Control-Allow-Headers: Content-Type
  ```
- All registry endpoints are **read-only** (GET only). No authentication required for browsing or installing free agents.
- Rate-limit the `/package` endpoint (e.g. 60 requests/minute per IP) to prevent abuse.

---

## Design Guidance

- **Match the existing myaiforone.com design language** -- same fonts, colors, spacing, component styles
- Reference: Vercel marketplace, Raycast extensions store, or Slack app directory for inspiration on card grid + detail layout
- Keep it clean and professional
- Fast loading -- the agent list should paginate or lazy-load, not dump 100+ cards at once
- Each agent detail page should be server-rendered or statically generated for SEO (Google should index `/agents/finance-assistant`)

---

## Checklist

### Phase 1: API
- [ ] Create `data/registry/agents/` directory structure
- [ ] Create 5-10 seed agent JSON files following the package schema
- [ ] Implement `GET /api/registry/agents` with search, category filter, tier filter, pagination
- [ ] Implement `GET /api/registry/agents/:id` (detail, supports registryId or slug)
- [ ] Implement `GET /api/registry/agents/:id/package` (full package)
- [ ] Add error handling (404, 400)
- [ ] Add CORS headers
- [ ] Test all three endpoints manually
- [ ] Test that the response shapes match the schemas documented above

### Phase 2: Page
- [ ] Add "Agents" to site navigation
- [ ] Build `/agents` browse page with search bar and category chips
- [ ] Build responsive agent card grid (4/2/1 columns)
- [ ] Build `/agents/:slug` detail page
- [ ] Build "Hire This Agent" modal with copy-to-clipboard
- [ ] Ensure mobile responsiveness across all views
- [ ] Add SEO meta tags to detail pages (title, description, og:image)
- [ ] Test the full flow: browse -> search -> filter -> detail -> hire modal -> copy

### Verification
- [ ] Hub agent on local install can call `GET /api/registry/agents` and parse the response
- [ ] Hub agent can call `GET /api/registry/agents/:id/package` and successfully install an agent from it
