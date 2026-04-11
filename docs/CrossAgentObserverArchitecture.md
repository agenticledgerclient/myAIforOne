# Super Agent Architecture

> **Status:** Draft / Vision
> **Author:** @myagentdev
> **Date:** 2026-04-11
> **Updated:** 2026-04-11

## Overview

Super Agents are a new agent class that can see across multiple agents' data — memory, conversation logs, daily journals, tasks, and activity — to synthesize a higher-level view that no single agent has.

Unlike standard agents (scoped to one purpose/workspace), super agents sit above the agent layer. They are the platform's answer to: "What if an agent could see everything I do across all my agents?"

### Motivating Example: The ME Agent

A "ME" agent that:
- Has read access to all (or selected) agents' conversation logs, daily journals, and memory
- Synthesizes months of activity into a model of the user — communication style, decision patterns, priorities, knowledge areas
- Can answer questions on behalf of the user, draft messages in their voice, surface patterns they wouldn't notice themselves

---

## Section 1 — Agent Class Consistency

The platform already has agent classes. Super agents must fit cleanly into this taxonomy, not live outside it.

### Current Classes

```typescript
// src/config.ts
agentClass?: "standard" | "platform" | "builder" | "gym";
```

| Class | Purpose | Examples |
|-------|---------|----------|
| `standard` | Personal single-purpose agents | @ailead, @tax2025, @buildinpublic |
| `platform` | Platform-shipped utility agents | Hub, @agentcreator, @skillcreator |
| `builder` | App development agents | @appcreator |
| `gym` | AI Gym coaching agents | Gym |

### Addition

```typescript
agentClass?: "standard" | "platform" | "builder" | "gym" | "super";
```

| Class | Purpose | Examples |
|-------|---------|----------|
| `super` | Cross-agent visibility, user-created | ME, Advisor, Archivist, Auditor |

### Decision: Hub and Gym Do NOT Change

> **Decided:** Hub and Gym remain `platform` class. They are not super agents. They are platform agents with custom backend code that happens to give them cross-agent visibility. Do not touch them.

`super` is a formalized class where cross-agent access is **config-driven**, not code-driven. Platform agents are a completely separate thing.

### How the executor recognizes super agents

The executor already has class-specific logic (e.g., gym gets soul.md prepended). For super agents:
1. Executor reads `agentClass: "super"` from config
2. Sets workspace to the super agent's Drive folder
3. Loads `observes` config to determine which agent folders are accessible
4. Prepends `soul.md` if present (see Section 6)
5. Injects super-agent-specific MCP tools alongside any user-configured MCPs

### Decision: Routing is unchanged

> **Decided:** The router does not need class-aware logic. Routing continues to work exactly as it does today — channel + chatId + mention alias. A super agent is routed the same way any other agent is.

---

## Section 2 — Full Feature Parity with Personal Agents

Super agents are NOT a stripped-down agent type. They get **every single capability** that standard/personal agents have, plus additional super-agent-specific config on top.

### Feature Parity Checklist

| Feature | Standard Agent | Super Agent | Notes |
|---------|---------------|-------------|-------|
| CLAUDE.md (system prompt) | ✅ | ✅ | Same |
| Skills | ✅ | ✅ | Same skill system |
| Goals (scheduled automation) | ✅ | ✅ | Super agents can have cron goals |
| Tasks | ✅ | ✅ | tasks.json, same format |
| MCPs | ✅ | ✅ | User-configurable, plus super-agent-specific tools |
| Memory (context.md, vectors, daily journals) | ✅ | ✅ | Their own memory, separate from observed agents |
| Advanced memory | ✅ | ✅ | `advancedMemory: true` supported |
| Wiki / learned.md | ✅ | ✅ | `wiki: true` supported |
| Conversation log | ✅ | ✅ | Their own log |
| Sessions | ✅ | ✅ | Session persistence |
| FileStorage | ✅ | ✅ | Their own file storage |
| Routes (channels) | ✅ | ✅ | Reachable via Slack, Telegram, web, etc. |
| Org placement | ✅ | ✅ | Can belong to an org, have title, report chain |
| Executor config | ✅ | ✅ | Claude default, can override to ollama if multi-model enabled |
| Allowed tools | ✅ | ✅ | Same tool permission model |
| Sub-agents | ✅ | ✅ | Can delegate to other agents |
| Claude account | ✅ | ✅ | Can use specific Claude account |

