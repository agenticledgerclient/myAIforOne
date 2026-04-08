import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Profile tests
 *
 * Tests the profile.json read/write logic, field validation,
 * merge behavior, and timestamp management — all as pure functions
 * replicated from src/web-ui.ts without importing the source.
 */

const tmpDir = join(tmpdir(), "channelToAgent-profile-tests");

// ─── Types ───────────────────────────────────────────────────────────

interface Profile {
  name?: string;
  role?: string;
  industry?: string;
  aiExperience?: string;
  interests?: string[];
  avatar?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ─── Replicated pure functions from src/web-ui.ts ────────────────────

function readProfile(filePath: string): Profile {
  try {
    if (!existsSync(filePath)) return {};
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Profile;
  } catch {
    return {};
  }
}

function writeProfile(filePath: string, updates: Partial<Profile>): Profile {
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const existing = readProfile(filePath);
  const now = new Date().toISOString();

  const merged: Profile = {
    ...existing,
    ...updates,
    updatedAt: now,
  };

  // Set createdAt only on first write (when no existing createdAt)
  if (!existing.createdAt) {
    merged.createdAt = now;
  } else {
    merged.createdAt = existing.createdAt;
  }

  writeFileSync(filePath, JSON.stringify(merged, null, 2));
  return merged;
}

function validateInterests(interests: unknown): boolean {
  return Array.isArray(interests);
}

function validateAiExperience(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  return typeof value === "string" && ["beginner", "intermediate", "advanced"].includes(value);
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("profile — readProfile", () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("returns {} when file does not exist", () => {
    const p = join(tmpDir, "nonexistent", "profile.json");
    const result = readProfile(p);
    assert.deepStrictEqual(result, {});
  });

  it("returns {} on malformed JSON", () => {
    const p = join(tmpDir, "profile.json");
    writeFileSync(p, "not valid json {{{");
    const result = readProfile(p);
    assert.deepStrictEqual(result, {});
  });

  it("returns {} when file contains a JSON array instead of object", () => {
    const p = join(tmpDir, "profile.json");
    writeFileSync(p, JSON.stringify(["not", "an", "object"]));
    const result = readProfile(p);
    assert.deepStrictEqual(result, {});
  });

  it("returns {} when file contains a JSON primitive", () => {
    const p = join(tmpDir, "profile.json");
    writeFileSync(p, JSON.stringify("just a string"));
    const result = readProfile(p);
    assert.deepStrictEqual(result, {});
  });

  it("returns valid profile when file exists", () => {
    const p = join(tmpDir, "profile.json");
    const profile: Profile = {
      name: "Alice",
      role: "Developer",
      industry: "Tech",
      aiExperience: "advanced",
      interests: ["coding", "AI"],
      avatar: "https://example.com/avatar.png",
      createdAt: "2026-04-08T10:00:00.000Z",
      updatedAt: "2026-04-08T11:00:00.000Z",
    };
    writeFileSync(p, JSON.stringify(profile, null, 2));
    const result = readProfile(p);
    assert.equal(result.name, "Alice");
    assert.equal(result.role, "Developer");
    assert.equal(result.industry, "Tech");
    assert.equal(result.aiExperience, "advanced");
    assert.deepStrictEqual(result.interests, ["coding", "AI"]);
    assert.equal(result.avatar, "https://example.com/avatar.png");
    assert.equal(result.createdAt, "2026-04-08T10:00:00.000Z");
    assert.equal(result.updatedAt, "2026-04-08T11:00:00.000Z");
  });
});

describe("profile — writeProfile", () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("writes valid JSON with 2-space indent", () => {
    const p = join(tmpDir, "profile.json");
    writeProfile(p, { name: "Bob" });

    const raw = readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.name, "Bob");

    // Verify 2-space indent formatting
    const reparsed = JSON.stringify(parsed, null, 2);
    assert.equal(raw, reparsed);
  });

  it("creates parent directory if missing", () => {
    const nested = join(tmpDir, "deep", "nested", "profile.json");
    writeProfile(nested, { name: "Charlie" });

    assert.ok(existsSync(nested));
    const parsed = JSON.parse(readFileSync(nested, "utf-8"));
    assert.equal(parsed.name, "Charlie");
  });

  it("merges fields without overwriting unset fields", () => {
    const p = join(tmpDir, "profile.json");

    // First write: set name and role
    writeProfile(p, { name: "Dana", role: "Designer" });

    // Second write: set industry only — name and role should persist
    writeProfile(p, { industry: "Finance" });

    const result = readProfile(p);
    assert.equal(result.name, "Dana");
    assert.equal(result.role, "Designer");
    assert.equal(result.industry, "Finance");
  });

  it("overwrites fields that are explicitly provided", () => {
    const p = join(tmpDir, "profile.json");

    writeProfile(p, { name: "Eve", role: "Engineer" });
    writeProfile(p, { name: "Eve Updated" });

    const result = readProfile(p);
    assert.equal(result.name, "Eve Updated");
    assert.equal(result.role, "Engineer");
  });

  it("sets createdAt only on first write", () => {
    const p = join(tmpDir, "profile.json");

    const first = writeProfile(p, { name: "Frank" });
    const firstCreatedAt = first.createdAt;
    assert.ok(firstCreatedAt);
    assert.ok(!isNaN(Date.parse(firstCreatedAt!)));

    // Small delay to ensure timestamps would differ
    const second = writeProfile(p, { role: "Manager" });
    assert.equal(second.createdAt, firstCreatedAt, "createdAt should not change on subsequent writes");
  });

