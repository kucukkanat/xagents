import { describe, expect, test } from "bun:test";
import { costUsd } from "./providers";

describe("costUsd", () => {
  test("returns undefined when pricing is unknown", () => {
    expect(costUsd(undefined, 1000, 1000)).toBeUndefined();
  });

  test("computes input + output cost per 1M tokens", () => {
    // 1M input @ $1 + 0.5M output @ $2 = $1 + $1 = $2
    expect(costUsd({ inputPer1M: 1, outputPer1M: 2 }, 1_000_000, 500_000)).toBeCloseTo(2, 9);
  });

  test("zero tokens cost zero", () => {
    expect(costUsd({ inputPer1M: 5, outputPer1M: 9 }, 0, 0)).toBe(0);
  });
});
