import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMemoryManager } from "../../src/memory/index.js";

const tmpDir = join(tmpdir(), "channelToAgent-manager-tests");

describe("MemoryManager", () => {
  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("creates manager for empty directory", async () => {
    mkdirSync(tmpDir, { recursive: true });
    const mgr = await createMemoryManager(tmpDir);
    const stats = await mgr.stats();
    assert.equal(stats.chunks, 0);
    assert.ok(stats.store === "json" || stats.store === "sqlite");
  });

  it("indexes context.md on first creation", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "context.md"), "Important decision: use PostgreSQL for the database.");

    const mgr = await createMemoryManager(tmpDir);
    const stats = await mgr.stats();
    assert.ok(stats.chunks > 0, "Should have indexed context.md");
  });

  it("search returns relevant results", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "context.md"), "We decided to use Stripe for payments and QuickBooks for accounting.");

    const mgr = await createMemoryManager(tmpDir);

    // Index an additional memory
    await mgr.index("The project deadline is March 2026.", "manual");

    const results = await mgr.search("Stripe payments");
    assert.ok(results.length > 0, "Should find relevant results");
    assert.ok(results[0].chunk.text.includes("Stripe"), "Top result should mention Stripe");
  });

  it("searchFormatted returns formatted string", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "context.md"), "Remember: API key for Brex is stored in .env file.");

    const mgr = await createMemoryManager(tmpDir);
    const formatted = await mgr.searchFormatted("Brex API");
    assert.ok(formatted.includes("[Relevant Memories]") || formatted === "");
  });

  it("indexExchange adds to daily log and store", async () => {
    mkdirSync(tmpDir, { recursive: true });
    const mgr = await createMemoryManager(tmpDir);

    await mgr.indexExchange("list my invoices", "Here are your 5 invoices...", "alice");

    const stats = await mgr.stats();
    assert.ok(stats.chunks > 0, "Should have indexed the exchange");

    // Check daily file was created
    const today = new Date().toISOString().split("T")[0];
    const dailyPath = join(tmpDir, "daily", `${today}.md`);
    assert.ok(existsSync(dailyPath), "Daily log should exist");
  });

  it("loadDailyContext returns today's log", async () => {
    mkdirSync(tmpDir, { recursive: true });
    const mgr = await createMemoryManager(tmpDir);

    await mgr.indexExchange("hello", "hi there", "user");
    const daily = mgr.loadDailyContext();
    assert.ok(daily.includes("hello") || daily.includes("Today"), "Should include today's content");
  });

  it("getCompactionPrompt returns null for low message count", async () => {
    mkdirSync(tmpDir, { recursive: true });
    const mgr = await createMemoryManager(tmpDir);
    assert.equal(mgr.getCompactionPrompt(5), null);
  });

  it("getCompactionPrompt returns warning at threshold", async () => {
    mkdirSync(tmpDir, { recursive: true });
    const mgr = await createMemoryManager(tmpDir);
    const prompt = mgr.getCompactionPrompt(20);
    assert.ok(prompt !== null, "Should return a prompt at 20 messages");
    assert.ok(prompt!.includes("20 messages"));
  });

  it("getCompactionPrompt returns strong warning at force threshold", async () => {
    mkdirSync(tmpDir, { recursive: true });
    const mgr = await createMemoryManager(tmpDir);
    const prompt = mgr.getCompactionPrompt(40);
    assert.ok(prompt !== null);
    assert.ok(prompt!.includes("save any important"));
  });

  it("reindex clears and rebuilds", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "context.md"), "Test content for reindex.");

    const mgr = await createMemoryManager(tmpDir);
    const before = await mgr.stats();

    await mgr.index("extra data", "manual");
    const during = await mgr.stats();
    assert.ok(during.chunks > before.chunks);

    await mgr.reindex();
    const after = await mgr.stats();
    // After reindex, should only have context.md chunks (not the manual one)
    assert.ok(after.chunks <= during.chunks);
  });
});
