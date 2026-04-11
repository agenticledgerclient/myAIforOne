# Cross-Agent Observer Architecture

> **Status:** Draft / Vision
> **Author:** @myagentdev
> **Date:** 2026-04-11

## Overview

Cross-Agent Observers are a class of agent that can read across multiple agents' data — memory, conversation logs, daily journals, and activity — to synthesize a higher-level view that no single agent has.

Unlike standard agents (scoped to one purpose/workspace), observers sit above the agent layer. They are the platform's answer to: "What if an agent could see everything I do across all my agents?"

## Agent Classification

| Class | Scope | Examples | Custom UI | Created By |
|-------|-------|----------|-----------|------------|
| **Standard** | Own workspace, own memory | @tax2025, @buildinpublic, @ailead | No | User |
| **Platform Observer** | Cross-agent, platform-shipped | Hub (Work), Gym (Coach) | Yes (custom tabs/pages) | Platform |
| **User Observer** | Cross-agent, user-created | ME, Advisor, Archivist | No (standard interface) | User |

## Motivating Example: The ME Agent

A "ME" agent that:
- Has read access to all (or selected) agents' conversation logs, daily journals, and memory
- Synthesizes months of activity into a model of the user — communication style, decision patterns, priorities, knowledge areas
- Can answer questions on behalf of the user, draft messages in their voice, surface patterns they wouldn't notice themselves

## Architecture

### Data Access Model

Observers read other agents' data through the Drive filesystem:

```
~/Desktop/MyAIforOne Drive/
├── PlatformUtilities/
│   ├── hub/
│   │   ├── memory/
│   │   │   ├── conversation_log.jsonl    ← observer can read
│   │   │   ├── daily/                    ← observer can read
│   │   │   ├── context.md                ← observer can read
│   │   │   └── vectors.json              ← observer can read
│   │   ├── FileStorage/                  ← observer can read
│   │   └── tasks.json                    ← observer can read
│   ├── gym/
│   │   └── ...
│   └── {observer-agent}/
│       └── memory/                       ← observer's own memory
├── PersonalAgents/
│   └── Personal/
│       ├── ailead/memory/                ← observer can read (if permitted)
│       ├── tax2025/memory/               ← observer can read (if permitted)
│       └── ...
```

### Permission Model

Observers don't get blanket access. Each observer declares which agents it can observe:

```jsonc
// agent config (conceptual)
{
  "id": "me-agent",
  "class": "observer",
  "observes": {
    "agents": ["hub", "gym", "ailead", "buildinpublic"],  // specific agents
    // OR
    "agents": "*",                                          // all agents
    "exclude": ["tax2025"],                                 // except these
  },
  "observeScope": {
    "conversationLogs": true,      // read conversation_log.jsonl
    "dailyJournals": true,         // read daily/*.md
    "memory": true,                // read context.md, vectors.json
    "tasks": true,                 // read tasks.json
    "fileStorage": false           // don't read uploaded files
  }
}
```

### Observer Capabilities

Observers get their power from two sources:

1. **Drive filesystem access** — workspace set to `~/Desktop/MyAIforOne Drive/`, giving read access to all agent directories (filtered by permission config above)

2. **MCP tools for aggregation** — platform-provided tools that query across agents:

| Tool | Description |
|------|-------------|
| `get_agent_activity_summary` | Activity stats across observed agents |
| `get_cross_agent_timeline` | Merged timeline of events across agents |
| `search_across_agents` | Semantic search across all observed agents' memory |
| `get_agent_conversation_log` | Read a specific agent's conversation history |
| `get_observed_agents` | List which agents this observer can see + their status |

### What Observers Do NOT Get

- **Custom UI** — user-created observers use the standard chat interface (no custom tabs/pages like Gym)
- **Custom backend code** — no gym-router.ts equivalent; all functionality comes from config + MCP tools + system prompt
- **Write access to other agents** — observers READ across agents but WRITE only to their own memory/storage
- **Tool use on other agents' behalf** — observers can't execute Bash, Write, etc. in another agent's workspace

## Observer Types (Templates)

Users create observers from templates that pre-configure the system prompt, MCP tools, and default observe scope:

| Template | Purpose | Default Observe Scope | Key MCP Tools |
|----------|---------|----------------------|----------------|
| **ME / Digital Twin** | Represent the user across all activity | All agents, full scope | search_across_agents, get_cross_agent_timeline |
| **Advisor** | Strategic recommendations based on patterns | All agents, conversations + journals | get_agent_activity_summary, search_across_agents |
| **Archivist** | Knowledge management, "what did I work on" | All agents, full scope | get_cross_agent_timeline, search_across_agents |
| **Auditor** | Compliance, cost, usage oversight | All agents, tasks + costs | get_all_costs, get_task_stats, get_agent_activity_summary |
| **Team Lead** | Org-level view of agent group performance | Specific org agents | get_agent_activity_summary, list_tasks |
| **Custom** | User-defined purpose | User-selected agents | User-selected tools |

## Platform Observers vs User Observers

| Aspect | Platform (Hub, Gym) | User-Created |
|--------|---------------------|--------------|
| Ships with platform | Yes | No |
| Custom UI (tabs, pages) | Yes | No — standard chat only |
| Custom backend code | Yes (gym-router, activity-digest) | No — MCP tools + system prompt only |
| Workspace | Repo or Drive | Drive only |
| Updatable by user | Config only (MCPs, skills) | Fully configurable |
| Templates | N/A (hardcoded) | Selectable |

## Open Questions

1. **Permission granularity** — Is agent-level permission enough, or do users need field-level control (e.g. "can read daily journals but not conversation logs")?

2. **Real-time vs batch** — Should observers get real-time hooks when observed agents complete a conversation, or only read stored data? Real-time enables reactive observers (alerts, summaries) but adds complexity.

3. **Observer-to-observer** — Can an observer observe another observer? (e.g. ME agent reads Gym's coaching insights). Probably yes, but need to prevent circular dependencies.

4. **Write-back** — Should observers ever be able to write to observed agents' data? (e.g. an Advisor agent adding a task to another agent's task list). Current answer: no — observers are read-only across agents.

5. **Cost attribution** — Observer agents will consume more tokens because they read more data. How is this surfaced to the user?

6. **Existing MCP tools** — Which of the current MCP tools (myaiforone-local) already cover observer needs vs what new tools are needed? `get_agent_activity_summary`, `search_memory`, `get_agent_logs` exist today — may just need scoping/filtering additions.

7. **UI for configuring observe permissions** — The web UI's agent creation form needs a new section for observer config. What does that look like? Multi-select of agents? Checkboxes for scope?

8. **Workspace scoping enforcement** — Currently, workspace = cwd and agents can still read any absolute path. For user observers, should the permission model be enforced at the tool level (filtering results) rather than relying on filesystem access?

9. **User observer system prompts** — How much of the system prompt is template-provided vs user-written? Templates should provide the "how to be an observer" instructions; users provide the "what to focus on" instructions.

10. **Migration** — Hub and Gym already exist as platform agents. When this class is formalized, do they need to be refactored to use the same config schema, or do they remain special cases?
