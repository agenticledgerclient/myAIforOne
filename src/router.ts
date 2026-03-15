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
      // Check if this message IS the pairing code
      if (msg.text.trim() === config.service.pairingCode) {
        pairedSenders.add(senderKey);
        savePairingStore();
        log.info(`Paired sender: ${senderKey}`);
        // Return null — the index.ts will see the pairing response flag
        return null;
      }
      log.debug(`Unpaired sender ${senderKey} — ignoring`);
      return null;
    }
  }

  for (const [agentId, agent] of Object.entries(config.agents)) {
    for (const route of agent.routes) {
      // Channel must match
      if (route.channel !== msg.channel) continue;

      // Chat ID must match
      const matchValue = String(route.match.value);
      if (msg.chatId !== matchValue) continue;

      // Permission check
      if (!isAllowed(msg, route)) {
        log.debug(`Blocked: ${msg.sender} not in allowFrom for ${agentId}`);
        return null;
      }

      // Mention check (groups and DMs)
      if (route.permissions.requireMention) {
        if (!hasMention(msg.text, agent)) {
          log.debug(`Skipping: mention required but no alias found in message`);
          continue;
        }
      }

      return { agentId, agentConfig: agent, route };
    }
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
