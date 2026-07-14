import {
  appError,
  err,
  newId,
  ok,
  type AppError,
  type CreateKnowledgebaseInput,
  type KbDocument,
  type KbDocumentId,
  type KbSearchHit,
  type Knowledgebase,
  type KnowledgebaseId,
  type Result,
  type UserId,
} from "@xagents/core";
import { nowIso, slugify, toFtsMatch } from "../helpers";
import {
  DOC_SELECT,
  KB_SELECT,
  mapKbDocumentRow,
  mapKbSearchRow,
  mapKnowledgebaseRow,
  type KbDocumentRow,
  type KbSearchRow,
  type KnowledgebaseRow,
} from "../mappers";
import type { Sqlite } from "../sqlite";

export interface NewDocument {
  readonly filename: string;
  readonly mime: string;
  readonly byteLength: number;
}

export interface NewChunk {
  readonly ord: number;
  readonly text: string;
}

export interface KnowledgebasesRepo {
  readonly create: (ownerId: UserId, input: CreateKnowledgebaseInput) => Knowledgebase;
  readonly get: (id: KnowledgebaseId) => Result<Knowledgebase, AppError>;
  readonly list: (ownerId: UserId) => Knowledgebase[];
  readonly remove: (id: KnowledgebaseId) => void;
  readonly clone: (sourceId: KnowledgebaseId, newOwnerId: UserId) => Result<Knowledgebase, AppError>;
  readonly addDocument: (kbId: KnowledgebaseId, doc: NewDocument) => KbDocument;
  readonly listDocuments: (kbId: KnowledgebaseId) => KbDocument[];
  /** A document's chunk texts in `ord` order (raw; stitch to reconstruct). */
  readonly documentChunks: (docId: KbDocumentId) => string[];
  readonly removeDocument: (docId: KbDocumentId) => void;
  readonly insertChunks: (
    kbId: KnowledgebaseId,
    docId: KbDocumentId,
    filename: string,
    chunks: readonly NewChunk[],
  ) => void;
  readonly searchChunks: (kbIds: readonly string[], query: string, limit: number) => KbSearchHit[];
}

interface RawChunkRow {
  readonly id: string;
  readonly document_id: string;
  readonly ord: number;
  readonly text: string;
}
interface RawDocRow {
  readonly id: string;
  readonly filename: string;
  readonly mime: string;
  readonly byte_length: number;
  readonly created_at: string;
}

