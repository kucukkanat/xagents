import { Hono } from "hono";
import type { GalleryItem } from "@xagents/core";
import type { AppContext } from "../context";

interface PublicRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly updatedAt: string;
  readonly ownerHandle: string;
}

// Table names come from a fixed whitelist below — never from user input.
const queryPublic = (ctx: AppContext, table: string): PublicRow[] =>
  ctx.db.raw
    .prepare(
      `SELECT e.id AS id, e.name AS name, e.description AS description,
              e.updated_at AS updatedAt, u.handle AS ownerHandle
       FROM ${table} e JOIN users u ON u.id = e.owner_id
       WHERE e.visibility = 'public'`,
    )
    .all() as PublicRow[];

const KINDS: ReadonlyArray<{ kind: GalleryItem["kind"]; table: string }> = [
  { kind: "agent", table: "agents" },
  { kind: "knowledgebase", table: "knowledgebases" },
  { kind: "skill", table: "skills" },
];

export const galleryRoutes = (ctx: AppContext): Hono => {
  const app = new Hono();
  app.get("/", (c) => {
    const wanted = c.req.query("kind");
    const items: GalleryItem[] = [];
    for (const { kind, table } of KINDS) {
      if (wanted !== undefined && wanted !== kind) continue;
      for (const r of queryPublic(ctx, table)) {
        items.push({ kind, id: r.id, name: r.name, description: r.description, ownerHandle: r.ownerHandle, updatedAt: r.updatedAt });
      }
    }
    items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return c.json(items);
  });
  return app;
};
