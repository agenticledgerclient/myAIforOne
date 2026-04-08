import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Multi-provider executor tests — OpenAI-compatible (OpenAI, Grok, Groq,
 * Together, Mistral) and Google Gemini.
 *
 * Tests the PROVIDERS registry, resolveProvider(), executeOpenAICompat(),
 * checkOpenAICompatHealth(), executeGemini(), checkGeminiHealth(), and
 * executor routing logic — all with mocked fetch, no real API calls.
 */

// ─── Helpers ────────────────────────────────────────────────────────

/** Minimal ServiceConfig-like object for testing */
function makeServiceConfig(overrides: Record<string, unknown> = {}) {
  return {
    logLevel: "info" as const,
    multiModelEnabled: undefined as boolean | undefined,
    platformDefaultExecutor: undefined as string | undefined,
    ollamaBaseUrl: undefined as string | undefined,
    providerKeys: {} as Record<string, string>,
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
 * Replicate the multi-provider routing logic from src/executor.ts (lines ~1237-1293)
 * so we can test the branching without spawning real processes.
 */
function resolveMultiProviderRoute(
  serviceConfig: ReturnType<typeof makeServiceConfig>,
  agentConfig: ReturnType<typeof makeAgentConfig>,
): {
  target: "claude" | "ollama" | "gemini" | "openai-compat" | "error";
  prefix?: string;
  modelName?: string;
  error?: string;
} {
  const multiModelEnabled = serviceConfig.multiModelEnabled ?? false;
  const effectiveExecutor = agentConfig.executor
    || (multiModelEnabled ? (serviceConfig.platformDefaultExecutor || "claude") : "claude");

  if (!(multiModelEnabled && effectiveExecutor !== "claude" && effectiveExecutor.includes(":"))) {
    return { target: "claude" };
  }

  const [prefix, ...rest] = effectiveExecutor.split(":");
  const modelName = rest.join(":");

  if (prefix === "ollama") {
    return { target: "ollama", prefix, modelName };
  }
  if (prefix === "gemini") {
    const apiKey = serviceConfig.providerKeys?.google;
    if (!apiKey) return { target: "error", error: "No Google API key configured" };
    return { target: "gemini", prefix, modelName };
  }

  // OpenAI-compatible providers
  const KNOWN_PREFIXES = ["openai", "grok", "groq", "together", "mistral"];
  if (KNOWN_PREFIXES.includes(prefix)) {
    const keyFieldMap: Record<string, string> = {
      openai: "openai", grok: "xai", groq: "groq", together: "together", mistral: "mistral",
    };
    const apiKey = serviceConfig.providerKeys?.[keyFieldMap[prefix]];
    if (!apiKey) return { target: "error", error: `No API key configured for ${prefix}` };
    return { target: "openai-compat", prefix, modelName };
  }

  return { target: "error", prefix, modelName, error: `Unknown model provider "${prefix}"` };
}

// ─── PROVIDERS registry ──────────────────────────────────────────────

describe("multi-provider — PROVIDERS registry", () => {
  it("has entries for all five OpenAI-compatible providers", async () => {
    const { PROVIDERS } = await import("../../src/openai-executor.js");
    const expected = ["openai", "grok", "groq", "together", "mistral"];
    for (const key of expected) {
      assert.ok(PROVIDERS[key], `missing provider: ${key}`);
    }
  });

  it("openai baseUrl points to api.openai.com", async () => {
    const { PROVIDERS } = await import("../../src/openai-executor.js");
    assert.equal(PROVIDERS.openai.baseUrl, "https://api.openai.com/v1");
  });

  it("grok baseUrl points to api.x.ai", async () => {
    const { PROVIDERS } = await import("../../src/openai-executor.js");
    assert.equal(PROVIDERS.grok.baseUrl, "https://api.x.ai/v1");
  });

  it("groq baseUrl points to api.groq.com", async () => {
    const { PROVIDERS } = await import("../../src/openai-executor.js");
    assert.equal(PROVIDERS.groq.baseUrl, "https://api.groq.com/openai/v1");
  });

  it("together baseUrl points to api.together.xyz", async () => {
    const { PROVIDERS } = await import("../../src/openai-executor.js");
    assert.equal(PROVIDERS.together.baseUrl, "https://api.together.xyz/v1");
  });

  it("mistral baseUrl points to api.mistral.ai", async () => {
    const { PROVIDERS } = await import("../../src/openai-executor.js");
    assert.equal(PROVIDERS.mistral.baseUrl, "https://api.mistral.ai/v1");
  });

  it("each provider has a name and keyField", async () => {
    const { PROVIDERS } = await import("../../src/openai-executor.js");
    for (const [key, config] of Object.entries(PROVIDERS)) {
      assert.ok(config.name, `${key} missing name`);
      assert.ok(config.keyField, `${key} missing keyField`);
    }
  });
});

// ─── resolveProvider ─────────────────────────────────────────────────

describe("multi-provider — resolveProvider", () => {
  it("returns config for known providers", async () => {
    const { resolveProvider } = await import("../../src/openai-executor.js");
    for (const key of ["openai", "grok", "groq", "together", "mistral"]) {
      const config = resolveProvider(key);
      assert.ok(config, `resolveProvider returned null for ${key}`);
      assert.equal(config!.keyField.length > 0, true);
    }
  });

  it("returns null for unknown provider", async () => {
    const { resolveProvider } = await import("../../src/openai-executor.js");
    assert.equal(resolveProvider("unknown-provider"), null);
  });

  it("returns null for empty string", async () => {
    const { resolveProvider } = await import("../../src/openai-executor.js");
    assert.equal(resolveProvider(""), null);
  });
});

// ─── executeOpenAICompat ─────────────────────────────────────────────

describe("multi-provider — executeOpenAICompat", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends correct payload shape and returns response content", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    globalThis.fetch = (async (url: string, opts: any) => {
      capturedUrl = url;
      capturedHeaders = Object.fromEntries(
        Object.entries(opts.headers || {}),
      );
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { role: "assistant", content: "Hello from OpenAI!" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      };
    }) as any;

    const { executeOpenAICompat } = await import("../../src/openai-executor.js");
    const result = await executeOpenAICompat({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-test-key",
      systemPrompt: "You are helpful.",
      message: "Say hello",
    });

    assert.equal(result, "Hello from OpenAI!");
    assert.equal(capturedUrl, "https://api.openai.com/v1/chat/completions");
    assert.equal(capturedHeaders["Authorization"], "Bearer sk-test-key");
    assert.equal(capturedHeaders["Content-Type"], "application/json");
    assert.equal(capturedBody.model, "gpt-4o");
    assert.equal(capturedBody.stream, false);
    assert.equal(capturedBody.temperature, 0.7);
    assert.equal(capturedBody.max_tokens, 4096);
    assert.equal(capturedBody.messages.length, 2);
    assert.equal(capturedBody.messages[0].role, "system");
    assert.equal(capturedBody.messages[0].content, "You are helpful.");
    assert.equal(capturedBody.messages[1].role, "user");
    assert.equal(capturedBody.messages[1].content, "Say hello");
  });

  it("uses correct URL for grok provider", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
      };
    }) as any;

    const { executeOpenAICompat } = await import("../../src/openai-executor.js");
    await executeOpenAICompat({
      provider: "grok",
      model: "grok-3",
      apiKey: "xai-test-key",
      systemPrompt: "test",
      message: "test",
    });

    assert.equal(capturedUrl, "https://api.x.ai/v1/chat/completions");
  });

  it("uses Authorization Bearer header", async () => {
    let capturedHeaders: any = {};
    globalThis.fetch = (async (_url: string, opts: any) => {
      capturedHeaders = opts.headers;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
      };
    }) as any;

    const { executeOpenAICompat } = await import("../../src/openai-executor.js");
    await executeOpenAICompat({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      apiKey: "gsk-test-key",
      systemPrompt: "test",
      message: "test",
    });

    assert.equal(capturedHeaders["Authorization"], "Bearer gsk-test-key");
  });

  it("returns empty string when response has no content", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { role: "assistant", content: null } }] }),
    })) as any;

    const { executeOpenAICompat } = await import("../../src/openai-executor.js");
    const result = await executeOpenAICompat({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-test",
      systemPrompt: "test",
      message: "test",
    });
    assert.equal(result, "");
  });

  it("throws on HTTP error with status code and provider name", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 429,
      text: async () => "Rate limit exceeded",
    })) as any;

    const { executeOpenAICompat } = await import("../../src/openai-executor.js");
    await assert.rejects(
      () => executeOpenAICompat({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "sk-test",
        systemPrompt: "test",
        message: "test",
      }),
      (err: Error) => {
        assert.ok(err.message.includes("429"), "should include status code");
        assert.ok(err.message.includes("OpenAI"), "should include provider name");
        return true;
      },
    );
  });

  it("throws when response contains error field", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        error: { message: "Model not found", type: "invalid_request_error" },
      }),
    })) as any;

    const { executeOpenAICompat } = await import("../../src/openai-executor.js");
    await assert.rejects(
      () => executeOpenAICompat({
        provider: "together",
        model: "nonexistent",
        apiKey: "sk-test",
        systemPrompt: "test",
        message: "test",
      }),
      (err: Error) => {
        assert.ok(err.message.includes("Model not found"));
        return true;
      },
    );
  });

  it("throws for unknown provider", async () => {
    const { executeOpenAICompat } = await import("../../src/openai-executor.js");
    await assert.rejects(
      () => executeOpenAICompat({
        provider: "nonexistent",
        model: "some-model",
        apiKey: "sk-test",
        systemPrompt: "test",
        message: "test",
      }),
      (err: Error) => {
        assert.ok(err.message.includes("Unknown provider"));
        return true;
      },
    );
  });

  it("respects custom temperature and maxTokens", async () => {
    let capturedBody: any = null;
    globalThis.fetch = (async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
      };
    }) as any;

    const { executeOpenAICompat } = await import("../../src/openai-executor.js");
    await executeOpenAICompat({
      provider: "mistral",
      model: "mistral-large-latest",
      apiKey: "sk-test",
      systemPrompt: "test",
      message: "test",
      temperature: 0.2,
      maxTokens: 1024,
    });

    assert.equal(capturedBody.temperature, 0.2);
    assert.equal(capturedBody.max_tokens, 1024);
  });

  it("allows baseUrl override", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
      };
    }) as any;

    const { executeOpenAICompat } = await import("../../src/openai-executor.js");
    await executeOpenAICompat({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-test",
      systemPrompt: "test",
      message: "test",
      baseUrl: "http://localhost:8080/v1",
    });

    assert.equal(capturedUrl, "http://localhost:8080/v1/chat/completions");
  });
});

