import express from "express";
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync, unlinkSync, chmodSync, rmSync, openSync, readSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, basename, dirname, extname, relative, isAbsolute } from "node:path";
import { execSync, spawn as cpSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { AppConfig } from "./config.js";
import { getPersonalAgentsDir, getPersonalRegistryDir, getSharedAgentsDir, isServerMode } from "./config.js";
import type { InboundMessage } from "./channels/types.js";
import type { ResolvedRoute } from "./router.js";
import { executeAgent, executeAgentStreaming, handleRelogin, initEncryptionSecret } from "./executor.js";
import { getEncryptionMode, hasMasterPassword, getEncryptionSecret, setMasterPassword as kcSetMasterPassword, clearMasterPassword as kcClearMasterPassword, getOrCreateMachineKey } from "./os-keychain.js";
import { countKeyFiles, encryptDir, reEncryptDir, createExportBundle, importExportBundle, encryptAuto, decryptAuto } from "./keystore.js";
import { executeGoal } from "./goals.js";
import { executeHeartbeat, loadHeartbeatHistory } from "./heartbeat.js";
import { executeWikiSync, getWikiSyncHistory } from "./wiki-sync.js";
import { createGymRouter } from "./gym/gym-router.js";
import { startActivityDigest } from "./gym/activity-digest.js";
import type { McpServerConfig } from "./config.js";
import { log } from "./logger.js";
import { isSharedAgentsAllowed, filterTemplatesByLicense, isTemplateAccessible, getTemplateAccess } from "./license.js";
import { buildVoiceRegistry, type VoiceRegistry } from "./voice/registry.js";

interface WebUIOptions {
  config: AppConfig;
  baseDir: string;
  dataDir?: string; // where config.json lives (defaults to baseDir)
  port: number;
  webhookSecret?: string;
  onWebhookMessage?: (agentId: string, text: string, channel: string, chatId: string) => Promise<void>;
  driverMap?: Map<string, import("./channels/types.js").ChannelDriver>;
  /**
   * Optional hook invoked just before app.listen() so callers can attach
   * additional routes (e.g. the /mcp Streamable HTTP endpoint) to the same
   * Express app / port.
   */
  attachExtraRoutes?: (app: import("express").Express) => void;
}

// ─── Job Store (event buffer for reconnectable streaming) ────────────
interface StreamJob {
  events: Array<{ idx: number; data: string }>;
  rawLines: string[]; // raw stdout/stderr lines (unparsed)
  rawListeners: Set<(idx: number) => void>;
  done: boolean;
  stopped: boolean;
  createdAt: number;
  listeners: Set<(idx: number) => void>; // notify waiting SSE connections
  abort?: AbortController; // used to kill the child process on Stop
}
const jobStore = new Map<string, StreamJob>();
// Track last-used Claude account per agent (for web UI dropdown switching)
const agentLastAccount = new Map<string, string>();

// Cleanup stale jobs every 60s (keep for 10 min after done)
setInterval(() => {
  const cutoff = Date.now() - 600_000;
  for (const [id, job] of jobStore) {
    if (job.done && job.createdAt < cutoff) jobStore.delete(id);
  }
}, 60_000);

export function startWebUI(opts: WebUIOptions): void {
  const app = express();
  app.use(express.json());

  // ─── Serve static assets (SVGs, images, etc.) from public/ ─────
  const publicDir = join(opts.baseDir, "public");
  app.use(express.static(publicDir, {
    maxAge: "1h",
    index: false,
    extensions: ["svg", "png", "ico", "jpg", "jpeg", "gif", "webp", "js", "css"],
  }));

  // Helper: serve an HTML page from public/ using readFileSync + res.send
  // Bypasses Express 5 send module's realpath resolution which fails on
  // macOS npx cache symlinked paths. HTML files are small enough that
  // readFileSync has no meaningful performance impact.
  const servePage = (res: any, filename: string, fallback: string | null = null) => {
    const filePath = join(publicDir, filename);
    if (existsSync(filePath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      try {
        let content = readFileSync(filePath, "utf8");
        // Inject Work/AI Gym nav toggle on pages with a topbar (skip home2, gym, mini, docs)
        const skipToggle = ["home2.html", "gym.html", "mini.html", "mcp-docs.html", "api-docs.html"];
        if (!skipToggle.includes(filename) && content.includes('class="topbar"')) {
          content = content.replace("</body>", '<script src="/nav-toggle.js"></script></body>');
        }
        res.type("html").send(content);
      } catch {
        if (!res.headersSent) {
          if (fallback) res.redirect(fallback);
          else res.status(404).send(`${filename} not found.`);
        }
      }
    } else if (fallback) {
      res.redirect(fallback);
    } else {
      res.status(404).send(`${filename} not found.`);
    }
  };

  // ─── Mount Gym API routes (gated by gymEnabled in the router) ────
  if ((opts.config.service as any).gymEnabled) {
    const gymAgent = opts.config.agents?.gym;
    const gymMemDir = gymAgent?.memoryDir;
    const gymRepoDir = join(opts.baseDir, "agents", "platform", "gym");
    const gymUserProgramsDir = gymMemDir ? join(gymMemDir, "..", "programs") : undefined;
    app.use(createGymRouter(opts.baseDir, {
      memoryDir: gymMemDir || undefined,
      programsDir: join(gymRepoDir, "programs"),
      userProgramsDir: gymUserProgramsDir,
    }));
  }

  // ─── Serve pages from public/ ─────────────────────────────────────
  const serverMode = isServerMode();
  // Mobile UA detection: phones get the mobile chat page unless they pass ?desktop=1
  const isMobileUA = (ua: string) => /Android.*Mobile|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua || "");
  const maybeRedirectMobile = (req: any, res: any, next: () => void) => {
    if (req.query?.desktop === "1") return next();
    if (isMobileUA(req.headers["user-agent"] || "")) return res.redirect("/ui");
    next();
  };
  const serveHome = (_req: any, res: any) => servePage(res, "home2.html", "/org");
  // Server mode: landing page is the Library (resource center)
  app.get("/", maybeRedirectMobile, serverMode ? (_req: any, res: any) => servePage(res, "library.html") : serveHome);
  app.get("/home", serveHome);
  app.get("/home-legacy", (_req, res) => servePage(res, "home.html", "/org"));
  app.get("/home2", (_req, res) => servePage(res, "home2.html", "/"));
  app.get("/activity", (_req, res) => res.redirect("/admin?tab=activity"));
  app.get("/ui", (_req, res) => servePage(res, "index.html"));
  app.get("/library", (_req, res) => servePage(res, "library.html", "/marketplace"));
  app.get("/marketplace", (_req, res) => servePage(res, "marketplace.html"));
  app.get("/org", (_req, res) => servePage(res, "org.html"));
  app.get("/monitor", (_req, res) => servePage(res, "monitor.html"));
  app.get("/admin", (_req, res) => servePage(res, "admin.html"));
  app.get("/channels", (_req, res) => res.redirect("/admin?tab=channels"));
  app.get("/tasks", (_req, res) => servePage(res, "tasks.html"));
  app.get("/projects", (_req, res) => servePage(res, "projects.html"));
  app.get("/boards", (_req, res) => servePage(res, "boards.html"));
  app.get("/lab", (_req, res) => servePage(res, "lab.html"));
  app.get("/agent-dashboard", (_req, res) => servePage(res, "agent-dashboard.html", "/org"));
  app.get("/mini", (_req, res) => servePage(res, "mini.html"));
  app.get("/m", (_req, res) => servePage(res, "m.html"));
  app.get("/settings", (_req, res) => res.redirect("/admin?tab=settings"));
  app.get("/mcp-docs", (_req, res) => servePage(res, "mcp-docs.html"));
  app.get("/api-docs", (_req, res) => servePage(res, "api-docs.html"));
  // Individual agent pages — serves the same chat UI; client JS switches to "resume sidebar" mode.
  app.get("/a/:agentId", (_req, res) => servePage(res, "index.html"));

  // ─── Auth System — API Keys ──────────────────────────────────────────
  // Auth is only active when service.auth.enabled is true (default: false).
  // When disabled, all API routes are open — personal gateway behavior unchanged.
  //
  // v1: API keys with "*" scope (full access). Scoped keys are a future enhancement.
  // Legacy auth.tokens[] still work for backcompat; they're auto-migrated to apiKeys
  // on first successful match so existing deployments keep working.

  function getAuthConfig() {
    return (opts.config.service as any).auth as { enabled?: boolean; tokens?: string[]; webPassword?: string } | undefined;
  }

  function getApiKeys(): import("./config.js").ApiKey[] {
    return ((opts.config.service as any).apiKeys as import("./config.js").ApiKey[]) || [];
  }

  // Generate a new API key secret — prefixed for recognizability.
  function generateApiKeySecret(): string {
    return "mai41team_" + randomBytes(32).toString("hex");
  }

  // Short opaque id used to reference a key in URLs (never the secret itself).
  function generateApiKeyId(): string {
    return "key_" + randomBytes(6).toString("hex");
  }

  // Show only the first 14 + last 4 chars of the key in list responses
  function previewKey(key: string): string {
    if (!key || key.length < 20) return key;
    return `${key.slice(0, 14)}...${key.slice(-4)}`;
  }

  // Persist the current in-memory config to disk.
  function saveConfigToDisk(): void {
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      if (!rawConfig.service) rawConfig.service = {};
      rawConfig.service.apiKeys = (opts.config.service as any).apiKeys || [];
      rawConfig.service.teamGateways = (opts.config.service as any).teamGateways || [];
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
    } catch (err) {
      log.warn(`Failed to persist config changes: ${err}`);
    }
  }

  // Match a bearer token against apiKeys[] (preferred) or legacy auth.tokens[].
  // Returns the matching ApiKey record if any, else null.
  function matchToken(token: string | null): import("./config.js").ApiKey | null {
    if (!token) return null;
    const keys = getApiKeys();
    for (const k of keys) {
      if (k.key === token) return k;
    }
    // Legacy fallback: auth.tokens[] (pre-apiKeys installations)
    const authCfg = getAuthConfig();
    if (authCfg?.tokens?.includes(token)) {
      // Synthesize a virtual ApiKey record so callers still get a reference
      return { id: "legacy", name: "Legacy Token", key: token, createdAt: new Date(0).toISOString(), scopes: ["*"] };
    }
    return null;
  }

  function authMiddleware(req: any, res: any, next: any) {
    const authCfg = getAuthConfig();
    if (!authCfg?.enabled) return next(); // auth disabled — open access (default)
    // Skip auth for login and status endpoints themselves
    if (req.path === "/auth/login" || req.path === "/auth/status") return next();
    // Check Bearer token in Authorization header
    const authHeader = req.headers.authorization as string | undefined;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const matched = matchToken(token);
    if (matched) {
      // Stamp lastUsedAt on real API keys (skip the synthesized legacy record)
      if (matched.id !== "legacy") {
        matched.lastUsedAt = new Date().toISOString();
      }
      (req as any).apiKey = matched;
      return next();
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Apply auth middleware to all /api/* routes
  app.use("/api", authMiddleware);

  // Role-based access: "read" keys can only GET (browse). Blocked from mutations + chat.
  // Paths that read-only keys ARE allowed: GET on any endpoint, plus auth endpoints.
  function requireFullAccess(req: any, res: any, next: any) {
    const authCfg = getAuthConfig();
    if (!authCfg?.enabled) return next(); // auth disabled — no restrictions
    const apiKey = (req as any).apiKey as import("./config.js").ApiKey | undefined;
    if (!apiKey) return next(); // no key (handled by authMiddleware already)
    if ((apiKey.role || "full") === "read") {
      return res.status(403).json({ error: "Read-only access — this action requires a full-access key" });
    }
    return next();
  }

  // Apply write protection: POST/PUT/PATCH/DELETE on /api/* require full role,
  // except auth endpoints (login, status) which are always open.
  app.use("/api", (req: any, res: any, next: any) => {
    // Allow all GET/HEAD/OPTIONS requests (browsing)
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    // Allow auth endpoints (login needs POST)
    if (req.path.startsWith("/auth/")) return next();
    // Everything else requires full access
    return requireFullAccess(req, res, next);
  });

  // POST /api/auth/login — accepts password, returns a Bearer API key
  app.post("/api/auth/login", (req, res) => {
    const authCfg = getAuthConfig();
    if (!authCfg?.enabled) return res.json({ ok: true, token: null, authEnabled: false, role: "full" });
    const { password } = req.body as any;
    if (!authCfg.webPassword || password !== authCfg.webPassword) {
      return res.status(401).json({ error: "Invalid password" });
    }
    // Prefer the first apiKey; fall back to legacy auth.tokens[0]
    const keys = getApiKeys();
    const firstKey = keys[0];
    const token = firstKey?.key || authCfg.tokens?.[0];
    if (!token) return res.status(500).json({ error: "No API key configured" });
    return res.json({ ok: true, token, role: firstKey?.role || "full" });
  });

  // GET /api/auth/status — returns auth state (used by web UI on page load)
  app.get("/api/auth/status", (req, res) => {
    const authCfg = getAuthConfig();
    const authEnabled = !!(authCfg?.enabled);
    if (!authEnabled) return res.json({ authEnabled: false, authenticated: true, role: "full" });
    const authHeader = req.headers.authorization as string | undefined;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const matched = matchToken(token);
    if (!matched) return res.json({ authEnabled: true, authenticated: false });
    return res.json({ authEnabled: true, authenticated: true, role: matched.role || "full", email: matched.email || null });
  });

  // Guard: /api/auth/keys/* is the issuance surface — meaningful only when this
  // install is acting as a shared gateway. Mirror the UI gating on the backend
  // so a curl-wielding client can't sidestep the toggle.
  function requireSharedAgents(_req: any, res: any, next: any) {
    // Server mode (Railway/container) is always a shared gateway.
    const enabled = isServerMode() || !!((opts.config.service as any).sharedAgentsEnabled);
    if (!enabled) {
      return res.status(403).json({ error: "Shared Agents feature is disabled" });
    }
    next();
  }
  app.use("/api/auth/keys", requireSharedAgents);

  // GET /api/auth/keys — list API keys (secret never returned, only preview)
  app.get("/api/auth/keys", (_req, res) => {
    const keys = getApiKeys();
    const out = keys.map(k => ({
      id: k.id,
      name: k.name,
      preview: previewKey(k.key),
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      scopes: k.scopes,
      email: k.email || null,
      role: k.role || "full",
    }));
    // Opportunistic flush so lastUsedAt updates get persisted when admin views the page
    saveConfigToDisk();
    return res.json({ keys: out });
  });

  // POST /api/auth/keys {name, email?, role?} — create a new key; returns the full secret ONCE
  app.post("/api/auth/keys", (req, res) => {
    const { name, email, role } = req.body as { name?: string; email?: string; role?: string };
    const label = (name || "").trim();
    if (!label) return res.status(400).json({ error: "name is required" });
    const keyRole = role === "read" ? "read" : "full";
    const keys = getApiKeys();
    const apiKey: import("./config.js").ApiKey = {
      id: generateApiKeyId(),
      name: label,
      key: generateApiKeySecret(),
      createdAt: new Date().toISOString(),
      scopes: ["*"],
      email: (email || "").trim() || undefined,
      role: keyRole,
    };
    keys.push(apiKey);
    (opts.config.service as any).apiKeys = keys;
    saveConfigToDisk();
    // Return the full key — only time it'll ever be shown
    return res.json({ ok: true, key: apiKey });
  });

  // DELETE /api/auth/keys/:id — revoke a key
  app.delete("/api/auth/keys/:id", (req, res) => {
    const id = req.params.id;
    const keys = getApiKeys();
    const idx = keys.findIndex(k => k.id === id);
    if (idx < 0) return res.status(404).json({ error: "Key not found" });
    // Prevent locking yourself out: refuse to delete the last remaining key
    if (keys.length === 1) {
      return res.status(400).json({ error: "Cannot delete the last API key — create another first" });
    }
    const removed = keys.splice(idx, 1)[0];
    (opts.config.service as any).apiKeys = keys;
    saveConfigToDisk();
    return res.json({ ok: true, id: removed.id });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ─── Team Gateways ─────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  //
  // A Team Gateway is a remote MyAIforOne deployment (e.g. Railway) that this
  // local install connects to via its HTTP MCP endpoint. Connecting a gateway
  // registers an MCP in config.mcps, writes the API key to mcp-keys/, and
  // auto-assigns the MCP to the Hub agent.

  function getTeamGateways(): import("./config.js").TeamGateway[] {
    return ((opts.config.service as any).teamGateways as import("./config.js").TeamGateway[]) || [];
  }

  // Slugify a display name into an id safe for filesystem + MCP registry use.
  function slugifyGatewayId(name: string): string {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || "team-gateway";
  }

  // Env var name for a gateway's API key in the mcp-keys .env file.
  function gatewayEnvVarName(id: string): string {
    return "TEAM_" + id.toUpperCase().replace(/[^A-Z0-9]/g, "_") + "_KEY";
  }

  // MCP name as it appears in config.mcps and on hub's mcps list.
  function gatewayMcpName(id: string): string {
    return "team-" + id;
  }

  // Write the API key + URL to mcp-keys/{mcpName}.env under the gateway data dir.
  // These become env vars on the stdio MCP child process (via executor.ts key loader):
  //   MYAGENT_API_URL   — so api-client.ts targets the remote gateway
  //   MYAGENT_API_TOKEN — so api-client.ts sends the Bearer header (added earlier)
  // The TEAM_<ID>_KEY var is kept as an alias so operators can cross-reference the
  // gateway by id in logs/grep without exposing MYAGENT_API_TOKEN directly.
  function writeGatewayKeyFile(id: string, apiKey: string, url: string): void {
    // Write to PersonalAgents/mcp-keys/ (primary) — keys belong in the Drive, not the repo
    const paDir = getPersonalAgentsDir(opts.config);
    const resolvedPaDir = paDir.startsWith("~") ? paDir.replace("~", homedir()) : paDir;
    const keysDir = join(resolvedPaDir, "mcp-keys");
    mkdirSync(keysDir, { recursive: true });
    const mcpName = gatewayMcpName(id);
    const envPath = join(keysDir, `${mcpName}.env`);
    const encPath = envPath + ".enc";
    const envVarName = gatewayEnvVarName(id);
    const trimmedUrl = (url || "").replace(/\/$/, "");
    const contents = [
      `# Team Gateway: ${id}`,
      `MYAGENT_API_URL=${trimmedUrl}`,
      `MYAGENT_API_TOKEN=${apiKey}`,
      `${envVarName}=${apiKey}`,
      "",
    ].join("\n");

    // Encrypt on write
    try {
      const secret = getEncryptionSecret();
      const encrypted = encryptAuto(contents, secret);
      writeFileSync(encPath, encrypted);
      writeFileSync(envPath, `# Encrypted — see ${mcpName}.env.enc\n`);
    } catch {
      writeFileSync(envPath, contents);
    }
  }

  // Remove the gateway's key file on disconnect.
  function removeGatewayKeyFile(id: string): void {
    const paDir = getPersonalAgentsDir(opts.config);
    const resolvedPaDir = paDir.startsWith("~") ? paDir.replace("~", homedir()) : paDir;
    const envPath = join(resolvedPaDir, "mcp-keys", `${gatewayMcpName(id)}.env`);
    if (existsSync(envPath)) {
      try { unlinkSync(envPath); } catch { /* ignore */ }
    }
    // Also clean up legacy location
    const legacyPath = join(opts.baseDir, "data", "mcp-keys", `${gatewayMcpName(id)}.env`);
    if (existsSync(legacyPath)) {
      try { unlinkSync(legacyPath); } catch { /* ignore */ }
    }
  }

  // Register the gateway as a STDIO MCP in config.mcps.
  // We reuse the bundled MCP binary pointed at the remote gateway via env vars
  // (MYAGENT_API_URL + MYAGENT_API_TOKEN loaded from mcp-keys/<mcpName>.env at
  // execution time by executor.ts). This works today — no remote /mcp endpoint
  // required on the target gateway. Future enhancement: if the remote gateway
  // exposes /mcp we can switch type to "http" to avoid the local spawn.
  function registerGatewayMcp(gw: import("./config.js").TeamGateway): void {
    const name = gatewayMcpName(gw.id);
    if (!opts.config.mcps) opts.config.mcps = {};
    const mcpBinary = join(opts.baseDir, "server", "mcp-server", "dist", "index.js");
    opts.config.mcps[name] = {
      type: "stdio",
      command: "node",
      args: [mcpBinary],
      // env values come from mcp-keys/<mcpName>.env at spawn time (see executor.ts)
      env: {},
    } as any;
  }

  // Remove the MCP entry when gateway is disconnected.
  function unregisterGatewayMcp(id: string): void {
    if (!opts.config.mcps) return;
    delete opts.config.mcps[gatewayMcpName(id)];
  }

  // Auto-assign the new MCP to the Hub agent so it can invoke team gateway tools.
  function assignGatewayMcpToHub(id: string): void {
    const hub = opts.config.agents?.["hub"];
    if (!hub) return; // no hub agent; nothing to do
    const mcpName = gatewayMcpName(id);
    if (!hub.mcps) hub.mcps = [];
    if (!hub.mcps.includes(mcpName)) hub.mcps.push(mcpName);
  }

  // Remove the MCP from Hub on disconnect (also from any other agents that had it).
  function detachGatewayMcpFromAgents(id: string): void {
    const mcpName = gatewayMcpName(id);
    for (const agent of Object.values(opts.config.agents || {})) {
      if (agent.mcps) agent.mcps = agent.mcps.filter(m => m !== mcpName);
    }
  }

  // Persist agents/mcps changes back to config.json.
  function persistFullConfig(): void {
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      if (!rawConfig.service) rawConfig.service = {};
      rawConfig.service.apiKeys = (opts.config.service as any).apiKeys || [];
      rawConfig.service.teamGateways = (opts.config.service as any).teamGateways || [];
      if (opts.config.mcps) rawConfig.mcps = opts.config.mcps;
      if (opts.config.agents) rawConfig.agents = opts.config.agents;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
    } catch (err) {
      log.warn(`Failed to persist config changes: ${err}`);
    }
  }

  // Probe a remote gateway's /api/capabilities to validate URL + API key.
  async function probeGateway(url: string, apiKey: string): Promise<{ ok: boolean; status?: number; platform?: string; sharedAgents?: boolean; error?: string }> {
    const trimmed = url.replace(/\/$/, "");
    try {
      const r = await fetch(`${trimmed}/api/capabilities`, {
        headers: { "Authorization": `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (r.status === 401) return { ok: false, status: 401, error: "Unauthorized — API key rejected" };
      if (!r.ok) return { ok: false, status: r.status, error: `HTTP ${r.status}` };
      const data: any = await r.json();
      return { ok: true, status: r.status, platform: data.platform, sharedAgents: !!data?.features?.sharedAgents };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  // GET /api/team-gateways — list connected gateways
  app.get("/api/team-gateways", (_req, res) => {
    const gws = getTeamGateways();
    return res.json({ gateways: gws });
  });

  // POST /api/team-gateways/test {url, apiKey} — validate before save
  app.post("/api/team-gateways/test", async (req, res) => {
    const { url, apiKey } = req.body as { url?: string; apiKey?: string };
    if (!url || !apiKey) return res.status(400).json({ error: "url and apiKey are required" });
    const r = await probeGateway(url, apiKey);
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error, status: r.status });
    return res.json({ ok: true, platform: r.platform, sharedAgents: r.sharedAgents });
  });

  // POST /api/team-gateways {name, url, apiKey} — save + auto-register MCP + auto-assign to hub
  app.post("/api/team-gateways", async (req, res) => {
    const { name, url, apiKey } = req.body as { name?: string; url?: string; apiKey?: string };
    const label = (name || "").trim();
    const trimmedUrl = (url || "").trim().replace(/\/$/, "");
    const key = (apiKey || "").trim();
    if (!label || !trimmedUrl || !key) return res.status(400).json({ error: "name, url, and apiKey are required" });

    // Probe before saving (don't save broken connections)
    const probe = await probeGateway(trimmedUrl, key);
    if (!probe.ok) return res.status(400).json({ error: probe.error || "Connection test failed", status: probe.status });

    // Derive a unique id from the name
    const baseId = slugifyGatewayId(label);
    const existing = getTeamGateways();
    if (existing.some(g => g.id === baseId)) {
      return res.status(409).json({ error: `A team gateway with id "${baseId}" already exists. Choose a different name.` });
    }

    const gw: import("./config.js").TeamGateway = {
      id: baseId,
      name: label,
      url: trimmedUrl,
      addedAt: new Date().toISOString(),
      lastStatus: "ok",
      lastStatusAt: new Date().toISOString(),
    };

    // 1. Write API key + URL to mcp-keys/team-{id}.env
    writeGatewayKeyFile(baseId, key, trimmedUrl);
    // 2. Register as stdio MCP (remote gateway URL wired via env vars in .env file)
    registerGatewayMcp(gw);
    // 3. Auto-assign to Hub
    assignGatewayMcpToHub(baseId);
    // 4. Save metadata
    const updated = [...existing, gw];
    (opts.config.service as any).teamGateways = updated;
    persistFullConfig();

    return res.json({ ok: true, gateway: gw });
  });

  // POST /api/team-gateways/:id/resync — re-test the connection and update status
  app.post("/api/team-gateways/:id/resync", async (req, res) => {
    const id = req.params.id;
    const gws = getTeamGateways();
    const gw = gws.find(g => g.id === id);
    if (!gw) return res.status(404).json({ error: "Gateway not found" });

    // Read the key back to test the connection
    const key = readGatewayKey(id);
    if (!key) {
      gw.lastStatus = "error";
      gw.lastStatusMessage = "API key file missing";
      gw.lastStatusAt = new Date().toISOString();
      persistFullConfig();
      return res.status(400).json({ status: "error", error: gw.lastStatusMessage });
    }
    const probe = await probeGateway(gw.url, key);
    gw.lastStatus = probe.ok ? "ok" : (probe.status === 401 ? "unauthorized" : (probe.error ? "offline" : "error"));
    gw.lastStatusMessage = probe.error;
    gw.lastStatusAt = new Date().toISOString();
    persistFullConfig();
    return res.json({ status: gw.lastStatus, platform: probe.platform, sharedAgents: probe.sharedAgents });
  });

  // Helper: read the API key back from the mcp-keys .env file for a gateway id.
  // Checks Drive first, then legacy data/mcp-keys/. Decrypts .enc files if needed.
  function readGatewayKey(id: string): string {
    const _pa = getPersonalAgentsDir(opts.config);
    const _resolvedPa = _pa.startsWith("~") ? _pa.replace("~", homedir()) : _pa;
    const mcpName = gatewayMcpName(id);
    const dirs = [
      join(_resolvedPa, "mcp-keys"),
      join(opts.baseDir, "data", "mcp-keys"),
    ];
    for (const dir of dirs) {
      // Try encrypted file first
      const encPath = join(dir, `${mcpName}.env.enc`);
      if (existsSync(encPath)) {
        try {
          const secret = getEncryptionSecret();
          const data = readFileSync(encPath);
          const content = decryptAuto(data, secret);
          const m = content.match(/^MYAGENT_API_TOKEN=(.+)$/m);
          if (m) return m[1].trim();
          const alias = content.match(new RegExp(`^${gatewayEnvVarName(id)}=(.+)$`, "m"));
          if (alias) return alias[1].trim();
        } catch { /* try next */ }
      }
      // Try plaintext
      const envPath = join(dir, `${mcpName}.env`);
      if (existsSync(envPath)) {
        try {
          const content = readFileSync(envPath, "utf-8");
          if (content.includes("# Encrypted")) continue;
          const m = content.match(/^MYAGENT_API_TOKEN=(.+)$/m);
          if (m) return m[1].trim();
          const alias = content.match(new RegExp(`^${gatewayEnvVarName(id)}=(.+)$`, "m"));
          if (alias) return alias[1].trim();
        } catch { continue; }
      }
    }
    return "";
  }

  // Helper: list local agent ids whose `mcps` array includes a given MCP name.
  function agentsWithMcp(mcpName: string): string[] {
    const out: string[] = [];
    for (const [id, agent] of Object.entries(opts.config.agents || {})) {
      if (Array.isArray((agent as any).mcps) && (agent as any).mcps.includes(mcpName)) {
        out.push(id);
      }
    }
    return out;
  }

  // GET /api/team-gateways/all-remote-agents — aggregate agents from ALL connected gateways
  // IMPORTANT: Must be registered BEFORE /:id to avoid Express treating "all-remote-agents" as an id
  app.get("/api/team-gateways/all-remote-agents", async (_req, res) => {
    const gws = getTeamGateways().filter(g => g.lastStatus === "ok");
    const results = await Promise.allSettled(
      gws.map(async gw => {
        const r = await gatewayFetch(gw.id, "/api/agents");
        if (!r.ok) return [];
        const data = await r.json() as any;
        return (data.agents || []).map((a: any) => ({
          ...a,
          _remote: true,
          _gatewayId: gw.id,
          _gatewayName: gw.name,
          _gatewayUrl: gw.url,
        }));
      })
    );
    const allAgents = results
      .filter((r): r is PromiseFulfilledResult<any[]> => r.status === "fulfilled")
      .flatMap(r => r.value);
    return res.json({ agents: allAgents });
  });

  // GET /api/team-gateways/all-remote-library/:type — aggregate from ALL gateways
  // IMPORTANT: Must be registered BEFORE /:id
  app.get("/api/team-gateways/all-remote-library/:type", async (req, res) => {
    const { type } = req.params;
    const validTypes = ["skills", "mcps", "prompts", "apps", "templates"];
    if (!validTypes.includes(type)) return res.status(400).json({ error: `Invalid type` });
    const gws = getTeamGateways().filter(g => g.lastStatus === "ok");
    const results = await Promise.allSettled(
      gws.map(async gw => {
        // Templates use /api/templates, everything else uses /api/marketplace/{type}
        const endpoint = type === "templates" ? `/api/templates` : `/api/marketplace/${type}?source=personal`;
        const r = await gatewayFetch(gw.id, endpoint);
        if (!r.ok) return [];
        const data = await r.json() as any;
        return (data.templates || data.items || data.skills || data.mcps || data.prompts || data.apps || []).map((item: any) => ({
          ...item,
          _remote: true,
          _gatewayId: gw.id,
          _gatewayName: gw.name,
        }));
      })
    );
    const allItems = results
      .filter((r): r is PromiseFulfilledResult<any[]> => r.status === "fulfilled")
      .flatMap(r => r.value);
    return res.json({ items: allItems });
  });

  // GET /api/team-gateways/:id — full record + derived attached agents.
  // Drives the per-gateway Configure modal.
  app.get("/api/team-gateways/:id", (req, res) => {
    const id = req.params.id;
    const gw = getTeamGateways().find(g => g.id === id);
    if (!gw) return res.status(404).json({ error: "Gateway not found" });
    const mcpName = gatewayMcpName(id);
    return res.json({
      gateway: gw,
      mcpName,
      attachedAgents: agentsWithMcp(mcpName),
    });
  });

  // GET /api/team-gateways/:id/key-preview — masked rendering data only.
  // Safe to call on every modal open; returns just prefix + last 4 chars.
  app.get("/api/team-gateways/:id/key-preview", (req, res) => {
    const id = req.params.id;
    const gw = getTeamGateways().find(g => g.id === id);
    if (!gw) return res.status(404).json({ error: "Gateway not found" });
    const key = readGatewayKey(id);
    if (!key) return res.json({ prefix: "", last4: "", present: false });
    const underscoreIdx = key.indexOf("_");
    const prefix = underscoreIdx > 0 ? key.slice(0, underscoreIdx + 1) : "";
    const last4 = key.length >= 4 ? key.slice(-4) : key;
    return res.json({ prefix, last4, present: true });
  });

  // GET /api/team-gateways/:id/key-reveal — full plaintext key.
  // Called explicitly via a Reveal/Copy action — never on modal open.
  app.get("/api/team-gateways/:id/key-reveal", (req, res) => {
    const id = req.params.id;
    const gw = getTeamGateways().find(g => g.id === id);
    if (!gw) return res.status(404).json({ error: "Gateway not found" });
    const key = readGatewayKey(id);
    if (!key) return res.status(404).json({ error: "Key file missing for this gateway" });
    return res.json({ apiKey: key });
  });

  // PATCH /api/team-gateways/:id { name } — rename the display label.
  // Id stays immutable (changing the id would require rewriting mcp-keys +
  // every agent's mcps array + the MCP registry name, which is a disconnect+reconnect flow).
  app.patch("/api/team-gateways/:id", (req, res) => {
    const id = req.params.id;
    const gws = getTeamGateways();
    const gw = gws.find(g => g.id === id);
    if (!gw) return res.status(404).json({ error: "Gateway not found" });
    const { name } = req.body as { name?: string };
    const label = (name || "").trim();
    if (!label) return res.status(400).json({ error: "name is required" });
    gw.name = label;
    (opts.config.service as any).teamGateways = gws;
    persistFullConfig();
    return res.json({ ok: true, gateway: gw });
  });

  // POST /api/team-gateways/:id/rotate-key { apiKey } — swap the API key used
  // to reach this gateway. We probe the new key against the existing URL first
  // and refuse to overwrite the .env file if it fails — so the old key stays
  // intact on bad rotate input.
  app.post("/api/team-gateways/:id/rotate-key", async (req, res) => {
    const id = req.params.id;
    const gws = getTeamGateways();
    const gw = gws.find(g => g.id === id);
    if (!gw) return res.status(404).json({ error: "Gateway not found" });
    const { apiKey } = req.body as { apiKey?: string };
    const newKey = (apiKey || "").trim();
    if (!newKey) return res.status(400).json({ error: "apiKey is required" });

    const probe = await probeGateway(gw.url, newKey);
    if (!probe.ok) {
      // Do NOT touch the existing key file. Report the error verbatim so the
      // UI can surface it in the Rotate inline form.
      return res.status(400).json({ error: probe.error || "New key failed connection test", status: probe.status });
    }
    // Overwrite the .env file + refresh status.
    writeGatewayKeyFile(id, newKey, gw.url);
    gw.lastStatus = "ok";
    gw.lastStatusMessage = undefined;
    gw.lastStatusAt = new Date().toISOString();
    (opts.config.service as any).teamGateways = gws;
    persistFullConfig();
    return res.json({ ok: true, status: gw.lastStatus, gateway: gw });
  });

  // POST /api/team-gateways/:id/attach { agentId } — give an additional local
  // agent access to this gateway's MCP. Idempotent: attaching twice = same state.
  app.post("/api/team-gateways/:id/attach", (req, res) => {
    const id = req.params.id;
    const gw = getTeamGateways().find(g => g.id === id);
    if (!gw) return res.status(404).json({ error: "Gateway not found" });
    const { agentId } = req.body as { agentId?: string };
    const aid = (agentId || "").trim();
    if (!aid) return res.status(400).json({ error: "agentId is required" });
    const agent = opts.config.agents?.[aid];
    if (!agent) return res.status(404).json({ error: `Agent '${aid}' not found` });
    const mcpName = gatewayMcpName(id);
    if (!agent.mcps) agent.mcps = [];
    if (!agent.mcps.includes(mcpName)) agent.mcps.push(mcpName);
    persistFullConfig();
    return res.json({ ok: true, agentId: aid, mcps: agent.mcps, attachedAgents: agentsWithMcp(mcpName) });
  });

  // POST /api/team-gateways/:id/detach { agentId } — revoke a local agent's
  // access to this gateway's MCP. Refuses to leave the gateway orphaned: if
  // the caller is trying to remove the last attached agent we reject with 400
  // so the user has to disconnect the whole gateway instead.
  app.post("/api/team-gateways/:id/detach", (req, res) => {
    const id = req.params.id;
    const gw = getTeamGateways().find(g => g.id === id);
    if (!gw) return res.status(404).json({ error: "Gateway not found" });
    const { agentId } = req.body as { agentId?: string };
    const aid = (agentId || "").trim();
    if (!aid) return res.status(400).json({ error: "agentId is required" });
    const agent = opts.config.agents?.[aid];
    if (!agent) return res.status(404).json({ error: `Agent '${aid}' not found` });
    const mcpName = gatewayMcpName(id);
    const current = agentsWithMcp(mcpName);
    // Orphan guard: if this agent is the last one holding the mcp, refuse.
    // Use Disconnect from the Team Gateways page to remove entirely.
    if (current.length <= 1 && current.includes(aid)) {
      return res.status(400).json({
        error: "Cannot detach the last attached agent — disconnect the gateway instead to remove it entirely.",
      });
    }
    if (agent.mcps) {
      agent.mcps = agent.mcps.filter(m => m !== mcpName);
    }
    persistFullConfig();
    return res.json({ ok: true, agentId: aid, mcps: agent.mcps || [], attachedAgents: agentsWithMcp(mcpName) });
  });

  // DELETE /api/team-gateways/:id — disconnect
  app.delete("/api/team-gateways/:id", (req, res) => {
    const id = req.params.id;
    const gws = getTeamGateways();
    const idx = gws.findIndex(g => g.id === id);
    if (idx < 0) return res.status(404).json({ error: "Gateway not found" });

    // 1. Remove from all agent mcp lists (including hub)
    detachGatewayMcpFromAgents(id);
    // 2. Remove MCP registry entry
    unregisterGatewayMcp(id);
    // 3. Remove mcp-keys file
    removeGatewayKeyFile(id);
    // 4. Remove metadata
    gws.splice(idx, 1);
    (opts.config.service as any).teamGateways = gws;
    persistFullConfig();
    return res.json({ ok: true, id });
  });

  // ─── API: Team Gateway Proxy (Unified Remote Experience) ────────────
  // These endpoints proxy requests to remote gateways so the local UI can
  // list remote agents, chat with them, browse their library, and download files.

  // Helper: make an authenticated fetch to a remote gateway
  async function gatewayFetch(gwId: string, path: string, init?: RequestInit & { timeout?: number }): Promise<Response> {
    const gw = getTeamGateways().find(g => g.id === gwId);
    if (!gw) throw new Error(`Gateway "${gwId}" not found`);
    const key = readGatewayKey(gwId);
    if (!key) throw new Error(`API key missing for gateway "${gwId}"`);
    const url = `${gw.url}${path}`;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${key}`,
      ...(init?.headers as Record<string, string> || {}),
    };
    return fetch(url, {
      ...init,
      headers,
      signal: init?.signal || AbortSignal.timeout(init?.timeout || 15000),
    });
  }

  // GET /api/team-gateways/:id/remote/agents — list agents on a remote gateway
  app.get("/api/team-gateways/:id/remote/agents", async (req, res) => {
    try {
      const r = await gatewayFetch(req.params.id, "/api/agents");
      if (!r.ok) return res.status(r.status).json({ error: `Remote returned ${r.status}` });
      const data = await r.json() as any;
      // Enrich each agent with gateway metadata
      const gw = getTeamGateways().find(g => g.id === req.params.id);
      const agents = (data.agents || []).map((a: any) => ({
        ...a,
        _remote: true,
        _gatewayId: req.params.id,
        _gatewayName: gw?.name || req.params.id,
        _gatewayUrl: gw?.url || "",
      }));
      return res.json({ agents });
    } catch (err: any) {
      return res.status(502).json({ error: err.message });
    }
  });

  // POST /api/team-gateways/:id/remote/chat — proxy a chat message to a remote agent
  // Returns a local jobId that streams the remote response back via SSE
  app.post("/api/team-gateways/:id/remote/chat/:agentId/stream", async (req, res) => {
    const { id: gwId, agentId } = req.params;
    const { text } = req.body as { text?: string };
    if (!text?.trim()) return res.status(400).json({ error: "Missing 'text' in body" });

    try {
      // Start streaming job on the remote gateway
      const startRes = await gatewayFetch(gwId, `/api/chat/${agentId}/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        timeout: 15000,
      });
      if (!startRes.ok) {
        const errBody = await startRes.text().catch(() => "");
        return res.status(startRes.status).json({ error: `Remote returned ${startRes.status}: ${errBody}` });
      }
      const { jobId: remoteJobId } = await startRes.json() as { jobId: string };

      // Create a local job that proxies the remote SSE stream
      const localJobId = `rjob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const job: StreamJob = { events: [], rawLines: [], rawListeners: new Set(), done: false, stopped: false, createdAt: Date.now(), listeners: new Set() };
      jobStore.set(localJobId, job);

      const pushEvent = (data: string) => {
        const idx = job.events.length;
        job.events.push({ idx, data });
        for (const cb of job.listeners) cb(idx);
      };

      res.json({ jobId: localJobId, remoteJobId });

      // Background: stream from remote and relay events locally
      (async () => {
        const heartbeat = setInterval(() => {
          if (!job.done && !job.stopped) pushEvent(JSON.stringify({ type: "heartbeat" }));
          else clearInterval(heartbeat);
        }, 30_000);

        try {
          const gw = getTeamGateways().find(g => g.id === gwId);
          const key = readGatewayKey(gwId);
          if (!gw || !key) throw new Error("Gateway or key unavailable");

          let lastEventId = 0;
          let retries = 0;
          const MAX_RETRIES = 10;

          while (!job.done && !job.stopped && retries < MAX_RETRIES) {
            try {
              const streamRes = await fetch(`${gw.url}/api/chat/jobs/${remoteJobId}/stream?after=${lastEventId}`, {
                headers: { "Authorization": `Bearer ${key}` },
                signal: AbortSignal.timeout(120_000),
              });
              if (!streamRes.ok || !streamRes.body) {
                retries++;
                continue;
              }

              const reader = streamRes.body.getReader();
              const decoder = new TextDecoder();
              let buffer = "";

              while (true) {
                const { done: rdDone, value } = await reader.read();
                if (rdDone) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                  if (line.startsWith("id: ")) {
                    lastEventId = parseInt(line.slice(4), 10) + 1;
                  } else if (line.startsWith("data: ")) {
                    const data = line.slice(6);
                    if (data === "[DONE]") {
                      pushEvent("[DONE]");
                      job.done = true;
                      break;
                    }
                    pushEvent(data);
                    retries = 0; // reset on success
                  }
                }
                if (job.done || job.stopped) break;
              }
            } catch (streamErr: any) {
              if (job.stopped) break;
              retries++;
              log.warn(`[GW Proxy] Retry ${retries}/${MAX_RETRIES} for remote job ${remoteJobId}: ${streamErr.message}`);
              await new Promise(r => setTimeout(r, 1000));
            }
          }
        } catch (err) {
          if (!job.stopped) pushEvent(JSON.stringify({ type: "error", data: String(err) }));
        } finally {
          clearInterval(heartbeat);
          if (!job.done) {
            pushEvent("[DONE]");
            job.done = true;
          }
        }
      })();
    } catch (err: any) {
      return res.status(502).json({ error: err.message });
    }
  });

  // ─── Tier 2: Remote Library Proxy ──────────────────────────────────

  // GET /api/team-gateways/:id/remote/library/:type — browse remote library
  // type: skills | mcps | prompts | apps
  app.get("/api/team-gateways/:id/remote/library/:type", async (req, res) => {
    const { id: gwId, type } = req.params;
    const validTypes = ["skills", "mcps", "prompts", "apps", "agents", "templates"];
    if (!validTypes.includes(type)) return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` });
    try {
      // Templates use /api/templates, everything else uses /api/marketplace/{type}
      const endpoint = type === "templates" ? `/api/templates` : `/api/marketplace/${type}?source=personal`;
      const r = await gatewayFetch(gwId, endpoint);
      if (!r.ok) return res.status(r.status).json({ error: `Remote returned ${r.status}` });
      const data = await r.json() as any;
      const gw = getTeamGateways().find(g => g.id === gwId);
      // Tag each item with gateway info
      const items = (data.templates || data.items || data.skills || data.mcps || data.prompts || data.apps || []).map((item: any) => ({
        ...item,
        _remote: true,
        _gatewayId: gwId,
        _gatewayName: gw?.name || gwId,
      }));
      return res.json({ items });
    } catch (err: any) {
      return res.status(502).json({ error: err.message });
    }
  });

  // POST /api/team-gateways/:id/remote/library/:type/:itemId/install — download + install locally
  app.post("/api/team-gateways/:id/remote/library/:type/:itemId/install", async (req, res) => {
    const { id: gwId, type, itemId } = req.params;
    const validTypes = ["skills", "mcps", "prompts", "templates"];
    if (!validTypes.includes(type)) return res.status(400).json({ error: `Can only install skills, mcps, prompts, or templates` });

    try {
      // Fetch the item detail from remote
      let content: string | null = null;
      let itemMeta: any = null;

      if (type === "skills") {
        // Get skill content from remote
        const r = await gatewayFetch(gwId, `/api/skills/${encodeURIComponent(itemId)}/content`);
        if (!r.ok) return res.status(r.status).json({ error: `Remote returned ${r.status}` });
        const data = await r.json() as any;
        content = data.content || data.body || "";
        itemMeta = data;
      } else if (type === "prompts") {
        const r = await gatewayFetch(gwId, `/api/marketplace/prompts`);
        if (!r.ok) return res.status(r.status).json({ error: `Remote returned ${r.status}` });
        const data = await r.json() as any;
        const items = data.items || [];
        itemMeta = items.find((i: any) => i.id === itemId);
        if (!itemMeta) return res.status(404).json({ error: "Item not found on remote" });
        content = itemMeta.template || itemMeta.content || "";
      }

      if (type === "skills" && content !== null) {
        // Write skill file to PersonalRegistry/skills/
        const skillsDir = join(opts.baseDir, "PersonalRegistry", "skills");
        mkdirSync(skillsDir, { recursive: true });
        const fileName = itemId.endsWith(".md") ? itemId : `${itemId}.md`;
        writeFileSync(join(skillsDir, fileName), content);
        return res.json({ ok: true, type, id: itemId, installed: true });
      }

      if (type === "prompts" && itemMeta) {
        // Write prompt to PersonalRegistry/prompts.json
        const promptsPath = join(opts.baseDir, "PersonalRegistry", "prompts.json");
        let prompts: any[] = [];
        if (existsSync(promptsPath)) {
          try { prompts = JSON.parse(readFileSync(promptsPath, "utf-8")); } catch { prompts = []; }
        }
        if (!prompts.find((p: any) => p.id === itemId)) {
          prompts.push(itemMeta);
          mkdirSync(dirname(promptsPath), { recursive: true });
          writeFileSync(promptsPath, JSON.stringify(prompts, null, 2));
        }
        return res.json({ ok: true, type, id: itemId, installed: true });
      }

      // MCPs — just return the metadata so user can configure locally
      if (type === "mcps") {
        const r = await gatewayFetch(gwId, `/api/marketplace/mcps`);
        if (!r.ok) return res.status(r.status).json({ error: `Remote returned ${r.status}` });
        const data = await r.json() as any;
        const items = data.items || [];
        itemMeta = items.find((i: any) => i.id === itemId);
        if (!itemMeta) return res.status(404).json({ error: "Item not found on remote" });
        return res.json({ ok: true, type, id: itemId, meta: itemMeta, note: "MCP metadata retrieved. Configure the connection locally." });
      }

      // Templates — fetch from remote /api/templates/:id and save to user templates dir
      if (type === "templates") {
        const r = await gatewayFetch(gwId, `/api/templates/${encodeURIComponent(itemId)}`);
        if (!r.ok) return res.status(r.status).json({ error: `Remote returned ${r.status}` });
        const tmplData = await r.json() as any;
        // Strip source field — it will be "user" when saved locally
        delete tmplData.source;
        mkdirSync(userTemplatesDir, { recursive: true });
        writeFileSync(join(userTemplatesDir, `${itemId}.json`), JSON.stringify(tmplData, null, 2));
        return res.json({ ok: true, type, id: itemId, installed: true });
      }

      return res.status(400).json({ error: "Unsupported install type" });
    } catch (err: any) {
      return res.status(502).json({ error: err.message });
    }
  });

  // ─── Tier 3: Remote File Proxy ─────────────────────────────────────

  // GET /api/team-gateways/:id/remote/agents/:agentId/files — list files on remote agent
  app.get("/api/team-gateways/:id/remote/agents/:agentId/files", async (req, res) => {
    const { id: gwId, agentId } = req.params;
    try {
      const r = await gatewayFetch(gwId, `/api/agents/${agentId}/files`);
      if (!r.ok) return res.status(r.status).json({ error: `Remote returned ${r.status}` });
      const data = await r.json();
      return res.json(data);
    } catch (err: any) {
      return res.status(502).json({ error: err.message });
    }
  });

  // GET /api/team-gateways/:id/remote/agents/:agentId/files/download?path=...
  // Download a specific file from a remote agent
  app.get("/api/team-gateways/:id/remote/agents/:agentId/files/download", async (req, res) => {
    const { id: gwId, agentId } = req.params;
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: "path query param required" });
    try {
      const r = await gatewayFetch(gwId, `/api/agents/${agentId}/files/download?path=${encodeURIComponent(filePath)}`, { timeout: 30000 });
      if (!r.ok) return res.status(r.status).json({ error: `Remote returned ${r.status}` });
      // Forward content-type and content-disposition headers
      const ct = r.headers.get("content-type");
      const cd = r.headers.get("content-disposition");
      if (ct) res.setHeader("Content-Type", ct);
      if (cd) res.setHeader("Content-Disposition", cd);
      // Pipe the response body through
      if (r.body) {
        const reader = r.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { res.end(); break; }
            res.write(value);
          }
        };
        await pump();
      } else {
        const buf = Buffer.from(await r.arrayBuffer());
        res.send(buf);
      }
    } catch (err: any) {
      return res.status(502).json({ error: err.message });
    }
  });

  // GET /api/team-gateways/:id/remote/sessions — list sessions on a remote agent
  app.get("/api/team-gateways/:id/remote/agents/:agentId/sessions", async (req, res) => {
    const { id: gwId, agentId } = req.params;
    try {
      const r = await gatewayFetch(gwId, `/api/agents/${agentId}/sessions`);
      if (!r.ok) return res.status(r.status).json({ error: `Remote returned ${r.status}` });
      return res.json(await r.json());
    } catch (err: any) {
      return res.status(502).json({ error: err.message });
    }
  });

  // ─── API: Open folder in Finder / Explorer ─────────────────────────
  app.post("/api/open-folder", (req, res) => {
    const { path: filePath } = req.body;
    if (!filePath || typeof filePath !== "string") return res.status(400).json({ error: "path required" });
    const resolved = resolve(filePath.replace(/^~/, homedir()));
    try {
      const target = existsSync(resolved) && statSync(resolved).isDirectory() ? resolved : dirname(resolved);
      if (!existsSync(target)) return res.status(404).json({ error: "path not found" });
      if (process.platform === "darwin") execSync(`open "${target}"`);
      else if (process.platform === "win32") execSync(`explorer "${target}"`);
      else execSync(`xdg-open "${target}"`);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API: Claude Accounts ────────────────────────────────────────
  const configFilePath = () => join(opts.dataDir || opts.baseDir, "config.json");


  app.get("/api/config/accounts", (_req, res) => {
    const accounts = opts.config.service.claudeAccounts || {};
    res.json(accounts);
  });

  app.post("/api/config/accounts", (req, res) => {
    const { name, path: cfgPath } = req.body as { name?: string; path?: string };
    if (!name?.trim() || !cfgPath?.trim()) return res.status(400).json({ error: "name and path required" });
    try {
      const raw = JSON.parse(readFileSync(configFilePath(), "utf-8"));
      if (!raw.service) raw.service = {};
      if (!raw.service.claudeAccounts) raw.service.claudeAccounts = {};
      raw.service.claudeAccounts[name.trim()] = cfgPath.trim();
      writeFileSync(configFilePath(), JSON.stringify(raw, null, 2));
      if (!opts.config.service.claudeAccounts) opts.config.service.claudeAccounts = {};
      opts.config.service.claudeAccounts[name.trim()] = cfgPath.trim();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/config/accounts/:name", (req, res) => {
    const { name } = req.params;
    try {
      const raw = JSON.parse(readFileSync(configFilePath(), "utf-8"));
      if (raw.service?.claudeAccounts) delete raw.service.claudeAccounts[name];
      writeFileSync(configFilePath(), JSON.stringify(raw, null, 2));
      if (opts.config.service.claudeAccounts) delete opts.config.service.claudeAccounts[name];
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API: Claude Account login flow ──────────────────────────────
  // In-memory store of running `claude auth login` processes keyed by session id.
  // The process stays alive waiting for the OAuth redirect so we don't kill it early.
  const loginSessions = new Map<string, { proc: any; output: string; name: string; path: string }>();

  // POST /api/config/accounts/login  { name, path }
  // Spawns `claude auth login` with CLAUDE_CONFIG_DIR set, streams output until a
  // URL appears, then returns { sessionId, url }.  Process keeps running.
  app.post("/api/config/accounts/login", (req, res) => {
    const { name, path: cfgPath } = req.body as { name?: string; path?: string };
    if (!name?.trim() || !cfgPath?.trim()) return res.status(400).json({ error: "name and path required" });

    const home = homedir();
    const resolvedPath = cfgPath.trim().replace(/^~/, home);

    // First check if already logged in
    try {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) { if (v !== undefined && k !== "CLAUDECODE" && k !== "CLAUDE_CODE_ENTRYPOINT") env[k] = v; }
      env.CLAUDE_CONFIG_DIR = resolvedPath;
      let status = "";
      try { status = execSync("claude auth status 2>&1", { env, timeout: 8_000 }).toString().trim(); } catch { /* ignore */ }
      if (status.toLowerCase().includes("logged in") || status.toLowerCase().includes("authenticated")) {
        return res.json({ alreadyLoggedIn: true });
      }
    } catch { /* ignore */ }

    // Spawn `claude auth login` — it will print an auth URL and keep running
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) { if (v !== undefined && k !== "CLAUDECODE" && k !== "CLAUDE_CODE_ENTRYPOINT") env[k] = v; }
    env.CLAUDE_CONFIG_DIR = resolvedPath;

    const proc = cpSpawn("claude", ["auth", "login"], { env, stdio: ["pipe", "pipe", "pipe"] });
    const sessionId = `login-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let output = "";
    loginSessions.set(sessionId, { proc, output, name: name.trim(), path: cfgPath.trim() });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        res.status(408).json({ error: "Timed out waiting for login URL. Try again." });
      }
    }, 20_000);

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const session = loginSessions.get(sessionId);
      if (session) session.output = output;

      const urlMatch = output.match(/https?:\/\/[^\s\n]+/);
      if (urlMatch && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        res.json({ sessionId, url: urlMatch[0].trim() });
      }
    };

    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);

    proc.on("close", (code: number) => {
      log.info(`[Auth] login process for "${name}" exited with code ${code}`);
      loginSessions.delete(sessionId);
    });
  });

  // POST /api/config/accounts/login/code  { sessionId, code }
  // Sends the verification code to the waiting login process's stdin.
  app.post("/api/config/accounts/login/code", (req, res) => {
    const { sessionId, code } = req.body as { sessionId?: string; code?: string };
    if (!sessionId || !code?.trim()) return res.status(400).json({ error: "sessionId and code required" });
    const session = loginSessions.get(sessionId);
    if (!session) return res.status(404).json({ error: "Login session not found or already completed" });
    try {
      session.proc.stdin.write(code.trim() + "\n");
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/config/accounts/:name/status
  // Checks if a configured account is authenticated.
  app.get("/api/config/accounts/:name/status", (req, res) => {
    const { name } = req.params;
    const home = homedir();
    const cfgPath = opts.config.service.claudeAccounts?.[name];
    if (!cfgPath) return res.status(404).json({ error: "Account not found" });
    const resolvedPath = cfgPath.replace(/^~/, home);
    try {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) { if (v !== undefined && k !== "CLAUDECODE" && k !== "CLAUDE_CODE_ENTRYPOINT" && k !== "CLAUDE_CONFIG_DIR") env[k] = v; }
      // Only set CLAUDE_CONFIG_DIR for non-default accounts — setting it to ~/.claude breaks auth status
      const defaultClaudeDir = join(home, ".claude");
      if (resolvedPath !== defaultClaudeDir) env.CLAUDE_CONFIG_DIR = resolvedPath;
      let status = "";
      try { status = execSync("claude auth status 2>&1", { env, timeout: 10_000 }).toString().trim(); } catch { /* not logged in */ }
      const loggedIn = status.toLowerCase().includes("logged in") || status.toLowerCase().includes("authenticated") || status.includes('"loggedIn": true') || status.includes('"loggedIn":true');
      // Try to extract email from JSON or text output
      let email: string | null = null;
      try { const parsed = JSON.parse(status); email = parsed.email || null; } catch {
        const match = status.match(/email[:\s]+"?([^\s",]+@[^\s",]+)/i);
        if (match) email = match[1];
      }
      res.json({ loggedIn, status, email });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/whoami/:agentId — which Claude account is this agent using right now?
  app.get("/api/whoami/:agentId", (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    const home = homedir();
    const accountName = agent?.claudeAccount || "default";
    let resolvedPath = "";
    if (agent?.claudeAccount && opts.config.service.claudeAccounts?.[agent.claudeAccount]) {
      resolvedPath = opts.config.service.claudeAccounts[agent.claudeAccount].replace(/^~/, home);
    } else {
      // Default account — try "main" first, then ~/.claude
      const mainPath = opts.config.service.claudeAccounts?.["main"];
      resolvedPath = mainPath ? mainPath.replace(/^~/, home) : join(home, ".claude");
    }
    try {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined && k !== "CLAUDECODE" && k !== "CLAUDE_CODE_ENTRYPOINT" && k !== "CLAUDE_CONFIG_DIR") env[k] = v;
      }
      // Only set CLAUDE_CONFIG_DIR for non-default accounts — setting it to ~/.claude breaks auth status
      if (agent?.claudeAccount && opts.config.service.claudeAccounts?.[agent.claudeAccount]) {
        env.CLAUDE_CONFIG_DIR = resolvedPath;
      }
      let raw = "";
      try { raw = execSync("claude auth status 2>&1", { env, timeout: 10_000 }).toString().trim(); } catch (e: any) {
        // execSync throws on non-zero exit — but claude auth status outputs JSON to stderr on failure
        raw = e.stdout?.toString().trim() || e.stderr?.toString().trim() || "";
      }
      let parsed: any = {};
      try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
      log.info(`[whoami] ${agentId} → account=${accountName} email=${parsed.email || "unknown"} plan=${parsed.subscriptionType || "unknown"}`);
      res.json({ accountName, configDir: resolvedPath, checkedAt: new Date().toISOString(), ...parsed });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API: Service settings (read/write top-level service fields) ──
  app.get("/api/config/service", (_req, res) => {
    const s = opts.config.service || {};
    const raw = JSON.parse(readFileSync(configFilePath(), "utf-8"));
    const deploy = raw.deployment || {};
    // Deployment mode: "server" on Railway/container, "local" otherwise.
    const deploymentMode = isServerMode() ? "server" : "local";
    // On server mode, sharedAgentsEnabled is always true by definition — the
    // server IS a shared gateway regardless of what config.json says.
    const sharedAgentsEnabled = deploymentMode === "server"
      ? true
      : (s as any).sharedAgentsEnabled ?? false;
    res.json({
      edition: (s as any).edition || "pro",
      maxAgents: (s as any).maxAgents ?? 0,  // 0 = unlimited
      deploymentMode,
      personalAgentsDir: (s as any).personalAgentsDir || "~/Desktop/MyAIforOne Drive/PersonalAgents",
      personalRegistryDir: (s as any).personalRegistryDir || "~/Desktop/MyAIforOne Drive/PersonalRegistry",
      webUIPort: (s as any).webUI?.port || 4888,
      webUIEnabled: (s as any).webUI?.enabled ?? true,
      webhookSecret: (s as any).webUI?.webhookSecret ? "(set)" : null,
      logLevel: (s as any).logLevel || "info",
      logFile: (s as any).logFile || null,
      pairingCode: (s as any).pairingCode ? "(set)" : null,
      deployment: {
        provider: deploy.provider || "railway",
        deployToken: deploy.deployToken ? "••••••••" : "",
        githubOrg: deploy.githubOrg || "",
        githubToken: deploy.githubToken ? "••••••••" : "",
      },
      defaultClaudeAccount: (s as any).defaultClaudeAccount || null,
      multiModelEnabled: (s as any).multiModelEnabled ?? false,
      platformDefaultExecutor: (s as any).platformDefaultExecutor || "claude",
      ollamaBaseUrl: (s as any).ollamaBaseUrl || "http://localhost:11434",
      providerKeys: Object.fromEntries(
        Object.entries((s as any).providerKeys || {}).map(([k, v]) => [k, v ? "••••••••" : ""])
      ),
      gymEnabled: (s as any).gymEnabled ?? false,
      aibriefingEnabled: (s as any).aibriefingEnabled ?? false,
      gymOnlyMode: (s as any).gymOnlyMode ?? false,
      sharedAgentsEnabled,
      voiceModeEnabled: (s as any).voiceModeEnabled ?? false,
      platformDefaultVoice: (s as any).platformDefaultVoice || "browser",
      voiceAutoPlay: (s as any).voiceAutoPlay ?? false,
      voiceMaxChars: (s as any).voiceMaxChars ?? 2000,
      licenseKey: (s as any).licenseKey ? `${(s as any).licenseKey.slice(0, 20)}...` : "",
      licenseUrl: (s as any).licenseUrl || "https://ai41license.agenticledger.ai",
    });
  });

  // Proxy for Ollama API (avoids CORS when browser fetches model list)
  app.get("/api/ollama-proxy", async (req, res) => {
    const url = req.query.url as string;
    if (!url || !url.includes("/api/tags")) {
      return res.status(400).json({ error: "Only /api/tags proxy is allowed" });
    }
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await r.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: "Could not reach Ollama", detail: String(err) });
    }
  });

  // Test connection to a provider (OpenAI-compat or Gemini)
  app.post("/api/config/provider-test", async (req, res) => {
    const { provider } = req.body as { provider?: string };
    if (!provider) return res.status(400).json({ error: "provider required" });

    const keys = (opts.config.service as any).providerKeys || {};

    if (provider === "anthropic") {
      const key = keys.anthropic;
      if (!key) return res.json({ ok: false, error: "No Anthropic API key configured" });
      try {
        const { checkAnthropicHealth } = await import("./anthropic-executor.js");
        const result = await checkAnthropicHealth(key);
        res.json(result);
      } catch (e: any) { res.json({ ok: false, error: e.message }); }
    } else if (provider === "gemini") {
      const key = keys.google;
      if (!key) return res.json({ ok: false, error: "No Google API key configured" });
      try {
        const { checkGeminiHealth } = await import("./gemini-executor.js");
        const result = await checkGeminiHealth(key);
        res.json(result);
      } catch (e: any) { res.json({ ok: false, error: e.message }); }
    } else {
      const { resolveProvider, checkOpenAICompatHealth } = await import("./openai-executor.js");
      const pc = resolveProvider(provider);
      if (!pc) return res.json({ ok: false, error: `Unknown provider: ${provider}` });
      const key = keys[pc.keyField];
      if (!key) return res.json({ ok: false, error: `No API key configured for ${pc.name}` });
      try {
        const result = await checkOpenAICompatHealth(provider, key);
        res.json(result);
      } catch (e: any) { res.json({ ok: false, error: e.message }); }
    }
  });

  app.put("/api/config/service", (req, res) => {
    const { personalAgentsDir, personalRegistryDir, webUIPort, logLevel, logFile, pairingCode, webhookSecret, webUIEnabled, deployment, defaultClaudeAccount, multiModelEnabled, platformDefaultExecutor, ollamaBaseUrl, providerKeys, gymEnabled, aibriefingEnabled, gymOnlyMode, sharedAgentsEnabled, licenseKey, licenseUrl, voiceModeEnabled, platformDefaultVoice, voiceAutoPlay, voiceMaxChars } = req.body as any;
    try {
      const raw = JSON.parse(readFileSync(configFilePath(), "utf-8"));
      if (!raw.service) raw.service = {};
      if (personalAgentsDir !== undefined) raw.service.personalAgentsDir = personalAgentsDir;
      if (personalRegistryDir !== undefined) raw.service.personalRegistryDir = personalRegistryDir;
      if (logLevel !== undefined) raw.service.logLevel = logLevel;
      if (logFile !== undefined) raw.service.logFile = logFile;
      if (pairingCode !== undefined) raw.service.pairingCode = pairingCode || undefined;
      if (defaultClaudeAccount !== undefined) {
        raw.service.defaultClaudeAccount = defaultClaudeAccount || undefined;
        // Also update in-memory config + claudeAccounts hint
        opts.config.service.defaultClaudeAccount = defaultClaudeAccount || undefined;
        if (opts.config.service.claudeAccounts) {
          (opts.config.service.claudeAccounts as any)._defaultAccount = defaultClaudeAccount || undefined;
        }
      }
      if (multiModelEnabled !== undefined) raw.service.multiModelEnabled = multiModelEnabled;
      if (platformDefaultExecutor !== undefined) raw.service.platformDefaultExecutor = platformDefaultExecutor;
      if (ollamaBaseUrl !== undefined) raw.service.ollamaBaseUrl = ollamaBaseUrl;
      // Provider API keys — only update non-masked values
      if (providerKeys && typeof providerKeys === 'object') {
        if (!raw.service.providerKeys) raw.service.providerKeys = {};
        for (const [provider, key] of Object.entries(providerKeys)) {
          if (key && (key as string) !== "••••••••") {
            raw.service.providerKeys[provider] = key;
          } else if (key === "") {
            delete raw.service.providerKeys[provider];
          }
        }
      }
      if (voiceModeEnabled !== undefined) { raw.service.voiceModeEnabled = voiceModeEnabled; (opts.config.service as any).voiceModeEnabled = voiceModeEnabled; }
      if (platformDefaultVoice !== undefined) { raw.service.platformDefaultVoice = platformDefaultVoice || "browser"; (opts.config.service as any).platformDefaultVoice = platformDefaultVoice || "browser"; }
      if (voiceAutoPlay !== undefined) { raw.service.voiceAutoPlay = voiceAutoPlay; (opts.config.service as any).voiceAutoPlay = voiceAutoPlay; }
      if (voiceMaxChars !== undefined) {
        const n = Number(voiceMaxChars);
        if (Number.isFinite(n) && n > 0) {
          raw.service.voiceMaxChars = n;
          (opts.config.service as any).voiceMaxChars = n;
        }
      }
      if (gymEnabled !== undefined) { raw.service.gymEnabled = gymEnabled; (opts.config.service as any).gymEnabled = gymEnabled; }
      if (aibriefingEnabled !== undefined) { raw.service.aibriefingEnabled = aibriefingEnabled; (opts.config.service as any).aibriefingEnabled = aibriefingEnabled; }
      if (gymOnlyMode !== undefined) { raw.service.gymOnlyMode = gymOnlyMode; (opts.config.service as any).gymOnlyMode = gymOnlyMode; }
      if (sharedAgentsEnabled !== undefined) { raw.service.sharedAgentsEnabled = sharedAgentsEnabled; (opts.config.service as any).sharedAgentsEnabled = sharedAgentsEnabled; }
      if (licenseKey !== undefined && licenseKey !== "" && !licenseKey.endsWith("...")) {
        raw.service.licenseKey = licenseKey;
        (opts.config.service as any).licenseKey = licenseKey;
        // Re-verify license immediately so agents unblock without restart
        import("./license.js").then(({ reverifyLicense }) => {
          reverifyLicense(licenseKey, (opts.config.service as any).licenseUrl).then(result => {
            log.info(`License re-verified: valid=${result.valid} org=${result.org || "n/a"}`);
          }).catch(() => {});
        });
      }
      if (licenseKey === "") { delete raw.service.licenseKey; delete (opts.config.service as any).licenseKey; }
      if (licenseUrl !== undefined) { raw.service.licenseUrl = licenseUrl || undefined; (opts.config.service as any).licenseUrl = licenseUrl || undefined; }
      if (webUIPort !== undefined || webhookSecret !== undefined || webUIEnabled !== undefined) {
        if (!raw.service.webUI) raw.service.webUI = {};
        if (webUIPort !== undefined) raw.service.webUI.port = Number(webUIPort);
        if (webhookSecret !== undefined) raw.service.webUI.webhookSecret = webhookSecret;
        if (webUIEnabled !== undefined) raw.service.webUI.enabled = webUIEnabled;
      }
      // Deployment settings — only update non-masked values
      if (deployment) {
        if (!raw.deployment) raw.deployment = {};
        if (deployment.provider !== undefined) raw.deployment.provider = deployment.provider;
        if (deployment.githubOrg !== undefined) raw.deployment.githubOrg = deployment.githubOrg;
        // Only update tokens if they're not the masked placeholder
        if (deployment.deployToken && deployment.deployToken !== "••••••••") raw.deployment.deployToken = deployment.deployToken;
        if (deployment.githubToken && deployment.githubToken !== "••••••••") raw.deployment.githubToken = deployment.githubToken;
      }
      writeFileSync(configFilePath(), JSON.stringify(raw, null, 2));
      // Sync in-memory config so GET reflects changes immediately
      if (multiModelEnabled !== undefined) (opts.config.service as any).multiModelEnabled = multiModelEnabled;
      if (platformDefaultExecutor !== undefined) (opts.config.service as any).platformDefaultExecutor = platformDefaultExecutor;
      if (ollamaBaseUrl !== undefined) (opts.config.service as any).ollamaBaseUrl = ollamaBaseUrl;
      if (providerKeys) (opts.config.service as any).providerKeys = raw.service.providerKeys;
      if (logLevel !== undefined) opts.config.service.logLevel = logLevel;
      if (logFile !== undefined) opts.config.service.logFile = logFile;
      if (pairingCode !== undefined) opts.config.service.pairingCode = pairingCode || undefined;
      if (personalAgentsDir !== undefined) opts.config.service.personalAgentsDir = personalAgentsDir;
      if (personalRegistryDir !== undefined) opts.config.service.personalRegistryDir = personalRegistryDir;
      res.json({ ok: true, note: "Restart required for port/dir changes to take effect" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API: Upgrade Lite → Pro ──────────────────────────────────────────

  app.post("/api/upgrade", (req, res) => {
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      // Already on Pro?
      const currentEdition = rawConfig.service?.edition || "pro";
      if (currentEdition === "pro") {
        return res.status(400).json({ success: false, error: "Already on Pro edition" });
      }

      const { licenseKey } = req.body as { licenseKey?: string };

      // 1. Change edition to "pro" and remove agent cap
      if (!rawConfig.service) rawConfig.service = {};
      rawConfig.service.edition = "pro";
      rawConfig.service.maxAgents = 0; // unlimited

      // 2. Swap myaiforone-lite MCP → myaiforone-local
      if (rawConfig.mcps && rawConfig.mcps["myaiforone-lite"]) {
        const liteMcp = rawConfig.mcps["myaiforone-lite"];
        // Update args: swap mcp-server-lite path for mcp-server path
        if (liteMcp.args && Array.isArray(liteMcp.args)) {
          liteMcp.args = liteMcp.args.map((arg: string) =>
            arg.replace(/server\/mcp-server-lite\/dist\/index\.js/, "server/mcp-server/dist/index.js")
              .replace(/server\\mcp-server-lite\\dist\\index\.js/, "server\\mcp-server\\dist\\index.js")
          );
        }
        rawConfig.mcps["myaiforone-local"] = liteMcp;
        delete rawConfig.mcps["myaiforone-lite"];
      }

      // 3. Update all agent MCP references from myaiforone-lite → myaiforone-local
      if (rawConfig.agents) {
        for (const agentId of Object.keys(rawConfig.agents)) {
          const agent = rawConfig.agents[agentId];
          if (agent.mcps && Array.isArray(agent.mcps)) {
            agent.mcps = agent.mcps.map((m: string) =>
              m === "myaiforone-lite" ? "myaiforone-local" : m
            );
          }
        }
      }

      // 4. Update defaultMcps references
      if (rawConfig.defaultMcps && Array.isArray(rawConfig.defaultMcps)) {
        rawConfig.defaultMcps = rawConfig.defaultMcps.map((m: string) =>
          m === "myaiforone-lite" ? "myaiforone-local" : m
        );
      }

      // 5. Swap hub-lite agent → full hub agent
      //    Find any agent whose claudeMd references hub-lite and update to full hub
      if (rawConfig.agents) {
        for (const agentId of Object.keys(rawConfig.agents)) {
          const agent = rawConfig.agents[agentId];
          if (agent.claudeMd && typeof agent.claudeMd === "string" &&
              agent.claudeMd.includes("hub-lite")) {
            agent.claudeMd = agent.claudeMd.replace(/hub-lite/g, "hub");
          }
          // Also update agentHome if it references hub-lite
          if (agent.agentHome && typeof agent.agentHome === "string" &&
              agent.agentHome.includes("hub-lite")) {
            agent.agentHome = agent.agentHome.replace(/hub-lite/g, "hub");
          }
          // Also update memoryDir if it references hub-lite
          if (agent.memoryDir && typeof agent.memoryDir === "string" &&
              agent.memoryDir.includes("hub-lite")) {
            agent.memoryDir = agent.memoryDir.replace(/hub-lite/g, "hub");
          }
        }
      }

      // 6. Store license key if provided
      if (licenseKey) {
        rawConfig.service.licenseKey = licenseKey;
      }

      // Write updated config to disk
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Sync in-memory config
      (opts.config.service as any).edition = "pro";
      (opts.config.service as any).maxAgents = 0;

      log.info("Upgrade complete: Lite → Pro");
      res.json({
        success: true,
        edition: "pro",
        message: "Upgrade complete. Restart to apply changes.",
      });
    } catch (e: any) {
      log.error(`Upgrade failed: ${e.message}`);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ─── API: Voice Mode (TTS + STT) ─────────────────────────────────────
  // See docs/voice-mode-plan.md

  const voiceRegistry: VoiceRegistry = buildVoiceRegistry(opts.config);

  // Snapshot of current voice config + provider/voice catalog for UI rendering.
  app.get("/api/voice-config", (_req, res) => {
    res.json(voiceRegistry.snapshot());
  });

  // Voices for a specific provider (or for the agent's resolved provider).
  app.get("/api/voices", (req, res) => {
    const providerId = (req.query.provider as string | undefined) || undefined;
    const agentId = (req.query.agentId as string | undefined) || undefined;
    if (providerId) {
      const p = voiceRegistry.get(providerId);
      if (!p) return res.status(404).json({ error: `Unknown provider: ${providerId}` });
      return res.json({ provider: p.id, name: p.name, serverSide: p.serverSide, configured: p.isConfigured(), voices: p.listVoices() });
    }
    const { provider, voiceId } = voiceRegistry.resolve(agentId);
    res.json({
      provider: provider.id,
      name: provider.name,
      serverSide: provider.serverSide,
      configured: provider.isConfigured(),
      effectiveVoiceId: voiceId || provider.defaultVoice(),
      voices: provider.listVoices(),
    });
  });

  // Synthesize speech for an agent's reply.
  // Body: { text: string, agentId?: string, providerOverride?: string }
  // Returns: audio/mpeg bytes, OR { clientSide: true, provider: "browser" } when the
  // resolved provider is the browser provider (client should use Web Speech API).
  app.post("/api/tts", async (req, res) => {
    try {
      if (!(opts.config.service as any).voiceModeEnabled) {
        return res.status(403).json({ error: "Voice mode is disabled" });
      }
      const { text, agentId, providerOverride, voiceOverride } = req.body as {
        text?: string; agentId?: string; providerOverride?: string; voiceOverride?: string;
      };
      if (!text || !text.trim()) return res.status(400).json({ error: "text is required" });

      // Truncate to platform max
      const maxChars = (opts.config.service as any).voiceMaxChars ?? 2000;
      const input = text.length > maxChars ? text.slice(0, maxChars) : text;

      // Resolve provider/voice. providerOverride wins if supplied.
      let provider, voiceId;
      if (providerOverride) {
        const p = voiceRegistry.get(providerOverride);
        if (!p) return res.status(400).json({ error: `Unknown provider: ${providerOverride}` });
        provider = p;
        voiceId = voiceOverride;
      } else {
        const resolved = voiceRegistry.resolve(agentId);
        provider = resolved.provider;
        voiceId = voiceOverride || resolved.voiceId;
      }

      if (!provider.serverSide) {
        // Browser provider — tell client to handle via Web Speech API.
        return res.json({ clientSide: true, provider: provider.id, voiceId: voiceId || provider.defaultVoice(), text: input });
      }

      if (!provider.isConfigured()) {
        return res.status(503).json({ error: `${provider.name} is not configured (missing API key)` });
      }

      const result = await provider.tts(input, { voiceId });
      res.setHeader("Content-Type", result.format === "mp3" ? "audio/mpeg" : "audio/wav");
      res.setHeader("X-Voice-Provider", provider.id);
      res.setHeader("X-Voice-Voice-Id", voiceId || provider.defaultVoice());
      res.setHeader("X-Voice-Characters", String(result.characters));
      res.send(result.audio);
    } catch (e: any) {
      log.error(`/api/tts failed: ${e?.message || e}`);
      res.status(500).json({ error: e?.message || "TTS failed" });
    }
  });

  // Transcribe audio.
  // Request: POST raw audio bytes with Content-Type: audio/<format>
  //   Optional query: ?providerOverride=grok&language=en&agentId=<id>
  // Returns: { text, language?, durationSeconds? }
  app.post(
    "/api/stt",
    express.raw({ type: ["audio/*", "application/octet-stream"], limit: "25mb" }),
    async (req, res) => {
      try {
        if (!(opts.config.service as any).voiceModeEnabled) {
          return res.status(403).json({ error: "Voice mode is disabled" });
        }
        const audio = req.body as Buffer;
        if (!audio || !Buffer.isBuffer(audio) || audio.length === 0) {
          return res.status(400).json({ error: "audio body is required (POST raw bytes with Content-Type: audio/*)" });
        }

        const providerOverride = (req.query.providerOverride as string | undefined) || undefined;
        const agentId = (req.query.agentId as string | undefined) || undefined;
        const language = (req.query.language as string | undefined) || undefined;
        const mimeType = (req.headers["content-type"] as string | undefined) || "audio/webm";

        let provider;
        if (providerOverride) {
          const p = voiceRegistry.get(providerOverride);
          if (!p) return res.status(400).json({ error: `Unknown provider: ${providerOverride}` });
          provider = p;
        } else {
          provider = voiceRegistry.resolve(agentId).provider;
        }

        if (!provider.serverSide) {
          return res.status(400).json({ error: "Browser provider is client-side; perform STT in the browser via Web Speech API" });
        }

        if (!provider.isConfigured()) {
          return res.status(503).json({ error: `${provider.name} is not configured (missing API key)` });
        }

        const result = await provider.stt(audio, { language, mimeType });
        res.json({ text: result.text, language: result.language, durationSeconds: result.durationSeconds, provider: provider.id });
      } catch (e: any) {
        log.error(`/api/stt failed: ${e?.message || e}`);
        res.status(500).json({ error: e?.message || "STT failed" });
      }
    }
  );

  // ─── API: Profile ────────────────────────────────────────────────────

  function profilePath(): string {
    return join(getPersonalAgentsDir(), "profile.json");
  }

  function readProfile(): Record<string, any> {
    const p = profilePath();
    if (!existsSync(p)) return {};
    try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return {}; }
  }

  app.get("/api/profile", (_req, res) => {
    res.json(readProfile());
  });

  app.put("/api/profile", (req, res) => {
    const { name, role, industry, aiExperience, interests, avatar } = req.body as any;
    try {
      const current = readProfile();
      if (name !== undefined) current.name = name;
      if (role !== undefined) current.role = role;
      if (industry !== undefined) current.industry = industry;
      if (aiExperience !== undefined) current.aiExperience = aiExperience;
      if (interests !== undefined) current.interests = interests;
      if (avatar !== undefined) current.avatar = avatar;
      if (!current.createdAt) current.createdAt = new Date().toISOString();
      current.updatedAt = new Date().toISOString();
      writeFileSync(profilePath(), JSON.stringify(current, null, 2));
      res.json({ ok: true, profile: current });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API: SaaS Publishing ──────────────────────────────────────────

  app.get("/api/saas/config", (_req, res) => {
    const raw = JSON.parse(readFileSync(configFilePath(), "utf-8"));
    const saas = raw.saas || {};
    res.json({ baseUrl: saas.baseUrl || "", connected: !!(saas.baseUrl && saas.apiKey), hasKey: !!saas.apiKey });
  });

  app.put("/api/saas/config", (req, res) => {
    const { baseUrl, apiKey } = req.body as any;
    try {
      const raw = JSON.parse(readFileSync(configFilePath(), "utf-8"));
      if (!raw.saas) raw.saas = {};
      if (baseUrl !== undefined) raw.saas.baseUrl = baseUrl;
      if (apiKey && apiKey !== "••••••••") raw.saas.apiKey = apiKey;
      writeFileSync(configFilePath(), JSON.stringify(raw, null, 2));
      (opts.config as any).saas = raw.saas;
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/saas/test", async (req, res) => {
    // Accept credentials from body (test before save) or fall back to saved config
    const raw = JSON.parse(readFileSync(configFilePath(), "utf-8"));
    const saved = raw.saas || {};
    const baseUrl = (req.body as any)?.baseUrl || saved.baseUrl;
    const apiKey = (req.body as any)?.apiKey && (req.body as any).apiKey !== "••••••••"
      ? (req.body as any).apiKey
      : saved.apiKey;
    if (!baseUrl || !apiKey) {
      return res.status(400).json({ error: "Enter a base URL and API key first" });
    }
    try {
      const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/api/agents`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) return res.status(401).json({ error: `SaaS returned ${resp.status} — check your API key` });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(502).json({ error: `Could not reach SaaS: ${e.message}` });
    }
  });

  app.post("/api/saas/publish", async (req, res) => {
    // destination: "library" (company-private, upsert) | "marketplace" (platform-wide, create)
    const { type, id, destination = "library" } = req.body as { type: string; id: string; destination?: string };
    if (!["skill", "prompt", "agent", "app"].includes(type)) {
      return res.status(400).json({ error: "type must be skill, prompt, agent, or app" });
    }
    if (!["library", "marketplace"].includes(destination)) {
      return res.status(400).json({ error: "destination must be library or marketplace" });
    }
    if (!id) return res.status(400).json({ error: "id required" });

    const raw = JSON.parse(readFileSync(configFilePath(), "utf-8"));
    const saas = raw.saas || {};
    if (!saas.baseUrl || !saas.apiKey) {
      return res.status(400).json({ error: "SaaS not configured — go to Admin → Settings to add your SaaS URL and API key" });
    }
    const base = saas.baseUrl.replace(/\/$/, "");
    const headers: Record<string, string> = { Authorization: `Bearer ${saas.apiKey}`, "Content-Type": "application/json" };
    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    // Both destinations use POST /api/marketplace/install — destination field controls where it lands
    const flag = destination === "library" ? "saasLibrary" : "saasMarketplace";

    try {
      if (type === "skill") {
        const registryPath = join(getPersonalRegistryDir(opts.config), "skills.json");
        const data = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf-8")) : { skills: [] };
        const entry = (data.skills || []).find((s: any) => s.id === id);
        if (!entry) return res.status(404).json({ error: `Skill "${id}" not found in personal registry` });
        const personalSkillsDir = join(resolveTilde(getPersonalAgentsDir(opts.config)), "skills");
        let contentPath = join(personalSkillsDir, `${id}.md`);
        if (!existsSync(contentPath)) contentPath = join(home, ".claude", "commands", `${id}.md`);
        if (!existsSync(contentPath) && entry.localPath) {
          contentPath = isAbsolute(entry.localPath) ? entry.localPath : join(opts.baseDir, entry.localPath);
        }
        const content = existsSync(contentPath) ? readFileSync(contentPath, "utf-8") : "";
        const resp = await fetch(`${base}/api/marketplace/install`, {
          method: "POST", headers,
          body: JSON.stringify({ type: "skill", destination, name: entry.name || id, description: entry.description || "", content, category: entry.category || "" }),
        });
        if (!resp.ok) return res.status(resp.status).json({ error: `SaaS error: ${await resp.text()}` });
        entry[flag] = true;
        writeFileSync(registryPath, JSON.stringify(data, null, 2));
        return res.json({ ok: true });

      } else if (type === "prompt") {
        const registryPath = join(getPersonalRegistryDir(opts.config), "prompts.json");
        const data = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf-8")) : { prompts: [] };
        const entry = (data.prompts || []).find((p: any) => p.id === id);
        if (!entry) return res.status(404).json({ error: `Prompt "${id}" not found` });
        const personalPromptsDir = join(resolveTilde(getPersonalAgentsDir(opts.config)), "prompts");
        let contentPath = join(personalPromptsDir, `${id}.md`);
        if (!existsSync(contentPath) && entry.localPath) {
          contentPath = isAbsolute(entry.localPath) ? entry.localPath : join(opts.baseDir, entry.localPath);
        }
        const content = existsSync(contentPath) ? readFileSync(contentPath, "utf-8") : (entry.content || "");
        const resp = await fetch(`${base}/api/marketplace/install`, {
          method: "POST", headers,
          body: JSON.stringify({ type: "prompt", destination, name: entry.name || id, description: entry.description || "", content }),
        });
        if (!resp.ok) return res.status(resp.status).json({ error: `SaaS error: ${await resp.text()}` });
        entry[flag] = true;
        writeFileSync(registryPath, JSON.stringify(data, null, 2));
        return res.json({ ok: true });

      } else if (type === "agent") {
        const agent = opts.config.agents[id];
        if (!agent) return res.status(404).json({ error: `Agent "${id}" not found` });
        const claudeMd = existsSync(agent.claudeMd) ? readFileSync(agent.claudeMd, "utf-8") : "";
        const resp = await fetch(`${base}/api/agents`, {
          method: "POST", headers,
          body: JSON.stringify({
            agentId: id, name: agent.name, description: agent.description, claudeMd,
            allowedTools: agent.allowedTools, skills: agent.skills || [], mcps: [],
            mentionAliases: agent.mentionAliases || [], model: "claude-sonnet-4-6",
            persistent: agent.persistent ?? true, streaming: agent.streaming ?? true,
            advancedMemory: agent.advancedMemory ?? true, agentClass: agent.agentClass || "standard",
            timeout: agent.timeout || 14400000,
          }),
        });
        if (!resp.ok) return res.status(resp.status).json({ error: `SaaS error: ${await resp.text()}` });
        const agentJsonPath = join(resolveTilde(agent.agentHome || ""), "agent.json");
        if (agent.agentHome && existsSync(agentJsonPath)) {
          const agentJson = JSON.parse(readFileSync(agentJsonPath, "utf-8"));
          agentJson[flag] = true;
          writeFileSync(agentJsonPath, JSON.stringify(agentJson, null, 2));
        }
        return res.json({ ok: true });

      } else if (type === "app") {
        const apps = readApps();
        const entry = apps.find((a: any) => a.id === id);
        if (!entry) return res.status(404).json({ error: `App "${id}" not found` });
        const resp = await fetch(`${base}/api/apps`, {
          method: "POST", headers,
          body: JSON.stringify({
            name: entry.name, url: entry.url || "",
            description: entry.shortDescription || entry.description || "",
            deployPlatform: entry.deployPlatform || "", githubRepo: entry.githubRepo || "",
            status: entry.status || "draft", category: entry.category || "",
            public: destination === "marketplace",
          }),
        });
        if (!resp.ok) return res.status(resp.status).json({ error: `SaaS error: ${await resp.text()}` });
        const updatedApps = apps.map((a: any) => a.id === id ? { ...a, [flag]: true } : a);
        writeFileSync(appsRegistryPath(), JSON.stringify(updatedApps, null, 2));
        return res.json({ ok: true });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── MCP registry sync helper ───────────────────────────────────
  // Ensures an MCP entry in config.json is also in PersonalRegistry/mcps.json.
  // Call this whenever an MCP is added to config.json from any code path.
  function syncMcpToRegistry(id: string, mcpEntry: any, meta?: { name?: string; description?: string; category?: string; provider?: string }) {
    const registryPath = join(getPersonalRegistryDir(opts.config), "mcps.json");
    let registryData: any = { mcps: [] };
    try { registryData = JSON.parse(readFileSync(registryPath, "utf-8")); } catch { /* fresh */ }
    if (!Array.isArray(registryData.mcps)) registryData.mcps = [];

    // Skip if already in personal registry (platform mcps.json is read-only)
    if (registryData.mcps.some((m: any) => m.id === id)) return;

    registryData.mcps.push({
      id,
      name: meta?.name || id,
      provider: meta?.provider || "me",
      description: meta?.description || "",
      category: meta?.category || "personal",
      verified: false,
      source: "local",
      tags: [meta?.category?.toLowerCase() || "personal"],
      requiredKeys: [],
      fetch: mcpEntry.type === "http"
        ? { type: "http", url: mcpEntry.url }
        : { type: "stdio", command: mcpEntry.command, args: mcpEntry.args || [] },
    });
    writeFileSync(registryPath, JSON.stringify(registryData, null, 2));
    log.info(`[Registry Sync] Auto-added MCP "${id}" to registry`);
  }

  // ─── Apps helpers ────────────────────────────────────────────────
  const appsRegistryPath = () => join(getPersonalRegistryDir(opts.config), "apps.json");
  function readApps(): any[] {
    const p = appsRegistryPath();
    if (!existsSync(p)) return [];
    try { return JSON.parse(readFileSync(p, "utf8")); } catch { return []; }
  }
  function writeApps(list: any[]) {
    writeFileSync(appsRegistryPath(), JSON.stringify(list, null, 2));
  }
  function slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  // ─── API: Apps CRUD ──────────────────────────────────────────────
  app.get("/api/apps", (_req, res) => {
    res.json(readApps());
  });

  app.post("/api/apps", (req, res) => {
    try {
      const { name, url, shortDescription, description, category, status, tags, agentDeveloper, githubRepo, githubBranch, deployPlatform, otherDetails, provider } = req.body as any;
      if (!name) return res.status(400).json({ error: "name is required" });
      const list = readApps();
      let id = slugify(name);
      // ensure unique
      let suffix = 2;
      while (list.find((a: any) => a.id === id)) { id = slugify(name) + "-" + suffix++; }
      const app: any = {
        id, name, url: url || "",
        provider: provider || "me",
        shortDescription: shortDescription || "",
        description: description || "",
        category: category || "",
        status: status || "draft",
        tags: Array.isArray(tags) ? tags : [],
        agentDeveloper: agentDeveloper || null,
        githubRepo: githubRepo || "",
        githubBranch: githubBranch || "main",
        deployPlatform: deployPlatform || null,
        otherDetails: otherDetails || "",
        healthStatus: "unknown",
        lastHealthCheck: null,
        createdAt: new Date().toISOString(),
      };
      list.push(app);
      writeApps(list);
      res.json(app);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  app.put("/api/apps/:id", (req, res) => {
    try {
      const list = readApps();
      const idx = list.findIndex((a: any) => a.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: "App not found" });
      const { name, url, shortDescription, description, category, status, tags, agentDeveloper, githubRepo, githubBranch, deployPlatform, otherDetails } = req.body as any;
      const existing = list[idx];
      list[idx] = {
        ...existing,
        name: name ?? existing.name,
        url: url ?? existing.url,
        shortDescription: shortDescription ?? existing.shortDescription,
        description: description ?? existing.description,
        category: category ?? existing.category,
        status: status ?? existing.status,
        tags: Array.isArray(tags) ? tags : existing.tags,
        agentDeveloper: agentDeveloper !== undefined ? (agentDeveloper || null) : existing.agentDeveloper,
        githubRepo: githubRepo ?? existing.githubRepo,
        githubBranch: githubBranch || existing.githubBranch,
        deployPlatform: deployPlatform !== undefined ? (deployPlatform || null) : existing.deployPlatform,
        otherDetails: otherDetails ?? existing.otherDetails,
        updatedAt: new Date().toISOString(),
      };
      writeApps(list);
      res.json(list[idx]);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  app.delete("/api/apps/:id", (req, res) => {
    try {
      const list = readApps();
      const idx = list.findIndex((a: any) => a.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: "App not found" });
      list.splice(idx, 1);
      writeApps(list);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  app.post("/api/apps/:id/check-health", async (req, res) => {
    try {
      const list = readApps();
      const app = list.find((a: any) => a.id === req.params.id);
      if (!app) return res.status(404).json({ error: "App not found" });
      if (!app.url) return res.status(400).json({ error: "App has no URL" });
      const start = Date.now();
      let healthy = false;
      let status = 0;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(app.url, { method: "GET", signal: controller.signal, redirect: "follow" });
        clearTimeout(timeout);
        status = resp.status;
        healthy = resp.ok;
      } catch { healthy = false; }
      const ms = Date.now() - start;
      const idx = list.findIndex((a: any) => a.id === req.params.id);
      if (idx !== -1) {
        list[idx].healthStatus = healthy ? "healthy" : "down";
        list[idx].lastHealthCheck = new Date().toISOString();
        writeApps(list);
      }
      res.json({ healthy, status, ms });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  // ─── API: Browse directories (for Lab project directory picker) ───
  app.get("/api/browse-dirs", (req, res) => {
    const home = homedir();
    const requestedPath = (req.query.path as string) || home;
    const resolved = requestedPath.startsWith("~") ? requestedPath.replace("~", home) : requestedPath;
    try {
      const entries = readdirSync(resolved, { withFileTypes: true });
      const dirs = entries
        .filter(e => e.isDirectory() && !e.name.startsWith("."))
        .map(e => e.name)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      const tilePath = resolved.startsWith(home) ? resolved.replace(home, "~") : resolved;
      res.json({ path: tilePath, dirs });
    } catch {
      res.status(400).json({ error: "Cannot read directory" });
    }
  });

  // ─── API: Install xbar plugin (macOS only) ──────────────────────
  app.post("/api/install-xbar", (_req, res) => {
    if (process.platform !== "darwin") return res.status(400).json({ error: "macOS only" });
    try {
      const src = join(opts.baseDir, "scripts", "xbar-myagent.5s.sh");
      const destDir = join(homedir(), "Library", "Application Support", "xbar", "plugins");
      mkdirSync(destDir, { recursive: true });
      const dest = join(destDir, "myagent.5s.sh");
      copyFileSync(src, dest);
      // Make executable
      chmodSync(dest, 0o755);
      res.json({ ok: true, path: dest });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Dashboard ───────────────────────────────────────────────
  let _dashboardCache: { data: any; ts: number } | null = null;
  const DASHBOARD_CACHE_MS = 10_000; // cache for 10 seconds

  app.get("/api/dashboard", (_req, res) => {
    const now = Date.now();
    if (_dashboardCache && (now - _dashboardCache.ts) < DASHBOARD_CACHE_MS) {
      return res.json({ ..._dashboardCache.data, uptime: process.uptime() });
    }

    const agents = Object.entries(opts.config.agents)
      .map(([id, agent]) => {
      const memoryDir = agent.memoryDir ? resolve(opts.baseDir, agent.memoryDir) : join(getPersonalAgentsDir(), id, "memory");
      const logPath = join(memoryDir, "conversation_log.jsonl");

      let messageCount = 0;
      let lastMessage = "never";
      let sessionActive = false;

      if (existsSync(logPath)) {
        try {
          const stat = statSync(logPath);
          if (stat.size > 0) {
            // Read only the last 16KB to get the last line instead of the entire file
            const fd = openSync(logPath, "r");
            const readSize = Math.min(stat.size, 16384);
            const buf = Buffer.alloc(readSize);
            readSync(fd, buf, 0, readSize, stat.size - readSize);
            closeSync(fd);
            const chunk = buf.toString("utf-8");
            const lines = chunk.trim().split("\n").filter(Boolean);
            if (lines.length > 0) {
              const last = JSON.parse(lines[lines.length - 1]);
              lastMessage = last.ts;
            }
            // Estimate line count from file size (avg ~200 bytes/line)
            messageCount = Math.max(1, Math.round(stat.size / 200));
          }
        } catch { /* ignore */ }
      }

      try {
        const files = readdirSync(memoryDir);
        sessionActive = files.some(f => f.startsWith("session") && f.endsWith(".json"));
      } catch { /* ignore */ }

      // Resolve agentHome
      const home = homedir();
      const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
      const agentHome = agent.agentHome
        ? resolveTilde(agent.agentHome)
        : agent.memoryDir ? resolve(opts.baseDir, agent.memoryDir, "..") : join(getPersonalAgentsDir(), id);

      // Task counts
      let taskCounts: Record<string, number> = { proposed: 0, approved: 0, in_progress: 0, review: 0, done: 0 };
      const tasksPath = join(agentHome, "tasks.json");
      if (existsSync(tasksPath)) {
        try {
          const tasksData = JSON.parse(readFileSync(tasksPath, "utf-8"));
          for (const t of tasksData.tasks || []) {
            if (taskCounts.hasOwnProperty(t.status)) taskCounts[t.status]++;
          }
        } catch { /* ignore */ }
      }

      return {
        id,
        name: agent.name,
        description: agent.description,
        persistent: agent.persistent ?? false,
        perSenderSessions: agent.perSenderSessions ?? false,
        mcps: agent.mcps || [],
        skills: agent.skills || [],
        agentSkills: agent.agentSkills || [],
        aliases: agent.mentionAliases || [],
        routes: (agent.routes || []).map(r => `${r.channel}:${r.match.value}`),
        messageCount,
        lastMessage,
        sessionActive,
        workspace: agent.workspace,
        streaming: agent.streaming ?? false,
        advancedMemory: agent.advancedMemory ?? true,
        autonomousCapable: agent.autonomousCapable ?? true,
        autoCommit: agent.autoCommit ?? false,
        timeout: agent.timeout ?? 14400000,
        tools: agent.allowedTools,
        org: agent.org || [],
        cron: agent.cron || [],
        goals: agent.goals || [],
        activeGoals: (agent.goals || []).filter(g => g.enabled).length,
        activeCron: (agent.cron || []).filter((c: any) => c.enabled !== false).length,
        agentHome,
        claudeAccount: agent.claudeAccount || null,
        agentClass: agent.agentClass || (agent.platformAgent ? "platform" : "standard"),
        taskCounts,
        subAgents: agent.subAgents || null,
        avatar: (agent as any).avatar || null,
        boardEnabled: agent.boardEnabled || false,
        boardLayout: agent.boardLayout || null,
        executor: agent.executor || null,
        wiki: agent.wiki || false,
        wikiSync: agent.wikiSync || null,
        shared: (agent as any).shared || false,
        conversationLogMode: (agent as any).conversationLogMode || "shared",
        imageSupport: (agent as any).imageSupport !== false,
      };
    });

    const channels = Object.entries(opts.config.channels)
      .filter(([, c]) => c.enabled)
      .map(([id]) => id);

    // Find default group agent: explicit config > first with subAgents > hub
    const defaultGroupAgent = (opts.config as any).defaultAgent
      || (opts.config.service as any).defaultGroupAgent
      || Object.entries(opts.config.agents).find(([, a]) => a.subAgents)?.[0]
      || (opts.config.agents["hub"] ? "hub" : null);

    const result = {
      status: "running",
      uptime: process.uptime(),
      channels,
      agents,
      mcpCount: Object.keys(opts.config.mcps || {}).length,
      claudeAccounts: Object.keys(opts.config.service.claudeAccounts || {}),
      defaultGroupAgent,
    };

    _dashboardCache = { data: result, ts: Date.now() };
    res.json(result);
  });

  // ─── Legacy dashboard redirect ────────────────────────────────────
  app.get("/dashboard-legacy", (_req, res) => {
    res.redirect("/ui");
  });

  // ─── API: Agent list (for marketplace assign modal) ───────────────
  app.get("/api/agents", (req, res) => {
    const agents = Object.entries(opts.config.agents)
      .map(([id, agent]) => ({
        id,
        name: agent.name || id,
        skills: agent.skills || [],
        agentClass: agent.agentClass || (agent.platformAgent ? "platform" : "standard"),
        shared: (agent as any).shared ?? false,
        conversationLogMode: (agent as any).conversationLogMode ?? "shared",
      }));
    res.json({ agents });
  });

  // ─── API: Platform agents (creator agents for Lab) ────────────────
  app.get("/api/platform-agents", (_req, res) => {
    const agents = Object.entries(opts.config.agents)
      .filter(([, agent]) => (agent.agentClass || (agent.platformAgent ? "platform" : "standard")) === "platform")
      .map(([id, agent]) => ({
        id,
        name: agent.name || id,
        description: agent.description || "",
        streaming: agent.streaming ?? false,
      }));
    res.json({ agents });
  });

  // GET /api/agents/board-enabled — list agents eligible for boards
  // NOTE: Must be registered BEFORE /api/agents/:id to avoid Express treating "board-enabled" as an :id param
  app.get("/api/agents/board-enabled", (_req, res) => {
    const result: Array<{ agentId: string; name: string; description: string; avatar: string | null; boardLayout?: string; agentClass?: string; goals?: any[]; cron?: any[] }> = [];
    for (const [agentId, agent] of Object.entries(opts.config.agents)) {
      if (agent.boardEnabled || agent.agentClass === "board") {
        result.push({
          agentId,
          name: agent.name,
          description: agent.description || "",
          avatar: agent.avatar || null,
          boardLayout: agent.boardLayout,
          agentClass: agent.agentClass,
          goals: (agent.goals || []).map((g: any) => ({ id: g.id, description: g.description, enabled: g.enabled })),
          cron: (agent.cron || []).map((c: any, i: number) => ({ index: i, schedule: c.schedule, message: c.message, enabled: c.enabled !== false })),
        });
      }
    }
    res.json(result);
  });

  // ─── API: Agent detail ────────────────────────────────────────────
  app.get("/api/agents/:id", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const memoryDir = resolve(opts.baseDir, agent.memoryDir);
    const logPath = join(memoryDir, "conversation_log.jsonl");

    let recentMessages: any[] = [];
    if (existsSync(logPath)) {
      try {
        const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
        recentMessages = lines.slice(-50).map(l => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
      } catch { /* ignore */ }
    }

    res.json({
      id: req.params.id,
      config: {
        name: agent.name,
        description: agent.description,
        persistent: agent.persistent,
        perSenderSessions: agent.perSenderSessions,
        mcps: agent.mcps,
        skills: agent.skills,
        aliases: agent.mentionAliases,
        workspace: agent.workspace,
        tools: agent.allowedTools,
        shared: (agent as any).shared ?? false,
        conversationLogMode: (agent as any).conversationLogMode ?? "shared",
        agentHome: agent.agentHome,
      },
      recentMessages,
    });
  });

  // ─── API: Agent instructions (CLAUDE.md) ─────────────────────────
  app.get("/api/agents/:id/instructions", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;

    // Find CLAUDE.md path
    let claudeMdPath: string;
    if (agent.claudeMd) {
      claudeMdPath = resolveTilde(agent.claudeMd);
    } else {
      const agentHome = agent.agentHome
        ? resolveTilde(agent.agentHome)
        : resolve(opts.baseDir, agent.memoryDir, "..");
      claudeMdPath = join(agentHome, "CLAUDE.md");
    }

    let instructions = "";
    if (existsSync(claudeMdPath)) {
      try {
        instructions = readFileSync(claudeMdPath, "utf-8");
      } catch { /* ignore */ }
    }

    // Also read heartbeat.md if present
    const agentHome2 = agent.agentHome
      ? resolveTilde(agent.agentHome)
      : resolve(opts.baseDir, agent.memoryDir, "..");
    const heartbeatMdPath = join(agentHome2, "heartbeat.md");
    let heartbeatInstructions = "";
    if (existsSync(heartbeatMdPath)) {
      try {
        heartbeatInstructions = readFileSync(heartbeatMdPath, "utf-8");
      } catch { /* ignore */ }
    }

    res.json({ instructions, heartbeatInstructions, path: claudeMdPath });
  });

  // ─── API: Chat with agent ─────────────────────────────────────────
  app.post("/api/chat/:agentId", async (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const { text, accountOverride, senderId: senderIdBody } = req.body as { text?: string; accountOverride?: string; senderId?: string };
    if (!text?.trim()) return res.status(400).json({ error: "Missing 'text' in body" });

    const effectiveAgent = accountOverride
      ? { ...agent, claudeAccount: accountOverride }
      : agent;

    log.info(`[WebUI Chat] ${agentId} <- web: ${text.slice(0, 80)}${accountOverride ? ` (account: ${accountOverride})` : ''}`);

    const syntheticMsg: InboundMessage = {
      id: `web-${Date.now()}`,
      channel: "web",
      chatId: "web-ui",
      chatType: "dm",
      sender: senderIdBody || "web-user",
      senderName: "Web UI",
      text,
      timestamp: Date.now(),
      isFromMe: false,
      isGroup: false,
      raw: { type: "web-ui" },
    };

    const route: ResolvedRoute = {
      agentId,
      agentConfig: effectiveAgent,
      route: effectiveAgent.routes[0],
    };

    try {
      // If agent has streaming enabled, use streaming executor but collect full response
      if (agent.streaming) {
        let fullResponse = "";
        for await (const event of executeAgentStreaming(route, syntheticMsg, opts.baseDir, opts.config.mcps, opts.config.service.claudeAccounts, undefined, { skills: opts.config.defaultSkills, mcps: opts.config.defaultMcps, prompts: opts.config.defaultPrompts, promptTrigger: opts.config.promptTrigger })) {
          if (event.type === "text") fullResponse += event.data;
          else if (event.type === "done" && event.data && !fullResponse) fullResponse = event.data;
          else if (event.type === "error") {
            res.status(500).json({ error: event.data });
            return;
          }
        }
        log.info(`[WebUI Chat] ${agentId} -> web: ${fullResponse.slice(0, 80)}`);
        res.json({ ok: true, response: fullResponse });
      } else {
        const response = await executeAgent(route, syntheticMsg, opts.baseDir, opts.config.mcps, opts.config.service.claudeAccounts, { skills: opts.config.defaultSkills, mcps: opts.config.defaultMcps, prompts: opts.config.defaultPrompts, promptTrigger: opts.config.promptTrigger });
        log.info(`[WebUI Chat] ${agentId} -> web: ${response.slice(0, 80)}`);
        res.json({ ok: true, response });
      }
    } catch (err) {
      log.error(`[WebUI Chat] ${agentId} error: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Chat with agent (reconnectable streaming) ──────────────
  // POST starts a job, returns jobId. GET streams events with reconnect support.

  app.post("/api/chat/:agentId/stream", async (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const { text, accountOverride, senderId: senderIdStream } = req.body as { text?: string; accountOverride?: string; senderId?: string };
    if (!text?.trim()) return res.status(400).json({ error: "Missing 'text' in body" });

    // If this tab has a targetAgentId, route to that agent instead
    let routeAgentId = agentId;
    if (senderIdStream) {
      const tabData = readSessionTabs(agentId);
      const tab = tabData.tabs.find((t: any) => t.id === senderIdStream);
      if (tab?.targetAgentId && opts.config.agents[tab.targetAgentId]) {
        routeAgentId = tab.targetAgentId;
        log.info(`[WebUI Stream] Tab "${senderIdStream}" has targetAgentId="${routeAgentId}" — routing there instead of "${agentId}"`);
      }
    }
    const routeAgent = opts.config.agents[routeAgentId];

    // Apply account override from web UI dropdown.
    // Track last-used account per agent so we only force a new session on the
    // actual transition, not on every subsequent message with the same override.
    const effectiveAccount = accountOverride || routeAgent.claudeAccount || "";
    const lastAccount = agentLastAccount.get(routeAgentId) || (routeAgent.claudeAccount || "");
    const accountChanged = effectiveAccount !== lastAccount;
    if (effectiveAccount) agentLastAccount.set(routeAgentId, effectiveAccount);

    const effectiveAgent = accountOverride
      ? { ...routeAgent, claudeAccount: accountOverride, ...(accountChanged ? { forceNewSession: true } : {}) }
      : routeAgent;

    log.info(`[WebUI Stream] ${routeAgentId} <- web: ${text.slice(0, 80)}${accountOverride ? ` (account: ${accountOverride})` : ''}`);

    // Create job
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const abortCtrl = new AbortController();
    const job: StreamJob = { events: [], rawLines: [], rawListeners: new Set(), done: false, stopped: false, createdAt: Date.now(), listeners: new Set(), abort: abortCtrl };
    jobStore.set(jobId, job);

    const pushEvent = (data: string) => {
      const idx = job.events.length;
      job.events.push({ idx, data });
      for (const cb of job.listeners) cb(idx);
    };

    // Return jobId immediately so frontend can connect to stream
    res.json({ jobId });

    // Run agent in background
    const syntheticMsg: InboundMessage = {
      id: `web-${Date.now()}`,
      channel: "web",
      chatId: "web-ui",
      chatType: "dm",
      sender: senderIdStream || "web-user",
      senderName: "Web UI",
      text,
      timestamp: Date.now(),
      isFromMe: false,
      isGroup: false,
      raw: { type: "web-ui" },
    };

    const route: ResolvedRoute = {
      agentId: routeAgentId,
      agentConfig: effectiveAgent,
      route: effectiveAgent.routes[0],
    };

    const pushRawLine = (line: string) => {
      const idx = job.rawLines.length;
      job.rawLines.push(line);
      for (const cb of job.rawListeners) cb(idx);
    };

    (async () => {
      // Heartbeat every 30s so frontend knows the agent is still alive
      const heartbeat = setInterval(() => {
        if (!job.done && !job.stopped) {
          pushEvent(JSON.stringify({ type: "heartbeat" }));
        } else {
          clearInterval(heartbeat);
        }
      }, 30_000);
      try {
        for await (const event of executeAgentStreaming(route, syntheticMsg, opts.baseDir, opts.config.mcps, opts.config.service.claudeAccounts, pushRawLine, { skills: opts.config.defaultSkills, mcps: opts.config.defaultMcps, prompts: opts.config.defaultPrompts, promptTrigger: opts.config.promptTrigger }, abortCtrl.signal)) {
          if (job.stopped) break;
          pushEvent(JSON.stringify(event));
        }
      } catch (err) {
        if (!job.stopped) pushEvent(JSON.stringify({ type: "error", data: String(err) }));
      } finally {
        clearInterval(heartbeat);
        if (!job.done) {
          pushEvent("[DONE]");
          job.done = true;
        }
      }
    })();
  });

  // GET: Stream events for a job, supports reconnect via ?after=N
  app.get("/api/chat/jobs/:jobId/stream", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      log.warn(`[SSE] Job not found: ${req.params.jobId}`);
      return res.status(404).json({ error: "Job not found" });
    }

    const after = parseInt(req.query.after as string) || 0;
    const connId = `sse-${Date.now().toString(36)}`;
    log.debug(`[SSE:${connId}] Connected to job ${req.params.jobId} after=${after} events=${job.events.length} done=${job.done}`);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    if (res.socket) res.socket.setNoDelay(true);

    let closed = false;
    req.on("close", () => {
      closed = true;
      log.debug(`[SSE:${connId}] Client disconnected (req close event)`);
    });

    // Send any buffered events the client missed
    let cursor = after;
    for (let i = after; i < job.events.length; i++) {
      if (closed) {
        log.debug(`[SSE:${connId}] Client closed during buffer replay at event ${i}`);
        return;
      }
      res.write(`id: ${job.events[i].idx}\ndata: ${job.events[i].data}\n\n`);
      cursor = i + 1;
    }
    if (cursor > after) {
      log.debug(`[SSE:${connId}] Replayed ${cursor - after} buffered events`);
    }

    // If job already done and we've sent everything, close
    if (job.done && cursor >= job.events.length) {
      log.debug(`[SSE:${connId}] Job already done, closing after replay`);
      res.end();
      return;
    }

    // Otherwise listen for new events (5s keepalive prevents browser background throttling)
    let keepaliveCount = 0;
    const keepalive = setInterval(() => {
      if (closed) { clearInterval(keepalive); return; }
      try {
        res.write(`: keepalive\n\n`);
        keepaliveCount++;
      } catch (err) {
        log.debug(`[SSE:${connId}] Keepalive write failed after ${keepaliveCount} keepalives: ${err}`);
        closed = true;
      }
    }, 5_000);

    const onEvent = (idx: number) => {
      if (closed) {
        log.debug(`[SSE:${connId}] Event ${idx} arrived but client already closed`);
        cleanup();
        return;
      }
      const evt = job.events[idx];
      if (!evt) return;
      try {
        res.write(`id: ${evt.idx}\ndata: ${evt.data}\n\n`);
        if (evt.data === "[DONE]") {
          log.debug(`[SSE:${connId}] [DONE] sent, closing. Total events: ${idx + 1}, keepalives: ${keepaliveCount}`);
          cleanup();
          res.end();
        }
      } catch (err) {
        log.debug(`[SSE:${connId}] Event write failed at idx ${idx}: ${err}`);
        closed = true;
        cleanup();
      }
    };

    const cleanup = () => {
      clearInterval(keepalive);
      job.listeners.delete(onEvent);
    };

    job.listeners.add(onEvent);
    req.on("close", cleanup);
  });

  // ─── API: Stop a streaming job ────────────────────────────────────
  app.post("/api/chat/jobs/:jobId/stop", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.done) return res.json({ ok: true, already: true });

    job.stopped = true;
    job.done = true;

    // Kill the underlying claude -p child process
    if (job.abort) job.abort.abort();

    // Push a stopped event then [DONE] so connected SSE clients finalize
    const pushEvent = (data: string) => {
      const idx = job.events.length;
      job.events.push({ idx, data });
      for (const cb of job.listeners) cb(idx);
    };
    pushEvent(JSON.stringify({ type: "stopped", data: "Stopped by user" }));
    pushEvent("[DONE]");

    log.info(`[WebUI] Job ${req.params.jobId} stopped by user`);
    res.json({ ok: true });
  });

  // ─── API: Recover lost exchange after service restart ───────────────
  // Browser POSTs the user message + streamed response back when it detects
  // a 404 (job not found = service restarted before log was written).
  app.post("/api/agents/:agentId/recover", (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const { userText, response, ts } = req.body as { userText?: string; response?: string; ts?: string };
    if (!userText?.trim() && !response?.trim()) {
      return res.status(400).json({ error: "Must provide userText or response" });
    }

    const memoryDir = resolve(opts.baseDir, agent.memoryDir);
    const logPath = join(memoryDir, "conversation_log.jsonl");
    try {
      mkdirSync(memoryDir, { recursive: true });
      const entry = {
        ts: ts || new Date().toISOString(),
        from: "web-user",
        text: userText || "",
        response: (response || "").slice(0, 2000),
        agentId,
        channel: "web",
        recovered: true,
      };
      appendFileSync(logPath, JSON.stringify(entry) + "\n");
      log.info(`[WebUI] Recovered exchange for ${agentId} (${(response || "").length} chars)`);
      res.json({ ok: true });
    } catch (err) {
      log.warn(`[WebUI] Failed to write recovery log: ${err}`);
      res.status(500).json({ error: "Failed to write recovery log" });
    }
  });

  // ─── API: Marketplace ──────────────────────────────────────────────

  // scan-skills must be BEFORE the :type catch-all to avoid being matched as type="scan-skills"
  app.get("/api/marketplace/scan-skills", (req, res) => {
    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const scanDir = req.query.dir
      ? resolveTilde(req.query.dir as string)
      : join(home, ".claude", "commands");

    if (!existsSync(scanDir)) {
      return res.status(404).json({ error: `Directory not found: ${scanDir}` });
    }

    const registryPath = join(opts.baseDir, "registry", "skills.json");
    const existingIds = new Set<string>();
    try {
      const data = JSON.parse(readFileSync(registryPath, "utf-8"));
      for (const s of (data.skills || [])) existingIds.add(s.id);
    } catch { /* registry may not exist yet */ }

    let files: any[] = [];
    try {
      const mdFiles = readdirSync(scanDir).filter((f: string) => f.endsWith(".md"));
      for (const file of mdFiles) {
        const id = file.replace(".md", "");
        if (existingIds.has(id)) continue;
        const filePath = join(scanDir, file);
        const content = readFileSync(filePath, "utf-8");
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        let name = id.replace(/[_-]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
        let description = "";
        if (fmMatch) {
          for (const line of fmMatch[1].split("\n")) {
            const [k, ...rest] = line.split(":");
            if (k?.trim() === "name") name = rest.join(":").trim();
            if (k?.trim() === "description") description = rest.join(":").trim();
          }
        }
        files.push({ id, filename: file, path: filePath, name, description });
      }
    } catch (err) {
      return res.status(500).json({ error: `Failed to scan directory: ${err}` });
    }

    res.json({ dir: scanDir, files });
  });

  app.get("/api/marketplace/:type", (req, res) => {
    const { type } = req.params;
    if (!["mcps", "skills", "agents", "prompts", "apps"].includes(type)) {
      return res.status(400).json({ error: "type must be mcps, skills, agents, prompts, or apps" });
    }

    // Apps: PersonalRegistry/apps.json (user's own) + registry/platform-apps.json (committed platform apps)
    if (type === "apps") {
      const personalAppsPath = join(getPersonalRegistryDir(opts.config), "apps.json");
      const platformAppsPath = join(opts.baseDir, "registry", "platform-apps.json");
      try {
        const personalApps: any[] = existsSync(personalAppsPath)
          ? JSON.parse(readFileSync(personalAppsPath, "utf-8")) as any[]
          : [];
        const platformApps: any[] = existsSync(platformAppsPath)
          ? JSON.parse(readFileSync(platformAppsPath, "utf-8")) as any[]
          : [];
        const allApps = [...platformApps, ...personalApps];
        const items = allApps.map((app: any) => {
          const agentId = app.agentDeveloper || null;
          const agentAlias = agentId && opts.config.agents[agentId]
            ? (opts.config.agents[agentId] as any).mentionAliases?.[0] || `@${agentId}`
            : agentId ? `@${agentId}` : null;
          return {
            ...app,
            provider: app.provider || "me",
            installed: true,
            assignedTo: agentId ? [agentId] : [],
            agentAlias,
          };
        });
        return res.json({ items });
      } catch {
        return res.status(500).json({ error: "Failed to read apps registry" });
      }
    }

    // Platform items from registry/{type}.json (committed), personal from PersonalRegistry/{type}.json (outside repo)
    const registryPath = join(opts.baseDir, "registry", `${type}.json`);
    const personalRegistryPath = join(getPersonalRegistryDir(opts.config), `${type}.json`);
    const source = (req.query.source as string) || "";

    let platformEntries: any[] = [];
    let personalEntries: any[] = [];
    try {
      if (existsSync(registryPath)) {
        const data = JSON.parse(readFileSync(registryPath, "utf-8"));
        platformEntries = data[type] || [];
      }
    } catch {
      return res.status(500).json({ error: "Failed to read registry" });
    }
    try {
      if (existsSync(personalRegistryPath)) {
        const personalData = JSON.parse(readFileSync(personalRegistryPath, "utf-8"));
        personalEntries = personalData[type] || [];
      }
    } catch { /* ignore missing personal file */ }

    // source=personal → only personal registry items (Library)
    // source=platform → only platform registry items (Marketplace)
    // no source → merged (backward compat)
    let entries: any[];
    const personalIds = new Set(personalEntries.map((e: any) => e.id));
    if (source === "personal") {
      entries = personalEntries;
    } else if (source === "platform") {
      entries = platformEntries;
    } else {
      entries = [...platformEntries.filter((e: any) => !personalIds.has(e.id)), ...personalEntries];
    }

    if (entries.length === 0 && !existsSync(registryPath) && !existsSync(personalRegistryPath)) {
      return res.json({ items: [] });
    }

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const personalSkillsDir = join(resolveTilde(getPersonalAgentsDir(opts.config)), "skills");
    const personalPromptsDir = join(resolveTilde(getPersonalAgentsDir(opts.config)), "prompts");
    const claudeCommandsDir = join(home, ".claude", "commands");

    const items = entries.map((entry: any) => {
      let installed = false;
      const assignedTo: string[] = [];

      if (type === "skills") {
        const id = entry.id;
        const isPlatformSkill = entry.source === "agenticledger/platform";
        const localPathExists = entry.localPath && existsSync(join(opts.baseDir, entry.localPath));
        installed = isPlatformSkill
          ? localPathExists
          : existsSync(join(personalSkillsDir, `${id}.md`))
            || existsSync(join(claudeCommandsDir, `${id}.md`))
            || !!localPathExists;
        for (const [agentId, agent] of Object.entries(opts.config.agents)) {
          if ((agent as any).skills?.includes(id)) assignedTo.push(agentId);
        }
      } else if (type === "prompts") {
        const id = entry.id;
        const isPlatformPrompt = entry.source === "agenticledger/platform";
        const localPathExists = entry.localPath && existsSync(join(opts.baseDir, entry.localPath));
        installed = isPlatformPrompt
          ? localPathExists
          : existsSync(join(personalPromptsDir, `${id}.md`)) || !!localPathExists;
        for (const [agentId, agent] of Object.entries(opts.config.agents)) {
          if ((agent as any).prompts?.includes(id)) assignedTo.push(agentId);
        }
      } else if (type === "mcps") {
        installed = personalIds.has(entry.id) || !!(opts.config.mcps as any)?.[entry.id];
        for (const [agentId, agent] of Object.entries(opts.config.agents)) {
          if ((agent as any).mcps?.includes(entry.id)) assignedTo.push(agentId);
        }
      } else if (type === "agents") {
        const draftsPath = join(opts.baseDir, "registry", "installed-drafts.json");
        let drafts: string[] = [];
        try {
          drafts = JSON.parse(readFileSync(draftsPath, "utf-8")).drafts.map((d: any) => d.id);
        } catch { /* ignore */ }
        installed = existsSync(join(opts.baseDir, "agents", entry.id))
          || drafts.includes(entry.id)
          || !!opts.config.agents[entry.id];
      }

      let isPlatformDefault = false;
      if (type === "skills") {
        isPlatformDefault = !!(opts.config.defaultSkills?.includes(entry.id));
      } else if (type === "mcps") {
        isPlatformDefault = !!(opts.config.defaultMcps?.includes(entry.id));
      } else if (type === "prompts") {
        isPlatformDefault = !!(opts.config.defaultPrompts?.includes(entry.id));
      }

      return { ...entry, provider: entry.provider || "AgenticLedger", installed, assignedTo, isPlatformDefault };
    });

    res.json({ items });
  });

  app.post("/api/marketplace/install", (req, res) => {
    const { type, id } = req.body as { type?: string; id?: string };
    if (!type || !id) return res.status(400).json({ error: "Missing type or id" });

    const registryPath = join(opts.baseDir, "registry", `${type}s.json`);
    if (!existsSync(registryPath)) return res.status(404).json({ error: "Registry not found" });

    let entry: any;
    try {
      const data = JSON.parse(readFileSync(registryPath, "utf-8"));
      const key = type === "mcp" ? "mcps" : type === "skill" ? "skills" : type === "prompt" ? "prompts" : "agents";
      entry = (data[key] || []).find((e: any) => e.id === id);
    } catch {
      return res.status(500).json({ error: "Failed to read registry" });
    }
    if (!entry) return res.status(404).json({ error: `${type} "${id}" not found in registry` });

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;

    try {
      if (type === "skill") {
        const destDir = join(resolveTilde(getPersonalAgentsDir(opts.config)), "skills");
        mkdirSync(destDir, { recursive: true });
        const srcPath = isAbsolute(entry.localPath) ? entry.localPath : join(opts.baseDir, entry.localPath);
        const destPath = join(destDir, `${id}.md`);
        if (!existsSync(srcPath)) return res.status(500).json({ error: `Source file not found: ${entry.localPath}` });
        copyFileSync(srcPath, destPath);
        log.info(`[Marketplace] Installed skill ${id} → ${destPath}`);

      } else if (type === "prompt") {
        const destDir = join(resolveTilde(getPersonalAgentsDir(opts.config)), "prompts");
        mkdirSync(destDir, { recursive: true });
        const srcPath = isAbsolute(entry.localPath) ? entry.localPath : join(opts.baseDir, entry.localPath);
        const destPath = join(destDir, `${id}.md`);
        if (!existsSync(srcPath)) return res.status(500).json({ error: `Source file not found: ${entry.localPath}` });
        copyFileSync(srcPath, destPath);
        log.info(`[Marketplace] Installed prompt ${id} → ${destPath}`);

      } else if (type === "mcp") {
        const configPath = configFilePath();
        const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
        if (!rawConfig.mcps) rawConfig.mcps = {};

        if (entry.fetch?.type === "http") {
          rawConfig.mcps[id] = { type: "http", url: entry.fetch.url, headers: {} };
          writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
          if (!(opts.config as any).mcps) (opts.config as any).mcps = {};
          (opts.config as any).mcps[id] = { type: "http", url: entry.fetch.url, headers: {} };
          log.info(`[Marketplace] Installed MCP ${id} (http)`);

        } else if (entry.fetch?.type === "npm") {
          execSync(`npm install ${entry.fetch.package}`, { cwd: opts.baseDir, timeout: 30_000 });
          rawConfig.mcps[id] = { type: "stdio", command: "npx", args: entry.fetch.args || ["-y", entry.fetch.package], env: {} };
          writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
          if (!(opts.config as any).mcps) (opts.config as any).mcps = {};
          (opts.config as any).mcps[id] = rawConfig.mcps[id];
          log.info(`[Marketplace] Installed MCP ${id} (npm: ${entry.fetch.package})`);
        }

      } else if (type === "agent") {
        const srcDir = join(opts.baseDir, entry.localPath);
        const destDir = join(opts.baseDir, "agents", id);
        if (existsSync(srcDir)) {
          mkdirSync(destDir, { recursive: true });
          for (const file of readdirSync(srcDir)) {
            copyFileSync(join(srcDir, file), join(destDir, file));
          }
        } else {
          mkdirSync(join(destDir, "memory"), { recursive: true });
          writeFileSync(join(destDir, "CLAUDE.md"), `# ${entry.name}\n\n${entry.description}\n`);
          writeFileSync(join(destDir, "agent.json"), JSON.stringify({ id, name: entry.name, draft: true, version: "1.0.0", created: new Date().toISOString() }, null, 2));
        }
        const draftsPath = join(opts.baseDir, "registry", "installed-drafts.json");
        let draftsData: { drafts: any[] } = { drafts: [] };
        try { draftsData = JSON.parse(readFileSync(draftsPath, "utf-8")); } catch { /* fresh */ }
        if (!draftsData.drafts.find((d: any) => d.id === id)) {
          draftsData.drafts.push({ id, name: entry.name, installedAt: new Date().toISOString() });
          writeFileSync(draftsPath, JSON.stringify(draftsData, null, 2));
        }
        log.info(`[Marketplace] Installed agent template ${id} → draft`);
      }

      const requiresKeys = type === "mcp" && (entry.requiredKeys?.length > 0);
      res.json({ ok: true, item: { ...entry, installed: true }, requiresKeys });

    } catch (err) {
      log.error(`[Marketplace] Install failed for ${type}/${id}: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Toggle platform default for skill or MCP ──────────────
  app.post("/api/marketplace/platform-default", (req, res) => {
    const { type, id, enabled } = req.body as { type?: string; id?: string; enabled?: boolean };
    if (!type || !id || typeof enabled !== "boolean") {
      return res.status(400).json({ error: "Missing type, id, or enabled" });
    }
    if (!["skill", "mcp", "prompt"].includes(type)) {
      return res.status(400).json({ error: "type must be skill, mcp, or prompt" });
    }

    const configPath = configFilePath();
    let rawConfig: any;
    try {
      rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      return res.status(500).json({ error: "Failed to read config.json" });
    }

    const field = type === "skill" ? "defaultSkills" : type === "mcp" ? "defaultMcps" : "defaultPrompts";
    if (!rawConfig[field]) rawConfig[field] = [];

    if (enabled) {
      if (!rawConfig[field].includes(id)) rawConfig[field].push(id);
    } else {
      rawConfig[field] = rawConfig[field].filter((x: string) => x !== id);
    }

    try {
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
      (opts.config as any)[field] = rawConfig[field];
      log.info(`[Marketplace] ${enabled ? "Set" : "Unset"} platform default: ${type}/${id}`);
      res.json({ ok: true, id, type, enabled });
    } catch {
      return res.status(500).json({ error: "Failed to write config.json" });
    }
  });

  app.post("/api/marketplace/assign", (req, res) => {
    const { type, id, agentIds } = req.body as { type?: string; id?: string; agentIds?: string[] };
    if (!type || !id || !Array.isArray(agentIds) || agentIds.length === 0) {
      return res.status(400).json({ error: "Missing type, id, or agentIds" });
    }

    const configPath = configFilePath();
    let rawConfig: any;
    try {
      rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      return res.status(500).json({ error: "Failed to read config.json" });
    }

    const missingKeys: string[] = [];

    for (const agentId of agentIds) {
      if (!rawConfig.agents[agentId]) continue;

      if (type === "skill") {
        if (!rawConfig.agents[agentId].skills) rawConfig.agents[agentId].skills = [];
        if (!rawConfig.agents[agentId].skills.includes(id)) {
          rawConfig.agents[agentId].skills.push(id);
        }
        if (!(opts.config.agents[agentId] as any).skills) (opts.config.agents[agentId] as any).skills = [];
        if (!(opts.config.agents[agentId] as any).skills.includes(id)) {
          (opts.config.agents[agentId] as any).skills.push(id);
        }

      } else if (type === "prompt") {
        if (!rawConfig.agents[agentId].prompts) rawConfig.agents[agentId].prompts = [];
        if (!rawConfig.agents[agentId].prompts.includes(id)) {
          rawConfig.agents[agentId].prompts.push(id);
        }
        if (!(opts.config.agents[agentId] as any).prompts) (opts.config.agents[agentId] as any).prompts = [];
        if (!(opts.config.agents[agentId] as any).prompts.includes(id)) {
          (opts.config.agents[agentId] as any).prompts.push(id);
        }

      } else if (type === "mcp") {
        if (!rawConfig.agents[agentId].mcps) rawConfig.agents[agentId].mcps = [];
        if (!rawConfig.agents[agentId].mcps.includes(id)) {
          rawConfig.agents[agentId].mcps.push(id);
        }
        if (!(opts.config.agents[agentId] as any).mcps) (opts.config.agents[agentId] as any).mcps = [];
        if (!(opts.config.agents[agentId] as any).mcps.includes(id)) {
          (opts.config.agents[agentId] as any).mcps.push(id);
        }
        const home = homedir();
        const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
        const agentCfg = opts.config.agents[agentId] as any;
        const agentHome = agentCfg.agentHome
          ? resolveTilde(agentCfg.agentHome)
          : join(resolveTilde(agentCfg.memoryDir || ""), "..");
        const keyFile = join(agentHome, "mcp-keys", `${id}.env`);
        if (!existsSync(keyFile)) {
          missingKeys.push(agentId);
          mkdirSync(join(agentHome, "mcp-keys"), { recursive: true });
          writeFileSync(keyFile, "");
        }
      }
    }

    try {
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
    } catch (err) {
      return res.status(500).json({ error: `Failed to write config: ${err}` });
    }

    log.info(`[Marketplace] Assigned ${type}/${id} to agents: ${agentIds.join(", ")}`);
    res.json({ ok: true, assigned: agentIds, missingKeys });
  });

  // (scan-skills route moved above :type catch-all — see line ~1000)

  // ─── API: Marketplace — import personal skills ───────────────────
  app.post("/api/marketplace/import-skills", (req, res) => {
    const { files } = req.body as { files?: Array<{ id: string; path: string; name: string; description: string }> };
    if (!files?.length) return res.status(400).json({ error: "No files provided" });

    const home = homedir();
    const commandsDir = join(home, ".claude", "commands");
    const personalDir = join(opts.baseDir, "registry", "skills", "personal");
    mkdirSync(personalDir, { recursive: true });

    const registryPath = join(getPersonalRegistryDir(opts.config), "skills.json");
    let registryData: any = { skills: [] };
    try { registryData = JSON.parse(readFileSync(registryPath, "utf-8")); } catch { /* fresh */ }

    const imported: any[] = [];
    for (const file of files) {
      const isInCommandsDir = file.path.startsWith(commandsDir);
      let localPath: string;
      if (isInCommandsDir) {
        localPath = file.path; // absolute reference — no copy needed
      } else {
        const dest = join(personalDir, `${file.id}.md`);
        copyFileSync(file.path, dest);
        localPath = `registry/skills/personal/${file.id}.md`;
      }
      const entry = {
        id: file.id,
        name: file.name,
        provider: "me",
        description: file.description,
        category: "personal",
        verified: false,
        source: "local",
        tags: ["personal"],
        localPath,
        fetch: { type: "file" },
      };
      registryData.skills = registryData.skills.filter((s: any) => s.id !== file.id);
      registryData.skills.push(entry);
      imported.push(entry);
    }

    writeFileSync(registryPath, JSON.stringify(registryData, null, 2));
    log.info(`[Marketplace] Imported ${imported.length} personal skills`);
    res.json({ ok: true, imported });
  });

  // ─── API: Marketplace — scan local prompts dir ───────────────────
  // ─── API: Marketplace — create personal prompt ───────────────────
  app.post("/api/marketplace/create-prompt", (req, res) => {
    const { id, name, description, content } = req.body as { id?: string; name?: string; description?: string; content?: string };
    if (!id || !name || !content) return res.status(400).json({ error: "id, name, and content are required" });

    const registryPersonalDir = join(opts.baseDir, "registry", "prompts", "personal");
    mkdirSync(registryPersonalDir, { recursive: true });

    const localPath = `registry/prompts/personal/${id}.md`;
    const filePath = join(opts.baseDir, localPath);
    const fileContent = `---\nname: ${name}\ndescription: ${description || ""}\n---\n\n${content}\n`;
    writeFileSync(filePath, fileContent);

    const registryPath = join(getPersonalRegistryDir(opts.config), "prompts.json");
    let registryData: any = { prompts: [] };
    try { registryData = JSON.parse(readFileSync(registryPath, "utf-8")); } catch { /* fresh */ }
    registryData.prompts = registryData.prompts.filter((p: any) => p.id !== id);
    registryData.prompts.push({
      id, name, provider: "me", description: description || "",
      category: "personal", source: "personal", tags: [],
      localPath, fetch: { type: "file" },
    });
    writeFileSync(registryPath, JSON.stringify(registryData, null, 2));
    log.info(`[Marketplace] Created personal prompt: ${id}`);
    res.json({ ok: true, id });
  });

  // ─── API: Import from SaaS export folder ─────────────────────────
  app.post("/api/import-from-folder", async (req, res) => {
    const { folderPath, preview } = req.body as { folderPath?: string; preview?: boolean };
    if (!folderPath) return res.status(400).json({ error: "folderPath is required" });

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const absFolder = resolveTilde(folderPath);

    if (!existsSync(absFolder)) return res.status(400).json({ error: `Folder not found: ${folderPath}` });

    // Helper: parse frontmatter from a .md file
    const parseMd = (mdPath: string): { name: string; description: string; body: string } => {
      const raw = readFileSync(mdPath, "utf-8");
      const fm = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!fm) return { name: "", description: "", body: raw };
      const attrs: Record<string, string> = {};
      fm[1].split("\n").forEach(line => {
        const m = line.match(/^(\w+):\s*(.*)$/);
        if (m) attrs[m[1]] = m[2].trim();
      });
      return { name: attrs.name || "", description: attrs.description || "", body: fm[2].trim() };
    };

    type FoundItem = { type: "skill" | "prompt" | "agent"; id: string; name: string; description: string; folderPath: string; contentFile: string };
    const found: FoundItem[] = [];

    // Scan a candidate directory: look for meta.json + content file
    const scanItemDir = (dir: string): FoundItem | null => {
      const metaPath = join(dir, "meta.json");
      if (!existsSync(metaPath)) return null;
      let meta: any = {};
      try { meta = JSON.parse(readFileSync(metaPath, "utf-8")); } catch { return null; }

      const skillMd = join(dir, "skill.md");
      const promptMd = join(dir, "prompt.md");
      const claudeMd = join(dir, "CLAUDE.md");

      let type: "skill" | "prompt" | "agent" | null = null;
      let contentFile = "";

      if (existsSync(skillMd)) { type = "skill"; contentFile = skillMd; }
      else if (existsSync(promptMd)) { type = "prompt"; contentFile = promptMd; }
      else if (existsSync(claudeMd)) { type = "agent"; contentFile = claudeMd; }

      if (!type) return null;

      const id = meta.id || basename(dir);
      const name = meta.name || id;
      const description = meta.description || "";
      return { type, id, name, description, folderPath: dir, contentFile };
    };

    // Check if the folder itself is a single item
    const direct = scanItemDir(absFolder);
    if (direct) {
      found.push(direct);
    } else {
      // Multi-item: scan skills/*, prompts/*, agents/* subdirs
      for (const sub of ["skills", "prompts", "agents"]) {
        const subDir = join(absFolder, sub);
        if (!existsSync(subDir)) continue;
        try {
          for (const entry of readdirSync(subDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const item = scanItemDir(join(subDir, entry.name));
            if (item) found.push(item);
          }
        } catch { /* skip unreadable */ }
      }
    }

    if (!found.length) return res.status(400).json({ error: "No importable items found in that folder. Expected meta.json + skill.md / prompt.md / CLAUDE.md." });

    if (preview) return res.json({ items: found.map(i => ({ type: i.type, id: i.id, name: i.name, description: i.description })) });

    // ── Import ─────────────────────────────────────────────────────
    const imported: any[] = [];
    const errors: string[] = [];

    const skillRegistryPath = join(getPersonalRegistryDir(opts.config), "skills.json");
    let skillRegistry: any = { skills: [] };
    try { skillRegistry = JSON.parse(readFileSync(skillRegistryPath, "utf-8")); } catch { /* fresh */ }

    const promptRegistryPath = join(getPersonalRegistryDir(opts.config), "prompts.json");
    let promptRegistry: any = { prompts: [] };
    try { promptRegistry = JSON.parse(readFileSync(promptRegistryPath, "utf-8")); } catch { /* fresh */ }

    let registriesDirty = false;

    for (const item of found) {
      try {
        if (item.type === "skill") {
          const parsed = parseMd(item.contentFile);
          const name = item.name || parsed.name || item.id;
          const description = item.description || parsed.description;
          const skillDir = join(opts.baseDir, "registry", "skills", "personal");
          mkdirSync(skillDir, { recursive: true });
          const destPath = join(skillDir, `${item.id}.md`);
          const fileContent = `---\nname: ${name}\ndescription: ${description}\n---\n\n${parsed.body || readFileSync(item.contentFile, "utf-8")}\n`;
          writeFileSync(destPath, fileContent);
          const localPath = `registry/skills/personal/${item.id}.md`;
          skillRegistry.skills = skillRegistry.skills.filter((s: any) => s.id !== item.id);
          skillRegistry.skills.push({ id: item.id, name, provider: "saas", description, category: "personal", verified: false, source: "saas", tags: ["saas"], localPath, fetch: { type: "file" } });
          registriesDirty = true;
          imported.push({ type: "skill", id: item.id, name });

        } else if (item.type === "prompt") {
          const parsed = parseMd(item.contentFile);
          const name = item.name || parsed.name || item.id;
          const description = item.description || parsed.description;
          const promptDir = join(opts.baseDir, "registry", "prompts", "personal");
          mkdirSync(promptDir, { recursive: true });
          const localPath = `registry/prompts/personal/${item.id}.md`;
          const destPath = join(opts.baseDir, localPath);
          const fileContent = `---\nname: ${name}\ndescription: ${description}\n---\n\n${parsed.body || readFileSync(item.contentFile, "utf-8")}\n`;
          writeFileSync(destPath, fileContent);
          promptRegistry.prompts = promptRegistry.prompts.filter((p: any) => p.id !== item.id);
          promptRegistry.prompts.push({ id: item.id, name, provider: "saas", description, category: "personal", source: "saas", tags: ["saas"], localPath, fetch: { type: "file" } });
          registriesDirty = true;
          imported.push({ type: "prompt", id: item.id, name });

        } else if (item.type === "agent") {
          let meta: any = {};
          try { meta = JSON.parse(readFileSync(join(item.folderPath, "meta.json"), "utf-8")); } catch { /* use defaults */ }
          const agentId = item.id;
          const agentName = item.name;

          if (opts.config.agents[agentId]) {
            errors.push(`Agent "${agentId}" already exists — skipped`);
            continue;
          }
          // Derive alias — ensure uniqueness
          let alias = meta.mentionAlias || `@${agentId}`;
          if (!alias.startsWith("@")) alias = `@${alias}`;
          const allAliases = Object.values(opts.config.agents).flatMap((a: any) => a.mentionAliases || []);
          if (allAliases.includes(alias)) alias = `@${agentId}-imported`;

          const paDir = getPersonalAgentsDir();
          const agentHome = join(paDir, agentId);
          const memoryDir = join(agentHome, "memory");
          mkdirSync(memoryDir, { recursive: true });
          mkdirSync(join(agentHome, "mcp-keys"), { recursive: true });
          mkdirSync(join(agentHome, "skills"), { recursive: true });
          mkdirSync(join(agentHome, "FileStorage", "Temp"), { recursive: true });
          mkdirSync(join(agentHome, "FileStorage", "Permanent"), { recursive: true });

          const claudeMdContent = readFileSync(item.contentFile, "utf-8");
          writeFileSync(join(agentHome, "CLAUDE.md"), claudeMdContent);
          writeFileSync(join(agentHome, "tasks.json"), JSON.stringify({ agentId, projects: [{ id: "general", name: "General", color: "#6b7280" }], tasks: [] }, null, 2));
          writeFileSync(join(memoryDir, "context.md"), `# ${agentName} Context\n\nImported from SaaS on ${new Date().toISOString().split("T")[0]}.\n`);

          const paDirTilde = paDir.startsWith(home) ? paDir.replace(home, "~") : paDir;
          const agentCfg: any = {
            name: agentName,
            description: item.description || `Imported agent ${agentName}`,
            agentHome: `${paDirTilde}/${agentId}`,
            workspace: meta.workspace || "~",
            claudeMd: `${paDirTilde}/${agentId}/CLAUDE.md`,
            memoryDir: `${paDirTilde}/${agentId}/memory`,
            persistent: meta.persistent ?? true,
            streaming: meta.streaming ?? true,
            advancedMemory: meta.advancedMemory ?? true,
            mentionAliases: [alias],
            allowedTools: meta.allowedTools || ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
            timeout: meta.timeout || 14400000,
            agentClass: meta.agentClass || "standard",
          };
          (opts.config.agents as any)[agentId] = agentCfg;
          const rawConfig = JSON.parse(readFileSync(configFilePath(), "utf-8"));
          rawConfig.agents = rawConfig.agents || {};
          rawConfig.agents[agentId] = agentCfg;
          writeFileSync(configFilePath(), JSON.stringify(rawConfig, null, 2));

          imported.push({ type: "agent", id: agentId, name: agentName });
        }
      } catch (err: any) {
        errors.push(`${item.type} "${item.id}": ${err.message}`);
      }
    }

    if (registriesDirty) {
      writeFileSync(skillRegistryPath, JSON.stringify(skillRegistry, null, 2));
      writeFileSync(promptRegistryPath, JSON.stringify(promptRegistry, null, 2));
    }

    log.info(`[Import] Imported ${imported.length} items from ${folderPath}`);
    res.json({ ok: true, imported, errors });
  });

  // ─── API: Skills — create skill ──────────────────────────────────
  app.post("/api/skills/create", (req, res) => {
    const { id, name, description, content, scope, orgName, agentId } = req.body as {
      id?: string; name?: string; description?: string; content?: string;
      scope?: string; orgName?: string; agentId?: string;
    };
    if (!id || !name || !description || !content || !scope) {
      return res.status(400).json({ error: "id, name, description, content, and scope are required" });
    }
    if (scope === "org" && !orgName) return res.status(400).json({ error: "orgName is required when scope is 'org'" });
    if (scope === "agent" && !agentId) return res.status(400).json({ error: "agentId is required when scope is 'agent'" });
    if (!["global", "personal", "org", "agent"].includes(scope)) {
      return res.status(400).json({ error: "scope must be one of: global, personal, org, agent" });
    }

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    let filePath: string;
    let localPath: string;
    let source: string;

    switch (scope) {
      case "global":
        filePath = join(home, ".claude", "commands", `${id}.md`);
        localPath = `~/.claude/commands/${id}.md`;
        source = "global";
        break;
      case "personal":
        filePath = join(getPersonalAgentsDir(opts.config), "skills", `${id}.md`);
        localPath = `${getPersonalAgentsDir(opts.config)}/skills/${id}.md`;
        source = "personal";
        break;
      case "org":
        filePath = join(getPersonalAgentsDir(opts.config), orgName!, "skills", `${id}.md`);
        localPath = `${getPersonalAgentsDir(opts.config)}/${orgName}/skills/${id}.md`;
        source = `org:${orgName}`;
        break;
      case "agent": {
        const agent = opts.config.agents[agentId!];
        if (!agent) return res.status(400).json({ error: `Agent '${agentId}' not found` });
        const agentHome = agent.agentHome
          ? resolveTilde(agent.agentHome)
          : resolve(opts.baseDir, agent.memoryDir, "..");
        filePath = join(agentHome, "skills", `${id}.md`);
        localPath = `${agent.agentHome || join(opts.baseDir, agent.memoryDir, "..")}/skills/${id}.md`;
        source = `agent:${agentId}`;
        break;
      }
      default:
        return res.status(400).json({ error: "Invalid scope" });
    }

    mkdirSync(dirname(filePath), { recursive: true });
    const fileContent = `---\nname: ${name}\ndescription: ${description}\n---\n\n${content}\n`;
    writeFileSync(filePath, fileContent);

    // Update PersonalRegistry/skills.json
    const registryPath = join(getPersonalRegistryDir(opts.config), "skills.json");
    let registryData: any = { skills: [] };
    try { registryData = JSON.parse(readFileSync(registryPath, "utf-8")); } catch { /* fresh */ }
    registryData.skills = registryData.skills.filter((s: any) => s.id !== id);
    registryData.skills.push({
      id, name, provider: "me", description,
      category: "custom", source, tags: [],
      localPath, fetch: { type: "file" },
    });
    writeFileSync(registryPath, JSON.stringify(registryData, null, 2));
    log.info(`[Skills] Created ${scope} skill: ${id} at ${filePath}`);
    res.json({ ok: true, id, path: filePath, scope });
  });

  // ─── API: Get/set prompt trigger character ───────────────────────
  app.get("/api/marketplace/prompt-trigger", (_req, res) => {
    res.json({ trigger: opts.config.promptTrigger || "!" });
  });

  app.post("/api/marketplace/prompt-trigger", (req, res) => {
    const { trigger } = req.body as { trigger?: string };
    if (!trigger || trigger.length !== 1) return res.status(400).json({ error: "trigger must be a single character" });
    const configPath = configFilePath();
    try {
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      rawConfig.promptTrigger = trigger;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
      (opts.config as any).promptTrigger = trigger;
      log.info(`[Marketplace] Prompt trigger set to: ${trigger}`);
      res.json({ ok: true, trigger });
    } catch {
      res.status(500).json({ error: "Failed to write config.json" });
    }
  });

  // ─── API: Marketplace — add custom MCP ───────────────────────────
  app.post("/api/marketplace/add-mcp", (req, res) => {
    const { id, name, description, mcpType, url, command, args, env: envVars } = req.body as {
      id?: string; name?: string; description?: string; mcpType?: string;
      url?: string; command?: string; args?: string[]; env?: Record<string, string>;
    };
    if (!id || !name || !mcpType) return res.status(400).json({ error: "Missing id, name, or mcpType" });

    const configPath = configFilePath();
    const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    if (!rawConfig.mcps) rawConfig.mcps = {};

    let mcpEntry: any;
    if (mcpType === "http") {
      if (!url) return res.status(400).json({ error: "URL required for HTTP MCP" });
      mcpEntry = { type: "http", url, headers: {} };
    } else {
      if (!command) return res.status(400).json({ error: "Command required for stdio MCP" });
      mcpEntry = { type: "stdio", command, args: args || [], env: envVars || {} };
    }

    rawConfig.mcps[id] = mcpEntry;
    writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
    if (!(opts.config as any).mcps) (opts.config as any).mcps = {};
    (opts.config as any).mcps[id] = mcpEntry;

    const personalMcpRegistryPath = join(getPersonalRegistryDir(opts.config), "mcps.json");
    let registryData: any = { mcps: [] };
    try { registryData = JSON.parse(readFileSync(personalMcpRegistryPath, "utf-8")); } catch { /* fresh */ }
    registryData.mcps = registryData.mcps.filter((m: any) => m.id !== id);
    registryData.mcps.push({
      id, name, provider: "me", description: description || "",
      category: "personal", verified: false, source: "local",
      tags: ["personal"], requiredKeys: [],
      fetch: mcpType === "http" ? { type: "http", url } : { type: "local", command, args: args || [] },
    });
    writeFileSync(personalMcpRegistryPath, JSON.stringify(registryData, null, 2));

    log.info(`[Marketplace] Added personal MCP: ${id}`);
    res.json({ ok: true });
  });

  // ─── API: Raw log stream for a job (tail -f style) ──────────────
  app.get("/api/chat/jobs/:jobId/raw", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const after = parseInt(req.query.after as string) || 0;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    if (res.socket) res.socket.setNoDelay(true);

    let closed = false;
    req.on("close", () => { closed = true; });

    // Send buffered raw lines
    for (let i = after; i < job.rawLines.length; i++) {
      if (closed) return;
      res.write(`data: ${job.rawLines[i]}\n\n`);
    }

    if (job.done && after >= job.rawLines.length) {
      res.write(`data: [DONE]\n\n`);
      res.end();
      return;
    }

    const keepalive = setInterval(() => {
      if (closed) { clearInterval(keepalive); return; }
      try { res.write(`: keepalive\n\n`); } catch { closed = true; }
    }, 5_000);

    const onRaw = (idx: number) => {
      if (closed) { cleanup(); return; }
      try {
        res.write(`data: ${job.rawLines[idx]}\n\n`);
      } catch { closed = true; cleanup(); }
    };

    const cleanup = () => {
      clearInterval(keepalive);
      job.rawListeners.delete(onRaw);
    };

    job.rawListeners.add(onRaw);
    req.on("close", cleanup);

    // If job finishes while connected, send done and close
    const checkDone = () => {
      if (job.done && !closed) {
        closed = true;
        try { res.write(`data: [DONE]\n\n`); } catch {}
        cleanup();
        try { res.end(); } catch {}
      }
    };
    // Piggyback on the regular event listener to detect done
    const onEvent = () => { if (job.done) checkDone(); };
    job.listeners.add(onEvent);
    req.on("close", () => job.listeners.delete(onEvent));
  });

  // ─── API: Upload file ────────────────────────────────────────────
  // Accepts multipart form data with file + mode (temp/permanent)
  app.post("/api/upload/:agentId", async (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    // Parse raw body as multipart — Express 5 doesn't have built-in multipart
    // We'll use a simple approach: read chunks from the request
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const body = Buffer.concat(chunks);

    // Extract boundary from content-type
    const contentType = req.headers["content-type"] || "";
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) return res.status(400).json({ error: "Missing multipart boundary" });

    const boundary = boundaryMatch[1];
    const parts = body.toString("binary").split(`--${boundary}`).filter(p => p.includes("Content-Disposition"));

    let fileName = "";
    let fileData: Buffer | null = null;
    let mode = "temp";

    for (const part of parts) {
      const headerEnd = part.indexOf("\r\n\r\n");
      if (headerEnd < 0) continue;
      const header = part.slice(0, headerEnd);
      const content = part.slice(headerEnd + 4).replace(/\r\n$/, "");

      if (header.includes('name="mode"')) {
        mode = content.trim();
      } else if (header.includes('name="file"')) {
        const fnMatch = header.match(/filename="([^"]+)"/);
        fileName = fnMatch ? fnMatch[1] : `upload-${Date.now()}`;
        fileData = Buffer.from(content, "binary");
      }
    }

    if (!fileData || !fileName) return res.status(400).json({ error: "No file in request" });

    // Save to agent's own folder
    const agentHome = agent.agentHome || resolve(opts.baseDir, agent.memoryDir, "..");
    const storageDir = join(agentHome, "FileStorage", mode === "permanent" ? "Permanent" : "Temp");
    mkdirSync(storageDir, { recursive: true });

    const savePath = join(storageDir, fileName);
    writeFileSync(savePath, fileData);

    log.info(`[Upload] ${agentId}: ${fileName} (${fileData.length} bytes, ${mode}) → ${savePath}`);

    res.json({
      ok: true,
      path: savePath,
      fileName,
      size: fileData.length,
      mode,
    });
  });

  // ─── API: Upload file (JSON/base64 — for MCP / programmatic use) ─
  app.post("/api/upload/:agentId/json", (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const { fileName, base64Content, mode = "temp" } = req.body as any;
    if (!fileName || !base64Content) return res.status(400).json({ error: "fileName and base64Content required" });

    const fileData = Buffer.from(base64Content, "base64");
    const agentHome = agent.agentHome || resolve(opts.baseDir, agent.memoryDir, "..");
    const storageDir = join(agentHome, "FileStorage", mode === "permanent" ? "Permanent" : "Temp");
    mkdirSync(storageDir, { recursive: true });

    const savePath = join(storageDir, fileName);
    writeFileSync(savePath, fileData);

    log.info(`[Upload/JSON] ${agentId}: ${fileName} (${fileData.length} bytes, ${mode}) → ${savePath}`);

    res.json({ ok: true, path: savePath, fileName, size: fileData.length, mode });
  });

  // ─── API: List agent files ──────────────────────────────────────
  app.get("/api/agents/:agentId/files", (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const agentHome = agent.agentHome
      ? resolveTilde(agent.agentHome)
      : resolve(opts.baseDir, agent.memoryDir, "..");
    const workspace = agent.workspace ? resolveTilde(agent.workspace) : agentHome;

    // Scan FileStorage dirs + workspace root for downloadable files
    const files: Array<{ name: string; path: string; size: number; modified: string; source: string }> = [];

    const scanDir = (dir: string, source: string, recursive = false, rootDir?: string) => {
      if (!existsSync(dir)) return;
      const root = rootDir || dir;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const fullPath = join(dir, entry.name);
          if (entry.isFile()) {
            try {
              const stat = statSync(fullPath);
              const rel = fullPath.slice(root.length + 1); // relative path within storage folder
              files.push({
                name: entry.name,
                path: fullPath,
                size: stat.size,
                modified: stat.mtime.toISOString(),
                source,
                ...(rel !== entry.name ? { folder: rel.slice(0, rel.length - entry.name.length - 1) } : {}),
              });
            } catch { /* skip */ }
          } else if (entry.isDirectory() && recursive) {
            scanDir(fullPath, source, true, root);
          }
        }
      } catch { /* skip */ }
    };

    // FileStorage (always scan)
    scanDir(join(agentHome, "FileStorage", "Temp"), "temp", true);
    scanDir(join(agentHome, "FileStorage", "Permanent"), "permanent", true);

    // Sort by modified descending
    files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    res.json({ ok: true, files });
  });

  // ─── API: Download agent file ─────────────────────────────────
  app.get("/api/agents/:agentId/download", (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const rawFilePath = req.query.path as string;
    if (!rawFilePath) return res.status(400).json({ error: "Missing 'path' query parameter" });

    // Security: resolve and validate the path is within allowed directories
    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const agentHome = agent.agentHome
      ? resolveTilde(agent.agentHome)
      : resolve(opts.baseDir, agent.memoryDir, "..");
    const workspace = agent.workspace ? resolveTilde(agent.workspace) : agentHome;

    // Resolve relative paths (e.g., "FileStorage/Temp/file.csv") against agent home
    const filePath = rawFilePath.startsWith("/") || rawFilePath.startsWith("~")
      ? rawFilePath
      : join(agentHome, rawFilePath);

    const resolvedPath = resolve(resolveTilde(filePath));
    const resolvedAgentHome = resolve(agentHome);
    const resolvedWorkspace = resolve(workspace);

    // Must be within agent home, workspace, or any agent's home (for cross-agent file access)
    let isAllowed = resolvedPath.startsWith(resolvedAgentHome) ||
                    resolvedPath.startsWith(resolvedWorkspace);
    if (!isAllowed) {
      // Check if file is within any other agent's home directory
      for (const [, otherAgent] of Object.entries(opts.config.agents)) {
        const otherHome = otherAgent.agentHome ? resolve(resolveTilde(otherAgent.agentHome)) : "";
        if (otherHome && resolvedPath.startsWith(otherHome)) {
          isAllowed = true;
          break;
        }
      }
    }
    if (!isAllowed) {
      return res.status(403).json({ error: "File path outside allowed directories" });
    }

    if (!existsSync(resolvedPath)) {
      return res.status(404).json({ error: "File not found" });
    }

    try {
      const stat = statSync(resolvedPath);
      if (!stat.isFile()) return res.status(400).json({ error: "Not a file" });
    } catch {
      return res.status(404).json({ error: "Cannot access file" });
    }

    const fileName = basename(resolvedPath);
    const ext = extname(fileName).toLowerCase();

    // Content type mapping
    const contentTypes: Record<string, string> = {
      ".csv": "text/csv",
      ".json": "application/json",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".pdf": "application/pdf",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".xls": "application/vnd.ms-excel",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".html": "text/html",
      ".zip": "application/zip",
    };

    const isInline = req.query.inline === "true";
    res.setHeader("Content-Disposition", `${isInline ? "inline" : "attachment"}; filename="${fileName}"`);
    res.setHeader("Content-Type", contentTypes[ext] || "application/octet-stream");

    log.info(`[Download] ${agentId}: ${fileName} from ${resolvedPath}`);
    try {
      const content = readFileSync(resolvedPath);
      res.send(content);
    } catch {
      if (!res.headersSent) res.status(404).json({ error: "File send failed" });
    }
  });

  // ─── API: Create agent ──────────────────────────────────────────
  app.post("/api/agents", async (req, res) => {
    const { agentId, name, description, alias, workspace, persistent, streaming, advancedMemory, autonomousCapable, autoCommit, autoCommitBranch, timeout, skills, agentSkills, prompts, tools, mcps, routes, org, cron, goals, instructions, claudeAccount, subAgents, heartbeatInstructions, heartbeatCron, heartbeatEnabled, agentClass, executor, wiki, wikiSync, shared, conversationLogMode, avatar, boardEnabled, boardLayout } = req.body as {
      agentId?: string; name?: string; description?: string; alias?: string;
      workspace?: string; persistent?: boolean; streaming?: boolean; advancedMemory?: boolean;
      autonomousCapable?: boolean; autoCommit?: boolean; autoCommitBranch?: string; timeout?: number;
      skills?: string[]; agentSkills?: string[]; prompts?: string[];
      tools?: string[]; mcps?: string[];
      routes?: Array<{ channel: string; chatId: string; requireMention?: boolean; allowFrom?: string[] }>;
      org?: Array<{ organization: string; function: string; title: string; reportsTo?: string }>;
      cron?: Array<{ schedule: string; message: string; channel: string; chatId: string; enabled?: boolean }>;
      goals?: Array<{ id: string; enabled: boolean; description: string; successCriteria?: string; instructions?: string; heartbeat: string; budget?: { maxDailyUsd: number }; reportTo?: string }>;
      instructions?: string;
      claudeAccount?: string;
      subAgents?: string[] | "*";
      heartbeatInstructions?: string;
      heartbeatCron?: string;
      heartbeatEnabled?: boolean;
      agentClass?: "standard" | "platform" | "builder" | "board";
      executor?: string;
      wiki?: boolean;
      wikiSync?: { enabled?: boolean; schedule?: string };
      shared?: boolean;
      conversationLogMode?: "shared" | "per-user";
      avatar?: string;
      boardEnabled?: boolean;
      boardLayout?: "small" | "medium" | "large";
    };

    if (!agentId || !name || !alias) {
      return res.status(400).json({ error: "Missing required fields: agentId, name, alias" });
    }

    // Validate agentId format
    if (!/^[a-z0-9-]+$/.test(agentId)) {
      return res.status(400).json({ error: "agentId must be lowercase alphanumeric with hyphens" });
    }

    // Enforce agent cap for Lite edition
    const edition = (opts.config.service as any).edition || "pro";
    const maxAgents = (opts.config.service as any).maxAgents || 0;
    if (edition === "lite" && maxAgents > 0) {
      const currentCount = Object.keys(opts.config.agents).length;
      if (currentCount >= maxAgents) {
        return res.status(403).json({
          error: `Agent limit reached (${maxAgents}). Upgrade to MyAIforOne Pro for unlimited agents.`,
          upgradeRequired: true,
        });
      }
    }

    // Check for duplicate
    if (opts.config.agents[agentId]) {
      return res.status(409).json({ error: `Agent "${agentId}" already exists` });
    }

    // Check alias uniqueness
    const allAliases = Object.values(opts.config.agents).flatMap(a => a.mentionAliases || []);
    const normalAlias = alias.startsWith("@") ? alias : `@${alias}`;
    if (allAliases.includes(normalAlias)) {
      return res.status(409).json({ error: `Alias "${normalAlias}" is already in use` });
    }

    try {
      // Create agent directory — shared agents go under SharedAgents/<org>/<agentId> or SharedAgents/<agentId>
      const orgName = org?.[0]?.organization;
      const baseDir = shared ? getSharedAgentsDir(opts.config) : getPersonalAgentsDir();
      const agentHome = orgName ? join(baseDir, orgName, agentId) : join(baseDir, agentId);
      const memoryDir = join(agentHome, "memory");
      mkdirSync(memoryDir, { recursive: true });
      mkdirSync(join(agentHome, "mcp-keys"), { recursive: true });
      mkdirSync(join(agentHome, "skills"), { recursive: true });
      mkdirSync(join(agentHome, "FileStorage", "Temp"), { recursive: true });
      mkdirSync(join(agentHome, "FileStorage", "Permanent"), { recursive: true });

      // Write tasks.json
      const tasksJson = {
        agentId,
        projects: [{ id: "general", name: "General", color: "#6b7280" }],
        tasks: [],
      };
      writeFileSync(join(agentHome, "tasks.json"), JSON.stringify(tasksJson, null, 2));

      // Write CLAUDE.md
      const claudeMd = instructions
        ? instructions
        : `# ${name}\n\n${description || "General-purpose agent."}\n\n## Identity\n- Mention alias: ${normalAlias}\n- Respond when mentioned with ${normalAlias}\n\n## Guidelines\n- Keep responses concise — you're replying to phone messages\n- If a task requires multiple steps, summarize what you did\n- If you need clarification, ask\n`;
      writeFileSync(join(agentHome, "CLAUDE.md"), claudeMd);

      // Write heartbeat.md if provided
      if (heartbeatInstructions) {
        writeFileSync(join(agentHome, "heartbeat.md"), heartbeatInstructions);
      }

      // Write context.md
      writeFileSync(join(memoryDir, "context.md"), `# ${name} Context\n\nCreated ${new Date().toISOString().split("T")[0]}.\n`);

      // Build config entry — use ~ prefix for portability in config.json
      const cfgBaseDir = shared ? getSharedAgentsDir(opts.config) : getPersonalAgentsDir();
      const cfgBaseDirTilde = cfgBaseDir.startsWith(homedir()) ? cfgBaseDir.replace(homedir(), "~") : cfgBaseDir;
      const cfgAgentPath = orgName ? `${cfgBaseDirTilde}/${orgName}/${agentId}` : `${cfgBaseDirTilde}/${agentId}`;
      const agentConfig: any = {
        name,
        description: description || `Agent ${name}`,
        agentHome: cfgAgentPath,
        workspace: workspace || "~",
        claudeMd: `${cfgAgentPath}/CLAUDE.md`,
        memoryDir: `${cfgAgentPath}/memory`,
        persistent: persistent ?? true,
        streaming: streaming ?? true,
        advancedMemory: advancedMemory ?? true,
        autonomousCapable: autonomousCapable ?? true,
        mentionAliases: [normalAlias],
        autoCommit: autoCommit ?? false,
        allowedTools: tools || ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"],
        timeout: timeout || 14400000,
        agentClass: agentClass || "standard",
      };

      if (mcps && mcps.length > 0) agentConfig.mcps = mcps;
      if (skills && skills.length > 0) agentConfig.skills = skills;
      if (agentSkills && agentSkills.length > 0) agentConfig.agentSkills = agentSkills;
      if (prompts && prompts.length > 0) agentConfig.prompts = prompts;
      if (claudeAccount) agentConfig.claudeAccount = claudeAccount;
      if (autoCommitBranch) agentConfig.autoCommitBranch = autoCommitBranch;
      if (subAgents) agentConfig.subAgents = subAgents;
      if (org && org.length > 0) agentConfig.org = org;
      if (cron && cron.length > 0) agentConfig.cron = cron;
      if (goals && goals.length > 0) agentConfig.goals = goals;
      if (executor) agentConfig.executor = executor;
      if (wiki) agentConfig.wiki = true;
      if (wikiSync) agentConfig.wikiSync = { enabled: !!wikiSync.enabled, schedule: wikiSync.schedule || "0 0 * * *" };
      if (shared) agentConfig.shared = true;
      if (conversationLogMode) agentConfig.conversationLogMode = conversationLogMode;
      // Board config — board class agents are auto board-enabled
      if (boardEnabled || agentClass === "board") agentConfig.boardEnabled = true;
      if (boardLayout) agentConfig.boardLayout = boardLayout;

      // Avatar — use provided, or auto-assign a random unused one
      const usedAvatars = new Set(Object.values(opts.config.agents).map((a: any) => a.avatar).filter(Boolean));
      if (avatar) {
        agentConfig.avatar = avatar;
      } else {
        const allAvatarIds = Array.from({ length: 80 }, (_, i) => `avatar-${String(i + 1).padStart(2, "0")}`);
        const unused = allAvatarIds.filter(id => !usedAvatars.has(id));
        if (unused.length > 0) {
          agentConfig.avatar = unused[Math.floor(Math.random() * unused.length)];
        }
      }

      // Build routes
      agentConfig.routes = (routes || []).map(r => ({
        channel: r.channel,
        match: {
          type: r.channel === "slack" ? "channel_id" : "chat_id",
          value: r.chatId,
        },
        permissions: {
          allowFrom: r.allowFrom || ["*"],
          requireMention: r.requireMention ?? true,
        },
      }));

      // If no routes provided, add a default web route so agent is always reachable from Web UI
      if (agentConfig.routes.length === 0) {
        agentConfig.routes.push({
          channel: "web",
          match: { type: "channel_id", value: "web-ui" },
          permissions: { allowFrom: ["*"], requireMention: false },
        });
        log.info(`Agent ${agentId} created with default web route (no explicit routes provided)`);
      }

      // Update config.json
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      rawConfig.agents[agentId] = agentConfig;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Rebuild
      try {
        execSync("npm run build", { cwd: opts.baseDir, timeout: 30_000 });
      } catch (buildErr) {
        log.warn(`Build after agent creation failed: ${buildErr}`);
      }

      // Update in-memory config
      const resolveTildeHere = (p: string) => p.startsWith("~") ? p.replace("~", homedir()) : p;
      agentConfig.workspace = resolveTildeHere(agentConfig.workspace);
      agentConfig.claudeMd = resolveTildeHere(agentConfig.claudeMd);
      agentConfig.memoryDir = resolveTildeHere(agentConfig.memoryDir);
      agentConfig.timeout = 120_000;
      opts.config.agents[agentId] = agentConfig;

      log.info(`Agent created via Web UI: ${agentId} (${normalAlias})`);
      res.json({ ok: true, agentId, alias: normalAlias, home: agentHome });
    } catch (err) {
      log.error(`Failed to create agent: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Update agent ──────────────────────────────────────────
  app.put("/api/agents/:id", async (req, res) => {
    const agentId = req.params.id;
    if (!opts.config.agents[agentId]) {
      return res.status(404).json({ error: `Agent "${agentId}" not found` });
    }

    const { name, description, alias, workspace, persistent, streaming, advancedMemory, autonomousCapable, autoCommit, autoCommitBranch, timeout, skills, agentSkills, prompts, tools, mcps, routes, org, cron, goals, instructions, claudeAccount, subAgents, heartbeatInstructions, heartbeatCron, heartbeatEnabled, agentClass, executor, wiki, wikiSync, conversationLogMode, avatar, boardEnabled, boardLayout, imageSupport } = req.body as {
      name?: string; description?: string; alias?: string;
      workspace?: string; persistent?: boolean; streaming?: boolean; advancedMemory?: boolean;
      autonomousCapable?: boolean; autoCommit?: boolean; autoCommitBranch?: string; timeout?: number;
      skills?: string[]; agentSkills?: string[]; prompts?: string[];
      tools?: string[]; mcps?: string[];
      routes?: Array<{ channel: string; chatId: string; requireMention?: boolean; allowFrom?: string[] }>;
      org?: Array<{ organization: string; function: string; title: string; reportsTo?: string }>;
      cron?: Array<{ schedule: string; message: string; channel: string; chatId: string; enabled?: boolean }>;
      goals?: Array<{ id: string; enabled: boolean; description: string; successCriteria?: string; instructions?: string; heartbeat: string; budget?: { maxDailyUsd: number }; reportTo?: string }>;
      instructions?: string;
      claudeAccount?: string;
      subAgents?: string[] | "*";
      heartbeatInstructions?: string;
      heartbeatCron?: string;
      heartbeatEnabled?: boolean;
      agentClass?: "standard" | "platform" | "builder" | "board";
      executor?: string;
      wiki?: boolean;
      wikiSync?: { enabled?: boolean; schedule?: string };
      conversationLogMode?: "shared" | "per-user";
      avatar?: string;
      boardEnabled?: boolean;
      boardLayout?: "small" | "medium" | "large";
      imageSupport?: boolean;
    };

    if (!name || !alias) {
      return res.status(400).json({ error: "Missing required fields: name, alias" });
    }

    // Check alias uniqueness (excluding this agent)
    const allAliases = Object.entries(opts.config.agents)
      .filter(([id]) => id !== agentId)
      .flatMap(([, a]) => a.mentionAliases || []);
    const normalAlias = alias.startsWith("@") ? alias : `@${alias}`;
    if (allAliases.includes(normalAlias)) {
      return res.status(409).json({ error: `Alias "${normalAlias}" is already in use` });
    }

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const existing = rawConfig.agents[agentId];

      // Update fields
      existing.name = name;
      existing.description = description || existing.description;
      existing.mentionAliases = [normalAlias];
      if (workspace !== undefined) existing.workspace = workspace;
      if (persistent !== undefined) existing.persistent = persistent;
      if (streaming !== undefined) existing.streaming = streaming;
      if (advancedMemory !== undefined) existing.advancedMemory = advancedMemory;
      if (autonomousCapable !== undefined) existing.autonomousCapable = autonomousCapable;
      if (autoCommit !== undefined) existing.autoCommit = autoCommit;
      if (timeout !== undefined) existing.timeout = timeout;
      if (skills !== undefined) existing.skills = skills.length > 0 ? skills : undefined;
      if (agentSkills !== undefined) existing.agentSkills = agentSkills.length > 0 ? agentSkills : undefined;
      if (tools) existing.allowedTools = tools;
      if (mcps !== undefined) existing.mcps = mcps.length > 0 ? mcps : undefined;
      if (claudeAccount !== undefined) existing.claudeAccount = claudeAccount || undefined;
      if (autoCommitBranch !== undefined) existing.autoCommitBranch = autoCommitBranch || undefined;
      if (prompts !== undefined) existing.prompts = prompts.length > 0 ? prompts : undefined;
      if (subAgents !== undefined) existing.subAgents = subAgents;
      if (agentClass !== undefined) existing.agentClass = agentClass;
      if (executor !== undefined) existing.executor = executor || undefined;
      if (org !== undefined) existing.org = org;
      if (cron !== undefined) existing.cron = cron;
      if (goals !== undefined) existing.goals = goals;
      if (wiki !== undefined) existing.wiki = wiki;
      if (wikiSync !== undefined) existing.wikiSync = wikiSync ? { enabled: !!wikiSync.enabled, schedule: wikiSync.schedule || "0 0 * * *" } : undefined;
      if (conversationLogMode !== undefined) existing.conversationLogMode = conversationLogMode;
      if (avatar !== undefined) existing.avatar = avatar || undefined;
      if (boardEnabled !== undefined) existing.boardEnabled = boardEnabled || undefined;
      if (boardLayout !== undefined) existing.boardLayout = boardLayout || undefined;
      if (imageSupport !== undefined) existing.imageSupport = imageSupport === false ? false : undefined; // omit when true (true is default)
      // Board class agents are always board-enabled
      if (agentClass === "board") existing.boardEnabled = true;
      // Note: `shared` and `agentHome` cannot be changed after creation to prevent orphaning data.

      // Build routes if provided
      if (routes !== undefined) {
        existing.routes = routes.map(r => ({
          channel: r.channel,
          match: {
            type: r.channel === "slack" ? "channel_id" : "chat_id",
            value: r.chatId,
          },
          permissions: {
            allowFrom: r.allowFrom || ["*"],
            requireMention: r.requireMention ?? true,
          },
        }));
      }

      // Detect agentHome change — update path references in agent files
      const home0 = homedir();
      const rt0 = (p: string) => p.startsWith("~") ? p.replace("~", home0) : p;
      const oldHome = opts.config.agents[agentId]?.agentHome
        ? rt0(opts.config.agents[agentId].agentHome)
        : null;
      const newHome = existing.agentHome ? rt0(existing.agentHome) : null;
      if (oldHome && newHome && oldHome !== newHome) {
        // Update path references in CLAUDE.md and context.md
        for (const relFile of ["CLAUDE.md", "memory/context.md"]) {
          const filePath = join(newHome, relFile);
          if (existsSync(filePath)) {
            try {
              let content = readFileSync(filePath, "utf-8");
              // Replace both tilde and expanded forms of the old path
              const oldHomeTilde = oldHome.replace(home0, "~");
              if (content.includes(oldHome) || content.includes(oldHomeTilde)) {
                const newHomeTilde = newHome.replace(home0, "~");
                content = content.split(oldHome).join(newHome);
                content = content.split(oldHomeTilde).join(newHomeTilde);
                writeFileSync(filePath, content);
                log.info(`Updated path references in ${relFile} for ${agentId}: ${oldHomeTilde} → ${newHomeTilde}`);
              }
            } catch { /* ignore read/write errors */ }
          }
        }
      }

      rawConfig.agents[agentId] = existing;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Write CLAUDE.md if instructions provided
      if (instructions !== undefined) {
        const home2 = homedir();
        const resolveTilde2 = (p: string) => p.startsWith("~") ? p.replace("~", home2) : p;
        let claudeMdPath: string;
        if (existing.claudeMd) {
          claudeMdPath = resolveTilde2(existing.claudeMd);
        } else if (existing.agentHome) {
          claudeMdPath = join(resolveTilde2(existing.agentHome), "CLAUDE.md");
        } else if (existing.memoryDir) {
          claudeMdPath = join(resolve(resolveTilde2(existing.memoryDir), ".."), "CLAUDE.md");
        } else {
          claudeMdPath = join(getPersonalAgentsDir(), agentId, "CLAUDE.md");
        }
        try {
          writeFileSync(claudeMdPath, instructions);
          log.info(`Updated CLAUDE.md for ${agentId} at ${claudeMdPath}`);
        } catch (writeErr) {
          log.warn(`Failed to write CLAUDE.md for ${agentId}: ${writeErr}`);
        }
      }

      // Write heartbeat.md if provided
      if (heartbeatInstructions !== undefined) {
        const home3 = homedir();
        const resolveTilde3 = (p: string) => p.startsWith("~") ? p.replace("~", home3) : p;
        const agentHome3 = existing.agentHome
          ? resolveTilde3(existing.agentHome)
          : existing.memoryDir
            ? resolve(resolveTilde3(existing.memoryDir), "..")
            : join(getPersonalAgentsDir(), agentId);
        const hbPath = join(agentHome3, "heartbeat.md");
        try {
          if (heartbeatInstructions) {
            writeFileSync(hbPath, heartbeatInstructions);
            log.info(`Updated heartbeat.md for ${agentId}`);
          } else {
            // Empty string = remove heartbeat.md
            if (existsSync(hbPath)) {
              unlinkSync(hbPath);
              log.info(`Removed heartbeat.md for ${agentId}`);
            }
          }
        } catch (writeErr) {
          log.warn(`Failed to write heartbeat.md for ${agentId}: ${writeErr}`);
        }
      }

      // Rebuild
      try {
        execSync("npm run build", { cwd: opts.baseDir, timeout: 30_000 });
      } catch (buildErr) {
        log.warn(`Build after agent update failed: ${buildErr}`);
      }

      // Update in-memory config
      const home = homedir();
      const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
      const memAgent = { ...existing };
      memAgent.workspace = resolveTilde(memAgent.workspace || "~");
      if (memAgent.claudeMd) memAgent.claudeMd = resolveTilde(memAgent.claudeMd);
      if (memAgent.memoryDir) memAgent.memoryDir = resolveTilde(memAgent.memoryDir);
      memAgent.timeout = 120_000;
      opts.config.agents[agentId] = memAgent;

      log.info(`Agent updated via Web UI: ${agentId}`);
      res.json({ ok: true, agentId });
    } catch (err) {
      log.error(`Failed to update agent: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Delete agent ──────────────────────────────────────────
  app.delete("/api/agents/:id", async (req, res) => {
    const agentId = req.params.id;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    // Require confirmation alias in the request body
    const { confirmAlias } = (req.body || {}) as { confirmAlias?: string };
    const agentAlias = agent.mentionAliases?.[0] || agentId;
    if (!confirmAlias || confirmAlias !== agentAlias) {
      return res.status(400).json({
        error: `Confirmation required. Send { "confirmAlias": "${agentAlias}" } to confirm deletion.`,
        requiredAlias: agentAlias,
      });
    }

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      if (!rawConfig.agents[agentId]) {
        return res.status(404).json({ error: `Agent "${agentId}" not in config.json` });
      }

      // Resolve agentHome for directory cleanup
      const home = homedir();
      const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
      const agentEntry = rawConfig.agents[agentId];
      let agentHome: string | null = null;
      if (agentEntry.agentHome) {
        agentHome = resolveTilde(agentEntry.agentHome);
      } else if (agentEntry.memoryDir) {
        agentHome = resolve(resolveTilde(agentEntry.memoryDir), "..");
      }

      // Remove from config.json
      delete rawConfig.agents[agentId];
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Remove from in-memory config
      delete opts.config.agents[agentId];

      // Remove agentHome directory
      let dirRemoved = false;
      if (agentHome && existsSync(agentHome)) {
        const { rmSync } = await import("node:fs");
        rmSync(agentHome, { recursive: true, force: true });
        dirRemoved = true;
        log.info(`Removed agent home directory: ${agentHome}`);
      }

      // Rebuild
      try {
        execSync("npm run build", { cwd: opts.baseDir, timeout: 30_000 });
      } catch (buildErr) {
        log.warn(`Build after agent delete failed: ${buildErr}`);
      }

      log.info(`Agent deleted via Web UI: ${agentId} (alias: ${agentAlias}, dir removed: ${dirRemoved})`);
      res.json({ ok: true, agentId, alias: agentAlias, directoryRemoved: dirRemoved, agentHome });
    } catch (err) {
      log.error(`Failed to delete agent: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Available MCPs ──────────────────────────────────────────
  app.get("/api/mcps", (_req, res) => {
    const mcps = Object.keys(opts.config.mcps || {});
    res.json({ mcps });
  });

  // ─── API: MCP catalog (for connect UI) ─────────────────────────────
  app.get("/api/mcp-catalog", (_req, res) => {
    const catalogPath = join(opts.baseDir, "mcp-catalog.json");
    if (!existsSync(catalogPath)) return res.json({ mcps: {} });
    try {
      const catalog = JSON.parse(readFileSync(catalogPath, "utf-8"));
      res.json({ mcps: catalog.mcps || {} });
    } catch {
      res.json({ mcps: {} });
    }
  });

  // ─── API: Agent MCP keys — list configured (names only, not values) ──
  app.get("/api/agents/:id/mcp-keys", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const agentHome = agent.agentHome
      ? resolveTilde(agent.agentHome)
      : resolve(opts.baseDir, agent.memoryDir, "..");
    const keysDir = join(agentHome, "mcp-keys");

    const configured: Record<string, string[]> = {};
    if (existsSync(keysDir)) {
      try {
        const files = readdirSync(keysDir);
        for (const file of files) {
          if (!file.endsWith(".env")) continue;
          const mcpName = file.replace(".env", "");
          try {
            const content = readFileSync(join(keysDir, file), "utf-8");
            const keys = content.split("\n")
              .filter(l => l.includes("=") && !l.startsWith("#"))
              .map(l => l.split("=")[0].trim());
            configured[mcpName] = keys;
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    res.json({ configured });
  });

  // ─── API: Agent MCP keys — save a key ─────────────────────────────
  app.post("/api/agents/:id/mcp-keys", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const { mcpName, envVar, value } = req.body as { mcpName?: string; envVar?: string; value?: string };
    if (!mcpName || !envVar || !value) {
      return res.status(400).json({ error: "Missing mcpName, envVar, or value" });
    }

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const agentHome = agent.agentHome
      ? resolveTilde(agent.agentHome)
      : resolve(opts.baseDir, agent.memoryDir, "..");
    const keysDir = join(agentHome, "mcp-keys");
    mkdirSync(keysDir, { recursive: true });

    const envFile = join(keysDir, `${mcpName}.env`);
    const encFile = envFile + ".enc";

    // Read existing content — decrypt if encrypted, skip stubs
    let lines: string[] = [];
    if (existsSync(encFile)) {
      try {
        const secret = getEncryptionSecret();
        const data = readFileSync(encFile);
        const content = decryptAuto(data, secret);
        lines = content.split("\n");
      } catch { /* start fresh */ }
    } else if (existsSync(envFile)) {
      const content = readFileSync(envFile, "utf-8");
      if (!content.includes("# Encrypted")) {
        lines = content.split("\n");
      }
    }

    const idx = lines.findIndex(l => l.startsWith(`${envVar}=`));
    if (idx >= 0) {
      lines[idx] = `${envVar}=${value}`;
    } else {
      lines.push(`${envVar}=${value}`);
    }
    const plaintext = lines.filter(l => l.trim()).join("\n") + "\n";

    // Encrypt on write — never store plaintext
    try {
      const secret = getEncryptionSecret();
      const encrypted = encryptAuto(plaintext, secret);
      writeFileSync(encFile, encrypted);
      writeFileSync(envFile, `# Encrypted — see ${mcpName}.env.enc\n`);
    } catch {
      // Fallback to plaintext if encryption fails (e.g., no keychain)
      writeFileSync(envFile, plaintext);
    }

    log.info(`[MCP Keys] Saved ${envVar} for ${req.params.id} → ${mcpName}.env`);
    res.json({ ok: true, mcpName, envVar });
  });

  // ─── API: Agent MCP keys — delete a key ───────────────────────────
  app.delete("/api/agents/:id/mcp-keys/:mcpName", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const agentHome = agent.agentHome
      ? resolveTilde(agent.agentHome)
      : resolve(opts.baseDir, agent.memoryDir, "..");
    const envFile = join(agentHome, "mcp-keys", `${req.params.mcpName}.env`);
    const encFile = envFile + ".enc";

    if (existsSync(encFile)) unlinkSync(encFile);
    if (existsSync(envFile)) unlinkSync(envFile);
    log.info(`[MCP Keys] Deleted ${req.params.mcpName} key files for ${req.params.id}`);
    res.json({ ok: true });
  });

  // ─── API: Named MCP connections (multi-account) ─────────────────
  // Creates a named instance of an MCP (e.g., "gmail-work") pointing to the same server
  // but with different credentials. Also stores label metadata for agent context.

  app.post("/api/agents/:id/mcp-connections", async (req, res) => {
    const agentId = req.params.id;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const { baseMcp, label, envVar, value, description } = req.body as {
      baseMcp?: string; label?: string; envVar?: string; value?: string; description?: string;
    };
    if (!baseMcp || !label || !envVar || !value) {
      return res.status(400).json({ error: "Missing baseMcp, label, envVar, or value" });
    }

    // Generate instance name from base + label: "gmail" + "Work" → "gmail-work"
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const instanceName = `${baseMcp}-${slug}`;

    // Check if the base MCP exists in registry
    const mcpRegistry = opts.config.mcps || {};
    const baseMcpConfig = mcpRegistry[baseMcp];
    if (!baseMcpConfig) {
      return res.status(400).json({ error: `Base MCP "${baseMcp}" not found in registry` });
    }

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      // Ensure the base MCP is in the agent's mcps array (don't add named instance)
      if (!rawConfig.agents[agentId].mcps) rawConfig.agents[agentId].mcps = [];
      if (!rawConfig.agents[agentId].mcps.includes(baseMcp)) {
        rawConfig.agents[agentId].mcps.push(baseMcp);
      }

      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Save the key to agent's mcp-keys
      const home = homedir();
      const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
      const agentHome = agent.agentHome
        ? resolveTilde(agent.agentHome)
        : resolve(opts.baseDir, agent.memoryDir, "..");
      const keysDir = join(agentHome, "mcp-keys");
      mkdirSync(keysDir, { recursive: true });
      const connPlaintext = `${envVar}=${value}\n`;
      try {
        const secret = getEncryptionSecret();
        const encrypted = encryptAuto(connPlaintext, secret);
        writeFileSync(join(keysDir, `${instanceName}.env.enc`), encrypted);
        writeFileSync(join(keysDir, `${instanceName}.env`), `# Encrypted — see ${instanceName}.env.enc\n`);
      } catch {
        writeFileSync(join(keysDir, `${instanceName}.env`), connPlaintext);
      }

      // Save metadata (label + description) for agent context injection
      const accountsPath = join(agentHome, "mcp-accounts.json");
      let accounts: Record<string, { label: string; baseMcp: string; description?: string }> = {};
      if (existsSync(accountsPath)) {
        try { accounts = JSON.parse(readFileSync(accountsPath, "utf-8")); } catch { /* ignore */ }
      }
      accounts[instanceName] = { label, baseMcp, description };
      writeFileSync(accountsPath, JSON.stringify(accounts, null, 2));

      // Update in-memory config — sync from what was written to disk
      if (opts.config.mcps) opts.config.mcps[instanceName] = { ...baseMcpConfig };
      const savedAgent = rawConfig.agents[agentId];
      opts.config.agents[agentId].mcps = savedAgent.mcps;

      log.info(`[MCP Connect] Created ${instanceName} for ${agentId} (base: ${baseMcp}, label: ${label})`);
      res.json({ ok: true, instanceName, label, baseMcp });
    } catch (err) {
      log.error(`Failed to create MCP connection: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // List named connections for an agent
  app.get("/api/agents/:id/mcp-connections", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const agentHome = agent.agentHome
      ? resolveTilde(agent.agentHome)
      : resolve(opts.baseDir, agent.memoryDir, "..");
    const accountsPath = join(agentHome, "mcp-accounts.json");

    let accounts: Record<string, any> = {};
    if (existsSync(accountsPath)) {
      try { accounts = JSON.parse(readFileSync(accountsPath, "utf-8")); } catch { /* ignore */ }
    }
    res.json({ connections: accounts });
  });

  // Delete a named connection
  app.delete("/api/agents/:id/mcp-connections/:instanceName", (req, res) => {
    const agentId = req.params.id;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const instanceName = req.params.instanceName;

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      // Remove from mcps registry
      delete rawConfig.mcps[instanceName];

      // Remove from agent's mcps array
      if (rawConfig.agents[agentId].mcps) {
        rawConfig.agents[agentId].mcps = rawConfig.agents[agentId].mcps.filter((m: string) => m !== instanceName);
      }

      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Remove key file
      const home = homedir();
      const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
      const agentHome = agent.agentHome
        ? resolveTilde(agent.agentHome)
        : resolve(opts.baseDir, agent.memoryDir, "..");
      const envFile = join(agentHome, "mcp-keys", `${instanceName}.env`);
      if (existsSync(envFile)) {
        unlinkSync(envFile);
      }

      // Remove from accounts metadata
      const accountsPath = join(agentHome, "mcp-accounts.json");
      if (existsSync(accountsPath)) {
        try {
          const accounts = JSON.parse(readFileSync(accountsPath, "utf-8"));
          delete accounts[instanceName];
          writeFileSync(accountsPath, JSON.stringify(accounts, null, 2));
        } catch { /* ignore */ }
      }

      // Update in-memory
      if (opts.config.mcps) delete opts.config.mcps[instanceName];
      if (agent.mcps) {
        agent.mcps = agent.mcps.filter((m: string) => m !== instanceName);
      }

      log.info(`[MCP Connect] Deleted ${instanceName} from ${agentId}`);
      res.json({ ok: true });
    } catch (err) {
      log.error(`Failed to delete MCP connection: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Security & Encryption ────────────────────────────────

  // Helper: resolve key directories
  function getKeyDirs(): string[] {
    const paDir = getPersonalAgentsDir(opts.config);
    const resolvedPaDir = paDir.startsWith("~") ? paDir.replace("~", homedir()) : paDir;
    return [
      join(resolvedPaDir, "mcp-keys"),
      join(opts.baseDir, "data", "mcp-keys"),
    ];
  }

  app.get("/api/security/status", (_req, res) => {
    try {
      const mode = getEncryptionMode();

      let encrypted = 0, plaintext = 0;
      for (const dir of getKeyDirs()) {
        const counts = countKeyFiles(dir);
        encrypted += counts.encrypted;
        plaintext += counts.plaintext;
      }

      res.json({
        mode,
        hasMasterPassword: hasMasterPassword(),
        encrypted,
        plaintext,
        keychainAvailable: true,
      });
    } catch (err) {
      res.json({
        mode: process.env.MYAGENT_MASTER_PASSWORD ? "env-var" : "none",
        hasMasterPassword: false,
        encrypted: 0,
        plaintext: 0,
        keychainAvailable: false,
        error: String(err),
      });
    }
  });

  app.post("/api/security/master-password", async (req, res) => {
    try {
      const { password, confirm } = req.body as { password?: string; confirm?: string };
      if (!password || !confirm) return res.status(400).json({ error: "Password and confirm required" });
      if (password !== confirm) return res.status(400).json({ error: "Passwords do not match" });
      if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

      const oldSecret = getEncryptionSecret();

      // Set the new master password
      kcSetMasterPassword(password);
      const newSecret = password;

      // Re-encrypt all existing .env.enc files from old secret to new
      let reEncrypted = 0;
      for (const dir of getKeyDirs()) {
        reEncrypted += reEncryptDir(dir, oldSecret, newSecret);
      }

      // Re-initialize the executor's encryption secret
      initEncryptionSecret();

      log.info(`[Security] Master password set, re-encrypted ${reEncrypted} files`);
      res.json({ ok: true, mode: "master-password", reEncrypted });
    } catch (err) {
      log.error(`[Security] Failed to set master password: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete("/api/security/master-password", async (_req, res) => {
    try {
      const oldSecret = getEncryptionSecret();

      // Ensure machine key exists before removing master password
      const machineKey = getOrCreateMachineKey();

      // Remove master password
      kcClearMasterPassword();

      // Re-encrypt all files with machine key
      let reEncrypted = 0;
      for (const dir of getKeyDirs()) {
        reEncrypted += reEncryptDir(dir, oldSecret, machineKey);
      }

      // Re-initialize to use machine key
      initEncryptionSecret();

      log.info(`[Security] Master password removed, re-encrypted ${reEncrypted} files with machine key`);
      res.json({ ok: true, mode: "machine-key", reEncrypted });
    } catch (err) {
      log.error(`[Security] Failed to remove master password: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/security/encrypt-keys", async (_req, res) => {
    try {
      const secret = getEncryptionSecret();

      let total = 0;
      for (const dir of getKeyDirs()) {
        if (existsSync(dir)) total += encryptDir(dir, secret);
      }

      log.info(`[Security] Encrypted ${total} key files`);
      res.json({ ok: true, encrypted: total });
    } catch (err) {
      log.error(`[Security] Failed to encrypt keys: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/security/export-keys", async (req, res) => {
    try {
      const { password } = req.body as { password?: string };
      if (!password || password.length < 8) return res.status(400).json({ error: "Export password must be at least 8 characters" });

      const secret = getEncryptionSecret();
      const bundle = createExportBundle(getKeyDirs(), secret, password);

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", "attachment; filename=myaiforone-keys.keybundle");
      res.send(bundle);
    } catch (err) {
      log.error(`[Security] Failed to export keys: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/security/import-keys", async (req, res) => {
    try {
      const { password, bundle } = req.body as { password?: string; bundle?: string };
      if (!password || !bundle) return res.status(400).json({ error: "Password and bundle data required" });

      const localSecret = getEncryptionSecret();

      const paDir = getPersonalAgentsDir(opts.config);
      const resolvedPaDir = paDir.startsWith("~") ? paDir.replace("~", homedir()) : paDir;
      const targetDir = join(resolvedPaDir, "mcp-keys");
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

      const bundleBuffer = Buffer.from(bundle, "base64");
      const imported = importExportBundle(bundleBuffer, password, localSecret, targetDir);

      // Re-initialize to pick up new keys
      initEncryptionSecret();

      log.info(`[Security] Imported ${imported} key files`);
      res.json({ ok: true, imported });
    } catch (err) {
      log.error(`[Security] Failed to import keys: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Agent Templates ──────────────────────────────────────

  const builtinTemplatesDir = resolve(opts.baseDir, "agents", "templates");
  const _paDir = getPersonalAgentsDir(opts.config);
  const userTemplatesDir = resolve(_paDir.startsWith("~") ? _paDir.replace("~", homedir()) : _paDir, "templates");

  /** Load all templates from a directory (each .json file = one template) */
  function loadTemplatesFrom(dir: string, source: "builtin" | "user"): any[] {
    if (!existsSync(dir)) return [];
    const templates: any[] = [];
    try {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        try {
          const data = JSON.parse(readFileSync(join(dir, file), "utf-8"));
          templates.push({ ...data, source });
        } catch { /* skip malformed */ }
      }
    } catch { /* dir unreadable */ }
    return templates;
  }

  // GET /api/templates — list all templates (builtin + user), filtered by license
  app.get("/api/templates", (_req, res) => {
    const access = getTemplateAccess();
    if (!access.allowed) return res.json({ templates: [] });

    const category = _req.query.category as string | undefined;
    const builtin = loadTemplatesFrom(builtinTemplatesDir, "builtin");
    const user = loadTemplatesFrom(userTemplatesDir, "user");
    let all = filterTemplatesByLicense([...builtin, ...user]);
    if (category) {
      all = all.filter((t: any) => t.categories && t.categories.includes(category));
    }
    res.json({ templates: all });
  });

  // GET /api/templates/:id — get a single template (license-gated)
  app.get("/api/templates/:id", (req, res) => {
    const id = req.params.id;
    const builtin = loadTemplatesFrom(builtinTemplatesDir, "builtin");
    const user = loadTemplatesFrom(userTemplatesDir, "user");
    const all = [...builtin, ...user];
    const tmpl = all.find((t: any) => t.id === id);
    if (!tmpl) return res.status(404).json({ error: `Template "${id}" not found` });
    if (!isTemplateAccessible(tmpl.id, tmpl.categories, tmpl.source)) {
      return res.status(403).json({ error: "Your license does not include access to this template" });
    }
    res.json(tmpl);
  });

  // POST /api/templates — create a user template
  app.post("/api/templates", (req, res) => {
    const { id, name, description, categories } = req.body as any;
    if (!id || !name || !description || !categories) {
      return res.status(400).json({ error: "Missing required fields: id, name, description, categories" });
    }
    if (!/^[a-z0-9-]+$/.test(id)) {
      return res.status(400).json({ error: "Template id must be lowercase alphanumeric with hyphens" });
    }
    // Check for duplicate across builtin + user
    const existing = [
      ...loadTemplatesFrom(builtinTemplatesDir, "builtin"),
      ...loadTemplatesFrom(userTemplatesDir, "user"),
    ].find((t: any) => t.id === id);
    if (existing) {
      return res.status(409).json({ error: `Template "${id}" already exists` });
    }
    try {
      mkdirSync(userTemplatesDir, { recursive: true });
      const template = { ...req.body, source: undefined }; // strip source if sent
      delete template.source;
      writeFileSync(join(userTemplatesDir, `${id}.json`), JSON.stringify(template, null, 2));
      res.json({ ok: true, template: { ...template, source: "user" } });
    } catch (err) {
      log.error(`Failed to create template: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // PUT /api/templates/:id — update a user template
  app.put("/api/templates/:id", (req, res) => {
    const id = req.params.id;
    const filePath = join(userTemplatesDir, `${id}.json`);
    if (!existsSync(filePath)) {
      // Check if it's a builtin
      const builtinPath = join(builtinTemplatesDir, `${id}.json`);
      if (existsSync(builtinPath)) {
        return res.status(403).json({ error: "Cannot update a built-in template. Save it as a new user template instead." });
      }
      return res.status(404).json({ error: `Template "${id}" not found` });
    }
    try {
      const existing = JSON.parse(readFileSync(filePath, "utf-8"));
      const updated = { ...existing, ...req.body, id }; // id is immutable
      delete updated.source;
      writeFileSync(filePath, JSON.stringify(updated, null, 2));
      res.json({ ok: true, template: { ...updated, source: "user" } });
    } catch (err) {
      log.error(`Failed to update template: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // DELETE /api/templates/:id — delete a user template
  app.delete("/api/templates/:id", (req, res) => {
    const id = req.params.id;
    const filePath = join(userTemplatesDir, `${id}.json`);
    if (!existsSync(filePath)) {
      const builtinPath = join(builtinTemplatesDir, `${id}.json`);
      if (existsSync(builtinPath)) {
        return res.status(403).json({ error: "Cannot delete a built-in template." });
      }
      return res.status(404).json({ error: `Template "${id}" not found` });
    }
    try {
      unlinkSync(filePath);
      res.json({ ok: true });
    } catch (err) {
      log.error(`Failed to delete template: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/templates/:id/personalize — AI-assisted template personalization (license-gated)
  // Takes template seed data + user customization notes, returns personalized agent config
  app.post("/api/templates/:id/personalize", async (req, res) => {
    const templateId = req.params.id;
    const builtin = loadTemplatesFrom(builtinTemplatesDir, "builtin");
    const userT = loadTemplatesFrom(userTemplatesDir, "user");
    const template = [...builtin, ...userT].find((t: any) => t.id === templateId);
    if (!template) return res.status(404).json({ error: `Template "${templateId}" not found` });
    if (!isTemplateAccessible(template.id, template.categories, template.source)) {
      return res.status(403).json({ error: "Your license does not include access to this template" });
    }

    const { userNotes, agentName, agentAlias } = req.body as {
      userNotes: string; agentName?: string; agentAlias?: string;
    };
    if (!userNotes || !userNotes.trim()) {
      return res.status(400).json({ error: "userNotes is required" });
    }

    const displayName = agentName || template.name;
    const alias = agentAlias || `@${templateId.replace(/-/g, '')}`;

    const prompt = `You are an expert AI agent architect. A user wants to hire an agent from a template. Your job is to personalize the agent's configuration based on the template's seed data and the user's specific needs.

TEMPLATE DATA:
Name: ${template.name}
Description: ${template.description}
Role: ${template.org?.title || 'General Agent'} — ${template.org?.function || 'General'}
Agent Class: ${template.agentClass || 'standard'}

TEMPLATE SYSTEM PROMPT:
${template.systemPrompt || ''}

TEMPLATE SEED INSTRUCTIONS:
${template.seedInstructions || '(none)'}

TEMPLATE SEED CONTEXT:
${template.seedContext || '(none)'}

TEMPLATE CAPABILITIES:
${(template.capabilities || []).map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}

TEMPLATE SUGGESTED TOOLS: ${(template.suggestedTools || []).join(', ')}
TEMPLATE SUGGESTED MCPS: ${(template.suggestedMcps || []).join(', ') || '(none)'}

TEMPLATE SEED GOALS:
${(template.seedGoals || []).map((g: any) => `- ${g.id}: ${g.description} (${g.heartbeat})`).join('\n') || '(none)'}

USER'S DISPLAY NAME FOR AGENT: ${displayName}
USER'S ALIAS FOR AGENT: ${alias}

USER'S CUSTOMIZATION NOTES:
${userNotes}

---

Based on the template and the user's notes, generate a PERSONALIZED agent configuration. Adapt everything to the user's specific context while keeping the template's core competencies.

Return ONLY a JSON object (no markdown, no code fences) with these fields:
{
  "name": "Personalized display name (keep short)",
  "description": "One-line description personalized to the user's context",
  "capabilities": ["5-6 bullet points personalized to the user's specific use case"],
  "claudeMd": "Full CLAUDE.md content — start with # Name, include the personalized system prompt, identity section with the alias, personalized guidelines, and any workflow instructions adapted to the user's needs",
  "contextMd": "Full context.md content — personalized getting-started guide based on what the user told you",
  "goals": [{"id": "kebab-case-id", "description": "Personalized goal description", "heartbeat": "cron expression"}]
}

Rules:
- Personalize capabilities to the user's specific industry/role/use case
- Adapt the CLAUDE.md instructions to reference the user's specific tools, workflow, and context
- Keep the context.md actionable — reference what the user told you
- Adjust goals to match the user's rhythm (e.g., weekly for a small business vs. daily for high volume)
- If the user mentions specific tools/integrations, note them even if they're not in the template
- Keep the tone professional but approachable
- The claudeMd should include ## Identity with the alias ${alias}`;

    try {
      // Resolve claude binary
      let claudeBin = "claude";
      try {
        claudeBin = execSync("which claude", { encoding: "utf-8" }).trim().split("\n")[0].trim();
      } catch { /* fallback to "claude" */ }

      const result = await new Promise<string>((resolveP, rejectP) => {
        const env = { ...process.env };
        delete env.CLAUDECODE;
        delete env.CLAUDE_CODE_ENTRYPOINT;

        const proc = cpSpawn(claudeBin, ["-p", prompt, "--output-format", "text"], {
          cwd: homedir(),
          stdio: ["pipe", "pipe", "pipe"],
          env,
          windowsHide: true,
        });

        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

        const timer = setTimeout(() => {
          proc.kill("SIGTERM");
          rejectP(new Error("Personalization timed out (60s)"));
        }, 60000);

        proc.on("close", (code) => {
          clearTimeout(timer);
          if (code !== 0) {
            log.warn(`[Templates] personalize claude -p failed: code=${code} stderr=${stderr.slice(0, 300)}`);
            rejectP(new Error(`AI personalization failed (exit ${code})`));
          } else {
            resolveP(stdout);
          }
        });
      });

      // Parse the JSON response — handle potential markdown fences
      let cleaned = result.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      }
      const parsed = JSON.parse(cleaned);

      // Validate required fields
      const personalized = {
        name: parsed.name || displayName,
        description: parsed.description || template.description,
        capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities : (template.capabilities || []),
        claudeMd: parsed.claudeMd || "",
        contextMd: parsed.contextMd || "",
        goals: Array.isArray(parsed.goals) ? parsed.goals : (template.seedGoals || []),
        // Pass through template metadata for the resume display
        suggestedTools: template.suggestedTools || [],
        suggestedMcps: template.suggestedMcps || [],
        agentClass: template.agentClass || "standard",
        org: template.org,
        icon: template.icon,
      };

      log.info(`[Templates] Personalized template "${templateId}" for user`);
      res.json({ ok: true, personalized });
    } catch (err: any) {
      log.error(`[Templates] Personalize failed: ${err.message || err}`);
      // If AI fails, return seed data as fallback so user can still deploy
      res.json({
        ok: true,
        personalized: {
          name: displayName,
          description: template.description,
          capabilities: template.capabilities || [],
          claudeMd: template.systemPrompt
            ? `# ${displayName}\n\n${template.systemPrompt}\n\n## Identity\n- Mention alias: ${alias}\n- Respond when mentioned with ${alias}\n\n## Guidelines\n- Keep responses concise — you're replying to phone messages\n- If a task requires multiple steps, summarize what you did\n- If you need clarification, ask\n${template.seedInstructions ? '\n' + template.seedInstructions : ''}`
            : `# ${displayName}\n\n${template.description}\n`,
          contextMd: template.seedContext || `# ${displayName} Context\n\nCreated from template "${templateId}".`,
          goals: template.seedGoals || [],
          suggestedTools: template.suggestedTools || [],
          suggestedMcps: template.suggestedMcps || [],
          agentClass: template.agentClass || "standard",
          org: template.org,
          icon: template.icon,
        },
        fallback: true,
        error: err.message,
      });
    }
  });

  // POST /api/templates/:id/deploy — deploy a template as a real agent (license-gated)
  app.post("/api/templates/:id/deploy", async (req, res) => {
    const templateId = req.params.id;
    const builtin = loadTemplatesFrom(builtinTemplatesDir, "builtin");
    const user = loadTemplatesFrom(userTemplatesDir, "user");
    const template = [...builtin, ...user].find((t: any) => t.id === templateId);
    if (!template) return res.status(404).json({ error: `Template "${templateId}" not found` });
    if (!isTemplateAccessible(template.id, template.categories, template.source)) {
      return res.status(403).json({ error: "Your license does not include access to this template" });
    }

    const { agentId, name, alias, workspace, org, personalizedClaudeMd, personalizedContextMd, personalizedGoals, personalizedDescription } = req.body as {
      agentId: string; name?: string; alias?: string; workspace?: string;
      org?: Array<{ organization: string; function: string; title: string; reportsTo?: string }>;
      personalizedClaudeMd?: string; personalizedContextMd?: string;
      personalizedGoals?: Array<{ id: string; description: string; heartbeat: string; budget?: { maxDailyUsd: number } }>;
      personalizedDescription?: string;
    };
    if (!agentId) return res.status(400).json({ error: "Missing required field: agentId" });
    if (!/^[a-z0-9-]+$/.test(agentId)) {
      return res.status(400).json({ error: "agentId must be lowercase alphanumeric with hyphens" });
    }
    if (opts.config.agents[agentId]) {
      return res.status(409).json({ error: `Agent "${agentId}" already exists` });
    }

    const agentName = name || template.name;
    const agentAlias = alias || `@${agentId}`;
    const normalAlias = agentAlias.startsWith("@") ? agentAlias : `@${agentAlias}`;

    // Check alias uniqueness
    const allAliases = Object.values(opts.config.agents).flatMap((a: any) => a.mentionAliases || []);
    if (allAliases.includes(normalAlias)) {
      return res.status(409).json({ error: `Alias "${normalAlias}" is already in use` });
    }

    try {
      // Derive org from template or override
      const agentOrg = org || (template.org ? [{ organization: "My Team", function: template.org.function, title: template.org.title }] : undefined);
      const orgName = agentOrg?.[0]?.organization;

      // Create agent directory
      const baseDir2 = getPersonalAgentsDir();
      const agentHome = orgName ? join(baseDir2, orgName, agentId) : join(baseDir2, agentId);
      const memoryDir = join(agentHome, "memory");
      mkdirSync(memoryDir, { recursive: true });
      mkdirSync(join(agentHome, "mcp-keys"), { recursive: true });
      mkdirSync(join(agentHome, "skills"), { recursive: true });
      mkdirSync(join(agentHome, "FileStorage", "Temp"), { recursive: true });
      mkdirSync(join(agentHome, "FileStorage", "Permanent"), { recursive: true });

      // Write tasks.json
      writeFileSync(join(agentHome, "tasks.json"), JSON.stringify({
        agentId, projects: [{ id: "general", name: "General", color: "#6b7280" }], tasks: [],
      }, null, 2));

      // Write CLAUDE.md — use personalized version if available, otherwise build from template
      if (personalizedClaudeMd) {
        writeFileSync(join(agentHome, "CLAUDE.md"), personalizedClaudeMd);
      } else {
        let claudeMd = template.systemPrompt
          ? `# ${agentName}\n\n${template.systemPrompt}\n\n## Identity\n- Mention alias: ${normalAlias}\n- Respond when mentioned with ${normalAlias}\n\n## Guidelines\n- Keep responses concise — you're replying to phone messages\n- If a task requires multiple steps, summarize what you did\n- If you need clarification, ask\n`
          : `# ${agentName}\n\n${template.description || "General-purpose agent."}\n\n## Identity\n- Mention alias: ${normalAlias}\n`;
        if (template.seedInstructions) {
          claudeMd += `\n${template.seedInstructions}\n`;
        }
        writeFileSync(join(agentHome, "CLAUDE.md"), claudeMd);
      }

      // Write context.md — use personalized version if available
      if (personalizedContextMd) {
        writeFileSync(join(memoryDir, "context.md"), personalizedContextMd);
      } else {
        const contextContent = template.seedContext
          ? `# ${agentName} Context\n\nCreated ${new Date().toISOString().split("T")[0]} from template "${templateId}".\n\n${template.seedContext}\n`
          : `# ${agentName} Context\n\nCreated ${new Date().toISOString().split("T")[0]} from template "${templateId}".\n`;
        writeFileSync(join(memoryDir, "context.md"), contextContent);
      }

      // Build config entry
      const cfgBaseDir = getPersonalAgentsDir();
      const cfgBaseDirTilde = cfgBaseDir.startsWith(homedir()) ? cfgBaseDir.replace(homedir(), "~") : cfgBaseDir;
      const cfgAgentPath = orgName ? `${cfgBaseDirTilde}/${orgName}/${agentId}` : `${cfgBaseDirTilde}/${agentId}`;

      const agentConfig: any = {
        name: agentName,
        description: personalizedDescription || template.description || `Agent ${agentName}`,
        agentHome: cfgAgentPath,
        workspace: workspace || "~",
        claudeMd: `${cfgAgentPath}/CLAUDE.md`,
        memoryDir: `${cfgAgentPath}/memory`,
        persistent: true,
        streaming: true,
        advancedMemory: true,
        autonomousCapable: true,
        mentionAliases: [normalAlias],
        autoCommit: false,
        allowedTools: template.suggestedTools || ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"],
        timeout: 14400000,
        agentClass: template.agentClass || "standard",
        deployedFrom: templateId,
      };

      if (template.suggestedMcps && template.suggestedMcps.length > 0) agentConfig.mcps = template.suggestedMcps;
      if (agentOrg && agentOrg.length > 0) agentConfig.org = agentOrg;
      if (template.icon) agentConfig.avatar = template.icon;
      const goalsSource = personalizedGoals || template.seedGoals;
      if (goalsSource && goalsSource.length > 0) {
        agentConfig.goals = goalsSource.map((g: any) => ({ ...g, enabled: false }));
        mkdirSync(join(agentHome, "goals"), { recursive: true });
      }
      if (template.seedCron && template.seedCron.length > 0) {
        agentConfig.cron = template.seedCron.map((c: any) => ({ ...c, enabled: false }));
      }

      // Default web route
      agentConfig.routes = [{
        channel: "web",
        match: { type: "channel_id", value: "web-ui" },
        permissions: { allowFrom: ["*"], requireMention: false },
      }];

      // Save to config.json
      const configPath2 = join(opts.dataDir || opts.baseDir, "config.json");
      const rawConfig = JSON.parse(readFileSync(configPath2, "utf-8"));
      rawConfig.agents[agentId] = agentConfig;
      writeFileSync(configPath2, JSON.stringify(rawConfig, null, 2));

      // Update in-memory config
      const resolveTildeHere = (p: string) => p.startsWith("~") ? p.replace("~", homedir()) : p;
      const memConfig = { ...agentConfig };
      memConfig.workspace = resolveTildeHere(memConfig.workspace);
      memConfig.claudeMd = resolveTildeHere(memConfig.claudeMd);
      memConfig.memoryDir = resolveTildeHere(memConfig.memoryDir);
      memConfig.agentHome = resolveTildeHere(memConfig.agentHome);
      opts.config.agents[agentId] = memConfig;

      log.info(`[Templates] Deployed template "${templateId}" as agent "${agentId}" (${normalAlias})`);
      res.json({ ok: true, agentId, alias: normalAlias, home: agentHome, deployedFrom: templateId });
    } catch (err) {
      log.error(`Failed to deploy template: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/agents/:id/save-as-template — save an existing agent as a template
  app.post("/api/agents/:id/save-as-template", (req, res) => {
    const agentId = req.params.id;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const { templateId, name, description, categories } = req.body as {
      templateId: string; name?: string; description?: string; categories: string[];
    };
    if (!templateId || !categories || !categories.length) {
      return res.status(400).json({ error: "Missing required fields: templateId, categories" });
    }
    if (!/^[a-z0-9-]+$/.test(templateId)) {
      return res.status(400).json({ error: "templateId must be lowercase alphanumeric with hyphens" });
    }

    // Check for duplicate
    const existing = [
      ...loadTemplatesFrom(builtinTemplatesDir, "builtin"),
      ...loadTemplatesFrom(userTemplatesDir, "user"),
    ].find((t: any) => t.id === templateId);
    if (existing) {
      return res.status(409).json({ error: `Template "${templateId}" already exists` });
    }

    try {
      // Read the agent's CLAUDE.md as system prompt
      const home3 = homedir();
      const resolveTilde3 = (p: string) => p.startsWith("~") ? p.replace("~", home3) : p;
      let systemPrompt = "";
      if (agent.claudeMd) {
        const claudePath = resolveTilde3(agent.claudeMd);
        if (existsSync(claudePath)) {
          systemPrompt = readFileSync(claudePath, "utf-8");
        }
      }

      const template: any = {
        id: templateId,
        name: name || agent.name,
        description: description || agent.description || `Template from agent ${agentId}`,
        categories,
        systemPrompt,
        suggestedTools: agent.allowedTools || [],
        suggestedMcps: (agent.mcps || []).filter((m: string) => {
          // Strip instance-specific MCP names — only keep base names (no underscores from named connections)
          return !m.includes("_");
        }),
        agentClass: agent.agentClass || "standard",
        icon: (agent as any).avatar || "bot",
      };

      if (agent.org && agent.org.length > 0) {
        template.org = { function: agent.org[0].function, title: agent.org[0].title };
      }

      mkdirSync(userTemplatesDir, { recursive: true });
      writeFileSync(join(userTemplatesDir, `${templateId}.json`), JSON.stringify(template, null, 2));

      log.info(`[Templates] Saved agent "${agentId}" as template "${templateId}"`);
      res.json({ ok: true, template: { ...template, source: "user" } });
    } catch (err) {
      log.error(`Failed to save agent as template: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Activity feed (recent messages across all agents) ────────
  // Query params: ?agent=agentId&q=searchTerm&limit=200
  app.get("/api/activity", (req, res) => {
    const filterAgent = req.query.agent as string || "";
    const searchQuery = (req.query.q as string || "").toLowerCase();
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
    const entries: any[] = [];
    const home2 = process.env.HOME || process.env.USERPROFILE || "";
    const rt = (p: string) => p.startsWith("~") ? p.replace("~", home2) : p;

    const agentEntries = filterAgent
      ? [[filterAgent, opts.config.agents[filterAgent]] as const].filter(([, a]) => a)
      : Object.entries(opts.config.agents);

    for (const [agentId, agent] of agentEntries) {
      try {
        const memDir = rt(agent.memoryDir);
        const logPath = join(memDir, "conversation_log.jsonl");
        if (!existsSync(logPath)) continue;
        const content = readFileSync(logPath, "utf-8");
        const lines = content.trim().split("\n").slice(-50); // last 50 per agent
        for (const line of lines) {
          try {
            const entry = { ...JSON.parse(line), agentId };
            if (searchQuery) {
              const text = ((entry.text || "") + " " + (entry.response || "")).toLowerCase();
              if (!text.includes(searchQuery)) continue;
            }
            entries.push(entry);
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    entries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    res.json({ entries: entries.slice(0, limit) });
  });

  // ─── API: Trigger goal now ──────────────────────────────────────────
  app.post("/api/agents/:id/goals/:goalId/trigger", async (req, res) => {
    const agentId = req.params.id;
    const goalId = req.params.goalId;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const goal = agent.goals?.find((g: any) => g.id === goalId);
    if (!goal) return res.status(404).json({ error: `Goal "${goalId}" not found` });

    log.info(`[Goal Trigger] Manual trigger: ${agentId}/${goalId}`);

    // Respond immediately — execution happens async
    res.json({ ok: true, message: `Goal "${goalId}" triggered. Running in background...` });

    // Execute in background
    try {
      const driverMap = opts.driverMap || new Map();
      const result = await executeGoal(
        agentId, agent, goal, opts.baseDir, driverMap,
        opts.config.mcps, opts.config.service.claudeAccounts,
      );
      log.info(`[Goal Trigger] Completed: ${agentId}/${goalId} — ${result.status}`);
    } catch (err) {
      log.error(`[Goal Trigger] Failed: ${agentId}/${goalId} — ${err}`);
    }
  });

  // ─── API: Delegate to agent (used by group agents) ─────────────────
  app.post("/api/delegate", async (req, res) => {
    const { agentId, text } = req.body as { agentId?: string; text?: string };
    if (!agentId || !text) return res.status(400).json({ error: "Missing agentId or text" });

    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    log.info(`[Delegate] → ${agentId}: ${text.slice(0, 80)}`);

    const syntheticMsg: InboundMessage = {
      id: `delegate-${Date.now()}`,
      channel: "delegate",
      chatId: "group-agent",
      chatType: "dm",
      sender: "group-agent",
      senderName: "Group Agent",
      text,
      timestamp: Date.now(),
      isFromMe: false,
      isGroup: false,
      raw: { type: "delegate" },
    };

    const route: ResolvedRoute = {
      agentId,
      agentConfig: agent,
      route: agent.routes[0],
    };

    try {
      const response = await executeAgent(route, syntheticMsg, opts.baseDir, opts.config.mcps, opts.config.service.claudeAccounts, { skills: opts.config.defaultSkills, mcps: opts.config.defaultMcps, prompts: opts.config.defaultPrompts, promptTrigger: opts.config.promptTrigger });
      log.info(`[Delegate] ← ${agentId}: ${response.slice(0, 80)}`);
      res.json({ ok: true, agentId, response });
    } catch (err) {
      log.error(`[Delegate] Failed for ${agentId}: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Agent registry (for group agent RAG) ────────────────────
  app.get("/api/agent-registry", (_req, res) => {
    const registry = Object.entries(opts.config.agents).map(([id, agent]) => ({
      id,
      name: agent.name,
      description: agent.description,
      aliases: agent.mentionAliases || [],
      mcps: agent.mcps || [],
      org: agent.org || [],
      capabilities: agent.allowedTools || [],
      hasGoals: (agent.goals || []).length > 0,
      isGroupAgent: !!agent.subAgents,
    }));
    res.json({ agents: registry });
  });

  // ─── API: Toggle goal enabled/paused ────────────────────────────────
  app.post("/api/agents/:id/goals/:goalId/toggle", (req, res) => {
    const agentId = req.params.id;
    const goalId = req.params.goalId;

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[agentId];
      if (!agent) return res.status(404).json({ error: "Agent not found" });

      const goal = agent.goals?.find((g: any) => g.id === goalId);
      if (!goal) return res.status(404).json({ error: `Goal "${goalId}" not found` });

      goal.enabled = !goal.enabled;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      const memGoal = opts.config.agents[agentId]?.goals?.find((g: any) => g.id === goalId);
      if (memGoal) memGoal.enabled = goal.enabled;

      log.info(`[Goal Toggle] ${agentId}/${goalId} → ${goal.enabled ? 'enabled' : 'paused'}`);
      res.json({ ok: true, goalId, enabled: goal.enabled });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Toggle schedule enabled/paused ──────────────────────────
  app.post("/api/agents/:id/cron/:index/toggle", (req, res) => {
    const agentId = req.params.id;
    const index = parseInt(req.params.index);

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[agentId];
      if (!agent) return res.status(404).json({ error: "Agent not found" });
      if (!agent.cron?.[index]) return res.status(404).json({ error: "Schedule not found" });

      const job = agent.cron[index];
      job.enabled = job.enabled === false ? true : false;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      if (opts.config.agents[agentId]?.cron?.[index]) {
        opts.config.agents[agentId].cron[index].enabled = job.enabled;
      }

      log.info(`[Cron Toggle] ${agentId}/cron[${index}] → ${job.enabled ? 'enabled' : 'paused'}`);
      res.json({ ok: true, index, enabled: job.enabled });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Trigger schedule now ────────────────────────────────────
  app.post("/api/agents/:id/cron/:index/trigger", async (req, res) => {
    const agentId = req.params.id;
    const index = parseInt(req.params.index);
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    if (!agent.cron?.[index]) return res.status(404).json({ error: "Schedule not found" });

    const job = agent.cron[index];
    log.info(`[Cron Trigger] Manual trigger: ${agentId}/cron[${index}] — "${job.message.slice(0, 60)}"`);

    res.json({ ok: true, message: `Schedule triggered. Running in background...` });

    // Execute via webhook handler
    if (opts.onWebhookMessage) {
      try {
        await opts.onWebhookMessage(agentId, job.message, job.channel, job.chatId);
        log.info(`[Cron Trigger] Completed: ${agentId}/cron[${index}]`);
      } catch (err) {
        log.error(`[Cron Trigger] Failed: ${agentId}/cron[${index}] — ${err}`);
      }
    }
  });

  // ─── API: All automations (goals + crons across all agents) ────────
  app.get("/api/automations", (_req, res) => {
    const goals: any[] = [];
    const crons: any[] = [];
    const home2 = process.env.HOME || process.env.USERPROFILE || "";
    const rt = (p: string) => p.startsWith("~") ? p.replace("~", home2) : p;

    for (const [agentId, agent] of Object.entries(opts.config.agents)) {
      for (const g of (agent.goals || [])) {
        goals.push({ ...g, agentId, agentName: agent.name });
      }
      for (let i = 0; i < (agent.cron || []).length; i++) {
        const c = agent.cron![i];
        crons.push({ ...c, index: i, agentId, agentName: agent.name });
      }
    }
    res.json({ goals, crons });
  });

  // ─── API: Goal run history ────────────────────────────────────────
  app.get("/api/agents/:id/goals/:goalId/history", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const home2 = process.env.HOME || process.env.USERPROFILE || "";
    const rt = (p: string) => p.startsWith("~") ? p.replace("~", home2) : p;
    const agentHome = agent.agentHome ? rt(agent.agentHome) : resolve(opts.baseDir, agent.memoryDir, "..");
    const goalsDir = join(agentHome, "goals");
    const entries: any[] = [];

    if (existsSync(goalsDir)) {
      try {
        const files = readdirSync(goalsDir).filter(f => f.startsWith("log-") && f.endsWith(".jsonl")).sort().reverse();
        for (const file of files.slice(0, 7)) { // last 7 days
          try {
            const content = readFileSync(join(goalsDir, file), "utf-8");
            for (const line of content.trim().split("\n")) {
              try {
                const entry = JSON.parse(line);
                if (entry.goalId === req.params.goalId) entries.push(entry);
              } catch { /* skip */ }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    entries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    res.json({ history: entries });
  });

  // ─── API: Cron run history (from conversation logs) ───────────────
  app.get("/api/agents/:id/cron/:index/history", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    const index = parseInt(req.params.index);
    const cronJob = agent.cron?.[index];
    if (!cronJob) return res.status(404).json({ error: "Schedule not found" });

    const home2 = process.env.HOME || process.env.USERPROFILE || "";
    const rt = (p: string) => p.startsWith("~") ? p.replace("~", home2) : p;
    const memDir = rt(agent.memoryDir);
    const logPath = join(memDir, "conversation_log.jsonl");
    const entries: any[] = [];

    if (existsSync(logPath)) {
      try {
        const content = readFileSync(logPath, "utf-8");
        const lines = content.trim().split("\n").slice(-200);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            // Match cron entries by channel and message content
            if ((entry.channel === "cron" || entry.channel === "webhook") &&
                entry.text && cronJob.message && entry.text.includes(cronJob.message.slice(0, 30))) {
              entries.push(entry);
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    entries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    res.json({ history: entries.slice(0, 20) });
  });

  // ─── API: Heartbeat — trigger ──────────────────────────────────────
  app.post("/api/agents/:id/heartbeat", async (req, res) => {
    const agentId = req.params.id;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const triggeredBy = (req.body as any)?.triggeredBy || "manual";
    log.info(`[Heartbeat] Triggered for ${agentId} (${triggeredBy})`);

    // Respond immediately — execution happens async
    res.json({ ok: true, message: `Heartbeat triggered for ${agentId}. Running in background...` });

    // Execute in background
    try {
      const result = await executeHeartbeat(
        agentId, agent, opts.baseDir,
        opts.config.mcps, opts.config.service.claudeAccounts,
        { skills: opts.config.defaultSkills, mcps: opts.config.defaultMcps, prompts: opts.config.defaultPrompts, promptTrigger: opts.config.promptTrigger },
        triggeredBy,
      );
      log.info(`[Heartbeat] Completed: ${agentId} — ${result.status} (${result.durationMs}ms)`);
    } catch (err) {
      log.error(`[Heartbeat] Failed: ${agentId} — ${err}`);
    }
  });

  // ─── API: Heartbeat — history ─────────────────────────────────────
  app.get("/api/agents/:id/heartbeat-history", (req, res) => {
    const agentId = req.params.id;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const agentHome = agent.agentHome || resolve(opts.baseDir, agent.memoryDir, "..");
    const limit = parseInt(req.query.limit as string) || 20;
    const history = loadHeartbeatHistory(agentHome, limit);
    res.json({ history });
  });

  // ─── API: Wiki Sync — trigger ──────────────────────────────────────
  app.post("/api/agents/:id/wiki-sync", async (req, res) => {
    const agentId = req.params.id;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    if (!agent.wiki) return res.json({ ok: false, error: "Wiki not enabled for this agent" });

    const triggeredBy = (req.body as any)?.triggeredBy || "manual";
    log.info(`[WikiSync] Triggered for ${agentId} (${triggeredBy})`);

    // Respond immediately — execution happens async
    res.json({ ok: true, message: `Wiki sync triggered for ${agentId}. Running in background...` });

    // Execute in background
    try {
      const result = await executeWikiSync(
        agentId, agent, opts.baseDir,
        opts.config.mcps, opts.config.service?.claudeAccounts,
        { skills: opts.config.defaultSkills, mcps: opts.config.defaultMcps, prompts: opts.config.defaultPrompts, promptTrigger: opts.config.promptTrigger },
        triggeredBy,
      );
      log.info(`[WikiSync] Completed: ${agentId} — ${result.status} (${result.durationMs}ms)`);
    } catch (err) {
      log.error(`[WikiSync] Failed: ${agentId} — ${err}`);
    }
  });

  // ─── API: Wiki Sync — history ─────────────────────────────────────
  app.get("/api/agents/:id/wiki-sync-history", (req, res) => {
    const agentId = req.params.id;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const agentHome = agent.agentHome || resolve(opts.baseDir, agent.memoryDir, "..");
    const limit = parseInt(req.query.limit as string) || 20;
    const history = getWikiSyncHistory(agentHome, limit);
    res.json({ history });
  });

  // ─── API: Delete goal ─────────────────────────────────────────────
  app.delete("/api/agents/:id/goals/:goalId", (req, res) => {
    const agentId = req.params.id;
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[agentId];
      if (!agent) return res.status(404).json({ error: "Agent not found" });

      const idx = (agent.goals || []).findIndex((g: any) => g.id === req.params.goalId);
      if (idx < 0) return res.status(404).json({ error: "Goal not found" });

      agent.goals.splice(idx, 1);
      if (agent.goals.length === 0) delete agent.goals;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      const memAgent = opts.config.agents[agentId];
      if (memAgent?.goals) {
        memAgent.goals = memAgent.goals.filter((g: any) => g.id !== req.params.goalId);
      }

      log.info(`[Goal Delete] ${agentId}/${req.params.goalId}`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Delete cron ─────────────────────────────────────────────
  app.delete("/api/agents/:id/cron/:index", (req, res) => {
    const agentId = req.params.id;
    const index = parseInt(req.params.index);
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[agentId];
      if (!agent) return res.status(404).json({ error: "Agent not found" });
      if (!agent.cron?.[index]) return res.status(404).json({ error: "Schedule not found" });

      agent.cron.splice(index, 1);
      if (agent.cron.length === 0) delete agent.cron;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      const memAgent = opts.config.agents[agentId];
      if (memAgent?.cron) {
        memAgent.cron.splice(index, 1);
      }

      log.info(`[Cron Delete] ${agentId}/cron[${index}]`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Create goal for agent ───────────────────────────────────
  app.post("/api/agents/:id/goals", (req, res) => {
    const agentId = req.params.id;
    const goal = req.body as any;
    if (!goal?.id || !goal?.description || !goal?.heartbeat) {
      return res.status(400).json({ error: "Missing id, description, or heartbeat" });
    }
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[agentId];
      if (!agent) return res.status(404).json({ error: "Agent not found" });

      if (!agent.goals) agent.goals = [];
      if (agent.goals.some((g: any) => g.id === goal.id)) {
        return res.status(409).json({ error: `Goal "${goal.id}" already exists` });
      }
      agent.goals.push(goal);
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      const memAgent = opts.config.agents[agentId];
      if (!memAgent.goals) memAgent.goals = [];
      memAgent.goals.push(goal);

      log.info(`[Goal Create] ${agentId}/${goal.id}`);
      res.json({ ok: true, goalId: goal.id });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Create cron for agent ───────────────────────────────────
  app.post("/api/agents/:id/cron", (req, res) => {
    const agentId = req.params.id;
    const cronJob = req.body as any;
    if (!cronJob?.schedule || !cronJob?.message || !cronJob?.channel || !cronJob?.chatId) {
      return res.status(400).json({ error: "Missing schedule, message, channel, or chatId" });
    }
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[agentId];
      if (!agent) return res.status(404).json({ error: "Agent not found" });

      if (!agent.cron) agent.cron = [];
      agent.cron.push(cronJob);
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      const memAgent = opts.config.agents[agentId];
      if (!memAgent.cron) memAgent.cron = [];
      memAgent.cron.push(cronJob);

      log.info(`[Cron Create] ${agentId} — "${cronJob.schedule}"`);
      res.json({ ok: true, index: agent.cron.length - 1 });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── Serve Automations page ───────────────────────────────────────
  app.get("/automations", (_req, res) => servePage(res, "automations.html", "/ui"));

  // ─── Task helpers ──────────────────────────────────────────────────

  const resolveTildeGlobal = (p: string) => {
    const h = homedir();
    return p.startsWith("~") ? p.replace("~", h) : p;
  };

  function getAgentHome(agent: any): string {
    if (agent.agentHome) return resolveTildeGlobal(agent.agentHome);
    return resolve(opts.baseDir, agent.memoryDir, "..");
  }

  function getTasksPath(agent: any): string {
    return join(getAgentHome(agent), "tasks.json");
  }

  function loadTasksFile(agent: any, agentId: string): { agentId: string; projects: any[]; tasks: any[] } {
    const p = getTasksPath(agent);
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, "utf-8"));
        if (!raw.projects) raw.projects = [{ id: "general", name: "General", color: "#6b7280" }];
        if (!raw.tasks) raw.tasks = [];
        return raw;
      } catch { /* ignore */ }
    }
    // Create default
    const data = {
      agentId,
      projects: [{ id: "general", name: "General", color: "#6b7280" }],
      tasks: [] as any[],
    };
    mkdirSync(getAgentHome(agent), { recursive: true });
    writeFileSync(p, JSON.stringify(data, null, 2));
    return data;
  }

  function saveTasksFile(agent: any, data: any): void {
    const p = getTasksPath(agent);
    writeFileSync(p, JSON.stringify(data, null, 2));
  }

  function determineAssignmentType(agentId: string, assignedBy: string): { assignmentType: string; status: string } {
    // Find the target agent's org to check reportsTo
    const targetAgent = opts.config.agents[agentId];
    if (!targetAgent || !targetAgent.org || targetAgent.org.length === 0) {
      return { assignmentType: "direct", status: "approved" };
    }

    // Check if assignedBy is a known agent alias
    let assignerAgentId: string | null = null;
    for (const [id, ag] of Object.entries(opts.config.agents)) {
      const aliases = ag.mentionAliases || [];
      const normalAssigner = assignedBy.startsWith("@") ? assignedBy : `@${assignedBy}`;
      if (aliases.includes(normalAssigner) || id === assignedBy) {
        assignerAgentId = id;
        break;
      }
    }

    if (!assignerAgentId) {
      // Not a known agent — treat as operator / direct
      return { assignmentType: "direct", status: "approved" };
    }

    // Check if assigner is a superior (target's reportsTo includes assigner's alias)
    const assignerAgent = opts.config.agents[assignerAgentId];
    const assignerAliases = assignerAgent?.mentionAliases || [];

    for (const orgEntry of targetAgent.org) {
      if (orgEntry.reportsTo) {
        const reportsToNorm = orgEntry.reportsTo.startsWith("@") ? orgEntry.reportsTo : `@${orgEntry.reportsTo}`;
        if (assignerAliases.includes(reportsToNorm) || assignerAgentId === orgEntry.reportsTo) {
          return { assignmentType: "direct", status: "approved" };
        }
      }
    }

    // Peer → proposal
    return { assignmentType: "proposal", status: "proposed" };
  }

  // ─── API: Task endpoints ──────────────────────────────────────────

  // GET /api/agents/:id/tasks/stats — must be before :taskId route
  app.get("/api/agents/:id/tasks/stats", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const data = loadTasksFile(agent, req.params.id);
    const counts: Record<string, number> = { proposed: 0, approved: 0, in_progress: 0, review: 0, done: 0 };
    for (const t of data.tasks) {
      if (counts.hasOwnProperty(t.status)) counts[t.status]++;
    }
    res.json(counts);
  });

  // GET /api/agents/:id/tasks — return full tasks.json + cross-agent tasks
  app.get("/api/agents/:id/tasks", (req, res) => {
    const agentId = req.params.id;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    const own = loadTasksFile(agent, agentId);

    // Collect cross-agent tasks: tasks in OTHER agents' files where owner or assignedBy matches this agent
    const myAliases = new Set<string>([
      agentId,
      `@${agentId}`,
      ...(agent.mentionAliases || []),
      ...(agent.mentionAliases || []).map(a => a.startsWith("@") ? a : `@${a}`),
    ]);
    const crossAgentTasks: any[] = [];
    for (const [otherId, otherAgent] of Object.entries(opts.config.agents)) {
      if (otherId === agentId) continue;
      try {
        const otherData = loadTasksFile(otherAgent as any, otherId);
        for (const t of otherData.tasks || []) {
          const ownerMatch = t.owner && myAliases.has(t.owner);
          const assignerMatch = t.assignedBy && myAliases.has(t.assignedBy);
          if (ownerMatch || assignerMatch) {
            crossAgentTasks.push({ ...t, _sourceAgent: otherId });
          }
        }
      } catch { /* skip agents with no/broken tasks */ }
    }

    res.json({ ...own, crossAgentTasks });
  });

  // POST /api/agents/:id/tasks — create new task
  app.post("/api/agents/:id/tasks", (req, res) => {
    const agentId = req.params.id;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const { title, description, project, priority, status, owner, assignedBy, assignmentType, dueDate, context } = req.body as any;
    if (!title) return res.status(400).json({ error: "Missing title" });

    const data = loadTasksFile(agent, agentId);
    const taskId = `${agentId}_${Date.now()}`;
    const now = new Date().toISOString();

    // Determine assignment type from hierarchy if not provided
    let finalAssignmentType = assignmentType;
    let finalStatus = status || "approved";
    if (!assignmentType && assignedBy) {
      const hierarchy = determineAssignmentType(agentId, assignedBy);
      finalAssignmentType = hierarchy.assignmentType;
      if (!status) finalStatus = hierarchy.status;
    }

    const task = {
      id: taskId,
      title,
      description: description || "",
      project: project || "general",
      priority: priority || "medium",
      status: finalStatus,
      owner: owner || (agent.mentionAliases?.[0] || agentId),
      assignedBy: assignedBy || "operator",
      assignmentType: finalAssignmentType || "direct",
      dueDate: dueDate || null,
      context: context || "",
      result: "",
      createdAt: now,
      updatedAt: now,
    };

    data.tasks.push(task);
    saveTasksFile(agent, data);
    log.info(`[Tasks] Created task ${taskId} for ${agentId}`);
    res.json({ ok: true, task });
  });

  // PUT /api/agents/:id/tasks/:taskId — update task
  app.put("/api/agents/:id/tasks/:taskId", (req, res) => {
    const agentId = req.params.id;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const data = loadTasksFile(agent, agentId);
    const taskIndex = data.tasks.findIndex((t: any) => t.id === req.params.taskId);
    if (taskIndex < 0) return res.status(404).json({ error: "Task not found" });

    const updates = req.body as any;
    const task = data.tasks[taskIndex];
    const updatableFields = ["title", "description", "project", "priority", "status", "owner", "assignedBy", "assignmentType", "dueDate", "context", "result"];
    for (const field of updatableFields) {
      if (updates[field] !== undefined) task[field] = updates[field];
    }
    task.updatedAt = new Date().toISOString();

    data.tasks[taskIndex] = task;
    saveTasksFile(agent, data);
    log.info(`[Tasks] Updated task ${req.params.taskId} for ${agentId}`);
    res.json({ ok: true, task });
  });

  // DELETE /api/agents/:id/tasks/:taskId — remove task
  app.delete("/api/agents/:id/tasks/:taskId", (req, res) => {
    const agentId = req.params.id;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const data = loadTasksFile(agent, agentId);
    const taskIndex = data.tasks.findIndex((t: any) => t.id === req.params.taskId);
    if (taskIndex < 0) return res.status(404).json({ error: "Task not found" });

    data.tasks.splice(taskIndex, 1);
    saveTasksFile(agent, data);
    log.info(`[Tasks] Deleted task ${req.params.taskId} from ${agentId}`);
    res.json({ ok: true });
  });

  // POST /api/agents/:id/projects — add project to agent's task board
  app.post("/api/agents/:id/projects", (req, res) => {
    const agentId = req.params.id;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const { id, name, color } = req.body as { id?: string; name?: string; color?: string };
    if (!id || !name) return res.status(400).json({ error: "Missing id or name" });

    const data = loadTasksFile(agent, agentId);
    if (data.projects.some((p: any) => p.id === id)) {
      return res.status(409).json({ error: "Project already exists" });
    }
    data.projects.push({ id, name, color: color || "#6b7280" });
    saveTasksFile(agent, data);
    res.json({ ok: true, projects: data.projects });
  });

  // GET /api/tasks/all — all tasks across all agents
  app.get("/api/tasks/all", (_req, res) => {
    const allTasks: any[] = [];
    for (const [agentId, agent] of Object.entries(opts.config.agents)) {
      try {
        const data = loadTasksFile(agent, agentId);
        for (const task of data.tasks) {
          allTasks.push({ ...task, agentId });
        }
      } catch { /* skip */ }
    }
    res.json({ tasks: allTasks });
  });

  // ─── API: Projects (cross-agent initiative tracking) ─────────────

  const projectsBaseDir = join(getPersonalAgentsDir(opts.config), "projects");

  interface ProjectEntity {
    id: string;
    name: string;
    description: string;
    status: "active" | "paused" | "completed" | "archived";
    owner: string;           // agent ID that owns the project
    teamMembers: string[];   // agent IDs
    plan: string;            // markdown plan text
    notes: string;           // freeform notes
    linkedTasks: Array<{ agentId: string; taskId: string }>;
    linkedAgents: string[];
    linkedOrgs: string[];
    linkedApps: string[];
    linkedArtifacts: Array<{ name: string; path?: string; url?: string; type?: string }>;
    executing?: boolean;
    createdAt: string;
    updatedAt: string;
  }

  function loadProjects(): ProjectEntity[] {
    if (!existsSync(projectsBaseDir)) return [];
    const projects: ProjectEntity[] = [];
    try {
      const dirs = readdirSync(projectsBaseDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
      for (const dir of dirs) {
        const projFile = join(projectsBaseDir, dir, "project.json");
        if (!existsSync(projFile)) continue;
        try {
          const proj = JSON.parse(readFileSync(projFile, "utf-8"));
          // Read plan.md and context.md if they exist
          const planPath = join(projectsBaseDir, dir, "plan.md");
          const contextPath = join(projectsBaseDir, dir, "context.md");
          if (existsSync(planPath)) proj.plan = readFileSync(planPath, "utf-8");
          if (existsSync(contextPath)) proj.notes = readFileSync(contextPath, "utf-8");
          projects.push(proj);
        } catch { /* skip corrupt */ }
      }
    } catch { /* dir read error */ }
    return projects;
  }

  function saveProject(project: ProjectEntity): void {
    const projDir = join(projectsBaseDir, project.id);
    if (!existsSync(projDir)) mkdirSync(projDir, { recursive: true });
    // Extract plan and notes to separate files
    const { plan, notes, ...metadata } = project;
    writeFileSync(join(projDir, "project.json"), JSON.stringify({ ...metadata, plan: undefined, notes: undefined }, null, 2));
    if (plan !== undefined) writeFileSync(join(projDir, "plan.md"), plan);
    if (notes !== undefined) writeFileSync(join(projDir, "context.md"), notes);
    // Ensure credentials.json exists
    const credPath = join(projDir, "credentials.json");
    if (!existsSync(credPath)) writeFileSync(credPath, "{}");
  }

  function deleteProjectFolder(projectId: string): void {
    const projDir = join(projectsBaseDir, projectId);
    if (existsSync(projDir)) {
      rmSync(projDir, { recursive: true });
    }
  }

  // GET /api/projects — list all projects (with task rollup per project)
  app.get("/api/projects", (_req, res) => {
    const projects = loadProjects();
    const enriched = projects.map(project => {
      const taskRollup: Record<string, number> = { proposed: 0, approved: 0, in_progress: 0, review: 0, done: 0 };
      const resolvedTasks: any[] = [];
      for (const ref of project.linkedTasks) {
        try {
          const agent = opts.config.agents[ref.agentId];
          if (!agent) continue;
          const data = loadTasksFile(agent, ref.agentId);
          const task = data.tasks.find((t: any) => t.id === ref.taskId);
          if (task) {
            if (taskRollup[task.status] !== undefined) taskRollup[task.status]++;
            resolvedTasks.push({ ...task, agentId: ref.agentId });
          }
        } catch { /* skip */ }
      }
      const totalTasks = project.linkedTasks.length;
      const doneTasks = taskRollup.done;
      return { ...project, taskRollup, totalTasks, doneTasks, resolvedTasks };
    });
    res.json({ projects: enriched });
  });

  // GET /api/projects/:id — get single project with status rollup
  app.get("/api/projects/:id", (req, res) => {
    const projects = loadProjects();
    const project = projects.find(p => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    // Build task status rollup from linked tasks
    const taskRollup: Record<string, number> = { proposed: 0, approved: 0, in_progress: 0, review: 0, done: 0 };
    for (const ref of project.linkedTasks) {
      try {
        const agent = opts.config.agents[ref.agentId];
        if (!agent) continue;
        const data = loadTasksFile(agent, ref.agentId);
        const task = data.tasks.find((t: any) => t.id === ref.taskId);
        if (task && taskRollup[task.status] !== undefined) {
          taskRollup[task.status]++;
        }
      } catch { /* skip */ }
    }

    res.json({ project, taskRollup });
  });

  // POST /api/projects — create a new project
  app.post("/api/projects", (req, res) => {
    const { name, description, owner, teamMembers, plan, notes } = req.body as {
      name?: string; description?: string; owner?: string;
      teamMembers?: string[]; plan?: string; notes?: string;
    };
    if (!name) return res.status(400).json({ error: "Missing name" });

    const id = `proj_${Date.now()}`;
    const now = new Date().toISOString();
    const project: ProjectEntity = {
      id,
      name,
      description: description || "",
      status: "active",
      owner: owner || "hub",
      teamMembers: teamMembers || [],
      plan: plan || "",
      notes: notes || "",
      linkedTasks: [],
      linkedAgents: [],
      linkedOrgs: [],
      linkedApps: [],
      linkedArtifacts: [],
      createdAt: now,
      updatedAt: now,
    };

    saveProject(project);
    log.info(`[Projects] Created project "${name}" (${id}) owned by ${project.owner}`);
    res.json({ ok: true, project });
  });

  // PUT /api/projects/:id — update a project
  app.put("/api/projects/:id", (req, res) => {
    const projects = loadProjects();
    const idx = projects.findIndex(p => p.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "Project not found" });

    const updatable = ["name", "description", "status", "owner", "teamMembers", "plan", "notes",
      "linkedTasks", "linkedAgents", "linkedOrgs", "linkedApps", "linkedArtifacts"] as const;
    for (const key of updatable) {
      if (req.body[key] !== undefined) {
        (projects[idx] as any)[key] = req.body[key];
      }
    }
    projects[idx].updatedAt = new Date().toISOString();
    saveProject(projects[idx]);
    log.info(`[Projects] Updated project ${req.params.id}`);
    res.json({ ok: true, project: projects[idx] });
  });

  // DELETE /api/projects/:id — delete a project
  app.delete("/api/projects/:id", (req, res) => {
    const projects = loadProjects();
    const idx = projects.findIndex(p => p.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "Project not found" });

    deleteProjectFolder(req.params.id);
    log.info(`[Projects] Deleted project ${req.params.id}`);
    res.json({ ok: true });
  });

  // POST /api/projects/:id/link — link entities to a project
  app.post("/api/projects/:id/link", (req, res) => {
    const projects = loadProjects();
    const idx = projects.findIndex(p => p.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "Project not found" });

    const { type, value } = req.body as { type?: string; value?: any };
    if (!type || value === undefined) return res.status(400).json({ error: "Missing type or value" });

    const project = projects[idx];
    switch (type) {
      case "task": {
        const ref = value as { agentId: string; taskId: string };
        if (!ref.agentId || !ref.taskId) return res.status(400).json({ error: "Task link needs agentId and taskId" });
        if (!project.linkedTasks.some(t => t.agentId === ref.agentId && t.taskId === ref.taskId)) {
          project.linkedTasks.push(ref);
        }
        break;
      }
      case "agent":
        if (!project.linkedAgents.includes(value)) project.linkedAgents.push(value);
        break;
      case "org":
        if (!project.linkedOrgs.includes(value)) project.linkedOrgs.push(value);
        break;
      case "app":
        if (!project.linkedApps.includes(value)) project.linkedApps.push(value);
        break;
      case "artifact":
        project.linkedArtifacts.push(value);
        break;
      default:
        return res.status(400).json({ error: `Unknown link type: ${type}` });
    }

    project.updatedAt = new Date().toISOString();
    saveProject(project);
    log.info(`[Projects] Linked ${type} to project ${req.params.id}`);
    res.json({ ok: true, project });
  });

  // POST /api/projects/:id/unlink — remove a linked entity
  app.post("/api/projects/:id/unlink", (req, res) => {
    const projects = loadProjects();
    const idx = projects.findIndex(p => p.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "Project not found" });

    const { type, value } = req.body as { type?: string; value?: any };
    if (!type || value === undefined) return res.status(400).json({ error: "Missing type or value" });

    const project = projects[idx];
    switch (type) {
      case "task":
        project.linkedTasks = project.linkedTasks.filter(
          t => !(t.agentId === value.agentId && t.taskId === value.taskId)
        );
        break;
      case "agent":
        project.linkedAgents = project.linkedAgents.filter(a => a !== value);
        break;
      case "org":
        project.linkedOrgs = project.linkedOrgs.filter(o => o !== value);
        break;
      case "app":
        project.linkedApps = project.linkedApps.filter(a => a !== value);
        break;
      case "artifact":
        project.linkedArtifacts = project.linkedArtifacts.filter(
          (a: any) => a.name !== value.name || a.path !== value.path
        );
        break;
      default:
        return res.status(400).json({ error: `Unknown link type: ${type}` });
    }

    project.updatedAt = new Date().toISOString();
    saveProject(project);
    log.info(`[Projects] Unlinked ${type} from project ${req.params.id}`);
    res.json({ ok: true, project });
  });

  // GET /api/projects/:id/status — formatted status report
  app.get("/api/projects/:id/status", (req, res) => {
    const projects = loadProjects();
    const project = projects.find(p => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const taskRollup: Record<string, number> = { proposed: 0, approved: 0, in_progress: 0, review: 0, done: 0 };
    const taskDetails: any[] = [];
    for (const ref of project.linkedTasks) {
      try {
        const agent = opts.config.agents[ref.agentId];
        if (!agent) continue;
        const data = loadTasksFile(agent, ref.agentId);
        const task = data.tasks.find((t: any) => t.id === ref.taskId);
        if (task) {
          if (taskRollup[task.status] !== undefined) taskRollup[task.status]++;
          taskDetails.push({ ...task, agentId: ref.agentId });
        }
      } catch { /* skip */ }
    }

    const totalTasks = project.linkedTasks.length;
    const doneTasks = taskRollup.done;
    const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    res.json({
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        owner: project.owner,
        teamMembers: project.teamMembers,
      },
      progress: `${progress}%`,
      taskRollup,
      taskDetails,
      linkedAgents: project.linkedAgents,
      linkedOrgs: project.linkedOrgs,
      linkedApps: project.linkedApps,
      linkedArtifacts: project.linkedArtifacts,
    });
  });

  // POST /api/projects/:id/execute — kick off autonomous project execution
  app.post("/api/projects/:id/execute", (req, res) => {
    const projectId = req.params.id;
    const projects = loadProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const ownerAgentId = project.owner;
    if (!ownerAgentId) return res.status(400).json({ error: "Project has no owner agent" });

    const ownerAgent = opts.config.agents[ownerAgentId];
    if (!ownerAgent) return res.status(404).json({ error: `Owner agent "${ownerAgentId}" not found` });

    const { schedule, reportTo, budget } = req.body || {};
    const goalId = "project-exec-" + projectId;
    const heartbeat = schedule || "*/15 * * * *";
    const projectDir = join(getPersonalAgentsDir(opts.config), "projects", projectId);

    // Determine reportTo — use provided value, or auto-detect first Slack route
    let resolvedReportTo = reportTo;
    if (!resolvedReportTo) {
      const slackRoute = ownerAgent.routes.find((r: any) => r.channel === "slack");
      if (slackRoute) {
        resolvedReportTo = "slack:" + String(slackRoute.match.value);
      }
    }

    const instructions = `You are executing project "${project.name}" (${project.id}).

Read the project status: use the get_project_status MCP tool with projectId "${project.id}".

Find the next task that has status "approved" or "in_progress". Skip tasks with status "done" or "blocked".

For the next undone task:
1. Update its status to "in_progress" using update_task
2. Execute the task based on its title and description
3. When complete, update its status to "done" using update_task
4. If you cannot complete it (missing credentials, need human input, external blocker), update its status to "blocked" and explain why

After completing a task, check if there are more undone tasks. If yes, continue to the next one.

If ALL tasks are done, update the project status to "completed" using update_project, and report: "Project '${project.name}' is complete. All tasks finished."

If a task is blocked, report: "Project '${project.name}' is blocked on task: [task title]. Reason: [why]"

Project context and credentials are at: ${projectDir}/context.md and ${projectDir}/credentials.json`;

    const goal = {
      id: goalId,
      description: "Execute project: " + project.name,
      heartbeat,
      enabled: true,
      instructions,
      ...(resolvedReportTo ? { reportTo: resolvedReportTo } : {}),
      budget: budget || { maxDailyUsd: 5 },
    };

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[ownerAgentId];
      if (!agent) return res.status(404).json({ error: "Agent not found in config" });

      if (!agent.goals) agent.goals = [];
      // Replace existing goal if present, otherwise push
      const existingIdx = agent.goals.findIndex((g: any) => g.id === goalId);
      if (existingIdx >= 0) {
        agent.goals[existingIdx] = goal;
      } else {
        agent.goals.push(goal);
      }
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      const memAgent = opts.config.agents[ownerAgentId];
      if (!memAgent.goals) memAgent.goals = [];
      const memIdx = memAgent.goals.findIndex((g: any) => g.id === goalId);
      if (memIdx >= 0) {
        memAgent.goals[memIdx] = goal;
      } else {
        memAgent.goals.push(goal);
      }

      // Update project status
      project.status = "active";
      (project as any).executing = true;
      project.updatedAt = new Date().toISOString();
      saveProject(project);

      log.info(`[Project Execute] ${projectId} — goal ${goalId} created on agent ${ownerAgentId}`);
      res.json({ ok: true, goalId, message: `Execution started for project "${project.name}" with schedule "${heartbeat}"` });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/projects/:id/pause — pause autonomous project execution
  app.post("/api/projects/:id/pause", (req, res) => {
    const projectId = req.params.id;
    const projects = loadProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const ownerAgentId = project.owner;
    if (!ownerAgentId) return res.status(400).json({ error: "Project has no owner agent" });

    const goalId = "project-exec-" + projectId;

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[ownerAgentId];
      if (!agent) return res.status(404).json({ error: "Agent not found in config" });

      const goal = agent.goals?.find((g: any) => g.id === goalId);
      if (!goal) return res.status(404).json({ error: `Goal "${goalId}" not found on agent "${ownerAgentId}"` });

      goal.enabled = false;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      const memAgent = opts.config.agents[ownerAgentId];
      const memGoal = memAgent.goals?.find((g: any) => g.id === goalId);
      if (memGoal) memGoal.enabled = false;

      // Update project
      (project as any).executing = false;
      project.updatedAt = new Date().toISOString();
      saveProject(project);

      log.info(`[Project Pause] ${projectId} — goal ${goalId} disabled`);
      res.json({ ok: true, message: `Execution paused for project "${project.name}"` });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  BOARDS — glanceable widget surfaces showing agent output
  // ═══════════════════════════════════════════════════════════════════

  interface BoardWidget {
    agentId: string;
    x: number;      // grid column (0-based)
    y: number;      // grid row (0-based)
    w: number;      // width in grid columns
    h: number;      // height in grid rows (1+)
    goalId?: string; // show output from a specific goal
    cronIndex?: number; // show output from a specific cron schedule
    scope?: "all" | "goal" | "cron"; // widget scope filter
    title?: string;  // override display title
  }

  interface BoardEntity {
    id: string;
    name: string;
    description: string;
    status: "active" | "paused" | "archived";
    widgets: BoardWidget[];
    refreshSchedule?: string;   // cron expression for auto-refresh
    defaultBoard?: boolean;
    lastRefreshedAt?: string;
    createdAt: string;
    updatedAt: string;
  }

  const boardsBaseDir = join(getPersonalAgentsDir(opts.config), "boards");

  function loadBoards(): BoardEntity[] {
    if (!existsSync(boardsBaseDir)) return [];
    const boards: BoardEntity[] = [];
    try {
      const dirs = readdirSync(boardsBaseDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
      for (const dir of dirs) {
        const boardFile = join(boardsBaseDir, dir, "board.json");
        if (!existsSync(boardFile)) continue;
        try {
          boards.push(JSON.parse(readFileSync(boardFile, "utf-8")));
        } catch { /* skip corrupt */ }
      }
    } catch { /* dir read error */ }
    return boards;
  }

  function saveBoard(board: BoardEntity): void {
    const boardDir = join(boardsBaseDir, board.id);
    if (!existsSync(boardDir)) mkdirSync(boardDir, { recursive: true });
    writeFileSync(join(boardDir, "board.json"), JSON.stringify(board, null, 2));
  }

  function deleteBoardFolder(boardId: string): void {
    const boardDir = join(boardsBaseDir, boardId);
    if (existsSync(boardDir)) rmSync(boardDir, { recursive: true });
  }

  // Helper: get agent's last output from conversation_log.jsonl
  function getAgentLastOutput(agentId: string, goalId?: string): { text: string; response: string; ts: string; channel?: string } | null {
    const agent = opts.config.agents[agentId];
    if (!agent) return null;
    const rt = (p: string) => p?.startsWith("~") ? p.replace("~", homedir()) : p;
    const memDir = rt(agent.memoryDir || join(agent.agentHome || "", "memory"));
    if (!existsSync(memDir)) return null;

    // If goalId specified, check goal log files
    if (goalId) {
      const goalsDir = join(memDir, "..", "goals");
      if (existsSync(goalsDir)) {
        try {
          const logFiles = readdirSync(goalsDir)
            .filter(f => f.startsWith("log-") && f.endsWith(".jsonl"))
            .sort().reverse();
          for (const logFile of logFiles) {
            const lines = readFileSync(join(goalsDir, logFile), "utf-8").trim().split("\n").filter(Boolean);
            for (let i = lines.length - 1; i >= 0; i--) {
              try {
                const entry = JSON.parse(lines[i]);
                if (entry.goalId === goalId) return { text: entry.text || entry.message || "", response: entry.response || "", ts: entry.ts || "", channel: entry.channel };
              } catch { continue; }
            }
          }
        } catch { /* ignore */ }
      }
      return null;
    }

    // Read conversation log (handle per-user mode)
    const isPerUser = (agent as any)?.conversationLogMode === "per-user";
    const logFiles = isPerUser
      ? (existsSync(memDir) ? readdirSync(memDir).filter(f => f.startsWith("conversation_log_") && f.endsWith(".jsonl")).map(f => join(memDir, f)) : [])
      : [join(memDir, "conversation_log.jsonl")];

    let latest: { text: string; response: string; ts: string; channel?: string } | null = null;
    for (const logPath of logFiles) {
      if (!existsSync(logPath)) continue;
      try {
        const content = readFileSync(logPath, "utf-8").trim();
        if (!content) continue;
        const lines = content.split("\n");
        // Read from end to find most recent
        for (let i = lines.length - 1; i >= 0; i--) {
          if (!lines[i]) continue;
          try {
            const entry = JSON.parse(lines[i]);
            if (!latest || (entry.ts && entry.ts > latest.ts)) {
              latest = { text: entry.text || "", response: entry.response || "", ts: entry.ts || "", channel: entry.channel };
            }
            break; // Only need the last entry per file
          } catch { continue; }
        }
      } catch { /* ignore */ }
    }
    return latest;
  }

  // GET /api/boards — list all boards
  app.get("/api/boards", (_req, res) => {
    const boards = loadBoards();
    res.json(boards);
  });

  // GET /api/boards/:id — get single board with enriched widget data
  app.get("/api/boards/:id", (req, res) => {
    const boards = loadBoards();
    const board = boards.find(b => b.id === req.params.id);
    if (!board) return res.status(404).json({ error: "Board not found" });

    const enrichedWidgets = (board.widgets || []).map(w => {
      const agent = opts.config.agents[w.agentId];
      const lastOutput = getAgentLastOutput(w.agentId, w.goalId);
      return {
        ...w,
        agentName: agent?.name || w.agentId,
        agentDescription: agent?.description || "",
        avatar: agent?.avatar || null,
        lastOutput,
      };
    });

    res.json({ ...board, widgets: enrichedWidgets });
  });

  // POST /api/boards — create a new board
  app.post("/api/boards", (req, res) => {
    const { name, description, widgets, refreshSchedule, defaultBoard } = req.body as {
      name?: string; description?: string; widgets?: BoardWidget[];
      refreshSchedule?: string; defaultBoard?: boolean;
    };
    if (!name) return res.status(400).json({ error: "Missing required field: name" });

    const board: BoardEntity = {
      id: `board_${Date.now()}`,
      name,
      description: description || "",
      status: "active",
      widgets: widgets || [],
      refreshSchedule,
      defaultBoard: defaultBoard || false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // If this is marked as default, unmark others
    if (board.defaultBoard) {
      const existing = loadBoards();
      for (const b of existing) {
        if (b.defaultBoard) {
          b.defaultBoard = false;
          saveBoard(b);
        }
      }
    }

    saveBoard(board);
    log.info(`Board created: ${board.id} "${board.name}"`);
    res.json(board);
  });

  // PUT /api/boards/:id — update a board
  app.put("/api/boards/:id", (req, res) => {
    const boards = loadBoards();
    const board = boards.find(b => b.id === req.params.id);
    if (!board) return res.status(404).json({ error: "Board not found" });

    const { name, description, status, widgets, refreshSchedule, defaultBoard } = req.body;
    if (name !== undefined) board.name = name;
    if (description !== undefined) board.description = description;
    if (status !== undefined) board.status = status;
    if (widgets !== undefined) board.widgets = widgets;
    if (refreshSchedule !== undefined) board.refreshSchedule = refreshSchedule;
    if (defaultBoard !== undefined) {
      board.defaultBoard = defaultBoard;
      // Unmark other default boards
      if (defaultBoard) {
        for (const b of boards) {
          if (b.id !== board.id && b.defaultBoard) {
            b.defaultBoard = false;
            saveBoard(b);
          }
        }
      }
    }
    board.updatedAt = new Date().toISOString();
    saveBoard(board);
    log.info(`Board updated: ${board.id}`);
    res.json(board);
  });

  // DELETE /api/boards/:id — delete a board
  app.delete("/api/boards/:id", (req, res) => {
    const boards = loadBoards();
    const board = boards.find(b => b.id === req.params.id);
    if (!board) return res.status(404).json({ error: "Board not found" });
    deleteBoardFolder(board.id);
    log.info(`Board deleted: ${board.id}`);
    res.json({ ok: true });
  });

  // POST /api/boards/:id/widgets — add a widget to a board
  app.post("/api/boards/:id/widgets", (req, res) => {
    const boards = loadBoards();
    const board = boards.find(b => b.id === req.params.id);
    if (!board) return res.status(404).json({ error: "Board not found" });

    const { agentId, x, y, w, h, goalId, cronIndex, scope, title } = req.body as {
      agentId?: string; x?: number; y?: number; w?: number; h?: number;
      goalId?: string; cronIndex?: number; scope?: string; title?: string;
    };
    if (!agentId) return res.status(400).json({ error: "Missing required field: agentId" });

    // Check agent exists and is board-enabled
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });
    if (!agent.boardEnabled && agent.agentClass !== "board") {
      return res.status(400).json({ error: `Agent "${agentId}" is not board-enabled` });
    }

    // Auto-position: find next available slot if x/y not specified
    const widget: BoardWidget = {
      agentId,
      x: x ?? 0,
      y: y ?? (board.widgets.length > 0 ? Math.max(...board.widgets.map(w2 => w2.y + w2.h)) : 0),
      w: w ?? 18,
      h: h ?? 1,
      goalId,
      cronIndex: cronIndex !== undefined ? cronIndex : undefined,
      scope: (scope === "goal" || scope === "cron") ? scope : "all",
      title,
    };

    board.widgets.push(widget);
    board.updatedAt = new Date().toISOString();
    saveBoard(board);
    res.json(board);
  });

  // PUT /api/boards/:id/widgets — update widget positions/sizes (batch)
  app.put("/api/boards/:id/widgets", (req, res) => {
    const boards = loadBoards();
    const board = boards.find(b => b.id === req.params.id);
    if (!board) return res.status(404).json({ error: "Board not found" });

    const { widgets } = req.body as { widgets: BoardWidget[] };
    if (!widgets || !Array.isArray(widgets)) return res.status(400).json({ error: "Missing widgets array" });

    board.widgets = widgets;
    board.updatedAt = new Date().toISOString();
    saveBoard(board);
    res.json(board);
  });

  // DELETE /api/boards/:id/widgets/:agentIdOrIndex — remove a widget from a board
  // If ?byIndex=true, treats param as a numeric index; otherwise filters by agentId
  app.delete("/api/boards/:id/widgets/:agentIdOrIndex", (req, res) => {
    const boards = loadBoards();
    const board = boards.find(b => b.id === req.params.id);
    if (!board) return res.status(404).json({ error: "Board not found" });

    if (req.query.byIndex === "true") {
      const idx = parseInt(req.params.agentIdOrIndex);
      if (isNaN(idx) || idx < 0 || idx >= board.widgets.length) return res.status(404).json({ error: "Widget not found" });
      board.widgets.splice(idx, 1);
    } else {
      const before = board.widgets.length;
      board.widgets = board.widgets.filter(w => w.agentId !== req.params.agentIdOrIndex);
      if (board.widgets.length === before) return res.status(404).json({ error: "Widget not found" });
    }

    board.updatedAt = new Date().toISOString();
    saveBoard(board);
    res.json(board);
  });

  // POST /api/boards/:id/refresh — manual refresh (returns enriched board data)
  app.post("/api/boards/:id/refresh", (_req, res) => {
    const boards = loadBoards();
    const board = boards.find(b => b.id === _req.params.id);
    if (!board) return res.status(404).json({ error: "Board not found" });

    // Re-read all widget outputs (fresh from disk)
    const enrichedWidgets = (board.widgets || []).map(w => {
      const agent = opts.config.agents[w.agentId];
      const lastOutput = getAgentLastOutput(w.agentId, w.goalId);
      return {
        ...w,
        agentName: agent?.name || w.agentId,
        agentDescription: agent?.description || "",
        avatar: agent?.avatar || null,
        lastOutput,
      };
    });

    board.lastRefreshedAt = new Date().toISOString();
    saveBoard(board);
    res.json({ ...board, widgets: enrichedWidgets });
  });

  // ─── API: Channels ───────────────────────────────────────────────

  // GET /api/channels — list all channels with config, sticky settings, and agent routes
  app.get("/api/channels", (_req, res) => {
    const result: any[] = [];

    for (const [channelName, channelCfg] of Object.entries(opts.config.channels)) {
      const cfg = channelCfg.config as Record<string, any>;

      // Find agents with routes on this channel
      const agentsOnChannel: any[] = [];
      for (const [agentId, agent] of Object.entries(opts.config.agents)) {
        for (const route of agent.routes) {
          if (route.channel === channelName) {
            agentsOnChannel.push({
              agentId,
              agentName: agent.name,
              alias: agent.mentionAliases?.[0] || agentId,
              chatId: String(route.match.value),
              requireMention: route.permissions?.requireMention ?? true,
            });
          }
        }
      }

      const entry: any = {
        name: channelName,
        driver: channelCfg.driver,
        enabled: channelCfg.enabled,
        stickyRouting: cfg.stickyRouting ?? "none",
        stickyPrefix: cfg.stickyPrefix ?? "!",
        stickyTimeoutMs: cfg.stickyTimeoutMs ?? 300000,
        agents: agentsOnChannel,
      };

      // iMessage-specific: monitoredChatIds
      if (channelName === "imessage") {
        entry.monitoredChatIds = cfg.monitoredChatIds || [];
      }

      result.push(entry);
    }

    res.json({ channels: result });
  });

  // PUT /api/channels/:channelName — update channel sticky settings
  app.put("/api/channels/:channelName", (req, res) => {
    const { channelName } = req.params;
    const channelCfg = opts.config.channels[channelName];
    if (!channelCfg) return res.status(404).json({ error: `Channel "${channelName}" not found` });

    const { stickyRouting, stickyPrefix, stickyTimeoutMs, enabled } = req.body as {
      stickyRouting?: string;
      stickyPrefix?: string;
      stickyTimeoutMs?: number;
      enabled?: boolean;
    };

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      if (!rawConfig.channels[channelName]) {
        return res.status(404).json({ error: `Channel "${channelName}" not in config.json` });
      }

      // Enable/disable channel
      if (enabled !== undefined) {
        rawConfig.channels[channelName].enabled = enabled;
        opts.config.channels[channelName].enabled = enabled;
      }

      const cfg = rawConfig.channels[channelName].config;
      if (stickyRouting !== undefined) cfg.stickyRouting = stickyRouting;
      if (stickyPrefix !== undefined) cfg.stickyPrefix = stickyPrefix;
      if (stickyTimeoutMs !== undefined) cfg.stickyTimeoutMs = stickyTimeoutMs;

      // Validate JSON before writing
      const json = JSON.stringify(rawConfig, null, 2);
      JSON.parse(json); // validate
      writeFileSync(configPath, json);

      // Update in-memory config
      (opts.config.channels[channelName].config as any).stickyRouting = cfg.stickyRouting;
      (opts.config.channels[channelName].config as any).stickyPrefix = cfg.stickyPrefix;
      (opts.config.channels[channelName].config as any).stickyTimeoutMs = cfg.stickyTimeoutMs;

      log.info(`[Channels] Updated sticky settings for ${channelName}`);
      res.json({ ok: true, note: "Restart service for changes to take full effect." });
    } catch (err) {
      log.error(`[Channels] Failed to update ${channelName}: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/channels/:channelName/credentials — set channel credentials (tokens, auth config)
  app.post("/api/channels/:channelName/credentials", (req, res) => {
    const { channelName } = req.params;
    const channelCfg = opts.config.channels[channelName];
    if (!channelCfg) return res.status(404).json({ error: `Channel "${channelName}" not found` });

    const credentials = req.body as Record<string, any>;
    if (!credentials || Object.keys(credentials).length === 0) {
      return res.status(400).json({ error: "No credentials provided" });
    }

    // Allowed fields per channel to prevent arbitrary config injection
    const allowedFields: Record<string, string[]> = {
      slack: ["botToken", "appToken", "mode"],
      telegram: ["botToken"],
      whatsapp: ["authDir"],
      discord: ["botToken"],
      imessage: ["cliPath", "includeAttachments", "debounceMs", "monitoredChatIds"],
    };
    const allowed = allowedFields[channelName];
    if (allowed) {
      const unknown = Object.keys(credentials).filter(k => !allowed.includes(k));
      if (unknown.length > 0) {
        return res.status(400).json({ error: `Unknown fields for ${channelName}: ${unknown.join(", ")}. Allowed: ${allowed.join(", ")}` });
      }
    }

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      if (!rawConfig.channels[channelName]) {
        return res.status(404).json({ error: `Channel "${channelName}" not in config.json` });
      }

      // Merge credentials into channel config
      const cfg = rawConfig.channels[channelName].config;
      for (const [key, value] of Object.entries(credentials)) {
        cfg[key] = value;
      }

      // Auto-enable the channel when credentials are set
      rawConfig.channels[channelName].enabled = true;

      // Validate JSON before writing
      const json = JSON.stringify(rawConfig, null, 2);
      JSON.parse(json);
      writeFileSync(configPath, json);

      // Update in-memory config
      for (const [key, value] of Object.entries(credentials)) {
        (opts.config.channels[channelName].config as any)[key] = value;
      }
      opts.config.channels[channelName].enabled = true;

      log.info(`[Channels] Updated credentials for ${channelName}`);
      res.json({ ok: true, channelName, fieldsSet: Object.keys(credentials), enabled: true, note: "Restart service for changes to take effect." });
    } catch (err) {
      log.error(`[Channels] Failed to set credentials for ${channelName}: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/channels/:channelName/agents — add agent route to channel
  app.post("/api/channels/:channelName/agents", (req, res) => {
    const { channelName } = req.params;
    if (!opts.config.channels[channelName]) {
      return res.status(404).json({ error: `Channel "${channelName}" not found` });
    }

    const { agentId, chatId, requireMention, allowFrom } = req.body as {
      agentId?: string;
      chatId?: string;
      requireMention?: boolean;
      allowFrom?: string[];
    };

    if (!agentId || !chatId) {
      return res.status(400).json({ error: "Missing agentId or chatId" });
    }

    if (!opts.config.agents[agentId]) {
      return res.status(404).json({ error: `Agent "${agentId}" not found` });
    }

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      const agentCfg = rawConfig.agents[agentId];
      if (!agentCfg) return res.status(404).json({ error: `Agent "${agentId}" not in config.json` });

      // Add route
      const newRoute = {
        channel: channelName,
        match: {
          type: channelName === "slack" ? "channel_id" : "chat_id",
          value: channelName === "imessage" ? (isNaN(Number(chatId)) ? chatId : Number(chatId)) : chatId,
        },
        permissions: {
          allowFrom: allowFrom || ["*"],
          requireMention: requireMention ?? true,
        },
      };
      if (!agentCfg.routes) agentCfg.routes = [];
      agentCfg.routes.push(newRoute);

      // For iMessage, also add to monitoredChatIds if numeric
      if (channelName === "imessage" && !isNaN(Number(chatId))) {
        const monitored = rawConfig.channels.imessage?.config?.monitoredChatIds || [];
        const numId = Number(chatId);
        if (!monitored.includes(numId)) {
          monitored.push(numId);
          rawConfig.channels.imessage.config.monitoredChatIds = monitored;
          // Update in-memory
          (opts.config.channels.imessage.config as any).monitoredChatIds = monitored;
        }
      }

      // Validate and write
      const json = JSON.stringify(rawConfig, null, 2);
      JSON.parse(json);
      writeFileSync(configPath, json);

      // Update in-memory config
      opts.config.agents[agentId].routes.push(newRoute as any);

      log.info(`[Channels] Added route ${channelName}:${chatId} to agent ${agentId}`);
      res.json({ ok: true, note: "Restart service for changes to take full effect." });
    } catch (err) {
      log.error(`[Channels] Failed to add agent route: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // DELETE /api/channels/:channelName/agents/:agentId — remove agent route from channel
  app.delete("/api/channels/:channelName/agents/:agentId", (req, res) => {
    const { channelName, agentId } = req.params;
    if (!opts.config.channels[channelName]) {
      return res.status(404).json({ error: `Channel "${channelName}" not found` });
    }
    if (!opts.config.agents[agentId]) {
      return res.status(404).json({ error: `Agent "${agentId}" not found` });
    }

    const { chatId } = req.body as { chatId?: string };
    if (!chatId) return res.status(400).json({ error: "Missing chatId in body" });

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      const agentCfg = rawConfig.agents[agentId];
      if (!agentCfg) return res.status(404).json({ error: `Agent "${agentId}" not in config.json` });

      // Remove the matching route
      const before = agentCfg.routes?.length || 0;
      agentCfg.routes = (agentCfg.routes || []).filter((r: any) => {
        return !(r.channel === channelName && String(r.match.value) === chatId);
      });
      const removed = before - (agentCfg.routes?.length || 0);

      // For iMessage, also remove from monitoredChatIds if no more routes use this chatId
      if (channelName === "imessage" && !isNaN(Number(chatId))) {
        const numId = Number(chatId);
        // Check if any agent still has a route to this chatId on imessage
        const stillUsed = Object.values(rawConfig.agents).some((a: any) =>
          (a.routes || []).some((r: any) => r.channel === "imessage" && Number(r.match.value) === numId)
        );
        if (!stillUsed && rawConfig.channels.imessage?.config?.monitoredChatIds) {
          rawConfig.channels.imessage.config.monitoredChatIds =
            rawConfig.channels.imessage.config.monitoredChatIds.filter((id: number) => id !== numId);
          (opts.config.channels.imessage.config as any).monitoredChatIds =
            rawConfig.channels.imessage.config.monitoredChatIds;
        }
      }

      // Validate and write
      const json = JSON.stringify(rawConfig, null, 2);
      JSON.parse(json);
      writeFileSync(configPath, json);

      // Update in-memory
      opts.config.agents[agentId].routes = opts.config.agents[agentId].routes.filter(
        r => !(r.channel === channelName && String(r.match.value) === chatId)
      );

      log.info(`[Channels] Removed ${removed} route(s) ${channelName}:${chatId} from agent ${agentId}`);
      res.json({ ok: true, removed, note: "Restart service for changes to take full effect." });
    } catch (err) {
      log.error(`[Channels] Failed to remove agent route: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/channels/:channelName/monitored — add monitoredChatId (iMessage only)
  app.post("/api/channels/:channelName/monitored", (req, res) => {
    const { channelName } = req.params;
    if (channelName !== "imessage") return res.status(400).json({ error: "monitoredChatIds only applies to iMessage" });
    if (!opts.config.channels.imessage) return res.status(404).json({ error: "iMessage channel not found" });

    const { chatId } = req.body as { chatId?: number };
    if (chatId == null || isNaN(chatId)) return res.status(400).json({ error: "Missing or invalid chatId (must be number)" });

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      const monitored = rawConfig.channels.imessage?.config?.monitoredChatIds || [];
      if (monitored.includes(chatId)) return res.json({ ok: true, note: "Already monitored" });
      monitored.push(chatId);
      rawConfig.channels.imessage.config.monitoredChatIds = monitored;

      const json = JSON.stringify(rawConfig, null, 2);
      JSON.parse(json);
      writeFileSync(configPath, json);

      (opts.config.channels.imessage.config as any).monitoredChatIds = monitored;
      log.info(`[Channels] Added monitoredChatId ${chatId} to iMessage`);
      res.json({ ok: true, note: "Restart service for changes to take full effect." });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // DELETE /api/channels/:channelName/monitored — remove monitoredChatId (iMessage only)
  app.delete("/api/channels/:channelName/monitored", (req, res) => {
    const { channelName } = req.params;
    if (channelName !== "imessage") return res.status(400).json({ error: "monitoredChatIds only applies to iMessage" });
    if (!opts.config.channels.imessage) return res.status(404).json({ error: "iMessage channel not found" });

    const { chatId } = req.body as { chatId?: number };
    if (chatId == null || isNaN(chatId)) return res.status(400).json({ error: "Missing or invalid chatId (must be number)" });

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      let monitored = rawConfig.channels.imessage?.config?.monitoredChatIds || [];
      monitored = monitored.filter((id: number) => id !== chatId);
      rawConfig.channels.imessage.config.monitoredChatIds = monitored;

      const json = JSON.stringify(rawConfig, null, 2);
      JSON.parse(json);
      writeFileSync(configPath, json);

      (opts.config.channels.imessage.config as any).monitoredChatIds = monitored;
      log.info(`[Channels] Removed monitoredChatId ${chatId} from iMessage`);
      res.json({ ok: true, note: "Restart service for changes to take full effect." });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── WhatsApp Gallery (photoGroups) ──────────────────────────────
  // GET /api/channels/whatsapp/gallery — list all gallery-linked groups
  app.get("/api/channels/whatsapp/gallery", (_req, res) => {
    if (!opts.config.channels.whatsapp) return res.status(404).json({ error: "WhatsApp channel not found" });
    const waConfig = (opts.config.channels.whatsapp.config || {}) as Record<string, any>;
    const photoGroups = waConfig.photoGroups || {};
    res.json({ photoGroups });
  });

  // POST /api/channels/whatsapp/gallery — add/update a gallery-linked group
  app.post("/api/channels/whatsapp/gallery", (req, res) => {
    if (!opts.config.channels.whatsapp) return res.status(404).json({ error: "WhatsApp channel not found" });
    const { groupJid, uploadUrl, secret } = req.body as { groupJid?: string; uploadUrl?: string; secret?: string };
    if (!groupJid || !uploadUrl || !secret) {
      return res.status(400).json({ error: "Missing required fields: groupJid, uploadUrl, secret" });
    }

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      if (!rawConfig.channels?.whatsapp?.config) {
        rawConfig.channels.whatsapp.config = {};
      }
      if (!rawConfig.channels.whatsapp.config.photoGroups) {
        rawConfig.channels.whatsapp.config.photoGroups = {};
      }
      rawConfig.channels.whatsapp.config.photoGroups[groupJid] = { uploadUrl, secret };

      const json = JSON.stringify(rawConfig, null, 2);
      JSON.parse(json); // validate
      writeFileSync(configPath, json);

      // Update in-memory config
      if (!(opts.config.channels.whatsapp.config as any).photoGroups) {
        (opts.config.channels.whatsapp.config as any).photoGroups = {};
      }
      (opts.config.channels.whatsapp.config as any).photoGroups[groupJid] = { uploadUrl, secret };

      // Hot-reload the WhatsApp driver's photoGroups map
      const waDriver = opts.driverMap?.get("whatsapp") as any;
      if (waDriver?.updatePhotoGroups) {
        waDriver.updatePhotoGroups((opts.config.channels.whatsapp.config as any).photoGroups);
      }

      log.info(`[Gallery] Added gallery link: ${groupJid} → ${uploadUrl}`);
      res.json({ ok: true, groupJid, uploadUrl });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // DELETE /api/channels/whatsapp/gallery — remove a gallery-linked group
  app.delete("/api/channels/whatsapp/gallery", (req, res) => {
    if (!opts.config.channels.whatsapp) return res.status(404).json({ error: "WhatsApp channel not found" });
    const { groupJid } = req.body as { groupJid?: string };
    if (!groupJid) return res.status(400).json({ error: "Missing required field: groupJid" });

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      if (rawConfig.channels?.whatsapp?.config?.photoGroups) {
        delete rawConfig.channels.whatsapp.config.photoGroups[groupJid];
      }

      const json = JSON.stringify(rawConfig, null, 2);
      JSON.parse(json); // validate
      writeFileSync(configPath, json);

      // Update in-memory config
      if ((opts.config.channels.whatsapp.config as any)?.photoGroups) {
        delete (opts.config.channels.whatsapp.config as any).photoGroups[groupJid];
      }

      // Hot-reload the WhatsApp driver's photoGroups map
      const waDriver = opts.driverMap?.get("whatsapp") as any;
      if (waDriver?.updatePhotoGroups) {
        waDriver.updatePhotoGroups((opts.config.channels.whatsapp.config as any).photoGroups || {});
      }

      log.info(`[Gallery] Removed gallery link: ${groupJid}`);
      res.json({ ok: true, removed: groupJid });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── Webhook endpoint ─────────────────────────────────────────────
  app.post("/webhook/:agentId", async (req, res) => {
    if (opts.webhookSecret) {
      const provided = req.headers["x-webhook-secret"] || req.query.secret;
      if (provided !== opts.webhookSecret) {
        return res.status(401).json({ error: "Invalid webhook secret" });
      }
    }

    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const { text, channel, chatId } = req.body as { text?: string; channel?: string; chatId?: string };
    if (!text) return res.status(400).json({ error: "Missing 'text' in body" });

    const route = agent.routes[0];
    const replyChannel = channel || route.channel;
    const replyChatId = chatId || String(route.match.value);

    if (opts.onWebhookMessage) {
      try {
        await opts.onWebhookMessage(agentId, text, replyChannel, replyChatId);
        res.json({ ok: true, agentId, channel: replyChannel, chatId: replyChatId });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    } else {
      res.status(501).json({ error: "Webhook handler not configured" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  NEW API ENDPOINTS — Sessions, Model, Cost, Pairing, Logs, Memory, Skills
  // ═══════════════════════════════════════════════════════════════════

  const home = homedir();
  const tilde = (p: string) => p?.startsWith("~") ? p.replace("~", home) : p;

  // Helper: resolve agent memoryDir
  function agentMemDir(agentId: string): string | null {
    const agent = opts.config.agents[agentId];
    if (!agent) return null;
    return tilde(agent.memoryDir || join(agent.agentHome || "", "memory"));
  }

  // ─── API: Sessions ──────────────────────────────────────────────────

  // GET /api/agents/:agentId/sessions — list all sessions for an agent
  app.get("/api/agents/:agentId/sessions", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    if (!existsSync(memDir)) return res.json({ sessions: [] });
    try {
      const files = readdirSync(memDir).filter(f => f.startsWith("session") && f.endsWith(".json"));
      const sessions = files.map(f => {
        try {
          const data = JSON.parse(readFileSync(join(memDir, f), "utf-8"));
          const senderMatch = f.match(/^session-(.+)\.json$/);
          return {
            senderId: senderMatch ? senderMatch[1] : "default",
            sessionId: data.sessionId,
            createdAt: data.createdAt,
            messageCount: data.messageCount || 0,
            file: f,
          };
        } catch { return null; }
      }).filter(Boolean);
      res.json({ sessions });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/agents/:agentId/sessions/reset — reset session (optionally for a sender)
  app.post("/api/agents/:agentId/sessions/reset", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const { senderId } = req.body as { senderId?: string };
    const fileName = senderId ? `session-${senderId}.json` : "session.json";
    const sessionPath = join(memDir, fileName);
    if (!existsSync(sessionPath)) return res.json({ ok: true, message: "No session to reset" });
    try {
      const state = JSON.parse(readFileSync(sessionPath, "utf-8"));
      unlinkSync(sessionPath);
      res.json({ ok: true, previousMessages: state.messageCount || 0 });
    } catch (e: any) {
      try { unlinkSync(sessionPath); } catch { /* ignore */ }
      res.json({ ok: true, message: "Session file removed" });
    }
  });

  // DELETE /api/agents/:agentId/sessions/:senderId — delete a specific session
  app.delete("/api/agents/:agentId/sessions/:senderId", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const fileName = req.params.senderId === "default" ? "session.json" : `session-${req.params.senderId}.json`;
    const sessionPath = join(memDir, fileName);
    if (!existsSync(sessionPath)) return res.status(404).json({ error: "Session not found" });
    try { unlinkSync(sessionPath); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── API: Named Session Tabs (server-side persistence) ─────────────────────

  function sessionTabsPath(agentId: string): string | null {
    const memDir = agentMemDir(agentId);
    if (!memDir) return null;
    return join(memDir, "session-tabs.json");
  }

  function readSessionTabs(agentId: string): { tabs: any[] } {
    const p = sessionTabsPath(agentId);
    if (!p || !existsSync(p)) return { tabs: [] };
    try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return { tabs: [] }; }
  }

  function writeSessionTabs(agentId: string, data: { tabs: any[] }): void {
    const p = sessionTabsPath(agentId);
    if (!p) return;
    const memDir = agentMemDir(agentId)!;
    if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true });
    writeFileSync(p, JSON.stringify(data, null, 2));
  }

  // GET /api/agents/:agentId/session-tabs — list all named sessions with last activity
  app.get("/api/agents/:agentId/session-tabs", (req, res) => {
    if (!agentMemDir(req.params.agentId)) return res.status(404).json({ error: "Agent not found" });
    const data = readSessionTabs(req.params.agentId);
    const memDir = agentMemDir(req.params.agentId)!;
    const logPath = join(memDir, "conversation_log.jsonl");
    // Enrich each tab with lastMessageAt + lastPreview from JSONL
    if (existsSync(logPath)) {
      try {
        const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
        const lastByTab: Record<string, { ts: string; preview: string }> = {};
        for (const line of lines) {
          try {
            const e = JSON.parse(line);
            if (e.from && (!lastByTab[e.from] || e.ts > lastByTab[e.from].ts)) {
              lastByTab[e.from] = { ts: e.ts, preview: (e.text || "").slice(0, 60) };
            }
          } catch { /* skip malformed */ }
        }
        data.tabs = data.tabs.map((t: any) => ({
          ...t,
          lastMessageAt: lastByTab[t.id]?.ts || t.createdAt,
          lastPreview: lastByTab[t.id]?.preview || "",
        }));
      } catch { /* ignore, return tabs without enrichment */ }
    }
    // Sort newest first
    data.tabs.sort((a: any, b: any) => (b.lastMessageAt || b.createdAt) > (a.lastMessageAt || a.createdAt) ? 1 : -1);
    res.json({ tabs: data.tabs });
  });

  // POST /api/agents/:agentId/session-tabs — register/upsert a tab
  app.post("/api/agents/:agentId/session-tabs", (req, res) => {
    const { agentId } = req.params;
    if (!agentMemDir(agentId)) return res.status(404).json({ error: "Agent not found" });
    const { tabId, label, targetAgentId } = req.body as { tabId?: string; label?: string; targetAgentId?: string };
    if (!tabId) return res.status(400).json({ error: "tabId required" });
    // Validate targetAgentId if provided
    if (targetAgentId && !opts.config.agents[targetAgentId]) {
      return res.status(400).json({ error: `targetAgentId "${targetAgentId}" not found` });
    }
    const data = readSessionTabs(agentId);
    const idx = data.tabs.findIndex((t: any) => t.id === tabId);
    if (idx >= 0) {
      if (label) data.tabs[idx].label = label;
      if (targetAgentId !== undefined) data.tabs[idx].targetAgentId = targetAgentId || null;
      data.tabs[idx].updatedAt = new Date().toISOString();
    } else {
      data.tabs.push({ id: tabId, label: label || `Session ${data.tabs.length + 1}`, ...(targetAgentId ? { targetAgentId } : {}), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    writeSessionTabs(agentId, data);
    res.json({ ok: true, tab: data.tabs.find((t: any) => t.id === tabId) });
  });

  // PUT /api/agents/:agentId/session-tabs/:tabId — rename a tab
  app.put("/api/agents/:agentId/session-tabs/:tabId", (req, res) => {
    const { agentId, tabId } = req.params;
    if (!agentMemDir(agentId)) return res.status(404).json({ error: "Agent not found" });
    const { label } = req.body as { label?: string };
    if (!label?.trim()) return res.status(400).json({ error: "label required" });
    const data = readSessionTabs(agentId);
    const tab = data.tabs.find((t: any) => t.id === tabId);
    if (!tab) return res.status(404).json({ error: "Tab not found" });
    tab.label = label.trim();
    tab.updatedAt = new Date().toISOString();
    writeSessionTabs(agentId, data);
    res.json({ ok: true, tab });
  });

  // DELETE /api/agents/:agentId/session-tabs/:tabId — permanently delete a tab + its session
  app.delete("/api/agents/:agentId/session-tabs/:tabId", (req, res) => {
    const { agentId, tabId } = req.params;
    const memDir = agentMemDir(agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const data = readSessionTabs(agentId);
    data.tabs = data.tabs.filter((t: any) => t.id !== tabId);
    writeSessionTabs(agentId, data);
    // Also clear the Claude session file so if re-opened it starts fresh
    const sessionFile = join(memDir, `session-${tabId}.json`);
    if (existsSync(sessionFile)) { try { unlinkSync(sessionFile); } catch { /* ignore */ } }
    res.json({ ok: true });
  });

  // GET /api/agents/:agentId/session-tabs/:tabId/history — replay chat from JSONL
  app.get("/api/agents/:agentId/session-tabs/:tabId/history", (req, res) => {
    const { agentId, tabId } = req.params;
    const memDir = agentMemDir(agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const logPath = join(memDir, "conversation_log.jsonl");
    if (!existsSync(logPath)) return res.json({ messages: [] });
    try {
      const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
      const messages: any[] = [];
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          if (e.from !== tabId) continue;
          if (e.text) messages.push({ role: "user", text: e.text, time: e.ts });
          if (e.response) messages.push({ role: "agent", text: e.response, time: e.ts });
        } catch { /* skip malformed */ }
      }
      res.json({ messages });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── API: Model Overrides ───────────────────────────────────────────

  // GET /api/agents/:agentId/model — get current model override
  app.get("/api/agents/:agentId/model", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const p = join(memDir, "model-override.json");
    if (!existsSync(p)) return res.json({ model: null, isOverride: false });
    try {
      const data = JSON.parse(readFileSync(p, "utf-8"));
      res.json({ model: data.model || null, isOverride: true });
    } catch { res.json({ model: null, isOverride: false }); }
  });

  // PUT /api/agents/:agentId/model — set model override
  app.put("/api/agents/:agentId/model", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const { model } = req.body as { model?: string };
    if (!model?.trim()) return res.status(400).json({ error: "model required" });
    const aliases: Record<string, string> = {
      opus: "claude-opus-4-7", sonnet: "claude-sonnet-4-6",
      haiku: "claude-haiku-4-5-20251001", "opus-4": "claude-opus-4-7",
      "opus-4.7": "claude-opus-4-7", "opus-4.6": "claude-opus-4-6", "sonnet-4": "claude-sonnet-4-6",
    };
    const resolved = aliases[model.trim().toLowerCase()] || model.trim();
    writeFileSync(join(memDir, "model-override.json"), JSON.stringify({ model: resolved }));
    res.json({ ok: true, model: resolved });
  });

  // DELETE /api/agents/:agentId/model — clear model override
  app.delete("/api/agents/:agentId/model", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const p = join(memDir, "model-override.json");
    if (existsSync(p)) try { unlinkSync(p); } catch { /* ignore */ }
    res.json({ ok: true });
  });

  // ─── API: Cost Tracking ─────────────────────────────────────────────

  // GET /api/agents/:agentId/cost?period=today|week|all — cost summary
  app.get("/api/agents/:agentId/cost", (req, res) => {
    const agentId = req.params.agentId;
    const memDir = agentMemDir(agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const agentCfg = opts.config.agents[agentId];
    const isPerUser = (agentCfg as any)?.conversationLogMode === "per-user";
    // For per-user mode, aggregate all per-user log files
    const logFiles = isPerUser
      ? (existsSync(memDir) ? readdirSync(memDir).filter(f => f.startsWith("conversation_log_") && f.endsWith(".jsonl")).map(f => join(memDir, f)) : [])
      : [join(memDir, "conversation_log.jsonl")];
    const anyExists = logFiles.some(f => existsSync(f));
    if (!anyExists) return res.json({ today: 0, week: 0, allTime: 0, totalMessages: 0, entries: [] });
    try {
      const entries = logFiles.flatMap(logPath => {
        if (!existsSync(logPath)) return [];
        return readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean)
          .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      });
      const sum = (arr: any[]) => arr.reduce((s: number, e: any) => s + (e.cost || 0), 0);
      const today = new Date().toISOString().slice(0, 10);
      const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
      const todayEntries = entries.filter((e: any) => e.ts?.startsWith(today));
      const weekEntries = entries.filter((e: any) => e.ts >= weekAgo);

      // Optional: return per-day breakdown
      const byDay: Record<string, { cost: number; messages: number }> = {};
      for (const e of entries) {
        const day = e.ts?.slice(0, 10);
        if (!day) continue;
        if (!byDay[day]) byDay[day] = { cost: 0, messages: 0 };
        byDay[day].cost += e.cost || 0;
        byDay[day].messages += 1;
      }

      res.json({
        today: sum(todayEntries),
        week: sum(weekEntries),
        allTime: sum(entries),
        totalMessages: entries.length,
        byDay,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/cost/all — cost summary across ALL agents
  app.get("/api/cost/all", (_req, res) => {
    const agents: Record<string, { today: number; week: number; allTime: number; messages: number }> = {};
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    for (const [agentId, agent] of Object.entries(opts.config.agents)) {
      const memDir = tilde(agent.memoryDir || join(agent.agentHome || "", "memory"));
      const logPath = join(memDir, "conversation_log.jsonl");
      if (!existsSync(logPath)) continue;
      try {
        const entries = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean)
          .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        const sum = (arr: any[]) => arr.reduce((s: number, e: any) => s + (e.cost || 0), 0);
        agents[agentId] = {
          today: sum(entries.filter((e: any) => e.ts?.startsWith(today))),
          week: sum(entries.filter((e: any) => e.ts >= weekAgo)),
          allTime: sum(entries),
          messages: entries.length,
        };
      } catch { /* skip */ }
    }
    res.json({ agents });
  });

  // ─── API: Pairing / Authorization ───────────────────────────────────

  // GET /api/pairing — list paired senders
  app.get("/api/pairing", (_req, res) => {
    const storePath = join(opts.baseDir, "data", "paired-senders.json");
    if (!existsSync(storePath)) return res.json({ paired: [], pairingEnabled: !!opts.config.service?.pairingCode });
    try {
      const data = JSON.parse(readFileSync(storePath, "utf-8")) as string[];
      res.json({ paired: data, pairingEnabled: !!opts.config.service?.pairingCode });
    } catch { res.json({ paired: [], pairingEnabled: !!opts.config.service?.pairingCode }); }
  });

  // POST /api/pairing — manually pair a sender
  app.post("/api/pairing", (req, res) => {
    const { senderKey } = req.body as { senderKey?: string };
    if (!senderKey?.trim()) return res.status(400).json({ error: "senderKey required (format: channel:senderId)" });
    const storePath = join(opts.baseDir, "data", "paired-senders.json");
    let paired: string[] = [];
    try { if (existsSync(storePath)) paired = JSON.parse(readFileSync(storePath, "utf-8")); } catch { /* fresh */ }
    if (!paired.includes(senderKey.trim())) paired.push(senderKey.trim());
    mkdirSync(join(opts.baseDir, "data"), { recursive: true });
    writeFileSync(storePath, JSON.stringify(paired, null, 2));
    res.json({ ok: true, paired });
  });

  // DELETE /api/pairing/:senderKey — unpair a sender
  app.delete("/api/pairing/:senderKey", (req, res) => {
    const storePath = join(opts.baseDir, "data", "paired-senders.json");
    if (!existsSync(storePath)) return res.json({ ok: true });
    try {
      let paired = JSON.parse(readFileSync(storePath, "utf-8")) as string[];
      paired = paired.filter(s => s !== req.params.senderKey);
      writeFileSync(storePath, JSON.stringify(paired, null, 2));
      res.json({ ok: true, paired });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── API: Conversation Logs ─────────────────────────────────────────

  // GET /api/agents/:agentId/logs?limit=50&offset=0&search=keyword&sender=<senderId>
  // When conversationLogMode is "per-user", aggregates all per-user log files unless ?sender= is specified.
  app.get("/api/agents/:agentId/logs", (req, res) => {
    const agentId = req.params.agentId;
    const memDir = agentMemDir(agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const agentCfg = opts.config.agents[agentId];
    const isPerUser = (agentCfg as any)?.conversationLogMode === "per-user";
    const senderFilter = req.query.sender as string | undefined;

    const readLog = (path: string): any[] => {
      if (!existsSync(path)) return [];
      try {
        return readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
          .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      } catch { return []; }
    };

    let entries: any[];
    if (isPerUser) {
      // Collect all per-user log files, or just the specified sender's file
      if (senderFilter) {
        const sanitized = senderFilter.replace(/[^a-zA-Z0-9_-]/g, "_");
        entries = readLog(join(memDir, `conversation_log_${sanitized}.jsonl`));
      } else {
        // Aggregate all per-user log files
        const files = existsSync(memDir)
          ? readdirSync(memDir).filter(f => f.startsWith("conversation_log_") && f.endsWith(".jsonl"))
          : [];
        entries = files.flatMap(f => readLog(join(memDir, f)));
        // Sort by timestamp after aggregation
        entries.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
      }
    } else {
      entries = readLog(join(memDir, "conversation_log.jsonl"));
    }

    // Search filter
    const search = req.query.search as string;
    if (search) {
      const q = search.toLowerCase();
      entries = entries.filter((e: any) =>
        (e.text || "").toLowerCase().includes(q) ||
        (e.response || "").toLowerCase().includes(q)
      );
    }

    const total = entries.length;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    // Return newest first
    entries.reverse();
    entries = entries.slice(offset, offset + limit);

    res.json({ entries, total, limit, offset, perUserMode: isPerUser });
  });

  // ─── API: Memory Management ─────────────────────────────────────────

  // GET /api/agents/:agentId/memory?limit=20 — list memory entries (context.md + daily files)
  app.get("/api/agents/:agentId/memory", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const entries: any[] = [];

    // context.md
    const ctxPath = join(memDir, "context.md");
    if (existsSync(ctxPath)) {
      try {
        const content = readFileSync(ctxPath, "utf-8");
        entries.push({ type: "context", file: "context.md", size: content.length, preview: content.slice(0, 500) });
      } catch { /* skip */ }
    }

    // Daily memory files
    const dailyDir = join(memDir, "daily");
    if (existsSync(dailyDir)) {
      try {
        const files = readdirSync(dailyDir).filter(f => f.endsWith(".md")).sort().reverse();
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        for (const f of files.slice(0, limit)) {
          try {
            const content = readFileSync(join(dailyDir, f), "utf-8");
            entries.push({ type: "daily", file: f, size: content.length, preview: content.slice(0, 500) });
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    // Memory index (if advanced memory is enabled)
    const indexPath = join(memDir, "memory-index.json");
    if (existsSync(indexPath)) {
      try {
        const idx = JSON.parse(readFileSync(indexPath, "utf-8"));
        entries.push({ type: "index", file: "memory-index.json", chunks: Array.isArray(idx) ? idx.length : (idx.chunks?.length || 0) });
      } catch { /* skip */ }
    }

    res.json({ entries });
  });

  // POST /api/agents/:agentId/memory/search — search memory (simple keyword)
  app.post("/api/agents/:agentId/memory/search", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const { query } = req.body as { query?: string };
    if (!query?.trim()) return res.status(400).json({ error: "query required" });
    const q = query.toLowerCase();
    const results: any[] = [];

    // Search context.md
    const ctxPath = join(memDir, "context.md");
    if (existsSync(ctxPath)) {
      const content = readFileSync(ctxPath, "utf-8");
      if (content.toLowerCase().includes(q)) {
        results.push({ file: "context.md", type: "context", snippet: extractSnippet(content, q) });
      }
    }

    // Search daily files
    const dailyDir = join(memDir, "daily");
    if (existsSync(dailyDir)) {
      for (const f of readdirSync(dailyDir).filter(f => f.endsWith(".md")).sort().reverse()) {
        const content = readFileSync(join(dailyDir, f), "utf-8");
        if (content.toLowerCase().includes(q)) {
          results.push({ file: `daily/${f}`, type: "daily", snippet: extractSnippet(content, q) });
        }
        if (results.length >= 20) break;
      }
    }

    res.json({ results, query });
  });

  // DELETE /api/agents/:agentId/memory/context — clear context.md
  app.delete("/api/agents/:agentId/memory/context", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const ctxPath = join(memDir, "context.md");
    if (existsSync(ctxPath)) writeFileSync(ctxPath, "");
    res.json({ ok: true });
  });

  // ─── API: Memory Write ─────────────────────────────────────────────
  app.post("/api/agents/:agentId/memory/write", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const { target, content } = req.body as any;
    if (!content) return res.status(400).json({ error: "content is required" });

    try {
      if (target === "context") {
        const ctxPath = join(memDir, "context.md");
        const existing = existsSync(ctxPath) ? readFileSync(ctxPath, "utf-8") : "";
        writeFileSync(ctxPath, existing ? existing + "\n" + content : content);
        res.json({ ok: true, file: "context.md", action: "appended" });
      } else if (target === "daily") {
        const dailyDir = join(memDir, "daily");
        mkdirSync(dailyDir, { recursive: true });
        const today = new Date().toISOString().slice(0, 10);
        const dailyPath = join(dailyDir, `${today}.md`);
        const existing = existsSync(dailyPath) ? readFileSync(dailyPath, "utf-8") : "";
        writeFileSync(dailyPath, existing ? existing + "\n" + content : content);
        res.json({ ok: true, file: `daily/${today}.md`, action: "appended" });
      } else {
        // Default: overwrite context.md entirely
        const ctxPath = join(memDir, "context.md");
        writeFileSync(ctxPath, content);
        res.json({ ok: true, file: "context.md", action: "overwritten" });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API: Skill Content Read ──────────────────────────────────────
  app.get("/api/skills/content", (req, res) => {
    const skillPath = req.query.path as string;
    if (!skillPath) return res.status(400).json({ error: "path query param required" });
    const resolved = tilde(skillPath);
    if (!existsSync(resolved)) return res.status(404).json({ error: "Skill file not found" });
    try {
      const content = readFileSync(resolved, "utf-8");
      res.json({ ok: true, path: resolved, content });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API: Update Goal ─────────────────────────────────────────────
  app.put("/api/agents/:id/goals/:goalId", (req, res) => {
    const { id: agentId, goalId } = req.params;
    const updates = req.body as any;
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[agentId];
      if (!agent) return res.status(404).json({ error: "Agent not found" });
      const idx = (agent.goals || []).findIndex((g: any) => g.id === goalId);
      if (idx < 0) return res.status(404).json({ error: `Goal "${goalId}" not found` });

      // Merge updates into existing goal
      agent.goals[idx] = { ...agent.goals[idx], ...updates, id: goalId };
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      const memAgent = opts.config.agents[agentId];
      if (memAgent?.goals?.[idx]) memAgent.goals[idx] = agent.goals[idx];

      log.info(`[Goal Update] ${agentId}/${goalId}`);
      res.json({ ok: true, goal: agent.goals[idx] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API: Update Cron ─────────────────────────────────────────────
  app.put("/api/agents/:id/cron/:index", (req, res) => {
    const { id: agentId } = req.params;
    const index = parseInt(req.params.index, 10);
    const updates = req.body as any;
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[agentId];
      if (!agent) return res.status(404).json({ error: "Agent not found" });
      if (!agent.cron?.[index]) return res.status(404).json({ error: `Cron index ${index} not found` });

      // Merge updates into existing cron
      agent.cron[index] = { ...agent.cron[index], ...updates };
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      const memAgent = opts.config.agents[agentId];
      if (memAgent?.cron?.[index]) memAgent.cron[index] = agent.cron[index];

      log.info(`[Cron Update] ${agentId} index ${index}`);
      res.json({ ok: true, index, cron: agent.cron[index] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API: Service Restart / Shutdown ──────────────────────────────
  app.post("/api/restart", (_req, res) => {
    res.json({ ok: true, message: "Restarting in 2 seconds..." });
    setTimeout(() => {
      log.info("[Restart] Service restart triggered via API");
      // Spawn a shell that waits 2s then starts the replacement process.
      // The delay ensures the current process has fully exited and released
      // the port before the new one starts. This avoids the race condition
      // where both the child AND launchd/KeepAlive try to grab the port.
      const restartCmd = `"${process.execPath}" ${process.argv.slice(1).map(a => `"${a}"`).join(" ")}`;
      const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
      const shellArgs = process.platform === "win32"
        ? ["-NoProfile", "-Command", `Start-Sleep -Seconds 2; & ${restartCmd}`]
        : ["-c", `sleep 2 && ${restartCmd} &`];
      const child = cpSpawn(shell, shellArgs, {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: "ignore",
        detached: true,
      });
      child.unref();
      process.exit(0);
    }, 1000);
  });

  app.post("/api/shutdown", (_req, res) => {
    res.json({ ok: true, message: "Shutting down..." });
    setTimeout(() => {
      log.info("[Shutdown] Service shutdown triggered via API");
      process.exit(0);
    }, 500);
  });

  // ─── API: Platform Updates ──────────────────────────────────────────

  // GET /api/version — current + latest version
  app.get("/api/version", async (_req, res) => {
    try {
      const pkgPath = join(opts.baseDir, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const current = pkg.version || "unknown";
      // Fetch latest from npm registry
      let latest = current;
      let updateAvailable = false;
      try {
        const resp = await fetch("https://registry.npmjs.org/myaiforone/latest", {
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          const data = await resp.json() as any;
          latest = data.version || current;
          // Semver comparison: only flag update if latest is actually newer
          const parse = (v: string) => v.split(".").map(Number);
          const [cMaj, cMin, cPat] = parse(current);
          const [lMaj, lMin, lPat] = parse(latest);
          updateAvailable = lMaj > cMaj || (lMaj === cMaj && lMin > cMin) || (lMaj === cMaj && lMin === cMin && lPat > cPat);
        }
      } catch { /* offline or timeout */ }
      res.json({ ok: true, current, latest, updateAvailable });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/update — update to latest version and restart
  app.post("/api/update", async (_req, res) => {
    try {
      const platform = process.platform;
      log.info("[Update] Platform update triggered via API");

      // Detect if managed by a system service (launchd on Mac, Task Scheduler on Windows)
      // These services auto-restart the process when it exits, so we just need to update
      // the global package and exit — no need to spawn a competing npx process.
      const launchdPlist = join(homedir(), "Library", "LaunchAgents", "com.agenticledger.channelToAgentToClaude.plist");
      const isMacService = platform === "darwin" && existsSync(launchdPlist);
      const isWinService = platform === "win32" &&
        opts.baseDir.includes("node_modules") &&
        (opts.baseDir.includes("npm") || opts.baseDir.includes("yarn")) &&
        !opts.baseDir.includes("_npx");
      const isManagedService = isMacService || isWinService;

      // NOTE: We intentionally do NOT delete the npx cache here.
      // Deleting it before the new version downloads can leave the app with no files at all
      // if the download fails. npx myaiforone@latest already fetches the latest version from
      // npm automatically — manual cache clearing is unnecessary and was causing data loss.

      if (isManagedService) {
        // Try to update the global package so the service manager restarts with new version
        log.info(`[Update] Managed service detected (${platform}) — running npm install -g myaiforone@latest`);
        let globalUpdateOk = false;
        try {
          execSync("npm install -g myaiforone@latest", { timeout: 120_000, stdio: "ignore" });
          log.info("[Update] Global install updated successfully");
          globalUpdateOk = true;
        } catch (installErr: any) {
          log.warn(`[Update] Global install failed: ${installErr.message}`);
        }

        if (globalUpdateOk) {
          res.json({ ok: true, message: "Updated. Service will restart automatically..." });
          // Just exit — launchd / Task Scheduler will restart with the updated package
          setTimeout(() => process.exit(0), 1000);
        } else if (isMacService) {
          // Permissions issue — unload launchd so it doesn't restart the old version,
          // then spawn npx to pull and run the latest
          res.json({ ok: true, message: "Updating via npx (run `sudo npm install -g myaiforone@latest` in Terminal for faster updates)..." });
          setTimeout(() => {
            log.info("[Update] Unloading launchd service before npx spawn...");
            try { execSync(`launchctl unload "${launchdPlist}"`, { timeout: 5_000, stdio: "ignore" }); } catch {}
            const child = cpSpawn("npx", ["myaiforone@latest"], {
              cwd: process.cwd(),
              env: { ...process.env },
              stdio: "ignore",
              detached: true,
              shell: true,
            });
            child.unref();
            process.exit(0);
          }, 1000);
        } else {
          // Windows with no write access — nothing we can do automatically
          res.json({ ok: false, message: "Update failed: permission denied. Run `npm install -g myaiforone@latest` as Administrator." });
        }
      } else {
        // Running via npx or direct node — clear cache and spawn new process
        res.json({ ok: true, message: "Clearing cache and restarting with latest version..." });
        setTimeout(() => {
          log.info("[Update] Spawning npx myaiforone@latest...");
          const child = cpSpawn("npx", ["myaiforone@latest"], {
            cwd: process.cwd(),
            env: { ...process.env },
            stdio: "ignore",
            detached: true,
            shell: true,
          });
          child.unref();
          process.exit(0);
        }, 1000);
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/open-terminal — open a system terminal with a pre-loaded command
  app.post("/api/open-terminal", (req, res) => {
    const { command } = req.body as { command?: string };
    if (!command?.trim()) return res.status(400).json({ error: "command required" });
    const platform = process.platform;
    try {
      if (platform === "darwin") {
        // Open Terminal.app with the command pre-loaded (doesn't auto-run, user presses Enter)
        const escaped = command.replace(/'/g, "'\\''");
        cpSpawn("osascript", [
          "-e", `tell application "Terminal" to do script "${escaped}"`,
          "-e", `tell application "Terminal" to activate`,
        ], { stdio: "ignore" }).unref();
      } else if (platform === "win32") {
        cpSpawn("cmd.exe", ["/c", "start", "cmd.exe", "/k", command], {
          stdio: "ignore", detached: true, shell: false,
        }).unref();
      } else {
        // Linux: try common terminal emulators
        const terminals = ["gnome-terminal", "xterm", "konsole", "xfce4-terminal"];
        let launched = false;
        for (const term of terminals) {
          try {
            cpSpawn(term, ["--", "bash", "-c", `${command}; exec bash`], {
              stdio: "ignore", detached: true,
            }).unref();
            launched = true;
            break;
          } catch { continue; }
        }
        if (!launched) return res.status(500).json({ error: "No terminal emulator found. Run the command manually." });
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API: Skills ────────────────────────────────────────────────────

  // GET /api/agents/:agentId/skills — list all skills available to an agent
  app.get("/api/agents/:agentId/skills", (req, res) => {
    const agent = opts.config.agents[req.params.agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    const memDir = tilde(agent.memoryDir || join(agent.agentHome || "", "memory"));
    const claudeDir = join(home, ".claude", "commands");
    const personalDir = join(tilde(getPersonalAgentsDir(opts.config)), "skills");
    const agentSkillsDir = join(memDir, "..", "skills");
    const orgNames = (agent.org || []).map((o: any) => o.organization).filter(Boolean);

    const skills: any[] = [];

    // Shared skills (explicitly configured)
    for (const name of (agent.skills || [])) {
      const personalPath = join(personalDir, `${name}.md`);
      const claudePath = join(claudeDir, `${name}.md`);
      const filePath = existsSync(personalPath) ? personalPath : existsSync(claudePath) ? claudePath : null;
      if (filePath) {
        try {
          const content = readFileSync(filePath, "utf-8");
          const descMatch = content.match(/description:\s*(.+)/);
          const scriptsMatch = content.match(/scripts:\s*(.+)/);
          skills.push({
            name, level: "shared", path: filePath,
            description: descMatch?.[1]?.trim() || "",
            scripts: scriptsMatch?.[1]?.trim() || null,
          });
        } catch { skills.push({ name, level: "shared", path: filePath, description: "" }); }
      }
    }

    // Org-scoped skills (auto-discovered)
    for (const org of orgNames) {
      const orgDir = join(tilde(getPersonalAgentsDir(opts.config)), org, "skills");
      if (!existsSync(orgDir)) continue;
      for (const f of readdirSync(orgDir).filter((f: string) => f.endsWith(".md"))) {
        const name = f.replace(".md", "");
        const filePath = join(orgDir, f);
        try {
          const content = readFileSync(filePath, "utf-8");
          const descMatch = content.match(/description:\s*(.+)/);
          const scriptsMatch = content.match(/scripts:\s*(.+)/);
          skills.push({
            name, level: "org", org, path: filePath,
            description: descMatch?.[1]?.trim() || "",
            scripts: scriptsMatch?.[1]?.trim() || null,
          });
        } catch { skills.push({ name, level: "org", org, path: filePath, description: "" }); }
      }
    }

    // Agent-specific skills
    for (const name of (agent.agentSkills || [])) {
      const filePath = join(agentSkillsDir, `${name}.md`);
      if (!existsSync(filePath)) continue;
      try {
        const content = readFileSync(filePath, "utf-8");
        const descMatch = content.match(/description:\s*(.+)/);
        const scriptsMatch = content.match(/scripts:\s*(.+)/);
        skills.push({
          name, level: "agent", path: filePath,
          description: descMatch?.[1]?.trim() || "",
          scripts: scriptsMatch?.[1]?.trim() || null,
        });
      } catch { skills.push({ name, level: "agent", path: filePath, description: "" }); }
    }

    res.json({ skills });
  });

  // GET /api/skills/org/:orgName — list all skills in an org
  app.get("/api/skills/org/:orgName", (req, res) => {
    const orgDir = join(tilde(getPersonalAgentsDir(opts.config)), req.params.orgName, "skills");
    if (!existsSync(orgDir)) return res.json({ skills: [], org: req.params.orgName });
    try {
      const skills = readdirSync(orgDir).filter((f: string) => f.endsWith(".md")).map(f => {
        const name = f.replace(".md", "");
        const filePath = join(orgDir, f);
        try {
          const content = readFileSync(filePath, "utf-8");
          const descMatch = content.match(/description:\s*(.+)/);
          const scriptsMatch = content.match(/scripts:\s*(.+)/);
          const hasScripts = scriptsMatch ? existsSync(join(orgDir, scriptsMatch[1].trim().replace(/\/$/, ""))) : false;
          return { name, path: filePath, description: descMatch?.[1]?.trim() || "", scripts: scriptsMatch?.[1]?.trim() || null, hasScripts };
        } catch { return { name, path: filePath, description: "" }; }
      });
      res.json({ skills, org: req.params.orgName });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── API: Sticky Routing ────────────────────────────────────────────

  // GET /api/sticky-routing — show active sticky assignments
  app.get("/api/sticky-routing", (_req, res) => {
    // Sticky state is in-memory in router.ts — we can read the data dir for channel configs
    const channelConfigs: any[] = [];
    for (const [name, ch] of Object.entries(opts.config.channels)) {
      const cfg = ch.config as Record<string, any>;
      channelConfigs.push({
        channel: name,
        stickyRouting: cfg.stickyRouting || "prefix",
        stickyPrefix: cfg.stickyPrefix || "!",
        stickyTimeoutMs: cfg.stickyTimeoutMs || 300000,
      });
    }
    res.json({ channels: channelConfigs });
  });

  // ─── Helper: extract snippet around keyword ─────────────────────────
  function extractSnippet(text: string, keyword: string, radius: number = 100): string {
    const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (idx === -1) return text.slice(0, 200);
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + keyword.length + radius);
    return (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
  }

  // ─── Health check ─────────────────────────────────────────────────
  // ─── API: Changelog (parsed from git log) ────────────────────────
  app.get("/api/changelog", (_req, res) => {
    try {
      const raw = execSync(
        `git log --format='COMMIT_START%n%h%n%ci%n%s%n%b%nCOMMIT_END' -100`,
        { cwd: opts.baseDir, timeout: 10_000 },
      ).toString();

      const commits = raw.split("COMMIT_START\n").filter(Boolean).map(block => {
        const lines = block.replace(/\nCOMMIT_END\n?$/, "").split("\n");
        const hash = lines[0];
        const date = lines[1];
        const subject = lines[2] || "";
        const body = lines.slice(3).join("\n").trim();

        // Parse conventional commit prefix
        const prefixMatch = subject.match(/^(feat|fix|refactor|docs|chore|perf|test|style|ci|build)(\(.+?\))?:\s*/i);
        const type = prefixMatch ? prefixMatch[1].toLowerCase() : "other";
        const title = prefixMatch ? subject.slice(prefixMatch[0].length) : subject;

        return { hash, date, type, title, body: body.replace(/Co-Authored-By:.*$/gm, "").trim() };
      }).filter(c => ["feat", "fix", "refactor", "docs", "perf"].includes(c.type));

      // Group by date
      const grouped: Record<string, typeof commits> = {};
      for (const c of commits) {
        const day = c.date.split(" ")[0]; // YYYY-MM-DD
        if (!grouped[day]) grouped[day] = [];
        grouped[day].push(c);
      }

      res.json({ days: grouped });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/changelog", (_req, res) => servePage(res, "changelog.html"));
  app.get("/user-guide", (_req, res) => servePage(res, "user-guide.html"));

  app.get("/docs/user-guide.md", (_req, res) => {
    const guidePath = join(opts.baseDir, "docs", "user-guide.md");
    try {
      const content = readFileSync(guidePath, "utf8");
      res.type("text/markdown").send(content);
    } catch {
      if (!res.headersSent) res.status(404).send("User guide not found.");
    }
  });

  // ─── API: User Guide ────────────────────────────────────────────
  app.get("/api/user-guide", (_req, res) => {
    try {
      const content = readFileSync(resolve(opts.baseDir, "docs", "user-guide.md"), "utf-8");
      res.json({ ok: true, content });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API: Capabilities (Discovery) ────────────────────────────────
  app.get("/api/capabilities", (_req, res) => {
    res.json({
      platform: "MyAIforOne",
      version: "1.0.0",
      features: {
        sharedAgents: isSharedAgentsAllowed(opts.config),
        gym: !!(opts.config.service as any).gymEnabled,
      },
      categories: {
        agents: {
          description: "Create, configure, and manage AI agents",
          actions: ["list_agents", "get_agent", "get_agent_instructions", "create_agent", "update_agent", "delete_agent", "recover_agent", "get_agent_registry"]
        },
        chat: {
          description: "Send messages and manage conversations with agents",
          actions: ["send_message", "delegate_message", "start_stream", "get_chat_job_raw", "stop_chat_job"]
        },
        sessions: {
          description: "Manage agent conversation sessions",
          actions: ["list_sessions", "reset_session", "delete_session"]
        },
        tasks: {
          description: "Task management across agents",
          actions: ["list_tasks", "create_task", "update_task", "delete_task", "get_all_tasks", "get_task_stats", "create_project"]
        },
        goals: {
          description: "Autonomous goal tracking with scheduled execution",
          actions: ["create_goal", "update_goal", "toggle_goal", "trigger_goal", "delete_goal", "get_goal_history"]
        },
        cron: {
          description: "Scheduled message triggers",
          actions: ["create_cron", "update_cron", "toggle_cron", "trigger_cron", "delete_cron", "get_cron_history"]
        },
        automations: {
          description: "View all goals and crons across agents",
          actions: ["list_automations"]
        },
        skills: {
          description: "Manage reusable instruction sets for agents",
          actions: ["get_agent_skills", "get_org_skills", "create_skill", "get_skill_content"]
        },
        mcps: {
          description: "MCP server registry and connections",
          actions: ["list_mcps", "get_mcp_catalog", "list_mcp_keys", "save_mcp_key", "delete_mcp_key", "list_mcp_connections", "create_mcp_connection", "delete_mcp_connection"]
        },
        marketplace: {
          description: "Browse, install, and assign skills/prompts/agents/MCPs",
          actions: ["browse_registry", "install_registry_item", "assign_to_agent", "set_platform_default", "scan_skills", "import_skills", "create_prompt", "create_skill", "add_mcp_to_registry", "get_prompt_trigger", "set_prompt_trigger"]
        },
        channels: {
          description: "Configure messaging channels and agent routing",
          actions: ["list_channels", "update_channel", "add_agent_route", "remove_agent_route", "add_monitored_chat", "remove_monitored_chat", "get_sticky_routing"]
        },
        gallery: {
          description: "WhatsApp photo gallery integration — auto-upload images from groups to galleries",
          actions: ["list_gallery_groups", "add_gallery_group", "remove_gallery_group"]
        },
        memory: {
          description: "Read, search, write, and clear agent memory",
          actions: ["get_agent_memory", "search_memory", "write_memory", "clear_memory_context"]
        },
        files: {
          description: "File storage per agent",
          actions: ["list_agent_files", "download_agent_file", "upload_file"]
        },
        apps: {
          description: "Registered web applications",
          actions: ["list_apps", "create_app", "update_app", "delete_app", "check_app_health"]
        },
        cost: {
          description: "Usage cost tracking",
          actions: ["get_agent_cost", "get_all_costs"]
        },
        model: {
          description: "Override Claude model per agent",
          actions: ["get_model", "set_model", "clear_model"]
        },
        activity: {
          description: "Activity feeds and conversation logs",
          actions: ["get_activity", "get_agent_logs"]
        },
        accounts: {
          description: "Claude account management and authentication",
          actions: ["list_accounts", "add_account", "delete_account", "check_account_status", "start_account_login", "submit_login_code", "whoami"]
        },
        config: {
          description: "Service configuration and deployment",
          actions: ["get_service_config", "update_service_config", "restart_service"]
        },
        saas: {
          description: "SaaS publishing integration",
          actions: ["get_saas_config", "update_saas_config", "test_saas_connection", "publish_to_saas"]
        },
        pairing: {
          description: "Authorized sender management",
          actions: ["list_paired_senders", "pair_sender", "unpair_sender"]
        },
        heartbeat: {
          description: "Agent health checks",
          actions: ["trigger_heartbeat", "get_heartbeat_history"]
        },
        templates: {
          description: "Agent templates — browse, deploy, and save agent blueprints",
          actions: ["list_templates", "deploy_template", "save_agent_as_template"]
        },
        platform: {
          description: "Platform-level tools",
          actions: ["health_check", "get_dashboard", "get_changelog", "get_user_guide", "list_capabilities", "get_platform_agents", "browse_dirs", "install_xbar", "send_webhook"]
        }
      }
    });
  });

  // ─── API: Drive — browse, read, search the PersonalAgents drive ──

  const driveRoot = () => tilde(getPersonalAgentsDir(opts.config));
  const registryRoot = () => tilde(getPersonalRegistryDir(opts.config));

  // Ensure a path stays within the drive
  function safeDrivePath(userPath: string): string | null {
    const root = driveRoot();
    const regRoot = registryRoot();
    const resolved = resolve(userPath.startsWith("~") ? tilde(userPath) : userPath);
    if (resolved.startsWith(root) || resolved.startsWith(regRoot)) return resolved;
    return null;
  }

  app.get("/api/drive/browse", (req, res) => {
    const target = (req.query.path as string) || driveRoot();
    const resolved = safeDrivePath(target);
    if (!resolved) return res.status(403).json({ error: "Path outside drive" });
    if (!existsSync(resolved)) return res.status(404).json({ error: "Path not found" });

    try {
      const stat = statSync(resolved);
      if (!stat.isDirectory()) {
        return res.json({ type: "file", path: resolved, size: stat.size });
      }
      const entries = readdirSync(resolved, { withFileTypes: true }).map(d => ({
        name: d.name,
        type: d.isDirectory() ? "dir" : "file",
        size: d.isFile() ? statSync(join(resolved, d.name)).size : undefined,
      }));
      res.json({ type: "dir", path: resolved, entries });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/drive/read", (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: "path query param required" });
    const resolved = safeDrivePath(filePath);
    if (!resolved) return res.status(403).json({ error: "Path outside drive" });
    if (!existsSync(resolved)) return res.status(404).json({ error: "File not found" });

    try {
      const stat = statSync(resolved);
      if (stat.isDirectory()) return res.status(400).json({ error: "Path is a directory, use /api/drive/browse" });
      if (stat.size > 1024 * 1024) return res.status(413).json({ error: "File too large (>1MB). Use download endpoint instead." });
      const content = readFileSync(resolved, "utf-8");
      res.json({ ok: true, path: resolved, size: stat.size, content });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/drive/search", (req, res) => {
    const query = (req.query.q as string || "").toLowerCase();
    const searchPath = (req.query.path as string) || driveRoot();
    const maxResults = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const fileTypes = (req.query.types as string || ".md,.json,.jsonl,.txt").split(",");

    if (!query) return res.status(400).json({ error: "q query param required" });
    const resolved = safeDrivePath(searchPath);
    if (!resolved) return res.status(403).json({ error: "Path outside drive" });

    const results: any[] = [];

    function searchDir(dir: string, depth: number) {
      if (depth > 8 || results.length >= maxResults) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (results.length >= maxResults) break;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
            searchDir(full, depth + 1);
          } else if (entry.isFile() && fileTypes.some(t => entry.name.endsWith(t))) {
            try {
              const stat = statSync(full);
              if (stat.size > 512 * 1024) continue; // skip files > 512KB
              const content = readFileSync(full, "utf-8");
              const lower = content.toLowerCase();
              const idx = lower.indexOf(query);
              if (idx >= 0) {
                const start = Math.max(0, idx - 80);
                const end = Math.min(content.length, idx + query.length + 80);
                results.push({
                  path: full,
                  relativePath: full.replace(driveRoot() + "/", ""),
                  size: stat.size,
                  snippet: (start > 0 ? "..." : "") + content.slice(start, end).replace(/\n/g, " ") + (end < content.length ? "..." : ""),
                });
              }
            } catch { /* skip unreadable files */ }
          }
        }
      } catch { /* skip unreadable dirs */ }
    }

    searchDir(resolved, 0);
    res.json({ ok: true, query, results, total: results.length, searchPath: resolved });
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  // ─── License info ────────────────────────────────────────────────
  app.get("/api/license", async (_req, res) => {
    try {
      const { getLicense } = await import("./license.js");
      const license = getLicense();
      res.json(license || { valid: true });
    } catch {
      res.json({ valid: true });
    }
  });

  // Dry-run: verify a key against the license server WITHOUT saving it to
  // config or touching the cached license. Used by the Admin UI's "Verify
  // Only" button so admins can test a key before saving.
  app.post("/api/license/check", async (req, res) => {
    try {
      const { licenseKey } = req.body || {};
      if (!licenseKey || typeof licenseKey !== "string") {
        res.status(400).json({ valid: false, error: "licenseKey required" });
        return;
      }
      const { checkLicenseNoCache } = await import("./license.js");
      const licenseUrl = (opts.config.service as any).licenseUrl;
      const result = await checkLicenseNoCache(licenseKey, licenseUrl);
      res.json(result);
    } catch (err) {
      res.status(500).json({ valid: false, error: String(err) });
    }
  });

  // ─── Startup: sync config.json MCPs → registry ───────────────────
  try {
    const cfgMcps = (opts.config as any).mcps || {};
    for (const [id, entry] of Object.entries(cfgMcps)) {
      syncMcpToRegistry(id, entry as any, { name: id, category: "personal" });
    }
  } catch (err) {
    log.warn(`[Registry Sync] MCP startup sync failed: ${err}`);
  }

  // ─── Startup: sync disk skills → PersonalRegistry ───────────────────────
  try {
    // Personal skills go to PersonalRegistry/skills.json (outside repo)
    const skillRegistryPath = join(getPersonalRegistryDir(opts.config), "skills.json");
    mkdirSync(dirname(skillRegistryPath), { recursive: true });
    let skillRegistry: any = { skills: [] };
    try { skillRegistry = JSON.parse(readFileSync(skillRegistryPath, "utf-8")); } catch { /* fresh */ }
    if (!Array.isArray(skillRegistry.skills)) skillRegistry.skills = [];
    // Also include ids already in the platform registry so we don't re-add platform skills as personal
    const platformRegistryPath = join(opts.baseDir, "registry", "skills.json");
    const platformIds = new Set<string>();
    try {
      const pd = JSON.parse(readFileSync(platformRegistryPath, "utf-8"));
      (pd.skills || []).forEach((s: any) => platformIds.add(s.id));
    } catch { /* ignore */ }
    const existingSkillIds = new Set([...skillRegistry.skills.map((s: any) => s.id), ...platformIds]);
    let added = 0;

    // Scan: ~/.claude/commands, personalAgents/skills, org skills dirs
    const skillDirs: Array<{ dir: string; source: string; provider: string }> = [
      { dir: join(homedir(), ".claude", "commands"), source: "global", provider: "AgenticLedger" },
      { dir: join(tilde(getPersonalAgentsDir(opts.config)), "skills"), source: "personal", provider: "me" },
    ];
    // Add org skill dirs
    const orgNames = new Set<string>();
    for (const agent of Object.values(opts.config.agents)) {
      for (const o of (agent.org || [])) {
        if (o.organization) orgNames.add(o.organization);
      }
    }
    for (const org of orgNames) {
      skillDirs.push({ dir: join(tilde(getPersonalAgentsDir(opts.config)), org, "skills"), source: "org", provider: "me" });
    }

    for (const { dir, source, provider } of skillDirs) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter((f: string) => f.endsWith(".md"))) {
        const id = file.replace(".md", "");
        if (existingSkillIds.has(id)) continue;
        try {
          const content = readFileSync(join(dir, file), "utf-8");
          const descMatch = content.match(/description:\s*(.+)/);
          skillRegistry.skills.push({
            id, name: id.replace(/[_-]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
            provider, description: descMatch?.[1]?.trim() || "",
            category: source, verified: false, source: "local",
            tags: [source], localPath: join(dir, file),
          });
          existingSkillIds.add(id);
          added++;
        } catch { /* skip unreadable */ }
      }
    }
    if (added > 0) {
      writeFileSync(skillRegistryPath, JSON.stringify(skillRegistry, null, 2));
      log.info(`[Registry Sync] Auto-added ${added} skills to registry`);
    }
  } catch (err) {
    log.warn(`[Registry Sync] Skill startup sync failed: ${err}`);
  }

  // Let callers attach extra routes (e.g. /mcp Streamable HTTP) to the same
  // Express app before the global error handler + listen.
  if (opts.attachExtraRoutes) {
    try {
      opts.attachExtraRoutes(app);
    } catch (err: any) {
      log.warn(`[Web UI] attachExtraRoutes failed: ${err?.message || err}`);
    }
  }

  // Global error handler — catch unhandled Express errors instead of
  // dumping raw stack traces to the browser
  app.use((err: any, _req: any, res: any, _next: any) => {
    log.warn(`[Web UI] Unhandled error: ${err.message}`);
    if (!res.headersSent) {
      res.status(err.status || 500).json({ error: err.message || "Internal server error" });
    }
  });

  // Hook for extra routes (e.g. /mcp) — runs after all core /api/* routes
  // are registered but before listen(), so callers can attach sibling
  // endpoints on the same port.
  if (opts.attachExtraRoutes) {
    try {
      opts.attachExtraRoutes(app);
    } catch (err) {
      log.warn(`attachExtraRoutes failed: ${err}`);
    }
  }

  app.listen(opts.port, () => {
    log.info(`Web UI running on http://localhost:${opts.port}/ui`);

    // Start gym activity digest cron if gymEnabled
    if ((opts.config.service as any).gymEnabled) {
      const gymAgentDigest = opts.config.agents?.gym;
      startActivityDigest({ baseDir: opts.baseDir, port: opts.port, memoryDir: gymAgentDigest?.memoryDir || undefined });
    }
  });
}