### What super agents ADD on top

| Additional Config | Purpose |
|-------------------|---------|
| `observes` | Which agents this super agent can see (Section 5) |
| `observeScope` | What data within those agents is accessible (Section 5) |
| `soul.md` | Personality/identity layer (Section 6) |

### Principle
> If a personal agent can do it, a super agent can do it. The super agent class adds cross-agent visibility — it doesn't subtract anything.

---

## Section 3 — Storage Location in Drive

### Current Drive Layout

```
~/Desktop/MyAIforOne Drive/
├── PlatformUtilities/          ← platform-class agents (Hub, Gym, agentcreator, etc.)
│   ├── hub/
│   ├── gym/
│   ├── agentcreator/
│   ├── skillcreator/
│   └── promptcreator/
├── PersonalAgents/
│   ├── Personal/               ← standard-class agents
│   │   ├── ailead/
│   │   ├── tax2025/
│   │   └── buildinpublic/
│   ├── projects/               ← cross-agent projects
│   └── AgenticLedger Builds/   ← builder-class agents
│       ├── myagent-dev/
│       └── ma41saas/
```

### Decision: New Top-Level Folder — `SuperAgents/`

> **Decided:** `SuperAgents/` — a new top-level Drive folder, parallel to `PersonalAgents/` and `PlatformUtilities/`.

```
~/Desktop/MyAIforOne Drive/
├── PlatformUtilities/          ← platform agents (unchanged)
├── PersonalAgents/             ← standard + builder agents (unchanged)
├── SuperAgents/                ← NEW: super-class agents
│   ├── me-agent/
│   │   ├── CLAUDE.md
│   │   ├── soul.md             ← personality layer (Section 6)
│   │   ├── memory/
│   │   │   ├── context.md
│   │   │   ├── conversation_log.jsonl
│   │   │   ├── daily/
│   │   │   ├── vectors.json
│   │   │   └── learned.md
│   │   ├── FileStorage/
│   │   ├── goals/
│   │   ├── skills/
│   │   └── tasks.json
│   ├── advisor/
│   │   └── ...
│   └── archivist/
│       └── ...
```

### Why NOT PlatformUtilities?

| Factor | PlatformUtilities | New SuperAgents/ |
|--------|-------------------|-----------------|
| Semantics | "Platform ships these" | "User creates these" |
| Confusion | Mixing user-created with platform-shipped | Clean separation |
| Discoverability | User agents hidden among platform tools | Obvious where super agents live |
| Hub/Gym impact | Would need reclassification | Hub/Gym stay untouched in PlatformUtilities |

### Decision: System prompts live ONLY in Drive

> **Decided:** Super agents do NOT have a CLAUDE.md in the repo `agents/` directory. Their system prompt lives only in their Drive folder (`SuperAgents/<agent-id>/CLAUDE.md`). This is consistent with them being user-created and user-owned.

### Config mapping

```jsonc
// config.json agent entry
{
  "id": "me-agent",
  "agentClass": "super",
  "agentHome": "SuperAgents/me-agent"  // relative to Drive root
}
```

The executor resolves `agentHome` to the full Drive path, same as it does for `PersonalAgents/Personal/ailead` or `PlatformUtilities/hub` today.

### Folder structure inside a super agent

Identical to a personal agent folder (CLAUDE.md, memory/, FileStorage/, goals/, skills/, tasks.json) — plus `soul.md` at the root level.

---

## Section 4 — User-Created

Super agents are **not** platform-only. Users create them, configure them, and own them — just like personal agents.

### Decision: No limit, no notifications

> **Decided:** No limit on how many super agents a user can create. Agents are NOT notified when they are being observed — this would be noise without value.

### Creation Methods

**1. Via @agentcreator conversation:**
> "I need a super agent that watches all my agents and helps me find things across my conversations"

@agentcreator detects the cross-agent intent and:
- Sets `agentClass: "super"`
- Creates folder in `SuperAgents/`
- Prompts for which agents to observe
- Writes the CLAUDE.md with super-agent-aware system prompt
- Optionally writes soul.md based on user's desired personality

**2. Via Web UI:**
- Agent creation form gets a new "Super Agent" option in the class selector
- When selected, shows super-agent-specific config sections (agent selection, scope, soul)
- Otherwise identical to creating a standard agent

