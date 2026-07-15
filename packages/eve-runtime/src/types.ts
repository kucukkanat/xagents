import type { Agent, ProviderCodegen, Skill, SkillResource } from "@xagents/core";
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
  /** Resolved provider adapter + settings for codegen (from the live registry). */
  readonly provider: ProviderCodegen;
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

/** A running host as reported to the monitoring layer (epoch millis for times). */
export interface HostStatus {
  readonly agentId: string;
  readonly origin: string;
  readonly pid: number | null;
  readonly startedAt: number;
  readonly lastUsed: number;
  readonly uptimeMs: number;
}

/** Why a host was stopped — surfaced in the admin audit trail. */
export type HostStopReason = "idle" | "invalidated" | "admin";

/**
 * Lifecycle signals emitted by `HostSupervisor` (when an `onEvent` is provided).
 * The supervisor stays DB-agnostic: it only emits; the server persists/broadcasts.
 */
export type SupervisorEvent =
  | {
      readonly kind: "host_started";
      readonly agentId: string;
      readonly pid: number | null;
      readonly origin: string;
      readonly bootMs: number;
    }
  | { readonly kind: "host_stopped"; readonly agentId: string; readonly reason: HostStopReason }
  | { readonly kind: "host_crashed"; readonly agentId: string; readonly pid: number | null }
  | { readonly kind: "boot_failed"; readonly agentId: string; readonly message: string }
  | { readonly kind: "sandbox_reaped"; readonly count: number };

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
