import express from "express";
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, basename, dirname, extname, relative, isAbsolute } from "node:path";
import { execSync } from "node:child_process";
import type { AppConfig } from "./config.js";
import { getPersonalAgentsDir, getPersonalRegistryDir } from "./config.js";
import type { InboundMessage } from "./channels/types.js";
import type { ResolvedRoute } from "./router.js";
import { executeAgent, executeAgentStreaming, handleRelogin } from "./executor.js";
import { executeGoal } from "./goals.js";
import { executeHeartbeat, loadHeartbeatHistory } from "./heartbeat.js";
import type { McpServerConfig } from "./config.js";
import { log } from "./logger.js";

interface WebUIOptions {
  config: AppConfig;
  baseDir: string;
  port: number;
  webhookSecret?: string;
  onWebhookMessage?: (agentId: string, text: string, channel: string, chatId: string) => Promise<void>;
  driverMap?: Map<string, import("./channels/types.js").ChannelDriver>;
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

  // ─── Serve the Home page ─────────────────────────────────────────
  app.get("/", (_req, res) => res.redirect("/org"));

  app.get("/home", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "home.html");
    if (existsSync(htmlPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(htmlPath);
    } else {
      res.redirect("/org");
    }
  });

  // ─── Serve the Activity Logs page (redirects to admin) ──────────
  app.get("/activity", (_req, res) => {
    res.redirect("/admin?tab=activity");
  });

  // ─── Serve the UI HTML (no-cache to always get latest) ──────────
  app.get("/ui", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "index.html");
    if (existsSync(htmlPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(htmlPath);
    } else {
      res.status(404).send("UI not found. Create public/index.html");
    }
  });

  // ─── Serve the My Library page ──────────────────────────────────
  app.get("/library", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "library.html");
    if (existsSync(htmlPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(htmlPath);
    } else {
      res.redirect("/marketplace");
    }
  });

  // ─── Serve the Marketplace page ────────────────────────────────
  app.get("/marketplace", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "marketplace.html");
    if (existsSync(htmlPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(htmlPath);
    } else {
      res.status(404).send("Marketplace page not found.");
    }
  });

  // ─── Serve the Org page ────────────────────────────────────────
  app.get("/org", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "org.html");
    if (existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send("Org page not found.");
    }
  });

  // ─── Serve the Admin page ──────────────────────────────────────
  app.get("/admin", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "admin.html");
    if (existsSync(htmlPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(htmlPath);
    } else {
      res.status(404).send("Admin page not found.");
    }
  });

  // ─── Channels redirects to admin ───────────────────────────────
  app.get("/channels", (_req, res) => {
    res.redirect("/admin?tab=channels");
  });

  // ─── Serve the Tasks page ───────────────────────────────────────
  app.get("/tasks", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "tasks.html");
    if (existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send("Tasks page not found.");
    }
  });

  // ─── Serve the Lab page ──────────────────────────────────────────
  app.get("/lab", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "lab.html");
    if (existsSync(htmlPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(htmlPath);
    } else {
      res.status(404).send("Lab page not found.");
    }
  });

  // /apps route removed — Apps are now managed in the Registry (marketplace) Apps tab

  // ─── Serve the Agent Dashboard page ────────────────────────────
  app.get("/agent-dashboard", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "agent-dashboard.html");
    if (existsSync(htmlPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(htmlPath);
    } else {
      res.redirect("/org");
    }
  });

  app.get("/mini", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "mini.html");
    if (existsSync(htmlPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(htmlPath);
    } else {
      res.status(404).send("Mini bar not found.");
    }
  });

  app.get("/settings", (_req, res) => {
    res.redirect("/admin?tab=settings");
  });

  app.get("/mcp-docs", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "mcp-docs.html");
    if (existsSync(htmlPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(htmlPath);
    } else {
      res.status(404).send("MCP docs not found.");
    }
  });

  app.get("/api-docs", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "api-docs.html");
    if (existsSync(htmlPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(htmlPath);
    } else {
      res.status(404).send("API docs not found.");
    }
  });

  // ─── API: Claude Accounts ────────────────────────────────────────
  const configFilePath = () => join(opts.baseDir, "config.json");

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
    const { spawn } = require("node:child_process");
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) { if (v !== undefined && k !== "CLAUDECODE" && k !== "CLAUDE_CODE_ENTRYPOINT") env[k] = v; }
    env.CLAUDE_CONFIG_DIR = resolvedPath;

    const proc = spawn("claude", ["auth", "login"], { env, stdio: ["pipe", "pipe", "pipe"] });
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
      for (const [k, v] of Object.entries(process.env)) { if (v !== undefined && k !== "CLAUDECODE" && k !== "CLAUDE_CODE_ENTRYPOINT") env[k] = v; }
      env.CLAUDE_CONFIG_DIR = resolvedPath;
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
    res.json({
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
    });
  });

  app.put("/api/config/service", (req, res) => {
    const { personalAgentsDir, personalRegistryDir, webUIPort, logLevel, logFile, pairingCode, webhookSecret, webUIEnabled, deployment } = req.body as any;
    try {
      const raw = JSON.parse(readFileSync(configFilePath(), "utf-8"));
      if (!raw.service) raw.service = {};
      if (personalAgentsDir !== undefined) raw.service.personalAgentsDir = personalAgentsDir;
      if (personalRegistryDir !== undefined) raw.service.personalRegistryDir = personalRegistryDir;
      if (logLevel !== undefined) raw.service.logLevel = logLevel;
      if (logFile !== undefined) raw.service.logFile = logFile;
      if (pairingCode !== undefined) raw.service.pairingCode = pairingCode || undefined;
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
      res.json({ ok: true, note: "Restart required for port/dir changes to take effect" });
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
            advancedMemory: agent.advancedMemory ?? false, agentClass: agent.agentClass || "standard",
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
      const { chmodSync } = require("node:fs");
      chmodSync(dest, 0o755);
      res.json({ ok: true, path: dest });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Dashboard ───────────────────────────────────────────────
  app.get("/api/dashboard", (_req, res) => {
    const agents = Object.entries(opts.config.agents)
      .map(([id, agent]) => {
      const memoryDir = agent.memoryDir ? resolve(opts.baseDir, agent.memoryDir) : join(getPersonalAgentsDir(), id, "memory");
      const logPath = join(memoryDir, "conversation_log.jsonl");

      let messageCount = 0;
      let lastMessage = "never";
      let sessionActive = false;

      if (existsSync(logPath)) {
        try {
          const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
          messageCount = lines.length;
          if (lines.length > 0) {
            const last = JSON.parse(lines[lines.length - 1]);
            lastMessage = last.ts;
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
        advancedMemory: agent.advancedMemory ?? false,
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
      };
    });

    const channels = Object.entries(opts.config.channels)
      .filter(([, c]) => c.enabled)
      .map(([id]) => id);

    // Find default group agent (first one with subAgents, or explicitly set)
    const defaultGroupAgent = (opts.config.service as any).defaultGroupAgent
      || Object.entries(opts.config.agents).find(([, a]) => a.subAgents)?.[0]
      || null;

    res.json({
      status: "running",
      uptime: process.uptime(),
      channels,
      agents,
      mcpCount: Object.keys(opts.config.mcps || {}).length,
      claudeAccounts: Object.keys(opts.config.service.claudeAccounts || {}),
      defaultGroupAgent,
    });
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

    const { text, accountOverride } = req.body as { text?: string; accountOverride?: string };
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
      sender: "web-user",
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

    const { text, accountOverride } = req.body as { text?: string; accountOverride?: string };
    if (!text?.trim()) return res.status(400).json({ error: "Missing 'text' in body" });

    // Apply account override from web UI dropdown.
    // Track last-used account per agent so we only force a new session on the
    // actual transition, not on every subsequent message with the same override.
    const effectiveAccount = accountOverride || agent.claudeAccount || "";
    const lastAccount = agentLastAccount.get(agentId) || (agent.claudeAccount || "");
    const accountChanged = effectiveAccount !== lastAccount;
    if (effectiveAccount) agentLastAccount.set(agentId, effectiveAccount);

    const effectiveAgent = accountOverride
      ? { ...agent, claudeAccount: accountOverride, ...(accountChanged ? { forceNewSession: true } : {}) }
      : agent;

    log.info(`[WebUI Stream] ${agentId} <- web: ${text.slice(0, 80)}${accountOverride ? ` (account: ${accountOverride})` : ''}`);

    // Create job
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: StreamJob = { events: [], rawLines: [], rawListeners: new Set(), done: false, stopped: false, createdAt: Date.now(), listeners: new Set() };
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
      sender: "web-user",
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
        for await (const event of executeAgentStreaming(route, syntheticMsg, opts.baseDir, opts.config.mcps, opts.config.service.claudeAccounts, pushRawLine, { skills: opts.config.defaultSkills, mcps: opts.config.defaultMcps, prompts: opts.config.defaultPrompts, promptTrigger: opts.config.promptTrigger })) {
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
        const configPath = join(opts.baseDir, "config.json");
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

    const configPath = join(opts.baseDir, "config.json");
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

    const configPath = join(opts.baseDir, "config.json");
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
            advancedMemory: meta.advancedMemory ?? false,
            mentionAliases: [alias],
            allowedTools: meta.allowedTools || ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
            timeout: meta.timeout || 14400000,
            agentClass: meta.agentClass || "standard",
          };
          (opts.config.agents as any)[agentId] = agentCfg;
          const rawConfig = JSON.parse(readFileSync(join(opts.baseDir, "config.json"), "utf-8"));
          rawConfig.agents = rawConfig.agents || {};
          rawConfig.agents[agentId] = agentCfg;
          writeFileSync(join(opts.baseDir, "config.json"), JSON.stringify(rawConfig, null, 2));

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
    const configPath = join(opts.baseDir, "config.json");
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

    const configPath = join(opts.baseDir, "config.json");
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
        res.write(`data: [DONE]\n\n`);
        cleanup();
        res.end();
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

    const scanDir = (dir: string, source: string, recursive = false) => {
      if (!existsSync(dir)) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const fullPath = join(dir, entry.name);
          if (entry.isFile()) {
            try {
              const stat = statSync(fullPath);
              files.push({
                name: entry.name,
                path: fullPath,
                size: stat.size,
                modified: stat.mtime.toISOString(),
                source,
              });
            } catch { /* skip */ }
          } else if (entry.isDirectory() && recursive) {
            scanDir(fullPath, source, true);
          }
        }
      } catch { /* skip */ }
    };

    // FileStorage (always scan)
    scanDir(join(agentHome, "FileStorage", "Temp"), "temp");
    scanDir(join(agentHome, "FileStorage", "Permanent"), "permanent");

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
    res.sendFile(resolvedPath);
  });

  // ─── API: Create agent ──────────────────────────────────────────
  app.post("/api/agents", async (req, res) => {
    const { agentId, name, description, alias, workspace, persistent, streaming, advancedMemory, autonomousCapable, autoCommit, autoCommitBranch, timeout, skills, agentSkills, prompts, tools, mcps, routes, org, cron, goals, instructions, claudeAccount, subAgents, heartbeatInstructions, heartbeatCron, heartbeatEnabled, agentClass } = req.body as {
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
      agentClass?: "standard" | "platform" | "builder";
    };

    if (!agentId || !name || !alias) {
      return res.status(400).json({ error: "Missing required fields: agentId, name, alias" });
    }

    // Validate agentId format
    if (!/^[a-z0-9-]+$/.test(agentId)) {
      return res.status(400).json({ error: "agentId must be lowercase alphanumeric with hyphens" });
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
      // Create agent directory
      const agentHome = join(getPersonalAgentsDir(), agentId);
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
      const paDir = getPersonalAgentsDir();
      const paDirTilde = paDir.startsWith(homedir()) ? paDir.replace(homedir(), "~") : paDir;
      const agentConfig: any = {
        name,
        description: description || `Agent ${name}`,
        agentHome: `${paDirTilde}/${agentId}`,
        workspace: workspace || "~",
        claudeMd: `${paDirTilde}/${agentId}/CLAUDE.md`,
        memoryDir: `${paDirTilde}/${agentId}/memory`,
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
      const configPath = join(opts.baseDir, "config.json");
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

    const { name, description, alias, workspace, persistent, streaming, advancedMemory, autonomousCapable, autoCommit, autoCommitBranch, timeout, skills, agentSkills, prompts, tools, mcps, routes, org, cron, goals, instructions, claudeAccount, subAgents, heartbeatInstructions, heartbeatCron, heartbeatEnabled, agentClass } = req.body as {
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
      agentClass?: "standard" | "platform" | "builder";
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
      const configPath = join(opts.baseDir, "config.json");
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
      if (org !== undefined) existing.org = org;
      if (cron !== undefined) existing.cron = cron;
      if (goals !== undefined) existing.goals = goals;

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
      const configPath = join(opts.baseDir, "config.json");
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
    // Read existing content and update or append the key
    let lines: string[] = [];
    if (existsSync(envFile)) {
      lines = readFileSync(envFile, "utf-8").split("\n");
    }
    const idx = lines.findIndex(l => l.startsWith(`${envVar}=`));
    if (idx >= 0) {
      lines[idx] = `${envVar}=${value}`;
    } else {
      lines.push(`${envVar}=${value}`);
    }
    writeFileSync(envFile, lines.filter(l => l.trim()).join("\n") + "\n");

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

    if (existsSync(envFile)) {
      unlinkSync(envFile);
      log.info(`[MCP Keys] Deleted ${req.params.mcpName}.env for ${req.params.id}`);
    }
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
      const configPath = join(opts.baseDir, "config.json");
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
      writeFileSync(join(keysDir, `${instanceName}.env`), `${envVar}=${value}\n`);

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
      const configPath = join(opts.baseDir, "config.json");
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
      const configPath = join(opts.baseDir, "config.json");
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
      const configPath = join(opts.baseDir, "config.json");
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

  // ─── API: Delete goal ─────────────────────────────────────────────
  app.delete("/api/agents/:id/goals/:goalId", (req, res) => {
    const agentId = req.params.id;
    try {
      const configPath = join(opts.baseDir, "config.json");
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
      const configPath = join(opts.baseDir, "config.json");
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
      const configPath = join(opts.baseDir, "config.json");
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
      const configPath = join(opts.baseDir, "config.json");
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
  app.get("/automations", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "automations.html");
    if (existsSync(htmlPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(htmlPath);
    } else {
      res.redirect("/ui");
    }
  });

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
        return JSON.parse(readFileSync(p, "utf-8"));
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
      const configPath = join(opts.baseDir, "config.json");
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
      const configPath = join(opts.baseDir, "config.json");
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
      const configPath = join(opts.baseDir, "config.json");
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
      const configPath = join(opts.baseDir, "config.json");
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
      const configPath = join(opts.baseDir, "config.json");
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
      opus: "claude-opus-4-6", sonnet: "claude-sonnet-4-6",
      haiku: "claude-haiku-4-5-20251001", "opus-4": "claude-opus-4-6", "sonnet-4": "claude-sonnet-4-6",
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
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const logPath = join(memDir, "conversation_log.jsonl");
    if (!existsSync(logPath)) return res.json({ today: 0, week: 0, allTime: 0, totalMessages: 0, entries: [] });
    try {
      const entries = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
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

  // GET /api/agents/:agentId/logs?limit=50&offset=0&search=keyword
  app.get("/api/agents/:agentId/logs", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const logPath = join(memDir, "conversation_log.jsonl");
    if (!existsSync(logPath)) return res.json({ entries: [], total: 0 });
    try {
      let entries = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

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

      res.json({ entries, total, limit, offset });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
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
      const configPath = join(opts.baseDir, "config.json");
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
      const configPath = join(opts.baseDir, "config.json");
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

  // ─── API: Service Restart ─────────────────────────────────────────
  app.post("/api/restart", (_req, res) => {
    res.json({ ok: true, message: "Restarting in 1 second..." });
    setTimeout(() => {
      log.info("[Restart] Service restart triggered via API");
      process.exit(0); // launchd/systemd/scheduler will restart
    }, 1000);
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

  app.get("/changelog", (_req, res) => {
    res.sendFile(resolve(opts.baseDir, "public", "changelog.html"));
  });

  app.get("/user-guide", (_req, res) => {
    res.sendFile(resolve(opts.baseDir, "public", "user-guide.html"));
  });

  app.get("/docs/user-guide.md", (_req, res) => {
    res.type("text/markdown").sendFile(resolve(opts.baseDir, "docs", "user-guide.md"));
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

  app.listen(opts.port, () => {
    log.info(`Web UI running on http://localhost:${opts.port}/ui`);
  });
}
