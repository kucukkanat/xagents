import { cn } from "@/lib/utils";

/**
 * The xagents glyph: a rounded "squircle" carrying an orbiting-spark motif —
 * a central node (the agent) with an orbit crossing it, echoing the microVM /
 * autonomy theme. Uses a per-instance gradient so multiple marks can coexist.
 */
export function BrandMark({
  className,
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}) {
  const gid = "brandmark-grad";
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="xagents"
      className={cn("size-8", className)}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--brand)" />
          <stop offset="100%" stopColor="var(--brand-2)" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="31" height="31" rx="9" fill={`url(#${gid})`} />
      <g
        fill="none"
        stroke="var(--brand-foreground)"
        strokeWidth="1.9"
        strokeLinecap="round"
        opacity="0.96"
      >
        {/* orbit */}
        <ellipse
          cx="16"
          cy="16"
          rx="9.5"
          ry="4.4"
          transform="rotate(-30 16 16)"
          className={animated ? "origin-center animate-[float_7s_ease-in-out_infinite]" : undefined}
        />
        {/* the agent node */}
        <circle cx="16" cy="16" r="3.1" fill="var(--brand-foreground)" stroke="none" />
      </g>
    </svg>
  );
}

/** The glyph paired with the gradient wordmark — used in the sidebar header. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <BrandMark className="size-7" />
      <span className="text-gradient-brand animate-gradient text-sm font-semibold tracking-tight">
        xagents
      </span>
    </div>
  );
}
