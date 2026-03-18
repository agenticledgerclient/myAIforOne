import express from "express";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { join, resolve, basename, extname, relative } from "node:path";
import { execSync } from "node:child_process";
import type { AppConfig } from "./config.js";
import type { InboundMessage } from "./channels/types.js";
import type { ResolvedRoute } from "./router.js";
import { executeAgent, executeAgentStreaming } from "./executor.js";
import type { McpServerConfig } from "./config.js";
import { log } from "./logger.js";

interface WebUIOptions {
  config: AppConfig;
  baseDir: string;
  port: number;
  webhookSecret?: string;
  onWebhookMessage?: (agentId: string, text: string, channel: string, chatId: string) => Promise<void>;
}

export function startWebUI(opts: WebUIOptions): void {
  const app = express();
  app.use(express.json());

  // ─── Serve the UI HTML ────────────────────────────────────────────
  app.get("/ui", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "index.html");
    if (existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send("UI not found. Create public/index.html");
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

  // ─── Serve the Tasks page ───────────────────────────────────────
  app.get("/tasks", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "tasks.html");
    if (existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send("Tasks page not found.");
    }
  });

  // ─── API: Dashboard ───────────────────────────────────────────────
  app.get("/api/dashboard", (_req, res) => {
    const agents = Object.entries(opts.config.agents).map(([id, agent]) => {
      const memoryDir = resolve(opts.baseDir, agent.memoryDir);
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
      const home = process.env.HOME || process.env.USERPROFILE || "";
      const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
      const agentHome = agent.agentHome
        ? resolveTilde(agent.agentHome)
        : resolve(opts.baseDir, agent.memoryDir, "..");

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
        routes: agent.routes.map(r => `${r.channel}:${r.match.value}`),
        messageCount,
        lastMessage,
        sessionActive,
        workspace: agent.workspace,
        streaming: agent.streaming ?? false,
        advancedMemory: agent.advancedMemory ?? false,
        autonomousCapable: agent.autonomousCapable ?? true,
        autoCommit: agent.autoCommit ?? false,
        timeout: agent.timeout ?? 120000,
        tools: agent.allowedTools,
        org: agent.org || [],
        cron: agent.cron || [],
        goals: agent.goals || [],
        activeGoals: (agent.goals || []).filter(g => g.enabled).length,
        agentHome,
        claudeAccount: agent.claudeAccount || null,
        taskCounts,
      };
    });

    const channels = Object.entries(opts.config.channels)
      .filter(([, c]) => c.enabled)
      .map(([id]) => id);

    res.json({
      status: "running",
      uptime: process.uptime(),
      channels,
      agents,
      claudeAccounts: Object.keys(opts.config.service.claudeAccounts || {}),
    });
  });

  // ─── Legacy dashboard (keep backward compat) ──────────────────────
  app.get("/", (_req, res) => {
    res.redirect("/ui");
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

    const home = process.env.HOME || process.env.USERPROFILE || "";
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

    res.json({ instructions, path: claudeMdPath });
  });

  // ─── API: Chat with agent ─────────────────────────────────────────
  app.post("/api/chat/:agentId", async (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const { text } = req.body as { text?: string };
    if (!text?.trim()) return res.status(400).json({ error: "Missing 'text' in body" });

    log.info(`[WebUI Chat] ${agentId} <- web: ${text.slice(0, 80)}`);

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
      agentConfig: agent,
      route: agent.routes[0],
    };

    try {
      // If agent has streaming enabled, use streaming executor but collect full response
      if (agent.streaming) {
        let fullResponse = "";
        for await (const event of executeAgentStreaming(route, syntheticMsg, opts.baseDir, opts.config.mcps, opts.config.service.claudeAccounts)) {
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
        const response = await executeAgent(route, syntheticMsg, opts.baseDir, opts.config.mcps, opts.config.service.claudeAccounts);
        log.info(`[WebUI Chat] ${agentId} -> web: ${response.slice(0, 80)}`);
        res.json({ ok: true, response });
      }
    } catch (err) {
      log.error(`[WebUI Chat] ${agentId} error: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Chat with agent (SSE streaming) ──────────────────────
  app.post("/api/chat/:agentId/stream", async (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const { text } = req.body as { text?: string };
    if (!text?.trim()) return res.status(400).json({ error: "Missing 'text' in body" });

    log.info(`[WebUI Stream] ${agentId} <- web: ${text.slice(0, 80)}`);

    // SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

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
      agentConfig: agent,
      route: agent.routes[0],
    };

    // Keepalive ping every 15s prevents browser/proxy timeout
    const keepalive = setInterval(() => {
      try { res.write(`: keepalive\n\n`); } catch { /* connection closed */ }
    }, 15_000);

    try {
      for await (const event of executeAgentStreaming(route, syntheticMsg, opts.baseDir, opts.config.mcps, opts.config.service.claudeAccounts)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: "error", data: String(err) })}\n\n`);
    } finally {
      clearInterval(keepalive);
    }

    res.write(`data: [DONE]\n\n`);
    res.end();
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

  // ─── API: List agent files ──────────────────────────────────────
  app.get("/api/agents/:agentId/files", (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const home = process.env.HOME || process.env.USERPROFILE || "";
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

    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: "Missing 'path' query parameter" });

    // Security: resolve and validate the path is within allowed directories
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const agentHome = agent.agentHome
      ? resolveTilde(agent.agentHome)
      : resolve(opts.baseDir, agent.memoryDir, "..");
    const workspace = agent.workspace ? resolveTilde(agent.workspace) : agentHome;

    const resolvedPath = resolve(filePath);
    const resolvedAgentHome = resolve(agentHome);
    const resolvedWorkspace = resolve(workspace);

    // Must be within agent home or workspace
    const isAllowed = resolvedPath.startsWith(resolvedAgentHome) ||
                      resolvedPath.startsWith(resolvedWorkspace);
    if (!isAllowed) {
      return res.status(403).json({ error: "File path outside agent's allowed directories" });
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

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", contentTypes[ext] || "application/octet-stream");

    log.info(`[Download] ${agentId}: ${fileName} from ${resolvedPath}`);
    res.sendFile(resolvedPath);
  });

  // ─── API: Create agent ──────────────────────────────────────────
  app.post("/api/agents", async (req, res) => {
    const { agentId, name, description, alias, workspace, persistent, streaming, advancedMemory, autonomousCapable, autoCommit, timeout, skills, agentSkills, tools, mcps, routes, org, cron, goals, instructions, claudeAccount } = req.body as {
      agentId?: string; name?: string; description?: string; alias?: string;
      workspace?: string; persistent?: boolean; streaming?: boolean; advancedMemory?: boolean;
      autonomousCapable?: boolean; autoCommit?: boolean; timeout?: number;
      skills?: string[]; agentSkills?: string[];
      tools?: string[]; mcps?: string[];
      routes?: Array<{ channel: string; chatId: string; requireMention: boolean }>;
      org?: Array<{ organization: string; function: string; title: string; reportsTo?: string }>;
      cron?: Array<{ schedule: string; message: string; channel: string; chatId: string }>;
      goals?: Array<{ id: string; enabled: boolean; description: string; successCriteria?: string; instructions?: string; heartbeat: string; budget?: { maxDailyUsd: number }; reportTo?: string }>;
      instructions?: string;
      claudeAccount?: string;
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
      const home = process.env.HOME || process.env.USERPROFILE || "";
      const agentHome = join(home, "Desktop", "personalAgents", agentId);
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

      // Write context.md
      writeFileSync(join(memoryDir, "context.md"), `# ${name} Context\n\nCreated ${new Date().toISOString().split("T")[0]}.\n`);

      // Build config entry
      const agentConfig: any = {
        name,
        description: description || `Agent ${name}`,
        agentHome: `~/Desktop/personalAgents/${agentId}`,
        workspace: workspace || "~",
        claudeMd: `~/Desktop/personalAgents/${agentId}/CLAUDE.md`,
        memoryDir: `~/Desktop/personalAgents/${agentId}/memory`,
        persistent: persistent ?? true,
        streaming: streaming ?? true,
        advancedMemory: advancedMemory ?? true,
        autonomousCapable: autonomousCapable ?? true,
        mentionAliases: [normalAlias],
        autoCommit: autoCommit ?? false,
        allowedTools: tools || ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"],
        timeout: timeout || 120000,
      };

      if (mcps && mcps.length > 0) agentConfig.mcps = mcps;
      if (skills && skills.length > 0) agentConfig.skills = skills;
      if (agentSkills && agentSkills.length > 0) agentConfig.agentSkills = agentSkills;
      if (claudeAccount) agentConfig.claudeAccount = claudeAccount;
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
          allowFrom: ["*"],
          requireMention: r.requireMention ?? true,
        },
      }));

      // If no routes provided, skip (agent won't be routable until routes added)
      if (agentConfig.routes.length === 0) {
        // Add placeholder message
        log.info(`Agent ${agentId} created without routes — add routes in config.json`);
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
      const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
      agentConfig.workspace = resolveTilde(agentConfig.workspace);
      agentConfig.claudeMd = resolveTilde(agentConfig.claudeMd);
      agentConfig.memoryDir = resolveTilde(agentConfig.memoryDir);
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

    const { name, description, alias, workspace, persistent, streaming, advancedMemory, autonomousCapable, autoCommit, timeout, skills, agentSkills, tools, mcps, routes, org, cron, goals, instructions, claudeAccount } = req.body as {
      name?: string; description?: string; alias?: string;
      workspace?: string; persistent?: boolean; streaming?: boolean; advancedMemory?: boolean;
      autonomousCapable?: boolean; autoCommit?: boolean; timeout?: number;
      skills?: string[]; agentSkills?: string[];
      tools?: string[]; mcps?: string[];
      routes?: Array<{ channel: string; chatId: string; requireMention: boolean }>;
      org?: Array<{ organization: string; function: string; title: string; reportsTo?: string }>;
      cron?: Array<{ schedule: string; message: string; channel: string; chatId: string }>;
      goals?: Array<{ id: string; enabled: boolean; description: string; successCriteria?: string; instructions?: string; heartbeat: string; budget?: { maxDailyUsd: number }; reportTo?: string }>;
      instructions?: string;
      claudeAccount?: string;
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
      if (org !== undefined) existing.org = org;
      if (cron !== undefined) existing.cron = cron.length > 0 ? cron : undefined;
      if (goals !== undefined) existing.goals = goals.length > 0 ? goals : undefined;

      // Build routes if provided
      if (routes !== undefined) {
        existing.routes = routes.map(r => ({
          channel: r.channel,
          match: {
            type: r.channel === "slack" ? "channel_id" : "chat_id",
            value: r.chatId,
          },
          permissions: {
            allowFrom: ["*"],
            requireMention: r.requireMention ?? true,
          },
        }));
      }

      rawConfig.agents[agentId] = existing;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Write CLAUDE.md if instructions provided
      if (instructions !== undefined) {
        const home2 = process.env.HOME || process.env.USERPROFILE || "";
        const resolveTilde2 = (p: string) => p.startsWith("~") ? p.replace("~", home2) : p;
        let claudeMdPath: string;
        if (existing.claudeMd) {
          claudeMdPath = resolveTilde2(existing.claudeMd);
        } else if (existing.agentHome) {
          claudeMdPath = join(resolveTilde2(existing.agentHome), "CLAUDE.md");
        } else if (existing.memoryDir) {
          claudeMdPath = join(resolve(resolveTilde2(existing.memoryDir), ".."), "CLAUDE.md");
        } else {
          claudeMdPath = join(home2, "Desktop", "personalAgents", agentId, "CLAUDE.md");
        }
        try {
          writeFileSync(claudeMdPath, instructions);
          log.info(`Updated CLAUDE.md for ${agentId} at ${claudeMdPath}`);
        } catch (writeErr) {
          log.warn(`Failed to write CLAUDE.md for ${agentId}: ${writeErr}`);
        }
      }

      // Rebuild
      try {
        execSync("npm run build", { cwd: opts.baseDir, timeout: 30_000 });
      } catch (buildErr) {
        log.warn(`Build after agent update failed: ${buildErr}`);
      }

      // Update in-memory config
      const home = process.env.HOME || process.env.USERPROFILE || "";
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

  // ─── API: Available MCPs ──────────────────────────────────────────
  app.get("/api/mcps", (_req, res) => {
    const mcps = Object.keys(opts.config.mcps || {});
    res.json({ mcps });
  });

  // ─── Task helpers ──────────────────────────────────────────────────

  const resolveTildeGlobal = (p: string) => {
    const h = process.env.HOME || process.env.USERPROFILE || "";
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

  // GET /api/agents/:id/tasks — return full tasks.json
  app.get("/api/agents/:id/tasks", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    res.json(loadTasksFile(agent, req.params.id));
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

  // ─── Health check ─────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.listen(opts.port, () => {
    log.info(`Web UI running on http://localhost:${opts.port}/ui`);
  });
}
