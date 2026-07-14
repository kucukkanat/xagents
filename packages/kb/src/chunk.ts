export interface ChunkOptions {
  /** Target maximum characters per chunk. */
  readonly maxChars?: number;
  /** Characters of overlap carried between adjacent chunks (aids recall). */
  readonly overlap?: number;
}

export interface Chunk {
  readonly ord: number;
  readonly text: string;
}

const DEFAULTS = { maxChars: 1200, overlap: 150 } as const;

/**
 * Split text into overlapping chunks, preferring paragraph boundaries and
 * hard-splitting only paragraphs that exceed `maxChars`. Overlap is applied
 * across chunk boundaries so a passage spanning a boundary is still findable.
 */
export const chunkText = (input: string, options: ChunkOptions = {}): Chunk[] => {
  const maxChars = options.maxChars ?? DEFAULTS.maxChars;
  const overlap = Math.min(options.overlap ?? DEFAULTS.overlap, Math.floor(maxChars / 2));

  const normalized = input.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (normalized.length === 0) return [];

  const paragraphs = normalized.split(/\n{2,}/).flatMap((p) => splitOversized(p.trim(), maxChars));

  const chunks: string[] = [];
  let current = "";
  for (const part of paragraphs) {
    if (part.length === 0) continue;
    if (current.length === 0) {
      current = part;
    } else if (current.length + 2 + part.length <= maxChars) {
      current = `${current}\n\n${part}`;
    } else {
      chunks.push(current);
      current = overlap > 0 ? `${current.slice(-overlap)}\n\n${part}` : part;
    }
  }
  if (current.length > 0) chunks.push(current);

  return chunks.map((text, ord) => ({ ord, text }));
};

/**
 * Reassemble ordered chunk texts back into a single document, removing the
 * overlap {@link chunkText} carries across boundaries. For each successive
 * chunk we drop the longest prefix that already appears as a suffix of the
 * text so far, so overlapping passages aren't duplicated. This is a faithful
 * text reconstruction — not necessarily byte-identical to the original file,
 * since chunking normalizes whitespace first.
 */
export const stitchChunks = (chunks: readonly string[]): string => {
  let out = "";
  for (const chunk of chunks) {
    if (out.length === 0) {
      out = chunk;
      continue;
    }
    let overlap = 0;
    for (let n = Math.min(out.length, chunk.length); n > 0; n--) {
      if (out.endsWith(chunk.slice(0, n))) {
        overlap = n;
        break;
      }
    }
    out += chunk.slice(overlap);
  }
  return out;
};

/** Hard-split a single paragraph longer than maxChars into char windows. */
const splitOversized = (paragraph: string, maxChars: number): string[] => {
  if (paragraph.length <= maxChars) return [paragraph];
  const out: string[] = [];
  for (let i = 0; i < paragraph.length; i += maxChars) {
    out.push(paragraph.slice(i, i + maxChars));
  }
  return out;
};
