import { statSync } from "node:fs";
import type { AdminEvent, AdminRuntime, AdminStreamEvent } from "@xagents/core";
import type { Db, NewAdminEvent } from "@xagents/db";
import type { HostSupervisor, SupervisorEvent } from "@xagents/eve-runtime";
import type { ChatTurns } from "../turns";

export interface AdminHubOptions {
  readonly db: Db;
  readonly supervisor: HostSupervisor;
  readonly turns: ChatTurns;
  readonly dbPath: string;
  readonly sandboxBackend: string;
  readonly sampleIntervalMs: number;
  readonly metricsRetentionDays: number;
  readonly historyRetentionDays: number;
}

type Subscriber = (event: AdminStreamEvent) => void;

const PRUNE_INTERVAL_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** Translate a supervisor lifecycle event into an audit-log record. */
const supervisorToAdminEvent = (ev: SupervisorEvent): NewAdminEvent => {
  switch (ev.kind) {
    case "host_started":
      return {
        kind: "host_started",
        actor: "system",
        target: ev.agentId,
        detail: { pid: ev.pid, origin: ev.origin, bootMs: ev.bootMs },
      };
    case "host_stopped":
      return ev.reason === "idle"
        ? { kind: "host_idle_reaped", actor: "system", target: ev.agentId, detail: { reason: ev.reason } }
        : {
            kind: "host_stopped",
            actor: ev.reason === "admin" ? "admin" : "system",
            target: ev.agentId,
            detail: { reason: ev.reason },
          };
    case "host_crashed":
      return { kind: "host_crashed", actor: "system", target: ev.agentId, detail: { pid: ev.pid } };
    case "boot_failed":
      return { kind: "boot_failed", actor: "system", target: ev.agentId, detail: { message: ev.message } };
    case "sandbox_reaped":
      return { kind: "sandbox_reaped", actor: "system", target: null, detail: { count: ev.count } };
  }
};

/**
 * The monitoring nerve center: samples runtime gauges on an interval (persisting
 * a time series and broadcasting live), records supervisor lifecycle + operator
 * actions to the audit log, and fans everything out to SSE subscribers. One
 * source, two consumers — history in SQLite, live over the wire.
 */
export class AdminHub {
  readonly #opts: AdminHubOptions;
  readonly #subscribers = new Set<Subscriber>();
  readonly #startedAt = Date.now();
  #sampler: NodeJS.Timeout | undefined;
  #pruner: NodeJS.Timeout | undefined;

  constructor(opts: AdminHubOptions) {
    this.#opts = opts;
  }

  /** Begin sampling + pruning. Both timers are unref'd so they never hold the loop. */
  start(): void {
    this.#sampler = setInterval(() => void this.#sample(), this.#opts.sampleIntervalMs);
    this.#sampler.unref();
    this.#pruner = setInterval(() => this.#prune(), PRUNE_INTERVAL_MS);
    this.#pruner.unref();
  }

  stop(): void {
    if (this.#sampler !== undefined) clearInterval(this.#sampler);
    if (this.#pruner !== undefined) clearInterval(this.#pruner);
  }

  uptimeMs(): number {
    return Date.now() - this.#startedAt;
  }

  /** Wired into the supervisor's `onEvent`: persist + broadcast a lifecycle event. */
  onSupervisorEvent = (ev: SupervisorEvent): void => {
    const record = this.#opts.db.admin.recordAdminEvent(supervisorToAdminEvent(ev));
    this.#broadcast({ type: "event", event: record });
  };

  /** Record an operator action from a mutating admin route and broadcast it. */
  recordAction(action: string, target: string | null, detail: Record<string, unknown> = {}): AdminEvent {
    const record = this.#opts.db.admin.recordAdminEvent({
      kind: "admin_action",
      actor: "admin",
      target,
      detail: { action, ...detail },
    });
    this.#broadcast({ type: "event", event: record });
    return record;
  }

  /** A snapshot of every runtime gauge (used by both the sampler and the overview). */
  async gauges(): Promise<Readonly<Record<string, number>>> {
    const sandbox = await this.#opts.supervisor.sandboxStats();
    return {
      "hosts.running": this.#opts.supervisor.list().length,
      "hosts.starting": this.#opts.supervisor.startingIds().length,
      "turns.active": this.#opts.turns.activeChatIds().length,
      "sandbox.vms": sandbox.vms,
      "sandbox.orphans": sandbox.orphans,
      "proc.rss": process.memoryUsage().rss,
      "db.bytes": this.#dbBytes(),
    };
  }

  /** The overview's runtime block, derived from a single gauge snapshot. */
  async runtime(): Promise<AdminRuntime> {
    const g = await this.gauges();
    return {
      hostsRunning: g["hosts.running"] ?? 0,
      hostsStarting: g["hosts.starting"] ?? 0,
      turnsActive: g["turns.active"] ?? 0,
      sandboxVms: g["sandbox.vms"] ?? 0,
      sandboxOrphans: g["sandbox.orphans"] ?? 0,
      rssBytes: g["proc.rss"] ?? 0,
      dbBytes: g["db.bytes"] ?? 0,
      uptimeMs: this.uptimeMs(),
      sandboxBackend: this.#opts.sandboxBackend,
    };
  }

  /**
   * Live feed for `GET /api/admin/stream`. Emits an immediate gauge snapshot so
   * the client paints without waiting a full tick, then tails samples + events.
   * The `signal` (the request's abort signal) unblocks the wait so a disconnect
   * cleans up promptly rather than parking until the next event.
   */
  async *subscribe(signal: AbortSignal): AsyncGenerator<AdminStreamEvent> {
    const queue: AdminStreamEvent[] = [];
    let wake: (() => void) | null = null;
    const sub: Subscriber = (event) => {
      queue.push(event);
      wake?.();
      wake = null;
    };
    // A single abort listener for the connection's lifetime — re-registering one
    // per wake cycle would leak listeners on a long-lived stream (and trip Node's
    // MaxListenersExceededWarning after a handful of sample ticks).
    const onAbort = (): void => {
      wake?.();
      wake = null;
    };
    signal.addEventListener("abort", onAbort);
    this.#subscribers.add(sub);
    try {
      queue.push({ type: "sample", ts: new Date().toISOString(), metrics: await this.gauges() });
      for (;;) {
        if (signal.aborted) return;
        while (queue.length > 0) {
          const event = queue.shift();
          if (event !== undefined) yield event;
        }
        if (signal.aborted) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.#subscribers.delete(sub);
    }
  }

  #broadcast(event: AdminStreamEvent): void {
    for (const sub of this.#subscribers) sub(event);
  }

  async #sample(): Promise<void> {
    try {
      const metrics = await this.gauges();
      const ts = new Date().toISOString();
      this.#opts.db.admin.recordSamples(ts, metrics);
      this.#broadcast({ type: "sample", ts, metrics });
    } catch {
      // A single failed sample tick must never crash the sampler.
    }
  }

  #prune(): void {
    const now = Date.now();
    const samplesBefore = new Date(now - this.#opts.metricsRetentionDays * DAY_MS).toISOString();
    const historyBefore = new Date(now - this.#opts.historyRetentionDays * DAY_MS).toISOString();
    this.#opts.db.admin.pruneOlderThan(samplesBefore, historyBefore);
  }

  #dbBytes(): number {
    try {
      return statSync(this.#opts.dbPath).size;
    } catch {
      return 0;
    }
  }
}
