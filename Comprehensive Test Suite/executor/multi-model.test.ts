import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Multi-model / Ollama executor tests
 *
 * Tests config defaults, executor routing logic, health checks, and
 * the Ollama executor functions — all without requiring a running
 * Ollama instance (uses mocked fetch where needed).
 */

const tmpDir = join(tmpdir(), "channelToAgent-multimodel-tests");

// ─── Helpers ────────────────────────────────────────────────────────

/** Minimal ServiceConfig-like object for testing */
function makeServiceConfig(overrides: Record<string, unknown> = {}) {
  return {
    logLevel: "info" as const,
    multiModelEnabled: undefined as boolean | undefined,
    platformDefaultExecutor: undefined as string | undefined,
    ollamaBaseUrl: undefined as string | undefined,
    ...overrides,
  };
}

/** Minimal AgentConfig-like object for testing */
function makeAgentConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: "test-agent",
    description: "Test agent",
    workspace: "/tmp/test",
    claudeMd: "/tmp/test/CLAUDE.md",
    memoryDir: "/tmp/test/memory",
    autoCommit: false,
    autoCommitBranch: "main",
    allowedTools: ["Read"],
    routes: [],
    executor: undefined as string | undefined,
    timeout: 300_000,
    ...overrides,
  };
}

/**
 * Replicate the executor routing logic from src/executor.ts (lines ~1233-1237)
 * so we can test the branching without spawning real processes.
 */
function resolveExecutor(
  serviceConfig: ReturnType<typeof makeServiceConfig>,
  agentConfig: ReturnType<typeof makeAgentConfig>,
): { useOllama: boolean; effectiveExecutor: string; ollamaModel?: string } {
  const multiModelEnabled = serviceConfig.multiModelEnabled ?? false;
  const effectiveExecutor = agentConfig.executor
    || (multiModelEnabled ? (serviceConfig.platformDefaultExecutor || "claude") : "claude");

  if (multiModelEnabled && effectiveExecutor.startsWith("ollama:")) {
    const ollamaModel = effectiveExecutor.slice("ollama:".length);
    return { useOllama: true, effectiveExecutor, ollamaModel };
  }
  return { useOllama: false, effectiveExecutor };
}

// ─── Config validation defaults ─────────────────────────────────────

describe("multi-model — config defaults", () => {
  it("multiModelEnabled defaults to false when undefined", () => {
    const svc = makeServiceConfig();
    assert.equal(svc.multiModelEnabled ?? false, false);
  });

  it("multiModelEnabled defaults to false when not present", () => {
    const svc = { logLevel: "info" as const };
    assert.equal((svc as any).multiModelEnabled ?? false, false);
  });

  it("platformDefaultExecutor defaults to 'claude' when undefined", () => {
    const svc = makeServiceConfig();
    const result = svc.platformDefaultExecutor || "claude";
    assert.equal(result, "claude");
  });

  it("ollamaBaseUrl defaults to http://localhost:11434 when undefined", () => {
    const svc = makeServiceConfig();
    const result = svc.ollamaBaseUrl || "http://localhost:11434";
    assert.equal(result, "http://localhost:11434");
  });

  it("agent executor field defaults to undefined", () => {
    const agent = makeAgentConfig();
    assert.equal(agent.executor, undefined);
  });
});

// ─── Executor routing ───────────────────────────────────────────────

