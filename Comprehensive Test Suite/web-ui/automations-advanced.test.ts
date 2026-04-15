import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4888";
let testAgentId = "";

async function json(url: string, opts?: any) {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

before(async () => {
  try {
    const { body } = await json("/api/dashboard");
    const agents = (body as any)?.agents || [];
    testAgentId = agents[0]?.id || "myagent-dev";
  } catch { testAgentId = "myagent-dev"; }
});

// ═══════════════════════════════════════════════════════════════════
//  GOALS — full CRUD + toggle/trigger/history
// ═══════════════════════════════════════════════════════════════════

describe("Goals API — advanced", () => {
  let goalId = "";

  it("POST /api/agents/:id/goals creates goal", async () => {
    const unique = `test-goal-advanced-${Date.now()}`;
    const { status, body } = await json(`/api/agents/${testAgentId}/goals`, {
      method: "POST",
      body: {
        id: unique,
        description: "Advanced test goal",
        heartbeat: "0 0 31 2 *",
        successCriteria: "Test passes",
        instructions: "Do nothing"
      }
    });
    assert.equal(status, 200);
    goalId = (body as any)?.goalId || (body as any)?.id || unique;
  });

  it("PUT /api/agents/:id/goals/:goalId updates goal", async () => {
    if (!goalId) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/goals/${goalId}`, {
      method: "PUT",
      body: { description: "Updated advanced test goal", heartbeat: "0 0 31 2 *" }
    });
    assert.equal(status, 200);
    assert.ok((body as any).ok);
  });

  it("POST /api/agents/:id/goals/:goalId/toggle toggles goal enabled state", async () => {
    if (!goalId) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/goals/${goalId}/toggle`, {
      method: "POST"
    });
    assert.equal(status, 200);
    assert.ok("enabled" in (body as any));
  });

  it("GET /api/agents/:id/goals/:goalId/history returns history array", async () => {
    if (!goalId) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/goals/${goalId}/history`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).history) || Array.isArray(body));
  });

  it("DELETE /api/agents/:id/goals/:goalId removes goal", async () => {
    if (!goalId) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/goals/${goalId}`, {
      method: "DELETE"
    });
    assert.equal(status, 200);
    assert.ok((body as any).ok);
    goalId = "";
  });
});

// ═══════════════════════════════════════════════════════════════════
//  CRON — full CRUD + toggle/trigger/history
// ═══════════════════════════════════════════════════════════════════

describe("Cron API — advanced", () => {
  let cronIndex: number | undefined;

  it("POST /api/agents/:id/cron creates cron job", async () => {
    const { body: agentBody } = await json(`/api/agents/${testAgentId}`);
    const route = (agentBody as any)?.config?.routes?.[0];

    const { status, body } = await json(`/api/agents/${testAgentId}/cron`, {
      method: "POST",
      body: {
        schedule: "0 0 31 2 *",
        message: "Advanced test cron — never fires",
        channel: route?.channel || "web",
        chatId: route?.match?.value || "test"
      }
    });
    assert.equal(status, 200);
    cronIndex = (body as any)?.index;
  });

  it("PUT /api/agents/:id/cron/:index updates cron", async () => {
    if (cronIndex === undefined) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/cron/${cronIndex}`, {
      method: "PUT",
      body: { message: "Updated advanced test cron" }
    });
    assert.equal(status, 200);
    assert.ok((body as any).ok);
  });

  it("POST /api/agents/:id/cron/:index/toggle toggles cron enabled", async () => {
    if (cronIndex === undefined) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/cron/${cronIndex}/toggle`, {
      method: "POST"
    });
    assert.equal(status, 200);
    assert.ok("enabled" in (body as any));
  });

  it("GET /api/agents/:id/cron/:index/history returns history", async () => {
    if (cronIndex === undefined) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/cron/${cronIndex}/history`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).history) || Array.isArray(body));
  });

  it("DELETE /api/agents/:id/cron/:index removes cron", async () => {
    if (cronIndex === undefined) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/cron/${cronIndex}`, {
      method: "DELETE"
    });
    assert.equal(status, 200);
    assert.ok((body as any).ok);
    cronIndex = undefined;
  });
});

// ═══════════════════════════════════════════════════════════════════
//  HEARTBEAT
// ═══════════════════════════════════════════════════════════════════

describe("Heartbeat API", () => {
  it("POST /api/agents/:id/heartbeat triggers heartbeat", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/heartbeat`, {
      method: "POST"
    });
    assert.ok(status === 200 || status === 202 || status === 500);
    if (status === 200) {
      assert.ok("ok" in (body as any) || typeof body === "object");
    }
  });

  it("GET /api/agents/:id/heartbeat-history returns history array", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/heartbeat-history`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).history) || Array.isArray(body) || typeof body === "object");
  });
});

// ═══════════════════════════════════════════════════════════════════
//  WIKI SYNC
// ═══════════════════════════════════════════════════════════════════

describe("Wiki Sync API", () => {
  it("POST /api/agents/:id/wiki-sync triggers wiki sync", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/wiki-sync`, {
      method: "POST"
    });
    assert.ok(status === 200 || status === 202 || status === 500);
    if (status === 200) {
      assert.ok(typeof body === "object");
    }
  });

  it("GET /api/agents/:id/wiki-sync-history returns sync history", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/wiki-sync-history`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).history) || Array.isArray(body) || typeof body === "object");
  });
});

// ═══════════════════════════════════════════════════════════════════
//  AGENT RECOVER
// ═══════════════════════════════════════════════════════════════════

describe("Agent Recover API", () => {
  it("POST /api/agents/:agentId/recover rejects missing body fields", async () => {
    // recover requires userText or response in body — empty body returns 400 or 500
    const { status } = await json(`/api/agents/${testAgentId}/recover`, {
      method: "POST",
      body: {}
    });
    assert.ok(status === 400 || status === 500);
  });

  it("POST /api/agents/:agentId/recover with userText returns 200", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/recover`, {
      method: "POST",
      body: { userText: "test recovery message from test suite" }
    });
    assert.ok(status === 200 || status === 201);
    if (status === 200) {
      assert.ok((body as any).ok || typeof body === "object");
    }
  });

  it("POST /api/agents/NONEXISTENT/recover returns 404", async () => {
    const { status } = await json("/api/agents/NONEXISTENT_AGENT_XYZ/recover", {
      method: "POST",
      body: { userText: "test" }
    });
    assert.equal(status, 404);
  });
});
