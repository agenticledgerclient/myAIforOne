---
name: opMCPcreate
description: Create production MCP servers following the proven Orphil/AgenticLedger pattern. Scaffolds all files, generates interactive docs, and builds test suites. Use when building MCP servers for any API or service.
---

# MCP Server Creator — Orphil Pattern

Create production-ready MCP servers following the exact architecture proven across 4 production servers. This skill generates all files, interactive documentation, and test suites.

## Reference Implementations

Before building, study these production servers for patterns and nuance:

| Server | Path | Auth | API Type | Tools |
|--------|------|------|----------|-------|
| **NodeFortress** | `C:\Users\oreph\clawd\OrphilLLC\Clients\NodeFortress\mcp-server` | API key header | REST | 14 |
| **Lighthouse** | `C:\Users\oreph\clawd\OrphilLLC\Clients\Lighthouse\mcp-server` | None (public) | REST | 28 |
| **LightSpark SDK** | `C:\Users\oreph\clawd\OrphilLLC\Clients\LightSpark\LightsparkSDK\mcp-server` | Basic Auth | GraphQL | 37 |
| **GRID** | `C:\Users\oreph\clawd\OrphilLLC\Clients\LightSpark\GRID\mcp-server` | Basic Auth | REST | 38 |
| **Modern Treasury** | `C:\Users\oreph\clawd\OrphilLLC\Clients\FinanceStackMCPs\modern-treasury\mcp-server` | Basic Auth | REST | 55 |

**When in doubt about any pattern, read the actual source files from these servers.**

---

## MANDATORY: Build Checklist

**At the START of every MCP server build, create a checklist file at `{project-root}/BUILD_CHECKLIST.md` using this template.** Update it after completing each phase. This is NOT optional — it's how we track quality.

```markdown
# MCP Server Build Checklist — {{SERVER_NAME}}

## Server Info
- **Target API:** {{API_NAME}}
- **API Docs:** {{API_DOCS_URL}}
- **Auth Type:** {{none | apikey | basic | bearer}}
- **API Type:** {{REST | GraphQL}}
- **Target Directory:** {{FULL_PATH}}
- **Started:** {{DATE}}

## Phase 1: Research
- [ ] API documentation found and reviewed
- [ ] Auth model identified: {{type}}
- [ ] All endpoints listed and categorized
- [ ] Pagination pattern identified
- [ ] Sample API calls tested manually
- **Endpoint count:** {{N}}
- **Categories:** {{list}}

## Phase 2: Scaffold
- [ ] Directory structure created
- [ ] package.json written
- [ ] tsconfig.json written
- [ ] .env.example written
- [ ] .gitignore written
- [ ] npm install successful

## Phase 3: Implementation
- [ ] api-client.ts — auth pattern: {{A/B/C/D}}
- [ ] api-client.ts — all {{N}} endpoint methods written
- [ ] tools.ts — all {{N}} tools defined with Zod schemas
- [ ] tools.ts — all descriptions under 60 chars
- [ ] tools.ts — all fields have .describe()
- [ ] index.ts — standalone server wiring complete
- [ ] hub-server.ts — MCPServerInstance class complete
- [ ] hub-server.ts — setTokens() matches api-client auth pattern
- [ ] hub-server.ts — singleton exported
- [ ] npm run build — compiles cleanly

## Phase 4: Documentation
- [ ] docs/index.html created (interactive, dark theme)
- [ ] All tools represented in TOOLS array
- [ ] Search works
- [ ] Copy-to-clipboard works
- [ ] Example responses included

## Phase 5: Testing
- [ ] test/test-tools.ts created
- [ ] Tests run against live API
- [ ] Pass rate: {{N}}%
- [ ] Avg response time: {{N}}ms
- [ ] Known issues documented

## Phase 6: Finalize
- [ ] README.md written with Claude Desktop config
- [ ] docs/TEST-RESULTS.md created
- [ ] No secrets in git
- [ ] All files match directory structure

## Phase 7: Reference Comparison (FINAL GATE)
- [ ] Compared against reference: {{REFERENCE_SERVER_NAME}}
- [ ] File structure matches reference
- [ ] api-client.ts follows same request() pattern
- [ ] tools.ts follows same {name, description, inputSchema, handler} pattern
- [ ] index.ts follows same ListTools + CallTool handler pattern
- [ ] hub-server.ts implements MCPServerInstance correctly
- [ ] hub-server.ts compared against agentinabox bundled server (e.g., ccview, gmail)
- [ ] docs/index.html has same features (sidebar, search, tool cards, copy)
- [ ] test/test-tools.ts follows same TestResult pattern
- [ ] Deviations documented and justified: {{list or "none"}}

## Agent-in-a-Box Hub Integration
- [ ] hub-server.ts ready for import into mcp-server-manager.ts
- [ ] Well-known server entry documented (id, name, category, envVars)
- [ ] Token mapping documented (which token field = which credential)

## Completion
- **Finished:** {{DATE}}
- **Total tools:** {{N}}
- **Pass rate:** {{N}}%
- **Status:** {{COMPLETE | BLOCKED}}
```

