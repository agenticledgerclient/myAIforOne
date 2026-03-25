---
description: "List all available skills with their descriptions, organized by category. Use anytime you want to see what skills you have."
allowed-tools: Glob, Read
argument-hint: "[filter keyword]"
---

# Skills Directory

List all skills with descriptions, organized by category.

## Arguments
$ARGUMENTS
- `filter keyword` (optional) — only show skills matching this keyword (e.g., "mcp", "bastion", "test")

## Workflow

1. Read the skill list from the system context (the available skills list is already loaded)
2. Organize into categories based on prefix/purpose:

### Categories

**App Building (`opappbuild_*`)**
Skills for making projects agent-ready with APIs, docs, MCP, and tests.

**MCP (`opMCP*`)**
Skills for creating, extending, documenting, exposing, and releasing MCP servers.

**Client Work (`opclient_*`, `client_*`)**
Client-specific skills (Bastion SOC 1, P&C visualization, etc.)

**SOPs (`sop_*`)**
Standard operating procedures for file types and workflows (PDF, XLSX, DOCX, PPTX, etc.)

**Railway (`rw_*`)**
Railway deployment and infrastructure management.

**Testing (`optest*`, `opWebapp*`)**
Test creation, test suites, and E2E test factories.

**Dev Workflow (`opbranch*`, `opdevlog`, `opfullrelease`, `opcodereview`, `opSkill*`)**
Git branching, dev logs, releases, code review, skill management.

**Blockchain/Crypto (`allium-*`, `frexplorer`, `lightspark-*`, `wac_*`)**
On-chain data, wallet queries, Lightning Network, crypto accounting.

**Superpowers (`superpowers:*`)**
Meta-skills for planning, debugging, TDD, brainstorming, code review, etc.

**Other**
Everything else (claude-api, references, etc.)

3. Print each category as a section with skill name and one-line description
4. If a filter keyword was provided, only show skills whose name or description matches
5. Print total count at the bottom

## Output Format

```
=== Skills Directory ===

── App Building ──
  /opappbuild_agentready        Master orchestrator: APIs + docs + MCP + MCP docs
  /opappbuild_agentready_trueup Audit API docs, MCP tools, MCP docs gaps
  /opappbuild_testsuite         Set up test infrastructure + CLAUDE.md discipline
  /opappbuild_testsuite_trueup  Audit test coverage gaps

── MCP ──
  /opMCPcreate                  Create production MCP servers
  /opMCPdocs                    Generate MCP tool documentation page
  ...

Total: {N} skills
```

Keep descriptions to ~60 chars max — trim if needed. One line per skill.
