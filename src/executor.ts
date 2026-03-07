import { spawn } from "node:child_process";
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import type { InboundMessage } from "./channels/types.js";
import type { ResolvedRoute } from "./router.js";
import { formatMessage } from "./utils/message-formatter.js";
import { log } from "./logger.js";

interface ContentBlock {
  type: "text" | "image";
  text?: string;
  source?: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

export async function executeAgent(
  route: ResolvedRoute,
  msg: InboundMessage,
  baseDir: string,
): Promise<string> {
  const { agentId, agentConfig } = route;
  const workspace = resolve(agentConfig.workspace);
  const claudeMdPath = resolve(baseDir, agentConfig.claudeMd);
  const memoryDir = resolve(baseDir, agentConfig.memoryDir);
  const contextPath = join(memoryDir, "context.md");
  const logPath = join(memoryDir, "conversation_log.jsonl");

  // Load system prompt from CLAUDE.md
  let systemPrompt: string;
  try {
    systemPrompt = readFileSync(claudeMdPath, "utf-8");
  } catch (err) {
    log.error(`Failed to read CLAUDE.md for ${agentId}: ${err}`);
    return `Error: Could not load agent configuration for ${agentId}.`;
  }

  // Format the message with memory context and history
  const formattedMessage = formatMessage(
    msg,
    existsSync(contextPath) ? contextPath : undefined,
    existsSync(logPath) ? logPath : undefined,
  );

  // Build stdin payload — multimodal JSON if images attached, plain text otherwise
  const hasImages = msg.attachments && msg.attachments.length > 0;
  let stdinPayload: string;

  if (hasImages) {
    const contentBlocks: ContentBlock[] = [
      { type: "text", text: formattedMessage },
    ];

    for (const att of msg.attachments!) {
      try {
        const imgBuffer = readFileSync(att.path);
        const mimeType = att.mimeType || guessMimeType(att.path);
        if (imgBuffer.length > 10_000_000) {
          log.warn(`Skipping oversized image: ${att.path} (${imgBuffer.length} bytes)`);
          continue;
        }
        contentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: mimeType,
            data: imgBuffer.toString("base64"),
          },
        });
        log.debug(`Attached image: ${att.path} (${mimeType}, ${imgBuffer.length} bytes)`);
      } catch (err) {
        log.warn(`Failed to read attachment ${att.path}: ${err}`);
      }
    }

    stdinPayload = JSON.stringify([{ role: "user", content: contentBlocks }]);
    log.debug(`Executing ${agentId} with ${contentBlocks.length - 1} image(s): ${formattedMessage.slice(0, 200)}`);
  } else {
    stdinPayload = formattedMessage;
    log.debug(`Executing ${agentId}: ${formattedMessage.slice(0, 200)}`);
  }

  // Build claude -p command
  const args = [
    "-p",
    "-",
    "--system-prompt",
    systemPrompt,
    "--output-format",
    "text",
    "--add-dir",
    workspace,
  ];

  if (agentConfig.allowedTools.length > 0) {
    args.push("--allowedTools", agentConfig.allowedTools.join(","));
  }

  // Spawn claude in the agent's workspace directory
  const timeout = agentConfig.timeout ?? 120_000;
  let response: string;

  try {
    response = await spawnClaude(args, workspace, timeout, stdinPayload);
  } catch (err) {
    log.error(`Agent ${agentId} execution failed: ${err}`);
    return `Sorry, I ran into an error processing that request.`;
  }

  // Auto-commit if enabled
  if (agentConfig.autoCommit) {
    await autoCommit(workspace, agentId, response, agentConfig.autoCommitBranch);
  }

  // Log to conversation history
  try {
    const entry = {
      ts: new Date().toISOString(),
      from: msg.sender,
      text: msg.text,
      response: response.slice(0, 2000),
      agentId,
      channel: msg.channel,
    };
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch (err) {
    log.warn(`Failed to write conversation log: ${err}`);
  }

  return response;
}

function spawnClaude(args: string[], cwd: string, timeout: number, stdinData?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Remove env vars that trigger Claude Code nesting detection
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const proc = spawn("claude", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    // Pipe prompt via stdin if provided
    if (stdinData && proc.stdin) {
      proc.stdin.write(stdinData);
      proc.stdin.end();
    }

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`claude -p timed out after ${timeout}ms`));
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        log.warn(`claude -p exited with code ${code} stderr: ${stderr.slice(0, 500)} stdout: ${stdout.slice(0, 500)}`);
        reject(new Error(`claude -p exited with code ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function autoCommit(
  workspace: string,
  agentId: string,
  response: string,
  branch: string,
): Promise<void> {
  try {
    // Check for changes
    const status = await runGit(workspace, ["status", "--porcelain"]);
    if (!status.trim()) return;

    // Commit summary from first line of response
    const summary = response.split("\n")[0].slice(0, 72);
    await runGit(workspace, ["add", "-A"]);
    await runGit(workspace, ["commit", "-m", `Agent(${agentId}): ${summary}`]);
    await runGit(workspace, ["push", "origin", branch]);
    log.info(`Auto-committed and pushed for ${agentId}`);
  } catch (err) {
    log.warn(`Auto-commit failed for ${agentId}: ${err}`);
  }
}

function guessMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
  };
  return map[ext || ""] || "image/png";
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`git ${args[0]} failed (code ${code})`));
      else resolve(stdout);
    });
    proc.on("error", reject);
  });
}
