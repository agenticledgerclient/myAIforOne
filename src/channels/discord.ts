import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Client, GatewayIntentBits, AttachmentBuilder } from "discord.js";
import type { Message as DiscordMessage } from "discord.js";
import type { ChannelDriver, InboundMessage, OutboundMessage } from "./types.js";
import { splitText } from "./types.js";
import { log } from "../logger.js";

export class DiscordDriver implements ChannelDriver {
  readonly channelId = "discord";

  private client: Client;
  private botToken: string;
  private messageHandler: ((msg: InboundMessage) => Promise<void>) | null = null;
  private botUserId: string | null = null;

  constructor(config: Record<string, unknown>) {
    const botToken = config.botToken as string;
    if (!botToken) {
      throw new Error("Discord driver requires botToken in config");
    }
    this.botToken = botToken;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.once("ready", () => {
        this.botUserId = this.client.user?.id ?? null;
        log.info(`Discord bot authenticated as ${this.client.user?.tag} (${this.botUserId})`);
        resolve();
      });

      this.client.on("messageCreate", (msg) => this.handleMessage(msg));

      this.client.on("error", (err) => {
        log.error(`Discord error: ${err.message}`);
      });

      this.client.login(this.botToken).catch(reject);
      log.info("Discord driver started — listening for messages");
    });
  }

  async stop(): Promise<void> {
    await this.client.destroy();
    log.info("Discord driver stopped");
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async send(msg: OutboundMessage): Promise<void> {
    const channel = await this.client.channels.fetch(msg.chatId);
    if (!channel?.isTextBased()) return;

    const textChannel = channel as any;
    const chunks = splitText(msg.text, 2000); // Discord limit
    for (const chunk of chunks) {
      await textChannel.send(chunk);
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(chatId);
      if (channel?.isTextBased()) {
        await (channel as any).sendTyping();
      }
    } catch { /* ignore */ }
  }

  async sendFile(chatId: string, filePath: string, caption?: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(chatId);
      if (!channel?.isTextBased()) return;

      const attachment = new AttachmentBuilder(filePath);
      await (channel as any).send({
        content: caption || undefined,
        files: [attachment],
      });
    } catch (err) {
      log.warn(`Failed to send file to Discord: ${err}`);
    }
  }

  private async handleMessage(msg: DiscordMessage): Promise<void> {
    if (msg.author.id === this.botUserId) return;
    if (msg.author.bot) return;
    if (!msg.content?.trim()) return;

    const isGroup = msg.guild !== null;

    const inbound: InboundMessage = {
      id: msg.id,
      channel: this.channelId,
      chatId: msg.channelId,
      chatType: isGroup ? "group" : "dm",
      sender: msg.author.id,
      senderName: msg.author.displayName || msg.author.username,
      text: msg.content,
      timestamp: msg.createdTimestamp,
      isFromMe: false,
      isGroup,
      groupName: msg.guild?.name,
      replyTo: msg.reference?.messageId
        ? { id: msg.reference.messageId, text: "" }
        : undefined,
      raw: msg,
    };

    log.debug(`Discord received from ${msg.author.username} in ${msg.channelId}: ${msg.content.slice(0, 100)}`);

    if (this.messageHandler) {
      this.messageHandler(inbound).catch((err) => {
        log.error(`Discord message handler error: ${err}`);
      });
    }
  }
}
