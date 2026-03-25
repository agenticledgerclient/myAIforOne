---
description: Generate SOC1 weekly status report on Notion via Claude.ai MCP
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(python:*), mcp__claude_ai_Notion__*
argument-hint: [optional: dry-run]
---

# Bastion SOC 1 — Status Report

Generate and publish a weekly SOC1 status report to the SOC1 Notion page. Fetches data from Smartsheet DRL, computes metrics, and creates/updates a Notion page via Claude.ai MCP.

## When to Use

- "generate Bastion status report"
- "create SOC1 weekly report"
- "update Bastion status report"
- "refresh SOC1 status"

## Arguments
$ARGUMENTS

- No argument: generate and publish report
- `dry-run`: generate report but only show preview, don't publish

## Skill Files Location
`/Users/oreph/Documents/Orphil LLC/Clients/Bastion/skills/readinesstracker/`

## How to Execute

### Step 1: Run the Status Report Script

```bash
cd "/Users/oreph/Documents/Orphil LLC/Clients/Bastion/skills/readinesstracker"
PYTHONIOENCODING=utf-8 python bastion_status_report.py
```

This will:
- Fetch DRL from Smartsheet
- Compute metrics (unique controls, completion %, evidence breakdown, CO stats, owner stats)
- Generate Notion-flavored Markdown content
- Output `status_report_output.json`

### Step 2: Review the Output

Read `status_report_output.json` and present the summary to the user:
- Total controls, completed count, percentages
- Whether creating new or updating existing page

If argument is `dry-run`, stop here.

### Step 3: Create or Update the Report Page

Read the output JSON and check `existing_page_id`:

**If page exists** (existing_page_id is not empty) — Update using `mcp__claude_ai_Notion__notion-update-page`:
```
page_id: <existing_page_id>
command: "replace_content"
content: <markdown_content from JSON>
```

**If no page exists** — Create using `mcp__claude_ai_Notion__notion-create-pages`:
```
parent: {"page_id": "<parent_page_id from JSON>"}
title: "<page_title from JSON>"
icon: "📈"
content: <markdown_content from JSON>
```

### Step 4: Save Page ID

After creating a new page, save the page ID to `soc1_report_pages.json`:
```json
{
  "YYYY-MM-DD": "<new_page_id>"
}
```

Read the existing file first and merge (don't overwrite previous dates).

## SOC1 Main Page
- Page ID: `2fe311e3-804c-8096-879a-f0e1c1b7ee4e`

## Key Files

| File | Purpose |
|------|---------|
| `bastion_status_report.py` | Data fetch + markdown generation |
| `status_report_output.json` | Generated report content |
| `soc1_report_pages.json` | Date → page ID mapping (dedup) |

## Report Sections

1. Executive Summary (overview, accomplishments, escalations, next steps)
2. Progress by Stage (progress bars for P&P, Design, Follow-Up, Confirm, Testing)
3. Focus on Testing (stats, evidence breakdown, CO table, owner table, pending items)
4. Additional Detail (toggle)
5. Slack Message (toggle with copy-paste message)
