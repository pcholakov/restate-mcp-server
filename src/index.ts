import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  DeploymentResponseSchema,
  ListDeploymentsResponseSchema,
  ListServicesResponseSchema,
  RegisterDeploymentRequestSchema,
  RegisterDeploymentResponseSchema,
  ServiceMetadataSchema,
} from "./schemas.js";

// Define fetch type for Node.js environment
declare const fetch: (url: string, options?: RequestInit) => Promise<Response>;

const RESTATE_API_BASE = process.env.RESTATE_API_BASE ?? "http://localhost:9070";
const USER_AGENT = "restate-mcp-server/0.0.1";

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

// Restate Admin API client
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
- **query**: Query Restate state and metadata using SQL syntax

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

### Querying Restate Data
Use \`query\` to query Restate's introspection schema using SQL:
\`\`\`
{
  "query": "SELECT * FROM state WHERE service_name = 'greeter'"
}
\`\`\`

## Introspection Schema Tables

### Table: state
Query service key-value state data.

| Column name | Type | Description |
| --- | --- | --- |
| \`partition_key\` | \`UInt64\` | Internal column that is used for partitioning the services invocations. Can be ignored. |
| \`service_name\` | \`Utf8\` | The name of the invoked service. |
| \`service_key\` | \`Utf8\` | The key of the Virtual Object. |
| \`key\` | \`Utf8\` | The \`utf8\` state key. |
| \`value_utf8\` | \`Utf8\` | Only contains meaningful values when a service stores state as \`utf8\`. This is the case for services that serialize state using JSON (default for Typescript SDK, Java/Kotlin SDK if using JsonSerdes). |
| \`value\` | \`Binary\` | A binary, uninterpreted representation of the value. You can use the more specific column \`value_utf8\` if the value is a string. |

### Table: sys_journal
Query journal entries for service invocations.

| Column name | Type | Description |
| --- | --- | --- |
| \`partition_key\` | \`UInt64\` | Internal column that is used for partitioning the services invocations. Can be ignored. |
| \`id\` | \`Utf8\` | Invocation ID. |
| \`index\` | \`UInt32\` | The index of this journal entry. |
| \`entry_type\` | \`Utf8\` | The entry type. |
| \`name\` | \`Utf8\` | The name of the entry supplied by the user, if any. |
| \`completed\` | \`Boolean\` | Indicates whether this journal entry has been completed; this is only valid for some entry types. |
| \`invoked_id\` | \`Utf8\` | If this entry represents an outbound invocation, indicates the ID of that invocation. |
| \`invoked_target\` | \`Utf8\` | If this entry represents an outbound invocation, indicates the invocation Target. |
| \`sleep_wakeup_at\` | \`TimestampMillisecond\` | If this entry represents a sleep, indicates wakeup time. |
| \`promise_name\` | \`Utf8\` | If this entry is a promise related entry, indicates the promise name. |
| \`raw\` | \`Binary\` | Raw binary representation of the entry. |
| \`version\` | \`UInt32\` | The journal version. |
| \`entry_json\` | \`Utf8\` | The entry serialized as a JSON string (only relevant for journal version 2) |
| \`appended_at\` | \`TimestampMillisecond\` | When the entry was appended to the journal |

### Table: sys_keyed_service_status
Query status information for keyed services.

| Column name | Type | Description |
| --- | --- | --- |
| \`partition_key\` | \`UInt64\` | Internal column that is used for partitioning the services invocations. Can be ignored. |
| \`service_name\` | \`Utf8\` | The name of the invoked virtual object/workflow. |
| \`service_key\` | \`Utf8\` | The key of the virtual object/workflow. |
| \`invocation_id\` | \`Utf8\` | Invocation ID. |

### Table: sys_inbox
Query inbox entries for services.

| Column name | Type | Description |
| --- | --- | --- |
| \`partition_key\` | \`UInt64\` | Internal column that is used for partitioning the services invocations. Can be ignored. |
| \`service_name\` | \`Utf8\` | The name of the invoked virtual object/workflow. |
| \`service_key\` | \`Utf8\` | The key of the virtual object/workflow. |
| \`id\` | \`Utf8\` | Invocation ID. |
| \`sequence_number\` | \`UInt64\` | Sequence number in the inbox. |
| \`created_at\` | \`TimestampMillisecond\` | Timestamp indicating the start of this invocation. DEPRECATED: you should not use this field anymore, but join with the sys_invocation table |

### Table: sys_idempotency
Query idempotency information.

| Column name | Type | Description |
| --- | --- | --- |
| \`partition_key\` | \`UInt64\` | Internal column that is used for partitioning the services invocations. Can be ignored. |
| \`service_name\` | \`Utf8\` | The name of the invoked service. |
| \`service_key\` | \`Utf8\` | The key of the virtual object or the workflow ID. Null for regular services. |
| \`service_handler\` | \`Utf8\` | The invoked handler. |
| \`idempotency_key\` | \`Utf8\` | The user provided idempotency key. |
| \`invocation_id\` | \`Utf8\` | Invocation ID. |

### Table: sys_promise
Query workflow promises.

| Column name | Type | Description |
| --- | --- | --- |
| \`partition_key\` | \`UInt64\` | Internal column that is used for partitioning the services invocations. Can be ignored. |
| \`service_name\` | \`Utf8\` | The name of the workflow service. |
| \`service_key\` | \`Utf8\` | The workflow ID. |
| \`key\` | \`Utf8\` | The promise key. |
| \`completed\` | \`Boolean\` | True if the promise was completed. |
| \`completion_success_value\` | \`Binary\` | The completion success, if any. |
| \`completion_success_value_utf8\` | \`Utf8\` | The completion success as UTF-8 string, if any. |
| \`completion_failure\` | \`Utf8\` | The completion failure, if any. |

### Table: sys_service
Query service metadata.

| Column name | Type | Description |
| --- | --- | --- |
| \`name\` | \`Utf8\` | The name of the registered user service. |
| \`revision\` | \`UInt64\` | The latest deployed revision. |
| \`public\` | \`Boolean\` | Whether the service is accessible through the ingress endpoint or not. |
| \`ty\` | \`Utf8\` | The service type. Either \`service\` or \`virtual_object\` or \`workflow\`. |
| \`deployment_id\` | \`Utf8\` | The ID of the latest deployment |

### Table: sys_deployment
Query deployment information.

| Column name | Type | Description |
| --- | --- | --- |
| \`id\` | \`Utf8\` | The ID of the service deployment. |
| \`ty\` | \`Utf8\` | The type of the endpoint. Either \`http\` or \`lambda\`. |
| \`endpoint\` | \`Utf8\` | The address of the endpoint. Either HTTP URL or Lambda ARN. |
| \`created_at\` | \`TimestampMillisecond\` | Timestamp indicating the deployment registration time. |
| \`min_service_protocol_version\` | \`UInt32\` | Minimum supported protocol version. |
| \`max_service_protocol_version\` | \`UInt32\` | Maximum supported protocol version. |

### Table: sys_invocation
Query invocation details.

| Column name | Type | Description |
| --- | --- | --- |
| \`id\` | \`Utf8\` | Invocation ID. |
| \`target\` | \`Utf8\` | Invocation Target. Format for plain services: \`ServiceName/HandlerName\`, e.g. \`Greeter/greet\`. Format for virtual objects/workflows: \`VirtualObjectName/Key/HandlerName\`, e.g. \`Greeter/Francesco/greet\`. |
| \`target_service_name\` | \`Utf8\` | The name of the invoked service. |
| \`target_service_key\` | \`Utf8\` | The key of the virtual object or the workflow ID. Null for regular services. |
| \`target_handler_name\` | \`Utf8\` | The invoked handler. |
| \`target_service_ty\` | \`Utf8\` | The service type. Either \`service\` or \`virtual_object\` or \`workflow\`. |
| \`status\` | \`Utf8\` | Either \`pending\` or \`scheduled\` or \`ready\` or \`running\` or \`backing-off\` or \`suspended\` or \`completed\`. |

## Query Examples

\`\`\`
// Query all greeter service keys
"query": "SELECT * FROM state WHERE service_name = 'greeter'"

// Query specific object key's state
"query": "SELECT * FROM state WHERE service_name = 'greeter' AND service_key = 'world'"

// Query running invocations
"query": "SELECT * FROM sys_invocation WHERE status = 'running'"

// Query workflow promises
"query": "SELECT * FROM sys_promise WHERE service_name = 'OrderWorkflow'"
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
  "query",
  "Query Restate state and metadata using SQL syntax. Available tables include 'state', 'sys_journal', 'sys_keyed_service_status', 'sys_inbox', 'sys_idempotency', 'sys_promise', 'sys_service', 'sys_deployment', and 'sys_invocation'.",
  {
    query: z.string().describe("SQL query to execute against Restate's introspection schema"),
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
