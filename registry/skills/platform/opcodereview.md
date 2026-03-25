---
description: Review all work done in this session for best practices, efficiency, and security
allowed-tools: Read, Glob, Grep, Task
---

# Code Review - Verify All Work

You are performing a thorough code review of all the work done in this conversation/session.

## Your Task

Go back and systematically verify all the code changes, implementations, and modifications made during this session.

## Review Checklist

### 1. Best Coding Practices
- [ ] Code follows consistent naming conventions (camelCase, PascalCase where appropriate)
- [ ] Functions are small, focused, and do one thing well
- [ ] DRY principle followed - no unnecessary code duplication
- [ ] Proper error handling with meaningful error messages
- [ ] Code is readable and self-documenting
- [ ] Comments added only where logic is non-obvious
- [ ] Proper use of async/await patterns (no unhandled promises)
- [ ] Consistent code formatting and indentation
- [ ] No dead code or unused imports left behind
- [ ] TypeScript types are properly defined (if applicable)

### 2. Efficiency
- [ ] No unnecessary loops or iterations
- [ ] Database queries are optimized (no N+1 queries)
- [ ] Appropriate data structures used
- [ ] No memory leaks (event listeners cleaned up, subscriptions unsubscribed)
- [ ] API calls are batched where possible
- [ ] Caching implemented where beneficial
- [ ] No redundant re-renders in frontend code
- [ ] Lazy loading used for heavy components/modules

### 3. Security
- [ ] No hardcoded secrets, API keys, or credentials
- [ ] Input validation on all user inputs
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (proper output encoding)
- [ ] CSRF protection in place
- [ ] Authentication checks on protected routes
- [ ] Authorization checks (users can only access their own data)
- [ ] Sensitive data not logged
- [ ] Rate limiting considered for public endpoints
- [ ] File uploads validated (type, size, content)

### 4. General Quality
- [ ] Edge cases handled
- [ ] Null/undefined checks in place
- [ ] Proper HTTP status codes used
- [ ] API responses have consistent structure
- [ ] Frontend properly handles loading and error states
- [ ] No console.log statements left in production code

## Review Process

1. **Identify All Changes**: Review the conversation history to identify every file that was created or modified.

2. **Read Each File**: For each changed file, read the current state and analyze against the checklist.

3. **Report Issues**: For each issue found, report:
   - File and line number
   - Category (Best Practice / Efficiency / Security)
   - Severity (Critical / Warning / Suggestion)
   - Description of the issue
   - Recommended fix

4. **Summarize**: Provide an overall assessment:
   - Total issues found by category
   - Critical items that must be fixed
   - Overall code quality rating

## Output Format

```
## Code Review Summary

### Files Reviewed
- `path/to/file1.ts` - [status]
- `path/to/file2.ts` - [status]

### Issues Found

#### Critical (Must Fix)
1. **[Security]** `file.ts:42` - SQL injection vulnerability
   - Issue: User input directly concatenated into query
   - Fix: Use parameterized query instead

#### Warnings
1. **[Best Practice]** `file.ts:15` - Function too long
   - Issue: Function is 150 lines, should be broken up
   - Fix: Extract helper functions

#### Suggestions
1. **[Efficiency]** `file.ts:88` - Could use memoization
   - Issue: Expensive calculation repeated on each render
   - Fix: Wrap in useMemo hook

### Overall Assessment
- Best Practices: X/10
- Efficiency: X/10
- Security: X/10
- **Overall: X/10**

### Recommended Actions
1. [List prioritized fixes]
```

## Important

- Be thorough - review EVERY file that was touched
- Be specific - provide exact line numbers and concrete fixes
- Be honest - if the code has issues, report them clearly
- Prioritize security issues above all else
