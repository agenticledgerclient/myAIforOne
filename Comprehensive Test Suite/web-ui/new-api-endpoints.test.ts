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

// Find a test agent before running
before(async () => {
  try {
    const { body } = await json("/api/dashboard");
    const agents = (body as any)?.agents || [];
    testAgentId = agents[0]?.id || "myagent-dev";
  } catch { testAgentId = "myagent-dev"; }
});

// ═══════════════════════════════════════════════════════════════════
//  SESSIONS
// ═══════════════════════════════════════════════════════════════════

describe("Sessions API", () => {
  it("GET /api/agents/:id/sessions returns sessions array", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/sessions`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).sessions));
  });

  it("GET /api/agents/NONEXISTENT/sessions returns 404", async () => {
    const { status } = await json("/api/agents/NONEXISTENT_AGENT_XYZ/sessions");
    assert.equal(status, 404);
  });

  it("POST /api/agents/:id/sessions/reset with no session returns ok", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/sessions/reset`, {
      method: "POST", body: { senderId: "test-nonexistent-sender" }
    });
    assert.equal(status, 200);
    assert.equal((body as any).ok, true);
  });

  it("DELETE /api/agents/:id/sessions/nonexistent returns 404", async () => {
    const { status } = await json(`/api/agents/${testAgentId}/sessions/nonexistent-session-xyz`, {
      method: "DELETE"
    });
    assert.equal(status, 404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MODEL OVERRIDES
// ═══════════════════════════════════════════════════════════════════

describe("Model Override API", () => {
  it("GET /api/agents/:id/model returns model state", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/model`);
    assert.equal(status, 200);
    assert.ok("model" in (body as any));
    assert.ok("isOverride" in (body as any));
  });

  it("PUT /api/agents/:id/model sets model with alias", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/model`, {
      method: "PUT", body: { model: "sonnet" }
    });
    assert.equal(status, 200);
    assert.equal((body as any).model, "claude-sonnet-4-6");
  });

  it("GET /api/agents/:id/model confirms override is set", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/model`);
    assert.equal(status, 200);
    assert.equal((body as any).isOverride, true);
    assert.equal((body as any).model, "claude-sonnet-4-6");
  });

  it("DELETE /api/agents/:id/model clears override", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/model`, { method: "DELETE" });
    assert.equal(status, 200);
    assert.equal((body as any).ok, true);
  });

  it("GET /api/agents/:id/model confirms override is cleared", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/model`);
    assert.equal(status, 200);
    assert.equal((body as any).isOverride, false);
    assert.equal((body as any).model, null);
  });

  it("PUT /api/agents/:id/model rejects empty model", async () => {
    const { status } = await json(`/api/agents/${testAgentId}/model`, {
      method: "PUT", body: { model: "" }
    });
    assert.equal(status, 400);
  });

  it("GET /api/agents/NONEXISTENT/model returns 404", async () => {
    const { status } = await json("/api/agents/NONEXISTENT_AGENT_XYZ/model");
    assert.equal(status, 404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  COST TRACKING
// ═══════════════════════════════════════════════════════════════════

describe("Cost API", () => {
  it("GET /api/agents/:id/cost returns cost breakdown", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/cost`);
    assert.equal(status, 200);
    const b = body as any;
    assert.ok("today" in b);
    assert.ok("week" in b);
    assert.ok("allTime" in b);
    assert.ok("totalMessages" in b);
    assert.ok("byDay" in b);
    assert.equal(typeof b.today, "number");
    assert.equal(typeof b.week, "number");
  });

  it("GET /api/cost/all returns cost for all agents", async () => {
    const { status, body } = await json("/api/cost/all");
    assert.equal(status, 200);
    assert.ok("agents" in (body as any));
    assert.equal(typeof (body as any).agents, "object");
  });

  it("GET /api/agents/NONEXISTENT/cost returns 404", async () => {
    const { status } = await json("/api/agents/NONEXISTENT_AGENT_XYZ/cost");
    assert.equal(status, 404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  PAIRING
// ═══════════════════════════════════════════════════════════════════

describe("Pairing API", () => {
  it("GET /api/pairing returns paired list", async () => {
    const { status, body } = await json("/api/pairing");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).paired));
    assert.ok("pairingEnabled" in (body as any));
  });

  it("POST /api/pairing adds a sender", async () => {
    const { status, body } = await json("/api/pairing", {
      method: "POST", body: { senderKey: "test:test-sender-123" }
    });
    assert.equal(status, 200);
    assert.equal((body as any).ok, true);
    assert.ok((body as any).paired.includes("test:test-sender-123"));
  });

  it("DELETE /api/pairing/:key removes sender", async () => {
    const { status, body } = await json("/api/pairing/test:test-sender-123", { method: "DELETE" });
    assert.equal(status, 200);
    assert.equal((body as any).ok, true);
    assert.ok(!(body as any).paired.includes("test:test-sender-123"));
  });

  it("POST /api/pairing rejects empty key", async () => {
    const { status } = await json("/api/pairing", { method: "POST", body: { senderKey: "" } });
    assert.equal(status, 400);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  CONVERSATION LOGS
// ═══════════════════════════════════════════════════════════════════

describe("Conversation Logs API", () => {
  it("GET /api/agents/:id/logs returns paginated entries", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/logs?limit=5`);
    assert.equal(status, 200);
    const b = body as any;
    assert.ok("entries" in b);
    assert.ok("total" in b);
    assert.ok(Array.isArray(b.entries));
    assert.ok(b.entries.length <= 5);
  });

  it("GET /api/agents/:id/logs with search filters results", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/logs?search=test&limit=10`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).entries));
  });

  it("GET /api/agents/:id/logs respects offset", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/logs?limit=3&offset=0`);
    assert.equal(status, 200);
    assert.equal((body as any).limit, 3);
    assert.equal((body as any).offset, 0);
  });

  it("GET /api/agents/NONEXISTENT/logs returns 404", async () => {
    const { status } = await json("/api/agents/NONEXISTENT_AGENT_XYZ/logs");
    assert.equal(status, 404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MEMORY
// ═══════════════════════════════════════════════════════════════════

describe("Memory API", () => {
  it("GET /api/agents/:id/memory returns memory entries", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/memory`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).entries));
  });

  it("POST /api/agents/:id/memory/search finds results", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/memory/search`, {
      method: "POST", body: { query: "agent" }
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).results));
    assert.ok("query" in (body as any));
  });

  it("POST /api/agents/:id/memory/search rejects empty query", async () => {
    const { status } = await json(`/api/agents/${testAgentId}/memory/search`, {
      method: "POST", body: { query: "" }
    });
    assert.equal(status, 400);
  });

  it("GET /api/agents/NONEXISTENT/memory returns 404", async () => {
    const { status } = await json("/api/agents/NONEXISTENT_AGENT_XYZ/memory");
    assert.equal(status, 404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  SKILLS
// ═══════════════════════════════════════════════════════════════════

describe("Skills API", () => {
  it("GET /api/agents/:id/skills returns skills with levels", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/skills`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).skills));
    for (const s of (body as any).skills) {
      assert.ok("name" in s);
      assert.ok("level" in s);
      assert.ok("path" in s);
    }
  });

  it("GET /api/skills/org/:orgName returns org skills", async () => {
    const { status, body } = await json("/api/skills/org/p2pfinance");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).skills));
    assert.equal((body as any).org, "p2pfinance");
    // Should have weekly_wallet_update
    const names = (body as any).skills.map((s: any) => s.name);
    assert.ok(names.includes("weekly_wallet_update"), "Should include org skill");
  });

  it("GET /api/skills/org/NONEXISTENT returns empty array", async () => {
    const { status, body } = await json("/api/skills/org/NONEXISTENT_ORG_XYZ");
    assert.equal(status, 200);
    assert.equal((body as any).skills.length, 0);
  });

  it("GET /api/agents/NONEXISTENT/skills returns 404", async () => {
    const { status } = await json("/api/agents/NONEXISTENT_AGENT_XYZ/skills");
    assert.equal(status, 404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  STICKY ROUTING
// ═══════════════════════════════════════════════════════════════════

describe("Sticky Routing API", () => {
  it("GET /api/sticky-routing returns channel configs", async () => {
    const { status, body } = await json("/api/sticky-routing");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).channels));
    for (const ch of (body as any).channels) {
      assert.ok("channel" in ch);
      assert.ok("stickyRouting" in ch);
      assert.ok("stickyTimeoutMs" in ch);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  CONFIG / ACCOUNTS
// ═══════════════════════════════════════════════════════════════════

describe("Config Accounts API", () => {
  it("GET /api/config/accounts returns account map", async () => {
    const { status, body } = await json("/api/config/accounts");
    assert.equal(status, 200);
    assert.equal(typeof body, "object");
  });

  it("GET /api/config/service returns service settings", async () => {
    const { status, body } = await json("/api/config/service");
    assert.equal(status, 200);
    assert.ok("personalAgentsDir" in (body as any));
    assert.ok("personalRegistryDir" in (body as any), "personalRegistryDir must be present in service settings");
    assert.ok("webUIPort" in (body as any));
    assert.ok("logLevel" in (body as any));
  });
});

// ═══════════════════════════════════════════════════════════════════
//  API DOCS
// ═══════════════════════════════════════════════════════════════════

describe("API Docs", () => {
  it("GET /api-docs returns 200", async () => {
    const res = await fetch(`${BASE}/api-docs`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("MyAIforOne API"));
  });
});

// ═══════════════════════════════════════════════════════════════════
//  HEALTH
// ═══════════════════════════════════════════════════════════════════

describe("Health", () => {
  it("GET /health returns ok", async () => {
    const { status, body } = await json("/health");
    assert.equal(status, 200);
    assert.equal((body as any).ok, true);
    assert.ok(typeof (body as any).uptime === "number");
  });
});
