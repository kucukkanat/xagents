import { useEffect, useState } from "react";
import { FlameIcon, PowerIcon, RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  cancelTurn,
  getRuntime,
  reapSandboxes,
  stopAllHosts,
  stopHost,
  warmSandbox,
} from "@/lib/admin-api";
import { useAdminToken } from "@/components/admin-guard";
import { AdminTable, Td, Th, fmtUptime } from "@/components/admin/primitives";
import { useConfig } from "@/lib/config-context";
import { useAsync } from "@/hooks/use-async";

const POLL_MS = 4000;

export function RuntimeTab() {
  const token = useAdminToken();
  const { sandboxBackend } = useConfig();
  const [tick, setTick] = useState(0);
  const { data, error, loading, reload } = useAsync(() => getRuntime(token), [token, tick]);

  // Light polling keeps the runtime view fresh without a dedicated stream.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => clearInterval(id);
  }, []);

  const act = async (p: Promise<unknown>, ok?: string): Promise<void> => {
    try {
      await p;
      if (ok !== undefined) toast.success(ok);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    }
  };

  if (loading && data === undefined) return <Skeleton className="h-64 rounded-xl" />;
  if (error !== undefined || data === undefined) {
    return (
      <EmptyState
        icon={PowerIcon}
        title="Couldn't load runtime state"
        description={error}
        action={<Button onClick={reload}>Retry</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{data.sandbox.vms}</span> sandbox microVMs
          {data.sandbox.orphans > 0 ? (
            <span className="text-status-error"> · {data.sandbox.orphans} orphaned</span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {sandboxBackend === "microsandbox" ? (
            <Button variant="outline" size="sm" onClick={() => void act(warmSandbox(token), "Warm started")}>
              <FlameIcon /> Warm image
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void act(reapSandboxes(token).then((r) => toast.message(`Reaped ${r.reaped} VM(s)`)))}
          >
            <Trash2Icon /> Reap orphans
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={data.hosts.length === 0}
            onClick={() => void act(stopAllHosts(token), "Stopped all hosts")}
          >
            <PowerIcon /> Stop all
          </Button>
          <Button variant="ghost" size="sm" onClick={reload}>
            <RefreshCwIcon /> Refresh
          </Button>
        </div>
      </div>

      {data.hosts.length === 0 ? (
        <EmptyState icon={PowerIcon} title="No hosts running" description="Agent hosts spin up on the first chat and idle-reap after inactivity." />
      ) : (
        <AdminTable
          head={
            <tr>
              <Th>Agent</Th>
              <Th>PID</Th>
              <Th>Origin</Th>
              <Th>Uptime</Th>
              <Th>Idle</Th>
              <Th className="text-right">Action</Th>
            </tr>
          }
        >
          {data.hosts.map((h) => (
            <tr key={h.agentId} className="hover:bg-muted/30">
              <Td className="font-medium">{h.agentName ?? h.agentId}</Td>
              <Td className="tabular-nums text-muted-foreground">{h.pid ?? "—"}</Td>
              <Td className="font-mono text-xs text-muted-foreground">{h.origin}</Td>
              <Td className="tabular-nums">{fmtUptime(h.uptimeMs)}</Td>
              <Td className="tabular-nums text-muted-foreground">{fmtUptime(h.idleMs)}</Td>
              <Td className="text-right">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void act(stopHost(token, h.agentId), "Host stopped")}
                >
                  <PowerIcon /> Stop
                </Button>
              </Td>
            </tr>
          ))}
        </AdminTable>
      )}

      {data.starting.length > 0 ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Cold-starting:</span>
          {data.starting.map((id) => (
            <Badge key={id} variant="ghost" className="bg-status-starting/15 text-status-starting">
              {id}
            </Badge>
          ))}
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Active turns ({data.activeTurns.length})
        </h3>
        {data.activeTurns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No turns running right now.</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {data.activeTurns.map((chatId) => (
              <li key={chatId} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="font-mono text-xs">{chatId}</span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void act(cancelTurn(token, chatId), "Turn cancelled")}
                >
                  <XIcon /> Cancel
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