**Rules for the checklist:**
1. Create it at the START — before writing any code
2. Update it AFTER each phase — mark items as `[x]` and fill in values
3. The Phase 7 comparison is the FINAL GATE — do not declare done without it
4. Choose the reference server closest to your auth/API type:
   - No auth + REST → compare against **Lighthouse**
   - API key + REST → compare against **NodeFortress**
   - Basic auth + REST → compare against **GRID**
   - Basic auth + GraphQL → compare against **LightSpark SDK**
5. When comparing, actually READ the reference files — don't just check boxes

---

## Phase 1: Research the Target API

Before writing any code:

1. **Find the API documentation** — Swagger/OpenAPI spec, developer docs, or raw endpoint list
2. **Identify the authentication model**:
   - `none` — Public API, no credentials needed
   - `apikey` — API key sent as header (e.g., `x-api-key: KEY`)
   - `basic` — HTTP Basic Auth (`Authorization: Basic base64(id:secret)`)
   - `bearer` — Bearer token (`Authorization: Bearer TOKEN`)
3. **List ALL endpoints** — Group them by category (e.g., "Accounts", "Transactions", "Search")
4. **Identify the API type**: REST (most common) or GraphQL
5. **Note pagination patterns** — cursor-based, offset/limit, page numbers
6. **Test a few endpoints** manually to verify responses and understand data shapes

---

## Phase 2: Scaffold the Project

### Directory Structure (MANDATORY — do not deviate)

```
mcp-server/
├── src/
│   ├── index.ts          # Standalone MCP server (Claude Desktop/Code)
│   ├── hub-server.ts     # Agent-in-a-Box bundled integration
│   ├── api-client.ts     # HTTP/GraphQL client with auth
│   └── tools.ts          # Tool definitions (Zod schemas + handlers)
├── docs/
│   └── index.html        # Interactive documentation page
├── test/
│   └── test-tools.ts     # Automated test suite
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

**Two entry points, shared internals:**
- `index.ts` → standalone stdio server for Claude Desktop/Code
- `hub-server.ts` → `MCPServerInstance` class for Agent-in-a-Box hub integration
- Both reuse the SAME `api-client.ts` and `tools.ts` — zero duplication

### package.json Template

```json
{
  "name": "{{SERVER_NAME}}-mcp-server",
  "version": "1.0.0",
  "description": "MCP server for {{SERVICE_NAME}} API",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "{{SERVER_NAME}}-mcp": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch",
    "test": "npx tsx test/test-tools.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.22.4",
    "zod-to-json-schema": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "typescript": "^5.3.0",
    "tsx": "^4.21.0"
  }
}
```

### tsconfig.json (EXACT — do not modify)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### .env.example

```bash
# {{SERVICE_NAME}} API Credentials
# Auth type: {{AUTH_TYPE}}
{{ENV_VARS}}
```

### .gitignore

```
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
```

---

## Phase 3: Implement the Server

### 3.1 — api-client.ts

The API client handles all HTTP communication. Choose the auth pattern that matches:

#### Pattern A: No Auth (Public API)
Reference: `Lighthouse/mcp-server/src/api-client.ts`

```typescript
const BASE_URL = '{{API_BASE_URL}}';

