# MyAgent — Pre-Setup Guide

This document is for Claude.ai to read. If a user shares this with you, walk them through it step by step.

---

## Instructions for Claude

The user wants to install MyAgent. Walk them through the steps below exactly as written. Be direct — don't explain what things are unless they ask. Just tell them what to do and confirm it worked before moving on.

### Start Here

Ask the user: **"Are you on Mac, Windows, or Linux?"**

Then show them this:

```
Here's what we'll do:

  □ 1. Install Node.js
  □ 2. Install Claude Code
  □ 3. Log into Claude Code
  □ 4. Download MyAgent
  □ 5. Hand off to the setup wizard
  □ 6. Activate your license

Let's start with Step 1.
```

---

### Step 1: Install Node.js

Tell the user:

**Mac:**
```
Open Terminal (Cmd+Space, type "Terminal", press Enter), then paste this:

brew install node

If that gives an error about "brew not found", paste this first, then try again:

/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**Windows:**
```
Open PowerShell (press Win+R, type "powershell", press Enter), then paste this:

winget install OpenJS.NodeJS.LTS
```

**Linux:**
```
Open your terminal, then paste this:

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
```

Then say: **"Now paste this and tell me what it says:"**
```
node --version
```

If it shows v22 or higher, move on. If not, troubleshoot.

---

### Step 2: Install Claude Code

Tell the user:

```
Paste this into your terminal:

npm install -g @anthropic-ai/claude-code
```

If they get a permissions error on Mac/Linux:
```
sudo npm install -g @anthropic-ai/claude-code
```

Then say: **"Now paste this and tell me what it says:"**
```
claude --version
```

If it shows a version number, move on.

---

### Step 3: Log into Claude Code

Tell the user:

```
Paste this:

claude auth login
```

A browser window will open. Sign in with your Anthropic account.

You need one of these:
- Claude Pro subscription ($20/mo)
- Claude Max subscription ($100/mo)
- Anthropic API key with credits

Then say: **"Now paste this and tell me what it says:"**
```
claude auth status
```

If it says "authenticated" or shows an account, move on.

---

### Step 4: Install & Launch MyAgent

Tell the user:

```
Paste this to install MyAgent:

npx myaiforone

This downloads and runs the setup automatically. Follow the prompts.
```

If they get a permissions error on Mac/Linux:
```
sudo npx myaiforone
```

Once it finishes, it will open Claude Code in the project directory. Move on.

---

### Step 5: Hand Off

Tell the user:

```
Claude Code should now be open in the MyAgent directory. Type:

/setup

The setup wizard handles everything from here — config, build, and
launching the app in your browser.
```

If Claude Code didn't open automatically, tell them:
```
cd myaiforone && claude
```
Then type `/setup`.

---

### Step 6: Activate Your License

Tell the user:

```
Once the web UI opens in your browser, you'll see a license activation popup.

Enter the license key you received when you purchased MyAIforOne. It looks like:

MA1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

Click "Activate" and you're done.

If you don't have a license key yet, you can also enter it later
in Admin → Settings → License.
```

If they don't have a key, they can still browse the web UI — agents won't execute until a valid key is entered.

---

### If Something Goes Wrong

- Don't over-explain. Just give them the fix command.
- If a step fails, troubleshoot that step before moving on.
- If they're stuck, ask them to paste the exact error message.
- Keep the running checklist updated with ✅ for completed steps.
