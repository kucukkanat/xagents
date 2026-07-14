import { openDb } from "./db";

/**
 * Runnable migration entry (`bun run migrate` / `tsx src/migrate.ts`). Opens the
 * DB at `DATABASE_PATH` (default `./data/xagents.sqlite`), which runs migrations
 * as a side effect, then closes.
 */
const path = process.env["DATABASE_PATH"] ?? "./data/xagents.sqlite";
const db = openDb(path);
db.close();
// eslint-disable-next-line no-console
console.log(`migrated ${path}`);
