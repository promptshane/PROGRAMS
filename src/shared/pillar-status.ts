import type { CorePillar, PillarStatus } from "./types";

/**
 * Single enforcement point for the pillar lifecycle (`status`) axis and the
 * canon rule: only the human confirms canon; agents may only ever produce
 * unconfirmed suggestions.
 *
 * `status` is lifecycle ONLY. It is orthogonal to `pillarType` (lane/color) and
 * `endState` (ending) — neither of those is encoded here.
 */

export const PILLAR_STATUSES = [
  "canonical",
  "maybe",
  "open",
  "suggested",
  "silenced",
] as const satisfies readonly PillarStatus[];

/** The only status any agent is permitted to assign to a pillar. */
export const AGENT_PILLAR_STATUS = "suggested" as const satisfies PillarStatus;

const PILLAR_STATUS_SET = new Set<string>(PILLAR_STATUSES);

/** Validate an unknown value into a PillarStatus, falling back to "open". */
export const coercePillarStatus = (value: unknown): PillarStatus =>
  typeof value === "string" && PILLAR_STATUS_SET.has(value)
    ? (value as PillarStatus)
    : "open";

/**
 * Derive a sane lifecycle `status` for legacy pillars that predate the field.
 * Priority: a Dan-authored assumption marks the pillar as an unconfirmed
 * suggestion regardless of pillarType; otherwise map from pillarType.
 */
export const derivePillarStatus = (
  legacy: Pick<CorePillar, "pillarType" | "assumptionSource">,
): PillarStatus => {
  if (legacy.assumptionSource === "dan") return "suggested";
  switch (legacy.pillarType) {
    case "core":
    case "hard-stop":
      return "canonical";
    case "tbd":
      return "open";
    case "side":
    case "ghost":
      return "maybe";
    default:
      return "open";
  }
};

export const isCanon = (pillar: Pick<CorePillar, "status">): boolean =>
  pillar.status === "canonical";

export const isUnconfirmedSuggestion = (pillar: Pick<CorePillar, "status">): boolean =>
  pillar.status === "suggested";
