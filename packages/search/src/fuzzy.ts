import Fuse from "fuse.js";
import type { FuseOptionKeyObject, FuseResult, FuseResultMatch, IFuseOptions } from "fuse.js";

/**
 * A `[start, end]` **inclusive** character range within a matched string —
 * the shape Fuse.js reports and what the highlighter consumes.
 */
export type MatchRange = readonly [number, number];

/** Matched character ranges for a single searched field (e.g. `name`). */
export interface FieldMatch {
  readonly key: string;
  readonly ranges: readonly MatchRange[];
}

/** One ranked hit: the original item plus where the query matched, for highlighting. */
export interface SearchResult<T> {
  readonly item: T;
  /** Fuse relevance score in `[0, 1]` (0 = perfect); `null` for the empty-query identity pass. */
  readonly score: number | null;
  readonly matches: readonly FieldMatch[];
}

/** A field to search, with an optional relevance weight (higher = counts more). */
export interface SearchKey {
  readonly name: string;
  readonly weight?: number;
}

/**
 * Default matching strictness. `0` demands an exact substring; `1` matches
 * anything. `0.3` keeps results predictable — partial/word matches land, but
 * outright misspellings ("reserch" → "Research") do not. Tune per call site if
 * a surface wants to be more or less forgiving.
 */
export const DEFAULT_THRESHOLD = 0.3;

/**
 * Build the Fuse options we use everywhere. `ignoreLocation` makes a match
 * anywhere in the string count equally (so "research" finds "Deep Research
 * Bot"); `includeMatches` gives us the ranges the highlighter needs.
 */
function buildOptions<T>(
  keys: readonly SearchKey[],
  overrides: Partial<IFuseOptions<T>> | undefined,
): IFuseOptions<T> {
  const fuseKeys = keys.map(
    (key): FuseOptionKeyObject<T> =>
      key.weight === undefined ? { name: key.name } : { name: key.name, weight: key.weight },
  );
  return {
    includeScore: true,
    includeMatches: true,
    ignoreLocation: true,
    threshold: DEFAULT_THRESHOLD,
    minMatchCharLength: 1,
    keys: fuseKeys,
    ...overrides,
  };
}

/**
 * Create a reusable searcher for a fixed item set. Prefer this over
 * {@link fuzzySearch} when the same list is queried repeatedly (e.g. per
 * keystroke) — building the index once and calling {@link searchWith} avoids
 * re-indexing on every query.
 */
export function createSearcher<T>(
  items: readonly T[],
  keys: readonly SearchKey[],
  options?: Partial<IFuseOptions<T>>,
): Fuse<T> {
  return new Fuse([...items], buildOptions(keys, options));
}

function toFieldMatch(match: FuseResultMatch): FieldMatch {
  return {
    key: match.key ?? "",
    ranges: match.indices.map((range) => [range[0], range[1]] as MatchRange),
  };
}

function toResult<T>(result: FuseResult<T>): SearchResult<T> {
  return {
    item: result.item,
    score: result.score ?? null,
    // Drop keyless matches — without a key we can't map ranges back to a field.
    matches: (result.matches ?? []).map(toFieldMatch).filter((match) => match.key !== ""),
  };
}

/**
 * Query a searcher built by {@link createSearcher}. An empty/whitespace query
 * returns every item in its original order (identity), so a cleared search box
 * shows the full, unshuffled list.
 */
export function searchWith<T>(
  searcher: Fuse<T>,
  items: readonly T[],
  query: string,
): readonly SearchResult<T>[] {
  const trimmed = query.trim();
  if (trimmed === "") return items.map((item) => ({ item, score: null, matches: [] }));
  return searcher.search(trimmed).map(toResult);
}

/** One-shot fuzzy search: index `items` and query them in a single call. */
export function fuzzySearch<T>(
  items: readonly T[],
  query: string,
  keys: readonly SearchKey[],
  options?: Partial<IFuseOptions<T>>,
): readonly SearchResult<T>[] {
  const trimmed = query.trim();
  if (trimmed === "") return items.map((item) => ({ item, score: null, matches: [] }));
  return createSearcher(items, keys, options).search(trimmed).map(toResult);
}

/** The matched ranges for one field of a result, or `[]` if that field didn't match. */
export function rangesForKey<T>(result: SearchResult<T>, key: string): readonly MatchRange[] {
  for (const match of result.matches) {
    if (match.key === key) return match.ranges;
  }
  return [];
}
