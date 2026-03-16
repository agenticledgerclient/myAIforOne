import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import cron from "node-cron";

// Import goal utilities
import {
  readBudget,
  writeBudget,
  isBudgetExhausted,
  buildGoalPrompt,
  budgetPath,
  type BudgetState,
} from "../../src/goals.js";

const testDir = join(tmpdir(), `goals-test-${Date.now()}`);

describe("goals — budget tracking", () => {
  beforeEach(() => {
    mkdirSync(join(testDir, "goals"), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("returns default budget when no file exists", () => {
    const budget = readBudget(testDir, 5.0);
    assert.equal(budget.spent, 0);
    assert.equal(budget.limit, 5.0);
    assert.equal(budget.executions, 0);
  });

  it("reads existing budget file", () => {
    const state: BudgetState = { spent: 2.5, limit: 5.0, executions: 3 };
    const path = budgetPath(testDir);
    mkdirSync(join(testDir, "goals"), { recursive: true });
    writeFileSync(path, JSON.stringify(state));

    const budget = readBudget(testDir, 5.0);
    assert.equal(budget.spent, 2.5);
    assert.equal(budget.executions, 3);
  });

  it("writes budget file and reads it back", () => {
    const state: BudgetState = { spent: 1.23, limit: 5.0, executions: 2 };
    writeBudget(testDir, state);

    const path = budgetPath(testDir);
    assert.ok(existsSync(path), "Budget file should exist");

    const read = JSON.parse(readFileSync(path, "utf-8")) as BudgetState;
    assert.equal(read.spent, 1.23);
    assert.equal(read.limit, 5.0);
    assert.equal(read.executions, 2);
  });

  it("detects budget exhaustion correctly", () => {
    assert.ok(isBudgetExhausted({ spent: 5.0, limit: 5.0, executions: 5 }));
    assert.ok(isBudgetExhausted({ spent: 6.0, limit: 5.0, executions: 6 }));
    assert.ok(!isBudgetExhausted({ spent: 4.99, limit: 5.0, executions: 4 }));
    assert.ok(!isBudgetExhausted({ spent: 0, limit: 5.0, executions: 0 }));
  });

  it("uses configured limit even if file has different limit", () => {
    const state: BudgetState = { spent: 2.0, limit: 3.0, executions: 2 };
    writeBudget(testDir, state);

    // Read with a different limit — should use the new one
    const budget = readBudget(testDir, 10.0);
    assert.equal(budget.limit, 10.0);
    assert.equal(budget.spent, 2.0);
  });
});

describe("goals — goal prompt building", () => {
  it("builds a basic goal prompt with all fields", () => {
    const goal = {
      id: "check-prices",
      enabled: true,
      description: "Check cryptocurrency prices",
      successCriteria: "Report top 5 crypto prices",
      instructions: "Use the CoinGecko API",
      heartbeat: "0 * * * *",
      budget: { maxDailyUsd: 5.0 },
    };

    const prompt = buildGoalPrompt(goal, 3.5, 5.0);
    assert.ok(prompt.includes("[AUTONOMOUS GOAL: check-prices]"));
    assert.ok(prompt.includes("Description: Check cryptocurrency prices"));
    assert.ok(prompt.includes("Success Criteria: Report top 5 crypto prices"));
    assert.ok(prompt.includes("Instructions: Use the CoinGecko API"));
    assert.ok(prompt.includes("Budget remaining today: $3.50 of $5.00"));
    assert.ok(prompt.includes("[/AUTONOMOUS GOAL]"));
    assert.ok(prompt.includes("Evaluate this goal."));
  });

  it("builds prompt without optional fields", () => {
    const goal = {
      id: "monitor",
      enabled: true,
      description: "Monitor system health",
      heartbeat: "*/30 * * * *",
    };

    const prompt = buildGoalPrompt(goal, Infinity, Infinity);
    assert.ok(prompt.includes("[AUTONOMOUS GOAL: monitor]"));
    assert.ok(prompt.includes("Description: Monitor system health"));
    assert.ok(!prompt.includes("Success Criteria:"));
    assert.ok(!prompt.includes("Instructions:"));
  });
});

describe("goals — cron validation for heartbeats", () => {
  it("validates correct heartbeat cron expressions", () => {
    assert.ok(cron.validate("0 * * * *"));       // every hour
    assert.ok(cron.validate("*/15 * * * *"));     // every 15 min
    assert.ok(cron.validate("0 9 * * 1-5"));      // weekday mornings
    assert.ok(cron.validate("0 0 * * *"));         // daily midnight
  });

  it("rejects invalid heartbeat expressions", () => {
    assert.ok(!cron.validate("every hour"));
    assert.ok(!cron.validate(""));
    assert.ok(!cron.validate("0 25 * * *"));       // invalid hour
  });
});
