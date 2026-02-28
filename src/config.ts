import { readFileSync } from "node:fs";
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

export interface AgentConfig {
  name: string;
  description: string;
  workspace: string;
  claudeMd: string;
  memoryDir: string;
  skills?: string[];
  autoCommit: boolean;
  autoCommitBranch: string;
  allowedTools: string[];
  mentionAliases?: string[];
  routes: RouteConfig[];
  timeout?: number;
}

export interface ChannelConfig {
  enabled: boolean;
  driver: string;
  config: Record<string, unknown>;
}

export interface ServiceConfig {
  logLevel: LogLevel;
  logFile?: string;
}

export interface AppConfig {
  service: ServiceConfig;
  channels: Record<string, ChannelConfig>;
  agents: Record<string, AgentConfig>;
  defaultAgent: string | null;
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

    // Resolve ~ in workspace path
    if (agent.workspace.startsWith("~")) {
      agent.workspace = agent.workspace.replace("~", process.env.HOME || "");
    }

    // Set defaults
    agent.autoCommit = agent.autoCommit ?? false;
    agent.autoCommitBranch = agent.autoCommitBranch ?? "main";
    agent.allowedTools = agent.allowedTools ?? ["Read", "Edit", "Write", "Glob", "Grep", "Bash"];
    agent.timeout = agent.timeout ?? 120_000;
  }

  // Defaults
  config.service = config.service ?? { logLevel: "info" };
  config.service.logLevel = config.service.logLevel ?? "info";
  config.defaultAgent = config.defaultAgent ?? null;

  return config;
}
