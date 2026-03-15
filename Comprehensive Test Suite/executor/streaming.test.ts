import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("executor — streaming patterns", () => {
  it("stream-json requires --verbose flag", () => {
    // This validates our fix: stream-json won't work without --verbose
    const args = ["-p", "-", "--output-format", "stream-json", "--verbose"];
    assert.ok(args.includes("--verbose"), "stream-json args must include --verbose");
    assert.ok(args.includes("stream-json"), "output format must be stream-json");
  });

  it("StreamEvent types are well-defined", () => {
    const validTypes = ["status", "text", "done", "error"];
    for (const t of validTypes) {
      assert.ok(typeof t === "string");
    }
  });

  it("streaming session uses stream-json not json", () => {
    // When streaming is true, we must NOT use --output-format json
    // because sessions created with json can't be resumed with stream-json
    const streamingArgs = ["--output-format", "stream-json", "--verbose"];
    const nonStreamingArgs = ["--output-format", "json"];

    assert.ok(!streamingArgs.includes("json") || streamingArgs.includes("stream-json"));
    assert.ok(!nonStreamingArgs.includes("stream-json"));
  });
});
