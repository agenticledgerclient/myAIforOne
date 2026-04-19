import { Router } from "express";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

// ─── Gym Router ──────────────────────────────────────────────────────
// All AI Gym endpoints: learner profile, plan, progress, cards,
// dimension history, programs, agent activity summaries, and log search.

export function createGymRouter(baseDir: string, opts?: { memoryDir?: string; programsDir?: string; userProgramsDir?: string }): Router {
  const router = Router();
  const gymRepoDir = join(baseDir, "agents", "platform", "gym");
  const memoryDir = opts?.memoryDir || join(gymRepoDir, "memory");
  const programsDir = opts?.programsDir || join(gymRepoDir, "programs");
  const userProgramsDir = opts?.userProgramsDir || join(memoryDir, "programs");

  // ── Helpers ─────────────────────────────────────────────────────────

  function ensureDir(dir: string): void {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  function readJson(path: string, fallback: any = {}): any {
    try {
      if (!existsSync(path)) return fallback;
      const raw = readFileSync(path, "utf-8").trim();
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJson(path: string, data: any): void {
    ensureDir(dirname(path));
    writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  }

  function readJsonl(path: string): any[] {
    try {
      if (!existsSync(path)) return [];
      const raw = readFileSync(path, "utf-8").trim();
      if (!raw) return [];
      return raw.split("\n").filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  // ── 1. Learner Profile ─────────────────────────────────────────────

  const profilePath = () => join(memoryDir, "learner-profile.json");

  const emptyProfile = {
    name: "",
    goals: [],
    dimensions: {},
    preferences: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  router.get("/api/gym/learner-profile", (_req, res) => {
    ensureDir(memoryDir);
    const data = readJson(profilePath(), emptyProfile);
    res.json(data);
  });

  router.put("/api/gym/learner-profile", (req, res) => {
    ensureDir(memoryDir);
    const existing = readJson(profilePath(), emptyProfile);
    const merged = { ...existing, ...req.body, updatedAt: new Date().toISOString() };
    writeJson(profilePath(), merged);
    res.json(merged);
  });

  // ── 2. Plan ────────────────────────────────────────────────────────

  const planPath = () => join(memoryDir, "plan.json");

  router.get("/api/gym/plan", (_req, res) => {
    ensureDir(memoryDir);
    const data = readJson(planPath(), { modules: [], createdAt: null, updatedAt: null });
    res.json(data);
  });

  router.put("/api/gym/plan", (req, res) => {
    ensureDir(memoryDir);
    const data = { ...req.body, updatedAt: new Date().toISOString() };
    writeJson(planPath(), data);
    res.json(data);
  });

  // ── 3. Progress ────────────────────────────────────────────────────

  const progressPath = () => join(memoryDir, "program-progress.json");

  router.get("/api/gym/progress", (_req, res) => {
    ensureDir(memoryDir);
    const data = readJson(progressPath(), { programs: {}, updatedAt: null });
    res.json(data);
  });

  router.put("/api/gym/progress", (req, res) => {
    ensureDir(memoryDir);
    const data = { ...req.body, updatedAt: new Date().toISOString() };
    writeJson(progressPath(), data);
    res.json(data);
  });

  // ── 4. Cards ───────────────────────────────────────────────────────

  const cardsPath = () => join(memoryDir, "gym-cards.json");

  router.get("/api/gym/cards", (req, res) => {
    ensureDir(memoryDir);
    const data: any[] = readJson(cardsPath(), []);
    const all = req.query.all === "true";
    // By default, filter out dismissed cards
    const filtered = all ? data : data.filter((c: any) => !c.dismissed);
    res.json(Array.isArray(filtered) ? filtered : []);
  });

  router.post("/api/gym/cards", (req, res) => {
    ensureDir(memoryDir);
    const cards: any[] = readJson(cardsPath(), []);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const card = {
      title: "",
      description: "",
      dismissed: false,
      ...req.body,
      // Auto-generated fields always override body
      id,
      createdAt,
    };
    cards.push(card);
    writeJson(cardsPath(), cards);
    res.status(201).json(card);
  });

  router.post("/api/gym/cards/:id/dismiss", (req, res) => {
    ensureDir(memoryDir);
    const cards: any[] = readJson(cardsPath(), []);
    const card = cards.find((c: any) => c.id === req.params.id);
    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    card.dismissed = true;
    card.dismissedAt = new Date().toISOString();
    writeJson(cardsPath(), cards);
    res.json(card);
  });

  router.delete("/api/gym/cards/:id", (req, res) => {
    ensureDir(memoryDir);
    const cards: any[] = readJson(cardsPath(), []);
    const idx = cards.findIndex((c: any) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    const [removed] = cards.splice(idx, 1);
    writeJson(cardsPath(), cards);
    res.json(removed);
  });

  // ── 5. Dimension History (Snapshots) ───────────────────────────────

  const dimensionHistoryPath = () => join(memoryDir, "dimension-history.json");

  router.post("/api/gym/dimensions/snapshot", (req, res) => {
    ensureDir(memoryDir);
    const history: any[] = readJson(dimensionHistoryPath(), []);
    const snapshot = {
      date: req.body.date || new Date().toISOString().slice(0, 10),
      dimensions: req.body.dimensions || {},
    };
    history.push(snapshot);
    writeJson(dimensionHistoryPath(), history);
    res.status(201).json(snapshot);
  });

  // ── 6. Programs — List All ─────────────────────────────────────────

  router.get("/api/gym/programs", (_req, res) => {
    const programs: any[] = [];

    // Platform standard programs (from repo)
    ensureDir(programsDir);
    const platformSlugs = readdirSync(programsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const slug of platformSlugs) {
      const data = readJson(join(programsDir, slug, "program.json"), null);
      if (data) programs.push({ ...data, slug, source: data.source || "platform" });
    }

    // User & coach created programs (from Drive)
    ensureDir(userProgramsDir);
    const userSlugs = readdirSync(userProgramsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const slug of userSlugs) {
      const data = readJson(join(userProgramsDir, slug, "program.json"), null);
      if (data) programs.push({ ...data, slug, source: data.source || "user" });
    }

    res.json(programs);
  });

  // ── 7. Programs — Get One (with module content) ────────────────────

  router.get("/api/gym/programs/:slug", (req, res) => {
    const slug = req.params.slug;

    // Check platform programs first, then user programs
    let progDir = join(programsDir, slug);
    let defaultSource = "platform";
    if (!existsSync(join(progDir, "program.json"))) {
      progDir = join(userProgramsDir, slug);
      defaultSource = "user";
    }
    const pPath = join(progDir, "program.json");

    if (!existsSync(pPath)) {
      res.status(404).json({ error: "Program not found" });
      return;
    }

    const program = readJson(pPath, {});
    program.slug = slug;
    if (!program.source) program.source = defaultSource;

    // Enrich modules with .md file content if present
    if (Array.isArray(program.modules)) {
      program.modules = program.modules.map((mod: any) => {
        if (mod.file) {
          const mdPath = join(progDir, mod.file);
          if (existsSync(mdPath)) {
            mod.content = readFileSync(mdPath, "utf-8");
          }
        }
        return mod;
      });
    }

    res.json(program);
  });

  // ── 8. Programs — Create ───────────────────────────────────────────

  router.post("/api/gym/programs", (req, res) => {
    const slug = req.body.slug || req.body.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || randomUUID();
    const progDir = join(userProgramsDir, slug);
    ensureDir(progDir);

    const program = {
      ...req.body,
      slug,
      source: req.body.source || "user",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeJson(join(progDir, "program.json"), program);
    res.status(201).json(program);
  });

  // ── 9. Programs — Update ───────────────────────────────────────────

  router.patch("/api/gym/programs/:slug", (req, res) => {
    const slug = req.params.slug;
    // Check user programs first (editable), then platform
    let pPath = join(userProgramsDir, slug, "program.json");
    if (!existsSync(pPath)) pPath = join(programsDir, slug, "program.json");

    if (!existsSync(pPath)) {
      res.status(404).json({ error: "Program not found" });
      return;
    }

    const existing = readJson(pPath, {});
    const updated = { ...existing, ...req.body, slug, updatedAt: new Date().toISOString() };
    writeJson(pPath, updated);
    res.json(updated);
  });

  // ── 10. Programs — Delete ──────────────────────────────────────────

  router.delete("/api/gym/programs/:slug", (req, res) => {
    const slug = req.params.slug;

    // Check user programs first
    let progDir = join(userProgramsDir, slug);
    if (!existsSync(progDir)) {
      // Allow deleting platform programs only if explicitly requested
      progDir = join(programsDir, slug);
    }

    if (!existsSync(progDir)) {
      res.status(404).json({ error: "Program not found" });
      return;
    }

    rmSync(progDir, { recursive: true, force: true });
    res.json({ deleted: slug });
  });

  // ── 11. Programs — Import Markdown ─────────────────────────────────

  router.post("/api/gym/programs/import-markdown", (req, res) => {
    const markdown: string = req.body.markdown || "";
    if (!markdown.trim()) {
      res.status(400).json({ error: "No markdown provided" });
      return;
    }

    const lines = markdown.split("\n");
    let title = "Untitled Program";
    const modules: any[] = [];
    let currentModule: any = null;
    let currentStep: any = null;
    let contentBuffer: string[] = [];

    function flushContent() {
      if (currentStep && contentBuffer.length) {
        currentStep.content = contentBuffer.join("\n").trim();
        contentBuffer = [];
      }
    }

    for (const line of lines) {
      // H1 — program title
      const h1 = line.match(/^#\s+(.+)/);
      if (h1 && !line.startsWith("##")) {
        title = h1[1].trim();
        continue;
      }

      // H2 — module
      const h2 = line.match(/^##\s+(.+)/);
      if (h2 && !line.startsWith("###")) {
        flushContent();
        currentModule = {
          title: h2[1].trim().replace(/^Module\s+\d+:\s*/i, ""),
          steps: [],
        };
        modules.push(currentModule);
        currentStep = null;
        contentBuffer = [];
        continue;
      }

      // H3 — step
      const h3 = line.match(/^###\s+(.+)/);
      if (h3) {
        flushContent();
        currentStep = {
          title: h3[1].trim().replace(/^Step\s+\d+:\s*/i, ""),
          content: "",
        };
        if (currentModule) {
          currentModule.steps.push(currentStep);
        } else {
          // Step before any module — create implicit module
          currentModule = { title: "Module 1", steps: [currentStep] };
          modules.push(currentModule);
        }
        contentBuffer = [];
        continue;
      }

      // Regular content
      contentBuffer.push(line);
    }

    // Flush remaining
    flushContent();

    // Generate slug
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || randomUUID();
    const source = req.body.source || "user";
    const progDir = join(userProgramsDir, slug);
    ensureDir(progDir);

    const program = {
      slug,
      title,
      description: req.body.description || "",
      source,
      modules,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    writeJson(join(progDir, "program.json"), program);
    res.status(201).json(program);
  });

  // ── 12. Agent Activity Summary ─────────────────────────────────────

  router.get("/api/agents/:id/activity-summary", (req, res) => {
    const agentId = req.params.id;
    const agentsDir = join(baseDir, "agents");

    // Resolve the agent's actual memory directory from config.json
    let memDir = join(agentsDir, agentId, "memory");
    const configPath = join(baseDir, "config.json");
    try {
      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        const agentConfig = config.agents?.[agentId];
        if (agentConfig?.memoryDir) {
          const resolved = agentConfig.memoryDir.replace(/^~/, process.env.HOME || "~");
          if (existsSync(resolved)) memDir = resolved;
        }
      }
    } catch { /* fall back to default path */ }

    // Also check platform subdirectory if default path doesn't exist
    if (!existsSync(memDir)) {
      const platformMemDir = join(agentsDir, "platform", agentId, "memory");
      if (existsSync(platformMemDir)) memDir = platformMemDir;
    }

    const logPath = join(memDir, "conversation_log.jsonl");

    if (!existsSync(logPath)) {
      res.json({
        agentId,
        messageCount: 0,
        activeDays: 0,
        uniqueDates: [],
        topics: [],
        toolUseCounts: {},
        lastActive: null,
      });
      return;
    }

    const entries = readJsonl(logPath);
    const messageCount = entries.length;
    const dates = new Set<string>();
    const toolCounts: Record<string, number> = {};
    const topicSet = new Set<string>();
    let lastActive: string | null = null;

    for (const entry of entries) {
      // Extract date
      if (entry.timestamp) {
        const dateStr = entry.timestamp.slice(0, 10);
        dates.add(dateStr);
        if (!lastActive || entry.timestamp > lastActive) {
          lastActive = entry.timestamp;
        }
      }

      // Extract topics from user messages (first 50 chars)
      if (entry.role === "user" && entry.content) {
        const snippet = entry.content.slice(0, 50).trim();
        if (snippet) topicSet.add(snippet);
      }

      // Count tool uses from assistant messages
      if (entry.role === "assistant" && entry.content) {
        // Look for tool use patterns: Read(, Write(, Bash(, Glob(, Grep(, Edit(
        const toolPattern = /\b(Read|Write|Bash|Glob|Grep|Edit|WebFetch|WebSearch|TodoWrite|NotebookEdit)\b/g;
        let match;
        while ((match = toolPattern.exec(entry.content)) !== null) {
          toolCounts[match[1]] = (toolCounts[match[1]] || 0) + 1;
        }
      }

      // Also check for explicit tool_use entries
      if (entry.tool) {
        toolCounts[entry.tool] = (toolCounts[entry.tool] || 0) + 1;
      }
    }

    res.json({
      agentId,
      messageCount,
      activeDays: dates.size,
      uniqueDates: Array.from(dates).sort(),
      topics: Array.from(topicSet).slice(0, 20), // Cap at 20
      toolUseCounts: toolCounts,
      lastActive,
    });
  });

  // ── 13. Search Agent Logs ──────────────────────────────────────────

  router.get("/api/agents/logs/search", (req, res) => {
    const q = (req.query.q as string || "").toLowerCase().trim();
    if (!q) {
      res.status(400).json({ error: "Query parameter 'q' is required" });
      return;
    }

    const agentIdsParam = req.query.agentIds as string | undefined;
    const filterIds = agentIdsParam ? agentIdsParam.split(",").map((s) => s.trim()) : null;

    const agentsDir = join(baseDir, "agents");
    if (!existsSync(agentsDir)) {
      res.json({ results: [] });
      return;
    }

    const agentDirs = readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
      .map((d) => d.name);

    const results: any[] = [];
    const maxResults = 100;

    for (const agentId of agentDirs) {
      if (filterIds && !filterIds.includes(agentId)) continue;

      const logPath = join(agentsDir, agentId, "memory", "conversation_log.jsonl");
      if (!existsSync(logPath)) continue;

      const entries = readJsonl(logPath);
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        const content = (entry.content || "").toLowerCase();
        if (content.includes(q)) {
          results.push({
            agentId,
            role: entry.role,
            content: entry.content,
            timestamp: entry.timestamp,
            // Include surrounding context — first 200 chars
            snippet: entry.content?.slice(0, 200),
          });
        }
      }
      if (results.length >= maxResults) break;
    }

    res.json({ query: q, count: results.length, results });
  });

  // ── 14. Agent Logs (paginated) ──────────────────────────────────────

  router.get("/api/agents/:id/logs", (req, res) => {
    const agentId = req.params.id;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const agentsDir = join(baseDir, "agents");

    // Resolve memory dir: check config.json memoryDir, then direct path, then platform/ subfolder
    let logPath = "";
    const cfgPath = join(baseDir, "config.json");
    try {
      if (existsSync(cfgPath)) {
        const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
        const ac = cfg.agents?.[agentId];
        if (ac?.memoryDir) {
          const resolved = ac.memoryDir.replace(/^~/, process.env.HOME || "~");
          const candidate = join(resolved, "conversation_log.jsonl");
          if (existsSync(candidate)) logPath = candidate;
        }
      }
    } catch { /* ignore */ }
    if (!logPath) {
      logPath = join(agentsDir, agentId, "memory", "conversation_log.jsonl");
      if (!existsSync(logPath)) {
        logPath = join(agentsDir, "platform", agentId, "memory", "conversation_log.jsonl");
      }
    }

    if (!existsSync(logPath)) {
      res.json({ agentId, total: 0, offset, limit, entries: [] });
      return;
    }

    const all = readJsonl(logPath);
    // Newest first
    all.reverse();
    const entries = all.slice(offset, offset + limit);
    res.json({ agentId, total: all.length, offset, limit, entries });
  });

  // ── 15. Run Digest Manually ─────────────────────────────────────────

  router.post("/api/gym/digest/run", async (req, res) => {
    try {
      const { runActivityDigest } = await import("./activity-digest.js");
      // Infer port from the request
      const port = parseInt(req.get("host")?.split(":")[1] || "4888");
      await runActivityDigest({ baseDir, port });
      res.json({ ok: true, message: "Activity digest completed" });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Digest failed" });
    }
  });

  // ── 16. Dimension History ───────────────────────────────────────────

  router.get("/api/gym/dimensions/history", (_req, res) => {
    const histPath = join(memoryDir, "dimension-history.json");
    const data = readJson(histPath, []);
    res.json(Array.isArray(data) ? data : []);
  });

  // ── Changelog (for Feed: Platform Updates) ──
  router.get("/api/changelog", (_req, res) => {
    // Read changelog from a static file if it exists, otherwise return defaults
    const changelogPath = join(baseDir, "data", "changelog.json");
    if (existsSync(changelogPath)) {
      const data = readJson(changelogPath, []);
      res.json(Array.isArray(data) ? data : []);
    } else {
      // Return empty — changelog entries are added by platform updates
      res.json([]);
    }
  });

  // ── Feed Aggregator ──
  router.get("/api/gym/feed", (_req, res) => {
    ensureDir(memoryDir);

    // Tips — sourced from AI insights (replaces old heuristic cards)
    const insightsData = readJson(join(memoryDir, "insights.json"), { insights: [], dismissed: [] });
    const dismissed: string[] = insightsData.dismissed || [];
    const tips = (insightsData.insights || [])
      .filter((ins: any) => ins.text && !dismissed.includes(ins.id))
      .slice(-10)
      .map((ins: any) => ({
        title: ins.category === "dimension" ? "Dimension" : ins.category === "struggle" ? "Pattern" : ins.category === "dormant" ? "Dormant" : ins.category === "feature-gap" ? "Feature" : "Insight",
        description: ins.text,
        type: "tip",
        generatedAt: insightsData.generatedAt || null,
      }));

    // Platform Updates — from changelog
    const changelogPath = join(baseDir, "data", "changelog.json");
    const changelog: any[] = existsSync(changelogPath) ? readJson(changelogPath, []) : [];

    // Filter updates to those relevant to the learner
    const profile = readJson(profilePath(), {});
    const neverUsed = profile.features?.neverUsed || [];
    const relevantUpdates = changelog
      .filter((entry: any) => {
        if (!entry.feature) return true; // Show all non-feature-specific entries
        return neverUsed.includes(entry.feature); // Only show if user hasn't used this feature
      })
      .slice(-10);

    // AI Briefing — from briefing.json if it exists
    const briefingPath = join(memoryDir, "briefing.json");
    const briefing: any[] = existsSync(briefingPath) ? readJson(briefingPath, []) : [];

    res.json({
      tips,
      platformUpdates: relevantUpdates,
      briefing: briefing.slice(-5),
    });
  });

  // ── Gym Config (public flags for frontend) ──
  router.get("/api/gym/config", (_req, res) => {
    // Read service config to get gym flags
    const configPath = join(baseDir, "config.json");
    const config = readJson(configPath, {});
    const service = config.service || {};
    res.json({
      gymEnabled: !!service.gymEnabled,
      gymOnlyMode: !!service.gymOnlyMode,
      aibriefingEnabled: !!service.aibriefingEnabled,
    });
  });

  // ── AI Insights (written by weekly goal, read by "You tell me") ──

  const insightsPath = () => join(memoryDir, "insights.json");

  router.get("/api/gym/insights", (req, res) => {
    const data = readJson(insightsPath(), { insights: [], generatedAt: null, dismissed: [] });
    const dismissed: string[] = data.dismissed || [];
    const includeDismissed = req.query.includeDismissed === "true";
    // Filter out dismissed insights unless explicitly requested
    const filtered = includeDismissed
      ? data.insights || []
      : (data.insights || []).filter((ins: any) => !dismissed.includes(ins.id));
    res.json({ ...data, insights: filtered });
  });

  router.post("/api/gym/insights", (req, res) => {
    const existing = readJson(insightsPath(), { insights: [], generatedAt: null, dismissed: [] });
    // Assign IDs to each insight if not already present
    const insights = (req.body.insights || []).map((ins: any, i: number) => ({
      ...ins,
      id: ins.id || `insight-${ins.category || "gen"}-${i}-${Date.now()}`,
    }));
    const newInsights = {
      insights,
      topRecommendation: req.body.topRecommendation || null,
      summary: req.body.summary || null,
      generatedAt: new Date().toISOString(),
      previousGeneratedAt: existing.generatedAt || null,
      dismissed: existing.dismissed || [], // Preserve dismissed list across regenerations
    };
    writeJson(insightsPath(), newInsights);
    res.json(newInsights);
  });

  // Dismiss an insight (mark as done or cancelled)
  router.post("/api/gym/insights/:id/dismiss", (req, res) => {
    const data = readJson(insightsPath(), { insights: [], generatedAt: null, dismissed: [] });
    const dismissed: string[] = data.dismissed || [];
    const insightId = req.params.id;
    const status = req.body.status || "dismissed"; // "done" | "cancelled" | "dismissed"
    const insight = (data.insights || []).find((ins: any) => ins.id === insightId);
    if (!insight) {
      res.status(404).json({ error: "Insight not found" });
      return;
    }
    if (!dismissed.includes(insightId)) {
      dismissed.push(insightId);
    }
    // Mark the insight itself with status for history
    insight.dismissedAt = new Date().toISOString();
    insight.dismissStatus = status;
    data.dismissed = dismissed;
    writeJson(insightsPath(), data);
    res.json({ ok: true, id: insightId, status });
  });

  // Clear all dismissed insights (reset)
  router.post("/api/gym/insights/reset-dismissed", (_req, res) => {
    const data = readJson(insightsPath(), { insights: [], generatedAt: null, dismissed: [] });
    // Remove dismiss markers from insights
    for (const ins of (data.insights || [])) {
      delete ins.dismissedAt;
      delete ins.dismissStatus;
    }
    data.dismissed = [];
    writeJson(insightsPath(), data);
    res.json({ ok: true });
  });

  // ── Manual digest trigger ────────────────────────────────────────
  router.post("/api/gym/insights/generate", async (_req, res) => {
    try {
      const { runActivityDigest } = await import("./activity-digest.js");
      const configPath = join(baseDir, "config.json");
      const config = readJson(configPath, {});
      const port = config.service?.port || 4888;
      await runActivityDigest({ baseDir, port, memoryDir });
      const data = readJson(insightsPath(), { insights: [], generatedAt: null });
      res.json({ ok: true, ...data });
    } catch (err: any) {
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  // ── Coach-Created Guides ──────────────────────────────────────────

  // List guides (programs with source=coach)
  router.get("/api/gym/guides", (_req, res) => {
    const guides: any[] = [];
    // Check user programs dir for coach-created guides
    if (existsSync(userProgramsDir)) {
      for (const entry of readdirSync(userProgramsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const pPath = join(userProgramsDir, entry.name, "program.json");
        const data = readJson(pPath, null);
        if (data && data.source === "coach") {
          guides.push({ ...data, slug: entry.name });
        }
      }
    }
    res.json(guides);
  });

  // Create a guide (convenience wrapper — creates a program with source=coach)
  router.post("/api/gym/guides", (req, res) => {
    const slug = req.body.slug || req.body.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || randomUUID();
    const progDir = join(userProgramsDir, slug);
    ensureDir(progDir);

    const guide = {
      ...req.body,
      slug,
      source: "coach",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeJson(join(progDir, "program.json"), guide);
    res.status(201).json(guide);
  });

  // ── Projects & Series ──────────────────────────────────────────────
  //
  // Projects group programs by source/author. Series group programs within
  // a project. Both are stored as JSON files alongside programs.
  //
  //   Platform projects: agents/platform/gym/projects/{slug}/project.json
  //   User projects:     {memoryDir}/projects/{slug}/project.json
  //   Series:            .../{slug}/series/{series-slug}.json

  const platformProjectsDir = join(gymRepoDir, "projects");
  const userProjectsDir = join(memoryDir, "projects");

  // ── Helpers: Projects ────────────────────────────────────────────

  function listProjectsFromDir(dir: string, source: string): any[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const data = readJson(join(dir, d.name, "project.json"), null);
        if (!data) return null;
        // Count programs that reference this project
        const programCount = countProgramsForProject(data.slug || d.name);
        // Count series
        const seriesDir = join(dir, d.name, "series");
        const seriesCount = existsSync(seriesDir)
          ? readdirSync(seriesDir).filter((f) => f.endsWith(".json")).length
          : 0;
        return { ...data, slug: data.slug || d.name, source, _counts: { programs: programCount, series: seriesCount } };
      })
      .filter(Boolean);
  }

  function countProgramsForProject(projectSlug: string): number {
    let count = 0;
    for (const dir of [programsDir, userProgramsDir]) {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const data = readJson(join(dir, entry.name, "program.json"), null);
        if (data && data.projectSlug === projectSlug) count++;
      }
    }
    return count;
  }

  function resolveProjectDir(slug: string): { dir: string; source: string } | null {
    const userDir = join(userProjectsDir, slug);
    if (existsSync(join(userDir, "project.json"))) return { dir: userDir, source: "user" };
    const platDir = join(platformProjectsDir, slug);
    if (existsSync(join(platDir, "project.json"))) return { dir: platDir, source: "platform" };
    return null;
  }

  // ── Projects — List All ──────────────────────────────────────────

  router.get("/api/gym/projects", (_req, res) => {
    const projects = [
      ...listProjectsFromDir(platformProjectsDir, "platform"),
      ...listProjectsFromDir(userProjectsDir, "user"),
    ];
    res.json(projects);
  });

  // ── Projects — Get One ───────────────────────────────────────────

  router.get("/api/gym/projects/:slug", (req, res) => {
    const resolved = resolveProjectDir(req.params.slug);
    if (!resolved) { res.status(404).json({ error: "Project not found" }); return; }

    const project = readJson(join(resolved.dir, "project.json"), {});
    project.slug = req.params.slug;
    project.source = resolved.source;

    // Load series
    const seriesDir = join(resolved.dir, "series");
    const series: any[] = [];
    if (existsSync(seriesDir)) {
      for (const f of readdirSync(seriesDir).filter((f) => f.endsWith(".json")).sort()) {
        const s = readJson(join(seriesDir, f), null);
        if (s) series.push(s);
      }
    }
    // Sort by position
    series.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    // Load programs that belong to this project
    const programs: any[] = [];
    for (const dir of [programsDir, userProgramsDir]) {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const data = readJson(join(dir, entry.name, "program.json"), null);
        if (data && data.projectSlug === req.params.slug) {
          programs.push({ ...data, slug: data.slug || entry.name });
        }
      }
    }
    // Sort by orderInSeries (nulls last)
    programs.sort((a, b) => (a.orderInSeries ?? 9999) - (b.orderInSeries ?? 9999));

    res.json({ ...project, series, programs });
  });

  // ── Projects — Create ────────────────────────────────────────────

  router.post("/api/gym/projects", (req, res) => {
    const slug = req.body.slug || req.body.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || randomUUID();
    const projDir = join(userProjectsDir, slug);
    ensureDir(projDir);

    const project = {
      id: req.body.id || randomUUID(),
      name: req.body.name || "Untitled Project",
      slug,
      description: req.body.description || "",
      sourceUrl: req.body.sourceUrl || null,
      tags: req.body.tags || [],
      isActive: req.body.isActive !== false,
      isPublic: req.body.isPublic !== false,
      createdAt: req.body.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeJson(join(projDir, "project.json"), project);
    res.status(201).json(project);
  });

  // ── Projects — Update ────────────────────────────────────────────

  router.patch("/api/gym/projects/:slug", (req, res) => {
    const resolved = resolveProjectDir(req.params.slug);
    if (!resolved) { res.status(404).json({ error: "Project not found" }); return; }

    const pPath = join(resolved.dir, "project.json");
    const existing = readJson(pPath, {});
    const updated = { ...existing, ...req.body, slug: req.params.slug, updatedAt: new Date().toISOString() };
    writeJson(pPath, updated);
    res.json(updated);
  });

  // ── Projects — Delete ────────────────────────────────────────────

  router.delete("/api/gym/projects/:slug", (req, res) => {
    const resolved = resolveProjectDir(req.params.slug);
    if (!resolved) { res.status(404).json({ error: "Project not found" }); return; }

    rmSync(resolved.dir, { recursive: true, force: true });
    res.json({ deleted: req.params.slug });
  });

  // ── Series — List (for a project) ────────────────────────────────

  router.get("/api/gym/projects/:projectSlug/series", (req, res) => {
    const resolved = resolveProjectDir(req.params.projectSlug);
    if (!resolved) { res.status(404).json({ error: "Project not found" }); return; }

    const seriesDir = join(resolved.dir, "series");
    const series: any[] = [];
    if (existsSync(seriesDir)) {
      for (const f of readdirSync(seriesDir).filter((f) => f.endsWith(".json")).sort()) {
        const s = readJson(join(seriesDir, f), null);
        if (s) {
          // Count programs in this series
          const programCount = countProgramsForSeries(s.slug);
          series.push({ ...s, _counts: { programs: programCount } });
        }
      }
    }
    series.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    res.json(series);
  });

  function countProgramsForSeries(seriesSlug: string): number {
    let count = 0;
    for (const dir of [programsDir, userProgramsDir]) {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const data = readJson(join(dir, entry.name, "program.json"), null);
        if (data && data.seriesSlug === seriesSlug) count++;
      }
    }
    return count;
  }

  // ── Series — Get One ─────────────────────────────────────────────

  router.get("/api/gym/projects/:projectSlug/series/:seriesSlug", (req, res) => {
    const resolved = resolveProjectDir(req.params.projectSlug);
    if (!resolved) { res.status(404).json({ error: "Project not found" }); return; }

    const sPath = join(resolved.dir, "series", `${req.params.seriesSlug}.json`);
    if (!existsSync(sPath)) { res.status(404).json({ error: "Series not found" }); return; }

    const series = readJson(sPath, {});
    // Load programs in this series
    const programs: any[] = [];
    for (const dir of [programsDir, userProgramsDir]) {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const data = readJson(join(dir, entry.name, "program.json"), null);
        if (data && data.seriesSlug === req.params.seriesSlug) {
          programs.push({ ...data, slug: data.slug || entry.name });
        }
      }
    }
    programs.sort((a, b) => (a.orderInSeries ?? 9999) - (b.orderInSeries ?? 9999));

    res.json({ ...series, programs });
  });

  // ── Series — Create ──────────────────────────────────────────────

  router.post("/api/gym/projects/:projectSlug/series", (req, res) => {
    const resolved = resolveProjectDir(req.params.projectSlug);
    if (!resolved) { res.status(404).json({ error: "Project not found" }); return; }

    const slug = req.body.slug || req.body.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || randomUUID();
    const seriesDir = join(resolved.dir, "series");
    ensureDir(seriesDir);

    // Determine next position
    const existing: any[] = [];
    if (existsSync(seriesDir)) {
      for (const f of readdirSync(seriesDir).filter((f) => f.endsWith(".json"))) {
        const s = readJson(join(seriesDir, f), null);
        if (s) existing.push(s);
      }
    }
    const maxPos = existing.reduce((max, s) => Math.max(max, s.position ?? 0), -1);

    const series = {
      id: req.body.id || randomUUID(),
      name: req.body.name || "Untitled Series",
      slug,
      description: req.body.description || "",
      coverImage: req.body.coverImage || null,
      tags: req.body.tags || [],
      position: req.body.position ?? maxPos + 1,
      isActive: req.body.isActive !== false,
      projectSlug: req.params.projectSlug,
      createdAt: req.body.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeJson(join(seriesDir, `${slug}.json`), series);
    res.status(201).json(series);
  });

  // ── Series — Update ──────────────────────────────────────────────

  router.patch("/api/gym/projects/:projectSlug/series/:seriesSlug", (req, res) => {
    const resolved = resolveProjectDir(req.params.projectSlug);
    if (!resolved) { res.status(404).json({ error: "Project not found" }); return; }

    const sPath = join(resolved.dir, "series", `${req.params.seriesSlug}.json`);
    if (!existsSync(sPath)) { res.status(404).json({ error: "Series not found" }); return; }

    const existing = readJson(sPath, {});
    const updated = { ...existing, ...req.body, slug: req.params.seriesSlug, updatedAt: new Date().toISOString() };
    writeJson(sPath, updated);
    res.json(updated);
  });

  // ── Series — Delete ──────────────────────────────────────────────

  router.delete("/api/gym/projects/:projectSlug/series/:seriesSlug", (req, res) => {
    const resolved = resolveProjectDir(req.params.projectSlug);
    if (!resolved) { res.status(404).json({ error: "Project not found" }); return; }

    const sPath = join(resolved.dir, "series", `${req.params.seriesSlug}.json`);
    if (!existsSync(sPath)) { res.status(404).json({ error: "Series not found" }); return; }

    rmSync(sPath, { force: true });
    // Orphan programs — remove seriesSlug from programs that referenced this series
    for (const dir of [programsDir, userProgramsDir]) {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const pPath = join(dir, entry.name, "program.json");
        const data = readJson(pPath, null);
        if (data && data.seriesSlug === req.params.seriesSlug) {
          data.seriesSlug = null;
          data.orderInSeries = null;
          writeJson(pPath, data);
        }
      }
    }
    res.json({ deleted: req.params.seriesSlug });
  });

  // ── Import from AI Gym Platform ──────────────────────────────────
  //
  // Accepts a full project export (project + series + programs) and
  // writes it locally. Designed for easy copy-down from aigym-platform.

  router.post("/api/gym/import-from-aigym", (req, res) => {
    const { project, series, programs } = req.body;
    if (!project?.slug) {
      res.status(400).json({ error: "project.slug is required" });
      return;
    }

    const projDir = join(userProjectsDir, project.slug);
    ensureDir(projDir);

    // Write project
    const projectData = {
      id: project.id || randomUUID(),
      name: project.name,
      slug: project.slug,
      description: project.description || "",
      sourceUrl: project.sourceUrl || null,
      tags: project.tags || [],
      isActive: project.isActive !== false,
      isPublic: project.isPublic !== false,
      source: "platform",
      sourceId: project.id, // Original aigym UUID
      createdAt: project.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeJson(join(projDir, "project.json"), projectData);

    // Write series
    const seriesResults: any[] = [];
    if (Array.isArray(series)) {
      const seriesDir = join(projDir, "series");
      ensureDir(seriesDir);
      for (const s of series) {
        const sSlug = s.slug || s.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || randomUUID();
        const seriesData = {
          id: s.id || randomUUID(),
          name: s.name,
          slug: sSlug,
          description: s.description || "",
          coverImage: s.coverImage || null,
          tags: s.tags || [],
          position: s.position ?? 0,
          isActive: s.isActive !== false,
          projectSlug: project.slug,
          sourceId: s.id,
          createdAt: s.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        writeJson(join(seriesDir, `${sSlug}.json`), seriesData);
        seriesResults.push(seriesData);
      }
    }

    // Write programs
    const programResults: any[] = [];
    if (Array.isArray(programs)) {
      for (const p of programs) {
        const pSlug = p.slug || p.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || randomUUID();
        const pDir = join(userProgramsDir, pSlug);
        ensureDir(pDir);

        // Map aigym fields to local schema
        const programData: any = {
          id: pSlug,
          slug: pSlug,
          title: p.title,
          description: p.description || "",
          coverImage: p.coverImage || null,
          sourceUrl: p.sourceUrl || null,
          tier: p.tier || "free",
          personas: p.personas || [],
          globalInfo: p.globalInfo || null,
          tags: p.tags || [],
          isActive: p.isActive !== false,
          isPublic: p.isPublic !== false,
          source: "platform",
          sourceId: p.id, // Original aigym UUID
          // Grouping
          projectSlug: project.slug,
          seriesSlug: null,
          orderInSeries: null,
          // Local-only fields (defaults)
          difficulty: p.difficulty || "beginner",
          dimensions: p.dimensions || [],
          estimatedTime: p.estimatedTime || null,
          prerequisites: p.prerequisites || [],
          trainers: p.trainers || ["alex", "jordan", "morgan", "riley", "sam"],
          createdAt: p.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Resolve seriesSlug if program has seriesId
        if (p.seriesId && Array.isArray(series)) {
          const matchedSeries = series.find((s: any) => s.id === p.seriesId);
          if (matchedSeries) {
            programData.seriesSlug = matchedSeries.slug || matchedSeries.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            programData.orderInSeries = p.orderInSeries ?? null;
          }
        }

        // Map modules + steps
        if (Array.isArray(p.modules)) {
          programData.modules = p.modules.map((m: any, mi: number) => ({
            id: m.id || `module-${mi}`,
            title: m.title,
            description: m.description || "",
            order: m.position ?? mi + 1,
            agentInstructions: m.agentInstructions || null,
            isVisible: m.isVisible !== false,
            steps: Array.isArray(m.steps) ? m.steps.map((s: any, si: number) => ({
              id: s.id || `step-${mi}-${si}`,
              title: s.title,
              order: s.position ?? si + 1,
              type: s.type || "self-report",
              content: s.content || "",
              isCritical: !!s.isCritical,
              personaVariations: s.personaVariations || {},
              trainerVariations: s.personaVariations || {}, // alias
              attachments: s.attachments || [],
              isVisible: s.isVisible !== false,
              verification: s.verification || "self-report",
            })) : [],
          }));
        }

        writeJson(join(pDir, "program.json"), programData);
        programResults.push(programData);
      }
    }

    res.status(201).json({
      project: projectData,
      series: seriesResults,
      programs: programResults,
      counts: { series: seriesResults.length, programs: programResults.length },
    });
  });

  return router;
}
