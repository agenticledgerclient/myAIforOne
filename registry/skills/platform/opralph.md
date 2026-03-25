# Ralph Templates Reader

Display available Ralph templates for autonomous AI coding/testing loops.

## Instructions

When this skill is invoked:

1. **Read the README** to show the user an overview:
   ```
   Read: C:\Users\oreph\Documents\AgenticLedger\Custom Applications\RalphTemplates\README.md
   ```

2. **List all available templates** by running:
   ```bash
   ls -la "C:\Users\oreph\Documents\AgenticLedger\Custom Applications\RalphTemplates"
   ```

3. **Present a summary table** to the user showing:
   | Template | Purpose |
   |----------|---------|
   | FullBuildFromScratch | Build entire new app from scratch |
   | NewFeatureExistingApp_FullBuild | Add features to existing codebase |
   | BackEndTest | Comprehensive backend API testing |
   | ClaudeCodeBrowser | Browser UI testing with Claude-in-Chrome |
   | BackEndTest&ClaudeCodeBrowser | Combined backend + browser testing |

4. **Ask the user** which template they want to explore or use

5. **If user selects a template**, read the RALPH_GUIDE.md from that template folder:
   ```
   Read: C:\Users\oreph\Documents\AgenticLedger\Custom Applications\RalphTemplates\RalphTemplate-[Name]\RALPH_GUIDE.md
   ```

## Template Directory

`C:\Users\oreph\Documents\AgenticLedger\Custom Applications\RalphTemplates`

## Quick Reference

- **New project from scratch**: Use `FullBuildFromScratch`
- **Adding features**: Use `NewFeatureExistingApp_FullBuild`
- **Testing existing API**: Use `BackEndTest`
- **Testing existing UI**: Use `ClaudeCodeBrowser`
- **Full test coverage**: Use `BackEndTest&ClaudeCodeBrowser`
