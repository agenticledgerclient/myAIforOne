# /opDeployPaths - Deployment Environments Reference

Reference for the two paired GitHub + Railway deployment environments and their credentials.

## Environment Map

We operate two completely separate deployment environments. Each GitHub account maps 1:1 to a Railway account:

| Environment | GitHub Account | Railway Account |
|-------------|---------------|-----------------|
| **Environment A** | `ore@agenticledger.ai` | `ore@agenticledger.ai` |
| **Environment B** | `oregpt` | `ore.phillips@icloud.com` |

## Credentials

### Environment A — ore@agenticledger.ai

| Service | Token |
|---------|-------|
| GitHub PAT | `ghp_REDACTED` |
| Railway API Token | `6420ab05-a0db-47ce-8fce-7dac088329f1` |

### Environment B — oregpt / ore.phillips@icloud.com

| Service | Token |
|---------|-------|
| GitHub PAT | `ghp_REDACTED` |
| Railway API Token | `15884380-6780-4453-9e21-9e1870b78bcb` |

## Important: Railway CLI Fallback

**The Railway CLI frequently fails or times out.** When this happens, use the Railway REST API directly instead of retrying the CLI.

### Direct API Examples

```bash
# List projects (replace TOKEN with the appropriate Railway API token)
curl -s -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -X POST https://backboard.railway.com/graphql/v2 \
  -d '{"query": "{ me { projects { edges { node { id name } } } } }"}'

# Get services for a project
curl -s -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -X POST https://backboard.railway.com/graphql/v2 \
  -d '{"query": "{ project(id: \"PROJECT_ID\") { services { edges { node { id name } } } } }"}'

# Get deployments for a service
curl -s -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -X POST https://backboard.railway.com/graphql/v2 \
  -d '{"query": "{ deployments(first: 5, input: { serviceId: \"SERVICE_ID\" }) { edges { node { id status } } } }"}'

# Get environment variables
curl -s -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -X POST https://backboard.railway.com/graphql/v2 \
  -d '{"query": "{ variables(projectId: \"PROJECT_ID\", environmentId: \"ENV_ID\", serviceId: \"SERVICE_ID\") }"}'
```

### When to use API vs CLI

| Situation | Use |
|-----------|-----|
| CLI works fine | `railway status`, `railway logs`, `railway up` |
| CLI hangs, times out, or errors | Switch to direct API calls above |
| Need to query across projects | API (CLI is project-scoped) |
| Deploying code | CLI `railway up` or push to GitHub (auto-deploy) |

## Quick CLI Commands (when CLI works)

```bash
# Check status
railway status

# Deploy
railway up

# View logs
railway logs

# Open dashboard
railway open

# Link to a specific project
railway link
```

## Project Inventory

### Environment A — `agenticledger` GitHub (user account)

| Project | Local Path | Repo |
|---------|------------|------|
| AgentHub | `Documents/AgenticLedger/Custom Applications/AgentHub` | `agenticledger/agenticledger_agenthub` |
| ExpertAgent_forFrexplorer | `Documents/AgenticLedger/Custom Applications/ExpertAgent_forFrexplorer` | `agenticledger/ExpertAgent_forFrexplorer` |
| frexplorer | `Documents/AgenticLedger/Custom Applications/frexplorer` | `agenticledger/frexplorer` |
| pl-analyzer | `Documents/AgenticLedger/Custom Applications/p&Lanalyzer` | `agenticledger/pl-analyzer` |

### Environment B — `oregpt` GitHub

**From `clawd/app/`:**

| Project | Local Path | Repo |
|---------|------------|------|
| agenticledger-prod | `clawd/app/agenticledger-prod` | `oregpt/agenticledger-prod` |
| agentic-portal | `clawd/app/agentic-portal` | `oregpt` (recently migrated) |
| finney | `clawd/app/finney` | `oregpt/finneybuilder` |

**From `Documents/AgenticLedger/Custom Applications/`:**

| Project | Local Path | Repo |
|---------|------------|------|
| agenticledger_applets | `Custom Applications/agenticledger_applets` | `oregpt/Agenticledger_applets` |
| AgenticledgerPlatformAuth | `Custom Applications/AgenticledgerPlatformAuth` | `oregpt/agenticledger_platform` |
| AgenticLedgerTrader | `Custom Applications/AgenticLedgerTrader` | `oregpt/agenticledger-trader` |
| AIProjectManager | `Custom Applications/AIProjectManager` | `oregpt/Agenticledger_aiProjectMgr` |
| canton-monitor | `Custom Applications/canton-monitor` | `oregpt/cantaraalert` |
| ComplianceApp | `Custom Applications/ComplianceApp` | `oregpt/complianceapp` |
| EnterpriseWalletManager | `Custom Applications/EnterpriseWalletManager` | `oregpt/enterprisewalletmanager` |
| ExpertAgent_oregpt_temp | `Custom Applications/ExpertAgent_oregpt_temp` | `oregpt/ExpertAgent` |
| FAAMTracker | `Custom Applications/FAAMTracker` | `oregpt/Agenticledger_App_FAAMView` |
| fluxanalyzer | `Custom Applications/fluxanalyzer` | `oregpt` (repo TBD) |

**From `Documents/AgenticLedger/Custom Applications/agentinabox/`:**

| Subfolder | Repo |
|-----------|------|
| expertAgent | `oregpt/ExpertAgent` |
| agentinabox-intellect-eu | `oregpt/agentinabox-intellect-eu` |
| agentaInc_app | `oregpt/agenticledger_agentinabox_demo` |
| agentinabox | `oregpt/agenticledger_agentinabox` |
| agentinabox_platform_admin | `oregpt/agenticledger_agentinabox_platform_administration` |

### Not Deployed / No Git

| Project | Local Path |
|---------|------------|
| task-tracker | `clawd/app/task-tracker` (had stale remote, not a real deploy) |
| Applets | `Custom Applications/Applets` |
| CantondappDocumentation | `Custom Applications/CantondappDocumentation` |
| ccviewAI | `Custom Applications/ccviewAI` |
| chainAnalyzer | `Custom Applications/chainAnalyzer` |
| clawdbot | `Custom Applications/clawdbot` |
| MyQueue | `Custom Applications/MyQueue` |
| Openclaw | `Custom Applications/Openclaw` |
| RalphTemplates | `Custom Applications/RalphTemplates` |
| TOOLS | `Custom Applications/TOOLS` |

## Key Reminder

Always match the right credentials to the right environment. If working on a repo under the `agenticledger` GitHub user account, use Environment A's Railway token. If working under `oregpt` GitHub, use Environment B's Railway token.
