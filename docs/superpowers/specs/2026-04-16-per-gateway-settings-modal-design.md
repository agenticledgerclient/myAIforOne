# Per-Gateway Settings Modal + Issued-Keys Feature Gating

**Date:** 2026-04-16
**Status:** Design approved, ready for planning
**Author:** brainstormed via web UI session 2026-04-16

## Problem

The local-install Admin UI conflates two unrelated concepts under flat top-level tabs:

1. **`API Keys`** — keys this install *issues* for inbound clients connecting TO it. Only meaningful when this install is acting as a gateway (`sharedAgentsEnabled === true`). Currently shown unconditionally.
2. **`Team Gateways`** — gateways this install connects OUT to as a client. Each card has only `Test` and `Disconnect` — no way to drill in for per-gateway settings (rotate the API key being used, rename, control which local agents have access).

We expect users to connect to 10–20 team gateways over time. The current flat layout doesn't scale, and the issuance tab is misleading on installs that aren't acting as gateways.

## Goals

- Make per-gateway configuration discoverable and scalable to many future settings without UI sprawl.
- Hide the issuance UI on installs that aren't acting as a gateway, and harden the underlying endpoints to match.
- Keep existing connection mechanics (auto-MCP registration, auto-attach to Hub, disconnect cleanup) intact.

## Non-Goals

- Server-side filtering of which shared agents are exposed by a gateway (gateway-side concern, separate spec).
- Renaming a gateway's `id` (immutable; rename = disconnect + reconnect).
- Changing a gateway's URL in place (disconnect + reconnect).
- Scoped/granular API keys (still `*` scope only).
- Adding empty Notifications/Advanced tabs in the modal — IA is not seeded with vaporware.

## Information Architecture Changes

### Top-level admin tabs

| Today                | Tomorrow                                     | Visibility                                |
| -------------------- | -------------------------------------------- | ----------------------------------------- |
| `API Keys`           | `Issued Keys` (renamed)                      | Hidden unless `sharedAgentsEnabled === true` |
| `Team Gateways`      | `Team Gateways` (unchanged)                  | Always visible                            |

> **Open veto item at user review:** the rename `API Keys` → `Issued Keys`. The new label more accurately describes "keys this install issues to inbound clients." If the user prefers to keep the original label, drop the rename and only do the gating.

When `sharedAgentsEnabled` is on, the **Team Gateways** page header gains a small inline link: *"This install also issues keys → Manage Issued Keys."* Keeps both consumer- and provider-side concepts discoverable from one place without conflating them.

### Inside Team Gateways

Each gateway card grows a `Configure` button alongside `Test` / `Disconnect`. The card itself is also clickable (same target). All three open the **per-gateway modal**.

## Per-Gateway Modal

A tabbed modal scoped to a single connected gateway.

**Frame**
- Header: gateway name, status pill (`OK` / `OFFLINE` / `UNAUTHORIZED` / `ERROR`), URL
- Close `X` (top-right)
- Footer: persistent `Disconnect` (destructive, left) and `Close` (right)

**Tabs:** `Connection` (default) | `Credentials`

### Tab 1 — Connection

- **Display name** — editable inline; save via `PATCH /api/team-gateways/:id`
- **URL** — read-only with explainer: *"To change the URL, disconnect and reconnect."*
- **Status** — pill + "Last checked X ago" + `Test now` button (uses existing `/api/team-gateways/:id/resync`)
- **MCP id** — read-only, copyable (useful for debugging which `.mcp.json` entry maps to this gateway)
- **Added on** — read-only timestamp

**Section: "Gateway access"** *(near the bottom of the Connection tab)*
- One-line explainer: *"These local agents can use this gateway as an MCP."*
- Chip row of currently attached agents (Hub default). Each chip has an `×` to detach.
- `+ Add agent` dropdown lists local agents not currently attached.
- Empty state when only Hub is attached: just the Hub chip, no extra UI.
- Attach calls `POST /api/team-gateways/:id/attach { agentId }`; detach calls `POST /api/team-gateways/:id/detach { agentId }`. Both update the agent's `mcps` list and persist config.

### Tab 2 — Credentials

- **API key display** — masked by default (`mai41team_••••••••a3f2`). Two server endpoints back this:
  - `GET /api/team-gateways/:id/key-preview` returns `{ prefix: "mai41team_", last4: "a3f2" }` for the masked rendering. Always safe to call.
  - `GET /api/team-gateways/:id/key-reveal` returns `{ apiKey }` (full plaintext). Only called when the user clicks `Reveal`. Both endpoints require admin auth (same auth as other admin endpoints). Reasoning: avoid shipping the plaintext key on every modal open; require an explicit reveal action.
