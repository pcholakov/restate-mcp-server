import * as restate from "@restatedev/restate-sdk";

// Create a simple service with a single handler
const simpleService = restate.service({
  name: "SimpleService",
  handlers: {
    greet: async (_ctx: restate.Context, name: string) => {
      return `Hello, ${name}!`;
    },
    longRunning: async (ctx: restate.Context, _: any) => {
      await ctx.sleep(3600 * 1000);
    },
  },
});

// Start the server if this file is run directly
if (process.argv[1]?.endsWith('simple-service.ts') ||
  process.argv[1]?.endsWith('simple-service.js')) {
  restate.endpoint()
    .bind(simpleService)
    .listen(9080)
    .then(() => console.log("Simple service listening on port 9080"));
}

export { simpleService };
