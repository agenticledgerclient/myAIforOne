import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStore } from "../../src/memory/store.js";

const tmpDir = join(tmpdir(), "channelToAgent-store-tests");

describe("vector store — JSON", () => {
  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("creates store in empty directory", async () => {
    const store = await createStore(tmpDir);
    assert.ok(store.name === "json" || store.name === "sqlite");
    assert.equal(await store.count(), 0);
  });

  it("adds and retrieves chunks", async () => {
    const store = await createStore(tmpDir);
    await store.add({
      id: "test-1",
      text: "hello world",
      vector: [0.1, 0.2, 0.3],
      source: "manual",
      timestamp: new Date().toISOString(),
    });

    const all = await store.getAll();
    assert.equal(all.length, 1);
    assert.equal(all[0].text, "hello world");
    assert.deepEqual(all[0].vector, [0.1, 0.2, 0.3]);
  });

  it("addBatch adds multiple chunks", async () => {
    const store = await createStore(tmpDir);
    await store.addBatch([
      { id: "b1", text: "one", vector: [1], source: "test", timestamp: "2026-01-01" },
      { id: "b2", text: "two", vector: [2], source: "test", timestamp: "2026-01-02" },
      { id: "b3", text: "three", vector: [3], source: "test", timestamp: "2026-01-03" },
    ]);
    assert.equal(await store.count(), 3);
  });

  it("replaces chunk with same ID", async () => {
    const store = await createStore(tmpDir);
    await store.add({ id: "x", text: "old", vector: [1], source: "test", timestamp: "2026-01-01" });
    await store.add({ id: "x", text: "new", vector: [2], source: "test", timestamp: "2026-01-02" });

    const all = await store.getAll();
    assert.equal(all.length, 1);
    assert.equal(all[0].text, "new");
  });

  it("removes by ID", async () => {
    const store = await createStore(tmpDir);
    await store.add({ id: "rm-me", text: "bye", vector: [1], source: "test", timestamp: "2026-01-01" });
    assert.equal(await store.count(), 1);
    await store.remove("rm-me");
    assert.equal(await store.count(), 0);
  });

  it("clears all chunks", async () => {
    const store = await createStore(tmpDir);
    await store.addBatch([
      { id: "a", text: "a", vector: [1], source: "test", timestamp: "2026-01-01" },
      { id: "b", text: "b", vector: [2], source: "test", timestamp: "2026-01-01" },
    ]);
    assert.equal(await store.count(), 2);
    await store.clear();
    assert.equal(await store.count(), 0);
  });

  it("persists to JSON file", async () => {
    const store = await createStore(tmpDir);
    await store.add({ id: "persist", text: "saved", vector: [0.5], source: "test", timestamp: "2026-01-01" });

    // Read the JSON file directly
    const jsonPath = join(tmpDir, "vectors.json");
    if (store.name === "json") {
      assert.ok(existsSync(jsonPath), "JSON file should exist");
      const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
      assert.equal(data.length, 1);
      assert.equal(data[0].id, "persist");
    }
  });
});
