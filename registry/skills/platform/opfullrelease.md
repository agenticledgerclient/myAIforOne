---
description: Execute full feature release workflow with documentation, testing, and UI verification
allowed-tools: Read, Write, Edit, Glob, Grep, Task, Bash(git:*), Bash(npm:*), Bash(npx:*), Bash(node:*), Bash(mkdir:*), Bash(ls:*), mcp__claude-in-chrome__tabs_context_mcp, mcp__claude-in-chrome__tabs_create_mcp, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__read_page, mcp__claude-in-chrome__find, mcp__claude-in-chrome__form_input, mcp__claude-in-chrome__computer, mcp__claude-in-chrome__javascript_tool, mcp__claude-in-chrome__get_page_text
argument-hint: [feature-name] [domain]
---

# Full Feature Release Workflow

You are executing a comprehensive feature release workflow that documents, tests, and verifies a newly built feature. This workflow creates a persistent checklist tracker that survives across sessions.

## User Arguments
$ARGUMENTS

If no arguments provided, analyze the codebase context (git status, recent changes) to determine the feature and appropriate domain.

## Phase Overview

This workflow has **4 phases** that must be completed in order:

| Phase | Task | Description |
|-------|------|-------------|
| 1 | **Platform Overview** | Document the feature in the platform overview (domain-based) |
| 2 | **Test Suite** | Add tests to comprehensive test suite (domain-based d1-d11) |
| 3 | **Backend Tests** | Execute backend tests and verify they pass |
| 4 | **Browser Tests** | Start servers, login, and browser-test the UI |

---

## Step 0: Create or Resume Checklist Tracker

### Check for Existing Tracker
Look for `RELEASE_CHECKLIST.md` in the project root. If it exists, read it to understand current progress and resume from where we left off.

### Create New Tracker (if none exists)
Create `RELEASE_CHECKLIST.md` with this structure:

```markdown
# Feature Release Checklist

**Feature:** [Feature Name]
**Domain:** [Domain Number and Name]
**Started:** [Current Date]
**Status:** In Progress

---

## Release Progress

### Phase 1: Platform Overview Documentation
- [ ] Identify target platform overview file
- [ ] Analyze feature for functional documentation
- [ ] Analyze feature for technical documentation
- [ ] Update/create domain section
- [ ] Update cross-domain integration map if needed
- [ ] Increment version and add to recent updates

### Phase 2: Comprehensive Test Suite
- [ ] Identify appropriate domain folder (d1-d11)
- [ ] Create ENDPOINTS.md if not exists
- [ ] Create or update test file ({domain}Endpoints.test.ts)
- [ ] Add test cases for all new endpoints/functionality
- [ ] Register tests in runTests.ts if new suite

### Phase 3: Backend Tests
- [ ] Run the test suite for this domain
- [ ] Verify all tests pass
- [ ] Fix any failing tests
- [ ] Run full regression suite (optional)

### Phase 4: Browser UI Tests
- [ ] Start backend server (port 5000)
- [ ] Start frontend server (if separate)
- [ ] Login as platform_admin (platformadmin@platform.local)
- [ ] Verify feature is accessible
- [ ] Test feature functionality
- [ ] Login as org_admin (orgadmin@platform.local)
- [ ] Test feature from org_admin perspective
- [ ] Document any UI issues found

---

## Session Log

### [Current Date]
- Started release workflow
- [Add progress notes here]

---

## Notes
[Any important observations or decisions]
```

---

## Phase 1: Platform Overview Documentation

### 1.1 Locate Platform Overview
Search for existing platform overview in these locations (in order):
- `platform-definition/00-PLATFORM-OVERVIEW.md`
- `docs/PLATFORM-OVERVIEW.md`
- `PLATFORM-OVERVIEW.md` in project root

If none exists, create `platform-definition/00-PLATFORM-OVERVIEW.md`.

### 1.2 Analyze the Feature
Using git status, recent commits, and code exploration, document:

**For Functional Overview:**
- What capability does this add?
- What user persona benefits?
- What workflow does it enable?

**For Technical Overview:**
- What API endpoints were added?
- What database changes?
- What services/components created?

**For Domain Architecture:**
- Which domain does this belong to? (D1-D11 or new domain)
- What module groups does it add/modify?
- What interfaces does it provide/consume?

### 1.3 Update the Document
Follow the domain-based structure from the reference example:

```markdown
## Domain X: [Domain Name] (DX-SHORTCODE)
**Team Focus:** [What this domain handles]

### Module Groups
- **DX-MG1: [Module Name]** - Description
- **DX-MG2: [Module Name]** - Description

### Ownership Scope
- What this domain owns

### Key Interfaces
- **Provides to [Domain Y]:** What it provides
- **Consumes from [Domain Z]:** What it consumes

### Key Files
| File | Purpose |
|------|---------|
| `path/to/file` | Description |
```

### 1.4 Update Checklist
Mark Phase 1 items as complete in `RELEASE_CHECKLIST.md`.

---

## Phase 2: Comprehensive Test Suite

### 2.1 Determine Domain Folder
Map the feature to the correct domain folder:

| Domain | Folder | Focus Area |
|--------|--------|------------|
| D1 | `d1/` | Core Platform (auth, users, org management) |
| D2 | `d2/` | Agent Intelligence (agent CRUD, lifecycle) |
| D3 | `d3/` | User Interaction (chat, conversations) |
| D4 | `d4/` | Integration Platform (capabilities, MCP) |
| D5 | `d5/` | Distribution Channels (sharing, public agents) |
| D6 | `d6/` | Analytics & Billing (usage, metrics) |
| D7 | `d7/` | Data Processing (pipelines, D7 agents) |
| D8 | `d8/` | Reporting Portal (reports, dashboards) |
| D9 | `d9/` | External Data Sources (data source CRUD) |
| D10 | `d10/` | Autonomous Agents (autonomous features) |
| D11 | `d11/` | Appent (API agents, schema management) |

