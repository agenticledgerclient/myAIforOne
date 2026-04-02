# Platform MCP Audit — Hub Agent Readiness

> Every action the hub agent needs to perform must be available as an MCP tool.
> This audit maps every platform API endpoint to its MCP tool coverage.
> **Status**: ✅ = covered | ❌ = missing | ⚠️ = partial

---

## Summary

| Category | API Endpoints | MCP Tools | Gaps |
|----------|:---:|:---:|:---:|
| Agents | 8 | 8 | 0 |
| Chat & Streaming | 6 | 5 | 1 |
| Sessions | 3 | 3 | 0 |
| Tasks & Projects | 7 | 7 | 0 |
| Goals | 5 | 5 | 0 |
| Cron Jobs | 5 | 5 | 0 |
| Automations (list) | 1 | 1 | 0 |
| Skills | 3 | 3 | 0 |
| MCPs | 2 | 2 | 0 |
| MCP Keys & Connections | 5 | 5 | 0 |
| Marketplace / Registry | 9 | 9 | 0 |
| Channels | 7 | 7 | 0 |
| Memory | 3 | 3 | 0 |
| Activity & Logs | 3 | 3 | 0 |
| Model Overrides | 3 | 3 | 0 |
| Cost | 2 | 2 | 0 |
| Files | 3 | 3 | 0 |
| Apps | 5 | 5 | 0 |
| Accounts / Auth | 6 | 6 | 0 |
| Service Config | 2 | 2 | 0 |
| Pairing | 3 | 3 | 0 |
| Heartbeat | 2 | 2 | 0 |
| Delegation | 1 | 1 | 0 |
| Webhooks | 1 | 1 | 0 |
| SaaS Integration | 4 | 4 | 0 |
| Dashboard | 2 | 2 | 0 |
| Platform Agents (Lab) | 1 | 1 | 0 |
| Utilities | 3 | 3 | 0 |
| **TOTAL** | **105** | **104** | **1** |

> Note: ~21 HTML page routes excluded (not API actions). Only API endpoints counted.

---

## Detailed Mapping

### Agents

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 1 | List all agents | `GET /api/agents` | `list_agents` | ✅ |
| 2 | Get agent details | `GET /api/agents/:id` | `get_agent` | ✅ |
| 3 | Get agent instructions | `GET /api/agents/:id/instructions` | `get_agent_instructions` | ✅ |
| 4 | Create agent | `POST /api/agents` | `create_agent` | ✅ |
| 5 | Update agent | `PUT /api/agents/:id` | `update_agent` | ✅ |
| 6 | Delete agent | `DELETE /api/agents/:id` | `delete_agent` | ✅ |
| 7 | Recover agent | `POST /api/agents/:agentId/recover` | `recover_agent` | ✅ |
| 8 | Get agent registry | `GET /api/agent-registry` | `get_agent_registry` | ✅ |

### Chat & Streaming

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 9 | Send message (sync) | `POST /api/chat/:agentId` | `send_message` | ✅ |
| 10 | Start streaming chat | `POST /api/chat/:agentId/stream` | `start_stream` | ✅ |
| 11 | Get stream output (SSE) | `GET /api/chat/jobs/:jobId/stream` | — | ❌ |
| 12 | Get raw job output | `GET /api/chat/jobs/:jobId/raw` | `get_chat_job_raw` | ✅ |
| 13 | Stop chat job | `POST /api/chat/jobs/:jobId/stop` | `stop_chat_job` | ✅ |
| 14 | Delegate to agent | `POST /api/delegate` | `delegate_message` | ✅ |

> **Gap note:** SSE stream endpoint is browser-only; MCP clients use `get_chat_job_raw` polling instead. **Not a real gap** — can reclassify as N/A.

