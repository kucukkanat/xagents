import {
  type ImportLogEntry,
  type ImportSeverity,
  type ImportSource,
  type ProviderId,
  type ReasoningEffort,
  type Visibility,
  AgentExportManifest,
  DEFAULT_MODEL,
  EXPORT_MANIFEST_FILE,
  MODEL_CATALOG,
  ProviderIdSchema,
  ReasoningEffortSchema,
  findModel,
} from "@xagents/core";
import { parseSkillMd } from "@xagents/skills";

/**
 * Turns an unpacked archive (path -> bytes) into a validated, ready-to-commit
 * plan plus a full audit log. Pure and side-effect-free: it never touches the
 * DB or disk, so every branch is unit-testable. The server takes the plan and
 * writes it transactionally; this module owns *what is valid* and *why*.
 */

export interface ImportPlanResource {
  readonly path: string;
  readonly content: string;
}
export interface ImportPlanSkill {
  readonly name: string;
  readonly description: string;
  readonly skillMd: string;
  readonly visibility: Visibility;
  readonly resources: readonly ImportPlanResource[];
}
export interface ImportPlanDocument {
  readonly filename: string;
  readonly mime: string;
  readonly text: string;
}
export interface ImportPlanKnowledgebase {
  readonly name: string;
  readonly description: string;
  readonly visibility: Visibility;
  readonly documents: readonly ImportPlanDocument[];
}
export interface ImportPlanAgent {
  readonly name: string;
  readonly description: string;
  readonly instructionsMd: string;
  readonly modelProvider: ProviderId;
  readonly modelId: string;
  readonly reasoning: ReasoningEffort;
  readonly visibility: Visibility;
}
export interface ImportPlan {
  readonly source: ImportSource;
  readonly agent: ImportPlanAgent;
  readonly skills: readonly ImportPlanSkill[];
  readonly knowledgebases: readonly ImportPlanKnowledgebase[];
}

export interface ParsedArchive {
  readonly source: ImportSource;
  /** null when a blocking (error-severity) problem prevents a usable plan. */
  readonly plan: ImportPlan | null;
  readonly log: readonly ImportLogEntry[];
}

type Files = ReadonlyMap<string, Buffer>;
type Log = ImportLogEntry[];

const entry = (severity: ImportSeverity, step: string, message: string): ImportLogEntry => ({
  severity,
  step,
  message,
});
const readText = (files: Files, path: string): string | undefined => files.get(path)?.toString("utf8");

/** Imported entities always land private; the user can publish afterwards. */
const IMPORTED_VISIBILITY: Visibility = "private";

/** Resolve a (provider, modelId) pair against the catalog, logging any fixups. */
const resolveModel = (
  provider: string,
  modelId: string,
  log: Log,
  step: string,
): { readonly provider: ProviderId; readonly modelId: string } | null => {
  const parsed = ProviderIdSchema.safeParse(provider);
  if (!parsed.success) {
    log.push(
      entry(
        "error",
        step,
        `Model provider ${JSON.stringify(provider)} is not supported. Supported providers: ${ProviderIdSchema.options.join(", ")}.`,
      ),
    );
    return null;
  }
  if (findModel(parsed.data, modelId) !== undefined) return { provider: parsed.data, modelId };

  const fallback = MODEL_CATALOG.find((m) => m.provider === parsed.data) ?? DEFAULT_MODEL;
  log.push(
    entry(
      "warning",
      step,
      `Model ${JSON.stringify(modelId)} is not in the catalog; substituting ${JSON.stringify(fallback.modelId)}.`,
    ),
  );
  return { provider: fallback.provider, modelId: fallback.modelId };
};

const resolveReasoning = (raw: string | undefined, log: Log, step: string): ReasoningEffort => {
  if (raw === undefined) return "provider-default";
  const parsed = ReasoningEffortSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  log.push(entry("warning", step, `Unknown reasoning ${JSON.stringify(raw)}; using "provider-default".`));
  return "provider-default";
};

