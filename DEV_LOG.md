# Development Log

## 2026-02-28 — Initial Build + iMessage + Slack Live

### What Was Built
- Full service: routes messages from phone channels → Claude Code agents via `claude -p`
- **iMessage driver** — fully working via `imsg` CLI (JSON-RPC over subprocess)
- **Slack driver** — fully working via Socket Mode (WebSocket, no public URL needed)
- **Router** — matches channel + chatId → agent, with `@producer` mention filtering (works in both DMs and groups)
- **Agent executor** — spawns `claude -p` with system prompt, memory context, conversation history. Pipes prompt via stdin to handle special characters (emoji, links).
- **"On it..." indicator** — immediate response so users know the agent is working
- **Auto-commit** — agent changes auto-committed and pushed to trigger Netlify deploy
- **launchd service** — auto-starts on login, restarts on crash
- **FIC Show Agent** — first agent, pointed at financeiscooked-soundboard repo
- **Conversation logging** — append-only JSONL log for memory continuity
- **Helper scripts** — chat discovery, test send, service install/uninstall

### Configuration
- iMessage: chat_id 67 (SMS group with cohost)
- Slack: channel C0AFJMHKZDG, bot `financeiscookedproduc`, Socket Mode
- `@producer` alias triggers the agent; all other messages silently ignored
- Unmatched messages suppressed from logs for privacy

### Issues Resolved
- `claude -p` flags: `--cwd` doesn't exist → use `cwd` on spawn + `--add-dir`; `--systemPrompt` → `--system-prompt`
- Nesting detection: `CLAUDECODE` env var must be unset when spawning `claude -p` from within Claude Code
- Null bytes in args: messages with emoji/links crash `spawn()` → switched to piping prompt via stdin
- `imsg` permissions: launchd runs as `node`, not Terminal → needed to add `/opt/homebrew/Cellar/node@22/22.22.0/bin/node` to Full Disk Access
- `is_from_me` filtering: removed for iMessage so the user can also trigger the agent (no infinite loop risk because `@producer` check prevents agent replies from re-triggering)

### Documents Created
- `EXECUTOR_OPTIONS.md` — analysis of `claude -p` vs SDK vs Direct API trade-offs

---

## 2026-02-28 — WhatsApp Driver (UNFINISHED)

### What Was Built
- `src/channels/whatsapp.ts` — WhatsApp driver using `@whiskeysockets/baileys` (same approach as OpenClaw)
- `src/whatsapp-login.ts` — QR code pairing script
- `src/whatsapp-chats.ts` — JID discovery script (connect + listen for messages to grab chat JID)
- WhatsApp enabled in config, route placeholder added
- Baileys + qrcode-terminal dependencies installed

### Current State: BLOCKED
- QR code pairing works — successfully linked as `14428998398:22@s.whatsapp.net`
- **Problem:** Baileys session keeps getting disconnected when running the discovery script after pairing. Suspected cause: session conflict between login script and discovery script creating separate socket connections. Only one Baileys connection per linked device is allowed at a time.
- Combined login + discovery into a single script (`whatsapp-chats.ts`) but still having connection issues.
- **The JID for the "FicProducer" WhatsApp group has not been discovered yet.** Once we get the JID, it just needs to be plugged into `config.json` and the driver should work.

### To Resume — Steps Needed
1. Make sure the launchd service is stopped: `launchctl unload ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist`
2. Clear stale creds if needed: `rm -rf data/whatsapp-auth/*`
3. Run the combined script: `npx tsx src/whatsapp-chats.ts`
4. Scan QR code if prompted
5. Once connected, send a message in the FicProducer WhatsApp group from the phone
6. The script should print the JID (looks like `120363XXXXXXXXXX@g.us`)
7. Update `config.json`: change `"value": "DISCOVER_FROM_LOGS"` to the actual JID
8. Rebuild: `npm run build`
9. Restart service: `launchctl load ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist`

### Architecture Notes
- Baileys speaks the WhatsApp Web multi-device protocol directly (not official API, not whatsapp-web.js)
- No Meta Business account needed, no webhook URL needed
- Phone doesn't need to stay online after initial QR pairing
- Account ban risk exists (unofficial client) but low for multi-device protocol
- WhatsApp driver listens to all messages at the protocol level (can't subscribe to specific chats) — router filters to only respond to configured JID
- `fromMe` messages are skipped in the WhatsApp driver (unlike iMessage where we allow them)

### Dependencies Added
- `@whiskeysockets/baileys` ^7.0.0-rc.9
- `qrcode-terminal` ^0.12.0
- `@types/qrcode-terminal` ^0.12.2 (dev)
