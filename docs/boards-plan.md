# Boards — Implementation Plan

## Overview
Boards are a new first-class entity (like Projects) that provide a non-chat rendering surface. Each board displays widget cards showing the last output from multiple agents. Any agent can be board-enabled; agents with `class: "board"` exist solely for board output.

## Architecture

### Data Model
- Stored at `PersonalAgents/boards/<id>/board.json`
- Widget positions use grid coordinates: x, y, w, h

```typescript
interface BoardEntity {
  id: string;                    // "board_<timestamp>"
  name: string;
  description: string;
  status: "active" | "paused" | "archived";
  widgets: BoardWidget[];
  refreshSchedule?: string;      // cron expression
  defaultBoard?: boolean;
  lastRefreshedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface BoardWidget {
  agentId: string;
  x: number;                     // grid column
  y: number;                     // grid row
  w: number;                     // grid width (1-4)
  h: number;                     // grid height (1+)
  goalId?: string;               // show output from specific goal
  title?: string;                // override display title
}
```

### Agent Config Additions
```typescript
boardEnabled?: boolean;          // opt-in flag (orthogonal to class)
boardLayout?: "small" | "medium" | "large";  // default widget size
```

### Agent Class: "board"
- Auto-sets `boardEnabled: true`
- Excluded from chat agent dropdowns
- Exists solely to produce board output

## Checklist

### Phase 1: Agent Config
- [x] Add `boardEnabled`, `boardLayout` to `AgentConfig` interface in `config.ts`
- [x] Support `boardEnabled`/`boardLayout` in agent create/update API in `web-ui.ts`
- [x] Add `"board"` as valid `agentClass` value (auto boardEnabled, excluded from chat)

### Phase 2: Board CRUD
- [x] Define `BoardEntity` and `BoardWidget` interfaces with grid position fields (x, y, w, h)
- [x] Implement board storage (`loadBoards`, `saveBoard`, `deleteBoardFolder`) in `PersonalAgents/boards/`
- [x] Add API endpoints: `GET/POST /api/boards`, `GET/PUT/DELETE /api/boards/:id`
- [x] Add widget endpoints: `POST /api/boards/:id/widgets`, `DELETE /api/boards/:id/widgets/:agentId`
- [x] Add `PUT /api/boards/:id/widgets` for updating widget position/size (drag-resize)
- [x] Add `GET /api/agents/board-enabled` endpoint

### Phase 3: Last Output
- [x] Implement `getAgentLastOutput()` helper (reads `conversation_log.jsonl`, handles per-user mode)
- [x] Enrich `GET /api/boards/:id` with widget outputs (agent name, avatar, last response, timestamp)

### Phase 4: Refresh
- [x] Add `POST /api/boards/:id/refresh` endpoint (re-triggers widget agents)
- [x] Add board auto-refresh cron scheduling (start/stop/restart lifecycle on board CRUD)

### Phase 5: MCP Tools
- [x] Add board API client functions to `api-client.ts` (8 functions)
- [x] Add board MCP tools to `mcp-server/index.ts` (list, get, create, update, delete, add_widget, remove_widget, refresh)
- [x] Add `boardEnabled`/`boardLayout` to `create_agent` and `update_agent` MCP tool schemas

### Phase 6: Web UI
- [x] Add `/boards` page route in `web-ui.ts`
- [x] Create `boards.html` with topbar, sub-nav, theme toggle matching existing pages
- [x] Board selector: dropdown for all boards + chips for recent/pinned + default board auto-load
- [x] Widget grid canvas: CSS grid with resizable widgets (drag-to-resize with snap)
- [x] Widget cards: agent avatar, name, timestamp, truncated response content
- [x] Widget expand overlay: click card to show full output in modal overlay
- [x] Board controls: Refresh All button, per-widget refresh, auto-refresh indicator
- [x] New Board creation form + Edit Board panel (add/remove widgets, rename, schedule)
- [x] Add `boardEnabled` toggle + `boardLayout` dropdown to agent edit form
- [x] Add Boards nav tab to all HTML pages (topbar navigation)

### Phase 7: Tests
- [x] Add board CRUD tests to Comprehensive Test Suite
- [x] Add board widget and last-output tests
- [x] Add board refresh and MCP tool tests
- [x] Run full test suite and verify all pass

### Phase 8: Docs
- [x] Update `CLAUDE.md` with boards entity documentation
- [x] Run `/opappbuild_agentready_trueup` for API docs, MCP tools, MCP docs
- [x] Run `/opappbuild_testsuite_trueup` for test coverage
- [x] Update user guide (`docs/user-guide.md`) with boards page, endpoints, MCP tools

## UI Design

### Board Page (`/boards`)
- Lands directly on default board (zero-click useful)
- Top bar: board dropdown selector + recent board chips + New/Edit/Refresh buttons
- Canvas: CSS grid (4 columns) with resizable widget cards (drag-to-resize with snap)
- Widget cards show: agent avatar, name, timestamp, truncated output
- Click card → overlay modal with full output (card doesn't resize)
- Boards nav tab added to all pages, positioned prominently

### Navigation
```
[ Boards ] [ Org ] [ Projects ] [ Tasks ] [ Automations ] [ Admin ]
```

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/boards` | List all boards |
| POST | `/api/boards` | Create a board |
| GET | `/api/boards/:id` | Get board with enriched widget data |
| PUT | `/api/boards/:id` | Update board |
| DELETE | `/api/boards/:id` | Delete board |
| POST | `/api/boards/:id/widgets` | Add widget to board |
| PUT | `/api/boards/:id/widgets` | Update widget positions/sizes |
| DELETE | `/api/boards/:id/widgets/:agentId` | Remove widget |
| POST | `/api/boards/:id/refresh` | Manual refresh |
| GET | `/api/agents/board-enabled` | List board-eligible agents |

## MCP Tools
`list_boards`, `get_board`, `create_board`, `update_board`, `delete_board`, `add_board_widget`, `remove_board_widget`, `refresh_board`
