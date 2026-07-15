import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AdminEvent } from "@xagents/core";
import { streamAdmin } from "@/lib/admin-api";
import { useAdminToken } from "@/components/admin-guard";

interface SeriesPoint {
  readonly ts: string;
  readonly value: number;
}

export interface AdminLive {
  /** Latest gauge snapshot, keyed by metric name. */
  readonly metrics: Readonly<Record<string, number>>;
  /** Rolling client-side history per metric (recent samples) for live sparklines. */
  readonly series: Readonly<Record<string, readonly SeriesPoint[]>>;
  /** Recent lifecycle/audit events, newest first. */
  readonly events: readonly AdminEvent[];
  readonly connected: boolean;
}

const EMPTY: AdminLive = { metrics: {}, series: {}, events: [], connected: false };
const AdminLiveContext = createContext<AdminLive>(EMPTY);

export const useAdminLive = (): AdminLive => useContext(AdminLiveContext);

const MAX_POINTS = 120; // ~30 min at a 15s sample interval
const MAX_EVENTS = 100;

/** Opens a single admin SSE connection and shares its live state with all tabs. */
export function AdminLiveProvider({ children }: { children: ReactNode }) {
  const token = useAdminToken();
  const [live, setLive] = useState<AdminLive>(EMPTY);

  useEffect(() => {
    const ctrl = new AbortController();
    let active = true;
    void (async () => {
      try {
        for await (const ev of streamAdmin(token, ctrl.signal)) {
          if (!active) break;
          if (ev.type === "sample") {
            setLive((prev) => {
              const series: Record<string, SeriesPoint[]> = {};
              for (const [k, v] of Object.entries(ev.metrics)) {
                const arr = [...(prev.series[k] ?? []), { ts: ev.ts, value: v }];
                series[k] = arr.slice(-MAX_POINTS);
              }
              return { metrics: ev.metrics, series, events: prev.events, connected: true };
            });
          } else {
            setLive((prev) => ({
              ...prev,
              events: [ev.event, ...prev.events].slice(0, MAX_EVENTS),
            }));
          }
        }
      } catch {
        // aborted or stream closed
      } finally {
        if (active) setLive((prev) => ({ ...prev, connected: false }));
      }
    })();
    return () => {
      active = false;
      ctrl.abort();
    };
  }, [token]);

  return <AdminLiveContext value={live}>{children}</AdminLiveContext>;
}
