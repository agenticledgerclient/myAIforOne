---
description: "Generate a standalone HTML visualization of business processes, steps, and controls matching the P&C platform's exact visual style with full interactivity. Use when the user provides process documents, SOPs, or control matrices and wants a polished dark-themed HTML report. Supports incremental building (add processes one at a time) then produce final combined HTML. Output goes to ~/Desktop/APPs/Process&Controls_Ondemand_Outputs/"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(python3:*), Agent
argument-hint: "[document paths or 'generate']"
---

# Process & Controls On-Demand Visualization

Generate self-contained, interactive HTML documents that faithfully recreate the Process & Controls platform visualization with full interactivity.

## Output Location

**ALWAYS** save to:
```
~/Desktop/APPs/Process&Controls_Ondemand_Outputs/{CLIENT_NAME}/process-controls-report-YYYY-MM-DD.html
```
- `{CLIENT_NAME}` = uppercase org name (e.g., `BASTION`)
- Create the client subfolder if it doesn't exist
- Each regeneration overwrites the same-date file

## Arguments
$ARGUMENTS
- If paths to documents are provided, read and parse them
- If "generate" is passed, produce the HTML from accumulated processes
- If no args, ask what documents/processes to visualize

## Workflow

1. **User provides input** — process documents (.docx SOPs), control matrices (.csv/.xlsx), or plain-text descriptions
2. **You extract and structure** — parse into processes, steps, and controls using the Data Structure below
3. **Confirm** — "Parsed [Process Name]: X steps, Y controls. Ready for the next, or should I generate?"
4. **Repeat** — user may add more processes incrementally
5. **Generate** — produce one self-contained HTML with all processes via Python generator script

## Data Structure

For each process, extract:

```
Process:
  - id (sequential), name, controlObjective

Steps[] (ordered):
  - id (sequence), name, description, owner, system, critical (boolean)

Controls[]:
  - id (CTL-001, CTL-002...), name, description
  - type: "preventive" | "detective" | "corrective"
  - frequency: "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Annually" | "As needed"
  - owner
  - linkedSteps: number[] (step sequence numbers)
```

## Generation Method

Write a Python script that generates the HTML. The HTML is too large to write by hand. The script must:

1. Define all process/step/control data as Python dicts
2. Generate complete HTML with all CSS, SVG, and JS inline
3. Embed `PROC_DATA` as a global JSON object in the `<script>` tag
4. Write to the output path

## Required Interactive Features (ALL must be present)

### 1. Visibility Mode Toggles (4 modes in toolbar)
- **Hidden** (EyeOff icon): Hide control nodes + purple edges. Steps show only count pill.
- **Badges** (Eye icon): Hide control nodes. Steps show 8px colored dots per control (cyan=preventive, yellow=detective, red=corrective). Dots scale 1.6x on hover. Click dot → select control in sidebar.
- **Compact** (Layers icon): Hide control nodes. Steps get expanded section with mini control cards (shield icon + truncated name 28 chars + type dot). Click card → select control.
- **Expanded** (Maximize2 icon): DEFAULT. Separate control gate nodes visible with purple dashed connections.

Toggle button styling:
```css
font-family: 'IBM Plex Mono'; font-size: 10px; font-weight: 500; padding: 5px 10px; border-radius: 7px;
Active: background rgba(56,189,248,0.12), color #38bdf8, border-color rgba(56,189,248,0.2)
Inactive: transparent bg, muted text
```

### 2. Collapsible Detail Panel
- Close (X) button at top-right of sidebar
- When closed, flow area takes full width
- Floating "open panel" button at right edge to reopen
- CSS transition for smooth animation

### 3. Search/Filter
- Search input in toolbar with placeholder "Search steps & controls..."
- Matches name, system, owner, description
- Non-matching nodes dim to 30% opacity
- Clear restores all

### 4. Zoom Controls
- Floating panel at bottom-left: +, -, Fit buttons + zoom % display
- Apply via CSS `transform: scale(N)` + `transform-origin: 0 0` on `.canvas`
- Ctrl/Cmd + mouse wheel to zoom

### 5. Print Button
- Printer icon in toolbar, calls `window.print()`

### 6. Export JSON Button
- Download icon in toolbar
- Downloads structured JSON with all process data

## Visual Style — MATCH EXACTLY

### Dark Theme Tokens
```
--bg-deep: #060a13
--bg-surface: rgba(12, 18, 33, 0.9)
--bg-node: rgba(12, 18, 33, 0.85)
--bg-ctrl: rgba(20, 14, 40, 0.85)
--border-dim: rgba(56, 189, 248, 0.08)
--border-glow: rgba(56, 189, 248, 0.15)
--text-primary: rgba(255, 255, 255, 0.92)
--text-secondary: rgba(255, 255, 255, 0.7)
--text-muted: rgba(148, 163, 184, 0.6)
--accent-cyan: #22d3ee
--accent-cyan-soft: #38bdf8
--accent-cyan-bg: rgba(6, 182, 212, 0.2)
--accent-purple: rgba(139, 92, 246, 0.25)
--accent-purple-bg: rgba(139, 92, 246, 0.15)
--panel-bg: rgba(12, 18, 33, 0.95)
```

