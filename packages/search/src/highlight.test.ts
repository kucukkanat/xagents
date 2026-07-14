import { describe, expect, test } from "bun:test";
import { highlightSegments, type Segment } from "./highlight";

const text = (segments: readonly Segment[]): string => segments.map((s) => s.text).join("");
const matched = (segments: readonly Segment[]): string =>
  segments
    .filter((s) => s.match)
    .map((s) => s.text)
    .join("|");

describe("highlightSegments", () => {
  test("empty text yields no segments", () => {
    expect(highlightSegments("", [[0, 2]])).toEqual([]);
  });

  test("no ranges yields a single unmatched segment", () => {
    expect(highlightSegments("Research Bot", [])).toEqual([{ text: "Research Bot", match: false }]);
  });

  test("a mid-string range splits into before / match / after", () => {
    const segments = highlightSegments("Deep Research Bot", [[5, 12]]);
    expect(segments).toEqual([
      { text: "Deep ", match: false },
      { text: "Research", match: true },
      { text: " Bot", match: false },
    ]);
  });

  test("a range at the start has no leading unmatched segment", () => {
    const segments = highlightSegments("Research", [[0, 3]]);
    expect(segments).toEqual([
      { text: "Rese", match: true },
      { text: "arch", match: false },
    ]);
  });

  test("a range at the end has no trailing unmatched segment", () => {
    const segments = highlightSegments("Research", [[4, 7]]);
    expect(segments).toEqual([
      { text: "Rese", match: false },
      { text: "arch", match: true },
    ]);
  });

  test("full coverage yields one matched segment", () => {
    expect(highlightSegments("Bot", [[0, 2]])).toEqual([{ text: "Bot", match: true }]);
  });

  test("adjacent inclusive ranges merge", () => {
    const segments = highlightSegments("abcdef", [
      [0, 2],
      [3, 4],
    ]);
    expect(matched(segments)).toBe("abcde");
    expect(text(segments)).toBe("abcdef");
  });

  test("overlapping ranges merge", () => {
    const segments = highlightSegments("abcdef", [
      [0, 3],
      [2, 4],
    ]);
    expect(matched(segments)).toBe("abcde");
  });

  test("unsorted ranges are ordered before segmenting", () => {
    const segments = highlightSegments("abcdef", [
      [4, 5],
      [0, 1],
    ]);
    expect(segments).toEqual([
      { text: "ab", match: true },
      { text: "cd", match: false },
      { text: "ef", match: true },
    ]);
  });

  test("out-of-bounds ends are clamped to the string", () => {
    expect(highlightSegments("abc", [[1, 99]])).toEqual([
      { text: "a", match: false },
      { text: "bc", match: true },
    ]);
  });

  test("wholly out-of-range or inverted ranges are dropped", () => {
    expect(highlightSegments("abc", [[5, 9]])).toEqual([{ text: "abc", match: false }]);
    expect(highlightSegments("abc", [[2, 1]])).toEqual([{ text: "abc", match: false }]);
    expect(highlightSegments("abc", [[-3, -1]])).toEqual([{ text: "abc", match: false }]);
  });

  test("negative start is clamped to zero", () => {
    expect(highlightSegments("abc", [[-2, 1]])).toEqual([
      { text: "ab", match: true },
      { text: "c", match: false },
    ]);
  });
});
