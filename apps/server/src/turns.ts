import type { ChatStreamEvent } from "@xagents/core";

/**
 * A single in-flight (or just-finished) turn. Its `buffer` is the full event
 * timeline; subscribers replay it from index 0 and then tail live updates, so
 * a page refresh mid-turn re-attaches to exactly what's happening — the turn
 * itself runs to completion regardless of who's watching.
 */
interface Turn {
  readonly buffer: ChatStreamEvent[];
  done: boolean;
  /** Resolvers woken on every new event and on completion. */
  readonly waiters: Set<() => void>;
}

/** How long a finished turn lingers so a late/reconnecting subscriber still sees its tail. */
const LINGER_MS = 30_000;

/**
 * Owns at most one active turn per chat, decoupled from any HTTP request. The
 * producer (which talks to the eve host and persists to the DB) runs in the
 * background; `subscribe` is a pure fan-out over the buffered timeline.
 */
export class ChatTurns {
  readonly #turns = new Map<string, Turn>();

  /** True while a turn is producing events for this chat (not yet finished). */
  isActive(chatId: string): boolean {
    const turn = this.#turns.get(chatId);
    return turn !== undefined && !turn.done;
  }

  /**
   * Start a background turn. Rejects (returns false) if one is already running
   * for this chat. The producer yields the normalized event timeline; each
   * event is buffered and broadcast. The producer owns persistence.
   */
  start(chatId: string, produce: () => AsyncGenerator<ChatStreamEvent>): boolean {
    if (this.isActive(chatId)) return false;
    const turn: Turn = { buffer: [], done: false, waiters: new Set() };
    this.#turns.set(chatId, turn);

    const notify = (): void => {
      for (const w of turn.waiters) w();
      turn.waiters.clear();
    };

    void (async () => {
      try {
        for await (const ev of produce()) {
          turn.buffer.push(ev);
          notify();
        }
      } catch (cause) {
        turn.buffer.push({
          type: "error",
          message: cause instanceof Error ? cause.message : "turn failed",
        });
      } finally {
        turn.done = true;
        notify();
        // Evict after a grace window unless a newer turn already replaced this one.
        setTimeout(() => {
          if (this.#turns.get(chatId) === turn) this.#turns.delete(chatId);
        }, LINGER_MS).unref();
      }
    })();

    return true;
  }

  /**
   * Observe a turn: replays the buffered timeline from the start, then tails
   * live events until the turn finishes. Returns immediately (empty) if no turn
   * exists for the chat. Independent per subscriber — a slow or disconnected
   * consumer never stalls or kills the turn.
   */
  async *subscribe(chatId: string): AsyncGenerator<ChatStreamEvent> {
    const turn = this.#turns.get(chatId);
    if (turn === undefined) return;
    let i = 0;
    for (;;) {
      while (i < turn.buffer.length) {
        const ev = turn.buffer[i];
        i += 1;
        if (ev !== undefined) yield ev;
      }
      if (turn.done) return;
      await new Promise<void>((resolve) => turn.waiters.add(resolve));
    }
  }
}
