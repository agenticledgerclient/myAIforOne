import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
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
  type: "http" | "sse";
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
  subAgents?: string[] | "*";  // Group agent: list of agent IDs to delegate to, or "*" for all
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
  personalAgentsDir?: string;  // Override path to personalAgents dir (default: ~/Desktop/personalAgents)
  webUI?: WebUIConfig;
  claudeAccounts?: Record<string, string>;  // name → config dir path, e.g. {"main": "~/.claude"}
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
}

export function loadConfig(configPath: string): AppConfig {
  const fullPath = resolve(configPath);
  const raw = readFileSync(fullPath, "utf-8");
  const config = JSON.parse(raw) as AppConfig;

  // Validate required fields
  if (!config.agents || Object.keys(config.agents).length === 0) {
    throw new Error("config.json must have at least one agent defined");
  }

  if (!config.channels || Object.keys(config.channels).length === 0) {
    throw new Error("config.json must have at least one channel defined");
  }

  const enabledChannels = Object.entries(config.channels).filter(([, c]) => c.enabled);
  if (enabledChannels.length === 0) {
    throw new Error("At least one channel must be enabled");
  }

  // Validate each agent has at least one route
  for (const [id, agent] of Object.entries(config.agents)) {
    if (!agent.routes || agent.routes.length === 0) {
      throw new Error(`Agent "${id}" must have at least one route`);
    }
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
      // Auto-derive claudeMd and memoryDir from agentHome if not explicitly set differently
      if (!agent.claudeMd || agent.claudeMd.includes(id)) {
        agent.claudeMd = `${agent.agentHome}/CLAUDE.md`;
      }
      if (!agent.memoryDir || agent.memoryDir.includes(id)) {
        agent.memoryDir = `${agent.agentHome}/memory`;
      }
    }
    agent.claudeMd = resolveTilde(agent.claudeMd);
    agent.memoryDir = resolveTilde(agent.memoryDir);
    // Derive agentHome from memoryDir if not set
    if (!agent.agentHome) {
      agent.agentHome = resolve(resolveTilde(agent.memoryDir), "..");
    }

    // Validate MCP references
    if (agent.mcps && agent.mcps.length > 0) {
      if (!config.mcps || Object.keys(config.mcps).length === 0) {
        throw new Error(`Agent "${id}" references MCPs but no "mcps" registry is defined in config`);
      }
      for (const mcpName of agent.mcps) {
        if (!config.mcps[mcpName]) {
          throw new Error(`Agent "${id}" references MCP "${mcpName}" which is not defined in config.mcps`);
        }
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
      } else if (mcp.type === "http" || mcp.type === "sse") {
        if (!(mcp as McpServerHttp).url) throw new Error(`MCP "${mcpId}" (${mcp.type}) must have a "url" field`);
      } else {
        throw new Error(`MCP "${mcpId}" has unknown type "${(mcp as any).type}" — must be "stdio", "http", or "sse"`);
      }
    }
  }

  // Defaults
  config.service = config.service ?? { logLevel: "info" };
  config.service.logLevel = config.service.logLevel ?? "info";
  config.defaultAgent = config.defaultAgent ?? null;

  // Resolve personalAgentsDir (expand ~)
  if (config.service.personalAgentsDir) {
    const home = homedir();
    config.service.personalAgentsDir = config.service.personalAgentsDir.startsWith("~")
      ? config.service.personalAgentsDir.replace("~", home)
      : config.service.personalAgentsDir;
  }
  _personalAgentsDir = config.service.personalAgentsDir || resolve(homedir(), "Desktop", "personalAgents");

  return config;
}

/** Resolved personalAgents directory — set during config loading, used by executor and keystore */
let _personalAgentsDir: string | null = null;

/** Resolve the personalAgents directory from config, falling back to ~/Desktop/personalAgents */
export function getPersonalAgentsDir(config?: AppConfig): string {
  if (_personalAgentsDir) return _personalAgentsDir;
  if (config) return config.service.personalAgentsDir || resolve(homedir(), "Desktop", "personalAgents");
  return resolve(homedir(), "Desktop", "personalAgents");
}
