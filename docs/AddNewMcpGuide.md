# Adding a New MCP Server

## 1. Add the MCP definition to `config.json`

Under the top-level `"mcps"` object, add a new entry:

### Stdio MCP (local process)
```json
"mcps": {
  "my-new-mcp": {
    "type": "stdio",
    "command": "node",
    "args": ["~/path/to/mcp-server/dist/index.js"],
    "env": {
      "API_URL": "https://your-api.example.com",
      "API_KEY": "your-key"
    }
  }
}
```

### HTTP MCP (remote server)
```json
"mcps": {
  "my-http-mcp": {
    "type": "http",
    "url": "https://your-mcp-server.example.com/mcp",
    "headers": {
      "Authorization": "Bearer your-token"
    }
  }
}
```

## 2. Assign the MCP to an agent

In the agent's config within `config.json`, add the MCP name to its `mcps` array:

```json
"my-agent": {
  "mcps": ["my-new-mcp"],
  ...
}
```

The executor automatically:
- Generates a temp `.mcp.json` config file per invocation
- Passes `--mcp-config <path> --strict-mcp-config` to `claude -p`
- Adds `mcp__<server-name>__*` to `--allowedTools` so the agent can call all tools on that MCP
- Cleans up temp files after execution

## 3. Rebuild and restart

```bash
npm run build
launchctl unload ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist
launchctl load ~/Library/LaunchAgents/com.agenticledger.channelToAgentToClaude.plist
```

## Config validation

On startup, `loadConfig()` validates:
- Each MCP definition has required fields (`command` for stdio, `url` for http/sse)
- Each agent's `mcps` references exist in the top-level `mcps` registry
- MCP type is one of: `stdio`, `http`, `sse`

## MCP reference repos

- **Stdio pattern**: https://github.com/agenticledger/financeMCPsLive
- **HTTP (Bearer auth)**: https://github.com/agenticledger/smartsheets-mcp-http
- **HTTP (OAuth + API key)**: https://github.com/agenticledger/qbo-mcp-http
- **Expose stdio as HTTP**: Use `/opMCPExpose` to wrap any stdio MCP as a Streamable HTTP server
