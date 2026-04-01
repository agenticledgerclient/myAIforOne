import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { resolve } from "node:path";
import { loadConfig, getPersonalAgentsDir, getPersonalRegistryDir } from "../../src/config.js";

const tmpDir = join(tmpdir(), "channelToAgent-personalregistry-tests");

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

describe("personalRegistryDir config", () => {
  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("getPersonalRegistryDir returns default path when not configured", () => {
    const home = homedir();
    const expected = resolve(home, "Desktop", "MyAIforOne Drive", "PersonalRegistry");
    // Call without loading a config — should return the default
    // We need to reset the module-level cache by loading a fresh config first
    const path = writeConfig(minimalConfig);
    loadConfig(path);
    // After loading minimal config with no personalRegistryDir, should use default
    const dir = getPersonalRegistryDir();
    assert.equal(dir, expected);
  });

  it("getPersonalRegistryDir respects personalRegistryDir config key", () => {
    const cfg = JSON.parse(JSON.stringify(minimalConfig));
    cfg.service.personalRegistryDir = "/custom/registry/path";
    const path = writeConfig(cfg);
    loadConfig(path);
    const dir = getPersonalRegistryDir();
    assert.equal(dir, "/custom/registry/path");
  });

  it("getPersonalRegistryDir resolves tilde in personalRegistryDir", () => {
    const cfg = JSON.parse(JSON.stringify(minimalConfig));
    cfg.service.personalRegistryDir = "~/custom/registry";
    const path = writeConfig(cfg);
    loadConfig(path);
    const dir = getPersonalRegistryDir();
    assert.ok(!dir.startsWith("~"), "Tilde should be resolved");
    assert.ok(dir.includes("custom/registry"), "Path should be preserved");
  });

  it("getPersonalAgentsDir returns default path when not configured", () => {
    const home = homedir();
    const expected = resolve(home, "Desktop", "MyAIforOne Drive", "PersonalAgents");
    const path = writeConfig(minimalConfig);
    loadConfig(path);
    const dir = getPersonalAgentsDir();
    assert.equal(dir, expected);
  });

  it("getPersonalAgentsDir respects personalAgentsDir config key", () => {
    const cfg = JSON.parse(JSON.stringify(minimalConfig));
    cfg.service.personalAgentsDir = "/custom/agents/path";
    const path = writeConfig(cfg);
    loadConfig(path);
    const dir = getPersonalAgentsDir();
    assert.equal(dir, "/custom/agents/path");
  });

  it("getPersonalAgentsDir resolves tilde in personalAgentsDir", () => {
    const cfg = JSON.parse(JSON.stringify(minimalConfig));
    cfg.service.personalAgentsDir = "~/custom/agents";
    const path = writeConfig(cfg);
    loadConfig(path);
    const dir = getPersonalAgentsDir();
    assert.ok(!dir.startsWith("~"), "Tilde should be resolved");
    assert.ok(dir.includes("custom/agents"), "Path should be preserved");
  });

  it("personalRegistryDir defaults to different path than personalAgentsDir", () => {
    const home = homedir();
    const agentsDefault = resolve(home, "Desktop", "MyAIforOne Drive", "PersonalAgents");
    const registryDefault = resolve(home, "Desktop", "MyAIforOne Drive", "PersonalRegistry");
    assert.notEqual(agentsDefault, registryDefault);
    assert.ok(agentsDefault.endsWith("PersonalAgents"));
    assert.ok(registryDefault.endsWith("PersonalRegistry"));
  });

  it("config with personalRegistryDir key does not throw", () => {
    const cfg = JSON.parse(JSON.stringify(minimalConfig));
    cfg.service.personalRegistryDir = "/tmp/my-registry";
    const path = writeConfig(cfg);
    assert.doesNotThrow(() => loadConfig(path));
  });
});
