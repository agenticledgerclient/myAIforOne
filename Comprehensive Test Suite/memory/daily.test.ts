import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendDailyEntry, loadRecentDaily, getDailyDir } from "../../src/memory/daily.js";

const tmpDir = join(tmpdir(), "channelToAgent-daily-tests");

describe("daily memory", () => {
  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("creates daily directory", () => {
    const dir = getDailyDir(tmpDir);
    assert.ok(existsSync(dir));
  });

  it("appends entry to today's file", () => {
    appendDailyEntry(tmpDir, "alice", "hello there", "hi alice, how can I help?");

    const today = new Date().toISOString().split("T")[0];
    const filePath = join(tmpDir, "daily", `${today}.md`);
    assert.ok(existsSync(filePath));

    const content = readFileSync(filePath, "utf-8");
    assert.ok(content.includes("Daily Log"));
    assert.ok(content.includes("alice"));
    assert.ok(content.includes("hello there"));
    assert.ok(content.includes("hi alice"));
  });

  it("appends multiple entries to same day", () => {
    appendDailyEntry(tmpDir, "bob", "first message", "first response");
    appendDailyEntry(tmpDir, "bob", "second message", "second response");

    const today = new Date().toISOString().split("T")[0];
    const content = readFileSync(join(tmpDir, "daily", `${today}.md`), "utf-8");
    assert.ok(content.includes("first message"));
    assert.ok(content.includes("second message"));
  });

  it("truncates long messages", () => {
    const longMsg = "x".repeat(500);
    appendDailyEntry(tmpDir, "user", longMsg, "response");

    const today = new Date().toISOString().split("T")[0];
    const content = readFileSync(join(tmpDir, "daily", `${today}.md`), "utf-8");
    // Should be truncated to ~200 chars
    assert.ok(content.length < longMsg.length);
  });

  it("loadRecentDaily returns today's content", () => {
    appendDailyEntry(tmpDir, "user", "test message", "test response");
    const recent = loadRecentDaily(tmpDir);
    assert.ok(recent.includes("Today"));
    assert.ok(recent.includes("test message"));
  });

  it("loadRecentDaily returns empty for no files", () => {
    mkdirSync(join(tmpDir, "daily"), { recursive: true });
    const recent = loadRecentDaily(tmpDir);
    assert.equal(recent, "");
  });
});
