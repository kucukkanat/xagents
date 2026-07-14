import { describe, expect, test } from "bun:test";
import { chunkText, stitchChunks } from "./chunk";
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

describe("stitchChunks", () => {
  test("empty and singleton inputs", () => {
    expect(stitchChunks([])).toBe("");
    expect(stitchChunks(["solo"])).toBe("solo");
  });

  test("removes the overlap chunkText carries across boundaries", () => {
    // Three paragraphs that force multiple chunks with a 150-char overlap.
    const paras = ["A".repeat(500), "B".repeat(500), "C".repeat(500)];
    const chunks = chunkText(paras.join("\n\n"));
    expect(chunks.length).toBeGreaterThan(1);
    // Reconstruction is the normalized text with no duplicated overlap.
    expect(stitchChunks(chunks.map((c) => c.text))).toBe(paras.join("\n\n"));
  });

  test("round-trips multi-paragraph prose across chunk boundaries", () => {
    // Several normal-sized paragraphs that span multiple overlapping chunks.
    const paras = Array.from(
      { length: 8 },
      (_, i) => `Paragraph ${i}: ${"word ".repeat(30).trim()}.`,
    );
    const text = paras.join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(stitchChunks(chunks.map((c) => c.text))).toBe(text);
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
