import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  downloadMediaMessage,
  type WASocket,
  type BaileysEventMap,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ChannelDriver, InboundMessage, OutboundMessage } from "./types.js";
import { log } from "../logger.js";

// Baileys is noisy — suppress its internal logger
const silentLogger = {
  level: "silent" as const,
  child: () => silentLogger,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

export class WhatsAppDriver implements ChannelDriver {
  readonly channelId = "whatsapp";

  private sock: WASocket | null = null;
  private messageHandler: ((msg: InboundMessage) => Promise<void>) | null = null;
  private authDir: string;
  private selfId: string | null = null;
  private retryCount = 0;
  private maxRetries = 5;
  private stopping = false;
  /** Track message IDs sent by this socket so we don't echo agent replies */
  private sentIds = new Set<string>();

  /** Photo gallery upload config (optional) */
  private photoUploadUrl: string | null = null;
  private photoUploadSecret: string | null = null;
  /** Group JIDs to capture photos from (e.g. "120363424846088477@g.us") */
  private photoGroups: Set<string> = new Set();

  constructor(config: Record<string, unknown>) {
    const baseAuthDir = (config.authDir as string) ?? "./data/whatsapp-auth";
    this.authDir = resolve(baseAuthDir);
    mkdirSync(this.authDir, { recursive: true });

    // Optional photo gallery upload config
    this.photoUploadUrl = (config.photoUploadUrl as string) ?? null;
    this.photoUploadSecret = (config.photoUploadSecret as string) ?? null;
    const groups = (config.photoGroups as string[]) ?? [];
    this.photoGroups = new Set(groups);
  }

  async start(): Promise<void> {
    this.stopping = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.sock) {
      this.sock.ev.removeAllListeners("messages.upsert");
      this.sock.ev.removeAllListeners("connection.update");
      this.sock.end(undefined);
      this.sock = null;
    }
    log.info("WhatsApp driver stopped");
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.sock) throw new Error("WhatsApp not connected");
    const sent = await this.sock.sendMessage(msg.chatId, { text: msg.text });
    if (sent?.key?.id) this.sentIds.add(sent.key.id);
  }

  private async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, silentLogger as any),
      },
      version,
      logger: silentLogger as any,
      printQRInTerminal: false,
      browser: ["channelToAgentToClaude", "Desktop", "1.0.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    // Save credentials on update
    this.sock.ev.on("creds.update", saveCreds);

    // Handle connection state changes
    this.sock.ev.on("connection.update", (update) => {
      this.handleConnectionUpdate(update, saveCreds);
    });

    // Handle incoming messages
    this.sock.ev.on("messages.upsert", (upsert) => {
      this.handleMessagesUpsert(upsert);
    });
  }

  private handleConnectionUpdate(
    update: Partial<BaileysEventMap["connection.update"]>,
    saveCreds: () => Promise<void>,
  ): void {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // Display QR code — this should only happen during initial login
      log.warn("WhatsApp QR code generated — run the login script first: npm run whatsapp-login");
      log.warn("QR code cannot be displayed from the background service");
    }

    if (connection === "open") {
      this.selfId = this.sock?.user?.id ?? null;
      this.retryCount = 0;
      log.info(`WhatsApp connected as ${this.sock?.user?.name ?? this.selfId}`);
    }

    if (connection === "close") {
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;

      if (reason === DisconnectReason.loggedOut) {
        log.error("WhatsApp logged out — credentials cleared. Run: npm run whatsapp-login");
        return;
      }

      if (reason === 515) {
        // Restart requested by WhatsApp
        log.info("WhatsApp requested restart, reconnecting...");
        this.reconnect();
        return;
      }

      if (!this.stopping && this.retryCount < this.maxRetries) {
        this.retryCount++;
        const delay = Math.min(5000 * Math.pow(2, this.retryCount - 1), 300_000);
        log.warn(`WhatsApp disconnected (reason: ${reason}), reconnecting in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`);
        setTimeout(() => this.reconnect(), delay);
      } else if (!this.stopping) {
        log.error(`WhatsApp disconnected after ${this.maxRetries} retries, giving up`);
      }
    }
  }

  private async reconnect(): Promise<void> {
    if (this.sock) {
      this.sock.ev.removeAllListeners("messages.upsert");
      this.sock.ev.removeAllListeners("connection.update");
      this.sock.ev.removeAllListeners("creds.update");
      this.sock.end(undefined);
      this.sock = null;
    }
    await this.connect();
  }

  private handleMessagesUpsert(upsert: BaileysEventMap["messages.upsert"]): void {
    if (upsert.type !== "notify") return;

    for (const msg of upsert.messages) {
      // Skip status broadcasts
      if (msg.key.remoteJid === "status@broadcast") continue;

      // Skip messages sent by this socket (agent replies) to avoid echo loops.
      // But do NOT skip all fromMe — the user's phone shares the same WhatsApp
      // account as this linked device, so user messages also appear as fromMe.
      const msgId = msg.key.id || "";
      if (this.sentIds.has(msgId)) {
        this.sentIds.delete(msgId);
        continue;
      }

      // Upload photo to gallery if this group is in photoGroups
      const remoteJidForPhoto = msg.key.remoteJid!;
      if (
        this.photoUploadUrl &&
        this.photoUploadSecret &&
        msg.message?.imageMessage &&
        this.photoGroups.has(remoteJidForPhoto)
      ) {
        this.uploadPhotoToGallery(msg).catch((err) => {
          log.warn(`[cruise-gallery] Photo upload failed: ${err}`);
        });
      }

      // Extract text from various message types
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        null;

      if (!text?.trim()) continue;

      const remoteJid = msg.key.remoteJid!;
      const isGroup = remoteJid.endsWith("@g.us");
      const sender = isGroup
        ? msg.key.participant || remoteJid
        : remoteJid;

      // Extract reply context
      const quotedMsg = msg.message?.extendedTextMessage?.contextInfo;
      const replyTo = quotedMsg?.quotedMessage
        ? {
            id: quotedMsg.stanzaId || "",
            text:
              quotedMsg.quotedMessage.conversation ||
              quotedMsg.quotedMessage.extendedTextMessage?.text ||
              "",
            sender: quotedMsg.participant || undefined,
          }
        : undefined;

      const inbound: InboundMessage = {
        id: msg.key.id || String(Date.now()),
        channel: this.channelId,
        chatId: remoteJid,
        chatType: isGroup ? "group" : "dm",
        sender,
        senderName: msg.pushName || undefined,
        text,
        timestamp: (msg.messageTimestamp as number) * 1000,
        isFromMe: false,
        isGroup,
        groupName: undefined,
        replyTo,
        raw: msg,
      };

      if (this.messageHandler) {
        this.messageHandler(inbound).catch((err) => {
          log.error(`WhatsApp message handler error: ${err}`);
        });
      }
    }
  }

  private async uploadPhotoToGallery(msg: BaileysEventMap["messages.upsert"]["messages"][0]): Promise<void> {
    if (!this.sock || !this.photoUploadUrl || !this.photoUploadSecret) return;

    const imageMsg = msg.message?.imageMessage;
    if (!imageMsg) return;

    // Download image buffer from WhatsApp
    const buffer = await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { logger: silentLogger as any, reuploadRequest: this.sock.updateMediaMessage }
    ) as Buffer;

    if (!buffer || buffer.length === 0) {
      log.warn("[cruise-gallery] Downloaded image buffer is empty, skipping");
      return;
    }

    // Build multipart form
    const mime = imageMsg.mimetype || "image/jpeg";
    const ext = mime.includes("png") ? ".png" : mime.includes("gif") ? ".gif" : mime.includes("webp") ? ".webp" : ".jpg";
    const filename = `photo_${Date.now()}${ext}`;

    const formData = new FormData();
    // Copy to a plain ArrayBuffer to satisfy strict BlobPart typing
    const ab = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(ab).set(buffer);
    formData.append("photo", new Blob([ab], { type: mime }), filename);
    formData.append("sender", msg.pushName || msg.key.participant || "Guest");
    if (imageMsg.caption) formData.append("caption", imageMsg.caption);

    const res = await fetch(this.photoUploadUrl, {
      method: "POST",
      headers: { "x-upload-secret": this.photoUploadSecret },
      body: formData,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gallery upload returned ${res.status}: ${body}`);
    }

    log.info(`[cruise-gallery] Photo uploaded: ${filename} from ${msg.pushName || "Guest"}`);
  }
}
