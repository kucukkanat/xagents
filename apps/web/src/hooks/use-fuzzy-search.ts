import { useMemo } from "react";
import { createSearcher, searchWith, type SearchKey, type SearchResult } from "@xagents/search";

/**
 * Fuzzy-filter an in-memory list, recomputed only when the items or query
 * change. The Fuse index is built once per item set (not per keystroke). An
 * empty query returns every item in its original order, so a cleared box shows
 * the untouched list.
 *
 * Pass a **stable** `keys` reference (a module-level constant) — a fresh array
 * literal on every render would rebuild the index each time.
 */
export function useFuzzySearch<T>(
  items: readonly T[],
  query: string,
  keys: readonly SearchKey[],
): readonly SearchResult<T>[] {
  const searcher = useMemo(() => createSearcher(items, keys), [items, keys]);
  return useMemo(() => searchWith(searcher, items, query), [searcher, items, query]);
}
