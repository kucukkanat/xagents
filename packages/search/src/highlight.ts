import type { MatchRange } from "./fuzzy";

/** A run of text that either did (`match: true`) or didn't participate in a match. */
export interface Segment {
  readonly text: string;
  readonly match: boolean;
}

/**
 * Normalize raw match ranges: clamp to the string bounds, drop empties, then
 * sort and merge overlapping/adjacent ranges into a minimal, ordered set.
 * Fuse ranges are inclusive, so `[0,2]` and `[3,4]` are adjacent and merge.
 */
function normalizeRanges(ranges: readonly MatchRange[], length: number): readonly MatchRange[] {
  const clamped: MatchRange[] = [];
  for (const [rawStart, rawEnd] of ranges) {
    const start = Math.max(0, rawStart);
    const end = Math.min(length - 1, rawEnd);
    if (start <= end) clamped.push([start, end]);
  }
  clamped.sort((a, b) => a[0] - b[0]);

  const merged: MatchRange[] = [];
  for (const range of clamped) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 1) {
      merged[merged.length - 1] = [last[0], Math.max(last[1], range[1])];
    } else {
      merged.push([range[0], range[1]]);
    }
  }
  return merged;
}

/**
 * Split `text` into alternating matched / unmatched {@link Segment}s so a UI
 * can wrap the matched runs (e.g. in `<mark>`). Returns a single unmatched
 * segment when nothing matches, and `[]` for empty text.
 */
export function highlightSegments(text: string, ranges: readonly MatchRange[]): readonly Segment[] {
  if (text === "") return [];
  const merged = normalizeRanges(ranges, text.length);
  if (merged.length === 0) return [{ text, match: false }];

  const segments: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end + 1), match: true });
    cursor = end + 1;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}
