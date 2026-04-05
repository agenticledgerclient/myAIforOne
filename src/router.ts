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

// Sticky routing modes:
//   "none"   — always require @mention (default)
//   "sticky" — mention once, then all messages route for stickyTimeoutMs
//   "prefix" — like sticky, but follow-up messages must start with a trigger character (e.g., ! or @)
type StickyMode = "none" | "sticky" | "prefix";

function getStickyMode(config: AppConfig, channel: string): { mode: StickyMode; prefix: string; timeoutMs: number } {
  const channelCfg = config.channels[channel];
  if (!channelCfg) return { mode: "none", prefix: "!", timeoutMs: DEFAULT_STICKY_TIMEOUT_MS };

  const raw = (channelCfg.config as any).stickyRouting;
  let mode: StickyMode = "prefix"; // default: prefix mode
  if (raw === "sticky") mode = "sticky";
  else if (raw === "none") mode = "none";
  else if (raw === "prefix") mode = "prefix";

  const prefix = (channelCfg.config as any).stickyPrefix ?? "!";
  const timeoutMs = (channelCfg.config as any).stickyTimeoutMs ?? DEFAULT_STICKY_TIMEOUT_MS;
  return { mode, prefix, timeoutMs };
}

function getStickyAgent(
  msg: InboundMessage,
  config: AppConfig,
): ResolvedRoute | null {
  const { mode, prefix, timeoutMs } = getStickyMode(config, msg.channel);
  if (mode === "none") return null;

  const key = `${msg.channel}:${msg.chatId}:${msg.sender}`;
  const entry = stickyMap.get(key);

  if (!entry) return null;

  // Check if expired
  if (Date.now() - entry.timestamp > timeoutMs) {
    stickyMap.delete(key);
    return null;
  }

  // Prefix mode: message must start with the trigger character
  if (mode === "prefix") {
    const trimmed = msg.text.trim();
    if (!trimmed.startsWith(prefix)) {
      return null; // No prefix — don't route via sticky
    }
    // Strip the prefix from the message text for the agent
    msg.text = trimmed.slice(prefix.length).trim();
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

  log.debug(`Sticky routing (${mode}): ${msg.sender} → ${entry.agentId} (${Math.round((Date.now() - entry.timestamp) / 1000)}s ago)`);
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

  // Fall back to default agent — only for the web channel
  if (msg.channel === "web" && config.defaultAgent && config.agents[config.defaultAgent]) {
    const agent = config.agents[config.defaultAgent];
    const matchingRoute = agent.routes.find(r => r.channel === msg.channel);
    if (matchingRoute) {
      return {
        agentId: config.defaultAgent,
        agentConfig: agent,
        route: matchingRoute,
      };
    }
  }

  log.debug(`No route for ${msg.channel}:${msg.chatId} from ${msg.senderName || msg.sender}`);
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
