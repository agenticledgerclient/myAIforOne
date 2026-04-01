# MyAgent SaaS — Deployment Plan

## Vision

A **separate application** (separate repo) that takes the MyAgent concept and rebuilds the backend for multi-tenant, server-hosted deployment. Teams access it via Slack and Web UI — no local install needed. Power users with the local app can push/pull agents to/from any SaaS instance.

**Two completely independent applications:**

| | MyAgent Local | MyAgent SaaS |
|---|---|---|
| **Repo** | `channelToAgentToClaude` | `myagent-saas` (new) |
| **Storage** | File-based (JSON, JSONL, markdown) | PostgreSQL + pgvector |
| **Users** | Single user, no auth | Multi-tenant, auth + roles |
| **Executor** | `claude -p` (CLI, personal sub) | Anthropic Messages API (API key) |
| **Channels** | iMessage, Slack, Telegram, Discord, WhatsApp, Web | Slack, Telegram, Discord, WhatsApp, Web (no iMessage) |
| **Agents** | Personal, file-based config | Per-tenant, database-stored |
| **Memory** | File-based (JSONL, markdown) | PostgreSQL + vector embeddings |
| **Deploy** | Local Mac/Windows | Railway / any cloud |

---

## Architecture

```
LOCAL APP (existing, unchanged)
├── File-based storage
├── CLI executor (claude -p)
├── Personal agents
├── iMessage + all channels
├── Push/pull to SaaS instances ← (new feature, added later)
│
│   push/pull via REST API
│   ▼
SAAS APP (new repo: myagent-saas)
├── PostgreSQL + pgvector
├── API executor (Anthropic Messages API)
├── Multi-tenant (org → users → agents)
├── Auth (invite code → session)
├── Slack, Telegram, Discord, WhatsApp, Web
├── Web UI (same look and feel, different backend)
├── REST API for everything
└── Import/export endpoints for push/pull
```

---

## Repo Setup

### Step 0: Clone and Rename

- [ ] **0.1** Clone `channelToAgentToClaude` → `myagent-saas`
- [ ] **0.2** Remove: iMessage channel driver, CLI executor, file-based config loading, launchd scripts, Windows service scripts
- [ ] **0.3** Keep: Web UI (all HTML pages), Slack/Telegram/Discord/WhatsApp drivers, router logic, MCP hub, skill/prompt system, cron/goals system
- [ ] **0.4** Update `package.json` — new name, add Postgres dependencies (`pg`, `@prisma/client`, `pgvector`)
- [ ] **0.5** Add Prisma ORM with PostgreSQL provider
- [ ] **0.6** Create `.env.example` with: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `SESSION_SECRET`, `PORT`
- [ ] **0.7** Update `CLAUDE.md` for the new repo — document the SaaS architecture, not the local app

---

## Phase 1: Database Layer (PostgreSQL + pgvector)

Replace all file-based storage with PostgreSQL. Use Prisma ORM. Enable pgvector for semantic memory search.

### Schema Design

- [ ] **1.1 Core tenant model**
  ```prisma
  model Tenant {
    id        String   @id @default(cuid())
    name      String
    slug      String   @unique
    createdAt DateTime @default(now())
    users     User[]
    agents    Agent[]
    skills    Skill[]
    prompts   Prompt[]
    apps      App[]
    mcpConfigs McpConfig[]
  }
  ```

- [ ] **1.2 User model**
  ```prisma
  model User {
    id        String   @id @default(cuid())
    email     String
    name      String
    role      Role     @default(USER)
    tenantId  String
    tenant    Tenant   @relation(fields: [tenantId], references: [id])
    sessions  Session[]
    messages  Message[]
    createdAt DateTime @default(now())
    @@unique([email, tenantId])
  }

  enum Role {
    ADMIN
    USER
  }
  ```

- [ ] **1.3 Agent model**
  ```prisma
  model Agent {
    id              String   @id @default(cuid())
    agentId         String
    tenantId        String
    tenant          Tenant   @relation(fields: [tenantId], references: [id])
    name            String
    description     String?
    claudeMd        String   @db.Text
    workspace       String?
    persistent      Boolean  @default(true)
    streaming       Boolean  @default(true)
    advancedMemory  Boolean  @default(false)
    agentClass      String   @default("standard")
    allowedTools    String[]
    skills          String[]
    mcps            String[]
    mentionAliases  String[]
    timeout         Int      @default(14400000)
    model           String?
    org             Json?
    cron            Json?
    goals           Json?
    routes          Json?
    messages        Message[]
    sessions        AgentSession[]
    memories        Memory[]
    createdAt       DateTime @default(now())
    updatedAt       DateTime @updatedAt
    @@unique([agentId, tenantId])
  }
  ```

