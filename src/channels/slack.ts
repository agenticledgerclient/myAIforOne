import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebClient } from "@slack/web-api";
import { SocketModeClient } from "@slack/socket-mode";
import type { ChannelDriver, InboundMessage, OutboundMessage } from "./types.js";
import { log } from "../logger.js";

interface SlackFile {
  id: string;
  name: string;
  mimetype: string;
  url_private_download?: string;
  size: number;
}

interface SlackMessageEvent {
  type: "message";
  subtype?: string;
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
  channel_type: "channel" | "group" | "im" | "mpim";
  files?: SlackFile[];
}

export class SlackDriver implements ChannelDriver {
  readonly channelId = "slack";

  private web: WebClient;
  private socket: SocketModeClient;
  private botToken: string;
  private messageHandler: ((msg: InboundMessage) => Promise<void>) | null = null;
  private botUserId: string | null = null;

  constructor(config: Record<string, unknown>) {
    const botToken = config.botToken as string;
    const appToken = config.appToken as string;

    if (!botToken || !appToken) {
      throw new Error("Slack driver requires botToken and appToken in config");
    }

    this.botToken = botToken;
    this.web = new WebClient(botToken);
    this.socket = new SocketModeClient({
      appToken,
      clientPingTimeout: 30_000,
      serverPingTimeout: 30_000,
      pingPongLoggingEnabled: false,
    });
  }

  async start(): Promise<void> {
    // Get bot's own user ID so we can ignore our own messages
    const auth = await this.web.auth.test();
    this.botUserId = auth.user_id as string;
    log.info(`Slack bot authenticated as ${auth.user} (${this.botUserId})`);

    // Listen for message events
    this.socket.on("message", async ({ event, ack }) => {
      await ack();
      this.handleEvent(event as SlackMessageEvent);
    });

    // Handle connection events
    this.socket.on("connected", () => {
      log.info("Slack socket mode connected");
    });

    this.socket.on("disconnected", () => {
      log.warn("Slack socket mode disconnected");
    });

    await this.socket.start();
    log.info("Slack driver started — listening for messages");
  }

  async stop(): Promise<void> {
    await this.socket.disconnect();
    log.info("Slack driver stopped");
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async send(msg: OutboundMessage): Promise<void> {
    await this.web.chat.postMessage({
      channel: msg.chatId,
      text: msg.text,
      ...(msg.replyToId ? { thread_ts: msg.replyToId } : {}),
    });
  }

  private async handleEvent(event: SlackMessageEvent): Promise<void> {
    // Skip bot's own messages, subtypes (edits, joins, etc.), and empty messages
    if (event.user === this.botUserId) return;
    if (event.subtype) return;
    if (!event.text?.trim() && !event.files?.length) return;

    const isGroup = event.channel_type === "channel" || event.channel_type === "group";

    // Download image attachments from Slack
    const attachments = await this.downloadFiles(event.files);

    const inbound: InboundMessage = {
      id: event.ts,
      channel: this.channelId,
      chatId: event.channel,
      chatType: isGroup ? "group" : "dm",
      sender: event.user,
      text: event.text || "",
      timestamp: Math.floor(parseFloat(event.ts) * 1000),
      isFromMe: false,
      isGroup,
      replyTo: event.thread_ts
        ? { id: event.thread_ts, text: "" }
        : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      raw: event,
    };

    log.debug(`Slack received from ${event.user} in ${event.channel}: ${(event.text || "").slice(0, 100)}${attachments.length ? ` [${attachments.length} image(s)]` : ""}`);

    if (this.messageHandler) {
      this.messageHandler(inbound).catch((err) => {
        log.error(`Slack message handler error: ${err}`);
      });
    }
  }

  private async downloadFiles(files?: SlackFile[]): Promise<Array<{ path: string; mimeType?: string }>> {
    if (!files?.length) return [];

    const imageFiles = files.filter((f) =>
      f.mimetype?.startsWith("image/") && f.url_private_download && f.size < 10_000_000
    );
    if (imageFiles.length === 0) return [];

    const downloadDir = join(tmpdir(), "channelToAgent-slack-images");
    mkdirSync(downloadDir, { recursive: true });

    const results: Array<{ path: string; mimeType?: string }> = [];

    for (const file of imageFiles) {
      try {
        const resp = await fetch(file.url_private_download!, {
          headers: { Authorization: `Bearer ${this.botToken}` },
        });
        if (!resp.ok) {
          log.warn(`Failed to download Slack file ${file.name}: ${resp.status}`);
          continue;
        }
        const buffer = Buffer.from(await resp.arrayBuffer());
        const localPath = join(downloadDir, `${file.id}-${file.name}`);
        writeFileSync(localPath, buffer);
        results.push({ path: localPath, mimeType: file.mimetype });
        log.debug(`Downloaded Slack file: ${file.name} (${buffer.length} bytes)`);
      } catch (err) {
        log.warn(`Error downloading Slack file ${file.name}: ${err}`);
      }
    }

    return results;
  }
}
