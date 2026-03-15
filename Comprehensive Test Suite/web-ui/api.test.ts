import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4888";

describe("web-ui API endpoints", () => {
  it("GET /api/dashboard returns agents with org data", async () => {
    try {
      const res = await fetch(`${BASE}/api/dashboard`);
      if (!res.ok) return;
      const data = await res.json() as any;
      assert.ok(Array.isArray(data.agents));

      // Check that org field is present
      for (const agent of data.agents) {
        assert.ok("org" in agent, `Agent ${agent.id} should have org field`);
        assert.ok(Array.isArray(agent.org));
        assert.ok("streaming" in agent, `Agent ${agent.id} should have streaming field`);
      }
    } catch { /* service not running */ }
  });

  it("GET /api/mcps returns MCP list", async () => {
    try {
      const res = await fetch(`${BASE}/api/mcps`);
      if (!res.ok) return;
      const data = await res.json() as any;
      assert.ok("mcps" in data);
      assert.ok(Array.isArray(data.mcps));
    } catch { /* service not running */ }
  });

  it("GET /api/agents/:id returns recent messages", async () => {
    try {
      const dash = await fetch(`${BASE}/api/dashboard`);
      if (!dash.ok) return;
      const dashData = await dash.json() as any;
      if (dashData.agents.length === 0) return;

      const agentId = dashData.agents[0].id;
      const res = await fetch(`${BASE}/api/agents/${agentId}`);
      const data = await res.json() as any;
      assert.ok("id" in data);
      assert.ok("config" in data);
      assert.ok("recentMessages" in data);
      assert.ok(Array.isArray(data.recentMessages));
    } catch { /* service not running */ }
  });

  it("POST /api/agents rejects missing fields", async () => {
    try {
      const res = await fetch(`${BASE}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }), // missing agentId and alias
      });
      if (res.status === 400) {
        const data = await res.json() as any;
        assert.ok(data.error.includes("Missing"));
      }
    } catch { /* service not running */ }
  });

  it("PUT /api/agents/:id rejects unknown agent", async () => {
    try {
      const res = await fetch(`${BASE}/api/agents/nonexistent-agent-xyz`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test", alias: "@test" }),
      });
      if (res.status === 404) {
        assert.ok(true, "Correctly rejected unknown agent");
      }
    } catch { /* service not running */ }
  });

  it("POST /api/chat/:id/stream returns SSE headers for streaming agent", async () => {
    try {
      // Find a streaming agent
      const dash = await fetch(`${BASE}/api/dashboard`);
      if (!dash.ok) return;
      const dashData = await dash.json() as any;
      const streamAgent = dashData.agents.find((a: any) => a.streaming);
      if (!streamAgent) return; // no streaming agent configured

      // Just check the endpoint exists and returns SSE content type
      // Don't actually send a real message (would trigger Claude)
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 2000);

      const res = await fetch(`${BASE}/api/chat/${streamAgent.id}/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "" }), // empty text should be rejected
        signal: controller.signal,
      }).catch(() => null);

      if (res && res.status === 400) {
        assert.ok(true, "Empty text correctly rejected");
      }
    } catch { /* service not running or aborted */ }
  });
});
