import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildVoiceRegistry } from "../../src/voice/registry.js";
import type { AppConfig } from "../../src/config.js";

/**
 * Voice registry resolution tests.
 *
 * Verifies the override → platform default → fallback chain that determines
 * which provider/voice an agent uses at runtime.
 */

function makeConfig(overrides: Partial<AppConfig["service"]> = {}, agents: Record<string, any> = {}): AppConfig {
  return {
    service: {
      personalAgentsDir: "/tmp/agents",
      personalRegistryDir: "/tmp/registry",
      logLevel: "info",
      ...overrides,
    } as any,
    agents,
    channels: {} as any,
    mcps: {} as any,
  } as AppConfig;
}

describe("voice — registry resolve()", () => {
  it("falls back to browser when nothing is configured", () => {
    const reg = buildVoiceRegistry(makeConfig());
    const { provider, voiceId } = reg.resolve();
    assert.equal(provider.id, "browser");
    assert.equal(voiceId, undefined);
  });

  it("uses platform default when set and configured", () => {
    const reg = buildVoiceRegistry(makeConfig({
      platformDefaultVoice: "browser",
    } as any));
    const { provider } = reg.resolve();
    assert.equal(provider.id, "browser");
  });

  it("falls back to browser when platform default points at unconfigured grok", () => {
    // No xai key — grok is unconfigured, so we fall back to browser.
    const reg = buildVoiceRegistry(makeConfig({
      platformDefaultVoice: "grok:Ara",
    } as any));
    const { provider, voiceId } = reg.resolve();
    assert.equal(provider.id, "browser");
    // voiceId from the override should be dropped because we fell back to a different provider
    assert.equal(voiceId, undefined);
  });

  it("uses grok when platform default is grok and key is configured", () => {
    const reg = buildVoiceRegistry(makeConfig({
      platformDefaultVoice: "grok:Ara",
      providerKeys: { xai: "xai-test-key" },
    } as any));
    const { provider, voiceId } = reg.resolve();
    assert.equal(provider.id, "grok");
    assert.equal(voiceId, "Ara");
  });

  it("agent override beats platform default", () => {
    const reg = buildVoiceRegistry(makeConfig(
      {
        platformDefaultVoice: "browser",
        providerKeys: { xai: "xai-test-key" },
      } as any,
      {
        myagent: { name: "myagent", voice: "grok:Eve" } as any,
      },
    ));
    const { provider, voiceId } = reg.resolve("myagent");
    assert.equal(provider.id, "grok");
    assert.equal(voiceId, "Eve");
  });

  it("agent override falls back when its provider isn't configured", () => {
    // Agent says grok:Eve, but no xai key set. Should fall back to browser
    // and drop the voiceId (Eve isn't a browser voice).
    const reg = buildVoiceRegistry(makeConfig(
      { platformDefaultVoice: "browser" } as any,
      {
        myagent: { name: "myagent", voice: "grok:Eve" } as any,
      },
    ));
    const { provider, voiceId } = reg.resolve("myagent");
    assert.equal(provider.id, "browser");
    assert.equal(voiceId, undefined);
  });

  it("missing agent uses platform default", () => {
    const reg = buildVoiceRegistry(makeConfig({
      platformDefaultVoice: "browser",
    } as any));
    const { provider } = reg.resolve("does-not-exist");
    assert.equal(provider.id, "browser");
  });
});

describe("voice — registry list/get", () => {
  it("lists browser and grok providers", () => {
    const reg = buildVoiceRegistry(makeConfig());
    const ids = reg.list().map(p => p.id).sort();
    assert.deepEqual(ids, ["browser", "grok"]);
  });

  it("get() returns the requested provider or undefined", () => {
    const reg = buildVoiceRegistry(makeConfig());
    assert.equal(reg.get("browser")?.id, "browser");
    assert.equal(reg.get("grok")?.id, "grok");
    assert.equal(reg.get("nope"), undefined);
  });

  it("browser provider is always configured", () => {
    const reg = buildVoiceRegistry(makeConfig());
    assert.equal(reg.get("browser")?.isConfigured(), true);
  });

  it("grok provider is unconfigured without xai key", () => {
    const reg = buildVoiceRegistry(makeConfig());
    assert.equal(reg.get("grok")?.isConfigured(), false);
  });

  it("grok provider becomes configured when xai key is set on the live config", () => {
    const cfg = makeConfig();
    const reg = buildVoiceRegistry(cfg);
    assert.equal(reg.get("grok")?.isConfigured(), false);
    // Mutate config — registry reads key lazily, so this should flip immediately
    (cfg.service as any).providerKeys = { xai: "xai-key" };
    assert.equal(reg.get("grok")?.isConfigured(), true);
  });
});

describe("voice — registry snapshot()", () => {
  it("disabled by default with browser as fallback default", () => {
    const reg = buildVoiceRegistry(makeConfig());
    const snap = reg.snapshot();
    assert.equal(snap.enabled, false);
    assert.equal(snap.defaultProvider, "browser");
    assert.equal(snap.autoPlay, false);
    assert.equal(snap.maxChars, 2000);
  });

  it("reflects voiceModeEnabled and platformDefaultVoice settings", () => {
    const reg = buildVoiceRegistry(makeConfig({
      voiceModeEnabled: true,
      platformDefaultVoice: "grok:Ara",
      voiceAutoPlay: true,
      voiceMaxChars: 500,
    } as any));
    const snap = reg.snapshot();
    assert.equal(snap.enabled, true);
    assert.equal(snap.defaultProvider, "grok");
    assert.equal(snap.defaultVoiceId, "Ara");
    assert.equal(snap.autoPlay, true);
    assert.equal(snap.maxChars, 500);
  });

  it("snapshot.providers includes voices and configured flag", () => {
    const reg = buildVoiceRegistry(makeConfig({
      providerKeys: { xai: "xai-key" },
    } as any));
    const snap = reg.snapshot();
    const grok = snap.providers.find(p => p.id === "grok")!;
    assert.equal(grok.configured, true);
    assert.equal(grok.serverSide, true);
    assert.ok(grok.voices.length >= 5, "grok should expose 5+ voices");
    const browser = snap.providers.find(p => p.id === "browser")!;
    assert.equal(browser.serverSide, false);
    assert.equal(browser.configured, true);
  });

  it("snapshot never includes the API key", () => {
    const reg = buildVoiceRegistry(makeConfig({
      providerKeys: { xai: "xai-secret-do-not-leak" },
    } as any));
    const snap = reg.snapshot();
    const json = JSON.stringify(snap);
    assert.equal(json.includes("xai-secret-do-not-leak"), false);
  });
});
