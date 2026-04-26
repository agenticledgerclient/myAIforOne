import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { browserProvider } from "../../src/voice/providers/browser.js";
import { createGrokProvider } from "../../src/voice/providers/grok.js";

/**
 * Voice provider tests.
 *
 * Browser provider — no real audio, but it should advertise itself as
 * client-side and refuse server-side tts/stt calls.
 *
 * Grok provider — uses a mocked global fetch so we don't hit xAI.
 */

describe("voice — browser provider", () => {
  it("is always configured (no key required)", () => {
    assert.equal(browserProvider.isConfigured(), true);
  });

  it("is marked as client-side, not server-side", () => {
    assert.equal(browserProvider.serverSide, false);
  });

  it("exposes at least one voice and a default", () => {
    assert.ok(browserProvider.listVoices().length >= 1);
    assert.ok(browserProvider.defaultVoice());
  });

  it("tts() throws — must be handled client-side", async () => {
    await assert.rejects(() => browserProvider.tts(""), /client-side/);
  });

  it("stt() throws — must be handled client-side", async () => {
    await assert.rejects(() => browserProvider.stt(Buffer.alloc(0)), /client-side/);
  });
});

describe("voice — grok provider (mocked fetch)", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("is unconfigured when no key", () => {
    const grok = createGrokProvider({ getApiKey: () => undefined });
    assert.equal(grok.isConfigured(), false);
  });

  it("is configured when key is present", () => {
    const grok = createGrokProvider({ getApiKey: () => "xai-key" });
    assert.equal(grok.isConfigured(), true);
  });

  it("lists 5 grok voices including Ara/Eve/Leo/Rex/Sal", () => {
    const grok = createGrokProvider({ getApiKey: () => undefined });
    const voiceIds = grok.listVoices().map(v => v.id);
    for (const id of ["ara", "eve", "leo", "rex", "sal"]) {
      assert.ok(voiceIds.includes(id), `expected voice id ${id} to be present, got ${voiceIds.join(",")}`);
    }
  });

  it("default voice is 'ara'", () => {
    const grok = createGrokProvider({ getApiKey: () => "x" });
    assert.equal(grok.defaultVoice(), "ara");
  });

  it("tts() throws when key missing", async () => {
    const grok = createGrokProvider({ getApiKey: () => undefined });
    await assert.rejects(() => grok.tts("hi"), /not configured/);
  });

  it("tts() throws on empty text", async () => {
    const grok = createGrokProvider({ getApiKey: () => "x" });
    await assert.rejects(() => grok.tts(""), /text is required/);
  });

  it("tts() POSTs to xAI and returns audio buffer + characters", async () => {
    let captured: { url: string; init: any } | null = null;
    globalThis.fetch = (async (url: string, init: any) => {
      captured = { url: String(url), init };
      const audio = new Uint8Array([0x49, 0x44, 0x33, 0x04]); // fake mp3 magic
      return new Response(audio, { status: 200, headers: { "content-type": "audio/mpeg" } });
    }) as any;

    const grok = createGrokProvider({ getApiKey: () => "xai-test" });
    const result = await grok.tts("hello world", { voiceId: "Eve" });

    assert.ok(captured, "fetch was not called");
    assert.match(captured!.url, /api\.x\.ai\/v1\/tts/);
    const body = JSON.parse(captured!.init.body);
    // voice id is normalized to lowercase
    assert.equal(body.voice_id, "eve");
    assert.equal(body.text, "hello world");
    assert.equal(captured!.init.headers["Authorization"], "Bearer xai-test");
    assert.equal(result.format, "mp3");
    assert.equal(result.characters, "hello world".length);
    assert.ok(result.audio.length > 0);
  });

  it("tts() truncates input to 15k chars", async () => {
    let captured: { init: any } | null = null;
    globalThis.fetch = (async (_url: string, init: any) => {
      captured = { init };
      return new Response(new Uint8Array([1, 2]), { status: 200 });
    }) as any;

    const grok = createGrokProvider({ getApiKey: () => "k" });
    const huge = "a".repeat(20_000);
    const result = await grok.tts(huge);
    const body = JSON.parse(captured!.init.body);
    assert.equal(body.text.length, 15_000);
    assert.equal(result.characters, 15_000);
  });

  it("tts() bubbles up xAI error responses", async () => {
    globalThis.fetch = (async () => {
      return new Response("rate limit exceeded", { status: 429, statusText: "Too Many Requests" });
    }) as any;
    const grok = createGrokProvider({ getApiKey: () => "k" });
    await assert.rejects(() => grok.tts("hi"), /Grok TTS failed: 429/);
  });

  it("stt() throws when key missing", async () => {
    const grok = createGrokProvider({ getApiKey: () => undefined });
    await assert.rejects(() => grok.stt(Buffer.from([1, 2, 3])), /not configured/);
  });

  it("stt() throws on empty audio", async () => {
    const grok = createGrokProvider({ getApiKey: () => "x" });
    await assert.rejects(() => grok.stt(Buffer.alloc(0)), /audio is required/);
  });

  it("stt() POSTs multipart to xAI and returns text", async () => {
    let captured: { url: string; init: any } | null = null;
    globalThis.fetch = (async (url: string, init: any) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({ text: "hello there", language: "en", duration: 1.2 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as any;

    const grok = createGrokProvider({ getApiKey: () => "xai-test" });
    const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]); // fake webm magic
    const result = await grok.stt(audio, { language: "en", mimeType: "audio/webm" });

    assert.match(captured!.url, /api\.x\.ai\/v1\/stt/);
    assert.equal(captured!.init.method, "POST");
    assert.equal(captured!.init.headers["Authorization"], "Bearer xai-test");
    // body is FormData — just check it exists
    assert.ok(captured!.init.body);
    assert.equal(result.text, "hello there");
    assert.equal(result.language, "en");
    assert.equal(result.durationSeconds, 1.2);
  });

  it("stt() bubbles up xAI error responses", async () => {
    globalThis.fetch = (async () => {
      return new Response("invalid audio", { status: 400, statusText: "Bad Request" });
    }) as any;
    const grok = createGrokProvider({ getApiKey: () => "k" });
    await assert.rejects(() => grok.stt(Buffer.from([1])), /Grok STT failed: 400/);
  });
});
