import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react";
import type { AdminRuntime } from "@xagents/core";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getOverview } from "@/lib/admin-api";
import { useAdminToken } from "@/components/admin-guard";
import { useAdminLive } from "@/components/admin/live-context";
import { StatTile, TimeSeriesChart, fmtInt, fmtMs, fmtUptime, fmtUsd } from "@/components/admin/primitives";
import { useAsync } from "@/hooks/use-async";
import { formatBytes } from "@/lib/format";

export function OverviewTab() {
  const token = useAdminToken();
  const { data, error, loading, reload } = useAsync(() => getOverview(token), [token]);
  const live = useAdminLive();

  if (loading && data === undefined) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }
  if (error !== undefined || data === undefined) {
    return (
      <EmptyState
        icon={AlertTriangleIcon}
        title="Couldn't load the overview"
        description={error}
        action={<Button onClick={reload}>Retry</Button>}
      />
    );
  }

  // Prefer the live gauge snapshot for runtime numbers when the feed is up.
  const rt: AdminRuntime = live.connected
    ? {
        ...data.runtime,
        hostsRunning: live.metrics["hosts.running"] ?? data.runtime.hostsRunning,
        turnsActive: live.metrics["turns.active"] ?? data.runtime.turnsActive,
        sandboxVms: live.metrics["sandbox.vms"] ?? data.runtime.sandboxVms,
        rssBytes: live.metrics["proc.rss"] ?? data.runtime.rssBytes,
        dbBytes: live.metrics["db.bytes"] ?? data.runtime.dbBytes,
      }
    : data.runtime;

  const c = data.counts;
  const t = data.today;
  const errorRate = t.turns > 0 ? Math.round((t.errors / t.turns) * 100) : 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Runtime</h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className={`size-2 rounded-full ${live.connected ? "bg-status-running" : "bg-status-idle"}`}
            />
            {live.connected ? "Live" : "Offline"}
          </span>
          <Button variant="ghost" size="sm" onClick={reload}>
            <RefreshCwIcon /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Running hosts" value={fmtInt(rt.hostsRunning)} hint={`${rt.hostsStarting} starting`} />
        <StatTile label="Active turns" value={fmtInt(rt.turnsActive)} />
        <StatTile
          label="Sandbox VMs"
          value={fmtInt(rt.sandboxVms)}
          hint={rt.sandboxOrphans > 0 ? `${rt.sandboxOrphans} orphaned` : "no orphans"}
        />
        <StatTile label="Process memory" value={formatBytes(rt.rssBytes)} />
        <StatTile label="Database size" value={formatBytes(rt.dbBytes)} />
        <StatTile label="Sandbox backend" value={<span className="text-base">{rt.sandboxBackend}</span>} />
        <StatTile label="Server uptime" value={fmtUptime(rt.uptimeMs)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Process memory (live)
          </p>
          <TimeSeriesChart points={live.series["proc.rss"] ?? []} color="var(--color-chart-1)" />
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Active turns (live)
          </p>
          <TimeSeriesChart points={live.series["turns.active"] ?? []} color="var(--color-chart-2)" />
        </div>
      </div>

      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Today</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Turns" value={fmtInt(t.turns)} hint={`${t.completed} completed`} />
        <StatTile label="Error rate" value={`${errorRate}%`} hint={`${t.errors} errors`} />
        <StatTile label="Tokens" value={fmtInt(t.totalTokens)} />
        <StatTile label="Estimated cost" value={fmtUsd(t.costUsd)} />
        <StatTile label="Avg duration" value={fmtMs(t.avgDurationMs)} />
        <StatTile label="Cancelled" value={fmtInt(t.cancelled)} />
      </div>

      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Content</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Agents" value={fmtInt(c.agents)} />
        <StatTile label="Knowledgebases" value={fmtInt(c.knowledgebases)} hint={`${c.documents} docs`} />
        <StatTile label="Skills" value={fmtInt(c.skills)} />
        <StatTile label="Chats" value={fmtInt(c.chats)} hint={`${c.messages} messages`} />
        <StatTile label="Users" value={fmtInt(c.users)} />
        <StatTile label="KB chunks" value={fmtInt(c.chunks)} />
      </div>
    </div>
  );
}
