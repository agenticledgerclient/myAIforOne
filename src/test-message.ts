import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { configureLogger, log } from "./logger.js";
import { executeAgent } from "./executor.js";
import type { InboundMessage } from "./channels/types.js";
import type { ResolvedRoute } from "./router.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = resolve(__dirname, "..");

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let agentId: string | null = null;
  let text: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent" && args[i + 1]) {
      agentId = args[++i];
    } else if (args[i] === "--text" && args[i + 1]) {
      text = args[++i];
    }
  }

  if (!agentId || !text) {
    console.log("Usage: npm run test-message -- --agent <agentId> --text <message>");
    console.log('Example: npm run test-message -- --agent fic-show --text "List all episodes"');
    process.exit(1);
  }

  const configPath = resolve(baseDir, "config.json");
  const config = loadConfig(configPath);

  configureLogger("debug");

  const agentConfig = config.agents[agentId];
  if (!agentConfig) {
    console.error(`Agent "${agentId}" not found. Available: ${Object.keys(config.agents).join(", ")}`);
    process.exit(1);
  }

  const msg: InboundMessage = {
    id: "test-" + Date.now(),
    channel: "test",
    chatId: "test",
    chatType: "dm",
    sender: "test-user",
    text,
    timestamp: Date.now(),
    isFromMe: false,
    isGroup: false,
    raw: {},
  };

  const route: ResolvedRoute = {
    agentId,
    agentConfig,
    route: agentConfig.routes[0],
  };

  log.info(`Testing agent "${agentId}" with message: "${text}"`);
  const response = await executeAgent(route, msg, baseDir);
  console.log("\n--- Agent Response ---");
  console.log(response);
  console.log("--- End ---\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
