---
name: opreset
description: Reset an agent's persistent session in the channelToAgentToClaude gateway. Clears session state so the next message starts a fresh conversation. Use /opcompact first to save important context.
---

# Reset Agent Session

This command is intercepted by the channelToAgentToClaude gateway executor — it never reaches Claude. When a user sends `/opreset` via phone (e.g., `@agentmgr /opreset`), the executor:

1. Deletes `memory/session.json` for that agent
2. Returns a confirmation message
3. Next message starts a completely fresh Claude session with a new UUID

## How it works

The executor checks every incoming message for the `/opreset` pattern before spawning Claude. If matched:
- The session file is deleted
- A response is sent back immediately (no Claude invocation)
- The conversation_log.jsonl still records the reset event

## Important

- Use `/opcompact` BEFORE `/opreset` to save anything important
- After reset, the agent still has its context.md (standing memory) — only the conversation session is cleared
- Non-persistent agents ignore this command (they have no session to reset)
