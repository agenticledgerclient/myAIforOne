---
name: opMCPExpose
description: Take an existing stdio MCP server and expose it as a Streamable HTTP server with a public URL. Dual-mode auth (Bearer passthrough + OAuth 2.0 Client Credentials) so it works with Claude Code, Claude Desktop, AND Claude.ai Cowork/agent platforms. Duplicates the MCP into a new folder, adds Express + Streamable HTTP transport, creates a GitHub repo under agenticledger org, deploys to Railway, and tests end-to-end. No hardcoded API keys on the server. Use when someone asks for an MCP server URL or you need to expose an MCP over HTTP.
---

# MCP Expose — Stdio to Streamable HTTP

Convert any existing stdio-based MCP server into a publicly accessible HTTP MCP server with dual-mode auth (Bearer passthrough + OAuth 2.0 Client Credentials).

## Auth Model

**The server stores NO permanent credentials.** Two auth modes are supported:

1. **Bearer Passthrough** — Client sends `Authorization: Bearer <their-api-key>` directly. The server extracts and uses it as-is. For Claude Code, Claude Desktop, and direct API clients.

2. **OAuth 2.0 Client Credentials** — Client POSTs to `/oauth/token` with `client_id=<slug>&client_secret=<their-api-key>&grant_type=client_credentials`, gets back a time-limited `mcp_`-prefixed token, then uses that as the Bearer token. For Claude.ai Cowork and agent platforms that require OAuth.

OAuth tokens are in-memory only (Map), expire after 1 hour, and are cleared on server restart. The `client_id` is always the server's slug (e.g., `smartsheets`, `stripe`). The `client_secret` IS the user's actual API key. Auto-detection: if a Bearer token starts with `mcp_`, it's an OAuth token; otherwise it's a raw API key.

## Credentials

| Service | Value |
|---------|-------|
| **GitHub PAT** (agenticledger org) | `ghp_REDACTED` |
| **Railway API Token** | `6420ab05-a0db-47ce-8fce-7dac088329f1` |
| **Railway Project** | FinanceMCPs (`3230ac49-2b3c-4e8f-a266-3fcf93b0b51f`) |
| **Railway Environment** | production (`c511b016-571a-4176-8e13-e23afdd586c9`) |

## Output Location

All exposed servers go to: `/tmp/<service-name>-mcp-http` (built and pushed to GitHub, then deployed from there)

## Cross-Platform Paths

**This skill runs on both Mac and Windows.** Detect platform first.

| Resource | Windows | Mac |
|----------|---------|-----|
| **Exposed MCPs** | `C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\General\Exposed\` | `/Users/oreph/Desktop/APPs/financestackmcps/General/Exposed/` |
| **MCPLive** | `C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\MCPLive\` | `/Users/oreph/Desktop/APPs/financestackmcps/MCPLive/` |
| **FinanceStackMCPs** | `C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\` | `/Users/oreph/Desktop/APPs/financestackmcps/` |
| **Gateway** | N/A | `/Users/oreph/Desktop/APPs/channelToAgentToClaude/` |
| **Logo** | `C:\Users\oreph\Documents\AgenticLedger\logos\agenticledger_icon.png` | Copy from any existing exposed server's `src/public/logo.png` |

## Arguments

The user provides:
1. **Source MCP path** — path to existing stdio MCP server (contains `src/index.ts`, `src/api-client.ts`, `src/tools.ts`)
2. **Service name** — e.g., "Smartsheets", "Stripe", "Brex" (used for folder name, repo name, Railway service name)

If not provided, ask for them.

---

## MANDATORY: Build Checklist

**At the START of every expose run, create `BUILD_CHECKLIST.md` in the exposed folder.** Update each item as you complete it. This is NOT optional.

```markdown
# MCP Expose Checklist — {{SERVICE_NAME}}

## Server Info
- **Source MCP:** {{SOURCE_PATH}}
- **Service Name:** {{SERVICE_NAME}}
- **API Client Class:** {{CLASS_NAME}}
- **Constructor Args:** {{e.g., "apiKey: string"}}
- **Tool Count:** {{N}}
- **Target Directory:** {{EXPOSED_PATH}}
- **Started:** {{DATE}}

## Phase 1: Read Source
- [ ] Read api-client.ts — identified class name and constructor
- [ ] Read tools.ts — confirmed tool count
- [ ] Read index.ts — confirmed stdio transport
- [ ] Read package.json — noted dependencies
- [ ] Read tsconfig.json — noted config

## Phase 2: Scaffold
- [ ] Created target directory
- [ ] Created package.json (with express added, build copies public assets)
- [ ] Created tsconfig.json
- [ ] Created .gitignore (includes DEPLOYMENT.md)
- [ ] Created .env.example (PORT only, no API keys)
- [ ] Copied api-client.ts (unchanged)
- [ ] Copied tools.ts (unchanged)
- [ ] Created src/public/ with AgenticLedger logo
- [ ] Created index.ts with Streamable HTTP transport + dual-mode auth + branded UI
- [ ] Auth model: Dual-mode (Bearer passthrough + OAuth Client Credentials)
- [ ] OAuth endpoints: /.well-known/oauth-authorization-server, /oauth/token, /oauth/revoke
- [ ] SLUG constant set to correct service slug
- [ ] Replaced all placeholders with actual values

## Phase 3: Build & Local Test
- [ ] npm install — 0 vulnerabilities
- [ ] npx tsc — 0 errors
- [ ] Smoke test: server starts, shows correct tool count
- [ ] Smoke test: shows "Dual-mode" auth
- [ ] Smoke test: OAuth discovery endpoint returns valid JSON
- [ ] Smoke test: OAuth token exchange works
- [ ] Smoke test: MCP init works with OAuth token