### Sessions

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 15 | List sessions | `GET /api/agents/:agentId/sessions` | `list_sessions` | ✅ |
| 16 | Reset session | `POST /api/agents/:agentId/sessions/reset` | `reset_session` | ✅ |
| 17 | Delete session | `DELETE /api/agents/:agentId/sessions/:senderId` | `delete_session` | ✅ |

### Tasks & Projects

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 18 | List agent tasks | `GET /api/agents/:id/tasks` | `list_tasks` | ✅ |
| 19 | Create task | `POST /api/agents/:id/tasks` | `create_task` | ✅ |
| 20 | Update task | `PUT /api/agents/:id/tasks/:taskId` | `update_task` | ✅ |
| 21 | Delete task | `DELETE /api/agents/:id/tasks/:taskId` | `delete_task` | ✅ |
| 22 | Get all tasks (cross-agent) | `GET /api/tasks/all` | `get_all_tasks` | ✅ |
| 23 | Get task stats | `GET /api/agents/:id/tasks/stats` | `get_task_stats` | ✅ |
| 24 | Create project | `POST /api/agents/:id/projects` | `create_project` | ✅ |

### Goals

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 25 | Create goal | `POST /api/agents/:id/goals` | `create_goal` | ✅ |
| 26 | Toggle goal | `POST /api/agents/:id/goals/:goalId/toggle` | `toggle_goal` | ✅ |
| 27 | Trigger goal | `POST /api/agents/:id/goals/:goalId/trigger` | `trigger_goal` | ✅ |
| 28 | Delete goal | `DELETE /api/agents/:id/goals/:goalId` | `delete_goal` | ✅ |
| 29 | Get goal history | `GET /api/agents/:id/goals/:goalId/history` | `get_goal_history` | ✅ |

### Cron Jobs

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 30 | Create cron | `POST /api/agents/:id/cron` | `create_cron` | ✅ |
| 31 | Toggle cron | `POST /api/agents/:id/cron/:index/toggle` | `toggle_cron` | ✅ |
| 32 | Trigger cron | `POST /api/agents/:id/cron/:index/trigger` | `trigger_cron` | ✅ |
| 33 | Delete cron | `DELETE /api/agents/:id/cron/:index` | `delete_cron` | ✅ |
| 34 | Get cron history | `GET /api/agents/:id/cron/:index/history` | `get_cron_history` | ✅ |

### Automations

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 35 | List all automations | `GET /api/automations` | `list_automations` | ✅ |

### Skills

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 36 | Create skill | `POST /api/skills/create` | `create_skill` | ✅ |
| 37 | Get agent skills | `GET /api/agents/:agentId/skills` | `get_agent_skills` | ✅ |
| 38 | Get org skills | `GET /api/skills/org/:orgName` | `get_org_skills` | ✅ |

### MCPs

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 39 | List MCPs | `GET /api/mcps` | `list_mcps` | ✅ |
| 40 | Get MCP catalog | `GET /api/mcp-catalog` | `get_mcp_catalog` | ✅ |

### MCP Keys & Connections

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 41 | List MCP keys | `GET /api/agents/:id/mcp-keys` | `list_mcp_keys` | ✅ |
| 42 | Save MCP key | `POST /api/agents/:id/mcp-keys` | `save_mcp_key` | ✅ |
| 43 | Delete MCP key | `DELETE /api/agents/:id/mcp-keys/:mcpName` | `delete_mcp_key` | ✅ |
| 44 | List MCP connections | `GET /api/agents/:id/mcp-connections` | `list_mcp_connections` | ✅ |
| 45 | Create MCP connection | `POST /api/agents/:id/mcp-connections` | `create_mcp_connection` | ✅ |
| 46 | Delete MCP connection | `DELETE /api/agents/:id/mcp-connections/:instanceName` | `delete_mcp_connection` | ✅ |

