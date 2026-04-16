/**
 * api-keys.test.ts
 * Tests for /api/auth/keys endpoints (list / create / delete) and the auth
 * middleware's behavior against generated keys.
 *
 * These tests run against the live web UI at http://localhost:4888.
 * They skip gracefully when the service is offline (matching the existing
 * pattern used across the comprehensive test suite).
 *
 * Behavior validated:
 *   - GET  /api/auth/keys           — returns array of {id,name,preview,createdAt,scopes}
 *   - POST /api/auth/keys           — validates {name}, returns full secret once
 *   - DELETE /api/auth/keys/:id     — removes key, refuses to delete the last key
 *   - Auth middleware               — 401 without valid token when auth enabled
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

// /api/auth/keys/* is gated behind service.sharedAgentsEnabled — when the flag
// is off the gateway returns 403 on every keys endpoint. Tests here skip
// gracefully in that state rather than asserting issuance UI behavior on an
// install that doesn't act as a gateway.
async function issuanceEnabled(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/auth/keys`);
    return r.status !== 403;
  } catch { return false; }
}

describe("API Keys — list / create / delete", () => {
  it("GET /api/auth/keys returns a keys array (no secrets leaked)", async () => {
    if (!(await serviceUp())) return;
    if (!(await issuanceEnabled())) return;
    const res = await fetch(`${BASE}/api/auth/keys`);
    assert.equal(res.status, 200, "list endpoint should return 200 when auth disabled or authorized");
    const data = await res.json() as any;
    assert.ok(Array.isArray(data.keys), "response should have .keys array");
    for (const k of data.keys) {
      assert.ok("id" in k, "each key entry should have id");
      assert.ok("name" in k, "each key entry should have name");
      assert.ok("preview" in k, "each key entry should have preview");
      assert.ok("createdAt" in k, "each key entry should have createdAt");
      assert.ok("scopes" in k, "each key entry should have scopes");
      // Secret should NEVER be returned in list — only preview.
      assert.ok(!("key" in k), `list must not expose raw key (found on id=${k.id})`);
      assert.equal(typeof k.preview, "string");
    }
  });

  it("POST /api/auth/keys with empty name returns 400", async () => {
    if (!(await serviceUp())) return;
    if (!(await issuanceEnabled())) return;
    const res = await fetch(`${BASE}/api/auth/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    assert.equal(res.status, 400, "empty name should be rejected");
    const data = await res.json() as any;
    assert.ok("error" in data, "error message should be returned");
  });

  it("POST /api/auth/keys with whitespace name returns 400", async () => {
    if (!(await serviceUp())) return;
    if (!(await issuanceEnabled())) return;
    const res = await fetch(`${BASE}/api/auth/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    assert.equal(res.status, 400, "whitespace-only name should be rejected");
  });

  it("POST /api/auth/keys with missing body returns 400", async () => {
    if (!(await serviceUp())) return;
    if (!(await issuanceEnabled())) return;
    const res = await fetch(`${BASE}/api/auth/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400, "missing name should be rejected");
  });

  it("POST then DELETE round-trip: create, list shows it, delete removes it", async () => {
    if (!(await serviceUp())) return;
    if (!(await issuanceEnabled())) return;

    const label = `test-key-roundtrip-${Date.now()}`;
    // Create
    const created = await fetch(`${BASE}/api/auth/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: label }),
    });
    assert.equal(created.status, 200, "create should return 200");
    const createdData = await created.json() as any;
    assert.equal(createdData.ok, true);
    assert.ok(createdData.key, "create response should include full key object");
    assert.ok(createdData.key.id, "created key should have id");
    assert.equal(createdData.key.name, label);
    assert.ok(createdData.key.key, "create response must include the RAW secret once");
    assert.ok(Array.isArray(createdData.key.scopes));
    const createdId = createdData.key.id;

    // List shows it (without the secret)
    const list = await fetch(`${BASE}/api/auth/keys`);
    assert.equal(list.status, 200);
    const listData = await list.json() as any;
    const found = listData.keys.find((k: any) => k.id === createdId);
    assert.ok(found, `newly created key ${createdId} should appear in list`);
    assert.equal(found.name, label);
    assert.ok(!("key" in found), "list entry should not leak raw secret");

    // Delete
    const del = await fetch(`${BASE}/api/auth/keys/${createdId}`, { method: "DELETE" });
    // 200 ok, or 400 if this was the only key in the system (rare)
    assert.ok(del.status === 200 || del.status === 400, `delete returned unexpected status ${del.status}`);
    if (del.status === 200) {
      const delData = await del.json() as any;
      assert.equal(delData.ok, true);
      assert.equal(delData.id, createdId);

      // Confirm list no longer contains it
      const list2 = await fetch(`${BASE}/api/auth/keys`);
      const list2Data = await list2.json() as any;
      const stillThere = list2Data.keys.find((k: any) => k.id === createdId);
      assert.ok(!stillThere, "deleted key must not appear in subsequent list");
    }
  });

  it("DELETE /api/auth/keys/:id for unknown id returns 404", async () => {
    if (!(await serviceUp())) return;
    if (!(await issuanceEnabled())) return;
    const res = await fetch(`${BASE}/api/auth/keys/key_does_not_exist_xyz`, { method: "DELETE" });
    assert.equal(res.status, 404, "deleting unknown key id should return 404");
    const data = await res.json() as any;
    assert.ok("error" in data);
  });

  it("DELETE refuses to remove the last remaining key (lockout guard)", async () => {
    if (!(await serviceUp())) return;
    if (!(await issuanceEnabled())) return;

    // Read current keys
    const list = await fetch(`${BASE}/api/auth/keys`);
    if (!list.ok) return;
    const listData = await list.json() as any;

    // If there is exactly one key, attempt deletion — it MUST be refused with 400.
    // If there are multiple keys, we skip the assertion (can't safely reduce to 1
    // and then try to delete in a hermetic way without risking real lockout).
    if (listData.keys.length === 1) {
      const onlyId = listData.keys[0].id;
      const res = await fetch(`${BASE}/api/auth/keys/${onlyId}`, { method: "DELETE" });
      assert.equal(res.status, 400, "deleting the last key must be refused");
      const data = await res.json() as any;
      assert.ok("error" in data);
      assert.match(String(data.error), /last/i, "error message should explain why");
    }
  });

  it("preview field masks the actual secret", async () => {
    if (!(await serviceUp())) return;
    if (!(await issuanceEnabled())) return;

    // Create a throwaway key so we have a known raw secret to compare with preview.
    const label = `test-preview-${Date.now()}`;
    const created = await fetch(`${BASE}/api/auth/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: label }),
    });
    if (!created.ok) return;
    const createdData = await created.json() as any;
    const rawKey: string = createdData.key.key;
    const id: string = createdData.key.id;

    try {
      const list = await fetch(`${BASE}/api/auth/keys`);
      const listData = await list.json() as any;
      const entry = listData.keys.find((k: any) => k.id === id);
      assert.ok(entry, "newly created key should appear in list");
      assert.notEqual(entry.preview, rawKey, "preview must not equal the raw secret");
      // Typical preview formats show only a suffix or prefix fragment; ensure it's shorter
      // than the full key (sanity check; exact format is implementation-defined).
      assert.ok(entry.preview.length < rawKey.length || entry.preview.includes("…") || entry.preview.includes("*"),
        `preview '${entry.preview}' should be shorter than or masked relative to raw key`);
    } finally {
      // Cleanup — best-effort; will refuse if this is the last key, which is fine.
      await fetch(`${BASE}/api/auth/keys/${id}`, { method: "DELETE" }).catch(() => {});
    }
  });
});

describe("API Keys — auth middleware interaction", () => {
  it("when auth is enabled, /api/auth/keys without token returns 401", async () => {
    if (!(await serviceUp())) return;
    const status = await fetch(`${BASE}/api/auth/status`);
    if (!status.ok) return;
    const statusData = await status.json() as any;
    if (!statusData.authEnabled) return; // skip when auth disabled — can't test gating

    const res = await fetch(`${BASE}/api/auth/keys`);
    assert.equal(res.status, 401, "protected keys list must require auth");
  });

  it("when auth is enabled, POST /api/auth/keys without token returns 401", async () => {
    if (!(await serviceUp())) return;
    const status = await fetch(`${BASE}/api/auth/status`);
    if (!status.ok) return;
    const statusData = await status.json() as any;
    if (!statusData.authEnabled) return;

    const res = await fetch(`${BASE}/api/auth/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "should-fail" }),
    });
    assert.equal(res.status, 401, "creating keys without auth must 401");
  });

  it("when auth is enabled, DELETE /api/auth/keys/:id without token returns 401", async () => {
    if (!(await serviceUp())) return;
    const status = await fetch(`${BASE}/api/auth/status`);
    if (!status.ok) return;
    const statusData = await status.json() as any;
    if (!statusData.authEnabled) return;

    const res = await fetch(`${BASE}/api/auth/keys/key_anything`, { method: "DELETE" });
    assert.equal(res.status, 401, "deleting keys without auth must 401");
  });

  it("when auth is disabled, all key operations are accessible without a token", async () => {
    if (!(await serviceUp())) return;
    if (!(await issuanceEnabled())) return;
    const status = await fetch(`${BASE}/api/auth/status`);
    if (!status.ok) return;
    const statusData = await status.json() as any;
    if (statusData.authEnabled) return; // skip when auth on — can't test un-gated path

    const res = await fetch(`${BASE}/api/auth/keys`);
    assert.equal(res.status, 200, "keys list should be accessible when auth disabled");
  });
});
