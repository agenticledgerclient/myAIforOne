import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { InboundMessage } from "./channels/types.js";
import type { AgentConfig, RouteConfig, AppConfig } from "./config.js";
import { log } from "./logger.js";

export interface ResolvedRoute {
  agentId: string;
  agentConfig: AgentConfig;
  route: RouteConfig;
}

// ─── Pairing store ───────────────────────────────────────────────────

const pairedSenders = new Set<string>();
let pairingStoreLoaded = false;
let pairingStorePath = "";

function loadPairingStore(baseDir: string): void {
  if (pairingStoreLoaded) return;
  pairingStorePath = join(baseDir, "data", "paired-senders.json");
  try {
    if (existsSync(pairingStorePath)) {
      const data = JSON.parse(readFileSync(pairingStorePath, "utf-8")) as string[];
      for (const s of data) pairedSenders.add(s);
    }
  } catch { /* fresh start */ }
  pairingStoreLoaded = true;
}

function savePairingStore(): void {
  try {
    mkdirSync(join(pairingStorePath, ".."), { recursive: true });
    writeFileSync(pairingStorePath, JSON.stringify([...pairedSenders], null, 2));
  } catch (err) {
    log.warn(`Failed to save pairing store: ${err}`);
  }
}

// ─── Sticky routing ──────────────────────────────────────────────────

interface StickyEntry {
  agentId: string;
  timestamp: number;
}

// Key: "channel:chatId:sender" → last agent they talked to
const stickyMap = new Map<string, StickyEntry>();

const DEFAULT_STICKY_TIMEOUT_MS = 300_000; // 5 minutes

function getStickyAgent(
  msg: InboundMessage,
  config: AppConfig,
): ResolvedRoute | null {
  // Check if this channel has sticky routing enabled
  const channelCfg = config.channels[msg.channel];
  if (!channelCfg) return null;

  const stickyEnabled = (channelCfg.config as any).stickyRouting ?? true;
  if (!stickyEnabled) return null;

  const timeoutMs = (channelCfg.config as any).stickyTimeoutMs ?? DEFAULT_STICKY_TIMEOUT_MS;
  const key = `${msg.channel}:${msg.chatId}:${msg.sender}`;
  const entry = stickyMap.get(key);

  if (!entry) return null;

  // Check if expired
  if (Date.now() - entry.timestamp > timeoutMs) {
    stickyMap.delete(key);
    return null;
  }

  // Verify the agent still exists
  const agent = config.agents[entry.agentId];
  if (!agent) {
    stickyMap.delete(key);
    return null;
  }

  // Find the matching route for this channel + chatId
  const route = agent.routes.find(
    r => r.channel === msg.channel && String(r.match.value) === msg.chatId
  );
  if (!route) return null;

  // Permission check
  if (!isAllowed(msg, route)) return null;

  log.debug(`Sticky routing: ${msg.sender} → ${entry.agentId} (${Math.round((Date.now() - entry.timestamp) / 1000)}s ago)`);
  return { agentId: entry.agentId, agentConfig: agent, route };
}

function setStickyAgent(msg: InboundMessage, agentId: string): void {
  const key = `${msg.channel}:${msg.chatId}:${msg.sender}`;
  stickyMap.set(key, { agentId, timestamp: Date.now() });
}

// ─── Route resolver ──────────────────────────────────────────────────

export function resolveRoute(
  msg: InboundMessage,
  config: AppConfig,
  baseDir?: string,
): ResolvedRoute | null {
  // Feature 4: DM pairing gate
  if (config.service.pairingCode && baseDir) {
    loadPairingStore(baseDir);

    const senderKey = `${msg.channel}:${msg.sender}`;
    if (!pairedSenders.has(senderKey)) {
      if (msg.text.trim() === config.service.pairingCode) {
        pairedSenders.add(senderKey);
        savePairingStore();
        log.info(`Paired sender: ${senderKey}`);
        return null;
      }
      log.debug(`Unpaired sender ${senderKey} — ignoring`);
      return null;
    }
  }

  // Try explicit mention routing first
  for (const [agentId, agent] of Object.entries(config.agents)) {
    for (const route of agent.routes) {
      if (route.channel !== msg.channel) continue;

      const matchValue = String(route.match.value);
      if (msg.chatId !== matchValue) continue;

      if (!isAllowed(msg, route)) {
        log.debug(`Blocked: ${msg.sender} not in allowFrom for ${agentId}`);
        return null;
      }

      if (route.permissions.requireMention) {
        if (!hasMention(msg.text, agent)) {
          continue;
        }
      }

      // Explicit mention found — update sticky and return
      setStickyAgent(msg, agentId);
      return { agentId, agentConfig: agent, route };
    }
  }

  // No explicit mention — try sticky routing
  const sticky = getStickyAgent(msg, config);
  if (sticky) {
    // Refresh the timestamp on each sticky hit
    setStickyAgent(msg, sticky.agentId);
    return sticky;
  }

  // Fall back to default agent
  if (config.defaultAgent && config.agents[config.defaultAgent]) {
    const agent = config.agents[config.defaultAgent];
    return {
      agentId: config.defaultAgent,
      agentConfig: agent,
      route: agent.routes[0],
    };
  }

  return null;
}

// Exported for pairing check in index.ts
export function isPairingAttempt(msg: InboundMessage, config: AppConfig, baseDir: string): boolean {
  if (!config.service.pairingCode) return false;
  loadPairingStore(baseDir);
  const senderKey = `${msg.channel}:${msg.sender}`;
  if (pairedSenders.has(senderKey)) return false;
  return msg.text.trim() === config.service.pairingCode;
}

export function pairSender(msg: InboundMessage, baseDir: string): void {
  loadPairingStore(baseDir);
  const senderKey = `${msg.channel}:${msg.sender}`;
  pairedSenders.add(senderKey);
  savePairingStore();
  log.info(`Paired sender: ${senderKey}`);
}

function hasMention(text: string, agent: AgentConfig): boolean {
  const lower = text.toLowerCase();
  if (agent.mentionAliases?.length) {
    return agent.mentionAliases.some((alias) => lower.includes(alias.toLowerCase()));
  }
  return lower.includes(agent.name.toLowerCase());
}

function isAllowed(msg: InboundMessage, route: RouteConfig): boolean {
  const { allowFrom } = route.permissions;
  if (!allowFrom || allowFrom.length === 0) return true;
  if (allowFrom.includes("*")) return true;
  return allowFrom.includes(msg.sender);
}
