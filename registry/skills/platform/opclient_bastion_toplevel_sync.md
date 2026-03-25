---
description: Update Bastion SOC 1 Readiness Tracker top-level process pages from Smartsheet DRL
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(python:*), mcp__claude_ai_Notion__*
argument-hint: [optional: dry-run]
---

# Bastion SOC 1 — Top-Level Readiness Update

Quick update of the 15 parent process/objective rows in the Notion SOC1 Readiness Tracker. Pulls directly from DRL — no dependency on child controls in Notion.

## When to Use

- "update Bastion top levels"
- "refresh Bastion readiness top level"
- "quick Bastion readiness sync"
- "update parent processes from DRL"

## Arguments
$ARGUMENTS

- No argument: run sync and apply changes
- `dry-run`: run sync but only show plan, don't apply

## Skill Files Location
`C:\Users\oreph\clawd\skills\client-bastion-soc1readinesstracker\`

## How to Execute

### Step 1: Run the Top-Level Sync Script

```bash
cd "C:/Users/oreph/clawd/skills/client-bastion-soc1readinesstracker"
PYTHONIOENCODING=utf-8 python bastion_toplevel_sync.py
```

This will:
- Fetch DRL from Smartsheet
- Group rows by CO # (CO 1 through CO 14)
- Compute aggregate Readiness Testing status per CO group (worst-status-wins)
- Merge all Client Responses 1 notes per CO group (prefixed with Control #)
- Output `toplevel_changeset.json` with 14 parent page updates

### Step 2: Review the Plan

The script prints a table showing each CO group, its aggregate status, and whether it has notes. Present this to the user.

If argument is `dry-run`, stop here.

### Step 3: Apply Updates

For each update in `toplevel_changeset.json`, use `mcp__claude_ai_Notion__notion-update-page`:

```
page_id: <from changeset>
command: "update_properties"
properties: {
  "Readiness Testing": "<aggregate status>",
  "Notes": "<merged notes or omit if empty>"
}
```

Batch in groups of 5 for efficiency.

## What Gets Updated

Only 2 properties on the 15 parent process pages:

| Property | Source | Logic |
|----------|--------|-------|
| **Readiness Testing** | DRL Evidence Status | Worst-status-wins across all child rows in the CO group |
| **Notes** | DRL Client Responses 1 | All non-empty values merged, prefixed with Control # |

All other properties (Policy & Procedures, Initial Design Discussion, Design Follow-Up, Control Confirmation) are left untouched.

## Key Files

| File | Purpose |
|------|---------|
| `bastion_toplevel_sync.py` | Top-level sync script |
| `parent_pages.json` | 15 parent process → Notion page ID mapping |
| `toplevel_changeset.json` | Output update plan |

## CO → Process Mapping

| CO | Process | Parent Page ID |
|----|---------|---------------|
| CO 1 | Partner Mints Stablecoin | 317311e3-804c-81c7-... |
| CO 2 | Customer Redeems Stablecoin | 317311e3-804c-816f-... |
| CO 3 | Post-Mint and Post Redemption Verification | 317311e3-804c-8106-... |
| CO 4 | Monthly Treasury Reconciliation | 317311e3-804c-8144-... |
| CO 5 | Compliance Checks | 317311e3-804c-81d2-... |
| CO 6 | Stablecoin freeze and unfreeze | 317311e3-804c-8174-... |
| CO 7 | Stablecoin Seizure | 317311e3-804c-817d-... |
| CO 8 | New Hire and Employee Compliance | 317311e3-804c-81aa-... |
| CO 9 | Logical Access | 317311e3-804c-8150-... |
| CO 10 | Backup and Recovery | 317311e3-804c-814e-... |
| CO 11 | Monitoring | 317311e3-804c-8161-... |
| CO 12 | Risk Management | 317311e3-804c-8133-... |
| CO 13 | Change Management | 317311e3-804c-81c3-... |
| CO 14 | Third-Party Management | 317311e3-804c-81e4-... |

Note: "Stablecoin seizure process" (15th parent) has no matching CO group in the DRL.