**3. Programmatically via MCP:**
- `create_agent` tool supports `agentClass: "super"` with `observes` and `observeScope` fields

### Ownership & Lifecycle

| Aspect | Behavior |
|--------|----------|
| Created by | User (via any creation method) |
| Editable by | User (full config access) |
| Deletable by | User |
| Visible in agent list | Yes — filtered by class or shown with class badge |
| Routable | Yes — same channel routing as any agent |
| Can be mentioned | Yes — `@me-agent` in Slack, etc. |

### Guardrails
- When creating a super agent, the UI/agentcreator should explain: "This agent will be able to read conversations and memory from the agents you select"
- Users must explicitly opt in to which agents are observed — no silent defaults

---

## Section 5 — Cross-Agent Access Configuration

This is the core differentiator. Super agents declare which agents they can see and exactly what data within each agent's folder they can access.

### Config Schema

```jsonc
{
  "id": "me-agent",
  "agentClass": "super",
  "observes": {
    // ── Level 1: Which agents ──
    "agents": ["hub", "gym", "ailead", "buildinpublic"],  // specific agent IDs
    // OR
    "agents": "*",                                          // all agents
    "exclude": ["tax2025"],                                 // except these (only with "*")
  },
  "observeScope": {
    // ── Level 2: Which top-level folders/files ──
    "memory": true,           // memory/ folder
    "conversationLog": true,  // memory/conversation_log.jsonl specifically
    "dailyJournals": true,    // memory/daily/ folder
    "context": true,          // memory/context.md
    "vectors": true,          // memory/vectors.json
    "tasks": true,            // tasks.json
    "goals": true,            // goals/ folder
    "fileStorage": false,     // FileStorage/ folder
    "skills": false,          // skills/ folder
    "claudeMd": true,         // CLAUDE.md (the agent's system prompt)
    "soulMd": true,           // soul.md (if exists)
  },
  "observeScopeOverrides": {
    // ── Level 3: Per-agent overrides ──
    "tax2025": {
      "conversationLog": false,  // can see tax agent's memory but NOT conversation log
      "tasks": true
    },
    "ailead": {
      "fileStorage": true        // can see ailead's files (overrides default false)
    }
  }
}
```

### Three Levels of Granularity

| Level | What it controls | Example |
|-------|-----------------|---------|
| **Agent level** | Which agents are visible at all | `"agents": ["hub", "ailead"]` or `"agents": "*"` |
| **Folder/file level** | Which data types within each agent | `"conversationLog": true, "fileStorage": false` |
| **Per-agent override** | Exceptions for specific agents | `"tax2025": { "conversationLog": false }` |

### How It Maps to the Filesystem

When the executor builds the super agent's context, it resolves each observed agent's Drive path and applies the scope filter:

```
Observed agent: ailead
  agentHome: PersonalAgents/Personal/ailead

  Accessible (based on observeScope):
    ✅ PersonalAgents/Personal/ailead/memory/context.md
    ✅ PersonalAgents/Personal/ailead/memory/daily/
    ✅ PersonalAgents/Personal/ailead/memory/conversation_log.jsonl
    ✅ PersonalAgents/Personal/ailead/memory/vectors.json
    ✅ PersonalAgents/Personal/ailead/tasks.json
    ✅ PersonalAgents/Personal/ailead/CLAUDE.md
    ❌ PersonalAgents/Personal/ailead/FileStorage/     (fileStorage: false)
    ❌ PersonalAgents/Personal/ailead/skills/           (skills: false)
```

### Decision: Scope changes are config-only

> **Decided:** Scope cannot be changed at runtime. To change which agents a super agent can see or what data it can access, the user must update the config (via Web UI, @agentcreator, or MCP). The super agent cannot expand its own permissions mid-conversation.

### Decision: Super agents CAN observe other super agents

> **Decided:** Yes. A super agent can observe another super agent — they're just agents with folders in Drive like any other. The `observes.agents` list can include super agent IDs. Since super agents are read-only across agents (they never write to observed agents' data), there is no cycle risk.

### Decision: Filesystem-based enforcement (for now)

> **Decided:** Use filesystem-based enforcement — the super agent's workspace is set to Drive root and the system prompt instructs it which paths are accessible. This is consistent with how all agents work today (no agent has tool-level path restrictions). Tool-based enforcement is a future hardening option if needed.

### Decision: No special audit logging

