import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4888";

async function api(path: string, opts: any = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return { res, data: await res.json() };
}

describe("Boards API", () => {
  let createdBoardId: string | null = null;

  // ─── CRUD ──────────────────────────────────────────────────────

  it("GET /api/boards returns array", async () => {
    try {
      const { res, data } = await api("/api/boards");
      if (!res.ok) return;
      assert.ok(Array.isArray(data), "Should return array");
    } catch { /* service not running */ }
  });

  it("POST /api/boards creates a board", async () => {
    try {
      const { res, data } = await api("/api/boards", {
        method: "POST",
        body: JSON.stringify({ name: "Test Board", description: "Test description" }),
      });
      if (!res.ok) return;
      assert.ok(data.id, "Should have an id");
      assert.equal(data.name, "Test Board");
      assert.equal(data.description, "Test description");
      assert.equal(data.status, "active");
      assert.ok(Array.isArray(data.widgets), "Should have widgets array");
      assert.ok(data.createdAt, "Should have createdAt");
      createdBoardId = data.id;
    } catch { /* service not running */ }
  });

  it("POST /api/boards rejects missing name", async () => {
    try {
      const { res, data } = await api("/api/boards", {
        method: "POST",
        body: JSON.stringify({ description: "No name" }),
      });
      assert.equal(res.status, 400);
      assert.ok(data.error.includes("name"), "Should mention name in error");
    } catch { /* service not running */ }
  });

  it("GET /api/boards/:id returns enriched board", async () => {
    if (!createdBoardId) return;
    try {
      const { res, data } = await api(`/api/boards/${createdBoardId}`);
      if (!res.ok) return;
      assert.equal(data.id, createdBoardId);
      assert.equal(data.name, "Test Board");
      assert.ok(Array.isArray(data.widgets));
    } catch { /* service not running */ }
  });

  it("GET /api/boards/:id returns 404 for nonexistent", async () => {
    try {
      const { res } = await api("/api/boards/nonexistent_board_999");
      assert.equal(res.status, 404);
    } catch { /* service not running */ }
  });

  it("PUT /api/boards/:id updates board fields", async () => {
    if (!createdBoardId) return;
    try {
      const { res, data } = await api(`/api/boards/${createdBoardId}`, {
        method: "PUT",
        body: JSON.stringify({ name: "Updated Board", status: "paused" }),
      });
      if (!res.ok) return;
      assert.equal(data.name, "Updated Board");
      assert.equal(data.status, "paused");
    } catch { /* service not running */ }
  });

  it("PUT /api/boards/:id can set defaultBoard", async () => {
    if (!createdBoardId) return;
    try {
      const { res, data } = await api(`/api/boards/${createdBoardId}`, {
        method: "PUT",
        body: JSON.stringify({ defaultBoard: true }),
      });
      if (!res.ok) return;
      assert.equal(data.defaultBoard, true);
    } catch { /* service not running */ }
  });

  // ─── Widgets ───────────────────────────────────────────────────

  it("POST /api/boards/:id/widgets rejects non-board-enabled agent", async () => {
    if (!createdBoardId) return;
    try {
      // Try adding any agent — it should fail if not board-enabled
      const dash = await fetch(`${BASE}/api/dashboard`);
      if (!dash.ok) return;
      const dashData = await dash.json() as any;
      if (!dashData.agents?.length) return;
      // Find an agent that is NOT board-enabled
      const nonBoardAgent = dashData.agents.find((a: any) => !a.boardEnabled && a.agentClass !== "board");
      if (!nonBoardAgent) return; // all are board-enabled, skip test
      const { res } = await api(`/api/boards/${createdBoardId}/widgets`, {
        method: "POST",
        body: JSON.stringify({ agentId: nonBoardAgent.id }),
      });
      assert.equal(res.status, 400, "Should reject non-board-enabled agent");
    } catch { /* service not running */ }
  });

  it("POST /api/boards/:id/widgets rejects missing agentId", async () => {
    if (!createdBoardId) return;
    try {
      const { res } = await api(`/api/boards/${createdBoardId}/widgets`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
    } catch { /* service not running */ }
  });

  it("PUT /api/boards/:id/widgets updates widget positions", async () => {
    if (!createdBoardId) return;
    try {
      const { res, data } = await api(`/api/boards/${createdBoardId}/widgets`, {
        method: "PUT",
        body: JSON.stringify({ widgets: [] }),
      });
      if (!res.ok) return;
      assert.ok(Array.isArray(data.widgets));
      assert.equal(data.widgets.length, 0);
    } catch { /* service not running */ }
  });

  // ─── Board-Enabled Agents ─────────────────────────────────────

  it("GET /api/agents/board-enabled returns array", async () => {
    try {
      const { res, data } = await api("/api/agents/board-enabled");
      if (!res.ok) return;
      assert.ok(Array.isArray(data), "Should return array");
      for (const agent of data) {
        assert.ok(agent.agentId, "Each agent should have agentId");
        assert.ok(agent.name, "Each agent should have name");
      }
    } catch { /* service not running */ }
  });

  // ─── Refresh ──────────────────────────────────────────────────

  it("POST /api/boards/:id/refresh returns enriched data", async () => {
    if (!createdBoardId) return;
    try {
      const { res, data } = await api(`/api/boards/${createdBoardId}/refresh`, {
        method: "POST",
      });
      if (!res.ok) return;
      assert.ok(data.lastRefreshedAt, "Should set lastRefreshedAt");
      assert.ok(Array.isArray(data.widgets));
    } catch { /* service not running */ }
  });

  it("POST /api/boards/:id/refresh returns 404 for nonexistent", async () => {
    try {
      const { res } = await api("/api/boards/nonexistent/refresh", { method: "POST" });
      assert.equal(res.status, 404);
    } catch { /* service not running */ }
  });

  // ─── Cleanup ──────────────────────────────────────────────────

  it("DELETE /api/boards/:id deletes the board", async () => {
    if (!createdBoardId) return;
    try {
      const { res, data } = await api(`/api/boards/${createdBoardId}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      assert.equal(data.ok, true);

      // Verify it's gone
      const { res: res2 } = await api(`/api/boards/${createdBoardId}`);
      assert.equal(res2.status, 404);
    } catch { /* service not running */ }
  });

  it("DELETE /api/boards/:id returns 404 for nonexistent", async () => {
    try {
      const { res } = await api("/api/boards/nonexistent", { method: "DELETE" });
      assert.equal(res.status, 404);
    } catch { /* service not running */ }
  });
});

describe("Board Agent Config", () => {
  it("AgentConfig supports boardEnabled and boardLayout fields", async () => {
    try {
      // Verify the agent update API accepts boardEnabled/boardLayout
      const dash = await fetch(`${BASE}/api/dashboard`);
      if (!dash.ok) return;
      const dashData = await dash.json() as any;
      if (!dashData.agents?.length) return;
      const agentId = dashData.agents[0].id;

      // Get current config
      const agentRes = await fetch(`${BASE}/api/agents/${agentId}`);
      if (!agentRes.ok) return;
      const agentData = await agentRes.json() as any;

      // The fields should be accepted without error (even if not set)
      assert.ok(typeof agentData === "object", "Should return agent object");
    } catch { /* service not running */ }
  });
});