export class {{ClientName}} {
  private async request<T>(endpoint: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${BASE_URL}${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API Error ${response.status}: ${text}`);
    }

    return response.json();
  }

  // Add methods per endpoint:
  async listItems(limit?: number, cursor?: string) {
    return this.request<any>('/items', { limit, cursor });
  }

  async getItem(id: string) {
    return this.request<any>(`/items/${encodeURIComponent(id)}`);
  }
}
```

#### Pattern B: API Key Header
Reference: `NodeFortress/mcp-server/src/api-client.ts`

```typescript
const BASE_URL = '{{API_BASE_URL}}';

export class {{ClientName}} {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(endpoint: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${BASE_URL}${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'x-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API Error ${response.status}: ${text}`);
    }

    return response.json();
  }
}
```

#### Pattern C: HTTP Basic Auth
Reference: `GRID/mcp-server/src/api-client.ts` and `LightsparkSDK/mcp-server/src/api-client.ts`

```typescript
const BASE_URL = '{{API_BASE_URL}}';

export class {{ClientName}} {
  private clientId: string;
  private clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private getAuthHeader(): string {
    return `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`;
  }

  private async request<T>(endpoint: string, options: { method?: string; body?: any; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${BASE_URL}${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      'Authorization': this.getAuthHeader(),
      'Accept': 'application/json',
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (response.status === 204) return {} as T;

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API Error ${response.status}: ${text}`);
    }

    return response.json();
  }
}
```

#### Pattern D: GraphQL
Reference: `LightsparkSDK/mcp-server/src/api-client.ts`

```typescript
const ENDPOINT = '{{GRAPHQL_ENDPOINT}}';

export class {{ClientName}} {
  private clientId: string;
  private clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private getAuthHeader(): string {
    return `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`;
  }

  async query<T = any>(gql: string, variables?: Record<string, any>): Promise<T> {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': this.getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: gql, variables }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GraphQL Error ${response.status}: ${text}`);
    }

    const json = await response.json();
    if (json.errors?.length) {
      throw new Error(`GraphQL: ${json.errors[0].message}`);
    }

    return json.data;
  }
}
```

**API Client Rules:**
- One method per API endpoint
- Always `encodeURIComponent()` for path parameters
- Always handle optional params with `if (value !== undefined)`
- Generic `request<T>()` method — never duplicate HTTP logic
- Throw meaningful errors with status codes

---

### 3.2 — tools.ts

Every tool follows this exact structure:

```typescript
import { z } from 'zod';
import { {{ClientName}} } from './api-client.js';

export const tools = [
  {
    name: 'category_action',
    description: 'Brief description under 60 chars',
    inputSchema: z.object({
      id: z.string().describe('item ID'),
      limit: z.number().optional().describe('max results'),
    }),
    handler: async (client: {{ClientName}}, args: { id: string; limit?: number }) =>
      client.getItem(args.id, args.limit),
  },
  // ... more tools
];
```

**Tool Naming Convention:**
- List operations: `category_list` (e.g., `validators_list`, `contracts_list`)
- Get single item: `category_get` (e.g., `validator_get`, `contract_get`)
- Create: `category_create`
- Update: `category_update`
- Delete: `category_delete`
- Special actions: `category_action` (e.g., `party_balance`, `quote_execute`)
- Search: `search`

**Tool Description Rules:**
- Under 60 characters — saves LLM tokens
- Action-oriented: "List all X", "Get X by ID", "Create new X"
- No redundant words like "This tool" or "Use this to"

**Zod Schema Rules:**
- Always `.describe()` every field — Claude needs these hints
- Keep descriptions to 1-3 words: `.describe('party ID')`, `.describe('max results')`
- Use `.optional()` for non-required fields
- Use `.enum()` for fixed options: `z.enum(['ASC', 'DESC']).describe('sort order')`
- Flat parameters only — no nested objects in schemas (flatten in handler)

---

### 3.3 — index.ts

The server wiring is nearly identical every time:

```typescript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { {{ClientName}} } from './api-client.js';
import { tools } from './tools.js';

// --- Auth Setup (choose one) ---

// No auth:
const client = new {{ClientName}}();

// API key:
const API_KEY = process.env.{{ENV_KEY_NAME}};
if (!API_KEY) { console.error('Missing {{ENV_KEY_NAME}}'); process.exit(1); }
const client = new {{ClientName}}(API_KEY);

