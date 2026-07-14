import { describe, expect, test } from "bun:test";
import type { ChatStreamEvent } from "@xagents/core";
import { ChatTurns } from "./turns";

const collect = async (gen: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> => {
  const out: ChatStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
};

const gate = (): { wait: Promise<void>; open: () => void } => {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
};

describe("ChatTurns", () => {
  test("a subscriber replays the whole timeline then stops when the turn completes", async () => {
    const turns = new ChatTurns();
    const events: ChatStreamEvent[] = [
      { type: "status", state: "preparing" },
      { type: "status", state: "thinking" },
      { type: "text_delta", text: "hi" },
      { type: "turn_completed", messageId: "m1", text: "hi", continuationToken: "t1" },
    ];
    async function* produce(): AsyncGenerator<ChatStreamEvent> {
      for (const ev of events) {
        await Promise.resolve();
        yield ev;
      }
    }
    expect(turns.start("c1", produce)).toBe(true);
    expect(await collect(turns.subscribe("c1"))).toEqual(events);
    expect(turns.isActive("c1")).toBe(false);
  });

  test("refuses a second turn while one is active, then allows a fresh one after it ends", async () => {
    const turns = new ChatTurns();
    const g = gate();
    async function* produce(): AsyncGenerator<ChatStreamEvent> {
      yield { type: "status", state: "thinking" };
      await g.wait;
      yield { type: "turn_completed", messageId: "m", text: "", continuationToken: "t" };
    }
    expect(turns.start("c1", produce)).toBe(true);
    expect(turns.isActive("c1")).toBe(true);
    expect(turns.start("c1", produce)).toBe(false);

    g.open();
    await collect(turns.subscribe("c1"));
    expect(turns.isActive("c1")).toBe(false);

    async function* produce2(): AsyncGenerator<ChatStreamEvent> {
      yield { type: "text_delta", text: "again" };
    }
    expect(turns.start("c1", produce2)).toBe(true);
    await collect(turns.subscribe("c1"));
  });

  test("a late subscriber still replays events emitted before it attached", async () => {
    const turns = new ChatTurns();
    const g = gate();
    async function* produce(): AsyncGenerator<ChatStreamEvent> {
      yield { type: "text_delta", text: "a" };
      yield { type: "text_delta", text: "b" };
      await g.wait;
      yield { type: "text_delta", text: "c" };
    }
    turns.start("c1", produce);
    await new Promise((r) => setTimeout(r, 10)); // let "a"/"b" buffer
    const pending = collect(turns.subscribe("c1"));
    g.open();
    const got = await pending;
    expect(got.map((e) => (e.type === "text_delta" ? e.text : e.type))).toEqual(["a", "b", "c"]);
  });

  test("two subscribers each receive the complete timeline", async () => {
    const turns = new ChatTurns();
    async function* produce(): AsyncGenerator<ChatStreamEvent> {
      await Promise.resolve();
      yield { type: "text_delta", text: "x" };
      yield { type: "turn_completed", messageId: "m", text: "x", continuationToken: "t" };
    }
    turns.start("c1", produce);
    const [a, b] = await Promise.all([
      collect(turns.subscribe("c1")),
      collect(turns.subscribe("c1")),
    ]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
  });

  test("a producer error surfaces as a terminal error event", async () => {
    const turns = new ChatTurns();
    async function* produce(): AsyncGenerator<ChatStreamEvent> {
      yield { type: "text_delta", text: "partial" };
      throw new Error("boom");
    }
    turns.start("c1", produce);
    const got = await collect(turns.subscribe("c1"));
    expect(got.at(-1)).toEqual({ type: "error", message: "boom" });
    expect(turns.isActive("c1")).toBe(false);
  });

  test("subscribing to an unknown chat yields nothing", async () => {
    const turns = new ChatTurns();
    expect(await collect(turns.subscribe("nope"))).toEqual([]);
  });

  test("cancel stops a running turn with a terminal interruption event", async () => {
    const turns = new ChatTurns();
    const g = gate();
    let reachedAfterGate = false;
    async function* produce(): AsyncGenerator<ChatStreamEvent> {
      yield { type: "text_delta", text: "partial" };
      await g.wait; // never opened — cancel must interrupt the await
      reachedAfterGate = true;
      yield { type: "turn_completed", messageId: "m", text: "partial", continuationToken: "t" };
    }
    turns.start("c1", produce);
    await new Promise((r) => setTimeout(r, 10)); // let "partial" buffer

    expect(turns.cancel("c1")).toBe(true);
    const got = await collect(turns.subscribe("c1"));
    expect(got.at(-1)).toEqual({ type: "error", message: "Generation stopped." });
    expect(turns.isActive("c1")).toBe(false);
    expect(reachedAfterGate).toBe(false);
  });

  test("cancel is a no-op on a chat with no active turn", async () => {
    const turns = new ChatTurns();
    expect(turns.cancel("nope")).toBe(false);
  });
});
