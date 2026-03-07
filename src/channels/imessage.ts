import type { ChannelDriver, InboundMessage, OutboundMessage } from "./types.js";
import { ImsgRpcClient } from "../utils/imsg-rpc.js";
import { log } from "../logger.js";

interface ImsgMessage {
  id: number;
  sender: string;
  text: string;
  chat_id: number;
  chat_guid: string;
  chat_name: string | null;
  is_group: boolean;
  is_from_me: boolean;
  participants: string[];
  created_at: string;
  reply_to_text: string | null;
  reply_to_sender: string | null;
  reply_to_id: number | null;
  attachments: Array<{ path: string; mime_type?: string }>;
}

interface DebounceEntry {
  messages: ImsgMessage[];
  timer: ReturnType<typeof setTimeout>;
}

export class IMessageDriver implements ChannelDriver {
  readonly channelId = "imessage";

  private client: ImsgRpcClient;
  private messageHandler: ((msg: InboundMessage) => Promise<void>) | null = null;
  private debounceMap = new Map<string, DebounceEntry>();
  private debounceMs: number;

  constructor(config: Record<string, unknown>) {
    const cliPath = (config.cliPath as string) ?? "imsg";
    this.debounceMs = (config.debounceMs as number) ?? 2000;
    this.client = new ImsgRpcClient(cliPath);
  }

  async start(): Promise<void> {
    await this.client.start();

    this.client.onNotification((notification) => {
      if (notification.method === "message") {
        const raw = (notification.params as { message: ImsgMessage }).message;
        this.handleRawMessage(raw);
      }
    });

    // Subscribe to message watch (attachments enabled for image support)
    await this.client.request("watch.subscribe", { attachments: true });
    log.info("iMessage driver started — watching for messages");
  }

  async stop(): Promise<void> {
    // Clear all debounce timers
    for (const [, entry] of this.debounceMap) {
      clearTimeout(entry.timer);
    }
    this.debounceMap.clear();

    await this.client.stop();
    log.info("iMessage driver stopped");
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async send(msg: OutboundMessage): Promise<void> {
    await this.client.request("send", {
      text: msg.text,
      chat_id: Number(msg.chatId),
    }, 30_000);
  }

  private handleRawMessage(raw: ImsgMessage): void {
    if (!raw.text?.trim() && !raw.attachments?.length) return;

    // Debounce: coalesce rapid messages from same sender in same chat
    const key = `${raw.chat_id}:${raw.sender}`;
    const existing = this.debounceMap.get(key);

    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push(raw);
      existing.timer = setTimeout(() => this.flushDebounce(key), this.debounceMs);
    } else {
      this.debounceMap.set(key, {
        messages: [raw],
        timer: setTimeout(() => this.flushDebounce(key), this.debounceMs),
      });
    }
  }

  private flushDebounce(key: string): void {
    const entry = this.debounceMap.get(key);
    if (!entry) return;
    this.debounceMap.delete(key);

    // Coalesce multiple messages into one
    const messages = entry.messages;
    const first = messages[0];
    const text = messages.map((m) => m.text).join("\n");

    const inbound: InboundMessage = {
      id: String(first.id),
      channel: this.channelId,
      chatId: String(first.chat_id),
      chatType: first.is_group ? "group" : "dm",
      sender: first.sender,
      text,
      timestamp: new Date(first.created_at).getTime(),
      isFromMe: false,
      isGroup: first.is_group,
      groupName: first.chat_name ?? undefined,
      participants: first.participants,
      replyTo: first.reply_to_id
        ? {
            id: String(first.reply_to_id),
            text: first.reply_to_text ?? "",
            sender: first.reply_to_sender ?? undefined,
          }
        : undefined,
      attachments: this.collectImageAttachments(messages),
      raw: messages.length === 1 ? first : messages,
    };

    if (this.messageHandler) {
      this.messageHandler(inbound).catch((err) => {
        log.error(`Message handler error: ${err}`);
      });
    }
  }

  private collectImageAttachments(messages: ImsgMessage[]): Array<{ path: string; mimeType?: string }> | undefined {
    const imageTypes = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/heic"];
    const attachments: Array<{ path: string; mimeType?: string }> = [];

    for (const msg of messages) {
      if (!msg.attachments?.length) continue;
      for (const a of msg.attachments) {
        if (a.mime_type && imageTypes.includes(a.mime_type)) {
          attachments.push({ path: a.path, mimeType: a.mime_type });
        }
      }
    }

    return attachments.length > 0 ? attachments : undefined;
  }
}