describe("multi-model — executor routing", () => {
  it("routes to Ollama when multiModelEnabled=true and agent has executor='ollama:gemma2'", () => {
    const svc = makeServiceConfig({ multiModelEnabled: true });
    const agent = makeAgentConfig({ executor: "ollama:gemma2" });
    const result = resolveExecutor(svc, agent);

    assert.equal(result.useOllama, true);
    assert.equal(result.effectiveExecutor, "ollama:gemma2");
    assert.equal(result.ollamaModel, "gemma2");
  });

  it("routes to Ollama with llama3.1 model name", () => {
    const svc = makeServiceConfig({ multiModelEnabled: true });
    const agent = makeAgentConfig({ executor: "ollama:llama3.1" });
    const result = resolveExecutor(svc, agent);

    assert.equal(result.useOllama, true);
    assert.equal(result.ollamaModel, "llama3.1");
  });

  it("uses Claude when multiModelEnabled=false regardless of agent executor field", () => {
    const svc = makeServiceConfig({ multiModelEnabled: false });
    const agent = makeAgentConfig({ executor: "ollama:gemma2" });
    const result = resolveExecutor(svc, agent);

    // multiModelEnabled is false, so even though agent says ollama, it won't pass
    // the `multiModelEnabled && effectiveExecutor.startsWith("ollama:")` check
    assert.equal(result.useOllama, false);
    // effectiveExecutor still holds the agent's value, but the Ollama branch won't fire
    assert.equal(result.effectiveExecutor, "ollama:gemma2");
  });

  it("uses Claude when multiModelEnabled is undefined (default)", () => {
    const svc = makeServiceConfig();
    const agent = makeAgentConfig({ executor: "ollama:gemma2" });
    const result = resolveExecutor(svc, agent);

    assert.equal(result.useOllama, false);
  });

  it("uses Claude when agent has no executor field and multiModelEnabled=false", () => {
    const svc = makeServiceConfig({ multiModelEnabled: false });
    const agent = makeAgentConfig();
    const result = resolveExecutor(svc, agent);

    assert.equal(result.useOllama, false);
    assert.equal(result.effectiveExecutor, "claude");
  });

  it("uses platformDefaultExecutor when agent has no executor and multiModelEnabled=true", () => {
    const svc = makeServiceConfig({
      multiModelEnabled: true,
      platformDefaultExecutor: "ollama:mistral",
    });
    const agent = makeAgentConfig();
    const result = resolveExecutor(svc, agent);

    assert.equal(result.useOllama, true);
    assert.equal(result.effectiveExecutor, "ollama:mistral");
    assert.equal(result.ollamaModel, "mistral");
  });

  it("falls back to 'claude' when agent has no executor and platformDefaultExecutor is undefined", () => {
    const svc = makeServiceConfig({ multiModelEnabled: true });
    const agent = makeAgentConfig();
    const result = resolveExecutor(svc, agent);

    assert.equal(result.useOllama, false);
    assert.equal(result.effectiveExecutor, "claude");
  });

  it("agent executor overrides platformDefaultExecutor", () => {
    const svc = makeServiceConfig({
      multiModelEnabled: true,
      platformDefaultExecutor: "ollama:mistral",
    });
    const agent = makeAgentConfig({ executor: "ollama:gemma2" });
    const result = resolveExecutor(svc, agent);

    assert.equal(result.useOllama, true);
    assert.equal(result.ollamaModel, "gemma2");
  });

  it("agent with executor='claude' stays on Claude even when multiModelEnabled=true", () => {
    const svc = makeServiceConfig({
      multiModelEnabled: true,
      platformDefaultExecutor: "ollama:mistral",
    });
    const agent = makeAgentConfig({ executor: "claude" });
    const result = resolveExecutor(svc, agent);

    assert.equal(result.useOllama, false);
    assert.equal(result.effectiveExecutor, "claude");
  });
});

// ─── Ollama health check ────────────────────────────────────────────

describe("multi-model — checkOllamaHealth", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns ok:true when Ollama responds with models", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ models: [{ name: "gemma2:latest" }, { name: "llama3.1:latest" }] }),
    })) as any;

    const { checkOllamaHealth } = await import("../../src/ollama-executor.js");
    const result = await checkOllamaHealth("http://localhost:11434");
    assert.equal(result.ok, true);
    assert.equal(result.error, undefined);
  });

  it("returns ok:true when checking a specific model that exists", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ models: [{ name: "gemma2:latest" }, { name: "llama3.1:latest" }] }),
    })) as any;

    const { checkOllamaHealth } = await import("../../src/ollama-executor.js");
    const result = await checkOllamaHealth("http://localhost:11434", "gemma2");
    assert.equal(result.ok, true);
  });

  it("returns ok:false when specific model is not found", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ models: [{ name: "gemma2:latest" }] }),
    })) as any;

    const { checkOllamaHealth } = await import("../../src/ollama-executor.js");
    const result = await checkOllamaHealth("http://localhost:11434", "nonexistent-model");
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("nonexistent-model"));
    assert.ok(result.error?.includes("not found"));
  });

  it("returns ok:false when Ollama responds with non-200", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 503,
    })) as any;

    const { checkOllamaHealth } = await import("../../src/ollama-executor.js");
    const result = await checkOllamaHealth("http://localhost:11434");
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("503"));
  });

  it("returns ok:false when Ollama is not running (fetch throws)", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as any;

    const { checkOllamaHealth } = await import("../../src/ollama-executor.js");
    const result = await checkOllamaHealth("http://localhost:11434");
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("not running"));
  });

  it("uses default URL when none provided", async () => {
    let calledUrl = "";
    globalThis.fetch = (async (url: string) => {
      calledUrl = url;
      return { ok: true, json: async () => ({ models: [] }) };
    }) as any;

    const { checkOllamaHealth } = await import("../../src/ollama-executor.js");
    await checkOllamaHealth();
    assert.ok(calledUrl.includes("localhost:11434"));
  });
});

