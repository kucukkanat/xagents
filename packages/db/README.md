# @xagents/db

SQLite data layer for xagents, built on [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3). It owns the schema, an idempotent migration, and a set of synchronous repositories that return the domain types from `@xagents/core`.

- **Synchronous** — better-sqlite3 is sync, so every call returns a value, not a promise.
- **Typed failures** — expected misses (`not_found`) come back as `Result<T, AppError>`; programmer errors throw.
- **Lexical RAG** — knowledgebase chunks are indexed in a standalone FTS5 table and retrieved with BM25 ranking.

> Native addon: tests must run under **Node via Vitest** (`*.node.test.ts`), never `bun test`.

## Usage

```ts
import { openDb } from "@xagents/db";
import { CreateAgentInput, CreateKnowledgebaseInput, isOk } from "@xagents/core";

// ":memory:" for tests; a file path is created (parent dirs included) and WAL-enabled.
const db = openDb("./data/xagents.sqlite");

const me = db.users.getCurrent(); // the single seeded "local" user

const kb = db.knowledgebases.create(me.id, CreateKnowledgebaseInput.parse({ name: "Docs" }));
const doc = db.knowledgebases.addDocument(kb.id, {
  filename: "report.md",
  mime: "text/markdown",
  byteLength: 2048,
});
db.knowledgebases.insertChunks(kb.id, doc.id, doc.filename, [
  { ord: 0, text: "Foxes are small omnivorous mammals." },
  { ord: 1, text: "Databases index text for fast retrieval." },
]);

const hits = db.knowledgebases.searchChunks([kb.id], "fox", 5);
// hits[0] => { text, score, citation: "report.md:0", ... } ranked by BM25

const agent = db.agents.create(
  me.id,
  CreateAgentInput.parse({
    name: "Research Bot",
    instructionsMd: "You are helpful.",
    modelProvider: "deepseek",
    modelId: "deepseek-chat",
    knowledgebaseIds: [kb.id],
  }),
);

const detail = db.agents.getDetail(agent.id);
if (isOk(detail)) {
  console.log(detail.value.knowledgebases.length); // 1
}

// Chats persist messages and the normalized ChatStreamEvent timeline.
const chat = db.chats.create(agent.id, me.id, "First chat");
db.chats.messages.append(chat.id, "user", "hello");
db.chats.events.append(chat.id, 0, { type: "turn_started", chatId: chat.id });

db.close();
```

## Migrations

Opening the DB runs the migration as a side effect. To run it standalone:

```bash
DATABASE_PATH=./data/xagents.sqlite bun run migrate   # defaults to ./data/xagents.sqlite
```

## Repository API

- `users`: `getCurrent()`
- `agents`: `create`, `get`, `getDetail`, `list`, `update`, `remove`, `setLinks`, `clone`
- `knowledgebases`: `create`, `get`, `list`, `remove`, `clone`, `addDocument`, `listDocuments`, `removeDocument`, `insertChunks`, `searchChunks`
- `skills`: `create`, `get`, `list`, `update`, `remove`, `clone`, `setResources`, `listResources`
- `chats`: `create`, `get`, `list`, `setContinuationToken`, `setTitle`, `messages.{append,list}`, `events.{append,list}`

## Testing

```bash
vitest run packages/db      # Node runtime (required for the native addon)
```