### Fonts (Google Fonts @import)
```
Heading: 'Syne', sans-serif (600-700)
Body: 'DM Sans', sans-serif
Mono: 'IBM Plex Mono', monospace
```

### Layout
- Tab bar: fixed top, one tab per process, active = cyan accent
- Toolbar: below tab bar, 40px height, glass background. Left: visibility toggles + search. Right: print + export buttons.
- Process page: flow-area (left, flex:1) + detail-panel (right, 30%, min 320px, max 400px)

### Step Node Card
```css
width: 220px; padding: 14px; background: var(--bg-node);
border: 1px solid var(--border-glow); border-radius: 12px;
backdrop-filter: blur(16px); box-shadow: 0 2px 12px rgba(0,0,0,0.3);
cursor: pointer; transition: all 0.25s;
```
- Sequence badge: circular, top-left (-10px), 24px, cyan
- Step name: Syne 13px 600
- System label: IBM Plex Mono 10px muted
- Control count pill: purple bg, mono font
- Critical steps: `border-left: 3px solid #f59e0b`
- Hover: translateY(-2px), brighter border
- Selected: cyan border + glow
- Steps arranged left-to-right, 5 per row, wrap with bezier curve to next row

### Control Node Card
```css
width: 140px; padding: 10px 12px; background: var(--bg-ctrl);
border: 1px solid rgba(148,163,184,0.3); border-radius: 10px;
backdrop-filter: blur(16px);
box-shadow: 0 0 16px rgba(148,163,184,0.08), 0 0 32px rgba(148,163,184,0.04);
text-align: center; cursor: pointer;
```
- All controls default to "untested" health (gray border/glow)
- Shield icon, control name (Syne 11px), type badge pill
- Type badges: preventive=cyan, detective=yellow, corrective=red

### Health Colors
```
healthy:  border=#34d399, glow=rgba(52,211,153,0.25), text=#6ee7b7
at-risk:  border=#fbbf24, glow=rgba(251,191,36,0.25), text=#fde68a
deficient: border=#f87171, glow=rgba(248,113,113,0.25), text=#fca5a5
untested: border=rgba(148,163,184,0.3), glow=rgba(148,163,184,0.08)
```

### Animated SVG Edges
Step-to-step:
- Base path: stroke rgba(56,189,248,0.15), strokeWidth 2
- Dashed overlay: strokeDasharray 6 4, animated stroke-dashoffset
- Animated circles: fill #00e5ff, r=2.5, animateMotion along path

Step-to-control (class `ctrl-edge`):
- Dashed purple: rgba(167,139,250,0.3), strokeDasharray 4 4

### Detail Panel Sidebar
```css
width: 30%; min-width: 320px; max-width: 400px;
background: var(--panel-bg);
border-left: 1px solid rgba(56,189,248,0.35);
box-shadow: -8px 0 40px rgba(0,0,0,0.3);
padding: 24px; overflow-y: auto;
```

### Info Row (sidebar)
- 30x30px icon box: cyan bg, rounded 8px
- Label: IBM Plex Mono 10px muted uppercase, letter-spacing 0.5px
- Value: DM Sans 13px primary

### Type Badges
- Preventive: rgba(56,189,248,0.1) bg, #38bdf8 text
- Detective: rgba(234,179,8,0.1) bg, #eab308 text
- Corrective: rgba(239,68,68,0.1) bg, #ef4444 text
- All: 10px, 600 weight, IBM Plex Mono, uppercase, pill shape

### Print Styles
```css
@media print {
  .tab-bar, .toolbar { display: none !important; }
  .process-page { display: block !important; position: relative !important; top: auto !important; page-break-before: always; height: auto !important; }
  body { background: white; color: black; overflow: visible; }
  .detail-panel { display: none; }
  .step-node { background: white; border-color: #ccc; }
  .ctrl-node { background: #f9f9ff; border-color: #999; }
}
```

## JS Functions Required

```
switchTab(n)           — tab switching
selectNode(proc,type,id) — node selection → sidebar update
setVisibility(mode)    — hidden/badges/compact/expanded toggle
togglePanel()          — show/hide detail sidebar
zoomIn() / zoomOut() / zoomFit() — zoom controls
handleSearch(query)    — search/filter nodes
exportJSON()           — download PROC_DATA as JSON
printReport()          — window.print()
```

Mouse wheel zoom: Ctrl/Cmd + wheel on flow area.

## SVG Icons (inline Lucide paths)
Shield, ShieldCheck, User, Monitor, Tag, Activity, Clock, ChevronDown, ChevronUp, EyeOff, Eye, Layers, Maximize2, Search, Printer, Download, X.

## No External Dependencies (except fonts)
- Google Fonts @import for Syne, DM Sans, IBM Plex Mono
- All CSS inline in `<style>`
- All JS inline in `<script>`
- SVG inline for edges and icons
- No React, no build step, no npm

## Reference Implementation
The latest generated report lives at:
```
~/Desktop/APPs/Process&Controls_Ondemand_Outputs/BASTION/process-controls-report-2026-03-13.html
```
If you need to check the exact HTML structure of a working example, read the most recent file in the client subfolder. The Python generator script is at `~/Desktop/generate_report.py`.
