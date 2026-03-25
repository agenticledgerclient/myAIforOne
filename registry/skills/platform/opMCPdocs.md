---
description: "Generate an interactive MCP Tool Documentation page for any project's MCP server. The Swagger-builder equivalent for MCP tools. Creates a React component (McpDocsPage.tsx) with categorized tool cards, parameter tables, search, expand/collapse, copy buttons, and example blocks. Reads the MCP tool definitions from the project's server/mcp-server/tools/ directory."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
argument-hint: "[project path]"
---

# MCP Documentation Page Builder

Generate an interactive MCP Tool Documentation page for any project, matching the proven pattern from Process & Controls and pl-analyzer.

## Arguments
$ARGUMENTS
- Provide the project root path (e.g., `~/Desktop/APPs/MyProject`)
- If omitted, use the current working directory

## What This Produces

A single React component file: `client/src/pages/McpDocsPage.tsx`

Features:
- **Left sidebar** — Tool category navigation with icons and tool counts
- **Main content** — Categorized, expandable tool cards
- **Search** — Real-time filtering across tool names, descriptions, and parameter names
- **Expand/Collapse All** — Buttons in stats bar
- **Stats bar** — Total tools and categories count
- **Tool cards** — Name (monospace, copyable), description, parameter table, example JSON block
- **Parameter table** — 4 columns: Parameter | Type | Required/Optional | Description
- **Copy buttons** — On tool names and example blocks
- **Dark theme** — Matches project's design system

## Workflow

### Step 1: Discover MCP Tools
Read all tool definition files from the project:
```
server/mcp-server/tools/*.ts
```

For each file, extract:
- Tool name (e.g., `pc_processes_list`)
- Description string
- Input schema (Zod) — extract parameter names, types, required/optional, and `.describe()` text
- Any example usage

Also read:
- `server/mcp-server/hub-server.ts` — to see how tools are imported and organized
- `server/mcp-server/types.ts` — for the MCPToolDef interface

### Step 2: Determine Tool Categories
Group tools into categories based on file names and prefixes:
- `tools/processes.ts` → "Processes" category
- `tools/agents.ts` → "Agents" category
- etc.

Each category needs: `id`, `label`, `icon` (Lucide), `description`, `tools[]`

### Step 3: Determine Project Design System
Check if the project has:
- `client/src/design-tokens.ts` — use those colors/fonts
- `client/src/theme.tsx` — use theme tokens
- Neither → use the default dark theme below

### Step 4: Generate McpDocsPage.tsx
Generate the component following this exact structure:

```typescript
import { useState, useMemo } from 'react';
import { Server, Search, ChevronDown, ChevronRight, Copy, Check, Hash,
  /* category icons */ } from 'lucide-react';

/* ─── types ─── */
interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface ToolDoc {
  name: string;
  description: string;
  params: ToolParam[];
  example?: string;
}

interface ToolCategory {
  id: string;
  label: string;
  icon: React.ReactNode;
  description: string;
  tools: ToolDoc[];
}

/* ─── tool catalog ─── */
const TOOL_DOCS: ToolCategory[] = [
  // ... generated from discovered tools
];

/* ─── styles ─── */
const styles = { /* ... */ };

/* ─── components ─── */
function CopyButton({ text }: { text: string }) { /* ... */ }
function ToolCardComponent({ tool }: { tool: ToolDoc }) { /* ... */ }
function CategorySection({ category, expanded, onToggle, searchFilter }: { /* ... */ }) { /* ... */ }

/* ─── main page ─── */
export default function McpDocsPage() { /* ... */ }
```

### Step 5: Wire Navigation
Check the project's sidebar/navigation component and add a link to the MCP docs page:
- Look in `client/src/layouts/Sidebar.tsx` or similar
- Add under a "Documentation" group alongside API Docs if it exists
- Add route in `App.tsx` or equivalent router

### Step 6: Verify
- Confirm the component compiles: `npx tsc --noEmit` (check just the new file)
- Confirm all imported Lucide icons exist
- Confirm tool count matches what's in the MCP server

## Default Dark Theme (if no design system found)

