#!/usr/bin/env node

/**
 * Comprehensive Test Suite Runner
 * Discovers and runs all test files across domain directories.
 * Usage: node "Comprehensive Test Suite/run-all-tests.js"
 */

import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const suiteDir = __dirname;

function findTestFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findTestFiles(full));
    } else if (entry.endsWith(".test.js") || entry.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

const testFiles = findTestFiles(suiteDir);

if (testFiles.length === 0) {
  console.log("No test files found.");
  process.exit(0);
}

console.log(`\n🧪 Running ${testFiles.length} test file(s)...\n`);

let passed = 0;
let failed = 0;

for (const file of testFiles) {
  const relative = file.replace(suiteDir + "/", "");
  try {
    execSync(`npx tsx --test "${file}"`, {
      cwd: resolve(suiteDir, ".."),
      stdio: "inherit",
      timeout: 30_000,
    });
    passed++;
  } catch (err) {
    failed++;
  }
}

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${testFiles.length} total`);
console.log("=".repeat(50));

process.exit(failed > 0 ? 1 : 0);
