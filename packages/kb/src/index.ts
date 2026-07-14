import { type AppError, type Result, ok } from "@xagents/core";
import { type Chunk, type ChunkOptions, chunkText } from "./chunk";
import { type RawDocument, extractText } from "./extract";

export type { RawDocument } from "./extract";
export type { Chunk, ChunkOptions } from "./chunk";
export { extractText } from "./extract";
export { chunkText, stitchChunks } from "./chunk";

export interface IngestedDocument {
  readonly text: string;
  readonly chunks: readonly Chunk[];
}

/**
 * Turn an uploaded file into indexable chunks: extract text, then chunk it.
 * The server persists the chunks via `@xagents/db` (which owns the FTS index).
 */
export const ingestDocument = async (
  doc: RawDocument,
  options?: ChunkOptions,
): Promise<Result<IngestedDocument, AppError>> => {
  const extracted = await extractText(doc);
  if (!extracted.ok) return extracted;
  return ok({ text: extracted.value, chunks: chunkText(extracted.value, options) });
};
