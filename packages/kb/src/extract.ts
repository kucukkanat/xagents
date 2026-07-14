import { extractText as pdfExtractText } from "unpdf";
import { type AppError, type Result, appError, err, ok } from "@xagents/core";

export interface RawDocument {
  readonly filename: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

const isPdf = (doc: RawDocument): boolean =>
  doc.mime === "application/pdf" || doc.filename.toLowerCase().endsWith(".pdf");

/**
 * Extract plain text from an uploaded document. Markdown/text decode directly;
 * PDFs go through unpdf. Unknown types fall back to a UTF-8 decode (best effort).
 */
export const extractText = async (doc: RawDocument): Promise<Result<string, AppError>> => {
  if (isPdf(doc)) {
    try {
      const { text } = await pdfExtractText(doc.bytes, { mergePages: true });
      return ok(text);
    } catch (cause) {
      return err(appError("validation", `could not parse PDF "${doc.filename}"`, cause));
    }
  }
  return ok(new TextDecoder().decode(doc.bytes));
};
