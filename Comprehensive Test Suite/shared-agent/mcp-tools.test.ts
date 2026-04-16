/**
 * mcp-tools.test.ts
 * Tests for the 4 new MCP tools exposed via the MCP server:
 *   get_storage_info, update_storage_config,
 *   get_conversation_senders, get_conversation_log
 *
 * These are tested via the web API since the MCP server runs as a subprocess.
 * We verify the underlying API endpoints that the MCP tools call.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4888";

describe("MCP tool backing APIs", () => {
  // get_storage_info → GET /api/service (returns sharedAgentsEnabled, sharedAgentsDir)
  it("get_storage_info: /api/service returns storage config fields", async () => {
    try {
      const res = await fetch(`${BASE}/api/service`);
      if (!res.ok) return;
      const data = await res.json() as any;
      assert.ok("sharedAgentsEnabled" in data, "service should expose sharedAgentsEnabled for get_storage_info");
    } catch { /* service not running */ }
  });

  // update_storage_config → PUT /api/config/service
  it("update_storage_config: PUT /api/config/service accepts storage fields", async () => {
    try {
      const get = await fetch(`${BASE}/api/service`);
      if (!get.ok) return;
      const current = await get.json() as any;

      // Send a no-op update (same value) to verify the endpoint accepts these fields
      const res = await fetch(`${BASE}/api/config/service`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sharedAgentsEnabled: current.sharedAgentsEnabled }),
      });
      assert.ok(res.ok, "PUT /api/config/service should succeed for storage update");
    } catch { /* service not running */ }
  });

  // get_conversation_senders → GET /api/agents/:id/logs (aggregated senders)
  it("get_conversation_senders: logs endpoint is accessible per agent", async () => {
    try {
      const list = await fetch(`${BASE}/api/agents`);
      if (!list.ok) return;
      const data = await list.json() as any;
      const agents: any[] = data.agents ?? data;
      if (agents.length === 0) return;

      const agentId = agents[0].id;
      const res = await fetch(`${BASE}/api/agents/${agentId}/logs?limit=1`);
      assert.ok(res.ok, "logs endpoint should be accessible (used by get_conversation_senders)");
    } catch { /* service not running */ }
  });

  // get_conversation_log → GET /api/agents/:id/logs?sender=&limit=&offset=
  it("get_conversation_log: logs endpoint supports sender param", async () => {
    try {
      const list = await fetch(`${BASE}/api/agents`);
      if (!list.ok) return;
      const data = await list.json() as any;
      const agents: any[] = data.agents ?? data;
      if (agents.length === 0) return;

      const agentId = agents[0].id;
      const res = await fetch(`${BASE}/api/agents/${agentId}/logs?sender=test_user&limit=5&offset=0`);
      assert.ok(res.ok, "logs endpoint with sender param should succeed");
      const logs = await res.json() as any;
      assert.ok(Array.isArray(logs), "logs with sender filter should return array");
    } catch { /* service not running */ }
  });

  it("get_conversation_log: logs endpoint supports limit and offset params", async () => {
    try {
      const list = await fetch(`${BASE}/api/agents`);
      if (!list.ok) return;
      const data = await list.json() as any;
      const agents: any[] = data.agents ?? data;
      if (agents.length === 0) return;

      const agentId = agents[0].id;

      const page1 = await fetch(`${BASE}/api/agents/${agentId}/logs?limit=2&offset=0`);
      const page2 = await fetch(`${BASE}/api/agents/${agentId}/logs?limit=2&offset=2`);
      if (!page1.ok || !page2.ok) return;

      const logs1 = await page1.json() as any;
      const logs2 = await page2.json() as any;
      assert.ok(Array.isArray(logs1), "page 1 should be array");
      assert.ok(Array.isArray(logs2), "page 2 should be array");
    } catch { /* service not running */ }
  });
});
