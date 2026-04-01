---
name: opcompact
description: Save important context from the current agent conversation before resetting the session. Writes key information to the agent's persistent context.md file so it survives session resets.
---

# Compact Agent Memory

Save important information from the current conversation into persistent memory before resetting the session.

## How it works

When a user sends `/opcompact` followed by instructions (e.g., `@agentmgr /opcompact save that we're using Prisma 7 with SQLite`), this is handled BY the agent (Claude) — not intercepted by the executor.

The agent should:

1. Read the user's instructions about what to save
2. Read the current `context.md` file in the agent's memory directory
3. Merge the new information with existing context — don't blindly overwrite
4. Write the updated context back to `context.md`
5. Confirm what was saved

## Context file location

The agent's memory directory is configured in config.json under `memoryDir`. The context file is always `context.md` within that directory.

For the claudeManager agent: `~/Desktop/MyAIforOne Drive/PersonalAgents/claudeManager/memory/context.md`

## Guidelines

- **Merge, don't replace** — read existing context.md first, keep what's still relevant
- **Be concise** — this is injected into the system prompt on every message after reset
- **Facts over narrative** — save decisions, config details, preferences — not conversation summaries
- **Date-stamp entries** — so stale context can be identified later

## Example usage

```
@agentmgr /opcompact save these:
- Bobby app uses Prisma 7 with SQLite adapter
- Login: accounting@rdavidorf.com / admin123
- financeiscooked platform is on Railway
- We decided to use persistent sessions for all new agents
```

## After compacting

Follow up with `/opreset` to clear the session. The saved context will be loaded into the system prompt of the new session automatically.
