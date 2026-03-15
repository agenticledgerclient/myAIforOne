import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmpDir = join(tmpdir(), "channelToAgent-mcpkeys-tests");

describe("MCP key loading", () => {
  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("parses KEY=value format", () => {
    mkdirSync(join(tmpDir, "data", "mcp-keys"), { recursive: true });
    writeFileSync(join(tmpDir, "data", "mcp-keys", "test.env"), "API_KEY=sk-123\nSECRET=abc456\n");

    const content = readFileSync(join(tmpDir, "data", "mcp-keys", "test.env"), "utf-8");
    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (val) vars[key] = val;
    }

    assert.equal(vars.API_KEY, "sk-123");
    assert.equal(vars.SECRET, "abc456");
  });

  it("ignores comments and blank lines", () => {
    mkdirSync(join(tmpDir, "data", "mcp-keys"), { recursive: true });
    writeFileSync(join(tmpDir, "data", "mcp-keys", "test.env"), "# comment\n\nKEY=val\n# another\n");

    const content = readFileSync(join(tmpDir, "data", "mcp-keys", "test.env"), "utf-8");
    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }

    assert.equal(Object.keys(vars).length, 1);
    assert.equal(vars.KEY, "val");
  });

  it("skips empty values", () => {
    mkdirSync(join(tmpDir, "data", "mcp-keys"), { recursive: true });
    writeFileSync(join(tmpDir, "data", "mcp-keys", "test.env"), "FILLED=yes\nEMPTY=\n");

    const content = readFileSync(join(tmpDir, "data", "mcp-keys", "test.env"), "utf-8");
    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const val = trimmed.slice(eqIdx + 1).trim();
      if (val) vars[trimmed.slice(0, eqIdx).trim()] = val;
    }

    assert.equal(vars.FILLED, "yes");
    assert.ok(!("EMPTY" in vars), "Empty values should be skipped");
  });

  it("file keys override config keys", () => {
    const configEnv = { API_KEY: "old-key", OTHER: "keep" };
    const fileEnv = { API_KEY: "new-key" };

    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries(configEnv)) {
      if (v) merged[k] = v;
    }
    Object.assign(merged, fileEnv);

    assert.equal(merged.API_KEY, "new-key");
    assert.equal(merged.OTHER, "keep");
  });

  it("resolves ${VAR} in HTTP headers", () => {
    const header = "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}";
    const fileEnv: Record<string, string> = { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_abc123" };

    const resolved = header.replace(/\$\{(\w+)\}/g, (_, varName) => {
      return fileEnv[varName] || "";
    });

    assert.equal(resolved, "Bearer ghp_abc123");
  });
});