> **Decided:** Super agents do not get special audit logging beyond what normal agents already have. If/when audit logging is added for all agents, super agents get it too.

### Super-Agent-Specific MCP Tools

| Tool | Description |
|------|-------------|
| `get_observed_agents` | List which agents this super agent can see + their status |
| `read_agent_file` | Read a specific file from an observed agent (scope-checked) |
| `search_across_agents` | Semantic search across all observed agents' memory |
| `get_cross_agent_timeline` | Merged timeline of events across observed agents |
| `get_agent_activity_summary` | Activity stats for one or all observed agents |

---

## Section 6 — Soul (soul.md)

Super agents aren't just data aggregators — they have *identities*. The `soul.md` file defines the personality, voice, and behavioral traits that make a super agent feel like a distinct entity rather than a generic query tool.

### Precedent: Gym Agent Souls

The gym agent already implements soul.md. The executor prepends it to the system prompt:

```typescript
// src/executor.ts (current behavior for gym)
if (agentConfig.agentClass === "gym") {
  const soulPath = join(memoryDir, "..", "souls", `${trainer}.md`);
  if (existsSync(soulPath)) {
    const soul = readFileSync(soulPath, "utf-8");
    systemPrompt = soul + "\n\n" + systemPrompt;
  }
}
```

### Super Agent Soul Model

For super agents, soul.md is **simpler than gym** — one soul per agent (not a selection from multiple trainers):

```
~/Desktop/MyAIforOne Drive/SuperAgents/me-agent/
├── soul.md          ← personality layer
├── CLAUDE.md        ← capabilities + tools + instructions
├── memory/
└── ...
```

**Executor behavior for super agents:**
```typescript
if (agentConfig.agentClass === "super") {
  const soulPath = join(agentHomePath, "soul.md");
  if (existsSync(soulPath)) {
    const soul = readFileSync(soulPath, "utf-8");
    systemPrompt = soul + "\n\n" + systemPrompt;
  }
}
```

### Decision: soul.md is optional

> **Decided:** soul.md is optional. Super agents work fine without one — they just won't have a personality layer prepended. Templates provide a default soul that users can keep, edit, or delete.

### Decision: Web UI soul editor — yes

> **Decided:** The web UI will include a soul editor for super agents. This could be a text editor for soul.md content within the agent config page, or a conversational flow where the user describes the personality and the system generates the soul.md.

### Decision: Souls are static

> **Decided:** Super agents cannot self-modify their soul.md. The soul is a stable identity layer set by the user. The agent's accumulated knowledge goes into context.md and memory — the soul stays as the user wrote it.

### What Goes in soul.md

