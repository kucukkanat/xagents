import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The canonical zero-state: a named headline, a sentence of context, one primary
 * action, and an optional richer slot (`children`) for suggestion/template cards.
 * `tone="brand"` lights it with the signature aurora + a pulsing accent icon for
 * first-run / hero moments; the default stays quiet for routine empty lists.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  children,
  tone = "muted",
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  tone?: "muted" | "brand";
  className?: string;
}) {
  const brand = tone === "brand";
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center gap-4 overflow-hidden rounded-xl border border-dashed px-6 py-16 text-center",
        "animate-in fade-in-0 zoom-in-95 duration-500 ease-out",
        brand && "border-brand-border/60",
        className,
      )}
    >
      {brand ? (
        <div aria-hidden className="bg-aurora pointer-events-none absolute inset-0 opacity-80" />
      ) : null}
      <div
        className={cn(
          "relative flex size-12 items-center justify-center rounded-full",
          brand ? "text-brand" : "bg-muted text-muted-foreground",
        )}
        style={brand ? { background: "color-mix(in oklch, var(--brand) 14%, transparent)" } : undefined}
      >
        {brand ? (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full animate-glow-pulse"
            style={{ background: "color-mix(in oklch, var(--brand) 12%, transparent)" }}
          />
        ) : null}
        <Icon className="relative size-5" />
      </div>
      <div className="relative space-y-1.5">
        <p className="text-base font-semibold tracking-tight">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="relative">{action}</div> : null}
      {children ? <div className="relative w-full">{children}</div> : null}
    </div>
  );
}
