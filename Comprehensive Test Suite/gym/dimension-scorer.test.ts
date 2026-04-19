import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scoreAnalysis,
  scoreCommunication,
  scoreKnowledge,
  scoreAutomation,
  scoreBuilding,
  scoreAllDimensions,
  computeTrends,
} from "../../dist/gym/dimension-scorer.js";

describe("dimension-scorer — scoring functions", () => {
  it("scoreAnalysis returns 0 for empty input", () => {
    assert.equal(scoreAnalysis([]), 0);
  });

  it("scoreAnalysis scores based on agent breadth and messages", () => {
    const summaries = [
      { agentId: "coder", messageCount: 50, activeDays: 5, uniqueDates: ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"], topics: [], toolUseCounts: {}, lastActive: "2026-01-05T00:00:00Z" },
      { agentId: "writer", messageCount: 30, activeDays: 3, uniqueDates: ["2026-01-01", "2026-01-03", "2026-01-05"], topics: [], toolUseCounts: {}, lastActive: "2026-01-05T00:00:00Z" },
      { agentId: "researcher", messageCount: 20, activeDays: 2, uniqueDates: ["2026-01-02", "2026-01-04"], topics: [], toolUseCounts: {}, lastActive: "2026-01-04T00:00:00Z" },
    ];
    const score = scoreAnalysis(summaries);
    assert.ok(score >= 2, `Expected score >= 2, got ${score}`);
    assert.ok(score <= 5, `Expected score <= 5, got ${score}`);
  });

  it("scoreAnalysis excludes platform agents", () => {
    const summaries = [
      { agentId: "hub", messageCount: 100, activeDays: 10, uniqueDates: [], topics: [], toolUseCounts: {}, lastActive: null },
      { agentId: "gym", messageCount: 50, activeDays: 5, uniqueDates: [], topics: [], toolUseCounts: {}, lastActive: null },
    ];
    assert.equal(scoreAnalysis(summaries), 0);
  });

  it("scoreCommunication returns 0 for empty input", () => {
    assert.equal(scoreCommunication([]), 0);
  });

  it("scoreCommunication rewards tool diversity and topics", () => {
    const summaries = [
      {
        agentId: "coder",
        messageCount: 30,
        activeDays: 5,
        uniqueDates: ["2026-01-01"],
        topics: ["write a function", "fix the bug", "explain this code", "review PR", "deploy app", "test coverage"],
        toolUseCounts: { Read: 10, Write: 5, Bash: 3, Grep: 2 },
        lastActive: "2026-01-05T00:00:00Z",
      },
    ];
    const score = scoreCommunication(summaries);
    assert.ok(score >= 2, `Expected score >= 2, got ${score}`);
  });

  it("scoreKnowledge rewards program completions", () => {
    assert.equal(scoreKnowledge([], 0, 0), 0);
    const score = scoreKnowledge(["getting-started"], 3, 2);
    assert.ok(score >= 2, `Expected score >= 2 with getting-started completed, got ${score}`);
  });

  it("scoreAutomation returns 0 for no agents", () => {
    assert.equal(scoreAutomation([]), 0);
  });

  it("scoreAutomation rewards goals and cron", () => {
    const agents = [
      { id: "coder", name: "Coder", goals: [{ id: "g1", enabled: true }], cron: [{ schedule: "0 9 * * *" }] },
      { id: "writer", name: "Writer" },
      { id: "researcher", name: "Researcher", mcps: ["github"] },
    ];
    const score = scoreAutomation(agents as any);
    assert.ok(score >= 2, `Expected score >= 2, got ${score}`);
  });

  it("scoreBuilding returns 0 for no agents", () => {
    assert.equal(scoreBuilding([]), 0);
  });

  it("scoreBuilding rewards custom agents with good prompts", () => {
    const agents = [
      { id: "coder", name: "Coder", workspace: "/projects/app", allowedTools: ["Read", "Write", "Bash"], mcps: ["github"], systemPromptLength: 500 },
      { id: "writer", name: "Writer", workspace: "/projects/blog", allowedTools: ["Read", "Write"], systemPromptLength: 300 },
    ];
    const score = scoreBuilding(agents as any);
    assert.ok(score >= 3, `Expected score >= 3, got ${score}`);
  });

  it("scoreAllDimensions returns all 5 keys", () => {
    const result = scoreAllDimensions([], [], [], 0);
    assert.ok("knowledge" in result);
    assert.ok("communication" in result);
    assert.ok("analysis" in result);
    assert.ok("automation" in result);
    assert.ok("building" in result);
  });

  it("computeTrends detects improvements", () => {
    const current = { knowledge: 3, communication: 2, analysis: 3, automation: 1, building: 2 };
    const previous = { knowledge: 2, communication: 2, analysis: 2, automation: 1, building: 1 };
    const trends = computeTrends(current, previous);
    assert.equal(trends.knowledge, "up");
    assert.equal(trends.communication, "stable");
    assert.equal(trends.analysis, "up");
    assert.equal(trends.automation, "stable");
    assert.equal(trends.building, "up");
  });

  it("computeTrends returns stable for null previous", () => {
    const current = { knowledge: 3, communication: 2, analysis: 3, automation: 1, building: 2 };
    const trends = computeTrends(current, null);
    assert.equal(trends.knowledge, "stable");
    assert.equal(trends.communication, "stable");
  });

  it("all scores are clamped 0-5", () => {
    // Even with extreme data, scores shouldn't exceed 5
    const bigSummaries = Array(20).fill(null).map((_, i) => ({
      agentId: `agent-${i}`,
      messageCount: 1000,
      activeDays: 365,
      uniqueDates: Array(365).fill(null).map((_, d) => `2026-01-${String(d + 1).padStart(2, "0")}`),
      topics: Array(50).fill("topic"),
      toolUseCounts: { Read: 100, Write: 100, Bash: 100, Grep: 100, Edit: 100 },
      lastActive: "2026-12-31T00:00:00Z",
    }));
    const score = scoreAnalysis(bigSummaries);
    assert.ok(score >= 0 && score <= 5, `Score out of range: ${score}`);
  });
});
