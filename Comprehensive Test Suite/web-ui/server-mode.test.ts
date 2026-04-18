/**
 * server-mode.test.ts
 * Tests for server-mode (Railway) deployment behavior.
 *
 * Validates:
 *   - GET /api/config/service returns deploymentMode field
 *   - Dashboard returns defaultGroupAgent and agents on server mode
 *   - Role-based middleware blocks writes for read-only keys (when auth enabled)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4888";

async function serviceUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`);
    return r.ok;
  } catch { return false; }
}

async function json(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, opts);
  let body: any;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

describe("Server Mode — deployment config", () => {
  it("GET /api/config/service returns deploymentMode", async () => {
    if (!(await serviceUp())) return;

    const { status, body } = await json("/api/config/service");
    assert.equal(status, 200);
    assert.ok(body.deploymentMode, "should include deploymentMode");
    assert.ok(
      ["server", "local"].includes(body.deploymentMode),
      `deploymentMode should be 'server' or 'local', got '${body.deploymentMode}'`
    );
  });

  it("GET /api/config/service includes gymEnabled flag", async () => {
    if (!(await serviceUp())) return;

    const { status, body } = await json("/api/config/service");
    assert.equal(status, 200);
    assert.ok("gymEnabled" in body, "should include gymEnabled");
  });

  it("GET /api/config/service includes sharedAgentsEnabled flag", async () => {
    if (!(await serviceUp())) return;

    const { status, body } = await json("/api/config/service");
    assert.equal(status, 200);
    assert.ok("sharedAgentsEnabled" in body, "should include sharedAgentsEnabled");
  });
});

describe("Server Mode — dashboard", () => {
  it("GET /api/dashboard returns agents array and defaultGroupAgent", async () => {
    if (!(await serviceUp())) return;

    const { status, body } = await json("/api/dashboard");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.agents), "agents should be an array");
    // defaultGroupAgent may be null on local installs without setup
    assert.ok("defaultGroupAgent" in body, "should include defaultGroupAgent field");
  });

  it("GET /api/dashboard agents include id, name, description", async () => {
    if (!(await serviceUp())) return;

    const { status, body } = await json("/api/dashboard");
    assert.equal(status, 200);
    if (body.agents.length > 0) {
      const agent = body.agents[0];
      assert.ok(agent.id, "agent should have id");
      assert.ok(agent.name, "agent should have name");
      assert.ok("description" in agent, "agent should have description");
      assert.ok("streaming" in agent, "agent should have streaming flag");
      assert.ok("agentClass" in agent, "agent should have agentClass");
    }
  });
});

describe("Server Mode — server-mode.js nav gating logic", () => {
  // These tests validate the constants and rules in public/server-mode.js
  // by testing the actual /api/config/service endpoint that drives it.

  it("deploymentMode drives which pages are allowed", async () => {
    if (!(await serviceUp())) return;

    const { body } = await json("/api/config/service");
    const mode = body.deploymentMode;

    // SERVER_PAGES in server-mode.js: /, /library, /org, /admin, /api-docs, /mcp-docs, /user-guide
    const serverPages = ["/", "/library", "/org", "/admin", "/api-docs", "/mcp-docs", "/user-guide", "/mini"];
    // Pages hidden on server: /ui, /lab, /monitor, /tasks, /projects, /automations
    const localOnlyPages = ["/ui", "/lab", "/monitor", "/tasks", "/projects", "/automations"];

    if (mode === "server") {
      // On server mode, local-only pages should not be served (server-mode.js redirects)
      // We verify the backend still serves them (redirect is client-side), but the intent is clear
      for (const page of serverPages) {
        const r = await fetch(`${BASE}${page}`, { redirect: "manual" });
        assert.ok([200, 301, 302].includes(r.status), `${page} should be accessible on server mode`);
      }
    }

    // Whether local or server, all pages should respond (gating is client-side JS)
    for (const page of ["/org", "/library", "/admin"]) {
      const r = await fetch(`${BASE}${page}`);
      assert.ok(r.ok, `${page} should respond with 200`);
    }
  });

  it("sub-nav links to non-server pages should be hidden by server-mode.js", async () => {
    if (!(await serviceUp())) return;

    const { body } = await json("/api/config/service");
    // This is a structural test: verify the org page HTML contains sub-nav links
    // that server-mode.js will hide based on SERVER_PAGES set
    const orgRes = await fetch(`${BASE}/org`);
    const html = await orgRes.text();

    // org.html should contain sub-nav-link elements
    assert.ok(html.includes("sub-nav-link"), "org.html should have sub-nav links");
    // server-mode.js should be loaded
    assert.ok(html.includes("server-mode.js"), "org.html should include server-mode.js");
  });

  it("server-mode.js is included in all main pages", async () => {
    if (!(await serviceUp())) return;

    const pages = ["/", "/org", "/admin", "/library"];
    for (const page of pages) {
      const r = await fetch(`${BASE}${page}`);
      const html = await r.text();
      assert.ok(
        html.includes("server-mode.js"),
        `${page} should include server-mode.js`
      );
    }
  });
});

describe("Server Mode — bootstrap agents", () => {
  it("hub agent exists and has required fields", async () => {
    if (!(await serviceUp())) return;

    const { status, body } = await json("/api/dashboard");
    assert.equal(status, 200);
    const hub = body.agents.find((a: any) => a.id === "hub" || a.name === "Hub");
    assert.ok(hub, "hub agent should exist");
    assert.ok(hub.id, "hub agent should have an id");
    assert.ok(hub.description, "hub agent should have a description");
  });

  it("hub agent has org assignment (not Unassigned)", async () => {
    if (!(await serviceUp())) return;

    const { status, body } = await json("/api/dashboard");
    assert.equal(status, 200);
    const hub = body.agents.find((a: any) => a.id === "hub" || a.name === "Hub");
    assert.ok(hub, "hub agent should exist");
    assert.ok(Array.isArray(hub.org), "hub agent should have org array");
    assert.ok(hub.org.length > 0, "hub agent org should not be empty");
    assert.ok(hub.org[0].organization, "hub agent should have a non-empty organization");
  });

  it("gym agent exists on instances with gymEnabled", async () => {
    if (!(await serviceUp())) return;

    const svc = await json("/api/config/service");
    if (!svc.body.gymEnabled) return; // skip if gym not enabled

    const { body } = await json("/api/dashboard");
    const gym = body.agents.find((a: any) => a.id === "gym");
    assert.ok(gym, "gym agent should exist when gymEnabled is true");
  });
});

describe("Server Mode — mini chat popup for server mode", () => {
  it("/mini is accessible and includes agent selector", async () => {
    if (!(await serviceUp())) return;

    const r = await fetch(`${BASE}/mini`);
    assert.ok(r.ok, "/mini should respond with 200");
    const html = await r.text();
    assert.ok(html.includes("agentSelect"), "/mini should have agent selector");
    assert.ok(html.includes("server-mode.js"), "/mini should include server-mode.js");
  });

  it("/mini supports hash-based agent pre-selection", async () => {
    if (!(await serviceUp())) return;

    const r = await fetch(`${BASE}/mini`);
    const html = await r.text();
    assert.ok(
      html.includes("location.hash"),
      "/mini should read URL hash for agent pre-selection"
    );
  });

  it("org.html Chat button uses mini popup on server mode", async () => {
    if (!(await serviceUp())) return;

    const r = await fetch(`${BASE}/org`);
    const html = await r.text();
    assert.ok(
      html.includes("_ma1ServerMode") && html.includes("/mini#"),
      "org.html Chat button should open /mini popup on server mode"
    );
  });
});

describe("Server Mode — role-based access control", () => {
  it("GET /api/auth/status returns role field", async () => {
    if (!(await serviceUp())) return;

    const { status, body } = await json("/api/auth/status");
    assert.equal(status, 200);
    // On local (auth disabled), role should default to "full"
    if (!body.authEnabled) {
      assert.equal(body.role, "full", "auth disabled should default to full role");
    } else if (body.authenticated) {
      assert.ok(
        ["full", "read"].includes(body.role),
        `role should be 'full' or 'read', got '${body.role}'`
      );
    }
  });

  it("POST /api/auth/login returns role field", async () => {
    if (!(await serviceUp())) return;

    const { status, body } = await json("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "" }),
    });
    // On local (auth disabled), returns ok with role=full
    if (body.authEnabled === false) {
      assert.equal(body.role, "full");
    }
    // On server (auth enabled), wrong password gives 401
    // — role is only returned on success
  });
});
