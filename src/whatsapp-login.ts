import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import { mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const authDir = resolve(__dirname, "..", "data", "whatsapp-auth");

let qrCount = 0;

function connectSocket(): Promise<"restart" | "done"> {
  return new Promise(async (res) => {
    mkdirSync(authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    console.log(`Connecting... (Baileys ${version.join(".")})`);

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
        qrCount++;
        console.log(`\n--- QR Code #${qrCount} (scan quickly!) ---\n`);
        qrcode.generate(qr, { small: true });
        console.log("\nWaiting for scan...");
      }

      if (connection === "open") {
        console.log(`\n✓ Connected as ${sock.user?.name ?? sock.user?.id}`);
        console.log(`Credentials saved to: ${authDir}`);
        console.log("\nWhatsApp is linked! You can now restart the service.");
        setTimeout(() => res("done"), 3000);
      }

      if (connection === "close") {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        console.log(`Connection closed (reason: ${reason})`);

        if (reason === DisconnectReason.loggedOut) {
          console.log("Logged out — clearing creds and retrying...");
          rmSync(authDir, { recursive: true, force: true });
          res("restart");
        } else if (reason === DisconnectReason.restartRequired || reason === 515) {
          console.log("WhatsApp requested restart — reconnecting...\n");
          res("restart");
        } else {
          console.error(`Unexpected disconnect (${reason}). Retrying...\n`);
          res("restart");
        }
      }
    });
  });
}

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

  const maxAttempts = 5;
  for (let i = 0; i < maxAttempts; i++) {
    const result = await connectSocket();
    if (result === "done") {
      process.exit(0);
    }
    console.log(`Attempt ${i + 2} of ${maxAttempts}...`);
  }

  console.error("Max reconnection attempts reached. Please try again.");
  process.exit(1);
}

login().catch((err) => {
  console.error("Login failed:", err);
  process.exit(1);
});
