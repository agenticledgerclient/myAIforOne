import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveRoute } from "../../src/router.js";
import type { InboundMessage } from "../../src/channels/types.js";
import type { AppConfig } from "../../src/config.js";

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: "1", channel: "telegram", chatId: "123", chatType: "group",
    sender: "user1", text: "hello", timestamp: Date.now(),
    isFromMe: false, isGroup: true, raw: {}, ...overrides,
  };
}

function makeConfig(): AppConfig {
  return {
    service: { logLevel: "info" },
    channels: {
      telegram: {
        enabled: true, driver: "telegram",
        config: { botToken: "x", stickyRouting: true, stickyTimeoutMs: 5000 },
      },
    },
    agents: {
      "agent-a": {
        name: "Agent A", description: "a", workspace: "/tmp",
        claudeMd: "/tmp/a.md", memoryDir: "/tmp/a",
        mentionAliases: ["@agenta"], autoCommit: false,
        autoCommitBranch: "main", allowedTools: ["Read"],
        routes: [{ channel: "telegram", match: { type: "chat_id", value: "123" },
          permissions: { allowFrom: ["*"], requireMention: true } }],
      },
      "agent-b": {
        name: "Agent B", description: "b", workspace: "/tmp",
        claudeMd: "/tmp/b.md", memoryDir: "/tmp/b",
        mentionAliases: ["@agentb"], autoCommit: false,
        autoCommitBranch: "main", allowedTools: ["Read"],
        routes: [{ channel: "telegram", match: { type: "chat_id", value: "123" },
          permissions: { allowFrom: ["*"], requireMention: true } }],
      },
    },
    defaultAgent: null,
  } as AppConfig;
}

describe("sticky routing", () => {
  it("first message without mention returns null", () => {
    const result = resolveRoute(makeMsg({ text: "hello" }), makeConfig());
    assert.equal(result, null);
  });

  it("mention routes to correct agent", () => {
    const result = resolveRoute(makeMsg({ text: "@agenta check something" }), makeConfig());
    assert.ok(result);
    assert.equal(result.agentId, "agent-a");
  });

  it("follow-up without mention routes to same agent (sticky)", () => {
    const config = makeConfig();
    // First: mention agent-a
    resolveRoute(makeMsg({ text: "@agenta check something" }), config);
    // Second: no mention — should still go to agent-a
    const result = resolveRoute(makeMsg({ text: "what about the tests?" }), config);
    assert.ok(result);
    assert.equal(result.agentId, "agent-a");
  });

  it("new mention switches sticky to different agent", () => {
    const config = makeConfig();
    resolveRoute(makeMsg({ text: "@agenta check" }), config);
    resolveRoute(makeMsg({ text: "@agentb deploy" }), config);
    // Follow-up should go to agent-b now
    const result = resolveRoute(makeMsg({ text: "is it done?" }), config);
    assert.ok(result);
    assert.equal(result.agentId, "agent-b");
  });

  it("different senders have independent sticky", () => {
    const config = makeConfig();
    resolveRoute(makeMsg({ sender: "alice", text: "@agenta hi" }), config);
    resolveRoute(makeMsg({ sender: "bob", text: "@agentb hi" }), config);

    const aliceFollowup = resolveRoute(makeMsg({ sender: "alice", text: "update?" }), config);
    const bobFollowup = resolveRoute(makeMsg({ sender: "bob", text: "status?" }), config);

    assert.equal(aliceFollowup?.agentId, "agent-a");
    assert.equal(bobFollowup?.agentId, "agent-b");
  });

  it("sticky disabled returns null for follow-ups", () => {
    const config = makeConfig();
    (config.channels.telegram.config as any).stickyRouting = false;

    resolveRoute(makeMsg({ text: "@agenta check" }), config);
    const result = resolveRoute(makeMsg({ text: "follow up" }), config);
    assert.equal(result, null);
  });
});
