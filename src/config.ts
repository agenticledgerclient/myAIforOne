import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import type { LogLevel } from "./logger.js";

export interface RouteMatch {
  type: "chat_id" | "chat_guid" | "chat_identifier" | "channel_id" | "jid";
  value: string | number;
}

export interface RoutePermissions {
  allowFrom: string[];
  requireMention: boolean;
}

export interface RouteConfig {
  channel: string;
  match: RouteMatch;
  permissions: RoutePermissions;
}

// ─── MCP Server definitions ──────────────────────────────────────────

export interface McpServerStdio {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpServerHttp {
  type: "http" | "sse" | "streamable-http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpServerStdio | McpServerHttp;

// ─── Cron job config ─────────────────────────────────────────────────

export interface CronJobConfig {
  schedule: string;       // cron expression (e.g., "0 9 * * *")
  message: string;        // message to send to the agent
  channel: string;        // which channel to reply on
  chatId: string;         // which chat to reply in
  enabled?: boolean;      // default true — set false to pause
}

// ─── Goals config ───────────────────────────────────────────────────

export interface GoalConfig {
  id: string;
  enabled: boolean;
  description: string;
  successCriteria?: string;
  instructions?: string;
  heartbeat: string;       // cron expression
  budget?: { maxDailyUsd: number };
  reportTo?: string | string[];  // "channel:chatId" or array of them e.g. ["telegram:-5112439418", "slack:C0ALHTDD6JF"]
}

// ─── Agent config ────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  description: string;
  agentHome?: string;    // agent's own folder (memory, skills, keys, storage)
  workspace: string;     // project/codebase the agent works on
  claudeMd: string;
  memoryDir: string;
  skills?: string[];        // shared skills from ~/.claude/commands/
  agentSkills?: string[];   // agent-specific skills from agent's skills/ folder
  mcps?: string[];
  prompts?: string[];       // prompt templates available to this agent
  persistent?: boolean;
  perSenderSessions?: boolean;
  streaming?: boolean;
  advancedMemory?: boolean;
  org?: Array<{
    organization: string;
    function: string;
    title: string;
    reportsTo?: string;
  }>;
  autonomousCapable?: boolean;
  autoCommit: boolean;
  autoCommitBranch: string;
  allowedTools: string[];
  claudeAccount?: string;  // which account this agent uses (key from service.claudeAccounts)
  mentionAliases?: string[];
  routes: RouteConfig[];
  timeout?: number;
  cron?: CronJobConfig[];
  goals?: GoalConfig[];
  wiki?: boolean;                     // Enable wiki learning — agent saves learned facts to learned.md
  wikiSync?: {
    enabled: boolean;
    schedule: string;                 // cron expression (e.g., "0 0 * * *" = daily midnight)
  };
  subAgents?: string[] | "*";  // Group agent: list of agent IDs to delegate to, or "*" for all
  platformAgent?: boolean;     // DEPRECATED — use agentClass instead
  agentClass?: "standard" | "platform" | "builder" | "gym";  // standard (default), platform (Lab creators), builder (app developer agents), gym (AI Gym agents)
  executor?: string;  // "claude" (default) or "ollama:modelname" (e.g., "ollama:gemma2")
}

export interface ChannelConfig {
  enabled: boolean;
  driver: string;
  config: Record<string, unknown>;
}

// ─── Web UI config ───────────────────────────────────────────────────

export interface WebUIConfig {
  enabled: boolean;
  port: number;
  webhookSecret?: string;
}

export interface ServiceConfig {
  logLevel: LogLevel;
  logFile?: string;
  pairingCode?: string;
  personalAgentsDir?: string;   // Override path to PersonalAgents dir (default: ~/Desktop/MyAIforOne Drive/PersonalAgents)
  personalRegistryDir?: string; // Override path to PersonalRegistry dir (default: ~/Desktop/MyAIforOne Drive/PersonalRegistry)
  webUI?: WebUIConfig;
  claudeAccounts?: Record<string, string>;  // name → config dir path, e.g. {"main": "~/.claude"}
  defaultClaudeAccount?: string;    // account name to use when agent has no claudeAccount set (e.g. "main")
  multiModelEnabled?: boolean;      // false = claude only, true = enables alternative models
  platformDefaultExecutor?: string; // "claude" (default) or "ollama:gemma2" etc.
  ollamaBaseUrl?: string;           // default: "http://localhost:11434"
  providerKeys?: Record<string, string>; // provider API keys: { openai: "sk-...", xai: "xai-...", google: "AIza...", groq: "gsk_...", together: "...", mistral: "..." }
  gymEnabled?: boolean;                   // false = gym hidden, true = gym active
  aibriefingEnabled?: boolean;            // false = no AI briefing feed, true = weekly AI news via web search
  gymOnlyMode?: boolean;
  licenseKey?: string;                    // MyAIforOne license key (validated against ai41license.agenticledger.ai)
  licenseUrl?: string;                    // Override license server URL (default: https://ai41license.agenticledger.ai)
}

export interface AppConfig {
  service: ServiceConfig;
  channels: Record<string, ChannelConfig>;
  agents: Record<string, AgentConfig>;
  mcps?: Record<string, McpServerConfig>;
  defaultAgent: string | null;
  defaultSkills?: string[];   // skills given to every agent automatically
  defaultMcps?: string[];     // MCPs given to every agent automatically
  defaultPrompts?: string[];  // prompt templates given to every agent automatically
  promptTrigger?: string;     // character used to invoke prompt templates (default: "!")
  saas?: {
    baseUrl: string;
    apiKey: string;
  };
}

export function loadConfig(configPath: string): AppConfig {
  const fullPath = resolve(configPath);
  const raw = readFileSync(fullPath, "utf-8");
  const config = JSON.parse(raw) as AppConfig;

  // Ensure required top-level keys exist (default to empty — app can start for setup)
  if (!config.agents) config.agents = {};
  if (!config.channels) config.channels = {};

  // Normalize each agent's paths and ensure routes is always an array
  const agentIds = Object.keys(config.agents);
  for (const id of agentIds) {
    const agent = config.agents[id];
    // Routes are optional — agents without channel routes are still reachable via web UI
    if (!agent.routes) agent.routes = [];
    if (!agent.workspace) {
      throw new Error(`Agent "${id}" must have a workspace path`);
    }
    if (!agent.claudeMd) {
      throw new Error(`Agent "${id}" must have a claudeMd path`);
    }

    // Resolve ~ in paths (works on macOS and Windows)
    const home = homedir();
    const resolveTilde = (p: string) =>
      p.startsWith("~") ? p.replace("~", home) : p;
    agent.workspace = resolveTilde(agent.workspace);
    if (agent.agentHome) {
      agent.agentHome = resolveTilde(agent.agentHome);
      // Auto-derive claudeMd and memoryDir from agentHome only if not explicitly set
      if (!agent.claudeMd) {
        agent.claudeMd = join(agent.agentHome, "CLAUDE.md");
      }
      if (!agent.memoryDir) {
        agent.memoryDir = join(agent.agentHome, "memory");
      }
    }
    agent.claudeMd = resolveTilde(agent.claudeMd);
    agent.memoryDir = resolveTilde(agent.memoryDir);
    // Derive agentHome from memoryDir if not set
    if (!agent.agentHome) {
      agent.agentHome = resolve(resolveTilde(agent.memoryDir), "..");
    }

    // Validate MCP references — warn and strip missing MCPs instead of crashing
    if (agent.mcps && agent.mcps.length > 0) {
      if (!config.mcps || Object.keys(config.mcps).length === 0) {
        console.warn(`[config] Agent "${id}" references MCPs but no "mcps" registry is defined — stripping MCP list`);
        agent.mcps = [];
      } else {
        const valid: string[] = [];
        for (const mcpName of agent.mcps) {
          if (config.mcps[mcpName]) {
            valid.push(mcpName);
          } else {
            console.warn(`[config] Agent "${id}" references MCP "${mcpName}" which is not defined in config.mcps — skipping`);
          }
        }
        agent.mcps = valid;
      }
    }

    // Set defaults
    agent.autoCommit = agent.autoCommit ?? false;
    agent.autoCommitBranch = agent.autoCommitBranch ?? "main";
    agent.allowedTools = agent.allowedTools ?? ["Read", "Edit", "Write", "Glob", "Grep", "Bash"];
    agent.timeout = agent.timeout ?? 14_400_000;
  }

  // Validate MCP definitions
  if (config.mcps) {
    for (const [mcpId, mcp] of Object.entries(config.mcps)) {
      if (mcp.type === "stdio") {
        if (!mcp.command) throw new Error(`MCP "${mcpId}" (stdio) must have a "command" field`);
      } else if (mcp.type === "http" || mcp.type === "sse" || mcp.type === "streamable-http") {
        if (!(mcp as McpServerHttp).url) throw new Error(`MCP "${mcpId}" (${mcp.type}) must have a "url" field`);
      } else {
        throw new Error(`MCP "${mcpId}" has unknown type "${(mcp as any).type}" — must be "stdio", "http", "sse", or "streamable-http"`);
      }
    }
  }

  // Defaults
  config.service = config.service ?? { logLevel: "info" };
  config.service.logLevel = config.service.logLevel ?? "info";
  config.defaultAgent = config.defaultAgent ?? null;

  const home = homedir();
  const driveRoot = resolve(home, "Desktop", "MyAIforOne Drive");

  // Resolve personalAgentsDir (expand ~)
  if (config.service.personalAgentsDir) {
    config.service.personalAgentsDir = config.service.personalAgentsDir.startsWith("~")
      ? config.service.personalAgentsDir.replace("~", home)
      : config.service.personalAgentsDir;
  }
  _personalAgentsDir = config.service.personalAgentsDir || resolve(driveRoot, "PersonalAgents");

  // Resolve personalRegistryDir (expand ~)
  if (config.service.personalRegistryDir) {
    config.service.personalRegistryDir = config.service.personalRegistryDir.startsWith("~")
      ? config.service.personalRegistryDir.replace("~", home)
      : config.service.personalRegistryDir;
  }
  _personalRegistryDir = config.service.personalRegistryDir || resolve(driveRoot, "PersonalRegistry");

  // Inject default account hint into claudeAccounts map so executor can pick it up
  if (config.service.defaultClaudeAccount && config.service.claudeAccounts) {
    (config.service.claudeAccounts as any)._defaultAccount = config.service.defaultClaudeAccount;
  }

  return config;
}

/** Resolved PersonalAgents directory — set during config loading, used by executor and keystore */
let _personalAgentsDir: string | null = null;
/** Resolved PersonalRegistry directory — set during config loading, used by web-ui */
let _personalRegistryDir: string | null = null;

/** Resolve the PersonalAgents directory from config, falling back to ~/Desktop/MyAIforOne Drive/PersonalAgents */
export function getPersonalAgentsDir(config?: AppConfig): string {
  if (_personalAgentsDir) return _personalAgentsDir;
  const driveRoot = resolve(homedir(), "Desktop", "MyAIforOne Drive");
  if (config) return config.service.personalAgentsDir || resolve(driveRoot, "PersonalAgents");
  return resolve(driveRoot, "PersonalAgents");
}

/** Resolve the PersonalRegistry directory from config, falling back to ~/Desktop/MyAIforOne Drive/PersonalRegistry */
export function getPersonalRegistryDir(config?: AppConfig): string {
  if (_personalRegistryDir) return _personalRegistryDir;
  const driveRoot = resolve(homedir(), "Desktop", "MyAIforOne Drive");
  if (config) return config.service.personalRegistryDir || resolve(driveRoot, "PersonalRegistry");
  return resolve(driveRoot, "PersonalRegistry");
}
