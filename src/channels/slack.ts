import { WebClient } from "@slack/web-api";
import { SocketModeClient } from "@slack/socket-mode";
import type { ChannelDriver, InboundMessage, OutboundMessage } from "./types.js";
import { log } from "../logger.js";

interface SlackMessageEvent {
  type: "message";
  subtype?: string;
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
  channel_type: "channel" | "group" | "im" | "mpim";
}

export class SlackDriver implements ChannelDriver {
  readonly channelId = "slack";

  private web: WebClient;
  private socket: SocketModeClient;
  private messageHandler: ((msg: InboundMessage) => Promise<void>) | null = null;
  private botUserId: string | null = null;

  constructor(config: Record<string, unknown>) {
    const botToken = config.botToken as string;
    const appToken = config.appToken as string;

    if (!botToken || !appToken) {
      throw new Error("Slack driver requires botToken and appToken in config");
    }

    this.web = new WebClient(botToken);
    this.socket = new SocketModeClient({ appToken });
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

  private handleEvent(event: SlackMessageEvent): void {
    // Skip bot's own messages, subtypes (edits, joins, etc.), and empty messages
    if (event.user === this.botUserId) return;
    if (event.subtype) return;
    if (!event.text?.trim()) return;

    const isGroup = event.channel_type === "channel" || event.channel_type === "group";

    const inbound: InboundMessage = {
      id: event.ts,
      channel: this.channelId,
      chatId: event.channel,
      chatType: isGroup ? "group" : "dm",
      sender: event.user,
      text: event.text,
      timestamp: Math.floor(parseFloat(event.ts) * 1000),
      isFromMe: false,
      isGroup,
      replyTo: event.thread_ts
        ? { id: event.thread_ts, text: "" }
        : undefined,
      raw: event,
    };

    log.debug(`Slack received from ${event.user} in ${event.channel}: ${event.text.slice(0, 100)}`);

    if (this.messageHandler) {
      this.messageHandler(inbound).catch((err) => {
        log.error(`Slack message handler error: ${err}`);
      });
    }
  }
}