### Marketplace / Registry

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 47 | Browse by type | `GET /api/marketplace/:type` | `browse_registry` | ✅ |
| 48 | Install item | `POST /api/marketplace/install` | `install_registry_item` | ✅ |
| 49 | Assign to agent | `POST /api/marketplace/assign` | `assign_to_agent` | ✅ |
| 50 | Set platform default | `POST /api/marketplace/platform-default` | `set_platform_default` | ✅ |
| 51 | Scan skills | `GET /api/marketplace/scan-skills` | `scan_skills` | ✅ |
| 52 | Import skills | `POST /api/marketplace/import-skills` | `import_skills` | ✅ |
| 53 | Create prompt | `POST /api/marketplace/create-prompt` | `create_prompt` | ✅ |
| 54 | Get prompt trigger | `GET /api/marketplace/prompt-trigger` | `get_prompt_trigger` | ✅ |
| 55 | Set prompt trigger | `POST /api/marketplace/prompt-trigger` | `set_prompt_trigger` | ✅ |
| 56 | Add MCP to registry | `POST /api/marketplace/add-mcp` | `add_mcp_to_registry` | ✅ |

### Channels

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 57 | List channels | `GET /api/channels` | `list_channels` | ✅ |
| 58 | Update channel | `PUT /api/channels/:channelName` | `update_channel` | ✅ |
| 59 | Add agent route | `POST /api/channels/:channelName/agents` | `add_agent_route` | ✅ |
| 60 | Remove agent route | `DELETE /api/channels/:channelName/agents/:agentId` | `remove_agent_route` | ✅ |
| 61 | Add monitored chat | `POST /api/channels/:channelName/monitored` | `add_monitored_chat` | ✅ |
| 62 | Remove monitored chat | `DELETE /api/channels/:channelName/monitored` | `remove_monitored_chat` | ✅ |
| 63 | Get sticky routing | `GET /api/sticky-routing` | `get_sticky_routing` | ✅ |

### Memory

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 64 | Get agent memory | `GET /api/agents/:agentId/memory` | `get_agent_memory` | ✅ |
| 65 | Search memory | `POST /api/agents/:agentId/memory/search` | `search_memory` | ✅ |
| 66 | Clear memory context | `DELETE /api/agents/:agentId/memory/context` | `clear_memory_context` | ✅ |

### Activity & Logs

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 67 | Get activity feed | `GET /api/activity` | `get_activity` | ✅ |
| 68 | Get agent logs | `GET /api/agents/:agentId/logs` | `get_agent_logs` | ✅ |
| 69 | Get changelog | `GET /api/changelog` | `get_changelog` | ✅ |

### Model Overrides

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 70 | Get model | `GET /api/agents/:agentId/model` | `get_model` | ✅ |
| 71 | Set model | `PUT /api/agents/:agentId/model` | `set_model` | ✅ |
| 72 | Clear model | `DELETE /api/agents/:agentId/model` | `clear_model` | ✅ |

### Cost

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 73 | Get agent cost | `GET /api/agents/:agentId/cost` | `get_agent_cost` | ✅ |
| 74 | Get all costs | `GET /api/cost/all` | `get_all_costs` | ✅ |

### Files

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 75 | Upload file (JSON/base64) | `POST /api/upload/:agentId/json` | `upload_file` | ✅ |
| 76 | List agent files | `GET /api/agents/:agentId/files` | `list_agent_files` | ✅ |
| 77 | Download file | `GET /api/agents/:agentId/download` | `download_agent_file` | ✅ |

### Apps

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 78 | List apps | `GET /api/apps` | `list_apps` | ✅ |
| 79 | Create app | `POST /api/apps` | `create_app` | ✅ |
| 80 | Update app | `PUT /api/apps/:id` | `update_app` | ✅ |
| 81 | Delete app | `DELETE /api/apps/:id` | `delete_app` | ✅ |
| 82 | Check app health | `POST /api/apps/:id/check-health` | `check_app_health` | ✅ |

