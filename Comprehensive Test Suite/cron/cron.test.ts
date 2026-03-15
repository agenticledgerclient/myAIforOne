import { describe, it } from "node:test";
import assert from "node:assert/strict";
import cron from "node-cron";

describe("cron — schedule validation", () => {
  it("validates correct cron expression", () => {
    assert.ok(cron.validate("0 9 * * 1-5"));      // weekdays at 9am
    assert.ok(cron.validate("*/5 * * * *"));        // every 5 minutes
    assert.ok(cron.validate("0 0 * * *"));          // midnight daily
    assert.ok(cron.validate("30 14 * * 1"));        // Monday 2:30pm
  });

  it("rejects invalid cron expression", () => {
    assert.ok(!cron.validate("not a cron"));
    assert.ok(!cron.validate(""));
    assert.ok(!cron.validate("60 * * * *"));        // 60 minutes invalid
  });
});
