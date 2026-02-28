# Conversation History — How We Got Here

This document captures the design journey that led to the channelToAgentToClaude architecture. It serves as context for any Claude session continuing this work.

---

## The Original Question (2026-02-27)

**User (Ore):** "I need to figure out if I can send a message to Claude Code terminal from iMessage, like from text."

The initial exploration confirmed that Claude Code has no native mechanism for receiving external messages into a running session. There's an open GitHub feature request (#24983) for external event sources.

---

## Discovery: Clawdbot / OpenClaw

Ore already runs **Clawdbot** (closed-source version of OpenClaw) on Windows with WhatsApp and Slack configured. We explored the `~/.clawdbot/clawdbot.json` config and found:
- WhatsApp channel enabled with `selfChatMode: true`
- Slack channel enabled via socket mode
- 6 named agents (Kara, Perry, Lois, Cat, Steel, Jimmy) with workspaces under `C:\Users\oreph\clawd\agents\`
- Gateway runs locally on `ws://127.0.0.1:18789`

Ore pointed us to **OpenClaw** — the open-source version at `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\Openclaw\` — to understand the architecture properly.

---

## Deep Dive: OpenClaw iMessage Architecture

We explored OpenClaw's `src/imessage/` directory and mapped the complete flow:

### Message Flow
```
iPhone (iMessage) → macOS Messages.app (stores in SQLite DB)
    → imsg CLI (native macOS binary, watches DB via JSON-RPC)
    → OpenClaw Node.js monitor (access control, routing)
    → AI Agent (Claude API with tools, skills, memory)
    → Reply via imsg RPC → back to iMessage group/DM
```

### Key Files in OpenClaw
| File | Purpose |
|------|---------|
| `src/imessage/client.ts` | JSON-RPC subprocess client to `imsg` |
| `src/imessage/send.ts` | Send messages via `imsg` RPC |
| `src/imessage/monitor/monitor-provider.ts` | Inbound message handling, access control, routing |
| `src/imessage/targets.ts` | Chat ID parsing, normalization, allowlist matching |
| `src/routing/resolve-route.ts` | Route messages to specific agents by chat/channel/peer |

### Group Chat Support (Built In)
- `is_group` flag detection
- `groupPolicy`: "open" | "allowlist" | "disabled"
- `groupAllowFrom`: allowlisted senders in groups
- `requireMention`: bot only responds when @mentioned (optional)
- Rolling history window for group context (default 20 messages)
- Per-group agent routing via bindings
- Participants list passed to agent as `GroupMembers`

### Chat Identification
iMessage chats are identified by:
- `chat_id` (numeric, e.g., `42`)
- `chat_guid` (e.g., `iMessage;+;chat123456`)
- `chat_identifier` (e.g., `chat123456789`)

NOT by name. You discover IDs via `imsg chats --json`.

---

## Key Discovery: `imsg` Is Standalone

`imsg` is NOT part of OpenClaw. It's a standalone open-source macOS CLI:
- **Repo:** https://github.com/steipete/imsg
- **Install:** `brew install steipete/tap/imsg`
- **License:** Open source (by Peter Steinberger)
- **Requires:** macOS 14+, Full Disk Access, Messages.app signed in

Key commands:
```bash
imsg chats --limit 10 --json          # discover chat IDs
imsg history --chat-id 1 --limit 20   # read message history
imsg watch --chat-id 1 --attachments  # real-time stream (notifications)
imsg send --to "+1..." --text "hi"    # send a message
imsg rpc                              # JSON-RPC mode for programmatic use
```

This means we can use `imsg` without any OpenClaw dependency.

---

## Design Decision: Build From Scratch

Ore decided NOT to use OpenClaw as a dependency. Reasons:
- Wants full ownership of the code
- Wants a simpler, purpose-built tool
- Happy to reference OpenClaw patterns but no runtime dependency
- OpenClaw is ~30,000 lines; this project targets ~300-500 lines

### What we borrow (patterns, not code):
- The `imsg` JSON-RPC integration pattern
- Chat ID-based routing (not name-based)
- Agent-per-project architecture
- Channel abstraction for future multi-channel support

### What we replace:
| OpenClaw | Our version |
|----------|-------------|
| Custom agent framework (memory, sessions, skills, compaction) | `claude -p` (Claude Code CLI) |
| Gateway WebSocket server | Simple Node.js service |
| 10+ channel plugins | Channel abstraction, starting with iMessage |
| Complex config system | Simple JSON config |

---

## Architecture Decision: Agent-Centric Model

Ore's key framing: **"I want to think of each route as an agent."**

Each project has a distinct agent identity with:
- Its own name and personality (CLAUDE.md)
- Its own skills
- Its own memory (persists across conversations)
- Its own workspace (git repo)
- Multiple channel routes in (iMessage, Slack, WhatsApp — fungible)

From the user's perspective: "I'm messaging the YouTube Show Agent" or "I'm messaging the AgenticLedger Agent" — not "I'm running claude -p with different flags."

---

## Architecture Decision: Channel Fungibility

Channels are interchangeable entry points to the same agent:
```jsonc
{
  "agents": {
    "fic-show": {
      "routes": [
        { "channel": "imessage", "chatId": 42 },
        { "channel": "slack", "chat": "#fic-planning" },
        { "channel": "whatsapp", "chat": "+1..." }
      ]
    }
  }
}
```

Today: iMessage only. Fast-follow: Slack, then WhatsApp. The channel layer is abstracted from day one so adding channels is config + a driver, not a rewrite.

---

## The Concrete Use Case: Finance Is Cooked

**Finance Is Cooked** is a weekly YouTube show about AI disrupting finance & accounting. The show app lives at:
- **Repo:** https://github.com/financeiscooked/financeiscooked-soundboard
- **Live:** https://ficsoundboard.netlify.app
- **Local:** `C:\Users\oreph\clawd\app\financeiscooked-soundboard`

The app has an Episodes tab with JSON-based show rundowns. A Claude skill (`.claude/skills/update-episode/SKILL.md`) already knows how to add segments, slides, articles, and images to episodes.

**The workflow:**
1. Ore and cohost are in an iMessage group chat
2. Someone texts: "Add this article about vibecoding to EP3 quick-updates"
3. The FIC Show Agent picks it up, edits `ep3.json`, commits, pushes
4. Netlify auto-deploys in ~30 seconds
5. Agent replies in the group: "Added to EP3 quick-updates as proposed"

All new content gets `"status": "proposed"` — only hosts can finalize during show prep.

---

## Environment Notes

- **Primary machine:** Windows 11 (C:\Users\oreph)
- **Mac available:** For running `imsg` + the service
- **Clawdbot already running:** On Windows with WhatsApp + Slack
- **Claude Code:** Available on both machines, same Anthropic account
- **Note:** Claude Code sessions don't sync across machines — hence pushing specs to git

---

## Summary of Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Use OpenClaw? | No (patterns only) | Want full ownership, simpler codebase |
| Use `imsg`? | Yes | Standalone, battle-tested, brew-installable |
| Agent execution | `claude -p` (Claude Code CLI) | Full tool access, skills, file editing — no custom runtime needed |
| Chat identification | By `chat_id` (numeric) | That's what `imsg` provides; discovered via `imsg chats --json` |
| Agent model | One agent per project directory | Each has identity, skills, memory, workspace |
| Channel model | Abstracted, pluggable | Start iMessage, fast-follow Slack + WhatsApp |
| First agent | FIC Show Agent | Update episode content for Finance Is Cooked |
| Repo | `agenticledger/channelToAgentToClaude` | Separate from any specific project |