## Phase 4: GitHub
- [ ] git init + commit
- [ ] Created repo under agenticledger org
- [ ] Pushed to main branch

## Phase 5: Railway Deploy
- [ ] Created service in FinanceMCPs project
- [ ] Set PORT=3100 env var
- [ ] Connected GitHub repo
- [ ] Deployment status: SUCCESS
- [ ] Created public railway domain
- [ ] Railway domain URL: {{RAILWAY_DOMAIN}}

## Phase 5.5: Custom Domain + DNS
- [ ] Created custom domain on Railway: {{SERVICE_NAME}}mcp.agenticledger.ai
- [ ] Set SERVER_BASE_URL env var
- [ ] Got verification token from Railway
- [ ] Added CNAME record to Namecheap: {{SERVICE_NAME}}mcp → {{RAILWAY_CNAME_TARGET}}
- [ ] Added TXT record to Namecheap: _railway-verify.{{SERVICE_NAME}}mcp → railway-verify={{TOKEN}}
- [ ] DNS propagation verified (dig CNAME)
- [ ] Custom domain URL: https://{{SERVICE_NAME}}mcp.agenticledger.ai

## Phase 6: End-to-End Tests
- [ ] GET / returns JSON with name, tools, auth.type: "dual-mode", configTemplate
- [ ] Health check returns 200 with auth: "dual-mode" and auth_modes array
- [ ] OAuth discovery (/.well-known/oauth-authorization-server) returns valid JSON
- [ ] POST /mcp without auth returns 401 with both auth modes in error
- [ ] Bearer passthrough: MCP initialize works with raw API key
- [ ] OAuth flow: token exchange returns mcp_-prefixed token
- [ ] OAuth flow: MCP initialize works with exchanged token
- [ ] OAuth errors: wrong client_id rejected, missing secret rejected, invalid token rejected
- [ ] Token revocation works
- [ ] (Optional) Live API call with real credentials works

## Phase 7: Documentation
- [ ] Created DEPLOYMENT.md (gitignored)
- [ ] Includes MCP URL, auth instructions, client config

## Phase 7.5: MCPLive Connect Button
- [ ] Added connectUrl + connectLabel to SERVERS entry in MCPLive build.js
- [ ] Rebuilt MCPLive (npm run build)
- [ ] Committed and pushed MCPLive
- [ ] Connect button visible on financemcps.agenticledger.ai/<slug>/

## Phase 8.5: MyAgent Gateway Registration (skip if gateway not on this machine)
- [ ] Gateway found at ~/Desktop/APPs/channelToAgentToClaude/ (or mark SKIPPED)
- [ ] Added MCP entry to gateway config.json mcps block
- [ ] Validated config JSON loads correctly
- [ ] Service name in gateway: {{SERVICE_NAME}}
- [ ] Key variable: ${UPPER_SNAKE_KEY}
- [ ] Added to mcp-catalog.json (or SKIPPED)
- [ ] Added to config.example.json (or SKIPPED)

