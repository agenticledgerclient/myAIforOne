import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity, buildVocab, getEmbeddingProvider } from "../../src/memory/embeddings.js";

describe("embeddings — TF-IDF local", () => {
  it("produces non-zero vectors for text", async () => {
    const provider = getEmbeddingProvider();
    // TF-IDF if no OPENAI_API_KEY, OpenAI if present
    assert.ok(provider.name === "tfidf-local" || provider.name === "openai-text-embedding-3-small");

    const vec = await provider.embed("hello world test");
    assert.ok(vec.length > 0, "Vector should have dimensions");
    assert.ok(vec.some(v => v !== 0), "Vector should have non-zero values");
  });

  it("embedBatch returns one vector per text", async () => {
    const provider = getEmbeddingProvider();
    const vecs = await provider.embedBatch(["hello", "world", "test"]);
    assert.equal(vecs.length, 3);
    for (const v of vecs) {
      assert.ok(v.length > 0);
    }
  });

  it("similar texts have higher cosine similarity", async () => {
    const provider = getEmbeddingProvider();
    buildVocab(["quickbooks invoice accounting", "stripe payment processing", "invoice billing accounting"]);
    const vecs = await provider.embedBatch([
      "quickbooks invoice accounting",
      "invoice billing accounting",
      "stripe payment processing",
    ]);

    const simSame = cosineSimilarity(vecs[0], vecs[1]); // both about invoices
    const simDiff = cosineSimilarity(vecs[0], vecs[2]); // invoices vs payments

    assert.ok(simSame > simDiff, `Similar texts (${simSame.toFixed(3)}) should score higher than different (${simDiff.toFixed(3)})`);
  });
});

describe("cosine similarity", () => {
  it("identical vectors return 1", () => {
    const v = [0.5, 0.3, 0.8];
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 0.001);
  });

  it("orthogonal vectors return 0", () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 0.001);
  });

  it("handles empty vectors", () => {
    assert.equal(cosineSimilarity([], []), 0);
  });

  it("handles mismatched dimensions", () => {
    const sim = cosineSimilarity([1, 0, 0], [1, 0]);
    assert.ok(typeof sim === "number");
    assert.ok(!isNaN(sim));
  });
});
