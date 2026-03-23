import type { DirectorId, PlanningMode, ReasoningEffort } from "./types";

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

const DIRECTOR_NAMES: Record<DirectorId, string> = {
  "project-manager": "Jeff",
  "creative-director": "Dan",
  "rd-director": "Todd",
  "programming-director": "Ping",
  "validation-director": "Pong",
};

const DIRECTOR_LABELS: Record<DirectorId, string> = {
  "project-manager": "Project Manager",
  "creative-director": "Creative Director",
  "rd-director": "R&D Director",
  "programming-director": "Programming Director",
  "validation-director": "Validation Director",
};

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
    introMessage: "Let me coordinate on this...",
    outroMessage: "I’ve got the next steps lined up.",
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
    introMessage: "I’ll think about the creative direction...",
    outroMessage: "I’ve captured the creative thread for now.",
    runtimeDefaults: {
      reasoningEffort: "xhigh",
      planningMode: "none",
    },
    receivesFrom: [
      contextLink("User"),
      directorLink("project-manager"),
      contextLink("Core details and vibes"),
    ],
    sendsTo: [directorLink("rd-director")],
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
    introMessage: "Let me research and plan this out...",
    outroMessage: "I’ve mapped the R&D angle for now.",
    runtimeDefaults: {
      reasoningEffort: "xhigh",
      planningMode: "none",
    },
    receivesFrom: [
      directorLink("creative-director"),
      contextLink("Internet research (web search/fetch)"),
      contextLink("Research and roadmap context"),
    ],
    sendsTo: [directorLink("programming-director")],
    accessOverview: [
      "Only Dan's confirmed concept memory, not Dan's unconfirmed draft or side-notes.",
      "Todd's codebase index from the latest repo scan or refresh.",
      "Todd's planning state: V1-V3 roadmap, future update plan, previous update log, and trouble log.",
    ],
    notesSource: "directorStateMap",
  },
  "programming-director": {
    id: "programming-director",
    name: DIRECTOR_NAMES["programming-director"],
    label: DIRECTOR_LABELS["programming-director"],
    shortDescription: "Executes Todd-approved updates, reports the result, and returns to waiting.",
    introMessage: "I'll look at the implementation...",
    outroMessage: "I’m stepping back out of the code thread.",
    runtimeDefaults: {
      reasoningEffort: "high",
      planningMode: "review",
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
    introMessage: "Let me evaluate this...",
    outroMessage: "I’ve wrapped this validation pass.",
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
