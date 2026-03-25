---
description: Intake meeting transcript or adhoc note and update Bastion SOC 1 live updates
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
argument-hint: <paste meeting overview/transcript OR adhoc note>
---

# Bastion Notes Intake

Intake meeting transcripts, overviews, or adhoc notes and update the weekly live updates file.

## Project Location
`C:\Users\oreph\Documents\Orphil LLC\Clients\Bastion\Smartsheets`

## Directory Structure
```
Smartsheets/
├── meeting_transcripts/     # Raw meeting transcripts & overviews
├── adhoc_updates/           # Random notes, reminders, quick updates
├── live_updates/            # Weekly working docs (WE_YYYY-MM-DD.md)
│   └── WE_2026-01-24.md     # Week ending Friday
└── notes/                   # Official finalized notes
```

## Input
$ARGUMENTS

## Workflow

### Step 1: Determine Input Type

Analyze the provided content to classify it:

**Meeting Transcript/Overview** if it contains:
- Meeting title, date, participants
- Transcript text or structured overview
- Action items from a meeting
- Reference to a call/meeting

**Adhoc Update** if it contains:
- Quick note or reminder
- Status update without meeting context
- Random thought or decision to capture
- Short update (no transcript)

### Step 2: Calculate Week-Ending Date

Week ends **Friday**. Calculate the Friday of the current week:
- If today is Mon-Fri → use this Friday
- If today is Sat-Sun → use next Friday

### Step 3: Save Raw Content

**For Meeting:**
Save to `meeting_transcripts/{date}_{title-slug}.md`:
```markdown
# {Meeting Title}

**Date:** {date}
**Participants:** {names}
**Source:** {link if provided}

---

## Overview
{overview content}

---

## Transcript
{transcript if provided}
```

**For Adhoc:**
Save to `adhoc_updates/{date}_{short-title}.md`:
```markdown
# {Short Title}

**Date:** {date}

---

{content}
```

### Step 4: Parse Content

Extract from the input:
- **Completed items** - things that were done/resolved
- **New action items** - tasks assigned (note owner: Ore, Aprio, Bastion, etc.)
- **Decisions/changes** - what was decided or changed
- **Escalations** - blockers, issues, concerns
- **Scheduled meetings** - any new meetings scheduled
- **Key dates** - deadlines, milestones

### Step 5: Update Live Updates File

Open `live_updates/WE_{friday-date}.md` and append to the appropriate sections:

| Section | What to Add |
|---------|-------------|
| Completed This Week | Items marked done in the meeting |
| Open Action Items | New tasks with owner and due date |
| Escalations | New blockers or issues |
| Decisions & Changes | Key decisions made |
| Scheduled Meetings | New meetings scheduled |
| Meetings Log | Entry for this meeting (if meeting) |
| Adhoc Notes | Entry for this note (if adhoc) |
| Quick Reference | Update focus/key dates if relevant |

**Important:**
- Add new rows to tables, don't replace existing content
- Use today's date (1/22 format) for the Date column
- Keep tables properly formatted

### Step 6: Confirm

Output summary:
```
---
## Notes Intake Complete

**Type:** Meeting / Adhoc
**Saved to:** {path to raw file}
**Week:** WE_{friday-date}

### Added to Live Updates:
- Completed: {count} items
- Open Actions: {count} items
- Decisions: {count} items
- Escalations: {count} items
- Meetings Scheduled: {count}

### Quick View - Open Action Items:
{list current open action items from live_updates}
---
```

## Live Updates Format Reference

The live updates file has these queryable sections:

```markdown
## Completed This Week        ← "What was accomplished?"
## Open Action Items          ← "What's pending?"
## Escalations                ← "Any blockers?"
## Decisions & Changes        ← "What changed?"
## Scheduled Meetings         ← "What's coming up?"
## Meetings Log               ← "What meetings happened?"
## Adhoc Notes                ← "Any random notes?"
## Quick Reference            ← "What's the focus?"
```

## Examples

**User asks:** "What action items are open?"
→ Read `## Open Action Items` section

**User asks:** "What was completed this week?"
→ Read `## Completed This Week` section

**User asks:** "Any escalations?"
→ Read `## Escalations` section
