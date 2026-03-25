---
description: "Set up the Comprehensive Test Suite for any project and bake testing discipline into CLAUDE.md. Delegates to /optestcreate for scaffolding, then adds standing orders to CLAUDE.md ensuring tests are created and run after every feature. Use when starting a new project or adding test infrastructure."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent, Skill
argument-hint: "[project path]"
---

# Test Infrastructure Setup

Set up comprehensive test infrastructure and bake testing discipline into the project's CLAUDE.md.

## Arguments
$ARGUMENTS
- `project path` — root of the target project (required)

## Workflow

### Step 1: Discovery
1. Read the project's `CLAUDE.md` and `README.md`
2. Check what test infrastructure already exists:
   - `Comprehensive Test Suite/` directory?
   - `run-all-tests.js`?
   - Any existing test files?
   - Test-related npm scripts in `package.json`?
3. Identify the project's API routes (`server/routes/`) to know what needs test coverage
4. Identify the project's stack for test approach (Express, Next, etc.)

### Step 2: Scaffold Test Suite
**Delegate to `/optestcreate`** — invoke the skill with the project path.

This creates the full Comprehensive Test Suite structure with domain-based organization.

### Step 3: Add CLAUDE.md Standing Orders
Append a concise block to the project's CLAUDE.md. **Keep it short and directive.**

```markdown
## After Every Feature
1. Add tests to `Comprehensive Test Suite/{domain}/`
2. Run all tests: `node "Comprehensive Test Suite/run-all-tests.js"`
3. ALL tests must pass before committing
```

**Rules:**
- If CLAUDE.md already has a similar section, UPDATE it — don't duplicate
- If CLAUDE.md already has a "Testing" or "After Every Feature" section, merge into it
- Never make it longer than 4 lines
- Use imperative voice, no explanations

### Step 4: Verify
Run the completion checklist below.

## Completion Checklist

After all steps, verify each item and report status:

```
[ ] Comprehensive Test Suite/ directory exists
[ ] run-all-tests.js exists and is executable
[ ] At least one domain test file exists per API route group
[ ] package.json has a test script (npm test works)
[ ] CLAUDE.md has "After Every Feature" standing orders
[ ] CLAUDE.md standing orders mention running tests
[ ] Tests actually run without crashing (run them)
[ ] Report: X domain test files covering Y API route groups
```

Print the checklist with pass/fail for each item.
