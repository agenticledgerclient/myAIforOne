# AI Gym — Architecture & Design Document

> Personal AI trainer that lives inside your agent platform. Learns from your actual usage, delivers personalized training, and keeps you current on AI — all from one place.

---

## Table of Contents

1. [Concept](#1-concept)
2. [Strategic Position](#2-strategic-position)
3. [Onboarding Flow](#3-onboarding-flow)
4. [Gym Coach Agent](#4-gym-coach-agent)
5. [Directory Structure](#5-directory-structure)
6. [Learner Profile](#6-learner-profile)
7. [AI Strength Dimensions](#7-ai-strength-dimensions)
8. [RAG Pipeline — How the Coach Sees Everything](#8-rag-pipeline--how-the-coach-sees-everything)
9. [Programs (Structured Training)](#9-programs-structured-training)
10. [Continuous Coaching (Ongoing Personalized Mode)](#10-continuous-coaching-ongoing-personalized-mode)
11. [The Feed (News + Updates)](#11-the-feed-news--updates)
12. [UI — The /gym Page](#12-ui--the-gym-page)
13. [Feature Flag & Gym-Only Mode](#13-feature-flag--gym-only-mode)
14. [What Needs Building](#14-what-needs-building)
15. [Profile/Auth Decision (Resolved)](#15-profileauth-decision-resolved)
16. [Open Questions](#16-open-questions)

---

## 1. Concept

The AI Gym is a personal AI growth area built into the MyAI for One platform. It is **not** a course platform — it's a coach that lives inside your actual AI workspace.

### Core Insight

Learning AI and using AI are the same motion. The gym isn't a separate product — it's an on-ramp. Someone starts with a guided program, and by the end they've built the muscle memory of actually using agents. They graduate from "gym member" to "power user" without a context switch.

### What Makes It Different

Traditional AI training: "Here's a course. Go through it. Done."

The AI Gym: A coach agent that **observes your real platform activity** across all your agents, understands your skill level and work patterns, and generates personalized training — continuously, not just once.

Nobody else has a coach that lives inside your actual AI workspace and sees everything you do. That's the moat.

---

## 2. Strategic Position

### As a Distribution Channel

The gym is a way to distribute the MyAI for One platform itself. The training *is* the product usage.

- **Gym-only install**: Someone installs MyAI for One purely for AI training. The gym is the front door. As they progress, they naturally discover "wait, I can just *keep* using these agents for my real work."
- **Shareable programs**: A trainer creates a program, exports it, shares it. The recipient installs the platform to run it.
- **Lead flow**: Training on AI → Using AI tools → Power user. The gym is the top of the funnel.

### Standalone vs Integrated

- Some users use the **full platform** (agents, channels, automations) and the gym is an added growth area
- Some users use **only the gym** — they installed for training and may or may not expand into the full platform
- Both are valid. The gym should work as a standalone experience or as part of the full platform.

---

## 3. Onboarding Flow

The gym's entry point is a three-step onboarding flow. It runs once on first activation and gates access to the main gym experience until complete.

```
Step 1 — Choose Your Trainer
Step 2 — Get to Know You
Step 3 — Get Your Plan
```

---

### Step 1 — Choose Your Trainer

The user selects one of **5 trainer profiles**. Each profile is a named persona with a fixed personality, communication style, and pace. The selection UI shows each trainer as a card: name, avatar, and a short first-person intro — enough to feel like a real person, not a feature matrix.

Pacing and tone are baked into each profile. There are no separate dropdowns or configuration steps. Pick the person you want coaching you.

---

#### The 5 Trainers

**Alex** *(Collaborative · Steady)*
> "Hey, I'm Alex. I work right alongside you — we figure things out together. I'm not here to lecture you; I'm here to build with you. Expect a consistent pace, real progress every session, and a lot of high-fives along the way."

**Jordan** *(Direct · Steady)*
> "I'm Jordan. I'm direct, I don't sugarcoat, and I'll hold you accountable. We set a goal, we hit it. I'll tell you exactly what to work on and call you out when you're avoiding the hard stuff. Steady, focused work — that's how you actually get good at this."

**Morgan** *(Thoughtful · Steady)*
> "I'm Morgan. I care a lot about the 'why.' I won't just show you what to click — I'll make sure you understand what's actually happening and why it matters. We'll take things one layer at a time, and when we're done you'll have real understanding, not just checked boxes."

**Riley** *(Challenging · Immersive)*
> "I'm Riley. I'm going to push you — hard questions, uncomfortable exercises, things you'll want to skip. That's exactly where we're going. When you're with me, we go deep and fast. You'll surprise yourself with what you can do when someone actually expects it of you."

**Sam** *(Patient · Steady)*
> "I'm Sam. I meet you exactly where you are — no pressure, no judgment. Brand new? Fine. Tried before and it didn't stick? Also fine. We go at your pace. One thing at a time, building from what you already know. Nothing overwhelming, ever."

---

Each trainer has a corresponding avatar image (illustrated, not photorealistic). Avatar files live at `public/trainers/<name>.png`. The selection card shows the avatar, the trainer's name, and their intro.

Users can switch trainers at any time. Their plan, progress, and history are untouched — only the coaching voice changes.

**Implementation:** Each trainer profile is a `soul.md` file — the personality layer of the gym agent's system prompt. Switching trainers = swapping which `soul.md` is active. Base coaching logic (methodology, verification, RAG) lives in `CLAUDE.md` and never changes.

---

### Step 2 — Get to Know You

Once a trainer is selected, the agent sends a **single conversational message** — not a form or questionnaire. It covers three topics and invites the user to respond however they want, in one go.

**The Three Topics:**
1. **About You (professional)** — User shares LinkedIn, Twitter, or any links. Agent reads and builds a profile passively. User can review and edit. Goal: professional context and background. Nothing personal.
2. **Your AI Use** — Where are you today? Heavy user with real workflows? Curious beginner? User describes in their own words with an example.
3. **Your Goals** — What do you want out of AI? More productive at work? Build something? Just not feel left behind?

**The One-Question Prompt:**
> "Before we get started, tell me a bit about yourself — I'll use this to make everything we do together actually useful to you. You can share things like: your LinkedIn or any links (I'll read them), what you do for work, where you are with AI right now (total beginner, dabbler, daily user — give me an example), and what you're hoping to get out of this. One message, however you want to write it."

The agent processes the response, builds the learner profile, and confirms back with a brief summary before moving to the plan.

---

### Step 3 — The Plan

The plan is a **real, visible, living document** — not a background concept. It has its own section in the gym UI. Users can see it, the gym agent updates it continuously, and the user can edit it too.

The plan always has two buckets:

**Bucket 1 — On the Job Training (User-Driven)**
The user brings their real work to the platform. The gym agent observes, assists, suggests, and tracks skill development as a byproduct of actual usage. Learning by doing. Value is delivered immediately — they're not studying AI, they're using AI to get things done, and the gym is tracking the growth in the background.

**Bucket 2 — Platform-Driven**

Two sub-buckets:
- **Textbook** — Curated modules: read this article, watch this video, learn this concept. Structured, sequenced content for foundational knowledge.
- **Dynamic** — Personalized suggestions based on observed platform activity. If the user did something with Excel through the platform, and the gym agent knows a Claude + Excel technique they haven't seen, it surfaces it as a training moment. Reactive, contextual, continuously generated.

**Plan properties:**
- Created at end of onboarding, seeded from the user profile built in Step 2
- Updated continuously by the gym agent as usage patterns emerge
- User can add goals, mark things done, or reorder priorities
- Tracks: mastered skills, in-progress learning, suggested next steps, wins/milestones
- Will have dedicated APIs and MCP tools for read/write access
- The bucket structure (on-the-job vs. platform-driven / textbook vs. dynamic) is preserved as the organizing frame — always visible in the UI

---

## 4. Gym Coach Agent

The gym coach is a **gym-class agent** — a distinct class separate from personal agents and platform agents. Like platform agents (e.g., Hub), it ships with the platform and is not user-deletable. Unlike platform agents, it is gated behind a feature flag and has a user-facing personality layer (`soul.md`) that can be swapped without touching core coaching logic.

> **Class decision:** The onboarding doc introduced "gym" as a third agent class. The architecture doc previously said `class: "platform"`. Current working resolution: use `class: "gym"` in `agent.json` and treat gym-class agents as a sub-type of platform agents — same elevated access and ship-with-platform rules, but distinct in that they have a `soul.md` personality layer and are feature-flagged. This needs final confirmation before implementation.

### agent.json

```json
{
  "id": "gym",
  "name": "AI Gym Coach",
  "alias": "gym",
  "class": "gym",
  "workspace": "~",
  "advancedMemory": true,
  "wiki": true,
  "persistentSession": true,
  "allowedTools": ["Read", "Glob", "Grep", "Write", "Bash"],
  "mcps": ["myaiforone"],
  "featureFlag": "gymEnabled"
}
```

### Why These Settings

| Setting | Reason |
|---------|--------|
| `class: "gym"` | Naming convention only (same executor behavior as platform agents). Marks agent as non-deletable by users and feature-flag gated. Formalize as a real class later if a second gym-type agent is needed. |
| `advancedMemory: true` | Daily journals + vector embeddings. This is how the coach builds long-term understanding of you over weeks and months. |
| `wiki: true` | Learns facts from conversations. When you tell the coach "I work in finance" or "I'm intermediate with Python", it saves to `learned.md`. |
| `persistentSession: true` | Coaching is a continuous relationship, not one-off Q&A. Session persists across visits. |
| `allowedTools: [Read, Glob, Grep, Write, Bash]` | Full standard tool set — same baseline as any capable agent on the platform. The coach's **first-choice** for all data access is MCP tools (see §8 Layer 3/4). Direct file tools are a fallback for edge cases not yet covered by MCP, and for writing to its own memory directory. |
| `mcps: ["myaiforone"]` | Full platform MCP access. Primary interface for all agent data: `list_agents`, `get_agent`, `get_agent_logs`, `get_agent_activity_summary`, gym plan/progress/cards, and program CRUD. |

### Code Structure — Gym Subfolder

All gym-specific code lives under `src/gym/` and is imported where needed by the rest of the platform. Nothing gym-related is scattered across the main `src/` files.

```
src/gym/
├── gym-agent.ts          ← gym agent registration + soul.md loading logic
├── gym-router.ts         ← /api/gym/* route handlers (plan, progress, cards, programs)
├── gym-mcp-tools.ts      ← MCP tool definitions for gym-specific tools
├── activity-digest.ts    ← scheduled digest goal: reads agent summaries, updates profile
├── dimension-scorer.ts   ← dimension scoring logic from activity patterns
├── program-importer.ts   ← markdown → Program/Module/Step parser + import
└── onboarding.ts         ← onboarding flow state machine (3 steps)
```

Platform files (`src/web-ui.ts`, `src/mcp-server/index.ts`, etc.) import from `src/gym/` only at registration points — they don't contain gym logic inline. The gym feature flag gates all registrations; when `gymEnabled: false`, nothing in `src/gym/` runs.

---

### System Prompt Architecture

The gym agent's prompt is split into two layers:

**`CLAUDE.md` — Core coaching logic (never changes)**
- Assessment methodology — how to evaluate skill level from activity patterns
- Recommendation engine — rules for matching capability gaps to training modules
- Verification approach — how to check exercise completion via MCP tools
- Proactive insight generation — patterns to watch for in activity digests
- Plan management — how to read/write the living plan document

**`soul.md` — Personality layer (swappable per trainer profile)**
- Tone, voice, and communication style
- Pacing philosophy (steady vs. immersive)
- How the trainer opens sessions, delivers feedback, celebrates wins
- One `soul.md` per trainer profile; active file is symlinked or referenced at agent startup

---

## 5. Directory Structure

```
agents/platform/gym/
├── agent.json                  ← Gym agent config (class: "gym")
├── CLAUDE.md                   ← Core coaching logic (never changes)
├── souls/                      ← Trainer personality files
│   ├── alex.md                 ← Alex — collaborative, steady
│   ├── jordan.md               ← Jordan — direct, accountable, steady
│   ├── morgan.md               ← Morgan — thoughtful, frameworks-first, steady
│   ├── riley.md                ← Riley — challenging, immersive
│   └── sam.md                  ← Sam — patient, no pressure, steady
├── memory/
│   ├── conversation_log.jsonl  ← Coach conversation history
│   ├── context.md              ← Persistent coaching context
│   ├── learned.md              ← Wiki: facts learned from conversations
│   ├── learner-profile.json    ← User's skill map, patterns, preferences
│   ├── plan.md                 ← Living plan document (two-bucket structure)
│   ├── program-progress.json   ← Program/module completion state
│   ├── daily/                  ← Advanced memory journals (auto-generated)
│   └── embeddings/             ← Vector index for RAG search
└── programs/                   ← Bundled training programs
    ├── getting-started/
    │   ├── program.json
    │   └── modules/
    │       ├── 01-meet-your-ai.md
    │       ├── 02-first-conversation.md
    │       ├── 03-give-it-context.md
    │       └── ...
    ├── prompt-engineering/
    │   ├── program.json
    │   └── modules/
    ├── agent-building/
    │   ├── program.json
    │   └── modules/
    ├── automations-mastery/
    │   ├── program.json
    │   └── modules/
    └── mcp-integrations/
        ├── program.json
        └── modules/
```

---

## 6. Learner Profile

The learner profile is the core data structure that makes everything personalized. It's updated by both the scheduled activity digest and direct coaching conversations.

### Schema

```json
{
  "version": 1,
  "createdAt": "2026-04-08T00:00:00Z",
  "updatedAt": "2026-04-08T18:00:00Z",

  "identity": {
    "skillLevel": "intermediate",
    "role": "fintech product manager",
    "interests": ["automation", "finance", "team productivity"],
    "learningStyle": "hands-on",
    "prefersConcise": true,
    "notes": "Works in fintech. Prefers concise explanations. Visual learner."
  },

  "activity": {
    "activeAgents": ["coder", "researcher", "writer"],
    "dormantAgents": ["ops", "designer"],
    "totalMessages": 1247,
    "messagesThisWeek": 83,
    "mostActiveDay": "tuesday",
    "averageSessionLength": "12min",
    "lastActivity": "2026-04-08T17:30:00Z"
  },

  "features": {
    "used": ["chat", "sessions", "file-upload", "canvas", "multi-provider"],
    "neverUsed": ["automations", "mcps", "delegation", "cron", "webhooks"],
    "recentlyDiscovered": ["multi-provider"]
  },

  "patterns": {
    "strengths": [
      "Good at crafting detailed prompts",
      "Uses file upload effectively with @coder"
    ],
    "struggles": [
      {
        "pattern": "Long back-and-forth with @coder on debugging",
        "suggestion": "Teach workspace setup + tool access for self-debugging",
        "firstSeen": "2026-03-20",
        "occurrences": 7
      },
      {
        "pattern": "Manually copies output from @researcher to @writer",
        "suggestion": "Teach delegation / agent-to-agent handoff",
        "firstSeen": "2026-04-01",
        "occurrences": 4
      }
    ]
  },

  "programs": {
    "completed": ["getting-started"],
    "current": {
      "programId": "agent-building",
      "currentStepId": "02-create-first-s2",
      "startedAt": "2026-04-05T10:00:00Z"
    },
    "recommended": ["automations-mastery", "mcp-integrations"]
  },

  "streak": {
    "current": 12,
    "longest": 18,
    "lastActiveDate": "2026-04-08"
  },

  "dimensions": {
    "application":   { "score": 3, "label": "Proficient", "trend": "up",     "lastUpdated": "2026-04-08" },
    "communication": { "score": 2, "label": "Developing", "trend": "stable", "lastUpdated": "2026-04-08" },
    "knowledge":     { "score": 3, "label": "Proficient", "trend": "up",     "lastUpdated": "2026-04-08" },
    "orchestration": { "score": 1, "label": "Beginner",   "trend": "stable", "lastUpdated": "2026-04-08" },
    "craft":         { "score": 2, "label": "Developing", "trend": "up",     "lastUpdated": "2026-04-08" }
  },

  "selectedTrainer": "alex"
}
```

### How It Gets Updated

| Source | What it updates |
|--------|----------------|
| Activity digest (scheduled) | `activity`, `features`, `patterns` |
| Direct coaching conversation | `identity`, `programs.current`, wiki facts |
| Program completion | `programs.completed`, `streak` |
| Coach observation | `patterns.strengths`, `patterns.struggles` |

---

## 7. AI Strength Dimensions

The learner profile is scored across **5 dimensions**. These are the axes that define what "AI skill" actually means. Together they give the coach — and the user — a clear picture of where they are and what to develop next.

Each dimension is scored **1–5**:

| Level | Label |
|-------|-------|
| 1 | Beginner |
| 2 | Developing |
| 3 | Proficient |
| 4 | Advanced |
| 5 | Expert |

---

### The 5 Dimensions

#### 1. Application
> *How deeply is AI integrated into your actual work?*

Are you reaching for your AI agents when a task comes up — or still defaulting to doing things manually? This is about **habit and reflex**, not knowledge. A score of 1 means occasional experimentation; a score of 5 means AI is your default tool for a broad range of real tasks.

**How it's measured:** Agent usage frequency, breadth of agents used, whether agents have real workspaces and real tasks vs toy usage, session depth.

**Gym guidance at low scores:** On-the-job training challenges — "bring your next real task here." The coach nudges toward substitution: replacing a manual workflow with an agent one.

---

#### 2. Communication
> *How effectively do you talk to AI?*

Prompting is a skill. This dimension tracks whether the user gives context, structures requests clearly, knows when to course-correct, and gets strong results without excessive back-and-forth. A score of 1 means short, vague prompts and frequent frustration; a score of 5 means precise, context-rich requests that produce great output on the first or second try.

**How it's measured:** Prompt length and specificity patterns, number of follow-up corrections per session, self-reported frustration signals ("that's not what I meant"), quality of instructions given to agents.

**Gym guidance at low scores:** Prompt engineering program. Micro-lessons on context, specificity, and structured requests.

---

#### 3. Knowledge
> *How much do you understand about AI — how it works, what it can and can't do?*

Core AI literacy. Does the user understand what a model is, how context windows work, what hallucination means, what MCPs and tools enable, how RAG works, what the current landscape looks like? This is the **conceptual foundation** that everything else builds on.

**How it's measured:** Program completion (especially foundational programs), question types asked to the coach (surface vs. deep), demonstrated understanding in conversations, self-reported experience level.

**Gym guidance at low scores:** Textbook modules. Curated explainers. Feed content prioritizes AI fundamentals.

---

#### 4. Orchestration
> *Can you design and run multi-agent, automated workflows?*

Beyond chatting with a single agent — can the user chain agents together, set up automations, delegate work, run scheduled tasks, and build workflows that operate without their constant involvement? This is where AI stops being a tool and starts being a workforce.

**How it's measured:** Use of goals/cron, delegation between agents, multi-agent session patterns, automation setup, whether agents are doing work while the user is offline.

**Gym guidance at low scores:** Automations Mastery program. Coach introduces the concept of "agents working for you, not with you."

---

#### 5. Craft
> *Can you build, configure, and tune AI systems from scratch?*

The builder dimension. Can the user create a specialized agent with a good system prompt, assign the right tools, wire up MCPs, set the correct workspace? This is about **AI system design** — knowing what to give an agent, what to withhold, and why.

**How it's measured:** Agents created, quality of system prompts written (coach reads and evaluates CLAUDE.md files), MCP configurations set up, tool selection choices, workspace assignments.

**Gym guidance at low scores:** Agent Building program. Coach reviews existing agents and suggests improvements to system prompts and tool configs.

---

### Dimension Scores in the Learner Profile

Dimension scores are stored in the `dimensions` field of `learner-profile.json` (see §6 for the full schema). `selectedTrainer` is also stored there — read at agent spawn time to load the correct `souls/<name>.md`.

**Trend values:** `up`, `down`, `stable` — based on delta between last two digest cycles. Weekly snapshots saved separately in `dimension-history.json` to power the progress history chart.

### How the Coach Uses Dimensions

- **Program recommendations** — each program maps to one or two primary dimensions. Low score → recommended program.
- **Gym card generation** — coach generates cards targeting the user's lowest dimension with the most activity (where coaching effort has highest ROI).
- **Plan structure** — the living plan is organized around dimension growth, not just task completion.
- **Progress story** — when the user asks "how am I doing?", the coach can give a dimensional answer: "Your Application and Knowledge are solid. Orchestration is where we should focus next."
- **Radar chart** — the `/gym` UI will visualize these 5 dimensions as a radar/spider chart — one glance shows the shape of your AI skill.

---

## 8. RAG Pipeline — How the Coach Sees Everything

The coach needs to understand your activity across all agents without loading every conversation into its context window. This is solved with a multi-layer RAG approach.

### Layer 1: Activity Ingestion (Scheduled)

A scheduled goal on the gym agent runs daily:

```
Goal: "activity-digest"
Schedule: "0 6 * * *" (daily at 6am)
Prompt: "Analyze platform activity since your last digest.
         Read conversation logs across all agents.
         Update the learner profile.
         Generate any new recommendations or gym cards."
```

What the digest does:

1. Calls `list_agents` MCP tool to get the full agent roster
2. For each agent, calls `get_agent_activity_summary` MCP tool (aggregated: message count, topics, tool use, last active) — avoids streaming full logs for every agent
3. For agents with notable activity or struggles, calls `get_agent_logs` for deeper pattern analysis
4. Summarizes patterns: which agents active, what topics, what tool use, what struggles
5. Calls `snapshot_dimensions` MCP tool to save a weekly dimension score checkpoint (for the progress history chart)
6. Writes the digest into its own `daily/` journal (advanced memory auto-embeds this)
7. Calls `update_profile` MCP tool to update the learner profile with new observations
8. Calls `create_gym_card` MCP tool for each new recommendation surfaced

### Layer 2: Vector Search Over History

The coach's `advancedMemory: true` setting means all daily digests are automatically embedded into its vector store. When the coach needs historical context:

- **"What has the user been doing this week?"** → vector search over recent daily journals
- **"When did the user last try automations?"** → vector search over older digests
- **"What programs match the user's current gaps?"** → vector search over program module content

### Layer 3: Cross-Agent Activity via MCP

All agent data access goes through **MCP tools and APIs** — no direct file reads on agent directories. This is the first-class approach for all current and future access patterns.

**Rationale:** Direct file access is a local-only shortcut. MCP tools give us a stable abstraction layer that works identically on local install and SaaS, and can be exposed externally in the future without rearchitecting the coach.

| Need | MCP Tool |
|------|----------|
| List all agents | `list_agents` |
| Get agent config (tools, MCPs, workspace) | `get_agent` |
| Get conversation logs for an agent | `get_agent_logs` *(new — see §14)* |
| Search across all agent logs | `search_agent_logs` *(new — see §14)* |
| Get activity summary for an agent | `get_agent_activity_summary` *(new — see §14)* |
| Verify user created an agent | `list_agents` (check for new entry) |
| Verify automation was set up | `list_automations` |
| Check what channels are active | `list_channels` |
| Read/write learner profile | `get_profile`, `update_profile` |
| Read/write gym plan | `get_plan`, `update_plan` *(new — see §14)* |

> **Performance note:** The activity digest calls `get_agent_logs` per agent — potentially many calls on an active install. To keep the digest fast, `get_agent_activity_summary` should return a pre-aggregated summary (message count, topics, tool use, last active) so the coach doesn't need to stream raw logs for every agent every day. Raw logs via `get_agent_logs` are reserved for deep-dive analysis on specific agents.

### Layer 4: Gym State via MCP

The coach's own data (plan, progress, profile) is also read/written via MCP tools — not via Write tool on files directly.

| Need | MCP Tool |
|------|----------|
| Read learner profile | `get_profile` |
| Update learner profile | `update_profile` |
| Read gym plan | `get_plan` *(new)* |
| Update gym plan | `update_plan` *(new)* |
| Read/write program progress | `get_gym_progress`, `update_gym_progress` *(new)* |
| Generate gym cards | `create_gym_card` *(new)* |

---

## 9. Programs (Structured Training)

Programs are the gym's formal curriculum. Each is a structured progression of modules, where each module contains a sequence of steps. This is a **three-level hierarchy**: Program → Module → Step.

> **Reference implementation:** The aigym-platform (`~/Desktop/APPs/aigym-platform`) has a working implementation of this schema with full CRUD APIs, an AI generator, a markdown importer, and progress tracking per step. The local gym should align with this schema so programs are portable between the two.

### Schema

```
Program
├── id, title, slug, description
├── tier: "free" | "pro"
├── difficulty: "beginner" | "intermediate" | "advanced"
├── estimatedTime
├── prerequisites: string[] (program slugs)
├── trainers: string[] (trainer IDs with persona variations, e.g. ["alex","riley"] — "personas" in aigym-platform)
├── isPublic: boolean
├── isMarketplaceListed: boolean  ← see Marketplace section below
└── modules: Module[]
    ├── id, title, description
    ├── position (display order)
    ├── agentInstructions (optional — hints for the gym coach on this module)
    └── steps: Step[]
        ├── id, title, content (markdown)
        ├── position
        ├── isCritical: boolean
        ├── trainerVariations: { [trainerId]: string }  ← per-trainer content variants (e.g. "riley": "...immersive version...") — "personaVariations" in aigym-platform
        └── verification: Verification
```

### Step Format

Each step's `content` field is markdown:

```markdown
## Create Your First Custom Agent

An agent is your AI teammate for a specific job. Instead of one general assistant
that does everything, you create focused agents: one for code review, one for
writing, one for research. Each gets its own context, tools, and personality.

### Exercise

Create a new agent for something you actually do at work. Ideas:
- A code reviewer for your main project
- A writing assistant with your style guidelines
- A research agent for your industry

Go to the Org page and click **+ New Agent**, or just tell me what you want
and I'll help you set it up right here.

### What I'll Check
I'll verify that a new agent appeared in your roster with a meaningful name
and at least a basic system prompt. Generic names like "test" don't count!
```

### Verification Types

Verification lives at the step level:

| Type | How it works |
|------|-------------|
| `knowledge` | Coach asks the user questions, evaluates understanding |
| `platform-check` | Coach calls MCP tools to verify platform state changed |
| `activity-check` | Coach calls `get_agent_activity_summary` to verify the user actually used a feature |
| `self-report` | User tells the coach they completed it (low-verification fallback) |

### AI Program Generation

Programs can be generated from a text description — no hand-authoring required.

The user describes what they want to learn in plain language (or voice). The gym coach runs a structured conversation to gather requirements, then generates the full program in markdown format. The markdown is parsed into Program → Module → Step objects and imported via API.

**Generation flow:**
1. User: "I want to learn how to use AI for research"
2. Coach gathers scope, skill level, and time budget via conversation
3. Coach generates structured markdown (H1 = Program, H2 = Module, H3 = Step)
4. Program is previewed, then imported via `POST /api/gym/programs/import-markdown`
5. Program appears in the user's plan

**Markdown format the generator outputs:**

```markdown
# Program Title
Brief description.

## Module 1: Module Title
Brief module description.

### Step 1: Step Title
Step content with detailed instructions, exercises, and verification criteria.

### Step 2: Step Title
...
```

This is the same pattern already implemented in aigym-platform's `AIGenerator.jsx` + `POST /api/programs/import-markdown`. The local gym implementation should follow the same contract.

### Marketplace

Programs are marketplace-eligible — alongside agents, prompts, and MCPs.

A program with `isMarketplaceListed: true` and `isPublic: true` appears in the marketplace:
- **Discovery:** Browse, search, filter by difficulty, dimension, topic, trainer compatibility
- **Install:** One-click import into the user's gym (copies the program, not a shared reference)
- **Author credit:** Creator's name and org shown on the program card
- **Tier:** `free` programs install with no gate; `pro` programs require a subscription (SaaS only for now)

This enables a creator ecosystem: a coach, educator, or power user authors a program, lists it in the marketplace, and other users install it. The program runs inside their local gym, coached by their trainer of choice.

> **Design note:** Program content is trainer-agnostic at the step level. Persona variations (`personaVariations` on steps) allow a program to ship with optional style variants per trainer — but the core content works with any trainer.

### Bundled Programs (Initial Set)

1. **Getting Started** — First agent, first conversation, basic platform orientation
2. **Prompt Engineering** — Writing effective prompts, system prompts, context management
3. **Agent Building** — Creating specialized agents, workspace setup, tool configuration
4. **Automations Mastery** — Goals, cron jobs, scheduled tasks, autonomous workflows
5. **MCP Integrations** — Connecting agents to external services, API tools
6. **Multi-Model Strategy** — When to use Claude vs OpenAI vs Groq vs local models

---

## 9. Continuous Coaching (Ongoing Personalized Mode)

This is the mode that keeps people coming back after they've "graduated" from programs. The coach generates contextual, timely insights based on real activity.

### How It Works

The coach doesn't wait for you to ask. It proactively generates recommendations:

**Missed capability detection:**
> "You're doing a lot of back-and-forth between @designer and @coder. Did you know you can set up delegation so @designer automatically hands off to @coder? Here's a 3-minute exercise."

**Depth opportunity:**
> "You've been using @researcher for basic Q&A for 2 weeks, but you've never used file uploads or given it MCP tools. Want to try giving it Google Drive access? That would let it pull source material directly."

**New capability alert:**
> "New: you can now run some agents on Groq for free. Your @qa-helper agent mostly does simple text tasks — want to try switching it to Groq and see if the quality holds?"

**Struggle detection:**
> "I noticed your last 3 conversations with @coder ended with you saying 'never mind, I'll do it manually.' Let's figure out what's going wrong — usually that means the agent needs better context or tools."

### Where Recommendations Surface

- **Gym cards** on the `/gym` page — 2-3 actionable recommendations, refreshed daily
- **Coach chat** — ask "what should I work on?" and get a personalized answer
- **Optional notifications** — if the user configures it, the coach can message via their preferred channel (Slack, Telegram, etc.)

### The Two Modes Side by Side

| | Structured Programs | Continuous Coaching |
|---|---|---|
| **Trigger** | User starts a program | Coach observes activity |
| **Content** | Pre-authored modules | Dynamically generated insights |
| **Pacing** | User-driven, sequential | Coach-driven, contextual |
| **Verification** | Explicit checks per module | Implicit via activity tracking |
| **When** | Onboarding, skill-building | Ongoing, indefinite |
| **Analogy** | Following a workout plan | Personal trainer watching your form |

---

## 10. The Feed (News + Updates)

The other half of the gym — staying current on AI.

### AI Briefing

A scheduled goal that curates AI news relevant to *you*:

- Based on your agents, your industry, your skill level
- Not generic "AI news" — filtered through your learner profile
- Example: If you work in finance and use automation heavily, you get news about AI in fintech and new automation capabilities, not generic ChatGPT headlines

### Platform Updates

Changelog entries surfaced as "new capability unlocked" cards:

- "You can now use Grok models. Want to try one?"
- "Session tabs are here — you can run multiple conversations per agent now."
- Tied to relevance: only surface updates for features the user is likely to care about

### Tips

Contextual nudges based on usage:

- "You haven't tried automations yet. Here's a 5-minute program."
- "Your @writer agent has been idle for 2 weeks. Want to archive it or give it a new role?"
- "You're in the top 10% of platform users by activity. Want to try building a multi-agent workflow?"

---

## 11. UI — The /gym Page

### Layout

```
┌──────────────────────────────────────────────────────┐
│  AI Gym                                    [streak]  │
├──────────────┬───────────────────────────────────────┤
│              │                                       │
│  Programs    │   Coach Chat                          │
│  ─────────   │   (main panel — chat with coach)      │
│  ● Getting   │                                       │
│    Started ✓ │                                       │
│  ● Agent     │                                       │
│    Building  │                                       │
│    (3/8)     │                                       │
│  ○ Auto-     │                                       │
│    mations   │                                       │
│  ○ MCPs      │                                       │
│              │                                       │
│  ─────────   │                                       │
│  Gym Cards   │                                       │
│  ─────────   │                                       │
│  💡 Tip:     │                                       │
│  delegation  │                                       │
│  📊 Weekly   │                                       │
│  progress    │                                       │
│  🆕 New:     │                                       │
│  multi-model │                                       │
│              │                                       │
├──────────────┴───────────────────────────────────────┤
│  Feed: AI Briefing | Platform Updates | Tips         │
└──────────────────────────────────────────────────────┘
```

### Panels

| Panel | Content |
|-------|---------|
| **Left sidebar** | Program list (with progress indicators), gym cards (recommendations) |
| **Main panel** | Tabbed: **Coach** (chat) · **Progress** (dimension tracker) |
| **Bottom feed** | Scrollable feed of AI news, platform updates, and contextual tips |

### Interactions

| Action | What happens |
|--------|-------------|
| Click a program | Coach loads that program's context, shows current module, guides you through it |
| Click a gym card | Coach opens a focused micro-lesson on that topic |
| Chat freely | Coach responds with full context of your learner profile and activity history |
| Complete a module | Coach verifies, updates progress, suggests next step |
| Click "Progress" tab | Opens the dimension progress view (see below) |

---

### Progress Tab — Dimension Tracker

The **Progress** tab sits alongside the coach chat in the main panel. It's the user's view of their AI skill evolution over time.

```
┌─────────────────────────────────────────────────────┐
│  My AI Strength                                      │
│                                                      │
│  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │   Current Shape      │  │  Over Time           │  │
│  │                      │  │                      │  │
│  │   [Radar chart]      │  │  [Line chart]        │  │
│  │   5 dimensions       │  │  each dimension      │  │
│  │   plotted as         │  │  tracked weekly      │  │
│  │   spider/pentagon    │  │  last 90 days        │  │
│  │                      │  │                      │  │
│  └──────────────────────┘  └──────────────────────┘  │
│                                                      │
│  Dimension Breakdown                                 │
│  ─────────────────────────────────────────────────  │
│  Application    ████████░░  3/5  Proficient  ↑      │
│  Communication  ██████░░░░  2/5  Developing  →      │
│  Knowledge      ████████░░  3/5  Proficient  ↑      │
│  Orchestration  ████░░░░░░  1/5  Beginner    →      │
│  Craft          ██████░░░░  2/5  Developing  ↑      │
│                                                      │
│  Next focus: Orchestration                           │
│  [Start Automations Mastery →]                       │
│                                                      │
│  Milestones                                          │
│  ─────────────────────────────────────────────────  │
│  ✓ Apr 2  First agent created         (Craft ↑)     │
│  ✓ Apr 5  10 sessions completed       (Application) │
│  ✓ Apr 8  Getting Started program     (Knowledge ↑) │
│  ○ Agent Building program             in progress   │
└─────────────────────────────────────────────────────┘
```

**Charts:**
- **Radar/spider chart** — current snapshot of all 5 dimensions. One glance shows the shape of the user's skill (e.g., strong on Application and Knowledge, weak on Orchestration).
- **Line chart** — each dimension plotted as a separate line over time (weekly data points from the activity digest). Shows velocity and trend, not just current state.

**Dimension breakdown** — progress bars with score, label, and trend arrow (↑ improving, → stable, ↓ declining).

**Next focus** — the coach surfaces the highest-ROI dimension to develop next (lowest score with the most adjacent activity). One-click jump into the relevant program.

**Milestones** — a chronological list of meaningful achievements: programs completed, dimension level-ups, streaks, first uses of key features. Gives the user a sense of their journey over time.

**Data source:** All data comes from `learner-profile.json`. Weekly snapshots are saved by the activity digest into a `dimension-history.json` file alongside the learner profile, used to power the line chart.

---

## 12. Feature Flag & Gym-Only Mode

### Feature Flag

```json
// config.json → service
{
  "gymEnabled": false  // default: off
}
```

When `gymEnabled: false`:
- No `/gym` nav item
- Gym coach agent not registered
- Zero impact on existing platform behavior

When `gymEnabled: true`:
- `/gym` appears in nav
- Gym coach agent is active
- Activity digest goal starts running

### Gym-Only Mode

For users who installed purely for training:

```json
// config.json → service
{
  "gymEnabled": true,
  "gymOnlyMode": true  // hides non-essential nav items
}
```

When `gymOnlyMode: true`:
- Landing page is `/gym` instead of `/home`
- Nav shows: **Gym** | **Agents** (simplified) | **Settings**
- Other pages (Lab, Marketplace, Admin) hidden but still accessible via URL
- As the user progresses, the coach can suggest "expanding" to full mode

---

## 13. What Needs Building

### Phase 0: MCP Foundation (prerequisite for everything)

New MCP tools and API endpoints the gym depends on. Must be built before the gym agent can function.

| Item | API | MCP Tool | Effort |
|------|-----|----------|--------|
| Agent log access | `GET /api/agents/:id/logs` (paginated) | `get_agent_logs` | S |
| Agent activity summary | `GET /api/agents/:id/activity-summary` | `get_agent_activity_summary` | S |
| Cross-agent log search | `GET /api/agents/logs/search?q=` | `search_agent_logs` | M |
| Gym plan read/write | `GET/PUT /api/gym/plan` | `get_plan`, `update_plan` | S |
| Gym progress read/write | `GET/PUT /api/gym/progress` | `get_gym_progress`, `update_gym_progress` | S |
| Gym cards read/write | `GET/POST /api/gym/cards` | `list_gym_cards`, `create_gym_card` | S |
| Program import from markdown | `POST /api/gym/programs/import-markdown` | `import_program` | S |
| Program CRUD | `GET/POST/PATCH/DELETE /api/gym/programs` | `list_programs`, `get_program`, `create_program`, `update_program` | M |
| Dimension history write | `POST /api/gym/dimensions/snapshot` | `snapshot_dimensions` | S |

### Phase 1: Foundation

| Item | Description | Effort |
|------|-------------|--------|
| Gym agent | `agents/platform/gym/` — agent.json, CLAUDE.md | S |
| Feature flag | `service.gymEnabled` in config, gate nav + agent registration | S |
| `/gym` page | UI: coach chat + program sidebar + gym cards | M |
| Learner profile + dimensions | JSON schema, APIs, MCP tools for read/write | S |

### Phase 2: Programs

| Item | Description | Effort |
|------|-------------|--------|
| Program schema | Program → Module → Step hierarchy, aligned with aigym-platform | S |
| Getting Started program | 5-8 steps across 3-4 modules, hands-on, verified | M |
| Program progress tracking | Per-step completion, verification logic, MCP tools | S |
| Program browser UI | Sidebar with progress indicators | S |
| AI program generator | Conversation → markdown → import via API (port from aigym-platform) | M |
| Markdown import endpoint | `POST /api/gym/programs/import-markdown` | S |

### Phase 3: Continuous Coaching

| Item | Description | Effort |
|------|-------------|--------|
| Activity digest goal | Scheduled cross-agent activity summary via MCP | M |
| Gym cards | Recommendation generation + UI cards | M |
| Struggle detection | Pattern matching in activity summaries | M |
| Capability gap analysis | Compare features used vs available | S |

### Phase 4: Feed

| Item | Description | Effort |
|------|-------------|--------|
| AI Briefing | Scheduled news curation (needs web search MCP) | M |
| Platform updates | Changelog → personalized "new capability" cards | S |
| Feed UI | Bottom panel with scrollable feed | S |

### Phase 5: Marketplace

| Item | Description | Effort |
|------|-------------|--------|
| `isMarketplaceListed` flag | Add to program schema + API | S |
| Marketplace browse page | Discovery grid filtered by dimension, difficulty, topic | M |
| Program install flow | Copy program into user's gym via API | S |
| Author attribution | Creator name + org on program cards | S |

---

## Build Phases — Concentric Circles

Each circle is a complete, working product. Later circles add depth and reach without requiring the previous circle to be rebuilt.

---

### MVP — The Core Loop

**Goal:** Prove that a coach that knows you can deliver real, personalized value.

Everything a user needs to experience the full promise of the gym: meet their trainer, get profiled, follow a program, see the coach observe their activity and adapt.

| | What's in it |
|---|---|
| **Onboarding** | All 3 steps: choose trainer, get-to-know-you, get your plan |
| **Gym agent** | Fully configured, feature-flagged, soul.md loading from `selectedTrainer` |
| **Learner profile** | Full schema + `dimensions`, seeded from onboarding, updated by digest |
| **/gym page** | Coach chat + program sidebar + gym cards |
| **Programs** | 1 bundled program: *Getting Started* (5–6 steps, self-report + platform-check verification) |
| **Activity digest** | Daily scheduled goal — reads agent summaries via MCP, updates profile + dimensions, generates gym cards |
| **Progress tab** | Current dimension scores (radar chart + progress bars + next-focus CTA). No history chart yet. |
| **MCP foundation** | All Phase 0 tools built: `get_agent_logs`, `get_agent_activity_summary`, `get_plan`, `update_plan`, `get_gym_progress`, `update_gym_progress`, `list_gym_cards`, `create_gym_card`, `snapshot_dimensions` |
| **Gym subfolder** | `src/gym/` with clean separation — no gym code in platform files |

**What it does NOT include:** multiple programs, AI generator, history charts, the Feed, notifications, gym-only mode, marketplace.

---

### P1 — Depth

**Goal:** Give users reasons to come back after they've finished Getting Started. The coach gets smarter and more proactive; the program library fills out.

| | What's in it |
|---|---|
| **Programs** | All 5 remaining bundled programs (Prompt Engineering, Agent Building, Automations Mastery, MCP Integrations, Multi-Model Strategy) |
| **AI program generator** | Conversation → markdown → import. Port from aigym-platform. |
| **All verification types** | `knowledge` + `platform-check` fully wired; `self-report` already in MVP |
| **Continuous coaching** | Struggle detection + capability gap analysis from activity digests |
| **Progress history chart** | Line chart of dimension scores over time (requires snapshots running since MVP) |
| **The Feed** | AI Briefing (web search MCP, off by default) + Platform Updates + Tips |
| **Gym-only mode** | First-run wizard + `gymOnlyMode` config flag |

---

### P2 — Reach

**Goal:** Programs leave the gym and travel. Other people can install and use programs created by power users. The gym becomes a network effect, not just a personal tool.

| | What's in it |
|---|---|
| **Marketplace** | Programs listed, browsed, installed by others |
| **Trainer variations in programs** | `trainerVariations` on steps — programs adapt their voice to your trainer |
| **Channel notifications** | Coach can message via Slack/Telegram when it has something important (opt-in) |
| **Gamification** | Badges for dimension milestones, streak display in the gym header |
| **Program export/share** | Export a program as shareable markdown or deep link |

---

## 14. Profile/Auth Decision (Resolved)

**Decision:** Lightweight profile, no auth. Full auth deferred to SaaS traction milestone.

The platform now has a simple profile system:

- **`profile.json`** on disk (in the base config directory)
- **API:** `GET /api/profile`, `PUT /api/profile`
- **MCP tools:** `get_profile`, `update_profile`
- **UI:** Profile section at the top of Admin → Settings
- **Fields:** name, role, industry, aiExperience (beginner/intermediate/advanced), interests (array), avatar

### Design Rationale

- **No login, no passwords, no sessions** — the product works without a profile, but gets better with one (Microsoft Word model)
- **Single user assumed** for local install — one profile per install
- **The gym coach reads the profile** via `get_profile` MCP tool to personalize coaching
- **Any agent can read it** — enables personalization platform-wide, not just in the gym
- **Full auth is a SaaS problem** — the SaaS fork already has Prisma + JWT. When local install needs multi-user, it will adopt the same pattern.

### Future Considerations

If multi-device identification is needed later (e.g., "Ore's iPhone" vs "Ore's laptop"), the path is:
1. Add a PIN gate (single shared PIN → cookie-based session)
2. Add device pairing (pair a browser → device token in localStorage)
3. Per-device profile names (not auth, just identification)

This is additive — doesn't require touching existing endpoints.

---

## 15. Open Questions

**All resolved:**

1. ~~**User/profile concept**~~ — Lightweight `profile.json`, no auth. See §15.
2. ~~**Coach personality**~~ — 5 named trainers (Alex, Jordan, Morgan, Riley, Sam), each with a `souls/<name>.md` file. Swappable anytime. See §3.
3. ~~**Gym agent class**~~ — Naming convention only. `class: "gym"` = non-deletable + feature-flag gated + soul.md loading. Same executor behavior as platform agents. Formalize later if needed.
4. ~~**soul.md loading mechanism**~~ — Option (b): `selectedTrainer` stored in `learner-profile.json`. Executor reads it at spawn time, prepends `souls/<name>.md` before `CLAUDE.md`. No symlinks.
5. ~~**Plan storage**~~ — Structured JSON (`plan.json`). Two-bucket structure is fixed and known; JSON lets the UI render buckets natively. Coach writes via `update_plan` MCP tool.
6. ~~**Plan APIs/MCP**~~ — `GET/PUT /api/gym/plan` + `get_plan`, `update_plan` MCP tools. See §14 Phase 0.
7. ~~**Dynamic bucket trigger**~~ — Pull (daily activity digest at 6am). Event-driven is a future optimization.
8. ~~**Program authoring**~~ — Both: bundled programs (hand-authored, imported at first `gymEnabled`) + AI generator (conversation → markdown → import via API). See §9.
9. ~~**Verification depth at launch**~~ — `knowledge` + `platform-check` + `self-report`. Skip `activity-check` for MVP.
10. ~~**News source for AI Briefing**~~ — Web search MCP (Brave/Tavily). Toggle off by default (`aibriefingEnabled: false`). Coach runs a personalized search when enabled.
11. ~~**Gym-only install path**~~ — Same install. First-run wizard asks intent; sets `gymOnlyMode: true` in config. No separate package.
12. ~~**Trainer profiles at launch**~~ — 5 named trainers. Decided.
13. ~~**Gym agent ID**~~ — Fixed `id: "gym"`. Ships with the platform.
14. ~~**Gamification depth**~~ — Streaks only for MVP. No badges, levels, or leaderboards. Keep it clean; revisit for SaaS.
