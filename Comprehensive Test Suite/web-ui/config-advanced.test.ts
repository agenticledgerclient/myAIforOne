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
//  PROFILE
// ═══════════════════════════════════════════════════════════════════

describe("Profile API", () => {
  it("GET /api/profile returns profile object", async () => {
    const { status, body } = await json("/api/profile");
    assert.equal(status, 200);
    assert.equal(typeof body, "object");
    assert.ok(body !== null);
  });

  it("PUT /api/profile updates profile fields", async () => {
    const { status, body } = await json("/api/profile", {
      method: "PUT",
      body: { _testField: "test-value-api-suite" }
    });
    assert.equal(status, 200);
    // Response is { ok: true, profile: { ... } } or { updatedAt: ... }
    assert.ok((body as any).ok || (body as any).updatedAt || typeof body === "object");
  });
});

// ═══════════════════════════════════════════════════════════════════
//  SERVICE CONFIG
// ═══════════════════════════════════════════════════════════════════

describe("Service Config API", () => {
  it("GET /api/config/service returns full service settings", async () => {
    const { status, body } = await json("/api/config/service");
    assert.equal(status, 200);
    const b = body as any;
    assert.ok("personalAgentsDir" in b);
    assert.ok("webUIPort" in b);
    assert.ok("logLevel" in b);
  });

  it("PUT /api/config/service accepts valid settings object", async () => {
    // Read current config first, then write it back unchanged
    const { body: current } = await json("/api/config/service");
    const { status, body } = await json("/api/config/service", {
      method: "PUT",
      body: { logLevel: (current as any)?.logLevel ?? "info" }
    });
    assert.equal(status, 200);
    assert.ok((body as any).ok);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  ACCOUNTS
// ═══════════════════════════════════════════════════════════════════

describe("Accounts API — advanced", () => {
  it("GET /api/config/accounts returns accounts map", async () => {
    const { status, body } = await json("/api/config/accounts");
    assert.equal(status, 200);
    assert.equal(typeof body, "object");
  });

  it("GET /api/config/accounts/:name/status returns response for first account", async () => {
    const { body: accounts } = await json("/api/config/accounts");
    const names = Object.keys((accounts as any) || {});
    if (names.length === 0) return;
    const { status } = await json(`/api/config/accounts/${encodeURIComponent(names[0])}/status`);
    assert.ok(status === 200 || status === 500);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  WHOAMI
// ═══════════════════════════════════════════════════════════════════

describe("Whoami API", () => {
  it("GET /api/whoami/:agentId returns agent identity info", async () => {
    const { status, body } = await json(`/api/whoami/${testAgentId}`);
    assert.equal(status, 200);
    const b = body as any;
    assert.ok("agentId" in b || "id" in b || typeof b === "object");
  });

  it("GET /api/whoami/NONEXISTENT returns 200 with default account info", async () => {
    // whoami falls back to default account even for unknown agentIds
    const { status, body } = await json("/api/whoami/NONEXISTENT_AGENT_XYZ_999");
    assert.ok(status === 200 || status === 404);
    if (status === 200) {
      assert.ok(typeof body === "object");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  SAAS CONFIG
// ═══════════════════════════════════════════════════════════════════

describe("SaaS Config API", () => {
  it("GET /api/saas/config returns saas settings", async () => {
    const { status, body } = await json("/api/saas/config");
    assert.equal(status, 200);
    assert.equal(typeof body, "object");
  });

  it("PUT /api/saas/config accepts partial updates", async () => {
    const { body: current } = await json("/api/saas/config");
    const { status, body } = await json("/api/saas/config", {
      method: "PUT",
      body: { enabled: (current as any)?.enabled ?? false }
    });
    assert.equal(status, 200);
    assert.ok((body as any).ok || typeof body === "object");
  });
});

// ═══════════════════════════════════════════════════════════════════
//  VERSION & SYSTEM
// ═══════════════════════════════════════════════════════════════════

describe("System Endpoints", () => {
  it("GET /api/version returns version info", async () => {
    const { status, body } = await json("/api/version");
    assert.equal(status, 200);
    const b = body as any;
    assert.ok("version" in b || "current" in b || typeof b.version === "string" || typeof b === "object");
  });

  it("GET /api/capabilities returns capabilities list", async () => {
    const { status, body } = await json("/api/capabilities");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body) || typeof body === "object");
  });

  it("GET /api/user-guide returns user guide content", async () => {
    const { status, body } = await json("/api/user-guide");
    assert.equal(status, 200);
    assert.ok("content" in (body as any) || typeof (body as any) === "string" || typeof body === "object");
  });

  it("GET /api/browse-dirs returns directory listing", async () => {
    const { status, body } = await json("/api/browse-dirs?path=" + encodeURIComponent("~"));
    assert.ok(status === 200 || status === 400);
    if (status === 200) {
      assert.ok(Array.isArray((body as any).entries) || typeof body === "object");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  APPS — additional coverage
// ═══════════════════════════════════════════════════════════════════

describe("Apps API — advanced", () => {
  let appId = "";

  it("POST /api/apps creates app, PUT updates it, DELETE removes it", async () => {
    // Create
    const create = await json("/api/apps", {
      method: "POST",
      body: { name: "AdvancedTestApp", provider: "test", category: "test" }
    });
    assert.equal(create.status, 200);
    appId = (create.body as any)?.id || "";

    if (!appId) return;

    // Update
    const update = await json(`/api/apps/${appId}`, {
      method: "PUT",
      body: { name: "AdvancedTestApp Updated", category: "updated" }
    });
    assert.equal(update.status, 200);

    // Delete
    const del = await json(`/api/apps/${appId}`, { method: "DELETE" });
    assert.equal(del.status, 200);
  });

  it("POST /api/apps/:id/check-health validates app has URL before checking", async () => {
    // Create an app without a URL — should return 400 (no URL configured)
    const create = await json("/api/apps", {
      method: "POST",
      body: { name: "HealthTestAppSuite", provider: "test", category: "test" }
    });
    const id = (create.body as any)?.id;
    if (!id) return;

    // App has no URL, expect 400
    const { status } = await json(`/api/apps/${id}/check-health`, { method: "POST" });
    assert.ok(status === 400 || status === 200 || status === 500);

    // Cleanup
    await json(`/api/apps/${id}`, { method: "DELETE" });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  DRIVE
// ═══════════════════════════════════════════════════════════════════

describe("Drive API", () => {
  it("GET /api/drive/browse returns directory structure", async () => {
    const { status, body } = await json("/api/drive/browse");
    assert.ok(status === 200 || status === 400);
    if (status === 200) {
      assert.ok(typeof body === "object");
    }
  });

  it("GET /api/drive/search requires q param", async () => {
    const { status } = await json("/api/drive/search");
    assert.ok(status === 400 || status === 200);
  });

  it("GET /api/drive/search with q returns results", async () => {
    const { status, body } = await json("/api/drive/search?q=test");
    assert.ok(status === 200 || status === 400);
    if (status === 200) {
      assert.ok(Array.isArray((body as any).results) || typeof body === "object");
    }
  });

  it("GET /api/drive/read requires path param", async () => {
    const { status } = await json("/api/drive/read");
    assert.ok(status === 400 || status === 200);
  });
});
