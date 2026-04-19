# AI Gym — Build Plan

> Explicit task checklist from MVP through P2. Each item is a discrete, completable unit of work.
> Phases are concentric circles — each is a shippable product. Never start a phase until the previous is working end-to-end.

**Status key:** `[ ]` not started · `[~]` in progress · `[x]` done

---

## Phase 0 — MCP Foundation
> Prerequisite for everything. The gym agent is MCP-first — these tools must exist before the agent can do anything useful.

### New API Endpoints (`src/web-ui.ts` or new `src/gym/gym-router.ts`)

- [x] `GET /api/agents/:id/logs` — paginated conversation log for one agent (newest first, limit/offset params)
- [x] `GET /api/agents/:id/activity-summary` — aggregated summary: message count, active days, topics (array), tool use counts, last active timestamp
- [x] `GET /api/agents/logs/search?q=&agentIds=` — full-text search across agent logs
- [x] `GET /api/gym/plan` — return `agents/platform/gym/memory/plan.json`
- [x] `PUT /api/gym/plan` — write `agents/platform/gym/memory/plan.json`
- [x] `GET /api/gym/progress` — return `agents/platform/gym/memory/program-progress.json`
- [x] `PUT /api/gym/progress` — write `agents/platform/gym/memory/program-progress.json`
- [x] `GET /api/gym/cards` — return current gym cards array
- [x] `POST /api/gym/cards` — append a new gym card
- [x] `DELETE /api/gym/cards/:id` — dismiss a card
- [x] `POST /api/gym/dimensions/snapshot` — append weekly dimension scores to `dimension-history.json`
- [x] `GET /api/gym/programs` — list all programs (bundled + user-created)
- [x] `GET /api/gym/programs/:slug` — get full program with modules + steps
- [x] `POST /api/gym/programs` — create a new program
- [x] `PATCH /api/gym/programs/:id` — update program metadata
- [x] `DELETE /api/gym/programs/:id` — delete a program
- [x] `POST /api/gym/programs/import-markdown` — parse markdown into Program→Module→Step and save

### New MCP Tools (`server/mcp-server/index.ts`)

- [x] `get_agent_logs` — wraps `GET /api/agents/:id/logs`
- [x] `get_agent_activity_summary` — wraps `GET /api/agents/:id/activity-summary`
- [x] `search_agent_logs` — wraps `GET /api/agents/logs/search`
- [x] `get_plan` — wraps `GET /api/gym/plan`
- [x] `update_plan` — wraps `PUT /api/gym/plan`
- [x] `get_gym_progress` — wraps `GET /api/gym/progress`
- [x] `update_gym_progress` — wraps `PUT /api/gym/progress`
- [x] `list_gym_cards` — wraps `GET /api/gym/cards`
- [x] `create_gym_card` — wraps `POST /api/gym/cards`
- [x] `dismiss_gym_card` — wraps `DELETE /api/gym/cards/:id`
- [x] `snapshot_dimensions` — wraps `POST /api/gym/dimensions/snapshot`
- [x] `list_gym_programs` — wraps `GET /api/gym/programs`
- [x] `get_gym_program` — wraps `GET /api/gym/programs/:slug`
- [x] `import_program` — wraps `POST /api/gym/programs/import-markdown`

### Data Files (created on first `gymEnabled: true`)

- [x] `agents/platform/gym/memory/learner-profile.json` — initialized with empty schema on onboarding complete
- [x] `agents/platform/gym/memory/plan.json` — initialized after onboarding Step 3
- [x] `agents/platform/gym/memory/program-progress.json` — empty object `{}`
- [x] `agents/platform/gym/memory/gym-cards.json` — empty array `[]`
- [x] `agents/platform/gym/memory/dimension-history.json` — empty array `[]`

---

## MVP — The Core Loop
> Shippable product. Delivers: meet your trainer → get profiled → follow a program → coach watches and adapts.

### 1. Gym Subfolder Setup

