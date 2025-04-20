# Restate operations MCP server

This is an MCP server that exposes the Restate Admin API as tools over MCP.

## Running

Build the server:

```sh
npm run clean-install && npm run build
```

Register the MCP server:

```json
{
  "mcpServers": {
    "restate": {
      "command": "node",
      "args": [".../restate-mcp-server/dist/index.js"]
    }
  }
}
```

## What can it do?

At the moment, support is still very basic - tools cover the most common

- Manage services and deployments, including updating configuration settings
- List, cancel/kill service invocations
- Query KV state and other attributes exposed via the introspection schema

Things to try:

> Can you list my Restate services?

> Deploy a service running at ...

> Update idempotency retention to ...
