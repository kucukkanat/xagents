# @xagents/kb

Knowledgebase **ingestion**: turn an uploaded file into indexable text chunks. Storage
and lexical (BM25/FTS5) retrieval live in `@xagents/db` — this package only extracts and
chunks. No embeddings, no vectors (the platform uses lexical search).

## Usage

```ts
import { ingestDocument } from "@xagents/kb";

const bytes = new Uint8Array(await file.arrayBuffer());
const res = await ingestDocument({ filename: file.name, mime: file.type, bytes });
if (!res.ok) throw new Error(res.error.message);

// res.value.chunks: { ord, text }[] — hand to db.knowledgebases.insertChunks(...)
```

- **Extraction** — Markdown/text decode directly; PDFs via [`unpdf`](https://github.com/unjs/unpdf);
  unknown types fall back to a UTF-8 decode.
- **Chunking** — overlapping, paragraph-aware windows (`maxChars` default 1200,
  `overlap` 150), hard-splitting only paragraphs that exceed the limit.

Lower-level `extractText` and `chunkText` are exported too.
