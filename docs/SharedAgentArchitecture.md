# Shared Agent Architecture

> **Status:** Draft / Vision
> **Author:** @myagentdev
> **Date:** 2026-04-11

## Overview

Shared agents are standard agents that a team of people can use together. They have 100% feature parity with personal agents — same skills, goals, tasks, MCPs, memory, sessions, everything — but their data lives in a shared location (server-local or cloud Drive) and they're accessed through a shared gateway.

The personal platform is completely untouched. Users keep their local gateway and private agents. The shared gateway is a second MyAgent instance running on a server, dedicated to team agents.

### Use Case

A finance department with 5 people. They all need to talk to the same `@finance-analyst` agent. The agent builds up shared knowledge from everyone's conversations. Each person also has their own private agents on their personal gateway at home.

---

## Section 1 — Hybrid Model

```
[Alice's Mac]                         [Shared Server]
  Personal gateway                      Shared gateway
  ├── @me-agent (private)               ├── @finance-analyst (shared)
  ├── @tax2025 (private)                ├── @budget-tracker (shared)
  └── @ailead (private)                 └── @compliance-bot (shared)
       │                                     │
  Local Drive                           Per-agent storage choice:
  (unchanged)                             Server-local OR Google Drive
```

| Layer | Personal | Shared |
|-------|----------|--------|
| Gateway | Local (user's machine) | Hosted (server, always-on) |
| Agents | Private, single-user | Shared, multi-user |
| Config | Local `config.json` | Server `config.json` |
| Channels | User's own Slack/Telegram/etc. | Team Slack workspace, shared web UI URL |
| Data | Local Drive | Per-agent: server-local or cloud Drive |

### What changes vs personal

| Aspect | Personal Gateway | Shared Gateway |
|--------|-----------------|----------------|
| Who runs it | The user | Server admin / IT / team lead |
| Who talks to agents | One person | Multiple team members |
| Sessions | One sender | Multiple senders (isolated by senderId) |
| Memory | Built from one person's conversations | Built from everyone's conversations |
| Agent config | User manages | Admin manages (or delegated) |

### What stays the same

Everything else. The shared gateway is the exact same MyAgent codebase — same executor, same router, same channels, same MCP system. No fork, no special build. Just a second instance configured for team use.

---

## Section 2 — Per-Agent Storage Choice

Each shared agent independently chooses where its data lives. This is a per-agent config, not a global setting.

### Option A: Server-Local Storage

```jsonc
{
  "id": "finance-analyst",
  "agentClass": "standard",
  "storage": "local",
  "agentHome": "/data/shared-agents/finance-analyst"
}
```

```
[Shared Server]
  /data/shared-agents/
  └── finance-analyst/
      ├── CLAUDE.md
      ├── soul.md
      ├── memory/
      │   ├── context.md
      │   ├── conversation_log.jsonl
      │   ├── daily/
      │   └── vectors.json
      ├── FileStorage/
      ├── goals/
      ├── skills/
      └── tasks.json
```

- Data lives on the server's filesystem
- Simplest setup — no external dependencies
- Server operator holds the data
- If server goes down, data is on that server (backup strategy needed)

### Option B: Cloud Drive Storage

```jsonc
{
  "id": "budget-tracker",
  "agentClass": "standard",
  "storage": "drive",
  "agentHome": "/mnt/gdrive/SharedAgents/budget-tracker",
  "storageProvider": "google-drive"
}
```

```
[Google Drive / Dropbox / OneDrive] (shared with team)
  SharedAgents/
  └── budget-tracker/
      ├── CLAUDE.md
      ├── soul.md
      ├── memory/
      │   ├── context.md
      │   ├── conversation_log.jsonl
      │   ├── daily/
      │   └── vectors.json
      ├── FileStorage/
      ├── goals/
      ├── skills/
      └── tasks.json
```

- Data lives in the team's own cloud storage
- Team controls the data — can revoke server access anytime by unsharing the folder
- Fits orgs that don't want a third party holding their data
- Slightly more latency on reads/writes
- Requires the cloud Drive to be mounted/synced on the server

### Mixed Example

A team with three shared agents, each with different storage:

```jsonc
{
  "agents": [
    {
      "id": "finance-analyst",
      "storage": "local",
      "agentHome": "/data/shared-agents/finance-analyst"
    },
    {
      "id": "budget-tracker",
      "storage": "drive",
      "agentHome": "/mnt/gdrive/SharedAgents/budget-tracker"
    },
    {
      "id": "compliance-bot",
      "storage": "drive",
      "agentHome": "/mnt/team-dropbox/Agents/compliance-bot"
    }
  ]
}
```

### Under the hood

The gateway doesn't care where the filesystem is. `agentHome` is already an absolute path. Whether it points to `/data/shared-agents/X` (local) or `/mnt/gdrive/SharedAgents/X` (mounted Drive) changes nothing in the executor, router, or memory system. The `storage` and `storageProvider` fields are metadata for the admin UI and setup tooling — they don't affect runtime behavior.

---

## Section 3 — Multi-User Session Isolation

When multiple people talk to the same shared agent, each person gets their own conversation thread. This already works today — sessions are keyed by `senderId`.

### How it works

```
Alice messages @finance-analyst on Slack → senderId: "U_ALICE"
Bob messages @finance-analyst on Slack   → senderId: "U_BOB"
Carol messages via web UI                → senderId: "web-carol"
```

Each gets a separate:
- Session (independent conversation state)
- Session tab (if using tabs)
- Conversation thread

### What IS always shared across all users

| Shared | Why |
|--------|-----|
| `CLAUDE.md` (system prompt) | Same agent identity for everyone |
| `soul.md` | Same personality for everyone |
| `context.md` | Accumulated knowledge from all conversations |
| `memory/daily/` journals | Agent's daily summaries include all users' interactions |
| `tasks.json` | Shared task list |
| `goals/` | Shared scheduled automations |
| `skills/` | Same skills for everyone |
| `FileStorage/` | Shared uploaded files |

### What is NOT shared

| Isolated | Why |
|----------|-----|
| Active session state | Each user has their own conversation thread |
| Session tabs | Per-user tabs |

### Decision: Conversation log sharing is per-agent config

> **Decided:** Whether conversation logs are shared or per-user is a **per-agent configuration**.

```jsonc
{
  "id": "finance-analyst",
  "conversationLogMode": "shared"    // "shared" or "per-user"
}
```

**Mode: `shared`** (default) — All team members' conversations go into one `conversation_log.jsonl`. The agent sees everyone's history. Alice's question about salary data is visible to the agent when Bob asks next. Best for: knowledge-building agents where shared context is the point.

**Mode: `per-user`** — Each user gets their own conversation log: `conversation_log_U_ALICE.jsonl`, `conversation_log_U_BOB.jsonl`. The agent only sees the current user's history in context. Best for: sensitive agents where conversations should stay private between each user and the agent.

```
memory/
├── conversation_log.jsonl              ← shared mode (one file)
├── conversation_log_U_ALICE.jsonl      ← per-user mode
├── conversation_log_U_BOB.jsonl        ← per-user mode
├── context.md                          ← always shared
└── daily/                              ← always shared
```

Note: Even in per-user mode, `context.md` and `daily/` journals are still shared — the agent's accumulated knowledge benefits everyone. Only the raw conversation logs are isolated.

---

## Section 4 — Team Access & Channels

### How team members connect

**Slack (recommended for teams):**
- Shared agent is configured with a route on the team's Slack workspace
- Team members `@mention` the agent in a channel or DM it
- Most natural for team use — already how teams communicate

**Web UI:**
- Shared gateway serves the web UI on a URL (e.g., `https://agents.company.com` or `http://192.168.1.50:4888`)
- Team members visit the URL, select the agent, and chat
- No special auth today — future consideration

**Other channels:**
- Telegram group, Discord server — same channel driver, shared workspace
- Each channel route is configured in the shared gateway's `config.json`

### Admin vs User

For the initial version, there's no role separation — anyone who can access the shared gateway's web UI can see and configure agents. This is fine for small teams. Role-based access control (RBAC) is a future phase.

| Action | Who can do it (v1) | Future (RBAC) |
|--------|-------------------|---------------|
| Chat with shared agents | Everyone | Everyone |
| View agent config | Everyone | Everyone |
| Edit agent config | Everyone | Admin only |
| Create/delete agents | Everyone | Admin only |
| View conversation logs | Everyone | Configurable |
| Manage goals/tasks | Everyone | Configurable |

---

## Section 5 — What Does NOT Change

The shared gateway is the same codebase. These things stay identical:

- **Executor** — same `claude -p` spawn, same MCP config generation, same session management
- **Router** — same channel + chatId + alias routing
- **Memory system** — same context.md, vectors.json, daily journals, advanced memory, wiki
- **MCP hub** — same MCP registry, same tool injection
- **Skills** — same skill system
- **Goals & cron** — same scheduled automation
- **Agent classes** — shared agents can be `standard`, `super`, `builder`, whatever. The storage/sharing is orthogonal to agent class
- **Config format** — same `config.json` structure

### The only differences at deploy time

| Setting | Personal Gateway | Shared Gateway |
|---------|-----------------|----------------|
| Where it runs | User's Mac | Server (Railway, VPS, always-on Mac) |
| `config.json` agents | Personal agents | Shared agents |
| Channel tokens | User's Slack/Telegram | Team Slack/Telegram |
| Drive paths | User's local Drive | Server-local or mounted cloud Drive |
| Web UI port | `localhost:4888` | Public/internal URL |

---

## Section 6 — Deployment Options

### Light (small team, ≤10 people)

- Run on a team lead's always-on Mac or a cheap VPS ($5-10/mo)
- Mount Google Drive via `google-drive-ocamlfuse` or Dropbox CLI for Drive storage agents
- Team connects via Slack or web UI URL on local network

### Medium (department, 10-50 people)

- Deploy on Railway, Render, or AWS Lightsail
- Server-local storage with automated backups
- Or mount cloud storage via FUSE/rclone
- Slack Socket Mode for team workspace

### Enterprise (future)

- Kubernetes deployment
- RBAC and auth
- Audit logging
- SSO integration
- Multiple shared gateways per department

---

## Section 7 — Storage Implementation: How Reads & Writes Work

When a shared agent's data lives on a cloud Drive (Google Drive, Dropbox, OneDrive), the gateway reads and writes through a mounted filesystem. This section explains the mechanics.

### The Write Flow

Every time a user messages a shared agent:

```
1. User sends message via Slack/web
2. Gateway receives message, routes to agent
3. Executor spawns Claude with system prompt
4. Claude responds
5. Gateway writes to agent files:
   ├── conversation_log.jsonl  (append one line — the exchange)
   ├── memory/context.md       (update if advanced memory is on)
   ├── memory/daily/<date>.md  (append to today's journal)
   ├── memory/vectors.json     (update if vector memory is on)
   └── tasks.json              (update if agent modified tasks)
6. If storage = "drive": mount client syncs changes to cloud
```

### Why One Gateway = No Conflicts

The critical design choice: **one shared gateway = one writer process**. All five team members' messages funnel through a single Node.js process. The gateway writes sequentially — even if Alice and Bob message simultaneously, the executor handles them one at a time (or queues them). There's never two processes writing to `conversation_log.jsonl` at the same time.

This is the key advantage over the "shared Drive, personal gateways" approach where five separate processes could write to the same file simultaneously.

### Cloud Drive Mount Options

The gateway writes to what looks like a local folder. A mount client handles syncing to the cloud in the background.

| Mount Tool | Platform | How It Works | Write Latency | Best For |
|------------|----------|-------------|---------------|----------|
| **rclone mount** | Linux, macOS | FUSE mount with configurable cache | Fast (cache mode) or slow (no cache) | Most flexible, all cloud providers |
| **google-drive-ocamlfuse** | Linux | FUSE mount for Google Drive | Fast (local cache) | Google Drive on Linux servers |
| **Google Drive for Desktop** | macOS, Windows | Native sync client | Fast (local cache) | Dev/small team on Mac |
| **Dropbox CLI** | Linux | Native headless sync | Fast (local cache) | Dropbox teams |
| **OneDrive (rclone)** | Linux | rclone FUSE mount | Fast (cache mode) | Microsoft 365 teams |

### Recommended: rclone with Write-Back Cache

```bash
# Mount Google Drive with write-back cache (recommended for shared agents)
rclone mount gdrive:SharedAgents /mnt/gdrive/SharedAgents \
  --vfs-cache-mode writes \
  --vfs-write-back 5s \
  --dir-cache-time 30s \
  --allow-other
```

| Flag | What It Does |
|------|-------------|
| `--vfs-cache-mode writes` | Writes go to local cache first, then sync to cloud in background. Reads go direct to cloud (always fresh). |
| `--vfs-write-back 5s` | Wait 5 seconds after last write before uploading. Batches rapid writes (e.g., conversation log + context.md + daily journal all written in quick succession). |
| `--dir-cache-time 30s` | Cache directory listings for 30 seconds. Reduces API calls. |
| `--allow-other` | Let the gateway process (which may run as a different user) access the mount. |

### What Happens During Each Write Type

| File | Write Pattern | Cloud Sync Behavior |
|------|--------------|-------------------|
| `conversation_log.jsonl` | Append one line per exchange | Small append, syncs within `--vfs-write-back` window |
| `memory/context.md` | Full file rewrite after each conversation (if advanced memory on) | Replaces file in cloud, no merge needed |
| `memory/daily/<date>.md` | Append to today's journal | Small append, same as conversation log |
| `memory/vectors.json` | Full file rewrite when vectors updated | Replaces file in cloud |
| `tasks.json` | Full file rewrite when tasks change | Replaces file in cloud |
| `FileStorage/*` | Written when user uploads files | File-level upload, no conflict risk |

### Durability & Edge Cases

**Normal operation:** Gateway writes to local cache → rclone syncs to cloud within 5 seconds. Team members browsing the Google Drive folder see updates within seconds.

**Gateway restarts:** If the gateway crashes mid-write:
- `conversation_log.jsonl`: Append-only, so at worst you lose the last exchange. Previous data is safe.
- `context.md` / `tasks.json`: Full-file rewrites, so either the old version or new version is on disk — no partial writes (Node.js `writeFileSync` is atomic on most filesystems).

**Cloud goes offline:** rclone cache holds writes locally. When cloud reconnects, it syncs. No data loss as long as server disk is intact.

**Server goes offline:** If server-local storage, data is on the server (need backups). If Drive storage, data is safe in the cloud — just need a new server and remount.

### Server-Local Storage: No Mount Needed

When `storage: "local"`, there's no cloud sync involved. The gateway reads and writes directly to the server's filesystem. Standard backup practices apply (cron rsync, cloud backup agent, etc.).

```
Server-local: gateway writes → /data/shared-agents/finance-analyst/memory/...
                                 ↑ direct filesystem, no mount, no sync
```

### Per-Agent Storage Config Reference

```jsonc
{
  "id": "finance-analyst",
  "storage": "local",                    // "local" or "drive"
  "storageProvider": null,               // null for local
  "agentHome": "/data/shared-agents/finance-analyst"
}

{
  "id": "budget-tracker",
  "storage": "drive",
  "storageProvider": "google-drive",     // "google-drive", "dropbox", "onedrive", "custom"
  "agentHome": "/mnt/gdrive/SharedAgents/budget-tracker"
}
```

The `storage` and `storageProvider` fields are metadata — they tell the admin UI and setup tooling how the data is stored. At runtime, the gateway only cares about `agentHome` (an absolute path). Whether that path is local or a mount point is transparent to the executor.

---

## Decisions Log

All open questions have been resolved:

| # | Question | Decision |
|---|----------|----------|
| 1 | Auth for web UI? | **Auth from day 1.** Shared gateway requires authentication — no open access. |
| 2 | Conversation log privacy? | **Per-agent config.** `conversationLogMode: "shared"` (one log for all users) or `"per-user"` (separate log per user). See Section 3. |
| 3 | Concurrent write risk on restart? | **Don't worry about it yet.** One gateway = one writer. Edge case risk is minimal. |
| 4 | Backup strategy? | **Deferred** to a future phase. |
| 5 | Cloud Drive mounting? | **Google Drive is the base use case.** Mount details (rclone etc.) are an implementation detail covered in Section 7. |
| 6 | Shared super agents? | **Not supported initially.** Super agents are not part of the shared agent scope for the initial build. |
| 7 | Cross-gateway observation? | **No.** Personal super agents cannot observe shared agents on a different server. |
| 8 | Config sync? | **Single config.json, last-write-wins.** Good enough for small teams. |
| 9 | Cost tracking? | **Per-agent.** Existing cost tracking is per-agent, which works for shared agents. |
| 10 | Migration (personal ↔ shared)? | **Create a new agent, then copy the data you want.** Not an in-place migration — treated as creating a new agent and selectively bringing over files. |

---

## Summary

Shared agents = same agents, same code, second gateway instance, per-agent storage choice (Google Drive as base case). Auth required from day 1. Conversation log sharing is per-agent config. The personal platform doesn't change — you just run another copy for the team.