```typescript
const T = {
  bg: '#0a0f1a',
  surface: 'rgba(15, 23, 42, 0.6)',
  border: 'rgba(56, 189, 248, 0.08)',
  borderHover: 'rgba(56, 189, 248, 0.2)',
  text: '#f1f5f9',
  textMuted: '#94a3b8',
  textDim: '#64748b',
  accent: '#38bdf8',
  accentBg: 'rgba(56, 189, 248, 0.1)',
  purple: '#818cf8',
  orange: '#f97316',
  orangeBg: 'rgba(249, 115, 22, 0.1)',
  code: 'rgba(0, 0, 0, 0.3)',
  fontHeading: "'Syne', sans-serif",
  fontBody: "'DM Sans', sans-serif",
  fontMono: "'DM Mono', monospace",
};
```

## Component Style Specifications

### Page Layout
```css
display: flex; height: 100vh; overflow: hidden;
```

### Sidebar (left, fixed width)
```css
width: 240px; background: rgba(15,23,42,0.95); border-right: 1px solid {border};
padding: 20px 0; overflow-y: auto;
```
- Category nav items: icon + label + count badge
- Active state: accent color + accent bg
- Hover: lighter text

### Main Content (flex: 1, scrollable)
```css
flex: 1; overflow-y: auto; padding: 32px 40px;
```

### Header
```css
display: flex; align-items: center; gap: 12px;
```
- Server icon (24px, accent color) + "MCP Tool Documentation" heading
- Subtitle with tool prefix highlighted in purple

### Stats Bar
```css
display: flex; gap: 24px; padding: 12px 16px;
background: rgba(56,189,248,0.04); border-radius: 8px; border: 1px solid {border};
```
- "{N} tools" | "{N} categories" | [Expand All] [Collapse All]

### Search Input
```css
width: 100%; padding: 10px 12px 10px 36px;
background: rgba(15,23,42,0.6); border: 1px solid {border}; border-radius: 8px;
color: #f1f5f9; font-size: 14px;
```
- Search icon positioned absolutely at left

### Category Header (clickable, expandable)
```css
display: flex; align-items: center; gap: 10px; padding: 14px 16px;
background: rgba(15,23,42,0.6); border: 1px solid {border}; border-radius: 10px;
cursor: pointer; transition: all 0.15s;
```
- Icon (accent) + Label (Syne 15px 600) + Description (dim) + Count badge + Chevron

### Tool Card
```css
background: rgba(15,23,42,0.4); border: 1px solid rgba(56,189,248,0.06);
border-radius: 8px; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px;
```

### Tool Name
```css
font-family: monospace; font-size: 14px; font-weight: 600; color: {accent};
```
- Hash icon (13px, dim) + name + CopyButton

### Parameter Table
```css
width: 100%; border-collapse: collapse; font-size: 12px;
```
- Header: uppercase, dim, letter-spacing, bottom border
- Cells: padding 6px 10px
- Param name: monospace, bold
- Param type: purple, monospace, 11px
- Required badge: orange bg + text
- Optional badge: gray bg + text

### Example Block
```css
background: rgba(0,0,0,0.3); border-radius: 6px; padding: 10px 14px;
font-size: 12px; font-family: monospace; color: {textMuted};
white-space: pre-wrap; position: relative; line-height: 1.5;
```
- CopyButton positioned top-right

## Lucide Icon Suggestions by Category
Map tool file names to appropriate icons:
- org → Building2
- users → Users
- processes/workflows → Workflow
- steps → ListChecks
- controls → Shield
- documents/evidence → FileText / Paperclip
- agents → Bot
- chat → MessageSquare
- memory/knowledge → Brain
- capabilities → Puzzle
- channels → Radio
- config/settings → Settings
- platform/admin → Crown
- api-keys → Key
- audits → ListChecks
- insights → Lightbulb
- prompts → Wand2
- Default → Hash

## Reference Implementations
- **Process & Controls**: `/Users/oreph/Desktop/APPs/Process & Controls/client/src/pages/McpDocsPage.tsx` (1717 lines, 15 categories, 90+ tools)
- **pl-analyzer**: `/Users/oreph/Desktop/APPs/pl-analyzer/client/src/pages/McpDocsPage.tsx` (63.5 KB, 14 categories, 100+ tools)

Read these for exact patterns if unsure about any implementation detail.
