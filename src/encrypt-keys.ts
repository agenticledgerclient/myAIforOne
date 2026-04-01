#!/usr/bin/env node
/**
 * Encrypt all MCP key .env files.
 * Usage: npm run encrypt-keys
 * Prompts for master password, encrypts all .env → .env.enc
 */

import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { encryptDir } from "./keystore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = resolve(__dirname, "..");

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

  const password = await ask("Master password: ");
  if (!password) {
    console.log("No password provided. Aborting.");
    rl.close();
    return;
  }

  const confirm = await ask("Confirm password: ");
  if (password !== confirm) {
    console.log("Passwords don't match. Aborting.");
    rl.close();
    return;
  }

  let total = 0;

  // Encrypt shared keys
  const sharedDir = join(baseDir, "data", "mcp-keys");
  if (existsSync(sharedDir)) {
    const count = encryptDir(sharedDir, password);
    total += count;
    console.log(`Shared keys: ${count} files encrypted`);
  }

  // Encrypt agent-level keys
  const personalBase = join(process.env.HOME || process.env.USERPROFILE || "", "Desktop", "MyAIforOne Drive", "PersonalAgents");
  if (existsSync(personalBase)) {
    const walkDirs = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const mcpKeysDir = join(dir, entry.name, "mcp-keys");
          if (existsSync(mcpKeysDir)) {
            const count = encryptDir(mcpKeysDir, password);
            total += count;
            if (count > 0) console.log(`${entry.name}: ${count} files encrypted`);
          }
          // Recurse into org folders
          walkDirs(join(dir, entry.name));
        }
      }
    };
    walkDirs(personalBase);
  }

  console.log(`\nDone. ${total} key files encrypted.`);
  console.log("Original .env files replaced with stubs. Encrypted data in .env.enc files.");
  rl.close();
}

main().catch(console.error);
