import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ChildProcess, spawn } from "child_process";
import { GenericContainer } from "testcontainers";
import { setTimeout } from "timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { simpleService } from "./simple-service.js";

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

const RegisterDeploymentResponseSchema = z.object({
  id: z.string(),
  services: z.array(z.any()),
});

let restateTestEnvironment: RestateTestEnvironment;
let simpleServiceProcess: ChildProcess;
let restateClient: clients.Ingress;
let mcpClient: Client;

// Implementation of the Restate service management for testing
async function fetchWithOptions(url: string, options: RequestInit = {}) {
  const headers = {
    "User-Agent": "restate-mcp-server/0.0.1",
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

// Restate API client for testing
const testRestateApi = {
  async listDeployments() {
    const data = await fetchWithOptions(`${process.env.RESTATE_API_BASE}/deployments`);
    return ListDeploymentsResponseSchema.parse(data);
  },

  async createDeployment(request: { uri: string; force?: boolean }) {
    const data = await fetchWithOptions(`${process.env.RESTATE_API_BASE}/deployments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
    return RegisterDeploymentResponseSchema.parse(data);
  },
};

beforeAll(async () => {
  // Start Restate server
  restateTestEnvironment = await RestateTestEnvironment.start(() =>
    new GenericContainer("restatedev/restate:1.3")
      .withEnvironment({ RESTATE_LOG_FORMAT: "compact" })
      .withLogConsumer((stream) => {
        stream.on("data", (line) => console.info(line));
        stream.on("err", (line) => console.error(line));
      }),
  );

  restateClient = clients.connect({ url: restateTestEnvironment.baseUrl() });

  const healthCheckResponse = await fetch(`${restateTestEnvironment.adminAPIBaseUrl()}/health`);
  expect(healthCheckResponse.ok);

  // Start our simple service on port 9080
  simpleServiceProcess = spawn("tsx", ["src/test/simple-service.ts"]);
  simpleServiceProcess.stdout?.on("data", (data) => {
    console.log(`Simple service: ${data}`);
  });
  simpleServiceProcess.stderr?.on("data", (data) => {
    console.error(`Simple service error: ${data}`);
  });

  // Wait for service to start
  await setTimeout(2000);

  // TODO: remove
  process.env.RESTATE_API_BASE = restateTestEnvironment.adminAPIBaseUrl();
  console.log(`Restate Admin API URL: ${process.env.RESTATE_API_BASE}`);

  const transport = new StdioClientTransport({
    command: "tsx",
    args: ["src/index.ts"],
    env: {
      ...process.env,
      RESTATE_API_BASE: restateTestEnvironment.adminAPIBaseUrl(),
    },
  });

  mcpClient = new Client({
    name: "e2e-test",
    version: "0.0.1",
  });

  await mcpClient.connect(transport);
});

afterAll(async () => {
  if (mcpClient) {
    await mcpClient.close();
  }

  if (simpleServiceProcess) {
    simpleServiceProcess.kill();
  }

  if (restateTestEnvironment) {
    await restateTestEnvironment.stop();
  }
});

describe("Restate MCP server", () => {
  it("is running", async () => {
    await mcpClient.ping();
    const tools = await mcpClient.listTools();
    expect(tools).toBeDefined();
  });

  it("can deploy and list services", async () => {
    // Deploy the service using the Restate API directly
    const deploymentData = await testRestateApi.createDeployment({
      uri: "http://host.docker.internal:9080",
      force: true,
    });

    expect(deploymentData).toBeDefined();
    expect(deploymentData.id).toBeDefined();

    const listDeploymentsResponse = (await mcpClient.callTool({
      name: "list-deployments",
      arguments: {},
    })) as { content: [{ type; text: string }] };

    console.log("Raw list-deployments response:", listDeploymentsResponse);

    expect(listDeploymentsResponse.content[0].type).toBe("text");
    const deploymentParsed = JSON.parse(listDeploymentsResponse.content[0].text);

    console.log("Parsed list-deployments response:", JSON.stringify(deploymentParsed, null, 2));

    const deployments = ListDeploymentsResponseSchema.parse(deploymentParsed);

    const foundDeployment = deployments.deployments.find(
      (d: { id: string }) => d.id === deploymentData.id,
    );
    expect(foundDeployment).toBeDefined();

    if (foundDeployment && "uri" in foundDeployment) {
      // The URI might have a trailing slash, so we'll check if it starts with the expected value
      expect(foundDeployment?.uri?.startsWith("http://host.docker.internal:9080")).toBe(true);
    }

    const serviceFound = deploymentData.services.some((s) => s.name === "SimpleService");
    expect(serviceFound).toBe(true);
  });
});

describe("Invocation management", () => {
  it("can list and cancel ongoing invocations", async () => {
    const client = restateClient.serviceSendClient(simpleService);
    const handle = await client.longRunning({}, clients.rpc.sendOpts({}));

    console.log(`Submitted long-running invocation: ${handle.invocationId}`);

    // todo: list invocations, cancel long-running, list again to confirm it's gone
  });
});
