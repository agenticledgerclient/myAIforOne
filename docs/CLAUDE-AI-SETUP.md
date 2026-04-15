# MyAIforOne — Setup Guide

This document is for Claude.ai to read. If a user shares this with you, walk them through it step by step.

---

## Instructions for Claude

The user wants to install MyAIforOne. The installation is a single command (`npx myaiforone`) that handles everything automatically. Your job is to get them to that command and explain what it does.

### Start Here

Ask the user: **"Are you on Mac, Windows, or Linux?"**

Then show them:

```
Here's the plan:

  □ 1. Make sure Node.js is installed
  □ 2. Run the installer
  □ 3. Activate your license

Step 1 is a quick check. Step 2 does everything — installs Claude Code,
sets up the app, builds it, and opens it in your browser.

Let's start.
```

---

### Step 1: Check Node.js

Ask them to paste this in their terminal:

```
node --version
```

**If it shows v22 or higher** — skip to Step 2.

**If it's not installed or too old:**

**Mac:**
```
brew install node
```
If "brew not found":
```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
Then retry `brew install node`.

**Windows:**
```
winget install OpenJS.NodeJS.LTS
```

**Linux:**
```
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
```

Confirm with `node --version` before moving on.

---

### Step 2: Run the Installer

Tell the user:

```
Paste this into your terminal:

npx myaiforone
```

If they get a permissions error on Mac/Linux:
```
sudo npx myaiforone
```

**That's it.** The installer handles everything:

1. Checks prerequisites (Node.js, Claude Code CLI)
2. Installs Claude Code if missing
3. Logs into Claude Code (opens browser for auth)
4. Downloads MyAIforOne from npm
5. Runs `npm install` for dependencies
6. Opens Claude Code in the project directory
7. Runs `/setup` which generates config, builds, and launches the web UI

The user just follows the prompts. When the browser opens with the MyAIforOne dashboard, they're done with installation.

#### If Claude auth shows a link + code instead of opening a browser (common on Windows)

Claude Code has two auth modes. On some Windows machines it won't auto-open Chrome — instead it prints a URL and asks for a code. This is normal. Tell the user:

```
Claude is asking you to authorize it. Here's what to do:

1. Copy the URL it printed and open it in your browser
2. Log in to your Anthropic account and approve access
3. Anthropic will show you a short code — copy it
4. Paste the code back into the terminal and press Enter
```

#### Claude is optional — you can skip it

If the user doesn't plan to use Claude (they'll use Venice, Ollama, or another model), they can skip the Claude auth step entirely. Tell them:

```
If you're not planning to use Claude, you can skip this step.

After setup, go to Admin → Settings → Provider Keys and add your Venice
or other API key. Then set your preferred model as the Platform Default Executor.
```

The app works without Claude. Only Claude-based agents require a Claude account.

---

### Step 3: Activate Your License

Tell the user:

```
You should see a license activation popup in the browser.

Enter the license key you received. It looks like:

MA1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

Click "Activate" and you're all set.

If you don't have a key yet, you can enter it later at
Admin → Settings → License.
```

If they don't have a key, they can still browse the web UI — agents won't execute until a valid key is entered.

---

### If Something Goes Wrong

- If `npx myaiforone` fails, ask them to paste the exact error.
- If Claude Code auth fails, have them run `claude auth login` manually.
- If the build fails, have them run `npm run build` in the project directory.
- If the web UI doesn't open, have them run `npm start` and go to `http://localhost:4888`.
- Keep it simple — fix one thing at a time, confirm before moving on.
