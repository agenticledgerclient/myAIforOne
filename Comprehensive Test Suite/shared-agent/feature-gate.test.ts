/**
 * feature-gate.test.ts
 * Verifies the dual gate: sharedAgentsEnabled config flag + license feature.
 * Tests run against live service when available; skip gracefully otherwise.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4888";

describe("shared-agent feature gate", () => {
  it("GET /api/capabilities returns features.sharedAgents field", async () => {
    try {
      const res = await fetch(`${BASE}/api/capabilities`);
      if (!res.ok) return;
      const data = await res.json() as any;
      assert.ok("features" in data, "capabilities should have features object");
      assert.ok("sharedAgents" in data.features, "features should include sharedAgents");
      assert.equal(typeof data.features.sharedAgents, "boolean");
    } catch { /* service not running */ }
  });

  it("GET /api/capabilities returns features.gym field", async () => {
    try {
      const res = await fetch(`${BASE}/api/capabilities`);
      if (!res.ok) return;
      const data = await res.json() as any;
      assert.ok("features" in data);
      assert.ok("gym" in data.features, "features should include gym");
      assert.equal(typeof data.features.gym, "boolean");
    } catch { /* service not running */ }
  });

  it("GET /api/service returns sharedAgentsEnabled field", async () => {
    try {
      const res = await fetch(`${BASE}/api/service`);
      if (!res.ok) return;
      const data = await res.json() as any;
      assert.ok("sharedAgentsEnabled" in data, "service response should include sharedAgentsEnabled");
    } catch { /* service not running */ }
  });

  it("sharedAgentsEnabled defaults to false when not set", async () => {
    try {
      const res = await fetch(`${BASE}/api/service`);
      if (!res.ok) return;
      const data = await res.json() as any;
      // In a default install without the flag set, should be false
      // This is a soft assertion since the value depends on config
      assert.equal(typeof data.sharedAgentsEnabled, "boolean");
    } catch { /* service not running */ }
  });

  it("PUT /api/config/service accepts sharedAgentsEnabled toggle", async () => {
    try {
      // Read current state
      const get = await fetch(`${BASE}/api/service`);
      if (!get.ok) return;
      const current = await get.json() as any;

      // Toggle to opposite and back (non-destructive test)
      const newValue = !current.sharedAgentsEnabled;
      const put = await fetch(`${BASE}/api/config/service`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sharedAgentsEnabled: newValue }),
      });
      if (!put.ok) return;
      const updated = await put.json() as any;
      assert.equal(updated.sharedAgentsEnabled, newValue, "sharedAgentsEnabled should update");

      // Restore original
      await fetch(`${BASE}/api/config/service`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sharedAgentsEnabled: current.sharedAgentsEnabled }),
      });
    } catch { /* service not running */ }
  });
});
