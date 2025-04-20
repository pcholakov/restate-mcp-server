import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { GenericContainer } from "testcontainers";
import { beforeAll, describe, expect, it } from "vitest";

let restateTestEnvironment: RestateTestEnvironment;
let restateClient: clients.Ingress;
let ingressUrl: string;

beforeAll(async () => {
  restateTestEnvironment = await RestateTestEnvironment.start(
    () =>
      new GenericContainer("restatedev/restate:1.3.1")
        .withEnvironment({ RESTATE_LOG_FORMAT: "compact" })
        .withLogConsumer((stream) => {
          stream.on("data", (line) => console.info(line));
          stream.on("err", (line) => console.error(line));
        }),
  );

  ingressUrl = restateTestEnvironment.baseUrl();
  restateClient = clients.connect({ url: ingressUrl });

  const healthCheckResponse = await fetch(`${restateTestEnvironment.adminAPIBaseUrl()}/health`);
  expect(healthCheckResponse.ok);
});

describe("Restate MCP server", () => {
  it("can list deployed services", async () => { 
    // todo
  });
});