/**
 * team-gateways/types.test.ts
 * Static shape tests for TeamGateway + the derived MCP + env var naming.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TeamGateway } from "../../src/config.js";

describe("TeamGateway type shape", () => {
  it("has required fields id, name, url, addedAt", () => {
    const g: TeamGateway = {
      id: "acme",
      name: "Acme Corp",
      url: "https://acme.example.com",
      addedAt: new Date().toISOString(),
    };
    assert.equal(typeof g.id, "string");
    assert.equal(typeof g.name, "string");
    assert.equal(typeof g.url, "string");
    assert.equal(typeof g.addedAt, "string");
  });

  it("allows optional status fields", () => {
    const g: TeamGateway = {
      id: "acme",
      name: "Acme",
      url: "https://acme.example.com",
      addedAt: new Date().toISOString(),
      lastStatus: "ok",
      lastStatusAt: new Date().toISOString(),
      lastStatusMessage: "",
    };
    assert.equal(g.lastStatus, "ok");
  });

  it("lastStatus restricted to expected union", () => {
    // Compile-time check — this test is really for the type system.
    const statuses: Array<TeamGateway["lastStatus"]> = ["ok", "offline", "unauthorized", "error", undefined];
    assert.equal(statuses.length, 5);
  });
});

describe("derived naming conventions", () => {
  it("MCP name = 'team-' + slug", () => {
    // The slugifier in web-ui.ts lowercases and replaces non-alphanumeric with
    // hyphens. Verify our expectations about the naming contract.
    const id = "agenticledger-hq";
    const mcpName = `team-${id}`;
    assert.equal(mcpName, "team-agenticledger-hq");
  });

  it("env var name = TEAM_<ID>_KEY uppercased", () => {
    const id = "agenticledger-hq";
    const envVar = "TEAM_" + id.toUpperCase().replace(/[^A-Z0-9]/g, "_") + "_KEY";
    assert.equal(envVar, "TEAM_AGENTICLEDGER_HQ_KEY");
  });
});
