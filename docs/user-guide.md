# MyAIforOne — User Guide

> Master reference for every page, button, action, API endpoint, and MCP tool in the MyAIforOne platform.
> Organized by UI page. Each action includes its API and MCP mapping.
> Intended audience: hub agent, platform agents, and advanced users.

---

## Table of Contents

1. [Home](#1-home)
2. [Agents (Org)](#2-agents-org)
   - [Agent List](#21-agent-list)
   - [Agent Creation / Edit Modal](#22-agent-creation--edit-modal)
   - [Agent Dashboard](#23-agent-dashboard)
3. [Chat](#3-chat)
4. [Library](#4-library)
5. [Lab](#5-lab)
6. [Marketplace](#6-marketplace)
7. [Admin](#7-admin)
   - [Channels](#71-channels)
   - [Activity](#72-activity)
   - [Settings](#73-settings)
   - [Docs](#74-docs)
8. [Monitor](#8-monitor)
   - [Setup Checklist](#81-setup-checklist)
   - [Dashboard](#82-dashboard)
9. [Projects](#9-projects)
10. [AI Gym](#10-ai-gym)
   - [Onboarding](#101-onboarding-first-visit)
   - [Main Gym View](#102-main-gym-view)
   - [Dimensions](#103-ai-strength-dimensions)
   - [Programs](#104-programs)
   - [Activity Digest](#105-activity-digest)
   - [Trainer Souls](#106-trainer-souls)
   - [API & MCP Reference](#107-api--mcp-reference)

---

# 1. Home

**URL:** `/` or `/home`
**Purpose:** The primary interface — a conversational AI hub. Users talk to their personal AI, which routes to the right agent or handles platform operations directly.

## 1.1 Landing View

The initial state before any message is sent.

### Chat Input (Landing)
- **Large textarea** — type a message to any agent
- **Send button (→)** — sends the first message and transitions to chat view
  - If message contains `@alias`, routes to that agent
  - If no mention, routes to the default/hub agent

### Agent Tiles
- **Org filter dropdown** — filter visible tiles by organization
  - Options: "Recent" (default), plus all organization names
- **Agent tile grid** — clickable tiles showing each agent
  - Each tile shows: avatar (2-letter initials), name, last message time (in Recent view)
  - **Click a tile** → inserts `@alias` into the chat input

| Action | API | MCP |
|--------|-----|-----|
| List agents for tiles | `GET /api/agents` | `list_agents` |
| | **Params:** `?org=orgName` (optional) | **Params:** `org` (optional string) |

## 1.2 Chat View

Active after the first message is sent.

### Agent Sidebar (Left Panel)
- **Org filter dropdown** — filter sidebar agents by organization (top of sidebar)
- **Recent section** — agents sorted by most recent interaction first
  - Each entry: avatar, agent name, alias, time since last activity
  - **Click an agent** → inserts `@alias` into chat input
- **All Agents section** — collapsible section (click header to expand/collapse)
  - Shows all agents not in the Recent section, with count badge
  - Arrow indicator (▶/▼) shows collapsed/expanded state
- **◀ Collapse button** — collapses the entire sidebar to zero width, giving chat full width
  - Click again (or the Agents toggle) to re-expand

### Chat Header (Per-Agent)
When chatting with an agent, the header shows:
- **Agent avatar and name**
- **Account override dropdown** — select which Claude account to use for this agent
  - Options: "default" (agent's configured account), plus all other configured accounts
  - In-memory only — resets on page reload
  - The selected account is passed as `accountOverride` on every send/stream call
- **▨ Canvas button** — toggles the canvas/preview panel (right side)
  - When active, shows files created or modified by the agent
  - Canvas has: download button (downloads file), close button, file content display
- **↺ Reset Session button** — (only for persistent-session agents) compacts and resets the conversation
  - Shows confirmation dialog: "Reset session? This clears conversation history. Use /opcompact first to save important context."
  - On confirm, calls reset session API

| Action | API | MCP |
|--------|-----|-----|
| Reset session | `POST /api/agents/:agentId/sessions/reset` | `reset_session` |
| | **Body:** `{ senderId? }` | **Params:** `agentId`, `senderId?` |
| Account override | Passed as `accountOverride` param on `POST /api/chat/:agentId` and `/stream` | `send_message` / `start_stream` — `accountOverride` param |
| List accounts (populates dropdown) | `GET /api/config/accounts` | `list_accounts` |
| | | *(no params)* |
| Download canvas file | `GET /api/agents/:agentId/download?path=filePath` | `download_agent_file` |
| | **Query:** `path` (absolute file path) | **Params:** `agentId`, `path` |

### Chat Messages Area
- **User messages** — right-aligned, light blue background
- **Agent messages** — left-aligned, purple background, markdown-rendered
  - Shows `[via:agentId]` tag indicating which agent responded
  - File references render with **Download** and **▨ Preview** buttons
- **Thinking indicator** — animated dots while agent is processing
- **Tool usage cards** — show which tools the agent is actively using

### Chat Input
- **Textarea** — multi-line input, auto-resizes
  - Placeholder: "Type @ to mention an agent..."
  - `Enter` sends, `Shift+Enter` for newline
- **@mention autocomplete** — appears while typing `@`
  - Shows matching agents with avatar, alias, name
  - Arrow keys to navigate, Tab/Enter to select, Escape to dismiss
- **Send button (→)** — sends message to the mentioned (or default) agent
- **File attachment button (📎)** — opens file picker to upload files to the agent
- **Voice record button (🎤)** — start/stop voice recording for transcription
- **Voice mode button (🔇/🔊)** — toggles reading agent responses aloud via text-to-speech

### Streaming Controls (During Active Response)
While an agent is streaming a response:
- **Stop button (■)** — red square button, appears next to Send. Interrupts the agent's response immediately.
  - Keyboard shortcut: `Escape`
- **Send button becomes "Queue"** — the send button changes to amber "Queue" mode
  - Type a follow-up message and click Queue (or press Enter) to queue it
  - Queued messages auto-send when the current response completes
- **Message Queue** — appears below the input when messages are queued
  - Each queued message shows: position number, message text preview
  - **Edit button (✎)** — edit the queued message text
  - **Cancel button (✕)** — remove the queued message

| Action | API | MCP |
|--------|-----|-----|
| Stop / interrupt streaming | `POST /api/chat/jobs/:jobId/stop` | `stop_chat_job` |
| | | **Params:** `jobId` |
| Queue sends via normal chat | `POST /api/chat/:agentId` or `/stream` | `send_message` / `start_stream` |
| | Queue is client-side; each queued message sends normally when prior response completes | |

| Action | API | MCP |
|--------|-----|-----|
| Send message (sync) | `POST /api/chat/:agentId` | `send_message` |
| | **Body:** `{ text, accountOverride? }` | **Params:** `agentId`, `text`, `accountOverride?` |
| Start streaming chat | `POST /api/chat/:agentId/stream` | `start_stream` |
| | **Body:** `{ text, accountOverride? }` | **Params:** `agentId`, `text`, `accountOverride?` |
| Poll stream output | `GET /api/chat/jobs/:jobId/raw?after=N` | `get_chat_job_raw` |
| | **Query:** `after` (line offset) | **Params:** `jobId`, `after?` |
| Stop streaming job | `POST /api/chat/jobs/:jobId/stop` | `stop_chat_job` |
| | | **Params:** `jobId` |
| Delegate to agent | `POST /api/delegate` | `delegate_message` |
| | **Body:** `{ agentId, text }` | **Params:** `agentId`, `text` |
| Upload file | `POST /api/upload/:agentId/json` | `upload_file` |
| | **Body:** `{ fileName, base64Content, mode? }` | **Params:** `agentId`, `fileName`, `base64Content`, `mode?` |

### Raw Logs Panel (Bottom Drawer)
- **Toggle button (⌘)** — shows/hides raw Claude output
- **Clear button** — clears all log entries
- **Close button** — hides the panel
- **Log content area** — live streaming output from the agent's Claude process

---

# 2. Agents (Org)

**URL:** `/org`
**Purpose:** Manage all agents — create, configure, organize, and monitor.

## 2.1 Agent List

### Sub-Navigation Tabs
- **Teams** (`/org`) — agents view (default)
- **Tasks** (`/tasks`) — cross-agent task panel
- **Automations** (`/automations`) — goals and cron jobs across all agents

### View Controls

| Control | Description |
|---------|-------------|
| **Grid view (◊)** | 300px agent cards in a wrapping grid |
| **Compact view (▬▬)** | Condensed cards with 3-dot menu |
| **List view (≡)** | Sortable table with columns: Name, Alias, Org, Dept, Title, Class, Status, Last Active, Msgs |
| **Search input** | Filter agents by name, alias, or description |
| **Org select dropdown** | Filter by organization |
| **Class filter dropdown** | Checkboxes: Standard, Builder, Platform |
| **Hide names button (👁 Hide)** | Blurs all agent names globally for presentations |
| **Per-org hide button (👁)** | Each organization section has its own hide/show toggle to blur names within that org only |
| **Select mode button (☑ Select)** | Enables multi-select checkboxes on each agent |
| **+ New Agent button** | Opens agent creation modal |

### Agent Cards (All Views)
Each agent shows:
- **Avatar** — 2-letter initials in colored circle
- **Heartbeat indicator (❤)** — pulsing animation if heartbeat is active
- **Automation indicator (⟳)** — spinning icon if goals/crons are active
- **Name** — agent display name
- **Subtitle** — org, department, title
- **Status dot** — green for active
- **Hover actions:**
  - **Chat button** → opens `/ui#agentId`
  - **Dashboard button** → opens `/agent-dashboard?id=agentId`
  - **Config button** → opens edit modal

### List View (Table)
- **Sortable columns** — click any header to sort ascending/descending
- **Row click** → opens config modal for that agent

### Multi-Select Mode
When activated via Select button:
- **Checkboxes** appear on each agent
- **Select All / Deselect All** buttons
- **Delete Selected** — bulk delete with confirmation
- **Cancel** — exits multi-select mode

| Action | API | MCP |
|--------|-----|-----|
| List all agents | `GET /api/agents` | `list_agents` |
| | **Query:** `?org=orgName` | **Params:** `org?` (string) |
| Get agent details | `GET /api/agents/:id` | `get_agent` |
| | | **Params:** `agentId` |
| Delete agent | `DELETE /api/agents/:id` | `delete_agent` |
| | **Query:** `?confirmAlias=alias` | **Params:** `agentId`, `confirmAlias` |
| Get agent registry | `GET /api/agent-registry` | `get_agent_registry` |
| | *(no params)* | *(no params)* |

## 2.2 Agent Creation / Edit Modal

Opened by **+ New Agent** button or clicking an agent's Config button. Has 6 standard tabs, plus 4 additional tabs when editing a Gym-class agent (10 total).

### Tab 1: Overview

| Field | Description |
|-------|-------------|
| **Agent ID** | Lowercase, hyphens only (e.g., `my-agent`). Auto-generates alias on input. |
| **Mention Alias** | @-prefixed (e.g., `@myagent`). Auto-generated from ID but editable. |
| **Name** | Display name shown in UI and chat. |
| **Description** | Short description of the agent's purpose. |
| **Instructions (CLAUDE.md)** | System prompt written to the agent's CLAUDE.md file. Multi-line textarea. |
| **Agent Class** | Dropdown: Standard, Builder, Platform, Gym. |
| **Executor** | Dropdown: Platform Default, Claude, Ollama models, or cloud providers — OpenAI, Grok (xAI), Gemini, Groq, Together, Mistral (when multi-model is enabled). Format: `provider:model` (e.g., `openai:gpt-4o`, `gemini:gemini-2.5-flash`, `grok:grok-3`). Overrides the service-level default executor for this agent. |

#### Organization Entries
Each agent can belong to multiple organizations. Per entry:
- **Organization** — org name
- **Function/Department** — department within the org
- **Title** — agent's role title
- **Reports To** — optional, who this agent reports to
- **Remove button (×)** — removes this org entry
- **+ Add Org Entry** — adds another org association

#### Heartbeat Section (Collapsible)
- **Enabled toggle** — pill switch to enable/disable heartbeat
- **Instructions** — what the agent should check during heartbeat
- **Frequency dropdown** — Manual, Daily, Weekdays, Weekly, Every N mins
- **Day select** — for weekly (Mon-Sun)
- **Time inputs** — hour (0-23), minute (0-59), AM/PM
- **Cron preview** — read-only display of the generated cron expression

#### Wiki Learning Section (Collapsible)
- **Wiki Learning toggle** — enable/disable Wiki Learning (`wiki` field)
  - When enabled, the agent captures facts and corrections from conversations into `learned.md`
- **Wiki Sync toggle** — enable/disable scheduled Wiki Sync (`wikiSync.enabled`)
  - Automatically merges `learned.md` into `context.md` on a schedule
- **Schedule** — cron expression for sync frequency (`wikiSync.schedule`, default: `0 0 * * *`)

| Action | API | MCP |
|--------|-----|-----|
| Create agent | `POST /api/agents` | `create_agent` |
| | **Body:** `{ agentId, alias, name, description, instructions, agentClass, executor, orgs[], heartbeat{}, wiki, wikiSync{}, ... }` | **Params:** `agentId`, `alias`, `name`, `description`, `instructions`, `agentClass`, `executor`, `orgs`, `heartbeat`, `workspace`, `allowedTools`, `mcps`, `routes`, `persistent`, `streaming`, `advancedMemory`, `autonomousCapable`, `autoCommit`, `timeout`, `claudeAccount`, `wiki`, `wikiSync` |
| Update agent | `PUT /api/agents/:id` | `update_agent` |
| | **Body:** same fields as create | **Params:** `agentId`, plus any fields to update |
| Get agent instructions | `GET /api/agents/:id/instructions` | `get_agent_instructions` |
| | | **Params:** `agentId` |

### Tab 2: Skills

Controls which tools the agent can use.

- **Default tool pills** (toggle on/off):
  - Read, Edit, Write, Glob, Grep, Bash, WebFetch, WebSearch
  - Each is a clickable pill — checked (✓) = enabled
- **Custom skills** — additional skills from library shown as toggle pills
- **+ Add New Skill button** — opens skill creation flow

| Action | API | MCP |
|--------|-----|-----|
| Get agent skills | `GET /api/agents/:agentId/skills` | `get_agent_skills` |
| | | **Params:** `agentId` |
| Get org skills | `GET /api/skills/org/:orgName` | `get_org_skills` |
| | | **Params:** `orgName` |
| Create skill | `POST /api/skills/create` | `create_skill` |
| | **Body:** `{ id, name, description, content, scope, orgName?, agentId? }` | **Params:** `id`, `name`, `description`, `content`, `scope`, `orgName?`, `agentId?` |
| Assign skill to agent | `POST /api/marketplace/assign` | `assign_to_agent` |
| | **Body:** `{ agentId, itemId, type: "skill" }` | **Params:** `agentId`, `itemId`, `type` |

### Tab 3: MCPs

Manage MCP server connections for the agent.

- **MCP toggle pills** — enable/disable each MCP from the registry
- **MCP accordion sections** (per MCP, expandable):
  - **API Key cards** — key name, status badge (OK/Missing), secret input, save/disconnect buttons
  - **OAuth connections** — account name, status, remove button
  - **+ Add Account button** — opens MCP auth modal
- **Unconfigured MCPs section** — MCPs not yet connected

#### MCP Auth Modal
- **Auth form** — dynamic fields based on MCP requirements (API key input, OAuth link, etc.)
- **Cancel / Save buttons**

#### Connecting Google OAuth MCPs (Sheets, Gmail, Calendar, Drive, Docs)

Several MCPs use Google OAuth instead of an API key. These include:

| MCP | What it enables |
|-----|----------------|
| `googlesheets` | Read, write, and manage Google Sheets spreadsheets |
| `gmail` | Read, search, send Gmail messages |
| `googlecalendar` | List, create, and manage calendar events |
| `googledrive` | Browse, read, and manage Drive files |
| `googledocs` | Read and edit Google Docs documents |

**To connect a Google OAuth MCP to an agent:**
1. Go to **Org page** → click the agent → **MCPs tab**
2. Find the MCP (e.g. Google Sheets) in the accordion and click **+ Add Account**
3. In the auth modal, click **Authorize** — this opens a Google sign-in flow
4. Sign in with the Google account you want to connect
5. The refresh token is stored automatically under a connection name like `googlesheets-agenticledger`

**Multiple accounts:** You can add multiple Google accounts to the same MCP (e.g. `agenticledger`, `bst`, `financeiscooked`) by repeating the flow with a different account. Each becomes a separate named connection.

**Via MCP tool:** Use `create_mcp_connection` with `baseMcp`, `label`, `envVar` (e.g. `GOOGLESHEETS_AGENTICLEDGER`), and `value` (refresh token). The token must be issued by the agenticledger.ai OAuth client — tokens from other Google Cloud projects will fail with `invalid_grant`.

| Action | API | MCP |
|--------|-----|-----|
| List registered MCPs | `GET /api/mcps` | `list_mcps` |
| | | *(no params)* |
| Get MCP catalog | `GET /api/mcp-catalog` | `get_mcp_catalog` |
| | | *(no params)* |
| List MCP keys for agent | `GET /api/agents/:id/mcp-keys` | `list_mcp_keys` |
| | | **Params:** `agentId` |
| Save MCP key | `POST /api/agents/:id/mcp-keys` | `save_mcp_key` |
| | **Body:** `{ mcpName, envVar, value }` | **Params:** `agentId`, `mcpName`, `envVar`, `value` |
| Delete MCP key | `DELETE /api/agents/:id/mcp-keys/:mcpName` | `delete_mcp_key` |
| | | **Params:** `agentId`, `mcpName` |
| List MCP connections | `GET /api/agents/:id/mcp-connections` | `list_mcp_connections` |
| | | **Params:** `agentId` |
| Create MCP connection | `POST /api/agents/:id/mcp-connections` | `create_mcp_connection` |
| | **Body:** `{ mcpName, instanceName, config }` | **Params:** `agentId`, `body` (object with mcpName, instanceName, config) |
| Delete MCP connection | `DELETE /api/agents/:id/mcp-connections/:instanceName` | `delete_mcp_connection` |
| | | **Params:** `agentId`, `instanceName` |

### Tab 4: Schedules (Cron Jobs)

Trigger automated messages on a schedule.

- **+ Add Schedule button** — adds a new schedule entry
- **Per schedule entry:**
  - **Frequency dropdown** — Manual, Daily, Weekly, Every N minutes
  - **Day checkboxes** (if weekly) — Mon through Sun
  - **Time inputs** — hours, minutes
  - **Message textarea** — the message to send when triggered
  - **Channel select** — which channel to send to
  - **Chat ID input** — target chat/conversation
  - **Cron preview** — human-readable expression
  - **Trigger Now button** — manually fires the schedule immediately
  - **Pause/Resume button** — toggles cron on/off
  - **Remove button (×)** — deletes the schedule

| Action | API | MCP |
|--------|-----|-----|
| Create cron | `POST /api/agents/:id/cron` | `create_cron` |
| | **Body:** `{ schedule, message, channel?, chatId?, enabled? }` | **Params:** `agentId`, `body` (object with schedule, message, channel, chatId, enabled) |
| Toggle cron on/off | `POST /api/agents/:id/cron/:index/toggle` | `toggle_cron` |
| | | **Params:** `agentId`, `index` (number) |
| Trigger cron manually | `POST /api/agents/:id/cron/:index/trigger` | `trigger_cron` |
| | | **Params:** `agentId`, `index` (number) |
| Get cron run history | `GET /api/agents/:id/cron/:index/history` | `get_cron_history` |
| | | **Params:** `agentId`, `index` (number) |
| Delete cron | `DELETE /api/agents/:id/cron/:index` | `delete_cron` |
| | | **Params:** `agentId`, `index` (number) |

### Tab 5: Goals

Autonomous task tracking with reporting.

- **+ Add Goal button** — adds a new goal entry
- **Per goal entry:**
  - **Goal ID** — unique identifier (auto-generated from title if blank)
  - **Goal Name/Title** — what is this goal
  - **Description textarea** — detailed description
  - **Success Metric textarea** — how to measure completion
  - **Reporting channels** — where to send reports
    - Per channel: channel dropdown, chat ID input, remove (×)
    - **+ Add Channel** — adds another report destination
  - **Enabled toggle** — pill switch
  - **Trigger mode dropdown** — Heartbeat (default) or On-demand
  - **Heartbeat settings** (if Heartbeat mode) — frequency, days, time
  - **Budget input** — max daily USD spend
  - **Trigger Now button** — manually executes goal
  - **Pause/Resume button** — toggles goal on/off
  - **Remove button (×)** — deletes the goal

| Action | API | MCP |
|--------|-----|-----|
| Create goal | `POST /api/agents/:id/goals` | `create_goal` |
| | **Body:** `{ goalId, name, description, successMetric, reportTargets[], triggerMode, schedule?, budget?, enabled? }` | **Params:** `agentId`, `body` (object) |
| Toggle goal on/off | `POST /api/agents/:id/goals/:goalId/toggle` | `toggle_goal` |
| | | **Params:** `agentId`, `goalId` |
| Trigger goal manually | `POST /api/agents/:id/goals/:goalId/trigger` | `trigger_goal` |
| | | **Params:** `agentId`, `goalId` |
| Get goal run history | `GET /api/agents/:id/goals/:goalId/history` | `get_goal_history` |
| | | **Params:** `agentId`, `goalId` |
| Delete goal | `DELETE /api/agents/:id/goals/:goalId` | `delete_goal` |
| | | **Params:** `agentId`, `goalId` |
| List all automations | `GET /api/automations` | `list_automations` |
| | *(no params)* | *(no params)* |

### Tab 6: Config

Advanced agent configuration.

#### Behavior Toggles (Pill Switches)
| Toggle | Description |
|--------|-------------|
| **Persistent Session** | Keep conversation context between messages (default: on) |
| **Streaming** | Stream responses in real-time (default: off) |
| **Advanced Memory** | Enable long-term semantic recall with daily journals + vector search (default: on) |
| **Autonomous Capable** | Allow agent to act on goals autonomously (default: on) |
| **Auto Commit** | Auto-commit code changes (default: off) |

#### Other Fields
- **Workspace** — working directory for the agent (default: `~`)
- **Agent Home** — computed path (read-only)
- **Timeout** — max execution time in seconds (default: 14400)
- **Claude Account** — which Claude account to use (dropdown of configured accounts)

#### Routes
Which channels can invoke this agent.
- Per route: channel dropdown, chat/channel ID, require mention checkbox, remove (×)
- **+ Add Route** — adds a new channel route

### Gym-Specific Tabs (Agent Class = Gym Only)

When editing an agent with **Agent Class: Gym**, four additional tabs appear after Config. These tabs are hidden for all other agent classes.

#### Trainer Tab

Switch the active coaching personality. Changes how the coach communicates during training sessions without affecting progress or profile data.

| Element | Description |
|---------|-------------|
| **Trainer grid** | 5 cards in a responsive grid, each showing avatar (initials), name, coaching style |
| **Active indicator** | Selected trainer has a colored border, tinted background, and "Active" badge |
| **Click to switch** | Clicking a card immediately updates the learner profile via `PUT /api/gym/learner-profile` with `{ selectedTrainer }` |

Trainers: Alex (Collaborative, cyan), Jordan (Direct, orange), Morgan (Thoughtful, purple), Riley (Challenging, red), Sam (Patient, green).

#### Learner Tab

View and edit the learner profile built during onboarding. The coach updates this profile as you train.

| Field | Description |
|-------|-------------|
| **Identity** | JSON or text — professional background, role, experience level |
| **Goals** | Newline-separated list of learning goals |
| **Current Streak** | Read-only counter of consecutive active days |
| **Longest Streak** | Read-only all-time streak record |
| **Strengths** | Pill badges of identified strengths (read-only, set by coach) |
| **Struggles** | Pill badges of identified struggles (read-only, set by coach) |
| **Save Profile** | Pushes identity + goals changes via `PUT /api/gym/learner-profile` |

#### Dimensions Tab

Current scores across the 5 AI skill dimensions with trend and history.

| Element | Description |
|---------|-------------|
| **Dimension bars** | 5 color-coded progress bars (0–10 scale) with score and trend arrow |
| **Trend indicators** | Up arrow (improving, green), down arrow (declining, red), dot (stable, gray) |
| **History table** | Last 5 dimension snapshots showing date and scores per dimension |

Data sources: `GET /api/gym/learner-profile` (current scores), `GET /api/gym/dimensions/history` (snapshots).

#### Programs Tab

All training programs with enrollment status and completion progress.

| Element | Description |
|---------|-------------|
| **Program cards** | Title, difficulty badge (color-coded), estimated time, target dimensions |
| **Progress bar** | Shown for started programs — percentage complete with step count |
| **Current module** | Shows which module the learner is working on |
| **Description** | Truncated program description (120 chars) |

Data sources: `GET /api/gym/programs` (program list), `GET /api/gym/progress` (completion state).

### Delete Agent

- **Delete Agent button** (red, bottom-left of modal) — only visible when editing
- **Confirmation overlay:**
  - Warning: "This action cannot be undone"
  - Shows agent alias
  - **Confirmation input** — must type the agent's alias exactly
  - **Cancel button** — closes without deleting
  - **Delete Forever button** — disabled until alias matches, then executes delete

| Action | API | MCP |
|--------|-----|-----|
| Delete agent | `DELETE /api/agents/:id?confirmAlias=alias` | `delete_agent` |
| | **Query:** `confirmAlias` (agent alias) | **Params:** `agentId`, `confirmAlias` |

### Save Agent

- **Save button** — "Create Agent" (new) or "Update Agent" (editing)
  - Collects all fields from all tabs (6 standard + 4 gym-specific if applicable)
  - Validates required fields (agentId, alias, name)
  - Creates agent directory, writes CLAUDE.md, updates config.json

## 2.3 Agent Dashboard

**URL:** `/agent-dashboard?id=agentId`
**Purpose:** At-a-glance view of a single agent — tasks, activity, cost, heartbeat.

### Agent Header
- **Avatar** — 2-letter initials
- **Agent name** — large display
- **Status dot** — green for active
- **Alias** — @mention format
- **Description**
- **Action buttons:**
  - **← Org** — back to `/org`
  - **Chat** — opens `/ui#agentId`
  - **♥ Heartbeat** — trigger manual heartbeat
    - Shows "Running..." while executing, "Triggered!" on success

| Action | API | MCP |
|--------|-----|-----|
| Trigger heartbeat | `POST /api/agents/:id/heartbeat` | `trigger_heartbeat` |
| | **Body:** `{ triggeredBy? }` | **Params:** `agentId`, `triggeredBy?` |

### Tasks Section
- **Section title** with count badge
- **Per task card:**
  - Status dot (color-coded by status)
  - Task title
  - Priority badge (High/Medium/Low with color)
  - Status label, time ago, assigned by, source agent
  - **Start button** — moves task to in_progress (if proposed/approved)
  - **Done button** — marks task complete
- **Cross-agent tasks** — tasks from other agents shown separately
- **Empty state:** "No tasks assigned"

| Action | API | MCP |
|--------|-----|-----|
| List agent tasks | `GET /api/agents/:id/tasks` | `list_tasks` |
| | | **Params:** `agentId` |
| Create task | `POST /api/agents/:id/tasks` | `create_task` |
| | **Body:** `{ title, description?, priority?, status?, assignedBy?, project? }` | **Params:** `agentId`, `body` (object) |
| Update task (status change) | `PUT /api/agents/:id/tasks/:taskId` | `update_task` |
| | **Body:** `{ status?, title?, description?, priority? }` | **Params:** `agentId`, `taskId`, `body` (object) |
| Delete task | `DELETE /api/agents/:id/tasks/:taskId` | `delete_task` |
| | | **Params:** `agentId`, `taskId` |
| Get all tasks (cross-agent) | `GET /api/tasks/all` | `get_all_tasks` |
| | | *(no params)* |
| Get task stats | `GET /api/agents/:id/tasks/stats` | `get_task_stats` |
| | | **Params:** `agentId` |
| Create project | `POST /api/agents/:id/projects` | `create_project` |
| | **Body:** `{ name }` | **Params:** `agentId`, `name` |

### Recent Activity Section
- **Open Chat link** — links to `/ui#agentId`
- **Activity items** — recent messages with time, direction (IN/OUT), message preview (120 chars)
- **Empty state:** "No recent activity"

| Action | API | MCP |
|--------|-----|-----|
| Get activity feed | `GET /api/activity` | `get_activity` |
| | **Query:** `?limit=N` | **Params:** `limit?` (number) |
| Get agent logs | `GET /api/agents/:agentId/logs` | `get_agent_logs` |
| | **Query:** `?limit=N&offset=N&search=text` | **Params:** `agentId`, `limit?`, `offset?`, `search?` |

### Cost Section
- **3-column stat grid:**
  - Total Cost ($X.XXXX)
  - Messages (count)
  - Average Cost per message ($X.XXXX)
- **Empty state:** "No cost data"

| Action | API | MCP |
|--------|-----|-----|
| Get agent cost | `GET /api/agents/:agentId/cost` | `get_agent_cost` |
| | | **Params:** `agentId` |
| Get all costs | `GET /api/cost/all` | `get_all_costs` |
| | | *(no params)* |

### Heartbeat History Section
- **Count badge** — number of heartbeats
- **Per heartbeat item** (up to 10 most recent):
  - Status dot — green (success), red (error), amber (timeout)
  - Time ago
  - Duration (ms or s)
  - Summary (first 100 chars)
  - Trigger badge — "manual", "schedule", etc.
- **Empty state:** "No heartbeats yet. Trigger one above."

| Action | API | MCP |
|--------|-----|-----|
| Get heartbeat history | `GET /api/agents/:id/heartbeat-history` | `get_heartbeat_history` |
| | **Query:** `?limit=N` | **Params:** `agentId`, `limit?` |

### Wiki Learning

Wiki Learning lets agents automatically capture facts and corrections from conversations into a `learned.md` file. This knowledge accumulates over time and can be merged into the agent's main knowledge base (`context.md`).

**How it works:**
1. Enable "Wiki Learning" on any agent's config page
2. The agent will evaluate each conversation and save new facts to `learned.md` in its memory directory
3. You can manually ask the agent to "update context from learned" to merge verified facts into `context.md`

**Wiki Sync (scheduled):**
- Optionally enable Wiki Sync to automatically merge learned facts on a schedule
- Configure via the Schedule tab on the agent config page (same UI as Heartbeat)
- Default schedule: daily at midnight (`0 0 * * *`)
- The sync reviews `learned.md`, cross-checks against `context.md`, merges verified facts, and flags contradictions

| Action | API | MCP |
|--------|-----|-----|
| Trigger wiki sync | `POST /api/agents/:id/wiki-sync` | `trigger_wiki_sync` |
| | | **Params:** `agentId` |
| Get wiki sync history | `GET /api/agents/:id/wiki-sync-history` | `get_wiki_sync_history` |
| | **Query:** `?limit=N` | **Params:** `agentId`, `limit?` |

---

# 3. Chat

**URL:** `/ui` or `/ui#agentId`
**Purpose:** Full-screen chat interface with any agent.

The chat interface on `/ui` is functionally identical to the Home chat view (see [Section 1.2](#12-chat-view)) with these differences:

- **URL hash routing** — `/ui#agentId` opens directly to a specific agent
- **No landing view** — goes straight to chat
- **Agent drawer** — same sidebar with agent list

All chat actions, APIs, and MCP tools are identical to Home (see [Section 1.2](#12-chat-view)).

### Session Management

| Action | API | MCP |
|--------|-----|-----|
| List sessions (low-level) | `GET /api/agents/:agentId/sessions` | `list_sessions` |
| | | **Params:** `agentId` |
| Reset session | `POST /api/agents/:agentId/sessions/reset` | `reset_session` |
| | **Body:** `{ senderId? }` | **Params:** `agentId`, `senderId?` |
| Delete session | `DELETE /api/agents/:agentId/sessions/:senderId` | `delete_session` |
| | | **Params:** `agentId`, `senderId` |

### Named Session Tabs (server-side threads)

Each agent supports named, persistent session threads visible in the Web UI tab bar. Sessions survive browser resets and are stored in `agents/<agentId>/memory/session-tabs.json`. Conversation history is replayed from `conversation_log.jsonl` by `tabId`.

| Action | API | MCP |
|--------|-----|-----|
| Create/upsert tab | `POST /api/agents/:agentId/session-tabs` | `create_session_tab` |
| | **Body:** `{ tabId, label, targetAgentId? }` | **Params:** `agentId`, `tabId`, `label`; `targetAgentId` (optional) |
| List all session tabs | `GET /api/agents/:agentId/session-tabs` | `list_session_tabs` |
| | Returns tabs sorted newest-first with `lastMessageAt` + `lastPreview` | **Params:** `agentId` |
| Get conversation history | `GET /api/agents/:agentId/session-tabs/:tabId/history` | `get_session_tab_history` |
| | Returns `{ messages: [{role, text, time}] }` filtered by tabId | **Params:** `agentId`, `tabId` |
| Rename tab | `PUT /api/agents/:agentId/session-tabs/:tabId` | `rename_session_tab` |
| | **Body:** `{ label }` | **Params:** `agentId`, `tabId`, `label` |
| Delete tab (permanent) | `DELETE /api/agents/:agentId/session-tabs/:tabId` | `delete_session_tab` |
| | Also clears Claude session file | **Params:** `agentId`, `tabId` |

**Note:** `senderId` in messages sent from the Web UI is the `tabId`. This is what links JSONL log entries to a specific named thread. For agents to maintain separate memory per tab, set `persistent: true` and `perSenderSessions: true` in the agent config.

**`targetAgentId` — cross-agent tab routing:** When a tab is created with `targetAgentId`, all messages sent in that tab are routed to the target agent instead of the host agent. This lets hub (or any agent) create a tab that talks directly to a specialist agent (e.g. `agentcreator`, `skillcreator`) so the sub-agent accumulates its own conversation history and memory. The tab still appears on the host agent's chat page — users don't leave the page, they just switch tabs.

### Model Override (not visible in UI, API/MCP only)

| Action | API | MCP |
|--------|-----|-----|
| Get current model | `GET /api/agents/:agentId/model` | `get_model` |
| | | **Params:** `agentId` |
| Set model override | `PUT /api/agents/:agentId/model` | `set_model` |
| | **Body:** `{ model }` (opus, sonnet, haiku, or full model ID) | **Params:** `agentId`, `model` |
| Clear model override | `DELETE /api/agents/:agentId/model` | `clear_model` |
| | | **Params:** `agentId` |

### Memory (not visible in chat UI, API/MCP only)

| Action | API | MCP |
|--------|-----|-----|
| Get agent memory | `GET /api/agents/:agentId/memory` | `get_agent_memory` |
| | **Query:** `?limit=N` | **Params:** `agentId`, `limit?` |
| Search memory | `POST /api/agents/:agentId/memory/search` | `search_memory` |
| | **Body:** `{ query }` | **Params:** `agentId`, `query` |
| Clear memory context | `DELETE /api/agents/:agentId/memory/context` | `clear_memory_context` |
| | | **Params:** `agentId` |

### Files (not visible in chat UI, API/MCP only)

| Action | API | MCP |
|--------|-----|-----|
| List agent files | `GET /api/agents/:agentId/files` | `list_agent_files` |
| | | **Params:** `agentId` |
| Download file | `GET /api/agents/:agentId/download?path=filePath` | `download_agent_file` |
| | **Query:** `path` (absolute file path) | **Params:** `agentId`, `path` |
| Upload file | `POST /api/upload/:agentId/json` | `upload_file` |
| | **Body:** `{ fileName, base64Content, mode? }` | **Params:** `agentId`, `fileName`, `base64Content`, `mode?` ("temp" or "permanent") |

### Recover Agent (not visible in UI, API/MCP only)

| Action | API | MCP |
|--------|-----|-----|
| Recover from corruption | `POST /api/agents/:agentId/recover` | `recover_agent` |
| | **Body:** `{ userText?, response? }` | **Params:** `agentId`, `userText?`, `response?` |

---

# 4. Library

**URL:** `/library`
**Purpose:** Manage your personal library of skills, prompts, apps, MCPs, and agents. Install, assign, create, and publish.

## 4.1 Type Tabs

Five tabs along the top, each showing a different resource type:
- **Skills** — reusable instruction sets agents can invoke
- **Prompts** — reusable prompt templates triggered with a character (e.g., `!`)
- **Apps** — registered web applications
- **MCPs** — Model Context Protocol servers
- **Agents** — agent configurations

## 4.2 Search & Filters

- **Search input** — real-time filtering by name, description, or tags
- **Search clear button (×)** — appears when search has content
- **Category pills** — dynamic filter buttons:
  - **"all"** — show everything
  - **Per-category pills** — auto-generated from item categories
  - **"★ Platform Defaults" pill** — (skills/prompts/MCPs only) toggle to show only platform defaults

Each tab loads its data from the registry on mount:

| Action | API | MCP |
|--------|-----|-----|
| Load Skills/Prompts/Agents/MCPs tab | `GET /api/marketplace/:type` | `browse_registry` |
| | **URL param:** `type` (skills, prompts, agents, mcps) | **Params:** `type` |
| Load Apps tab | `GET /api/apps` | `list_apps` |
| | | *(no params)* |
| Load MCPs tab (registered servers) | `GET /api/mcps` | `list_mcps` |
| | | *(no params)* |
| Load agents (for assign modal) | `GET /api/agents` | `list_agents` |
| | | *(no params)* |

## 4.3 Personal Items Section ("Built by Me")

### Section Header
- **Item count** in parentheses
- **⊕ Add [Type] split button** with dropdown menu:

| Type | Dropdown Options |
|------|-----------------|
| Skills | "Scan" (scan folder), "AI Build" (→ Lab), "Marketplace" (→ Marketplace) |
| Prompts | "Paste" (inline form), "AI Build" (→ Lab), "Marketplace" (→ Marketplace) |
| Apps | "Register" (inline form), "AI Build" (→ Lab), "Marketplace" (→ Marketplace) |
| MCPs | "Add" (inline form), "Marketplace" (→ Marketplace) |

### Inline Creation Panels

#### Scan Skills Panel (Skills only)
- **Directory input** — folder path to scan (default: `~/.claude/commands`)
- **Scan button** — scans for `.md` skill files
- **Results** — checkboxes for each found skill with name and description
- **Import button** — imports selected skills

| Action | API | MCP |
|--------|-----|-----|
| Scan for skills | `GET /api/marketplace/scan-skills` | `scan_skills` |
| | **Query:** `?dir=path` | **Params:** `dir?` (string) |
| Import scanned skills | `POST /api/marketplace/import-skills` | `import_skills` |
| | **Body:** `{ agentId, skills[] }` | **Params:** `agentId`, `skills` (string array) |
| Create skill (programmatic) | `POST /api/skills/create` | `create_skill` |
| | **Body:** `{ id, name, description, content, scope, orgName?, agentId? }` | **Params:** `id`, `name`, `description`, `content`, `scope` ("global"\|"org"\|"agent"), `orgName?`, `agentId?` |

> Note: The "AI Build" button redirects to Lab (`/lab?build=skill`) where a creator agent builds the skill conversationally. The `create_skill` API/MCP can also create skills directly without the Lab.

#### Create Prompt Panel (Prompts only)
- **Name input** — prompt display name
- **ID input** — auto-generated from name
- **Description input**
- **Content textarea** — the prompt template text
- **Save prompt button**
- **Cancel button**

| Action | API | MCP |
|--------|-----|-----|
| Create prompt | `POST /api/marketplace/create-prompt` | `create_prompt` |
| | **Body:** `{ id, name, content }` | **Params:** `id`, `name`, `content` |

#### Add MCP Panel (MCPs only)
- **Name input**
- **ID input** — auto-generated from name
- **Description input**
- **Type toggle** — HTTP or stdio buttons
- **HTTP fields:** URL input
- **stdio fields:** Command input, Args input (space-separated)
- **Add MCP button**
- **Cancel button**

| Action | API | MCP |
|--------|-----|-----|
| Add MCP to registry | `POST /api/marketplace/add-mcp` | `add_mcp_to_registry` |
| | **Body:** `{ name, id, description, type, url?, command?, args? }` | **Params:** `body` (object) |

#### Register App Panel (Apps only)
- **Name input** (required)
- **URL input** (required)
- **Description input**
- **Category dropdown** — Productivity, Development, Finance, Analytics, Communication, AI/Agents, Other
- **Status dropdown** — Draft, Live, Maintenance
- **GitHub Repo input** (optional)
- **Deploy platform dropdown** — Railway, Vercel, Netlify, Render, Local, Other
- **Register App button**
- **Cancel button**

| Action | API | MCP |
|--------|-----|-----|
| Create app | `POST /api/apps` | `create_app` |
| | **Body:** `{ name, url, description?, category?, status?, repo?, deploy? }` | **Params:** `body` (object) |

## 4.4 Item Cards

Each resource is displayed as a card with consistent elements:

### Card Elements
- **Name and provider**
- **Badges:**
  - "✓ verified" — if provider is AgenticLedger/platform
  - "built by me" — if provider is 'me'
  - "community" — if external provider
  - "✓ installed" — if already installed
  - "★ default" — if set as platform default
- **Description**
- **Meta tags** — categories and assigned agents (e.g., "→ agent1, agent2, +1")

### Card Actions

| Button | Description | When Visible |
|--------|-------------|-------------|
| **Install** | Install the item | Not yet installed |
| **Manage** | Open assign modal | Already installed |
| **☆ Set Default / ★ Default** | Toggle platform default | Skills, Prompts, MCPs |
| **↑ Publish ▾** | Publish to SaaS (dropdown) | SaaS connected, Skills/Prompts only |

#### Install

| Action | API | MCP |
|--------|-----|-----|
| Install item | `POST /api/marketplace/install` | `install_registry_item` |
| | **Body:** `{ id, type }` | **Params:** `id`, `type` |

After install, the **Assign Modal** opens (see below).

#### Manage / Assign Modal
- **Title:** "✓ [Item Name] installed" or "Manage — [Item Name]"
- **Agent checklist** — checkboxes for each configured agent
- **Missing keys alert** — warns if API keys are needed
- **Assign selected button** — assigns item to checked agents

| Action | API | MCP |
|--------|-----|-----|
| Assign to agent | `POST /api/marketplace/assign` | `assign_to_agent` |
| | **Body:** `{ agentId, itemId, type }` | **Params:** `agentId`, `itemId`, `type` ("skill", "mcp", "agent") |

#### Set Platform Default

| Action | API | MCP |
|--------|-----|-----|
| Set platform default | `POST /api/marketplace/platform-default` | `set_platform_default` |
| | **Body:** `{ type, id }` | **Params:** `type`, `id` |

#### Publish to SaaS (Dropdown)
- **"Company Library" button** — publish to SaaS library
- **"Marketplace" button** — publish to SaaS marketplace

| Action | API | MCP |
|--------|-----|-----|
| Publish to SaaS | `POST /api/saas/publish` | `publish_to_saas` |
| | **Body:** `{ type, id, destination }` | **Params:** `type` ("skill"\|"prompt"\|"agent"\|"app"), `id`, `destination?` ("library"\|"marketplace") |

### App Cards (Special Layout)
Apps have a richer card:
- **Initials icon** — colored 2-letter box
- **App name and URL**
- **Status badge** — Draft/Live/Maintenance (colored)
- **Deploy badge** — Railway/Vercel/Netlify/Render/Local/Other
- **Description**
- **Category tag and tags**
- **Agent developer badge** — shows assigned agent

#### App-Specific Actions

| Button | Description |
|--------|-------------|
| **↗ Launch** | Opens app URL in new tab |
| **↑ Publish ▾** | Publish to SaaS (dropdown) |
| **⌂ GitHub** | Opens GitHub repo (if configured) |
| **✕ Delete** | Deletes app from registry |
| **Health chip** | Shows health status; click to check |

| Action | API | MCP |
|--------|-----|-----|
| Launch app | Opens `app.url` in new browser tab | N/A — client-side navigation |
| GitHub link | Opens `app.repo` in new browser tab | N/A — client-side navigation |
| Delete app | `DELETE /api/apps/:id` | `delete_app` |
| | | **Params:** `id` |
| Update app | `PUT /api/apps/:id` | `update_app` |
| | **Body:** fields to update | **Params:** `id`, `body` (object) |
| Check app health | `POST /api/apps/:id/check-health` | `check_app_health` |
| | | **Params:** `id` |
| Publish app to SaaS | `POST /api/saas/publish` | `publish_to_saas` |
| | **Body:** `{ type: "app", id, destination }` | **Params:** `type`, `id`, `destination?` |

## 4.5 Prompt Trigger Config (Prompts Tab Only)
- **Trigger display** — shows current character (e.g., `!`)
- **✎ Edit button** — prompts for a new 1-character trigger

| Action | API | MCP |
|--------|-----|-----|
| Get prompt trigger | `GET /api/marketplace/prompt-trigger` | `get_prompt_trigger` |
| | | *(no params)* |
| Set prompt trigger | `POST /api/marketplace/prompt-trigger` | `set_prompt_trigger` |
| | **Body:** `{ trigger }` (single character) | **Params:** `trigger` |

## 4.6 Import from Folder Modal
- **Step 1:** folder path input + Browse button (opens directory picker) + Scan Folder button
- **Directory picker:** breadcrumb path, folder listing, up (..) button, Select/Cancel
- **Step 2:** preview list of found items with type, name, description + Import All button

| Action | API | MCP |
|--------|-----|-----|
| Browse directories | `GET /api/browse-dirs` | `browse_dirs` |
| | **Query:** `?path=dirPath` | **Params:** `path?` |

---

# 5. Lab

**URL:** `/lab`
**Purpose:** AI-assisted creation of agents, skills, apps, and prompts. Conversational build experience.

## 5.1 Landing View

### Hero Section
- **Title:** "Lab"
- **Subtitle:** "What do you want to build?"

### Build Tiles (4 clickable tiles)
| Tile | Icon | Description |
|------|------|-------------|
| **Agent** | Diamond (cyan) | "A purpose-built AI with memory, tools, and channels" |
| **Skill** | Lightning (green) | "A reusable instruction set any agent can invoke" |
| **App** | Grid (amber) | "A deployed web application in your platform" |
| **Prompt** | Star (purple) | "A reusable prompt template triggered with !" |

Clicking a tile opens the **Intake Form** for that type.

### Your Work Section (Artifacts)
- **Search input** — filter existing artifacts by name
- **Accordion groups** (click header to expand/collapse, arrow rotates):
  - **Apps** — each row shows: name, category tag, status badge (Draft/Live/Maintenance)
    - **Launch button** — opens the app URL in a new tab
    - **Modify button** — opens the Lab creation view to continue building with the App Creator agent
    - **Deploy button** — triggers deployment flow
  - **Agents** — each row shows: name, agent ID, status badge
  - **Skills** — each row shows: name, category tag, status badge
  - **Prompts** — each row shows: name, category tag, status badge
- Each accordion shows a **count badge** with the number of items

## 5.2 Intake Form

Opened by clicking a build tile.

| Field | Description |
|-------|-------------|
| **Name** | What you're building (placeholder varies by type) |
| **Description** | Detailed description of what you want |
| **Project directory** (Apps only) | Folder path + Browse button with directory picker |
| **📎 Attach files** | File attachment button + hidden file input |
| **Create button** | Submits to the appropriate creator agent |
| **Cancel button** | Returns to landing |

## 5.3 Creator Agents

Each build type is handled by a **hardcoded platform agent** — a real agent with its own ID, system prompt, and tools:

| Type | Agent ID | Name | Alias |
|------|----------|------|-------|
| Agent | `agentcreator` | Agent Creator | `@agentcreator` |
| Skill | `skillcreator` | Skill Creator | `@skillcreator` |
| App | `appcreator` | App Creator | `@appcreator` |
| Prompt | `promptcreator` | Prompt Creator | `@promptcreator` |

These are real agents — you can also message them directly from any channel via `@agentcreator`, `@skillcreator`, etc. They are registered as **Platform** class agents.

| Action | API | MCP |
|--------|-----|-----|
| List creator agents | `GET /api/platform-agents` | `get_platform_agents` |
| | Returns list of platform agents with IDs, names, aliases | *(no params)* |

## 5.4 Creation View

The AI-assisted build interface — a split-pane chat + canvas.

### Chat Panel (Left)
- **Header:** creator agent avatar, name (e.g., "Agent Creator"), alias (e.g., "@agentcreator")
- **Messages area:** user messages (cyan) and agent messages (purple, markdown-rendered)
- **Thinking indicator** — animated dots while processing
- **Tool cards** — show active tool usage

#### Chat Input Controls
| Control | Description |
|---------|-------------|
| **📎 Clip button** | Toggle file drop zone for drag-and-drop |
| **🎤 Mic button** | Voice input (stub) |
| **⌘ Raw Logs button** | Toggle raw logs drawer |
| **Chat textarea** | Enter sends, Shift+Enter newline, auto-resizes |
| **Send button** | Sends message; becomes "Queue" during streaming |
| **Stop button** | Appears during streaming; stops active job |

#### Raw Logs Drawer
- **Mode button** — toggles between "Clean" and "● Raw" modes
- **Log content area** — live streaming output from the creator agent

### Canvas Panel (Right)
- **Toggle button (▢ Canvas)** — show/hide canvas
- **Clear button** — empties canvas
- **Copy button** — copies all blocks to clipboard
- **Close button** — hides canvas
- **Canvas blocks** — code/content artifacts generated by the creator agent
  - Each block: type label (json, yaml, markdown, typescript, etc.), copy button, content
- **Empty state:** "Canvas is empty — Artifacts will appear here as they're built"
- **Resize handle** — draggable divider between chat and canvas

### Deploy Button
- **Deploy** — disabled until artifacts exist; triggers deployment flow

| Action | API | MCP |
|--------|-----|-----|
| Get platform agents (creators) | `GET /api/platform-agents` | `get_platform_agents` |
| | | *(no params)* |
| Send message to creator | `POST /api/chat/:agentId` | `send_message` |
| | **Body:** `{ text }` | **Params:** `agentId` (e.g., `agentcreator`), `text` |
| Start streaming with creator | `POST /api/chat/:agentId/stream` | `start_stream` |
| | **Body:** `{ text }` | **Params:** `agentId`, `text` |
| Stop streaming | `POST /api/chat/jobs/:jobId/stop` | `stop_chat_job` |
| | | **Params:** `jobId` |
| Poll stream output | `GET /api/chat/jobs/:jobId/raw?after=N` | `get_chat_job_raw` |
| | **Query:** `after` (line offset) | **Params:** `jobId`, `after?` |
| Upload file attachment to creator | `POST /api/upload/:agentId` (multipart) | `upload_file` |
| | Multipart form: `file` + `mode` | **Params:** `agentId`, `fileName`, `base64Content`, `mode?` |
| Browse dirs (App project picker) | `GET /api/browse-dirs?path=dirPath` | `browse_dirs` |
| | **Query:** `path` | **Params:** `path?` |

---

# 6. Marketplace

**URL:** `/marketplace`
**Purpose:** Browse, install, and assign skills, prompts, agents, MCPs, and apps from the registry.

## 6.1 Type Tabs

Same five tabs as Library: **Apps** (default), **Skills**, **Agents**, **MCPs**, **Prompts**

## 6.2 Search & Filters

Identical to Library (see [Section 4.2](#42-search--filters)):
- Search input with real-time filtering
- Category pills with "all" and per-category options
- "★ Platform Defaults" pill (skills/prompts/MCPs only)

## 6.3 Sections

Items are split into two sections:
- **"Built by Me"** — your personal items (same as Library, with add/create panels)
- **"Built by Others"** — community and platform items

## 6.4 Item Cards

Same card layout as Library (see [Section 4.4](#44-item-cards) for full card anatomy) with these marketplace-specific behaviors:

### Skills / Prompts / MCPs / Agents Cards
- **Name, provider, description, badges** — same as Library
- **Install button** — primary action; downloads item to your local registry
  - After install, the **Assign Modal** opens automatically to assign to agents
- **"✓ Installed" badge** — replaces Install button once installed
- **☆ Set Default / ★ Default** — toggle platform default (skills/prompts/MCPs)
- **↑ Publish ▾ dropdown** — publish to SaaS (Company Library or Marketplace)
- **Manage button** — opens assign modal (if already installed)

### App Cards
- **↗ Launch** — opens app URL in new tab
- **↑ Publish ▾** — publish to SaaS (Company Library / Marketplace)
- **⌂ GitHub** — opens repo (if configured)
- **✕ Delete** — removes app
- **Health chip** — shows status; click to re-check

All actions, APIs, and MCP tools are identical to Library (see [Section 4.4](#44-item-cards) for full API/MCP tables):

| Action | API | MCP |
|--------|-----|-----|
| Browse registry by type | `GET /api/marketplace/:type` | `browse_registry` |
| | **URL param:** `type` (skills, prompts, agents, mcps, apps) | **Params:** `type` |
| Install item | `POST /api/marketplace/install` | `install_registry_item` |
| | **Body:** `{ id, type }` | **Params:** `id`, `type` |
| Assign to agent | `POST /api/marketplace/assign` | `assign_to_agent` |
| | **Body:** `{ agentId, itemId, type }` | **Params:** `agentId`, `itemId`, `type` |
| Set platform default | `POST /api/marketplace/platform-default` | `set_platform_default` |
| | **Body:** `{ type, id }` | **Params:** `type`, `id` |

---

# 7. Admin

**URL:** `/admin`
**Purpose:** System-level configuration — channels, activity logs, accounts, service settings, SaaS, and deployment.

## 7.1 Channels

**Tab:** Channels

### Per Channel Card
One card per messaging channel (Telegram, Slack, iMessage, WhatsApp, Discord). Each shows:

| Element | Description |
|---------|-------------|
| **Channel icon** | Emoji for channel type |
| **Channel name** | e.g., "Telegram" |
| **Status pill** | "Connected" or "Disabled" |
| **Sticky mode select** | None, Sticky, Prefix — controls routing behavior |
| **Prefix input** | Only visible if Prefix mode; the prefix string |
| **Timeout input** | Minutes before sticky routing expires |
| **Save Settings button** | Saves channel configuration |

### Monitored Chat IDs (iMessage only)
- **List of monitored chat IDs** with remove buttons per entry
- **Add input** — chat ID to add
- **Add button** — adds the chat ID

| Action | API | MCP |
|--------|-----|-----|
| Add monitored chat | `POST /api/channels/:channelName/monitored` | `add_monitored_chat` |
| | **Body:** `{ chatId }` | **Params:** `channelName`, `chatId` |
| Remove monitored chat | `DELETE /api/channels/:channelName/monitored` | `remove_monitored_chat` |
| | **Body:** `{ chatId }` | **Params:** `channelName`, `chatId` |

### Chat Groups (Agent Routing)
- **Filter dropdown** — filter by chat ID
- **Agent list** — grouped by chat ID, showing agent name, alias, remove button
- **Add Agent section:**
  - Agent select dropdown
  - Chat/Channel ID input
  - **Add Agent button**

| Action | API | MCP |
|--------|-----|-----|
| List channels | `GET /api/channels` | `list_channels` |
| | | *(no params)* |
| Update channel settings | `PUT /api/channels/:channelName` | `update_channel` |
| | **Body:** `{ stickyMode?, prefix?, timeout?, enabled? }` | **Params:** `channelName`, `body` (object) |
| Add agent route | `POST /api/channels/:channelName/agents` | `add_agent_route` |
| | **Body:** `{ agentId, chatId?, requireMention? }` | **Params:** `channelName`, `body` (object) |
| Remove agent route | `DELETE /api/channels/:channelName/agents/:agentId` | `remove_agent_route` |
| | | **Params:** `channelName`, `agentId` |
| Get sticky routing | `GET /api/sticky-routing` | `get_sticky_routing` |
| | | *(no params)* |

## 7.2 Activity

**Tab:** Activity

### Filters
- **Agent filter dropdown** — dynamically populated with all agents
- **Channel filter dropdown** — All Channels, Telegram, Slack, iMessage, Discord, WhatsApp
- **Search input** — searches message content (debounced)
- **Result count** — "X entries"

### Activity Entries
Each entry shows:
- Agent avatar and name (clickable link to chat)
- Channel tag
- Session indicator
- Timestamp
- "Chat →" button to view in chat
- Query text (first 200 chars)
- Response preview (first 800 chars, expandable on click)

| Action | API | MCP |
|--------|-----|-----|
| Get activity feed | `GET /api/activity` | `get_activity` |
| | **Query:** `?limit=N` | **Params:** `limit?` |
| Get agent logs | `GET /api/agents/:agentId/logs` | `get_agent_logs` |
| | **Query:** `?limit=N&offset=N&search=text` | **Params:** `agentId`, `limit?`, `offset?`, `search?` |

## 7.3 Settings

**Tab:** Settings (default)

### Profile Section
- **Section label:** "Profile" (cyan highlight)
- **Description:** "Your identity — agents can use this to personalize responses"
- **Fields:**

| Field | Description |
|-------|-------------|
| **Name** | Your name |
| **Role / Title** | Your job role (e.g., product manager, developer, student) |
| **Industry** | Your industry or domain (e.g., fintech, healthcare, education) |
| **AI Experience** | Dropdown: Beginner, Intermediate, Advanced |
| **Interests** | Comma-separated list of focus areas (e.g., automation, coding, writing) |

- **Save button** — persists profile to `profile.json`

| Action | API | MCP |
|--------|-----|-----|
| Get profile | `GET /api/profile` | `get_profile` |
| | | *(no params)* |
| Update profile | `PUT /api/profile` | `update_profile` |
| | **Body:** `{ name?, role?, industry?, aiExperience?, interests? }` | **Params:** `name?`, `role?`, `industry?`, `aiExperience?`, `interests?` |

### Claude Accounts Section

#### Account List
Each account row shows:
- **Status dot** — green (authenticated), red (error), grey (unknown)
- **Account name**
- **Email address** (fetched from account status)
- **Account path** (e.g., `~/.claude-main`)
- **↻ Re-login button** — restart OAuth for this account
- **✕ Delete button** — remove account

#### Add Account
- **Account name input**
- **Login & Add button (→)** — starts OAuth flow
- **Login panel** (appears after starting):
  - Step 1: Login URL display (copyable, clickable)
  - Step 2: Code input field + **Submit Code button**
  - **Verify & Save button**

| Action | API | MCP |
|--------|-----|-----|
| List accounts | `GET /api/config/accounts` | `list_accounts` |
| | | *(no params)* |
| Add account | `POST /api/config/accounts` | `add_account` |
| | **Body:** `{ name, path }` | **Params:** `name`, `path` |
| Delete account | `DELETE /api/config/accounts/:name` | `delete_account` |
| | | **Params:** `name` |
| Check account status | `GET /api/config/accounts/:name/status` | `check_account_status` |
| | | **Params:** `name` |
| Start login | `POST /api/config/accounts/login` | `start_account_login` |
| | **Body:** `{ name, path }` | **Params:** `name`, `path` |
| Submit login code | `POST /api/config/accounts/login/code` | `submit_login_code` |
| | **Body:** `{ accountName, code }` | **Params:** `accountName`, `code` |
| Check auth status | `GET /api/whoami/:agentId` | `whoami` |
| | | **Params:** `agentId` |

### Service Section
- **Note:** "Restart required for most changes"
- **Settings grid:**

| Field | Description |
|-------|-------------|
| **Personal Agents Directory** | Where agent folders are stored |
| **Personal Registry Directory** | Where skills/prompts registry lives |
| **Web UI Port** | Port for the web interface (default: 4888) |
| **Log Level** | Logging verbosity |

- **Save button** — saves service configuration

| Action | API | MCP |
|--------|-----|-----|
| Get service config | `GET /api/config/service` | `get_service_config` |
| | | *(no params)* |
| Update service config | `PUT /api/config/service` | `update_service_config` |
| | **Body:** `{ personalAgentsDir?, personalRegistryDir?, port?, logLevel?, multiModelEnabled?, platformDefaultExecutor?, ollamaBaseUrl? }` | **Params:** `body` (object) |

### AI Models Section
- **Section label:** "AI Models" (amber highlight)
- **Toggle:** Enable Multi-Model — enables/disables alternative model routing (Ollama + cloud providers)
- **Setup guide** (shown when enabled): Platform-specific install instructions for Ollama (macOS, Windows, Linux), model pull commands, and a "Test Connection" button that checks Ollama availability and lists downloaded models
- **Settings grid:**

| Field | Description |
|-------|-------------|
| **Platform Default Executor** | Default executor for all agents: `claude` (default), `ollama:<model>`, or any supported provider:model combo |
| **Ollama Base URL** | Ollama API endpoint (default: `http://localhost:11434`) |

- **Save button** — saves AI model settings

#### Supported Providers

| Provider | Executor format | API key field | Example |
|----------|----------------|---------------|---------|
| **Claude** | `claude` (default) | — (uses local CLI auth) | `claude` |
| **Ollama** | `ollama:<model>` | — (local, no key) | `ollama:gemma2`, `ollama:llama3.1` |
| **OpenAI** | `openai:<model>` | `openai` | `openai:gpt-4o`, `openai:gpt-4o-mini` |
| **Grok (xAI)** | `grok:<model>` | `xai` | `grok:grok-3`, `grok:grok-3-mini` |
| **Gemini** | `gemini:<model>` | `google` | `gemini:gemini-2.5-flash`, `gemini:gemini-2.5-pro` |
| **Groq** | `groq:<model>` | `groq` | `groq:llama-3.3-70b-versatile` |
| **Together** | `together:<model>` | `together` | `together:meta-llama/Llama-3.3-70B-Instruct` |
| **Mistral** | `mistral:<model>` | `mistral` | `mistral:mistral-large-latest` |

API keys are stored in `config.json` under `service.providerKeys` (e.g., `{ "openai": "sk-...", "xai": "xai-...", "google": "AIza..." }`). Set them in Admin → Settings → Provider Keys.

- **Limitations:** Non-Claude agents (Ollama + cloud providers) get text-in/text-out only — no tool use (Read, Write, Bash), no MCP tools, no persistent sessions. Good for Q&A, content generation, and advisory roles.

| Action | API | MCP |
|--------|-----|-----|
| Enable multi-model | `PUT /api/config/service` | `update_service_config` |
| | **Body:** `{ multiModelEnabled: true }` | **Params:** `{ multiModelEnabled: true }` |
| Set platform default | `PUT /api/config/service` | `update_service_config` |
| | **Body:** `{ platformDefaultExecutor: "openai:gpt-4o" }` | **Params:** `{ platformDefaultExecutor: "openai:gpt-4o" }` |
| Set Ollama URL | `PUT /api/config/service` | `update_service_config` |
| | **Body:** `{ ollamaBaseUrl: "http://host:11434" }` | **Params:** `{ ollamaBaseUrl: "http://host:11434" }` |
| Set provider API keys | `PUT /api/config/service` | `update_service_config` |
| | **Body:** `{ providerKeys: { openai: "sk-...", xai: "xai-..." } }` | **Params:** `{ providerKeys: { ... } }` |
| Test provider API key | `POST /api/config/provider-test` | `test_provider` |
| | **Body:** `{ provider: "openai" }` — tests the configured key for that provider | **Params:** `provider` (string: openai, grok, gemini, groq, together, mistral) |
| Proxy Ollama tag list | `GET /api/ollama-proxy?url=<ollamaUrl>/api/tags` | — (internal) |
| | **Query:** `url` — only `/api/tags` proxy is allowed | N/A — used by the Settings UI to list local Ollama models |

### Deployment Section
- **Section label:** "Deployment" (green highlight)
- **Note:** "Restart required for most changes"
- **Settings grid:**

| Field | Description |
|-------|-------------|
| **Provider** | Deployment platform (e.g., "railway") |
| **Deploy Token** | Platform deploy token (password field with reveal toggle) |
| **GitHub Org/User** | GitHub organization or username for deployments |
| **GitHub Token** | GitHub personal access token (password field with reveal toggle) |

- **Save button** — saves deployment configuration
- **Reveal toggle buttons (👁)** — show/hide password fields for Deploy Token and GitHub Token

> Note: Deployment settings are stored in `config.json` and do not currently have dedicated API/MCP endpoints. They are managed through the `update_service_config` API.

| Action | API | MCP |
|--------|-----|-----|
| Get deployment config | `GET /api/config/service` | `get_service_config` |
| | Returns service config including deployment settings | *(no params)* |
| Update deployment config | `PUT /api/config/service` | `update_service_config` |
| | **Body:** `{ deployment: { provider?, deployToken?, githubOrg?, githubToken? } }` | **Params:** `body` (object) |

### SaaS Publishing Section
- **Description:** "Publish skills, prompts, agents, and apps from your Library to a shared SaaS workspace"
- **Status dot** — green when connected, hidden otherwise
- **Settings grid:**

| Field | Description |
|-------|-------------|
| **SaaS Base URL** | The SaaS platform URL |
| **API Key** | SaaS API key (password field with reveal toggle) |

- **Save button** — saves SaaS config
- **Test Connection button** — tests credentials

| Action | API | MCP |
|--------|-----|-----|
| Get SaaS config | `GET /api/saas/config` | `get_saas_config` |
| | | *(no params)* |
| Update SaaS config | `PUT /api/saas/config` | `update_saas_config` |
| | **Body:** `{ baseUrl?, apiKey? }` | **Params:** `baseUrl?`, `apiKey?` |
| Test SaaS connection | `POST /api/saas/test` | `test_saas_connection` |
| | **Body:** `{ baseUrl?, apiKey? }` | **Params:** `baseUrl?`, `apiKey?` |

### Status Indicator Section
- **Description:** "Show a live status dot in your menu bar (Mac) or system tray (Windows)"
- **Install xbar Plugin button** (macOS only) — installs the status bar indicator

| Action | API | MCP |
|--------|-----|-----|
| Install xbar plugin | `POST /api/install-xbar` | `install_xbar` |
| | | *(no params)* |

### Authorized Senders (Pairing)

| Action | API | MCP |
|--------|-----|-----|
| List paired senders | `GET /api/pairing` | `list_paired_senders` |
| | | *(no params)* |
| Pair sender | `POST /api/pairing` | `pair_sender` |
| | **Body:** `{ senderKey }` | **Params:** `senderKey` |
| Unpair sender | `DELETE /api/pairing/:senderKey` | `unpair_sender` |
| | | **Params:** `senderKey` |

## 7.4 Docs

**Tab:** Docs

Documentation cards:

| Card | Description | Action |
|------|-------------|--------|
| **API Docs** | Full REST API reference — endpoints, schemas, auth | External link (↗) |
| **MCP Tools** | MCP tool definitions — available actions via MCP | External link (↗) |
| **Changelog** | Release history — features, fixes, breaking changes | In-app link (→) |
| **User Guide** | This document — comprehensive platform walkthrough | In-app link (→) — **to be added** |

| Action | API | MCP |
|--------|-----|-----|
| Get changelog | `GET /api/changelog` | `get_changelog` |
| | | *(no params)* |

---

# 8. Monitor

**URL:** `/monitor`
**Purpose:** At-a-glance platform health and first-time setup checklist. This is the first page new users see after running `/setup`.

## 8.1 Setup Checklist

The **Getting Started** card appears at the top of the page. It tracks three onboarding milestones and auto-updates as you complete them.

| Element | Description |
|---------|-------------|
| **Connect a messaging channel** | Turns green when at least one channel (Telegram, Slack, WhatsApp, iMessage) is connected |
| **Create your first agent** | Turns green when at least one personal (non-platform) agent exists |
| **Send a test message** | Turns green when any personal agent has received at least one message |
| **Start Setup button** | Navigates to `/?setup=true`, which opens the hub chat and auto-triggers the `/onboarding` skill to walk through channel + agent setup |
| **"Setup complete!" badge** | Appears and the checklist collapses once all three items are done |

| Action | API | MCP |
|--------|-----|-----|
| Get dashboard data (drives checklist) | `GET /api/dashboard` | `get_dashboard` |

## 8.2 Dashboard

Below the setup checklist, a 2-column dashboard grid shows live platform metrics. Data auto-refreshes every 30 seconds.

### Platform Status Card

| Stat | Description |
|------|-------------|
| **Uptime** | How long the service has been running (hours + minutes) |
| **Total Agents** | Count of all registered agents (platform + personal) |
| **Personal Agents** | Count of non-platform agents (excludes hub, creators) |
| **Organizations** | Distinct organizations across all agents |
| **Channels** | Pills showing each connected channel name |
| **MCPs** | Number of MCP servers in the registry |
| **Active Automations** | Sum of active goals + active cron jobs across personal agents |
| **Open Tasks** | Sum of approved + in-progress + review tasks across personal agents |

### Agent Activity Card

Shows personal agents sorted by most recent activity.

| Element | Description |
|---------|-------------|
| **Search input** | Filter agents by name or alias |
| **Filter pills** | Toggle filters: MCPs, Skills, Automations, Open Tasks. Filters combine with AND logic. |
| **Agent rows** | Each row shows: avatar (initials), name, @alias, badge counts (MCPs, skills, automations, tasks), message count, and time since last message |
| **Click an agent row** | Navigates to `/ui?agent={agentId}` to chat with that agent |

### Recent Activity Card (full width)

A chronological feed of the last 15 messages across all agents.

| Element | Description |
|---------|-------------|
| **Time column** | Timestamp (HH:MM) |
| **Agent column** | Agent that handled the message |
| **Message column** | First 80 characters of the message. User messages shown in accent blue, agent responses in purple. |

### Costs Card (full width, conditional)

Only appears when cost data is available from `GET /api/costs`.

| Element | Description |
|---------|-------------|
| **Period rows** | Shows cost per time period (today, this week, this month) with dollar amounts |

| Action | API | MCP |
|--------|-----|-----|
| Get dashboard data | `GET /api/dashboard` | `get_dashboard` |
| Get recent activity | `GET /api/activity?limit=15` | `get_activity` |
| Get cost data | `GET /api/costs` | `get_all_costs` |

---

# 9. Projects

Cross-agent initiatives that bundle tasks, agents, orgs, apps, and artifacts under a single trackable entity. Unlike tasks (finite, single-agent), projects are long-running containers that group related work across your entire platform.

**Route:** `/projects`

## 9.1 Projects List

A responsive card grid showing all projects. Header displays active/paused/completed counts with a **+ New Project** button.

### Filter Bar

| Element | Description |
|---------|-------------|
| **Search** | Text search filtering by project name or description |
| **Status pills** | Filter by All, Active, Paused, Completed, Archived |

### Project Cards

| Element | Description |
|---------|-------------|
| **Name** | Project name (display font) |
| **Status badge** | Color-coded: active (green), paused (amber), completed (accent), archived (muted) |
| **Owner badge** | Agent ID that owns the project |
| **Team count** | Number of team member agents |
| **Description** | Truncated to 2 lines |
| **Progress bar** | Based on linked task completion percentage |
| **Task stats** | "X/Y tasks done" |
| **Linked counts** | Agents, apps, artifacts counts |
| **Created date** | When the project was created |
| **Click** | Opens the project detail panel |

## 9.2 Project Detail Panel

Slide-in panel showing full project details with editable fields.

| Element | Description |
|---------|-------------|
| **Name** | Editable project name |
| **Description** | Editable description |
| **Status** | Dropdown: active, paused, completed, archived |
| **Owner** | Dropdown of all agents |
| **Team Members** | Multi-select checkboxes of agents |
| **Plan** | Editable markdown textarea |
| **Notes** | Editable freeform textarea |
| **Linked Tasks** | List with status dots, link/unlink controls |
| **Linked Agents** | List with unlink controls |
| **Linked Orgs** | List with unlink controls |
| **Linked Apps** | List with unlink controls |
| **Linked Artifacts** | List with name + type, unlink controls |
| **Save button** | Saves all changes |
| **Delete button** | Deletes the project |
| **Link entity** | Type selector + value input to add new links |

## 9.3 Create Project Modal

Form for creating a new project.

| Field | Description |
|-------|-------------|
| **Name** | Required — project name |
| **Description** | What this project is about |
| **Owner** | Agent dropdown (defaults to hub) |
| **Team Members** | Checkboxes for team agent selection |
| **Plan** | Markdown textarea for the project plan |
| **Notes** | Additional notes |

## 9.4 API & MCP Reference

| Action | API | MCP |
|--------|-----|-----|
| List all projects | `GET /api/projects` | `list_projects` |
| Get project detail | `GET /api/projects/:id` | `get_project` |
| Create project | `POST /api/projects` | `create_initiative` |
| Update project | `PUT /api/projects/:id` | `update_project` |
| Delete project | `DELETE /api/projects/:id` | `delete_project` |
| Link entity to project | `POST /api/projects/:id/link` | `link_to_project` |
| Unlink entity from project | `POST /api/projects/:id/unlink` | `unlink_from_project` |
| Get project status report | `GET /api/projects/:id/status` | `get_project_status` |
| Start autonomous execution | `POST /api/projects/:id/execute` | `execute_project` |
| Pause autonomous execution | `POST /api/projects/:id/pause` | `pause_project` |

### Autonomous Execution

Projects can execute autonomously in the background. When you call `execute_project`, it creates a scheduled goal on the owner agent that:
1. Reads the project status and finds the next undone task
2. Marks it in-progress, executes it, marks it done
3. Continues to the next task
4. Reports to the owner agent's Slack channel when complete or blocked

Options: `schedule` (cron, default every 15 min), `reportTo` (channel:chatId), `budget` (maxDailyUsd, default $5).

Use `pause_project` to stop execution. The goal is disabled but preserved.

---

# 10. AI Gym

Personal AI training area with a coach agent, structured programs, dimension tracking, and personalized learning plans. Gated behind `gymEnabled: true` in settings.

**Route:** `/gym`

## 10.1 Onboarding (First Visit)

Full-screen 3-step flow shown when `onboardingComplete: false`. Must be completed before accessing the main gym.

### Step 1 — Choose Your Trainer

| Element | Description |
|---------|-------------|
| **Trainer cards** | Grid of 5 trainer profiles, each with avatar, name, style, and intro quote |
| **Alex** | Collaborative · Steady — works alongside you |
| **Jordan** | Direct · Steady — holds you accountable |
| **Morgan** | Thoughtful · Steady — explains the "why" |
| **Riley** | Challenging · Immersive — pushes you hard |
| **Sam** | Patient · Steady — meets you where you are |
| **Next button** | Enabled after selecting a trainer |

### Step 2 — Get to Know You

| Element | Description |
|---------|-------------|
| **Coach header** | Selected trainer's avatar and name |
| **Coach message** | One-question prompt asking about professional background, AI experience, and goals |
| **Text input** | Free-form textarea for response |
| **Send button** | Sends response to gym agent via `POST /api/chat/gym/stream` |

### Step 3 — Get Your Plan

| Element | Description |
|---------|-------------|
| **Loading spinner** | Shown while coach generates the plan |
| **Plan summary** | Two-bucket display: On-the-Job Training + Platform-Driven Learning |
| **Enter the Gym** | Marks onboarding complete and enters main gym |

## 10.2 Mode Picker (Landing)

After onboarding, returning users see a **mode picker** instead of jumping straight into chat. Three tiles answer "what brings you to the gym?"

| Tile | Title | Description |
|------|-------|-------------|
| **1** | **I have work to do** | Bring a real task. Coach helps you execute while teaching along the way. Chat opens with "Describe what you need to get done..." placeholder. |
| **2 (Recommended)** | **You tell me** | Coach picks what to work on based on activity, dimension gaps, and unused features. Visually emphasized with accent border. Auto-sends a coaching request — coach arrives with one specific recommendation. |
| **3** | **I want to get smart** | Self-directed learning. Pick a topic or program. If in-progress program exists, coach offers to continue it. Otherwise prompts for topic. |

Additional elements:
- **Time-aware greeting** — "Good morning/afternoon/evening. What brings you to the gym?"
- **Streak counter** — shown below tiles if streak > 0

Clicking a tile sets the **session mode** (task/coach/learn), transitions to the main gym view, and primes the coach chat with mode-appropriate context.

## 10.3 Main Gym View

Three-panel layout: left sidebar, center panel (tabbed), bottom feed strip.

### Top Bar

| Element | Description |
|---------|-------------|
| **Configure button** | Opens the agent editor modal (same as Org page) in an iframe overlay, pre-loaded with the gym agent. Shows all 6 standard tabs plus 4 gym-specific tabs (Trainer, Learner, Dimensions, Programs). See section 2.2 for tab details. |
| **Gym nav link** | Returns to gym home |
| **Theme toggle** | Light/dark mode switch |

### Left Sidebar

| Element | Description |
|---------|-------------|
| **Streak counter** | Fire icon with current day streak count |
| **Programs list** | All programs with status indicators: ✓ (done), N/M (in progress), ○ (not started) |
| **Gym cards** | 2–3 cards with title, description, CTA button, and dismiss (×) control |
| **"New" badge** | Shown on cards generated by the latest digest |

### Center Panel — Coach Tab

| Element | Description |
|---------|-------------|
| **Coach header** | Trainer name + avatar + style subtitle |
| **Chat messages** | Scrollable conversation area (user right-aligned, coach left-aligned) |
| **Chat input** | Textarea with Enter-to-send + send button. Routes to `POST /api/chat/gym/stream` |
| **Typing indicator** | Three bouncing dots shown while coach is responding |
| **SSE streaming** | Responses stream in real-time via `GET /api/chat/jobs/:jobId/stream` |

### Center Panel — Progress Tab

| Element | Description |
|---------|-------------|
| **Radar chart** | SVG spider chart showing 5 dimensions at current scores (0–5) |
| **Dimension breakdown** | Row per dimension: label, progress bar, score/5, trend arrow (↑ ↓ →) |
| **Next focus** | Callout highlighting the weakest dimension with guidance text |
| **Milestones** | Chronological list of achievements (program completions, level-ups) |

### Bottom Feed Strip

Placeholder for P1. Displays "Feed coming in P1".

## 10.4 AI Strength Dimensions

Learners are scored across 5 dimensions on a **1–5 scale** (0 = not yet assessed):

| Dimension | What It Measures |
|-----------|-----------------|
| **Application** | How deeply AI is integrated into actual work — usage frequency, breadth, habit |
| **Communication** | Prompt effectiveness — context, specificity, iteration efficiency |
| **Knowledge** | Conceptual understanding of AI, agents, tools, MCPs, memory |
| **Orchestration** | Multi-agent workflows — goals, cron, delegation, automation |
| **Craft** | Building AI systems — agent creation, system prompts, tool/MCP config |

Score labels: 1 = Beginner, 2 = Developing, 3 = Proficient, 4 = Advanced, 5 = Expert.

## 10.5 Programs

Structured training curricula. Each program has modules, and each module has steps with verification.

### Getting Started (Bundled)

Pre-installed beginner program with 3 modules and 7 steps:
- **Meet Your AI** — What is an agent? + Have your first conversation
- **Give It Context** — Prompt quality + Try a detailed prompt + Upload a file
- **Make It Yours** — Create a specialized agent + Write a system prompt

### Step Verification Types

| Type | How It Works |
|------|-------------|
| **knowledge** | Coach asks comprehension questions, evaluates understanding |
| **platform-check** | Coach calls MCP tools to verify platform state changed (e.g., new agent created) |
| **self-report** | User describes what they did and learned |

## 10.6 Activity Digest

Scheduled daily at 6am (when `gymEnabled: true`). Also triggerable manually via `POST /api/gym/digest/run`.

What it does:
1. Scans all agent activity summaries
2. Scores 5 dimensions using observed patterns
3. Snapshots dimension history weekly
4. Updates learner profile (activity, features, streak, dimensions)
5. Writes daily journal to `agents/platform/gym/memory/daily/<date>.md`
6. Generates 2–3 gym cards (weakest dimension tips, dormant agent nudges, unused feature discovery)

## 10.7 Trainer Souls

Each trainer is a `soul.md` file prepended to the gym agent's system prompt at spawn time. Switching trainers changes the coaching voice without affecting progress, plan, or profile. Switch anytime via the **Trainer tab** in the gym agent's Configure modal (top bar → Configure → Trainer tab).

Avatar SVGs at `public/trainers/{alex,jordan,morgan,riley,sam}.svg`.

## 10.8 Coach-Created Guides

After any substantive coaching session, the gym agent auto-generates a reusable guide and asks the user to review it.

| Element | Description |
|---------|-------------|
| **Guide generation** | Coach distills session into clean step-by-step instructions via `create_gym_guide` MCP tool |
| **Review prompt** | Coach asks "I wrote up a guide from what we just did — want to review it?" |
| **Approval** | User can edit, approve, or discard before saving |
| **Where guides appear** | Gym sidebar → Guides tab → "Coach Created" filter |
| **Skill publishing** | Guides can also be published as agent-executable skills via `create_skill` |

Guides have two forms: human-readable (browsable in gym) and agent-executable (assignable as skills).

| Action | API | MCP |
|--------|-----|-----|
| List coach guides | `GET /api/gym/guides` | `list_gym_guides` |
| Create coach guide | `POST /api/gym/guides` | `create_gym_guide` |
| | **Body:** `{ title, description?, difficulty?, dimensions?, estimatedTime?, modules?, content? }` | **Params:** `title`, `description?`, `difficulty?`, `dimensions?`, `estimatedTime?`, `modules?`, `content?` |

## 10.9 API & MCP Reference

| Action | API | MCP |
|--------|-----|-----|
| Get learner profile | `GET /api/gym/learner-profile` | `get_learner_profile` |
| Update learner profile | `PUT /api/gym/learner-profile` | `update_learner_profile` |
| | **Body:** any profile fields (merged) | **Params:** `data` (object) |
| Get training plan | `GET /api/gym/plan` | `get_plan` |
| Update training plan | `PUT /api/gym/plan` | `update_plan` |
| | **Body:** full plan object | **Params:** `data` (object) |
| Get program progress | `GET /api/gym/progress` | `get_gym_progress` |
| Update program progress | `PUT /api/gym/progress` | `update_gym_progress` |
| | **Body:** progress data | **Params:** `data` (object) |
| List gym cards | `GET /api/gym/cards` | `list_gym_cards` |
| Create gym card | `POST /api/gym/cards` | `create_gym_card` |
| | **Body:** `{ title, description, type, cta?, ctaAction? }` | **Params:** `title`, `description`, `type` |
| Dismiss gym card | `DELETE /api/gym/cards/:id` | `dismiss_gym_card` |
| | | **Params:** `id` |
| Snapshot dimensions | `POST /api/gym/dimensions/snapshot` | `snapshot_dimensions` |
| | **Body:** `{ date?, dimensions }` | **Params:** `date?`, `dimensions` |
| Get dimension history | `GET /api/gym/dimensions/history` | `get_dimension_history` |
| List programs | `GET /api/gym/programs` | `list_gym_programs` |
| Get program detail | `GET /api/gym/programs/:slug` | `get_gym_program` |
| | | **Params:** `slug` |
| Create program | `POST /api/gym/programs` | -- |
| | **Body:** `{ title, slug?, description, difficulty, modules[] }` | |
| Update program | `PATCH /api/gym/programs/:slug` | `update_gym_program` |
| | **Body:** fields to update | **Params:** `slug`, `body` |
| Delete program | `DELETE /api/gym/programs/:slug` | `delete_gym_program` |
| | | **Params:** `slug` |
| Import program from markdown | `POST /api/gym/programs/import-markdown` | `import_program` |
| | **Body:** `{ markdown }` (H1=program, H2=module, H3=step) | **Params:** `markdown` |
| Get agent activity summary | `GET /api/agents/:id/activity-summary` | `get_agent_activity_summary` |
| | | **Params:** `agentId` |
| Get agent logs (paginated) | `GET /api/agents/:id/logs?limit=50&offset=0` | `get_agent_logs` |
| | | **Params:** `agentId`, `limit?`, `offset?` |
| Search agent logs | `GET /api/agents/logs/search?q=keyword&agentIds=a,b` | `search_agent_logs` |
| | | **Params:** `q`, `agentIds?` |
| Run activity digest | `POST /api/gym/digest/run` | `run_gym_digest` |
| Get gym feed | `GET /api/gym/feed` | `get_gym_feed` |
| | Returns tips, platformUpdates, briefing | *(no params)* |
| Get gym config flags | `GET /api/gym/config` | `get_gym_config` |
| | Returns gymEnabled, gymOnlyMode, aibriefingEnabled | *(no params)* |
| List coach-created guides | `GET /api/gym/guides` | `list_gym_guides` |
| | Returns array of programs with source=coach | *(no params)* |
| Create coach guide | `POST /api/gym/guides` | `create_gym_guide` |
| | **Body:** `{ title, description?, difficulty?, dimensions?, estimatedTime?, modules?, content? }` | **Params:** `title`, `description?`, `difficulty?`, `dimensions?`, `estimatedTime?`, `modules?`, `content?` |

---

# Appendix A: Global Navigation

Present on every page:

| Element | Description |
|---------|-------------|
| **MyAIforOne logo** | Home link |
| **Agents tab** | → `/org` |
| **Chat tab** | → `/ui` |
| **Library tab** | → `/library` |
| **Projects tab** | → `/projects` |
| **Lab tab** | → `/lab` |
| **Gym tab** | → `/gym` (only visible when `gymEnabled: true`) |
| **Marketplace link** | → `/marketplace` |
| **Admin button (⚙)** | → `/admin` |
| **User Guide button** | → `/user-guide` — this document |
| **Monitor button** | → `/monitor` — setup checklist + live dashboard |
| **Mini Bar button** | Opens a compact floating popup window (440×460) at `/mini`. A lightweight chat interface you can keep open while working — has agent selection, @mention, send, and basic chat. Useful as a quick-access sidebar. |
| **Theme toggle** | Switches between light and dark mode. Persists across sessions via localStorage. |

---

# Appendix B: Dashboard & Health

| Action | API | MCP |
|--------|-----|-----|
| Full dashboard | `GET /api/dashboard` | `get_dashboard` |
| | Returns all agents, channels, accounts, uptime | *(no params)* |
| Health check | `GET /health` | `health_check` |
| | Returns `{ status: "ok" }` | *(no params)* |

---

# Appendix C: Webhook

External systems can trigger agent messages via webhook:

| Action | API | MCP |
|--------|-----|-----|
| Send webhook | `POST /webhook/:agentId` | `send_webhook` |
| | **Headers:** `x-webhook-secret: secret` (optional) | **Params:** `agentId`, `text`, `secret?`, `channel?`, `chatId?` |
| | **Body:** `{ text, channel?, chatId? }` | |

---

# Appendix D: Complete MCP Tool Index

Quick reference — all MCP tools alphabetically:

| # | Tool | Category |
|---|------|----------|
| 1 | `add_account` | Accounts |
| 2 | `add_agent_route` | Channels |
| 3 | `add_monitored_chat` | Channels |
| 4 | `add_mcp_to_registry` | Marketplace |
| 5 | `assign_to_agent` | Marketplace |
| 6 | `browse_dirs` | Utilities |
| 7 | `browse_registry` | Marketplace |
| 8 | `check_account_status` | Accounts |
| 9 | `check_app_health` | Apps |
| 10 | `clear_memory_context` | Memory |
| 11 | `clear_model` | Model |
| 12 | `create_agent` | Agents |
| -- | `create_gym_card` | AI Gym |
| -- | `create_gym_guide` | AI Gym |
| 13 | `create_app` | Apps |
| 14 | `create_cron` | Cron |
| 15 | `create_goal` | Goals |
| 16 | `create_mcp_connection` | MCPs |
| 17 | `create_initiative` | Projects |
| 18 | `create_project` | Tasks |
| 19 | `create_prompt` | Marketplace |
| 19 | `create_skill` | Skills |
| 20 | `create_task` | Tasks |
| 21 | `delegate_message` | Chat |
| 22 | `delete_account` | Accounts |
| 23 | `delete_agent` | Agents |
| -- | `delete_gym_program` | AI Gym |
| 24 | `delete_app` | Apps |
| 25 | `delete_cron` | Cron |
| 26 | `delete_goal` | Goals |
| 27 | `delete_mcp_connection` | MCPs |
| -- | `delete_project` | Projects |
| 28 | `delete_mcp_key` | MCPs |
| 29 | `delete_session` | Sessions |
| -- | `create_session_tab` | Session Tabs |
| -- | `delete_session_tab` | Session Tabs |
| 30 | `delete_task` | Tasks |
| -- | `execute_project` | Projects |
| -- | `dismiss_gym_card` | AI Gym |
| 31 | `download_agent_file` | Files |
| 32 | `get_activity` | Activity |
| 33 | `get_agent` | Agents |
| -- | `get_agent_activity_summary` | AI Gym |
| 34 | `get_agent_cost` | Cost |
| 35 | `get_agent_instructions` | Agents |
| 36 | `get_agent_logs` | Activity |
| 37 | `get_agent_memory` | Memory |
| -- | `get_session_tab_history` | Session Tabs |
| 38 | `get_agent_registry` | Agents |
| 39 | `get_agent_skills` | Skills |
| 40 | `get_all_costs` | Cost |
| 41 | `get_all_tasks` | Tasks |
| 42 | `get_changelog` | Utilities |
| 43 | `get_chat_job_raw` | Chat |
| 44 | `get_cron_history` | Cron |
| 45 | `get_dashboard` | Dashboard |
| -- | `get_dimension_history` | AI Gym |
| 46 | `get_goal_history` | Goals |
| -- | `get_heartbeat_history` | Heartbeat |
| -- | `get_gym_config` | AI Gym |
| -- | `get_gym_feed` | AI Gym |
| -- | `get_gym_program` | AI Gym |
| -- | `get_gym_progress` | AI Gym |
| -- | `get_learner_profile` | AI Gym |
| -- | `get_mcp_catalog` | MCPs |
| 49 | `get_model` | Model |
| -- | `get_org_skills` | Skills |
| -- | `get_plan` | AI Gym |
| -- | `get_platform_agents` | Lab |
| -- | `get_project` | Projects |
| -- | `get_project_status` | Projects |
| -- | `get_profile` | Profile |
| -- | `get_prompt_trigger` | Marketplace |
| 53 | `get_saas_config` | SaaS |
| 54 | `get_service_config` | Config |
| 55 | `get_sticky_routing` | Channels |
| 56 | `get_task_stats` | Tasks |
| 57 | `get_wiki_sync_history` | Wiki |
| 58 | `health_check` | Dashboard |
| -- | `import_program` | AI Gym |
| 59 | `import_skills` | Marketplace |
| 60 | `install_registry_item` | Marketplace |
| 61 | `install_xbar` | Utilities |
| -- | `link_to_project` | Projects |
| 62 | `list_agents` | Agents |
| -- | `list_gym_cards` | AI Gym |
| -- | `list_gym_guides` | AI Gym |
| -- | `list_gym_programs` | AI Gym |
| 63 | `list_agent_files` | Files |
| 64 | `list_apps` | Apps |
| 65 | `list_automations` | Automations |
| 66 | `list_channels` | Channels |
| 67 | `list_mcp_connections` | MCPs |
| 68 | `list_mcp_keys` | MCPs |
| 69 | `list_mcps` | MCPs |
| 70 | `list_paired_senders` | Pairing |
| -- | `list_projects` | Projects |
| 71 | `list_sessions` | Sessions |
| -- | `list_session_tabs` | Session Tabs |
| 72 | `list_tasks` | Tasks |
| 73 | `list_accounts` | Accounts |
| 74 | `pair_sender` | Pairing |
| -- | `pause_project` | Projects |
| 75 | `publish_to_saas` | SaaS |
| 76 | `recover_agent` | Agents |
| -- | `run_gym_digest` | AI Gym |
| -- | `rename_session_tab` | Session Tabs |
| 77 | `remove_agent_route` | Channels |
| 78 | `remove_monitored_chat` | Channels |
| 79 | `reset_session` | Sessions |
| 80 | `save_mcp_key` | MCPs |
| 81 | `scan_skills` | Marketplace |
| -- | `search_agent_logs` | AI Gym |
| 82 | `search_memory` | Memory |
| 83 | `send_message` | Chat |
| -- | `snapshot_dimensions` | AI Gym |
| 84 | `send_webhook` | Webhook |
| 85 | `set_model` | Model |
| 86 | `set_platform_default` | Marketplace |
| 87 | `set_prompt_trigger` | Marketplace |
| 88 | `start_account_login` | Accounts |
| 89 | `start_stream` | Chat |
| 90 | `stop_chat_job` | Chat |
| 91 | `submit_login_code` | Accounts |
| 92 | `test_provider` | Service Config / Multi-Provider |
| 93 | `test_saas_connection` | SaaS |
| 94 | `toggle_cron` | Cron |
| 94 | `toggle_goal` | Goals |
| 95 | `trigger_cron` | Cron |
| 96 | `trigger_goal` | Goals |
| 97 | `trigger_heartbeat` | Heartbeat |
| 98 | `trigger_wiki_sync` | Wiki |
| 99 | `unpair_sender` | Pairing |
| -- | `unlink_from_project` | Projects |
| 100 | `update_agent` | Agents |
| -- | `update_gym_program` | AI Gym |
| -- | `update_gym_progress` | AI Gym |
| -- | `update_learner_profile` | AI Gym |
| 101 | `update_app` | Apps |
| 102 | `update_channel` | Channels |
| -- | `update_plan` | AI Gym |
| -- | `update_profile` | Profile |
| -- | `update_project` | Projects |
| 103 | `update_saas_config` | SaaS |
| 104 | `update_service_config` | Config |
| 105 | `update_task` | Tasks |
| 106 | `upload_file` | Files |
| 107 | `whoami` | Accounts |