// ─── checkOpenAICompatHealth ─────────────────────────────────────────

describe("multi-provider — checkOpenAICompatHealth", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns ok:true with model list on success", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }, { id: "gpt-3.5-turbo" }],
      }),
    })) as any;

    const { checkOpenAICompatHealth } = await import("../../src/openai-executor.js");
    const result = await checkOpenAICompatHealth("openai", "sk-test-key");
    assert.equal(result.ok, true);
    assert.ok(result.models);
    assert.ok(result.models!.includes("gpt-4o"));
    assert.ok(result.models!.includes("gpt-4o-mini"));
  });

  it("returns ok:false with 'Invalid API key' on 401", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
    })) as any;

    const { checkOpenAICompatHealth } = await import("../../src/openai-executor.js");
    const result = await checkOpenAICompatHealth("openai", "sk-bad-key");
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("Invalid API key"));
  });

  it("returns ok:false with 'Invalid API key' on 403", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 403,
    })) as any;

    const { checkOpenAICompatHealth } = await import("../../src/openai-executor.js");
    const result = await checkOpenAICompatHealth("grok", "bad-key");
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("Invalid API key"));
  });

  it("returns ok:false on non-200 response", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 503,
    })) as any;

    const { checkOpenAICompatHealth } = await import("../../src/openai-executor.js");
    const result = await checkOpenAICompatHealth("groq", "gsk-test");
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("503"));
  });

  it("returns ok:false for unknown provider", async () => {
    const { checkOpenAICompatHealth } = await import("../../src/openai-executor.js");
    const result = await checkOpenAICompatHealth("nonexistent", "sk-test");
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("Unknown provider"));
  });

  it("calls correct URL with Bearer auth header", async () => {
    let capturedUrl = "";
    let capturedHeaders: any = {};
    globalThis.fetch = (async (url: string, opts: any) => {
      capturedUrl = url;
      capturedHeaders = opts?.headers || {};
      return {
        ok: true,
        json: async () => ({ data: [] }),
      };
    }) as any;

    const { checkOpenAICompatHealth } = await import("../../src/openai-executor.js");
    await checkOpenAICompatHealth("together", "tog-test-key");
    assert.equal(capturedUrl, "https://api.together.xyz/v1/models");
    assert.equal(capturedHeaders["Authorization"], "Bearer tog-test-key");
  });
});

