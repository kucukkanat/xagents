import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { type AppError, type Result, appError, err, ok } from "@xagents/core";
import type { AgentHost, HostStatus, HostStopReason, SupervisorEvent } from "./types";

const require = createRequire(import.meta.url);
/** Absolute path to the installed eve CLI entrypoint. */
const eveBinPath = (): string =>
  require.resolve("eve/package.json").replace(/package\.json$/, "bin/eve.js");

const URL_RE = /https?:\/\/[^\s"'<>]+/g;
const isLoopback = (u: string): boolean => /127\.0\.0\.1|localhost|\[::1\]/.test(u);

interface Running {
  readonly host: AgentHost;
  readonly proc: ChildProcess;
  readonly startedAt: number;
  lastUsed: number;
}

export interface SupervisorOptions {
  /** Where each agent's materialized eve project lives. */
  readonly projectDirFor: (agentId: string) => string;
  /** Extra env for every eve child. Merged over process.env. */
  readonly env?: Record<string, string | undefined>;
  /**
   * Per-agent env resolved at spawn time — the provider secret(s) that agent's
   * model needs, decrypted just-in-time by the server. Layered over `env`, so a
   * host only ever receives the one provider key it uses. Re-resolved on every
   * (re)start, so rotating a key + restarting the host picks up the new value.
   */
  readonly envFor?: (agentId: string) => Record<string, string | undefined>;
  /** Kill a host after this long without use. Default 10 min. */
  readonly idleMs?: number;
  /** How long to wait for `eve dev` to print its origin. Default 180s. */
  readonly bootTimeoutMs?: number;
  /** Optional monitoring hook. Called on every host/sandbox lifecycle change. */
  readonly onEvent?: (event: SupervisorEvent) => void;
}

/**
 * Owns one `eve dev` child process per agent. eve has no in-process server
 * (its own Next.js adapter spawns the CLI and proxies), so we do the same:
 * spawn on demand, discover the printed origin, health-check, and idle-reap.
 */
export class HostSupervisor {
  readonly #projectDirFor: (agentId: string) => string;
  readonly #env: Record<string, string | undefined> | undefined;
  readonly #envFor: ((agentId: string) => Record<string, string | undefined>) | undefined;
  readonly #idleMs: number;
  readonly #bootTimeoutMs: number;
  readonly #running = new Map<string, Running>();
  readonly #starting = new Map<string, Promise<Result<AgentHost, AppError>>>();
  /** PIDs of every eve host we currently keep alive (starting or running). A
   *  microsandbox VM whose parent isn't in here is an orphan we should reap. */
  readonly #hostPids = new Set<number>();
  readonly #sweeper: NodeJS.Timeout;
  readonly #onEvent: ((event: SupervisorEvent) => void) | undefined;

  constructor(opts: SupervisorOptions) {
    this.#projectDirFor = opts.projectDirFor;
    this.#env = opts.env;
    this.#envFor = opts.envFor;
    this.#idleMs = opts.idleMs ?? 10 * 60_000;
    this.#bootTimeoutMs = opts.bootTimeoutMs ?? 180_000;
    this.#onEvent = opts.onEvent;
    this.#sweeper = setInterval(() => {
      this.#reapIdle();
      void this.reapOrphanSandboxes();
    }, 30_000);
    this.#sweeper.unref();
  }

  /** Emit a lifecycle event to the monitoring hook, if one is wired. Never throws. */
  #emit(event: SupervisorEvent): void {
    try {
      this.#onEvent?.(event);
    } catch {
      // A misbehaving observer must never affect host supervision.
    }
  }

  /** Snapshot of the currently-running hosts, for the monitoring layer. */
  list(): HostStatus[] {
    const now = Date.now();
    const out: HostStatus[] = [];
    for (const [agentId, r] of this.#running) {
      out.push({
        agentId,
        origin: r.host.origin,
        pid: r.proc.pid ?? null,
        startedAt: r.startedAt,
        lastUsed: r.lastUsed,
        uptimeMs: now - r.startedAt,
      });
    }
    return out;
  }

  /** Agent ids currently cold-starting (spawned, not yet serving). */
  startingIds(): string[] {
    return [...this.#starting.keys()];
  }

  /** Live and orphaned `eve-sbx-*` microVM counts from a single `ps` snapshot. */
  async sandboxStats(): Promise<{ readonly vms: number; readonly orphans: number }> {
    const snapshot = await psSnapshot();
    return {
      vms: countSandboxPids(snapshot),
      orphans: selectOrphanSandboxPids(snapshot, this.#hostPids).length,
    };
  }

  /** Reuse a healthy host or start one. Concurrent calls for the same agent share one start. */
  async getOrStart(agentId: string): Promise<Result<AgentHost, AppError>> {
    const existing = this.#running.get(agentId);
    if (existing !== undefined) {
      existing.lastUsed = Date.now();
      return ok(existing.host);
    }
    const pending = this.#starting.get(agentId);
    if (pending !== undefined) return pending;

    const start = this.#start(agentId).finally(() => this.#starting.delete(agentId));
    this.#starting.set(agentId, start);
    return start;
  }

  /** Whether a host is currently running for this agent. */
  has(agentId: string): boolean {
    return this.#running.has(agentId);
  }

  /** Stop an agent's host (call after the agent is edited so it re-materializes). */
  stop(agentId: string, reason: HostStopReason = "invalidated"): void {
    const r = this.#running.get(agentId);
    if (r === undefined) return;
    this.#running.delete(agentId);
    if (r.proc.pid !== undefined) this.#hostPids.delete(r.proc.pid);
    killProc(r.proc);
    this.#emit({ kind: "host_stopped", agentId, reason });
  }

  /** Stop every running host but keep the sweeper alive — the admin "stop all"
   *  control. Distinct from `stopAll`, which also tears the sweeper down. */
  stopHosts(): number {
    const ids = [...this.#running.keys()];
    for (const agentId of ids) this.stop(agentId, "admin");
    return ids.length;
  }

  /** Full teardown for process shutdown: kills hosts AND stops the sweeper. */
  stopAll(): void {
    clearInterval(this.#sweeper);
    for (const [, r] of this.#running) {
      if (r.proc.pid !== undefined) this.#hostPids.delete(r.proc.pid);
      killProc(r.proc);
    }
    this.#running.clear();
  }

  /**
   * SIGKILL every leftover microVM whose eve host we no longer own. microsandbox
   * runs each `msb sandbox` VM in its own process group so it OUTLIVES its
   * creator: when an eve host is stopped (idle-reap, agent edit, shutdown) or
   * crashes, its VMs reparent to init and keep running forever (~1 GiB each),
   * and microsandbox's own registry drifts out of sync with the live processes.
   * So we reap at the OS level — any `eve-sbx-*` VM not parented by a host in
   * `#hostPids` is an orphan. Assumes a single server instance owns these VMs.
   */
  async reapOrphanSandboxes(): Promise<number> {
    const pids = selectOrphanSandboxPids(await psSnapshot(), this.#hostPids);
    let reaped = 0;
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
        reaped += 1;
      } catch {
        // Raced with the process exiting between the snapshot and the kill — fine.
      }
    }
    if (reaped > 0) this.#emit({ kind: "sandbox_reaped", count: reaped });
    return reaped;
  }

  async #start(agentId: string): Promise<Result<AgentHost, AppError>> {
    const cwd = this.#projectDirFor(agentId);
    const startedAt = Date.now();
    const proc = spawn(process.execPath, [eveBinPath(), "dev", "--no-ui", "--port", "0"], {
      cwd,
      env: { ...process.env, ...this.#env, ...this.#envFor?.(agentId) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Record the pid from spawn (not only after a successful boot) so a host
    // that dies while booting still has its VMs recognized as reapable.
    const { pid } = proc;
    if (pid !== undefined) this.#hostPids.add(pid);
    proc.once("exit", () => {
      if (pid !== undefined) this.#hostPids.delete(pid);
      // Drop the record if this exact process dies so the next call restarts it.
      // A record still pointing at this proc means it died on its own (crash) —
      // `stop` deletes the record before killing, so it won't reach here.
      const cur = this.#running.get(agentId);
      if (cur?.proc === proc) {
        this.#running.delete(agentId);
        this.#emit({ kind: "host_crashed", agentId, pid: pid ?? null });
      }
    });

    const origin = await waitForOrigin(proc, this.#bootTimeoutMs);
    if (!origin.ok) {
      killProc(proc);
      this.#emit({ kind: "boot_failed", agentId, message: origin.error.message });
      return origin;
    }
    const host: AgentHost = { agentId, origin: origin.value };
    this.#running.set(agentId, { host, proc, startedAt, lastUsed: Date.now() });
    this.#emit({
      kind: "host_started",
      agentId,
      pid: pid ?? null,
      origin: origin.value,
      bootMs: Date.now() - startedAt,
    });
    return ok(host);
  }

  #reapIdle(): void {
    const cutoff = Date.now() - this.#idleMs;
    for (const [agentId, r] of this.#running) {
      if (r.lastUsed < cutoff) this.stop(agentId, "idle");
    }
  }
}

const waitForOrigin = (proc: ChildProcess, timeoutMs: number): Promise<Result<string, AppError>> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (r: Result<string, AppError>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.stdout?.off("data", onData);
      proc.stderr?.off("data", onData);
      resolve(r);
    };
    const onData = (buf: Buffer): void => {
      for (const m of buf.toString("utf8").matchAll(URL_RE)) {
        const candidate = m[0].replace(/[)\].,]+$/, "");
        if (!isLoopback(candidate)) continue;
        try {
          finish(ok(new URL(candidate).origin));
          return;
        } catch {
          // keep scanning subsequent matches
        }
      }
    };
    const timer = setTimeout(
      () => finish(err(appError("agent_runtime_error", "eve dev did not report an origin in time"))),
      timeoutMs,
    );
    timer.unref();
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.once("error", (e) => finish(err(appError("agent_runtime_error", "failed to spawn eve dev", e))));
    proc.once("exit", (code) =>
      finish(err(appError("agent_runtime_error", `eve dev exited before serving (code ${String(code)})`))),
    );
  });