- [ ] **1.4 Message / conversation model**
  ```prisma
  model Message {
    id        String   @id @default(cuid())
    agentId   String
    agent     Agent    @relation(fields: [agentId], references: [id])
    userId    String
    user      User     @relation(fields: [userId], references: [id])
    role      String   // "user" | "agent"
    text      String   @db.Text
    channel   String
    tools     Json?
    cost      Float?
    createdAt DateTime @default(now())
    @@index([agentId, userId, createdAt])
  }
  ```

- [ ] **1.5 Agent session model (for API executor conversation state)**
  ```prisma
  model AgentSession {
    id          String   @id @default(cuid())
    agentId     String
    agent       Agent    @relation(fields: [agentId], references: [id])
    userId      String
    messages    Json     @db.JsonB  // Anthropic message format array
    createdAt   DateTime @default(now())
    updatedAt   DateTime @updatedAt
    @@unique([agentId, userId])
  }
  ```

- [ ] **1.6 Vector memory model (pgvector)**
  ```prisma
  model Memory {
    id        String   @id @default(cuid())
    agentId   String
    agent     Agent    @relation(fields: [agentId], references: [id])
    content   String   @db.Text
    embedding Unsupported("vector(1536)")
    metadata  Json?
    createdAt DateTime @default(now())
    @@index([agentId])
  }
  ```
  - Raw SQL for vector similarity search: `ORDER BY embedding <=> $1 LIMIT $2`
  - Embedding generation via Anthropic or OpenAI embeddings API

- [ ] **1.7 Skill, Prompt, App, McpConfig models**
  ```prisma
  model Skill {
    id          String   @id @default(cuid())
    tenantId    String
    tenant      Tenant   @relation(fields: [tenantId], references: [id])
    name        String
    description String?
    content     String   @db.Text
    category    String?
    isDefault   Boolean  @default(false)
    createdAt   DateTime @default(now())
    @@unique([name, tenantId])
  }

  model Prompt {
    id          String   @id @default(cuid())
    tenantId    String
    tenant      Tenant   @relation(fields: [tenantId], references: [id])
    name        String
    description String?
    content     String   @db.Text
    trigger     String   @default("!")
    createdAt   DateTime @default(now())
    @@unique([name, tenantId])
  }

  model App {
    id              String   @id @default(cuid())
    tenantId        String
    tenant          Tenant   @relation(fields: [tenantId], references: [id])
    name            String
    description     String?
    url             String?
    status          String   @default("draft")
    category        String?
    agentDeveloper  String?
    githubRepo      String?
    deployPlatform  String?
    healthStatus    String   @default("unknown")
    createdAt       DateTime @default(now())
  }

  model McpConfig {
    id        String @id @default(cuid())
    tenantId  String
    tenant    Tenant @relation(fields: [tenantId], references: [id])
    name      String
    type      String // "http" | "stdio"
    url       String?
    command   String?
    args      String[]
    headers   Json?
    env       Json?
    @@unique([name, tenantId])
  }
  ```

- [ ] **1.8 Session model (auth sessions)**
  ```prisma
  model Session {
    id        String   @id @default(cuid())
    userId    String
    user      User     @relation(fields: [userId], references: [id])
    token     String   @unique
    expiresAt DateTime
    createdAt DateTime @default(now())
  }
  ```

- [ ] **1.9 Prisma migration — initial schema**
  - `npx prisma migrate dev --name init`
  - Enable pgvector extension: `CREATE EXTENSION IF NOT EXISTS vector;`

- [ ] **1.10 Seed script**
  - Create default tenant
  - Create admin user
  - Seed platform agents (agentcreator, skillcreator, appcreator, promptcreator)
  - Seed default skills

---

## Phase 2: API Executor

Replace `claude -p` CLI executor with direct Anthropic Messages API calls.

- [ ] **2.1 Executor interface**
  - Define `executeAgent(route, message, context)` and `executeAgentStreaming(route, message, context)` interfaces
  - Both take: system prompt, user message, tools, conversation history
  - Sync returns: response text
  - Streaming returns: `AsyncGenerator<StreamEvent>`

- [ ] **2.2 Anthropic API client**
  - New file: `src/executor-api.ts`
  - Use `@anthropic-ai/sdk` package
  - Call `client.messages.create()` with system prompt, messages, tools
  - Support streaming via `client.messages.stream()`
  - Model selection: per-agent or global default
  - Config: `ANTHROPIC_API_KEY` env var

