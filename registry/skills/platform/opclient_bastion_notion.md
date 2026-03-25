---
description: Generate Bastion SOC 1 readiness dashboard and owner responsibilities in Notion from Smartsheet data
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(python:*), Bash(powershell:*)
argument-hint: [dashboard | owners | both | setup]
---

# Bastion SOC 1 Notion Dashboard Skill

Generate SOC 1 audit status reports in Notion from Smartsheet data.

## When to Use

- "refresh Bastion dashboard" or "update Bastion Notion"
- "refresh Bastion owner responsibilities"
- "setup Bastion dashboard in [client's] Notion"
- "create Bastion SOC 1 reports"

## Required Inputs

### First-Time Setup
User must provide:
1. **Notion Integration Key** — The client's Notion API key (starts with `ntn_` or `secret_`)
2. **Parent Page ID** — The Notion page ID where dashboard will be created

### Subsequent Runs
Config is saved locally — just run the refresh command.

## Arguments
$ARGUMENTS

- `dashboard` — Run weekly status report only
- `owners` — Run owner responsibilities only
- `both` — Run both scripts (default if no argument)
- `setup` — Force re-setup of Notion credentials

## Skill Files Location
`C:\Users\oreph\clawd\skills\client-bastion-notion\`

## How to Execute

### Step 1: Check for existing config
```python
config_path = r"C:\Users\oreph\clawd\skills\client-bastion-notion\bastion_config.json"
```

If config exists with `notion_api_key` and `parent_page_id`, proceed to Step 3.

### Step 2: First-time setup (if no config)
Ask user for:
- Notion Integration Key
- Parent Page ID (from the Notion page URL)

Save to `bastion_config.json`:
```json
{
  "notion_api_key": "ntn_xxx...",
  "parent_page_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

### Step 3: Run the appropriate script

**For weekly status reports (or argument = `dashboard`):**
```powershell
$env:PYTHONIOENCODING="utf-8"
python "C:\Users\oreph\clawd\skills\client-bastion-notion\bastion_dashboard.py"
```

**For owner responsibilities (or argument = `owners`):**
```powershell
$env:PYTHONIOENCODING="utf-8"
python "C:\Users\oreph\clawd\skills\client-bastion-notion\bastion_owner_responsibilities.py"
```

**For both (argument = `both` or no argument):**
Run both scripts in sequence.

## What Gets Created

### Parent Page Structure
```
[Parent Page You Specified]
├── Weekly Reports
│   └── YYYY-MM-DD Status Report
│
├── ─────────── divider ───────────
│
└── Owner Responsibilities
    ├── Vince T / Fab C. Responsibilities
    ├── Jasmine M. Responsibilities
    ├── Drew M / Chelsea O. Responsibilities
    └── Jameel A. Responsibilities
```

### Weekly Report Contents
- Executive Summary (overall %, accomplishments, escalations, next steps)
- Progress by Stage (P&P, Design, Confirm, Testing)
- Focus on Testing (stats, evidence breakdown, CO table, owner table)
- Additional Detail (toggle)
- Slack Message (toggle)

### Owner Responsibility Contents
- Progress header with stats
- Action items table: CO/Ctrl | Control Activity | Action Item | Client Notes | Response

## Data Source

**Smartsheet DRL** (hardcoded — same source always):
- Sheet ID: `8104482672955268`
- API Key: Stored in script

## Owner Mapping

| Control Objectives | Owner |
|--------------------|-------|
| CO 1-4 | Vince T / Fab C. |
| CO 5-7 | Jasmine M. |
| CO 8 | Drew M / Chelsea O. |
| CO 9-14 | Jameel A. |

## Config Files Created

After first run, these are auto-generated in the skill folder:
- `bastion_config.json` — Notion credentials + parent page
- `notion_pages.json` — Created page IDs for weekly reports
- `notion_owner_pages.json` — Created page IDs for owner pages

## Changing Notion Environment

To switch from personal Notion to client Notion:
1. Delete or rename `bastion_config.json`
2. Run refresh command
3. Provide new Notion API key and parent page ID

Or manually edit `bastion_config.json` with new values.

## Troubleshooting

**"Notion API error 401":** Invalid API key — check the integration key
**"Notion API error 404":** Page not found — verify parent page ID and that integration has access
**Script hangs:** Notion API is slow — wait 30-60 seconds
**Encoding errors:** Ensure `$env:PYTHONIOENCODING="utf-8"` is set
