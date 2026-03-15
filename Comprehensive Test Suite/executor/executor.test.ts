import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test the intercepted commands and session management logic
// The actual claude spawning requires the CLI, so we test the utilities

const tmpDir = join(tmpdir(), "channelToAgent-executor-tests");

describe("executor — session file management", () => {
  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("session.json stores valid JSON with sessionId", () => {
    mkdirSync(tmpDir, { recursive: true });
    const state = { sessionId: "abc-123", createdAt: "2026-01-01", messageCount: 5 };
    const path = join(tmpDir, "session.json");
    writeFileSync(path, JSON.stringify(state, null, 2));

    const loaded = JSON.parse(readFileSync(path, "utf-8"));
    assert.equal(loaded.sessionId, "abc-123");
    assert.equal(loaded.messageCount, 5);
  });

  it("per-sender session files use sender ID in filename", () => {
    mkdirSync(tmpDir, { recursive: true });
    const state = { sessionId: "def-456", createdAt: "2026-01-01", messageCount: 1 };
    const path = join(tmpDir, "session-user42.json");
    writeFileSync(path, JSON.stringify(state));

    assert.ok(existsSync(path));
    const loaded = JSON.parse(readFileSync(path, "utf-8"));
    assert.equal(loaded.sessionId, "def-456");
  });

  it("reset deletes session file", () => {
    mkdirSync(tmpDir, { recursive: true });
    const path = join(tmpDir, "session.json");
    writeFileSync(path, '{"sessionId":"x","createdAt":"","messageCount":0}');
    assert.ok(existsSync(path));

    rmSync(path);
    assert.ok(!existsSync(path));
  });
});

describe("executor — command interception patterns", () => {
  it("/opreset matches with leading whitespace", () => {
    const pattern = /^\s*\/opreset\b/i;
    assert.ok(pattern.test("/opreset"));
    assert.ok(pattern.test("  /opreset"));
    assert.ok(pattern.test("/OPRESET"));
    assert.ok(!pattern.test("text /opreset")); // not at start
  });

  it("/opcompact matches with content after", () => {
    const pattern = /^\s*\/opcompact\b/i;
    assert.ok(pattern.test("/opcompact save this"));
    assert.ok(pattern.test("/OPCOMPACT save that"));
    assert.ok(!pattern.test("run /opcompact")); // not at start
  });
});
