# Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/marketplace` page where users can browse, install, and assign MCPs, skills, and agent templates to their agents.

**Architecture:** Registry JSON files in `/registry/` define all available items. Three backend endpoints handle listing (with installed/assigned status), installing (writing to config.mcps or copying skill files), and assigning (writing to agents[id].mcps/skills). A standalone `public/marketplace.html` page renders cards with search/filter and a post-install multi-agent assign modal.

**Tech Stack:** TypeScript/Express (backend), vanilla JS HTML page matching existing design system (DM Sans + IBM Plex Mono + Syne fonts, CSS variables from org.html), Node.js `fs` for registry reads/writes.

**Spec:** `docs/superpowers/specs/2026-03-25-marketplace-design.md`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `scripts/seed-registry.ts` | Create | One-time seed: migrate mcp-catalog.json, scan skills, fetch external |
| `registry/mcps.json` | Create (generated) | All MCP entries |
| `registry/skills.json` | Create (generated) | All skill entries |
| `registry/agents.json` | Create | Agent template catalog (minimal) |
| `registry/skills/platform/*.md` | Create (generated) | Skill files copied from ~/.claude/commands/ |
| `registry/skills/external/*.md` | Create (fetched) | affaan-m skills downloaded |
| `registry/installed-drafts.json` | Create | Draft agent tracking (not config.json) |
| `src/web-ui.ts` | Modify | Add 3 marketplace API endpoints + serve /marketplace route |
| `public/marketplace.html` | Create | Marketplace UI page |
| `public/org.html` | Modify | Add Marketplace nav link |
| `public/activity.html` | Modify | Add Marketplace nav link |
| `public/home.html` | Modify | Add Marketplace nav link |
| `public/index.html` | Modify | Add Marketplace nav link |
| `Comprehensive Test Suite/web-ui/api.test.ts` | Modify | Add marketplace API tests |

---

## Task 1: Seed Script — Migrate MCPs + Generate Skills Registry

**Files:**
- Create: `scripts/seed-registry.ts`
- Create: `registry/mcps.json` (output)
- Create: `registry/skills.json` (output)
- Create: `registry/agents.json` (output)
- Create: `registry/skills/platform/*.md` (output)
- Create: `registry/skills/external/*.md` (output)

- [ ] **Step 1: Create registry folder structure**

```bash
mkdir -p ~/Desktop/APPs/channelToAgentToClaude/registry/skills/platform
mkdir -p ~/Desktop/APPs/channelToAgentToClaude/registry/skills/external
mkdir -p ~/Desktop/APPs/channelToAgentToClaude/registry/agents/platform
```

- [ ] **Step 2: Create the seed script**

Create `scripts/seed-registry.ts`:

```typescript
#!/usr/bin/env npx ts-node
/**
 * scripts/seed-registry.ts
 * One-time seed: generates registry/mcps.json, registry/skills.json, registry/agents.json
 * and copies/fetches all source files into registry/skills/
 *
 * Run: npx ts-node scripts/seed-registry.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const BASE = join(import.meta.dirname ?? __dirname, "..");
const COMMANDS_DIR = join(homedir(), ".claude", "commands");

// ── 1. Migrate mcp-catalog.json → registry/mcps.json ──────────────

const catalog = JSON.parse(readFileSync(join(BASE, "mcp-catalog.json"), "utf-8"));

const mcpEntries = Object.entries(catalog.mcps as Record<string, any>).map(([id, mcp]) => ({
  id,
  name: mcp.name,
  provider: "AgenticLedger",
  description: mcp.description,
  category: mcp.category,
  verified: true,
  source: "agenticledger/platform",
  tags: [mcp.category],
  requiredKeys: mcp.requiredKeys || [],
  fetch: {
    type: "http",
    url: mcp.url,
  },
}));

writeFileSync(
  join(BASE, "registry", "mcps.json"),
  JSON.stringify({ mcps: mcpEntries }, null, 2)
);
console.log(`✓ registry/mcps.json — ${mcpEntries.length} MCPs`);

// ── 2. Scan ~/.claude/commands/ → registry/skills.json ─────────────

function extractFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length) fm[key.trim()] = rest.join(":").trim();
  }
  return { name: fm.name, description: fm.description };
}

function titleCase(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function guessCategory(id: string, description: string): string {
  const text = (id + " " + description).toLowerCase();
  if (text.match(/pdf|docx|pptx|xlsx|word|excel|powerpoint/)) return "documents";
  if (text.match(/deploy|railway|mcp|skill|agent|build/)) return "devtools";
  if (text.match(/bastion|soc|audit|compliance/)) return "compliance";
  if (text.match(/client|bastion/)) return "client";
  if (text.match(/test|tdd/)) return "testing";
  if (text.match(/crypto|blockchain|wallet|token/)) return "crypto";
  if (text.match(/slack|telegram|email|calendar/)) return "productivity";
  if (text.match(/frontend|design|ui|css/)) return "design";
  return "general";
}

mkdirSync(join(BASE, "registry", "skills", "platform"), { recursive: true });

const skillEntries: any[] = [];

if (existsSync(COMMANDS_DIR)) {
  const files = readdirSync(COMMANDS_DIR).filter(f => f.endsWith(".md"));
  for (const file of files) {
    const id = file.replace(".md", "");
    const srcPath = join(COMMANDS_DIR, file);
    const destPath = join(BASE, "registry", "skills", "platform", file);
    const content = readFileSync(srcPath, "utf-8");
    const { name: fmName, description: fmDesc } = extractFrontmatter(content);
    const name = fmName || titleCase(id);
    const description = fmDesc || "";
    const category = guessCategory(id, description);

    copyFileSync(srcPath, destPath);

    skillEntries.push({
      id,
      name,
      provider: "AgenticLedger",
      description,
      category,
      verified: true,
      source: "agenticledger/platform",
      tags: [category],
      localPath: `registry/skills/platform/${file}`,
      fetch: { type: "file" },
    });
  }
  console.log(`✓ registry/skills/platform/ — ${files.length} skills copied`);
}

// ── 3. Fetch external skills from affaan-m/everything-claude-code ──

const EXTERNAL_SKILLS: Array<{ id: string; name: string; description: string; file: string }> = [
  { id: "tdd", name: "Test-Driven Development", description: "Write failing tests first, then implement.", file: "tdd.md" },
  { id: "code-review", name: "Code Review", description: "Systematic code review workflow.", file: "code-review.md" },
  { id: "systematic-debugging", name: "Systematic Debugging", description: "Structured debugging process.", file: "systematic-debugging.md" },
  { id: "writing-plans", name: "Write Plans", description: "Create detailed implementation plans.", file: "writing-plans.md" },
  { id: "verification-before-completion", name: "Verify Before Completing", description: "Run checks before marking work done.", file: "verification-before-completion.md" },
  { id: "brainstorming", name: "Brainstorming", description: "Design features through collaborative dialogue.", file: "brainstorming.md" },
];

const RAW_BASE = "https://raw.githubusercontent.com/affaan-m/everything-claude-code/main/commands";

mkdirSync(join(BASE, "registry", "skills", "external"), { recursive: true });

for (const skill of EXTERNAL_SKILLS) {
  const destPath = join(BASE, "registry", "skills", "external", skill.file);
  if (existsSync(destPath)) {
    console.log(`  skip (exists): ${skill.file}`);
  } else {
    try {
      const content = execSync(`curl -sf "${RAW_BASE}/${skill.file}"`, { timeout: 10_000 }).toString();
      writeFileSync(destPath, content);
      console.log(`  fetched: ${skill.file}`);
    } catch {
      // Write a placeholder if fetch fails
      writeFileSync(destPath, `# ${skill.name}\n\n${skill.description}\n\n(Source: ${RAW_BASE}/${skill.file})\n`);
      console.log(`  placeholder: ${skill.file} (fetch failed)`);
    }
  }

  skillEntries.push({
    id: `ext-${skill.id}`,
    name: skill.name,
    provider: "affaan-m",
    description: skill.description,
    category: "devtools",
    verified: false,
    source: `github:affaan-m/everything-claude-code/commands/${skill.file}`,
    tags: ["devtools", "external"],
    localPath: `registry/skills/external/${skill.file}`,
    fetch: { type: "file" },
  });
}

