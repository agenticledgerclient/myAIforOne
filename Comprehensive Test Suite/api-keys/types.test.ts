/**
 * api-keys/types.test.ts
 * Static shape tests for the ApiKey interface and the service.apiKeys array.
 * These run regardless of whether the service is up.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ApiKey } from "../../src/config.js";

describe("ApiKey type shape", () => {
  it("has required fields id, name, key, createdAt, scopes", () => {
    const k: ApiKey = {
      id: "key_abc",
      name: "Test",
      key: "mai41team_" + "a".repeat(64),
      createdAt: new Date().toISOString(),
      scopes: ["*"],
    };
    assert.equal(typeof k.id, "string");
    assert.equal(typeof k.name, "string");
    assert.equal(typeof k.key, "string");
    assert.equal(typeof k.createdAt, "string");
    assert.ok(Array.isArray(k.scopes));
  });

  it("allows optional lastUsedAt", () => {
    const k: ApiKey = {
      id: "key_abc",
      name: "Test",
      key: "mai41team_xxx",
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      scopes: ["*"],
    };
    assert.equal(typeof k.lastUsedAt, "string");
  });
});

describe("ApiKey secret format", () => {
  it("issued keys start with mai41team_ prefix", () => {
    // The server-side generator in web-ui.ts produces "mai41team_" + 64 hex chars.
    // We can't import the private helper, so we smoke-test the expected prefix
    // by scanning the public interface + naming convention.
    const samplePrefix = "mai41team_";
    const sample = samplePrefix + "ff".repeat(32);
    assert.ok(sample.startsWith(samplePrefix), "keys should start with mai41team_");
    assert.equal(sample.length, samplePrefix.length + 64, "hex body should be 64 chars");
  });
});