## Final Validation
- [ ] All Phase 1-8.5 items checked (8.5 may be SKIPPED)
- [ ] Server is live and responding at public URL
- [ ] No service credentials stored on the server
- [ ] BUILD_CHECKLIST.md fully complete
```

**Update this checklist after each phase.** At the end (Phase 8.5), validate every box is checked.

---

## Phase 1: Read Source MCP

Read the existing MCP server to understand its structure:

```
Read: {source}/src/api-client.ts    — the API client class
Read: {source}/src/tools.ts         — tool definitions
Read: {source}/src/index.ts         — current stdio setup
Read: {source}/package.json         — dependencies
Read: {source}/tsconfig.json        — TS config
```

**Identify:**
- The API client class name (e.g., `SmartsheetClient`)
- Constructor signature — what credential(s) it takes (usually 1 API key string)
- All dependencies
- Number of tools

---

## Phase 2: Scaffold Exposed Server

Create the folder (use platform-appropriate Exposed MCPs path from table above, or `/tmp/<service-name>-mcp-http` for temp builds):

### Files to create:

**1. `package.json`** — Same deps as source, plus `express` and `@types/express`:
```json
{
  "name": "<service-name>-mcp-http",
  "version": "1.0.0",
  "description": "<ServiceName> MCP Server — Exposed via Streamable HTTP transport",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc && mkdir -p dist/public && cp -r src/public/* dist/public/",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.0",
    "express": "^4.21.0",
    "zod": "^3.22.4",
    "zod-to-json-schema": "^3.22.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^20.10.0",
    "tsx": "^4.21.0",
    "typescript": "^5.3.0"
  }
}
```

**2. `tsconfig.json`** — Copy from source.

**3. `.gitignore`**:
```
node_modules/
dist/
.env
DEPLOYMENT.md
```

**4. `.env.example`**:
```
# Server port (default: 3100)
PORT=3100

# No API keys needed — clients pass their own credentials via Bearer token
```

**5. `src/public/logo.png`** — Copy the AgenticLedger logo:
```bash
mkdir -p src/public
cp "C:\Users\oreph\Documents\AgenticLedger\logos\agenticledger_icon.png" src/public/logo.png
```

**6. `src/api-client.ts`** — Copy EXACTLY from source. No changes.

**7. `src/tools.ts`** — Copy EXACTLY from source. No changes.

**8. `src/index.ts`** — THE KEY FILE. This replaces the stdio transport with Express + Streamable HTTP. Template:

```typescript
#!/usr/bin/env node
/**
 * <ServiceName> MCP Server — Exposed via Streamable HTTP
 *
 * Auth model: Dual-mode — supports both direct Bearer passthrough
 * and OAuth 2.0 Client Credentials grant.
 * No permanent credentials are stored on the server.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema as _zodToJsonSchema } from 'zod-to-json-schema';
import { <ApiClientClass> } from './api-client.js';
import { tools } from './tools.js';

function zodToJsonSchema(schema: any): any {
  return _zodToJsonSchema(schema);
}

const PORT = parseInt(process.env.PORT || '3100', 10);
const SERVER_BASE_URL = process.env.SERVER_BASE_URL || `http://localhost:${PORT}`;
const SLUG = '<service-slug>';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- OAuth token store (in-memory, ephemeral) ---
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

interface OAuthToken {
  apiKey: string;
  expiresAt: number;
}

const oauthTokens = new Map<string, OAuthToken>();

// Cleanup expired tokens every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of oauthTokens) {
    if (now > data.expiresAt) oauthTokens.delete(token);
  }
}, 10 * 60 * 1000);

// --- Static assets (logo) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/static', express.static(path.join(__dirname, 'public')));

// Health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    server: '<service-name>-mcp-http',
    version: '1.0.0',
    tools: tools.length,
    transport: 'streamable-http',
    auth: 'dual-mode',
    auth_modes: ['bearer-passthrough', 'oauth-client-credentials'],
  });
});

// --- OAuth 2.0 Discovery ---
app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.json({
    issuer: SERVER_BASE_URL,
    token_endpoint: `${SERVER_BASE_URL}/oauth/token`,
    revocation_endpoint: `${SERVER_BASE_URL}/oauth/revoke`,
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
    response_types_supported: ['token'],
    service_documentation: `https://financemcps.agenticledger.ai/${SLUG}/`,
  });
});

// --- OAuth 2.0 Token Exchange ---
app.post('/oauth/token', (req, res) => {
  const { grant_type, client_id, client_secret } = req.body;

  if (grant_type !== 'client_credentials') {
    res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Only client_credentials is supported' });
    return;
  }

  if (client_id !== SLUG) {
    res.status(400).json({ error: 'invalid_client', error_description: `client_id must be "${SLUG}"` });
    return;
  }

  if (!client_secret) {
    res.status(400).json({ error: 'invalid_request', error_description: 'client_secret is required (your API key)' });
    return;
  }

  const accessToken = `mcp_${randomUUID().replace(/-/g, '')}`;
  const expiresIn = TOKEN_TTL_MS / 1000;

  oauthTokens.set(accessToken, {
    apiKey: client_secret,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });

  res.json({
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: expiresIn,
  });
});

// --- OAuth 2.0 Token Revocation ---
app.post('/oauth/revoke', (req, res) => {
  const { token } = req.body;
  if (token) oauthTokens.delete(token);
  res.status(200).json({ status: 'revoked' });
});

// --- Smart root route: content negotiation ---
// JSON for AI agents, HTML helper for humans
app.get('/', (req, res) => {
  const accept = req.headers.accept || '';
  if (accept.includes('text/html')) {
    // Serve branded HTML helper page with live config generator
    res.send(BRANDED_LANDING_HTML);
    return;
  }
  // Default: JSON self-description for AI agents
  res.json({
    name: '<ServiceName> MCP Server',
    provider: 'AgenticLedger',
    version: '1.0.0',
    description: '<Short description of what this MCP does>',
    mcpEndpoint: '/mcp',
    transport: 'streamable-http',
    tools: tools.length,
    auth: {
      type: 'dual-mode',
      description: 'Supports both direct Bearer token and OAuth 2.0 Client Credentials',
      modes: {
        bearer: {
          description: 'Pass your API key directly as the Bearer token',
          header: 'Authorization: Bearer <your-api-key>',
        },
        oauth: {
          description: 'Exchange credentials for a time-limited token',
          token_endpoint: `${SERVER_BASE_URL}/oauth/token`,
          client_id: SLUG,
          client_secret: '<your-api-key>',
          grant_type: 'client_credentials',
        },
      },
    },
    configTemplate: {
      mcpServers: {
        '<service-name>': {
          url: `${SERVER_BASE_URL}/mcp`,
          headers: { Authorization: 'Bearer <your-api-key>' }
        }
      }
    },
    links: {
      health: '/health',
      documentation: `https://financemcps.agenticledger.ai/<service-slug>/`,
      oauth_discovery: '/.well-known/oauth-authorization-server',
    }
  });
});

// --- Dual-mode API key resolver ---
function resolveApiKey(req: express.Request): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;

  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  // Mode 1: OAuth-issued token
  if (token.startsWith('mcp_')) {
    const entry = oauthTokens.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      oauthTokens.delete(token);
      return null;
    }
    return entry.apiKey;
  }

  // Mode 2: Raw API key passthrough
  return token;
}

// --- Per-session state ---
interface SessionState {
  server: Server;
  transport: StreamableHTTPServerTransport;
  client: <ApiClientClass>;
}

const sessions = new Map<string, SessionState>();

function createMCPServer(client: <ApiClientClass>): Server {
  const server = new Server(
    { name: '<service-name>-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t) => t.name === name);

    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      const result = await tool.handler(client, args as any);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// --- Streamable HTTP endpoint ---
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // Existing session
  if (sessionId && sessions.has(sessionId)) {
    const { transport } = sessions.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // New session — requires Bearer token (raw API key or OAuth-issued)
  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    res.status(401).json({
      error: 'Missing or invalid Authorization header.',
      modes: {
        bearer: 'Authorization: Bearer <your-api-key>',
        oauth: `POST ${SERVER_BASE_URL}/oauth/token with client_id=${SLUG}&client_secret=<your-api-key>&grant_type=client_credentials`,
      },
    });
    return;
  }

  // Create per-session API client with the user's credentials
  const client = new <ApiClientClass>(apiKey);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  const server = createMCPServer(client);

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) {
      sessions.delete(sid);
      console.log(`[mcp] Session closed: ${sid}`);
    }
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);

  const newSessionId = transport.sessionId;
  if (newSessionId) {
    sessions.set(newSessionId, { server, transport, client });
    console.log(`[mcp] New session: ${newSessionId}`);
  }
});

// GET /mcp — SSE stream for server notifications
app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: 'Invalid or missing session. Send initialization POST first.' });
    return;
  }
  const { transport } = sessions.get(sessionId)!;
  await transport.handleRequest(req, res);
});

// DELETE /mcp — close session
app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const { transport, server } = sessions.get(sessionId)!;
  await transport.close();
  await server.close();
  sessions.delete(sessionId);
  res.status(200).json({ status: 'session closed' });
});

// ==================== BRANDED HTML HELPER PAGE ====================
// Interactive page: user enters API key, gets live MCP config + OAuth config to copy.
// Key never touches the server — all client-side JavaScript.
// AgenticLedger enterprise branding — DM Sans, #2563EB blue, animated gradient.
const BRANDED_LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><ServiceName> MCP Server — AgenticLedger</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root{--primary:#2563EB;--primary-dark:#1D4ED8;--primary-light:#DBEAFE;--primary-50:#EFF6FF;--fg:#0F172A;--muted:#64748B;--surface:#F8FAFC;--border:#E2E8F0;--success:#10B981;--success-light:#D1FAE5;}
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'DM Sans',sans-serif;color:var(--fg);min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--surface);background-image:linear-gradient(135deg,var(--primary-50) 0%,var(--surface) 50%,#F0F9FF 100%);background-size:400% 400%;animation:gradientShift 15s ease infinite;}
    @keyframes gradientShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
    .card{background:#fff;border:1px solid var(--border);border-radius:16px;padding:40px;max-width:560px;width:100%;margin:20px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06);animation:slideUp .5s ease-out;}
    @keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    .header{display:flex;align-items:center;gap:14px;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid var(--border);}
    .header img{height:36px;}
    .header span{font-size:18px;font-weight:700;color:var(--fg);}
    .status-badge{display:inline-flex;align-items:center;gap:6px;background:var(--success-light);border:1px solid #A7F3D0;border-radius:20px;padding:6px 14px;font-size:13px;font-weight:600;color:#065F46;margin-bottom:20px;}
    .status-badge::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--success);animation:pulse 2s infinite;}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .info-grid{display:grid;gap:12px;margin-bottom:24px;}
    .info-row{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--primary-50);border-radius:10px;font-size:13px;}
    .info-row .label{color:var(--muted);font-weight:500;}
    .info-row .value{color:var(--fg);font-weight:600;font-family:'JetBrains Mono',monospace;font-size:12px;}
    .section-title{font-size:14px;font-weight:600;color:var(--fg);margin:24px 0 10px;display:flex;align-items:center;gap:8px;}
    .key-input{width:100%;padding:12px 16px;border:2px solid var(--border);border-radius:10px;font-family:'JetBrains Mono',monospace;font-size:13px;transition:border-color .2s;margin-bottom:8px;}
    .key-input:focus{outline:none;border-color:var(--primary);}
    .key-hint{font-size:12px;color:var(--muted);margin-bottom:20px;line-height:1.5;}
    .config-block{position:relative;}
    .config-pre{background:#1E293B;border-radius:12px;padding:20px;overflow-x:auto;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.7;margin:0 0 24px;color:#E2E8F0;white-space:pre;}
    .config-copy{position:absolute;top:12px;right:12px;background:rgba(255,255,255,.1);color:#CBD5E1;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px 12px;font-family:'DM Sans',sans-serif;font-size:12px;cursor:pointer;transition:all .15s;}
    .config-copy:hover{background:rgba(255,255,255,.2);color:#fff;}
    .config-copy.copied{background:rgba(16,185,129,.3);color:#86EFAC;}
    .trust{display:flex;gap:16px;flex-wrap:wrap;padding-top:20px;border-top:1px solid var(--border);}
    .trust-item{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);}
    .trust-item svg{width:14px;height:14px;color:var(--success);}
    .footer{padding-top:16px;border-top:1px solid var(--border);text-align:center;font-size:12px;color:var(--muted);margin-top:20px;}
  </style>
</head>
<body>
  <div class="card">
    <div class="header"><img src="/static/logo.png" alt="AgenticLedger"><span><ServiceName> MCP</span></div>
    <div class="status-badge">Server Online</div>
    <div class="info-grid">
      <div class="info-row"><span class="label">Tools</span><span class="value">\${tools.length}</span></div>
      <div class="info-row"><span class="label">Transport</span><span class="value">Streamable HTTP</span></div>
      <div class="info-row"><span class="label">Auth</span><span class="value">Dual-Mode (Bearer + OAuth)</span></div>
    </div>

    <div class="section-title">Enter your API key</div>
    <input type="text" class="key-input" id="apiKeyInput" placeholder="<your-service-api-key>" oninput="updateConfig()">
    <div class="key-hint">Your key stays in your browser — it is never sent to this server.</div>

    <div class="section-title">MCP Configuration (Bearer)</div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">Add to your <strong style="color:var(--fg)">claude_desktop_config.json</strong> or <strong style="color:var(--fg)">.mcp.json</strong>:</p>
    <div class="config-block">
      <button class="config-copy" onclick="copyBlock('configBlock',this)">Copy</button>
      <pre class="config-pre" id="configBlock"></pre>
    </div>

    <div class="section-title">OAuth Configuration (Claude.ai / Agent Platforms)</div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">For platforms that require OAuth Client Credentials:</p>
    <div class="config-block">
      <button class="config-copy" onclick="copyBlock('oauthBlock',this)">Copy</button>
      <pre class="config-pre" id="oauthBlock"></pre>
    </div>

    <div class="trust">
      <div class="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>No credentials stored</div>
      <div class="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>Stateless</div>
      <div class="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>Per-session auth</div>
    </div>
    <div class="footer">Powered by AgenticLedger &middot; <a href="https://financemcps.agenticledger.ai/" target="_blank" style="color:var(--primary);text-decoration:none">Explore Other MCPs</a></div>
  </div>
  <script>
    function updateConfig(){
      var key=document.getElementById('apiKeyInput').value||'<your-api-key>';
      var config=JSON.stringify({mcpServers:{"<service-name>":{url:"\${SERVER_BASE_URL}/mcp",headers:{Authorization:"Bearer "+key}}}},null,2);
      document.getElementById('configBlock').textContent=config;
      var oauth="Token URL:      \${SERVER_BASE_URL}/oauth/token\\nClient ID:      ${SLUG}\\nClient Secret:  "+key+"\\nGrant Type:     client_credentials";
      document.getElementById('oauthBlock').textContent=oauth;
    }
    function copyBlock(id,btn){
      var text=document.getElementById(id).textContent;
      navigator.clipboard.writeText(text).then(function(){
        btn.textContent='Copied!';btn.classList.add('copied');
        setTimeout(function(){btn.textContent='Copy';btn.classList.remove('copied');},2000);
      });
    }
    updateConfig();
  </script>
</body>
</html>`;

app.listen(PORT, () => {
  console.log(`<ServiceName> MCP HTTP Server running on port ${PORT}`);
  console.log(`  MCP endpoint:   ${SERVER_BASE_URL}/mcp`);
  console.log(`  OAuth token:    ${SERVER_BASE_URL}/oauth/token`);
  console.log(`  OAuth discovery: ${SERVER_BASE_URL}/.well-known/oauth-authorization-server`);
  console.log(`  Health check:   ${SERVER_BASE_URL}/health`);
  console.log(`  Landing page:   ${SERVER_BASE_URL}/`);
  console.log(`  Tools:          ${tools.length}`);
  console.log(`  Transport:      Streamable HTTP`);
  console.log(`  Auth:           Dual-mode (Bearer passthrough + OAuth Client Credentials)`);
});
```

**IMPORTANT:** Replace all `<ApiClientClass>`, `<ServiceName>`, `<service-name>` placeholders with actual values from the source MCP.

---

## Phase 3: Build & Test Locally

```bash
cd <exposed-folder>
npm install
npx tsc     # must compile with 0 errors
```

Quick smoke test:
```bash
PORT=3199 timeout 5 node dist/index.js 2>&1 || true
```

Verify output shows correct tool count and "Dual-mode" auth.

---

## Phase 4: Create GitHub Repo & Push

```bash
# Init git
cd <exposed-folder>
git init
git add -A
git commit -m "<ServiceName> MCP HTTP Server - Streamable HTTP transport"

# Create repo under agenticledger org
curl -s -H "Authorization: token ghp_REDACTED" \
  -H "Accept: application/vnd.github+json" \
  -X POST https://api.github.com/orgs/agenticledger/repos \
  -d '{"name":"<service-name>-mcp-http","description":"<ServiceName> MCP Server - Streamable HTTP","private":false}'

# If org fails, try user account:
# curl -s -H "Authorization: token ghp_REDACTED" \
#   -X POST https://api.github.com/user/repos \
#   -d '{"name":"<service-name>-mcp-http","private":false}'

# Push
git remote add origin https://ghp_REDACTED@github.com/agenticledger/<service-name>-mcp-http.git
git branch -M main
git push -u origin main
```

---

## Phase 5: Deploy to Railway

All commands use the Railway GraphQL API (CLI auth is unreliable).

**API base:**
```
URL: https://backboard.railway.com/graphql/v2
Headers:
  Content-Type: application/json
  Authorization: Bearer 6420ab05-a0db-47ce-8fce-7dac088329f1
```

### Step 1: Create service in FinanceMCPs project

```graphql
mutation {
  serviceCreate(input: {
    name: "<service-name>-mcp",
    projectId: "3230ac49-2b3c-4e8f-a266-3fcf93b0b51f"
  }) { id name }
}
```

Save the returned service ID.

### Step 2: Set PORT env var

```graphql
mutation {
  variableUpsert(input: {
    projectId: "3230ac49-2b3c-4e8f-a266-3fcf93b0b51f",
    environmentId: "c511b016-571a-4176-8e13-e23afdd586c9",
    serviceId: "<SERVICE_ID>",
    name: "PORT",
    value: "3100"
  })
}
```

**No other env vars needed** — credentials come from the client.

### Step 3: Connect GitHub repo

```graphql
mutation {
  serviceConnect(id: "<SERVICE_ID>", input: {
    repo: "agenticledger/<service-name>-mcp-http",
    branch: "main"
  }) { id name }
}
```

If the GitHub repo is under a different account (e.g., oregpt), use that path instead.

### Step 4: Wait for deployment

Poll until status is `SUCCESS`:
```graphql
{
  deployments(first: 1, input: { serviceId: "<SERVICE_ID>" }) {
    edges { node { id status createdAt } }
  }
}
```

Wait 10s between polls. Typical build takes 30-60s.

### Step 5: Create public domain

```graphql
mutation {
  serviceDomainCreate(input: {
    serviceId: "<SERVICE_ID>",
    environmentId: "c511b016-571a-4176-8e13-e23afdd586c9"
  }) { domain }
}
```

Save the returned domain (e.g., `<service-name>-mcp-production.up.railway.app`).

### Step 6: Create custom domain

```graphql
mutation {
  customDomainCreate(input: {
    serviceId: "<SERVICE_ID>",
    environmentId: "c511b016-571a-4176-8e13-e23afdd586c9",
    domain: "<service-name>mcp.agenticledger.ai"
  }) { id domain }
}
```

### Step 7: Set SERVER_BASE_URL env var

```graphql
mutation {
  variableUpsert(input: {
    projectId: "3230ac49-2b3c-4e8f-a266-3fcf93b0b51f",
    environmentId: "c511b016-571a-4176-8e13-e23afdd586c9",
    serviceId: "<SERVICE_ID>",
    name: "SERVER_BASE_URL",
    value: "https://<service-name>mcp.agenticledger.ai"
  })
}
```

### Step 8: Get verification token and add DNS records to Namecheap

Query Railway for the verification token:
```graphql
{
  project(id: "3230ac49-2b3c-4e8f-a266-3fcf93b0b51f") {
    services { edges { node { name serviceInstances(first: 1) { edges { node { domains {
      customDomains { domain status { verified verificationDnsHost verificationToken } }
      serviceDomains { domain }
    } } } } } } }
  }
}
```

Find the service's custom domain entry. Extract:
- `verificationDnsHost` (e.g., `_railway-verify.<subdomain>`)
- `verificationToken` (the hash value)
- The CNAME target from `serviceDomains[0].domain` — this is NOT the custom domain, it's the Railway-generated domain (e.g., `abc123.up.railway.app`)

**Add BOTH records to Namecheap using the API:**

```
Namecheap API Credentials:
- API User: OrePhillips
- API Key: da89bfedac7b46b7b8c2c59a48189e34
- Client IP: get via `curl -s4 ifconfig.me`
```

**IMPORTANT: Namecheap setHosts REPLACES all records.** You must:
1. GET all existing records: `namecheap.domains.dns.getHosts` (SLD=agenticledger, TLD=ai)
2. ADD the 2 new records to the existing list:
   - CNAME: `<service-name>mcp` → `<railway-generated-domain>.up.railway.app`
   - TXT: `_railway-verify.<service-name>mcp` → `railway-verify=<verificationToken>`
3. SET all records (existing + new): `namecheap.domains.dns.setHosts`

Example Python script:
```python
import xml.etree.ElementTree as ET
import urllib.request, urllib.parse

API_USER = "OrePhillips"
API_KEY = "da89bfedac7b46b7b8c2c59a48189e34"
CLIENT_IP = "<your-ip>"  # from curl -s4 ifconfig.me

# GET existing
url = f"https://api.namecheap.com/xml.response?ApiUser={API_USER}&ApiKey={API_KEY}&UserName={API_USER}&Command=namecheap.domains.dns.getHosts&ClientIp={CLIENT_IP}&SLD=agenticledger&TLD=ai"
with urllib.request.urlopen(url) as resp:
    data = resp.read().decode()

root = ET.fromstring(data)
ns = {'nc': 'http://api.namecheap.com/xml.response'}
hosts = root.findall('.//nc:host', ns)

records = []
for h in hosts:
    rec = {'HostName': h.get('Name'), 'RecordType': h.get('Type'), 'Address': h.get('Address'), 'TTL': h.get('TTL', '1800')}
    if h.get('MXPref'): rec['MXPref'] = h.get('MXPref')
    records.append(rec)

# ADD new records (check they don't already exist)
existing_hosts = {r['HostName'] for r in records}
if '<service-name>mcp' not in existing_hosts:
    records.append({'HostName': '<service-name>mcp', 'RecordType': 'CNAME', 'Address': '<railway-domain>.up.railway.app', 'TTL': '1800'})
if '_railway-verify.<service-name>mcp' not in existing_hosts:
    records.append({'HostName': '_railway-verify.<service-name>mcp', 'RecordType': 'TXT', 'Address': 'railway-verify=<token>', 'TTL': '1800'})

# SET all
params = {'ApiUser': API_USER, 'ApiKey': API_KEY, 'UserName': API_USER,
    'Command': 'namecheap.domains.dns.setHosts', 'ClientIp': CLIENT_IP,
    'SLD': 'agenticledger', 'TLD': 'ai'}
for i, rec in enumerate(records, 1):
    params[f'HostName{i}'] = rec['HostName']
    params[f'RecordType{i}'] = rec['RecordType']
    params[f'Address{i}'] = rec['Address']
    params[f'TTL{i}'] = rec.get('TTL', '1800')
    if 'MXPref' in rec: params[f'MXPref{i}'] = rec['MXPref']

data = urllib.parse.urlencode(params).encode()
req = urllib.request.Request("https://api.namecheap.com/xml.response", data=data)
with urllib.request.urlopen(req) as resp:
    result = resp.read().decode()
    assert 'Status="OK"' in result, f"DNS update failed: {result}"
```

Verify with: `dig +short <service-name>mcp.agenticledger.ai CNAME`

---

## Phase 6: End-to-End Tests

Run these tests in sequence. Set variables first:
```bash
DOMAIN="https://<domain>"
SLUG="<service-slug>"
```

### Test 0: Smart root route (JSON)
```bash
curl -s $DOMAIN/ -H "Accept: application/json" | python3 -m json.tool
```
Expected: JSON with `name`, `tools`, `auth.type: "dual-mode"`, `auth.modes.bearer`, `auth.modes.oauth`, `configTemplate`

### Test 1: Health check
```bash
curl -s $DOMAIN/health | python3 -m json.tool
```
Expected: `auth: "dual-mode"`, `auth_modes: ["bearer-passthrough", "oauth-client-credentials"]`

### Test 2: OAuth discovery
```bash
curl -s $DOMAIN/.well-known/oauth-authorization-server | python3 -m json.tool
```
Expected: Valid JSON with `token_endpoint`, `grant_types_supported: ["client_credentials"]`

### Test 3: Auth rejection
```bash
curl -s -X POST $DOMAIN/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```
Expected: 401 with both auth modes in error response

### Test 4: Bearer passthrough MCP init
```bash
curl -s --max-time 5 -X POST $DOMAIN/mcp \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```
Expected: SSE response with `serverInfo` and `protocolVersion`

### Test 5: OAuth token exchange
```bash
TOKEN=$(curl -s -X POST $DOMAIN/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=$SLUG&client_secret=test-key-123" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
echo "Token: $TOKEN"
```
Expected: Token starting with `mcp_`

### Test 6: MCP init with OAuth token
```bash
curl -s --max-time 5 -X POST $DOMAIN/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```
Expected: SSE response with `serverInfo` (same as bearer test)

### Test 7: OAuth error cases
```bash
# Wrong client_id
curl -s -X POST $DOMAIN/oauth/token -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=wrong&client_secret=test"
# Missing secret
curl -s -X POST $DOMAIN/oauth/token -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=$SLUG"
# Invalid OAuth token
curl -s -X POST $DOMAIN/mcp \
  -H "Authorization: Bearer mcp_invalidtoken123" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```
Expected: 400/401 errors for each

### Test 8: Token revocation
```bash
curl -s -X POST $DOMAIN/oauth/revoke -H "Content-Type: application/x-www-form-urlencoded" \
  -d "token=$TOKEN" | python3 -m json.tool
```
Expected: `{"status": "revoked"}`

### Test 9 (optional): Actual API call with real credentials
If you have a valid service API key, test a read-only tool using both auth modes.

---

## Phase 7: Write DEPLOYMENT.md

Create `DEPLOYMENT.md` in the exposed folder (already in .gitignore):

```markdown
# <ServiceName> MCP HTTP Server — LIVE

| Item | Value |
|------|-------|
| **MCP URL** | `https://<domain>/mcp` |
| **Health** | `https://<domain>/health` |
| **Transport** | Streamable HTTP |
| **Auth** | Dual-mode (Bearer passthrough + OAuth Client Credentials) |
| **Tools** | <N> |
| **Railway Project** | FinanceMCPs |
| **GitHub Repo** | `agenticledger/<service-name>-mcp-http` |

## How Clients Connect

**Mode 1: Bearer Passthrough** (Claude Code, Claude Desktop, direct clients)
- URL: `https://<domain>/mcp`
- Auth: `Authorization: Bearer <their-own-service-api-key>`

**Mode 2: OAuth Client Credentials** (Claude.ai Cowork, agent platforms)
- Token URL: `https://<domain>/oauth/token`
- Client ID: `<service-slug>`
- Client Secret: `<their-own-service-api-key>`
- Grant Type: `client_credentials`

No server-side API keys. Each client authenticates with their own credentials.

## Client Config (Claude Desktop / Claude Code)

\```json
{
  "mcpServers": {
    "<service-name>": {
      "type": "streamable-http",
      "url": "https://<domain>/mcp",
      "headers": {
        "Authorization": "Bearer <your-service-api-key>"
      }
    }
  }
}
\```
```

---

## Phase 7.5: Add Connect Button to MCPLive Demo Hub

The MCPLive demo hub at `financemcps.agenticledger.ai` has a page for each MCP server. When a server is exposed with auth (OAuth, Plaid Link, etc.), add a "Connect" button to its demo page.

**MCPLive location:** See Cross-Platform Paths table above (Windows: `C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\MCPLive`, Mac: `/Users/oreph/Desktop/APPs/financestackmcps/MCPLive/`)

### Step 1: Add `connectUrl` and `connectLabel` to the server's SERVERS entry in `build.js`

Find the server entry by its `slug` and add these two fields:

```javascript
{
  slug: '<service-slug>',
  name: '<ServiceName> MCP Server',
  folder: '<FolderName>',
  // ... existing fields ...
  connectUrl: 'https://<domain>/auth/connect',
  connectLabel: 'Connect Your <Service>',  // e.g. "Connect Your Bank", "Connect Your QuickBooks"
},
```

The `heroButtonsHTML()` function in build.js already handles rendering a green `connect-cta` button when `connectUrl` is present. No template changes needed.

### Step 2: Rebuild and push

```bash
cd <MCPLive path from Cross-Platform Paths table>
npm run build
git add build.js public/
git commit -m "Add Connect button for <ServiceName> MCP — links to <domain>/auth/connect"
git push origin main
```

Railway auto-deploys on push. Verify at `https://financemcps.agenticledger.ai/<slug>/`.

---

## Phase 8: Validate Checklist

**Read `BUILD_CHECKLIST.md` and verify every single checkbox is checked.** This is the final gate.

1. Read the checklist file
2. Count total checkboxes vs checked checkboxes
3. If ANY are unchecked:
   - List the unchecked items
   - Go back and complete them
   - Do NOT proceed to Summary Output until 100% checked
4. If all are checked:
   - Update the checklist with completion timestamp
   - Add `## Result: PASSED` at the bottom
   - Proceed to Summary Output

```bash
# Quick validation command
grep -c "\- \[ \]" BUILD_CHECKLIST.md    # should be 0
grep -c "\- \[x\]" BUILD_CHECKLIST.md    # should match total items
```

If validation fails, fix the issues and re-validate. Do not skip this phase.

---

## Phase 8.5: Register in MyAgent Gateway

Register the new HTTP MCP in the MyAgent gateway so agents can use it.

**Gateway config:** `~/Desktop/APPs/channelToAgentToClaude/config.json`

> **Note:** This step may be run from a machine that doesn't have the MyAgent gateway installed (e.g., a Windows dev box). If the gateway folder (`~/Desktop/APPs/channelToAgentToClaude`) doesn't exist, **skip this phase** — mark the checklist items as `[SKIPPED — gateway not on this machine]` and move on. The MCP is still fully deployed and usable; gateway registration can be done later from the Mac that runs the gateway.

### Step 1: Check if gateway exists

```bash
ls ~/Desktop/APPs/channelToAgentToClaude/config.json 2>/dev/null && echo "Gateway found" || echo "Gateway not found — skip Phase 8.5"
```

If not found, skip to Phase 9 / Summary Output.

### Step 2: Add MCP to the `mcps` block

Add this entry to the `mcps` object in `config.json`:

```json
"<service-name>": {
  "type": "http",
  "url": "https://<service-name>mcp.agenticledger.ai/mcp",
  "headers": {
    "Authorization": "Bearer ${<SERVICE_NAME_UPPER>_API_KEY}"
  }
}
```

Where `<SERVICE_NAME_UPPER>` is the service name in UPPER_SNAKE_CASE (e.g., `SMARTSHEETS_API_KEY`, `STRIPE_API_KEY`, `P2P_LAMBDA_KEY`).

### Step 3: Validate config

```bash
cd ~/Desktop/APPs/channelToAgentToClaude
node -e "JSON.parse(require('fs').readFileSync('config.json','utf8')); console.log('Valid JSON')"
node -e "const {loadConfig}=require('./dist/config.js'); const c=loadConfig('./config.json'); console.log('MCPs:', Object.keys(c.mcps).length)"
```

### Step 4: Add to MCP Catalog (optional — ask user)

Ask: **"Want to add this MCP to the MyAgent catalog so it's available to all new installs?"**

If yes, update these files in the gateway project (`~/Desktop/APPs/channelToAgentToClaude/`):

**1. `mcp-catalog.json`** — add entry to the `mcps` object:
```json
"<service-name>": {
  "name": "<Human Name>",
  "description": "<one-line description of what the MCP does>",
  "category": "<pick from: accounting, banking, payments, billing, expense, tax, hr, crm, productivity, crypto, analytics, devtools, infrastructure>",
  "url": "https://<service-name>mcp.agenticledger.ai/mcp",
  "requiredKeys": [{ "env": "<SERVICE_NAME_UPPER>_API_KEY", "label": "<Human Label>", "hint": "<where to get the key>" }]
}
```
If no auth required, use `"requiredKeys": []`.

**2. `config.example.json`** — add to `mcps` block (same format as Step 2 above). This ensures new installs get it pre-registered.

**3. `@agentcreator` MCP list** — add the service name to the agentcreator's `mcps` array in config.json so it can use the MCP when creating agents.

**4. Commit & push** the catalog + example changes:
```bash
cd ~/Desktop/APPs/channelToAgentToClaude
git add mcp-catalog.json config.example.json
git commit -m "Add <service-name> MCP to catalog"
git push origin main
```

### Notes
- This only **registers** the MCP at the gateway level — it does NOT assign it to any agent yet
- To assign to an agent: add the MCP name to the agent's `mcps` array in config.json, then save the agent's API key to `<agentHome>/mcp-keys/<service-name>.env` with: `<SERVICE_NAME_UPPER>_API_KEY=<key>`
- No rebuild needed — config.json is read at startup, so restart the service: `launchctl kickstart -k gui/$(id -u)/com.agenticledger.channelToAgentToClaude`

### Checklist item to add to BUILD_CHECKLIST.md:
```
## Phase 8.5: MyAgent Gateway Registration
- [ ] Added MCP entry to gateway config.json mcps block
- [ ] Validated config JSON loads correctly
- [ ] Service name in gateway: <service-name>
- [ ] Key variable: ${<SERVICE_NAME_UPPER>_API_KEY}
- [ ] Added to mcp-catalog.json (or SKIPPED)
- [ ] Added to config.example.json (or SKIPPED)
```

---

## Summary Output

End every run with:

```
## MCP Exposed Successfully

| Item | Value |
|------|-------|
| Service | <ServiceName> |
| URL | https://<domain>/mcp |
| Tools | <N> |
| Auth | Dual-mode (Bearer + OAuth) |
| OAuth Token URL | https://<domain>/oauth/token |
| OAuth Client ID | <service-slug> |
| GitHub | agenticledger/<service-name>-mcp-http |
| Railway | FinanceMCPs / <service-name>-mcp |

Bearer: Authorization: Bearer <their-api-key>
OAuth:  POST /oauth/token with client_id=<slug>&client_secret=<their-api-key>&grant_type=client_credentials
```
