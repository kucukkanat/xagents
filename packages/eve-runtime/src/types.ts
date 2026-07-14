import type { Agent, Skill, SkillResource } from "@xagents/core";
import type { SandboxBackendKind } from "@xagents/sandbox";

/** A skill plus the resource files bundled with it. */
export interface MaterializedSkill {
  readonly skill: Skill;
  readonly resources: readonly SkillResource[];
}

/**
 * Everything needed to write an eve project to disk for one agent. The server
 * assembles this from the DB (it owns data access); eve-runtime stays pure and
 * never touches the database.
 */
export interface AgentMaterializationSpec {
  readonly agent: Agent;
  readonly skills: readonly MaterializedSkill[];
  /** When true, a `kb_search` tool is emitted that calls back to the platform. */
  readonly hasKnowledgebases: boolean;
  /** Base URL of the platform server the `kb_search` tool calls back into. */
  readonly internalUrl: string;
  readonly backendKind: SandboxBackendKind;
}

/** A running eve host serving exactly one materialized agent. */
export interface AgentHost {
  readonly agentId: string;
  /** e.g. `http://127.0.0.1:53211` */
  readonly origin: string;
}

/**
 * Opaque resume handle persisted per chat. eve needs both the session id (to
 * open the stream) and the continuation token (to append follow-up turns), so
 * we carry both and treat the encoded string as opaque at the DB layer.
 */
export interface EveResume {
  readonly sessionId: string;
  readonly continuationToken: string;
  /** Number of session events already consumed; the next turn streams from here
   *  (eve's `/stream?startIndex=`), so replays don't re-emit prior turns. */
  readonly nextIndex: number;
}
