#!/usr/bin/env node

/**
 * MyAgent CLI installer
 * Usage: npx myaiforone
 *
 * Checks prerequisites, scaffolds the project, and runs setup.
 * Provides detailed error messages that can be pasted into Claude for help.
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { randomBytes } from 'crypto';
import { homedir, platform as osPlatform } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// ── Helpers ──────────────────────────────────────────────────────────────────

const PLATFORM = osPlatform();
const IS_MAC = PLATFORM === 'darwin';
const IS_WIN = PLATFORM === 'win32';
const IS_LINUX = PLATFORM === 'linux';
const HOME = homedir();
const PLATFORM_NAME = IS_MAC ? 'macOS' : IS_WIN ? 'Windows' : 'Linux';

// DATA_DIR: where config.json and user data live.
// - Windows: %APPDATA%\MyAIforOneGateway  (C:\Users\<user>\AppData\Roaming\MyAIforOneGateway)
// - Mac/Linux: ~/.myaiforone
// - Dev mode (cloned repo): PROJECT_ROOT (no change from before)
const APP_DATA = IS_WIN
  ? (process.env.APPDATA || join(HOME, 'AppData', 'Roaming'))
  : HOME;
const DATA_DIR = existsSync(join(PROJECT_ROOT, '.git'))
  ? PROJECT_ROOT  // dev/cloned-repo mode — use repo root as before
  : IS_WIN
    ? join(APP_DATA, 'MyAIforOneGateway')
    : join(HOME, '.myaiforone');

const STEPS = [
  'Check Node.js',
  'Check Claude Code CLI',
  'Install dependencies',
  'Create MyAIforOne Drive',
  'Generate config',
  'Register platform agents',
  'Build',
  'Start service & open browser',
];

let completedSteps = 0;

function printBanner() {
  console.log('');
  console.log('  ╔══════════════════════════════════╗');
  console.log('  ║        MyAgent Installer          ║');
  console.log('  ╚══════════════════════════════════╝');
  console.log('');
  console.log(`  Platform: ${PLATFORM_NAME}`);
  console.log('');
}

function printChecklist() {
  console.log('');
  for (let i = 0; i < STEPS.length; i++) {
    if (i < completedSteps) {
      console.log(`  ✅ ${i + 1}. ${STEPS[i]}`);
    } else if (i === completedSteps) {
      console.log(`  →  ${i + 1}. ${STEPS[i]}...`);
    } else {
      console.log(`  □  ${i + 1}. ${STEPS[i]}`);
    }
  }
  console.log('');
}

function stepDone(msg) {
  completedSteps++;
  if (msg) console.log(`  ✅ ${msg}`);
}

function fail(step, message, fix) {
  console.error('');
  console.error(`  ❌ FAILED at step ${step + 1}: ${STEPS[step]}`);
  console.error('');
  console.error('  Error:');
  console.error(`  ${message}`);
  console.error('');
  if (fix) {
    console.error('  Fix:');
    console.error(`  ${fix}`);
    console.error('');
  }
  console.error('  ─────────────────────────────────────────────');
  console.error('  If you need help, paste this entire error');
  console.error('  into Claude.ai or Claude Code and it will');
  console.error('  walk you through fixing it.');
  console.error('  ─────────────────────────────────────────────');
  console.error('');
  process.exit(1);
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: opts.silent ? 'pipe' : undefined, ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function mkdirp(p) {
  mkdirSync(p, { recursive: true });
}

// ── Step 0: Check Node.js ────────────────────────────────────────────────────

function checkNode() {
  printChecklist();

  const version = run('node --version', { silent: true });
  if (!version) {
    const fix = IS_MAC
      ? 'Run: brew install node'
      : IS_WIN
        ? 'Run: winget install OpenJS.NodeJS.LTS'
        : 'Run: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs';
    fail(0, 'Node.js is not installed.', fix);
  }

  const major = parseInt(version.replace('v', '').split('.')[0], 10);
  if (major < 22) {
    const fix = IS_MAC
      ? 'Run: brew upgrade node'
      : IS_WIN
        ? 'Run: winget upgrade OpenJS.NodeJS.LTS'
        : 'Visit https://nodejs.org and install v22+';
    fail(0, `Node.js ${version} is too old. Need v22+.`, fix);
  }

  stepDone(`Node.js ${version}`);
}

// ── Step 1: Check Claude Code CLI ────────────────────────────────────────────

async function checkClaude() {
  printChecklist();

  const version = run('claude --version', { silent: true });
  if (version) {
    // Check auth
    const authStatus = run('claude auth status', { silent: true });
    if (authStatus && (authStatus.includes('authenticated') || authStatus.includes('Logged in') || authStatus.includes('Active'))) {
      stepDone(`Claude Code CLI ${version} (authenticated)`);
      return;
    }

    console.log('  Claude Code CLI is installed but not authenticated.');
    await runClaudeAuth(version);
    return;
  }

  // Not installed — install it
  console.log('  Claude Code CLI not found. Installing...');
  console.log('');
  console.log('  Running: npm install -g @anthropic-ai/claude-code');
  console.log('');

  const installResult = run('npm install -g @anthropic-ai/claude-code 2>&1');
  if (!installResult || run('claude --version', { silent: true }) === null) {
    const fix = IS_MAC || IS_LINUX
      ? 'Try: sudo npm install -g @anthropic-ai/claude-code'
      : 'Run PowerShell as Administrator and try again.';
    fail(1, 'Failed to install Claude Code CLI.', fix);
  }

  const newVersion = run('claude --version', { silent: true }) || 'installed';
  console.log(`  Installed Claude Code CLI ${newVersion}`);
  console.log('');
  await runClaudeAuth(newVersion);
}

async function runClaudeAuth(version) {
  console.log('  Running: claude auth login');
  console.log('');
  console.log('  This will either:');
  console.log('    A) Open a browser window automatically — just sign in and come back');
  console.log('    B) Show a URL + ask for a code (common on Windows):');
  console.log('       1. Copy the URL and open it in your browser');
  console.log('       2. Sign in and approve access');
  console.log('       3. Copy the short code shown and paste it back here');
  console.log('');

  let authenticated = false;
  while (!authenticated) {
    try {
      execSync('claude auth login', { stdio: 'inherit' });
      authenticated = true;
    } catch {
      console.log('');
      console.log('  Authentication did not complete.');
      const retry = await ask('  Try again? (y/n) ');
      if (retry.toLowerCase() !== 'y') {
        console.log('');
        console.log('  Skipping Claude authentication. You can run "claude auth login" later.');
        console.log('');
        stepDone('Claude Code CLI (skipped auth)');
        return;
      }
      console.log('');
    }
  }

  stepDone(`Claude Code CLI ${version} (authenticated)`);
}

// ── Step 2: Install dependencies ─────────────────────────────────────────────

function installDeps() {
  printChecklist();

  if (existsSync(join(PROJECT_ROOT, 'node_modules'))) {
    stepDone('Dependencies already installed');
    return;
  }

  console.log('  Running: npm install');
  console.log('');

  try {
    execSync('npm install', { cwd: PROJECT_ROOT, stdio: 'inherit' });
  } catch {
    fail(2,
      'npm install failed.',
      `cd "${PROJECT_ROOT}" and run "npm install" manually. Check the error above.`
    );
  }

  stepDone('Dependencies installed');
}

// ── Step 3: Create MyAIforOne Drive ──────────────────────────────────────────

function createDrive() {
  printChecklist();

  const driveRoot = join(HOME, 'Desktop', 'MyAIforOne Drive');
  const dirs = [
    join(driveRoot, 'PersonalAgents'),
    join(driveRoot, 'PersonalRegistry'),
    join(driveRoot, 'PersonalRegistry', 'skills', 'personal'),
    join(driveRoot, 'PersonalRegistry', 'prompts', 'personal'),
  ];

  const platformAgents = ['hub', 'agentcreator', 'skillcreator', 'appcreator', 'promptcreator', 'gym'];
  for (const agent of platformAgents) {
    dirs.push(join(driveRoot, 'PlatformUtilities', agent, 'memory'));
    dirs.push(join(driveRoot, 'PlatformUtilities', agent, 'FileStorage', 'Temp'));
    dirs.push(join(driveRoot, 'PlatformUtilities', agent, 'FileStorage', 'Permanent'));
  }

  for (const d of dirs) {
    mkdirp(d);
  }

  stepDone('MyAIforOne Drive created');
}

// ── Step 4: Generate config.json ─────────────────────────────────────────────

function generateConfig() {
  printChecklist();

  mkdirp(DATA_DIR);
  const configPath = join(DATA_DIR, 'config.json');
  if (existsSync(configPath)) {
    console.log('  config.json already exists — skipping generation.');
    stepDone('Config already exists');
    return;
  }

  const examplePath = join(PROJECT_ROOT, 'config.example.json');
  if (!existsSync(examplePath)) {
    fail(4, 'config.example.json not found.', `Make sure you're running this from the myAIforOne directory.`);
  }

  const config = JSON.parse(readFileSync(examplePath, 'utf8'));

  // Webhook secret
  config.service.webUI.webhookSecret = randomBytes(16).toString('hex');

  // Disable all channels
  for (const ch of Object.values(config.channels)) {
    ch.enabled = false;
  }

  // Scan platform skills
  const skillsDir = join(PROJECT_ROOT, 'registry', 'skills', 'platform');
  let defaultSkills = [];
  if (existsSync(skillsDir)) {
    defaultSkills = readdirSync(skillsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace('.md', ''));
  }
  config.defaultSkills = defaultSkills;
  config.defaultMcps = [];

  // Add myaiforone-local MCP
  config.mcps['myaiforone-local'] = {
    type: 'stdio',
    command: 'node',
    args: [join(PROJECT_ROOT, 'server', 'mcp-server', 'dist', 'index.js')],
    env: { MYAGENT_API_URL: 'http://localhost:4888' },
  };

  // Empty agents — will be populated in next step
  config.agents = {};
  config.defaultAgent = null;

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  stepDone('Config generated');
}

// ── Step 5: Register platform agents ─────────────────────────────────────────

function registerAgents() {
  printChecklist();

  const configPath = join(DATA_DIR, 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  const driveRoot = join(HOME, 'Desktop', 'MyAIforOne Drive');
  const allTools = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch'];

  // Hub agent
  config.agents.hub = {
    name: 'Hub',
    description: 'The primary AI interface — handles all platform operations through natural conversation.',
    agentHome: join(driveRoot, 'PlatformUtilities', 'hub'),
    claudeMd: join(PROJECT_ROOT, 'agents', 'platform', 'hub', 'CLAUDE.md'),
    memoryDir: join(driveRoot, 'PlatformUtilities', 'hub', 'memory'),
    workspace: join(driveRoot, 'PlatformUtilities', 'hub'),
    persistent: true,
    streaming: true,
    subAgents: '*',
    mcps: ['myaiforone-local'],
    allowedTools: allTools,
    timeout: 14400000,
    autoCommit: false,
    agentClass: 'platform',
    routes: [{ channel: 'web', match: 'default' }],
  };

  config.defaultAgent = 'hub';

  // Creator agents
  const creators = [
    { id: 'agentcreator', name: 'Agent Creator', skills: ['opAgents_AddNew'] },
    { id: 'skillcreator', name: 'Skill Creator', skills: ['MyAgentSkillCreate'] },
    { id: 'appcreator', name: 'App Creator', skills: ['ai41_app_build'] },
    { id: 'promptcreator', name: 'Prompt Creator', skills: [] },
  ];

  for (const c of creators) {
    config.agents[c.id] = {
      name: c.name,
      agentClass: 'platform',
      persistent: true,
      streaming: true,
      mcps: ['myaiforone-local'],
      workspace: join(driveRoot, 'PlatformUtilities', c.id),
      agentHome: join(driveRoot, 'PlatformUtilities', c.id),
      claudeMd: join(PROJECT_ROOT, 'agents', 'platform', c.id, 'CLAUDE.md'),
      memoryDir: join(driveRoot, 'PlatformUtilities', c.id, 'memory'),
      allowedTools: allTools,
      skills: c.skills,
      timeout: 14400000,
      autoCommit: false,
      routes: [],
      org: [{ organization: 'Platform Creators', function: 'Lab', title: 'Creator Agent', reportsTo: '' }],
    };
  }

  // Gym agent — load from agent.json
  const gymJsonPath = join(PROJECT_ROOT, 'agents', 'platform', 'gym', 'agent.json');
  if (existsSync(gymJsonPath)) {
    const gymConfig = JSON.parse(readFileSync(gymJsonPath, 'utf8'));
    const { id, ...gymRest } = gymConfig;
    config.agents.gym = {
      ...gymRest,
      agentHome: join(driveRoot, 'PlatformUtilities', 'gym'),
      claudeMd: join(PROJECT_ROOT, 'agents', 'platform', 'gym', 'CLAUDE.md'),
      memoryDir: join(driveRoot, 'PlatformUtilities', 'gym', 'memory'),
    };
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Validate JSON
  try {
    JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (e) {
    fail(5, `config.json is invalid JSON after agent registration: ${e.message}`, 'This is a bug. Please report it.');
  }

  stepDone('Platform agents registered (hub + 4 creators + gym)');
}

// ── Step 6: Build ────────────────────────────────────────────────────────────

function build() {
  printChecklist();

  console.log('  Running: npm run build');
  console.log('');

  try {
    execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'inherit' });
  } catch {
    fail(6,
      'Build failed. Check the TypeScript errors above.',
      `cd "${PROJECT_ROOT}" and run "npm run build" to see details.`
    );
  }

  stepDone('Build complete');
}

// ── Step 7: Start & open browser ─────────────────────────────────────────────

function startAndOpen() {
  printChecklist();

  // Create desktop shortcut silently
  try {
    if (IS_MAC) {
      const appPath = join(HOME, 'Desktop', 'MyAIforOne.app');
      mkdirp(join(appPath, 'Contents', 'MacOS'));
      mkdirp(join(appPath, 'Contents', 'Resources'));
      writeFileSync(join(appPath, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>MyAIforOne</string>
  <key>CFBundleName</key><string>MyAIforOne</string>
  <key>CFBundleDisplayName</key><string>MyAIforOne</string>
  <key>CFBundleIdentifier</key><string>com.myaiforone.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleIconFile</key><string>MyAIforOne</string>
</dict>
</plist>`);
      writeFileSync(join(appPath, 'Contents', 'MacOS', 'MyAIforOne'), '#!/bin/bash\nopen "http://localhost:4888"\n');
      run(`chmod +x "${join(appPath, 'Contents', 'MacOS', 'MyAIforOne')}"`);
      // Copy icon if bundled with the package
      const icnsSource = join(PROJECT_ROOT, 'assets', 'MyAIforOne.icns');
      if (existsSync(icnsSource)) {
        copyFileSync(icnsSource, join(appPath, 'Contents', 'Resources', 'MyAIforOne.icns'));
      }
    } else if (IS_WIN) {
      const icoSource = join(PROJECT_ROOT, 'assets', 'MyAIforOne.ico');
      const iconArg = existsSync(icoSource) ? `$s.IconLocation = '${icoSource.replace(/\\/g, '\\\\')}'; ` : '';
      // Windows shortcut via PowerShell
      run(`powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('${join(HOME, 'Desktop', 'MyAIforOne.lnk').replace(/\\/g, '\\\\')}'); $s.TargetPath = 'http://localhost:4888'; $s.Description = 'Open MyAIforOne Web UI'; ${iconArg}$s.Save()"`);
    }
  } catch {
    // Shortcut creation is non-critical
  }

  // Install tray/menu bar indicator (non-blocking — skip silently on failure)
  try {
    if (IS_MAC) {
      // Copy xbar plugin if xbar is installed
      const xbarDir = join(HOME, 'Library', 'Application Support', 'xbar', 'plugins');
      if (existsSync(xbarDir)) {
        copyFileSync(
          join(PROJECT_ROOT, 'scripts', 'xbar-myagent.5s.sh'),
          join(xbarDir, 'xbar-myagent.5s.sh')
        );
        run(`chmod +x "${join(xbarDir, 'xbar-myagent.5s.sh')}"`);
        console.log('  ✅ Menu bar indicator installed (xbar)');
      }
    } else if (IS_WIN) {
      // Launch PowerShell tray app hidden
      const trayScript = join(PROJECT_ROOT, 'scripts', 'tray-indicator.ps1');
      if (existsSync(trayScript)) {
        const tray = spawn('powershell', ['-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', trayScript], {
          detached: true,
          stdio: 'ignore',
        });
        tray.unref();
        console.log('  ✅ System tray indicator launched');
      }
    }
  } catch {
    // Tray indicator is non-critical
  }

  // Start the service — fully detached so it survives after this CLI exits
  console.log('  Starting service...');
  const child = spawn('node', ['dist/index.js'], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, MYAGENT_DATA_DIR: DATA_DIR },
  });
  child.unref();

  // Poll /health until the service is ready (up to 20 seconds)
  let attempts = 0;
  const maxAttempts = 40;
  const poll = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch('http://localhost:4888/health', { signal: AbortSignal.timeout(800) });
      if (res.ok) {
        clearInterval(poll);
        stepDone('Service running');
        openBrowser();
        printFinal();
        return;
      }
    } catch { /* not ready yet */ }

    if (attempts >= maxAttempts) {
      clearInterval(poll);
      console.log('  Service started (waiting for full init).');
      openBrowser();
      printFinal();
    }
  }, 500);
}

