---
description: Create a comprehensive test suite structure for the current project with domain-based organization
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(mkdir:*), Bash(ls:*)
---

# Create Comprehensive Test Suite

You are creating a comprehensive test suite structure for regression testing this application.

## Your Task

1. **Analyze the Codebase**:
   - Identify the key domain areas (e.g., Auth, Users, API endpoints, Services, etc.)
   - Look at the routes, services, and major components
   - Understand what functionality needs testing

2. **Create the Test Suite Structure**:
   Create a folder called `Comprehensive Test Suite` (or use `$ARGUMENTS` if specified) at the project root with:

   ```
   Comprehensive Test Suite/
   ├── README.md                  # Overview, quick start, structure
   ├── TEST_SUITE_PLAN.md         # Full test plan with priorities and endpoints
   ├── run-all-tests.js           # Master test runner
   │
   ├── {Domain1}/                 # One folder per domain area
   │   ├── README.md              # Domain-specific test docs
   │   └── {domain1}-tests.js     # Node.js test script
   │
   ├── {Domain2}/
   │   ├── README.md
   │   └── {domain2}-tests.js
   │
   └── ... (more domains as needed)
   ```

3. **For Each Domain Folder**, create:

   **README.md** containing:
   - Description of what this domain tests
   - Endpoints/functions tested (table format)
   - Backend route file location
   - How to run the tests
   - Expected results
   - Sample test data
   - Troubleshooting section

   **{domain}-tests.js** containing:
   - Configuration section (BASE_URL, SESSION_ID if applicable)
   - Test functions for each endpoint/feature
   - Color-coded console output (green=pass, red=fail)
   - Main test runner with summary

4. **Root Files**:

   **README.md**: Overall test suite documentation with:
   - Quick start command
   - Full structure tree
   - Prerequisites
   - Test categories with status table
   - How to run all tests
   - How to add new tests

   **TEST_SUITE_PLAN.md**: Comprehensive test plan with:
   - Priority levels (P1=Critical, P2=Important, P3=Standard)
   - Test suite structure table
   - Implementation phases
   - Test script standards/template
   - Endpoint summary by area

   **run-all-tests.js**: Master runner that:
   - Runs all domain test files
   - Shows progress
   - Collects and displays summary
   - Uses configurable delays between suites

## Test Script Template

Use this pattern for test files:

```javascript
/**
 * {Domain} Tests - Node.js Test Script
 *
 * Tests the {Domain} endpoints:
 * - GET /api/... - Description
 * - POST /api/... - Description
 *
 * Usage: node {domain}-tests.js
 */

const CONFIG = {
  BASE_URL: process.env.BASE_URL || 'http://localhost:5000',
  SESSION_ID: 'your-session-id', // Update as needed
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(message, color = '') {
  console.log(`${color}${message}${colors.reset}`);
}

function logResult(testName, passed, details = '') {
  const status = passed ? `${colors.green}✓ PASS` : `${colors.red}✗ FAIL`;
  log(`${status}${colors.reset} ${testName}`);
  if (details) console.log(`  ${details}`);
}

async function makeRequest(endpoint, options = {}) {
  const url = `${CONFIG.BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'x-session-id': CONFIG.SESSION_ID,
    ...options.headers,
  };

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body, error: null };
  } catch (error) {
    return { status: null, body: null, error: error.message };
  }
}

// Test functions here...
async function testExample() {
  log('\n--- Test: Example ---', colors.cyan);
  // Implementation
}

// Main runner
async function runTests() {
  log('\n========================================', colors.bold);
  log('  {DOMAIN} ENDPOINT TESTS', colors.bold);
  log('========================================', colors.bold);

  const results = {};

  try {
    results.example = await testExample();
    // Add more tests
  } catch (error) {
    log(`\n${colors.red}Unexpected error: ${error.message}${colors.reset}`);
  }

  // Summary
  log('\n========================================', colors.bold);
  log('  TEST SUMMARY', colors.bold);
  log('========================================', colors.bold);

  const passedCount = Object.values(results).filter(Boolean).length;
  const totalCount = Object.keys(results).length;

  for (const [name, passed] of Object.entries(results)) {
    const status = passed ? `${colors.green}PASS` : `${colors.red}FAIL`;
    log(`  ${status}${colors.reset} - ${name}`);
  }

  log(`\n  Total: ${passedCount}/${totalCount} tests passed`);
  process.exit(passedCount === totalCount ? 0 : 1);
}

runTests();
```

## Instructions

1. First explore the codebase to identify domains
2. Create the folder structure
3. Generate all files with appropriate content
4. Inform the user what was created and how to run the tests

Focus on API endpoints and key functionality. Make the tests practical and runnable.
