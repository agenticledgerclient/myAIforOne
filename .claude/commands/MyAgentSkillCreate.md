---
name: MyAgentSkillCreate
description: Create skills for the MyAgent platform with proper placement (global, org, agent), optional processing scripts, and registry integration. Use when building reusable skills for agents on this platform.
---

# MyAgent Skill Creator

Create skills for the MyAgent (MyAIforOne) platform. This skill understands the platform's multi-level skill system and ensures skills are properly structured, placed, and discoverable.

## Skill Levels

Skills live at 4 levels. Ask the user which level makes sense:

| Level | Location | Who sees it | When to use |
|-------|----------|-------------|-------------|
| **Global** | `~/.claude/commands/` | All Claude sessions + all agents | Platform utilities, cross-cutting ops |
| **Personal** | `~/Desktop/personalAgents/skills/` | All agents via shared index | User's custom skills not tied to an org |
| **Org-scoped** | `~/Desktop/personalAgents/{OrgName}/skills/` | All agents in that org (auto-discovered, marked ◆) | Domain skills shared within a team/org |
| **Agent-specific** | `~/Desktop/personalAgents/{OrgName}/{agentId}/skills/` or `{agentHome}/skills/` | Only that agent (marked ★) | Highly specific workflows for one agent |

If the user says "for this org" or names an org → **org-scoped**.
If the user says "for this agent" or names an agent → **agent-specific**.
If unclear → ask.

## Skill Structure Convention

Every skill MUST follow this structure:

### Simple skill (instructions only)
```
skills/
└── my_skill.md                    # Skill definition with frontmatter
```

### Skill with processing scripts
```
skills/
├── my_skill.md                    # Skill definition (references scripts)
└── my_skill/                      # Scripts folder (same name as .md, no extension)
    ├── process.py                 # Reusable processing script
    ├── helpers.sh                 # Helper scripts
    └── templates/                 # Templates, configs, etc.
        └── output_template.xlsx
```

**Convention rules:**
- The scripts folder MUST share the exact name as the `.md` file (minus extension)
- Scripts folder lives in the SAME directory as the `.md` file
- Scripts are **permanent and reusable** — never regenerated on each run
- The `.md` file references scripts by **relative path**: `{scripts}/process.py`
- Scripts accept CLI arguments for inputs/outputs — never hardcode paths
- Scripts should be executable and self-contained (include shebangs, dependency checks)

## Frontmatter Format

Every skill `.md` file MUST start with YAML frontmatter:

```yaml
---
name: skill_name_snake_case
description: >-
  One-line description of what this skill does.
  Include WHEN to use it and WHAT triggers it.
scripts: skill_name_snake_case/    # Only if skill has a scripts folder
allowed-tools: Bash Read Write     # Optional: space-separated tool restrictions
---
```

**Rules:**
- `name`: snake_case, matches filename without `.md`
- `description`: Critical — this is what tells Claude WHEN to invoke the skill. Be specific about triggers and use cases. Keep under 200 chars.
- `scripts`: Optional. Relative path to the scripts subfolder. Only include if the skill has processing scripts.
- `allowed-tools`: Optional. Space-separated list of tools the skill needs.

## Creation Process

### Step 1 — Gather Requirements

Ask the user (1-2 questions at a time, be conversational):

1. **What does the skill do?** Get a clear description of the workflow.
2. **Which level?** Global / Org / Agent? If org or agent, which one?
3. **Does it need scripts?** Will it run processing code (Python, shell, Node, etc.)?
4. **What are the inputs/outputs?** Files? User text? API calls?
5. **How is it triggered?** User types a command? Agent auto-detects? Scheduled?

If the user gives everything in one message, skip the conversation and build it.

### Step 2 — Determine Placement

Based on the level chosen:

| Level | Write `.md` to | Write scripts to |
|-------|----------------|-----------------|
| Global | `~/.claude/commands/{name}.md` | `~/.claude/commands/{name}/` |
| Personal | `~/Desktop/personalAgents/skills/{name}.md` | `~/Desktop/personalAgents/skills/{name}/` |
| Org-scoped | `~/Desktop/personalAgents/{OrgName}/skills/{name}.md` | `~/Desktop/personalAgents/{OrgName}/skills/{name}/` |
| Agent-specific | `{agentHome}/skills/{name}.md` | `{agentHome}/skills/{name}/` |

To find an agent's home directory, read config.json:
```bash
cat ~/Desktop/APPs/channelToAgentToClaude/config.json | python3 -c "
import json,sys
c = json.load(sys.stdin)
for aid, a in c.get('agents',{}).items():
    print(f'{aid}: {a.get(\"agentHome\", \"(not set)\")}')"
```

To find an org's agents:
```bash
cat ~/Desktop/APPs/channelToAgentToClaude/config.json | python3 -c "
import json,sys
c = json.load(sys.stdin)
for aid, a in c.get('agents',{}).items():
    orgs = [o['organization'] for o in a.get('org',[])]
    if orgs: print(f'{aid}: {orgs}')"
```

### Step 3 — Write the Skill

