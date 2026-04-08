# AI Gym — Architecture & Design Document

> Personal AI trainer that lives inside your agent platform. Learns from your actual usage, delivers personalized training, and keeps you current on AI — all from one place.

---

## Table of Contents

1. [Concept](#1-concept)
2. [Strategic Position](#2-strategic-position)
3. [Gym Coach Agent](#3-gym-coach-agent)
4. [Directory Structure](#4-directory-structure)
5. [Learner Profile](#5-learner-profile)
6. [RAG Pipeline — How the Coach Sees Everything](#6-rag-pipeline--how-the-coach-sees-everything)
7. [Programs (Structured Training)](#7-programs-structured-training)
8. [Continuous Coaching (Ongoing Personalized Mode)](#8-continuous-coaching-ongoing-personalized-mode)
9. [The Feed (News + Updates)](#9-the-feed-news--updates)
10. [UI — The /gym Page](#10-ui--the-gym-page)
11. [Feature Flag & Gym-Only Mode](#11-feature-flag--gym-only-mode)
12. [What Needs Building](#12-what-needs-building)
13. [Open Questions](#13-open-questions)

---

## 1. Concept

The AI Gym is a personal AI growth area built into the MyAgent platform. It is **not** a course platform — it's a coach that lives inside your actual AI workspace.

### Core Insight

Learning AI and using AI are the same motion. The gym isn't a separate product — it's an on-ramp. Someone starts with a guided program, and by the end they've built the muscle memory of actually using agents. They graduate from "gym member" to "power user" without a context switch.

### What Makes It Different

Traditional AI training: "Here's a course. Go through it. Done."

The AI Gym: A coach agent that **observes your real platform activity** across all your agents, understands your skill level and work patterns, and generates personalized training — continuously, not just once.

Nobody else has a coach that lives inside your actual AI workspace and sees everything you do. That's the moat.

---

## 2. Strategic Position

### As a Distribution Channel

The gym is a way to distribute the MyAgent platform itself. The training *is* the product usage.

- **Gym-only install**: Someone installs MyAgent purely for AI training. The gym is the front door. As they progress, they naturally discover "wait, I can just *keep* using these agents for my real work."
- **Shareable programs**: A trainer creates a program, exports it, shares it. The recipient installs the platform to run it.
- **Lead flow**: Training on AI → Using AI tools → Power user. The gym is the top of the funnel.

### Standalone vs Integrated

- Some users use the **full platform** (agents, channels, automations) and the gym is an added growth area
- Some users use **only the gym** — they installed for training and may or may not expand into the full platform
- Both are valid. The gym should work as a standalone experience or as part of the full platform.

---

## 3. Gym Coach Agent

The gym coach is a **platform agent** — same class as Hub. It has elevated access to observe cross-agent activity.

### agent.json

```json
{
  "id": "gym",
  "name": "AI Gym Coach",
  "alias": "gym",
  "class": "platform",
  "workspace": "~",
  "advancedMemory": true,
  "wiki": true,
  "persistentSession": true,
  "allowedTools": ["Read", "Glob", "Grep", "Write"],
  "mcps": ["myaiforone"],
  "featureFlag": "gymEnabled"
}
```

### Why These Settings

| Setting | Reason |
|---------|--------|
| `class: "platform"` | Same tier as Hub. Not user-deletable. Ships with the platform. |
| `advancedMemory: true` | Daily journals + vector embeddings. This is how the coach builds long-term understanding of you over weeks and months. |
| `wiki: true` | Learns facts from conversations. When you tell the coach "I work in finance" or "I'm intermediate with Python", it saves to `learned.md`. |
| `persistentSession: true` | Coaching is a continuous relationship, not one-off Q&A. Session persists across visits. |
| `allowedTools: [Read, Glob, Grep, Write]` | Read access to all agent dirs (conversation logs, configs). Write access for updating learner profile and progress files. |
| `mcps: ["myaiforone"]` | Full platform MCP access. Can call `list_agents`, `get_agent`, read activity, check what tools/MCPs each agent has, verify program completion. |

### System Prompt (CLAUDE.md) Responsibilities

The coach's system prompt defines:

- **Coaching personality** — encouraging, concise, action-oriented. Not lecturing.
- **Assessment methodology** — how to evaluate a user's skill level from activity patterns
- **Recommendation engine** — rules for matching unused features / capability gaps to training modules
- **Verification approach** — how to check if a user completed a hands-on exercise (call MCP tools to verify state)
- **Proactive insight generation** — patterns to watch for in activity digests that should trigger recommendations

---

## 4. Directory Structure

```
agents/platform/gym/
├── agent.json                  ← Platform agent config
├── CLAUDE.md                   ← System prompt (coaching methodology)
├── memory/
│   ├── conversation_log.jsonl  ← Coach conversation history
│   ├── context.md              ← Persistent coaching context
│   ├── learned.md              ← Wiki: facts learned from conversations
│   ├── learner-profile.json    ← User's skill map, patterns, preferences
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

## 5. Learner Profile

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
      "moduleIndex": 3,
      "startedAt": "2026-04-05T10:00:00Z"
    },
    "recommended": ["automations-mastery", "mcp-integrations"]
  },

  "streak": {
    "current": 12,
    "longest": 18,
    "lastActiveDate": "2026-04-08"
  }
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

## 6. RAG Pipeline — How the Coach Sees Everything

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

1. Calls `list_agents` via MCP to get the full agent roster
2. For each agent, reads `agents/<id>/memory/conversation_log.jsonl` via Read tool
3. Summarizes patterns: which agents active, what topics, what tool use, what struggles
4. Writes the digest into its own `daily/` journal (advanced memory auto-embeds this)
5. Updates `learner-profile.json` with new observations
6. Generates "gym cards" (recommendations) for the `/gym` page

### Layer 2: Vector Search Over History

The coach's `advancedMemory: true` setting means all daily digests are automatically embedded into its vector store. When the coach needs historical context:

- **"What has the user been doing this week?"** → vector search over recent daily journals
- **"When did the user last try automations?"** → vector search over older digests
- **"What programs match the user's current gaps?"** → vector search over program module content

### Layer 3: Cross-Agent Log Access

The coach has `workspace: "~"` and Read/Glob/Grep tools. It can directly access:

```
agents/*/memory/conversation_log.jsonl   ← all agent conversation logs
agents/*/agent.json                       ← all agent configs (tools, MCPs)
agents/*/memory/context.md                ← all agent persistent context
```

This is the **local install approach** — direct file access. Simple, fast, no auth boundaries needed because it's all one machine, one user.

For the SaaS version, this would need to go through the API with auth (e.g., `GET /api/agents/:agentId/logs`).

### Layer 4: Platform State via MCP

For real-time checks (not historical), the coach calls MCP tools:

| Need | MCP Tool |
|------|----------|
| List all agents | `list_agents` |
| Check agent's tools/MCPs | `get_agent` |
| Verify user created an agent | `list_agents` (check for new entry) |
| Verify automation was set up | `list_automations` |
| Check what channels are active | `list_channels` |
| Get recent activity | Read `conversation_log.jsonl` directly |

---

## 7. Programs (Structured Training)

Programs are the gym's formal curriculum. Each is a structured progression of hands-on modules.

### program.json Schema

```json
{
  "id": "agent-building",
  "name": "Agent Building",
  "description": "Learn to create specialized agents for your specific workflows",
  "difficulty": "intermediate",
  "estimatedTime": "2 hours",
  "prerequisites": ["getting-started"],
  "modules": [
    {
      "id": "01-anatomy",
      "title": "Anatomy of an Agent",
      "file": "modules/01-anatomy.md",
      "estimatedTime": "15min",
      "verification": {
        "type": "knowledge",
        "description": "Coach asks comprehension questions"
      }
    },
    {
      "id": "02-create-first",
      "title": "Create Your First Custom Agent",
      "file": "modules/02-create-first.md",
      "estimatedTime": "20min",
      "verification": {
        "type": "platform-check",
        "check": "new-agent-exists",
        "description": "Coach verifies a new agent was created via list_agents"
      }
    },
    {
      "id": "03-system-prompt",
      "title": "Writing an Effective System Prompt",
      "file": "modules/03-system-prompt.md",
      "estimatedTime": "20min",
      "verification": {
        "type": "platform-check",
        "check": "agent-has-custom-prompt",
        "description": "Coach reads the new agent's CLAUDE.md and evaluates quality"
      }
    }
  ]
}
```

### Module Format

Each module is a markdown file with:

- **Concept** — brief explanation (2-3 paragraphs max)
- **Why it matters** — tied to a real use case
- **Exercise** — the hands-on thing to do RIGHT NOW on the platform
- **Verification** — what the coach checks to confirm completion

Example module snippet:

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

| Type | How it works |
|------|-------------|
| `knowledge` | Coach asks the user questions, evaluates understanding |
| `platform-check` | Coach calls MCP tools to verify platform state changed |
| `activity-check` | Coach reads conversation logs to verify the user actually used a feature |
| `self-report` | User tells the coach they completed it (low-verification fallback) |

### Bundled Programs (Initial Set)

1. **Getting Started** — First agent, first conversation, basic platform orientation
2. **Prompt Engineering** — Writing effective prompts, system prompts, context management
3. **Agent Building** — Creating specialized agents, workspace setup, tool configuration
4. **Automations Mastery** — Goals, cron jobs, scheduled tasks, autonomous workflows
5. **MCP Integrations** — Connecting agents to external services, API tools
6. **Multi-Model Strategy** — When to use Claude vs OpenAI vs Groq vs local models

---

## 8. Continuous Coaching (Ongoing Personalized Mode)

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

## 9. The Feed (News + Updates)

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

## 10. UI — The /gym Page

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
| **Main panel** | Chat with the coach agent. This is where coaching happens — structured or freeform |
| **Bottom feed** | Scrollable feed of AI news, platform updates, and contextual tips |

### Interactions

| Action | What happens |
|--------|-------------|
| Click a program | Coach loads that program's context, shows current module, guides you through it |
| Click a gym card | Coach opens a focused micro-lesson on that topic |
| Chat freely | Coach responds with full context of your learner profile and activity history |
| Complete a module | Coach verifies, updates progress, suggests next step |

---

## 11. Feature Flag & Gym-Only Mode

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

## 12. What Needs Building

### Phase 1: Foundation

| Item | Description | Effort |
|------|-------------|--------|
| Gym agent | `agents/platform/gym/` — agent.json, CLAUDE.md | S |
| Feature flag | `service.gymEnabled` in config, gate nav + agent registration | S |
| `/gym` page | UI: coach chat + program sidebar + gym cards | M |
| Learner profile | JSON schema + read/write from coach | S |

### Phase 2: Programs

| Item | Description | Effort |
|------|-------------|--------|
| Program schema | `program.json` + module markdown format | S |
| Getting Started program | 5-8 modules, hands-on, verified | M |
| Program progress tracking | `program-progress.json`, verification logic | S |
| Program browser UI | Sidebar with progress indicators | S |

### Phase 3: Continuous Coaching

| Item | Description | Effort |
|------|-------------|--------|
| Activity digest goal | Scheduled cross-agent log analysis | M |
| Gym cards | Recommendation generation + UI cards | M |
| Struggle detection | Pattern matching in conversation logs | M |
| Capability gap analysis | Compare features used vs available | S |

### Phase 4: Feed

| Item | Description | Effort |
|------|-------------|--------|
| AI Briefing | Scheduled news curation (needs web search MCP) | M |
| Platform updates | Changelog → personalized "new capability" cards | S |
| Feed UI | Bottom panel with scrollable feed | S |

---

## 13. User/Profile Decision (Resolved)

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

## 14. Open Questions

1. ~~**User/profile concept**~~ — Resolved. See Section 13 above.

2. **Program authoring**: Are programs hand-authored markdown shipped with the platform, or can the coach generate modules dynamically based on the learner profile? (Likely both — bundled programs for structure, dynamic micro-lessons for continuous coaching.)

3. **Verification depth**: How strict should module verification be? Options range from "coach asks if you did it" to "coach calls MCP tools and checks platform state." Stricter is better for learning but harder to build.

4. **News source for AI Briefing**: Where does AI news come from? Web search MCP? RSS feeds? Curated sources? This needs a data pipeline.

5. **Gym-only install path**: Is this a separate `npm create myagent-gym` command, or the same install with a first-run wizard that asks "are you here for training or the full platform?"

6. **Gamification**: Streaks are included in the learner profile. How far to go? Badges? Levels? Leaderboards (for SaaS)? Or keep it clean and focused?

7. **Coach personality**: Should the coach have a configurable personality (strict drill sergeant vs. chill mentor), or one consistent voice?
