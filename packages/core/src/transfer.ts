import { z } from "zod";
import { VisibilitySchema } from "./entities";
import { ReasoningEffortSchema } from "./providers";

/**
 * Contracts for two-way agent transfer: the machine-readable manifest written
 * into an export, and the structured report/log an import produces. Keeping
 * these in `@xagents/core` lets the server (producer) and web (consumer) agree
 * on one shape.
 */

/** Root manifest filename embedded in an xagents export archive. */
export const EXPORT_MANIFEST_FILE = "xagents.agent.json";
/** Versioned schema tag; bump when the manifest shape changes incompatibly. */
export const EXPORT_SCHEMA_ID = "xagents/agent-export@1";

const ExportSkillRef = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  /** Directory (archive-relative) holding this skill's SKILL.md + resources. */
  path: z.string().min(1),
});

const ExportDocumentRef = z.object({
  filename: z.string().min(1),
  mime: z.string().min(1),
  /** Archive-relative path to the document's extracted-text file. */
  path: z.string().min(1),
});

const ExportKnowledgebaseRef = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  documents: z.array(ExportDocumentRef).default([]),
});

/**
 * Authoritative, lossless description of an exported agent. When present in an
 * archive, import trusts this over any best-effort parse of the eve sources.
 */
export const AgentExportManifest = z.object({
  schema: z.literal(EXPORT_SCHEMA_ID),
  agent: z.object({
    name: z.string().min(1),
    description: z.string().default(""),
    /** Archive-relative path to the agent's instructions markdown. */
    instructionsPath: z.string().min(1),
    modelProvider: z.string().min(1),
    modelId: z.string().min(1),
    reasoning: ReasoningEffortSchema,
    visibility: VisibilitySchema,
  }),
  skills: z.array(ExportSkillRef).default([]),
  knowledgebases: z.array(ExportKnowledgebaseRef).default([]),
});
export type AgentExportManifest = z.infer<typeof AgentExportManifest>;

/** How an import archive was recognized. */
export type ImportSource = "xagents-export" | "eve-project" | "unknown";

export type ImportSeverity = "info" | "warning" | "error";

/** One line in the import's audit trail. */
export interface ImportLogEntry {
  readonly severity: ImportSeverity;
  /** Coarse stage this happened in, e.g. `unpack`, `agent`, `skill:foo`. */
  readonly step: string;
  readonly message: string;
}

export interface ImportSummary {
  readonly skills: number;
  readonly knowledgebases: number;
  readonly documents: number;
  readonly chunks: number;
}

/**
 * The complete outcome of an import attempt. Always returned to the client —
 * even on failure — so the user sees exactly what was validated, what actions
 * were taken, and what (if anything) was written.
 */
export interface ImportReport {
  /** True when no `error`-severity entries were recorded. */
  readonly ok: boolean;
  /** True only when rows were actually persisted (never on dry-run/failure). */
  readonly committed: boolean;
  readonly source: ImportSource;
  readonly agentId: string | null;
  readonly agentName: string | null;
  readonly summary: ImportSummary;
  readonly log: readonly ImportLogEntry[];
}
