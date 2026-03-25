---
description: Add tests to an existing Comprehensive Test Suite for newly built features
argument-hint: [feature-name or domain]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(mkdir:*), Bash(ls:*), Bash(node:*)
---

# Add to Existing Test Suite

You are adding tests to an existing Comprehensive Test Suite for a feature that was just built.

## Arguments

`$ARGUMENTS` - The feature name or domain area (e.g., "Payments", "UserSettings", "the activity endpoint we just built")

## Your Task

1. **Locate the Existing Test Suite**:
   - Look for `Comprehensive Test Suite` folder in the project
   - Read the existing `README.md` and `TEST_SUITE_PLAN.md` to understand the structure
   - Identify if this is a new domain or addition to existing domain

2. **Understand the New Feature**:
   - If not specified, ask what feature was just built
   - Look at recent code changes or the feature implementation
   - Identify the endpoints/functions that need testing

3. **Create or Update Tests**:

   **If NEW domain area:**
   - Create new folder: `Comprehensive Test Suite/{NewDomain}/`
   - Create `README.md` with domain documentation
   - Create `{domain}-tests.js` with test implementation
   - Update root `README.md` with new domain in structure
   - Update `TEST_SUITE_PLAN.md` with new domain and endpoints
   - Update `run-all-tests.js` to include new test file

   **If EXISTING domain:**
   - Read existing `{domain}-tests.js` to understand patterns
   - Add new test functions for the new endpoints
   - Update the `runTests()` function to include new tests
   - Update domain `README.md` with new endpoints
   - Update root `TEST_SUITE_PLAN.md` if needed

4. **Test Script Pattern**:

   For new test functions, follow this pattern:

   ```javascript
   // Test N: {Feature Name}
   async function test{FeatureName}() {
     log('\n--- Test N: {Feature Name} ({endpoint}) ---', colors.cyan);

     const { status, body, error } = await makeRequest('/api/{endpoint}', {
       method: 'GET', // or POST, PUT, DELETE
       body: { /* request body if needed */ },
     });

     if (error) {
       logResult('{Feature Name}', false, `Error: ${error}`);
       return false;
     }

     if (status !== 200) {
       logResult('HTTP Status 200', false, `Got: ${status}`);
       return false;
     }
     logResult('HTTP Status 200', true);

     // Add specific assertions
     if (body && body.success) {
       logResult('Response has success=true', true);
     }

     return true;
   }
   ```

5. **Update Documentation**:

   Add to domain `README.md`:
   ```markdown
   ## Endpoints Tested

   | Endpoint | Method | Description |
   |----------|--------|-------------|
   | `/api/new-endpoint` | POST | New feature description |
   ```

   Add to `TEST_SUITE_PLAN.md`:
   ```markdown
   | **{Domain}/** | {Description} | `/api/{endpoints}` | ✅ Complete |
   ```

6. **Verify**:
   - Run the new tests to make sure they work
   - Command: `node {domain}-tests.js` from the test suite folder

## Example Flow

User: "Add tests for the payments feature we just built"

1. Find `Comprehensive Test Suite/`
2. Check if `Payments/` exists
3. Look at the payments implementation in the codebase
4. Create or update tests for:
   - POST /api/payments/create
   - GET /api/payments/history
   - etc.
5. Update all documentation
6. Run tests to verify

## Output

After adding tests, summarize:
- What tests were added
- Which files were created/modified
- How to run the new tests
- Current test count for the domain
