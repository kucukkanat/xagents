import {
  newId,
  type AdminContentItem,
  type AdminCounts,
  type AdminEvent,
  type AdminEventKind,
  type AdminRunTotals,
  type AdminUser,
  type MetricSeries,
  type RunMetric,
  type RunMetricsPage,
  type RunStatus,
  type Visibility,
} from "@xagents/core";
import { nowIso } from "../helpers";
import type { Sqlite } from "../sqlite";

/** A per-turn telemetry row to persist (ids/timestamps are assigned here). */
export interface NewRunMetric {
  readonly chatId: string;
  readonly agentId: string;
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
}

export interface NewAdminEvent {
  readonly kind: AdminEventKind;
  readonly actor: "system" | "admin";
  readonly target: string | null;
  readonly detail: Record<string, unknown>;
}

export interface RunMetricsFilter {
  readonly fromIso?: string;
  readonly toIso?: string;
  readonly agentId?: string;
  readonly limit: number;
  /** Keyset cursor: rows with rowid < cursor (older) are returned next. */
  readonly cursor?: string;
}

export interface AdminRepo {
  readonly counts: () => AdminCounts;
  readonly listAgents: () => AdminContentItem[];
  readonly listKnowledgebases: () => AdminContentItem[];
  readonly listSkills: () => AdminContentItem[];
  readonly listChats: () => AdminContentItem[];
  readonly listUsers: () => AdminUser[];
  readonly runMetrics: (filter: RunMetricsFilter) => RunMetricsPage;
  readonly runTotals: (fromIso: string, toIso: string) => AdminRunTotals;
  /** Bucketed gauge series. `bucketLen` = ISO prefix length (16=minute, 13=hour). */
  readonly series: (metric: string, fromIso: string, toIso: string, bucketLen: number) => MetricSeries;
  readonly recentEvents: (fromIso: string | undefined, limit: number) => AdminEvent[];
  readonly recordRunMetric: (m: NewRunMetric) => void;
  readonly recordSamples: (ts: string, metrics: Readonly<Record<string, number>>) => void;
  readonly recordAdminEvent: (e: NewAdminEvent) => AdminEvent;
  readonly pruneOlderThan: (samplesBeforeIso: string, historyBeforeIso: string) => void;
  /** Moderation: flip visibility on any owner's content. Returns false if absent. */
  readonly setVisibility: (
    kind: "agent" | "knowledgebase" | "skill",
    id: string,
    visibility: Visibility,
  ) => boolean;
  /** Delete a user (cascades all their content). Returns false if absent. */
  readonly deleteUser: (id: string) => boolean;
}

// --- row shapes --------------------------------------------------------------

interface CountsRow {
  readonly users: number;
  readonly agents: number;
  readonly knowledgebases: number;
  readonly skills: number;
  readonly chats: number;
  readonly messages: number;
  readonly documents: number;
  readonly chunks: number;
}

interface ContentRow {
  readonly id: string;
  readonly name: string;
  readonly owner_id: string;
  readonly owner_handle: string;
  readonly visibility: string | null;
  readonly detail: string;
  readonly updated_at: string;
}

interface UserRow {
  readonly id: string;
  readonly handle: string;
  readonly display_name: string;
  readonly created_at: string;
  readonly agents: number;
  readonly knowledgebases: number;
  readonly skills: number;
  readonly chats: number;
}

interface RunMetricRow {
  readonly _rid: number;
  readonly id: string;
  readonly chat_id: string;
  readonly agent_id: string;
  readonly agent_name: string | null;
  readonly user_id: string;
  readonly model_provider: string;
  readonly model_id: string;
  readonly status: string;
  readonly error_message: string | null;
  readonly boot_ms: number | null;
  readonly ttft_ms: number | null;
  readonly duration_ms: number;
  readonly tool_calls: number;
  readonly sandbox_calls: number;
  readonly prompt_tokens: number | null;
  readonly completion_tokens: number | null;
  readonly total_tokens: number | null;
  readonly cost_usd: number | null;
  readonly started_at: string;
  readonly created_at: string;
}

interface TotalsRow {
  readonly turns: number;
  readonly completed: number;
  readonly errors: number;
  readonly cancelled: number;
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
  readonly cost_usd: number;
  readonly avg_duration_ms: number;
}

interface SeriesRow {
  readonly bucket: string;
  readonly value: number;
}

interface AdminEventRow {
  readonly id: string;
  readonly ts: string;
  readonly kind: string;
  readonly actor: string;
  readonly target: string | null;
  readonly detail_json: string;
}

// --- guards / mappers --------------------------------------------------------