// ─── executeGemini ───────────────────────────────────────────────────

describe("multi-provider — executeGemini", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends correct Gemini-specific payload and returns content", async () => {
    let capturedUrl = "";
    let capturedBody: any = null;
    let capturedHeaders: any = {};

    globalThis.fetch = (async (url: string, opts: any) => {
      capturedUrl = url;
      capturedHeaders = opts.headers;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: "Hello from Gemini!" }], role: "model" },
            finishReason: "STOP",
          }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        }),
      };
    }) as any;

    const { executeGemini } = await import("../../src/gemini-executor.js");
    const result = await executeGemini({
      model: "gemini-2.5-flash",
      apiKey: "AIza-test-key",
      systemPrompt: "You are helpful.",
      message: "Say hello",
    });

    assert.equal(result, "Hello from Gemini!");

    // URL pattern: {base}/models/{model}:generateContent?key={apiKey}
    assert.ok(capturedUrl.includes("/models/gemini-2.5-flash:generateContent"));
    assert.ok(capturedUrl.includes("key=AIza-test-key"));

    // Auth via query string, NOT Bearer header
    assert.equal(capturedHeaders["Content-Type"], "application/json");
    assert.equal(capturedHeaders["Authorization"], undefined);

    // Gemini-specific payload shape
    assert.deepEqual(capturedBody.system_instruction, {
      parts: [{ text: "You are helpful." }],
    });
    assert.equal(capturedBody.contents.length, 1);
    assert.equal(capturedBody.contents[0].role, "user");
    assert.deepEqual(capturedBody.contents[0].parts, [{ text: "Say hello" }]);
    assert.equal(capturedBody.generationConfig.temperature, 0.7);
    assert.equal(capturedBody.generationConfig.maxOutputTokens, 4096);
  });

  it("concatenates multiple parts text from candidates", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: "Part one. " }, { text: "Part two." }],
            role: "model",
          },
          finishReason: "STOP",
        }],
      }),
    })) as any;

    const { executeGemini } = await import("../../src/gemini-executor.js");
    const result = await executeGemini({
      model: "gemini-2.5-pro",
      apiKey: "AIza-test",
      systemPrompt: "test",
      message: "test",
    });

    assert.equal(result, "Part one. Part two.");
  });

  it("returns empty string when no candidates", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ candidates: [] }),
    })) as any;

    const { executeGemini } = await import("../../src/gemini-executor.js");
    const result = await executeGemini({
      model: "gemini-2.5-flash",
      apiKey: "AIza-test",
      systemPrompt: "test",
      message: "test",
    });
    assert.equal(result, "");
  });

  it("throws on HTTP error", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    })) as any;

    const { executeGemini } = await import("../../src/gemini-executor.js");
    await assert.rejects(
      () => executeGemini({
        model: "gemini-2.5-flash",
        apiKey: "AIza-test",
        systemPrompt: "test",
        message: "test",
      }),
      (err: Error) => {
        assert.ok(err.message.includes("500"));
        assert.ok(err.message.includes("Gemini"));
        return true;
      },
    );
  });

  it("throws when response contains error field", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        error: { code: 400, message: "API key not valid", status: "INVALID_ARGUMENT" },
      }),
    })) as any;

    const { executeGemini } = await import("../../src/gemini-executor.js");
    await assert.rejects(
      () => executeGemini({
        model: "gemini-2.5-flash",
        apiKey: "bad-key",
        systemPrompt: "test",
        message: "test",
      }),
      (err: Error) => {
        assert.ok(err.message.includes("API key not valid"));
        return true;
      },
    );
  });

  it("respects custom temperature and maxTokens", async () => {
    let capturedBody: any = null;
    globalThis.fetch = (async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
      };
    }) as any;

    const { executeGemini } = await import("../../src/gemini-executor.js");
    await executeGemini({
      model: "gemini-2.5-flash",
      apiKey: "AIza-test",
      systemPrompt: "test",
      message: "test",
      temperature: 0.1,
      maxTokens: 512,
    });

    assert.equal(capturedBody.generationConfig.temperature, 0.1);
    assert.equal(capturedBody.generationConfig.maxOutputTokens, 512);
  });
});

