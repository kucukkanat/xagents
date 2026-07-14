import { describe, expect, test } from "bun:test";
import { chunkText } from "./chunk";
import { extractText } from "./extract";
import { ingestDocument } from "./index";

describe("chunkText", () => {
  test("empty input yields no chunks", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  test("short text is a single chunk", () => {
    const chunks = chunkText("Hello world.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ ord: 0, text: "Hello world." });
  });

  test("splits long text into ordered chunks within maxChars (plus overlap)", () => {
    const para = "word ".repeat(400).trim(); // ~2000 chars
    const chunks = chunkText(`${para}\n\n${para}`, { maxChars: 500, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => expect(c.ord).toBe(i));
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(600);
  });

  test("hard-splits a single oversized paragraph", () => {
    const chunks = chunkText("x".repeat(2500), { maxChars: 1000, overlap: 0 });
    expect(chunks.length).toBe(3);
  });
});

describe("extractText", () => {
  test("decodes markdown/text bytes", async () => {
    const bytes = new TextEncoder().encode("# Title\n\nBody text");
    const res = await extractText({ filename: "a.md", mime: "text/markdown", bytes });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toContain("Body text");
  });
});

describe("ingestDocument", () => {
  test("extracts + chunks a text file", async () => {
    const bytes = new TextEncoder().encode("Para one.\n\nPara two.");
    const res = await ingestDocument({ filename: "n.txt", mime: "text/plain", bytes });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.text).toContain("Para one");
      expect(res.value.chunks.length).toBeGreaterThanOrEqual(1);
    }
  });
});
