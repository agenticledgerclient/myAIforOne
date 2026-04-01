/**
 * Tests for updated sticky routing behavior:
 * - stickyRouting: true (legacy boolean) must NOT be valid — it defaults to "prefix" mode
 * - stickyRouting: "sticky" | "prefix" | "none" are the valid string values
 * - "none" disables sticky follow-ups
 * - "prefix" requires a trigger prefix character for follow-ups
 * - "sticky" routes all follow-ups without prefix
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveRoute } from "../../src/router.js";
import type { InboundMessage } from "../../src/channels/types.js";
import type { AppConfig } from "../../src/config.js";

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: "1", channel: "telegram", chatId: "100", chatType: "group",
    sender: "user1", text: "hello", timestamp: Date.now(),
    isFromMe: false, isGroup: true, raw: {}, ...overrides,
  };
}

function makeConfig(stickyRouting: any, stickyPrefix = "!"): AppConfig {
  return {
    service: { logLevel: "info" },
    channels: {
      telegram: {
        enabled: true, driver: "telegram",
        config: { botToken: "x", stickyRouting, stickyPrefix, stickyTimeoutMs: 60_000 },
      },
    },
    agents: {
      "agent-x": {
        name: "Agent X", description: "x", workspace: "/tmp",
        claudeMd: "/tmp/x.md", memoryDir: "/tmp/x",
        mentionAliases: ["@agentx"], autoCommit: false,
        autoCommitBranch: "main", allowedTools: ["Read"],
        routes: [{ channel: "telegram", match: { type: "chat_id", value: "100" },
          permissions: { allowFrom: ["*"], requireMention: true } }],
      },
    },
    defaultAgent: null,
  } as AppConfig;
}

describe("sticky routing mode validation", () => {
  it('stickyRouting: "none" — follow-ups return null (no routing)', () => {
    const config = makeConfig("none");
    resolveRoute(makeMsg({ text: "@agentx start" }), config);
    const result = resolveRoute(makeMsg({ text: "follow up" }), config);
    assert.equal(result, null, "none mode should not route follow-ups");
  });

  it('stickyRouting: "sticky" — follow-ups route without prefix', () => {
    const config = makeConfig("sticky");
    resolveRoute(makeMsg({ text: "@agentx start" }), config);
    const result = resolveRoute(makeMsg({ text: "follow up without prefix" }), config);
    assert.ok(result, "sticky mode should route follow-ups without prefix");
    assert.equal(result.agentId, "agent-x");
  });

  it('stickyRouting: "prefix" — follow-ups require prefix character', () => {
    const config = makeConfig("prefix", "!");
    resolveRoute(makeMsg({ text: "@agentx start" }), config);

    // Without prefix: should NOT route
    const noPrefix = resolveRoute(makeMsg({ text: "follow up without prefix", sender: "user2" }), config);
    // (different sender to avoid sticky from previous test run)
    // But with unique config, follow-ups to user1 should fail without prefix
    // Let's use a fresh sender
    const config2 = makeConfig("prefix", "!");
    resolveRoute(makeMsg({ text: "@agentx start", sender: "alice" }), config2);
    const noPrefixResult = resolveRoute(makeMsg({ text: "no prefix here", sender: "alice" }), config2);
    assert.equal(noPrefixResult, null, "prefix mode should not route follow-ups without prefix");
  });

  it('stickyRouting: "prefix" — follow-ups WITH prefix DO route', () => {
    const config = makeConfig("prefix", "!");
    resolveRoute(makeMsg({ text: "@agentx start", sender: "bob" }), config);
    const result = resolveRoute(makeMsg({ text: "! continue this task", sender: "bob" }), config);
    assert.ok(result, "prefix mode should route follow-ups with prefix");
    assert.equal(result.agentId, "agent-x");
  });

  it('stickyRouting: "prefix" — strips prefix from message text', () => {
    const config = makeConfig("prefix", "!");
    resolveRoute(makeMsg({ text: "@agentx start", sender: "charlie" }), config);
    const msg = makeMsg({ text: "! do something important", sender: "charlie" });
    const result = resolveRoute(msg, config);
    assert.ok(result, "Should route");
    // The prefix should be stripped from msg.text
    assert.equal(msg.text, "do something important");
  });

  it('stickyRouting: true (legacy boolean) — defaults to prefix mode', () => {
    // When stickyRouting is `true` (legacy), the code does not match any string,
    // so the default "prefix" mode is used.
    const config = makeConfig(true, "!");
    resolveRoute(makeMsg({ text: "@agentx start", sender: "dana" }), config);

    // Without prefix — should NOT route (default is prefix mode for unrecognized values)
    const result = resolveRoute(makeMsg({ text: "no prefix follow up", sender: "dana" }), config);
    assert.equal(result, null, 'boolean true should default to prefix mode — follow-up without prefix returns null');
  });

  it('stickyRouting: false (legacy boolean) — defaults to prefix mode (not none)', () => {
    // When stickyRouting is `false`, the code doesn't match "none", "sticky", or "prefix",
    // so the default "prefix" is used — NOT "none".
    const config = makeConfig(false, "!");
    resolveRoute(makeMsg({ text: "@agentx start", sender: "eve" }), config);
    // With prefix: should route (prefix mode is the default fallback)
    const msg = makeMsg({ text: "! continue", sender: "eve" });
    const result = resolveRoute(msg, config);
    assert.ok(result, 'boolean false defaults to prefix mode — prefixed follow-up should route');
  });

  it('stickyRouting: "none" explicitly — disables all sticky follow-ups', () => {
    const config = makeConfig("none");
    resolveRoute(makeMsg({ text: "@agentx start", sender: "frank" }), config);
    // Even with "!" prefix, none mode means no follow-ups
    const result = resolveRoute(makeMsg({ text: "! follow", sender: "frank" }), config);
    assert.equal(result, null, 'none mode should not route any follow-ups, even with prefix');
  });
});
