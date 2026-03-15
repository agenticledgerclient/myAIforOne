import { writeFileSync, mkdirSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Bot } from "grammy";
import type { Context } from "grammy";
import type { Message, PhotoSize } from "grammy/types";
import type { ChannelDriver, InboundMessage, OutboundMessage } from "./types.js";
import { splitText } from "./types.js";
import { log } from "../logger.js";
import { InputFile } from "grammy";

export class TelegramDriver implements ChannelDriver {
  readonly channelId = "telegram";

  private bot: Bot;
  private botToken: string;
  private messageHandler: ((msg: InboundMessage) => Promise<void>) | null = null;
  private botId: number | null = null;

  constructor(config: Record<string, unknown>) {
    const botToken = config.botToken as string;
    if (!botToken) {
      throw new Error("Telegram driver requires botToken in config");
    }
    this.botToken = botToken;
    this.bot = new Bot(botToken);
  }

  async start(): Promise<void> {
    const me = await this.bot.api.getMe();
    this.botId = me.id;
    log.info(`Telegram bot authenticated as @${me.username} (${me.id})`);

    this.bot.on("message:text", (ctx) => this.handleMessage(ctx));
    this.bot.on("message:photo", (ctx) => this.handleMessage(ctx));
    this.bot.on("message:voice", (ctx) => this.handleVoiceMessage(ctx));
    this.bot.on("message:audio", (ctx) => this.handleVoiceMessage(ctx));

    this.bot.catch((err) => {
      log.error(`Telegram bot error: ${err.message}`);
    });

    this.bot.start({
      onStart: () => {
        log.info("Telegram driver started — listening for messages (long polling)");
      },
    });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
    log.info("Telegram driver stopped");
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async send(msg: OutboundMessage): Promise<void> {
    const chatId = parseInt(msg.chatId, 10);
    const chunks = splitText(msg.text, 4096);
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(chatId, chunk, {
        ...(msg.replyToId ? { reply_parameters: { message_id: parseInt(msg.replyToId, 10) } } : {}),
      });
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    try {
      await this.bot.api.sendChatAction(parseInt(chatId, 10), "typing");
    } catch { /* ignore */ }
  }

  async sendFile(chatId: string, filePath: string, caption?: string): Promise<void> {
    try {
      const numericId = parseInt(chatId, 10);
      const ext = filePath.split(".").pop()?.toLowerCase() || "";
      const imageExts = ["png", "jpg", "jpeg", "gif", "webp"];

      if (imageExts.includes(ext)) {
        await this.bot.api.sendPhoto(numericId, new InputFile(filePath), {
          caption: caption || undefined,
        });
      } else {
        await this.bot.api.sendDocument(numericId, new InputFile(filePath), {
          caption: caption || undefined,
        });
      }
    } catch (err) {
      log.warn(`Failed to send file to Telegram: ${err}`);
    }
  }

  private async handleMessage(ctx: Context): Promise<void> {
    const msg = ctx.message;
    if (!msg) return;
    if (msg.from?.id === this.botId) return;
    if (msg.from?.is_bot) return;

    const chatId = msg.chat.id.toString();
    const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
    const sender = msg.from?.id.toString() || "unknown";
    const senderName = buildSenderName(msg.from);
    const text = msg.text || msg.caption || "";

    const attachments = await this.downloadPhotos(msg);

    if (!text.trim() && attachments.length === 0) return;

    let replyTo: InboundMessage["replyTo"] | undefined;
    if (msg.reply_to_message) {
      replyTo = {
        id: msg.reply_to_message.message_id.toString(),
        text: msg.reply_to_message.text || msg.reply_to_message.caption || "",
        sender: msg.reply_to_message.from?.id.toString(),
      };
    }

    const inbound: InboundMessage = {
      id: msg.message_id.toString(),
      channel: this.channelId,
      chatId,
      chatType: isGroup ? "group" : "dm",
      sender,
      senderName,
      text,
      timestamp: msg.date * 1000,
      isFromMe: false,
      isGroup,
      groupName: isGroup ? (msg.chat as any).title : undefined,
      replyTo,
      attachments: attachments.length > 0 ? attachments : undefined,
      raw: msg,
    };

    log.debug(
      `Telegram received from ${senderName} (${sender}) in ${chatId}: ${text.slice(0, 100)}${attachments.length ? ` [${attachments.length} photo(s)]` : ""}`,
    );

    if (this.messageHandler) {
      this.messageHandler(inbound).catch((err) => {
        log.error(`Telegram message handler error: ${err}`);
      });
    }
  }

  // Feature 8: Voice note handling — download audio, transcribe if configured
  private async handleVoiceMessage(ctx: Context): Promise<void> {
    const msg = ctx.message;
    if (!msg) return;
    if (msg.from?.id === this.botId) return;
    if (msg.from?.is_bot) return;

    const voice = msg.voice || msg.audio;
    if (!voice) return;

    const chatId = msg.chat.id.toString();
    const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
    const sender = msg.from?.id.toString() || "unknown";
    const senderName = buildSenderName(msg.from);

    try {
      const file = await this.bot.api.getFile(voice.file_id);
      if (!file.file_path) return;

      const url = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
      const resp = await fetch(url);
      if (!resp.ok) return;

      const buffer = Buffer.from(await resp.arrayBuffer());
      const ext = file.file_path.split(".").pop() || "ogg";
      const downloadDir = join(tmpdir(), "channelToAgent-telegram-voice");
      mkdirSync(downloadDir, { recursive: true });
      const localPath = join(downloadDir, `${msg.message_id}.${ext}`);
      writeFileSync(localPath, buffer);

      // Transcribe via OpenAI Whisper API if key is available
      const transcription = await transcribeAudio(localPath);
      if (!transcription) {
        log.debug(`Voice message from ${senderName} — no transcription (no OPENAI_API_KEY)`);
        return;
      }

      log.debug(`Transcribed voice from ${senderName}: ${transcription.slice(0, 100)}`);

      const inbound: InboundMessage = {
        id: msg.message_id.toString(),
        channel: this.channelId,
        chatId,
        chatType: isGroup ? "group" : "dm",
        sender,
        senderName,
        text: `[Voice message transcription]: ${transcription}`,
        timestamp: msg.date * 1000,
        isFromMe: false,
        isGroup,
        groupName: isGroup ? (msg.chat as any).title : undefined,
        raw: msg,
      };

      if (this.messageHandler) {
        this.messageHandler(inbound).catch((err) => {
          log.error(`Telegram voice handler error: ${err}`);
        });
      }
    } catch (err) {
      log.warn(`Error handling voice message: ${err}`);
    }
  }

  private async downloadPhotos(msg: Message): Promise<Array<{ path: string; mimeType?: string }>> {
    if (!msg.photo?.length) return [];

    const downloadDir = join(tmpdir(), "channelToAgent-telegram-images");
    mkdirSync(downloadDir, { recursive: true });

    const results: Array<{ path: string; mimeType?: string }> = [];

    const largest = msg.photo.reduce((a: PhotoSize, b: PhotoSize) =>
      (a.file_size || 0) > (b.file_size || 0) ? a : b,
    );

    try {
      const file = await this.bot.api.getFile(largest.file_id);
      if (!file.file_path) {
        log.warn(`No file_path for Telegram photo ${largest.file_id}`);
        return results;
      }

      const url = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        log.warn(`Failed to download Telegram photo: ${resp.status}`);
        return results;
      }

      const buffer = Buffer.from(await resp.arrayBuffer());
      if (buffer.length > 10_000_000) {
        log.warn(`Skipping oversized Telegram photo (${buffer.length} bytes)`);
        return results;
      }

      const ext = file.file_path.split(".").pop() || "jpg";
      const localPath = join(downloadDir, `${msg.message_id}-${largest.file_id}.${ext}`);
      writeFileSync(localPath, buffer);
      results.push({ path: localPath, mimeType: `image/${ext === "jpg" ? "jpeg" : ext}` });
      log.debug(`Downloaded Telegram photo: ${localPath} (${buffer.length} bytes)`);
    } catch (err) {
      log.warn(`Error downloading Telegram photo: ${err}`);
    }

    return results;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function buildSenderName(from?: { first_name?: string; last_name?: string; username?: string }): string {
  if (!from) return "unknown";
  const parts = [from.first_name, from.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return from.username || "unknown";
}

// Feature 8: Voice transcription via OpenAI Whisper API
async function transcribeAudio(filePath: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const { readFileSync } = await import("node:fs");
    const { basename } = await import("node:path");
    const audioData = readFileSync(filePath);
    const fileName = basename(filePath);

    const formData = new FormData();
    formData.append("file", new Blob([audioData]), fileName);
    formData.append("model", "whisper-1");

    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!resp.ok) {
      log.warn(`Whisper API error: ${resp.status}`);
      return null;
    }

    const result = await resp.json() as { text: string };
    return result.text;
  } catch (err) {
    log.warn(`Transcription failed: ${err}`);
    return null;
  }
}
