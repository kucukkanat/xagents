import { AlertTriangleIcon, ListIcon } from "lucide-react";
import type { AdminEvent, AdminEventKind } from "@xagents/core";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getEvents } from "@/lib/admin-api";
import { useAdminToken } from "@/components/admin-guard";
import { useAdminLive } from "@/components/admin/live-context";
import { AdminTable, Td, Th } from "@/components/admin/primitives";
import { useAsync } from "@/hooks/use-async";
import { relativeTime } from "@/lib/format";

const KIND_TONE: Record<AdminEventKind, string> = {
  host_started: "bg-status-running/15 text-status-running",
  host_stopped: "bg-muted text-muted-foreground",
  host_idle_reaped: "bg-muted text-muted-foreground",
  host_crashed: "bg-status-error/15 text-status-error",
  boot_failed: "bg-status-error/15 text-status-error",
  sandbox_reaped: "bg-status-starting/15 text-status-starting",
  admin_action: "bg-brand-subtle text-brand",
};

const summarize = (detail: Record<string, unknown>): string =>
  Object.entries(detail)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");

export function EventsTab() {
  const token = useAdminToken();
  const initial = useAsync(() => getEvents(token, "150"), [token]);
  const live = useAdminLive();

  // Live events (newest) win over the initial fetch; dedupe by id.
  const byId = new Map<string, AdminEvent>();
  for (const e of live.events) byId.set(e.id, e);
  for (const e of initial.data ?? []) if (!byId.has(e.id)) byId.set(e.id, e);
  const events = [...byId.values()].sort((a, b) => b.ts.localeCompare(a.ts));

  if (initial.loading && initial.data === undefined) return <Skeleton className="h-64 rounded-xl" />;
  if (initial.error !== undefined && events.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangleIcon}
        title="Couldn't load events"
        description={initial.error}
        action={<Button onClick={initial.reload}>Retry</Button>}
      />
    );
  }
  if (events.length === 0) {
    return (
      <EmptyState
        icon={ListIcon}
        title="No events yet"
        description="Host lifecycle changes, sandbox reaps, and admin actions appear here as they happen."
      />
    );
  }

  return (
    <AdminTable
      head={
        <tr>
          <Th>When</Th>
          <Th>Event</Th>
          <Th>Actor</Th>
          <Th>Target</Th>
          <Th>Detail</Th>
        </tr>
      }
    >
      {events.map((e) => (
        <tr key={e.id} className="hover:bg-muted/30">
          <Td className="whitespace-nowrap text-muted-foreground">{relativeTime(e.ts)}</Td>
          <Td>
            <Badge variant="ghost" className={KIND_TONE[e.kind]}>
              {e.kind.replace(/_/g, " ")}
            </Badge>
          </Td>
          <Td className="text-muted-foreground">{e.actor}</Td>
          <Td className="font-mono text-xs text-muted-foreground">{e.target ?? "—"}</Td>
          <Td className="max-w-md truncate text-xs text-muted-foreground">{summarize(e.detail)}</Td>
        </tr>
      ))}
    </AdminTable>
  );
}
