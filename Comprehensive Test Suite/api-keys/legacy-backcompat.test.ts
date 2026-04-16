/**
 * api-keys/legacy-backcompat.test.ts
 * Unit tests for matchToken() in src/auth-helper.ts — verifies the fallback
 * path for legacy auth.tokens[] still works so installs that haven't migrated
 * to apiKeys[] remain functional.
 *
 * These run in-process (no service required) because the helper is a pure
 * function over the AppConfig object.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchToken, isAuthEnabled, extractBearer } from "../../src/auth-helper.js";
import type { AppConfig } from "../../src/config.js";

function mkConfig(overrides: Partial<any> = {}): AppConfig {
  return {
    service: {
      auth: { enabled: true, tokens: ["legacy-token-abc"], ...(overrides.auth ?? {}) },
      apiKeys: overrides.apiKeys ?? [],
    } as any,
    agents: {},
    mcps: {},
    channels: {},
    routes: [],
  } as unknown as AppConfig;
}

describe("matchToken: legacy auth.tokens[] backcompat", () => {
  it("returns a synthesized ApiKey for a matching legacy token", () => {
    const config = mkConfig();
    const hit = matchToken(config, "legacy-token-abc");
    assert.ok(hit, "matchToken should return a record for legacy tokens");
    assert.equal(hit?.id, "legacy");
    assert.equal(hit?.key, "legacy-token-abc");
    assert.deepEqual(hit?.scopes, ["*"]);
  });

  it("returns null for a token present in neither apiKeys[] nor auth.tokens[]", () => {
    const config = mkConfig();
    assert.equal(matchToken(config, "not-a-real-token"), null);
  });

  it("returns null when token is null/undefined/empty", () => {
    const config = mkConfig();
    assert.equal(matchToken(config, null), null);
    assert.equal(matchToken(config, ""), null);
  });

  it("prefers apiKeys[] over legacy when both contain the same token", () => {
    const config = mkConfig({
      apiKeys: [{
        id: "key_real",
        name: "Real Key",
        key: "shared-value",
        createdAt: new Date().toISOString(),
        scopes: ["*"],
      }],
      auth: { enabled: true, tokens: ["shared-value"] },
    });
    const hit = matchToken(config, "shared-value");
    assert.equal(hit?.id, "key_real", "apiKeys[] match should win");
  });

  it("stamps lastUsedAt on the in-memory apiKeys[] record when matched", () => {
    const config = mkConfig({
      apiKeys: [{
        id: "key_stamp",
        name: "Stamp Test",
        key: "stamp-me",
        createdAt: new Date(0).toISOString(),
        scopes: ["*"],
      }],
    });
    const before = ((config.service as any).apiKeys[0] as any).lastUsedAt;
    const hit = matchToken(config, "stamp-me");
    const after = ((config.service as any).apiKeys[0] as any).lastUsedAt;
    assert.ok(hit);
    assert.notEqual(after, before, "lastUsedAt should have been updated");
    assert.ok(typeof after === "string" && after.length > 0, "lastUsedAt should be ISO string");
  });
});

describe("isAuthEnabled", () => {
  it("returns true when service.auth.enabled is true", () => {
    const config = mkConfig({ auth: { enabled: true, tokens: [] } });
    assert.equal(isAuthEnabled(config), true);
  });

  it("returns false when service.auth.enabled is false", () => {
    const config = mkConfig({ auth: { enabled: false, tokens: [] } });
    assert.equal(isAuthEnabled(config), false);
  });

  it("returns false when service.auth is undefined", () => {
    const config = { service: {} as any, agents: {}, mcps: {}, channels: {}, routes: [] } as unknown as AppConfig;
    assert.equal(isAuthEnabled(config), false);
  });
});

describe("extractBearer", () => {
  it("extracts the token from a valid Bearer header", () => {
    assert.equal(extractBearer("Bearer abc123"), "abc123");
  });

  it("returns null for null or undefined", () => {
    assert.equal(extractBearer(null), null);
    assert.equal(extractBearer(undefined), null);
  });

  it("returns null for a header not in Bearer form", () => {
    assert.equal(extractBearer("Basic abc123"), null);
    assert.equal(extractBearer("abc123"), null);
  });

  it("preserves trailing whitespace in the token (caller's responsibility to trim)", () => {
    // Intentional: the helper is a pure string slicer; it doesn't sanitize.
    assert.equal(extractBearer("Bearer abc "), "abc ");
  });
});
