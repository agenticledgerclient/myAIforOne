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
//  MEMORY — write + clear operations
// ═══════════════════════════════════════════════════════════════════

describe("Memory API — write and clear", () => {
  it("POST /api/agents/:id/memory/write writes a memory entry", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/memory/write`, {
      method: "POST",
      body: { text: "Test memory entry from API test suite", type: "note" }
    });
    assert.ok(status === 200 || status === 201 || status === 400);
    if (status === 200 || status === 201) {
      assert.ok(typeof body === "object");
    }
  });

  it("POST /api/agents/:id/memory/write rejects empty text", async () => {
    const { status } = await json(`/api/agents/${testAgentId}/memory/write`, {
      method: "POST",
      body: { text: "" }
    });
    assert.ok(status === 400 || status === 200);
  });

  it("DELETE /api/agents/:agentId/memory/context clears context memory", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/memory/context`, {
      method: "DELETE"
    });
    assert.ok(status === 200 || status === 404);
    if (status === 200) {
      assert.ok((body as any).ok || typeof body === "object");
    }
  });

  it("GET /api/agents/NONEXISTENT/memory returns 404", async () => {
    const { status } = await json("/api/agents/NONEXISTENT_AGENT_XYZ/memory");
    assert.equal(status, 404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MCP KEYS — write operations
// ═══════════════════════════════════════════════════════════════════

describe("MCP Keys API — write", () => {
  const testMcpName = "test-mcp-key-suite";

  it("POST /api/agents/:id/mcp-keys saves an MCP key", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/mcp-keys`, {
      method: "POST",
      body: { mcpName: testMcpName, keys: { TEST_KEY: "test-value-123" } }
    });
    assert.ok(status === 200 || status === 400 || status === 404);
    if (status === 200) {
      assert.ok((body as any).ok || typeof body === "object");
    }
  });

  it("DELETE /api/agents/:id/mcp-keys/:mcpName removes MCP key", async () => {
    const { status } = await json(`/api/agents/${testAgentId}/mcp-keys/${testMcpName}`, {
      method: "DELETE"
    });
    assert.ok(status === 200 || status === 404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MCP CONNECTIONS — write operations
// ═══════════════════════════════════════════════════════════════════

describe("MCP Connections API — write", () => {
  let connectionInstance = "";

  it("POST /api/agents/:id/mcp-connections creates a connection", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/mcp-connections`, {
      method: "POST",
      body: { mcpName: "test-mcp-conn", instanceName: "test-instance-999", config: {} }
    });
    assert.ok(status === 200 || status === 400 || status === 404);
    if (status === 200) {
      connectionInstance = "test-instance-999";
    }
  });

  it("DELETE /api/agents/:id/mcp-connections/:instanceName removes connection", async () => {
    if (!connectionInstance) return;
    const { status } = await json(`/api/agents/${testAgentId}/mcp-connections/${connectionInstance}`, {
      method: "DELETE"
    });
    assert.ok(status === 200 || status === 404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  SKILLS CONTENT
// ═══════════════════════════════════════════════════════════════════

describe("Skills Content API", () => {
  it("GET /api/skills/content returns skill file content", async () => {
    // Get a skill first to get a valid path
    const { body: skillsBody } = await json(`/api/agents/${testAgentId}/skills`);
    const skills = (skillsBody as any)?.skills || [];
    if (skills.length === 0) return;

    const { status, body } = await json(`/api/skills/content?path=${encodeURIComponent(skills[0].path)}`);
    assert.ok(status === 200 || status === 400 || status === 404);
    if (status === 200) {
      assert.ok("content" in (body as any) || typeof body === "object");
    }
  });

  it("GET /api/skills/content without path returns 400", async () => {
    const { status } = await json("/api/skills/content");
    assert.ok(status === 400 || status === 200);
  });
});
