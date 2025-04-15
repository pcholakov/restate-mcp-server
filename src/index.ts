import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const NWS_API_BASE = "https://localhost:9070";
const USER_AGENT = "restate-mcp-server/0.0.1";

// Create server instance
const server = new McpServer({
    name: "restate",
    version: "0.0.1",
    capabilities: {
        resources: {},
        tools: {},
    },
});