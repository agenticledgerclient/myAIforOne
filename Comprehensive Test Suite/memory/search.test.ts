import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hybridSearch, formatSearchResults } from "../../src/memory/search.js";
import type { MemoryChunk } from "../../src/memory/store.js";

function makeChunk(id: string, text: string, vector: number[], source = "test", timestamp = "2026-03-15T00:00:00Z"): MemoryChunk {
  return { id, text, vector, source, timestamp };
}

describe("hybrid search", () => {
  it("returns empty for empty chunks", () => {
    const results = hybridSearch([1, 0, 0], "test", []);
    assert.equal(results.length, 0);
  });

  it("ranks by vector similarity", () => {
    const chunks = [
      makeChunk("a", "apple fruit", [1, 0, 0]),
      makeChunk("b", "banana fruit", [0.9, 0.1, 0]),
      makeChunk("c", "car vehicle", [0, 0, 1]),
    ];

    const results = hybridSearch([1, 0, 0], "apple", chunks, { vectorWeight: 1, keywordWeight: 0, decayWeight: 0 });
    assert.ok(results.length > 0);
    assert.equal(results[0].chunk.id, "a"); // highest cosine similarity
  });

  it("keyword matching boosts relevant results", () => {
    const chunks = [
      makeChunk("a", "stripe payment processing", [0.5, 0.5, 0]),
      makeChunk("b", "quickbooks invoice system", [0.5, 0.5, 0]),
    ];

    // Same vectors, but keyword "stripe" should boost first result
    const results = hybridSearch([0.5, 0.5, 0], "stripe", chunks, { vectorWeight: 0.3, keywordWeight: 0.7, decayWeight: 0 });
    assert.equal(results[0].chunk.id, "a");
  });

  it("temporal decay reduces old daily entries", () => {
    const oldDate = "2025-01-01T00:00:00Z"; // >1 year ago
    const newDate = new Date().toISOString();

    const chunks = [
      makeChunk("old", "meeting notes", [1, 0], "daily", oldDate),
      makeChunk("new", "meeting notes", [1, 0], "daily", newDate),
    ];

    const results = hybridSearch([1, 0], "meeting", chunks, { vectorWeight: 0.3, keywordWeight: 0.3, decayWeight: 0.4 });
    assert.equal(results[0].chunk.id, "new"); // newer should rank higher
  });

  it("context source never decays", () => {
    const oldDate = "2020-01-01T00:00:00Z";
    const chunks = [
      makeChunk("ctx", "important decision", [1, 0], "context", oldDate),
      makeChunk("daily", "random note", [0.9, 0.1], "daily", oldDate),
    ];

    const results = hybridSearch([1, 0], "important", chunks, { decayWeight: 0.5, vectorWeight: 0.25, keywordWeight: 0.25 });
    // Context chunk should rank higher despite same age because it doesn't decay
    assert.equal(results[0].chunk.id, "ctx");
  });

  it("respects topK limit", () => {
    const chunks = Array.from({ length: 20 }, (_, i) =>
      makeChunk(`c${i}`, `chunk ${i}`, [Math.random()], "test")
    );
    const results = hybridSearch([0.5], "chunk", chunks, { topK: 3, minScore: 0 });
    assert.ok(results.length <= 3);
  });

  it("filters by minScore", () => {
    const chunks = [
      makeChunk("a", "relevant match", [1, 0], "test"),
      makeChunk("b", "completely unrelated xyz", [0, 1], "test"),
    ];
    const results = hybridSearch([1, 0], "relevant", chunks, { minScore: 0.3 });
    // Only the matching chunk should pass
    assert.ok(results.every(r => r.score >= 0.3));
  });
});

describe("formatSearchResults", () => {
  it("returns empty string for no results", () => {
    assert.equal(formatSearchResults([]), "");
  });

  it("formats results with date and source", () => {
    const results = [{
      chunk: makeChunk("a", "test memory", [1], "daily", "2026-03-15T12:00:00Z"),
      score: 0.8, vectorScore: 0.7, keywordScore: 0.9, decayFactor: 1,
    }];
    const formatted = formatSearchResults(results);
    assert.ok(formatted.includes("[Relevant Memories]"));
    assert.ok(formatted.includes("2026-03-15"));
    assert.ok(formatted.includes("daily"));
    assert.ok(formatted.includes("test memory"));
  });
});
