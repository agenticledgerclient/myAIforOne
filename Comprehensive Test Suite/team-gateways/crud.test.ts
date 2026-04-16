/**
 * team-gateways/crud.test.ts
 * End-to-end tests for /api/team-gateways CRUD + test endpoint. Skips when no
 * gateway is running on localhost:4888.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4888";

async function gatewayUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

async function authHeaders(): Promise<Record<string, string>> {
  const statusRes = await fetch(`${BASE}/api/auth/status`);
  if (!statusRes.ok) return {};
  const status = await statusRes.json() as { authEnabled: boolean };
  if (!status.authEnabled) return {};
  const token = process.env.MYAGENT_TEST_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

describe("GET /api/team-gateways", () => {
  it("returns an object with a gateways array", async () => {
    if (!(await gatewayUp())) return;
    const headers = await authHeaders();
    const r = await fetch(`${BASE}/api/team-gateways`, { headers });
    if (r.status === 401) return;
    assert.ok(r.ok, `expected ok, got ${r.status}`);
    const data = await r.json() as { gateways: unknown[] };
    assert.ok(Array.isArray(data.gateways));
  });
});

describe("POST /api/team-gateways/test", () => {
  it("400 when url or apiKey missing", async () => {
    if (!(await gatewayUp())) return;
    const headers = await authHeaders();
    const r = await fetch(`${BASE}/api/team-gateways/test`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    if (r.status === 401) return;
    assert.equal(r.status, 400);
  });

  it("reports connection failure for a clearly bogus URL", async () => {
    if (!(await gatewayUp())) return;
    const headers = await authHeaders();
    const r = await fetch(`${BASE}/api/team-gateways/test`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://this-domain-does-not-exist-abc123xyz.invalid",
        apiKey: "mai41team_fake",
      }),
    });
    if (r.status === 401) return;
    // We expect the gateway to report a 4xx (probe returned !ok) — anything
    // other than a 200 "ok:true" means the validation did its job.
    if (r.ok) {
      const data = await r.json() as { ok: boolean };
      assert.equal(data.ok, false, "probe to nonexistent domain must not report ok:true");
    } else {
      assert.ok(r.status >= 400 && r.status < 500, "expect 4xx on probe failure");
    }
  });
});

describe("POST /api/team-gateways", () => {
  it("400 on missing fields", async () => {
    if (!(await gatewayUp())) return;
    const headers = await authHeaders();
    const r = await fetch(`${BASE}/api/team-gateways`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "No URL" }),
    });
    if (r.status === 401) return;
    assert.equal(r.status, 400);
  });

  it("refuses to save a gateway that fails the probe", async () => {
    if (!(await gatewayUp())) return;
    const headers = await authHeaders();
    const r = await fetch(`${BASE}/api/team-gateways`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "bogus-test-" + Date.now(),
        url: "https://this-host-does-not-exist-xyz.invalid",
        apiKey: "mai41team_fake",
      }),
    });
    if (r.status === 401) return;
    assert.ok(!r.ok, "POST should reject unreachable gateway before save");
  });
});

describe("DELETE /api/team-gateways/:id", () => {
  it("404 on unknown id", async () => {
    if (!(await gatewayUp())) return;
    const headers = await authHeaders();
    const r = await fetch(`${BASE}/api/team-gateways/doesnotexistxyz`, {
      method: "DELETE",
      headers,
    });
    if (r.status === 401) return;
    assert.equal(r.status, 404);
  });
});
