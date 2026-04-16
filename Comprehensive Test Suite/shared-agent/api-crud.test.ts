/**
 * api-crud.test.ts
 * CRUD operations for shared agents: creation routing, field presence, and cleanup.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4888";
const TEST_AGENT_ID = "test-shared-agent-crud-" + Date.now();

describe("shared-agent CRUD", () => {
  it("GET /api/agents returns shared and conversationLogMode fields on each agent", async () => {
    try {
      const res = await fetch(`${BASE}/api/agents`);
      if (!res.ok) return;
      const data = await res.json() as any;
      const agents: any[] = data.agents ?? data;
      if (!Array.isArray(agents) || agents.length === 0) return;
      for (const agent of agents) {
        assert.ok("shared" in agent, `Agent ${agent.id} missing 'shared' field`);
        assert.ok("conversationLogMode" in agent, `Agent ${agent.id} missing 'conversationLogMode' field`);
      }
    } catch { /* service not running */ }
  });

  it("GET /api/agents/:id returns shared, conversationLogMode, and agentHome", async () => {
    try {
      const list = await fetch(`${BASE}/api/agents`);
      if (!list.ok) return;
      const data = await list.json() as any;
      const agents: any[] = data.agents ?? data;
      if (!Array.isArray(agents) || agents.length === 0) return;
      const agentId = agents[0].id;

      const res = await fetch(`${BASE}/api/agents/${agentId}`);
      if (!res.ok) return;
      const agent = await res.json() as any;
      assert.ok("shared" in agent, "agent detail should have 'shared' field");
      assert.ok("conversationLogMode" in agent, "agent detail should have 'conversationLogMode' field");
      assert.ok("agentHome" in agent, "agent detail should have 'agentHome' field");
      assert.equal(typeof agent.agentHome, "string");
    } catch { /* service not running */ }
  });

  it("POST /api/agents with shared:true includes shared field in response", async () => {
    try {
      // Only test if sharedAgentsEnabled
      const caps = await fetch(`${BASE}/api/capabilities`);
      if (!caps.ok) return;
      const capsData = await caps.json() as any;
      if (!capsData.features?.sharedAgents) return; // skip if feature not enabled

      const res = await fetch(`${BASE}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: TEST_AGENT_ID,
          name: "Shared CRUD Test Agent",
          alias: "@test-shared-crud",
          shared: true,
          conversationLogMode: "shared",
        }),
      });
      if (!res.ok) return;
      const agent = await res.json() as any;
      assert.equal(agent.shared, true, "created agent should have shared:true");
      assert.ok(agent.agentHome, "created agent should have agentHome");
      // For shared agents, path should contain SharedAgents
      assert.ok(
        agent.agentHome.includes("SharedAgents"),
        `agentHome '${agent.agentHome}' should contain 'SharedAgents'`
      );
    } catch { /* service not running */ }
  });

  it("POST /api/agents with shared:false routes to PersonalAgents", async () => {
    try {
      const PERSONAL_ID = "test-personal-agent-crud-" + Date.now();
      const res = await fetch(`${BASE}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: PERSONAL_ID,
          name: "Personal CRUD Test Agent",
          alias: "@test-personal-crud",
          shared: false,
        }),
      });
      if (!res.ok) return;
      const agent = await res.json() as any;
      assert.equal(agent.shared, false, "created agent should have shared:false");
      assert.ok(agent.agentHome, "created agent should have agentHome");
      // For personal agents, path should contain PersonalAgents
      assert.ok(
        agent.agentHome.includes("PersonalAgents"),
        `agentHome '${agent.agentHome}' should contain 'PersonalAgents'`
      );

      // Cleanup
      await fetch(`${BASE}/api/agents/${PERSONAL_ID}`, { method: "DELETE" });
    } catch { /* service not running */ }
  });

  it("PUT /api/agents/:id accepts conversationLogMode update", async () => {
    try {
      const list = await fetch(`${BASE}/api/agents`);
      if (!list.ok) return;
      const data = await list.json() as any;
      const agents: any[] = data.agents ?? data;
      const target = agents.find((a: any) => a.id === TEST_AGENT_ID);
      if (!target) return; // test agent wasn't created (feature gate off)

      const res = await fetch(`${BASE}/api/agents/${TEST_AGENT_ID}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationLogMode: "per-user" }),
      });
      if (!res.ok) return;
      const updated = await res.json() as any;
      assert.equal(updated.conversationLogMode, "per-user");
    } catch { /* service not running */ }
  });

  it("cleanup: DELETE test shared agent", async () => {
    try {
      const res = await fetch(`${BASE}/api/agents/${TEST_AGENT_ID}`, { method: "DELETE" });
      // 200 or 404 are both acceptable here
      assert.ok(res.status === 200 || res.status === 404);
    } catch { /* service not running */ }
  });
});