### 2.2 Create/Update Test Files
Follow the test suite structure:

```
comprehensive-test-suite/
└── dX/
    ├── ENDPOINTS.md           # Document endpoints tested
    └── {domain}Endpoints.test.ts  # Test implementation
```

### 2.3 Test File Template
Use this pattern for test files:

```typescript
/**
 * [Domain] Endpoints Tests
 *
 * Tests the [feature] endpoints:
 * - GET /api/... - Description
 * - POST /api/... - Description
 */

import { TestRunner, TestDataFactory, assert, assertEqual } from '../utils/testRunner';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

export async function run[Domain]Tests(): Promise<void> {
  const runner = new TestRunner('[Domain] Endpoints');
  const factory = new TestDataFactory(BASE_URL);

  try {
    // Setup test data
    await factory.setup();

    // Test 1: [Description]
    await runner.test('[Test Name]', async () => {
      const response = await fetch(`${BASE_URL}/api/endpoint`);
      assertEqual(response.status, 200, 'Should return 200');
      // ... assertions
    });

    // More tests...

  } finally {
    // Cleanup
    await factory.cleanup();
    runner.summary();
  }
}

// Allow direct execution
if (require.main === module) {
  run[Domain]Tests();
}
```

### 2.4 Register in Test Runner
If creating a new test suite, add to `runTests.ts`:

```typescript
import { run[Domain]Tests } from './dX/[domain]Endpoints.test';

const suites: SuiteRunner[] = [
  // ... existing suites
  { name: '[domain]', runner: run[Domain]Tests },
];
```

### 2.5 Update Checklist
Mark Phase 2 items as complete in `RELEASE_CHECKLIST.md`.

---

## Phase 3: Backend Tests

### 3.1 Run Domain Tests
```bash
npx tsx comprehensive-test-suite/runTests.ts --suite=[domain-name]
```

### 3.2 Verify Results
- All tests should pass (✅)
- No skipped tests without good reason
- No failing tests (❌)

### 3.3 Fix Failures
If tests fail:
1. Analyze the error message
2. Determine if it's a test bug or feature bug
3. Fix the issue
4. Re-run tests

### 3.4 Optional: Full Regression
```bash
npx tsx comprehensive-test-suite/runTests.ts
```

### 3.5 Update Checklist
Mark Phase 3 items as complete in `RELEASE_CHECKLIST.md`.

---

## Phase 4: Browser UI Tests

### 4.1 Start Servers
Start the application servers. For AgenticLedger-Prod:

```bash
# Terminal 1: Backend
cd server && npm run dev

# Terminal 2: Frontend (if separate)
cd client && npm run dev
```

Wait for servers to be ready (typically http://localhost:5000).

### 4.2 Login Credentials

**Platform Admin (seed if needed):**
- Email: `platformadmin@platform.local`
- Password: `platformadmin123`
- Role: `platform_admin`

**Organization Admin:**
- Email: `orgadmin@platform.local`
- Password: `orgadmin123`
- Role: `org_admin`

Note: Platform admin may be needed first to create org_admin user.

### 4.3 Browser Test Flow

Use Claude in Chrome browser automation tools:

1. **Get browser context:**
   ```
   mcp__claude-in-chrome__tabs_context_mcp
   ```

2. **Create new tab:**
   ```
   mcp__claude-in-chrome__tabs_create_mcp
   ```

3. **Navigate to app:**
   ```
   mcp__claude-in-chrome__navigate(url: "http://localhost:5000")
   ```

4. **Read page structure:**
   ```
   mcp__claude-in-chrome__read_page(tabId, filter: "interactive")
   ```

5. **Login flow:**
   - Find email input and enter credentials
   - Find password input and enter password
   - Click login button
   - Wait for dashboard to load

6. **Test feature:**
   - Navigate to feature area
   - Verify feature is visible and functional
   - Test key interactions
   - Take screenshots of important states

### 4.4 Test as Both Roles
- First test as `platform_admin` (full access)
- Then test as `org_admin` (typical user)

### 4.5 Document Issues
Record any UI issues in `RELEASE_CHECKLIST.md`:
- Visual bugs
- Broken interactions
- Missing functionality
- Performance issues

### 4.6 Update Checklist
Mark Phase 4 items as complete in `RELEASE_CHECKLIST.md`.

---

## Completion

When all phases are complete:

1. Update `RELEASE_CHECKLIST.md`:
   - Change Status to "Complete"
   - Add completion date
   - Add final notes

2. Summarize to user:
   - What was documented
   - What tests were added
   - Backend test results
   - UI test results
   - Any issues found

3. Suggest next steps:
   - Commit changes
   - Create PR
   - Address any issues found

---

## Resuming an Incomplete Workflow

If `RELEASE_CHECKLIST.md` exists with incomplete items:

1. Read the checklist to understand progress
2. Identify the current phase (first incomplete phase)
3. Resume from the first incomplete item
4. Update checklist as you complete items

The checklist is the source of truth for progress. Always update it as you complete each item.

---

## Error Handling

If you encounter blockers:

1. Document the blocker in the checklist under "Notes"
2. Mark the affected item with `[BLOCKED]` instead of `[ ]`
3. Continue with other items if possible
4. Report blockers to the user with suggestions

---

## Start Execution

Begin by:
1. Checking for existing `RELEASE_CHECKLIST.md`
2. If exists: read and resume
3. If not: analyze codebase, create checklist, start Phase 1

Execute each phase systematically, updating the checklist as you progress.