- **Copy** button — calls `key-reveal` and copies the result to clipboard without rendering it.
- **Rotate key** button → expands an inline form: paste new key → auto-test (calls `POST /api/team-gateways/:id/rotate-key { apiKey }`) → on success, overwrite `.env` file and re-probe to update `lastStatus`.
- **Last successful auth:** "X ago" line (derived from `lastStatusAt` when `lastStatus === "ok"`).
- Small explainer at the bottom: *"Get a new key from this gateway's Admin → Issued Keys page."*

## Feature Flag: `sharedAgentsEnabled`

**UI gating**
- Hide the top-level `Issued Keys` tab when `sharedAgentsEnabled !== true`.
- Hide the "Manage Issued Keys" header link in Team Gateways when off.

**Backend hardening (in scope for this PR)**
- All `/api/keys/*` endpoints reject with **403** when `sharedAgentsEnabled !== true`. The capability already exists; the routes should match the UI gating so that a curl-wielding client can't sidestep the toggle.
- Existing behavior when flag is on: unchanged.

**Out of gating scope**
- Team Gateways list, the per-gateway modal, and all `/api/team-gateways/*` endpoints stay unconditional. Every install can be a client.

## Backend Changes

### New endpoints

- `GET /api/team-gateways/:id` — full record + computed `attachedAgents: string[]` (derived by scanning all agents' `mcps` arrays for the gateway's MCP name). Used to populate the modal on open.
- `GET /api/team-gateways/:id/key-preview` — `{ prefix, last4 }` for masked display.
- `GET /api/team-gateways/:id/key-reveal` — `{ apiKey }` plaintext (admin-auth required, explicit reveal action).
- `PATCH /api/team-gateways/:id` body `{ name }` — update display name. Returns updated gateway. Fails with 404 if not found.
- `POST /api/team-gateways/:id/rotate-key` body `{ apiKey }` — probe new key against existing URL; if OK, write to `data/mcp-keys/team-{id}.env`, update `lastStatus*`, return new status. Fails with 400 if probe fails (do not write).
- `POST /api/team-gateways/:id/attach` body `{ agentId }` — append the gateway's MCP name to that agent's `mcps` array (if not already present), persist config. Returns the agent's updated `mcps` list.
- `POST /api/team-gateways/:id/detach` body `{ agentId }` — remove the gateway's MCP name from that agent's `mcps` array, persist config. Returns the agent's updated `mcps` list. Refuses with 400 if `agentId === "hub"` and no other agents are attached (Hub-as-anchor invariant — open for review).

### Hardening

- Add `sharedAgentsEnabled` guard middleware to the existing `/api/keys/*` route group. 403 with `{ error: "Shared Agents feature is disabled" }` when off.

### Data model

**No schema change.** `TeamGateway` interface stays as-is. Per-agent attachment continues to live in each agent's existing `mcps` field.

## Frontend Changes

All changes in `public/admin.html`:

- Conditionally render the `apikeys` tab button based on `service.sharedAgentsEnabled` (read from existing `/api/service-config` or equivalent).
- Rename `API Keys` → `Issued Keys` in the tab label and `panel-apikeys` page title.
- Add `Configure` button to each card in `loadTeamGateways()` rendering, plus make the card clickable.
- New function `openTeamGatewayModal(id)` that builds and shows the tabbed modal, fetching detail (gateway record, key for masked display, current attachment list) on open.
- New helpers: `renameGateway(id)`, `rotateGatewayKey(id)`, `attachAgentToGateway(id, agentId)`, `detachAgentFromGateway(id, agentId)`.

## Test Coverage (added under `Comprehensive Test Suite/team-gateways/`)

- `PATCH /:id` — happy path, 404 on missing.
- `rotate-key` — happy path (key file overwritten, status updated), reject when probe fails (file unchanged).
- `attach` / `detach` — agent's `mcps` list updated, idempotent (attach twice = same state), Hub-anchor refusal.
- Issued Keys flag gating — `/api/keys/*` returns 403 when `sharedAgentsEnabled` is false; 200 when true.

## Migration & Rollout

- No data migration required. Existing connected gateways continue to work; opening the modal just shows their current state.
- Existing single-page admin doesn't require a hard reload; the new modal is built dynamically when first opened.

## Open Items for User Review

1. **Rename `API Keys` → `Issued Keys`** — accept or veto.
2. **Hub-anchor invariant** — should `detach` refuse to remove Hub when it's the only attached agent (preventing accidental orphaning of the gateway from any agent)? Default in this spec: yes.
3. **`Configure` button placement** — in the card alongside `Test`/`Disconnect`, OR replace card with a clickable card and remove `Configure` button entirely? Default in this spec: keep both (`Configure` button + clickable card) for discoverability.