function openBrowser() {
  const url = 'http://localhost:4888/monitor';
  try {
    if (IS_MAC) run(`open "${url}"`);
    else if (IS_WIN) run(`start "" "${url}"`);
    else run(`xdg-open "${url}"`);
  } catch {
    console.log(`  Open ${url} in your browser.`);
  }
}

function printFinal() {
  completedSteps = STEPS.length;
  printChecklist();

  console.log('  ╔══════════════════════════════════╗');
  console.log('  ║         Setup complete!           ║');
  console.log('  ╚══════════════════════════════════╝');
  console.log('');
  console.log('  Web UI:   http://localhost:4888');
  console.log('  Monitor:  http://localhost:4888/monitor');
  console.log('');
  console.log('  The browser should have opened to the Monitor page.');
  console.log('  Click "Start Setup" and the hub agent will walk you');
  console.log('  through connecting channels and creating your first agent.');
  console.log('');
  if (IS_WIN) {
    console.log('  Look for the green icon in your system tray (bottom-right');
    console.log('  of your taskbar) — right-click it to restart, stop, or');
    console.log('  open the app anytime.');
    console.log('');
  } else if (IS_MAC) {
    console.log('  If you have xbar installed, look for the green dot in');
    console.log('  your menu bar for quick service control.');
    console.log('');
  }
  console.log('  Quick commands:');
  console.log(`    cd "${PROJECT_ROOT}"`);
  console.log('    npm start              — start manually');
  console.log('    npm run dev            — dev mode');
  console.log('    http://localhost:4888   — web dashboard');
  console.log('');

  process.exit(0);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  printBanner();

  // ── Version check — warn if running a stale cached version ───────
  try {
    const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
    const localVersion = pkg.version;
    const res = await fetch('https://registry.npmjs.org/myaiforone/latest', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const latestVersion = data.version;
      if (localVersion !== latestVersion) {
        console.log('  ⚠  You\'re running myaiforone@' + localVersion + ' but ' + latestVersion + ' is available.');
        console.log('  ⚠  Run: npx myaiforone@latest');
        console.log('  ⚠  Or:  npx clear-npx-cache && npx myaiforone');
        console.log('');
        const answer = await ask('  Continue with ' + localVersion + ' anyway? (y/n) ');
        if (answer.toLowerCase() !== 'y') {
          console.log('');
          console.log('  Run: npx myaiforone@latest');
          console.log('');
          process.exit(0);
        }
        console.log('');
      }
    }
  } catch { /* network unavailable — skip version check */ }

  console.log('  Here\'s what we\'ll do:');
  console.log('');
  for (let i = 0; i < STEPS.length; i++) {
    console.log(`  □  ${i + 1}. ${STEPS[i]}`);
  }
  console.log('');
  console.log('  This takes a couple of minutes. Let\'s go!');

  checkNode();
  await checkClaude();
  installDeps();
  createDrive();
  generateConfig();
  registerAgents();
  build();
  startAndOpen();
}

main().catch((e) => {
  console.error('');
  console.error(`  ❌ Unexpected error: ${e.message}`);
  console.error('');
  console.error('  Paste this into Claude.ai or Claude Code for help:');
  console.error(`  ${e.stack}`);
  console.error('');
  process.exit(1);
});
