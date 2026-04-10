/**
 * AI Gym — Dimension Scorer
 *
 * Scores learners across 5 AI skill dimensions based on observable
 * platform activity. Each dimension is scored 0–5.
 *
 * Scoring is heuristic — it works with whatever data is available
 * and errs on the side of encouragement (never penalizes absence,
 * only rewards observed activity).
 */

export interface ActivitySummary {
  agentId: string;
  messageCount: number;
  activeDays: number;
  uniqueDates: string[];
  topics: string[];
  toolUseCounts: Record<string, number>;
  lastActive: string | null;
}

export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  agentClass?: string;
  workspace?: string;
  allowedTools?: string[];
  mcps?: string[];
  goals?: any[];
  cron?: any[];
  claudeMd?: string;
  systemPromptLength?: number;
}

export interface DimensionScores {
  application: number;
  communication: number;
  knowledge: number;
  orchestration: number;
  craft: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Application — How deeply is AI integrated into actual work?
 * Measures: usage frequency, breadth of agents used, session depth.
 */
export function scoreApplication(summaries: ActivitySummary[]): number {
  if (!summaries.length) return 0;

  // Filter out platform/gym agents — we want real usage agents
  const userAgents = summaries.filter(
    (s) => !["hub", "gym", "agentcreator"].includes(s.agentId) && s.messageCount > 0
  );

  if (!userAgents.length) return 0;

  let score = 0;

  // Breadth: how many distinct agents used?
  const agentsUsed = userAgents.length;
  if (agentsUsed >= 1) score += 1;
  if (agentsUsed >= 3) score += 1;
  if (agentsUsed >= 5) score += 0.5;

  // Frequency: total messages across all agents
  const totalMessages = userAgents.reduce((sum, s) => sum + s.messageCount, 0);
  if (totalMessages >= 10) score += 0.5;
  if (totalMessages >= 50) score += 0.5;
  if (totalMessages >= 200) score += 0.5;

  // Consistency: total active days
  const allDates = new Set<string>();
  for (const s of userAgents) {
    for (const d of s.uniqueDates) allDates.add(d);
  }
  if (allDates.size >= 3) score += 0.5;
  if (allDates.size >= 7) score += 0.5;

  return clamp(Math.round(score), 0, 5);
}

/**
 * Communication — How effectively do you talk to AI?
 * Measures: prompt patterns, correction frequency, tool use diversity.
 * Note: Without full log analysis, this is a rough proxy.
 */
export function scoreCommunication(summaries: ActivitySummary[]): number {
  if (!summaries.length) return 0;

  const userAgents = summaries.filter(
    (s) => !["hub", "gym", "agentcreator"].includes(s.agentId) && s.messageCount > 0
  );

  if (!userAgents.length) return 0;

  let score = 0;

  // Basic usage means some communication skill
  const totalMessages = userAgents.reduce((sum, s) => sum + s.messageCount, 0);
  if (totalMessages >= 5) score += 1;
  if (totalMessages >= 20) score += 0.5;

  // Tool diversity in responses suggests effective prompting
  const allTools = new Set<string>();
  for (const s of userAgents) {
    for (const tool of Object.keys(s.toolUseCounts)) allTools.add(tool);
  }
  if (allTools.size >= 2) score += 0.5;
  if (allTools.size >= 4) score += 0.5;

  // Multi-topic conversations suggest context-rich prompting
  const allTopics = new Set<string>();
  for (const s of userAgents) {
    for (const t of s.topics) allTopics.add(t);
  }
  if (allTopics.size >= 5) score += 0.5;
  if (allTopics.size >= 15) score += 0.5;

  // Repeat usage of same agent with good results
  const hasDeepAgent = userAgents.some((s) => s.messageCount >= 30);
  if (hasDeepAgent) score += 0.5;

  // File operations suggest context-sharing (Read, Write, Edit)
  const hasFileOps = userAgents.some(
    (s) => s.toolUseCounts.Read || s.toolUseCounts.Write || s.toolUseCounts.Edit
  );
  if (hasFileOps) score += 0.5;

  return clamp(Math.round(score), 0, 5);
}

/**
 * Knowledge — How much do you understand about AI concepts?
 * Measures: program completions, breadth of engagement.
 * This dimension is hard to measure from activity alone —
 * the coach supplements with direct assessment during sessions.
 */
export function scoreKnowledge(
  programsCompleted: string[],
  totalPrograms: number,
  agentsUsed: number
): number {
  let score = 0;

  // Program completion is the primary signal
  if (programsCompleted.length >= 1) score += 1.5;
  if (programsCompleted.length >= 2) score += 1;
  if (programsCompleted.length >= 3) score += 0.5;

  // Engagement with multiple programs shows breadth
  if (totalPrograms >= 2) score += 0.5;

  // Using multiple agents suggests understanding of agent concepts
  if (agentsUsed >= 2) score += 0.5;
  if (agentsUsed >= 4) score += 0.5;

  // Getting Started completion is a strong knowledge signal
  if (programsCompleted.includes("getting-started")) score += 0.5;

  return clamp(Math.round(score), 0, 5);
}

/**
 * Orchestration — Can you design multi-agent, automated workflows?
 * Measures: goals/cron usage, multi-agent patterns, delegation.
 */
export function scoreOrchestration(agents: AgentInfo[]): number {
  if (!agents.length) return 0;

  let score = 0;

  // Check for goals/cron setup
  const hasGoals = agents.some((a) => a.goals && a.goals.length > 0);
  const hasCron = agents.some((a) => a.cron && a.cron.length > 0);
  if (hasGoals) score += 1.5;
  if (hasCron) score += 1;

  // Multiple agents is a prerequisite for orchestration
  const customAgents = agents.filter(
    (a) => !["hub", "gym", "agentcreator"].includes(a.id)
  );
  if (customAgents.length >= 3) score += 0.5;
  if (customAgents.length >= 5) score += 0.5;

  // Agents with MCPs suggest integration workflows
  const hasIntegrations = agents.some((a) => a.mcps && a.mcps.length > 0);
  if (hasIntegrations) score += 0.5;

  // Multiple enabled goals/crons suggest active automation
  const totalGoals = agents.reduce(
    (sum, a) => sum + (a.goals?.filter((g: any) => g.enabled)?.length || 0),
    0
  );
  if (totalGoals >= 2) score += 0.5;
  if (totalGoals >= 4) score += 0.5;

  return clamp(Math.round(score), 0, 5);
}

/**
 * Craft — Can you build, configure, and tune AI systems?
 * Measures: agents created, system prompt quality, MCP configs, tool selection.
 */
export function scoreCraft(agents: AgentInfo[]): number {
  if (!agents.length) return 0;

  let score = 0;

  // Custom agents created (exclude platform agents)
  const customAgents = agents.filter(
    (a) => !["hub", "gym", "agentcreator"].includes(a.id) && a.agentClass !== "platform"
  );

  if (customAgents.length >= 1) score += 1;
  if (customAgents.length >= 3) score += 0.5;
  if (customAgents.length >= 5) score += 0.5;

  // System prompt quality (proxy: non-trivial length)
  const hasGoodPrompts = customAgents.some(
    (a) => (a.systemPromptLength || 0) > 200
  );
  if (hasGoodPrompts) score += 1;

  // Tool configuration (agents with customized tool sets)
  const hasCustomTools = customAgents.some(
    (a) => a.allowedTools && a.allowedTools.length > 0
  );
  if (hasCustomTools) score += 0.5;

  // MCP configuration
  const hasMcps = customAgents.some((a) => a.mcps && a.mcps.length > 0);
  if (hasMcps) score += 0.5;

  // Workspace configuration (agents with real project workspaces, not ~)
  const hasWorkspaces = customAgents.some(
    (a) => a.workspace && a.workspace !== "~" && a.workspace !== "~/"
  );
  if (hasWorkspaces) score += 0.5;

  // Multiple distinct tool configs shows thoughtful design
  const toolConfigs = new Set(
    customAgents.map((a) => JSON.stringify(a.allowedTools?.sort() || []))
  );
  if (toolConfigs.size >= 2) score += 0.5;

  return clamp(Math.round(score), 0, 5);
}

/**
 * Score all dimensions from available data.
 */
export function scoreAllDimensions(
  summaries: ActivitySummary[],
  agents: AgentInfo[],
  programsCompleted: string[],
  totalPrograms: number
): DimensionScores {
  const userAgentCount = summaries.filter(
    (s) => !["hub", "gym", "agentcreator"].includes(s.agentId) && s.messageCount > 0
  ).length;

  return {
    application: scoreApplication(summaries),
    communication: scoreCommunication(summaries),
    knowledge: scoreKnowledge(programsCompleted, totalPrograms, userAgentCount),
    orchestration: scoreOrchestration(agents),
    craft: scoreCraft(agents),
  };
}

/**
 * Determine trend from comparing current scores to previous scores.
 */
export function computeTrends(
  current: DimensionScores,
  previous: DimensionScores | null
): Record<keyof DimensionScores, "up" | "down" | "stable"> {
  const dims = ["application", "communication", "knowledge", "orchestration", "craft"] as const;
  const result: any = {};
  for (const dim of dims) {
    if (!previous) {
      result[dim] = "stable";
    } else if (current[dim] > previous[dim]) {
      result[dim] = "up";
    } else if (current[dim] < previous[dim]) {
      result[dim] = "down";
    } else {
      result[dim] = "stable";
    }
  }
  return result;
}
