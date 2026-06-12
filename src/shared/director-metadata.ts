import { DIRECTOR_NAMES, DIRECTOR_LABELS } from "./types.ts";
import type { AiProvider, ClaudeModel, CodexModel, DirectorId, PlanningMode, ReasoningEffort } from "./types.ts";

export type DirectorFlowLink =
  | {
      kind: "director";
      directorId: DirectorId;
      label: string;
    }
  | {
      kind: "context";
      label: string;
    };

export interface DirectorRuntimeDefaults {
  reasoningEffort: ReasoningEffort;
  planningMode: PlanningMode;
}

export interface DirectorMetadata {
  id: DirectorId;
  name: string;
  label: string;
  shortDescription: string;
  modelBehaviorNote: string;
  introMessage: string;
  outroMessage: string;
  runtimeDefaults: DirectorRuntimeDefaults;
  receivesFrom: DirectorFlowLink[];
  sendsTo: DirectorFlowLink[];
  accessOverview: string[];
  notesSource: "danInternalNotes" | "directorStateMap" | null;
}

const contextLink = (label: string): DirectorFlowLink => ({
  kind: "context",
  label,
});

const directorLink = (directorId: DirectorId): DirectorFlowLink => ({
  kind: "director",
  directorId,
  label: `${DIRECTOR_NAMES[directorId]} — ${DIRECTOR_LABELS[directorId]}`,
});

export const DIRECTOR_METADATA: Record<DirectorId, DirectorMetadata> = {
  "project-manager": {
    id: "project-manager",
    name: DIRECTOR_NAMES["project-manager"],
    label: DIRECTOR_LABELS["project-manager"],
    shortDescription: "Coordinates requests, tracks overall project state, and routes work to the right specialist.",
    modelBehaviorNote: "Uses the selected project provider and model defaults.",
    introMessage: "I’m pulling the current state together.",
    outroMessage: "I’m stepping back into coordination mode.",
    runtimeDefaults: {
      reasoningEffort: "high",
      planningMode: "none",
    },
    receivesFrom: [
      contextLink("User"),
      contextLink("Director status"),
      contextLink("Project-wide session state"),
    ],
    sendsTo: [
      directorLink("creative-director"),
      directorLink("rd-director"),
      directorLink("programming-director"),
    ],
    accessOverview: [
      "Project-wide summaries from Dan, Todd, and Ping.",
      "Confirmed concept memory, Todd's roadmap and update queue, and validation summaries.",
      "Unresolved assumptions, pending confirmations, and blocked actions.",
      "Recent Slack context for coordinating the next handoff.",
    ],
    notesSource: null,
  },
  "creative-director": {
    id: "creative-director",
    name: DIRECTOR_NAMES["creative-director"],
    label: DIRECTOR_LABELS["creative-director"],
    shortDescription: "Holds the heart of the idea and refines the confirmed concept through conversation.",
    modelBehaviorNote: "Uses the small model for conversation and soft-memory notes, then the big model for hard-memory synthesis.",
    introMessage: "I’m stepping into the concept thread.",
    outroMessage: "I’m stepping back out of the concept thread.",
    runtimeDefaults: {
      reasoningEffort: "xhigh",
      planningMode: "none",
    },
    receivesFrom: [
      contextLink("User"),
      directorLink("project-manager"),
      contextLink("Core details"),
    ],
    sendsTo: [directorLink("rd-director"), directorLink("project-manager")],
    accessOverview: [
      "Confirmed concept memory plus Dan's working draft for the current conversation.",
      "Current conversation notes, side-notes, and the full experience description for the idea.",
      "Archived notes stay hidden unless explicitly recovered later.",
    ],
    notesSource: "danInternalNotes",
  },
  "rd-director": {
    id: "rd-director",
    name: DIRECTOR_NAMES["rd-director"],
    label: DIRECTOR_LABELS["rd-director"],
    shortDescription: "Turns Dan's confirmed concept into technical roadmap, future updates, and codebase-aware planning.",
    modelBehaviorNote: "Uses the small model for conversation and working notes, then the big model for roadmap and update synthesis.",
    introMessage: "I’m mapping the technical path now.",
    outroMessage: "I’m stepping back out of the planning thread.",
    runtimeDefaults: {
      reasoningEffort: "xhigh",
      planningMode: "none",
    },
    receivesFrom: [
      directorLink("creative-director"),
      contextLink("Internet research (web search/fetch)"),
      contextLink("Research and roadmap context"),
    ],
    sendsTo: [directorLink("programming-director"), directorLink("validation-director"), directorLink("project-manager")],
    accessOverview: [
      "Only Dan's confirmed concept memory, not Dan's unconfirmed draft or side-notes.",
      "Todd's codebase index from the latest repo scan or refresh.",
      "Todd's planning state: current state, end state goal, success chain (dependency steps in order), next update for Ping, update queue, previous update log, and trouble log.",
    ],
    notesSource: "directorStateMap",
  },
  "programming-director": {
    id: "programming-director",
    name: DIRECTOR_NAMES["programming-director"],
    label: DIRECTOR_LABELS["programming-director"],
    shortDescription: "Executes Todd-approved updates, reports the result, and returns to waiting.",
    modelBehaviorNote: "Uses the big model to plan the change, then switches to the small model to execute the approved code update.",
    introMessage: "I'll look at the implementation...",
    outroMessage: "I’m stepping back out of the code thread.",
    runtimeDefaults: {
      reasoningEffort: "high",
      planningMode: "auto",
    },
    receivesFrom: [
      directorLink("rd-director"),
      contextLink("Update queue"),
      contextLink("Core details needed to implement correctly"),
    ],
    sendsTo: [directorLink("validation-director")],
    accessOverview: [
      "Todd's active update context and the current codebase map summary.",
      "Short-horizon execution context: current task, latest raw report, and blocker state.",
      "Repo access on demand while implementing the active update.",
    ],
    notesSource: null,
  },
  "validation-director": {
    id: "validation-director",
    name: DIRECTOR_NAMES["validation-director"],
    label: DIRECTOR_LABELS["validation-director"],
    shortDescription: "Defines the expected outcome, tests the current state, and compares the build against the intended goal.",
    modelBehaviorNote: "Uses the selected project provider and model defaults.",
    introMessage: "I’m stepping into validation now.",
    outroMessage: "I’m stepping back out of validation.",
    runtimeDefaults: {
      reasoningEffort: "high",
      planningMode: "none",
    },
    receivesFrom: [
      directorLink("programming-director"),
      contextLink("Validation and test context"),
    ],
    sendsTo: [
      directorLink("project-manager"),
      contextLink("User"),
    ],
    accessOverview: [
      "Confirmed concept memory relevant to the validation target.",
      "Todd's explanation of what the update was supposed to achieve.",
      "Short-horizon context: current task, last result, last failure reason.",
    ],
    notesSource: null,
  },
};

