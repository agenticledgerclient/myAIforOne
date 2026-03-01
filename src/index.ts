import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { configureLogger, log } from "./logger.js";
import { resolveRoute } from "./router.js";
import { executeAgent } from "./executor.js";
import { IMessageDriver } from "./channels/imessage.js";
import { SlackDriver } from "./channels/slack.js";
import { WhatsAppDriver } from "./channels/whatsapp.js";
import type { ChannelDriver, InboundMessage } from "./channels/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = resolve(__dirname, "..");

async function main(): Promise<void> {
  const configPath = resolve(baseDir, "config.json");
  const config = loadConfig(configPath);

  configureLogger(config.service.logLevel, config.service.logFile);

  log.info("channelToAgentToClaude starting...");

  const drivers: ChannelDriver[] = [];

  // Initialize enabled channel drivers
  for (const [channelId, channelCfg] of Object.entries(config.channels)) {
    if (!channelCfg.enabled) {
      log.debug(`Channel "${channelId}" disabled, skipping`);
      continue;
    }

    let driver: ChannelDriver;

    switch (channelCfg.driver) {
      case "imessage":
        driver = new IMessageDriver(channelCfg.config);
        break;
      case "slack":
        driver = new SlackDriver(channelCfg.config);
        break;
      case "whatsapp":
        driver = new WhatsAppDriver(channelCfg.config);
        break;
      default:
        log.warn(`Unknown channel driver "${channelCfg.driver}" for "${channelId}", skipping`);
        continue;
    }

    // Wire up message handling
    driver.onMessage(async (msg: InboundMessage) => {
      // Route to agent
      const match = resolveRoute(msg, config);
      if (!match) return;

      log.info(`${match.agentId} <- ${msg.sender}: ${msg.text.slice(0, 80)}`);

      // Send thinking indicator (non-fatal if it fails)
      try {
        await driver.send({
          text: "On it...",
          chatId: msg.chatId,
        });
      } catch (err) {
        log.warn(`Failed to send thinking indicator: ${err}`);
      }

      // Execute agent
      const response = await executeAgent(match, msg, baseDir);

      // Reply via originating channel (retry once on failure)
      try {
        await driver.send({
          text: response,
          chatId: msg.chatId,
        });
      } catch (err) {
        log.warn(`Send failed, retrying in 2s: ${err}`);
        await new Promise((r) => setTimeout(r, 2000));
        try {
          await driver.send({
            text: response,
            chatId: msg.chatId,
          });
        } catch (retryErr) {
          log.error(`Send retry failed: ${retryErr}`);
        }
      }

      log.info(`${match.agentId} -> ${msg.chatId}: ${response.slice(0, 80)}`);
    });

    drivers.push(driver);
  }

  if (drivers.length === 0) {
    log.error("No channel drivers initialized. Check config.json.");
    process.exit(1);
  }

  // Start all drivers
  for (const driver of drivers) {
    await driver.start();
  }

  const agentCount = Object.keys(config.agents).length;
  log.info(
    `channelToAgentToClaude running — ${agentCount} agent(s), ${drivers.length} channel(s)`
  );

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down...`);
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
