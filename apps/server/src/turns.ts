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
  /** Aborted by `cancel` to stop a running turn on user request ("stop generating"). */
  readonly controller: AbortController;
}

/** How long a finished turn lingers so a late/reconnecting subscriber still sees its tail. */
const LINGER_MS = 30_000;

/** Distinguishes an abort from a real iterator result in the consume race. */
const ABORTED = Symbol("aborted");

const whenAborted = (signal: AbortSignal): Promise<typeof ABORTED> =>
  new Promise((resolve) => {
    if (signal.aborted) resolve(ABORTED);
    else signal.addEventListener("abort", () => resolve(ABORTED), { once: true });
  });

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

  /** Chat ids with a turn producing events right now — the live-turn gauge/list. */
  activeChatIds(): string[] {
    const ids: string[] = [];
    for (const [chatId, turn] of this.#turns) {
      if (!turn.done) ids.push(chatId);
    }
    return ids;
  }

  /**
   * Start a background turn. Rejects (returns false) if one is already running
   * for this chat. The producer yields the normalized event timeline; each
   * event is buffered and broadcast. The producer owns persistence.
   */
  start(chatId: string, produce: () => AsyncGenerator<ChatStreamEvent>): boolean {
    if (this.isActive(chatId)) return false;
    const turn: Turn = {
      buffer: [],
      done: false,
      waiters: new Set(),
      controller: new AbortController(),
    };
    this.#turns.set(chatId, turn);

    const notify = (): void => {
      for (const w of turn.waiters) w();
      turn.waiters.clear();
    };

    void (async () => {
      const iterator = produce();
      const aborted = whenAborted(turn.controller.signal);
      try {
        for (;;) {
          // Race the next event against a cancel; a cancel wins even mid-await so
          // "stop generating" is responsive regardless of how slow the model is.
          const next = await Promise.race([iterator.next(), aborted]);
          if (next === ABORTED) {
            turn.buffer.push({ type: "error", message: "Generation stopped." });
            notify();
            // Ask the producer to unwind (close the eve stream, run its finally),
            // but don't await it: a generator suspended on a slow/never-settling
            // await only completes its return once that await does, and cancel
            // must not block on that. Best-effort cleanup, rejection ignored.
            void Promise.resolve(iterator.return?.(undefined)).catch(() => {});
            break;
          }
          if (next.done) break;
          turn.buffer.push(next.value);
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
   * Stop the running turn for a chat ("stop generating"). Returns false if no
   * turn is active. The producer is unwound and the buffered timeline gains a
   * final interruption event; the caller persists the terminal state.
   */
  cancel(chatId: string): boolean {
    const turn = this.#turns.get(chatId);
    if (turn === undefined || turn.done) return false;
    turn.controller.abort();
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
