#!/usr/bin/env node
/**
 * install-mcps.js
 * Runs npm install in each MCP subdirectory under mcps/.
 * Called automatically via the postinstall hook in the root package.json.
 */

import { execSync } from "child_process";
import { readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mcpsRoot = join(__dirname, "..", "mcps");

if (!existsSync(mcpsRoot)) process.exit(0);

const dirs = readdirSync(mcpsRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(mcpsRoot, d.name))
  .filter((d) => existsSync(join(d, "package.json")));

if (dirs.length === 0) process.exit(0);

console.log(`\n📦 Installing MCP dependencies (${dirs.length} MCP${dirs.length > 1 ? "s" : ""})...`);

for (const dir of dirs) {
  const name = dir.split(/[\\/]/).pop();
  try {
    console.log(`  → ${name}`);
    execSync("npm install --prefer-offline --no-audit --no-fund", {
      cwd: dir,
      stdio: "inherit",
      timeout: 120_000,
    });
  } catch (err) {
    console.warn(`  ⚠ ${name} install failed — run manually: cd mcps/${name} && npm install`);
  }
}

console.log("✅ MCP installs complete.\n");
