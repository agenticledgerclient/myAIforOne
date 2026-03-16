#!/usr/bin/env node
/**
 * Decrypt all MCP key .env.enc files back to .env.
 * Usage: npm run decrypt-keys
 */

import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { decryptDir } from "./keystore.js";

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

  let total = 0;

  // Decrypt shared keys
  const sharedDir = join(baseDir, "data", "mcp-keys");
  if (existsSync(sharedDir)) {
    const count = decryptDir(sharedDir, password);
    total += count;
    console.log(`Shared keys: ${count} files decrypted`);
  }

  // Decrypt agent-level keys
  const personalBase = join(process.env.HOME || process.env.USERPROFILE || "", "Desktop", "personalAgents");
  if (existsSync(personalBase)) {
    const walkDirs = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const mcpKeysDir = join(dir, entry.name, "mcp-keys");
          if (existsSync(mcpKeysDir)) {
            const count = decryptDir(mcpKeysDir, password);
            total += count;
            if (count > 0) console.log(`${entry.name}: ${count} files decrypted`);
          }
          walkDirs(join(dir, entry.name));
        }
      }
    };
    walkDirs(personalBase);
  }

  console.log(`\nDone. ${total} key files decrypted.`);
  rl.close();
}

main().catch(console.error);
