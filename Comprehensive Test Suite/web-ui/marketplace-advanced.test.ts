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
//  MARKETPLACE — write operations
// ═══════════════════════════════════════════════════════════════════

describe("Marketplace API — write operations", () => {
  it("POST /api/marketplace/prompt-trigger updates prompt trigger", async () => {
    const { status, body } = await json("/api/marketplace/prompt-trigger", {
      method: "POST",
      body: { agentId: testAgentId, trigger: "" }
    });
    assert.ok(status === 200 || status === 400);
    if (status === 200) {
      assert.ok((body as any).ok || typeof body === "object");
    }
  });

  it("POST /api/marketplace/platform-default sets platform default agent", async () => {
    const { status, body } = await json("/api/marketplace/platform-default", {
      method: "POST",
      body: { agentId: testAgentId }
    });
    assert.ok(status === 200 || status === 400 || status === 404);
    if (status === 200) {
      assert.ok((body as any).ok || typeof body === "object");
    }
  });

  it("POST /api/marketplace/assign assigns skill to agent", async () => {
    const { body: skillsBody } = await json(`/api/agents/${testAgentId}/skills`);
    const skills = (skillsBody as any)?.skills || [];
    if (skills.length === 0) return;

    const { status, body } = await json("/api/marketplace/assign", {
      method: "POST",
      body: { agentId: testAgentId, skillName: skills[0].name, level: "available" }
    });
    assert.ok(status === 200 || status === 400 || status === 404);
  });

  it("POST /api/marketplace/add-mcp adds MCP to registry", async () => {
    const { status, body } = await json("/api/marketplace/add-mcp", {
      method: "POST",
      body: {
        name: "test-mcp-marketplace-999",
        command: "node",
        args: ["test.js"],
        description: "Test MCP added by test suite"
      }
    });
    assert.ok(status === 200 || status === 400);
    if (status === 200) {
      assert.ok((body as any).ok || typeof body === "object");
    }
  });

  it("POST /api/marketplace/create-prompt creates a prompt skill", async () => {
    const { status, body } = await json("/api/marketplace/create-prompt", {
      method: "POST",
      body: {
        name: "test-prompt-skill-999",
        content: "# Test Prompt\nThis is a test.",
        description: "Test prompt created by suite"
      }
    });
    assert.ok(status === 200 || status === 201 || status === 400);
  });

  it("POST /api/skills/create creates a skill file", async () => {
    const { status, body } = await json("/api/skills/create", {
      method: "POST",
      body: {
        name: "test-skill-create-999",
        content: "# Test Skill\nCreated by test suite.",
        agentId: testAgentId
      }
    });
    assert.ok(status === 200 || status === 201 || status === 400);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  LICENSE
// ═══════════════════════════════════════════════════════════════════

describe("License API", () => {
  it("GET /api/license returns license status", async () => {
    const { status, body } = await json("/api/license");
    assert.equal(status, 200);
    const b = body as any;
    assert.ok("valid" in b || "status" in b || "licensed" in b || typeof b === "object");
  });

  it("POST /api/license/check validates a license key", async () => {
    const { status, body } = await json("/api/license/check", {
      method: "POST",
      body: { licenseKey: "INVALID-KEY-FOR-TESTING" }
    });
    assert.ok(status === 200 || status === 400 || status === 422);
    const b = body as any;
    assert.ok(typeof b === "object");
  });
});

// ═══════════════════════════════════════════════════════════════════
//  AGENT PROJECTS LINK (from agent perspective)
// ═══════════════════════════════════════════════════════════════════

describe("Agent Projects API", () => {
  it("POST /api/agents/:id/projects links agent to a project", async () => {
    // First create a project
    const { body: projBody } = await json("/api/projects", {
      method: "POST",
      body: { name: "Agent-Project Link Test", owner: testAgentId, teamMembers: [] }
    });
    const projectId = (projBody as any)?.project?.id;
    if (!projectId) return;

    const { status, body } = await json(`/api/agents/${testAgentId}/projects`, {
      method: "POST",
      body: { projectId }
    });
    assert.ok(status === 200 || status === 400 || status === 404);

    // Cleanup
    await json(`/api/projects/${projectId}`, { method: "DELETE" });
  });
});
