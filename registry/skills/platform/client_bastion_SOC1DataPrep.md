---
description: Sync Bastion SOC 1 data from Auditor Smartsheets to Master sheet and create snapshot
allowed-tools: Read, Bash(python:*), Glob
argument-hint: [optional: --dry-run to preview without syncing]
---

# Bastion SOC 1 Data Prep (Smartsheet Sync)

You are running the data preparation step for Bastion's SOC 1 readiness tracking. This syncs data from the Auditor's Smartsheets to Ore's Master sheet.

## Project Location
`C:\Users\oreph\Documents\Orphil LLC\Clients\Bastion\Smartsheets`

## What This Does

The sync_script.py performs these steps:
1. **Fetch** - Pull data from Auditor Sheet 1 (Control Design) and Sheet 2 (Readiness Tracker)
2. **Map** - Build Process → Status mapping from Sheet 2
3. **Sync Controls** - Copy control objectives and activities to Master
4. **Sync Status** - Apply process-level status data to each control row
5. **Format** - Apply color coding (green=Completed, yellow=Pending, orange=Review, gray=Not Started)
6. **Verify** - Check row counts, process distribution, detect any deleted rows
7. **Snapshot** - Save JSON snapshot for reporting

## Arguments
$ARGUMENTS

## Environment
The script requires `SMARTSHEET_API_KEY` environment variable (already configured in the script).

## Workflow

### Step 1: Check Current State
First, list existing snapshots to see what data we have:
```
ls snapshots/
```

### Step 2: Run the Sync
Execute the sync script:
```bash
cd "C:\Users\oreph\Documents\Orphil LLC\Clients\Bastion\Smartsheets" && python sync_script.py
```

### Step 3: Review Output
The script outputs:
- Row counts from each sheet
- Process distribution (how many controls per process)
- Status distribution (Completed, Pending, etc.)
- Deleted row detection (warns if auditor removed rows)
- Verification status (PASSED or NEEDS REVIEW)

### Step 4: Confirm Snapshot Created
After successful sync, confirm the snapshot was saved:
```
ls snapshots/
```

A new file `{today's date}.json` should exist.

## Expected Output

A successful run looks like:
```
==================================================
  SMARTSHEET SOC 1 SYNC
  {date time}
==================================================

STEP 1: Fetching Auditor Data
  Sheet 1 (Control Design): XX rows
  Sheet 2 (Readiness Tracker): XX rows
  Master Sheet: XX rows

STEP 2: Building Process Mapping
  Mapped XX processes
    - Stable Coin Mint Process
    - Stable Coin Redeem Process
    ...

STEP 3: Syncing Control Data
  Updated XX existing rows

STEP 4: Syncing Status Data
  Updated XX rows with status data

STEP 5: Applying Formatting
  Applied colors to XX rows
  Applied text wrap to XX cells

STEP 6: Verification
  Row Counts:
    Auditor Sheet 1: XX
    Master Sheet: XX

  Process Distribution:
    XX - Logical Access
    XX - Stable Coin Mint Process
    ...

  Status: PASSED

==================================================
  SYNC COMPLETE
==================================================
  Status: PASSED
  Master Rows: XX
  Mapped Rows: XX
```

## What Happens Next

After running this DataPrep skill, the user should run:
- `/client_bastion_SOC1Status` - To analyze the snapshot and generate the dashboard

## Troubleshooting

**API Error**: Check that the API key is valid and has access to all three sheets
**Unmapped Rows**: Some controls don't map to a process - may need to update OBJ_TO_PROCESS mapping in script
**Deleted Rows Warning**: Auditor may have removed rows - review manually before deleting from Master

## Output Summary

After running, report:
1. Whether sync passed or needs review
2. Total controls synced
3. Any warnings (deleted rows, unmapped controls)
4. Snapshot file path created
5. Remind user to run `/client_bastion_SOC1Status` next
