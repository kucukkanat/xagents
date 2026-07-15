import { useEffect, useState } from "react";
import { ActivityIcon, AlertTriangleIcon } from "lucide-react";
import { toast } from "sonner";
import type { RunMetric } from "@xagents/core";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getRuns } from "@/lib/admin-api";
import { useAdminToken } from "@/components/admin-guard";
import {
  AdminTable,
  RunStatusBadge,
  StatTile,
  Td,
  Th,
  fmtInt,
  fmtMs,
  fmtTokens,
  fmtUsd,
} from "@/components/admin/primitives";
import { useAsync } from "@/hooks/use-async";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const DAY_MS = 24 * 60 * 60_000;
const RANGES = [
  { key: "24h", label: "24h", ms: DAY_MS },
  { key: "7d", label: "7 days", ms: 7 * DAY_MS },
  { key: "30d", label: "30 days", ms: 30 * DAY_MS },
  { key: "all", label: "All", ms: null },
] as const;

export function RunsTab() {
  const token = useAdminToken();
  const [rangeKey, setRangeKey] = useState<(typeof RANGES)[number]["key"]>("24h");
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[0];
  const from = range.ms === null ? undefined : new Date(Date.now() - range.ms).toISOString();

  const first = useAsync(() => getRuns(token, from !== undefined ? { from } : {}), [token, from]);
  const [more, setMore] = useState<RunMetric[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Reset appended pages whenever the base (range) query reloads.
  useEffect(() => {
    setMore([]);
    setCursor(first.data?.nextCursor ?? null);
  }, [first.data]);

  const runs = [...(first.data?.runs ?? []), ...more];

  const loadMore = async (): Promise<void> => {
    if (cursor === null) return;
    setLoadingMore(true);
    try {
      const page = await getRuns(token, { ...(from !== undefined ? { from } : {}), cursor });
      setMore((prev) => [...prev, ...page.runs]);
      setCursor(page.nextCursor);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  };

  const totals = first.data?.totals;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 rounded-lg border p-1 w-fit">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRangeKey(r.key)}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              r.key === rangeKey ? "bg-brand-subtle text-brand" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {totals !== undefined ? (
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Turns" value={fmtInt(totals.turns)} />
          <StatTile label="Completed" value={fmtInt(totals.completed)} />
          <StatTile label="Errors" value={fmtInt(totals.errors)} />
          <StatTile label="Tokens" value={fmtInt(totals.totalTokens)} />
          <StatTile label="Cost" value={fmtUsd(totals.costUsd)} />
          <StatTile label="Avg duration" value={fmtMs(totals.avgDurationMs)} />
        </div>
      ) : null}

      {first.loading && first.data === undefined ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : first.error !== undefined ? (
        <EmptyState
          icon={AlertTriangleIcon}
          title="Couldn't load runs"
          description={first.error}
          action={<Button onClick={first.reload}>Retry</Button>}
        />
      ) : runs.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="No runs in this window"
          description="Chat with an agent to generate run telemetry."
        />
      ) : (
        <>
          <AdminTable
            head={
              <tr>
                <Th>When</Th>
                <Th>Agent</Th>
                <Th>Model</Th>
                <Th>Status</Th>
                <Th className="text-right">Duration</Th>
                <Th className="text-right">TTFT</Th>
                <Th className="text-right">Tokens</Th>
                <Th className="text-right">Cost</Th>
              </tr>
            }
          >
            {runs.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <Td className="whitespace-nowrap text-muted-foreground">{relativeTime(r.createdAt)}</Td>
                <Td className="font-medium">{r.agentName ?? r.agentId}</Td>
                <Td className="text-muted-foreground">{r.modelId}</Td>
                <Td>
                  <RunStatusBadge status={r.status} />
                </Td>
                <Td className="text-right tabular-nums">{fmtMs(r.durationMs)}</Td>
                <Td className="text-right tabular-nums text-muted-foreground">{fmtMs(r.ttftMs)}</Td>
                <Td className="text-right tabular-nums">{fmtTokens(r.totalTokens)}</Td>
                <Td className="text-right tabular-nums">{r.costUsd === null ? "—" : fmtUsd(r.costUsd)}</Td>
              </tr>
            ))}
          </AdminTable>
          {cursor !== null ? (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
