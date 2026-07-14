import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentDetail,
  type AppError,
  type ImportLogEntry,
  type ImportReport,
  type ImportSummary,
  type Result,
  type User,
  EXPORT_SCHEMA_ID,
  EXPORT_MANIFEST_FILE,
  appError,
  asId,
  err,
  ok,
} from "@xagents/core";
import { type Db, openDb } from "@xagents/db";
import { chunkText, stitchChunks } from "@xagents/kb";
import {
  type AgentHost,
  type AgentMaterializationSpec,
  type ImportPlan,
  type MaterializedSkill,
  HostSupervisor,
  materializeAgent,
  parseAgentArchive,
  unzipBuffer,
  zipDirectory,
} from "@xagents/eve-runtime";
import type { ServerConfig } from "./env";
import { ChatTurns } from "./turns";

export interface AppContext {
  readonly config: ServerConfig;
  readonly db: Db;
  readonly supervisor: HostSupervisor;
  readonly turns: ChatTurns;
  readonly user: User;
}

/**
 * Any chat still marked "running" in the `turns` table was mid-turn when the
 * *previous* process stopped — the in-memory `ChatTurns` hub that owned it is
 * gone, so it will never emit a terminal event on its own. Finalize each one as
 * a persisted `error` event (surfaced by the existing pendingEvents/streaming
 * flow) so the chat shows a clear "interrupted" state instead of silence.
 */
export const reconcileInterruptedTurns = (db: Db): void => {
  for (const chatId of db.chats.turns.listRunning()) {
    const message = "This turn was interrupted by a server restart before it finished. Please try again.";
    const seq = db.chats.events.list(chatId).length;
    db.chats.events.append(chatId, seq, { type: "error", message });
    db.chats.turns.fail(chatId, message);
  }
};

export const createContext = (config: ServerConfig): AppContext => {
  const db = openDb(config.databasePath);
  reconcileInterruptedTurns(db);
  const supervisor = new HostSupervisor({
    projectDirFor: (agentId) => join(config.agentsWorkspaceDir, agentId),
    // Pass the provider key through to each eve child process.
    env: { DEEPSEEK_API_KEY: config.deepseekApiKey },
    idleMs: 10 * 60_000,
  });
  return { config, db, supervisor, turns: new ChatTurns(), user: db.users.getCurrent() };
};

/** Assemble the materialization spec from already-loaded agent detail. */
const specFromDetail = (ctx: AppContext, detail: AgentDetail): AgentMaterializationSpec => {
  const skills: MaterializedSkill[] = detail.skills.map((skill) => ({
    skill,
    resources: ctx.db.skills.listResources(asId("SkillId", skill.id)),
  }));
  return {
    agent: detail.agent,
    skills,
    hasKnowledgebases: detail.knowledgebases.length > 0,
    internalUrl: ctx.config.internalUrl,
    backendKind: ctx.config.sandboxBackend,
  };
};

/** Rebuild the on-disk eve project for an agent from the current DB state. */
export const materializeFromDb = async (
  ctx: AppContext,
  agentId: string,
): Promise<Result<void, AppError>> => {
  const detail = ctx.db.agents.getDetail(asId("AgentId", agentId));
  if (!detail.ok) return err(detail.error);
  const written = await materializeAgent(
    specFromDetail(ctx, detail.value),
    join(ctx.config.agentsWorkspaceDir, agentId),
  );
  return written.ok ? ok(undefined) : err(written.error);
};

export interface AgentExport {
  /** Suggested download filename, e.g. `my-agent.zip`. */
  readonly filename: string;
  readonly data: Buffer;
}