  it("updates updatedAt on every write", () => {
    const p = join(tmpDir, "profile.json");

    const first = writeProfile(p, { name: "Grace" });
    const firstUpdatedAt = first.updatedAt;
    assert.ok(firstUpdatedAt);
    assert.ok(!isNaN(Date.parse(firstUpdatedAt!)));

    const second = writeProfile(p, { role: "Analyst" });
    assert.ok(second.updatedAt);
    assert.ok(second.updatedAt! >= firstUpdatedAt!, "updatedAt should be same or later on subsequent writes");
  });

  it("returns the merged profile object", () => {
    const p = join(tmpDir, "profile.json");

    const result = writeProfile(p, { name: "Hank", interests: ["music"] });
    assert.equal(result.name, "Hank");
    assert.deepStrictEqual(result.interests, ["music"]);
    assert.ok(result.createdAt);
    assert.ok(result.updatedAt);
  });
});

describe("profile — field validation", () => {
  it("accepts a valid array for interests", () => {
    assert.ok(validateInterests(["coding", "AI", "music"]));
  });

  it("accepts an empty array for interests", () => {
    assert.ok(validateInterests([]));
  });

  it("rejects a string for interests", () => {
    assert.equal(validateInterests("coding"), false);
  });

  it("rejects a number for interests", () => {
    assert.equal(validateInterests(42), false);
  });

  it("rejects null for interests", () => {
    assert.equal(validateInterests(null), false);
  });

  it("rejects undefined for interests", () => {
    assert.equal(validateInterests(undefined), false);
  });

  it("rejects an object for interests", () => {
    assert.equal(validateInterests({ key: "value" }), false);
  });

  it("accepts 'beginner' for aiExperience", () => {
    assert.ok(validateAiExperience("beginner"));
  });

  it("accepts 'intermediate' for aiExperience", () => {
    assert.ok(validateAiExperience("intermediate"));
  });

  it("accepts 'advanced' for aiExperience", () => {
    assert.ok(validateAiExperience("advanced"));
  });

  it("accepts empty string for aiExperience", () => {
    assert.ok(validateAiExperience(""));
  });

  it("accepts undefined for aiExperience", () => {
    assert.ok(validateAiExperience(undefined));
  });

  it("accepts null for aiExperience", () => {
    assert.ok(validateAiExperience(null));
  });

  it("rejects invalid string for aiExperience", () => {
    assert.equal(validateAiExperience("expert"), false);
  });

  it("rejects number for aiExperience", () => {
    assert.equal(validateAiExperience(3), false);
  });

  it("rejects boolean for aiExperience", () => {
    assert.equal(validateAiExperience(true), false);
  });
});

describe("profile — full CRUD round-trip", () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("write, read, update, read cycle persists to disk", () => {
    const p = join(tmpDir, "profile.json");

    // Start empty
    let profile = readProfile(p);
    assert.deepStrictEqual(profile, {});

    // Create profile
    writeProfile(p, {
      name: "Iris",
      role: "Researcher",
      industry: "Academia",
      aiExperience: "intermediate",
      interests: ["NLP", "computer vision"],
    });

    // Read back and verify
    profile = readProfile(p);
    assert.equal(profile.name, "Iris");
    assert.equal(profile.role, "Researcher");
    assert.equal(profile.industry, "Academia");
    assert.equal(profile.aiExperience, "intermediate");
    assert.deepStrictEqual(profile.interests, ["NLP", "computer vision"]);
    assert.ok(profile.createdAt);
    assert.ok(profile.updatedAt);

    const originalCreatedAt = profile.createdAt;

    // Update some fields
    writeProfile(p, {
      role: "Senior Researcher",
      interests: ["NLP", "computer vision", "robotics"],
      avatar: "https://example.com/iris.png",
    });

    // Read again and verify merge
    profile = readProfile(p);
    assert.equal(profile.name, "Iris", "name should persist from original write");
    assert.equal(profile.role, "Senior Researcher", "role should be updated");
    assert.equal(profile.industry, "Academia", "industry should persist from original write");
    assert.equal(profile.aiExperience, "intermediate", "aiExperience should persist from original write");
    assert.deepStrictEqual(profile.interests, ["NLP", "computer vision", "robotics"], "interests should be replaced");
    assert.equal(profile.avatar, "https://example.com/iris.png", "avatar should be set");
    assert.equal(profile.createdAt, originalCreatedAt, "createdAt should not change");
    assert.ok(profile.updatedAt! >= originalCreatedAt!, "updatedAt should be same or later than createdAt");
  });

  it("multiple sequential updates accumulate all fields", () => {
    const p = join(tmpDir, "profile.json");

    writeProfile(p, { name: "Jack" });
    writeProfile(p, { role: "CTO" });
    writeProfile(p, { industry: "SaaS" });
    writeProfile(p, { aiExperience: "advanced" });
    writeProfile(p, { interests: ["strategy", "product"] });
    writeProfile(p, { avatar: "https://example.com/jack.png" });

    const profile = readProfile(p);
    assert.equal(profile.name, "Jack");
    assert.equal(profile.role, "CTO");
    assert.equal(profile.industry, "SaaS");
    assert.equal(profile.aiExperience, "advanced");
    assert.deepStrictEqual(profile.interests, ["strategy", "product"]);
    assert.equal(profile.avatar, "https://example.com/jack.png");
    assert.ok(profile.createdAt);
    assert.ok(profile.updatedAt);
  });

  it("writing empty updates still updates the timestamp", () => {
    const p = join(tmpDir, "profile.json");

    const first = writeProfile(p, { name: "Kate" });
    const firstUpdatedAt = first.updatedAt;

    // Write with no new fields
    const second = writeProfile(p, {});
    assert.ok(second.updatedAt! >= firstUpdatedAt!);
    assert.equal(second.name, "Kate", "existing fields should persist");
  });
});
