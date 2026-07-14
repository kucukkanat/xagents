import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  type ChatId,
  type ChatStreamEvent,
  type ChatWithMessages,
  CreateChatInput,
  SendMessageInput,
  UpdateChatInput,
  appError,
  asId,
  newId,
} from "@xagents/core";
import { decodeResume, runChatTurn } from "@xagents/eve-runtime";
import { type AppContext, ensureAgentReady } from "../context";
import { parseBody, readJson, sendError } from "../http";

/**
 * Events of the latest turn that never produced a final assistant message —
 * everything after the last `turn_completed`. Empty when the last turn finished
 * cleanly. Used to reconstruct an in-progress/interrupted bubble on page load.
 */
const pendingEvents = (events: readonly ChatStreamEvent[]): ChatStreamEvent[] => {
  let lastCompleted = -1;
  events.forEach((ev, i) => {
    if (ev.type === "turn_completed") lastCompleted = i;
  });
  return events.slice(lastCompleted + 1);
};

export const chatRoutes = (ctx: AppContext): Hono => {
  const app = new Hono();

  // The current user's conversation history, newest first. `?agentId=` narrows
  // it to a single agent (used by the agent detail page).
  app.get("/", (c) => {
    const agentId = c.req.query("agentId");
    const summaries = ctx.db.chats.listByUser(
      ctx.user.id,
      agentId === undefined ? undefined : asId("AgentId", agentId),
    );
    return c.json(summaries);
  });

  app.post("/", async (c) => {
    const body = parseBody(CreateChatInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    const agent = ctx.db.agents.get(asId("AgentId", body.value.agentId));
    if (!agent.ok) return sendError(c, agent.error);
    const chat = ctx.db.chats.create(
      asId("AgentId", body.value.agentId),
      ctx.user.id,
      body.value.title ?? "New chat",
    );
    return c.json(chat, 201);
  });

  app.get("/:id", (c) => {
    const id = asId("ChatId", c.req.param("id"));
    const chat = ctx.db.chats.get(id);
    if (!chat.ok) return sendError(c, chat.error);
    const agent = ctx.db.agents.get(chat.value.agentId);
    const streaming = ctx.turns.isActive(id);
    // While a turn is live, the SSE stream replays its full buffer, so the
    // client reconstructs from there — no need to also ship it here.
    const pending = streaming ? [] : pendingEvents(ctx.db.chats.events.list(id));
    const body: ChatWithMessages = {
      chat: chat.value,
      agentName: agent.ok ? agent.value.name : "Agent",
      messages: ctx.db.chats.messages.list(id),
      pending,
      streaming,
    };
    return c.json(body);
  });

  // Rename a conversation.
  app.patch("/:id", async (c) => {
    const id = asId("ChatId", c.req.param("id"));
    const chat = ctx.db.chats.get(id);
    if (!chat.ok) return sendError(c, chat.error);
    const body = parseBody(UpdateChatInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    ctx.db.chats.setTitle(id, body.value.title);
    const updated = ctx.db.chats.get(id);
    if (!updated.ok) return sendError(c, updated.error);
    return c.json(updated.value);
  });

  // Delete a conversation (cascades to its messages, events, and turn row).
  app.delete("/:id", (c) => {
    const id = asId("ChatId", c.req.param("id"));
    const chat = ctx.db.chats.get(id);
    if (!chat.ok) return sendError(c, chat.error);
    // Stop any in-flight turn first so its producer doesn't write to a dead chat.
    ctx.turns.cancel(id);
    ctx.db.chats.delete(id);
    return c.body(null, 204);
  });

  // Re-run the last user message after a failure — without appending a
  // duplicate user turn. The continuation token only advances on completion, so
  // a failed turn left it untouched: replaying the same message is a true retry.
  app.post("/:id/retry", (c) => {
    const id = asId("ChatId", c.req.param("id"));
    const chat = ctx.db.chats.get(id);
    if (!chat.ok) return sendError(c, chat.error);
    if (ctx.turns.isActive(id)) {
      return sendError(c, appError("conflict", "a turn is already in progress for this chat"));
    }
    const messages = ctx.db.chats.messages.list(id);
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser === undefined) {
      return sendError(c, appError("not_found", "no message to retry"));
    }
    const resume = decodeResume(chat.value.eveContinuationToken);
    ctx.db.chats.turns.start(id);
    const started = ctx.turns.start(id, () =>
      produceTurn(ctx, id, chat.value.agentId, lastUser.content, resume),
    );
    if (!started) {
      return sendError(c, appError("conflict", "a turn is already in progress for this chat"));
    }
    return c.json({ streaming: true }, 202);
  });

  // Stop the in-flight turn for this chat ("stop generating"). Idempotent: a
  // no-op (still 200) when nothing is running.
  app.post("/:id/cancel", (c) => {
    const id = asId("ChatId", c.req.param("id"));
    const chat = ctx.db.chats.get(id);
    if (!chat.ok) return sendError(c, chat.error);
    const cancelled = ctx.turns.cancel(id);
    if (cancelled) {
      // The hub unwound the producer, so persist the terminal state here — the
      // interruption event makes a reload show the stopped turn, not a hang.
      const ev: ChatStreamEvent = { type: "error", message: "Generation stopped." };
      ctx.db.chats.events.append(id, ctx.db.chats.events.list(id).length, ev);
      ctx.db.chats.turns.fail(id, "Generation stopped.");
    }
    return c.json({ cancelled });
  });

  app.post("/:id/messages", async (c) => {
    const id = asId("ChatId", c.req.param("id"));
    const chat = ctx.db.chats.get(id);
    if (!chat.ok) return sendError(c, chat.error);
    const body = parseBody(SendMessageInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    const message = body.value.message;

    if (ctx.turns.isActive(id)) {
      return sendError(c, appError("conflict", "a turn is already in progress for this chat"));
    }

    // Persist the user message up front — before the (possibly slow) cold start
    // — so a refresh during boot still shows what was sent.
    ctx.db.chats.messages.append(id, "user", message);
    if (chat.value.title.length === 0 || chat.value.title === "New chat") {
      ctx.db.chats.setTitle(id, message.slice(0, 60));
    }

    const resume = decodeResume(chat.value.eveContinuationToken);
    // Persist "running" before the in-memory hub takes over, so a process that
    // dies mid-turn leaves a durable trail for boot-time reconciliation instead
    // of a silent gap (see reconcileInterruptedTurns in context.ts).
    ctx.db.chats.turns.start(id);
    const started = ctx.turns.start(id, () =>
      produceTurn(ctx, id, chat.value.agentId, message, resume),
    );
    if (!started) {
      return sendError(c, appError("conflict", "a turn is already in progress for this chat"));
    }
    // The turn runs in the background; the client observes it via GET /:id/stream.
    return c.json({ streaming: true }, 202);
  });

  // Re-attachable live view of the active turn. A refresh mid-turn reconnects
  // here and replays the whole turn before tailing; disconnecting never affects
  // the turn. Closes immediately when nothing is running.
  app.get("/:id/stream", (c) => {
    const id = asId("ChatId", c.req.param("id"));
    const chat = ctx.db.chats.get(id);
    if (!chat.ok) return sendError(c, chat.error);
    return streamSSE(c, async (stream) => {
      for await (const ev of ctx.turns.subscribe(id)) {
        try {
          await stream.writeSSE({ data: JSON.stringify(ev) });
        } catch {
          // This subscriber went away; the background turn keeps running.
          break;
        }
      }
    });
  });

  return app;
};

/**
 * The background producer for one turn: brings the agent up, drives the eve
 * turn, and persists events + the final assistant message as they occur. Yields
 * the timeline for the hub to buffer and broadcast. `status` events are emitted
 * for UI feedback but never persisted (they aren't part of the durable log).
 */
async function* produceTurn(
  ctx: AppContext,
  id: ChatId,
  agentId: string,
  message: string,
  resume: ReturnType<typeof decodeResume>,
): AsyncGenerator<ChatStreamEvent> {
  // Persist any failure (rather than letting it vanish once the in-memory turn
  // is evicted) and finalize the durable turn record either way.
  const fail = (msg: string): ChatStreamEvent => {
    const ev: ChatStreamEvent = { type: "error", message: msg };
    ctx.db.chats.events.append(id, ctx.db.chats.events.list(id).length, ev);
    ctx.db.chats.turns.fail(id, msg);
    return ev;
  };

  try {
    yield { type: "status", state: "preparing" };

    const host = await ensureAgentReady(ctx, agentId);
    if (!host.ok) {
      yield fail(host.error.message);
      return;
    }

    yield { type: "status", state: "thinking" };

    let seq = ctx.db.chats.events.list(id).length;
    let finalized = false;
    for await (const ev of runChatTurn({
      host: host.value,
      chatId: id,
      message,
      resume,
      assistantMessageId: newId("MessageId"),
    })) {
      ctx.db.chats.events.append(id, seq++, ev);
      if (ev.type === "turn_completed") {
        ctx.db.chats.messages.append(id, "assistant", ev.text);
        ctx.db.chats.setContinuationToken(id, ev.continuationToken);
        ctx.db.chats.turns.complete(id);
        finalized = true;
      } else if (ev.type === "error") {
        // runChatTurn signals a mid-stream failure by *yielding* an error and
        // returning (it never throws), so finalize the durable turn here — else
        // the row is stuck "running" forever and every reboot re-flags it as
        // "interrupted" (see reconcileInterruptedTurns).
        ctx.db.chats.turns.fail(id, ev.message);
        finalized = true;
      }
      yield ev;
    }
    // Neither a completion nor an error terminated the stream: don't leave the
    // turn dangling as "running".
    if (!finalized) yield fail("the agent ended the turn without a response");
  } catch (cause) {
    yield fail(cause instanceof Error ? cause.message : "turn failed");
  }
}
