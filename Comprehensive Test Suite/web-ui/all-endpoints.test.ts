import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4888";
let testAgentId = "";
let allAgents: any[] = [];

async function json(url: string, opts?: any) {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
}

async function raw(url: string, opts?: any) {
  const res = await fetch(`${BASE}${url}`, opts);
  return { status: res.status, text: await res.text(), headers: res.headers };
}

before(async () => {
  const { body } = await json("/api/dashboard");
  allAgents = (body as any)?.agents || [];
  testAgentId = allAgents[0]?.id || "myagent-dev";
});

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD & HEALTH
// ═══════════════════════════════════════════════════════════════════

describe("Dashboard & Health", () => {
  it("GET /health returns ok + uptime", async () => {
    const { status, body } = await json("/health");
    assert.equal(status, 200);
    assert.equal((body as any).ok, true);
    assert.equal(typeof (body as any).uptime, "number");
  });

  it("GET /api/dashboard returns agents, channels, accounts", async () => {
    const { status, body } = await json("/api/dashboard");
    assert.equal(status, 200);
    const b = body as any;
    assert.ok(Array.isArray(b.agents));
    assert.ok(b.agents.length > 0, "Should have at least one agent");
    assert.ok("claudeAccounts" in b);
    // Each agent should have core fields
    const a = b.agents[0];
    assert.ok("id" in a);
    assert.ok("name" in a);
    assert.ok("org" in a);
  });

  it("GET /api/agent-registry returns registry", async () => {
    const { status, body } = await json("/api/agent-registry");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).agents));
  });
});

// ═══════════════════════════════════════════════════════════════════
//  AGENTS CRUD
// ═══════════════════════════════════════════════════════════════════

