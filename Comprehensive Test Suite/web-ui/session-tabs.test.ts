import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

/**
 * Session tabs tests
 *
 * Tests the session-tabs.json read/write logic, tab CRUD operations
 * (create, rename, delete), and edge cases — all as pure functions
 * replicated from src/web-ui.ts without importing the source.
 */

const tmpDir = join(tmpdir(), "channelToAgent-session-tabs-tests");

// ─── Types ───────────────────────────────────────────────────────────

interface SessionTab {
  id: string;
  label: string;
  createdAt: string;
  closedAt: string | null;
  claudeSessionId: string | null;
}

interface SessionTabsData {
  tabs: SessionTab[];
}

// ─── Replicated pure functions from src/web-ui.ts ────────────────────

function readSessionTabs(filePath: string): SessionTabsData {
  try {
    if (!existsSync(filePath)) return { tabs: [] };
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tabs)) return { tabs: [] };
    return parsed as SessionTabsData;
  } catch {
    return { tabs: [] };
  }
}

function writeSessionTabs(filePath: string, data: SessionTabsData): void {
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function createTab(label: string): SessionTab {
  return {
    id: "tab_" + randomBytes(8).toString("hex"),
    label,
    createdAt: new Date().toISOString(),
    closedAt: null,
    claudeSessionId: null,
  };
}

function renameTab(
  data: SessionTabsData,
  tabId: string,
  newLabel: string,
): { ok: true; tab: SessionTab } | { ok: false; error: string } {
  const tab = data.tabs.find((t) => t.id === tabId);
  if (!tab) return { ok: false, error: "Tab not found" };
  tab.label = newLabel;
  return { ok: true, tab };
}

function deleteTab(
  data: SessionTabsData,
  tabId: string,
): { ok: true } | { ok: false; error: string } {
  const idx = data.tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return { ok: false, error: "Tab not found" };
  data.tabs.splice(idx, 1);
  return { ok: true };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("session-tabs — readSessionTabs", () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("returns empty tabs array when file does not exist", () => {
    const p = join(tmpDir, "nonexistent", "session-tabs.json");
    const result = readSessionTabs(p);
    assert.deepStrictEqual(result, { tabs: [] });
  });

  it("returns empty tabs array when file contains malformed JSON", () => {
    const p = join(tmpDir, "session-tabs.json");
    writeFileSync(p, "not valid json {{{");
    const result = readSessionTabs(p);
    assert.deepStrictEqual(result, { tabs: [] });
  });

  it("returns empty tabs array when JSON has no tabs array", () => {
    const p = join(tmpDir, "session-tabs.json");
    writeFileSync(p, JSON.stringify({ something: "else" }));
    const result = readSessionTabs(p);
    assert.deepStrictEqual(result, { tabs: [] });
  });

  it("returns empty tabs array when tabs field is not an array", () => {
    const p = join(tmpDir, "session-tabs.json");
    writeFileSync(p, JSON.stringify({ tabs: "not-an-array" }));
    const result = readSessionTabs(p);
    assert.deepStrictEqual(result, { tabs: [] });
  });

  it("parses valid session-tabs.json correctly", () => {
    const p = join(tmpDir, "session-tabs.json");
    const data: SessionTabsData = {
      tabs: [
        {
          id: "tab_abc123",
          label: "My Session",
          createdAt: "2026-04-08T10:00:00.000Z",
          closedAt: null,
          claudeSessionId: "ses_xyz",
        },
      ],
    };
    writeFileSync(p, JSON.stringify(data, null, 2));
    const result = readSessionTabs(p);
    assert.equal(result.tabs.length, 1);
    assert.equal(result.tabs[0].id, "tab_abc123");
    assert.equal(result.tabs[0].label, "My Session");
    assert.equal(result.tabs[0].claudeSessionId, "ses_xyz");
  });
});

describe("session-tabs — writeSessionTabs", () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("writes file with correct JSON format (2-space indent)", () => {
    const p = join(tmpDir, "session-tabs.json");
    const data: SessionTabsData = {
      tabs: [
        {
          id: "tab_001",
          label: "Test",
          createdAt: "2026-04-08T10:00:00.000Z",
          closedAt: null,
          claudeSessionId: null,
        },
      ],
    };
    writeSessionTabs(p, data);

    const raw = readFileSync(p, "utf-8");
    assert.equal(raw, JSON.stringify(data, null, 2));
  });

  it("creates parent directory if missing", () => {
    const nested = join(tmpDir, "deep", "nested", "dir", "session-tabs.json");
    const data: SessionTabsData = { tabs: [] };
    writeSessionTabs(nested, data);

    assert.ok(existsSync(nested));
    const parsed = JSON.parse(readFileSync(nested, "utf-8"));
    assert.deepStrictEqual(parsed, { tabs: [] });
  });

  it("overwrites existing file", () => {
    const p = join(tmpDir, "session-tabs.json");
    writeSessionTabs(p, { tabs: [{ id: "tab_old", label: "Old", createdAt: "", closedAt: null, claudeSessionId: null }] });
    writeSessionTabs(p, { tabs: [] });

    const parsed = JSON.parse(readFileSync(p, "utf-8"));
    assert.equal(parsed.tabs.length, 0);
  });
});