// Basic auth:
const CLIENT_ID = process.env.{{ENV_ID_NAME}};
const CLIENT_SECRET = process.env.{{ENV_SECRET_NAME}};
if (!CLIENT_ID || !CLIENT_SECRET) { console.error('Missing credentials'); process.exit(1); }
const client = new {{ClientName}}(CLIENT_ID, CLIENT_SECRET);

// --- Server ---

const server = new Server(
  { name: '{{SERVER_NAME}}-mcp-server', version: '1.0.0' },
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
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('{{SERVER_NAME}} MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

**index.ts Rules:**
- Always use `zod-to-json-schema` package (simpler than custom converter)
- **CRITICAL: TS2589 deep type error** — When a server has 30+ tools, TypeScript chokes on `zodToJsonSchema(tool.inputSchema)` with "Type instantiation is excessively deep". Fix by wrapping it:
  ```typescript
  import { zodToJsonSchema as _zodToJsonSchema } from 'zod-to-json-schema';
  function zodToJsonSchema(schema: any): any {
    return _zodToJsonSchema(schema);
  }
  ```
- **CRITICAL: ToolDef interface** — For 30+ tools, add an explicit type to prevent union explosion in tools.ts:
  ```typescript
  interface ToolDef {
    name: string;
    description: string;
    inputSchema: z.ZodType<any>;
    handler: (client: ClientClass, args: any) => Promise<any>;
  }
  export const tools: ToolDef[] = [ ... ];
  ```
- Always validate env vars before creating client
- Always catch errors in CallToolRequestSchema and return `isError: true`
- Always log to `stderr` (not stdout — that's for MCP transport)
- Choose ONE auth pattern, delete the others

---

### 3.4 — hub-server.ts (Agent-in-a-Box Integration)

This file makes the MCP server plug directly into the Agent-in-a-Box hub as a **bundled server**. It reuses the SAME `api-client.ts` and `tools.ts` — only the outer shell is different.

**Reference implementation:** Study the bundled servers in:
`C:\Users\oreph\Documents\AgenticLedger\Custom Applications\agentinabox\agentinabox_v2\server\src\mcp-hub\servers\`

**MCPServerInstance interface** (from agentinabox `types.ts`):
```typescript
interface MCPServerInstance {
  name: string;
  version: string;
  description: string;
  tools: MCPTool[];
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  executeTool(name: string, args: any): Promise<MCPResponse>;
  listTools(): Promise<MCPTool[]>;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
}

interface MCPResponse {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: { server?: string; tool?: string; executionTime?: number };
}
```

**hub-server.ts Template:**

```typescript
/**
 * {{SERVICE_NAME}} MCP Server — Agent-in-a-Box Hub Integration
 *
 * This file implements MCPServerInstance for bundled registration
 * in the agentinabox MCP Hub. It reuses the same api-client and tools
 * as the standalone index.ts server.
 *
 * Usage:
 *   import { {{serverVar}}Server } from './hub-server.js';
 *   await orchestrator.registerServer({{serverVar}}Server);
 */

import { z } from 'zod';
import { {{ClientName}} } from './api-client.js';
import { tools } from './tools.js';

// Types matching agentinabox mcp-hub/types.ts
interface MCPTool {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
}

interface MCPResponse {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: { server?: string; tool?: string; executionTime?: number };
}

interface MCPServerInstance {
  name: string;
  version: string;
  description: string;
  tools: MCPTool[];
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  executeTool(name: string, args: any): Promise<MCPResponse>;
  listTools(): Promise<MCPTool[]>;
}

export class {{ClassName}}MCPServer implements MCPServerInstance {
  name = '{{server-name}}';
  version = '1.0.0';
  description = '{{SERVICE_DESCRIPTION}}';
  tools: MCPTool[] = [];

  private client: {{ClientName}} | null = null;

  /**
   * Called by MCPServerManager to inject credentials from database.
   * token1 = primary credential (API key, client ID, etc.)
   * token2 = secondary credential (client secret, refresh token, etc.)
   */
  setTokens(tokens: { token1?: string; token2?: string; token3?: string; token4?: string; token5?: string }) {
    // --- Choose auth pattern (match api-client.ts constructor) ---

    // No auth:
    this.client = new {{ClientName}}();

    // API key:
    if (tokens.token1) {
      this.client = new {{ClientName}}(tokens.token1);
    }

    // Basic auth (client ID + secret):
    if (tokens.token1 && tokens.token2) {
      this.client = new {{ClientName}}(tokens.token1, tokens.token2);
    }
  }

  async initialize(): Promise<void> {
    this.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
    console.log(`[{{server-name}}] Initialized with ${this.tools.length} tools`);
  }

  async shutdown(): Promise<void> {
    console.log(`[{{server-name}}] Shutting down`);
    this.client = null;
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<MCPResponse> {
    if (!this.client) {
      return { success: false, error: 'Server not configured — call setTokens() first' };
    }

    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      return { success: false, error: `Unknown tool: ${name}` };
    }

    const start = Date.now();
    try {
      const result = await tool.handler(this.client, args as any);
      return {
        success: true,
        data: result,
        metadata: {
          server: this.name,
          tool: name,
          executionTime: Date.now() - start,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
        metadata: {
          server: this.name,
          tool: name,
          executionTime: Date.now() - start,
        },
      };
    }
  }

  async listTools(): Promise<MCPTool[]> {
    return this.tools;
  }
}

// Singleton export for hub registration
export const {{serverVar}}Server = new {{ClassName}}MCPServer();
```

**hub-server.ts Rules:**
- Choose ONE auth pattern in `setTokens()`, delete the others (match api-client.ts)
- The `tools` array from `tools.ts` is reused directly — no duplication
- The `handler` functions from `tools.ts` work identically — they take `(client, args)`
- Always return `MCPResponse` format: `{ success, data, error, metadata }`
- Export a singleton instance for import into `mcp-server-manager.ts`

**To register in Agent-in-a-Box:**
1. Copy `hub-server.ts` (and its compiled output) to the agentinabox servers folder, OR import directly
2. Add to `mcp-server-manager.ts`:
   ```typescript
   import { {{serverVar}}Server } from './servers/{{server-name}}/hub-server.js';
   // In initializeBundledServers():
   await orchestrator.registerServer({{serverVar}}Server);
   ```
3. Add a well-known entry:
   ```typescript
   { id: 'mcp-{{server-name}}', name: '{{SERVICE_NAME}}', npmPackage: '__bundled__',
     category: '{{category}}', envVars: [{ name: '{{ENV_KEY}}', required: true, tokenField: 'token1' }] }
   ```

---

## Phase 4: Generate Interactive Documentation

Create `docs/index.html` — a dark-themed, interactive API reference page.

**The docs/index.html MUST include:**
1. **Dark theme** with CSS variables for theming
2. **Sidebar** with search (Ctrl+/) and category navigation
3. **Hero section** with server name, description, stats (tool count, pass rate, avg response time)
4. **Tool cards** grouped by category, each showing:
   - Tool name and description
   - Parameter table (name, type, required, description)
   - Interactive parameter inputs that generate live MCP request JSON
   - Copy-to-clipboard button with toast notification
   - Collapsible example response
5. **Responsive** — sidebar hides on mobile

**For the exact HTML/CSS/JS pattern, read:**
- `C:\Users\oreph\clawd\OrphilLLC\Clients\NodeFortress\mcp-server\docs\index.html` (931 lines, the gold standard)

The key data structure in the HTML is a TOOLS array:

```javascript
const TOOLS = [
  {
    name: 'tool_name',
    description: 'What it does',
    category: 'Category Name',
    params: [
      { name: 'id', type: 'string', required: true, description: 'The item ID' },
      { name: 'limit', type: 'number', required: false, description: 'Max results' }
    ],
    exampleResponse: { id: "abc123", name: "Example", status: "active" }
  },
  // ... all tools
];
```

**CSS Theme Variables to customize per client:**
```css
:root {
  --bg-primary: #0a0e1a;
  --bg-secondary: #0f1629;
  --bg-sidebar: #0d1220;
  --bg-card: #111827;
  --accent-primary: {{ACCENT_COLOR}};      /* Client brand color */
  --accent-primary-bg: {{ACCENT_COLOR_BG}}; /* 10% opacity version */
}
```

---

## Phase 5: Create Test Suite

Create `test/test-tools.ts` following this pattern:

```typescript
import { {{ClientName}} } from '../src/api-client.js';
import { tools } from '../src/tools.js';

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL';
  elapsed: number;
  error?: string;
}

async function runTests() {
  const client = new {{ClientName}}(/* credentials if needed */);
  const results: TestResult[] = [];

  // Gather sample IDs from list endpoints first
  console.log('Gathering test data...\n');
  // e.g., const items = await client.listItems();
  // const sampleId = items[0]?.id;

  for (const tool of tools) {
    const start = Date.now();
    try {
      // Build test args based on tool name
      let args: any = {};
      // Add logic to provide sample IDs for tools that need them

      const result = await tool.handler(client, args);
      const elapsed = Date.now() - start;

      results.push({ name: tool.name, status: 'PASS', elapsed });
      console.log(`  [PASS] ${tool.name} (${elapsed}ms)`);
    } catch (error) {
      const elapsed = Date.now() - start;
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name: tool.name, status: 'FAIL', elapsed, error: message });
      console.log(`  [FAIL] ${tool.name} (${elapsed}ms) - ${message}`);
    }

    // Rate limiting courtesy
    await new Promise(r => setTimeout(r, 300));
  }

  // Summary
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const avgTime = Math.round(results.reduce((sum, r) => sum + r.elapsed, 0) / results.length);

  console.log(`\n--- Results ---`);
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Pass Rate: ${((passed / results.length) * 100).toFixed(1)}%`);
  console.log(`Avg Response: ${avgTime}ms`);
}

runTests().catch(console.error);
```

---

## Phase 6: Build, Test, and Document

### Build & Test
```bash
npm install
npm run build
npm test
```

### Generate README.md

The README must include:
1. Server name and description
2. Tool count and categories
3. Installation instructions (`git clone` → `npm install` → `npm run build`)
4. Claude Desktop configuration JSON snippet
5. Tool reference table (name, description, status)
6. Known limitations
7. Links to API docs

### Claude Desktop Config Snippet

```json
{
  "mcpServers": {
    "{{server-name}}": {
      "command": "node",
      "args": ["{{FULL_PATH_TO_DIST}}/index.js"],
      "env": {
        {{ENV_CONFIG}}
      }
    }
  }
}
```

### Create docs/TEST-RESULTS.md

After running tests, document:
- Test date
- Environment (Node.js version, OS)
- Pass rate and avg response time
- Per-tool results
- Known issues or API bugs discovered

---

## Phase 7: Reference Comparison (FINAL GATE)

This is the last step before declaring the server complete. **Do NOT skip this.**

1. **Pick the closest reference server** based on auth type and API type (see checklist rules above)
2. **Read these files from the reference server:**
   - `src/index.ts` — verify your standalone server wiring matches
   - `src/api-client.ts` — verify your request() pattern matches
   - `src/tools.ts` — verify your tool structure matches
   - `docs/index.html` — verify your docs have the same features
   - `test/test-tools.ts` — verify your test pattern matches
3. **Compare hub-server.ts against an agentinabox bundled server:**
   - Read a server from `C:\Users\oreph\Documents\AgenticLedger\Custom Applications\agentinabox\agentinabox_v2\server\src\mcp-hub\servers\` (e.g., `ccview/index.ts` or `gmail/index.ts`)
   - Verify your `MCPServerInstance` implementation matches the pattern
   - Verify `setTokens()` → client construction works correctly
   - Verify `executeTool()` returns proper `MCPResponse` format
4. **Document any deviations** — if you did something differently, explain why in the checklist
4. **Update BUILD_CHECKLIST.md** — mark all Phase 7 items, fill in completion date and status

Only after Phase 7 is complete can you declare the server done.

---

## Workflow Summary

```
Phase 1: Research API        → Update checklist
Phase 2: Scaffold project    → Update checklist
Phase 3: Implement server    → Update checklist
Phase 4: Generate docs       → Update checklist
Phase 5: Create & run tests  → Update checklist
Phase 6: Finalize (README, TEST-RESULTS) → Update checklist
Phase 7: Compare to reference → Update checklist → DONE
```

Every phase ends with updating `BUILD_CHECKLIST.md`. The checklist IS the deliverable tracker.