### Accounts / Auth

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 83 | List accounts | `GET /api/config/accounts` | `list_accounts` | ✅ |
| 84 | Add account | `POST /api/config/accounts` | `add_account` | ✅ |
| 85 | Delete account | `DELETE /api/config/accounts/:name` | `delete_account` | ✅ |
| 86 | Check account status | `GET /api/config/accounts/:name/status` | `check_account_status` | ✅ |
| 87 | Start login | `POST /api/config/accounts/login` | `start_account_login` | ✅ |
| 88 | Submit login code | `POST /api/config/accounts/login/code` | `submit_login_code` | ✅ |

### Service Config

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 89 | Get service config | `GET /api/config/service` | `get_service_config` | ✅ |
| 90 | Update service config | `PUT /api/config/service` | `update_service_config` | ✅ |

### Pairing

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 91 | List paired senders | `GET /api/pairing` | `list_paired_senders` | ✅ |
| 92 | Pair sender | `POST /api/pairing` | `pair_sender` | ✅ |
| 93 | Unpair sender | `DELETE /api/pairing/:senderKey` | `unpair_sender` | ✅ |

### Heartbeat

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 94 | Trigger heartbeat | `POST /api/agents/:id/heartbeat` | `trigger_heartbeat` | ✅ |
| 95 | Get heartbeat history | `GET /api/agents/:id/heartbeat-history` | `get_heartbeat_history` | ✅ |

### Webhooks

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 96 | Send webhook | `POST /webhook/:agentId` | `send_webhook` | ✅ |

### Dashboard

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 97 | Get dashboard | `GET /api/dashboard` | `get_dashboard` | ✅ |
| 98 | Browse directories | `GET /api/browse-dirs` | `browse_dirs` | ✅ |

### Platform Agents (Lab)

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 99 | Get platform agents | `GET /api/platform-agents` | `get_platform_agents` | ✅ |

### Utilities

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 100 | Health check | `GET /health` | `health_check` | ✅ |
| 101 | Install xbar | `POST /api/install-xbar` | `install_xbar` | ✅ |
| 102 | Whoami | `GET /api/whoami/:agentId` | `whoami` | ✅ |

### SaaS Integration

| # | Action | API Endpoint | MCP Tool | Status |
|---|--------|-------------|----------|:---:|
| 103 | Get SaaS config | `GET /api/saas/config` | `get_saas_config` | ✅ |
| 104 | Update SaaS config | `PUT /api/saas/config` | `update_saas_config` | ✅ |
| 105 | Test SaaS connection | `POST /api/saas/test` | `test_saas_connection` | ✅ |
| 106 | Publish to SaaS | `POST /api/saas/publish` | `publish_to_saas` | ✅ |

---

## Gap Analysis

### ✅ All Gaps Closed

**Phase 1** (2026-04-02 — API coverage):
- `get_saas_config` — Get SaaS connection settings
- `update_saas_config` — Configure SaaS base URL and API key
- `test_saas_connection` — Test SaaS credentials
- `publish_to_saas` — Publish skill/prompt/agent/app to SaaS platform
- `upload_file` — Upload a file to an agent's storage (base64/JSON endpoint)

**Phase 2** (2026-04-02 — Hub agent readiness):
- `list_capabilities` — Structured discovery of all platform capabilities by category
- `write_memory` — Write to an agent's context.md or daily journal
- `get_skill_content` — Read full skill file content (markdown)
- `update_goal` — Modify an existing goal's config without delete+recreate
- `update_cron` — Modify an existing cron's schedule/message without delete+recreate
- `restart_service` — Trigger service restart after config changes
- `get_user_guide` — Full platform user guide as markdown

### Remaining Non-Gaps (1)

| # | Action | API Endpoint | Status | Notes |
|---|--------|-------------|:---:|-------|
| 1 | **SSE stream** | `GET /api/chat/jobs/:jobId/stream` | N/A | Browser-only; MCP uses `get_chat_job_raw` polling instead |

### ✅ Total MCP Tools: **113** | Coverage: **100%** of actionable endpoints + 7 hub-agent-specific tools
