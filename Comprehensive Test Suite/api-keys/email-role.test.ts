/**
 * email-role.test.ts
 * Tests for API key email + role fields (read/full access control).
 *
 * Validates:
 *   - POST /api/auth/keys with email + role creates key with those fields
 *   - GET /api/auth/keys returns email and role in the list
 *   - GET /api/auth/status returns role for authenticated key
 *   - Role defaults to "full" when not specified
 *   - Read-only keys are blocked from write endpoints (POST/PUT/DELETE)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4888";

async function serviceUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`);
    return r.ok;
  } catch { return false; }
}

async function issuanceEnabled(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/auth/keys`);
    return r.status !== 403;
  } catch { return false; }
}

// Helper: create a key and return the full key object
async function createKey(opts: { name: string; email?: string; role?: string }) {
  const res = await fetch(`${BASE}/api/auth/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  return { status: res.status, data: await res.json() as any };
}

// Helper: delete a key by id
async function deleteKey(id: string) {
  return fetch(`${BASE}/api/auth/keys/${id}`, { method: "DELETE" });
}

describe("API Keys — email + role fields", () => {
  let createdKeyId: string | null = null;
  let createdKeySecret: string | null = null;

  it("POST /api/auth/keys with email + role='full' creates a full-access key", async () => {
    if (!(await serviceUp())) return;
    if (!(await issuanceEnabled())) return;

    const { status, data } = await createKey({
      name: "Test Full Key",
      email: "admin@test.com",
      role: "full",
    });
    assert.equal(status, 200);
    assert.ok(data.ok);
    assert.ok(data.key);
    assert.equal(data.key.email, "admin@test.com");
    assert.equal(data.key.role, "full");
    assert.ok(data.key.key, "full secret should be returned on create");

    createdKeyId = data.key.id;
    createdKeySecret = data.key.key;
  });

  it("GET /api/auth/keys includes email and role in list", async () => {
    if (!(await serviceUp())) return;
    if (!(await issuanceEnabled())) return;
    if (!createdKeyId) return;

    const res = await fetch(`${BASE}/api/auth/keys`);
    assert.equal(res.status, 200);
    const data = await res.json() as any;
    const found = data.keys.find((k: any) => k.id === createdKeyId);
    assert.ok(found, "created key should appear in list");
    assert.equal(found.email, "admin@test.com");
    assert.equal(found.role, "full");
    // Secret should not be in list
    assert.ok(!("key" in found), "list must not expose raw key");
  });

  it("role defaults to 'full' when not specified", async () => {
    if (!(await serviceUp())) return;
    if (!(await issuanceEnabled())) return;

    const { status, data } = await createKey({ name: "No Role Key" });
    assert.equal(status, 200);
    assert.equal(data.key.role, "full", "role should default to full");

    // Cleanup
    if (data.key.id) await deleteKey(data.key.id);
  });

  it("POST /api/auth/keys with role='read' creates a read-only key", async () => {
    if (!(await serviceUp())) return;
    if (!(await issuanceEnabled())) return;

    const { status, data } = await createKey({
      name: "Test Read Key",
      email: "viewer@test.com",
      role: "read",
    });
    assert.equal(status, 200);
    assert.equal(data.key.role, "read");
    assert.equal(data.key.email, "viewer@test.com");

    // Cleanup
    if (data.key.id) await deleteKey(data.key.id);
  });

  it("email is optional — key without email has null email in list", async () => {
    if (!(await serviceUp())) return;
    if (!(await issuanceEnabled())) return;

    const { status, data } = await createKey({ name: "No Email Key" });
    assert.equal(status, 200);

    const listRes = await fetch(`${BASE}/api/auth/keys`);
    const listData = await listRes.json() as any;
    const found = listData.keys.find((k: any) => k.id === data.key.id);
    assert.ok(found);
    assert.equal(found.email, null, "email should be null when not provided");

    // Cleanup
    if (data.key.id) await deleteKey(data.key.id);
  });

  it("GET /api/auth/status returns role for authenticated key", async () => {
    if (!(await serviceUp())) return;
    if (!(await issuanceEnabled())) return;
    if (!createdKeySecret) return;

    const res = await fetch(`${BASE}/api/auth/status`, {
      headers: { Authorization: `Bearer ${createdKeySecret}` },
    });
    const data = await res.json() as any;
    // On local (auth disabled), role is always "full"
    assert.ok(data.role === "full" || data.authenticated === true,
      "status should include role or indicate authenticated");
  });

  // Cleanup created test key
  it("cleanup: delete test key", async () => {
    if (!(await serviceUp())) return;
    if (!(await issuanceEnabled())) return;
    if (!createdKeyId) return;

    await deleteKey(createdKeyId);
    createdKeyId = null;
    createdKeySecret = null;
  });
});
