import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitText } from "../../src/channels/types.js";

describe("splitText", () => {
  it("returns single chunk for short text", () => {
    const result = splitText("hello", 100);
    assert.deepEqual(result, ["hello"]);
  });

  it("splits at newline boundary", () => {
    const text = "line1\nline2\nline3";
    const result = splitText(text, 10);
    assert.ok(result.length >= 2, `Expected at least 2 chunks, got ${result.length}`);
    assert.ok(result[0].length <= 10, `First chunk should be <= 10 chars`);
  });

  it("handles text exactly at limit", () => {
    const text = "12345";
    const result = splitText(text, 5);
    assert.deepEqual(result, ["12345"]);
  });

  it("handles empty text", () => {
    const result = splitText("", 100);
    assert.equal(result.length, 0);
  });

  it("splits long text without newlines at maxLen", () => {
    const text = "a".repeat(200);
    const result = splitText(text, 100);
    assert.equal(result.length, 2);
    assert.equal(result[0].length, 100);
    assert.equal(result[1].length, 100);
  });

  it("prefers newline split near end of chunk", () => {
    const text = "a".repeat(80) + "\n" + "b".repeat(20);
    const result = splitText(text, 100);
    // Should split at the newline (position 80) since it's > 50% of maxLen
    assert.equal(result[0], "a".repeat(80));
  });
});
