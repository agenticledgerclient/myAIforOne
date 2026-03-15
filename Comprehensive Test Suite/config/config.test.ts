import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/config.js";

const tmpDir = join(tmpdir(), "channelToAgent-config-tests");

function writeConfig(config: any): string {
  mkdirSync(tmpDir, { recursive: true });
  const path = join(tmpDir, "config.json");
  writeFileSync(path, JSON.stringify(config));
  return path;
}

const minimalConfig = {
  service: { logLevel: "info" },
  channels: { test: { enabled: true, driver: "test", config: {} } },
  agents: {
    "test-agent": {
      name: "Test",
      description: "test",
      workspace: "/tmp",
      claudeMd: "/tmp/CLAUDE.md",
      memoryDir: "/tmp/memory",
      routes: [{ channel: "test", match: { type: "chat_id", value: "1" }, permissions: { allowFrom: ["*"], requireMention: false } }],
    },
  },
  defaultAgent: null,
};

describe("loadConfig", () => {
  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("loads a valid config", () => {
    const path = writeConfig(minimalConfig);
    const config = loadConfig(path);
    assert.equal(config.agents["test-agent"].name, "Test");
  });

  it("sets default values", () => {
    const path = writeConfig(minimalConfig);
    const config = loadConfig(path);
    const agent = config.agents["test-agent"];
    assert.equal(agent.autoCommit, false);
    assert.equal(agent.autoCommitBranch, "main");
    assert.equal(agent.timeout, 120_000);
    assert.deepEqual(agent.allowedTools, ["Read", "Edit", "Write", "Glob", "Grep", "Bash"]);
  });

  it("resolves tilde in workspace", () => {
    const cfg = JSON.parse(JSON.stringify(minimalConfig));
    cfg.agents["test-agent"].workspace = "~/test";
    const path = writeConfig(cfg);
    const config = loadConfig(path);
    assert.ok(!config.agents["test-agent"].workspace.startsWith("~"));
    assert.ok(config.agents["test-agent"].workspace.includes("/test"));
  });

  it("resolves tilde in claudeMd and memoryDir", () => {
    const cfg = JSON.parse(JSON.stringify(minimalConfig));
    cfg.agents["test-agent"].claudeMd = "~/claude.md";
    cfg.agents["test-agent"].memoryDir = "~/memory";
    const path = writeConfig(cfg);
    const config = loadConfig(path);
    assert.ok(!config.agents["test-agent"].claudeMd.startsWith("~"));
    assert.ok(!config.agents["test-agent"].memoryDir.startsWith("~"));
  });

  it("throws on missing agents", () => {
    const cfg = { ...minimalConfig, agents: {} };
    const path = writeConfig(cfg);
    assert.throws(() => loadConfig(path), /at least one agent/);
  });

  it("throws on missing channels", () => {
    const cfg = { ...minimalConfig, channels: {} };
    const path = writeConfig(cfg);
    assert.throws(() => loadConfig(path), /at least one channel/);
  });

  it("throws on agent missing routes", () => {
    const cfg = JSON.parse(JSON.stringify(minimalConfig));
    cfg.agents["test-agent"].routes = [];
    const path = writeConfig(cfg);
    assert.throws(() => loadConfig(path), /at least one route/);
  });

  it("throws on agent referencing unknown MCP", () => {
    const cfg = JSON.parse(JSON.stringify(minimalConfig));
    cfg.agents["test-agent"].mcps = ["nonexistent"];
    const path = writeConfig(cfg);
    assert.throws(() => loadConfig(path), /MCP/);
  });

  it("validates MCP definitions", () => {
    const cfg = JSON.parse(JSON.stringify(minimalConfig));
    cfg.mcps = { bad: { type: "stdio" } }; // missing command
    const path = writeConfig(cfg);
    assert.throws(() => loadConfig(path), /must have a "command"/);
  });
});
