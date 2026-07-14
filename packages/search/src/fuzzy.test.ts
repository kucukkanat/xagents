import { describe, expect, test } from "bun:test";
import {
  createSearcher,
  DEFAULT_THRESHOLD,
  fuzzySearch,
  rangesForKey,
  searchWith,
  type SearchKey,
} from "./fuzzy";

interface Item {
  readonly name: string;
  readonly description: string;
}

const items: readonly Item[] = [
  { name: "Research Bot", description: "Summarizes academic papers" },
  { name: "Resume Helper", description: "Improves your CV" },
  { name: "Weather", description: "Research-grade forecasts for sailors" },
];

const KEYS: readonly SearchKey[] = [
  { name: "name", weight: 2 },
  { name: "description", weight: 1 },
];

const names = (results: readonly { item: Item }[]): readonly string[] =>
  results.map((r) => r.item.name);

describe("fuzzySearch", () => {
  test("an empty query returns every item in original order (identity)", () => {
    const results = fuzzySearch(items, "", KEYS);
    expect(names(results)).toEqual(["Research Bot", "Resume Helper", "Weather"]);
    expect(results.every((r) => r.score === null)).toBe(true);
    expect(results.every((r) => r.matches.length === 0)).toBe(true);
  });

  test("a whitespace-only query is treated as empty", () => {
    expect(names(fuzzySearch(items, "   ", KEYS))).toEqual([
      "Research Bot",
      "Resume Helper",
      "Weather",
    ]);
  });

  test("matches substrings and reports them as scored results", () => {
    const results = fuzzySearch(items, "research", KEYS);
    expect(names(results)).toContain("Research Bot");
    expect(results.every((r) => typeof r.score === "number")).toBe(true);
  });

  test("weights a name match above a description-only match", () => {
    // "Research Bot" matches on name (weight 2); "Weather" only on description.
    const results = fuzzySearch(items, "research", KEYS);
    expect(names(results)).toEqual(["Research Bot", "Weather"]);
  });

  test("exposes match ranges on the field that matched", () => {
    const [top] = fuzzySearch(items, "research", KEYS);
    expect(top).toBeDefined();
    if (!top) return;
    const nameRanges = rangesForKey(top, "name");
    expect(nameRanges.length).toBeGreaterThan(0);
    expect(nameRanges[0]?.[0]).toBe(0); // "Research" starts at index 0
    expect(rangesForKey(top, "description")).toEqual([]);
  });

  test("searches secondary fields (description)", () => {
    const results = fuzzySearch(items, "papers", KEYS);
    expect(names(results)).toEqual(["Research Bot"]);
    const [hit] = results;
    expect(hit).toBeDefined();
    if (!hit) return;
    expect(rangesForKey(hit, "description").length).toBeGreaterThan(0);
    expect(rangesForKey(hit, "name")).toEqual([]);
  });

  test("an unrelated query returns nothing (no sloppy typo tolerance)", () => {
    expect(fuzzySearch(items, "zzzzz", KEYS)).toEqual([]);
  });

  test("respects a caller override of the threshold", () => {
    // A stricter threshold of 0 requires an exact substring.
    const exact = fuzzySearch(items, "resu", KEYS, { threshold: 0 });
    expect(names(exact)).toEqual(["Resume Helper"]);
  });
});

describe("createSearcher / searchWith", () => {
  test("reuses one index and matches the one-shot API", () => {
    const searcher = createSearcher(items, KEYS);
    const reused = searchWith(searcher, items, "resume");
    const oneShot = fuzzySearch(items, "resume", KEYS);
    expect(names(reused)).toEqual(names(oneShot));
    expect(names(reused)).toEqual(["Resume Helper"]);
  });

  test("searchWith returns identity for an empty query", () => {
    const searcher = createSearcher(items, KEYS);
    expect(names(searchWith(searcher, items, ""))).toEqual([
      "Research Bot",
      "Resume Helper",
      "Weather",
    ]);
  });
});

describe("rangesForKey", () => {
  test("returns an empty array when the key never matched", () => {
    const result = {
      item: { name: "x", description: "y" },
      score: 0,
      matches: [],
    };
    expect(rangesForKey(result, "name")).toEqual([]);
  });
});

test("DEFAULT_THRESHOLD is the documented predictable default", () => {
  expect(DEFAULT_THRESHOLD).toBe(0.3);
});
