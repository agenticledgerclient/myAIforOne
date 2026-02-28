# Executor Options: claude -p vs SDK vs Direct API

How the agent executes Claude — trade-offs between the three approaches.

**Current implementation: `claude -p` (CLI subprocess)**

---

## Option 1: `claude -p` (Current)

Spawns `claude -p` as a subprocess for each message. Claude Code handles everything.

**How it works:**
```
Message in → spawn("claude", ["-p", prompt, ...]) → capture stdout → reply
```

**Pros:**
- Isolation — each call is a separate process. Crashes don't affect the service.
- Language agnostic — works from Python, Go, Rust, anything that can spawn a process.
- Zero integration code — one `spawn()` call, ~20 lines for the executor.
- Auto-updates — new Claude Code features come free on update.
- Stateless — no session cleanup, no memory management. Process starts, works, exits.
- Full tool access out of the box — Read, Write, Edit, Bash, Glob, Grep, MCP, web search, etc.

**Cons:**
- Slow (~30-60 seconds per response) — cold start of Node.js process + Claude Code runtime on every message.
- Heavy — spawns a full Node.js process each time.
- No streaming — can't send partial responses as they generate.

**Best for:** Prototyping, low-volume agents, complex multi-step tasks where response time isn't critical.

---

## Option 2: SDK (`@anthropic-ai/claude-code` as a library)

Import Claude Code as a library, call it in-process. Same tools and agentic loop, no subprocess overhead.

**How it works:**
```
Message in → claudeCode({ prompt, cwd, systemPrompt }) → response → reply
```

**Pros:**
- Much faster (~5-15 seconds) — no cold start, runs in-process.
- Full tool access — same Read, Write, Edit, Bash, Glob, Grep as `claude -p`.
- Agentic loop included — multi-step tool use chains work automatically.
- Context management — handles window limits, compression.
- MCP support — same as CLI.

**Cons:**
- In-process — a bad agent call (memory leak, crash) can take down the service.
- JavaScript/TypeScript only — tied to Node.js.
- Pinned dependency — must manually update to get new features.
- More integration code than `claude -p` (but less than direct API).

**Best for:** Production agents where response time matters but you still need full tool access.

---

## Option 3: Direct API (`@anthropic-ai/sdk`)

Call the Anthropic Messages API directly. Implement your own tools and agent loop.

**How it works:**
```
Message in → anthropic.messages.create({ messages, tools }) → handle tool_use → loop → reply
```

**Pros:**
- Fastest possible (~3-10 seconds) — just HTTP to Anthropic, zero overhead.
- Full control — choose exactly which tools exist, how they behave.
- Minimal dependencies — just the Anthropic SDK.
- Streaming — can send partial responses as they generate.
- Lightweight — no Claude Code runtime loaded at all.

**Cons:**
- You build everything:
  - The agentic tool loop (~200-300 lines): call API → check for tool_use → execute → send result → repeat
  - Each tool handler: file read, write, edit, bash, glob, grep
  - Context window management
  - Error recovery and retries
- No free updates — new tools/features require manual implementation.
- More surface area for bugs in tool implementations.

**Best for:** High-volume, latency-sensitive agents with simple, well-defined tool needs.

---

## Recommendation

| Scenario | Best Choice |
|----------|-------------|
| Getting started / prototyping | `claude -p` |
| Production, response time matters, full tool access | SDK |
| Simple agent (read file + respond), maximum speed | Direct API |
| Non-JavaScript service | `claude -p` |
| Agent does complex multi-file edits | SDK or `claude -p` |

### For the FIC Show Agent specifically:

The agent mostly reads episode JSON files and makes edits — 2-3 tool calls per request. All three approaches work, but:

- **Now:** `claude -p` is fine. It works, it's simple, response time is acceptable for async text messages.
- **If response time becomes a pain:** Switch to SDK. Same capabilities, ~3-4x faster. Only the executor file changes — router, channels, config all stay the same.
- **If we strip it down to a focused bot:** Direct API with custom `readFile` and `editFile` tools. Fastest, but more code to maintain.

The architecture is designed so the executor is swappable without touching anything else.
