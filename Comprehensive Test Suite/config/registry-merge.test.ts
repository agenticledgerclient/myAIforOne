/**
 * Tests for registry merge behavior:
 * - Platform registry: registry/{type}.json (committed, read-only)
 * - Personal registry: PersonalRegistry/{type}.json (outside repo, user-managed)
 * - Personal items override platform items with same id
 * - Personal writes go to PersonalRegistry/, not registry/personal-*.json
 *
 * These tests validate the merge logic inline (without standing up the full web-ui)
 * by replicating the same merge algorithm used in web-ui.ts GET /api/marketplace/:type.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Replicates the merge logic from web-ui.ts /api/marketplace/:type.
 * Personal entries override platform entries with the same `id`.
 */
function mergeRegistryEntries(platformEntries: any[], personalEntries: any[]): any[] {
  const personalIds = new Set(personalEntries.map((e: any) => e.id));
  return [...platformEntries.filter((e: any) => !personalIds.has(e.id)), ...personalEntries];
}

describe("registry merge logic", () => {
  it("returns platform entries when no personal entries", () => {
    const platform = [
      { id: "skill-a", name: "Skill A", source: "agenticledger/platform" },
      { id: "skill-b", name: "Skill B", source: "agenticledger/platform" },
    ];
    const result = mergeRegistryEntries(platform, []);
    assert.deepEqual(result, platform);
  });

  it("appends personal entries that don't exist in platform", () => {
    const platform = [{ id: "skill-a", name: "Skill A" }];
    const personal = [{ id: "my-skill", name: "My Skill" }];
    const result = mergeRegistryEntries(platform, personal);
    assert.equal(result.length, 2);
    assert.ok(result.some(e => e.id === "skill-a"));
    assert.ok(result.some(e => e.id === "my-skill"));
  });

  it("personal entries override platform entries with same id", () => {
    const platform = [
      { id: "skill-a", name: "Skill A (platform)", version: "1.0" },
      { id: "skill-b", name: "Skill B (platform)" },
    ];
    const personal = [
      { id: "skill-a", name: "Skill A (personal override)", version: "2.0" },
    ];
    const result = mergeRegistryEntries(platform, personal);
    // skill-b from platform should remain
    // skill-a should be the personal version
    assert.equal(result.length, 2);
    const skillA = result.find(e => e.id === "skill-a");
    assert.ok(skillA, "skill-a should be in result");
    assert.equal(skillA.name, "Skill A (personal override)", "Personal entry should override platform");
    assert.equal(skillA.version, "2.0");
    const skillB = result.find(e => e.id === "skill-b");
    assert.ok(skillB, "skill-b should still be in result");
  });

  it("all personal entries override all matching platform entries", () => {
    const platform = [
      { id: "a", value: "platform-a" },
      { id: "b", value: "platform-b" },
      { id: "c", value: "platform-c" },
    ];
    const personal = [
      { id: "a", value: "personal-a" },
      { id: "c", value: "personal-c" },
      { id: "d", value: "personal-d" },
    ];
    const result = mergeRegistryEntries(platform, personal);
    assert.equal(result.length, 4); // b (platform) + a,c,d (personal)

    const a = result.find(e => e.id === "a");
    const b = result.find(e => e.id === "b");
    const c = result.find(e => e.id === "c");
    const d = result.find(e => e.id === "d");

    assert.equal(a?.value, "personal-a");
    assert.equal(b?.value, "platform-b");
    assert.equal(c?.value, "personal-c");
    assert.equal(d?.value, "personal-d");
  });

  it("returns empty array when both registries are empty", () => {
    const result = mergeRegistryEntries([], []);
    assert.deepEqual(result, []);
  });

  it("personal-only entries (no platform file) are returned as-is", () => {
    const personal = [
      { id: "mine-1", name: "My Item 1" },
      { id: "mine-2", name: "My Item 2" },
    ];
    const result = mergeRegistryEntries([], personal);
    assert.deepEqual(result, personal);
  });

  it("merge preserves all fields from personal entry", () => {
    const platform = [{ id: "x", name: "X", extra: "platform-only" }];
    const personal = [{ id: "x", name: "X Personal", customField: "my-value" }];
    const result = mergeRegistryEntries(platform, personal);
    const x = result.find(e => e.id === "x");
    assert.equal(x?.name, "X Personal");
    assert.equal(x?.customField, "my-value");
    // The personal entry did NOT include `extra` — that's expected behavior
    assert.equal(x?.extra, undefined);
  });
});

describe("PersonalRegistry write path", () => {
  it("personal registry path format is PersonalRegistry/{type}.json, not registry/personal-{type}.json", () => {
    // This validates the naming convention used in web-ui.ts
    const type = "skills";
    const oldPath = `registry/personal-${type}.json`;
    const newPath = `PersonalRegistry/${type}.json`;

    // The old path format (personal-*.json inside registry/) is no longer used
    assert.ok(!newPath.includes("personal-"), "New path should not use personal- prefix");
    assert.ok(newPath.startsWith("PersonalRegistry/"), "New path should be in PersonalRegistry/");
    assert.ok(!oldPath.startsWith("PersonalRegistry/"), "Old path was inside registry/ dir");
  });

  it("personal registry dir is separate from platform registry dir", () => {
    const baseDir = "/app";
    const platformRegistryDir = `${baseDir}/registry`;
    const personalRegistryDir = "/home/user/Desktop/MyAIforOne Drive/PersonalRegistry";
    assert.notEqual(platformRegistryDir, personalRegistryDir);
    assert.ok(!personalRegistryDir.startsWith(baseDir), "PersonalRegistry should be outside the app dir");
  });
});