// ─── checkGeminiHealth ───────────────────────────────────────────────

describe("multi-provider — checkGeminiHealth", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns ok:true with filtered gemini models", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
          { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
          { name: "models/text-embedding-004", displayName: "Embedding" },
        ],
      }),
    })) as any;

    const { checkGeminiHealth } = await import("../../src/gemini-executor.js");
    const result = await checkGeminiHealth("AIza-test-key");
    assert.equal(result.ok, true);
    assert.ok(result.models);
    assert.ok(result.models!.includes("gemini-2.5-flash"));
    assert.ok(result.models!.includes("gemini-2.5-pro"));
    // Non-gemini models should be filtered out
    assert.ok(!result.models!.includes("text-embedding-004"));
  });

  it("returns ok:false with 'Invalid API key' on 400", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 400,
    })) as any;

    const { checkGeminiHealth } = await import("../../src/gemini-executor.js");
    const result = await checkGeminiHealth("bad-key");
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("Invalid API key"));
  });

  it("returns ok:false with 'Invalid API key' on 403", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 403,
    })) as any;

    const { checkGeminiHealth } = await import("../../src/gemini-executor.js");
    const result = await checkGeminiHealth("bad-key");
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("Invalid API key"));
  });

  it("returns ok:false when specific model is not found", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        models: [
          { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
        ],
      }),
    })) as any;

    const { checkGeminiHealth } = await import("../../src/gemini-executor.js");
    const result = await checkGeminiHealth("AIza-test", "gemini-nonexistent");
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("gemini-nonexistent"));
    assert.ok(result.error?.includes("not found"));
  });

  it("uses API key in query string (not Bearer header)", async () => {
    let capturedUrl = "";
    let capturedHeaders: any = {};
    globalThis.fetch = (async (url: string, opts: any) => {
      capturedUrl = url;
      capturedHeaders = opts?.headers || {};
      return {
        ok: true,
        json: async () => ({ models: [] }),
      };
    }) as any;

    const { checkGeminiHealth } = await import("../../src/gemini-executor.js");
    await checkGeminiHealth("AIza-secret-key");
    assert.ok(capturedUrl.includes("key=AIza-secret-key"));
    assert.equal(capturedHeaders["Authorization"], undefined);
  });
});

