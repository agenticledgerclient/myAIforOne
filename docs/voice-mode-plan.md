# Voice Mode — Design & Implementation Plan

**Status:** Approved — Phase 1 in progress
**Author:** myagentdev (with @oreph)
**Date:** 2026-04-26
**Related:** Multi-Model Support (existing pattern we're mirroring)

---

## 1. Goal

Let users **talk to** and **listen to** their MyAgent agents — bidirectional voice conversations in the Web UI (and eventually all channels), with pluggable voice providers so we're not locked into one vendor.

**Two halves of voice:**
- **TTS (text-to-speech)** — agent's text reply read aloud (you listen)
- **STT (speech-to-text)** — your spoken input transcribed (you talk)

Both are required for a real "talk to your agent" experience. Phase 1 ships both.

---

## 2. Why Now / Why Grok

xAI launched standalone TTS + STT APIs in April 2026:
- **TTS:** $4.20 / 1M chars (~50× cheaper than ElevenLabs)
- **STT:** $0.10/hr batch, $0.20/hr streaming
- Built on the same infra that powers Grok Voice in the X app, Tesla, and Starlink support
- 5 voices (Ara, Eve, Leo, Rex, Sal) across 20+ languages, with expressive tags (`[laugh]`, `<whisper>`)

At realistic usage (100 agents × 20 replies/day) total monthly cost is ~$25. Voice-by-default becomes economically feasible.

But — we don't want to lock to one vendor. ElevenLabs has better voice quality for some use cases. OpenAI has Whisper. Browser has free built-in TTS. So the system needs to be **provider-pluggable from day one**.

---

## 3. Architecture

### 3.1 Mirror the existing multi-model pattern

The platform already supports per-agent LLM selection:

| LLM (existing) | Voice (new) |
|---|---|
| `service.multiModelEnabled` | `service.voiceModeEnabled` |
| `service.platformDefaultExecutor` (e.g. `claude`) | `service.platformDefaultVoice` (e.g. `browser`, `grok`, `elevenlabs`) |
| `agent.executor` override | `agent.voice` override |
| `service.providerKeys.{openai,xai,...}` | reuse — `providerKeys.xai`, `providerKeys.elevenlabs` |

This means agents work exactly like LLM selection: there's a platform default, and any agent can override it. Zero new mental model for the user.

### 3.2 Provider Abstraction

```ts
// src/voice/types.ts
interface VoiceProvider {
  id: string;                    // "browser" | "grok" | "elevenlabs"
  name: string;
  tts(text: string, voice?: string, options?: TtsOptions): Promise<AudioBuffer>;
  stt(audio: AudioBuffer, options?: SttOptions): Promise<string>;
  listVoices(): Voice[];
}
```

Implementations live under `src/voice/providers/`:
- `browser.ts` — uses Web Speech API client-side (free, no key, basic quality) — **default**
- `grok.ts` — calls xAI HTTPS API
- `elevenlabs.ts` — phase 2

### 3.3 Voice Selection Resolution

When an agent reply is rendered:
1. Read `agent.voice` (override). If set → use it.
2. Else read `service.platformDefaultVoice`. If set → use it.
3. Else fall back to `browser`.

A voice setting can be either just a provider (`"grok"`) or `provider:voiceId` (`"grok:Ara"`, `"elevenlabs:rachel"`).

### 3.4 Where Voice Lives in the Stack

```
┌─────────────────────────────────────────────────┐
│  Web UI (browser)                                │
│  ├─ Mic button → MediaRecorder → POST /api/stt  │
│  └─ Reply card → Play button → GET /api/tts     │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│  Backend (Express)                               │
│  ├─ POST /api/tts  → VoiceProviderRegistry      │
│  ├─ POST /api/stt  → VoiceProviderRegistry      │
│  └─ GET  /api/voices → list available voices    │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│  Provider (Grok / ElevenLabs / Browser)          │
└─────────────────────────────────────────────────┘
```

---

## 4. UX

### 4.1 Admin Settings — new "Voice Mode" section

```
┌─────────────────────────────────────────────┐
│  Voice Mode                                  │
│                                              │
│  [✓] Enable Voice Mode                       │
│                                              │
│  Default Provider:                           │
│  ( ) Browser (free, basic quality)  ← default│
│  (•) Grok (xAI) — best price                 │
│  ( ) ElevenLabs — best quality (phase 2)     │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ Grok API Key                          │   │
│  │ [••••••••••••••••••••••]  [Save]     │   │
│  │ Stored in OS keychain                 │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  Default Voice: [Ara ▼]                      │
│  Test: [▶ Play sample]                       │
│                                              │
│  ☐ Auto-play agent replies                  │
└─────────────────────────────────────────────┘
```

### 4.2 Per-Agent — new "Voice" tab in agent edit form

```
┌─────────────────────────────────────────────┐
│  Voice                                       │
│                                              │
│  Voice provider:                             │
│  (•) Use platform default (Grok)             │
│  ( ) Override                                │
│                                              │
│  [If override selected:]                     │
│   Provider:  [Grok ▼]                        │
│   Voice:     [Eve ▼]                         │
│   Test: [▶ Play sample]                      │
└─────────────────────────────────────────────┘
```

### 4.3 In Chat (Web UI)

- Each agent reply card gets a **🔊 Play** button (or auto-plays if enabled)
- Input area gets a **🎤 Mic** button — hold to record, release to transcribe + send
- While recording: visual waveform + cancel button
- While agent is "speaking": pause/stop button on the reply

---

## 5. Phased Plan

### Phase 1 — MVP (Web UI, Grok + Browser providers)

Goal: prove the architecture, ship usable voice in/out for the Web UI, validate cost/quality.

#### Backend
- [ ] Add `voiceModeEnabled`, `platformDefaultVoice` to `ServiceConfig` in `src/config.ts`
- [ ] Add `voice` field to `AgentConfig`
- [ ] Create `src/voice/types.ts` with `VoiceProvider` interface
- [ ] Create `src/voice/providers/browser.ts` (no-op on backend, signals client to use Web Speech API)
- [ ] Create `src/voice/providers/grok.ts` — wraps xAI TTS + STT HTTP API, reads key from `providerKeys.xai`
- [ ] Create `src/voice/registry.ts` — provider lookup + agent voice resolution
- [ ] Add routes in `src/web-ui.ts`:
  - [ ] `GET /api/voices` — list providers + voices for current config
  - [ ] `POST /api/tts` — `{ agentId?, text, providerOverride? }` → audio stream (mp3)
  - [ ] `POST /api/stt` — multipart audio upload → `{ text }`
  - [ ] `GET /api/voice-config` — current platform voice config (provider, default voice, enabled)
  - [ ] `PUT /api/voice-config` — admin update
- [ ] Reuse existing `save_mcp_key` pattern: store `XAI_API_KEY` via OS keychain (already supported in v1.1.56)

#### Frontend (Web UI)
- [ ] Admin Settings: new "Voice Mode" panel (provider selector, key entry, default voice, test button)
- [ ] Agent edit form: new "Voice" tab (default vs override, provider, voice, test button)
- [ ] Chat: 🔊 Play button on each agent reply (uses `<audio>` for backend providers, `SpeechSynthesisUtterance` for browser provider)
- [ ] Chat: 🎤 Mic button — `MediaRecorder` → POST `/api/stt` → injects transcribed text into input
- [ ] Optional auto-play toggle in admin settings

#### MCP / Tools
- [ ] New MCP tools: `set_platform_voice`, `set_agent_voice`, `list_voices`, `test_voice`
- [ ] Update `update_service_config` to accept new voice fields
- [ ] Update `update_agent` to accept `voice` field

#### Tests
- [ ] `Comprehensive Test Suite/voice/test-voice-config.js`
- [ ] `Comprehensive Test Suite/voice/test-tts-grok.js` (mocked xAI API)
- [ ] `Comprehensive Test Suite/voice/test-stt-grok.js` (mocked xAI API)
- [ ] `Comprehensive Test Suite/voice/test-agent-voice-override.js`
- [ ] All tests pass before commit

#### Docs
- [ ] Update `docs/user-guide.md` with Voice Mode section
- [ ] Update `docs/Architecture.md` agent config reference
- [ ] Run `/opappbuild_agentready_trueup`
- [ ] Run `/opappbuild_testsuite_trueup`

#### Acceptance criteria
- [ ] User can enable Voice Mode in admin settings, paste Grok key, hear test playback
- [ ] User can record voice → text appears in input → message sends
- [ ] User can play any agent reply as audio
- [ ] Per-agent voice override works (different agents, different voices)
- [ ] When voice mode is OFF, behavior is identical to today (zero regressions)

---

### Phase 2 — ElevenLabs + Auto-play polish

- [ ] `src/voice/providers/elevenlabs.ts` — TTS only (ElevenLabs doesn't do STT)
- [ ] Voice cloning support (ElevenLabs has it, Grok doesn't yet)
- [ ] Auto-play toggle wired up across agents
- [ ] Visual waveform + speaking indicator while audio plays
- [ ] "Stop speaking" button to interrupt long replies
- [ ] Voice selection preview UI (sample text per voice)

---

### Phase 3 — Multi-Channel Voice

Per-channel adapters that send/receive audio attachments using each platform's native voice-note API:

- [ ] Telegram — voice notes (`sendVoice`)
- [ ] Slack — `files.upload` audio attachment
- [ ] Discord — voice message attachment
- [ ] WhatsApp — voice notes via Baileys
- [ ] iMessage — audio attachment via `imsg` CLI
- [ ] Per-channel routing rule: "always voice", "voice if user sent voice", "text only"
- [ ] Inbound voice messages → STT → router (so users can voice-message agents from any channel)

---

### Phase 4 — Real-time / Streaming

- [ ] Streaming STT (xAI supports it) — live transcription as user speaks
- [ ] Streaming TTS (xAI supports it) — agent reply starts speaking before generation completes
- [ ] Push-to-talk + voice activity detection
- [ ] Persistent voice "call" mode (continuous conversation, no buttons)

---

## 6. Decisions — LOCKED 2026-04-26

| # | Decision | Confirmed |
|---|---|---|
| 1 | Phase 1 scope: Web UI + Grok + Browser, both TTS and STT | ✅ Yes |
| 2 | Default platform voice provider out of the box | ✅ `browser` (free, no setup) |
| 3 | Recommended provider once key is set | ✅ `grok` |
| 4 | Default Grok voice | ✅ `Ara` |
| 5 | Auto-play toggle default | ✅ OFF (user opts in) |
| 6 | Voice personality suggestion at agent creation | ✅ Phase 2 — skip for v1 |

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| xAI API outage breaks all voice | Browser provider always available as fallback |
| API key leakage | Store in OS keychain (already shipped in v1.1.56), never in config.json |
| TTS cost runaway | Track per-agent character count, expose in `get_agent_cost` |
| Long replies → long audio → bad UX | Truncate to first ~2000 chars for TTS by default, show "speak full reply" button |
| Browser mic permission denied | Graceful fallback message, keep text input working |
| Latency (round-trip TTS) | Phase 4 streaming TTS; for phase 1, accept ~1s delay |

---

## 8. SaaS Port

After phase 1 commits, ask user: "port to @ma41saas?" Voice provider abstraction should drop into the SaaS fork cleanly; main differences will be:
- Multi-tenant key storage (per-org Grok keys vs single user keychain)
- Per-org cost tracking / billing meter
- TTS cost passed through or absorbed by tier

---

## 9. Open Questions

1. Do we want a "voice journal" mode where the user dictates and an agent transcribes + summarizes (no reply needed)? Probably a separate skill/agent template, not core voice mode.
2. Should board widgets read themselves aloud on a schedule (audio morning briefing)? Natural extension once Phase 1 ships.
3. Voice as identity — should each agent get a default voice on creation (e.g. assigned by `@agentcreator`)? Nice-to-have, Phase 2.
