import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encryptString, decryptString, isEncrypted, encryptDir, decryptDir, loadMcpKeysWithDecryption } from "../../src/keystore.js";

const tmpDir = join(tmpdir(), "channelToAgent-keystore-tests");
const PASSWORD = "test-master-password-123";

describe("keystore — encryption", () => {
  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("encrypts and decrypts a string", () => {
    const plaintext = "STRIPE_API_KEY=sk_live_abc123";
    const encrypted = encryptString(plaintext, PASSWORD);
    assert.ok(encrypted.length > plaintext.length);
    const decrypted = decryptString(encrypted, PASSWORD);
    assert.equal(decrypted, plaintext);
  });

  it("wrong password fails to decrypt", () => {
    const encrypted = encryptString("secret", PASSWORD);
    assert.throws(() => decryptString(encrypted, "wrong-password"));
  });

  it("isEncrypted detects encrypted files", () => {
    mkdirSync(tmpDir, { recursive: true });
    const encPath = join(tmpDir, "test.env.enc");
    writeFileSync(encPath, encryptString("KEY=val", PASSWORD));
    assert.ok(isEncrypted(encPath));

    const plainPath = join(tmpDir, "test.env");
    writeFileSync(plainPath, "KEY=val");
    assert.ok(!isEncrypted(plainPath));
  });
});

describe("keystore — directory encrypt/decrypt", () => {
  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("encrypts all .env files in directory", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "stripe.env"), "STRIPE_API_KEY=sk_live_abc");
    writeFileSync(join(tmpDir, "notion.env"), "NOTION_KEY=ntn_abc");

    const count = encryptDir(tmpDir, PASSWORD);
    assert.equal(count, 2);
    assert.ok(existsSync(join(tmpDir, "stripe.env.enc")));
    assert.ok(existsSync(join(tmpDir, "notion.env.enc")));
  });

  it("decrypts .env.enc files back", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "test.env"), "MY_KEY=secret123");
    encryptDir(tmpDir, PASSWORD);

    // Plain file should now be a stub
    const stub = readFileSync(join(tmpDir, "test.env"), "utf-8");
    assert.ok(stub.includes("Encrypted"));

    // Decrypt
    const count = decryptDir(tmpDir, PASSWORD);
    assert.equal(count, 1);
    const restored = readFileSync(join(tmpDir, "test.env"), "utf-8");
    assert.ok(restored.includes("MY_KEY=secret123"));
  });

  it("skips empty .env files", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "empty.env"), "");
    const count = encryptDir(tmpDir, PASSWORD);
    assert.equal(count, 0);
  });
});

describe("keystore — dual-level key resolution", () => {
  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("loads from shared dir", () => {
    const sharedDir = join(tmpDir, "shared");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(join(sharedDir, "stripe.env"), "STRIPE_API_KEY=shared_key");

    const vars = loadMcpKeysWithDecryption(sharedDir, null, "stripe");
    assert.equal(vars.STRIPE_API_KEY, "shared_key");
  });

  it("agent-level overrides shared", () => {
    const sharedDir = join(tmpDir, "shared");
    const agentDir = join(tmpDir, "agent", "mcp-keys");
    mkdirSync(sharedDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    writeFileSync(join(sharedDir, "stripe.env"), "STRIPE_API_KEY=shared_key");
    writeFileSync(join(agentDir, "stripe.env"), "STRIPE_API_KEY=agent_key");

    // agentMemoryDir is the memory dir, mcp-keys is a sibling via ".."
    const agentMemoryDir = join(tmpDir, "agent", "memory");
    mkdirSync(agentMemoryDir, { recursive: true });
    const vars = loadMcpKeysWithDecryption(sharedDir, agentMemoryDir, "stripe");
    assert.equal(vars.STRIPE_API_KEY, "agent_key");
  });

  it("falls back to shared when no agent key", () => {
    const sharedDir = join(tmpDir, "shared");
    const agentMemoryDir = join(tmpDir, "agent", "memory");
    mkdirSync(sharedDir, { recursive: true });
    mkdirSync(agentMemoryDir, { recursive: true });

    writeFileSync(join(sharedDir, "stripe.env"), "STRIPE_API_KEY=shared_key");
    // No agent-level key

    const vars = loadMcpKeysWithDecryption(sharedDir, agentMemoryDir, "stripe");
    assert.equal(vars.STRIPE_API_KEY, "shared_key");
  });

  it("loads encrypted files with password", () => {
    const sharedDir = join(tmpDir, "shared");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(join(sharedDir, "stripe.env"), "STRIPE_API_KEY=encrypted_val");
    encryptDir(sharedDir, PASSWORD);

    const vars = loadMcpKeysWithDecryption(sharedDir, null, "stripe", PASSWORD);
    assert.equal(vars.STRIPE_API_KEY, "encrypted_val");
  });

  it("merges shared + agent vars", () => {
    const sharedDir = join(tmpDir, "shared");
    const agentDir = join(tmpDir, "agent", "mcp-keys");
    const agentMemoryDir = join(tmpDir, "agent", "memory");
    mkdirSync(sharedDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(agentMemoryDir, { recursive: true });

    writeFileSync(join(sharedDir, "xero.env"), "XERO_CLIENT_ID=shared_id\nXERO_SECRET=shared_secret");
    writeFileSync(join(agentDir, "xero.env"), "XERO_SECRET=agent_secret");

    const vars = loadMcpKeysWithDecryption(sharedDir, agentMemoryDir, "xero");
    assert.equal(vars.XERO_CLIENT_ID, "shared_id"); // from shared
    assert.equal(vars.XERO_SECRET, "agent_secret"); // overridden by agent
  });
});
