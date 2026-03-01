import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { log } from "../logger.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: unknown;
}

export class ImsgRpcClient {
  private proc: ChildProcess | null = null;
  private rl: Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private notificationHandler: ((notification: JsonRpcNotification) => void) | null = null;
  private cliPath: string;
  private stopping = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(cliPath = "imsg") {
    this.cliPath = cliPath;
  }

  async start(): Promise<void> {
    // Verify imsg exists
    try {
      const probe = spawn(this.cliPath, ["rpc", "--help"], { stdio: "pipe" });
      await new Promise<void>((resolve, reject) => {
        probe.on("close", () => resolve());
        probe.on("error", (err) => reject(err));
      });
    } catch {
      throw new Error(
        `"${this.cliPath}" not found. Install with: brew install steipete/tap/imsg`
      );
    }

    await this.startProcess();
    log.info("imsg RPC client started");
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      log.warn(`imsg: unparseable line: ${line.slice(0, 200)}`);
      return;
    }

    // Response to a request (has "id")
    if ("id" in parsed && typeof parsed.id === "number") {
      const req = this.pending.get(parsed.id);
      if (req) {
        clearTimeout(req.timer);
        this.pending.delete(parsed.id);

        if ("error" in parsed) {
          req.reject(new Error(JSON.stringify(parsed.error)));
        } else {
          req.resolve(parsed.result);
        }
      }
      return;
    }

    // Notification (has "method" but no "id")
    if ("method" in parsed && !("id" in parsed)) {
      this.notificationHandler?.(parsed as unknown as JsonRpcNotification);
      return;
    }

    log.debug(`imsg: unhandled message: ${line.slice(0, 200)}`);
  }

  async request<T>(method: string, params?: object, timeoutMs = 10_000): Promise<T> {
    if (!this.proc?.stdin?.writable) {
      throw new Error("imsg RPC client not started");
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`imsg RPC timeout: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      this.proc!.stdin!.write(payload + "\n");
    });
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandler = handler;
  }

  private async restart(): Promise<void> {
    try {
      this.rl?.close();
      this.proc = null;
      await this.startProcess();
      // Re-subscribe to watch
      await this.request("watch.subscribe", { attachments: false });
      log.info("imsg RPC client restarted successfully");
    } catch (err) {
      log.error(`imsg restart failed: ${err} — retrying in 10s`);
      this.restartTimer = setTimeout(() => this.restart(), 10_000);
    }
  }

  private async startProcess(): Promise<void> {
    this.proc = spawn(this.cliPath, ["rpc"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.on("error", (err) => {
      log.error(`imsg process error: ${err.message}`);
    });

    this.proc.on("close", (code) => {
      log.warn(`imsg process exited with code ${code}`);
      for (const [id, req] of this.pending) {
        clearTimeout(req.timer);
        req.reject(new Error("imsg process exited"));
        this.pending.delete(id);
      }
      if (!this.stopping) {
        log.info("imsg process died — restarting in 3s...");
        this.restartTimer = setTimeout(() => this.restart(), 3000);
      }
    });

    if (this.proc.stderr) {
      const stderrRl = createInterface({ input: this.proc.stderr });
      stderrRl.on("line", (line) => {
        if (line.trim()) log.warn(`imsg stderr: ${line}`);
      });
    }

    if (this.proc.stdout) {
      this.rl = createInterface({ input: this.proc.stdout });
      this.rl.on("line", (line) => this.handleLine(line));
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error("Client stopping"));
      this.pending.delete(id);
    }
    this.rl?.close();
    this.proc?.kill("SIGTERM");
    this.proc = null;
    log.info("imsg RPC client stopped");
  }
}
