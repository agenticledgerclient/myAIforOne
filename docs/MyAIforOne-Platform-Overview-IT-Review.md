# MyAI for One — Platform Overview & IT Review

**Version:** 1.0
**Date:** April 2026
**Classification:** Client-Facing — IT Review

---

## 1. Executive Summary

MyAI for One is a **desktop application** that gives organizations a private, locally-hosted AI agent platform. It runs entirely on the employee's computer — like Microsoft Word or Microsoft Excel — with no cloud infrastructure, no hosted services, and no data leaving the machine.

The platform enables teams to create purpose-built AI agents that handle specialized tasks: research, document preparation, data analysis, project management, and more. Each agent has its own identity, tools, memory, and expertise — accessed through a local web dashboard or connected messaging channels (Slack, Microsoft Teams, iMessage).

**Key facts for IT review:**

- 100% local installation — runs as a desktop process, not a cloud service
- All data (conversations, files, memory) stored on the local file system
- Powered by the organization's own Claude (Anthropic) subscription — billed directly to your account
- No data is sent to, stored by, or accessible to the platform vendor
- No inbound network ports exposed — all external connections are outbound only

---

## 2. Architecture & Data Residency

### 2.1 Desktop-Local Architecture

MyAI for One runs as a single Node.js process on the user's workstation, managed by the operating system's native service manager (launchd on macOS, Task Scheduler on Windows). This is identical in deployment model to applications like Microsoft Word, Microsoft Excel, or VS Code — it is installed locally and operates entirely within the boundaries of the user's machine.

```
┌─────────────────────────────────────────────────────────┐
│                    USER'S COMPUTER                        │
│                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐  │
│  │  Web UI      │───▶│  Gateway     │───▶│  Claude   │  │
│  │  (localhost)  │    │  (Node.js)   │    │  (local)  │  │
│  └──────────────┘    └──────────────┘    └───────────┘  │
│                              │                           │
│                              ▼                           │
│                    ┌──────────────────┐                   │
│                    │  Local File      │                   │
│                    │  System          │                   │
│                    │  (all data here) │                   │
│                    └──────────────────┘                   │
│                                                          │
└─────────────────────────────────────────────────────────┘
          │ (outbound only)
          ▼
   ┌─────────────┐
   │  Anthropic  │  ← Organization's own Claude subscription
   │  API        │
   └─────────────┘
```

### 2.2 Data Residency — Nothing Leaves the Machine

| Data Type | Storage Location | Leaves the Computer? |
|-----------|-----------------|---------------------|
| Conversations | Local file system (`conversation_log.jsonl`) | No |
| Agent configurations | Local JSON config file | No |
| Memory & context | Local markdown/JSON files | No |
| Session history | Local Claude session storage | No |
| Uploaded files | Local file system | No |
| Credentials & tokens | Local config (gitignored) | No |
| Skills & prompts | Local markdown files | No |