const asRunStatus = (v: string): RunStatus => {
  if (v === "completed" || v === "error" || v === "cancelled") return v;
  throw new Error(`invalid run status in db: ${v}`);
};

const asVisibilityOrNull = (v: string | null): Visibility | null => {
  if (v === null) return null;
  if (v === "private" || v === "public") return v;
  throw new Error(`invalid visibility in db: ${v}`);
};

const asActor = (v: string): "system" | "admin" => {
  if (v === "system" || v === "admin") return v;
  throw new Error(`invalid admin event actor in db: ${v}`);
};

const asEventKind = (v: string): AdminEventKind => {
  switch (v) {
    case "host_started":
    case "host_stopped":
    case "host_idle_reaped":
    case "host_crashed":
    case "boot_failed":
    case "sandbox_reaped":
    case "admin_action":
      return v;
    default:
      throw new Error(`invalid admin event kind in db: ${v}`);
  }
};

const mapContentRow = (row: ContentRow, kind: AdminContentItem["kind"]): AdminContentItem => ({
  kind,
  id: row.id,
  name: row.name,
  ownerId: row.owner_id,
  ownerHandle: row.owner_handle,
  visibility: asVisibilityOrNull(row.visibility),
  detail: row.detail,
  updatedAt: row.updated_at,
});

const mapRunMetricRow = (row: RunMetricRow): RunMetric => ({
  id: row.id,
  chatId: row.chat_id,
  agentId: row.agent_id,
  agentName: row.agent_name,
  userId: row.user_id,
  modelProvider: row.model_provider,
  modelId: row.model_id,
  status: asRunStatus(row.status),
  errorMessage: row.error_message,
  bootMs: row.boot_ms,
  ttftMs: row.ttft_ms,
  durationMs: row.duration_ms,
  toolCalls: row.tool_calls,
  sandboxCalls: row.sandbox_calls,
  promptTokens: row.prompt_tokens,
  completionTokens: row.completion_tokens,
  totalTokens: row.total_tokens,
  costUsd: row.cost_usd,
  startedAt: row.started_at,
  createdAt: row.created_at,
});

const mapTotals = (row: TotalsRow): AdminRunTotals => ({
  turns: row.turns,
  completed: row.completed,
  errors: row.errors,
  cancelled: row.cancelled,
  promptTokens: row.prompt_tokens,
  completionTokens: row.completion_tokens,
  totalTokens: row.total_tokens,
  costUsd: row.cost_usd,
  avgDurationMs: row.avg_duration_ms,
});