export const createKnowledgebasesRepo = (db: Sqlite): KnowledgebasesRepo => {
  const getRow = db.prepare<[string], KnowledgebaseRow>(`${KB_SELECT} WHERE k.id = ?`);
  const listRows = db.prepare<[string], KnowledgebaseRow>(
    `${KB_SELECT} WHERE k.owner_id = ? ORDER BY k.updated_at DESC`,
  );
  const insertKb = db.prepare(
    `INSERT INTO knowledgebases
       (id, owner_id, name, slug, description, visibility, forked_from, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const deleteKb = db.prepare("DELETE FROM knowledgebases WHERE id = ?");
  // FTS is standalone (no cascade), so its rows are deleted explicitly.
  const deleteKbFts = db.prepare("DELETE FROM kb_chunks_fts WHERE knowledgebase_id = ?");

  const docByKb = db.prepare<[string], KbDocumentRow>(
    `${DOC_SELECT} WHERE d.knowledgebase_id = ? ORDER BY d.created_at ASC`,
  );
  const insertDoc = db.prepare(
    `INSERT INTO kb_documents (id, knowledgebase_id, filename, mime, byte_length, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const deleteDoc = db.prepare("DELETE FROM kb_documents WHERE id = ?");
  const deleteDocFts = db.prepare("DELETE FROM kb_chunks_fts WHERE document_id = ?");

  const insertChunk = db.prepare(
    "INSERT INTO kb_chunks (id, knowledgebase_id, document_id, ord, text) VALUES (?, ?, ?, ?, ?)",
  );
  const insertChunkFts = db.prepare(
    `INSERT INTO kb_chunks_fts (text, chunk_id, knowledgebase_id, document_id, filename, ord)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  // For cloning: read a KB's documents and chunks verbatim.
  const rawDocsByKb = db.prepare<[string], RawDocRow>(
    "SELECT id, filename, mime, byte_length, created_at FROM kb_documents WHERE knowledgebase_id = ?",
  );
  const rawChunksByDoc = db.prepare<[string], RawChunkRow>(
    "SELECT id, document_id, ord, text FROM kb_chunks WHERE document_id = ? ORDER BY ord ASC",
  );

  const create = (ownerId: UserId, input: CreateKnowledgebaseInput): Knowledgebase => {
    const id = newId("KnowledgebaseId");
    const now = nowIso();
    insertKb.run(id, ownerId, input.name, slugify(input.name), input.description, input.visibility, null, now, now);
    return {
      id,
      ownerId,
      name: input.name,
      slug: slugify(input.name),
      description: input.description,
      visibility: input.visibility,
      forkedFrom: null,
      documentCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  };

  const get = (id: KnowledgebaseId): Result<Knowledgebase, AppError> => {
    const row = getRow.get(id);
    return row === undefined
      ? err(appError("not_found", `knowledgebase ${id} not found`))
      : ok(mapKnowledgebaseRow(row));
  };

  const list = (ownerId: UserId): Knowledgebase[] =>
    listRows.all(ownerId).map(mapKnowledgebaseRow);

  const remove = (id: KnowledgebaseId): void => {
    db.transaction(() => {
      deleteKbFts.run(id);
      deleteKb.run(id); // cascades kb_documents + kb_chunks
    })();
  };

  const addDocument = (kbId: KnowledgebaseId, doc: NewDocument): KbDocument => {
    const id = newId("KbDocumentId");
    const now = nowIso();
    insertDoc.run(id, kbId, doc.filename, doc.mime, doc.byteLength, now);
    return {
      id,
      knowledgebaseId: kbId,
      filename: doc.filename,
      mime: doc.mime,
      byteLength: doc.byteLength,
      chunkCount: 0,
      createdAt: now,
    };
  };

  const listDocuments = (kbId: KnowledgebaseId): KbDocument[] =>
    docByKb.all(kbId).map(mapKbDocumentRow);

  const documentChunks = (docId: KbDocumentId): string[] =>
    rawChunksByDoc.all(docId).map((c) => c.text);

  const removeDocument = (docId: KbDocumentId): void => {
    db.transaction(() => {
      deleteDocFts.run(docId);
      deleteDoc.run(docId); // cascades kb_chunks
    })();
  };

  const insertChunks = (
    kbId: KnowledgebaseId,
    docId: KbDocumentId,
    filename: string,
    chunks: readonly NewChunk[],
  ): void => {
    db.transaction(() => {
      for (const chunk of chunks) {
        const chunkId = newId("KbChunkId");
        insertChunk.run(chunkId, kbId, docId, chunk.ord, chunk.text);
        insertChunkFts.run(chunk.text, chunkId, kbId, docId, filename, chunk.ord);
      }
    })();
  };

  const searchChunks = (
    kbIds: readonly string[],
    query: string,
    limit: number,
  ): KbSearchHit[] => {
    const match = toFtsMatch(query);
    if (match === undefined || kbIds.length === 0 || limit <= 0) return [];
    const placeholders = kbIds.map(() => "?").join(", ");
    // ORDER BY bm25 ASC = best matches first (bm25 is more-negative-is-better);
    // score negates it so larger = more relevant, matching KbSearchHit.score.
    const sql = `SELECT chunk_id, document_id, filename, CAST(ord AS INTEGER) AS ord, text,
        -bm25(kb_chunks_fts) AS score
      FROM kb_chunks_fts
      WHERE kb_chunks_fts MATCH ? AND knowledgebase_id IN (${placeholders})
      ORDER BY bm25(kb_chunks_fts)
      LIMIT ?`;
    try {
      const rows = db.prepare<unknown[], KbSearchRow>(sql).all(match, ...kbIds, limit);
      return rows.map(mapKbSearchRow);
    } catch {
      // Defensive: malformed FTS syntax should degrade to "no hits", not throw.
      return [];
    }
  };

  const clone = (
    sourceId: KnowledgebaseId,
    newOwnerId: UserId,
  ): Result<Knowledgebase, AppError> => {
    const src = getRow.get(sourceId);
    if (src === undefined) return err(appError("not_found", `knowledgebase ${sourceId} not found`));

    return ok(
      db.transaction((): Knowledgebase => {
        const id = newId("KnowledgebaseId");
        const now = nowIso();
        insertKb.run(id, newOwnerId, src.name, src.slug, src.description, src.visibility, sourceId, now, now);

        // Deep-copy documents and their chunks (+ FTS rows) with fresh ids.
        for (const doc of rawDocsByKb.all(sourceId)) {
          const newDocId = newId("KbDocumentId");
          insertDoc.run(newDocId, id, doc.filename, doc.mime, doc.byte_length, now);
          for (const chunk of rawChunksByDoc.all(doc.id)) {
            const chunkId = newId("KbChunkId");
            insertChunk.run(chunkId, id, newDocId, chunk.ord, chunk.text);
            insertChunkFts.run(chunk.text, chunkId, id, newDocId, doc.filename, chunk.ord);
          }
        }
        return { ...mapKnowledgebaseRow(src), id, ownerId: newOwnerId, forkedFrom: sourceId, createdAt: now, updatedAt: now };
      })(),
    );
  };

  return {
    create,
    get,
    list,
    remove,
    clone,
    addDocument,
    listDocuments,
    documentChunks,
    removeDocument,
    insertChunks,
    searchChunks,
  };
};
