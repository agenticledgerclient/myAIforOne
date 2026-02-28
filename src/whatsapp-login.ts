import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
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

async function login(): Promise<void> {
  console.log("WhatsApp Login — Scan the QR code with your phone");
  console.log("WhatsApp > Settings > Linked Devices > Link a Device\n");

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
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScan this QR code:\n");
      qrcode.generate(qr, { small: true });
      console.log("\nWaiting for scan...");
    }

    if (connection === "open") {
      console.log(`\nConnected as ${sock.user?.name ?? sock.user?.id}`);
      console.log(`Credentials saved to: ${authDir}`);
      console.log("\nYou can now start the service — WhatsApp is linked.");
      console.log("Press Ctrl+C to exit.\n");
      // Keep running briefly to ensure creds are fully saved
      setTimeout(() => process.exit(0), 3000);
    }

    if (connection === "close") {
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) {
        console.error("\nLogged out. Try again.");
        process.exit(1);
      }
      if (reason !== 515) {
        console.error(`\nDisconnected (reason: ${reason}). Try again.`);
        process.exit(1);
      }
    }
  });
}

login().catch((err) => {
  console.error("Login failed:", err);
  process.exit(1);
});