const parseDetail = (json: string): Record<string, unknown> => {
  try {
    const v: unknown = JSON.parse(json);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const createAdminRepo = (db: Sqlite): AdminRepo => {
  const countsStmt = db.prepare<[], CountsRow>(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM agents) AS agents,
      (SELECT COUNT(*) FROM knowledgebases) AS knowledgebases,
      (SELECT COUNT(*) FROM skills) AS skills,
      (SELECT COUNT(*) FROM chats) AS chats,
      (SELECT COUNT(*) FROM messages) AS messages,
      (SELECT COUNT(*) FROM kb_documents) AS documents,
      (SELECT COUNT(*) FROM kb_chunks) AS chunks`);

  const agentsStmt = db.prepare<[], ContentRow>(`
    SELECT a.id, a.name, a.owner_id, u.handle AS owner_handle, a.visibility,
      (a.model_provider || '/' || a.model_id) AS detail, a.updated_at
    FROM agents a JOIN users u ON u.id = a.owner_id
    ORDER BY a.updated_at DESC`);

  const kbsStmt = db.prepare<[], ContentRow>(`
    SELECT k.id, k.name, k.owner_id, u.handle AS owner_handle, k.visibility,
      ((SELECT COUNT(*) FROM kb_documents d WHERE d.knowledgebase_id = k.id) || ' documents') AS detail,
      k.updated_at
    FROM knowledgebases k JOIN users u ON u.id = k.owner_id
    ORDER BY k.updated_at DESC`);

  const skillsStmt = db.prepare<[], ContentRow>(`
    SELECT s.id, s.name, s.owner_id, u.handle AS owner_handle, s.visibility,
      ((SELECT COUNT(*) FROM skill_resources r WHERE r.skill_id = s.id) || ' resources') AS detail,
      s.updated_at
    FROM skills s JOIN users u ON u.id = s.owner_id
    ORDER BY s.updated_at DESC`);

  const chatsStmt = db.prepare<[], ContentRow>(`
    SELECT c.id, c.title AS name, c.user_id AS owner_id, u.handle AS owner_handle, NULL AS visibility,
      ((SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) || ' messages') AS detail,
      c.updated_at
    FROM chats c JOIN users u ON u.id = c.user_id
    ORDER BY c.updated_at DESC`);

  const usersStmt = db.prepare<[], UserRow>(`
    SELECT u.id, u.handle, u.display_name, u.created_at,
      (SELECT COUNT(*) FROM agents a WHERE a.owner_id = u.id) AS agents,
      (SELECT COUNT(*) FROM knowledgebases k WHERE k.owner_id = u.id) AS knowledgebases,
      (SELECT COUNT(*) FROM skills s WHERE s.owner_id = u.id) AS skills,
      (SELECT COUNT(*) FROM chats c WHERE c.user_id = u.id) AS chats
    FROM users u ORDER BY u.created_at ASC`);

  const totalsSelect = `
    SELECT
      COUNT(*) AS turns,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errors,
      COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(cost_usd), 0) AS cost_usd,
      COALESCE(AVG(duration_ms), 0) AS avg_duration_ms
    FROM run_metrics WHERE created_at >= ? AND created_at < ?`;
  const totalsStmt = db.prepare<[string, string], TotalsRow>(totalsSelect);

  const insertRunMetric = db.prepare(`
    INSERT INTO run_metrics
      (id, chat_id, agent_id, user_id, model_provider, model_id, status, error_message,
       boot_ms, ttft_ms, duration_ms, tool_calls, sandbox_calls,
       prompt_tokens, completion_tokens, total_tokens, cost_usd, started_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const insertSample = db.prepare(
    "INSERT INTO metric_samples (id, ts, metric, value) VALUES (?, ?, ?, ?)",
  );

  const insertEvent = db.prepare(
    "INSERT INTO admin_events (id, ts, kind, actor, target, detail_json) VALUES (?, ?, ?, ?, ?, ?)",
  );

  const pruneSamples = db.prepare("DELETE FROM metric_samples WHERE ts < ?");
  const pruneRuns = db.prepare("DELETE FROM run_metrics WHERE created_at < ?");
  const pruneEvents = db.prepare("DELETE FROM admin_events WHERE ts < ?");

  // Table names can't be bound parameters, so one prepared statement per table.
  const setVisibilityStmts = {
    agent: db.prepare("UPDATE agents SET visibility = ?, updated_at = ? WHERE id = ?"),
    knowledgebase: db.prepare("UPDATE knowledgebases SET visibility = ?, updated_at = ? WHERE id = ?"),
    skill: db.prepare("UPDATE skills SET visibility = ?, updated_at = ? WHERE id = ?"),
  } as const;
  const deleteUserStmt = db.prepare("DELETE FROM users WHERE id = ?");

  const listContent = (
    all: () => ContentRow[],
    kind: AdminContentItem["kind"],
  ): AdminContentItem[] => all().map((r) => mapContentRow(r, kind));

  const runMetrics = (filter: RunMetricsFilter): RunMetricsPage => {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.fromIso !== undefined) {
      where.push("r.created_at >= ?");
      params.push(filter.fromIso);
    }
    if (filter.toIso !== undefined) {
      where.push("r.created_at < ?");
      params.push(filter.toIso);
    }
    if (filter.agentId !== undefined) {
      where.push("r.agent_id = ?");
      params.push(filter.agentId);
    }
    if (filter.cursor !== undefined) {
      where.push("r.rowid < ?");
      params.push(Number(filter.cursor));
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    // Fetch one extra row to know whether another page exists.
    const sql = `
      SELECT r.rowid AS _rid, r.*, a.name AS agent_name
      FROM run_metrics r LEFT JOIN agents a ON a.id = r.agent_id
      ${clause}
      ORDER BY r.rowid DESC
      LIMIT ?`;
    const rows = db.prepare<unknown[], RunMetricRow>(sql).all(...params, filter.limit + 1);
    const page = rows.slice(0, filter.limit);
    const nextCursor =
      rows.length > filter.limit && page.length > 0 ? String(page[page.length - 1]?._rid) : null;

    const from = filter.fromIso ?? "0000";
    const to = filter.toIso ?? "9999";
    const totalsRow = totalsStmt.get(from, to);
    return {
      runs: page.map(mapRunMetricRow),
      totals: mapTotals(
        totalsRow ?? {
          turns: 0,
          completed: 0,
          errors: 0,
          cancelled: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          cost_usd: 0,
          avg_duration_ms: 0,
        },
      ),
      nextCursor,
    };
  };

  return {
    counts: (): AdminCounts => {
      const row = countsStmt.get();
      return (
        row ?? {
          users: 0,
          agents: 0,
          knowledgebases: 0,
          skills: 0,
          chats: 0,
          messages: 0,
          documents: 0,
          chunks: 0,
        }
      );
    },
    listAgents: () => listContent(() => agentsStmt.all(), "agent"),
    listKnowledgebases: () => listContent(() => kbsStmt.all(), "knowledgebase"),
    listSkills: () => listContent(() => skillsStmt.all(), "skill"),
    listChats: () => listContent(() => chatsStmt.all(), "chat"),
    listUsers: (): AdminUser[] =>
      usersStmt.all().map((r) => ({
        id: r.id,
        handle: r.handle,
        displayName: r.display_name,
        createdAt: r.created_at,
        agents: r.agents,
        knowledgebases: r.knowledgebases,
        skills: r.skills,
        chats: r.chats,
      })),
    runMetrics,
    runTotals: (fromIso: string, toIso: string): AdminRunTotals => {
      const row = totalsStmt.get(fromIso, toIso);
      return mapTotals(
        row ?? {
          turns: 0,
          completed: 0,
          errors: 0,
          cancelled: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          cost_usd: 0,
          avg_duration_ms: 0,
        },
      );
    },
    series: (metric: string, fromIso: string, toIso: string, bucketLen: number): MetricSeries => {
      // Bucket by an ISO-prefix (16 chars = minute, 13 = hour) and average within
      // the bucket so charts stay bounded regardless of retention depth.
      const rows = db
        .prepare<[number, string, string, string], SeriesRow>(
          `SELECT substr(ts, 1, ?) AS bucket, AVG(value) AS value
           FROM metric_samples WHERE metric = ? AND ts >= ? AND ts < ?
           GROUP BY bucket ORDER BY bucket ASC`,
        )
        .all(bucketLen, metric, fromIso, toIso);
      return {
        metric,
        points: rows.map((r) => ({
          // Normalize the bucket prefix back to a parseable ISO instant.
          ts: bucketLen >= 16 ? `${r.bucket}:00.000Z` : `${r.bucket}:00:00.000Z`,
          value: r.value,
        })),
      };
    },
    recentEvents: (fromIso: string | undefined, limit: number): AdminEvent[] => {
      const rows =
        fromIso === undefined
          ? db
              .prepare<[number], AdminEventRow>(
                "SELECT * FROM admin_events ORDER BY rowid DESC LIMIT ?",
              )
              .all(limit)
          : db
              .prepare<[string, number], AdminEventRow>(
                "SELECT * FROM admin_events WHERE ts >= ? ORDER BY rowid DESC LIMIT ?",
              )
              .all(fromIso, limit);
      return rows.map((r) => ({
        id: r.id,
        ts: r.ts,
        kind: asEventKind(r.kind),
        actor: asActor(r.actor),
        target: r.target,
        detail: parseDetail(r.detail_json),
      }));
    },
    recordRunMetric: (m: NewRunMetric): void => {
      insertRunMetric.run(
        newId("RunMetricId"),
        m.chatId,
        m.agentId,
        m.userId,
        m.modelProvider,
        m.modelId,
        m.status,
        m.errorMessage,
        m.bootMs,
        m.ttftMs,
        m.durationMs,
        m.toolCalls,
        m.sandboxCalls,
        m.promptTokens,
        m.completionTokens,
        m.totalTokens,
        m.costUsd,
        m.startedAt,
        nowIso(),
      );
    },
    recordSamples: (ts: string, metrics: Readonly<Record<string, number>>): void => {
      db.transaction(() => {
        for (const [metric, value] of Object.entries(metrics)) {
          insertSample.run(newId("MetricSampleId"), ts, metric, value);
        }
      })();
    },
    recordAdminEvent: (e: NewAdminEvent): AdminEvent => {
      const id = newId("AdminEventId");
      const ts = nowIso();
      insertEvent.run(id, ts, e.kind, e.actor, e.target, JSON.stringify(e.detail));
      return { id, ts, kind: e.kind, actor: e.actor, target: e.target, detail: e.detail };
    },
    pruneOlderThan: (samplesBeforeIso: string, historyBeforeIso: string): void => {
      pruneSamples.run(samplesBeforeIso);
      pruneRuns.run(historyBeforeIso);
      pruneEvents.run(historyBeforeIso);
    },
    setVisibility: (
      kind: "agent" | "knowledgebase" | "skill",
      id: string,
      visibility: Visibility,
    ): boolean => setVisibilityStmts[kind].run(visibility, nowIso(), id).changes > 0,
    deleteUser: (id: string): boolean => deleteUserStmt.run(id).changes > 0,
  };
};
