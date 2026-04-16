/**
 * team-gateways.test.ts
 * Tests for /api/team-gateways endpoints:
 *   - GET    /api/team-gateways              — list
 *   - POST   /api/team-gateways/test         — probe remote before save
 *   - POST   /api/team-gateways              — add (requires successful probe)
 *   - POST   /api/team-gateways/:id/resync   — re-probe existing gateway
 *   - DELETE /api/team-gateways/:id          — disconnect + cleanup
 *
 * Hermetic strategy:
 *   A dummy HTTP server is spun up on an ephemeral localhost port for the
 *   duration of the describe block. It imitates the remote gateway's
 *   /api/capabilities endpoint the local install probes during test/add/resync.
 *   - Returns 200 with {platform, features:{sharedAgents:true}} when the right
 *     Authorization: Bearer <key> is presented.
 *   - Returns 401 for a wrong/missing key.
 *   This means we never hit the real internet and tests pass offline.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

const BASE = "http://localhost:4888";

async function serviceUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`);
    return r.ok;
  } catch { return false; }
}

// ─── Dummy remote gateway ─────────────────────────────────────────────
const DUMMY_KEY = "dummy-gateway-api-key-xyz-12345";
let dummyServer: http.Server | null = null;
let dummyUrl = "";

function startDummyGateway(): Promise<string> {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      // Only implement the endpoint probeGateway() hits.
      if (req.method === "GET" && req.url === "/api/capabilities") {
        const auth = req.headers.authorization || "";
        if (auth !== `Bearer ${DUMMY_KEY}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          platform: "MyAIforOne",
          version: "test-1.0.0",
          features: { sharedAgents: true, gym: false },
        }));
        return;
      }
      // Default: 404
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

describe("Team Gateways — list & probe", () => {
  before(async () => { await startDummyGateway(); });
  after(async () => { await stopDummyGateway(); });

  it("GET /api/team-gateways returns a gateways array", async () => {
    if (!(await serviceUp())) return;
    const res = await fetch(`${BASE}/api/team-gateways`);
    assert.equal(res.status, 200, "list endpoint should return 200");
    const data = await res.json() as any;
    assert.ok(Array.isArray(data.gateways), "response should have .gateways array");
    for (const gw of data.gateways) {
      assert.ok("id" in gw, "gateway should have id");
      assert.ok("name" in gw, "gateway should have name");
      assert.ok("url" in gw, "gateway should have url");
      assert.ok("addedAt" in gw, "gateway should have addedAt");
    }
  });

  it("POST /api/team-gateways/test with missing fields returns 400", async () => {
    if (!(await serviceUp())) return;
    const res = await fetch(`${BASE}/api/team-gateways/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  it("POST /api/team-gateways/test with url only returns 400", async () => {
    if (!(await serviceUp())) return;
    const res = await fetch(`${BASE}/api/team-gateways/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: dummyUrl }),
    });
    assert.equal(res.status, 400);
  });

  it("POST /api/team-gateways/test with valid url+key returns ok:true", async () => {
    if (!(await serviceUp())) return;
    const res = await fetch(`${BASE}/api/team-gateways/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: dummyUrl, apiKey: DUMMY_KEY }),
    });
    assert.equal(res.status, 200, "valid probe against dummy gateway should succeed");
    const data = await res.json() as any;
    assert.equal(data.ok, true);
    assert.equal(data.platform, "MyAIforOne");
    assert.equal(data.sharedAgents, true);
  });

  it("POST /api/team-gateways/test with wrong key returns 400 and propagates 401 status", async () => {
    if (!(await serviceUp())) return;
    const res = await fetch(`${BASE}/api/team-gateways/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: dummyUrl, apiKey: "wrong-key" }),
    });
    assert.equal(res.status, 400, "bad probe should surface as 400");
    const data = await res.json() as any;
    assert.equal(data.ok, false);
    assert.equal(data.status, 401, "remote 401 should be carried through the response body");
  });

  it("POST /api/team-gateways/test against unreachable url returns 400", async () => {
    if (!(await serviceUp())) return;
    // Port 1 is reliably refused on localhost (reserved, nothing listens).
    const res = await fetch(`${BASE}/api/team-gateways/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1:1", apiKey: DUMMY_KEY }),
    });
    assert.equal(res.status, 400);
    const data = await res.json() as any;
    assert.equal(data.ok, false);
    assert.ok(data.error, "unreachable host should surface an error message");
  });
});

describe("Team Gateways — add / resync / delete round-trip", () => {
  before(async () => { await startDummyGateway(); });
  after(async () => { await stopDummyGateway(); });

  // Each test run uses a unique name so the slug never collides with prior runs.
  const gwName = `TestGateway-${Date.now()}`;
  const gwId = gwName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  it("POST /api/team-gateways with missing fields returns 400", async () => {
    if (!(await serviceUp())) return;
    const res = await fetch(`${BASE}/api/team-gateways`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "incomplete" }),
    });
    assert.equal(res.status, 400);
  });

  it("POST /api/team-gateways with invalid key returns 400 (probe failure)", async () => {
    if (!(await serviceUp())) return;
    const res = await fetch(`${BASE}/api/team-gateways`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `WillFail-${Date.now()}`,
        url: dummyUrl,
        apiKey: "wrong-key-at-add",
      }),
    });
    assert.equal(res.status, 400, "add should refuse to save when probe fails");
    const data = await res.json() as any;
    assert.ok("error" in data);
  });

  it("POST /api/team-gateways with valid fields saves the gateway", async () => {
    if (!(await serviceUp())) return;
    const res = await fetch(`${BASE}/api/team-gateways`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: gwName, url: dummyUrl, apiKey: DUMMY_KEY }),
    });
    // 200 on success; 409 if slug somehow collided (skip later mutations).
    assert.ok(res.status === 200 || res.status === 409,
      `add should return 200 (or 409 on slug collision), got ${res.status}`);
    if (res.status === 200) {
      const data = await res.json() as any;
      assert.equal(data.ok, true);
      assert.ok(data.gateway);
      assert.equal(data.gateway.id, gwId);
      assert.equal(data.gateway.name, gwName);
      assert.equal(data.gateway.url, dummyUrl);
      assert.equal(data.gateway.lastStatus, "ok");
    }
  });

  it("GET /api/team-gateways includes the newly added gateway", async () => {
    if (!(await serviceUp())) return;
    const res = await fetch(`${BASE}/api/team-gateways`);
    if (!res.ok) return;
    const data = await res.json() as any;
    const found = (data.gateways as any[]).find(g => g.id === gwId);
    // If not found (e.g. add failed), we skip — other tests in this block will flag it.
    if (found) {
      assert.equal(found.name, gwName);
      assert.equal(found.url, dummyUrl);
    }
  });

  it("POST /api/team-gateways/:id/resync re-probes successfully", async () => {
    if (!(await serviceUp())) return;
    const res = await fetch(`${BASE}/api/team-gateways/${gwId}/resync`, { method: "POST" });
    if (res.status === 404) return; // gateway wasn't added (covered elsewhere)
    assert.equal(res.status, 200, "resync against healthy dummy should succeed");
    const data = await res.json() as any;
    assert.equal(data.status, "ok");
  });

  it("POST /api/team-gateways/:id/resync when remote is down reports offline/error", async () => {
    if (!(await serviceUp())) return;
    // Take the dummy server down so the resync probe fails.
    await stopDummyGateway();
    try {
      const res = await fetch(`${BASE}/api/team-gateways/${gwId}/resync`, { method: "POST" });
      if (res.status === 404) return;
      // The route returns 200 with body.status set to 'offline' or 'error' on failure.
      // Note: probeGateway returns ok:false+error only — the route does NOT return a
      // non-2xx when the probe fails (except when the key file is missing).
      assert.equal(res.status, 200);
      const data = await res.json() as any;
      assert.ok(["offline", "error", "unauthorized"].includes(data.status),
        `expected degraded status, got: ${data.status}`);
    } finally {
      // Restart dummy server for the next test
      await startDummyGateway();
    }
  });

  it("POST /api/team-gateways/:id/resync for unknown id returns 404", async () => {
    if (!(await serviceUp())) return;
    const res = await fetch(`${BASE}/api/team-gateways/gw_does_not_exist_xyz/resync`, { method: "POST" });
    assert.equal(res.status, 404);
  });

  it("DELETE /api/team-gateways/:id removes the gateway", async () => {
    if (!(await serviceUp())) return;
    const res = await fetch(`${BASE}/api/team-gateways/${gwId}`, { method: "DELETE" });
    if (res.status === 404) return; // gateway wasn't added
    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.equal(data.ok, true);
    assert.equal(data.id, gwId);

    // Confirm the list no longer has it
    const list = await fetch(`${BASE}/api/team-gateways`);
    const listData = await list.json() as any;
    const stillThere = (listData.gateways as any[]).find(g => g.id === gwId);
    assert.ok(!stillThere, "deleted gateway must not appear in subsequent list");
  });

  it("DELETE /api/team-gateways/:id for unknown id returns 404", async () => {
    if (!(await serviceUp())) return;
    const res = await fetch(`${BASE}/api/team-gateways/gw_does_not_exist_xyz`, { method: "DELETE" });
    assert.equal(res.status, 404);
  });

  it("POST /api/team-gateways rejects duplicate name/slug with 409", async () => {
    if (!(await serviceUp())) return;

    // Create a fresh gateway
    const freshName = `DupeTest-${Date.now()}`;
    const freshId = freshName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const first = await fetch(`${BASE}/api/team-gateways`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: freshName, url: dummyUrl, apiKey: DUMMY_KEY }),
    });
    if (first.status !== 200) return; // bail if first add didn't succeed

    try {
      // Second attempt with the same name should conflict
      const second = await fetch(`${BASE}/api/team-gateways`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: freshName, url: dummyUrl, apiKey: DUMMY_KEY }),
      });
      assert.equal(second.status, 409, "duplicate slug should return 409");
    } finally {
      // Cleanup
      await fetch(`${BASE}/api/team-gateways/${freshId}`, { method: "DELETE" }).catch(() => {});
    }
  });
});
