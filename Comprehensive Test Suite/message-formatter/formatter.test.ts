import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatMessage } from "../../src/utils/message-formatter.js";
import type { InboundMessage } from "../../src/channels/types.js";

const tmpDir = join(tmpdir(), "channelToAgent-formatter-tests");

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: "1",
    channel: "slack",
    chatId: "C123",
    chatType: "group",
    sender: "user1",
    senderName: "Alice",
    text: "hello world",
    timestamp: Date.now(),
    isFromMe: false,
    isGroup: true,
    groupName: "Test Group",
    raw: {},
    ...overrides,
  };
}

describe("formatMessage", () => {
  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("formats basic message with channel header", () => {
    const result = formatMessage(makeMsg());
    assert.ok(result.includes("slack"));
    assert.ok(result.includes("hello world"));
    assert.ok(result.includes("Alice") || result.includes("user1"));
  });

  it("includes group name for group messages", () => {
    const result = formatMessage(makeMsg({ isGroup: true, groupName: "My Group" }));
    assert.ok(result.includes("My Group"));
  });

  it("formats DM without group name", () => {
    const result = formatMessage(makeMsg({ isGroup: false, chatType: "dm" }));
    assert.ok(result.includes("DM"));
  });

  it("injects memory context when provided", () => {
    mkdirSync(tmpDir, { recursive: true });
    const contextPath = join(tmpDir, "context.md");
    writeFileSync(contextPath, "Important context here");
    const result = formatMessage(makeMsg(), contextPath);
    assert.ok(result.includes("Important context here"));
  });

  it("injects conversation history when provided", () => {
    mkdirSync(tmpDir, { recursive: true });
    const logPath = join(tmpDir, "log.jsonl");
    const entry = JSON.stringify({ ts: "2026-01-01", from: "bob", text: "prev msg", response: "prev resp" });
    writeFileSync(logPath, entry + "\n");
    const result = formatMessage(makeMsg(), undefined, logPath);
    assert.ok(result.includes("prev msg"));
  });

  it("limits history to historyLimit", () => {
    mkdirSync(tmpDir, { recursive: true });
    const logPath = join(tmpDir, "log.jsonl");
    const entries = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ ts: "2026-01-01", from: "bob", text: `msg${i}`, response: `resp${i}` })
    );
    writeFileSync(logPath, entries.join("\n") + "\n");
    const result = formatMessage(makeMsg(), undefined, logPath, 3);
    // Should only include last 3
    assert.ok(result.includes("msg7"));
    assert.ok(result.includes("msg9"));
    assert.ok(!result.includes("msg0"));
  });

  it("includes reply context", () => {
    const result = formatMessage(makeMsg({
      replyTo: { id: "99", text: "original message", sender: "bob" },
    }));
    assert.ok(result.includes("original message"));
    assert.ok(result.includes("bob"));
  });

  it("handles missing context file gracefully", () => {
    const result = formatMessage(makeMsg(), "/nonexistent/path.md");
    assert.ok(result.includes("hello world"));
  });
});