/** Build one skill plan from its archive directory, or null if unusable. */
const buildSkill = (files: Files, skillDir: string, log: Log): ImportPlanSkill | null => {
  const step = `skill:${skillDir}`;
  const md = readText(files, `${skillDir}/SKILL.md`);
  if (md === undefined) {
    log.push(entry("warning", step, `No SKILL.md under ${skillDir}; skill skipped.`));
    return null;
  }
  const parsed = parseSkillMd(md);
  if (!parsed.ok) {
    log.push(entry("warning", step, `Invalid SKILL.md (${parsed.error.message}); skill skipped.`));
    return null;
  }
  const prefix = `${skillDir}/`;
  const resources: ImportPlanResource[] = [];
  for (const [path, buf] of files) {
    if (path.startsWith(prefix) && path !== `${skillDir}/SKILL.md`) {
      resources.push({ path: path.slice(prefix.length), content: buf.toString("utf8") });
    }
  }
  log.push(
    entry(
      "info",
      step,
      `Skill "${parsed.value.frontmatter.name}" validated${resources.length > 0 ? ` (${resources.length} resource file(s))` : ""}.`,
    ),
  );
  return {
    name: parsed.value.frontmatter.name,
    description: parsed.value.frontmatter.description,
    skillMd: md,
    visibility: IMPORTED_VISIBILITY,
    resources,
  };
};

/** Parse an xagents export using its authoritative root manifest. */
const parseXagents = (files: Files, log: Log): ImportPlan | null => {
  const raw = readText(files, EXPORT_MANIFEST_FILE);
  if (raw === undefined) return null; // caller already checked; defensive.

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    log.push(entry("error", "manifest", `${EXPORT_MANIFEST_FILE} is not valid JSON: ${String(cause)}.`));
    return null;
  }
  const manifest = AgentExportManifest.safeParse(json);
  if (!manifest.success) {
    log.push(
      entry(
        "error",
        "manifest",
        `${EXPORT_MANIFEST_FILE} failed validation: ${manifest.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}.`,
      ),
    );
    return null;
  }
  const m = manifest.data;

  const instructions = readText(files, m.agent.instructionsPath);
  if (instructions === undefined || instructions.trim().length === 0) {
    log.push(entry("error", "agent", `Agent instructions not found at ${m.agent.instructionsPath}.`));
    return null;
  }
  const model = resolveModel(m.agent.modelProvider, m.agent.modelId, log, "agent");
  if (model === null) return null;
  const reasoning = resolveReasoning(m.agent.reasoning, log, "agent");
  if (m.agent.visibility === "public") {
    log.push(entry("info", "agent", "Source was public; imported as private."));
  }

  const skills = m.skills
    .map((ref) => buildSkill(files, ref.path.replace(/\/+$/, ""), log))
    .filter((s): s is ImportPlanSkill => s !== null);

  const knowledgebases: ImportPlanKnowledgebase[] = [];
  for (const kb of m.knowledgebases) {
    const documents: ImportPlanDocument[] = [];
    for (const doc of kb.documents) {
      const text = readText(files, doc.path);
      if (text === undefined) {
        log.push(entry("warning", `kb:${kb.slug}`, `Document file ${doc.path} missing; document skipped.`));
        continue;
      }
      documents.push({ filename: doc.filename, mime: doc.mime, text });
    }
    log.push(
      entry("info", `kb:${kb.slug}`, `Knowledgebase "${kb.name}" with ${documents.length} document(s) ready.`),
    );
    knowledgebases.push({ name: kb.name, description: kb.description, visibility: IMPORTED_VISIBILITY, documents });
  }

  log.push(entry("info", "agent", `Agent "${m.agent.name}" validated from xagents manifest.`));
  return {
    source: "xagents-export",
    agent: {
      name: m.agent.name,
      description: m.agent.description,
      instructionsMd: instructions,
      modelProvider: model.provider,
      modelId: model.modelId,
      reasoning,
      visibility: IMPORTED_VISIBILITY,
    },
    skills,
    knowledgebases,
  };
};

