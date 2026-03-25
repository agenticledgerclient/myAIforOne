---
description: Generate Bastion SOC 1 readiness dashboard with intelligent analysis and Slack message
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(python:*)
argument-hint: [optional: date in YYYY-MM-DD format]
---

# Bastion SOC 1 Status Report Generator

You are generating a SOC 1 readiness status report for Bastion. This skill analyzes snapshot data and creates an intelligent dashboard with auto-generated insights.

## Prerequisites
Run `/client_bastion_SOC1DataPrep` first if you need fresh data from Smartsheets.

## Project Location
`C:\Users\oreph\Documents\Orphil LLC\Clients\Bastion\Smartsheets`

## Directory Structure
```
Smartsheets/
├── snapshots/           # JSON snapshots by date (e.g., 2026-01-22.json)
├── notes/               # Markdown notes by date (e.g., 2026-01-22.md)
├── output/              # Generated HTML dashboards
├── sync_script.py       # Data sync (run via /client_bastion_SOC1DataPrep)
└── generate_report.py   # Dashboard generator
```

## Arguments
$ARGUMENTS

If a date is provided, use that snapshot. Otherwise, use the most recent snapshot.

## Workflow

### Step 1: Identify Current Snapshot
List available snapshots and select the target:
```bash
dir "C:\Users\oreph\Documents\Orphil LLC\Clients\Bastion\Smartsheets\snapshots"
```

### Step 2: Read and Analyze Snapshot
Read the JSON snapshot file and analyze the data.

**Key Fields in Each Control:**
- `process` - Process area name
- `owner` - Process owner (Vince T, Jameel A, Drew M, Jasmine M)
- `pp_status` - Policy & Procedures status
- `initial_design` - Initial Design status
- `design_followup` - Design Follow Up status
- `soc1_confirm` - SOC 1 Confirm status
- `readiness_test` - Readiness Test status
- `aprio_process_notes` - Auditor notes (contains action items!)

**Status Values:**
- `Completed` - Milestone done
- `Pending or In Progress` - Active work
- `Provided Pending Review` - Submitted to auditor, awaiting review
- `Not Started` - No work begun

### Step 3: Generate Intelligent Analysis

**Status Summary** - For each major process:
- Count controls and their milestone status
- Identify which milestones are complete vs pending
- Note any blocking items

Key processes to highlight:
- **Stable Coin Mint/Redeem** (high control count, usually leading)
- **Logical Access** (largest control count, IT General Controls)
- **Treasury Reconciliation** (financial controls)
- **Freeze/Unfreeze** (may have unassigned controls)
- **Supporting**: Change Mgmt, HR, Monitoring, Incident Response

**Next Steps** - Extract from:
1. `aprio_process_notes` field - contains explicit action items like:
   - "Ore and Ricardo to coordinate and schedule..."
   - "Review prior year SOC 2 report..."
   - "Bastion team reviewing internally..."
2. Logical next actions based on milestone status

**Escalations** - Flag issues:
- Controls with empty `owner` field
- Processes stuck at early stages
- Any concerning patterns

### Step 4: Write Notes File
Create `notes/{date}.md`:

```markdown
# Weekly Notes - {YYYY-MM-DD}

## Status Summary

- **{Process}** ({N} controls): {milestone summary}
- **{Process}** ({N} controls): {milestone summary}
...

**Overall: {X.X}% complete** ({completed}/{total} milestone statuses)

## Next Steps

- {action from aprio_process_notes}
- {logical next action}
...

## Escalations

- **{Issue}** - {impact}
(or "None at this time")

## Meetings / Discussions

- {date}: {meeting note from aprio_process_notes}

## Other Notes

- {N} total controls across {N} process areas
- {N} process owners: {names with control counts}
- {observations about maturity, patterns}
```

### Step 5: Generate Dashboard
```bash
cd "C:\Users\oreph\Documents\Orphil LLC\Clients\Bastion\Smartsheets" && python generate_report.py
```

### Step 6: Read and Display Slack Message
The dashboard generator creates a Slack message. Read the generated HTML or reconstruct from notes to provide a copy-paste ready message.

## Analysis Guidelines

**Process Maturity Indicators:**
| Process | Typical State | Watch For |
|---------|---------------|-----------|
| Mint/Redeem | P&P + Initial done | Design Follow Up scheduling |
| Logical Access | P&P pending review | Large control count, IT dependency |
| Treasury | P&P in review | Internal Bastion review before auditor |
| Freeze/Unfreeze | Initial done | Unassigned controls |
| Supporting (HR, Change, etc.) | Early stages | May need acceleration |

**Common aprio_process_notes Patterns:**
- "coordinate and schedule" → Next Step: Schedule meeting
- "reviewing internally" → Next Step: Complete internal review
- "prior year SOC 2" → Next Step: Review SOC 2 coverage
- "Ore and Ricardo" → Meeting coordination needed

## Output Format

End your response with:

```
---
## Dashboard Generated

**File:** output/soc1_dashboard.html
**Week:** {date}
**Overall Progress:** {X.X}%

### Slack Message (copy below)
```
{full formatted slack message}
```
---
```

This lets the user easily copy the Slack message for sharing.