const killProc = (proc: ChildProcess): void => {
  if (proc.killed) return;
  proc.kill("SIGTERM");
  setTimeout(() => {
    if (!proc.killed) proc.kill("SIGKILL");
  }, 2_000).unref();
};

/** Command-line shape of a microsandbox microVM an eve host launched. `msb` must
 *  be the executable itself (command start or a `/`-path), so a `ps`/`grep` whose
 *  *arguments* merely mention the pattern is never mistaken for a VM to kill. */
const SANDBOX_PROC_RE = /(?:^|\/)msb\s+sandbox\b.*--name\s+eve-sbx-/;

/**
 * From a `ps -Ao pid=,ppid=,command=` snapshot, the pids of eve sandbox VMs
 * whose parent isn't one of `hostPids` — the orphans to reap. Pure, so the reap
 * decision is unit-testable without touching real processes.
 */
export const selectOrphanSandboxPids = (
  psSnapshotText: string,
  hostPids: ReadonlySet<number>,
): number[] => {
  const pids: number[] = [];
  for (const line of psSnapshotText.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m === null) continue;
    const [, pidStr, ppidStr, command] = m;
    if (pidStr === undefined || ppidStr === undefined || command === undefined) continue;
    if (!SANDBOX_PROC_RE.test(command) || hostPids.has(Number(ppidStr))) continue;
    pids.push(Number(pidStr));
  }
  return pids;
};

/** Count every live `eve-sbx-*` microVM in a `ps` snapshot. Pure, so the gauge
 *  is unit-testable without touching real processes. */
export const countSandboxPids = (psSnapshotText: string): number => {
  let count = 0;
  for (const line of psSnapshotText.split("\n")) {
    const m = /^\s*\d+\s+\d+\s+(.*)$/.exec(line);
    if (m === null) continue;
    const command = m[1];
    if (command !== undefined && SANDBOX_PROC_RE.test(command)) count += 1;
  }
  return count;
};

/** Every process as `<pid> <ppid> <command>` lines; empty string on failure. */
const psSnapshot = (): Promise<string> =>
  new Promise((resolve) => {
    execFile("ps", ["-Ao", "pid=,ppid=,command="], { maxBuffer: 16 * 1024 * 1024 }, (e, out) =>
      resolve(e ? "" : out),
    );
  });
