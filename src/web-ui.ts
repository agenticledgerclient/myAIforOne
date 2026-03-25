import express from "express";
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, basename, extname, relative } from "node:path";
import { execSync } from "node:child_process";
import type { AppConfig } from "./config.js";
import { getPersonalAgentsDir } from "./config.js";
import type { InboundMessage } from "./channels/types.js";
import type { ResolvedRoute } from "./router.js";
import { executeAgent, executeAgentStreaming } from "./executor.js";
import { executeGoal } from "./goals.js";
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
  app.get("/", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "home.html");
    if (existsSync(htmlPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(htmlPath);
    } else {
      // Fallback to chat UI if home page doesn't exist
      res.redirect("/ui");
    }
  });

  // ─── Serve the Activity Logs page ────────────────────────────────
  app.get("/activity", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "activity.html");
    if (existsSync(htmlPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(htmlPath);
    } else {
      res.redirect("/ui");
    }
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

  // ─── Serve the Org page ────────────────────────────────────────
  app.get("/org", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "org.html");
    if (existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send("Org page not found.");
    }
  });

  // ─── Serve the Channels page (reuses org.html) ─────────────────
  app.get("/channels", (_req, res) => {
    const htmlPath = join(opts.baseDir, "public", "org.html");
    if (existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send("Channels page not found.");
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
      const home = homedir();
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
        activeCron: (agent.cron || []).filter((c: any) => c.enabled !== false).length,
        agentHome,
        claudeAccount: agent.claudeAccount || null,
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

    res.json({ instructions, path: claudeMdPath });
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

  // ─── API: Chat with agent (reconnectable streaming) ──────────────
  // POST starts a job, returns jobId. GET streams events with reconnect support.

  app.post("/api/chat/:agentId/stream", async (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const { text, accountOverride } = req.body as { text?: string; accountOverride?: string };
    if (!text?.trim()) return res.status(400).json({ error: "Missing 'text' in body" });

    // Apply account override from web UI dropdown.
    // When the account changes, set forceNewSession so the executor doesn't
    // try to --resume a session that belongs to a different account's history.
    const accountChanged = accountOverride && accountOverride !== (agent.claudeAccount || "");
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
      try {
        for await (const event of executeAgentStreaming(route, syntheticMsg, opts.baseDir, opts.config.mcps, opts.config.service.claudeAccounts, pushRawLine)) {
          if (job.stopped) break;
          pushEvent(JSON.stringify(event));
        }
      } catch (err) {
        if (!job.stopped) pushEvent(JSON.stringify({ type: "error", data: String(err) }));
      } finally {
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
            allowFrom: ["*"],
            requireMention: r.requireMention ?? true,
          },
        }));
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
    const { confirmAlias } = req.body as { confirmAlias?: string };
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
      const response = await executeAgent(route, syntheticMsg, opts.baseDir, opts.config.mcps, opts.config.service.claudeAccounts);
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

    const { stickyRouting, stickyPrefix, stickyTimeoutMs } = req.body as {
      stickyRouting?: string;
      stickyPrefix?: string;
      stickyTimeoutMs?: number;
    };

    try {
      const configPath = join(opts.baseDir, "config.json");
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      if (!rawConfig.channels[channelName]) {
        return res.status(404).json({ error: `Channel "${channelName}" not in config.json` });
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

    const { agentId, chatId, requireMention } = req.body as {
      agentId?: string;
      chatId?: string;
      requireMention?: boolean;
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
          allowFrom: ["*"],
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

  // ─── Health check ─────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.listen(opts.port, () => {
    log.info(`Web UI running on http://localhost:${opts.port}/ui`);
  });
}
