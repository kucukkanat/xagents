import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  type ChatWithMessages,
  CreateChatInput,
  SendMessageInput,
  appError,
  asId,
  newId,
} from "@xagents/core";
import { decodeResume, runChatTurn } from "@xagents/eve-runtime";
import { type AppContext, ensureAgentReady } from "../context";
import { parseBody, readJson, sendError } from "../http";

export const chatRoutes = (ctx: AppContext): Hono => {
  const app = new Hono();

  app.get("/", (c) => {
    const agentId = c.req.query("agentId");
    if (agentId === undefined) return sendError(c, appError("validation", "agentId query is required"));
    return c.json(ctx.db.chats.list(asId("AgentId", agentId)));
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
    const body: ChatWithMessages = { chat: chat.value, messages: ctx.db.chats.messages.list(id) };
    return c.json(body);
  });

  app.post("/:id/messages", async (c) => {
    const id = asId("ChatId", c.req.param("id"));
    const chat = ctx.db.chats.get(id);
    if (!chat.ok) return sendError(c, chat.error);
    const body = parseBody(SendMessageInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    const message = body.value.message;

    const host = await ensureAgentReady(ctx, chat.value.agentId);
    if (!host.ok) return sendError(c, host.error);

    ctx.db.chats.messages.append(id, "user", message);
    if (chat.value.title.length === 0 || chat.value.title === "New chat") {
      ctx.db.chats.setTitle(id, message.slice(0, 60));
    }

    const resume = decodeResume(chat.value.eveContinuationToken);
    const assistantMessageId = newId("MessageId");
    let seq = ctx.db.chats.events.list(id).length;

    return streamSSE(c, async (stream) => {
      for await (const ev of runChatTurn({
        host: host.value,
        chatId: id,
        message,
        resume,
        assistantMessageId,
      })) {
        ctx.db.chats.events.append(id, seq++, ev);
        await stream.writeSSE({ data: JSON.stringify(ev) });
        if (ev.type === "turn_completed") {
          ctx.db.chats.messages.append(id, "assistant", ev.text);
          ctx.db.chats.setContinuationToken(id, ev.continuationToken);
        }
      }
    });
  });

  return app;
};
