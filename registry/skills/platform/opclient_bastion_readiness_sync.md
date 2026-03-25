---
description: Sync Bastion SOC 1 Readiness Tracker child controls from Smartsheet DRL to Notion
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(python:*), mcp__claude_ai_Notion__*
argument-hint: [optional: dry-run]
---

# Bastion SOC 1 — Readiness Tracker Full Sync

Incrementally sync ~136 child control rows in the Notion SOC1 Readiness Tracker from the Smartsheet DRL. Detects additions, deletions, status changes, activity text changes, and notes updates.

## When to Use

- "sync Bastion readiness tracker"
- "update Bastion controls from DRL"
- "refresh readiness tracker child controls"
- "full Bastion readiness sync"

## Arguments
$ARGUMENTS

- No argument: run sync and apply changes
- `dry-run`: run sync but only show changeset, don't apply

## Skill Files Location
`C:\Users\oreph\clawd\skills\client-bastion-soc1readinesstracker\`

## How to Execute

### Step 1: Refresh Notion State Cache

Query the Notion tracker view to get current state of all rows:

```
Use mcp__claude_ai_Notion__notion-query-database-view on:
  view://304311e3-804c-8010-9438-000c49520a39

Save all rows (page_id, Process Name, Control #, Readiness Testing, Notes, control_activity)
to: C:\Users\oreph\clawd\skills\client-bastion-soc1readinesstracker\notion_tracker_state.json

Format: JSON array of objects with keys:
  page_id, control_num, process_name, control_activity, readiness_testing, notes, parent_page_id
```

### Step 2: Run the Sync Script

```bash
cd "C:/Users/oreph/clawd/skills/client-bastion-soc1readinesstracker"
PYTHONIOENCODING=utf-8 python bastion_readiness_sync.py
```

This will:
- Fetch DRL from Smartsheet (347 rows → 136 unique controls)
- Compare against Notion state cache
- Skip duplicate activities across COs (same activity, different CO #)
- Output `readiness_changeset.json` with adds/deletes/updates

### Step 3: Review the Changeset

Read `readiness_changeset.json` and present the summary to the user:
- How many adds, deletes, updates, unchanged
- List specific changes

If argument is `dry-run`, stop here.

### Step 4: Apply Changes

For each change in the changeset:

**Updates** — use `mcp__claude_ai_Notion__notion-update-page`:
- `command: "update_properties"`
- Properties: `Readiness Testing`, `Notes`, or `Process Name` (title = activity text)

**Adds** — use `mcp__claude_ai_Notion__notion-create-pages`:
- `parent: {"data_source_id": "304311e3-804c-80d6-881f-000b08f11ecd"}`
- Set `Process Name` (title), `Control #`, `Readiness Testing`
- **CRITICAL**: Set `Process / Objective` relation to parent page URL from `parent_pages.json`

**Deletes** — use `mcp__claude_ai_Notion__notion-update-page` to archive

Batch updates in groups of 5 for efficiency.

### Step 5: Update State Cache

After applying, update `notion_tracker_state.json` to reflect applied changes so the next sync sees the correct baseline.

## Key Files

| File | Purpose |
|------|---------|
| `bastion_readiness_sync.py` | Main sync script |
| `parent_pages.json` | 15 parent process → Notion page ID mapping |
| `notion_tracker_state.json` | Local cache of current Notion rows |
| `readiness_changeset.json` | Output changeset (adds/deletes/updates) |

## Notion Database

- Database ID: `304311e3-804c-8018-b490-d2f2e16659fd`
- Data Source ID: `304311e3-804c-80d6-881f-000b08f11ecd`
- View ID: `view://304311e3-804c-8010-9438-000c49520a39`

## Evidence Status Mapping

| DRL Evidence Status | Notion Readiness Testing |
|---------------------|--------------------------|
| (blank) | Not started |
| Population Pending, Evidence Pending, Sample Selected, etc. | Pending or In Progress |
| Evidence Accepted, Non-Occurrence, N/A, Duplicate | Completed |
| Exception, GAP | Completed with issue |

When multiple DRL rows share the same Control #, worst-status-wins.
