import type { ReactNode } from "react";
import type { RunStatus } from "@xagents/core";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// --- formatting helpers -----------------------------------------------------
export const fmtInt = (n: number): string => new Intl.NumberFormat("en").format(Math.round(n));
export const fmtUsd = (n: number): string =>
  n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
export const fmtMs = (ms: number | null): string => {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} m`;
};
export const fmtTokens = (n: number | null): string => (n === null ? "—" : fmtInt(n));
export const fmtUptime = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
};

/** A labeled metric tile — the overview's KPI row. */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint !== undefined ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * A minimal, dependency-free time-series sparkline (area + line) driven by the
 * design-system chart tokens. Stretches to its container; stroke stays crisp via
 * a non-scaling vector effect.
 */
export function TimeSeriesChart({
  points,
  color = "var(--color-chart-1)",
  height = 96,
}: {
  points: readonly { readonly ts: string; readonly value: number }[];
  color?: string;
  height?: number;
}) {
  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground"
        style={{ height }}
      >
        No data in this window yet
      </div>
    );
  }
  const W = 600;
  const H = height;
  const pad = 4;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number): number =>
    points.length === 1 ? W / 2 : pad + (i / (points.length - 1)) * (W - 2 * pad);
  const y = (v: number): number => pad + (1 - (v - min) / span) * (H - 2 * pad);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role="img"
      aria-label="time series"
    >
      <path d={area} fill={color} opacity={0.12} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

const RUN_STATUS_VARIANT: Record<RunStatus, string> = {
  completed: "bg-status-running/15 text-status-running",
  error: "bg-status-error/15 text-status-error",
  cancelled: "bg-muted text-muted-foreground",
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge variant="ghost" className={cn("capitalize", RUN_STATUS_VARIANT[status])}>
      {status}
    </Badge>
  );
}

/** Bordered, horizontally-scrollable table shell for admin lists. */
export function AdminTable({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
          {head}
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={cn("px-3 py-2 font-medium", className)}>{children}</th>
);
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cn("px-3 py-2 align-middle", className)}>{children}</td>
);
