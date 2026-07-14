# xagents

A platform to **create, share, and chat with AI agents, knowledgebases, and skills**.
Agents are [eve](https://eve.dev) agents; their tools/skills run inside
[microsandbox](https://microsandbox.dev) microVMs.

## What works today

- **Chat** with agents — real streaming, multi-turn memory, tool-call & sandbox
  steps and knowledgebase citations shown inline.
- **Agents** — create/edit (instructions, model, reasoning, attach KBs + skills),
  materialized to on-disk eve projects and run as supervised `eve` hosts.
- **Knowledgebases** — upload docs (md/txt/pdf) → chunked → **SQLite FTS5 / BM25**
  lexical retrieval, injected via an auto-generated `kb_search` tool with citations.
- **Skills** — Anthropic-style `SKILL.md` (+ resources), validated and materialized
  into the agent's eve project.
- **Sandbox execution** — agents run real `bash`/code inside a microsandbox microVM
  (verified: `python3`/`uname` execute in a real Linux aarch64 VM).
- **Marketplace** — publish agents/KBs/skills to a public gallery; **clone** any
  public item into your workspace.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 24 |
| Server | Hono (`@hono/node-server`) — REST + SSE streaming |
| Frontend | React + React Router v7 + shadcn/ui + Vite |
| Data | SQLite (`better-sqlite3`) + FTS5 (lexical RAG, no embeddings) |
| Agents | eve (materialized projects, child-process hosts, HTTP proxy) |
| Sandbox | microsandbox (default) · `just-bash` · `docker` — switchable |
| LLM | DeepSeek (`@ai-sdk/deepseek`); platform-configured model catalog |
| Tooling | Bun (install + `bun test`), Vitest for native/Node suites |

Monorepo: `@xagents/{core,db,sandbox,skills,kb,eve-runtime}` + `apps/{server,web}`.

## Prerequisites

- **Node 24+**, **Bun 1.3+**, macOS Apple Silicon or Linux w/ KVM (for microsandbox).
- A DeepSeek API key.

## Setup

```bash
bun install
cp .env.example .env      # then set DEEPSEEK_API_KEY
```

## Run

```bash
bun run dev               # server (:8787) + web (:5173) together
# or separately:
bun run dev:server
bun run dev:web
```

Open the web app (Vite prints the URL, typically http://localhost:5173). The
server pre-warms the sandbox image on startup; the **first** sandboxed chat per
image also builds a one-time microVM template (subsequent boots are sub-second).

## Test

```bash
bun test                  # unit suites (pure logic)
bun run test:integration  # Vitest, Node runtime (db + native)
```

## Configuration (`.env`)

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8787` | Server port |
| `DATABASE_PATH` | `./data/xagents.sqlite` | SQLite file |
| `AGENTS_WORKSPACE_DIR` | `./.agents-workspace` | Materialized eve projects |
| `SANDBOX_BACKEND` | `microsandbox` | `microsandbox` \| `just-bash` \| `docker` |
| `DEEPSEEK_API_KEY` | — | Required for chat |

## Architecture notes

- **Auth** is stubbed to a single seeded local user; the schema is multi-user-ready.
- eve has no in-process server, so each running agent is an `eve dev` **child
  process** the server supervises and proxies (mirrors eve's own Next.js adapter).
  The server maps eve's NDJSON turn stream into a normalized `ChatStreamEvent`
  union delivered over SSE.
- The `kb_search` tool inside an agent calls back to a loopback-only internal
  endpoint, so the database stays owned by the server process.
- Sandbox backend deps are pre-installed at the workspace root so eve never
  auto-installs mid-turn (which would trip its dev watcher and kill the run).
