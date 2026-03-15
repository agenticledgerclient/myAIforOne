import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import type { McpServerConfig, McpServerHttp } from "./config.js";
import type { InboundMessage } from "./channels/types.js";
import type { ResolvedRoute } from "./router.js";
import { formatMessage } from "./utils/message-formatter.js";
import { log } from "./logger.js";

// ─── Types ───────────────────────────────────────────────────────────

interface ContentBlock {
  type: "text" | "image";
  text?: string;
  source?: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

interface SessionState {
  sessionId: string;
  createdAt: string;
  messageCount: number;
}

interface ClaudeJsonResult {
  type: string;
  result: string;
  session_id: string;
  total_cost_usd: number;
  duration_ms: number;
}

// ─── Intercepted commands ────────────────────────────────────────────

const RESET_PATTERN = /^\s*\/opreset\b/i;
const COMPACT_PATTERN = /^\s*\/opcompact\b/i;

/**
 * Check if the message is an intercepted command.
 * Returns a response string if handled, or null to continue normal execution.
 */
function handleInterceptedCommand(
  text: string,
  agentId: string,
  memoryDir: string,
  senderId?: string,
): string | null {
  const sessionPath = join(memoryDir, sessionFileName(senderId));

  // ── /opreset ──
  if (RESET_PATTERN.test(text)) {
    if (existsSync(sessionPath)) {
      try {
        const state = JSON.parse(readFileSync(sessionPath, "utf-8")) as SessionState;
        unlinkSync(sessionPath);
        log.info(`Session reset for ${agentId} (was ${state.sessionId}, ${state.messageCount} messages)`);
        return `Session reset. Had ${state.messageCount} messages. Next message starts a fresh conversation.\n\nTip: Use /opcompact before /opreset to save important context.`;
      } catch {
        unlinkSync(sessionPath);
        return `Session reset. Next message starts fresh.`;
      }
    }
    return `No active session to reset. Next message will start a new one.`;
  }

  return null;
}

// ─── Skill index builder ─────────────────────────────────────────────

function buildSkillIndex(skillNames: string[]): string {
  const skillsDir = join(process.env.HOME || process.env.USERPROFILE || "", ".claude", "commands");
  const lines: string[] = [
    "\n## Available Skills",
    "You have skills available as markdown files. When a task matches a skill, use the Read tool to read it from the path shown, then follow its instructions.\n",
    "| Skill | Description | Path |",
    "|-------|-------------|------|",
  ];

  for (const name of skillNames) {
    const filePath = join(skillsDir, `${name}.md`);
    if (!existsSync(filePath)) {
      log.warn(`Skill file not found: ${filePath}`);
      continue;
    }
    try {
      const content = readFileSync(filePath, "utf-8");
      // Extract description from frontmatter
      const descMatch = content.match(/description:\s*(.+)/);
      const desc = descMatch ? descMatch[1].trim() : "No description";
      lines.push(`| ${name} | ${desc} | \`${filePath}\` |`);
    } catch {
      lines.push(`| ${name} | (could not read) | \`${filePath}\` |`);
    }
  }

  lines.push("");
  lines.push("To use a skill: Read the file at the path shown, then follow its checklist and instructions.");
  return lines.join("\n");
}

// ─── MCP config builder ─────────────────────────────────────────────

function buildMcpConfigFile(
  agentId: string,
  mcpNames: string[],
  mcpRegistry: Record<string, McpServerConfig>,
  baseDir: string,
): string {
  const mcpServers: Record<string, any> = {};

  for (const name of mcpNames) {
    const def = mcpRegistry[name];
    if (def.type === "stdio") {
      const args = (def.args || []).map((a) =>
        a.startsWith("~") ? a.replace("~", process.env.HOME || process.env.USERPROFILE || "") : a,
      );
      mcpServers[name] = {
        command: def.command,
        args,
        env: def.env || {},
      };
    } else {
      const httpDef = def as McpServerHttp;
      mcpServers[name] = {
        type: def.type,
        url: httpDef.url,
        headers: httpDef.headers || {},
      };
    }
  }

  const tmpDir = resolve(baseDir, "tmp", "mcp-configs");
  mkdirSync(tmpDir, { recursive: true });

  const filePath = join(tmpDir, `${agentId}-${Date.now()}.json`);
  writeFileSync(filePath, JSON.stringify({ mcpServers }, null, 2));

  return filePath;
}

// ─── Session management ──────────────────────────────────────────────

function sessionFileName(senderId?: string): string {
  // Feature 3: Per-sender sessions use sender-specific files
  return senderId ? `session-${senderId}.json` : "session.json";
}

function loadSession(memoryDir: string, senderId?: string): SessionState | null {
  const sessionPath = join(memoryDir, sessionFileName(senderId));
  if (!existsSync(sessionPath)) return null;
  try {
    return JSON.parse(readFileSync(sessionPath, "utf-8")) as SessionState;
  } catch {
    return null;
  }
}

function saveSession(memoryDir: string, state: SessionState, senderId?: string): void {
  const sessionPath = join(memoryDir, sessionFileName(senderId));
  writeFileSync(sessionPath, JSON.stringify(state, null, 2));
}

// ─── Main executor ──────────────────────────────────────────────────

export async function executeAgent(
  route: ResolvedRoute,
  msg: InboundMessage,
  baseDir: string,
  mcpRegistry?: Record<string, McpServerConfig>,
): Promise<string> {
  const { agentId, agentConfig } = route;
  const workspace = resolve(agentConfig.workspace);
  const claudeMdPath = resolve(baseDir, agentConfig.claudeMd);
  const memoryDir = resolve(baseDir, agentConfig.memoryDir);
  const contextPath = join(memoryDir, "context.md");
  const logPath = join(memoryDir, "conversation_log.jsonl");
  const isPersistent = agentConfig.persistent ?? false;
  const perSender = agentConfig.perSenderSessions ?? false;
  const senderSessionKey = (isPersistent && perSender) ? msg.sender : undefined;

  // ── Check for intercepted commands ──
  const intercepted = handleInterceptedCommand(msg.text, agentId, memoryDir, senderSessionKey);
  if (intercepted !== null) {
    // Still log the command
    try {
      const entry = {
        ts: new Date().toISOString(),
        from: msg.sender,
        text: msg.text,
        response: intercepted,
        agentId,
        channel: msg.channel,
      };
      appendFileSync(logPath, JSON.stringify(entry) + "\n");
    } catch { /* ignore */ }
    return intercepted;
  }

  // ── Load system prompt ──
  let systemPrompt: string;
  try {
    systemPrompt = readFileSync(claudeMdPath, "utf-8");
  } catch (err) {
    log.error(`Failed to read CLAUDE.md for ${agentId}: ${err}`);
    return `Error: Could not load agent configuration for ${agentId}.`;
  }

  // ── Append memory context to system prompt for persistent sessions ──
  // (In persistent mode, context.md is injected into the system prompt
  // so the agent has standing context even after a session reset)
  if (isPersistent && existsSync(contextPath)) {
    try {
      const context = readFileSync(contextPath, "utf-8").trim();
      if (context) {
        systemPrompt += `\n\n## Agent Memory\n${context}\n`;
      }
    } catch { /* ignore */ }
  }

  // ── Append skill index if configured ──
  if (agentConfig.skills && agentConfig.skills.length > 0) {
    systemPrompt += buildSkillIndex(agentConfig.skills);
  }

  // ── Append compact/reset instructions for persistent agents ──
  if (isPersistent) {
    systemPrompt += `\n\n## Session Commands
- When the user sends \`/opcompact\` followed by instructions, save the specified information to \`${contextPath}\` using the Write tool. This context survives session resets. Preserve any existing content that is still relevant — append or merge, don't overwrite blindly.
- \`/opreset\` is handled automatically by the gateway (you won't see it).
`;
  }

  // ── Format message ──
  // For persistent sessions: skip conversation history injection (Claude manages its own)
  // Still inject memory context for non-persistent sessions
  let formattedMessage: string;
  if (isPersistent) {
    // Persistent: just the message itself, no history (Claude has session history)
    formattedMessage = formatMessage(msg);
  } else {
    // Non-persistent: inject context + history as before
    formattedMessage = formatMessage(
      msg,
      existsSync(contextPath) ? contextPath : undefined,
      existsSync(logPath) ? logPath : undefined,
    );
  }

  // ── Build stdin payload ──
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

  // ── Build claude -p args ──
  const args: string[] = ["-p", "-"];

  // Session management for persistent agents
  let session: SessionState | null = null;
  if (isPersistent) {
    session = loadSession(memoryDir, senderSessionKey);
    if (session) {
      // Resume existing session
      args.push("--resume", session.sessionId);
      log.info(`Resuming session ${session.sessionId} for ${agentId} (msg #${session.messageCount + 1})`);
    } else {
      // First message: create new session
      const newId = randomUUID();
      session = { sessionId: newId, createdAt: new Date().toISOString(), messageCount: 0 };
      args.push("--session-id", newId);
      args.push("--system-prompt", systemPrompt);
      log.info(`Starting new session ${newId} for ${agentId}`);
    }

    // Use JSON output to get structured metadata
    args.push("--output-format", "json");
  } else {
    // Non-persistent: always pass system prompt, text output
    args.push("--system-prompt", systemPrompt);
    args.push("--output-format", "text");
  }

  // Workspace
  args.push("--add-dir", workspace);

  // Skills directory (so agent can Read skill files)
  if (agentConfig.skills && agentConfig.skills.length > 0) {
    const skillsDir = join(process.env.HOME || process.env.USERPROFILE || "", ".claude", "commands");
    if (existsSync(skillsDir)) {
      args.push("--add-dir", skillsDir);
    }
  }

  // Allowed tools — include MCP tool patterns
  const allowedTools = [...agentConfig.allowedTools];
  if (agentConfig.mcps && agentConfig.mcps.length > 0) {
    for (const mcpName of agentConfig.mcps) {
      allowedTools.push(`mcp__${mcpName}__*`);
    }
  }
  if (allowedTools.length > 0) {
    args.push("--allowedTools", allowedTools.join(","));
  }

  // MCP servers
  let mcpConfigPath: string | null = null;
  if (agentConfig.mcps && agentConfig.mcps.length > 0 && mcpRegistry) {
    mcpConfigPath = buildMcpConfigFile(agentId, agentConfig.mcps, mcpRegistry, baseDir);
    args.push("--mcp-config", mcpConfigPath, "--strict-mcp-config");
    log.debug(`MCP config for ${agentId}: ${mcpConfigPath} (servers: ${agentConfig.mcps.join(", ")})`);
  }

  // Permission mode for persistent agents (skip permission prompts)
  if (isPersistent) {
    args.push("--permission-mode", "acceptEdits");
  }

  // ── Spawn claude ──
  const timeout = agentConfig.timeout ?? 120_000;
  let rawOutput: string;

  try {
    rawOutput = await spawnClaude(args, workspace, timeout, stdinPayload);
  } catch (err) {
    log.error(`Agent ${agentId} execution failed: ${err}`);
    return `Sorry, I ran into an error processing that request.`;
  } finally {
    if (mcpConfigPath) {
      try { unlinkSync(mcpConfigPath); } catch { /* ignore */ }
    }
  }

  // ── Parse response ──
  let response: string;
  if (isPersistent) {
    // Parse JSON output
    try {
      const result = JSON.parse(rawOutput) as ClaudeJsonResult;
      response = result.result;
      log.debug(`Session ${result.session_id}: cost=$${result.total_cost_usd.toFixed(4)}, duration=${result.duration_ms}ms`);

      // Update session state
      if (session) {
        session.messageCount += 1;
        saveSession(memoryDir, session, senderSessionKey);
      }
    } catch (err) {
      // Fallback: treat as plain text if JSON parse fails
      log.warn(`Failed to parse JSON output for ${agentId}, using raw: ${err}`);
      response = rawOutput.trim();
      if (session) {
        session.messageCount += 1;
        saveSession(memoryDir, session, senderSessionKey);
      }
    }
  } else {
    response = rawOutput.trim();
  }

  // Auto-commit if enabled
  if (agentConfig.autoCommit) {
    await autoCommit(workspace, agentId, response, agentConfig.autoCommitBranch);
  }

  // Log to conversation history (audit trail)
  try {
    const entry = {
      ts: new Date().toISOString(),
      from: msg.sender,
      text: msg.text,
      response: response.slice(0, 2000),
      agentId,
      channel: msg.channel,
      ...(session ? { sessionId: session.sessionId, messageNum: session.messageCount } : {}),
    };
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch (err) {
    log.warn(`Failed to write conversation log: ${err}`);
  }

  return response;
}

// ─── Claude process spawner ──────────────────────────────────────────

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

// ─── Streaming executor ──────────────────────────────────────────────

export interface StreamEvent {
  type: "status" | "text" | "done" | "error";
  data: string;
}

/**
 * Execute agent with streaming — yields events as Claude processes.
 * Used by Web UI (SSE) and phone channels (status messages).
 */
export async function* executeAgentStreaming(
  route: ResolvedRoute,
  msg: InboundMessage,
  baseDir: string,
  mcpRegistry?: Record<string, McpServerConfig>,
): AsyncGenerator<StreamEvent> {
  const { agentId, agentConfig } = route;
  const workspace = resolve(agentConfig.workspace);
  const claudeMdPath = resolve(baseDir, agentConfig.claudeMd);
  const memoryDir = resolve(baseDir, agentConfig.memoryDir);
  const contextPath = join(memoryDir, "context.md");
  const logPath = join(memoryDir, "conversation_log.jsonl");
  const isPersistent = agentConfig.persistent ?? false;
  const perSender = agentConfig.perSenderSessions ?? false;
  const senderSessionKey = (isPersistent && perSender) ? msg.sender : undefined;

  // Check intercepted commands
  const intercepted = handleInterceptedCommand(msg.text, agentId, memoryDir, senderSessionKey);
  if (intercepted !== null) {
    try {
      appendFileSync(logPath, JSON.stringify({
        ts: new Date().toISOString(), from: msg.sender, text: msg.text,
        response: intercepted, agentId, channel: msg.channel,
      }) + "\n");
    } catch { /* ignore */ }
    yield { type: "text", data: intercepted };
    yield { type: "done", data: intercepted };
    return;
  }

  // Load system prompt (same logic as executeAgent)
  let systemPrompt: string;
  try {
    systemPrompt = readFileSync(claudeMdPath, "utf-8");
  } catch (err) {
    yield { type: "error", data: `Could not load agent configuration for ${agentId}.` };
    return;
  }

  if (isPersistent && existsSync(contextPath)) {
    try {
      const context = readFileSync(contextPath, "utf-8").trim();
      if (context) systemPrompt += `\n\n## Agent Memory\n${context}\n`;
    } catch { /* ignore */ }
  }

  if (agentConfig.skills && agentConfig.skills.length > 0) {
    systemPrompt += buildSkillIndex(agentConfig.skills);
  }

  if (isPersistent) {
    systemPrompt += `\n\n## Session Commands\n- When the user sends \`/opcompact\` followed by instructions, save the specified information to \`${contextPath}\` using the Write tool.\n- \`/opreset\` is handled automatically by the gateway.\n`;
  }

  let formattedMessage: string;
  if (isPersistent) {
    formattedMessage = formatMessage(msg);
  } else {
    formattedMessage = formatMessage(
      msg,
      existsSync(contextPath) ? contextPath : undefined,
      existsSync(logPath) ? logPath : undefined,
    );
  }

  const hasImages = msg.attachments && msg.attachments.length > 0;
  let stdinPayload: string;
  if (hasImages) {
    const contentBlocks: ContentBlock[] = [{ type: "text", text: formattedMessage }];
    for (const att of msg.attachments!) {
      try {
        const imgBuffer = readFileSync(att.path);
        const mimeType = att.mimeType || guessMimeType(att.path);
        if (imgBuffer.length > 10_000_000) continue;
        contentBlocks.push({ type: "image", source: { type: "base64", media_type: mimeType, data: imgBuffer.toString("base64") } });
      } catch { /* skip */ }
    }
    stdinPayload = JSON.stringify([{ role: "user", content: contentBlocks }]);
  } else {
    stdinPayload = formattedMessage;
  }

  // Build args with stream-json output
  const args: string[] = ["-p", "-"];

  let session: SessionState | null = null;
  if (isPersistent) {
    session = loadSession(memoryDir, senderSessionKey);
    if (session) {
      args.push("--resume", session.sessionId);
    } else {
      const newId = randomUUID();
      session = { sessionId: newId, createdAt: new Date().toISOString(), messageCount: 0 };
      args.push("--session-id", newId);
      args.push("--system-prompt", systemPrompt);
    }
  } else {
    args.push("--system-prompt", systemPrompt);
  }

  // Key difference: stream-json output (requires --verbose)
  args.push("--output-format", "stream-json", "--verbose");
  args.push("--add-dir", workspace);

  if (agentConfig.skills && agentConfig.skills.length > 0) {
    const skillsDir = join(process.env.HOME || process.env.USERPROFILE || "", ".claude", "commands");
    if (existsSync(skillsDir)) args.push("--add-dir", skillsDir);
  }

  const allowedTools = [...agentConfig.allowedTools];
  if (agentConfig.mcps && agentConfig.mcps.length > 0) {
    for (const mcpName of agentConfig.mcps) allowedTools.push(`mcp__${mcpName}__*`);
  }
  if (allowedTools.length > 0) args.push("--allowedTools", allowedTools.join(","));

  let mcpConfigPath: string | null = null;
  if (agentConfig.mcps && agentConfig.mcps.length > 0 && mcpRegistry) {
    mcpConfigPath = buildMcpConfigFile(agentId, agentConfig.mcps, mcpRegistry, baseDir);
    args.push("--mcp-config", mcpConfigPath, "--strict-mcp-config");
  }

  if (isPersistent) args.push("--permission-mode", "acceptEdits");

  const timeout = agentConfig.timeout ?? 120_000;

  // Spawn claude and stream output
  yield { type: "status", data: "Starting..." };

  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const proc = spawn("claude", args, { cwd: workspace, stdio: ["pipe", "pipe", "pipe"], env });

  if (stdinPayload && proc.stdin) {
    proc.stdin.write(stdinPayload);
    proc.stdin.end();
  }

  const timer = setTimeout(() => {
    proc.kill("SIGTERM");
  }, timeout);

  let fullResponse = "";
  let buffer = "";

  // Process stream-json output line by line
  const processLine = function*(line: string): Generator<StreamEvent> {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);

      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) {
            fullResponse += block.text;
            yield { type: "text", data: block.text } as StreamEvent;
          }
        }
      } else if (event.type === "tool_use") {
        const toolName = event.tool_name || event.name || "tool";
        yield { type: "status", data: `Using ${toolName}...` } as StreamEvent;
      } else if (event.type === "tool_result") {
        yield { type: "status", data: "Processing result..." } as StreamEvent;
      } else if (event.type === "result") {
        // Final result event
        if (event.result && !fullResponse) {
          fullResponse = event.result;
          yield { type: "text", data: event.result } as StreamEvent;
        }
        if (event.session_id && session) {
          session.messageCount += 1;
          saveSession(memoryDir, session, senderSessionKey);
        }
      }
    } catch {
      // Not JSON — might be partial line, ignore
    }
  };

  // Create a promise that resolves when the process closes
  const exitPromise = new Promise<number | null>((resolveExit) => {
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
    proc.on("error", () => {
      clearTimeout(timer);
      resolveExit(1);
    });
  });

  // Collect stdout chunks and yield events
  const chunks: string[] = [];
  proc.stdout.on("data", (data: Buffer) => {
    chunks.push(data.toString());
  });

  // Wait for process to complete
  const code = await exitPromise;

  // Clean up MCP config
  if (mcpConfigPath) {
    try { unlinkSync(mcpConfigPath); } catch { /* ignore */ }
  }

  if (code !== 0) {
    yield { type: "error", data: "Agent execution failed." };
    return;
  }

  // Process all output
  const allOutput = chunks.join("");
  const lines = allOutput.split("\n");
  for (const line of lines) {
    yield* processLine(line);
  }

  // If we got no text from streaming, try to parse as single JSON result
  if (!fullResponse) {
    try {
      const result = JSON.parse(allOutput) as ClaudeJsonResult;
      fullResponse = result.result;
      yield { type: "text", data: fullResponse };
      if (session) {
        session.messageCount += 1;
        saveSession(memoryDir, session, senderSessionKey);
      }
    } catch {
      fullResponse = allOutput.trim();
      if (fullResponse) yield { type: "text", data: fullResponse };
    }
  }

  // Auto-commit
  if (agentConfig.autoCommit) {
    await autoCommit(workspace, agentId, fullResponse, agentConfig.autoCommitBranch);
  }

  // Log
  try {
    appendFileSync(logPath, JSON.stringify({
      ts: new Date().toISOString(), from: msg.sender, text: msg.text,
      response: fullResponse.slice(0, 2000), agentId, channel: msg.channel,
      ...(session ? { sessionId: session.sessionId, messageNum: session.messageCount } : {}),
    }) + "\n");
  } catch { /* ignore */ }

  yield { type: "done", data: fullResponse };
}

// ─── Auto-commit ─────────────────────────────────────────────────────

async function autoCommit(
  workspace: string,
  agentId: string,
  response: string,
  branch: string,
): Promise<void> {
  try {
    const status = await runGit(workspace, ["status", "--porcelain"]);
    if (!status.trim()) return;

    const summary = response.split("\n")[0].slice(0, 72);
    await runGit(workspace, ["add", "-A"]);
    await runGit(workspace, ["commit", "-m", `Agent(${agentId}): ${summary}`]);
    await runGit(workspace, ["push", "origin", branch]);
    log.info(`Auto-committed and pushed for ${agentId}`);
  } catch (err) {
    log.warn(`Auto-commit failed for ${agentId}: ${err}`);
  }
}

// ─── Utilities ───────────────────────────────────────────────────────

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