- [x] Create `src/gym/` directory
- [x] Create `src/gym/index.ts` — exports all gym registrations (agent, routes, MCP tools, cron)
- [x] Soul.md loading implemented in `src/executor.ts` (both regular and streaming paths) — reads `selectedTrainer` from learner-profile.json, prepends `souls/<name>.md`
- [x] Create `src/gym/gym-router.ts` — all `/api/gym/*` route handlers (imports Phase 0 endpoint logic)
- [x] MCP tool definitions live in `server/mcp-server/index.ts` (co-located with other platform MCP tools)
- [x] Create `src/gym/activity-digest.ts` — scheduled digest goal runner
- [x] Create `src/gym/dimension-scorer.ts` — dimension scoring logic
- [x] Markdown parser + import logic implemented inline in `gym-router.ts` (POST /api/gym/programs/import-markdown)
- [x] Onboarding state machine implemented in `public/gym.html` JavaScript (3-step flow with API calls)
- [x] Update `src/web-ui.ts` — import and mount `src/gym/index.ts` when `gymEnabled: true`; no inline gym logic
- [x] Update `server/mcp-server/index.ts` — all gym MCP tools registered

### 2. Feature Flag

- [x] Add `gymEnabled: false` to `config.json` and `config.example.json`
- [x] Add `aibriefingEnabled: false` to `config.json` and `config.example.json` (Feed: AI Briefing off by default)
- [x] Gate gym agent registration behind `gymEnabled`
- [x] Gate `/gym` nav item behind `gymEnabled`
- [x] Gate activity digest cron job behind `gymEnabled`
- [x] Gate all `/api/gym/*` routes behind `gymEnabled`

### 3. Gym Agent

- [x] Create `agents/platform/gym/agent.json` with all fields (`id: "gym"`, `class: "gym"`, `advancedMemory: true`, `wiki: true`, `persistentSession: true`, full `allowedTools`, `mcps: ["myaiforone"]`, `featureFlag: "gymEnabled"`)
- [x] Create `agents/platform/gym/CLAUDE.md` — core coaching logic:
  - [x] Assessment methodology section (how to score dimensions from activity patterns)
  - [x] Recommendation engine section (capability gap → program mapping)
  - [x] Verification approach section (how to use MCP tools to check step completion)
  - [x] Proactive insight patterns section
  - [x] Plan management section (how to read/write plan.json via `get_plan` / `update_plan`)
  - [x] MCP-first instruction: always reach for MCP tools before file tools
- [x] Create `agents/platform/gym/souls/alex.md` — Alex personality layer
- [x] Create `agents/platform/gym/souls/jordan.md` — Jordan personality layer
- [x] Create `agents/platform/gym/souls/morgan.md` — Morgan personality layer
- [x] Create `agents/platform/gym/souls/riley.md` — Riley personality layer
- [x] Create `agents/platform/gym/souls/sam.md` — Sam personality layer
- [x] Implement soul.md loading in `src/executor.ts`: read `selectedTrainer` from `learner-profile.json`, prepend `souls/<name>.md` before `CLAUDE.md` at spawn time

### 4. Onboarding Flow

- [x] Design onboarding state: `{ step: 0|1|2|3, complete: boolean }` stored in `learner-profile.json`
- [x] **Step 1 — Choose Trainer**: UI card picker (5 trainer cards with avatar + name + intro quote)
  - [x] Trainer card component (avatar, name, intro text)
  - [x] Selection writes `selectedTrainer` to `learner-profile.json` via `PUT /api/gym/learner-profile`
  - [x] Avatar placeholder SVGs at `public/trainers/alex.svg` (etc.)
- [x] **Step 2 — Get to Know You**: coach sends the one-question prompt once trainer is selected
  - [x] Onboarding shows trainer's fullQuote message in step 2
  - [x] User response sent to gym agent via `POST /api/chat/gym/stream`
  - [x] Coach processes response and populates `identity` fields in learner profile
- [x] **Step 3 — Get Your Plan**: coach generates plan via SSE stream, writes via `update_plan`
  - [x] Plan displayed with two-bucket structure (on-the-job + platform-driven)
  - [x] Onboarding marked complete; gym main view unlocked
- [x] Gate gym main view behind `onboardingComplete: true` — incomplete users always land in onboarding

### 5. Learner Profile

- [x] Add `GET /api/gym/learner-profile` endpoint
- [x] Add `PUT /api/gym/learner-profile` endpoint
- [x] Add `get_learner_profile` MCP tool
- [x] Add `update_learner_profile` MCP tool
- [x] Initialize `learner-profile.json` with full schema (identity, activity, features, patterns, programs, streak, dimensions, selectedTrainer) on first gym activation

### 6. Getting Started Program