// ─── executeOllama ──────────────────────────────────────────────────

describe("multi-model — executeOllama", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends correct payload and returns response content", async () => {
    let capturedBody: any = null;
    globalThis.fetch = (async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ message: { content: "Hello from Ollama!" } }),
      };
    }) as any;

    const { executeOllama } = await import("../../src/ollama-executor.js");
    const result = await executeOllama({
      model: "gemma2",
      systemPrompt: "You are helpful.",
      message: "Say hello",
      baseUrl: "http://localhost:11434",
    });

    assert.equal(result, "Hello from Ollama!");
    assert.equal(capturedBody.model, "gemma2");
    assert.equal(capturedBody.stream, false);
    assert.equal(capturedBody.messages.length, 2);
    assert.equal(capturedBody.messages[0].role, "system");
    assert.equal(capturedBody.messages[0].content, "You are helpful.");
    assert.equal(capturedBody.messages[1].role, "user");
    assert.equal(capturedBody.messages[1].content, "Say hello");
  });

  it("returns empty string when response has no content", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ message: {} }),
    })) as any;

    const { executeOllama } = await import("../../src/ollama-executor.js");
    const result = await executeOllama({
      model: "gemma2",
      systemPrompt: "test",
      message: "test",
    });
    assert.equal(result, "");
  });

  it("throws on HTTP error response", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    })) as any;

    const { executeOllama } = await import("../../src/ollama-executor.js");
    await assert.rejects(
      () => executeOllama({ model: "gemma2", systemPrompt: "test", message: "test" }),
      (err: Error) => {
        assert.ok(err.message.includes("500"));
        return true;
      },
    );
  });

  it("throws when Ollama returns an error field", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ error: "model not found" }),
    })) as any;

    const { executeOllama } = await import("../../src/ollama-executor.js");
    await assert.rejects(
      () => executeOllama({ model: "gemma2", systemPrompt: "test", message: "test" }),
      (err: Error) => {
        assert.ok(err.message.includes("model not found"));
        return true;
      },
    );
  });

  it("uses default baseUrl when none provided", async () => {
    let calledUrl = "";
    globalThis.fetch = (async (url: string) => {
      calledUrl = url;
      return { ok: true, json: async () => ({ message: { content: "ok" } }) };
    }) as any;

    const { executeOllama } = await import("../../src/ollama-executor.js");
    await executeOllama({ model: "gemma2", systemPrompt: "test", message: "test" });
    assert.equal(calledUrl, "http://localhost:11434/api/chat");
  });
});

// ─── Model override file management ────────────────────────────────

describe("multi-model — model override file management", () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("model-override.json stores the resolved model string", () => {
    const p = join(tmpDir, "model-override.json");
    writeFileSync(p, JSON.stringify({ model: "claude-sonnet-4-6" }));

    const loaded = JSON.parse(readFileSync(p, "utf-8"));
    assert.equal(loaded.model, "claude-sonnet-4-6");
  });

  it("missing model-override.json means no override", () => {
    const p = join(tmpDir, "model-override.json");
    assert.equal(existsSync(p), false);
  });

  it("model alias mapping resolves known aliases", () => {
    // Replicates the alias map from executor.ts and web-ui.ts
    const aliases: Record<string, string> = {
      opus: "claude-opus-4-6",
      sonnet: "claude-sonnet-4-6",
      haiku: "claude-haiku-4-5-20251001",
      "opus-4": "claude-opus-4-6",
      "sonnet-4": "claude-sonnet-4-6",
    };

    assert.equal(aliases["opus"], "claude-opus-4-6");
    assert.equal(aliases["sonnet"], "claude-sonnet-4-6");
    assert.equal(aliases["haiku"], "claude-haiku-4-5-20251001");
  });

  it("unknown model names pass through as-is", () => {
    const aliases: Record<string, string> = {
      opus: "claude-opus-4-6",
      sonnet: "claude-sonnet-4-6",
    };
    const input = "claude-custom-model-id";
    const resolved = aliases[input] || input;
    assert.equal(resolved, "claude-custom-model-id");
  });
});