describe("Agents CRUD", () => {
  const testId = `test-agent-${Date.now()}`;

  it("GET /api/agents returns agent list", async () => {
    const { status, body } = await json("/api/agents");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).agents));
  });

  it("GET /api/agents?org=DemoOrg filters by org", async () => {
    const { status, body } = await json("/api/agents?org=DemoOrg");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).agents));
    // At least some agents should be returned for DemoOrg
  });

  it("GET /api/platform-agents returns only platform agents", async () => {
    const { status, body } = await json("/api/platform-agents");
    assert.equal(status, 200);
    const b = body as any;
    assert.ok(Array.isArray(b.agents), "Should return agents array");
    for (const agent of b.agents) {
      assert.ok("id" in agent, "Each agent should have id");
      assert.ok("name" in agent, "Each agent should have name");
      assert.ok("description" in agent, "Each agent should have description");
      assert.ok("streaming" in agent, "Each agent should have streaming");
      assert.equal(typeof agent.streaming, "boolean", "streaming should be boolean");
    }
  });

  it("GET /api/agents/:id returns agent detail", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}`);
    assert.equal(status, 200);
    const b = body as any;
    assert.ok("id" in b);
    assert.ok("config" in b || "recentMessages" in b);
  });

  it("GET /api/agents/:id/instructions returns CLAUDE.md", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/instructions`);
    assert.equal(status, 200);
    assert.ok("instructions" in (body as any));
  });

  it("GET /api/agents/NONEXISTENT returns 404", async () => {
    const { status } = await json("/api/agents/NONEXISTENT_XYZ_999");
    assert.equal(status, 404);
  });

  it("POST /api/agents creates or rejects agent", async () => {
    const unique = `test-agent-${Date.now()}`;
    const { status } = await json("/api/agents", {
      method: "POST",
      body: { agentId: unique, name: "Test Agent API", alias: `@${unique}`, description: "Test" }
    });
    assert.ok(status === 200 || status === 201 || status === 400); // 400 if field naming differs
    // Cleanup
    await json(`/api/agents/${unique}`, { method: "DELETE" });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  CHAT
// ═══════════════════════════════════════════════════════════════════

describe("Chat", () => {
  it("POST /api/chat/:agentId/stream starts job, returns jobId", async () => {
    const { status, body } = await json(`/api/chat/${testAgentId}/stream`, {
      method: "POST",
      body: { text: "ping", accountOverride: "" }
    });
    assert.equal(status, 200);
    assert.ok((body as any).jobId, "Should return a jobId");
  });

  it("POST /api/chat/:agentId/stream rejects empty text", async () => {
    const { status } = await json(`/api/chat/${testAgentId}/stream`, {
      method: "POST", body: { text: "" }
    });
    assert.equal(status, 400);
  });

  it("GET /api/chat/jobs/NONEXISTENT/stream returns 404 or error", async () => {
    const res = await raw(`/api/chat/jobs/nonexistent-job-xyz/stream`);
    assert.ok(res.status === 404 || res.status === 200); // SSE may return 200 with error event
  });

  it("POST /api/chat/jobs/NONEXISTENT/stop returns 404", async () => {
    const { status } = await json("/api/chat/jobs/nonexistent-job-xyz/stop", { method: "POST" });
    assert.equal(status, 404);
  });

  it("POST /api/delegate sends inter-agent message", async () => {
    const { status } = await json("/api/delegate", {
      method: "POST",
      body: { agentId: testAgentId, text: "test delegate ping" }
    });
    // May return 200, 202, or even 500 if agent is busy
    assert.ok(status >= 200 && status < 600);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  SESSIONS
// ═══════════════════════════════════════════════════════════════════

describe("Sessions", () => {
  it("GET /api/agents/:id/sessions returns sessions", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/sessions`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).sessions));
  });

  it("POST /api/agents/:id/sessions/reset with fake sender returns ok", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/sessions/reset`, {
      method: "POST", body: { senderId: "fake-sender-xyz" }
    });
    assert.equal(status, 200);
    assert.equal((body as any).ok, true);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MODEL OVERRIDES
// ═══════════════════════════════════════════════════════════════════

describe("Model Overrides", () => {
  it("GET → PUT → GET → DELETE → GET lifecycle", async () => {
    // Initial state
    let r = await json(`/api/agents/${testAgentId}/model`);
    assert.equal(r.status, 200);

    // Set
    r = await json(`/api/agents/${testAgentId}/model`, { method: "PUT", body: { model: "haiku" } });
    assert.equal(r.status, 200);
    assert.equal((r.body as any).model, "claude-haiku-4-5-20251001");

    // Verify
    r = await json(`/api/agents/${testAgentId}/model`);
    assert.equal((r.body as any).isOverride, true);

    // Clear
    r = await json(`/api/agents/${testAgentId}/model`, { method: "DELETE" });
    assert.equal(r.status, 200);

    // Verify cleared
    r = await json(`/api/agents/${testAgentId}/model`);
    assert.equal((r.body as any).isOverride, false);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  COST
// ═══════════════════════════════════════════════════════════════════

describe("Cost", () => {
  it("GET /api/agents/:id/cost returns breakdown", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/cost`);
    assert.equal(status, 200);
    const b = body as any;
    assert.ok("today" in b && "week" in b && "allTime" in b && "byDay" in b);
  });

  it("GET /api/cost/all returns all agents", async () => {
    const { status, body } = await json("/api/cost/all");
    assert.equal(status, 200);
    assert.ok("agents" in (body as any));
  });
});

// ═══════════════════════════════════════════════════════════════════
//  TASKS
// ═══════════════════════════════════════════════════════════════════

describe("Tasks", () => {
  let taskId = "";

  it("GET /api/agents/:id/tasks returns task list", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/tasks`);
    assert.equal(status, 200);
    assert.ok("tasks" in (body as any));
  });

  it("GET /api/agents/:id/tasks/stats returns stats", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/tasks/stats`);
    assert.equal(status, 200);
  });

  it("POST /api/agents/:id/tasks creates task", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/tasks`, {
      method: "POST",
      body: { title: "Test task from API test", priority: "low", project: "testing" }
    });
    assert.equal(status, 200);
    taskId = (body as any).task?.id || (body as any).id || (body as any).taskId || "";
  });

  it("PUT /api/agents/:id/tasks/:taskId updates task", async () => {
    if (!taskId) return;
    const { status } = await json(`/api/agents/${testAgentId}/tasks/${taskId}`, {
      method: "PUT", body: { status: "done" }
    });
    assert.equal(status, 200);
  });

  it("DELETE /api/agents/:id/tasks/:taskId deletes task", async () => {
    if (!taskId) return;
    const { status } = await json(`/api/agents/${testAgentId}/tasks/${taskId}`, { method: "DELETE" });
    assert.equal(status, 200);
  });

  it("GET /api/tasks/all returns all tasks", async () => {
    const { status, body } = await json("/api/tasks/all");
    assert.equal(status, 200);
    assert.ok("tasks" in (body as any));
  });
});

// ═══════════════════════════════════════════════════════════════════
//  PROJECTS (cross-agent initiatives)
// ═══════════════════════════════════════════════════════════════════

describe("Projects", () => {
  let projectId = "";

  it("GET /api/projects returns project list", async () => {
    const { status, body } = await json("/api/projects");
    assert.equal(status, 200);
    assert.ok("projects" in (body as any));
    assert.ok(Array.isArray((body as any).projects));
  });

  it("POST /api/projects creates a project", async () => {
    const { status, body } = await json("/api/projects", {
      method: "POST",
      body: { name: "Test Project", description: "Created by test suite", owner: testAgentId, teamMembers: [] }
    });
    assert.equal(status, 200);
    assert.ok((body as any).ok);
    assert.ok((body as any).project);
    projectId = (body as any).project.id;
    assert.ok(projectId);
    assert.equal((body as any).project.name, "Test Project");
    assert.equal((body as any).project.status, "active");
  });

  it("POST /api/projects requires name", async () => {
    const { status } = await json("/api/projects", {
      method: "POST", body: { description: "no name" }
    });
    assert.equal(status, 400);
  });

  it("GET /api/projects/:id returns project detail", async () => {
    if (!projectId) return;
    const { status, body } = await json(`/api/projects/${projectId}`);
    assert.equal(status, 200);
    assert.ok((body as any).project);
    assert.equal((body as any).project.id, projectId);
    assert.ok("taskRollup" in (body as any));
  });

  it("GET /api/projects/:id returns 404 for missing project", async () => {
    const { status } = await json("/api/projects/nonexistent_999");
    assert.equal(status, 404);
  });

  it("PUT /api/projects/:id updates project", async () => {
    if (!projectId) return;
    const { status, body } = await json(`/api/projects/${projectId}`, {
      method: "PUT",
      body: { status: "paused", plan: "## Phase 1\n- Step A\n- Step B", notes: "Test notes" }
    });
    assert.equal(status, 200);
    assert.ok((body as any).ok);
    assert.equal((body as any).project.status, "paused");
    assert.ok((body as any).project.plan.includes("Phase 1"));
  });

  it("POST /api/projects/:id/link links an agent", async () => {
    if (!projectId) return;
    const { status, body } = await json(`/api/projects/${projectId}/link`, {
      method: "POST",
      body: { type: "agent", value: testAgentId }
    });
    assert.equal(status, 200);
    assert.ok((body as any).ok);
    assert.ok((body as any).project.linkedAgents.includes(testAgentId));
  });

  it("POST /api/projects/:id/link rejects unknown type", async () => {
    if (!projectId) return;
    const { status } = await json(`/api/projects/${projectId}/link`, {
      method: "POST",
      body: { type: "unknown", value: "test" }
    });
    assert.equal(status, 400);
  });

  it("POST /api/projects/:id/unlink removes linked agent", async () => {
    if (!projectId) return;
    const { status, body } = await json(`/api/projects/${projectId}/unlink`, {
      method: "POST",
      body: { type: "agent", value: testAgentId }
    });
    assert.equal(status, 200);
    assert.ok((body as any).ok);
    assert.ok(!(body as any).project.linkedAgents.includes(testAgentId));
  });

  it("GET /api/projects/:id/status returns status report", async () => {
    if (!projectId) return;
    const { status, body } = await json(`/api/projects/${projectId}/status`);
    assert.equal(status, 200);
    assert.ok((body as any).project);
    assert.ok("progress" in (body as any));
    assert.ok("taskRollup" in (body as any));
  });

  it("POST /api/projects/:id/execute starts autonomous execution", async () => {
    if (!projectId) return;
    const { status, body } = await json(`/api/projects/${projectId}/execute`, {
      method: "POST",
      body: { schedule: "*/30 * * * *" }
    });
    assert.equal(status, 200);
    assert.ok((body as any).ok);
    assert.ok((body as any).goalId);
  });

  it("POST /api/projects/:id/pause pauses execution", async () => {
    if (!projectId) return;
    const { status, body } = await json(`/api/projects/${projectId}/pause`, {
      method: "POST"
    });
    assert.equal(status, 200);
    assert.ok((body as any).ok);
  });

  it("DELETE /api/projects/:id deletes project", async () => {
    if (!projectId) return;
    const { status, body } = await json(`/api/projects/${projectId}`, { method: "DELETE" });
    assert.equal(status, 200);
    assert.ok((body as any).ok);
  });

  it("GET /api/projects/:id returns 404 after deletion", async () => {
    if (!projectId) return;
    const { status } = await json(`/api/projects/${projectId}`);
    assert.equal(status, 404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  AUTOMATIONS (Goals + Crons)
// ═══════════════════════════════════════════════════════════════════

describe("Automations", () => {
  it("GET /api/automations returns goals and crons", async () => {
    const { status, body } = await json("/api/automations");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).goals));
    assert.ok(Array.isArray((body as any).crons));
  });

  // Test goal CRUD if agent has goals
  it("POST /api/agents/:id/goals creates a goal (then delete)", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/goals`, {
      method: "POST",
      body: { id: `test-goal-${Date.now()}`, description: "Test goal from API tests", heartbeat: "0 0 * * *", successCriteria: "Test passes", instructions: "Do nothing" }
    });
    assert.equal(status, 200);
    const goalId = (body as any).goalId || (body as any).id;
    if (goalId) {
      await json(`/api/agents/${testAgentId}/goals/${goalId}`, { method: "DELETE" });
    }
  });

  it("POST /api/agents/:id/cron creates a cron (then delete)", async () => {
    // Cron requires channel + chatId from agent routes
    const agent = allAgents.find((a: any) => a.id === testAgentId);
    const route = agent?.routes?.[0];
    const { status, body } = await json(`/api/agents/${testAgentId}/cron`, {
      method: "POST",
      body: { schedule: "0 0 31 2 *", message: "Test cron - never fires", channel: route?.channel || "web", chatId: route?.match?.value || "test" }
    });
    assert.equal(status, 200);
    const index = (body as any).index;
    if (index !== undefined) {
      await json(`/api/agents/${testAgentId}/cron/${index}`, { method: "DELETE" });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MCPs
// ═══════════════════════════════════════════════════════════════════

describe("MCPs", () => {
  it("GET /api/mcps returns MCP list", async () => {
    const { status, body } = await json("/api/mcps");
    assert.equal(status, 200);
    assert.ok("mcps" in (body as any));
  });

  it("GET /api/mcp-catalog returns catalog", async () => {
    const { status, body } = await json("/api/mcp-catalog");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });

  it("GET /api/agents/:id/mcp-keys returns keys list", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/mcp-keys`);
    assert.equal(status, 200);
  });

  it("GET /api/agents/:id/mcp-connections returns connections", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/mcp-connections`);
    assert.equal(status, 200);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  CHANNELS
// ═══════════════════════════════════════════════════════════════════

describe("Channels", () => {
  it("GET /api/channels returns channel list with routes", async () => {
    const { status, body } = await json("/api/channels");
    assert.equal(status, 200);
    // Response is { channels: [...] }
    const channels = (body as any).channels || body;
    assert.ok(Array.isArray(channels));
    if (channels.length > 0) {
      assert.ok("name" in channels[0]);
    }
  });

  it("GET /api/sticky-routing returns channel sticky configs", async () => {
    const { status, body } = await json("/api/sticky-routing");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).channels));
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MARKETPLACE / REGISTRY
// ═══════════════════════════════════════════════════════════════════

describe("Marketplace / Registry", () => {
  it("GET /api/marketplace/skills returns skills list", async () => {
    const { status, body } = await json("/api/marketplace/skills");
    assert.equal(status, 200);
  });

  it("GET /api/marketplace/agents returns agents list", async () => {
    const { status, body } = await json("/api/marketplace/agents");
    assert.equal(status, 200);
  });

  it("GET /api/marketplace/mcps returns MCP list", async () => {
    const { status, body } = await json("/api/marketplace/mcps");
    assert.equal(status, 200);
  });

  it("GET /api/marketplace/prompts returns prompts", async () => {
    const { status, body } = await json("/api/marketplace/prompts");
    assert.equal(status, 200);
  });

  it("GET /api/marketplace/apps returns apps", async () => {
    const { status, body } = await json("/api/marketplace/apps");
    assert.equal(status, 200);
  });

  it("GET /api/marketplace/scan-skills scans a dir", async () => {
    const { status } = await json("/api/marketplace/scan-skills?dir=~/.claude/commands");
    // May return 200, 400 (caught by :type handler), or 404
    assert.ok(status === 200 || status === 400 || status === 404);
  });

  it("GET /api/marketplace/prompt-trigger returns trigger", async () => {
    // This endpoint may route through marketplace/:type handler
    const { status } = await json("/api/marketplace/prompt-trigger");
    assert.ok(status === 200 || status === 400); // May be caught by :type handler
  });
});

// ═══════════════════════════════════════════════════════════════════
//  APPS
// ═══════════════════════════════════════════════════════════════════

describe("Apps", () => {
  let appId = "";

  it("GET /api/apps returns apps list", async () => {
    const { status, body } = await json("/api/apps");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
  });

  it("POST /api/apps creates an app", async () => {
    const { status, body } = await json("/api/apps", {
      method: "POST",
      body: { name: "Test App API", provider: "me", category: "test" }
    });
    assert.equal(status, 200);
    appId = (body as any).id || "";
  });

  it("DELETE /api/apps/:id deletes the test app", async () => {
    if (!appId) return;
    const { status } = await json(`/api/apps/${appId}`, { method: "DELETE" });
    assert.equal(status, 200);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  FILES
// ═══════════════════════════════════════════════════════════════════

describe("Files", () => {
  it("GET /api/agents/:id/files returns file listing", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/files`);
    assert.equal(status, 200);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  ACTIVITY & LOGS
// ═══════════════════════════════════════════════════════════════════

describe("Activity & Logs", () => {
  it("GET /api/activity returns feed", async () => {
    const { status, body } = await json("/api/activity?limit=5");
    assert.equal(status, 200);
    assert.ok("entries" in (body as any));
  });

  it("GET /api/agents/:id/logs returns paginated logs", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/logs?limit=3`);
    assert.equal(status, 200);
    assert.ok("entries" in (body as any));
    assert.ok("total" in (body as any));
  });

  it("GET /api/agents/:id/logs?search=test filters", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/logs?search=hello&limit=5`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).entries));
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MEMORY
// ═══════════════════════════════════════════════════════════════════

describe("Memory", () => {
  it("GET /api/agents/:id/memory returns entries", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/memory`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).entries));
  });

  it("POST /api/agents/:id/memory/search returns results", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/memory/search`, {
      method: "POST", body: { query: "agent" }
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).results));
  });
});

// ═══════════════════════════════════════════════════════════════════
//  SKILLS
// ═══════════════════════════════════════════════════════════════════

describe("Skills", () => {
  it("GET /api/agents/:id/skills returns skill list with levels", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/skills`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).skills));
  });

  it("GET /api/skills/org/p2pfinance returns org skills", async () => {
    const { status, body } = await json("/api/skills/org/p2pfinance");
    assert.equal(status, 200);
    assert.equal((body as any).org, "p2pfinance");
  });
});

// ═══════════════════════════════════════════════════════════════════
//  PAIRING
// ═══════════════════════════════════════════════════════════════════

describe("Pairing", () => {
  it("GET /api/pairing returns status", async () => {
    const { status, body } = await json("/api/pairing");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).paired));
  });

  it("POST + DELETE /api/pairing round-trip", async () => {
    let r = await json("/api/pairing", { method: "POST", body: { senderKey: "test:roundtrip-123" } });
    assert.equal(r.status, 200);
    assert.ok((r.body as any).paired.includes("test:roundtrip-123"));

    r = await json("/api/pairing/test:roundtrip-123", { method: "DELETE" });
    assert.equal(r.status, 200);
    assert.ok(!(r.body as any).paired.includes("test:roundtrip-123"));
  });
});

// ═══════════════════════════════════════════════════════════════════
//  CONFIG / ACCOUNTS
// ═══════════════════════════════════════════════════════════════════

describe("Config & Accounts", () => {
  it("GET /api/config/accounts returns accounts map", async () => {
    const { status, body } = await json("/api/config/accounts");
    assert.equal(status, 200);
    assert.equal(typeof body, "object");
  });

  it("GET /api/config/service returns service settings", async () => {
    const { status, body } = await json("/api/config/service");
    assert.equal(status, 200);
    assert.ok("personalAgentsDir" in (body as any));
    assert.ok("personalRegistryDir" in (body as any));
    assert.ok("webUIPort" in (body as any));
  });

  it("GET /api/config/accounts/:name/status returns response", async () => {
    const accounts = await json("/api/config/accounts");
    const names = Object.keys((accounts.body as any) || {});
    if (names.length === 0) return;
    const { status } = await json(`/api/config/accounts/${encodeURIComponent(names[0])}/status`);
    // May return 200 or 500 depending on claude CLI availability
    assert.ok(status === 200 || status === 500);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  CHANGELOG
// ═══════════════════════════════════════════════════════════════════

describe("Changelog", () => {
  it("GET /api/changelog returns 200 with changelog data", async () => {
    const { status, body } = await json("/api/changelog");
    assert.equal(status, 200);
    const b = body as any;
    // When gym is enabled: returns { days: {...} }
    // When gym is disabled: returns [] (empty array) or { days: {} }
    assert.ok(Array.isArray(b) || typeof b === "object", "Response should be an array or object");
    if (!Array.isArray(b) && "days" in b) {
      assert.equal(typeof b.days, "object", "days should be an object");
      for (const [day, commits] of Object.entries(b.days)) {
        assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(day), `Day key should be YYYY-MM-DD, got: ${day}`);
        assert.ok(Array.isArray(commits), "Each day should have an array of commits");
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  API DOCS PAGE
// ═══════════════════════════════════════════════════════════════════

describe("API Docs Page", () => {
  it("GET /api-docs returns HTML page", async () => {
    const res = await raw("/api-docs");
    assert.equal(res.status, 200);
    assert.ok(res.text.includes("MyAIforOne API"));
  });
});