export const getDirectorMetadata = (directorId: DirectorId): DirectorMetadata =>
  DIRECTOR_METADATA[directorId];

export const getDirectorRuntimeDefaults = (directorId: DirectorId): DirectorRuntimeDefaults =>
  DIRECTOR_METADATA[directorId].runtimeDefaults;

export type DirectorModelTier = "small" | "big";
export type DirectorModelUseCase = "conversation" | "synthesis" | "planning" | "execution";

export interface DirectorModelSelection {
  tier: DirectorModelTier | null;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  activeModel: string;
}

export const BIG_CODEX_MODEL: CodexModel = "gpt-5.5";
export const SMALL_CODEX_MODEL: CodexModel = "gpt-5.5-mini";
export const BIG_CLAUDE_MODEL: ClaudeModel = "opus";
export const SMALL_CLAUDE_MODEL: ClaudeModel = "sonnet";

export const usesFixedDirectorRuntimePolicy = (directorId: DirectorId): boolean =>
  directorId === "creative-director"
  || directorId === "rd-director";

export const resolveDirectorModelTier = (
  directorId: DirectorId,
  useCase: DirectorModelUseCase,
): DirectorModelTier | null => {
  if (directorId === "programming-director") {
    if (useCase === "planning") {
      return "big";
    }
    if (useCase === "execution") {
      return "small";
    }
    return null;
  }

  if (directorId === "creative-director" || directorId === "rd-director") {
    return useCase === "conversation" ? "small" : "big";
  }
  return null;
};

export const resolveDirectorModelSelection = (
  directorId: DirectorId,
  provider: AiProvider,
  model: CodexModel,
  claudeModel: ClaudeModel,
  useCase: DirectorModelUseCase,
): DirectorModelSelection => {
  const tier = resolveDirectorModelTier(directorId, useCase);
  if (!tier) {
    return {
      tier: null,
      provider,
      model,
      claudeModel,
      activeModel: provider === "claude" ? claudeModel : model,
    };
  }

  const resolvedModel = tier === "small" ? SMALL_CODEX_MODEL : BIG_CODEX_MODEL;
  const resolvedClaudeModel = tier === "small" ? SMALL_CLAUDE_MODEL : BIG_CLAUDE_MODEL;

  return {
    tier,
    provider,
    model: resolvedModel,
    claudeModel: resolvedClaudeModel,
    activeModel: provider === "claude" ? resolvedClaudeModel : resolvedModel,
  };
};

export const DIRECT_ROUTE_PATTERNS: { pattern: RegExp; directorId: DirectorId }[] = [
  { pattern: /^(?:hey\s+|@)?dan\b[,:\s]/i, directorId: "creative-director" },
  { pattern: /^(?:hey\s+|@)?todd\b[,:\s]/i, directorId: "rd-director" },
  { pattern: /^(?:hey\s+|@)?ping\b[,:\s]/i, directorId: "rd-director" },
  { pattern: /^(?:hey\s+|@)?pong\b[,:\s]/i, directorId: "rd-director" },
  { pattern: /^(?:hey\s+|@)?jeff\b[,:\s]/i, directorId: "project-manager" },
];

export const matchDirectRoutePattern = (message: string): DirectorId | null => {
  const trimmed = message.trim();
  if (!trimmed) return null;
  for (const { pattern, directorId } of DIRECT_ROUTE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return directorId;
    }
  }
  return null;
};
