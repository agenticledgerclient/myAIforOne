import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveRoute } from "../../src/router.js";
import type { InboundMessage } from "../../src/channels/types.js";
import type { AppConfig } from "../../src/config.js";

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: "1",
    channel: "slack",
    chatId: "C123",
    chatType: "group",
    sender: "user1",
    text: "@mybot hello",
    timestamp: Date.now(),
    isFromMe: false,
    isGroup: true,
    raw: {},
    ...overrides,
  };
}

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    service: { logLevel: "info" },
    channels: { slack: { enabled: true, driver: "slack", config: { stickyRouting: false } } },
    agents: {
      "test-agent": {
        name: "Test Agent",
        description: "test",
        workspace: "/tmp",
        claudeMd: "/tmp/CLAUDE.md",
        memoryDir: "/tmp/memory",
        mentionAliases: ["@mybot"],
        autoCommit: false,
        autoCommitBranch: "main",
        allowedTools: ["Read"],
        routes: [{
          channel: "slack",
          match: { type: "channel_id", value: "C123" },
          permissions: { allowFrom: ["*"], requireMention: true },
        }],
      },
    },
    defaultAgent: null,
    ...overrides,
  } as AppConfig;
}

describe("resolveRoute", () => {
  it("matches route by channel + chatId + mention", () => {
    const result = resolveRoute(makeMsg(), makeConfig());
    assert.ok(result);
    assert.equal(result.agentId, "test-agent");
  });

  it("returns null when mention is missing and required", () => {
    const result = resolveRoute(makeMsg({ text: "hello no mention" }), makeConfig());
    assert.equal(result, null);
  });

  it("matches when mention is not required", () => {
    const config = makeConfig();
    config.agents["test-agent"].routes[0].permissions.requireMention = false;
    const result = resolveRoute(makeMsg({ text: "hello" }), config);
    assert.ok(result);
  });

  it("returns null for wrong channel", () => {
    const result = resolveRoute(makeMsg({ channel: "telegram" }), makeConfig());
    assert.equal(result, null);
  });

  it("returns null for wrong chatId", () => {
    const result = resolveRoute(makeMsg({ chatId: "WRONG" }), makeConfig());
    assert.equal(result, null);
  });

  it("blocks sender not in allowFrom", () => {
    const config = makeConfig();
    config.agents["test-agent"].routes[0].permissions.allowFrom = ["user2"];
    const result = resolveRoute(makeMsg({ sender: "user1" }), config);
    assert.equal(result, null);
  });

  it("allows sender in allowFrom", () => {
    const config = makeConfig();
    config.agents["test-agent"].routes[0].permissions.allowFrom = ["user1"];
    const result = resolveRoute(makeMsg(), config);
    assert.ok(result);
  });

  it("falls back to defaultAgent for web channel", () => {
    const config = makeConfig({ defaultAgent: "test-agent" });
    // defaultAgent fallback only applies to the web channel
    config.agents["test-agent"].routes.push({
      channel: "web",
      match: { type: "channel_id", value: "web-default" },
      permissions: { allowFrom: ["*"], requireMention: false },
    });
    const result = resolveRoute(makeMsg({ channel: "web", chatId: "NOMATCH" }), config);
    assert.ok(result);
    assert.equal(result.agentId, "test-agent");
  });

  it("does NOT fall back to defaultAgent for non-web channels", () => {
    const config = makeConfig({ defaultAgent: "test-agent" });
    const result = resolveRoute(makeMsg({ chatId: "NOMATCH" }), config);
    assert.equal(result, null);
  });

  it("mention matching is case-insensitive", () => {
    const result = resolveRoute(makeMsg({ text: "@MYBOT hello" }), makeConfig());
    assert.ok(result);
  });

  it("matches multiple agents in same channel by different alias", () => {
    const config = makeConfig();
    config.agents["agent2"] = {
      ...config.agents["test-agent"],
      name: "Agent 2",
      mentionAliases: ["@other"],
      routes: [{
        channel: "slack",
        match: { type: "channel_id", value: "C123" },
        permissions: { allowFrom: ["*"], requireMention: true },
      }],
    };
    const result1 = resolveRoute(makeMsg({ text: "@mybot hi" }), config);
    const result2 = resolveRoute(makeMsg({ text: "@other hi" }), config);
    assert.equal(result1?.agentId, "test-agent");
    assert.equal(result2?.agentId, "agent2");
  });
});