describe("session-tabs — createTab", () => {
  it("generates a tab with tab_ prefix ID", () => {
    const tab = createTab("New Session");
    assert.ok(tab.id.startsWith("tab_"));
    assert.ok(tab.id.length > 4); // "tab_" + hex chars
  });

  it("sets label correctly", () => {
    const tab = createTab("My Session");
    assert.equal(tab.label, "My Session");
  });

  it("sets createdAt to a valid ISO date", () => {
    const before = new Date().toISOString();
    const tab = createTab("Test");
    const after = new Date().toISOString();

    assert.ok(tab.createdAt >= before);
    assert.ok(tab.createdAt <= after);
    // Verify it's a valid ISO string
    assert.ok(!isNaN(Date.parse(tab.createdAt)));
  });

  it("sets closedAt and claudeSessionId to null", () => {
    const tab = createTab("Test");
    assert.equal(tab.closedAt, null);
    assert.equal(tab.claudeSessionId, null);
  });

  it("generates unique IDs across multiple calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(createTab(`Tab ${i}`).id);
    }
    assert.equal(ids.size, 100);
  });
});

describe("session-tabs — renameTab", () => {
  it("renames an existing tab", () => {
    const data: SessionTabsData = {
      tabs: [
        { id: "tab_abc", label: "Original", createdAt: "", closedAt: null, claudeSessionId: null },
      ],
    };
    const result = renameTab(data, "tab_abc", "Renamed");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.tab.label, "Renamed");
      assert.equal(result.tab.id, "tab_abc");
    }
    // Verify mutation on the data object
    assert.equal(data.tabs[0].label, "Renamed");
  });

  it("returns error for unknown tab ID", () => {
    const data: SessionTabsData = {
      tabs: [
        { id: "tab_abc", label: "Original", createdAt: "", closedAt: null, claudeSessionId: null },
      ],
    };
    const result = renameTab(data, "tab_nonexistent", "New Name");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error.toLowerCase().includes("not found"));
    }
  });

  it("renames only the targeted tab among multiple tabs", () => {
    const data: SessionTabsData = {
      tabs: [
        { id: "tab_1", label: "First", createdAt: "", closedAt: null, claudeSessionId: null },
        { id: "tab_2", label: "Second", createdAt: "", closedAt: null, claudeSessionId: null },
        { id: "tab_3", label: "Third", createdAt: "", closedAt: null, claudeSessionId: null },
      ],
    };
    renameTab(data, "tab_2", "Updated Second");
    assert.equal(data.tabs[0].label, "First");
    assert.equal(data.tabs[1].label, "Updated Second");
    assert.equal(data.tabs[2].label, "Third");
  });
});

describe("session-tabs — deleteTab", () => {
  it("removes an existing tab", () => {
    const data: SessionTabsData = {
      tabs: [
        { id: "tab_abc", label: "Doomed", createdAt: "", closedAt: null, claudeSessionId: null },
      ],
    };
    const result = deleteTab(data, "tab_abc");
    assert.equal(result.ok, true);
    assert.equal(data.tabs.length, 0);
  });

  it("returns error for unknown tab ID", () => {
    const data: SessionTabsData = {
      tabs: [
        { id: "tab_abc", label: "Existing", createdAt: "", closedAt: null, claudeSessionId: null },
      ],
    };
    const result = deleteTab(data, "tab_nonexistent");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error.toLowerCase().includes("not found"));
    }
    // Original tab should still be there
    assert.equal(data.tabs.length, 1);
  });

  it("removes only the targeted tab among multiple tabs", () => {
    const data: SessionTabsData = {
      tabs: [
        { id: "tab_1", label: "First", createdAt: "", closedAt: null, claudeSessionId: null },
        { id: "tab_2", label: "Second", createdAt: "", closedAt: null, claudeSessionId: null },
        { id: "tab_3", label: "Third", createdAt: "", closedAt: null, claudeSessionId: null },
      ],
    };
    deleteTab(data, "tab_2");
    assert.equal(data.tabs.length, 2);
    assert.equal(data.tabs[0].id, "tab_1");
    assert.equal(data.tabs[1].id, "tab_3");
  });
});

describe("session-tabs — full CRUD round-trip", () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("create, list, rename, delete cycle persists to disk", () => {
    const p = join(tmpDir, "session-tabs.json");

    // Start empty
    let data = readSessionTabs(p);
    assert.equal(data.tabs.length, 0);

    // Create two tabs
    const tab1 = createTab("Session Alpha");
    const tab2 = createTab("Session Beta");
    data.tabs.push(tab1, tab2);
    writeSessionTabs(p, data);

    // Re-read and verify list
    data = readSessionTabs(p);
    assert.equal(data.tabs.length, 2);
    assert.equal(data.tabs[0].label, "Session Alpha");
    assert.equal(data.tabs[1].label, "Session Beta");

    // Rename first tab
    renameTab(data, tab1.id, "Session Alpha Renamed");
    writeSessionTabs(p, data);

    data = readSessionTabs(p);
    assert.equal(data.tabs[0].label, "Session Alpha Renamed");

    // Delete second tab
    deleteTab(data, tab2.id);
    writeSessionTabs(p, data);

    data = readSessionTabs(p);
    assert.equal(data.tabs.length, 1);
    assert.equal(data.tabs[0].id, tab1.id);
  });

  it("multiple tabs can coexist with different session IDs", () => {
    const p = join(tmpDir, "session-tabs.json");

    const tab1 = createTab("Tab 1");
    tab1.claudeSessionId = "ses_aaa";
    const tab2 = createTab("Tab 2");
    tab2.claudeSessionId = "ses_bbb";
    const tab3 = createTab("Tab 3");
    tab3.claudeSessionId = null;

    const data: SessionTabsData = { tabs: [tab1, tab2, tab3] };
    writeSessionTabs(p, data);

    const loaded = readSessionTabs(p);
    assert.equal(loaded.tabs.length, 3);
    assert.equal(loaded.tabs[0].claudeSessionId, "ses_aaa");
    assert.equal(loaded.tabs[1].claudeSessionId, "ses_bbb");
    assert.equal(loaded.tabs[2].claudeSessionId, null);
  });
});