- [ ] **2.3 Tool execution**
  - When model returns `tool_use` block, execute the tool server-side
  - Tool handlers for: Read, Write, Edit, Glob, Grep, Bash, WebFetch, WebSearch
  - Bash: sandboxed with timeout, scoped to agent workspace
  - File tools: scoped to tenant workspace directories
  - MCP tools: proxy to configured MCP servers
  - Return tool results, continue conversation loop

- [ ] **2.4 Conversation state**
  - Load/save conversation history from `AgentSession` table
  - Per-user, per-agent sessions
  - Context window management: truncate or summarize when approaching limit
  - Session reset: clear `AgentSession` record

- [ ] **2.5 Streaming integration**
  - Wire streaming executor into existing SSE/streaming endpoints
  - Emit same `StreamEvent` types as current CLI executor
  - Web UI streaming should work without frontend changes

- [ ] **2.6 Cost tracking**
  - Parse `usage` from Anthropic API response (input_tokens, output_tokens)
  - Store per-message cost in `Message.cost` field
  - Aggregate per-user, per-agent, per-tenant for billing/reporting

---

## Phase 3: Authentication & Multi-Tenancy

- [ ] **3.1 Auth middleware**
  - Session-based auth via `Session` table
  - Login endpoint: `POST /api/auth/login` (email + invite code)
  - Logout: `POST /api/auth/logout`
  - Session cookie: `HttpOnly`, `SameSite=Strict`
  - All API routes protected except: `/health`, `/login`, `/api/auth/*`
  - Attach `req.user` and `req.tenant` to authenticated requests

- [ ] **3.2 Tenant isolation**
  - Every database query scoped by `tenantId`
  - Prisma middleware or helper: `withTenant(tenantId)`
  - Agents, skills, prompts, apps, MCPs — all tenant-scoped
  - Users belong to exactly one tenant
  - No cross-tenant data leakage

- [ ] **3.3 Invite system**
  - Admin generates invite codes: `POST /api/admin/invites`
  - User redeems invite: `POST /api/auth/register` (email, name, invite code)
  - Invite tied to tenant — registering with it joins that tenant
  - Invite can be single-use or multi-use (configurable)

- [ ] **3.4 User identity in messages**
  - Web UI: attach authenticated user to chat messages
  - Slack: map Slack user ID to platform user (auto-create on first message if invite allows)
  - Telegram: map Telegram user ID to platform user
  - Per-user conversation isolation by default

- [ ] **3.5 Role-based access**
  - `ADMIN`: create/edit/delete agents, manage users, generate invites, access all settings
  - `USER`: chat with agents, browse registry, use Lab (if allowed)
  - Agent creation in Lab: admin-only by default, configurable per tenant

- [ ] **3.6 Login page**
  - `GET /login` — clean login page matching existing design language
  - Email + invite code (first time) or email + session (returning)
  - Redirect to `/ui` after login

- [ ] **3.7 Admin panel**
  - `/admin` — admin-only page
  - Manage users: list, invite, deactivate, change roles
  - Tenant settings: name, default model, allowed channels
  - Usage dashboard: token counts, costs per user/agent
  - Add to existing settings page or standalone

---

## Phase 4: Adapt Web UI & Routes

The frontend HTML pages stay the same (same design), but backend API calls now hit the database instead of the filesystem.

- [ ] **4.1 Rewrite API layer**
  - All `readFileSync`/`writeFileSync` config.json operations → Prisma queries
  - `GET /api/dashboard` → query `Agent`, `Message` tables
  - `GET /api/agents` → query `Agent` table with tenant filter
  - `POST /api/agents` → insert into `Agent` table
  - `PUT /api/agents/:id` → update `Agent` table
  - `DELETE /api/agents/:id` → delete from `Agent` table
  - Same for skills, prompts, apps, MCPs

- [ ] **4.2 Chat endpoints**
  - `POST /api/chat/:agentId` → load agent from DB, run API executor
  - `POST /api/chat/:agentId/stream` → same but streaming
  - Conversation history from `AgentSession` table
  - Messages logged to `Message` table

- [ ] **4.3 Marketplace/Registry endpoints**
  - Same API shape, backed by database instead of JSON files
  - `GET /api/marketplace/:type` → query appropriate table
  - Browse, search, filter — all database queries

- [ ] **4.4 File uploads**
  - Upload to server filesystem or S3/R2
  - Path stored in database
  - Scoped to tenant

