import { Fragment } from "react";
import { highlightSegments, type MatchRange } from "@xagents/search";
import { cn } from "@/lib/utils";

/**
 * Renders `text` with the matched character `ranges` wrapped in a subtle
 * brand-tinted `<mark>`. With no ranges it's just the text, so callers can pass
 * a result's match ranges unconditionally.
 */
export function Highlight({
  text,
  ranges,
  className,
}: {
  text: string;
  ranges: readonly MatchRange[];
  className?: string;
}) {
  const segments = highlightSegments(text, ranges);
  return (
    <>
      {segments.map((segment, i) =>
        segment.match ? (
          <mark
            key={i}
            className={cn(
              "rounded-[3px] bg-brand-subtle font-medium text-brand-muted-foreground",
              className,
            )}
          >
            {segment.text}
          </mark>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
