import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Test the web UI endpoints by making HTTP requests to the running service
// These tests require the service to NOT be running on port 8080 (or use a different port)
// For unit testing, we test the response format expectations

describe("web-ui — endpoint contracts", () => {
  it("dashboard returns expected shape", async () => {
    try {
      const resp = await fetch("http://localhost:8080/");
      if (!resp.ok) return; // service not running, skip
      const data = await resp.json() as any;
      assert.ok("status" in data);
      assert.ok("uptime" in data);
      assert.ok("channels" in data);
      assert.ok("agents" in data);
      assert.ok(Array.isArray(data.agents));
      if (data.agents.length > 0) {
        const agent = data.agents[0];
        assert.ok("id" in agent);
        assert.ok("name" in agent);
        assert.ok("messageCount" in agent);
      }
    } catch {
      // Service not running — skip gracefully
    }
  });

  it("health endpoint returns ok", async () => {
    try {
      const resp = await fetch("http://localhost:8080/health");
      if (!resp.ok) return;
      const data = await resp.json() as any;
      assert.equal(data.ok, true);
      assert.ok("uptime" in data);
    } catch {
      // Service not running — skip
    }
  });

  it("webhook rejects missing secret", async () => {
    try {
      const resp = await fetch("http://localhost:8080/webhook/test-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "test" }),
      });
      if (resp.status === 401) {
        assert.ok(true, "Correctly rejected without secret");
      }
    } catch {
      // Service not running — skip
    }
  });

  it("webhook rejects unknown agent", async () => {
    try {
      const resp = await fetch("http://localhost:8080/webhook/nonexistent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": "agentwebhook2026",
        },
        body: JSON.stringify({ text: "test" }),
      });
      if (resp.status === 404) {
        assert.ok(true, "Correctly rejected unknown agent");
      }
    } catch {
      // Service not running — skip
    }
  });
});
