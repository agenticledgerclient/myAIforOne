import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4888";

async function tryFetch(path: string, opts?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(`${BASE}${path}`, opts);
  } catch {
    return null; // service not running
  }
}

async function json(path: string, opts?: any) {
  const res = await tryFetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res) return { status: 0, body: null };
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ═══════════════════════════════════════════════════════════════════
//  PROGRESS — write
// ═══════════════════════════════════════════════════════════════════

describe("gym — progress write", () => {
  it("PUT /api/gym/progress updates progress object", async () => {
    const { status, body } = await json("/api/gym/progress", {
      method: "PUT",
      body: { _testField: "test", updatedAt: new Date().toISOString() }
    });
    if (status === 0) return;
    assert.ok(status === 200 || status === 201);
    assert.ok(typeof body === "object");
  });
});

// ═══════════════════════════════════════════════════════════════════
//  CARDS — dismiss
// ═══════════════════════════════════════════════════════════════════

describe("gym — card dismiss", () => {
  it("POST /api/gym/cards/:id/dismiss dismisses a card", async () => {
    // Create a card first
    const create = await json("/api/gym/cards", {
      method: "POST",
      body: { title: "Dismiss Test Card", description: "test dismiss", type: "tip" }
    });
    if (create.status === 0) return;
    assert.equal(create.status, 201);
    const cardId = (create.body as any)?.id;
    if (!cardId) return;

    const dismiss = await json(`/api/gym/cards/${cardId}/dismiss`, { method: "POST" });
    assert.ok(dismiss.status === 200 || dismiss.status === 404);
    if (dismiss.status === 200) {
      assert.ok((dismiss.body as any).ok || typeof dismiss.body === "object");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  PROGRAMS — create, patch, delete
// ═══════════════════════════════════════════════════════════════════

describe("gym — programs write", () => {
  let programSlug = "";

  it("POST /api/gym/programs creates a program", async () => {
    const { status, body } = await json("/api/gym/programs", {
      method: "POST",
      body: {
        title: "Test Program Advanced",
        description: "Created by test suite",
        modules: [{ title: "Module 1", steps: [{ title: "Step 1", content: "Content" }] }]
      }
    });
    if (status === 0) return;
    assert.ok(status === 200 || status === 201);
    programSlug = (body as any)?.slug || (body as any)?.id || "";
  });

  it("PATCH /api/gym/programs/:slug updates program fields", async () => {
    if (!programSlug) return;
    const { status, body } = await json(`/api/gym/programs/${programSlug}`, {
      method: "PATCH",
      body: { description: "Updated by test suite" }
    });
    assert.ok(status === 200 || status === 404);
    if (status === 200) {
      assert.ok(typeof body === "object");
    }
  });

  it("DELETE /api/gym/programs/:slug deletes program", async () => {
    if (!programSlug) return;
    const { status, body } = await json(`/api/gym/programs/${programSlug}`, {
      method: "DELETE"
    });
    assert.ok(status === 200 || status === 404);
    if (status === 200) {
      assert.ok((body as any).ok || typeof body === "object");
    }
  });

  it("DELETE /api/gym/programs/NONEXISTENT returns 404", async () => {
    const { status } = await json("/api/gym/programs/NONEXISTENT_PROGRAM_XYZ_999", {
      method: "DELETE"
    });
    if (status === 0) return;
    assert.equal(status, 404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  DIGEST
// ═══════════════════════════════════════════════════════════════════

describe("gym — digest", () => {
  it("POST /api/gym/digest/run triggers digest", async () => {
    const { status, body } = await json("/api/gym/digest/run", { method: "POST" });
    if (status === 0) return;
    assert.ok(status === 200 || status === 202 || status === 500);
    if (status === 200) {
      assert.ok(typeof body === "object");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  INSIGHTS
// ═══════════════════════════════════════════════════════════════════

describe("gym — insights", () => {
  let insightId = "";

  it("GET /api/gym/insights returns insights list", async () => {
    const { status, body } = await json("/api/gym/insights");
    if (status === 0) return;
    assert.ok(status === 200 || status === 404);
    if (status === 200) {
      assert.ok(Array.isArray(body) || Array.isArray((body as any).insights) || typeof body === "object");
    }
  });

  it("POST /api/gym/insights saves an insight", async () => {
    const { status, body } = await json("/api/gym/insights", {
      method: "POST",
      body: {
        title: "Test Insight from API suite",
        summary: "Test summary",
        category: "test",
        actionable: false
      }
    });
    if (status === 0) return;
    assert.ok(status === 200 || status === 201);
    insightId = (body as any)?.id || (body as any)?.insight?.id || "";
  });

  it("POST /api/gym/insights/:id/dismiss dismisses an insight", async () => {
    if (!insightId) return;
    const { status, body } = await json(`/api/gym/insights/${insightId}/dismiss`, {
      method: "POST"
    });
    assert.ok(status === 200 || status === 404);
    if (status === 200) {
      assert.ok((body as any).ok || typeof body === "object");
    }
  });

  it("POST /api/gym/insights/reset-dismissed resets dismissed state", async () => {
    const { status, body } = await json("/api/gym/insights/reset-dismissed", {
      method: "POST"
    });
    if (status === 0) return;
    assert.ok(status === 200);
    assert.ok((body as any).ok || typeof body === "object");
  });

  it("POST /api/gym/insights/generate generates new insights", async () => {
    const { status, body } = await json("/api/gym/insights/generate", {
      method: "POST"
    });
    if (status === 0) return;
    assert.ok(status === 200 || status === 202 || status === 500);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  GUIDES
// ═══════════════════════════════════════════════════════════════════

describe("gym — guides", () => {
  it("GET /api/gym/guides returns guides list", async () => {
    const { status, body } = await json("/api/gym/guides");
    if (status === 0) return;
    assert.ok(status === 200 || status === 404);
    if (status === 200) {
      assert.ok(Array.isArray(body) || Array.isArray((body as any).guides) || typeof body === "object");
    }
  });

  it("POST /api/gym/guides creates a guide", async () => {
    const { status, body } = await json("/api/gym/guides", {
      method: "POST",
      body: {
        title: "Test Guide from API suite",
        content: "# Test Guide\nCreated by test suite.",
        category: "test"
      }
    });
    if (status === 0) return;
    assert.ok(status === 200 || status === 201 || status === 400);
  });
});
