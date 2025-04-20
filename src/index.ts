import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Define fetch type for Node.js environment
declare const fetch: (url: string, options?: RequestInit) => Promise<Response>;

const RESTATE_API_BASE = process.env.RESTATE_API_BASE ?? "http://localhost:9070";
const USER_AGENT = "restate-mcp-server/0.0.1";

// Schema definitions for Restate API responses
const ServiceNameRevPairSchema = z.object({
  name: z.string(),
  revision: z.number().int().min(0),
});

// Deployment response schemas
const DeploymentBaseSchema = z.object({
  id: z.string(),
  services: z.array(ServiceNameRevPairSchema),
});

const HttpDeploymentSchema = DeploymentBaseSchema.extend({
  uri: z.string(),
  protocol_type: z.enum(["RequestResponse", "BidiStream"]),
  http_version: z.string(),
  created_at: z.string(),
  min_protocol_version: z.number().int(),
  max_protocol_version: z.number().int(),
  additional_headers: z.record(z.string()).optional(),
});

const LambdaDeploymentSchema = DeploymentBaseSchema.extend({
  arn: z.string(),
  assume_role_arn: z.string().nullable().optional(),
  created_at: z.string(),
  min_protocol_version: z.number().int(),
  max_protocol_version: z.number().int(),
  additional_headers: z.record(z.string()).optional(),
});

const DeploymentResponseSchema = z.union([HttpDeploymentSchema, LambdaDeploymentSchema]);
const ListDeploymentsResponseSchema = z.object({
  deployments: z.array(DeploymentResponseSchema),
});

// Handler metadata schema
const HandlerMetadataSchema = z.object({
  name: z.string(),
  ty: z.enum(["Exclusive", "Shared", "Workflow"]).nullable().optional(),
  documentation: z.string().nullable().optional(),
  metadata: z.record(z.string()).optional(),
  input_description: z.string(),
  output_description: z.string(),
  input_json_schema: z.any().nullable().optional(),
  output_json_schema: z.any().nullable().optional(),
});

// Service metadata schema
const ServiceMetadataSchema = z.object({
  name: z.string(),
  handlers: z.array(HandlerMetadataSchema),
  ty: z.enum(["Service", "VirtualObject", "Workflow"]),
  documentation: z.string().nullable().optional(),
  metadata: z.record(z.string()).optional(),
  deployment_id: z.string(),
  revision: z.number().int().min(0),
  public: z.boolean(),
  idempotency_retention: z.string(),
  workflow_completion_retention: z.string().nullable().optional(),
  inactivity_timeout: z.string().nullable().optional(),
  abort_timeout: z.string().nullable().optional(),
});

const ListServicesResponseSchema = z.object({
  services: z.array(ServiceMetadataSchema),
});

// Registration request schemas
const HttpRegisterDeploymentRequestSchema = z.object({
  uri: z.string(),
  additional_headers: z.record(z.string()).nullable().optional(),
  use_http_11: z.boolean().default(false).optional(),
  force: z.boolean().default(true).optional(),
  dry_run: z.boolean().default(false).optional(),
});

