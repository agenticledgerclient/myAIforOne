/**
 * api-keys/gating.test.ts
 *
 * Verifies the backend hardening that pairs with the "Issued Keys" UI gating:
 * when `service.sharedAgentsEnabled` is false, /api/auth/keys/* must reject
 * with 403 so a curl-wielding client can't sidestep the toggle. When true,
 * the endpoints behave normally.
 *
 * Tests run against a live local service; skip gracefully otherwise.
 * The test is non-destructive — it reads the current flag, toggles, verifies,
 * and restores the original value.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4888";

async function serviceUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

async function getSharedAgentsEnabled(): Promise<boolean | null> {
  const r = await fetch(`${BASE}/api/config/service`);
  if (!r.ok) return null;
  const d = await r.json() as any;
  return !!d.sharedAgentsEnabled;
}

async function setSharedAgentsEnabled(v: boolean): Promise<boolean> {
  const r = await fetch(`${BASE}/api/config/service`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sharedAgentsEnabled: v }),
  });
  return r.ok;
}

describe("Issued Keys (/api/auth/keys/*) feature gating", () => {
  it("returns 403 when sharedAgentsEnabled is false", async () => {
    if (!(await serviceUp())) return;
    const original = await getSharedAgentsEnabled();
    if (original === null) return;
    try {
      const ok = await setSharedAgentsEnabled(false);
      if (!ok) return;
      const r = await fetch(`${BASE}/api/auth/keys`);
      assert.equal(r.status, 403, "GET /api/auth/keys must 403 when sharedAgentsEnabled=false");
      const d = await r.json() as any;
      assert.ok(typeof d.error === "string" && d.error.length > 0, "error message required");
    } finally {
      await setSharedAgentsEnabled(!!original);
    }
  });

  it("returns 200 when sharedAgentsEnabled is true", async () => {
    if (!(await serviceUp())) return;
    const original = await getSharedAgentsEnabled();
    if (original === null) return;
    try {
      const ok = await setSharedAgentsEnabled(true);
      if (!ok) return;
      const r = await fetch(`${BASE}/api/auth/keys`);
      assert.equal(r.status, 200, "GET /api/auth/keys must 200 when sharedAgentsEnabled=true");
      const d = await r.json() as any;
      assert.ok(Array.isArray(d.keys), "response must include keys[]");
    } finally {
      await setSharedAgentsEnabled(!!original);
    }
  });

  it("POST /api/auth/keys also respects the gate (403 when off)", async () => {
    if (!(await serviceUp())) return;
    const original = await getSharedAgentsEnabled();
    if (original === null) return;
    try {
      const ok = await setSharedAgentsEnabled(false);
      if (!ok) return;
      const r = await fetch(`${BASE}/api/auth/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "gating-test-" + Date.now() }),
      });
      assert.equal(r.status, 403, "POST must also be gated, not just GET");
    } finally {
      await setSharedAgentsEnabled(!!original);
    }
  });
});
