import { Router } from "express";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
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
    ensureDir(join(path, "..").replace(/\/\.\.$/, ""));
    const dir = path.substring(0, path.lastIndexOf("/"));
    ensureDir(dir);
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

  router.get("/api/gym/cards", (_req, res) => {
    ensureDir(memoryDir);
    const data = readJson(cardsPath(), []);
    res.json(Array.isArray(data) ? data : []);
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
    const memDir = join(agentsDir, agentId, "memory");
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

    // Try direct path, then platform/ subfolder
    let logPath = join(agentsDir, agentId, "memory", "conversation_log.jsonl");
    if (!existsSync(logPath)) {
      logPath = join(agentsDir, "platform", agentId, "memory", "conversation_log.jsonl");
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

    // Tips — cards tagged as type "tip"
    const allCards: any[] = readJson(cardsPath(), []);
    const tips = (Array.isArray(allCards) ? allCards : [])
      .filter((c: any) => c.type === "tip" || c.type === "discovery" || c.type === "nudge")
      .slice(-10);

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

  return router;
}