const LambdaRegisterDeploymentRequestSchema = z.object({
  arn: z.string(),
  assume_role_arn: z.string().nullable().optional(),
  additional_headers: z.record(z.string()).nullable().optional(),
  force: z.boolean().default(true).optional(),
  dry_run: z.boolean().default(false).optional(),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const RegisterDeploymentRequestSchema = z.union([
  HttpRegisterDeploymentRequestSchema,
  LambdaRegisterDeploymentRequestSchema,
]);

const RegisterDeploymentResponseSchema = z.object({
  id: z.string(),
  services: z.array(ServiceMetadataSchema),
});

// Implementation of the Restate service management
async function fetchWithOptions(url: string, options: RequestInit = {}) {
  const headers = {
    "User-Agent": USER_AGENT,
    ...options.headers,
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      try {
        const errorJson = JSON.parse(errorText);
        throw new Error(
          `${response.status} ${response.statusText}: ${errorJson.message || errorText}`,
        );
      } catch {
        // JSON parse error, use raw text
        throw new Error(`${response.status} ${response.statusText}: ${errorText}`);
      }
    }

    if (response.status === 204 || response.headers.get("Content-Length") === "0") {
      return null;
    }

    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch ${url}: ${error.message}`);
    }
    throw error;
  }
}

// Restate API client
const restateApi = {
  async listDeployments() {
    const data = await fetchWithOptions(`${RESTATE_API_BASE}/deployments`);
    return ListDeploymentsResponseSchema.parse(data);
  },

  async getDeployment(deploymentId: string) {
    const data = await fetchWithOptions(`${RESTATE_API_BASE}/deployments/${deploymentId}`);
    return DeploymentResponseSchema.parse(data);
  },

  async createDeployment(request: z.infer<typeof RegisterDeploymentRequestSchema>) {
    const data = await fetchWithOptions(`${RESTATE_API_BASE}/deployments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
    return RegisterDeploymentResponseSchema.parse(data);
  },

  async deleteDeployment(deploymentId: string, force: boolean = true) {
    await fetchWithOptions(`${RESTATE_API_BASE}/deployments/${deploymentId}?force=${force}`, {
      method: "DELETE",
    });
    return { success: true };
  },

  async listServices() {
    const data = await fetchWithOptions(`${RESTATE_API_BASE}/services`);
    return ListServicesResponseSchema.parse(data);
  },

  async getService(serviceName: string) {
    const data = await fetchWithOptions(`${RESTATE_API_BASE}/services/${serviceName}`);
    return ServiceMetadataSchema.parse(data);
  },

  async modifyService(
    serviceName: string,
    options: { public?: boolean; idempotency_retention?: string },
  ) {
    const data = await fetchWithOptions(`${RESTATE_API_BASE}/services/${serviceName}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options),
    });
    return ServiceMetadataSchema.parse(data);
  },

  async listInvocations() {
    // Query the sys_invocation table via SQL introspection
    const query = "SELECT * FROM sys_invocation WHERE status = 'Running'";
    const result = await this.queryKVState(query);

    // Transform the result to match the expected schema
    const invocations = (result.rows || []).map((row: Record<string, unknown>) => ({
      id: row.id || "",
      service: row.service_name || "",
      handler: row.handler_name || "",
      status: row.status || "Running",
      started_at: row.started_at || new Date().toISOString(),
      completed_at: row.completed_at || null,
      object_key: row.object_key || undefined,
    }));

    return { invocations };
  },

  async queryKVState(query: string) {
    // Uses direct HTTP request with proper error handling
    try {
      // Directly use fetch with proper handling for potential binary response
      const response = await fetch(`${RESTATE_API_BASE}/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Server error: ${response.status} ${response.statusText} - ${text}`);
      }

      // Check content type to avoid parsing binary data
      const contentType = response.headers.get("Content-Type");
      if (contentType && !contentType.includes("application/json")) {
        throw new Error(`Unexpected response type: ${contentType}`);
      }

      // Get as text first to catch any JSON parse errors
      const textResponse = await response.text();
      try {
        return JSON.parse(textResponse);
      } catch {
        // JSON parse error
        throw new Error(`Invalid JSON response: ${textResponse.substring(0, 50)}...`);
      }
    } catch (error) {
      throw new Error(`SQL query error: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

// Define resources for providing documentation and context to clients
const restateOverviewContent = `# Restate Architecture Overview

Restate is a distributed runtime for reliable, stateful services.

## Key Concepts

- **Deployments**: Services are registered via deployments that provide an HTTP endpoint or Lambda ARN
- **Services**: Individual services exposed by a deployment that can be invoked
- **Handlers**: Functions within a service that can be called
- **Service Types**:
  - *Service*: Stateless service
  - *VirtualObject*: Stateful service with exclusive access to state
  - *Workflow*: Long-running, restartable service flow

## API Structure

- **/deployments**: Register, list, and manage service deployments
- **/services**: View and configure services
- **/services/{service}/handlers**: View service handlers and their metadata
- **/subscriptions**: Manage event subscriptions between services
`;

const restateToolsDocContent = `# Restate Management Tools

This MCP server provides tools to interact with a Restate admin API.

## Available Tools

- **list-deployments**: List all registered service deployments
- **get-deployment**: Get details of a specific deployment by ID
- **create-deployment**: Register a new deployment (HTTP endpoint or Lambda)
- **delete-deployment**: Remove a deployment from Restate
- **list-services**: List all available services
- **get-service**: Get details of a specific service
- **modify-service**: Configure a service (visibility, retention, etc.)
- **list-invocations**: List all running service invocations
- **query-kv-state**: Query service KV state using SQL syntax

## Common Operations

### Registering a Deployment
Use \`create-deployment\` with a service URI to register a new deployment:
\`\`\`
{
  "uri": "http://localhost:8080",
  "force": true
}
\`\`\`

### Configuring Service Visibility
Use \`modify-service\` to change service accessibility:
\`\`\`
{
  "serviceName": "my-service",
  "isPublic": true
}
\`\`\`

### Listing Running Invocations
Use \`list-invocations\` to see all currently running service invocations:
\`\`\`
{}
\`\`\`

### Querying Service State
Use \`query-kv-state\` to query a service's key-value state using SQL:
\`\`\`
{
  "query": "SELECT * FROM state WHERE service_name = 'greeter'"
}
\`\`\`

The SQL query uses table name 'state' with these common columns:
- service_name: Name of the service
- service_key: Virtual object key (same as objectKey)
- key: The KV state key
- value_utf8: String representation of the value
- value: Binary representation of the value
- partition_key: Internal Restate partition identifier

Examples:
\`\`\`
// Query all greeter service keys
"query": "SELECT * FROM state WHERE service_name = 'greeter'"

// Query specific object key's state
"query": "SELECT * FROM state WHERE service_name = 'greeter' AND service_key = 'world'"

// Query by specific value
"query": "SELECT * FROM state WHERE key = 'count' AND value_utf8 = '2'"
\`\`\`
`;

// Create server instance
const server = new McpServer({
  name: "restate",
  version: "0.0.1",
  capabilities: {
    resources: {
      manual: true, // Enables manual resource registration
    },
    tools: {
      listChanged: true, // Notify clients when tools change
    },
  },
});

// Register tools using the server.tool() method to ensure proper exposure
server.tool(
  "list-deployments",
  "List all registered Restate deployments",
  {}, // Empty object for no parameters
  async () => {
    const result = await restateApi.listDeployments();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "get-deployment",
  "Get a specific Restate deployment by ID",
  {
    deploymentId: z.string().describe("Deployment identifier"),
  },
  async ({ deploymentId }) => {
    const result = await restateApi.getDeployment(deploymentId);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "create-deployment",
  "Register a new deployment with the Restate server",
  {
    uri: z.string().describe("URI of the deployment to register"),
    additionalHeaders: z.record(z.string()).optional().describe("Optional additional headers"),
    useHttp11: z.boolean().optional().describe("Use HTTP/1.1 instead of HTTP/2"),
    force: z.boolean().optional().describe("Force registration even if deployment exists"),
  },
  async ({ uri, additionalHeaders, useHttp11, force }) => {
    const request = {
      uri,
      additional_headers: additionalHeaders,
      use_http_11: useHttp11,
      force,
    };

    const result = await restateApi.createDeployment(request);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "delete-deployment",
  "Delete a deployment from the Restate server",
  {
    deploymentId: z.string().describe("Deployment identifier"),
    force: z.boolean().default(true).describe("Force delete the deployment"),
  },
  async ({ deploymentId, force }) => {
    await restateApi.deleteDeployment(deploymentId, force);
    return {
      content: [
        {
          type: "text",
          text: `Successfully deleted deployment: ${deploymentId}`,
        },
      ],
    };
  },
);

server.tool(
  "list-services",
  "List all registered services in the Restate server",
  {}, // Empty object for no parameters
  async () => {
    const result = await restateApi.listServices();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "get-service",
  "Get a specific service by name",
  {
    serviceName: z.string().describe("Fully qualified service name"),
  },
  async ({ serviceName }) => {
    const result = await restateApi.getService(serviceName);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "modify-service",
  "Modify a registered service configuration",
  {
    serviceName: z.string().describe("Fully qualified service name"),
    isPublic: z.boolean().optional().describe("Make service publicly accessible"),
    idempotencyRetention: z.string().optional().describe("Idempotency retention duration"),
  },
  async ({ serviceName, isPublic, idempotencyRetention }) => {
    const options: { public?: boolean; idempotency_retention?: string } = {};

    if (isPublic !== undefined) {
      options.public = isPublic;
    }

    if (idempotencyRetention !== undefined) {
      options.idempotency_retention = idempotencyRetention;
    }

    const result = await restateApi.modifyService(serviceName, options);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "query-kv-state",
  "Query service KV state using SQL syntax. The table name is 'state' and common columns include 'service_name', 'service_key' (object_key), 'key', and 'value_utf8'.",
  {
    query: z
      .string()
      .describe(
        "SQL query to execute against the KV state (use 'state' as the table name, not 'kv_state')",
      ),
  },
  async ({ query }) => {
    const result = await restateApi.queryKVState(query);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

// Register documentation resources
server.resource(
  "restate-overview",
  "restate-overview",
  {
    description: "Overview of Restate architecture and concepts",
  },
  async () => {
    return {
      contents: [
        {
          uri: "restate-overview.md",
          text: restateOverviewContent,
        },
      ],
    };
  },
);

server.resource(
  "restate-tools-guide",
  "restate-tools-guide",
  {
    description: "Documentation for using Restate management tools",
  },
  async () => {
    return {
      contents: [
        {
          uri: "restate-tools-guide.md",
          text: restateToolsDocContent,
        },
      ],
    };
  },
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
