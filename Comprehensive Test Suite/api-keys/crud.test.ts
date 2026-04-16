/**
 * api-keys/crud.test.ts
 * End-to-end tests for the /api/auth/keys CRUD endpoints. These run against a
 * live gateway; tests skip gracefully when no service is up on localhost:4888.
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
  // If auth is enabled, we need a token. We read the first key from GET
  // /api/auth/keys but that itself requires auth — so as a bootstrap path
  // we try without auth first, and return empty headers if auth is off.
  const statusRes = await fetch(`${BASE}/api/auth/status`);
  if (!statusRes.ok) return {};
  const status = await statusRes.json() as { authEnabled: boolean };
  if (!status.authEnabled) return {};
  // With auth on, the test env expects MYAGENT_TEST_TOKEN to be exported.
  const token = process.env.MYAGENT_TEST_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

describe("GET /api/auth/keys", () => {
  it("returns an object with a keys array", async () => {
    if (!(await gatewayUp())) return;
    const headers = await authHeaders();
    const r = await fetch(`${BASE}/api/auth/keys`, { headers });
    if (r.status === 401) return; // auth on but no test token — skip
    if (r.status === 403) return; // sharedAgentsEnabled off — skip
    assert.ok(r.ok, `expected ok, got ${r.status}`);
    const data = await r.json() as { keys: unknown[] };
    assert.ok(Array.isArray(data.keys), "keys should be an array");
  });

  it("never returns the full secret, only a preview", async () => {
    if (!(await gatewayUp())) return;
    const headers = await authHeaders();
    const r = await fetch(`${BASE}/api/auth/keys`, { headers });
    if (r.status === 401) return;
    if (r.status === 403) return; // sharedAgentsEnabled off — skip
    if (!r.ok) return;
    const data = await r.json() as { keys: Array<{ preview: string; key?: string }> };
    for (const k of data.keys) {
      assert.equal((k as any).key, undefined, "full key must never appear in list response");
      assert.equal(typeof k.preview, "string", "preview must be a string");
      if (k.preview.length > 0) {
        assert.ok(k.preview.includes("..."), "preview should contain ellipsis");
      }
    }
  });
});

describe("POST /api/auth/keys", () => {
  it("400 when name is missing", async () => {
    if (!(await gatewayUp())) return;
    const headers = await authHeaders();
    const r = await fetch(`${BASE}/api/auth/keys`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (r.status === 401) return;
    if (r.status === 403) return; // sharedAgentsEnabled off — skip
    assert.equal(r.status, 400, "missing name should be rejected");
  });

  it("creates a key, returns the full secret exactly once, then hides it", async () => {
    if (!(await gatewayUp())) return;
    const headers = await authHeaders();
    const label = `test-${Date.now()}`;
    const createRes = await fetch(`${BASE}/api/auth/keys`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ name: label }),
    });
    if (createRes.status === 401) return;
    if (createRes.status === 403) return; // sharedAgentsEnabled off — skip
    assert.ok(createRes.ok, `create should succeed, got ${createRes.status}`);
    const created = await createRes.json() as { key: { id: string; name: string; key: string } };
    assert.equal(created.key.name, label);
    assert.ok(created.key.key.startsWith("mai41team_"), "new keys must use mai41team_ prefix");

    // Now list — the full secret should not be re-exposed
    const listRes = await fetch(`${BASE}/api/auth/keys`, { headers });
    assert.ok(listRes.ok);
    const listed = await listRes.json() as { keys: Array<{ id: string; preview: string }> };
    const mine = listed.keys.find(k => k.id === created.key.id);
    assert.ok(mine, "newly created key should appear in list");
    assert.ok(!(mine as any).key, "list never exposes full secret");

    // Cleanup — revoke the test key
    await fetch(`${BASE}/api/auth/keys/${created.key.id}`, { method: "DELETE", headers });
  });
});

describe("DELETE /api/auth/keys/:id", () => {
  it("404 on unknown id", async () => {
    if (!(await gatewayUp())) return;
    const headers = await authHeaders();
    const r = await fetch(`${BASE}/api/auth/keys/key_does_not_exist_xyz`, {
      method: "DELETE",
      headers,
    });
    if (r.status === 401) return;
    if (r.status === 403) return; // sharedAgentsEnabled off — skip
    assert.equal(r.status, 404);
  });

  it("refuses to delete the last remaining key", async () => {
    if (!(await gatewayUp())) return;
    const headers = await authHeaders();
    const listRes = await fetch(`${BASE}/api/auth/keys`, { headers });
    if (!listRes.ok) return;
    const listed = await listRes.json() as { keys: Array<{ id: string }> };
    if (listed.keys.length !== 1) return; // only meaningful when there's exactly one
    const r = await fetch(`${BASE}/api/auth/keys/${listed.keys[0].id}`, {
      method: "DELETE",
      headers,
    });
    assert.equal(r.status, 400, "last-key delete should be refused");
  });
});
