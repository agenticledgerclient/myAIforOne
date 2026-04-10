# AI Gym — Onboarding Design Document

> Brainstorming / planning doc. See `ai-gym-architecture.md` for the full system design.

---

## Overview

The AI Gym is a separate, toggleable module on the MyAI for One platform. When enabled, it gets its own dedicated tab in the app. The gym agent is a **distinct agent class** — not a personal agent, not a platform agent — but built on the same underlying infrastructure with the same capabilities (sessions, memory, MCP tools, etc.).

Onboarding is the entry point. It's a three-step flow:
1. Choose your trainer
2. Tell us about you
3. Get your plan

---

## Step 1 — Choose Your Trainer

The user picks one of **5 trainers**. Presented as cards: avatar, name, and a short first-person intro. The goal is for it to feel like meeting a real person — not configuring a feature.

Tone and pacing are baked into each profile. No separate dropdowns.

| Trainer | Style | Pace |
|---------|-------|------|
| **Alex** | Collaborative, celebratory | Steady |
| **Jordan** | Direct, accountable | Steady |
| **Morgan** | Thoughtful, frameworks-first | Steady |
| **Riley** | Challenging, hard questions | Immersive |
| **Sam** | Patient, no pressure | Steady |

**The intro each trainer shows on their card:**

> **Alex** — "Hey, I'm Alex. I work right alongside you — we figure things out together. I'm not here to lecture you; I'm here to build with you. Expect consistent progress every session and a lot of high-fives along the way."

> **Jordan** — "I'm Jordan. I'm direct, I don't sugarcoat, and I'll hold you accountable. We set a goal, we hit it. I'll tell you exactly what to work on and call you out when you're avoiding the hard stuff."

> **Morgan** — "I'm Morgan. I care a lot about the 'why.' I won't just show you what to click — I'll make sure you understand what's actually happening. We'll take things one layer at a time, and you'll leave with real understanding, not just checked boxes."

> **Riley** — "I'm Riley. I'm going to push you — hard questions, uncomfortable exercises, things you'll want to skip. That's exactly where we're going. When you're with me, we go deep and fast."

> **Sam** — "I'm Sam. I meet you exactly where you are — no pressure, no judgment. We go at your pace. One thing at a time, building from what you already know. Nothing overwhelming, ever."

Each card has an avatar image (`public/trainers/<name>.png`, illustrated style). Users can switch trainers at any time; history, plan, and progress persist.

### Implementation Note
Each trainer profile is a `soul.md` file — the system prompt personality layer for the gym agent. Switching trainers = swapping which `soul.md` is active. Users can switch profiles at any time; their history, plan, and progress persist unchanged.

---

## Step 2 — Get to Know You

Once the trainer profile is selected and adopted by the gym agent, the agent opens a **single conversational message** — not a questionnaire. The agent sends one prompt that covers three topics and gives the user suggested angles to respond to. The user replies however they want, in whatever order, in one go.

### The Three Topics

**1. About You (professional)**
Gathered passively where possible — user shares LinkedIn, Twitter, or any links. Agent reads and builds a profile. User can review and edit. Goal: understand their professional context and background. Nothing too personal.

**2. Your AI Use**
Where are you today? Heavy user with real workflows? Curious beginner? Somewhere in between? Give an example. The user tells this in their own words — the agent doesn't quiz them with options.

**3. Your Goals**
What do you want out of AI? More productive at work? Build something? Just not feel left behind? Open-ended.

### The One-Question Format
> "Before we get started, tell me a bit about yourself — I'll use this to make everything we do together actually useful to you. You can share things like: your LinkedIn or any links (I'll read them), what you do for work, where you are with AI right now (total beginner, dabbler, daily user — give me an example), and what you're hoping to get out of this. One message, however you want to write it."

The agent processes the response, builds the user profile, and confirms back with a brief summary before moving to the plan.

---

## Step 3 — The Plan

The plan is a **real, visible, living document** — not a background concept. It has its own section in the gym UI. Users can see it, the gym agent can update it, and the user can edit it too. It tracks what's been done, what's mastered, and surfaces wins over time.

The plan always has two buckets:

### Bucket 1 — On the Job Training (User-Driven)
The user brings their real work to the platform. The gym agent observes, assists, suggests, and tracks skill development as a byproduct of actual usage. Learning by doing. Value is delivered immediately — they're not studying AI, they're using AI to get things done, and the gym is tracking the growth in the background.

### Bucket 2 — Platform-Driven
Two sub-buckets:

**Textbook**
Curated modules: read this article, watch this video, learn this concept. Structured, sequenced content for foundational knowledge.

**Dynamic**
Personalized suggestions based on observed platform activity. If the user did something with Excel through the platform, and the gym agent knows a Claude + Excel technique they haven't seen, it surfaces it as a training moment. Reactive, contextual, continuously generated.

### Plan Properties
- Created at end of onboarding, based on the user profile built in Step 2
- Updated continuously by the gym agent as usage patterns emerge
- User can add goals, mark things done, or reorder priorities
- Tracks: mastered skills, in-progress learning, suggested next steps, wins/milestones
- Will have dedicated APIs and MCP tools for read/write access
- The bucket structure (on-the-job vs. platform-driven / textbook vs. dynamic) is preserved as the organizing frame — always visible in the UI

---

## Gym Agent — Notes

- Distinct agent class, separate from personal agents and platform agents
- Has all standard platform capabilities (sessions, memory, MCP, goals, crons, etc.)
- Personality layer = `soul.md` (swappable per trainer profile)
- One gym agent per user (or per install in local mode)
- Owns the user's learner profile, plan, and training history
- Connects to platform activity data (with permission) to power the dynamic bucket

---

## Open Questions

- How many trainer profiles at launch? 5 feels right — enough variety, not overwhelming
- Does the gym agent have a fixed `agentId` (e.g. `gym`) or is it user-created on first launch?
- Where does the learner profile live — agent memory (`context.md`) or a dedicated `learner-profile.json`?
- Plan UI: separate `/gym/plan` sub-page or a panel within the `/gym` tab?
- Dynamic bucket: pull-based (agent checks activity periodically) or event-driven (hooks on agent activity)?

---

*Last updated: 2026-04-09 — brainstorming phase*
