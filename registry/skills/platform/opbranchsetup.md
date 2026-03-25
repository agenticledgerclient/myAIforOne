---
description: Standardize git branch structure to main + Claude_Desktop_Local + Claude_Web_Local. Use when setting up a repo for multi-environment Claude development.
allowed-tools: Bash(git:*), Bash(gh:*)
argument-hint: [project-path]
---

# Git Branch Setup for Claude Development

Standardize any git repository to have exactly 3 branches:

| Branch | Purpose |
|--------|---------|
| `main` | Production (default branch) |
| `Claude_Desktop_Local` | Claude Desktop development |
| `Claude_Web_Local` | Claude Web development |

## Project Path
$ARGUMENTS

If no path provided, use the current working directory.

## Execution Steps

### Step 1: Analyze Current State

Run these commands and display results:

```bash
cd <project-path>
git remote -v
git branch -a -v --no-abbrev
```

Show the user:
- Remote URL
- All branches (local and remote) with their commit hashes

### Step 2: Check Branch Alignment

Compare commit hashes across all branches.

**If all branches are at the same commit:**
- Report: "All branches at same commit - safe to proceed"
- Continue to Step 3

**If branches are at different commits:**
- Show each branch with its date and commit message:
```bash
for branch in $(git branch --format='%(refname:short)'); do
  echo "=== $branch ==="
  git log $branch -1 --format="%h %ad %s" --date=short
done
```
- Ask user: "Branches are at different commits. Which should be the base?"
  - Option 1: Use the latest (show which one)
  - Option 2: Keep main as-is
  - Option 3: User specifies branch name
- If user chooses a non-main branch as base:
  - Stash any uncommitted changes: `git stash push -m "temp stash for branch setup"`
  - Checkout main: `git checkout main`
  - Reset main to chosen branch: `git reset --hard <chosen-branch>`
  - Force push main: `git push origin main --force`
  - Pop stash: `git stash pop` (if stash was created)

### Step 3: Create Target Branches

Check which target branches already exist:

```bash
git branch --list Claude_Desktop_Local Claude_Web_Local
git branch -r --list origin/Claude_Desktop_Local origin/Claude_Web_Local
```

For each missing branch:
```bash
git branch Claude_Desktop_Local  # if doesn't exist locally
git branch Claude_Web_Local      # if doesn't exist locally
git push origin Claude_Desktop_Local Claude_Web_Local
```

### Step 4: Delete Old Branches

Identify branches to delete (anything not in target list):
- Target branches: `main`, `Claude_Desktop_Local`, `Claude_Web_Local`
- Delete list: all other branches

For each branch to delete:

**Local deletion:**
```bash
git branch -D <branch-name>
```

**Remote deletion:**
```bash
git push origin --delete <branch-name>
```

**If remote deletion fails (branch is GitHub default):**
- Inform user: "Branch `<name>` is the GitHub default. Please change it:"
- Provide link: `https://github.com/<owner>/<repo>/settings`
- Wait for user confirmation, then retry deletion

### Step 5: Finalize

```bash
git remote set-head origin main
git fetch --prune
git branch -a
```

### Step 6: Report Final State

Display final state as table:

| Branch | Local | Remote | Notes |
|--------|-------|--------|-------|
| `main` | ✅ | ✅ | Production (default) |
| `Claude_Desktop_Local` | ✅ | ✅ | Claude Desktop |
| `Claude_Web_Local` | ✅ | ✅ | Claude Web |

## Error Handling

### Uncommitted Changes
If `git status` shows uncommitted changes before switching branches:
```bash
git stash push -m "temp stash for branch setup"
# ... do operations ...
git stash pop
```

### Protected Branches
If deletion fails due to branch protection:
- Inform user which branch is protected
- Provide GitHub settings link
- Wait for user to adjust settings

### No Remote
If no remote exists:
- Create branches locally only
- Inform user no remote push was performed

## Summary Template

After completion, provide a summary the user can copy:

```
## Branch Setup Complete: [repo-name]

Remote: [remote-url]

| Branch | Status |
|--------|--------|
| main | ✅ Production |
| Claude_Desktop_Local | ✅ Created |
| Claude_Web_Local | ✅ Created |

Deleted branches: [list or "none"]
```
