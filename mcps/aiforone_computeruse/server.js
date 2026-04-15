#!/usr/bin/env node
/**
 * aiforone_computeruse MCP Server
 *
 * Cross-platform computer control: screenshot, mouse, keyboard, app launch.
 * Works on macOS, Windows, and Linux.
 *
 * Tools:
 *   computer_screenshot         — capture screen, returns base64 image inline
 *   computer_get_info           — screen dimensions + platform
 *   computer_check_permissions  — verify accessibility is granted (macOS)
 *   computer_click              — left/right/middle click at (x, y)
 *   computer_double_click       — double-click at (x, y)
 *   computer_move               — move mouse cursor to (x, y)
 *   computer_scroll             — scroll at (x, y) in a direction
 *   computer_type               — type text at current cursor position
 *   computer_key                — press key or combo (e.g. "cmd+c", "ctrl+v", "enter")
 *   computer_open               — launch an app by name
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "child_process";
import { promises as fs } from "fs";
import { tmpdir, platform } from "os";
import { join } from "path";

const PLT = platform();

const server = new McpServer({
  name: "aiforone_computeruse",
  version: "1.0.0",
});

// ─── Lazy-load nut.js (large native dep — only loaded when needed) ────────────

let _nut = null;
async function getNut() {
  if (_nut) return _nut;
  try {
    _nut = await import("@nut-tree-fork/nut-js");
    return _nut;
  } catch {
    throw new Error(
      "nut.js not installed. Run: cd mcps/aiforone_computeruse && npm install"
    );
  }
}

// ─── Screenshot ──────────────────────────────────────────────────────────────

server.tool(
  "computer_screenshot",
  "Take a screenshot of the screen. Returns a base64 PNG image the agent can see directly.",
  {},
  async () => {
    const tmpFile = join(tmpdir(), `cu_screenshot_${Date.now()}.png`);
    try {
      if (PLT === "darwin") {
        execSync(`/usr/sbin/screencapture -x "${tmpFile}"`, { timeout: 10_000 });
      } else if (PLT === "win32") {
        // PowerShell screen capture
        const ps = [
          "Add-Type -AssemblyName System.Windows.Forms",
          "Add-Type -AssemblyName System.Drawing",
          "$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
          "$bmp = New-Object System.Drawing.Bitmap($s.Width, $s.Height)",
          "$g = [System.Drawing.Graphics]::FromImage($bmp)",
          "$g.CopyFromScreen($s.Location, [System.Drawing.Point]::Empty, $s.Size)",
          `$bmp.Save('${tmpFile.replace(/\\/g, "\\\\")}')`,
          "$g.Dispose(); $bmp.Dispose()",
        ].join("; ");
        execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 15_000 });
      } else {
        // Linux — try scrot, fallback to import (ImageMagick)
        try {
          execSync(`scrot "${tmpFile}"`, { timeout: 10_000 });
        } catch {
          execSync(`import -window root "${tmpFile}"`, { timeout: 10_000 });
        }
      }
      const data = await fs.readFile(tmpFile);
      return {
        content: [{ type: "image", data: data.toString("base64"), mimeType: "image/png" }],
      };
    } finally {
      fs.unlink(tmpFile).catch(() => {});
    }
  }
);

// ─── Screen info ─────────────────────────────────────────────────────────────

server.tool(
  "computer_get_info",
  "Get screen width, height, and platform. Call this before clicking to understand coordinate space.",
  {},
  async () => {
    const { screen } = await getNut();
    const width = await screen.width();
    const height = await screen.height();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ platform: PLT, width, height }),
        },
      ],
    };
  }
);

// ─── Permissions check ───────────────────────────────────────────────────────

server.tool(
  "computer_check_permissions",
  "Check if the agent has the necessary system permissions to control the computer. Run this first on a new install.",
  {},
  async () => {
    if (PLT !== "darwin") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              platform: PLT,
              message: "No special permissions required on this platform.",
            }),
          },
        ],
      };
    }
    try {
      const { mouse } = await getNut();
      await mouse.getPosition();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              platform: "darwin",
              message: "Accessibility permission granted. Computer use is ready.",
            }),
          },
        ],
      };
    } catch {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              platform: "darwin",
              message: "Accessibility permission NOT granted.",
              fix: "Go to System Settings → Privacy & Security → Accessibility → click + and add your Terminal app (or the app running this agent). Then call computer_check_permissions again.",
            }),
          },
        ],
      };
    }
  }
);

// ─── Mouse: click ────────────────────────────────────────────────────────────

server.tool(
  "computer_click",
  "Click at screen coordinates. Take a screenshot first to identify the correct (x, y).",
  {
    x: z.number().describe("X coordinate in logical pixels"),
    y: z.number().describe("Y coordinate in logical pixels"),
    button: z
      .enum(["left", "right", "middle"])
      .optional()
      .default("left")
      .describe("Mouse button to click"),
  },
  async ({ x, y, button }) => {
    const { mouse, Button, Point } = await getNut();
    await mouse.setPosition(new Point(x, y));
    const btn =
      button === "right"
        ? Button.RIGHT
        : button === "middle"
        ? Button.MIDDLE
        : Button.LEFT;
    await mouse.click(btn);
    return { content: [{ type: "text", text: `Clicked ${button} at (${x}, ${y})` }] };
  }
);

// ─── Mouse: double click ─────────────────────────────────────────────────────

server.tool(
  "computer_double_click",
  "Double-click at screen coordinates.",
  {
    x: z.number().describe("X coordinate in logical pixels"),
    y: z.number().describe("Y coordinate in logical pixels"),
  },
  async ({ x, y }) => {
    const { mouse, Button, Point } = await getNut();
    await mouse.setPosition(new Point(x, y));
    await mouse.doubleClick(Button.LEFT);
    return { content: [{ type: "text", text: `Double-clicked at (${x}, ${y})` }] };
  }
);

// ─── Mouse: move ─────────────────────────────────────────────────────────────

server.tool(
  "computer_move",
  "Move the mouse cursor to coordinates without clicking.",
  {
    x: z.number().describe("X coordinate"),
    y: z.number().describe("Y coordinate"),
  },
  async ({ x, y }) => {
    const { mouse, Point } = await getNut();
    await mouse.setPosition(new Point(x, y));
    return { content: [{ type: "text", text: `Moved mouse to (${x}, ${y})` }] };
  }
);

// ─── Mouse: scroll ───────────────────────────────────────────────────────────

server.tool(
  "computer_scroll",
  "Scroll at screen coordinates in a direction.",
  {
    x: z.number().describe("X coordinate to scroll at"),
    y: z.number().describe("Y coordinate to scroll at"),
    direction: z.enum(["up", "down", "left", "right"]),
    amount: z
      .number()
      .optional()
      .default(3)
      .describe("Number of scroll clicks (default: 3)"),
  },
  async ({ x, y, direction, amount }) => {
    const { mouse, Point } = await getNut();
    await mouse.setPosition(new Point(x, y));
    for (let i = 0; i < amount; i++) {
      if (direction === "up") await mouse.scrollUp(1);
      else if (direction === "down") await mouse.scrollDown(1);
      else if (direction === "left") await mouse.scrollLeft(1);
      else await mouse.scrollRight(1);
    }
    return {
      content: [{ type: "text", text: `Scrolled ${direction} ${amount}x at (${x}, ${y})` }],
    };
  }
);

// ─── Keyboard: type text ──────────────────────────────────────────────────────

server.tool(
  "computer_type",
  "Type text at the current cursor position. Click a text field first.",
  {
    text: z.string().describe("Text to type"),
  },
  async ({ text }) => {
    const { keyboard } = await getNut();
    await keyboard.type(text);
    return { content: [{ type: "text", text: `Typed: ${JSON.stringify(text)}` }] };
  }
);

// ─── Keyboard: key combo ──────────────────────────────────────────────────────

server.tool(
  "computer_key",
  "Press a key or keyboard shortcut. Examples: 'enter', 'tab', 'escape', 'cmd+c', 'ctrl+v', 'ctrl+alt+t', 'alt+tab'.",
  {
    key: z
      .string()
      .describe(
        "Key or combo using + as separator. Modifiers: ctrl/cmd/alt/shift. Special: enter, tab, escape, space, backspace, delete, up, down, left, right, home, end, pageup, pagedown, f1-f12"
      ),
  },
  async ({ key }) => {
    const { keyboard, Key } = await getNut();

    const keyMap = {
      ctrl: Key.LeftControl,
      control: Key.LeftControl,
      cmd: Key.LeftSuper,
      command: Key.LeftSuper,
      meta: Key.LeftSuper,
      win: Key.LeftSuper,
      alt: Key.LeftAlt,
      option: Key.LeftAlt,
      shift: Key.LeftShift,
      enter: Key.Return,
      return: Key.Return,
      tab: Key.Tab,
      escape: Key.Escape,
      esc: Key.Escape,
      space: Key.Space,
      backspace: Key.Backspace,
      delete: Key.Delete,
      del: Key.Delete,
      up: Key.Up,
      down: Key.Down,
      left: Key.Left,
      right: Key.Right,
      home: Key.Home,
      end: Key.End,
      pageup: Key.PageUp,
      pagedown: Key.PageDown,
      f1: Key.F1, f2: Key.F2, f3: Key.F3, f4: Key.F4,
      f5: Key.F5, f6: Key.F6, f7: Key.F7, f8: Key.F8,
      f9: Key.F9, f10: Key.F10, f11: Key.F11, f12: Key.F12,
      a: Key.A, b: Key.B, c: Key.C, d: Key.D, e: Key.E,
      f: Key.F, g: Key.G, h: Key.H, i: Key.I, j: Key.J,
      k: Key.K, l: Key.L, m: Key.M, n: Key.N, o: Key.O,
      p: Key.P, q: Key.Q, r: Key.R, s: Key.S, t: Key.T,
      u: Key.U, v: Key.V, w: Key.W, x: Key.X, y: Key.Y, z: Key.Z,
      "0": Key.Num0, "1": Key.Num1, "2": Key.Num2, "3": Key.Num3,
      "4": Key.Num4, "5": Key.Num5, "6": Key.Num6, "7": Key.Num7,
      "8": Key.Num8, "9": Key.Num9,
    };

    const parts = key.toLowerCase().split("+").map((k) => k.trim());
    const keys = parts.map((p) => keyMap[p]).filter(Boolean);

    if (keys.length === 0) {
      throw new Error(
        `Unknown key: "${key}". Use names like enter, tab, escape, cmd+c, ctrl+v, alt+tab.`
      );
    }

    await keyboard.pressKey(...keys);
    await keyboard.releaseKey(...keys);

    return { content: [{ type: "text", text: `Pressed: ${key}` }] };
  }
);

// ─── App launch ───────────────────────────────────────────────────────────────

server.tool(
  "computer_open",
  "Open an application by name. Cross-platform: works on macOS, Windows, and Linux.",
  {
    app: z
      .string()
      .describe(
        "App name or path. macOS: 'Spotify', 'Google Chrome', 'Terminal'. Windows: 'notepad', 'calc', 'chrome.exe'. Linux: 'firefox', 'gedit'."
      ),
  },
  async ({ app }) => {
    try {
      if (PLT === "darwin") {
        execSync(`/usr/bin/open -a "${app}"`, { timeout: 8_000 });
      } else if (PLT === "win32") {
        execSync(`start "" "${app}"`, { shell: true, timeout: 8_000 });
      } else {
        execSync(`xdg-open "${app}"`, { timeout: 8_000 });
      }
      return { content: [{ type: "text", text: `Opened: ${app}` }] };
    } catch (err) {
      throw new Error(`Could not open "${app}": ${err.message}`);
    }
  }
);

// ─── Start server ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
