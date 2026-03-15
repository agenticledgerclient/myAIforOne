import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/config.js";

const tmpDir = join(tmpdir(), "channelToAgent-org-tests");

function writeConfig(config: any): string {
  mkdirSync(tmpDir, { recursive: true });
  const path = join(tmpDir, "config.json");
  writeFileSync(path, JSON.stringify(config));
  return path;
}

const baseConfig = {
  service: { logLevel: "info" },
  channels: { test: { enabled: true, driver: "test", config: {} } },
  agents: {
    "test-agent": {
      name: "Test", description: "test", workspace: "/tmp",
      claudeMd: "/tmp/CLAUDE.md", memoryDir: "/tmp/memory",
      routes: [{ channel: "test", match: { type: "chat_id", value: "1" },
        permissions: { allowFrom: ["*"], requireMention: false } }],
    },
  },
  defaultAgent: null,
};

describe("org config", () => {
  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("loads agent without org field", () => {
    const path = writeConfig(baseConfig);
    const config = loadConfig(path);
    assert.equal(config.agents["test-agent"].org, undefined);
  });

  it("loads agent with org array", () => {
    const cfg = JSON.parse(JSON.stringify(baseConfig));
    cfg.agents["test-agent"].org = [
      { organization: "TestOrg", function: "Engineering", title: "Lead" }
    ];
    const path = writeConfig(cfg);
    const config = loadConfig(path);
    assert.ok(Array.isArray(config.agents["test-agent"].org));
    assert.equal(config.agents["test-agent"].org![0].organization, "TestOrg");
    assert.equal(config.agents["test-agent"].org![0].function, "Engineering");
    assert.equal(config.agents["test-agent"].org![0].title, "Lead");
  });

  it("supports multiple org entries", () => {
    const cfg = JSON.parse(JSON.stringify(baseConfig));
    cfg.agents["test-agent"].org = [
      { organization: "Org1", function: "Dept1", title: "Role1" },
      { organization: "Org2", function: "Dept2", title: "Role2", reportsTo: "@boss" },
    ];
    const path = writeConfig(cfg);
    const config = loadConfig(path);
    assert.equal(config.agents["test-agent"].org!.length, 2);
    assert.equal(config.agents["test-agent"].org![1].reportsTo, "@boss");
  });

  it("loads streaming flag", () => {
    const cfg = JSON.parse(JSON.stringify(baseConfig));
    cfg.agents["test-agent"].streaming = true;
    const path = writeConfig(cfg);
    const config = loadConfig(path);
    assert.equal(config.agents["test-agent"].streaming, true);
  });

  it("loads perSenderSessions flag", () => {
    const cfg = JSON.parse(JSON.stringify(baseConfig));
    cfg.agents["test-agent"].perSenderSessions = true;
    const path = writeConfig(cfg);
    const config = loadConfig(path);
    assert.equal(config.agents["test-agent"].perSenderSessions, true);
  });
});
