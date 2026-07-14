# xagents HTTP API contract

All types referenced here are exported from `@xagents/core`. Base path: `/api`.
JSON everywhere except the chat stream (SSE). Errors use `ApiErrorBody`
(`{ error: { code, message } }`) with the status from `httpStatusFor(code)`.

Auth is stubbed: every request acts as the single seeded user (no headers needed).

## Config
- `GET /api/config` → `ClientConfig` — model catalog, current user, sandbox backend.

## Agents
- `GET /api/agents` → `Agent[]` — current user's agents.
- `POST /api/agents` — body `CreateAgentInput` → `Agent` (201).
- `GET /api/agents/:id` → `AgentDetail` (agent + attached KBs + skills).
- `PATCH /api/agents/:id` — body `UpdateAgentInput` → `Agent`.
- `DELETE /api/agents/:id` → 204.
- `POST /api/agents/:id/clone` → `Agent` — deep-copies a public (or own) agent
  into the current user's workspace with `forkedFrom` set.

## Knowledgebases
- `GET /api/knowledgebases` → `Knowledgebase[]`.
- `POST /api/knowledgebases` — body `CreateKnowledgebaseInput` → `Knowledgebase`.
- `GET /api/knowledgebases/:id` → `KnowledgebaseDetail` (kb + documents).
- `DELETE /api/knowledgebases/:id` → 204.
- `POST /api/knowledgebases/:id/documents` — `multipart/form-data` with a `file`
  field → `KbDocument`. Server extracts text (md/txt/pdf), chunks, indexes (FTS5).
- `DELETE /api/knowledgebases/:id/documents/:docId` → 204.
- `POST /api/knowledgebases/:id/clone` → `Knowledgebase`.

## Skills
- `GET /api/skills` → `Skill[]`.
- `POST /api/skills` — body `CreateSkillInput` → `Skill`.
- `GET /api/skills/:id` → `Skill`.
- `PATCH /api/skills/:id` — partial `CreateSkillInput` → `Skill`.
- `DELETE /api/skills/:id` → 204.
- `POST /api/skills/:id/clone` → `Skill`.

## Marketplace / gallery
- `GET /api/gallery?kind=agent|knowledgebase|skill` → `GalleryItem[]` — public items
  from all users. Omit `kind` for all three.

## Chats
- `GET /api/chats?agentId=:id` → `Chat[]`.
- `POST /api/chats` — body `CreateChatInput` → `Chat`.
- `GET /api/chats/:id` → `ChatWithMessages`.
- `POST /api/chats/:id/messages` — body `SendMessageInput`, `Accept: text/event-stream`.
  **Streams the turn as SSE.** Each SSE `data:` line is one JSON `ChatStreamEvent`.
  The server persists the user message, the assistant message, and every event.
  Sequence: `turn_started` → (`reasoning_delta` | `text_delta` | `tool_call` |
  `tool_result` | `kb_citations`)* → `turn_completed` (or `error`).

### SSE consumption note (web)
`EventSource` only does GET, but this endpoint is POST. The web client must use
`fetch(..., { method: 'POST', headers: { Accept: 'text/event-stream' } })` and read
`response.body` with a `TextDecoder`, splitting on `\n\n` and stripping the `data: `
prefix, then `JSON.parse` each frame into a `ChatStreamEvent`.
