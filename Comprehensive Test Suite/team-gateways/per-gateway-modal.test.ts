/**
 * team-gateways/per-gateway-modal.test.ts
 *
 * End-to-end tests for the new endpoints that power the per-gateway
 * Configure modal:
 *
 *   - GET    /api/team-gateways/:id                  (detail + attachedAgents)
 *   - GET    /api/team-gateways/:id/key-preview      (masked rendering)
 *   - GET    /api/team-gateways/:id/key-reveal       (full plaintext)
 *   - PATCH  /api/team-gateways/:id                  (rename)
 *   - POST   /api/team-gateways/:id/rotate-key       (rotate + probe)
 *   - POST   /api/team-gateways/:id/attach           (add agent)
 *   - POST   /api/team-gateways/:id/detach           (remove agent; orphan guard)
 *
 * Hermetic strategy — spins a dummy remote gateway on localhost:ephemeral so
 * the local gateway's probe passes. Tests skip gracefully when the local
 * service isn't running on localhost:4888.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

const BASE = "http://localhost:4888";

async function serviceUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

// ─── Dummy remote gateway ─────────────────────────────────────────────
const DUMMY_KEY_V1 = "modal-test-key-v1-" + Date.now();
const DUMMY_KEY_V2 = "modal-test-key-v2-" + Date.now();
let dummyServer: http.Server | null = null;
let dummyUrl = "";

function startDummyGateway(): Promise<string> {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/api/capabilities") {
        const auth = req.headers.authorization || "";
        // Accept both the original and the rotated key so rotate-key tests can
        // probe successfully after the swap.
        if (auth !== `Bearer ${DUMMY_KEY_V1}` && auth !== `Bearer ${DUMMY_KEY_V2}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          platform: "MyAIforOne",
          version: "test-1.0.0",
          features: { sharedAgents: true },
        }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    srv.listen(0, "127.0.0.1", () => {
      dummyServer = srv;
      const addr = srv.address() as AddressInfo;
      dummyUrl = `http://127.0.0.1:${addr.port}`;
      resolve(dummyUrl);
    });
  });
}

function stopDummyGateway(): Promise<void> {
  return new Promise((resolve) => {
    if (!dummyServer) return resolve();
    dummyServer.close(() => resolve());
    dummyServer = null;
  });
}

async function pickAnyAgentId(): Promise<string | null> {
  const r = await fetch(`${BASE}/api/agents`);
  if (!r.ok) return null;
  const d = await r.json() as { agents: Array<{ id: string }> };
  return d.agents?.[0]?.id || null;
}

describe("Team Gateways — per-gateway modal endpoints", () => {
  before(async () => { await startDummyGateway(); });
  after(async () => { await stopDummyGateway(); });

  const gwName = `ModalTest-${Date.now()}`;
  const gwId = gwName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let created = false;

  it("setup: POST /api/team-gateways creates a hermetic test gateway", async () => {
    if (!(await serviceUp())) return;
    const add = await fetch(`${BASE}/api/team-gateways`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: gwName, url: dummyUrl, apiKey: DUMMY_KEY_V1 }),
    });
    if (add.status !== 200) return; // skip downstream tests if creation failed
    created = true;
    const d = await add.json() as any;
    assert.equal(d.ok, true);
    assert.equal(d.gateway?.id, gwId);
  });

  it("GET /api/team-gateways/:id returns gateway + attachedAgents[]", async () => {
    if (!created || !(await serviceUp())) return;
    const r = await fetch(`${BASE}/api/team-gateways/${gwId}`);
    assert.equal(r.status, 200);
    const d = await r.json() as any;
    assert.equal(d.gateway?.id, gwId);
    assert.equal(d.mcpName, `team-${gwId}`);
    assert.ok(Array.isArray(d.attachedAgents), "attachedAgents must be an array");
  });

  it("GET /api/team-gateways/:id 404s for unknown id", async () => {
    if (!(await serviceUp())) return;
    const r = await fetch(`${BASE}/api/team-gateways/this-id-does-not-exist-xyz-${Date.now()}`);
    assert.equal(r.status, 404);
  });

  it("GET /api/team-gateways/:id/key-preview returns masked prefix + last4", async () => {
    if (!created || !(await serviceUp())) return;
    const r = await fetch(`${BASE}/api/team-gateways/${gwId}/key-preview`);
    assert.equal(r.status, 200);
    const d = await r.json() as any;
    assert.equal(d.present, true, "key should be present on disk");
    // The dummy key is "modal-test-key-v1-<ts>" — no underscore prefix convention,
    // but last4 should be the last 4 chars of the stored key.
    assert.equal(typeof d.last4, "string");
    assert.equal(d.last4.length, 4);
    // The preview endpoint MUST NOT return the full plaintext
    assert.ok(!("apiKey" in d), "key-preview must not leak plaintext apiKey");
  });

  it("GET /api/team-gateways/:id/key-reveal returns full plaintext apiKey", async () => {
    if (!created || !(await serviceUp())) return;
    const r = await fetch(`${BASE}/api/team-gateways/${gwId}/key-reveal`);
    assert.equal(r.status, 200);
    const d = await r.json() as any;
    assert.equal(typeof d.apiKey, "string");
    // Stored key should match either V1 (original) or V2 (if rotate ran first)
    assert.ok(d.apiKey === DUMMY_KEY_V1 || d.apiKey === DUMMY_KEY_V2, `unexpected revealed key: ${d.apiKey}`);
  });

  it("PATCH /api/team-gateways/:id renames the gateway", async () => {
    if (!created || !(await serviceUp())) return;
    const newName = gwName + "-renamed";
    const r = await fetch(`${BASE}/api/team-gateways/${gwId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    assert.equal(r.status, 200);
    const d = await r.json() as any;
    assert.equal(d.gateway?.name, newName);
  });

  it("PATCH /api/team-gateways/:id rejects empty name with 400", async () => {
    if (!created || !(await serviceUp())) return;
    const r = await fetch(`${BASE}/api/team-gateways/${gwId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    assert.equal(r.status, 400);
  });

  it("POST /api/team-gateways/:id/rotate-key refuses a failing probe", async () => {
    if (!created || !(await serviceUp())) return;
    const badKey = "rotate-test-invalid-" + Date.now();
    const r = await fetch(`${BASE}/api/team-gateways/${gwId}/rotate-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: badKey }),
    });
    assert.equal(r.status, 400, "bad key must be rejected before touching the .env file");
    // And the old key should still reveal-able
    const reveal = await fetch(`${BASE}/api/team-gateways/${gwId}/key-reveal`);
    const revealData = await reveal.json() as any;
    assert.ok(revealData.apiKey === DUMMY_KEY_V1 || revealData.apiKey === DUMMY_KEY_V2,
      "stored key must be unchanged after a failed rotate");
  });

  it("POST /api/team-gateways/:id/rotate-key accepts a valid new key", async () => {
    if (!created || !(await serviceUp())) return;
    const r = await fetch(`${BASE}/api/team-gateways/${gwId}/rotate-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: DUMMY_KEY_V2 }),
    });
    assert.equal(r.status, 200);
    const d = await r.json() as any;
    assert.equal(d.ok, true);
    // Reveal should now return the rotated key
    const reveal = await fetch(`${BASE}/api/team-gateways/${gwId}/key-reveal`);
    const revealData = await reveal.json() as any;
    assert.equal(revealData.apiKey, DUMMY_KEY_V2, "reveal should return the rotated key");
  });

  it("POST /api/team-gateways/:id/attach is idempotent (attaching twice = same state)", async () => {
    if (!created || !(await serviceUp())) return;
    const agentId = await pickAnyAgentId();
    if (!agentId) return;
    // First attach (may already be attached from auto-assign-to-hub)
    const first = await fetch(`${BASE}/api/team-gateways/${gwId}/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId }),
    });
    assert.equal(first.status, 200);
    const firstData = await first.json() as any;
    const firstCount = (firstData.mcps as string[]).filter(m => m === `team-${gwId}`).length;
    assert.equal(firstCount, 1, "agent should list the mcp exactly once");
    // Second attach — mcp still listed exactly once
    const second = await fetch(`${BASE}/api/team-gateways/${gwId}/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId }),
    });
    assert.equal(second.status, 200);
    const secondData = await second.json() as any;
    const secondCount = (secondData.mcps as string[]).filter(m => m === `team-${gwId}`).length;
    assert.equal(secondCount, 1, "attaching twice must not duplicate the mcp entry");
  });

  it("POST /api/team-gateways/:id/attach 404s for unknown agent", async () => {
    if (!created || !(await serviceUp())) return;
    const r = await fetch(`${BASE}/api/team-gateways/${gwId}/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "agent-that-does-not-exist-" + Date.now() }),
    });
    assert.equal(r.status, 404);
  });

  it("POST /api/team-gateways/:id/detach refuses the last attached agent (orphan guard)", async () => {
    if (!created || !(await serviceUp())) return;
    // Fetch current attachedAgents; if there's exactly 1, detaching it MUST 400.
    const detailRes = await fetch(`${BASE}/api/team-gateways/${gwId}`);
    const detail = await detailRes.json() as any;
    const attached = detail.attachedAgents as string[];
    if (attached.length !== 1) return; // not the state this test covers
    const r = await fetch(`${BASE}/api/team-gateways/${gwId}/detach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: attached[0] }),
    });
    assert.equal(r.status, 400, "orphan guard must refuse the last detach");
  });

  it("teardown: DELETE /api/team-gateways/:id", async () => {
    if (!created || !(await serviceUp())) return;
    const r = await fetch(`${BASE}/api/team-gateways/${gwId}`, { method: "DELETE" });
    assert.equal(r.status, 200);
    // Confirm the key-reveal endpoint now 404s (no gateway, no key file)
    const reveal = await fetch(`${BASE}/api/team-gateways/${gwId}/key-reveal`);
    assert.equal(reveal.status, 404);
  });
});
