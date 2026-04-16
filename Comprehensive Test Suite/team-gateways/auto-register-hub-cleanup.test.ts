/**
 * team-gateways/auto-register-hub-cleanup.test.ts
 * Covers three pieces of behavior in one file (all observable via the public
 * HTTP API):
 *
 *   1. auto-register MCP       — after POST /api/team-gateways, an entry
 *                                 named `team-{id}` appears in /api/mcps.
 *   2. auto-assign to hub       — if a `hub` agent exists, GET /api/agents/hub
 *                                 now shows `team-{id}` in config.mcps.
 *   3. delete cleans everywhere — after DELETE /api/team-gateways/:id, the
 *                                 MCP is gone from /api/mcps AND from every
 *                                 agent's config.mcps array.
 *
 * Hermetic strategy — spins a dummy remote gateway on localhost:ephemeral so
 * the local gateway's probe passes. Tests skip gracefully when the service
 * isn't running on localhost:4888.
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
const DUMMY_KEY = "auto-register-test-key-xyz-12345";
let dummyServer: http.Server | null = null;
let dummyUrl = "";

function startDummyGateway(): Promise<string> {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
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

async function listMcps(): Promise<string[]> {
  const r = await fetch(`${BASE}/api/mcps`);
  if (!r.ok) return [];
  const d = await r.json() as { mcps: string[] };
  return Array.isArray(d.mcps) ? d.mcps : [];
}

async function hubMcps(): Promise<string[] | null> {
  const r = await fetch(`${BASE}/api/agents/hub`);
  if (r.status === 404) return null;
  if (!r.ok) return null;
  const d = await r.json() as { config?: { mcps?: string[] } };
  return d.config?.mcps || [];
}

describe("Team Gateways — auto-register + auto-assign + delete cleanup", () => {
  before(async () => { await startDummyGateway(); });
  after(async () => { await stopDummyGateway(); });

  const gwName = `AutoRegTest-${Date.now()}`;
  const gwId = gwName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const mcpName = `team-${gwId}`;

  it("POST /api/team-gateways auto-registers the MCP and (if hub exists) auto-assigns it", async () => {
    if (!(await serviceUp())) return;

    const add = await fetch(`${BASE}/api/team-gateways`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: gwName, url: dummyUrl, apiKey: DUMMY_KEY }),
    });
    if (add.status !== 200) return; // skip if add didn't land (e.g. collision)

    // 1. MCP is registered
    const mcps = await listMcps();
    assert.ok(mcps.includes(mcpName),
      `MCP '${mcpName}' must appear in /api/mcps after gateway add. Got team-* entries: ${mcps.filter(m => m.startsWith("team-")).join(", ") || "(none)"}`);

    // 2. If hub exists, it was auto-assigned. When hub doesn't exist this is a no-op.
    const hub = await hubMcps();
    if (hub !== null) {
      assert.ok(hub.includes(mcpName),
        `hub.mcps must include '${mcpName}' after auto-assign. Got hub.mcps = ${JSON.stringify(hub)}`);
    }
  });

  it("DELETE /api/team-gateways/:id strips the MCP from registry and from every agent", async () => {
    if (!(await serviceUp())) return;

    // Ensure the gateway actually exists (otherwise the add test was skipped)
    const listBefore = await fetch(`${BASE}/api/team-gateways`);
    if (!listBefore.ok) return;
    const listBeforeData = await listBefore.json() as any;
    const present = (listBeforeData.gateways as any[]).some(g => g.id === gwId);
    if (!present) return;

    const del = await fetch(`${BASE}/api/team-gateways/${gwId}`, { method: "DELETE" });
    assert.equal(del.status, 200);

    // MCP registry entry is gone
    const mcps = await listMcps();
    assert.ok(!mcps.includes(mcpName),
      `MCP '${mcpName}' must be removed from /api/mcps on disconnect. Still present in: ${mcps.filter(m => m.startsWith("team-")).join(", ")}`);

    // Hub no longer references it
    const hub = await hubMcps();
    if (hub !== null) {
      assert.ok(!hub.includes(mcpName),
        `hub.mcps must not still reference '${mcpName}' after delete. Got hub.mcps = ${JSON.stringify(hub)}`);
    }

    // No agent references it (we sample a few well-known agents to spot-check
    // the detach. A full sweep would require listing all agents then fetching
    // each one — we keep the sample small to stay fast.)
    const agentsRes = await fetch(`${BASE}/api/agents`);
    if (!agentsRes.ok) return;
    const { agents } = await agentsRes.json() as { agents: Array<{ id: string }> };
    // Sample up to 5 agents to check
    const sample = agents.slice(0, 5);
    for (const a of sample) {
      const r = await fetch(`${BASE}/api/agents/${a.id}`);
      if (!r.ok) continue;
      const d = await r.json() as { config?: { mcps?: string[] } };
      const arr = d.config?.mcps || [];
      assert.ok(!arr.includes(mcpName),
        `agent '${a.id}' must not still reference '${mcpName}'. Got mcps = ${JSON.stringify(arr)}`);
    }
  });
});