- [ ] **4.5 Web UI updates**
  - Add login redirect if not authenticated
  - Show logged-in user name in topbar
  - Hide admin-only features for regular users
  - Everything else stays the same — same pages, same design

---

## Phase 5: Push/Pull (Import/Export API)

Enable local MyAgent instances to push agents/skills/prompts to and pull from any SaaS instance.

- [ ] **5.1 Export endpoint (SaaS-side)**
  - `GET /api/export/:type/:id` — export agent, skill, prompt, or app as JSON package
  - Package includes: config, CLAUDE.md content, associated skills content
  - Strips: tenant info, user data, conversation history
  - Auth: requires API key or user session

- [ ] **5.2 Import endpoint (SaaS-side)**
  - `POST /api/import` — import an agent/skill/prompt package
  - Validates package, creates records in database
  - Generates default web route for imported agent
  - Auth: requires admin role

- [ ] **5.3 Push command (local-side — added to local app later)**
  - `/push @agent-name to remote-name`
  - Config: `remotes` section in local `config.json`
  - Packages agent config + CLAUDE.md + skills → POST to remote `/api/import`
  - Not part of this repo — tracked separately

- [ ] **5.4 Pull command (local-side — added to local app later)**
  - `/pull @agent-name from remote-name`
  - GET from remote `/api/export/agent/:id` → install locally
  - Not part of this repo — tracked separately

- [ ] **5.5 API key auth for push/pull**
  - Tenant-level API keys for programmatic access
  - `POST /api/admin/api-keys` — generate API key
  - API key scoped to tenant, attached to requests via `Authorization: Bearer` header

---

## Phase 6: Deployment

- [ ] **6.1 Dockerfile**
  ```dockerfile
  FROM node:22-alpine
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci --production
  COPY dist/ ./dist/
  COPY public/ ./public/
  COPY prisma/ ./prisma/
  RUN npx prisma generate
  EXPOSE 4888
  CMD ["node", "dist/index.js"]
  ```

- [ ] **6.2 Railway config**
  - PostgreSQL add-on with pgvector extension
  - Environment variables: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `SESSION_SECRET`, `PORT`
  - Health check: `GET /health`
  - Auto-deploy from GitHub

- [ ] **6.3 Database migrations on deploy**
  - `npx prisma migrate deploy` as part of build/start
  - Seed script for first deploy

- [ ] **6.4 First tenant setup**
  - CLI command or setup endpoint: creates first tenant + admin user
  - `npm run setup -- --tenant "Finance Team" --admin "admin@company.com"`

- [ ] **6.5 Verify deployment**
  - Web UI accessible
  - Auth working
  - Slack bot connecting
  - Agent execution via API
  - Conversation persistence
  - Vector memory search

---

## Build Order

```
Phase 0: Clone repo, clean up          ← Day 1
Phase 1: Database schema + Prisma      ← Day 1-2
Phase 2: API executor                  ← Day 2-3
Phase 3: Auth + multi-tenancy          ← Day 3-4
Phase 4: Rewrite API layer             ← Day 4-5
Phase 5: Push/pull endpoints           ← Day 5
Phase 6: Deploy to Railway             ← Day 5-6

Total: ~1 week to MVP
```

**MVP = Phases 0-4 + 6:** Team can sign in, chat with agents via Web UI and Slack, browse registry. Push/pull is a fast-follow.

---

## Open Questions

1. **Embedding model** — Use Anthropic's embeddings API or OpenAI's `text-embedding-3-small` for pgvector? OpenAI is cheaper and more common for embeddings.

2. **File tool sandboxing** — On the server, agents can't have free filesystem access. Options: (a) Docker containers per execution, (b) scoped to `/data/{tenantId}/{agentId}/` directory, (c) disable file tools entirely and rely on MCP for data access.

3. **Workspace concept** — Locally, workspace = directory on disk. On server, workspace = what? A mounted volume? A Git repo clone? Needs definition.

4. **Slack multi-tenant** — One Slack app per tenant, or one shared Slack app with tenant routing? Per-tenant is cleaner but requires each tenant to install their own app.

5. **Rate limiting** — Anthropic API has rate limits. Need queue/throttle for concurrent executions. Per-tenant rate limits too?

6. **Billing** — Track token usage per tenant for cost recovery? Not MVP but schema should support it (already has `Message.cost`).

7. **Background jobs** — Cron/goals on the server need a job scheduler. Use node-cron (already exists) or a proper queue (Bull/BullMQ with Redis)?
