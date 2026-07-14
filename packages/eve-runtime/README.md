# @xagents/eve-runtime

Bridges xagents domain data to [eve](https://eve.dev) agents. It **materializes** an
agent (from plain data — no DB dependency) into an on-disk eve project, **supervises**
one `eve dev` host process per agent, and **normalizes** eve's NDJSON turn stream into
`@xagents/core`'s `ChatStreamEvent` union.

Why a child process? eve has no in-process server — its own Next.js adapter spawns the
`eve` CLI and reverse-proxies. We do the same: `HostSupervisor` spawns `eve dev
--no-ui --port 0`, discovers the printed origin, health-tracks it, and idle-reaps.

## Usage

```ts
import { HostSupervisor, materializeAgent, runChatTurn, decodeResume } from "@xagents/eve-runtime";
import { join } from "node:path";

const supervisor = new HostSupervisor({
  projectDirFor: (id) => join(workspaceDir, id),
  env: { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY },
});

// 1. Write the eve project (instructions.md, agent.ts, sandbox.ts, skills/, tools/kb_search.ts)
await materializeAgent(spec, join(workspaceDir, agent.id));

// 2. Start (or reuse) the agent's eve host
const host = await supervisor.getOrStart(agent.id);
if (!host.ok) throw new Error(host.error.message);

// 3. Drive a turn; yields normalized ChatStreamEvents
for await (const ev of runChatTurn({
  host: host.value,
  chatId,
  message: "hello",
  resume: decodeResume(chat.eveContinuationToken), // null for a new chat
  assistantMessageId,
})) {
  // ev: turn_started | text_delta | reasoning_delta | tool_call | tool_result | kb_citations | turn_completed | error
}
```

The final `turn_completed` carries the full text and the opaque resume handle
(`sessionId` + `continuationToken` + `nextIndex`) — persist it on the chat and pass it
back via `decodeResume` on the next turn. The `nextIndex` cursor is what keeps eve's
replay-from-start stream from re-emitting prior turns.

## Sandbox

The generated `agent/sandbox.ts` pins the backend from `@xagents/sandbox`
(microsandbox by default). Built-in eve tools (`bash`, `read_file`, …) run inside that
microVM; their `tool_result` events are flagged `sandbox: true`.
