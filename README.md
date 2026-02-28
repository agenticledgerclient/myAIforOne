# channelToAgentToClaude

A personal agent gateway that routes messages from your phone (iMessage, Slack, WhatsApp) to project-specific Claude Code agents running on your Mac.

## What It Does

```
Your Phone (iMessage group chat)
    → Mac service detects message
    → Routes to the right agent (by chat ID)
    → Agent runs claude -p in project workspace
    → Reply sent back to group chat
```

Each project has its own agent with identity, skills, memory, and workspace. Channels are pluggable — same agent reachable from iMessage, Slack, or WhatsApp.

## Quick Start (Mac)

```bash
# Prerequisites
brew install steipete/tap/imsg          # iMessage CLI bridge
npm install -g @anthropic-ai/claude-code # Claude Code CLI

# Setup
git clone https://github.com/agenticledger/channelToAgentToClaude.git
cd channelToAgentToClaude
npm install

# Discover your iMessage chat IDs
imsg chats --limit 20 --json

# Edit config.json with your chat_id + workspace path
# Then start:
npm start
```

## Documentation

- **[BUILD_SPEC.md](BUILD_SPEC.md)** — Detailed build specification (start here if building)
- **[CONVERSATION_HISTORY.md](CONVERSATION_HISTORY.md)** — Design journey and architectural decisions

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  iMessage    │     │    Slack     │     │  WhatsApp    │
│  (via imsg)  │     │  (future)   │     │  (future)    │
└──────┬───────┘     └──────┬──────┘     └──────┬───────┘
       │                    │                    │
       ▼                    ▼                    ▼
┌────────────────────────────────────────────────────────┐
│  Router (channel + chatId → agent)                     │
├────────────────────────────────────────────────────────┤
│  Agent Executor (claude -p --cwd /workspace)           │
├────────────────────────────────────────────────────────┤
│  Reply back via originating channel                    │
└────────────────────────────────────────────────────────┘
```

## First Agent: FIC Show Agent

Routes an iMessage group chat to manage episode content for [Finance Is Cooked](https://ficsoundboard.netlify.app) — a weekly YouTube show about AI disrupting finance & accounting.

## License

MIT
