import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseVoiceSpec, formatVoiceSpec } from "../../src/voice/types.js";

/**
 * Voice spec parser/formatter tests.
 *
 * A voice spec is a string of one of these forms:
 *   - "browser"               provider only
 *   - "grok"                  provider only
 *   - "grok:Ara"              provider + voiceId
 *   - "elevenlabs:rachel"     provider + voiceId
 */

describe("voice — parseVoiceSpec", () => {
  it("returns null for empty/undefined/null input", () => {
    assert.equal(parseVoiceSpec(undefined), null);
    assert.equal(parseVoiceSpec(null), null);
    assert.equal(parseVoiceSpec(""), null);
    assert.equal(parseVoiceSpec("   "), null);
  });

  it("parses provider-only spec", () => {
    assert.deepEqual(parseVoiceSpec("browser"), { providerId: "browser" });
    assert.deepEqual(parseVoiceSpec("grok"), { providerId: "grok" });
    assert.deepEqual(parseVoiceSpec("  grok  "), { providerId: "grok" });
  });

  it("parses provider:voiceId spec", () => {
    assert.deepEqual(parseVoiceSpec("grok:Ara"), { providerId: "grok", voiceId: "Ara" });
    assert.deepEqual(parseVoiceSpec("elevenlabs:rachel"), { providerId: "elevenlabs", voiceId: "rachel" });
  });

  it("treats trailing colon as provider-only (no voiceId)", () => {
    assert.deepEqual(parseVoiceSpec("grok:"), { providerId: "grok", voiceId: undefined });
  });

  it("preserves voiceId case (Ara vs ara)", () => {
    assert.equal(parseVoiceSpec("grok:Ara")?.voiceId, "Ara");
    assert.equal(parseVoiceSpec("grok:ara")?.voiceId, "ara");
  });
});

describe("voice — formatVoiceSpec", () => {
  it("returns provider only when no voiceId", () => {
    assert.equal(formatVoiceSpec("browser"), "browser");
    assert.equal(formatVoiceSpec("grok"), "grok");
  });

  it("joins provider and voiceId with a colon", () => {
    assert.equal(formatVoiceSpec("grok", "Ara"), "grok:Ara");
    assert.equal(formatVoiceSpec("elevenlabs", "rachel"), "elevenlabs:rachel");
  });

  it("round-trips parse → format", () => {
    const specs = ["browser", "grok", "grok:Ara", "elevenlabs:rachel"];
    for (const spec of specs) {
      const parsed = parseVoiceSpec(spec)!;
      const reformatted = formatVoiceSpec(parsed.providerId, parsed.voiceId);
      assert.equal(reformatted, spec);
    }
  });
});