**The only outbound traffic** is the AI inference request sent to Anthropic's API — using the organization's own subscription credentials. This is the same traffic pattern as any application that calls a cloud API (e.g., Microsoft Office calling Microsoft 365 services, or Slack desktop calling Slack's servers).

### 2.3 No Vendor-Hosted Components

There is no:
- Cloud database
- Vendor-managed server
- Centralized data store
- Telemetry or analytics collection
- Phone-home mechanism
- Automatic update service that transmits data

---

## 3. Authentication & Subscription Model

### 3.1 Organization's Own Claude Subscription

MyAI for One does **not** include, bundle, or resell AI capabilities. It is a client application that connects to the organization's own Claude subscription from Anthropic.

| Aspect | Details |
|--------|---------|
| **Provider** | Anthropic (Claude) |
| **Billing** | Direct to the organization's Anthropic account |
| **API Key Control** | Organization manages its own API credentials |
| **Plan Selection** | Organization chooses its own plan tier (Pro, Team, Enterprise) |
| **Rate Limits** | Governed by the organization's subscription level |
| **Data Handling** | Governed by the organization's agreement with Anthropic |

This is analogous to how Microsoft Word requires a Microsoft 365 subscription — the application is local, but the AI/cloud features use the organization's own account.

### 3.2 Multi-Account Support

Organizations can configure multiple Claude accounts for different teams or cost centers:
- Separate billing per department
- Different plan tiers for different agent workloads
- Isolated credential management per team
- All accounts remain under the organization's control

### 3.3 No Platform Vendor Account Required

The platform vendor does not:
- Require user accounts on any external service
- Collect or store organization credentials
- Proxy, intercept, or log API traffic
- Have access to conversation content or agent data

---

## 4. Core Capabilities

### 4.1 AI Agents

Agents are specialized AI assistants, each with a defined role, tools, and expertise. Think of them as team members with specific job descriptions.

| Capability | Description |
|-----------|-------------|
| **Custom System Prompts** | Define each agent's role, expertise, constraints, and behavior |
| **Scoped Workspaces** | Restrict file access to specific project directories |
| **Tool Permissions** | Control what each agent can do (read-only, read-write, full access) |
| **Persistent Memory** | Agents remember context across conversations |
| **Advanced Memory** | Semantic long-term recall with automatic summarization |
| **Organization Structure** | Place agents in departments with reporting hierarchies |
| **Templates** | Deploy pre-configured agents from a template library |

### 4.2 Multi-Channel Communication

Users interact with agents through their preferred messaging platform:

| Channel | Connection Type | IT Requirement |
|---------|----------------|---------------|
| **Web UI** | localhost (no network) | None — browser on same machine |
| **Slack** | Outbound WebSocket | Organization's own Slack bot |
| **Microsoft Teams** | Outbound WebSocket | Organization's own Teams bot |
| **Telegram** | Outbound long-polling | Bot token from BotFather |
| **iMessage** | Local macOS API | macOS only, no network |
| **Discord** | Outbound WebSocket | Bot token |

All channel connections are **outbound only** — no inbound ports, no public URLs, no webhooks exposed to the internet.

### 4.3 Projects & Task Management

- Multi-agent project coordination
- Task assignment and tracking across agents
- Plan documentation and status monitoring
- Linked artifacts, agents, and organizations per project
- Autonomous execution with scheduled goals

### 4.4 Boards (Dashboards)

- Configurable widget surfaces showing agent outputs
- Morning briefing displays, status dashboards
- Auto-refreshing widgets with scheduled data pulls
- Resizable, repositionable grid layout

### 4.5 Library (Skills, Prompts, MCPs)

- **Skills** — Reusable instruction sets that extend agent capabilities
- **Prompts** — Templated conversation starters with trigger conditions
- **MCPs (Model Context Protocol)** — Structured integrations with external services

### 4.6 Lab (Agent Factory)

- Guided agent creation through natural conversation
- Template-based deployment for rapid agent setup
- Agent creation wizard with step-by-step configuration

### 4.7 Automation

| Feature | Description |
|---------|-------------|
| **Cron Jobs** | Scheduled message triggers on configurable intervals |
| **Goals** | Autonomous task execution with agent self-direction |
| **Heartbeats** | Periodic agent health checks and status reports |
| **Wiki Sync** | Automatic knowledge base updates from conversations |

### 4.8 Administration

- Local web dashboard on `localhost:4888` (not exposed to network)
- Channel credential management
- Agent activity monitoring and cost tracking
- Session management (reset, compact, view logs)
- Service configuration and platform settings
- Voice mode configuration (TTS/STT)

---

## 5. Security & Privacy

### 5.1 Data Isolation

| Security Property | Implementation |
|-------------------|---------------|
| **Data at rest** | All files stored on local disk under user's OS permissions |
| **Data in transit** | Only AI inference requests leave the machine (HTTPS to Anthropic) |
| **No data exfiltration** | No telemetry, analytics, or usage reporting to any external service |
| **No shared infrastructure** | Each installation is fully independent |
| **OS-level access control** | Standard file system permissions apply |

### 5.2 Network Posture

- **Zero inbound ports** — No HTTP server exposed to the network (Web UI binds to `localhost` only)
- **Outbound connections only** — Slack, Telegram, Discord use outbound WebSocket/polling
- **No public URL required** — No ngrok, no tunnels, no DNS records
- **No peer-to-peer** — Installations do not communicate with each other

### 5.3 Credential Management

- API keys and tokens stored in local config file (gitignored by default)
- macOS Keychain integration available for sensitive credentials
- No credentials transmitted to or stored by the platform vendor
- MCP connection keys stored locally with OS-level encryption options

### 5.4 What the Platform Vendor Cannot Do

| Action | Possible? |
|--------|-----------|
| Access your conversations | No |
| Read your files or documents | No |
| View your agent configurations | No |
| See which channels you use | No |
| Monitor your usage patterns | No |
| Push code or updates without your action | No |
| Disable your installation remotely | No |

---

## 6. Deployment Model

### 6.1 System Requirements

| Component | Requirement |
|-----------|-------------|
| **Operating System** | macOS 12+ or Windows 10+ |
| **Runtime** | Node.js 18+ |
| **Disk Space** | ~200 MB for application + agent data |
| **Network** | Outbound HTTPS (port 443) to Anthropic API |
| **Claude Subscription** | Active Anthropic account (Pro, Team, or Enterprise) |

### 6.2 Installation

The application is installed locally like any desktop software:

1. Clone or download the application package
2. Run `npm install` to install dependencies
3. Run `npm run build` to compile
4. Configure the service to auto-start with the OS

**macOS:** Managed via `launchd` (same mechanism as system services)
**Windows:** Managed via Task Scheduler (same mechanism as scheduled tasks)

### 6.3 Updates

Updates are applied manually by the organization's IT team — there is no automatic update mechanism. The organization controls when and whether to update, just like any locally-installed application.

### 6.4 Comparison to Familiar Desktop Applications

| Property | Microsoft Excel | MyAI for One |
|----------|----------------|--------------|
| Runs locally | Yes | Yes |
| Data stored on local disk | Yes | Yes |
| Requires internet for AI features | Yes (Copilot) | Yes (Claude API) |
| Subscription billed to org | Yes (M365) | Yes (Anthropic) |
| No data sent to app vendor | Yes* | Yes |
| IT controls updates | Yes | Yes |
| Works offline (core features) | Partial | Partial (local agents work, AI calls need internet) |

*Microsoft 365 does collect telemetry; MyAI for One does not.

---

## 7. Integration Points

### 7.1 External Service Connections

All integrations are configured and controlled locally by the organization:

| Integration | Purpose | Who Controls It |
|-------------|---------|-----------------|
| **Anthropic API** | AI inference (Claude) | Organization's subscription |
| **Slack Bot** | Messaging channel | Organization's Slack workspace |
| **MCP Servers** | Tool integrations (APIs, databases) | Organization configures locally |
| **OpenAI API** (optional) | Embeddings for advanced memory | Organization's key, if enabled |

### 7.2 MCP (Model Context Protocol) Integrations

MCPs allow agents to interact with external services through structured tool definitions. Examples:

- QuickBooks (accounting)
- Google Calendar (scheduling)
- Gmail (email)
- Notion (knowledge base)
- Custom internal APIs

Each MCP connection is:
- Configured locally by the organization
- Authenticated with the organization's own credentials
- Scoped to specific agents (not global)
- Removable at any time without affecting other agents

### 7.3 No Vendor-Managed Integrations

The platform vendor does not:
- Host proxy services for integrations
- Store integration credentials
- Route traffic through vendor infrastructure
- Require vendor approval for new integrations

---

## 8. Administration & Monitoring

### 8.1 Web Dashboard

The administration interface runs on `localhost:4888` — accessible only from the local machine's browser.

| Section | Capabilities |
|---------|-------------|
| **Home** | Agent chat, quick access to all agents |
| **Agents (Org)** | View org chart, manage agents, edit configurations |
| **Library** | Browse and manage skills, prompts, MCP connections |
| **Lab** | Create new agents through guided workflows |
| **Admin** | Channel setup, activity logs, platform settings, API docs |
| **Monitor** | Health dashboard, setup checklist, service status |
| **Projects** | Multi-agent project coordination |
| **Boards** | Configurable dashboards with agent output widgets |

### 8.2 Activity & Cost Tracking

- Per-agent message counts and response times
- Token usage tracking per agent and time period
- Conversation logs with full audit trail
- Session management (view, reset, compact)

### 8.3 Health Monitoring

- Service uptime and status
- Channel connection health
- Agent heartbeat monitoring
- Setup completeness checklist

---

## 9. AI Gym (Learning & Development)

AI Gym is a built-in learning module that helps team members develop AI collaboration skills through structured programs.

### 9.1 Capabilities

| Feature | Description |
|---------|-------------|
| **Programs** | Multi-session learning paths (e.g., "Prompt Engineering Fundamentals") |
| **Series** | Grouped programs for progressive skill building |
| **Guided Exercises** | Interactive lessons with an AI coach |
| **Progress Tracking** | Per-user enrollment, completion tracking, certificates |
| **AI Strength Dimensions** | Skill assessment across multiple AI competency areas |
| **Activity Digest** | Summary of learning activity and recommendations |
| **Custom Content** | Organizations can create their own training programs |

### 9.2 Use Cases

- Onboarding new team members to AI tools
- Developing prompt engineering skills
- Building competency in specific agent workflows
- Measuring team AI readiness

---

## Appendix A: Frequently Asked Questions (IT)

**Q: Does any data leave the computer?**
A: The only outbound data is the AI inference request to Anthropic's API (using your organization's subscription). No data is sent to the platform vendor, no telemetry is collected, and no usage analytics leave the machine.

