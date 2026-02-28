import type { InboundMessage } from "./channels/types.js";
import type { AgentConfig, RouteConfig, AppConfig } from "./config.js";
import { log } from "./logger.js";

export interface ResolvedRoute {
  agentId: string;
  agentConfig: AgentConfig;
  route: RouteConfig;
}

export function resolveRoute(msg: InboundMessage, config: AppConfig): ResolvedRoute | null {
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

function hasMention(text: string, agent: AgentConfig): boolean {
  const lower = text.toLowerCase();
  // Check aliases first (e.g. "@fic", "@show")
  if (agent.mentionAliases?.length) {
    return agent.mentionAliases.some((alias) => lower.includes(alias.toLowerCase()));
  }
  // Fall back to full agent name
  return lower.includes(agent.name.toLowerCase());
}

function isAllowed(msg: InboundMessage, route: RouteConfig): boolean {
  const { allowFrom } = route.permissions;
  if (!allowFrom || allowFrom.length === 0) return true;
  if (allowFrom.includes("*")) return true;
  return allowFrom.includes(msg.sender);
}