- [x] Create `agents/platform/gym/programs/getting-started/program.json` with metadata (title, slug, difficulty: beginner, tier: free, isPublic: true)
- [x] Module 1: Meet Your AI
  - [x] Step 1: What is an agent? (knowledge verification — coach asks 2 comprehension questions)
  - [x] Step 2: Your first conversation (platform-check — verify ≥5 messages sent to any agent)
- [x] Module 2: Give It Context
  - [x] Step 1: What makes a good prompt? (knowledge verification)
  - [x] Step 2: Try a detailed prompt (self-report — user marks done after attempting)
  - [x] Step 3: Upload a file to your agent (platform-check — verify file upload used)
- [x] Module 3: Make It Yours
  - [x] Step 1: Create a specialized agent (platform-check — verify new agent exists in `list_agents`)
  - [x] Step 2: Write a system prompt for it (platform-check — coach reads the agent's CLAUDE.md via `get_agent` and evaluates length/quality)
- [x] Program pre-seeded in `agents/platform/gym/programs/getting-started/`

### 7. Activity Digest

- [x] Implement `src/gym/activity-digest.ts`:
  - [x] Scheduled cron: `0 6 * * *` (daily 6am), only runs if `gymEnabled: true`
  - [x] Step 1: Scan agent directories — get full agent roster
  - [x] Step 2: For each agent, call `GET /api/agents/:id/activity-summary` — get aggregated stats
  - [x] Step 3: Read agent.json configs for building/automation scoring
  - [x] Step 4: Score dimensions based on observed patterns (use `dimension-scorer.ts`)
  - [x] Step 5: Call `POST /api/gym/dimensions/snapshot` if ≥7 days since last snapshot
  - [x] Step 6: Write digest to `agents/platform/gym/memory/daily/<date>.md`
  - [x] Step 7: Call `PUT /api/gym/learner-profile` with updated `activity`, `features`, `patterns`, `dimensions`, `streak`
  - [x] Step 8: Generate 2–3 gym cards; call `POST /api/gym/cards` for each
- [x] Implement `src/gym/dimension-scorer.ts`:
  - [x] `scoreAnalysis(activitySummaries)` — frequency, breadth, session depth
  - [x] `scoreCommunication(logSamples)` — tool diversity, topic breadth, depth signals
  - [x] `scoreKnowledge(profile, programProgress)` — program completions, engagement breadth
  - [x] `scoreAutomation(agentList)` — goals, cron, MCPs, multi-agent patterns
  - [x] `scoreBuilding(agentList)` — agents created, system prompt quality, MCP configs, tool configs

### 8. /gym Page — UI

- [x] Add `/gym` route to frontend, gated by `gymEnabled`
- [x] Add **Gym** item to main nav (gated)
- [x] **Onboarding view** — full-screen 3-step flow (shown when `onboardingComplete: false`)
- [x] **Main gym layout** — left sidebar + main panel + bottom feed strip
- [x] **Left sidebar**:
  - [x] Program list with progress indicators (✓ complete, N/M in progress, ○ not started)
  - [x] Gym cards section (2–3 cards, each with title + short description + CTA button)
  - [x] "New card" badge when digest has generated something new
- [x] **Main panel — Coach tab**:
  - [x] Chat interface with the gym agent (SSE streaming via `POST /api/chat/gym/stream`)
  - [x] Trainer name + avatar shown in chat header
- [x] **Main panel — Progress tab**:
  - [x] Radar/spider chart — 5 dimensions, current scores (SVG-based)
  - [x] Dimension breakdown list — progress bar + score + label + trend arrow per dimension
  - [x] "Next focus" callout — lowest-score dimension with guidance text
  - [x] Milestones list — chronological achievements
  - [x] *(History line chart deferred to P1 — needs snapshot history to be meaningful)*
- [x] **Bottom feed strip** — placeholder bar for P1 (shows "Feed coming in P1")
- [x] **Streak counter** — shown in gym header (days active streak from learner profile)

### 9. Trainer Avatars

- [x] Create 5 placeholder avatar SVGs at `public/trainers/alex.svg`, `jordan.svg`, `morgan.svg`, `riley.svg`, `sam.svg`
  - [x] Consistent visual style — gradient circles with initials
  - [x] Color-coded per trainer (cyan, orange, purple, red, green)

---

## P1 — Depth
> Everything a user needs to keep growing after Getting Started. Coach gets smarter. Program library fills out. Feed activates.

### 1. Remaining Bundled Programs

- [x] **Prompt Engineering** (intermediate)
  - [x] Module 1: Context and specificity
  - [x] Module 2: System prompts
  - [x] Module 3: Iterating and debugging prompts
  - [x] All steps with platform-check or knowledge verification
- [x] **Agent Building** (intermediate)
  - [x] Module 1: Anatomy of an agent
  - [x] Module 2: Create your first specialized agent
  - [x] Module 3: Writing an effective system prompt
  - [x] Module 4: Tools and workspace setup
- [x] **Automations Mastery** (intermediate)
  - [x] Module 1: Goals and scheduled tasks (cron)
  - [x] Module 2: Agent-to-agent delegation
  - [x] Module 3: Building a workflow that runs while you sleep
- [x] **MCP Integrations** (advanced)
  - [x] Module 1: What MCPs enable
  - [x] Module 2: Connecting your first MCP
  - [x] Module 3: Building an agent workflow with external APIs
- [x] **Multi-Model Strategy** (advanced)
  - [x] Module 1: Model landscape (Claude, GPT, Gemini, Groq, local)
  - [x] Module 2: When to use which model
  - [x] Module 3: Switching and comparing models on the platform

### 2. AI Program Generator

- [x] Port `AIGenerator.jsx` conversation flow to local gym (or build equivalent in gym chat)
- [x] Coach enters "program generation mode" when user says "create a program" or similar
- [x] Structured conversation: scope → skill level → time budget → generate
- [x] Coach outputs markdown in H1/H2/H3 format: `# Program`, `## Module N: Title`, `### Step N: Title`
- [x] Preview step: coach shows parsed structure (program title, module list, step count)
- [x] User confirms → coach calls `import_program` MCP tool → program added to gym
- [x] Program appears in sidebar program list immediately

### 3. All Verification Types Wired

- [x] `knowledge` verification: coach asks 2–3 targeted comprehension questions after step content, evaluates answers, decides pass/fail, marks step complete via `update_gym_progress`
- [x] `platform-check` verification: coach calls appropriate MCP tool per step's `check` field, evaluates result, marks step complete
  - [x] `new-agent-exists`: `list_agents` before/after
  - [x] `agent-has-custom-prompt`: `get_agent` → read CLAUDE.md path → evaluate length + content
  - [x] `automation-exists`: `list_agents` → check goals/cron arrays
  - [x] `mcp-configured`: `list_agents` → check mcps array
  - [x] `feature-used`: `get_agent_activity_summary` → check features.used array

### 4. Continuous Coaching

- [x] **Struggle detection** in `activity-digest.ts`:
  - [x] Detect sessions ending with "never mind", "I'll do it manually", "forget it" patterns
  - [x] Detect high correction rate (>4 back-and-forth before resolution)
  - [x] Write detected struggles to `patterns.struggles` in learner profile
  - [x] Generate gym card with specific suggestion when struggle detected
- [x] **Capability gap analysis** in `activity-digest.ts`:
  - [x] Compare `features.used` vs full platform feature list
  - [x] Identify highest-value unused capability based on current usage patterns
  - [x] Generate gym card for top gap (max 1 per digest to avoid noise)

### 5. Progress History Chart

- [x] Confirm `dimension-history.json` accumulates weekly snapshots
- [x] Add line chart component to Progress tab (renders dimension scores over time, one line per dimension, color-coded)
- [x] Show empty state: "Your progress chart will fill in as weeks go by"

### 6. The Feed

- [x] **Platform Updates**: read changelog / version notes → surface "new capability" cards to users likely to care (filter by relevant `features.neverUsed`)
  - [x] `GET /api/changelog` endpoint that returns recent platform updates
  - [x] Match updates to learner profile: only show if the capability is in `features.neverUsed`
- [x] **Tips**: contextual nudges generated by activity digest — idle agents, usage plateaus, etc.
  - [x] Tips generated in `activity-digest.ts` alongside gym cards but tagged `type: "tip"` for Feed
  - [x] Rendered in the bottom Feed strip
- [x] **AI Briefing** (requires `aibriefingEnabled: true` in config + web search MCP configured):
  - [x] Briefing data read from `agents/platform/gym/memory/briefing.json`
  - [x] Rendered in Feed strip under "AI Briefing" tab
  - [x] Clear "off by default" messaging in UI
- [x] Feed UI strip — bottom panel with 3 tabs: **Tips** · **Platform Updates** · **Briefing**
- [x] `GET /api/gym/feed` aggregator endpoint

### 7. Gym-Only Mode

- [x] Add `gymOnlyMode` to ServiceConfig interface in `config.ts`
- [x] When `gymOnlyMode: true`: set landing page to `/gym` instead of `/home`
- [x] When `gymOnlyMode: true`: nav shows only **Gym** · **Agents** · **Settings**
- [x] Other pages remain accessible via direct URL
- [x] `GET /api/gym/config` returns gymOnlyMode flag for frontend

---

## P2 — Reach
> Programs leave the gym and travel. Other people can install programs. Gym becomes a network effect.

### 1. Marketplace — Programs

- [ ] Add `isMarketplaceListed: boolean` and `isPublic: boolean` to program schema
- [ ] `GET /api/marketplace/programs` — list all public marketplace programs (across all users, SaaS; from a directory on local)
- [ ] Marketplace browse page (`/marketplace/programs`):
  - [ ] Grid of program cards: title, description, author, dimension tags, difficulty, step count
  - [ ] Filter by: dimension, difficulty, topic, trainer compatibility, tier
  - [ ] Search
- [ ] Program install flow:
  - [ ] "Install" button on program card
  - [ ] Copies program into user's gym via `POST /api/gym/programs` (deep copy, not a reference)
  - [ ] Installed program appears in sidebar program list
- [ ] Author attribution: `createdBy: { name, orgName }` on program cards
- [ ] "Publish to marketplace" option in program settings (sets `isMarketplaceListed: true`)

### 2. Trainer Variations in Programs

- [ ] Support `trainerVariations: { [trainerId]: string }` field on steps
- [ ] When rendering a step, check if `trainerVariations[selectedTrainer]` exists — use it if so, fall back to base `content`
- [ ] Program editor / AI generator can optionally generate trainer-specific variants
- [ ] Marketplace programs that include trainer variations show a "Trainer-optimized" badge

### 3. Channel Notifications

- [ ] Opt-in setting per user: `gymNotifications: { enabled: false, channel: "slack"|"telegram"|"discord"|null }`
- [ ] When enabled, activity digest can send a brief summary to the configured channel after running
  - [ ] "Here's your weekly gym update: Your Analysis score went up. You have a new challenge from Riley."
- [ ] Coach can send a nudge if user hasn't been active for 3+ days (once, not repeatedly)
- [ ] Notification channel set in gym settings UI

### 4. Gamification

- [ ] **Badges**: defined set of achievement badges
  - [ ] "First Steps" — complete Getting Started program
  - [ ] "Prompt Pro" — reach Communication score 4+
  - [ ] "Builder" — create 3+ specialized agents
  - [ ] "Automator" — set up first automation
  - [ ] "Streak: 7 Days", "Streak: 30 Days"
  - [ ] "Program Creator" — author + publish a program to marketplace
- [ ] Badge awarded by digest when condition first detected → stored in `learner-profile.json`
- [ ] Badges displayed on Progress tab below milestones
- [ ] Badge unlock shown as a gym card ("You earned: Builder 🏗️")

### 5. Program Export / Share

- [ ] `GET /api/gym/programs/:id/export` — returns program as formatted markdown (H1/H2/H3)
- [ ] "Export" button in program detail view
- [ ] "Share link" — generates a deep link to install the program (local: imports from exported markdown; SaaS: link to marketplace listing)

---

## Notes

- **Order within phases matters.** In MVP: Phase 0 MCP foundation first, then gym agent + souls, then onboarding, then the page. Don't build UI before the agent exists.
- **Programs are seeded on first `gymEnabled: true`.** Getting Started imports automatically. Subsequent bundled programs import in P1.
- **The Feed strip** can be a stub (empty) in MVP with a placeholder — real content in P1.
- **Avatar images** are blocked on having art. Use placeholders (initials on colored backgrounds) for MVP; replace with final illustrated avatars when ready.
- **`aibriefingEnabled`** is off by default and stays off until user explicitly opts in. Never run a web search without the flag.
- **SaaS porting note:** After MVP commit, flag for @ma41saas — the gym is a significant feature that will need adaptation (Prisma tables for programs/progress/cards, multi-user learner profiles, auth-gated gym routes).