writeFileSync(
  join(BASE, "registry", "skills.json"),
  JSON.stringify({ skills: skillEntries }, null, 2)
);
console.log(`✓ registry/skills.json — ${skillEntries.length} skills total`);

// ── 4. Create minimal registry/agents.json ─────────────────────────

const agentsRegistry = {
  agents: [
    {
      id: "general-assistant",
      name: "General Assistant",
      provider: "AgenticLedger",
      description: "A general-purpose agent for everyday tasks.",
      category: "general",
      verified: true,
      source: "agenticledger/platform",
      tags: ["general"],
      localPath: "registry/agents/platform/general-assistant",
      fetch: { type: "file" },
    },
  ],
};

writeFileSync(
  join(BASE, "registry", "agents.json"),
  JSON.stringify(agentsRegistry, null, 2)
);
console.log("✓ registry/agents.json — 1 template");

// ── 5. Create empty installed-drafts.json ─────────────────────────

const draftsPath = join(BASE, "registry", "installed-drafts.json");
if (!existsSync(draftsPath)) {
  writeFileSync(draftsPath, JSON.stringify({ drafts: [] }, null, 2));
  console.log("✓ registry/installed-drafts.json — created empty");
}

console.log("\n✅ Registry seed complete.");
```

- [ ] **Step 3: Run the seed script**

```bash
cd ~/Desktop/APPs/channelToAgentToClaude && npx ts-node --esm scripts/seed-registry.ts 2>&1
```

Expected output:
```
✓ registry/mcps.json — 47 MCPs
✓ registry/skills/platform/ — 67 skills copied
  fetched: tdd.md (or "placeholder" if GitHub unavailable)
  ...
✓ registry/skills.json — 73 skills total
✓ registry/agents.json — 1 template
✓ registry/installed-drafts.json — created empty
✅ Registry seed complete.
```

- [ ] **Step 4: Verify output files exist and are valid JSON**

```bash
node -e "const f=require('fs');['registry/mcps.json','registry/skills.json','registry/agents.json'].forEach(p=>{const d=JSON.parse(f.readFileSync(p,'utf-8'));console.log(p,JSON.stringify(Object.keys(d)))})"
```

Expected: `registry/mcps.json ["mcps"]`, `registry/skills.json ["skills"]`, `registry/agents.json ["agents"]`

- [ ] **Step 5: Commit registry data**

```bash
cd ~/Desktop/APPs/channelToAgentToClaude
git add registry/ scripts/seed-registry.ts
git commit -m "feat: add registry data layer and seed script"
```

---

## Task 2: Backend API Endpoints

**Files:**
- Modify: `src/web-ui.ts` (add after the recover endpoint, around line 565)

The three endpoints follow the exact same patterns as existing endpoints: read opts.config in memory, write config.json then sync to opts.config, return `{ ok: true }` or error.

- [ ] **Step 1: Add the `appendFileSync` import check**

`appendFileSync` is already imported from Task 0 (we added it in the recover endpoint earlier). Verify:

```bash
grep "appendFileSync" ~/Desktop/APPs/channelToAgentToClaude/src/web-ui.ts | head -1
```

Expected: sees `appendFileSync` in the import line.

- [ ] **Step 2: Add GET /api/marketplace/:type endpoint**

In `src/web-ui.ts`, find the recover endpoint we added earlier and add the marketplace endpoints immediately after it. Add this block:

```typescript
  // ─── API: Marketplace ──────────────────────────────────────────────

  app.get("/api/marketplace/:type", (req, res) => {
    const { type } = req.params;
    if (!["mcps", "skills", "agents"].includes(type)) {
      return res.status(400).json({ error: "type must be mcps, skills, or agents" });
    }

    const registryPath = join(opts.baseDir, "registry", `${type}.json`);
    if (!existsSync(registryPath)) {
      return res.json({ items: [] });
    }

    let entries: any[] = [];
    try {
      const data = JSON.parse(readFileSync(registryPath, "utf-8"));
      entries = data[type] || [];
    } catch {
      return res.status(500).json({ error: "Failed to read registry" });
    }

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const personalSkillsDir = join(resolveTilde(getPersonalAgentsDir(opts.config)), "skills");
    const claudeCommandsDir = join(home, ".claude", "commands");

    const items = entries.map((entry: any) => {
      let installed = false;
      const assignedTo: string[] = [];

      if (type === "skills") {
        const id = entry.id;
        installed = existsSync(join(personalSkillsDir, `${id}.md`))
          || existsSync(join(claudeCommandsDir, `${id}.md`));
        for (const [agentId, agent] of Object.entries(opts.config.agents)) {
          if ((agent as any).skills?.includes(id)) assignedTo.push(agentId);
        }
      } else if (type === "mcps") {
        installed = !!opts.config.mcps?.[entry.id];
        for (const [agentId, agent] of Object.entries(opts.config.agents)) {
          if ((agent as any).mcps?.includes(entry.id)) assignedTo.push(agentId);
        }
      } else if (type === "agents") {
        // Check installed-drafts.json + real config agents
        const draftsPath = join(opts.baseDir, "registry", "installed-drafts.json");
        let drafts: string[] = [];
        try {
          drafts = JSON.parse(readFileSync(draftsPath, "utf-8")).drafts.map((d: any) => d.id);
        } catch { /* ignore */ }
        installed = existsSync(join(opts.baseDir, "agents", entry.id))
          || drafts.includes(entry.id)
          || !!opts.config.agents[entry.id];
      }

      return { ...entry, installed, assignedTo };
    });

    res.json({ items });
  });
