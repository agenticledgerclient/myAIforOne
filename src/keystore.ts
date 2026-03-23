/**
 * Keystore — encrypt/decrypt MCP API key files.
 * Uses AES-256-GCM with a master password.
 * Encrypted files have .env.enc extension, plain files have .env extension.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getPersonalAgentsDir } from "./config.js";
import { log } from "./logger.js";

const ALGORITHM = "aes-256-gcm";
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const HEADER = "MYAGENT_ENC_V1"; // magic header to identify encrypted files

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LEN);
}

export function encryptString(plaintext: string, password: string): Buffer {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(password, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: HEADER + salt(16) + iv(12) + tag(16) + ciphertext
  const headerBuf = Buffer.from(HEADER, "utf-8");
  return Buffer.concat([headerBuf, salt, iv, tag, encrypted]);
}

export function decryptString(data: Buffer, password: string): string {
  const headerBuf = Buffer.from(HEADER, "utf-8");
  const headerLen = headerBuf.length;

  // Verify header
  if (data.subarray(0, headerLen).toString("utf-8") !== HEADER) {
    throw new Error("Not an encrypted keystore file");
  }

  let offset = headerLen;
  const salt = data.subarray(offset, offset + SALT_LEN); offset += SALT_LEN;
  const iv = data.subarray(offset, offset + IV_LEN); offset += IV_LEN;
  const tag = data.subarray(offset, offset + TAG_LEN); offset += TAG_LEN;
  const ciphertext = data.subarray(offset);

  const key = deriveKey(password, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf-8");
}

export function isEncrypted(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const data = readFileSync(filePath);
    return data.subarray(0, Buffer.from(HEADER).length).toString("utf-8") === HEADER;
  } catch {
    return false;
  }
}

/**
 * Encrypt all .env files in a directory → .env.enc
 */
export function encryptDir(dir: string, password: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".env")) continue;
    const plainPath = join(dir, file);
    const encPath = plainPath + ".enc";
    try {
      const content = readFileSync(plainPath, "utf-8");
      if (!content.trim()) continue; // skip empty files
      const encrypted = encryptString(content, password);
      writeFileSync(encPath, encrypted);
      // Remove the plain file after encryption
      writeFileSync(plainPath, `# Encrypted — see ${file}.enc\n`);
      count++;
    } catch (err) {
      log.warn(`Failed to encrypt ${file}: ${err}`);
    }
  }
  return count;
}

/**
 * Decrypt all .env.enc files in a directory → .env
 */
export function decryptDir(dir: string, password: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".env.enc")) continue;
    const encPath = join(dir, file);
    const plainPath = encPath.replace(".enc", "");
    try {
      const data = readFileSync(encPath);
      const content = decryptString(data, password);
      writeFileSync(plainPath, content);
      count++;
    } catch (err) {
      log.warn(`Failed to decrypt ${file}: ${err}`);
    }
  }
  return count;
}

/**
 * Load env vars from a .env file, auto-decrypting if .env.enc exists.
 * Priority: agent-level > shared
 */
export function loadMcpKeysWithDecryption(
  gatewayDir: string,
  agentMemoryDir: string | null,
  mcpName: string,
  masterPassword?: string,
): Record<string, string> {
  const vars: Record<string, string> = {};
  const personalAgentsBase = getPersonalAgentsDir();

  // Level 3: Gateway data/mcp-keys/ (last resort)
  const gatewayVars = loadEnvFile(join(gatewayDir, `${mcpName}.env`), join(gatewayDir, `${mcpName}.env.enc`), masterPassword);
  Object.assign(vars, gatewayVars);

  // Level 2: Shared personalAgents/mcp-keys/ (overrides gateway)
  const sharedKeysDir = join(personalAgentsBase, "mcp-keys");
  const sharedVars = loadEnvFile(join(sharedKeysDir, `${mcpName}.env`), join(sharedKeysDir, `${mcpName}.env.enc`), masterPassword);
  Object.assign(vars, sharedVars);

  // Level 1: Agent-specific agent/mcp-keys/ (highest priority)
  if (agentMemoryDir) {
    const agentKeysDir = join(agentMemoryDir, "..", "mcp-keys");
    const agentVars = loadEnvFile(join(agentKeysDir, `${mcpName}.env`), join(agentKeysDir, `${mcpName}.env.enc`), masterPassword);
    Object.assign(vars, agentVars);
  }

  return vars;
}

function loadEnvFile(plainPath: string, encPath: string, password?: string): Record<string, string> {
  const vars: Record<string, string> = {};

  // Try encrypted file first
  if (password && existsSync(encPath)) {
    try {
      const data = readFileSync(encPath);
      if (isEncrypted(encPath)) {
        const content = decryptString(data, password);
        parseEnvContent(content, vars);
        return vars;
      }
    } catch { /* fall through to plain */ }
  }

  // Try plain file
  if (existsSync(plainPath)) {
    try {
      const content = readFileSync(plainPath, "utf-8");
      // Skip stub files left after encryption
      if (!content.includes("# Encrypted")) {
        parseEnvContent(content, vars);
      }
    } catch { /* ignore */ }
  }

  return vars;
}

function parseEnvContent(content: string, vars: Record<string, string>): void {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (val) vars[key] = val;
  }
}