/** Sanitize a name to a safe path segment (no separators, no leading dots). */
const safeSegment = (name: string): string =>
  name.replace(/[^\w.-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "unnamed";

/** Return `name`, or a `-N`-suffixed variant, that isn't already in `used`. */
const uniqueSegment = (used: Set<string>, name: string): string => {
  if (!used.has(name)) return add(used, name);
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}${ext}`;
    if (!used.has(candidate)) return add(used, candidate);
  }
};
const add = (used: Set<string>, name: string): string => (used.add(name), name);

interface ExportKbRef {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly documents: readonly { readonly filename: string; readonly mime: string; readonly path: string }[];
}

/**
 * Write a self-contained snapshot of the agent's attached knowledgebases under
 * `knowledgebases/<kb>/<doc>.txt` (text reconstructed from stored chunks) and
 * return archive-relative refs for the export manifest. Original upload bytes
 * are not retained by the platform, so exports carry extracted text only.
 */
const writeKnowledgebaseFiles = async (
  ctx: AppContext,
  detail: AgentDetail,
  projectDir: string,
): Promise<ExportKbRef[]> => {
  if (detail.knowledgebases.length === 0) return [];

  const root = join(projectDir, "knowledgebases");
  await mkdir(root, { recursive: true });
  const usedKbDirs = new Set<string>();
  const refs: ExportKbRef[] = [];

  for (const kb of detail.knowledgebases) {
    const kbDir = uniqueSegment(usedKbDirs, safeSegment(kb.slug));
    await mkdir(join(root, kbDir), { recursive: true });
    const usedFiles = new Set<string>();

    const documents = [];
    for (const doc of ctx.db.knowledgebases.listDocuments(asId("KnowledgebaseId", kb.id))) {
      const text = stitchChunks(ctx.db.knowledgebases.documentChunks(asId("KbDocumentId", doc.id)));
      const file = uniqueSegment(usedFiles, `${safeSegment(doc.filename)}.txt`);
      await writeFile(join(root, kbDir, file), text.endsWith("\n") ? text : `${text}\n`);
      documents.push({ filename: doc.filename, mime: doc.mime, path: `knowledgebases/${kbDir}/${file}` });
    }
    refs.push({ slug: kb.slug, name: kb.name, description: kb.description, documents });
  }
  return refs;
};

/** Write the authoritative machine-readable manifest at the archive root. */
const writeExportManifest = async (
  projectDir: string,
  detail: AgentDetail,
  knowledgebases: readonly ExportKbRef[],
): Promise<void> => {
  const { agent, skills } = detail;
  const manifest = {
    schema: EXPORT_SCHEMA_ID,
    agent: {
      name: agent.name,
      description: agent.description,
      instructionsPath: "agent/instructions.md",
      modelProvider: agent.modelProvider,
      modelId: agent.modelId,
      reasoning: agent.reasoning,
      visibility: agent.visibility,
    },
    skills: skills.map((s) => ({ slug: s.slug, name: s.name, path: `agent/skills/${s.slug}` })),
    knowledgebases,
  };
  await writeFile(join(projectDir, EXPORT_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
};

/**
 * Render the agent's eve project into a throwaway temp directory and zip it.
 * Uses a temp dir (not the live workspace) so exporting never disturbs a
 * running host that is serving chats from its materialized directory. The zip
 * carries an `xagents.agent.json` manifest so it round-trips losslessly on import.
 */
export const exportAgent = async (
  ctx: AppContext,
  agentId: string,
): Promise<Result<AgentExport, AppError>> => {
  const detail = ctx.db.agents.getDetail(asId("AgentId", agentId));
  if (!detail.ok) return err(detail.error);

  const dir = await mkdtemp(join(tmpdir(), "xagents-export-"));
  try {
    const written = await materializeAgent(specFromDetail(ctx, detail.value), dir);
    if (!written.ok) return written;
    const kbRefs = await writeKnowledgebaseFiles(ctx, detail.value, dir);
    await writeExportManifest(dir, detail.value, kbRefs);
    return ok({ filename: `${detail.value.agent.slug}.zip`, data: await zipDirectory(dir) });
  } catch (cause) {
    return err(appError("agent_runtime_error", "failed to export agent project", cause));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

// --- Import ------------------------------------------------------------------

const emptySummary: ImportSummary = { skills: 0, knowledgebases: 0, documents: 0, chunks: 0 };

/** Count what a plan will create (dry-run preview; chunking is cheap). */
const summarize = (plan: ImportPlan): ImportSummary => {
  let documents = 0;
  let chunks = 0;
  for (const kb of plan.knowledgebases) {
    for (const doc of kb.documents) {
      documents += 1;
      chunks += chunkText(doc.text).length;
    }
  }
  return { skills: plan.skills.length, knowledgebases: plan.knowledgebases.length, documents, chunks };
};

/** Persist a validated plan in one transaction; returns created ids + counts. */
const commitPlan = (
  ctx: AppContext,
  plan: ImportPlan,
  log: ImportLogEntry[],
): { agentId: string; agentName: string; documents: number; chunks: number } => {
  const run = ctx.db.raw.transaction(() => {
    const ownerId = ctx.user.id;

    const skillIds = plan.skills.map((s) => {
      const created = ctx.db.skills.create(ownerId, {
        name: s.name,
        description: s.description,
        skillMd: s.skillMd,
        visibility: s.visibility,
      });
      if (s.resources.length > 0) ctx.db.skills.setResources(asId("SkillId", created.id), s.resources);
      log.push({
        severity: "info",
        step: `skill:${created.slug}`,
        message: `Created skill "${created.name}"${s.resources.length > 0 ? ` with ${s.resources.length} resource file(s)` : ""}.`,
      });
      return created.id;
    });

    let documents = 0;
    let chunks = 0;
    const kbIds = plan.knowledgebases.map((kb) => {
      const created = ctx.db.knowledgebases.create(ownerId, {
        name: kb.name,
        description: kb.description,
        visibility: kb.visibility,
      });
      for (const doc of kb.documents) {
        const parts = chunkText(doc.text);
        const d = ctx.db.knowledgebases.addDocument(asId("KnowledgebaseId", created.id), {
          filename: doc.filename,
          mime: doc.mime,
          byteLength: Buffer.byteLength(doc.text, "utf8"),
        });
        ctx.db.knowledgebases.insertChunks(
          asId("KnowledgebaseId", created.id),
          asId("KbDocumentId", d.id),
          doc.filename,
          parts,
        );
        documents += 1;
        chunks += parts.length;
      }
      log.push({
        severity: "info",
        step: `kb:${created.slug}`,
        message: `Created knowledgebase "${created.name}" with ${kb.documents.length} document(s), indexed for search.`,
      });
      return created.id;
    });

    const agent = ctx.db.agents.create(ownerId, {
      name: plan.agent.name,
      description: plan.agent.description,
      instructionsMd: plan.agent.instructionsMd,
      modelProvider: plan.agent.modelProvider,
      modelId: plan.agent.modelId,
      reasoning: plan.agent.reasoning,
      visibility: plan.agent.visibility,
      knowledgebaseIds: [],
      skillIds: [],
    });
    ctx.db.agents.setLinks(asId("AgentId", agent.id), { knowledgebaseIds: kbIds, skillIds });
    log.push({ severity: "info", step: "agent", message: `Created agent "${agent.name}".` });

    return { agentId: agent.id, agentName: agent.name, documents, chunks };
  });
  return run();
};

/**
 * Import an agent from an export/eve-project zip. Always returns a full report
 * (even on failure) so the user sees exactly what was validated and done. With
 * `dryRun`, it validates and previews without writing anything. Commits are
 * transactional: any write failure rolls back and nothing is persisted.
 */
export const importAgentArchive = async (
  ctx: AppContext,
  zip: Buffer,
  opts: { readonly dryRun: boolean },
): Promise<ImportReport> => {
  const unpacked = unzipBuffer(zip);
  if (!unpacked.ok) {
    return {
      ok: false,
      committed: false,
      source: "unknown",
      agentId: null,
      agentName: null,
      summary: emptySummary,
      log: [{ severity: "error", step: "unpack", message: unpacked.error.message }],
    };
  }

  const parsed = parseAgentArchive(unpacked.value);
  const log: ImportLogEntry[] = [...parsed.log];
  const blocked = parsed.plan === null || log.some((e) => e.severity === "error");

  if (blocked || parsed.plan === null) {
    return {
      ok: false,
      committed: false,
      source: parsed.source,
      agentId: null,
      agentName: parsed.plan?.agent.name ?? null,
      summary: parsed.plan ? summarize(parsed.plan) : emptySummary,
      log,
    };
  }

  const summary = summarize(parsed.plan);

  if (opts.dryRun) {
    return {
      ok: true,
      committed: false,
      source: parsed.source,
      agentId: null,
      agentName: parsed.plan.agent.name,
      summary,
      log: [...log, { severity: "info", step: "commit", message: "Dry run — validation only; nothing was written." }],
    };
  }

  try {
    const result = commitPlan(ctx, parsed.plan, log);
    return {
      ok: true,
      committed: true,
      source: parsed.source,
      agentId: result.agentId,
      agentName: result.agentName,
      summary: { ...summary, documents: result.documents, chunks: result.chunks },
      log,
    };
  } catch (cause) {
    return {
      ok: false,
      committed: false,
      source: parsed.source,
      agentId: null,
      agentName: parsed.plan.agent.name,
      summary,
      log: [
        ...log,
        {
          severity: "error",
          step: "commit",
          message: `Writing to the database failed (${cause instanceof Error ? cause.message : String(cause)}); no changes were saved.`,
        },
      ],
    };
  }
};

/** Ensure the agent is materialized and its eve host is running; returns the host. */
export const ensureAgentReady = async (
  ctx: AppContext,
  agentId: string,
): Promise<Result<AgentHost, AppError>> => {
  if (!ctx.supervisor.has(agentId)) {
    const materialized = await materializeFromDb(ctx, agentId);
    if (!materialized.ok) return materialized;
  }
  return ctx.supervisor.getOrStart(agentId);
};

/** Drop a running host so the next chat re-materializes (after edits/deletes). */
export const invalidateAgent = (ctx: AppContext, agentId: string): void => {
  ctx.supervisor.stop(agentId);
};