1. **Create the `.md` file** with proper frontmatter and clear instructions
2. **If scripts needed:** Create the scripts subfolder and write the script(s)
3. Scripts must:
   - Accept all file paths as CLI arguments (never hardcode)
   - Include a `--help` flag that explains usage
   - Include dependency checks at the top (e.g., `import` guards with helpful error messages)
   - Use `argparse` (Python), `getopts` (bash), or similar for argument parsing
   - Print progress and results to stdout
   - Exit with non-zero code on error

### Step 4 — Wire the Skill to Agent(s)

For **org-scoped** and **global** skills: No config changes needed — they're auto-discovered.

For **agent-specific** skills: Add the skill name to the agent's `agentSkills` array in config.json:
```python
import json
with open('config.json') as f: c = json.load(f)
skills = c['agents']['AGENT_ID'].get('agentSkills', [])
if 'SKILL_NAME' not in skills:
    skills.append('SKILL_NAME')
    c['agents']['AGENT_ID']['agentSkills'] = skills
    with open('config.json', 'w') as f: json.dump(c, f, indent=2)
```

For **shared** skills referenced explicitly: Add to the agent's `skills` array instead.

### Step 5 — Verify

1. Confirm the file exists at the right path
2. Confirm frontmatter parses correctly (name and description present)
3. If scripts exist, confirm the subfolder is named correctly
4. If agent-specific, confirm it's in the agent's config
5. Print summary:
   ```
   Skill Created:
     Name: {name}
     Level: {level}
     Location: {path}
     Scripts: {scripts_path or "none"}
     Discoverable by: {who can see it}
   ```

## Script Conventions (when scripts are needed)

### Python scripts
```python
#!/usr/bin/env python3
"""Short description of what this script does."""
import argparse
import sys

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, help='Path to input file')
    parser.add_argument('--output', required=True, help='Path to output file')
    # ... more args
    args = parser.parse_args()

    # Processing logic here
    print(f"Processing {args.input}...")
    # ...
    print(f"Output written to {args.output}")

if __name__ == '__main__':
    main()
```

### Shell scripts
```bash
#!/usr/bin/env bash
set -euo pipefail

usage() { echo "Usage: $0 --input FILE --output FILE" >&2; exit 1; }

INPUT="" OUTPUT=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --input) INPUT="$2"; shift 2;;
        --output) OUTPUT="$2"; shift 2;;
        --help) usage;;
        *) usage;;
    esac
done

[[ -z "$INPUT" || -z "$OUTPUT" ]] && usage

# Processing logic here
echo "Processing $INPUT..."
echo "Output written to $OUTPUT"
```

### Node.js scripts
```javascript
#!/usr/bin/env node
const { parseArgs } = require('node:util');
const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    output: { type: 'string' },
  }
});
if (!values.input || !values.output) {
  console.error('Usage: node script.js --input FILE --output FILE');
  process.exit(1);
}
// Processing logic here
```

## How the .md References Scripts

In the skill body, reference the script using the `{scripts}` placeholder or the relative path convention:

```markdown
## Execution

Run the processing script:
` ``bash
python3 {skill_dir}/process.py \
  --input "$INPUT_FILE" \
  --output "$OUTPUT_FILE" \
  --date "$(date +%Y-%m-%d)"
` ``

Where `{skill_dir}` is the scripts folder next to this .md file (same name, no extension).
```

Or reference explicitly:
```markdown
The processing script lives at the same level as this file, in the `weekly_wallet_update/` folder.
Run: `python3 /path/to/skills/weekly_wallet_update/process_update.py --mwi INPUT --tres TRESDATA --fb FIREBLOCKS --map TOKENMAP --output OUTPUT`
```

## Examples

### Example: Simple skill (no scripts)
```yaml
---
name: code_review_checklist
description: Run through a standardized code review checklist for PRs. Use when reviewing code changes.
---

# Code Review Checklist

When reviewing code, check each item...
```

### Example: Skill with Python processing script
```yaml
---
name: weekly_wallet_update
description: Weekly update of Total Quantity and Value (USD) in the MWI w Balance tab using TRESDATA and Fireblocks sources.
scripts: weekly_wallet_update/
---

# Weekly Wallet Inventory Update

## Execution

The user will attach 4 files. Run the processing script:

` ``bash
python3 {skill_dir}/process_update.py \
  --mwi "path/to/master_wallet.xlsx" \
  --tresdata "path/to/tresdata.csv" \
  --fireblocks "path/to/fireblocks.csv" \
  --tokenmap "path/to/token_map.csv" \
  --output "path/to/output.xlsx"
` ``

Review the output summary and share results with the user.
```

## Important Notes

- Skills under 500 lines. If longer, split into the `.md` (instructions) and scripts (logic).
- Scripts are the RIGHT place for deterministic processing. The `.md` is for instructions, context, and orchestration.
- Never generate throwaway scripts in FileStorage/Temp. Always use the permanent scripts folder.
- If a skill evolves, update the script in place — it's version-controlled by the folder structure.
- Org-scoped skills are auto-discovered — no config.json changes needed for agents in that org.
