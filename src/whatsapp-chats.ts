import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const authDir = resolve(__dirname, "..", "data", "whatsapp-auth");
mkdirSync(authDir, { recursive: true });

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

async function discover(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
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

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    if (update.qr) {
      console.log("\nScan this QR code with WhatsApp:\n");
      qrcode.generate(update.qr, { small: true });
    }
    if (update.connection === "open") {
      console.log("\nConnected! Now send a message in the WhatsApp chat you want to use.");
      console.log("(Send from your phone — any message will do)\n");
    }
    if (update.connection === "close") {
      // Don't exit on close during reconnect
    }
  });

  sock.ev.on("messages.upsert", (upsert) => {
    for (const msg of upsert.messages) {
      if (msg.key.remoteJid === "status@broadcast") continue;
      if (!msg.key.remoteJid) continue;

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        "(media/no text)";

      const isGroup = msg.key.remoteJid.endsWith("@g.us");

      console.log("=== MESSAGE FOUND ===");
      console.log(`  JID:     ${msg.key.remoteJid}`);
      console.log(`  Type:    ${isGroup ? "GROUP" : "DM"}`);
      console.log(`  From:    ${msg.key.fromMe ? "you" : (msg.key.participant || msg.key.remoteJid)}`);
      console.log(`  Name:    ${msg.pushName || "(unknown)"}`);
      console.log(`  Text:    ${String(text).slice(0, 100)}`);
      console.log("=====================\n");
    }
  });
}

console.log("WhatsApp Chat Discovery");
console.log("If already linked, will connect automatically.");
console.log("If not linked, scan the QR code.\n");

discover().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
