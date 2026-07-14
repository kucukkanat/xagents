import { serve } from "@hono/node-server";
import { SANDBOX_DEFAULT_IMAGE, ensureSandboxImage, warmSandboxImage } from "@xagents/sandbox";
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

// Ensure the custom sandbox image (the one that lets agents use `apt`) is built,
// then pre-warm it so the first sandboxed chat isn't blocked on a first boot.
// Fire-and-forget; never blocks the server. First run bakes the image (~1–2 min);
// a chat that lands mid-bake will fail until it finishes — restart-free thereafter.
if (config.sandboxBackend === "microsandbox") {
  console.log(`  preparing sandbox image ${SANDBOX_DEFAULT_IMAGE} in the background…`);
  void ensureSandboxImage({ log: (m) => console.log(`    ${m}`) }).then(async (r) => {
    if (!r.ok) {
      console.log(`  ⚠️  sandbox image build failed: ${r.error.message}`);
      return;
    }
    if (r.value.built) console.log("  ✓ sandbox image built");
    const warm = await warmSandboxImage();
    console.log(warm.ok ? "  ✓ sandbox image ready" : `  ⚠️  sandbox warm failed: ${warm.error.message}`);
  });
  // A previous process's eve hosts orphan their microVMs when killed/crashed;
  // reap those leftovers on boot so they don't accumulate (see reapOrphanSandboxes).
  void ctx.supervisor.reapOrphanSandboxes().then((n) => {
    if (n > 0) console.log(`  ✓ reaped ${n} orphaned sandbox microVM(s) from a prior run`);
  });
}

const shutdown = async (): Promise<void> => {
  console.log("\n↓ shutting down…");
  ctx.supervisor.stopAll();
  // Kill this process's microVMs too — killing their eve hosts doesn't (they run
  // in their own process groups), so without this they'd outlive us as orphans.
  await ctx.supervisor.reapOrphanSandboxes().catch(() => 0);
  ctx.db.close();
  server.close(() => process.exit(0));
  // Force-exit if something keeps the loop alive.
  setTimeout(() => process.exit(0), 3_000).unref();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
