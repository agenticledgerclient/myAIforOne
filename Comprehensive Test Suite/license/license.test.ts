import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import {
  verifyLicense,
  getLicense,
  checkLicenseForExecution,
  checkLicenseNoCache,
} from "../../src/license.js";

/**
 * Spin up a tiny mock license server whose /api/license/verify response
 * we can swap per-test. Returning a non-2xx status simulates a malfunctioning
 * server; refusing to respond simulates unreachable.
 */
type MockMode =
  | { kind: "valid"; features?: Record<string, boolean | number> }
  | { kind: "invalid"; error?: string }
  | { kind: "http500" }
  | { kind: "garbage" }
  | { kind: "hang" };

let mockMode: MockMode = { kind: "valid" };
let server: Server | null = null;
let baseUrl = "";

async function startMockServer(): Promise<void> {
  server = createServer((req, res) => {
    if (req.url !== "/api/license/verify" || req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    switch (mockMode.kind) {
      case "valid":
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            valid: true,
            org: "test-org",
            name: "Test",
            features: mockMode.features ?? { gym: true },
            expiresAt: "2099-01-01T00:00:00.000Z",
          })
        );
        return;
      case "invalid":
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            valid: false,
            error: mockMode.error ?? "expired",
          })
        );
        return;
      case "http500":
        res.writeHead(500).end("boom");
        return;
      case "garbage":
        res.writeHead(200, { "content-type": "application/json" });
        res.end("not-json-at-all");
        return;
      case "hang":
        // Never respond — the client's AbortSignal.timeout should fire.
        return;
    }
  });
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      if (addr && typeof addr === "object") {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
}

async function stopMockServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
}

describe("verifyLicense", () => {
  beforeEach(async () => {
    await startMockServer();
  });
  afterEach(async () => {
    await stopMockServer();
  });

  it("returns unlicensed pass-through when no key is configured", async () => {
    const result = await verifyLicense(undefined, baseUrl);
    assert.equal(result.valid, true);
    assert.equal(result.unlicensed, true);
    assert.equal(result.graceMode, undefined);
    assert.equal(checkLicenseForExecution(), null);
  });

  it("caches a valid license returned by the server", async () => {
    mockMode = { kind: "valid", features: { gym: true, maxAgents: 42 } };
    const result = await verifyLicense("KEY-123", baseUrl);
    assert.equal(result.valid, true);
    assert.equal(result.graceMode, undefined);
    assert.equal(result.org, "test-org");
    assert.deepEqual(result.features, { gym: true, maxAgents: 42 });
    assert.equal(checkLicenseForExecution(), null);
    assert.equal(getLicense()?.valid, true);
  });

  it("blocks execution when the server says the license is invalid", async () => {
    mockMode = { kind: "invalid", error: "expired" };
    const result = await verifyLicense("KEY-123", baseUrl);
    assert.equal(result.valid, false);
    assert.equal(result.graceMode, undefined);
    const block = checkLicenseForExecution();
    assert.ok(block, "execution should be blocked");
    assert.match(block!, /expired/);
  });

  it("enters grace mode when the server is unreachable", async () => {
    // Point at a closed port that definitely won't accept connections.
    const result = await verifyLicense("KEY-123", "http://127.0.0.1:1");
    assert.equal(result.valid, true);
    assert.equal(result.graceMode, true);
    assert.match(result.error ?? "", /grace mode/);
    // Grace mode allows execution.
    assert.equal(checkLicenseForExecution(), null);
  });

  it("enters grace mode when the server returns HTTP 500", async () => {
    mockMode = { kind: "http500" };
    const result = await verifyLicense("KEY-123", baseUrl);
    assert.equal(result.valid, true);
    assert.equal(result.graceMode, true);
    assert.equal(checkLicenseForExecution(), null);
  });

  it("enters grace mode when the server returns malformed JSON", async () => {
    mockMode = { kind: "garbage" };
    const result = await verifyLicense("KEY-123", baseUrl);
    assert.equal(result.valid, true);
    assert.equal(result.graceMode, true);
  });

  it("exits grace mode when a subsequent verify succeeds", async () => {
    // First call: unreachable → grace.
    let result = await verifyLicense("KEY-123", "http://127.0.0.1:1");
    assert.equal(result.graceMode, true);

    // Second call: server valid → grace cleared.
    mockMode = { kind: "valid" };
    result = await verifyLicense("KEY-123", baseUrl);
    assert.equal(result.valid, true);
    assert.equal(result.graceMode, undefined);
  });

  it("checkLicenseNoCache does not mutate the cached license (valid key)", async () => {
    // Prime the cache with an invalid state first.
    mockMode = { kind: "invalid", error: "expired" };
    await verifyLicense("OLD-KEY", baseUrl);
    const cachedBefore = getLicense();
    assert.equal(cachedBefore?.valid, false);

    // Dry-run a valid key → should return valid but NOT overwrite cache.
    mockMode = { kind: "valid" };
    const result = await checkLicenseNoCache("NEW-KEY", baseUrl);
    assert.equal(result.valid, true);
    assert.equal(result.org, "test-org");
    assert.equal(getLicense()?.valid, false, "cache should remain untouched");
  });

  it("checkLicenseNoCache returns unreachable flag when server is down", async () => {
    const result = await checkLicenseNoCache("KEY-123", "http://127.0.0.1:1");
    assert.equal(result.valid, false);
    assert.equal(result.unreachable, true);
    assert.match(result.error ?? "", /reach/);
  });

  it("checkLicenseNoCache returns invalid (not unreachable) when server says no", async () => {
    mockMode = { kind: "invalid", error: "expired" };
    const result = await checkLicenseNoCache("KEY-123", baseUrl);
    assert.equal(result.valid, false);
    assert.equal(result.unreachable, undefined);
    assert.match(result.error ?? "", /expired/);
  });

  it("exits grace mode into LOCKED state when server later says invalid", async () => {
    // First call: unreachable → grace.
    let result = await verifyLicense("KEY-123", "http://127.0.0.1:1");
    assert.equal(result.graceMode, true);
    assert.equal(checkLicenseForExecution(), null);

    // Second call: server says invalid → blocked.
    mockMode = { kind: "invalid", error: "revoked" };
    result = await verifyLicense("KEY-123", baseUrl);
    assert.equal(result.valid, false);
    assert.equal(result.graceMode, undefined);
    const block = checkLicenseForExecution();
    assert.ok(block);
    assert.match(block!, /revoked/);
  });
});
