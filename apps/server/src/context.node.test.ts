import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CreateAgentInput } from "@xagents/core";
import { openDb, type Db } from "@xagents/db";
import { reconcileInterruptedTurns } from "./context";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

describe("reconcileInterruptedTurns", () => {
  test("finalizes a turn left running by a previous process as a persisted error", () => {
    const owner = db.users.getCurrent();
    const agent = db.agents.create(
      owner.id,
      CreateAgentInput.parse({
        name: "Bot",
        instructionsMd: "You are helpful.",
        modelProvider: "deepseek",
        modelId: "deepseek-chat",
      }),
    );
    const chat = db.chats.create(agent.id, owner.id, "Stuck chat");
    db.chats.events.append(chat.id, 0, { type: "turn_started", chatId: chat.id });
    db.chats.turns.start(chat.id);

    reconcileInterruptedTurns(db);

    expect(db.chats.turns.listRunning()).toEqual([]);
    const events = db.chats.events.list(chat.id);
    expect(events.map((e) => e.type)).toEqual(["turn_started", "error"]);
    const last = events.at(-1);
    expect(last?.type === "error" ? last.message : "").toMatch(/interrupted/i);
  });

  test("leaves completed turns and chats with no turn untouched", () => {
    const owner = db.users.getCurrent();
    const agent = db.agents.create(
      owner.id,
      CreateAgentInput.parse({
        name: "Bot",
        instructionsMd: "You are helpful.",
        modelProvider: "deepseek",
        modelId: "deepseek-chat",
      }),
    );
    const finished = db.chats.create(agent.id, owner.id, "Finished chat");
    db.chats.turns.start(finished.id);
    db.chats.turns.complete(finished.id);
    const untouched = db.chats.create(agent.id, owner.id, "Never started");

    reconcileInterruptedTurns(db);

    expect(db.chats.events.list(finished.id)).toEqual([]);
    expect(db.chats.events.list(untouched.id)).toEqual([]);
  });
});
