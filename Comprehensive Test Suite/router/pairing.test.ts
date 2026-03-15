import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isPairingAttempt, pairSender } from "../../src/router.js";
import type { InboundMessage } from "../../src/channels/types.js";
import type { AppConfig } from "../../src/config.js";

const tmpDir = join(tmpdir(), "channelToAgent-pairing-tests");

function makeMsg(text: string): InboundMessage {
  return {
    id: "1", channel: "telegram", chatId: "123", chatType: "dm",
    sender: "user1", text, timestamp: Date.now(),
    isFromMe: false, isGroup: false, raw: {},
  };
}

function makeConfig(pairingCode?: string): AppConfig {
  return {
    service: { logLevel: "info", pairingCode },
    channels: { test: { enabled: true, driver: "test", config: {} } },
    agents: {
      "test-agent": {
        name: "Test", description: "test", workspace: "/tmp",
        claudeMd: "/tmp/CLAUDE.md", memoryDir: "/tmp/memory",
        autoCommit: false, autoCommitBranch: "main", allowedTools: ["Read"],
        routes: [{ channel: "telegram", match: { type: "chat_id", value: "123" },
          permissions: { allowFrom: ["*"], requireMention: false } }],
      },
    },
    defaultAgent: null,
  } as AppConfig;
}

describe("DM pairing", () => {
  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("returns false when no pairing code configured", () => {
    mkdirSync(join(tmpDir, "data"), { recursive: true });
    const result = isPairingAttempt(makeMsg("hello"), makeConfig(), tmpDir);
    assert.equal(result, false);
  });

  it("detects pairing attempt when code matches", () => {
    mkdirSync(join(tmpDir, "data"), { recursive: true });
    const result = isPairingAttempt(makeMsg("secret123"), makeConfig("secret123"), tmpDir);
    assert.equal(result, true);
  });

  it("rejects wrong pairing code", () => {
    mkdirSync(join(tmpDir, "data"), { recursive: true });
    const result = isPairingAttempt(makeMsg("wrongcode"), makeConfig("secret123"), tmpDir);
    assert.equal(result, false);
  });

  it("pairSender persists the pairing", () => {
    mkdirSync(join(tmpDir, "data"), { recursive: true });
    const msg = makeMsg("secret123");
    pairSender(msg, tmpDir);

    // After pairing, isPairingAttempt should return false (already paired)
    const result = isPairingAttempt(msg, makeConfig("secret123"), tmpDir);
    assert.equal(result, false);
  });
});
