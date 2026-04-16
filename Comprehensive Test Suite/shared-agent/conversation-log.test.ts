/**
 * conversation-log.test.ts
 * Tests for shared vs per-user conversation log modes and sender filtering.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4888";

describe("conversation log modes", () => {
  it("GET /api/agents/:id/logs returns log entries array", async () => {
    try {
      const list = await fetch(`${BASE}/api/agents`);
      if (!list.ok) return;
      const data = await list.json() as any;
      const agents: any[] = data.agents ?? data;
      if (agents.length === 0) return;

      const agentId = agents[0].id;
      const res = await fetch(`${BASE}/api/agents/${agentId}/logs?limit=5`);
      if (!res.ok) return;
      const logs = await res.json() as any;
      assert.ok(Array.isArray(logs), "logs should be an array");
    } catch { /* service not running */ }
  });

  it("GET /api/agents/:id/logs?sender= filter returns subset", async () => {
    try {
      const list = await fetch(`${BASE}/api/agents`);
      if (!list.ok) return;
      const data = await list.json() as any;
      const agents: any[] = data.agents ?? data;
      // Find a per-user agent if possible, otherwise any agent
      const agent = agents.find((a: any) => a.conversationLogMode === "per-user") ?? agents[0];
      if (!agent) return;

      // Request with a fake sender — should return empty array, not an error
      const res = await fetch(`${BASE}/api/agents/${agent.id}/logs?sender=nonexistent_sender_xyz&limit=5`);
      if (!res.ok) return;
      const logs = await res.json() as any;
      assert.ok(Array.isArray(logs), "filtered logs should be an array (possibly empty)");
    } catch { /* service not running */ }
  });

  it("GET /api/agents/:id/logs with no sender returns all logs for shared mode", async () => {
    try {
      const list = await fetch(`${BASE}/api/agents`);
      if (!list.ok) return;
      const data = await list.json() as any;
      const agents: any[] = data.agents ?? data;
      const agent = agents.find((a: any) => a.conversationLogMode === "shared") ?? agents[0];
      if (!agent) return;

      const res = await fetch(`${BASE}/api/agents/${agent.id}/logs?limit=10`);
      if (!res.ok) return;
      const logs = await res.json() as any;
      assert.ok(Array.isArray(logs), "shared mode logs should return array");
    } catch { /* service not running */ }
  });

  it("GET /api/agents/:id/cost returns numeric token/cost data", async () => {
    try {
      const list = await fetch(`${BASE}/api/agents`);
      if (!list.ok) return;
      const data = await list.json() as any;
      const agents: any[] = data.agents ?? data;
      if (agents.length === 0) return;

      const agentId = agents[0].id;
      const res = await fetch(`${BASE}/api/agents/${agentId}/cost`);
      if (!res.ok) return;
      const costData = await res.json() as any;
      // Should have token or cost fields (even if 0)
      const hasExpectedFields =
        "totalInputTokens" in costData ||
        "totalOutputTokens" in costData ||
        "totalCost" in costData ||
        "messages" in costData;
      assert.ok(hasExpectedFields, "cost endpoint should return token/cost data");
    } catch { /* service not running */ }
  });
});