**Q: What happens if we lose internet connectivity?**
A: The platform continues to run locally. Agents that require AI inference (most agents) will be unable to generate responses until connectivity is restored. Local files, configurations, and history remain accessible.

**Q: Can the vendor access our data remotely?**
A: No. There is no remote access mechanism, no phone-home capability, and no backdoor. The application runs entirely on your hardware under your OS user permissions.

**Q: How is this different from a SaaS AI tool?**
A: SaaS tools (like ChatGPT Teams or Gemini for Workspace) run on the vendor's servers, store conversations in the vendor's cloud, and process data on the vendor's infrastructure. MyAI for One is a local application — like installing Excel vs. using Google Sheets. Your data never leaves your machine.

**Q: What network ports does it use?**
A: Only outbound HTTPS (port 443) to Anthropic's API and optionally to messaging platforms (Slack, Telegram, etc.) that your organization configures. No inbound ports are opened. The Web UI binds exclusively to `localhost:4888` and is not accessible from other machines on the network.

**Q: How do we control which AI model is used?**
A: The organization's Anthropic subscription determines available models. Administrators can set model preferences per agent through the local admin dashboard.

**Q: Can we audit what the agents are doing?**
A: Yes. Every conversation is logged locally in `conversation_log.jsonl` per agent. Activity logs, token usage, and session history are all viewable in the admin dashboard — stored entirely on local disk.

