# Mobile Design Doc

**Status:** Draft
**Date:** 2026-05-04
**Owner:** @myagentdev

## Goal

Build a dedicated mobile experience focused on **one job**: pick an agent and chat with it.
Think Slack / WhatsApp / iMessage — not "responsive desktop dashboard."

99% of mobile time is spent in chat. Everything else lives behind a hamburger.

## Non-Goals

Explicitly **not** on mobile:
- File browser / agent files
- Canvas
- Reset session button
- Paperclip / file uploads
- Raw logs button
- Multi-pane layouts, sidebars, resizable widgets
- Boards, projects, org editor (responsive desktop is fine for those)

## Route

- New route: `/m` — mobile shell, replaces all of `/`, `/chat/:agentId` for mobile users
- Detection: client-side mobile UA detection on `/`, redirect to `/m`
- Escape hatch: `?desktop=1` query param to force desktop layout
- "View desktop site" link inside hamburger

## Layout

### Top bar (sticky, always visible)
```
[≡]  [Org ▾]  [Agent ▾]  [Account ▾]?           [🔔]
```
- **≡ Hamburger** — opens drawer for everything else (settings, sessions, files, logs, etc.)
- **Org picker** — dropdown, scopes the agent list below
- **Agent picker** — dropdown of agents in the selected org. Tapping switches active chat.
- **Account picker** — only shown when agent has multiple Claude accounts attached, otherwise hidden
- **🔔** — unread/notifications indicator (optional, phase 2)

### Chat surface (fills the rest)
- Full-bleed message list (vertical scroll)
- Bubbles: user right-aligned, agent left-aligned (Slack/WhatsApp style)
- Avatar/name only on agent side
- Auto-scroll to bottom on new message
- Pull-to-refresh = reload history
- Long-press a message = copy / replay TTS

### Composer (bottom, sticky above keyboard)
```
[🎤]  [  Type a message…           ]  [▶ Send]
                                       [🔊]
```
- **🎤 Mic** — push-to-talk or tap-to-toggle voice input. Uses existing TTS/STT pipeline.
- **Text input** — auto-grows up to ~4 lines
- **▶ Send** — sends message
- **🔊 Speaker** — toggle: when on, agent replies are auto-played via TTS

**Removed from composer:** paperclip, file upload, canvas trigger, reset session, raw logs

## Hamburger Drawer (`≡`)

The 1% surface. Slides in from left.
- Sessions list (switch session, new session)
- Agent settings (link out to desktop view)
- Files (if needed — link out)
- Logs (link out)
- Theme toggle
- View desktop site
- Sign out

Anything that exists on desktop but isn't in the top bar or composer goes here. We don't need to be exhaustive — most items are just deep links into the desktop UI for now.

## Voice (mic + speaker)

- **Mic (input):** uses existing voice pipeline. Tap to start, tap to stop. Transcription drops into the text input — user reviews and hits send. (Future: hold-to-talk + auto-send.)
- **Speaker (output):** when toggled on, every agent reply is read aloud using the agent's configured voice (`mcp__myaiforone-local__set_agent_voice`). Toggle persists per-device.

## Component Plan

```
frontend/src/mobile/
├── MobileShell.tsx        // route wrapper, top bar + drawer
├── TopBar.tsx             // org/agent/account pickers
├── ChatView.tsx           // message list
├── MessageBubble.tsx
├── Composer.tsx           // input + mic + speaker + send
├── HamburgerDrawer.tsx
└── hooks/
    ├── useMobileChat.ts   // wraps existing chat hooks, strips desktop-only state
    └── useVoice.ts        // mic + speaker
```

Reuses existing API client, WebSocket, auth, and theme system. Only the UI layer is new.

## Phases

**Phase 1 — MVP (what unblocks the user)**
- `/m` route + redirect
- Top bar: org + agent picker
- Chat view + composer with text + send
- Hamburger with "view desktop" link

**Phase 2 — Voice + accounts**
- Mic input
- Speaker output (TTS auto-play toggle)
- Claude account picker (when agent has multiple)

**Phase 3 — Polish**
- Notifications indicator
- Long-press message actions
- Pull-to-refresh
- PWA install prompt + manifest

## Open Questions

1. Should the agent picker be a dropdown or a horizontal swipeable strip (like Slack workspaces)?
2. Speaker toggle — per-agent or global per-device?
3. Mic — push-to-talk or tap-to-toggle? (Phase 1 = tap-to-toggle, simpler)
4. Where does the "new session" action live — top-right of chat, or in the hamburger?
