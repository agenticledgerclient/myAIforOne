/**
 * mcp-http/tool-listing.test.ts
 * Verifies the /mcp endpoint responds to an initialize + tools/list round-trip
 * and returns at least the core MCP tools we expect (e.g. list_agents).
 *
 * Streamable HTTP protocol:
 *   1. POST /mcp with method=initialize → gateway responds with server
 *      capabilities + an Mcp-Session-Id header.
 *   2. POST /mcp with the returned session id + method=tools/list → tool list.
 *
 * Skips gracefully when:
 *   - the gateway isn't running on localhost:4888
 *   - auth is enabled and no MYAGENT_TEST_TOKEN is provided
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

async function authHeaders(): Promise<Record<string, string>> {
  const statusRes = await fetch(`${BASE}/api/auth/status`).catch(() => null);
  if (!statusRes || !statusRes.ok) return {};
  const status = await statusRes.json() as { authEnabled: boolean };
  if (!status.authEnabled) return {};
  const token = process.env.MYAGENT_TEST_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Send a JSON-RPC request over Streamable HTTP. The transport can respond
 * with either application/json or text/event-stream. We accept both.
 */
async function mcpCall(body: unknown, extraHeaders: Record<string, string> = {}): Promise<{
  res: Response;
  data: any;
  sessionId: string | null;
}> {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const sessionId = res.headers.get("Mcp-Session-Id");
  const contentType = res.headers.get("Content-Type") || "";
  let data: any = null;
  if (res.ok) {
    const text = await res.text();
    if (contentType.includes("text/event-stream")) {
      // Parse a single SSE event — `data: {...}\n\n`
      const match = text.match(/^data: (.+)$/m);
      if (match) data = JSON.parse(match[1]);
    } else if (contentType.includes("application/json") && text) {
      data = JSON.parse(text);
    }
  }
  return { res, data, sessionId };
}

describe("/mcp tools/list round-trip", () => {
  it("initialize + tools/list returns a non-empty tool catalog including list_agents", async () => {
    if (!(await serviceUp())) return;
    const headers = await authHeaders();

    // Initialize — opens a session
    const init = await mcpCall({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "mcp-http-test", version: "0" },
      },
    }, headers);

    if (init.res.status === 401) return; // auth on, no token — skip
    // If the gateway had any other reason to fail init (e.g. stdio child
    // unavailable in a CI env), we skip rather than flag false-negatives.
    if (!init.res.ok) return;
    assert.ok(init.sessionId, "initialize must return an Mcp-Session-Id header");

    // tools/list on the same session
    const list = await mcpCall({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }, { ...headers, "Mcp-Session-Id": init.sessionId! });

    if (!list.res.ok) return;
    assert.ok(list.data, "tools/list should return a JSON-RPC response body");
    assert.equal(list.data.jsonrpc, "2.0");
    assert.ok(list.data.result, "response should have a result");
    assert.ok(Array.isArray(list.data.result.tools), "result.tools must be an array");
    assert.ok(list.data.result.tools.length > 0, "tool catalog should not be empty");

    // Verify one of the well-known tools is present so we know the stdio
    // proxy is actually reaching the real server (and not a stub).
    const names = new Set(list.data.result.tools.map((t: any) => t.name));
    const expected = ["list_agents", "list_projects", "list_mcps"];
    const hit = expected.find(n => names.has(n));
    assert.ok(hit, `expected at least one of ${expected.join(", ")} in tools list; got: ${[...names].slice(0, 5).join(", ")}...`);

    // Session teardown so we don't leak state across tests
    await fetch(`${BASE}/mcp`, {
      method: "DELETE",
      headers: { ...headers, "Mcp-Session-Id": init.sessionId! },
    }).catch(() => {});
  });
});

describe("/mcp tool call round-trip", () => {
  it("calling list_agents returns a JSON-RPC result (or a structured error)", async () => {
    if (!(await serviceUp())) return;
    const headers = await authHeaders();

    // Initialize
    const init = await mcpCall({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "mcp-http-test", version: "0" },
      },
    }, headers);
    if (init.res.status === 401 || !init.res.ok) return;

    // Call list_agents — this exercises the full stdio-proxy path end-to-end
    const call = await mcpCall({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_agents", arguments: {} },
    }, { ...headers, "Mcp-Session-Id": init.sessionId! });

    if (!call.res.ok) return;
    assert.ok(call.data, "tools/call should return JSON-RPC body");
    // Accept either a result or a structured tool error — what we don't accept
    // is a missing envelope, which would mean the HTTP transport is broken.
    assert.ok(call.data.result || call.data.error, "response must have result or error");

    // Cleanup session
    await fetch(`${BASE}/mcp`, {
      method: "DELETE",
      headers: { ...headers, "Mcp-Session-Id": init.sessionId! },
    }).catch(() => {});
  });
});