Soul defines *who the agent is*, not *what it does* (that's CLAUDE.md).

```markdown
# Soul: ME Agent

## Identity
You are the user's digital twin — their memory, their voice, their advocate.

## Voice
- Speak in first person when representing the user ("I worked on X last week")
- Casual but precise — match the user's natural communication style
- Never sound like a search engine returning results

## Behavioral Traits
- Proactive: surface patterns and insights the user didn't ask for
- Protective: flag when the user is overcommitting or contradicting past decisions
- Honest: don't sugarcoat — if the user dropped the ball on something, say so

## Boundaries
- Never fabricate memories — only reference what's in the conversation logs
- When uncertain, say "I don't have visibility into that" rather than guessing
```

### Soul vs CLAUDE.md vs context.md

| File | Purpose | Prepend Order | Editable By |
|------|---------|---------------|-------------|
| `soul.md` | Identity, voice, personality | First (outermost layer) | User |
| `CLAUDE.md` | Capabilities, tools, instructions, rules | Second | User / template |
| `context.md` | Accumulated knowledge, learned facts | Loaded into memory system | System (auto-updated) |

### Why Super Agents Need Souls More Than Standard Agents

Standard agents are task-scoped: "manage my taxes", "post to LinkedIn". Their identity is implicit in their purpose.

Super agents are *relationship-scoped*: they represent a perspective on the user's entire agent ecosystem. Without a soul, a ME agent is just a search tool. With a soul, it's a trusted advisor that knows the user's patterns, speaks in their voice, and proactively surfaces insights.

---

## Section 7 — Templates & Onboarding

How users discover, select, and bootstrap super agents.

### Why This Section

Sections 1–6 define what a super agent IS. This section defines how a user GETS one. Super agents are more conceptually complex than standard agents — users need guidance on what to create and why.

### Super Agent Templates

Templates pre-fill the CLAUDE.md, soul.md, default `observeScope`, and suggested agent list:

| Template | Purpose | Default Soul Vibe | Default Observe Scope |
|----------|---------|-------------------|----------------------|
| **ME / Digital Twin** | Represent the user across all activity | First-person, casual, proactive | All agents, full scope |
| **Advisor** | Strategic recommendations | Third-person, analytical, measured | All agents, conversations + journals |
| **Archivist** | Knowledge management, "what did I work on" | Neutral, thorough, organized | All agents, full scope |
| **Auditor** | Compliance, cost, usage oversight | Formal, precise, flag-oriented | All agents, tasks + costs |
| **Team Lead** | Org-level view of agent group | Directive, summary-focused | Specific org agents |
| **Custom** | User-defined purpose | User writes soul | User selects everything |

### Decision: Templates deferred to a separate phase

> **Decided:** Template registry design (hardcoded vs loadable/extensible) and first-run auto-scan behavior (automatic vs user-triggered, cost implications) are pushed to a separate phase. For the initial build, templates can be hardcoded. The extensibility question will be evaluated after the core super agent functionality is working.

### Creation Flows

**Quick start (via @agentcreator):**
1. User: "Create a ME agent that knows everything about me"
2. @agentcreator selects ME template, asks which agents to observe
3. Creates the agent with default soul + scope
4. User can refine later

**Guided (via Web UI):**
1. Click "+ New Agent" → select "Super Agent" class
2. Choose template (or Custom)
3. Template pre-fills soul, scope, CLAUDE.md — user can edit each
4. Select which agents to observe (multi-select with "All" option)
5. Fine-tune scope per agent if desired
6. Create

### First-Run Experience

When a super agent is first messaged, it should:
1. Acknowledge what it can see ("I have access to your conversations with @ailead, @hub, and @buildinpublic")
2. Do an initial scan/synthesis of available data
3. Introduce itself based on its soul ("I'm your digital twin — ask me anything about what you've been working on")

---

## Summary of Changes Required

| Area | What Changes |
|------|-------------|
| `src/config.ts` | Add `"super"` to `agentClass` union type, add `observes` + `observeScope` + `observeScopeOverrides` fields to AgentConfig |
| `src/executor.ts` | Super agent class detection, soul.md prepend, workspace set to Drive folder |
| MCP server | New super-agent-specific tools (`read_agent_file`, `get_observed_agents`, `search_across_agents`, `get_cross_agent_timeline`, `get_agent_activity_summary`) |
| Web UI | Agent creation form: super agent class option, agent selector, scope config, soul editor |
| @agentcreator | Template awareness, super agent creation flow |
| Drive | Create `SuperAgents/` folder structure |
| Docs | User guide entries for super agents |

---

## Decisions Log

All open questions have been resolved:

| # | Question | Decision |
|---|----------|----------|
| 1 | Should Hub/Gym migrate to super class? | **No.** Do not touch Hub/Gym. They remain `platform` class. |
| 2 | Does the router need class-aware logic? | **No.** Routing is unchanged — channel + chatId + alias. |
| 3 | Folder naming? | **`SuperAgents/`** |
| 4 | System prompts in repo or Drive? | **Drive only.** No `agents/` repo entry for super agents. |
| 5 | Limit on super agents? | **No limit.** |
| 6 | Notify agents when observed? | **No.** |
| 7 | Runtime scope changes? | **Config-only.** Super agents cannot expand their own permissions. |
| 8 | Super-to-super observation? | **Yes, allowed.** Folder-based, read-only — no cycle risk. |
| 9 | Audit logging? | **No special logging.** Same as normal agents. If audit logging is added platform-wide, super agents get it too. |
| 10 | Enforcement model? | **Filesystem-based** (consistent with all agents today). Tool-based is a future hardening option. |
| 11 | soul.md required? | **Optional.** Templates provide a default; users can keep, edit, or delete. |
| 12 | Web UI soul editor? | **Yes.** |
| 13 | Self-evolving souls? | **No.** Soul is static, set by user. Knowledge goes to context.md/memory. |
| 14 | Template registry design? | **Deferred** to separate phase. Hardcoded for initial build. |
| 15 | First-run auto-scan? | **Deferred** to separate phase. |
