export interface InboundMessage {
  id: string;
  channel: string;
  chatId: string;
  chatType: "dm" | "group";
  sender: string;
  senderName?: string;
  text: string;
  timestamp: number;
  isFromMe: boolean;
  isGroup: boolean;
  groupName?: string;
  participants?: string[];
  replyTo?: {
    id: string;
    text: string;
    sender?: string;
  };
  attachments?: Array<{
    path: string;
    mimeType?: string;
  }>;
  raw: unknown;
}

export interface OutboundMessage {
  text: string;
  chatId: string;
  replyToId?: string;
  attachments?: Array<{
    path: string;
    mimeType?: string;
  }>;
}

export interface ChannelDriver {
  readonly channelId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => Promise<void>): void;
  send(msg: OutboundMessage): Promise<void>;
}
