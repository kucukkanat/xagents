import { serve } from "@hono/node-server";
import { SANDBOX_DEFAULT_IMAGE, warmSandboxImage } from "@xagents/sandbox";
import { createApp } from "./app";
import { createContext } from "./context";
import { loadConfig, loadEnv } from "./env";

loadEnv();
const config = loadConfig();

if (config.deepseekApiKey === undefined) {
  console.warn("⚠️  DEEPSEEK_API_KEY is not set — chat turns will fail until it is provided in .env");
}

const ctx = createContext(config);
const app = createApp(ctx);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`✦ xagents server listening on http://localhost:${info.port}`);
  console.log(`  sandbox backend: ${config.sandboxBackend}`);
  console.log(`  database:        ${config.databasePath}`);
});

// Pre-warm the (large) eve sandbox image so the first sandboxed chat isn't
// blocked on a multi-minute first pull. Fire-and-forget; never blocks the server.
if (config.sandboxBackend === "microsandbox") {
  console.log(`  warming sandbox image ${SANDBOX_DEFAULT_IMAGE} in the background…`);
  void warmSandboxImage().then((r) => {
    console.log(r.ok ? "  ✓ sandbox image ready" : `  ⚠️  sandbox warm failed: ${r.error.message}`);
  });
}

const shutdown = (): void => {
  console.log("\n↓ shutting down…");
  ctx.supervisor.stopAll();
  ctx.db.close();
  server.close(() => process.exit(0));
  // Force-exit if something keeps the loop alive.
  setTimeout(() => process.exit(0), 3_000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
