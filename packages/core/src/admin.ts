import type { ModelOption } from "./providers";
import type { Visibility } from "./entities";

/**
 * Contract types for the super-admin console (`/api/admin/*`). These are the
 * serializable shapes crossing the wire; the server derives them from live
 * runtime state (supervisor/turns) and the metrics tables, and the web renders
 * them directly. Kept in `@xagents/core` so client and server share one source.
 */

/** Platform-wide entity counts. */
export interface AdminCounts {
  readonly users: number;
  readonly agents: number;
  readonly knowledgebases: number;
  readonly skills: number;
  readonly chats: number;
  readonly messages: number;
  readonly documents: number;
  readonly chunks: number;
}

/** Point-in-time runtime gauges. */
export interface AdminRuntime {
  readonly hostsRunning: number;
  readonly hostsStarting: number;
  readonly turnsActive: number;
  readonly sandboxVms: number;
  readonly sandboxOrphans: number;
  readonly rssBytes: number;
  readonly dbBytes: number;
  readonly uptimeMs: number;
  readonly sandboxBackend: string;
}

/** Aggregated run outcomes over a window (the overview uses "today"). */
export interface AdminRunTotals {
  readonly turns: number;
  readonly completed: number;
  readonly errors: number;
  readonly cancelled: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly avgDurationMs: number;
}

export interface AdminOverview {
  readonly counts: AdminCounts;
  readonly runtime: AdminRuntime;
  readonly today: AdminRunTotals;
  readonly models: readonly ModelOption[];
}

/** A live eve host as seen by the console. */
export interface AdminHost {
  readonly agentId: string;
  readonly agentName: string | null;
  readonly origin: string;
  readonly pid: number | null;
  readonly uptimeMs: number;
  readonly idleMs: number;
}

/** The Runtime tab payload: live hosts + starting/active/sandbox detail. */
export interface AdminRuntimeView {
  readonly hosts: readonly AdminHost[];
  readonly starting: readonly string[];
  readonly activeTurns: readonly string[];
  readonly sandbox: { readonly vms: number; readonly orphans: number };
}

export type RunStatus = "completed" | "error" | "cancelled";

/** One persisted per-turn telemetry row. */
export interface RunMetric {
  readonly id: string;
  readonly chatId: string;
  readonly agentId: string;
  readonly agentName: string | null;
  readonly userId: string;
  readonly modelProvider: string;
  readonly modelId: string;
  readonly status: RunStatus;
  readonly errorMessage: string | null;
  readonly bootMs: number | null;
  readonly ttftMs: number | null;
  readonly durationMs: number;
  readonly toolCalls: number;
  readonly sandboxCalls: number;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  readonly costUsd: number | null;
  readonly startedAt: string;
  readonly createdAt: string;
}

export interface RunMetricsPage {
  readonly runs: readonly RunMetric[];
  readonly totals: AdminRunTotals;
  readonly nextCursor: string | null;
}

export interface MetricPoint {
  readonly ts: string;
  readonly value: number;
}

export interface MetricSeries {
  readonly metric: string;
  readonly points: readonly MetricPoint[];
}

export type AdminEventKind =
  | "host_started"
  | "host_stopped"
  | "host_idle_reaped"
  | "host_crashed"
  | "boot_failed"
  | "sandbox_reaped"
  | "admin_action";

export interface AdminEvent {
  readonly id: string;
  readonly ts: string;
  readonly kind: AdminEventKind;
  readonly actor: "system" | "admin";
  readonly target: string | null;
  readonly detail: Record<string, unknown>;
}

export type AdminContentKind = "agent" | "knowledgebase" | "skill" | "chat";

/** A moderatable item across all owners. */
export interface AdminContentItem {
  readonly kind: AdminContentKind;
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly ownerHandle: string;
  /** null for chats (no visibility concept). */
  readonly visibility: Visibility | null;
  /** Short secondary line, e.g. "3 documents" / "12 messages". */
  readonly detail: string;
  readonly updatedAt: string;
}

export interface AdminUser {
  readonly id: string;
  readonly handle: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly agents: number;
  readonly knowledgebases: number;
  readonly skills: number;
  readonly chats: number;
}

/** Frames pushed over the admin SSE feed (`GET /api/admin/stream`). */
export type AdminStreamEvent =
  | { readonly type: "sample"; readonly ts: string; readonly metrics: Readonly<Record<string, number>> }
  | { readonly type: "event"; readonly event: AdminEvent };

/** The gauge metric names sampled into `metric_samples` / streamed live. */
export const ADMIN_METRICS = [
  "hosts.running",
  "hosts.starting",
  "turns.active",
  "sandbox.vms",
  "sandbox.orphans",
  "proc.rss",
  "db.bytes",
] as const;
export type AdminMetricName = (typeof ADMIN_METRICS)[number];

/** SSE endpoint for the live admin feed. */
export const adminStreamPath = "/api/admin/stream";
