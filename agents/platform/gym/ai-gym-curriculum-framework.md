# AI Gym Curriculum Framework

## Philosophy

The goal is not to learn AI — the goal is to **use AI**. Every dimension answers: "What did you USE AI to DO?"

Each module progresses through 4 levels (university model):
- **101** = You + AI, one-shot, manual
- **201** = You + AI, multi-step, structured
- **301** = AI runs it with your design, automated
- **401** = AI systems that operate independently, production-grade

---

## Module 1: Using AI to Gain Knowledge & Find Information

| Level | Core Idea | Focus |
|---|---|---|
| **101** | Ask AI questions | Chat with AI to get answers, replace basic Googling, learn to evaluate AI responses |
| **201** | Research with AI | Multi-step research, comparing sources, follow-up questioning, summarizing long documents |
| **301** | Structured knowledge systems | RAG, knowledge bases, feeding AI your own data, building searchable archives |
| **401** | Autonomous knowledge agents | Agents that monitor, curate, and surface information proactively (news digests, competitive intel, trend alerts) |

---

## Module 2: Using AI to Communicate

| Level | Core Idea | Focus |
|---|---|---|
| **101** | Talk to AI effectively | Prompting fundamentals — clear instructions, context-giving, iterating on outputs |
| **201** | Use AI to write for others | Draft emails, proposals, reports, social posts — AI as your writing partner |
| **301** | Multi-channel AI communication | AI across Slack, email, LinkedIn, client-facing docs — tone/audience adaptation, templates |
| **401** | AI as communication strategist | Content calendars, audience segmentation, brand voice systems, automated outreach pipelines |

**Note:** This dimension intentionally covers BOTH communicating WITH AI (101) and using AI to communicate WITH OTHERS (201+).

---

## Module 3: Using AI to Analyze, Review & Validate

| Level | Core Idea | Focus |
|---|---|---|
| **101** | Ask AI to check your work | Paste in a doc/spreadsheet/email, ask "what's wrong?" — basic review and proofreading |
| **201** | Structured analysis | Compare options, pros/cons, financial reviews, data validation, gap analysis |
| **301** | AI-powered QA workflows | Checklists, compliance checks, audit prep, systematic review processes with AI |
| **401** | Autonomous validation pipelines | Agents that continuously monitor, flag anomalies, and validate data integrity across systems |

---

## Module 4: Using AI to Improve Manual Tasks (Process Execution)

| Level | Core Idea | Focus |
|---|---|---|
| **101** | Delegate a task to AI | Hand AI a single repetitive task — reformatting, data entry, cleanup, sorting |
| **201** | Multi-step process delegation | Chain steps together — AI handles a full workflow (e.g., reconcile → categorize → report) |
| **301** | Orchestration | Goals, scheduled tasks, cron jobs — AI runs processes on autopilot without you asking |
| **401** | Multi-agent process systems | Multiple agents collaborating on complex processes, delegation chains, exception handling |

**The test:** If you delete it after it runs, it was Module 4 (process). If it lives on and gets reused, it's Module 5 (asset).

---

## Module 5: Using AI to Build Applications, Tools & Dashboards (Asset Building)

| Level | Core Idea | Focus |
|---|---|---|
| **101** | Build a simple tool with AI | Use AI to create a calculator, template, or simple utility — your first "vibe code" |
| **201** | Build functional apps | Full applications with UI, data, and logic — AI as your developer |
| **301** | Integrate and connect | MCP configs, API integrations, tools that pull live data from real systems |
| **401** | Production systems | Deployed apps, multi-user tools, monitoring, maintenance — assets that run your business |

---

## Curriculum Grid

5 modules x 4 levels = **20 course slots**. Each slot contains 5 programs = **100 programs at full buildout**.

---

## Mapping from Old Dimensions

| Old Dimension | New Home | Notes |
|---|---|---|
| Knowledge | Module 1 | Direct fit |
| Communication | Module 2 | Shifted: was "prompting skill", now covers both prompting (101) and communicating with others (201+) |
| Application | Dissolved | Becomes an engagement metric across all 5, not its own dimension |
| Craft | Module 5 | Building things |
| Orchestration | Module 4 at 301+ | Advanced process execution |
| Analyze/Review | Module 3 | **Net new** — no old dimension covered this |

---

## Scoring Signals (for dimension-scorer)

| Dimension Key | Label | What to Measure |
|---|---|---|
| `knowledge` | Gaining Knowledge | Program completions + gym engagement + topic breadth |
| `communication` | Communication | Messages involving content creation tools (Write, Edit) + communication MCPs (Slack, email, LinkedIn) |
| `analysis` | Analysis, Reviews & Validation | Read/Grep/Glob tool usage + review-oriented conversations + data MCPs (Plaid, QBO) |
| `automation` | Automating Manual Tasks | Cron/goals setup + automation patterns + repeated task delegation |
| `building` | Building Apps, Tools & Dashboards | Agent creation + MCP configs + system prompts + workspace setups + Bash usage |
