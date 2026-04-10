/**
 * AI Gym — Activity Digest
 *
 * Scheduled daily cron (6am) that:
 * 1. Reads all agent activity summaries via local HTTP API
 * 2. Scores dimensions using dimension-scorer
 * 3. Snapshots dimension history weekly
 * 4. Writes digest to daily journal
 * 5. Updates learner profile
 * 6. Generates gym cards with insights
 *
 * Runs only when gymEnabled: true.
 */

import cron from "node-cron";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  scoreAllDimensions,
  computeTrends,
  type ActivitySummary,
  type AgentInfo,
  type DimensionScores,
} from "./dimension-scorer.js";
import { log } from "../logger.js";

const API_BASE = "http://localhost";
let scheduledTask: cron.ScheduledTask | null = null;

interface DigestConfig {
  baseDir: string;
  port: number;
  memoryDir?: string;  // Override gym memory dir (defaults to agents/platform/gym/memory)
}

async function apiGet(port: number, path: string): Promise<any> {
  const res = await fetch(`${API_BASE}:${port}${path}`);
  if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
  return res.json();
}

async function apiPost(port: number, path: string, body: any): Promise<any> {
  const res = await fetch(`${API_BASE}:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API POST ${path} returned ${res.status}`);
  return res.json();
}

async function apiPut(port: number, path: string, body: any): Promise<any> {
  const res = await fetch(`${API_BASE}:${port}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API PUT ${path} returned ${res.status}`);
  return res.json();
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

/**
 * Run the activity digest. Called by cron or manually.
 */
export async function runActivityDigest(config: DigestConfig): Promise<void> {
  const { baseDir, port } = config;
  const memoryDir = config.memoryDir || join(baseDir, "agents", "platform", "gym", "memory");
  const dailyDir = join(memoryDir, "daily");

  log.info("[Gym Digest] Starting activity digest...");

  try {
    // ── Step 1: Get agent roster from config.json ──
    const agentsDir = join(baseDir, "agents");
    const agentDirs: string[] = [];

    // Primary source: config.json (contains all agents including those without agent.json)
    const configPath = join(baseDir, "config.json");
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        const agentsMap = config.agents || {};
        for (const id of Object.keys(agentsMap)) {
          agentDirs.push(id);
        }
      } catch { /* fall back to directory scan */ }
    }

    // Fallback: scan agent directories if config.json didn't yield results
    if (agentDirs.length === 0 && existsSync(agentsDir)) {
      for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
        const ajPath = join(agentsDir, entry.name, "agent.json");
        if (existsSync(ajPath)) {
          agentDirs.push(entry.name);
        }
        if (entry.name === "platform") {
          const platformDir = join(agentsDir, "platform");
          for (const sub of readdirSync(platformDir, { withFileTypes: true })) {
            if (!sub.isDirectory()) continue;
            const subAjPath = join(platformDir, sub.name, "agent.json");
            if (existsSync(subAjPath)) {
              agentDirs.push(`platform/${sub.name}`);
            }
          }
        }
      }
    }

    // ── Step 2: Get activity summaries for each agent ──
    const summaries: ActivitySummary[] = [];
    const agentInfos: AgentInfo[] = [];

    // Read config.json for agent metadata (most agents are defined here)
    let configAgents: Record<string, any> = {};
    const configPath2 = join(baseDir, "config.json");
    try {
      if (existsSync(configPath2)) {
        const config = JSON.parse(readFileSync(configPath2, "utf-8"));
        configAgents = config.agents || {};
      }
    } catch { /* ignore */ }

    for (const agentPath of agentDirs) {
      const agentId = agentPath.includes("/") ? agentPath.split("/").pop()! : agentPath;
      try {
        const summary = await apiGet(port, `/api/agents/${agentId}/activity-summary`);
        summaries.push(summary);
      } catch {
        // Agent may not have logs — skip
      }

      // Read agent config from agent.json or config.json
      let aj: any = null;
      const ajPath = join(agentsDir, agentPath, "agent.json");
      if (existsSync(ajPath)) {
        try { aj = JSON.parse(readFileSync(ajPath, "utf-8")); } catch { /* skip */ }
      }
      // Fall back to config.json entry
      if (!aj && configAgents[agentId]) {
        aj = { id: agentId, ...configAgents[agentId] };
      }

      if (aj) {
        try {
          const claudeMdPath = aj.claudeMd
            ? aj.claudeMd.replace(/^~/, process.env.HOME || "~")
            : join(agentsDir, agentPath, "CLAUDE.md");
          let promptLength = 0;
          if (existsSync(claudeMdPath)) {
            promptLength = readFileSync(claudeMdPath, "utf-8").length;
          }
          agentInfos.push({
            id: aj.id || agentId,
            name: aj.name || agentId,
            description: aj.description,
            agentClass: aj.agentClass,
            workspace: aj.workspace,
            allowedTools: aj.allowedTools,
            mcps: aj.mcps,
            goals: aj.goals,
            cron: aj.cron,
            systemPromptLength: promptLength,
          });
        } catch { /* skip */ }
      }
    }

    log.info(`[Gym Digest] Analyzed ${summaries.length} agents, ${agentInfos.length} agent configs`);

    // ── Step 3: Read learner profile ──
    const profilePath = join(memoryDir, "learner-profile.json");
    const profile = readJson(profilePath, {});
    const programsCompleted: string[] = profile.programs?.completed || [];

    // Count total programs
    const programsDir = join(baseDir, "agents", "platform", "gym", "programs");
    let totalPrograms = 0;
    if (existsSync(programsDir)) {
      totalPrograms = readdirSync(programsDir, { withFileTypes: true }).filter(
        (d) => d.isDirectory()
      ).length;
    }

    // ── Step 4: Score dimensions ──
    const scores = scoreAllDimensions(summaries, agentInfos, programsCompleted, totalPrograms);

    // Read previous scores for trends
    const prevDimensions = profile.dimensions || {};
    const previousScores: DimensionScores | null = prevDimensions.application
      ? {
          application: prevDimensions.application?.score || 0,
          communication: prevDimensions.communication?.score || 0,
          knowledge: prevDimensions.knowledge?.score || 0,
          orchestration: prevDimensions.orchestration?.score || 0,
          craft: prevDimensions.craft?.score || 0,
        }
      : null;

    const trends = computeTrends(scores, previousScores);
    const today = new Date().toISOString().slice(0, 10);

    const scoreLabels: Record<number, string> = {
      0: "Not assessed",
      1: "Beginner",
      2: "Developing",
      3: "Proficient",
      4: "Advanced",
      5: "Expert",
    };

    // Build dimensions object for profile
    const dimensions: Record<string, any> = {};
    for (const [key, score] of Object.entries(scores)) {
      dimensions[key] = {
        score,
        label: scoreLabels[score] || "Unknown",
        trend: trends[key as keyof DimensionScores],
        lastUpdated: today,
      };
    }

    // ── Step 5: Update streak ──
    const lastActiveDate = profile.streak?.lastActiveDate;
    let streakCurrent = profile.streak?.current || 0;
    const streakLongest = profile.streak?.longest || 0;

    // Check if user was active today (any agent had activity)
    const wasActiveToday = summaries.some((s) => {
      if (!s.lastActive) return false;
      return s.lastActive.slice(0, 10) === today;
    });

    if (wasActiveToday) {
      if (lastActiveDate === today) {
        // Already counted today
      } else {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);
        if (lastActiveDate === yesterdayStr) {
          streakCurrent += 1;
        } else {
          streakCurrent = 1; // Reset streak
        }
      }
    }

    // ── Step 6: Compute active agent stats ──
    const activeAgents = summaries
      .filter((s) => s.messageCount > 0 && !["hub", "gym", "agentcreator"].includes(s.agentId))
      .map((s) => s.agentId);

    const dormantAgents = summaries
      .filter((s) => {
        if (["hub", "gym", "agentcreator"].includes(s.agentId)) return false;
        if (s.messageCount === 0) return true;
        if (!s.lastActive) return true;
        const daysSinceActive =
          (Date.now() - new Date(s.lastActive).getTime()) / (1000 * 60 * 60 * 24);
        return daysSinceActive > 14;
      })
      .map((s) => s.agentId);

    const totalMessages = summaries.reduce((sum, s) => sum + s.messageCount, 0);
    const messagesThisWeek = summaries.reduce((sum, s) => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const recentDates = s.uniqueDates.filter(
        (d) => new Date(d) >= weekAgo
      );
      // Rough approximation: distribute messages evenly across dates
      const avgPerDay = s.messageCount / Math.max(s.activeDays, 1);
      return sum + Math.round(avgPerDay * recentDates.length);
    }, 0);

    // Compute features used across all agents
    const featuresUsed = new Set<string>();
    for (const s of summaries) {
      if (s.messageCount > 0) featuresUsed.add("chat");
      for (const tool of Object.keys(s.toolUseCounts)) {
        if (tool === "Read" || tool === "Write" || tool === "Edit") featuresUsed.add("file-ops");
        if (tool === "Bash") featuresUsed.add("bash");
        if (tool === "WebFetch" || tool === "WebSearch") featuresUsed.add("web");
      }
    }
    for (const a of agentInfos) {
      if (a.mcps && a.mcps.length > 0) featuresUsed.add("mcps");
      if (a.goals && a.goals.length > 0) featuresUsed.add("goals");
      if (a.cron && a.cron.length > 0) featuresUsed.add("cron");
    }

    const allFeatures = ["chat", "file-ops", "bash", "web", "mcps", "goals", "cron", "delegation", "webhooks", "multi-model"];
    const neverUsed = allFeatures.filter((f) => !featuresUsed.has(f));

    // ── Step 5: Snapshot dimensions weekly ──
    const historyPath = join(memoryDir, "dimension-history.json");
    const history = readJson(historyPath, []);
    const lastSnapshot = history.length > 0 ? history[history.length - 1].date : null;
    const daysSinceSnapshot = lastSnapshot
      ? (Date.now() - new Date(lastSnapshot).getTime()) / (1000 * 60 * 60 * 24)
      : 999;

    if (daysSinceSnapshot >= 7) {
      try {
        await apiPost(port, "/api/gym/dimensions/snapshot", {
          date: today,
          dimensions: scores,
        });
        log.info("[Gym Digest] Weekly dimension snapshot saved");
      } catch (err) {
        log.warn(`[Gym Digest] Failed to snapshot dimensions: ${err}`);
      }
    }

    // ── Step 6: Write daily digest journal ──
    mkdirSync(dailyDir, { recursive: true });
    const digestPath = join(dailyDir, `${today}.md`);

    const digestLines: string[] = [
      `# Activity Digest — ${today}`,
      "",
      `## Dimensions`,
      ...Object.entries(dimensions).map(
        ([k, v]: [string, any]) => `- **${k}**: ${v.score}/5 (${v.label}, ${v.trend})`
      ),
      "",
      `## Activity`,
      `- Active agents: ${activeAgents.join(", ") || "none"}`,
      `- Dormant agents: ${dormantAgents.join(", ") || "none"}`,
      `- Total messages: ${totalMessages}`,
      `- Messages this week: ~${messagesThisWeek}`,
      `- Streak: ${streakCurrent} days`,
      "",
      `## Features`,
      `- Used: ${Array.from(featuresUsed).join(", ") || "none"}`,
      `- Never used: ${neverUsed.join(", ") || "all used!"}`,
      "",
    ];

    writeFileSync(digestPath, digestLines.join("\n"), "utf-8");
    log.info(`[Gym Digest] Daily digest written to ${digestPath}`);

    // ── Step 7: Update learner profile ──
    const profileUpdate: any = {
      dimensions,
      activity: {
        activeAgents,
        dormantAgents,
        totalMessages,
        messagesThisWeek,
        lastActivity: new Date().toISOString(),
      },
      features: {
        used: Array.from(featuresUsed),
        neverUsed,
      },
      streak: {
        current: streakCurrent,
        longest: Math.max(streakCurrent, streakLongest),
        lastActiveDate: wasActiveToday ? today : lastActiveDate || today,
      },
    };

    try {
      await apiPut(port, "/api/gym/learner-profile", profileUpdate);
      log.info("[Gym Digest] Learner profile updated");
    } catch (err) {
      log.warn(`[Gym Digest] Failed to update profile: ${err}`);
    }

    // ── Step 8: Generate gym cards ──
    const cards: Array<{ title: string; description: string; type: string; ctaAction?: string; cta?: string }> = [];

    // Card: weakest dimension suggestion
    const weakest = (Object.entries(scores) as [string, number][]).sort((a, b) => a[1] - b[1])[0];
    if (weakest && weakest[1] < 3) {
      const suggestions: Record<string, string> = {
        application: "Try using an agent for a real work task today.",
        communication: "Practice writing a detailed, context-rich prompt.",
        knowledge: "Check out the Getting Started program to build foundations.",
        orchestration: "Set up your first scheduled goal or automation.",
        craft: "Create a specialized agent for one of your projects.",
      };
      cards.push({
        title: `Build your ${weakest[0]}`,
        description: suggestions[weakest[0]] || `Your ${weakest[0]} score is ${weakest[1]}/5 — let's improve it.`,
        type: "recommendation",
        cta: "Let's go",
        ctaAction: `Help me improve my ${weakest[0]} skills`,
      });
    }

    // Card: dormant agent nudge
    if (dormantAgents.length > 0) {
      const agent = dormantAgents[0];
      cards.push({
        title: `Revive @${agent}`,
        description: `Your ${agent} agent hasn't been active recently. Still useful, or time to reconfigure?`,
        type: "nudge",
        cta: "Review",
        ctaAction: `Tell me about my ${agent} agent — is it still useful?`,
      });
    }

    // Card: unused feature discovery
    if (neverUsed.length > 0) {
      const featureDescriptions: Record<string, string> = {
        goals: "Automated goals let your agents work while you sleep.",
        cron: "Scheduled tasks can run reports, checks, or updates automatically.",
        mcps: "MCPs connect your agents to external services like Slack, GitHub, or Stripe.",
        web: "Web tools let your agents search the internet and fetch live data.",
        delegation: "Agent-to-agent delegation lets agents hand off work to each other.",
        "multi-model": "You can use different AI models (Ollama, GPT) for different agents.",
      };
      const feature = neverUsed.find((f) => featureDescriptions[f]);
      if (feature) {
        cards.push({
          title: `Try ${feature}`,
          description: featureDescriptions[feature],
          type: "discovery",
          cta: "Learn more",
          ctaAction: `Tell me about ${feature} and how to set it up`,
        });
      }
    }

    // ── Struggle Detection ──
    const struggles: Array<{agentId: string; pattern: string; detail: string}> = [];

    for (const s of summaries) {
      if (s.messageCount < 5) continue;
      const agentId = s.agentId;
      if (["hub", "gym", "agentcreator"].includes(agentId)) continue;

      // Read last 50 log entries for this agent
      try {
        const logsRes = await apiGet(port, `/api/agents/${agentId}/logs?limit=50`);
        const entries = logsRes.entries || [];

        // Detect "gave up" patterns
        const gaveUpPatterns = /never\s*mind|forget\s*it|i('|')ll\s+do\s+it\s+(myself|manually)|this\s+isn('|')t\s+working|let('|')s\s+stop/i;
        const gaveUpCount = entries.filter((e: any) => e.role === "user" && gaveUpPatterns.test(e.content || "")).length;
        if (gaveUpCount >= 2) {
          struggles.push({ agentId, pattern: "gave-up", detail: `User gave up ${gaveUpCount} times with @${agentId}` });
        }

        // Detect high correction rate (many short back-and-forth exchanges)
        let corrections = 0;
        for (let i = 1; i < entries.length - 1; i++) {
          const prev = entries[i - 1];
          const curr = entries[i];
          if (prev?.role === "assistant" && curr?.role === "user") {
            const msg = (curr.content || "").toLowerCase();
            if (msg.startsWith("no") || msg.startsWith("that's not") || msg.startsWith("wrong") || msg.startsWith("try again") || /not what i/i.test(msg)) {
              corrections++;
            }
          }
        }
        if (corrections >= 4) {
          struggles.push({ agentId, pattern: "high-correction", detail: `High correction rate (${corrections}x) with @${agentId}` });
        }
      } catch { /* skip */ }
    }

    // Write struggles to profile
    if (struggles.length > 0) {
      profileUpdate.patterns = {
        ...profileUpdate.patterns,
        struggles: struggles.map((s) => ({ ...s, detectedAt: today })),
      };

      // Generate a card for the top struggle
      const topStruggle = struggles[0];
      const struggleAdvice: Record<string, string> = {
        "gave-up": `You've been hitting walls with @${topStruggle.agentId}. Want to work on prompt strategies that get better results?`,
        "high-correction": `Lots of back-and-forth with @${topStruggle.agentId}. A more structured prompt upfront could save time — want me to show you?`,
      };
      cards.push({
        title: "Coaching Moment",
        description: struggleAdvice[topStruggle.pattern] || topStruggle.detail,
        type: "tip",
        cta: "Help me",
        ctaAction: `I've been struggling with @${topStruggle.agentId}. Can you help me communicate with it better?`,
      });
    }

    // Re-update profile with struggle patterns
    if (struggles.length > 0) {
      try {
        await apiPut(port, "/api/gym/learner-profile", profileUpdate);
        log.info("[Gym Digest] Learner profile updated with struggle patterns");
      } catch (err) {
        log.warn(`[Gym Digest] Failed to update profile with struggles: ${err}`);
      }
    }

    // ── Capability Gap Analysis ──
    const allPlatformFeatures = ["chat", "file-ops", "bash", "web", "mcps", "goals", "cron", "delegation", "webhooks", "multi-model", "wiki", "advanced-memory", "canvas", "projects"];
    const gapFeatures = allPlatformFeatures.filter((f) => !featuresUsed.has(f));

    // Identify highest-value unused capability based on current patterns
    const featureValue: Record<string, { value: number; reason: string }> = {
      "goals": { value: 5, reason: "Automate recurring tasks — your agents can work while you sleep." },
      "mcps": { value: 5, reason: "Connect to external services (Slack, GitHub, APIs) for powerful workflows." },
      "projects": { value: 4, reason: "Organize multi-agent initiatives with tasks and tracking." },
      "cron": { value: 4, reason: "Schedule regular agent check-ins, reports, or maintenance." },
      "wiki": { value: 3, reason: "Let agents learn and remember facts across sessions." },
      "advanced-memory": { value: 3, reason: "Semantic search across past conversations for deeper context." },
      "canvas": { value: 2, reason: "Preview and edit files directly in the chat interface." },
      "multi-model": { value: 2, reason: "Use different AI models for different tasks." },
      "delegation": { value: 2, reason: "Let agents hand off work to each other for complex workflows." },
    };

    const topGap = gapFeatures
      .filter((f) => featureValue[f])
      .sort((a, b) => (featureValue[b]?.value || 0) - (featureValue[a]?.value || 0))[0];

    if (topGap && cards.length < 3) {
      cards.push({
        title: `Unlock ${topGap}`,
        description: featureValue[topGap].reason,
        type: "tip",
        cta: "Tell me more",
        ctaAction: `Tell me about ${topGap} and how to set it up on this platform`,
      });
    }

    // Post cards (max 3)
    for (const card of cards.slice(0, 3)) {
      try {
        await apiPost(port, "/api/gym/cards", {
          ...card,
          isNew: true,
          generatedAt: today,
        });
      } catch (err) {
        log.warn(`[Gym Digest] Failed to create gym card: ${err}`);
      }
    }

    // ── Step 9: Generate insights for "You tell me" mode ──
    const insights: Array<{ category: string; text: string; priority: number }> = [];

    // Insight from weakest dimension
    if (weakest && weakest[1] < 3) {
      const dimTips: Record<string, string> = {
        application: "You're not yet using agents for real work tasks regularly. Bringing a real task to an agent — even a small one — builds the strongest intuition.",
        communication: "Your prompts could be more detailed. Try giving agents more context upfront: what you want, why, and what good looks like.",
        knowledge: "You haven't explored the learning programs yet. Structured programs are the fastest way to level up.",
        orchestration: "You're doing everything manually. Goals, cron jobs, and delegation can automate the repetitive parts.",
        craft: "Your agents are still generic. Specialized agents with focused system prompts and curated tools outperform generalists.",
      };
      insights.push({
        category: "dimension",
        text: dimTips[weakest[0]] || `Your ${weakest[0]} score is ${weakest[1]}/5 — room to grow.`,
        priority: 5 - weakest[1],
      });
    }

    // Insight from struggles
    if (struggles.length > 0) {
      const s = struggles[0];
      insights.push({
        category: "struggle",
        text: s.pattern === "gave-up"
          ? `You've been hitting walls with @${s.agentId}. This usually means the prompt needs restructuring — not that the agent can't do it.`
          : `Lots of corrections with @${s.agentId}. Front-loading context in your initial prompt can cut the back-and-forth in half.`,
        priority: 4,
      });
    }

    // Insight from dormant agents
    if (dormantAgents.length > 0) {
      insights.push({
        category: "dormant",
        text: `You have ${dormantAgents.length} dormant agent${dormantAgents.length > 1 ? "s" : ""} (${dormantAgents.slice(0, 3).map(a => "@" + a).join(", ")}). Worth reviewing — maybe reconfigure or retire them.`,
        priority: 2,
      });
    }

    // Insight from unused high-value feature
    if (topGap) {
      insights.push({
        category: "feature-gap",
        text: `You haven't tried ${topGap} yet. ${featureValue[topGap].reason}`,
        priority: featureValue[topGap].value >= 4 ? 3 : 1,
      });
    }

    // Sort by priority and pick top recommendation
    insights.sort((a, b) => b.priority - a.priority);
    const topRec = insights[0];

    // Build summary
    const summaryParts: string[] = [];
    const overallLevel = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / 5);
    summaryParts.push(`Overall level: ${scoreLabels[overallLevel] || "Developing"} (avg ${(Object.values(scores).reduce((a, b) => a + b, 0) / 5).toFixed(1)}/5).`);
    summaryParts.push(`${activeAgents.length} active agent${activeAgents.length !== 1 ? "s" : ""}, ~${messagesThisWeek} messages this week, ${streakCurrent}-day streak.`);
    if (weakest && weakest[1] < 3) summaryParts.push(`Weakest area: ${weakest[0]} (${weakest[1]}/5).`);

    try {
      await apiPost(port, "/api/gym/insights", {
        insights: insights.map(({ category, text }) => ({ category, text })),
        topRecommendation: topRec ? topRec.text : null,
        summary: summaryParts.join(" "),
      });
      log.info(`[Gym Digest] Insights updated (${insights.length} insights, top: ${topRec?.category || "none"})`);
    } catch (err) {
      log.warn(`[Gym Digest] Failed to update insights: ${err}`);
    }

    log.info(`[Gym Digest] Complete. ${cards.length} cards generated.`);
  } catch (err) {
    log.error(`[Gym Digest] Failed: ${err}`);
  }
}

/**
 * Start the activity digest cron job.
 * Runs daily at 6am when gymEnabled is true.
 */
export function startActivityDigest(config: DigestConfig): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }

  scheduledTask = cron.schedule("0 6 * * *", async () => {
    await runActivityDigest(config);
  });

  log.info("[Gym Digest] Scheduled: daily at 6am");
}

export function stopActivityDigest(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    log.info("[Gym Digest] Stopped");
  }
}