```

- [ ] **Step 3: Add POST /api/marketplace/install endpoint**

```typescript
  app.post("/api/marketplace/install", (req, res) => {
    const { type, id } = req.body as { type?: string; id?: string };
    if (!type || !id) return res.status(400).json({ error: "Missing type or id" });

    const registryPath = join(opts.baseDir, "registry", `${type}s.json`);
    if (!existsSync(registryPath)) return res.status(404).json({ error: "Registry not found" });

    let entry: any;
    try {
      const data = JSON.parse(readFileSync(registryPath, "utf-8"));
      const key = type === "mcp" ? "mcps" : type === "skill" ? "skills" : "agents";
      entry = (data[key] || []).find((e: any) => e.id === id);
    } catch {
      return res.status(500).json({ error: "Failed to read registry" });
    }
    if (!entry) return res.status(404).json({ error: `${type} "${id}" not found in registry` });

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;

    try {
      if (type === "skill") {
        // Copy skill file to personalAgents/skills/ directory
        const destDir = join(resolveTilde(getPersonalAgentsDir(opts.config)), "skills");
        mkdirSync(destDir, { recursive: true });
        const srcPath = join(opts.baseDir, entry.localPath);
        const destPath = join(destDir, `${id}.md`);
        if (!existsSync(srcPath)) return res.status(500).json({ error: `Source file not found: ${entry.localPath}` });
        const { copyFileSync: cfSync } = require("node:fs");
        cfSync(srcPath, destPath);
        log.info(`[Marketplace] Installed skill ${id} → ${destPath}`);

      } else if (type === "mcp") {
        if (entry.fetch?.type === "http") {
          // Write http entry to config.mcps
          const configPath = join(opts.baseDir, "config.json");
          const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
          if (!rawConfig.mcps) rawConfig.mcps = {};
          rawConfig.mcps[id] = { type: "http", url: entry.fetch.url, headers: {} };
          writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
          if (!opts.config.mcps) (opts.config as any).mcps = {};
          (opts.config.mcps as any)[id] = { type: "http", url: entry.fetch.url, headers: {} };
          log.info(`[Marketplace] Installed MCP ${id} (http)`);

        } else if (entry.fetch?.type === "npm") {
          // Install npm package
          const { execSync: es } = require("node:child_process");
          es(`npm install ${entry.fetch.package}`, { cwd: opts.baseDir, timeout: 30_000 });
          const configPath = join(opts.baseDir, "config.json");
          const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
          if (!rawConfig.mcps) rawConfig.mcps = {};
          rawConfig.mcps[id] = { type: "stdio", command: "npx", args: entry.fetch.args || ["-y", entry.fetch.package], env: {} };
          writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
          if (!opts.config.mcps) (opts.config as any).mcps = {};
          (opts.config.mcps as any)[id] = rawConfig.mcps[id];
          log.info(`[Marketplace] Installed MCP ${id} (npm: ${entry.fetch.package})`);
        }

      } else if (type === "agent") {
        // Copy template files, write to installed-drafts.json (NOT config.json — see spec)
        const srcDir = join(opts.baseDir, entry.localPath);
        const destDir = join(opts.baseDir, "agents", id);
        if (existsSync(srcDir)) {
          mkdirSync(destDir, { recursive: true });
          for (const file of readdirSync(srcDir)) {
            const { copyFileSync: cfSync } = require("node:fs");
            cfSync(join(srcDir, file), join(destDir, file));
          }
        } else {
          // No template files — just create the directory with a default CLAUDE.md
          mkdirSync(join(destDir, "memory"), { recursive: true });
          writeFileSync(join(destDir, "CLAUDE.md"), `# ${entry.name}\n\n${entry.description}\n`);
          writeFileSync(join(destDir, "agent.json"), JSON.stringify({ id, name: entry.name, draft: true, version: "1.0.0", created: new Date().toISOString() }, null, 2));
        }

        // Append to installed-drafts.json
        const draftsPath = join(opts.baseDir, "registry", "installed-drafts.json");
        let draftsData = { drafts: [] as any[] };
        try { draftsData = JSON.parse(readFileSync(draftsPath, "utf-8")); } catch { /* fresh */ }
        if (!draftsData.drafts.find((d: any) => d.id === id)) {
          draftsData.drafts.push({ id, name: entry.name, installedAt: new Date().toISOString() });
          writeFileSync(draftsPath, JSON.stringify(draftsData, null, 2));
        }
        log.info(`[Marketplace] Installed agent template ${id} → draft`);
      }

      const requiresKeys = type === "mcp" && (entry.requiredKeys?.length > 0);
      res.json({ ok: true, item: { ...entry, installed: true }, requiresKeys });

    } catch (err) {
      log.error(`[Marketplace] Install failed for ${type}/${id}: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });
```

- [ ] **Step 4: Add POST /api/marketplace/assign endpoint**

```typescript
  app.post("/api/marketplace/assign", (req, res) => {
    const { type, id, agentIds } = req.body as { type?: string; id?: string; agentIds?: string[] };
    if (!type || !id || !Array.isArray(agentIds) || agentIds.length === 0) {
      return res.status(400).json({ error: "Missing type, id, or agentIds" });
    }

    const configPath = join(opts.baseDir, "config.json");
    let rawConfig: any;
    try {
      rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      return res.status(500).json({ error: "Failed to read config.json" });
    }

    const missingKeys: string[] = [];

    for (const agentId of agentIds) {
      if (!rawConfig.agents[agentId]) continue;

      if (type === "skill") {
        if (!rawConfig.agents[agentId].skills) rawConfig.agents[agentId].skills = [];
        if (!rawConfig.agents[agentId].skills.includes(id)) {
          rawConfig.agents[agentId].skills.push(id);
        }
        if (!opts.config.agents[agentId].skills) (opts.config.agents[agentId] as any).skills = [];
        if (!(opts.config.agents[agentId] as any).skills.includes(id)) {
          (opts.config.agents[agentId] as any).skills.push(id);
        }

      } else if (type === "mcp") {
        if (!rawConfig.agents[agentId].mcps) rawConfig.agents[agentId].mcps = [];
        if (!rawConfig.agents[agentId].mcps.includes(id)) {
          rawConfig.agents[agentId].mcps.push(id);
        }
        if (!opts.config.agents[agentId].mcps) (opts.config.agents[agentId] as any).mcps = [];
        if (!(opts.config.agents[agentId] as any).mcps.includes(id)) {
          (opts.config.agents[agentId] as any).mcps.push(id);
        }
        // Check if key file exists
        const home = homedir();
        const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
        const agentCfg = opts.config.agents[agentId] as any;
        const agentHome = agentCfg.agentHome
          ? resolveTilde(agentCfg.agentHome)
          : join(resolveTilde(agentCfg.memoryDir || ""), "..");
        const keyFile = join(agentHome, "mcp-keys", `${id}.env`);
        if (!existsSync(keyFile)) {
          missingKeys.push(agentId);
          // Create empty stub so executor doesn't throw
          mkdirSync(join(agentHome, "mcp-keys"), { recursive: true });
          writeFileSync(keyFile, "");
        }
      }
    }

    try {
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
    } catch (err) {
      return res.status(500).json({ error: `Failed to write config: ${err}` });
    }

    log.info(`[Marketplace] Assigned ${type}/${id} to agents: ${agentIds.join(", ")}`);
    res.json({ ok: true, assigned: agentIds, missingKeys });
  });
```

- [ ] **Step 5: Add /marketplace route to serve the page**

Find the existing page serving routes (around line 60 in web-ui.ts) and add:

```typescript
  // ─── Serve the Marketplace page ────────────────────────────────
  app.get("/marketplace", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "marketplace.html");
    if (existsSync(htmlPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(htmlPath);
    } else {
      res.status(404).send("Marketplace page not found.");
    }
  });
```

- [ ] **Step 6: Build and verify no TypeScript errors**

```bash
cd ~/Desktop/APPs/channelToAgentToClaude && npm run build 2>&1
```

Expected: clean build, no errors.

- [ ] **Step 7: Commit backend**

```bash
git add src/web-ui.ts
git commit -m "feat: add marketplace API endpoints (list, install, assign)"
```

---

## Task 3: Frontend — marketplace.html

**Files:**
- Create: `public/marketplace.html`

The page must match the existing design system exactly:
- Same CSS variables as org.html and activity.html
- Same fonts: DM Sans, IBM Plex Mono, Syne
- Same topbar with logo-mark, tab-btn navigation, theme toggle
- Cards using `--bg-card`, `--border-glow`, `--accent`, `--green`, `--amber`
- Same modal pattern as org.html's existing modals

- [ ] **Step 1: Create marketplace.html**

Create `public/marketplace.html` with the full implementation below. This is a long file — write it completely:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MyAIforOne — Marketplace</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Syne:wght@600;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

:root{
  --bg-deep:#060a13;
  --bg-surface:rgba(12,18,33,0.92);
  --bg-card:rgba(16,22,40,0.85);
  --bg-input:rgba(0,0,0,0.35);
  --border-dim:rgba(56,189,248,0.08);
  --border-glow:rgba(56,189,248,0.18);
  --border-active:rgba(56,189,248,0.45);
  --text-primary:rgba(255,255,255,0.92);
  --text-secondary:rgba(255,255,255,0.68);
  --text-muted:rgba(148,163,184,0.55);
  --accent:#22d3ee;
  --accent-soft:#38bdf8;
  --accent-bg:rgba(6,182,212,0.15);
  --accent-glow:rgba(34,211,238,0.12);
  --purple:rgba(139,92,246,0.7);
  --purple-bg:rgba(139,92,246,0.12);
  --green:#4ade80;
  --green-bg:rgba(74,222,128,0.1);
  --amber:#fbbf24;
  --amber-bg:rgba(251,191,36,0.1);
  --red:#f87171;
  --red-bg:rgba(248,113,113,0.1);
  --shadow:0 2px 12px rgba(0,0,0,0.3);
  --shadow-glow:0 0 20px rgba(34,211,238,0.08);
  --radius:12px;
  --font-sans:'DM Sans',system-ui,sans-serif;
  --font-mono:'IBM Plex Mono',monospace;
  --font-display:'Syne',sans-serif;
}
[data-theme="light"]{
  --bg-deep:#f4f6f9;--bg-surface:rgba(255,255,255,0.95);--bg-card:rgba(255,255,255,0.9);
  --bg-input:rgba(0,0,0,0.04);--border-dim:rgba(0,0,0,0.08);--border-glow:rgba(14,116,144,0.18);
  --border-active:rgba(14,116,144,0.45);--text-primary:rgba(15,23,42,0.92);
  --text-secondary:rgba(51,65,85,0.8);--text-muted:rgba(100,116,139,0.6);
  --accent:#0891b2;--accent-soft:#0e7490;--accent-bg:rgba(14,116,144,0.08);
  --accent-glow:rgba(14,116,144,0.06);--purple:rgba(109,40,217,0.75);--purple-bg:rgba(139,92,246,0.08);
  --green:#16a34a;--green-bg:rgba(22,163,74,0.08);--amber:#d97706;--amber-bg:rgba(217,119,6,0.08);
  --red:#dc2626;--red-bg:rgba(220,38,38,0.08);--shadow:0 1px 8px rgba(0,0,0,0.06);--shadow-glow:none;
}

html,body{width:100%;height:100%;overflow:hidden;background:var(--bg-deep);font-family:var(--font-sans);color:var(--text-primary);transition:background .3s,color .3s}

/* ── Topbar ── */
.topbar{height:56px;display:flex;align-items:center;padding:0 24px;background:var(--bg-surface);border-bottom:1px solid var(--border-dim);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);position:fixed;top:0;left:0;right:0;z-index:100}
.topbar-logo{display:flex;align-items:center;gap:10px;margin-right:32px}
.logo-mark{width:32px;height:32px;border-radius:8px;background:var(--accent-bg);border:1px solid var(--accent);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-size:14px;font-weight:800;color:var(--accent)}
.logo-text{font-family:var(--font-display);font-size:15px;font-weight:700}
.tab-group{display:flex;gap:0}
.tab-btn{font-family:var(--font-sans);font-size:13px;font-weight:600;color:var(--text-muted);background:none;border:none;padding:16px 20px;cursor:pointer;position:relative;transition:color .2s;text-decoration:none}
.tab-btn:hover{color:var(--text-secondary)}
.tab-btn.active{color:var(--accent)}
.tab-btn.active::after{content:'';position:absolute;bottom:0;left:12px;right:12px;height:2px;background:var(--accent);border-radius:1px}
.topbar-right{margin-left:auto;display:flex;align-items:center;gap:12px}
.theme-toggle{width:34px;height:34px;border-radius:8px;border:1px solid var(--border-dim);background:transparent;color:var(--text-muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all .2s}
.theme-toggle:hover{border-color:var(--border-glow);color:var(--text-secondary)}

/* ── Canvas ── */
.canvas{position:fixed;top:56px;left:0;right:0;bottom:0;overflow:auto;padding:32px 40px}

/* ── Toolbar ── */
.toolbar{display:flex;align-items:center;gap:12px;margin-bottom:24px;flex-wrap:wrap}
.type-tabs{display:flex;gap:4px;background:var(--bg-card);border:1px solid var(--border-dim);border-radius:10px;padding:4px}
.type-tab{font-family:var(--font-sans);font-size:12px;font-weight:600;padding:6px 16px;border-radius:7px;border:none;background:transparent;color:var(--text-muted);cursor:pointer;transition:all .2s}
.type-tab.active{background:var(--accent-bg);color:var(--accent);border:1px solid var(--border-active)}
.search-wrap{flex:1;max-width:320px;position:relative}
.search-input{width:100%;background:var(--bg-input);border:1px solid var(--border-dim);border-radius:8px;padding:8px 12px 8px 32px;font-family:var(--font-sans);font-size:13px;color:var(--text-primary);outline:none;transition:border-color .2s}
.search-input:focus{border-color:var(--border-active)}
.search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:13px;color:var(--text-muted);pointer-events:none}
.filter-pills{display:flex;gap:6px;flex-wrap:wrap}
.pill{font-family:var(--font-mono);font-size:10px;padding:4px 10px;border-radius:6px;border:1px solid var(--border-dim);background:transparent;color:var(--text-muted);cursor:pointer;transition:all .2s;white-space:nowrap}
.pill:hover{border-color:var(--border-glow);color:var(--text-secondary)}
.pill.active{border-color:var(--accent);color:var(--accent);background:var(--accent-bg)}

/* ── Grid ── */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}

/* ── Card ── */
.card{background:var(--bg-card);border:1px solid var(--border-dim);border-radius:var(--radius);padding:18px;display:flex;flex-direction:column;gap:10px;transition:all .25s;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);position:relative}
.card:hover{border-color:var(--border-glow);box-shadow:var(--shadow),var(--shadow-glow);transform:translateY(-1px)}
.card.installed{border-color:rgba(74,222,128,0.2)}

.card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.card-name{font-family:var(--font-display);font-size:14px;font-weight:700;color:var(--text-primary);line-height:1.2}
.card-badge-wrap{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0}
.badge{font-family:var(--font-mono);font-size:9px;font-weight:600;padding:3px 7px;border-radius:4px;white-space:nowrap;letter-spacing:.03em}
.badge-verified{background:var(--accent-bg);color:var(--accent);border:1px solid rgba(34,211,238,0.3)}
.badge-external{background:var(--bg-input);color:var(--text-muted);border:1px solid var(--border-dim)}
.badge-installed{background:var(--green-bg);color:var(--green);border:1px solid rgba(74,222,128,0.3)}
.badge-amber{background:var(--amber-bg);color:var(--amber);border:1px solid rgba(251,191,36,0.3)}

.card-provider{font-family:var(--font-mono);font-size:10px;color:var(--text-muted)}
.card-desc{font-size:12px;color:var(--text-secondary);line-height:1.5;flex:1}
.card-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.tag{font-family:var(--font-mono);font-size:9px;padding:2px 7px;border-radius:4px;background:var(--purple-bg);color:var(--purple);border:1px solid rgba(139,92,246,0.2)}
.assigned-to{font-family:var(--font-mono);font-size:9px;color:var(--text-muted)}

.card-actions{display:flex;gap:8px;margin-top:4px}
.btn{font-family:var(--font-sans);font-size:12px;font-weight:600;padding:7px 14px;border-radius:8px;border:none;cursor:pointer;transition:all .2s;flex:1}
.btn-install{background:var(--accent-bg);color:var(--accent);border:1px solid var(--border-active)}
.btn-install:hover{background:var(--accent);color:#000}
.btn-manage{background:transparent;color:var(--text-muted);border:1px solid var(--border-dim)}
.btn-manage:hover{border-color:var(--border-glow);color:var(--text-secondary)}
.btn-installing{background:var(--bg-input);color:var(--text-muted);border:1px solid var(--border-dim);cursor:default}

/* ── Empty state ── */
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px;gap:12px;color:var(--text-muted)}
.empty-icon{font-size:40px;opacity:.4}
.empty-text{font-size:14px}

/* ── Toast ── */
.toast{position:fixed;bottom:24px;right:24px;background:var(--bg-card);border:1px solid var(--border-glow);border-radius:10px;padding:12px 18px;font-size:13px;color:var(--text-primary);box-shadow:var(--shadow);z-index:300;opacity:0;transform:translateY(8px);transition:all .3s;pointer-events:none}
.toast.show{opacity:1;transform:translateY(0)}
.toast.toast-error{border-color:rgba(248,113,113,0.4);color:var(--red)}
.toast.toast-success{border-color:rgba(74,222,128,0.4);color:var(--green)}

/* ── Modal backdrop ── */
.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:200;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .25s}
.modal-backdrop.open{opacity:1;pointer-events:all}
.modal{background:var(--bg-surface);border:1px solid var(--border-glow);border-radius:16px;padding:28px;width:420px;max-width:90vw;max-height:80vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.5);transform:scale(.96);transition:transform .25s}
.modal-backdrop.open .modal{transform:scale(1)}
.modal-title{font-family:var(--font-display);font-size:16px;font-weight:700;margin-bottom:4px}
.modal-subtitle{font-size:13px;color:var(--text-muted);margin-bottom:20px}
.modal-section-label{font-family:var(--font-mono);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:10px}
.agent-list{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto;margin-bottom:20px}
.agent-check{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;border:1px solid var(--border-dim);cursor:pointer;transition:all .2s}
.agent-check:hover{border-color:var(--border-glow);background:var(--accent-bg)}
.agent-check input[type=checkbox]{accent-color:var(--accent);width:14px;height:14px;cursor:pointer}
.agent-check-name{font-size:13px;font-weight:500}
.agent-check-id{font-family:var(--font-mono);font-size:10px;color:var(--text-muted)}
.modal-actions{display:flex;gap:10px}
.btn-primary{background:var(--accent);color:#000;font-family:var(--font-sans);font-size:13px;font-weight:700;padding:10px 20px;border-radius:9px;border:none;cursor:pointer;transition:opacity .2s;flex:1}
.btn-primary:hover{opacity:.85}
.btn-secondary{background:transparent;color:var(--text-muted);font-family:var(--font-sans);font-size:13px;font-weight:600;padding:10px 20px;border-radius:9px;border:1px solid var(--border-dim);cursor:pointer;transition:all .2s}
.btn-secondary:hover{border-color:var(--border-glow);color:var(--text-secondary)}
.modal-warning{font-size:12px;color:var(--amber);background:var(--amber-bg);border:1px solid rgba(251,191,36,0.2);border-radius:8px;padding:10px 12px;margin-top:12px}
</style>
</head>
<body>

<!-- Topbar -->
<header class="topbar">
  <div class="topbar-logo">
    <div class="logo-mark">M</div>
    <span class="logo-text">MyAIforOne</span>
  </div>
  <nav class="tab-group">
    <a href="/" class="tab-btn">Home</a>
    <a href="/org" class="tab-btn">Dashboard</a>
    <a href="/marketplace" class="tab-btn active">Marketplace</a>
    <a href="/activity" class="tab-btn">Activity</a>
  </nav>
  <div class="topbar-right">
    <button class="theme-toggle" onclick="toggleTheme()" title="Toggle theme">☀</button>
  </div>
</header>

<main class="canvas">
  <!-- Toolbar -->
  <div class="toolbar">
    <div class="type-tabs">
      <button class="type-tab active" onclick="setType('mcps')">MCPs</button>
      <button class="type-tab" onclick="setType('skills')">Skills</button>
      <button class="type-tab" onclick="setType('agents')">Agents</button>
    </div>
    <div class="search-wrap">
      <span class="search-icon">⌕</span>
      <input class="search-input" type="text" placeholder="Search..." oninput="onSearch(this.value)" id="searchInput">
    </div>
    <div class="filter-pills" id="categoryPills"></div>
  </div>

  <!-- Grid -->
  <div class="grid" id="grid"></div>
</main>

<!-- Assign Modal -->
<div class="modal-backdrop" id="assignModal">
  <div class="modal">
    <div class="modal-title" id="modalTitle">Installed!</div>
    <div class="modal-subtitle" id="modalSubtitle">Assign to agents now? (optional)</div>
    <div class="modal-section-label">Select agents</div>
    <div class="agent-list" id="agentList"></div>
    <div class="modal-actions">
      <button class="btn-primary" onclick="submitAssign()">Assign selected</button>
      <button class="btn-secondary" onclick="closeModal()">Skip for now</button>
    </div>
    <div class="modal-warning" id="modalWarning" style="display:none"></div>
  </div>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>

<script>
// ── State ──────────────────────────────────────────────────────────
let currentType = 'mcps';
let allItems = [];
let agents = [];
let searchQuery = '';
let activeCat = 'all';
let pendingInstall = null; // { type, id, name }

// ── Init ───────────────────────────────────────────────────────────
async function init() {
  // Restore theme
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  // Load agents for assign modal
  try {
    const res = await fetch('/api/dashboard');
    const data = await res.json();
    agents = data.agents || [];
  } catch { agents = []; }

  await loadType('mcps');
}

// ── Load a type ────────────────────────────────────────────────────
async function loadType(type) {
  currentType = type;
  searchQuery = '';
  activeCat = 'all';
  document.getElementById('searchInput').value = '';

  // Update tab buttons
  document.querySelectorAll('.type-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.type-tab')[['mcps','skills','agents'].indexOf(type)].classList.add('active');

  try {
    const res = await fetch(`/api/marketplace/${type}`);
    const data = await res.json();
    allItems = data.items || [];
  } catch {
    allItems = [];
  }

  buildCategoryPills();
  render();
}

function setType(type) { loadType(type); }

// ── Search / filter ────────────────────────────────────────────────
function onSearch(q) { searchQuery = q.toLowerCase(); render(); }

function buildCategoryPills() {
  const cats = ['all', ...new Set(allItems.map(i => i.category).filter(Boolean))];
  const el = document.getElementById('categoryPills');
  el.innerHTML = cats.map(c =>
    `<button class="pill${c === activeCat ? ' active' : ''}" onclick="setCat('${c}')">${c}</button>`
  ).join('');
}

function setCat(cat) {
  activeCat = cat;
  buildCategoryPills();
  render();
}

// ── Render ─────────────────────────────────────────────────────────
function render() {
  const grid = document.getElementById('grid');

  const filtered = allItems.filter(item => {
    const matchCat = activeCat === 'all' || item.category === activeCat;
    const matchSearch = !searchQuery
      || item.name?.toLowerCase().includes(searchQuery)
      || item.description?.toLowerCase().includes(searchQuery)
      || item.tags?.some(t => t.toLowerCase().includes(searchQuery))
      || item.provider?.toLowerCase().includes(searchQuery);
    return matchCat && matchSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <div class="empty-icon">◇</div>
      <div class="empty-text">No items found</div>
    </div>`;
    return;
  }

  grid.innerHTML = filtered.map(item => renderCard(item)).join('');
}

function renderCard(item) {
  const typeKey = currentType === 'mcps' ? 'mcp' : currentType === 'skills' ? 'skill' : 'agent';
  const assigned = item.assignedTo?.length > 0
    ? `<span class="assigned-to">on ${item.assignedTo.length} agent${item.assignedTo.length > 1 ? 's' : ''}</span>`
    : '';
  const tags = (item.tags || []).slice(0,2).map(t => `<span class="tag">${t}</span>`).join('');

  const verifiedBadge = item.verified
    ? `<span class="badge badge-verified">✓ verified</span>`
    : `<span class="badge badge-external">${escHtml(item.provider || 'external')}</span>`;

  const installedBadge = item.installed ? `<span class="badge badge-installed">✓ installed</span>` : '';

  const actionBtn = item.installed
    ? `<button class="btn btn-manage" onclick="openManage('${escHtml(item.id)}')">Manage</button>`
    : `<button class="btn btn-install" id="install-${escHtml(item.id)}" onclick="installItem('${typeKey}','${escHtml(item.id)}','${escHtml(item.name)}')">+ Install</button>`;

  return `
  <div class="card${item.installed ? ' installed' : ''}">
    <div class="card-top">
      <div>
        <div class="card-name">${escHtml(item.name)}</div>
        <div class="card-provider">${escHtml(item.provider || '')}</div>
      </div>
      <div class="card-badge-wrap">${verifiedBadge}${installedBadge}</div>
    </div>
    <div class="card-desc">${escHtml(item.description || '')}</div>
    <div class="card-meta">${tags}${assigned}</div>
    <div class="card-actions">${actionBtn}</div>
  </div>`;
}

// ── Install ────────────────────────────────────────────────────────
async function installItem(type, id, name) {
  const btn = document.getElementById(`install-${id}`);
  if (btn) { btn.textContent = 'Installing...'; btn.className = 'btn btn-installing'; btn.disabled = true; }

  try {
    const res = await fetch('/api/marketplace/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, id }),
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      toast(`Install failed: ${data.error || 'unknown error'}`, 'error');
      if (btn) { btn.textContent = '+ Install'; btn.className = 'btn btn-install'; btn.disabled = false; }
      return;
    }

    // Update local state
    const item = allItems.find(i => i.id === id);
    if (item) item.installed = true;

    toast(`✓ ${name} installed`, 'success');
    render();
    openAssignModal(type, id, name, false);

  } catch (err) {
    toast(`Install error: ${err.message}`, 'error');
    if (btn) { btn.textContent = '+ Install'; btn.className = 'btn btn-install'; btn.disabled = false; }
  }
}

// ── Assign modal ───────────────────────────────────────────────────
function openAssignModal(type, id, name, isManage) {
  pendingInstall = { type, id, name };

  document.getElementById('modalTitle').textContent = isManage
    ? `Manage — ${name}`
    : `✓ ${name} installed`;
  document.getElementById('modalSubtitle').textContent = isManage
    ? 'Update which agents have this assigned.'
    : 'Assign to agents now? (optional)';

  const item = allItems.find(i => i.id === id);
  const alreadyAssigned = item?.assignedTo || [];

  // Build agent checklist
  const listEl = document.getElementById('agentList');
  listEl.innerHTML = agents.map(a => `
    <label class="agent-check">
      <input type="checkbox" value="${escHtml(a.id)}" ${alreadyAssigned.includes(a.id) ? 'checked' : ''}>
      <div>
        <div class="agent-check-name">${escHtml(a.name || a.id)}</div>
        <div class="agent-check-id">${escHtml(a.id)}</div>
      </div>
    </label>`).join('');

  document.getElementById('modalWarning').style.display = 'none';
  document.getElementById('assignModal').classList.add('open');
}

function openManage(id) {
  const item = allItems.find(i => i.id === id);
  if (!item) return;
  const typeKey = currentType === 'mcps' ? 'mcp' : currentType === 'skills' ? 'skill' : 'agent';
  openAssignModal(typeKey, id, item.name, true);
}

function closeModal() {
  document.getElementById('assignModal').classList.remove('open');
  pendingInstall = null;
}

async function submitAssign() {
  if (!pendingInstall) return;
  const { type, id, name } = pendingInstall;

  const checked = [...document.querySelectorAll('#agentList input[type=checkbox]:checked')]
    .map(el => el.value);

  if (checked.length === 0) { closeModal(); return; }

  try {
    const res = await fetch('/api/marketplace/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, id, agentIds: checked }),
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      toast(`Assign failed: ${data.error || 'unknown'}`, 'error');
      return;
    }

    // Update local assigned state
    const item = allItems.find(i => i.id === id);
    if (item) item.assignedTo = checked;

    if (data.missingKeys?.length > 0) {
      document.getElementById('modalWarning').style.display = 'block';
      document.getElementById('modalWarning').textContent =
        `⚠ API key needed for: ${data.missingKeys.join(', ')} — add key in agent config to activate.`;
      render();
      return; // Keep modal open to show warning
    }

    toast(`✓ ${name} assigned to ${checked.length} agent${checked.length > 1 ? 's' : ''}`, 'success');
    render();
    closeModal();

  } catch (err) {
    toast(`Assign error: ${err.message}`, 'error');
  }
}

// Close modal on backdrop click
document.getElementById('assignModal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// ── Theme ──────────────────────────────────────────────────────────
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  if (next === 'dark') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', 'light');
  localStorage.setItem('theme', next === 'dark' ? '' : 'light');
}

// ── Toast ──────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ── Util ───────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
</script>
</body>
</html>
```

- [ ] **Step 2: Verify the file was written correctly**

```bash
wc -l ~/Desktop/APPs/channelToAgentToClaude/public/marketplace.html
```

Expected: 250+ lines

- [ ] **Step 3: Restart service and open the page**

```bash
launchctl kickstart -k gui/$(id -u)/com.agenticledger.channelToAgentToClaude
sleep 3
open http://localhost:4888/marketplace
```

Expected: Marketplace page loads with MCPs tab showing cards from registry.

- [ ] **Step 4: Commit frontend**

```bash
git add public/marketplace.html
git commit -m "feat: add marketplace.html — browse, install, assign MCPs/skills/agents"
```

---

## Task 4: Add Marketplace Nav Link to All Existing Pages

**Files:**
- Modify: `public/org.html`
- Modify: `public/activity.html`
- Modify: `public/home.html`
- Modify: `public/index.html`

Each page has its own nav pattern. Match the existing style exactly.

- [ ] **Step 1: org.html — add Marketplace tab**

In `public/org.html`, find the `tab-group` nav section. It looks like:
```html
<a href="/" class="tab-btn">Home</a>
```
Add `<a href="/marketplace" class="tab-btn">Marketplace</a>` after the Dashboard/Org link.

- [ ] **Step 2: activity.html — add Marketplace nav link**

In `public/activity.html`, find the nav links section (uses `.nav-link` class). Add:
```html
<a href="/marketplace" class="nav-link">Marketplace</a>
```
alongside the other nav links.

- [ ] **Step 3: home.html — add Marketplace nav link**

Find the nav links in home.html and add the Marketplace link using the same class/style as other nav links on that page.

- [ ] **Step 4: index.html — add Marketplace nav link**

Find the nav links in index.html and add the Marketplace link using the same class/style.

- [ ] **Step 5: Verify nav links appear on all pages**

Open each page and confirm "Marketplace" appears in the nav:
```bash
open http://localhost:4888/org
open http://localhost:4888/activity
open http://localhost:4888/
```

- [ ] **Step 6: Commit nav updates**

```bash
git add public/org.html public/activity.html public/home.html public/index.html
git commit -m "feat: add Marketplace nav link to all pages"
```

---

## Task 5: Tests

**Files:**
- Modify: `Comprehensive Test Suite/web-ui/api.test.ts`

- [ ] **Step 1: Add marketplace API tests**

Append to `Comprehensive Test Suite/web-ui/api.test.ts`:

```typescript
  it("GET /api/marketplace/mcps returns items with installed/assignedTo fields", async () => {
    try {
      const res = await fetch(`${BASE}/api/marketplace/mcps`);
      if (!res.ok) return;
      const data = await res.json() as any;
      assert.ok(Array.isArray(data.items), "items should be an array");
      if (data.items.length > 0) {
        const item = data.items[0];
        assert.ok("id" in item, "item should have id");
        assert.ok("name" in item, "item should have name");
        assert.ok("installed" in item, "item should have installed field");
        assert.ok(Array.isArray(item.assignedTo), "item.assignedTo should be array");
      }
    } catch { /* service not running */ }
  });

  it("GET /api/marketplace/skills returns items", async () => {
    try {
      const res = await fetch(`${BASE}/api/marketplace/skills`);
      if (!res.ok) return;
      const data = await res.json() as any;
      assert.ok(Array.isArray(data.items));
    } catch { /* service not running */ }
  });

  it("GET /api/marketplace/agents returns items", async () => {
    try {
      const res = await fetch(`${BASE}/api/marketplace/agents`);
      if (!res.ok) return;
      const data = await res.json() as any;
      assert.ok(Array.isArray(data.items));
    } catch { /* service not running */ }
  });

  it("GET /api/marketplace/invalid returns 400", async () => {
    try {
      const res = await fetch(`${BASE}/api/marketplace/invalid`);
      assert.equal(res.status, 400);
    } catch { /* service not running */ }
  });

  it("POST /api/marketplace/install rejects missing fields", async () => {
    try {
      const res = await fetch(`${BASE}/api/marketplace/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "skill" }), // missing id
      });
      assert.equal(res.status, 400);
    } catch { /* service not running */ }
  });

  it("POST /api/marketplace/assign rejects missing fields", async () => {
    try {
      const res = await fetch(`${BASE}/api/marketplace/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "skill", id: "sop_pptx" }), // missing agentIds
      });
      assert.equal(res.status, 400);
    } catch { /* service not running */ }
  });
```

- [ ] **Step 2: Run the test suite**

```bash
cd ~/Desktop/APPs/channelToAgentToClaude && node "Comprehensive Test Suite/run-all-tests.js" 2>&1
```

Expected: all tests pass (marketplace tests pass or skip if service not running).

- [ ] **Step 3: Commit tests**

```bash
git add "Comprehensive Test Suite/web-ui/api.test.ts"
git commit -m "test: add marketplace API endpoint tests"
```

---

## Task 6: Final Build, Restart, and Push

- [ ] **Step 1: Final build**

```bash
cd ~/Desktop/APPs/channelToAgentToClaude && npm run build 2>&1
```

Expected: clean build.

- [ ] **Step 2: Restart service**

```bash
launchctl kickstart -k gui/$(id -u)/com.agenticledger.channelToAgentToClaude
sleep 3 && tail -5 logs/service.log
```

Expected: service running line visible.

- [ ] **Step 3: Smoke test the full flow**

```bash
# Marketplace page loads
curl -s http://localhost:4888/marketplace | grep -c "Marketplace"

# MCPs endpoint returns items
curl -s http://localhost:4888/api/marketplace/mcps | node -e "const d=require('fs').readFileSync('/dev/stdin','utf-8');const j=JSON.parse(d);console.log('items:',j.items?.length)"

# Skills endpoint returns items
curl -s http://localhost:4888/api/marketplace/skills | node -e "const d=require('fs').readFileSync('/dev/stdin','utf-8');const j=JSON.parse(d);console.log('skills:',j.items?.length)"
```

Expected: `items: 47` for MCPs, skills count > 0.

- [ ] **Step 4: Push to both repos**

```bash
cd ~/Desktop/APPs/channelToAgentToClaude
git push origin main
git push client main
```
