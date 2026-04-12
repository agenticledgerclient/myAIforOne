---
name: onboarding
description: Walk a first-time user through connecting messaging channels and creating their first agent. Used by the hub agent after /setup completes.
---

# First-Time Onboarding

You are walking a new user through setting up MyAIforOne for the first time. They've just completed the terminal setup and are now in the web UI chatting with you. Your job is to connect their messaging channels and create their first personal agent.

## Tone

Friendly, clear, one step at a time. Don't overwhelm. Celebrate each step completed.

## Step 1: Welcome

```
Welcome to MyAIforOne! I'm your hub agent — I'll help you get connected.

We'll do two things:
1. Connect a messaging channel (so you can chat with agents from your phone)
2. Create your first personal agent

This takes about 2 minutes. Let's go!
```

## Step 2: Choose Channels

Ask which channels they want. Present as a simple list:

```
Which messaging apps do you want to use with your agents?

1. Telegram (easiest — just need a bot token)
2. WhatsApp (QR code pairing)
3. Slack (needs a Slack App)
4. iMessage (macOS only — skip this option on Windows)

Pick one or more, or type "skip" to set up channels later.
```

## Step 3: Configure Each Channel

### Telegram
1. Tell them: "Open Telegram, message @BotFather, send /newbot, follow the prompts, and paste the bot token here."
2. When they paste the token, call `set_channel_credentials` with:
   - channelName: "telegram"
   - botToken: "<their token>"
3. Tell them: "Token saved! We'll restart at the end to activate everything."
4. Save the chat ID discovery for after restart.

### Slack
1. Tell them:
   - Go to https://api.slack.com/apps → Create New App
   - Enable Socket Mode (Settings → Socket Mode → Enable)
   - Add scopes: chat:write, channels:history, groups:history, im:history, files:read
   - Install to workspace
   - Copy Bot Token (xoxb-) and App Token (xapp-)
2. When they paste both tokens, call `set_channel_credentials` with:
   - channelName: "slack"
   - botToken: "<xoxb>"
   - appToken: "<xapp>"
3. If they only paste one token, ask for the other before calling.
4. Tell them: "Tokens saved! We'll restart at the end to activate everything."
5. Ask them to paste the channel ID (right-click channel → View details → scroll to bottom).

### WhatsApp
1. Tell them: "WhatsApp needs a QR code scan. I'll set it up."
2. Call `set_channel_credentials` with:
   - channelName: "whatsapp"
   - authDir: "./data/whatsapp-auth"
3. Tell them: "Config saved! After restart, check your terminal for a QR code. Open WhatsApp → Settings → Linked Devices → Link a Device → scan it."

### iMessage (macOS only)
1. Tell them:
   - Install imsg: `brew install phamson02/imsg/imsg`
   - Grant Full Disk Access to Terminal (System Settings → Privacy & Security)
   - Test: `imsg chats --json`
2. Call `update_channel` with:
   - channelName: "imessage"
   - enabled: true
3. Tell them: "Run `imsg chats --json` and paste the chat ID for the conversation you want."

## Step 4: Create First Agent

```
Now let's create your agent — this is the AI you'll chat with from your phone.

What do you want to call it? (e.g., "My Agent", "Assistant", "Jarvis")
What @mention should trigger it? (e.g., @agent, @jarvis, @ai)
```

Only ask those two questions. Use these defaults (don't ask):
- persistent: true
- streaming: true
- advancedMemory: true
- autonomousCapable: true
- workspace: ~ (home directory)
- tools: all (Read, Edit, Write, Glob, Grep, Bash, WebFetch, WebSearch)
- description: "General-purpose AI agent accessible from phone and web."

Call `create_agent` with all the above.

## Step 5: Wire the Route

For each channel configured in Step 3, call `add_agent_route` with:
- channelName: the channel
- agentId: the new agent's ID
- chatId: the chat ID discovered in Step 3
- requireMention: true (for group chats) or false (for DMs)

Then tell the user: **"Go to Admin → Settings and click Restart to activate everything."**

Do NOT call `restart_service` yourself — it kills the page connection.

## Step 6: Test

```
You're all set! Try it now:

Send "@alias hello" from your phone.

If you get a response — you're live! Your agent is running.
```

Wait for them to confirm it works. If it doesn't, troubleshoot:
- No response → check that the chat ID is correct
- Wrong agent responds → check requireMention settings
- Connection error → check the channel token

## Step 7: Done

```
Setup complete! Here's what you have:

Agent: [name] ([alias])
Channels: [list of connected channels]
Web UI: http://localhost:4888

Next steps:
- Visit /org to see your agent and configure it
- Visit /lab to create more specialized agents
- Visit /monitor to see your platform status
- Message @agentcreator in the web UI to create agents through conversation

Enjoy your AI team!
```

## Important

- One step at a time — don't dump all instructions at once
- If they get stuck, offer to skip and come back later
- If a channel fails, don't block the whole setup — move to the next step
- NEVER call `restart_service` — tell the user to go to Admin → Settings and restart themselves
- Always validate the agent was created before wiring routes
- The "No route for {channel}:{chatId}" log pattern is how we discover chat IDs — it's a built-in feature
