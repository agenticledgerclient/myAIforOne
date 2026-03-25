---
description: Create or update the development log to track session progress and enable continuity
allowed-tools: Read, Write, Edit, Glob, Grep, Task, Bash(git:*)
argument-hint: [project-path]
---

# Development Log Updater

You are tasked with creating or updating a **Development Log** that documents the current session's work and enables the next session to pick up where we left off.

## Target File
- Look for an existing log: `development_log.md`, `DEVELOPMENT_LOG.md`, `dev_log.md`, `DEVLOG.md`
- Check: project root, `docs/` folder
- If none exists, create `development_log.md` in the project root

## Project Path
$ARGUMENTS

If no path provided, use the current working directory.

## Document Structure

The development log MUST follow this structure:

```markdown
# [Project Name] Development Log

## Project Overview
[Brief 2-3 sentence description of the project]

---

## Latest Session: [Date]

### [Feature/Task Name]

[Description of what was done]

**The Feature:** (if applicable)
- Bullet points describing the feature

**Files Created:**
| File | Purpose |
|------|---------|
| `path/to/file.ts` | Description |

**Files Modified:**
| File | Changes |
|------|---------|
| `path/to/file.ts` | What was changed |

**API Endpoints:** (if applicable)
```
GET  /api/endpoint    -> Description
POST /api/endpoint    -> Description
```

**Database Changes:** (if applicable)
```sql
-- New tables or columns
CREATE TABLE example (...)
ALTER TABLE example ADD COLUMN ...
```

**Environment Variables:** (if applicable)
```
NEW_VAR=description
```

---

### [Another Feature/Task]
[Same structure as above]

---

## Session: [Previous Date]

### Features Implemented This Session

#### 1. [Feature Name]
[Details...]

---

## Running the Application

### Start Backend
```bash
cd path/to/backend
npm run dev
```

### Start Frontend
```bash
cd path/to/frontend
npm run dev
```

### URLs
- Frontend: http://localhost:XXXX
- Backend: http://localhost:XXXX

---

## Key Files Reference

### Frontend
| File | Purpose |
|------|---------|
| `path/file` | Description |

### Backend
| File | Purpose |
|------|---------|
| `path/file` | Description |

---

## Database Schema Notes

### Key Tables
- `table_name` - Description

### Important Constraints
- Constraint descriptions

---

## Next Steps / TODO
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

---

## Known Issues
- Issue 1 (if any)
- None currently blocking (if none)

---

## Session History

### [Current Date] (Current)
- **Feature 1** - Brief description
- **Feature 2** - Brief description
- **Bug Fix** - What was fixed

### [Previous Date]
- Previous session summary

### [Earlier Date]
- Earlier session summary
```

## Your Task

1. **Check for existing log**:
   - If exists, read and understand the current state
   - If not, create new with project overview

2. **Review the current session**:
   - Check git status and recent commits: `git status`, `git log --oneline -20`
   - Identify files that were modified/created
   - Understand what features/fixes were implemented

3. **Update the log**:

   **If adding to existing log:**
   - Move previous "Latest Session" content to "Session: [Date]" section
   - Create new "Latest Session: [Today's Date]" at the top
   - Add all work done this session with proper structure
   - Update "Session History" at the bottom
   - Update "Next Steps / TODO" based on current state
   - Update "Known Issues" if any were discovered or fixed

   **If creating new log:**
   - Fill in project overview
   - Document current session's work
   - Set up all sections

4. **Be thorough but scannable**:
   - Use tables for file changes
   - Use code blocks for commands/SQL
   - Include actual file paths
   - Document API endpoints with methods
   - Note any environment variables added

5. **Ensure continuity**:
   - The log should enable someone starting a new session to:
     - Understand what the project does
     - Know what was recently worked on
     - See what's left to do
     - Know how to run the application
     - Find key files quickly

6. **Date format**: Use `Month DD, YYYY` (e.g., `January 8, 2026`)

Start by checking git status and any existing log, then update or create the development log with all current session information.
