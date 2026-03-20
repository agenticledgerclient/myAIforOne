import type { ChannelDriver, InboundMessage, OutboundMessage } from "./types.js";
import { splitText } from "./types.js";
import { ImsgRpcClient } from "../utils/imsg-rpc.js";
import { getRecentMessages, getLatestRowId } from "../utils/imsg-db-reader.js";
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
  private dbPollInterval: ReturnType<typeof setInterval> | null = null;
  private dbPollRowIds = new Map<number, number>(); // chatId -> lastRowId
  private monitoredChatIds: number[] = [];
  private recentlySent = new Map<string, number>(); // text -> timestamp (for echo filtering)

  constructor(config: Record<string, unknown>) {
    const cliPath = (config.cliPath as string) ?? "imsg";
    this.debounceMs = (config.debounceMs as number) ?? 2000;
    this.monitoredChatIds = ((config.monitoredChatIds as number[]) ?? []);
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

    // DB polling fallback — macOS 15+ stores text in attributedBody, not text column
    // imsg watch may miss these messages, so we poll the DB directly
    this.startDbPolling();

    log.info("iMessage driver started — watching for messages + DB polling");
  }

  async stop(): Promise<void> {
    if (this.dbPollInterval) {
      clearInterval(this.dbPollInterval);
      this.dbPollInterval = null;
    }
    for (const [, entry] of this.debounceMap) {
      clearTimeout(entry.timer);
    }
    this.debounceMap.clear();

    await this.client.stop();
    log.info("iMessage driver stopped");
  }

  private startDbPolling(): void {
    // Discover chat IDs to monitor from config routes
    // If monitoredChatIds not set, we'll pick them up dynamically
    // Initialize last-seen rowid for each chat
    for (const chatId of this.monitoredChatIds) {
      this.dbPollRowIds.set(chatId, getLatestRowId(chatId));
    }

    // Poll every 3 seconds
    this.dbPollInterval = setInterval(() => {
      this.pollDb();
    }, 3000);
  }

  private pollDb(): void {
    // Also discover chat IDs dynamically from recent messages if not configured
    if (this.monitoredChatIds.length === 0) return;

    for (const chatId of this.monitoredChatIds) {
      const lastRowId = this.dbPollRowIds.get(chatId) || 0;
      const messages = getRecentMessages(chatId, lastRowId);

      for (const msg of messages) {
        // Update last seen
        if (msg.rowid > (this.dbPollRowIds.get(chatId) || 0)) {
          this.dbPollRowIds.set(chatId, msg.rowid);
        }

        // Skip empty
        if (!msg.text.trim()) continue;

        // Skip bot's own messages — check against recently sent texts
        if (this.recentlySent.has(msg.text.trim())) {
          this.recentlySent.delete(msg.text.trim());
          log.debug(`iMessage DB poll: skipping echo "${msg.text.slice(0, 40)}..."`);
          continue;
        }

        // Build an InboundMessage and pass to handler
        const inbound: InboundMessage = {
          id: String(msg.rowid),
          channel: this.channelId,
          chatId: String(chatId),
          chatType: "group",
          sender: msg.sender || "unknown",
          text: msg.text,
          timestamp: new Date(msg.createdAt).getTime(),
          // Always false — user's phone shares Apple ID with this Mac,
          // so all messages appear as is_from_me in the DB.
          // Echo prevention is handled in index.ts via recentBotMessages.
          isFromMe: false,
          isGroup: true,
          raw: msg,
        };

        log.debug(`iMessage DB poll: ${msg.sender} in chat ${chatId}: ${msg.text.slice(0, 80)}`);

        if (this.messageHandler) {
          this.messageHandler(inbound).catch((err) => {
            log.error(`iMessage DB poll handler error: ${err}`);
          });
        }
      }
    }
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async send(msg: OutboundMessage): Promise<void> {
    // iMessage doesn't have a strict char limit but long messages are unwieldy on phones
    const chunks = splitText(msg.text, 3000);
    for (const chunk of chunks) {
      // Track what we send so DB poller can filter echoes
      this.recentlySent.set(chunk.trim(), Date.now());
      await this.client.request("send", {
        text: chunk,
        chat_id: Number(msg.chatId),
      }, 30_000);
    }
    // Prune old entries (>60s) to prevent memory leak
    const cutoff = Date.now() - 60_000;
    for (const [text, ts] of this.recentlySent) {
      if (ts < cutoff) this.recentlySent.delete(text);
    }
  }

  private handleRawMessage(raw: ImsgMessage): void {
    // Note: can't filter is_from_me here because the user's phone shares
    // the same Apple ID as this Mac, so all messages appear as is_from_me.
    // Echo prevention is handled in index.ts via recentBotMessages tracking.
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
      isFromMe: first.is_from_me,
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
