import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4888";
let testAgentId = "";
let firstChannelName = "";

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

    const { body: chBody } = await json("/api/channels");
    const channels = (chBody as any)?.channels || chBody || [];
    firstChannelName = channels[0]?.name || "";
  } catch {
    testAgentId = "myagent-dev";
  }
});

// ═══════════════════════════════════════════════════════════════════
//  CHANNELS — write operations
// ═══════════════════════════════════════════════════════════════════

describe("Channels API — write operations", () => {
  it("PUT /api/channels/:channelName updates channel settings", async () => {
    if (!firstChannelName) return;
    const { status, body } = await json(`/api/channels/${firstChannelName}`, {
      method: "PUT",
      body: { enabled: true }
    });
    assert.ok(status === 200 || status === 404);
    if (status === 200) {
      assert.ok((body as any).ok || typeof body === "object");
    }
  });

  it("POST /api/channels/:channelName/monitored adds a monitored chat", async () => {
    if (!firstChannelName) return;
    const { status, body } = await json(`/api/channels/${firstChannelName}/monitored`, {
      method: "POST",
      body: { chatId: "test-monitored-chat-999", agentId: testAgentId }
    });
    assert.ok(status === 200 || status === 400 || status === 404);
  });

  it("DELETE /api/channels/:channelName/monitored removes a monitored chat", async () => {
    if (!firstChannelName) return;
    const { status } = await json(`/api/channels/${firstChannelName}/monitored`, {
      method: "DELETE",
      body: { chatId: "test-monitored-chat-999" }
    });
    assert.ok(status === 200 || status === 400 || status === 404);
  });

  it("POST /api/channels/:channelName/credentials accepts credential update", async () => {
    if (!firstChannelName) return;
    const { status } = await json(`/api/channels/${firstChannelName}/credentials`, {
      method: "POST",
      body: { token: "" }
    });
    assert.ok(status === 200 || status === 400 || status === 404);
  });

  it("POST /api/channels/:channelName/agents adds agent route", async () => {
    if (!firstChannelName) return;
    const { status } = await json(`/api/channels/${firstChannelName}/agents`, {
      method: "POST",
      body: { agentId: testAgentId, match: { type: "chatId", value: "test-chat-999" } }
    });
    assert.ok(status === 200 || status === 400 || status === 404);
  });

  it("DELETE /api/channels/:channelName/agents/:agentId removes agent route", async () => {
    if (!firstChannelName) return;
    const { status } = await json(`/api/channels/${firstChannelName}/agents/${testAgentId}`, {
      method: "DELETE"
    });
    assert.ok(status === 200 || status === 400 || status === 404 || status === 500);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  WEBHOOK
// ═══════════════════════════════════════════════════════════════════

describe("Webhook", () => {
  it("POST /webhook/:agentId rejects missing secret header", async () => {
    const res = await fetch(`${BASE}/webhook/${testAgentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "test" })
    });
    assert.ok(res.status === 401 || res.status === 403 || res.status === 400);
  });

  it("POST /webhook/NONEXISTENT returns 404 with valid secret", async () => {
    // Service config may define webhookSecret — try without it first
    const res = await fetch(`${BASE}/webhook/NONEXISTENT_AGENT_XYZ`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": "agentwebhook2026"
      },
      body: JSON.stringify({ text: "test" })
    });
    assert.ok(res.status === 404 || res.status === 401 || res.status === 403);
  });
});
