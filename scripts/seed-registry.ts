#!/usr/bin/env npx ts-node
/**
 * scripts/seed-registry.ts
 * One-time seed: generates registry/mcps.json, registry/skills.json, registry/agents.json
 * and copies/fetches all source files into registry/skills/
 *
 * Run: npx ts-node scripts/seed-registry.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BASE = join(__dirname, "..");
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
  return id.replace(/_/g, " ").replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
}

function guessCategory(id: string, description: string): string {
  const text = (id + " " + description).toLowerCase();
  if (text.match(/pdf|docx|pptx|xlsx|word|excel|powerpoint/)) return "documents";
  if (text.match(/deploy|railway|mcp|skill|agent|build/)) return "devtools";
  if (text.match(/bastion|soc|audit|compliance/)) return "compliance";
  if (text.match(/test|tdd/)) return "testing";
  if (text.match(/crypto|blockchain|wallet|token/)) return "crypto";
  if (text.match(/slack|telegram|email|calendar/)) return "productivity";
  if (text.match(/frontend|design|ui|css/)) return "design";
  return "general";
}

mkdirSync(join(BASE, "registry", "skills", "platform"), { recursive: true });

const skillEntries: any[] = [];

if (existsSync(COMMANDS_DIR)) {
  const files = readdirSync(COMMANDS_DIR).filter((f: string) => f.endsWith(".md"));
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
} else {
  console.log(`  (no ~/.claude/commands/ found — skipping platform skills)`);
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

// ── 5. Create empty installed-drafts.json if not exists ────────────

const draftsPath = join(BASE, "registry", "installed-drafts.json");
if (!existsSync(draftsPath)) {
  writeFileSync(draftsPath, JSON.stringify({ drafts: [] }, null, 2));
  console.log("✓ registry/installed-drafts.json — created empty");
}

console.log("\n✅ Registry seed complete.");
