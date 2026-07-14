#!/usr/bin/env bun
import { run } from "./cli";

// Shebang entry for the `microsandbox-image` bin. Ships TypeScript source (like
// the rest of this monorepo), so it runs under bun / tsx / a TS-aware Node.
run(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(`fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
