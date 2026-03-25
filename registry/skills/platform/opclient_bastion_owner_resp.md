---
description: Generate SOC1 owner responsibility pages on Notion via Claude.ai MCP
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(python:*), mcp__claude_ai_Notion__*
argument-hint: [optional: dry-run]
---

# Bastion SOC 1 — Owner Responsibilities

Generate and publish per-owner responsibility pages to the SOC1 Notion page. Fetches data from Smartsheet DRL, groups by owner, and creates/updates Notion pages via Claude.ai MCP.

## When to Use

- "generate Bastion owner responsibilities"
- "update SOC1 owner pages"
- "refresh owner action items"
- "create owner responsibility pages"

## Arguments
$ARGUMENTS

- No argument: generate and publish pages
- `dry-run`: generate pages but only show preview, don't publish

## Skill Files Location
`C:\Users\oreph\clawd\skills\client-bastion-soc1readinesstracker\`

## How to Execute

### Step 1: Run the Owner Responsibilities Script

```bash
cd "C:/Users/oreph/clawd/skills/client-bastion-soc1readinesstracker"
PYTHONIOENCODING=utf-8 python bastion_owner_resp.py
```

This will:
- Fetch DRL from Smartsheet
- Group controls by owner (4 owners: Vince T/Fab C., Jasmine M., Drew M/Chelsea O., Jameel A.)
- Generate Notion-flavored Markdown content per owner
- Output `owner_resp_output.json`

### Step 2: Review the Output

Read `owner_resp_output.json` and present the summary:
- Per-owner: total controls, completed count
- Whether creating new or updating existing pages

If argument is `dry-run`, stop here.

### Step 3: Create or Update Owner Pages

For each owner in the output JSON:

**If page exists** (`existing_page_id` is not empty) — Update:
```
Use mcp__claude_ai_Notion__notion-update-page:
  page_id: <existing_page_id>
  command: "replace_content"
  content: <markdown_content>
```

**If no page exists** — Create:
```
Use mcp__claude_ai_Notion__notion-create-pages:
  parent: {"page_id": "<parent_page_id>"}
  title: "<page_title>"
  icon: "👤"
  content: <markdown_content>
```

Process all 4 owners.

### Step 4: Save Page IDs

After creating new pages, update `soc1_owner_pages.json`:
```json
{
  "Vince T / Fab C.": "<page_id>",
  "Jasmine M.": "<page_id>",
  "Drew M / Chelsea O.": "<page_id>",
  "Jameel A.": "<page_id>"
}
```

Read the existing file first and merge.

## SOC1 Main Page
- Page ID: `2fe311e3-804c-8096-879a-f0e1c1b7ee4e`

## Owner Mapping

| Control Objectives | Owner |
|--------------------|-------|
| CO 1-4 | Vince T / Fab C. |
| CO 5-7 | Jasmine M. |
| CO 8 | Drew M / Chelsea O. |
| CO 9-14 | Jameel A. |

## Key Files

| File | Purpose |
|------|---------|
| `bastion_owner_resp.py` | Data fetch + markdown generation |
| `owner_resp_output.json` | Generated owner page content |
| `soc1_owner_pages.json` | Owner → page ID mapping (dedup) |

## Owner Page Sections

1. Header callout (owner name, last updated, progress bar)
2. Pending items callout (or "All complete" if done)
3. Action Items table (CO/Ctrl, Control Activity, Action Item, Client Notes, Response)
