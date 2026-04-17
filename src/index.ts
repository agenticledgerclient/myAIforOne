import { resolve, dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { configureLogger, log } from "./logger.js";
import { resolveRoute, isPairingAttempt, pairSender } from "./router.js";
import { executeAgent, executeAgentStreaming, setAppConfig } from "./executor.js";
import { SlackDriver } from "./channels/slack.js";
import { WhatsAppDriver } from "./channels/whatsapp.js";
import { TelegramDriver } from "./channels/telegram.js";
import { DiscordDriver } from "./channels/discord.js";
import { startWebUI } from "./web-ui.js";
import { attachMcpHttp } from "./mcp-http.js";
import { startCronJobs, stopCronJobs } from "./cron.js";
import { startGoals, stopGoals } from "./goals.js";
import { startWikiSync, stopWikiSync } from "./wiki-sync.js";
import { verifyLicense } from "./license.js";
import type { ChannelDriver, InboundMessage } from "./channels/types.js";

const isMac = process.platform === "darwin";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = resolve(__dirname, "..");

// dataDir: where config.json lives. Resolved in priority order:
// 1. MYAGENT_DATA_DIR env var (set by CLI spawn or user override)
// 2. %APPDATA%\MyAIforOneGateway on Windows, ~/.myaiforone on Mac/Linux
// 3. Legacy: Desktop/MyAIforOne Platform (previous location, kept for migration)
// 4. baseDir/package root (dev/cloned-repo fallback)
function resolveDataDir(): string {
  if (process.env.MYAGENT_DATA_DIR) return process.env.MYAGENT_DATA_DIR;
  const home = homedir();
  const isWin = process.platform === "win32";
  const appData = isWin ? (process.env.APPDATA || join(home, "AppData", "Roaming")) : home;
  const primary = isWin ? join(appData, "MyAIforOneGateway") : join(home, ".myaiforone");
  if (existsSync(join(primary, "config.json"))) return primary;
  // Legacy Desktop location — kept for backward compat
  const legacy = join(home, "Desktop", "MyAIforOne Platform");
  if (existsSync(join(legacy, "config.json"))) return legacy;
  return baseDir;
}
const dataDir = resolveDataDir();

async function main(): Promise<void> {
  const configPath = resolve(dataDir, "config.json");
  // First-run bootstrap — ONLY fires when MYAGENT_DATA_DIR is explicitly set
  // (Railway/container deploys). On local Mac installs, the /setup wizard
  // creates config.json; we never auto-generate one there.
  if (process.env.MYAGENT_DATA_DIR && !existsSync(configPath)) {
    const authToken = process.env.INITIAL_AUTH_TOKEN;
    const authPassword = process.env.INITIAL_AUTH_PASSWORD;
    if (!authToken || !authPassword) {
      console.error(
        "[bootstrap] Refusing to start a shared gateway without auth.\n" +
          "Set both INITIAL_AUTH_TOKEN and INITIAL_AUTH_PASSWORD env vars before first boot."
      );
      process.exit(1);
    }
    mkdirSync(dataDir, { recursive: true });
    const bootstrapPort = process.env.PORT ? Number(process.env.PORT) : 4888;
    const nowIso = new Date().toISOString();

    // Create shared directories on the volume
    mkdirSync(join(dataDir, "PersonalRegistry"), { recursive: true });
    mkdirSync(join(dataDir, "PersonalAgents"), { recursive: true });

    // Create platform agent directories on the volume
    const hubHome = join(dataDir, "PlatformUtilities", "hub");
    const gymHome = join(dataDir, "PlatformUtilities", "gym");
    for (const home of [hubHome, gymHome]) {
      mkdirSync(join(home, "memory"), { recursive: true });
      mkdirSync(join(home, "FileStorage", "Temp"), { recursive: true });
      mkdirSync(join(home, "FileStorage", "Permanent"), { recursive: true });
    }

    const pkgRoot = resolve(__dirname, "..");
    const minimal = {
      service: {
        logLevel: "info",
        webUI: { enabled: true, port: bootstrapPort },
        // Shared-gateway defaults — Railway deploys ARE shared gateways.
        sharedAgentsEnabled: true,
        gymEnabled: true,
        auth: {
          enabled: true,
          tokens: [authToken], // legacy field kept for backcompat
          webPassword: authPassword,
        },
        // Seed an initial API key so the new key system has a usable secret
        // without forcing operators to log in and create one by hand.
        apiKeys: [
          {
            id: "key_bootstrap",
            name: "Bootstrap",
            key: authToken,
            createdAt: nowIso,
            scopes: ["*"],
          },
        ],
      },
      channels: {},
      agents: {
        hub: {
          name: "Hub",
          description: "The primary AI interface — handles all platform operations through natural conversation.",
          agentHome: hubHome,
          claudeMd: "agents/platform/hub/CLAUDE.md",
          memoryDir: join(hubHome, "memory"),
          workspace: pkgRoot,
          persistent: true,
          streaming: true,
          agentClass: "platform",
          subAgents: "*",
          mcps: ["myaiforone-local"],
          allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"],
          timeout: 14400000,
          autoCommit: false,
          routes: [],
          org: [{ organization: "Platform", function: "Operations", title: "Hub Agent", reportsTo: "" }],
        },
        gym: {
          name: "AI Gym Coach",
          description: "Personal AI trainer — observes platform activity, delivers personalized training, and tracks skill growth.",
          agentHome: gymHome,
          claudeMd: "agents/platform/gym/CLAUDE.md",
          memoryDir: join(gymHome, "memory"),
          workspace: pkgRoot,
          agentClass: "gym",
          persistent: true,
          streaming: true,
          advancedMemory: true,
          wiki: true,
          featureFlag: "gymEnabled",
          allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
          mcps: ["myaiforone-local", "aigym-platform"],
          timeout: 14400000,
          autoCommit: false,
          mentionAliases: ["gym", "coach"],
          routes: [],
          org: [{ organization: "Platform", function: "Training", title: "AI Gym Coach", reportsTo: "hub" }],
        },
      },
      defaultAgent: "hub",
    };
    writeFileSync(configPath, JSON.stringify(minimal, null, 2));
    console.log(`[bootstrap] Wrote shared-gateway config to ${configPath}`);
  }
  // Migration: ensure platform agents exist on server mode (Railway).
  // Covers existing deployments that bootstrapped before agent seeding was added.
  if (process.env.MYAGENT_DATA_DIR && existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      if (!raw.agents) raw.agents = {};
      const pkgRoot = resolve(__dirname, "..");
      let changed = false;

      if (!raw.agents.hub) {
        const hubHome = join(dataDir, "PlatformUtilities", "hub");
        mkdirSync(join(hubHome, "memory"), { recursive: true });
        mkdirSync(join(hubHome, "FileStorage", "Temp"), { recursive: true });
        mkdirSync(join(hubHome, "FileStorage", "Permanent"), { recursive: true });
        raw.agents.hub = {
          name: "Hub",
          description: "The primary AI interface — handles all platform operations through natural conversation.",
          agentHome: hubHome,
          claudeMd: "agents/platform/hub/CLAUDE.md",
          memoryDir: join(hubHome, "memory"),
          workspace: pkgRoot,
          persistent: true,
          streaming: true,
          agentClass: "platform",
          subAgents: "*",
          mcps: ["myaiforone-local"],
          allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"],
          timeout: 14400000,
          autoCommit: false,
          routes: [],
          org: [{ organization: "Platform", function: "Operations", title: "Hub Agent", reportsTo: "" }],
        };
        if (!raw.defaultAgent) raw.defaultAgent = "hub";
        changed = true;
        console.log("[migration] Seeded hub agent");
      }

      if (!raw.agents.gym) {
        const gymHome = join(dataDir, "PlatformUtilities", "gym");
        mkdirSync(join(gymHome, "memory"), { recursive: true });
        mkdirSync(join(gymHome, "FileStorage", "Temp"), { recursive: true });
        mkdirSync(join(gymHome, "FileStorage", "Permanent"), { recursive: true });
        raw.agents.gym = {
          name: "AI Gym Coach",
          description: "Personal AI trainer — observes platform activity, delivers personalized training, and tracks skill growth.",
          agentHome: gymHome,
          claudeMd: "agents/platform/gym/CLAUDE.md",
          memoryDir: join(gymHome, "memory"),
          workspace: pkgRoot,
          agentClass: "gym",
          persistent: true,
          streaming: true,
          advancedMemory: true,
          wiki: true,
          featureFlag: "gymEnabled",
          allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
          mcps: ["myaiforone-local", "aigym-platform"],
          timeout: 14400000,
          autoCommit: false,
          mentionAliases: ["gym", "coach"],
          routes: [],
          org: [{ organization: "Platform", function: "Training", title: "AI Gym Coach", reportsTo: "hub" }],
        };
        if (!raw.service) raw.service = {};
        if (raw.service.gymEnabled === undefined) raw.service.gymEnabled = true;
        changed = true;
        console.log("[migration] Seeded gym agent");
      }

      if (changed) {
        writeFileSync(configPath, JSON.stringify(raw, null, 2));
        console.log("[migration] Updated server-mode config with platform agents");
      }
    } catch (e) {
      console.warn("[migration] Failed to seed platform agents:", e);
    }
  }

  const config = loadConfig(configPath);
  setAppConfig(config);

  configureLogger(config.service.logLevel, config.service.logFile);

  log.info("channelToAgentToClaude starting...");

  // ─── License verification (non-blocking — UI always starts) ────────
  const license = await verifyLicense(config.service.licenseKey, config.service.licenseUrl);
  if (config.service.licenseKey && !license.valid) {
    log.warn(`License invalid: ${license.error || "expired or revoked"}. Agents will be blocked until a valid license is entered in Admin → Settings.`);
  }

  const drivers: ChannelDriver[] = [];
  const driverMap = new Map<string, ChannelDriver>();

  // Initialize enabled channel drivers
  for (const [channelId, channelCfg] of Object.entries(config.channels)) {
    if (!channelCfg.enabled) {
      log.debug(`Channel "${channelId}" disabled, skipping`);
      continue;
    }

    let driver: ChannelDriver;

    switch (channelCfg.driver) {
      case "imessage":
        if (!isMac) {
          log.warn("iMessage channel is macOS-only and has been disabled on this platform. Use Telegram, Slack, or Discord instead.");
          continue;
        }
        // Dynamic import — imsg CLI only exists on macOS
        const { IMessageDriver } = await import("./channels/imessage.js");
        driver = new IMessageDriver(channelCfg.config);
        break;
      case "slack":
        driver = new SlackDriver(channelCfg.config);
        break;
      case "whatsapp":
        driver = new WhatsAppDriver(channelCfg.config);
        break;
      case "telegram":
        driver = new TelegramDriver(channelCfg.config);
        break;
      case "discord":
        driver = new DiscordDriver(channelCfg.config);
        break;
      default:
        log.warn(`Unknown channel driver "${channelCfg.driver}" for "${channelId}", skipping`);
        continue;
    }

    // Track recent bot-sent messages to prevent echo loops
    const recentBotMessages = new Set<string>();

    // Wire up message handling
    driver.onMessage(async (msg: InboundMessage) => {
      // Anti-echo: ignore bot's own messages and echo loops
      if (msg.isFromMe) return;
      if (msg.text === "On it..." || msg.text?.startsWith("Paired successfully") || msg.text?.startsWith("Still working...")) return;
      const msgKey = `${msg.chatId}:${msg.text?.slice(0, 50)}`;
      if (recentBotMessages.has(msgKey)) {
        recentBotMessages.delete(msgKey);
        return;
      }

      // Feature 4: DM pairing gate
      if (isPairingAttempt(msg, config, baseDir)) {
        pairSender(msg, baseDir);
        try {
          await driver.send({
            text: "Paired successfully. You can now message my agents.",
            chatId: msg.chatId,
          });
        } catch { /* ignore */ }
        return;
      }

      // Route to agent
      const match = resolveRoute(msg, config, baseDir);
      if (!match) return;

      log.info(`${match.agentId} <- ${msg.sender}: ${msg.text.slice(0, 80)}`);

      // Feature 2: Typing indicator
      if (driver.sendTyping) {
        driver.sendTyping(msg.chatId).catch(() => {});
      }

      // Send thinking indicator
      if (driver.sendTyping) {
        driver.sendTyping(msg.chatId).catch(() => {});
      }
      try {
        recentBotMessages.add(`${msg.chatId}:On it...`);
        await driver.send({ text: "On it...", chatId: msg.chatId });
      } catch (err) {
        log.warn(`Failed to send thinking indicator: ${err}`);
      }

      // Execute agent — streaming or regular
      // Heartbeat: send "Still working..." every 4 minutes to keep channel alive
      const HEARTBEAT_MS = 4 * 60 * 1000;
      let heartbeatCount = 0;
      const heartbeat = setInterval(() => {
        heartbeatCount++;
        const elapsed = heartbeatCount * 4;
        const heartbeatMsg = `Still working... (${elapsed} min)`;
        recentBotMessages.add(`${msg.chatId}:${heartbeatMsg}`);
        driver.send({ text: heartbeatMsg, chatId: msg.chatId }).catch((err) => {
          log.warn(`Heartbeat send failed: ${err}`);
        });
      }, HEARTBEAT_MS);

      let response: string;
      try {
        if (match.agentConfig.streaming) {
          // Streaming mode: send status updates to phone channel
          let lastStatus = "";
          let fullText = "";
          for await (const event of executeAgentStreaming(match, msg, baseDir, config.mcps, config.service.claudeAccounts, undefined, { skills: config.defaultSkills, mcps: config.defaultMcps, prompts: config.defaultPrompts, promptTrigger: config.promptTrigger })) {
            if (event.type === "status" && event.data !== lastStatus) {
              lastStatus = event.data;
              // Send status updates (throttle — only unique ones)
              if (driver.sendTyping) {
                driver.sendTyping(msg.chatId).catch(() => {});
              }
            } else if (event.type === "text") {
              fullText += event.data;
            } else if (event.type === "done") {
              response = event.data || fullText;
            } else if (event.type === "error") {
              response = `Error: ${event.data}`;
            }
          }
          response = response! || fullText || "No response from agent.";
        } else {
          response = await executeAgent(match, msg, baseDir, config.mcps, config.service.claudeAccounts, { skills: config.defaultSkills, mcps: config.defaultMcps, prompts: config.defaultPrompts, promptTrigger: config.promptTrigger });
        }
      } finally {
        clearInterval(heartbeat);
      }

      // Reply via originating channel (retry once on failure)
      recentBotMessages.add(`${msg.chatId}:${response.slice(0, 50)}`);
      try {
        await driver.send({ text: response, chatId: msg.chatId });
      } catch (err) {
        log.warn(`Send failed, retrying in 2s: ${err}`);
        await new Promise((r) => setTimeout(r, 2000));
        try {
          await driver.send({ text: response, chatId: msg.chatId });
        } catch (retryErr) {
          log.error(`Send retry failed: ${retryErr}`);
        }
      }

      log.info(`${match.agentId} -> ${msg.chatId}: ${response.slice(0, 80)}`);
    });

    drivers.push(driver);
    driverMap.set(channelId, driver);
  }

  // ─── Feature 6 + 9: Web UI + Webhooks (start early so it's accessible even with no channels) ───
  const webUI = config.service.webUI;
  let cronMessageHandler: (agentId: string, message: string, channel: string, chatId: string) => Promise<void>;

  if (webUI?.enabled) {
    const webUIPort = process.env.PORT ? Number(process.env.PORT) : (webUI.port || 8080);
    // cronMessageHandler is defined below — bind via closure so webUI can reference it
    startWebUI({
      config,
      baseDir,
      dataDir,
      port: webUIPort,
      webhookSecret: webUI.webhookSecret,
      driverMap,
      onWebhookMessage: async (agentId, text, channel, chatId) => {
        if (cronMessageHandler) await cronMessageHandler(agentId, text, channel, chatId);
      },
      // Attach the Streamable HTTP /mcp endpoint on the same port so remote
      // MCP clients (e.g. another MyAIforOne install) can reach this gateway
      // via a single Bearer-authed URL.
      attachExtraRoutes: (app) => {
        attachMcpHttp(app, { config, baseDir, port: webUIPort });
      },
    });
  }

  if (drivers.length === 0) {
    log.warn("No channel drivers enabled — running in web-UI-only mode. Configure a channel to enable messaging.");
  } else {
    // Start all drivers — catch per-channel failures so one bad token doesn't crash the gateway
    for (const driver of drivers) {
      try {
        await driver.start();
      } catch (err: any) {
        log.warn(`Channel "${driver.channelId ?? "unknown"}" failed to start: ${err.message ?? err} — skipping`);
      }
    }
  }

  // ─── Feature 7: Cron jobs ──────────────────────────────────────────
  cronMessageHandler = async (agentId: string, message: string, channel: string, chatId: string) => {
    const agent = config.agents[agentId];
    if (!agent) return;

    // Build a synthetic inbound message for the executor
    const syntheticMsg: InboundMessage = {
      id: `cron-${Date.now()}`,
      channel,
      chatId,
      chatType: "group",
      sender: "cron",
      senderName: "Scheduled Task",
      text: message,
      timestamp: Date.now(),
      isFromMe: false,
      isGroup: true,
      raw: { type: "cron" },
    };

    const route = { agentId, agentConfig: agent, route: agent.routes[0] };
    const response = await executeAgent(route, syntheticMsg, baseDir, config.mcps, config.service.claudeAccounts, { skills: config.defaultSkills, mcps: config.defaultMcps, prompts: config.defaultPrompts, promptTrigger: config.promptTrigger });

    // Send response to the configured channel
    const driver = driverMap.get(channel);
    if (driver) {
      try {
        await driver.send({ text: response, chatId });
      } catch (err) {
        log.error(`Cron response send failed for ${agentId}: ${err}`);
      }
    }
  };

  startCronJobs(config, cronMessageHandler);

  // ─── Feature 8: Autonomous Goals ──────────────────────────────────
  startGoals(config, driverMap, baseDir, config.mcps);

  // ─── Feature: Wiki Sync ──────────────────────────────────────────
  startWikiSync(config, baseDir, config.mcps);

  const agentCount = Object.keys(config.agents).length;
  log.info(
    `channelToAgentToClaude running — ${agentCount} agent(s), ${drivers.length} channel(s)`
  );

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down...`);
    stopCronJobs();
    stopGoals();
    stopWikiSync();
    for (const driver of drivers) {
      await driver.stop();
    }
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