**Q: How do we uninstall it?**
A: Stop the service (unload from launchd/Task Scheduler), delete the application directory, and optionally remove the Claude session data from `~/.claude/`. No registry entries, no kernel extensions, no system modifications to reverse.

---

## Appendix B: Data Flow Summary

```
User types message
        │
        ▼
[Local Web UI / Slack / Teams]
        │
        ▼ (localhost or outbound WebSocket)
[Gateway Process — on user's machine]
        │
        ├──▶ [Local File System] — reads/writes agent files
        │
        ├──▶ [Claude CLI — on user's machine] — spawns local process
        │           │
        │           ▼ (outbound HTTPS, port 443)
        │    [Anthropic API] — AI inference only
        │           │
        │           ▼ (response)
        │    [Claude CLI returns response]
        │
        ▼
[Response delivered to user via same channel]
```

**Data that crosses the network boundary:**
- AI prompt + context → Anthropic API (encrypted HTTPS)
- AI response ← Anthropic API (encrypted HTTPS)
- Messaging (if Slack/Teams configured) → Organization's own messaging platform

**Data that never crosses the network boundary:**
- File contents, agent configurations, conversation logs, memory, credentials, skills, templates, project data, board data, user preferences

---

*Document prepared for IT review. For questions, contact your account representative.*
