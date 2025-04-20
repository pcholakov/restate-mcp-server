import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ChildProcess, spawn } from "child_process";
import { GenericContainer } from "testcontainers";
import { setTimeout } from "timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ListDeploymentsResponseSchema } from "../../src/schemas.js";
import { simpleService } from "./simple-service.js";

let restateTestEnvironment: RestateTestEnvironment;
let simpleServiceProcess: ChildProcess;
let restateClient: clients.Ingress;
let mcpClient: Client;

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
  await setTimeout(1000);

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
    // Deploy the service using the MCP client
    const createDeploymentResponse = (await mcpClient.callTool({
      name: "create-deployment",
      arguments: {
        uri: "http://host.docker.internal:9080",
        force: true,
      },
    })) as { content: [{ type; text: string }] };

    expect(createDeploymentResponse.content[0].type).toBe("text");
    const deploymentData = JSON.parse(createDeploymentResponse.content[0].text);

    console.log("Parsed create-deployment response:", JSON.stringify(deploymentData, null, 2));

    expect(deploymentData).toBeDefined();
    expect(deploymentData.id).toBeDefined();

    // List deployments using the MCP client
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

    // List invocations to check if our long-running invocation is there
    const listInvocationsResponse = (await mcpClient.callTool({
      name: "list-invocations",
      arguments: {},
    })) as { content: [{ type; text: string }] };

    expect(listInvocationsResponse.content[0].type).toBe("text");
    const invocationsData = JSON.parse(listInvocationsResponse.content[0].text);
    console.log("Running invocations:", JSON.stringify(invocationsData, null, 2));

    // Verify our invocation is in the list
    const foundInvocation = invocationsData.invocations.some(
      (inv: { id: string }) => inv.id === handle.invocationId,
    );
    expect(foundInvocation).toBe(true);

    // Cancel the invocation
    const cancelResponse = (await mcpClient.callTool({
      name: "cancel-invocation",
      arguments: {
        invocationId: handle.invocationId,
        mode: "Cancel",
      },
    })) as { content: [{ type; text: string }] };

    expect(cancelResponse.content[0].type).toBe("text");
    console.log("Cancel response:", cancelResponse.content[0].text);

    // List invocations again to verify the invocation is gone
    const listInvocationsAfterCancelResponse = (await mcpClient.callTool({
      name: "list-invocations",
      arguments: {},
    })) as { content: [{ type; text: string }] };

    expect(listInvocationsAfterCancelResponse.content[0].type).toBe("text");
    const invocationsAfterCancelData = JSON.parse(
      listInvocationsAfterCancelResponse.content[0].text,
    );
    console.log(
      "Running invocations after cancel:",
      JSON.stringify(invocationsAfterCancelData, null, 2),
    );

    // Wait for the cancelation to reflect; we've seen the test below fail occasionally without the wait
    await setTimeout(100);

    // Verify our invocation is no longer in the list
    const invocationStillExists = invocationsAfterCancelData.invocations.some(
      (inv: { id: string }) => inv.id === handle.invocationId,
    );
    expect(invocationStillExists).toBe(false);
  });
});
