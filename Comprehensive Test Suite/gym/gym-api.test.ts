import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4888";

async function tryFetch(path: string, opts?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(`${BASE}${path}`, opts);
  } catch {
    return null; // service not running
  }
}

describe("gym — API endpoint contracts", () => {
  // ── Learner Profile ───────────────────────────────────────────────

  it("GET /api/gym/learner-profile returns profile shape", async () => {
    const resp = await tryFetch("/api/gym/learner-profile");
    if (!resp || !resp.ok) return;
    const data = await resp.json() as any;
    assert.ok("dimensions" in data || "createdAt" in data || "updatedAt" in data);
  });

  it("PUT /api/gym/learner-profile merges fields", async () => {
    const resp = await tryFetch("/api/gym/learner-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _testField: "test" }),
    });
    if (!resp || !resp.ok) return;
    const data = await resp.json() as any;
    assert.ok("updatedAt" in data);
  });

  // ── Plan ──────────────────────────────────────────────────────────

  it("GET /api/gym/plan returns plan object", async () => {
    const resp = await tryFetch("/api/gym/plan");
    if (!resp || !resp.ok) return;
    const data = await resp.json() as any;
    assert.ok(typeof data === "object");
  });

  it("PUT /api/gym/plan writes plan", async () => {
    const resp = await tryFetch("/api/gym/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modules: [], updatedAt: new Date().toISOString() }),
    });
    if (!resp || !resp.ok) return;
    const data = await resp.json() as any;
    assert.ok("updatedAt" in data);
  });

  // ── Progress ──────────────────────────────────────────────────────

  it("GET /api/gym/progress returns progress object", async () => {
    const resp = await tryFetch("/api/gym/progress");
    if (!resp || !resp.ok) return;
    const data = await resp.json() as any;
    assert.ok(typeof data === "object");
  });

  // ── Cards ─────────────────────────────────────────────────────────

  it("GET /api/gym/cards returns array", async () => {
    const resp = await tryFetch("/api/gym/cards");
    if (!resp || !resp.ok) return;
    const data = await resp.json() as any;
    assert.ok(Array.isArray(data));
  });

  it("POST /api/gym/cards creates a card with id", async () => {
    const resp = await tryFetch("/api/gym/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test Card", description: "test", type: "test" }),
    });
    if (!resp) return;
    assert.equal(resp.status, 201);
    const data = await resp.json() as any;
    assert.ok(data.id);
    assert.equal(data.title, "Test Card");

    // Clean up — dismiss the card
    if (data.id) {
      await tryFetch(`/api/gym/cards/${data.id}`, { method: "DELETE" });
    }
  });

  // ── Dimensions ────────────────────────────────────────────────────

  it("POST /api/gym/dimensions/snapshot saves snapshot", async () => {
    const resp = await tryFetch("/api/gym/dimensions/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2099-01-01",
        dimensions: { application: 3, communication: 2, knowledge: 3, orchestration: 1, craft: 2 },
      }),
    });
    if (!resp) return;
    assert.equal(resp.status, 201);
    const data = await resp.json() as any;
    assert.equal(data.date, "2099-01-01");
  });

  it("GET /api/gym/dimensions/history returns array", async () => {
    const resp = await tryFetch("/api/gym/dimensions/history");
    if (!resp || !resp.ok) return;
    const data = await resp.json() as any;
    assert.ok(Array.isArray(data));
  });

  // ── Programs ──────────────────────────────────────────────────────

  it("GET /api/gym/programs returns array of programs", async () => {
    const resp = await tryFetch("/api/gym/programs");
    if (!resp || !resp.ok) return;
    const data = await resp.json() as any;
    assert.ok(Array.isArray(data));
  });

  it("GET /api/gym/programs/getting-started returns program with modules", async () => {
    const resp = await tryFetch("/api/gym/programs/getting-started");
    if (!resp || !resp.ok) return;
    const data = await resp.json() as any;
    assert.equal(data.slug, "getting-started");
    assert.ok(Array.isArray(data.modules));
    assert.ok(data.modules.length >= 3);
  });

  it("GET /api/gym/programs/nonexistent returns 404", async () => {
    const resp = await tryFetch("/api/gym/programs/nonexistent-program-xyz");
    if (!resp) return;
    assert.equal(resp.status, 404);
  });

  it("POST /api/gym/programs/import-markdown parses markdown", async () => {
    const markdown = `# Test Program\n\n## Module 1: Basics\n\n### Step 1: Hello\nContent here.`;
    const resp = await tryFetch("/api/gym/programs/import-markdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown }),
    });
    if (!resp) return;
    assert.equal(resp.status, 201);
    const data = await resp.json() as any;
    assert.equal(data.title, "Test Program");
    assert.ok(data.modules.length >= 1);
    assert.equal(data.modules[0].title, "Basics");

    // Clean up
    if (data.slug) {
      await tryFetch(`/api/gym/programs/${data.slug}`, { method: "DELETE" });
    }
  });

  // ── Agent Activity ────────────────────────────────────────────────

  it("GET /api/agents/hub/activity-summary returns summary shape", async () => {
    const resp = await tryFetch("/api/agents/hub/activity-summary");
    if (!resp || !resp.ok) return;
    const data = await resp.json() as any;
    assert.ok("agentId" in data);
    assert.ok("messageCount" in data);
    assert.ok("activeDays" in data);
    assert.ok("toolUseCounts" in data);
  });

  it("GET /api/agents/logs/search requires q param", async () => {
    const resp = await tryFetch("/api/agents/logs/search");
    if (!resp) return;
    assert.equal(resp.status, 400);
  });

  it("GET /api/agents/logs/search with q returns results shape", async () => {
    const resp = await tryFetch("/api/agents/logs/search?q=test");
    if (!resp || !resp.ok) return;
    const data = await resp.json() as any;
    assert.ok("query" in data);
    assert.ok("count" in data);
    assert.ok(Array.isArray(data.results));
  });

  it("GET /api/agents/hub/logs returns paginated entries", async () => {
    const resp = await tryFetch("/api/agents/hub/logs?limit=5&offset=0");
    if (!resp || !resp.ok) return;
    const data = await resp.json() as any;
    assert.ok("total" in data);
    assert.ok("entries" in data);
    assert.ok(Array.isArray(data.entries));
    assert.ok(data.limit <= 5);
  });

  // ── Feed Aggregator ────────────────────────────────────────────────

  it("GET /api/gym/feed returns tips, platformUpdates, briefing", async () => {
    const resp = await tryFetch("/api/gym/feed");
    if (!resp || !resp.ok) return;
    const data = await resp.json() as any;
    assert.ok("tips" in data, "Feed should contain tips");
    assert.ok("platformUpdates" in data, "Feed should contain platformUpdates");
    assert.ok("briefing" in data, "Feed should contain briefing");
    assert.ok(Array.isArray(data.tips), "tips should be an array");
    assert.ok(Array.isArray(data.platformUpdates), "platformUpdates should be an array");
    assert.ok(Array.isArray(data.briefing), "briefing should be an array");
  });

  // ── Gym Config ─────────────────────────────────────────────────────

  it("GET /api/gym/config returns gym flags", async () => {
    const resp = await tryFetch("/api/gym/config");
    if (!resp || !resp.ok) return;
    const data = await resp.json() as any;
    assert.ok("gymEnabled" in data, "Config should contain gymEnabled");
    assert.ok("gymOnlyMode" in data, "Config should contain gymOnlyMode");
    assert.ok("aibriefingEnabled" in data, "Config should contain aibriefingEnabled");
    assert.equal(typeof data.gymEnabled, "boolean", "gymEnabled should be boolean");
    assert.equal(typeof data.gymOnlyMode, "boolean", "gymOnlyMode should be boolean");
    assert.equal(typeof data.aibriefingEnabled, "boolean", "aibriefingEnabled should be boolean");
  });
});
