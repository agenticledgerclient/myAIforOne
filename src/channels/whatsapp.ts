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
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
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

  /**
   * Per-group gallery upload config.
   * New format:  photoGroups: { "jid@g.us": { uploadUrl, secret } }
   * Legacy compat: photoGroups: string[]  +  photoUploadUrl  +  photoUploadSecret
   */
  private photoGroups: Map<string, { uploadUrl: string; secret: string }> = new Map();

  constructor(config: Record<string, unknown>) {
    const baseAuthDir = (config.authDir as string) ?? "./data/whatsapp-auth";
    this.authDir = resolve(baseAuthDir);
    mkdirSync(this.authDir, { recursive: true });

    // Build per-group gallery upload map
    const rawGroups = config.photoGroups;
    if (rawGroups && typeof rawGroups === "object" && !Array.isArray(rawGroups)) {
      // New map format: { "jid": { uploadUrl, secret } }
      for (const [jid, cfg] of Object.entries(rawGroups as Record<string, any>)) {
        if (cfg?.uploadUrl && cfg?.secret) {
          this.photoGroups.set(jid, { uploadUrl: cfg.uploadUrl, secret: cfg.secret });
        }
      }
    } else if (Array.isArray(rawGroups)) {
      // Legacy array format — pair with top-level photoUploadUrl + photoUploadSecret
      const url = (config.photoUploadUrl as string) ?? null;
      const secret = (config.photoUploadSecret as string) ?? null;
      if (url && secret) {
        for (const jid of rawGroups as string[]) {
          this.photoGroups.set(jid, { uploadUrl: url, secret });
        }
      }
    }
  }

  async start(): Promise<void> {
    this.stopping = false;
    await this.connect();
  }

  /** Hot-reload photoGroups from updated config (called by API endpoints) */
  updatePhotoGroups(groups: Record<string, { uploadUrl: string; secret: string }>): void {
    this.photoGroups.clear();
    for (const [jid, cfg] of Object.entries(groups)) {
      if (cfg?.uploadUrl && cfg?.secret) {
        this.photoGroups.set(jid, { uploadUrl: cfg.uploadUrl, secret: cfg.secret });
      }
    }
    log.info(`[whatsapp] photoGroups reloaded: ${this.photoGroups.size} group(s)`);
  }

  /** Return current photoGroups for API reads */
  getPhotoGroups(): Record<string, { uploadUrl: string; secret: string }> {
    const result: Record<string, { uploadUrl: string; secret: string }> = {};
    for (const [jid, cfg] of this.photoGroups) {
      result[jid] = cfg;
    }
    return result;
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

  private async handleMessagesUpsert(upsert: BaileysEventMap["messages.upsert"]): Promise<void> {
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

      const remoteJid = msg.key.remoteJid!;
      const imageMsg = msg.message?.imageMessage;
      const videoMsg = msg.message?.videoMessage;

      // Gallery sidecar: upload media to configured gallery for this group (fire-and-forget)
      if (imageMsg && this.photoGroups.has(remoteJid)) {
        this.uploadMediaToGallery(msg, "image", this.photoGroups.get(remoteJid)!).catch((err) => {
          log.warn(`[gallery] Photo upload failed for ${remoteJid}: ${err}`);
        });
      }
      if (videoMsg && this.photoGroups.has(remoteJid)) {
        this.uploadMediaToGallery(msg, "video", this.photoGroups.get(remoteJid)!).catch((err) => {
          log.warn(`[gallery] Video upload failed for ${remoteJid}: ${err}`);
        });
      }

      // Extract text from various message types
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        imageMsg?.caption ||
        msg.message?.videoMessage?.caption ||
        null;

      // Skip messages with no text AND no image
      if (!text?.trim() && !imageMsg) continue;

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

      // Download image to temp file so the executor can pass it to Claude as vision
      let tempImagePath: string | null = null;
      if (imageMsg && this.sock) {
        try {
          const buffer = await downloadMediaMessage(
            msg, "buffer", {},
            { logger: silentLogger as any, reuploadRequest: this.sock.updateMediaMessage }
          ) as Buffer;
          if (buffer && buffer.length > 0) {
            const mime = imageMsg.mimetype || "image/jpeg";
            const ext = mime.includes("png") ? ".png" : mime.includes("gif") ? ".gif" : mime.includes("webp") ? ".webp" : ".jpg";
            tempImagePath = join(tmpdir(), `wa_img_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
            writeFileSync(tempImagePath, buffer);
            log.debug(`[whatsapp] Image saved to temp: ${tempImagePath} (${buffer.length} bytes)`);
          }
        } catch (err) {
          log.warn(`[whatsapp] Failed to download image for agent: ${err}`);
        }
      }

      const inbound: InboundMessage = {
        id: msg.key.id || String(Date.now()),
        channel: this.channelId,
        chatId: remoteJid,
        chatType: isGroup ? "group" : "dm",
        sender,
        senderName: msg.pushName || undefined,
        text: text?.trim() || "",
        timestamp: (msg.messageTimestamp as number) * 1000,
        isFromMe: false,
        isGroup,
        groupName: undefined,
        replyTo,
        ...(tempImagePath ? { attachments: [{ path: tempImagePath, mimeType: imageMsg?.mimetype || "image/jpeg" }] } : {}),
        raw: msg,
      };

      if (this.messageHandler) {
        this.messageHandler(inbound)
          .catch((err) => { log.error(`WhatsApp message handler error: ${err}`); })
          .finally(() => {
            // Clean up temp image after agent is done
            if (tempImagePath) {
              try { unlinkSync(tempImagePath); } catch {}
            }
          });
      }
    }
  }

  private async uploadMediaToGallery(
    msg: BaileysEventMap["messages.upsert"]["messages"][0],
    mediaType: "image" | "video",
    galleryCfg: { uploadUrl: string; secret: string },
  ): Promise<void> {
    if (!this.sock) return;

    const mediaMsg = mediaType === "image"
      ? msg.message?.imageMessage
      : msg.message?.videoMessage;
    if (!mediaMsg) return;

    // Download media buffer from WhatsApp
    const buffer = await downloadMediaMessage(
      msg, "buffer", {},
      { logger: silentLogger as any, reuploadRequest: this.sock.updateMediaMessage }
    ) as Buffer;

    if (!buffer || buffer.length === 0) {
      log.warn(`[gallery] Downloaded ${mediaType} buffer is empty, skipping`);
      return;
    }

    // Build multipart form
    const mime = mediaMsg.mimetype || (mediaType === "video" ? "video/mp4" : "image/jpeg");
    let ext: string;
    if (mediaType === "video") {
      ext = mime.includes("mov") ? ".mov" : ".mp4";
    } else {
      ext = mime.includes("png") ? ".png" : mime.includes("gif") ? ".gif" : mime.includes("webp") ? ".webp" : ".jpg";
    }
    const filename = `${mediaType}_${Date.now()}${ext}`;

    const formData = new FormData();
    const ab = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(ab).set(buffer);
    formData.append("photo", new Blob([ab], { type: mime }), filename);
    formData.append("sender", msg.pushName || msg.key.participant || "Guest");
    if (mediaMsg.caption) formData.append("caption", mediaMsg.caption);

    const res = await fetch(galleryCfg.uploadUrl, {
      method: "POST",
      headers: { "x-upload-secret": galleryCfg.secret },
      body: formData,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gallery upload returned ${res.status}: ${body}`);
    }

    log.info(`[gallery] ${mediaType} forwarded: ${filename} from ${msg.pushName || "Guest"}`);
  }
}
