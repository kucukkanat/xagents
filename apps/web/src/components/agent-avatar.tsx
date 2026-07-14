import { cn } from "@/lib/utils";

/** First letters of the first two words — the agent's monogram. */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "AI";

export type AgentActivity = "idle" | "thinking" | "streaming";

/**
 * An agent's identity chip: a conic violet→cyan gradient ring around a monogram.
 * The ring softly pulses while the agent is thinking or streaming, then settles.
 */
export function AgentAvatar({
  name,
  status = "idle",
  className,
}: {
  name: string;
  status?: AgentActivity;
  className?: string;
}) {
  const active = status !== "idle";
  const ring = "conic-gradient(from 210deg, var(--brand), var(--brand-2), var(--brand))";
  return (
    <span
      className={cn(
        "relative inline-flex size-8 shrink-0 items-center justify-center rounded-full p-[1.5px]",
        className,
      )}
      style={{ background: ring }}
    >
      {active ? (
        <span
          aria-hidden
          className="absolute -inset-0.5 rounded-full opacity-70 blur-[3px] animate-glow-pulse"
          style={{ background: ring }}
        />
      ) : null}
      <span className="relative flex size-full items-center justify-center rounded-full bg-card text-xs font-semibold text-foreground">
        {initials(name)}
      </span>
    </span>
  );
}