// ─── Executor routing — multi-provider ──────────────────────────────

describe("multi-provider — executor routing", () => {
  it("routes to openai-compat when prefix is 'openai'", () => {
    const svc = makeServiceConfig({
      multiModelEnabled: true,
      providerKeys: { openai: "sk-test" },
    });
    const agent = makeAgentConfig({ executor: "openai:gpt-4o" });
    const result = resolveMultiProviderRoute(svc, agent);

    assert.equal(result.target, "openai-compat");
    assert.equal(result.prefix, "openai");
    assert.equal(result.modelName, "gpt-4o");
  });

  it("routes to openai-compat when prefix is 'grok'", () => {
    const svc = makeServiceConfig({
      multiModelEnabled: true,
      providerKeys: { xai: "xai-test" },
    });
    const agent = makeAgentConfig({ executor: "grok:grok-3" });
    const result = resolveMultiProviderRoute(svc, agent);

    assert.equal(result.target, "openai-compat");
    assert.equal(result.prefix, "grok");
    assert.equal(result.modelName, "grok-3");
  });

  it("routes to openai-compat when prefix is 'groq'", () => {
    const svc = makeServiceConfig({
      multiModelEnabled: true,
      providerKeys: { groq: "gsk-test" },
    });
    const agent = makeAgentConfig({ executor: "groq:llama-3.3-70b-versatile" });
    const result = resolveMultiProviderRoute(svc, agent);

    assert.equal(result.target, "openai-compat");
    assert.equal(result.prefix, "groq");
    assert.equal(result.modelName, "llama-3.3-70b-versatile");
  });

  it("routes to openai-compat when prefix is 'together'", () => {
    const svc = makeServiceConfig({
      multiModelEnabled: true,
      providerKeys: { together: "tog-test" },
    });
    const agent = makeAgentConfig({ executor: "together:meta-llama/Llama-3.3-70B-Instruct" });
    const result = resolveMultiProviderRoute(svc, agent);

    assert.equal(result.target, "openai-compat");
    assert.equal(result.modelName, "meta-llama/Llama-3.3-70B-Instruct");
  });

  it("routes to openai-compat when prefix is 'mistral'", () => {
    const svc = makeServiceConfig({
      multiModelEnabled: true,
      providerKeys: { mistral: "mis-test" },
    });
    const agent = makeAgentConfig({ executor: "mistral:mistral-large-latest" });
    const result = resolveMultiProviderRoute(svc, agent);

    assert.equal(result.target, "openai-compat");
    assert.equal(result.prefix, "mistral");
  });

  it("routes to gemini when prefix is 'gemini'", () => {
    const svc = makeServiceConfig({
      multiModelEnabled: true,
      providerKeys: { google: "AIza-test" },
    });
    const agent = makeAgentConfig({ executor: "gemini:gemini-2.5-flash" });
    const result = resolveMultiProviderRoute(svc, agent);

    assert.equal(result.target, "gemini");
    assert.equal(result.prefix, "gemini");
    assert.equal(result.modelName, "gemini-2.5-flash");
  });

  it("returns error for unknown prefix", () => {
    const svc = makeServiceConfig({ multiModelEnabled: true });
    const agent = makeAgentConfig({ executor: "anthropic:claude-opus-4-6" });
    const result = resolveMultiProviderRoute(svc, agent);

    assert.equal(result.target, "error");
    assert.ok(result.error?.includes("Unknown model provider"));
  });

  it("returns error when no API key configured for openai-compat provider", () => {
    const svc = makeServiceConfig({
      multiModelEnabled: true,
      providerKeys: {}, // no keys
    });
    const agent = makeAgentConfig({ executor: "openai:gpt-4o" });
    const result = resolveMultiProviderRoute(svc, agent);

    assert.equal(result.target, "error");
    assert.ok(result.error?.includes("No API key"));
  });

  it("returns error when no Google API key configured for gemini", () => {
    const svc = makeServiceConfig({
      multiModelEnabled: true,
      providerKeys: {}, // no keys
    });
    const agent = makeAgentConfig({ executor: "gemini:gemini-2.5-flash" });
    const result = resolveMultiProviderRoute(svc, agent);

    assert.equal(result.target, "error");
    assert.ok(result.error?.includes("No Google API key"));
  });

  it("falls back to claude when multiModelEnabled is false", () => {
    const svc = makeServiceConfig({
      multiModelEnabled: false,
      providerKeys: { openai: "sk-test" },
    });
    const agent = makeAgentConfig({ executor: "openai:gpt-4o" });
    const result = resolveMultiProviderRoute(svc, agent);

    assert.equal(result.target, "claude");
  });

  it("falls back to claude when executor is just 'claude'", () => {
    const svc = makeServiceConfig({
      multiModelEnabled: true,
      providerKeys: { openai: "sk-test" },
    });
    const agent = makeAgentConfig({ executor: "claude" });
    const result = resolveMultiProviderRoute(svc, agent);

    assert.equal(result.target, "claude");
  });

  it("handles model names with colons (e.g. together model paths)", () => {
    const svc = makeServiceConfig({
      multiModelEnabled: true,
      providerKeys: { together: "tog-test" },
    });
    const agent = makeAgentConfig({ executor: "together:org/model:variant" });
    const result = resolveMultiProviderRoute(svc, agent);

    assert.equal(result.target, "openai-compat");
    assert.equal(result.modelName, "org/model:variant");
  });
});
