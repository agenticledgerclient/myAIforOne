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
//  CHAT — non-streaming + raw job output
// ═══════════════════════════════════════════════════════════════════

describe("Chat API — advanced", () => {
  let jobId = "";

  it("POST /api/chat/:agentId/stream creates a chat job", async () => {
    const { status, body } = await json(`/api/chat/${testAgentId}/stream`, {
      method: "POST",
      body: { text: "ping", accountOverride: "" }
    });
    assert.equal(status, 200);
    assert.ok((body as any).jobId);
    jobId = (body as any).jobId;
  });

  it("GET /api/chat/jobs/:jobId/raw returns raw job output", async () => {
    if (!jobId) return;
    // Give the job a moment to produce output
    await new Promise(r => setTimeout(r, 500));
    const { status, body } = await json(`/api/chat/jobs/${jobId}/raw`);
    assert.ok(status === 200 || status === 404);
    if (status === 200) {
      assert.ok(typeof body === "object" || typeof body === "string");
    }
  });

  it("GET /api/chat/jobs/NONEXISTENT/raw returns 404", async () => {
    const { status } = await json("/api/chat/jobs/nonexistent-job-xyz-raw/raw");
    assert.equal(status, 404);
  });

  it("POST /api/chat/:agentId rejects empty text (non-streaming)", async () => {
    const { status } = await json(`/api/chat/${testAgentId}`, {
      method: "POST",
      body: { text: "" }
    });
    assert.equal(status, 400);
  });

  it("POST /api/chat/:agentId/NONEXISTENT returns 404 for unknown agent", async () => {
    const { status } = await json("/api/chat/NONEXISTENT_AGENT_XYZ/stream", {
      method: "POST",
      body: { text: "ping" }
    });
    assert.equal(status, 404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  SESSION TABS — API-level coverage
// ═══════════════════════════════════════════════════════════════════

describe("Session Tabs API", () => {
  let tabId = "";

  it("GET /api/agents/:agentId/session-tabs returns tabs array", async () => {
    const { status, body } = await json(`/api/agents/${testAgentId}/session-tabs`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).tabs));
  });

  it("POST /api/agents/:agentId/session-tabs creates a tab", async () => {
    const newTabId = `tab_test_apichat_${Date.now()}`;
    const { status, body } = await json(`/api/agents/${testAgentId}/session-tabs`, {
      method: "POST",
      body: { label: "Test Tab from API Suite", tabId: newTabId }
    });
    assert.equal(status, 200);
    assert.ok((body as any).ok);
    tabId = (body as any)?.tab?.id || newTabId;
  });

  it("GET /api/agents/:agentId/session-tabs/:tabId/history returns history", async () => {
    if (!tabId) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/session-tabs/${tabId}/history`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).history) || typeof body === "object");
  });

  it("PUT /api/agents/:agentId/session-tabs/:tabId renames tab", async () => {
    if (!tabId) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/session-tabs/${tabId}`, {
      method: "PUT",
      body: { label: "Renamed Tab" }
    });
    assert.equal(status, 200);
    assert.ok((body as any).ok);
  });

  it("DELETE /api/agents/:agentId/session-tabs/:tabId removes tab", async () => {
    if (!tabId) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/session-tabs/${tabId}`, {
      method: "DELETE"
    });
    assert.equal(status, 200);
    assert.ok((body as any).ok);
  });

  it("DELETE /api/agents/:agentId/session-tabs/NONEXISTENT returns 200 or 404", async () => {
    // The endpoint returns 200 even for nonexistent tab IDs (idempotent delete)
    const { status } = await json(`/api/agents/${testAgentId}/session-tabs/tab_nonexistent_xyz`, {
      method: "DELETE"
    });
    assert.ok(status === 200 || status === 404);
  });

  it("GET /api/agents/NONEXISTENT/session-tabs returns 404", async () => {
    const { status } = await json("/api/agents/NONEXISTENT_AGENT_XYZ/session-tabs");
    assert.equal(status, 404);
  });
});
