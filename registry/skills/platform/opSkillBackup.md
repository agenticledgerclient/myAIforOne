---
name: opSkillBackup
description: Backup all Claude skills to ClaudeSkillTransfer folder for syncing to another computer. Zips commands/, settings, MCP config, and memory. Logs the backup date.
---

# Skill Backup & Transfer

## What this does
1. Zips all Claude skills and config into a timestamped archive
2. Saves it to `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\ClaudeSkillTransfer\`
3. Updates the transfer log with date, skill count, and file list

## Steps

### Step 1: Create the backup archive

Run this command (replace TIMESTAMP dynamically):

```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DEST="/c/Users/oreph/Documents/AgenticLedger/Custom Applications/ClaudeSkillTransfer"
mkdir -p "$DEST"

# Create the zip with all skills, settings, and config
cd /c/Users/oreph/.claude
tar -czf "$DEST/claude-skills-$TIMESTAMP.tar.gz" \
  commands/ \
  settings.json \
  settings.local.json \
  .mcp.json \
  2>/dev/null

echo "Archive created: claude-skills-$TIMESTAMP.tar.gz"
echo "Skills count: $(find commands/ -name '*.md' | wc -l)"
```

### Step 2: Generate the skill manifest

List all skills included in backup:

```bash
find /c/Users/oreph/.claude/commands -name "*.md" -type f | sort | sed 's|.*/commands/||'
```

### Step 3: Update the transfer log

Append to `TRANSFER_LOG.md` in the destination folder with:
- Date/time of backup
- Number of skills
- Archive filename
- Full list of skills included

Use this format:

```markdown
## Backup: YYYY-MM-DD HH:MM:SS

- **Archive:** `claude-skills-YYYYMMDD_HHMMSS.tar.gz`
- **Skills:** XX files
- **Contents:** commands/, settings.json, settings.local.json, .mcp.json

<details>
<summary>Skills included</summary>

- skill1.md
- skill2.md
...

</details>

---
```

### Step 4: Write agent pickup instructions

Ensure `AGENT_INSTRUCTIONS.md` exists in the destination folder with instructions for the receiving agent. Only create this file if it doesn't already exist.

The instructions should tell the receiving agent:
1. Look for the latest `.tar.gz` file in this folder
2. Extract to `~/.claude/` on the target machine: `tar -xzf <latest-archive>.tar.gz -C ~/.claude/`
3. Verify with: `ls ~/.claude/commands/` to confirm skills are in place
4. The `CLAUDE.md` file in the user's home directory should also be synced separately if needed

### Step 5: Confirm

Report back:
- Archive filename and size
- Number of skills backed up
- Location saved to
- Log entry added