/** Factory-call → modelId, from a foreign eve `agent/agent.ts`. */
const MODEL_CALL_RE = /model\s*:\s*(\w+)\s*\(\s*["']([^"']+)["']/;
const REASONING_RE = /reasoning\s*:\s*["']([\w-]+)["']/;

/** Best-effort parse of a plain eve project developed outside xagents. */
const parseEveProject = (files: Files, log: Log): ImportPlan | null => {
  const instructions = readText(files, "agent/instructions.md");
  if (instructions === undefined || instructions.trim().length === 0) {
    log.push(entry("error", "agent", "Missing or empty agent/instructions.md."));
    return null;
  }

  const agentTs = readText(files, "agent/agent.ts");
  if (agentTs === undefined) {
    log.push(entry("error", "agent", "Missing agent/agent.ts; cannot determine the model."));
    return null;
  }
  const modelMatch = MODEL_CALL_RE.exec(agentTs);
  if (modelMatch === null) {
    log.push(
      entry("error", "agent", "Could not find a `model: provider(\"id\")` call in agent/agent.ts."),
    );
    return null;
  }
  const model = resolveModel(modelMatch[1] ?? "", modelMatch[2] ?? "", log, "agent");
  if (model === null) return null;
  const reasoning = resolveReasoning(REASONING_RE.exec(agentTs)?.[1], log, "agent");

  let name = "Imported agent";
  let description = "";
  const pkgRaw = readText(files, "package.json");
  if (pkgRaw !== undefined) {
    try {
      const pkg: unknown = JSON.parse(pkgRaw);
      if (typeof pkg === "object" && pkg !== null) {
        const record = pkg as Record<string, unknown>;
        if (typeof record.name === "string" && record.name.length > 0) {
          name = record.name.replace(/^xagents-agent-/, "") || name;
        }
        if (typeof record.description === "string") description = record.description;
      }
    } catch {
      log.push(entry("warning", "agent", "package.json is not valid JSON; using a default agent name."));
    }
  }
  log.push(entry("info", "agent", `Agent name resolved to "${name}" (from ${pkgRaw ? "package.json" : "default"}).`));

  const skillDirs = new Set<string>();
  for (const path of files.keys()) {
    const match = /^(agent\/skills\/[^/]+)\/SKILL\.md$/.exec(path);
    if (match?.[1] !== undefined) skillDirs.add(match[1]);
  }
  const skills = [...skillDirs]
    .sort()
    .map((dir) => buildSkill(files, dir, log))
    .filter((s): s is ImportPlanSkill => s !== null);

  if ([...files.keys()].some((p) => p.startsWith("agent/tools/"))) {
    log.push(
      entry(
        "warning",
        "tools",
        "Custom eve tools were found but are not imported; xagents manages tools (e.g. kb_search) automatically.",
      ),
    );
  }
  if ([...files.keys()].some((p) => p.startsWith("knowledgebases/"))) {
    log.push(
      entry(
        "info",
        "knowledgebases",
        "A knowledgebases/ folder was present but this archive has no xagents manifest, so no knowledgebases were imported.",
      ),
    );
  }

  return {
    source: "eve-project",
    agent: {
      name,
      description,
      instructionsMd: instructions,
      modelProvider: model.provider,
      modelId: model.modelId,
      reasoning,
      visibility: IMPORTED_VISIBILITY,
    },
    skills,
    knowledgebases: [],
  };
};

/** Detect the archive format and produce a validated plan + audit log. */
export const parseAgentArchive = (files: Files): ParsedArchive => {
  const log: Log = [];

  if (files.has(EXPORT_MANIFEST_FILE)) {
    log.push(entry("info", "detect", "Recognized an xagents export (found the manifest)."));
    return { source: "xagents-export", plan: parseXagents(files, log), log };
  }
  if (files.has("agent/instructions.md") || files.has("agent/agent.ts")) {
    log.push(entry("info", "detect", "No xagents manifest; treating as a plain eve project."));
    return { source: "eve-project", plan: parseEveProject(files, log), log };
  }
  log.push(
    entry(
      "error",
      "detect",
      `Unrecognized archive: expected ${EXPORT_MANIFEST_FILE} or an agent/ directory (instructions.md / agent.ts).`,
    ),
  );
  return { source: "unknown", plan: null, log };
};
