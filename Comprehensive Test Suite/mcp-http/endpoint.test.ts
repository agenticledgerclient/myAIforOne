/**
 * mcp-http/endpoint.test.ts
 * Smoke tests for the Streamable HTTP /mcp endpoint mounted on the gateway.
 * Skips when the service is not running.
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

async function authOn(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/auth/status`);
    if (!r.ok) return false;
    const d = await r.json() as { authEnabled: boolean };
    return !!d.authEnabled;
  } catch { return false; }
}

describe("/mcp endpoint", () => {
  it("POST /mcp without auth returns 401 when auth is enabled", async () => {
    if (!(await gatewayUp())) return;
    if (!(await authOn())) return;
    const r = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(r.status, 401);
  });

  it("POST /mcp with a clearly bogus Bearer returns 401 when auth is enabled", async () => {
    if (!(await gatewayUp())) return;
    if (!(await authOn())) return;
    const r = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer nope" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(r.status, 401);
  });

  it("GET /mcp without a session id returns 4xx when auth is enabled", async () => {
    if (!(await gatewayUp())) return;
    if (!(await authOn())) return;
    const token = process.env.MYAGENT_TEST_TOKEN;
    if (!token) return;
    const r = await fetch(`${BASE}/mcp`, { headers: { Authorization: `Bearer ${token}` } });
    assert.ok(r.status >= 400 && r.status < 500, "GET without session should be a client error");
  });
});

describe("/mcp <-> /api consistency", () => {
  it("the same API key that works for /api/* should be accepted at /mcp", async () => {
    if (!(await gatewayUp())) return;
    const token = process.env.MYAGENT_TEST_TOKEN;
    if (!token) return;
    const apiRes = await fetch(`${BASE}/api/capabilities`, { headers: { Authorization: `Bearer ${token}` } });
    if (apiRes.status === 401) return;
    // If /api/* accepted the token, /mcp should NOT 401 it. We post an
    // initialize and accept either 200 (full handshake) or a non-401 error
    // code as evidence auth passed.
    const mcpRes = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
      }),
    });
    assert.notEqual(mcpRes.status, 401, "/mcp must not 401 a token that /api accepts");
  });
});
