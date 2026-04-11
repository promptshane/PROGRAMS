import type {
  CorePillar,
  ToddCurrentStateItem,
  ToddEndStateItem,
  ToddMemory,
  ToddNextUpdate,
  ToddRoadmap,
  ToddSimplificationMode,
  ToddSuccessChainStep,
  ToddUpdateKind,
  VersionUpdate,
} from "@shared/types";

export type ToddHardMemorySectionKey =
  | "history"
  | "current-state"
  | "priority-update"
  | "success-chain"
  | "end-state";

export interface ToddHardMemoryPriorityUpdate {
  source: "live" | "roadmap";
  id: string;
  title: string;
  description: string;
  pillarIds: string[];
  updateKind: ToddUpdateKind | null;
  simplificationMode: ToddSimplificationMode | null;
  structuralReason: string | null;
  supportsNextStep: string | null;
  skillsNeeded: string[];
  dependencies: string[];
  pillarNames: string[];
  currentStateContext: string | null;
  successDefinition: string | null;
  partialSuccessDefinition: string | null;
  partialFailureDefinition: string | null;
  failureDefinition: string | null;
  missingContractFields: string[];
}

export interface ToddHardMemoryViewModel {
  roadmap: ToddRoadmap | null;
  sectionStatus: Record<ToddHardMemorySectionKey, { incomplete: boolean; reason: string | null }>;
  hasIncompleteSections: boolean;
  history: {
    previousUpdateLog: ToddMemory["previousUpdateLog"];
    troubleLog: ToddMemory["troubleLog"];
    updateCount: number;
    troubleCount: number;
    latestGoal: string | null;
    latestOutcome: string | null;
  };
  currentState: {
    summary: string | null;
    items: ToddCurrentStateItem[];
  };
  priorityUpdate: ToddHardMemoryPriorityUpdate | null;
  successChain: {
    trackedSteps: ToddSuccessChainStep[];
    steps: ToddSuccessChainStep[];
    supportingQueuedUpdates: VersionUpdate[];
    remainingCount: number;
    trackedCount: number;
    nextPendingTitle: string | null;
  };
  endState: {
    summary: string | null;
    items: ToddEndStateItem[];
  };
}

const trimToNull = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const summarizeTitles = (items: Array<{ title: string }>): string | null => {
  const titles = items
    .map((item) => trimToNull(item.title))
    .filter((title): title is string => Boolean(title));
  return titles.length > 0 ? titles.join(" · ") : null;
};

const findPillarNameById = (pillars: CorePillar[], targetId: string): string | null => {
  for (const pillar of pillars) {
    if (pillar.id === targetId) {
      return pillar.name;
    }
    const nested = findPillarNameById(pillar.corePillars, targetId);
    if (nested) {
      return nested;
    }
  }
  return null;
};

export const getToddPillarNames = (
  pillarIds: string[],
  corePillars: CorePillar[] | null | undefined,
): string[] => {
  if (!corePillars || pillarIds.length === 0) {
    return [];
  }

  return pillarIds
    .map((pillarId) => findPillarNameById(corePillars, pillarId))
    .filter((name, index, values): name is string => typeof name === "string" && values.indexOf(name) === index);
};

const sortSuccessChain = (steps: ToddSuccessChainStep[]): ToddSuccessChainStep[] =>
  [...steps].sort((left, right) => left.order - right.order);

const sortRoadmapPathway = (roadmap: ToddRoadmap | null): ToddRoadmap["pathway"] =>
  [...(roadmap?.pathway ?? [])].sort((left, right) => left.order - right.order);

const sortQueuedUpdates = (updates: VersionUpdate[]): VersionUpdate[] =>
  [...updates].sort((left, right) => left.order - right.order);

const buildFallbackSuccessChain = (roadmap: ToddRoadmap | null): ToddSuccessChainStep[] => {
  const currentState = roadmap?.currentState ?? [];
  return sortRoadmapPathway(roadmap).map((item, index) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    order: item.order ?? index,
    satisfied: currentState.some((stateItem) => stateItem.title === item.title && stateItem.itemStatus === "done"),
    satisfiedAt: null,
  }));
};

const buildFallbackQueuedUpdates = (roadmap: ToddRoadmap | null): VersionUpdate[] =>
  sortRoadmapPathway(roadmap).map((item, index) => ({
    id: item.id,
    versionId: null,
    title: item.title,
    description: item.description,
    order: item.order ?? index,
    status: "pending",
    dependencies: [],
    pillarIds: item.pillarIds,
    skillsNeeded: [],
    updateKind: item.updateKind,
    simplificationMode: null,
    structuralReason: null,
    supportsNextStep: null,
  }));

const isOpenQueuedUpdate = (update: VersionUpdate): boolean =>
  update.status === "pending" || update.status === "in_progress";

const matchesUpdate = (
  update: Pick<VersionUpdate, "id" | "title">,
  target: Pick<ToddNextUpdate, "id" | "title"> | Pick<ToddHardMemoryPriorityUpdate, "id" | "title">,
): boolean => update.id === target.id || update.title === target.title;

const getPriorityContractMissingFields = (
  nextUpdate: ToddNextUpdate | null,
  roadmapPriority: ToddRoadmap["priorityUpdate"] | null,
): string[] => {
  const source = nextUpdate ?? roadmapPriority;
  if (!source) {
    return ["priority update"];
  }

  const missing: string[] = [];
  if (!trimToNull(source.currentStateContext ?? null)) missing.push("current-state context");
  if (!trimToNull(source.successDefinition ?? null)) missing.push("success definition");
  if (!trimToNull(source.partialSuccessDefinition ?? null)) missing.push("partial-success definition");
  if (!trimToNull(source.partialFailureDefinition ?? null)) missing.push("partial-failure definition");
  if (!trimToNull(source.failureDefinition ?? null)) missing.push("failure definition");
  return missing;
};

const formatMissingContractReason = (missingFields: string[]): string | null => {
  if (missingFields.length === 0) {
    return null;
  }
  return `Priority Update is missing ${missingFields.join(", ")}.`;
};

export const buildToddHardMemoryViewModel = (
  toddMemory: ToddMemory,
  corePillars: CorePillar[] | null | undefined,
): ToddHardMemoryViewModel => {
  const roadmap = toddMemory.hardMemory ?? toddMemory.roadmap ?? null;
  const roadmapCurrentState = roadmap?.currentState ?? [];
  const roadmapEndState = roadmap?.endState ?? [];

  const previousUpdateLog = [...toddMemory.previousUpdateLog].slice().reverse();
  const troubleLog = [...toddMemory.troubleLog].sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));

  const currentStateSummary = trimToNull(toddMemory.currentState) ?? summarizeTitles(roadmapCurrentState);
  const endStateSummary = trimToNull(toddMemory.endStateGoal) ?? summarizeTitles(roadmapEndState);

  const trackedSuccessChain = toddMemory.successChain.length > 0
    ? sortSuccessChain(toddMemory.successChain)
    : buildFallbackSuccessChain(roadmap);
  const remainingSuccessChain = trackedSuccessChain.filter((step) => !step.satisfied);
  const queuedUpdates = toddMemory.futureUpdatePlan.length > 0
    ? sortQueuedUpdates(toddMemory.futureUpdatePlan)
    : buildFallbackQueuedUpdates(roadmap);

  const matchingQueuedUpdate = toddMemory.nextUpdate
    ? queuedUpdates.find((update) => matchesUpdate(update, toddMemory.nextUpdate!)) ?? null
    : null;
  const matchingRoadmapPriority = roadmap?.priorityUpdate && toddMemory.nextUpdate
    && (roadmap.priorityUpdate.id === toddMemory.nextUpdate.id || roadmap.priorityUpdate.title === toddMemory.nextUpdate.title)
    ? roadmap.priorityUpdate
    : roadmap?.priorityUpdate ?? null;

  const missingContractFields = getPriorityContractMissingFields(toddMemory.nextUpdate, matchingRoadmapPriority);

  const priorityUpdate: ToddHardMemoryPriorityUpdate | null = toddMemory.nextUpdate
    ? {
        source: "live",
        id: toddMemory.nextUpdate.id,
        title: toddMemory.nextUpdate.title,
        description: toddMemory.nextUpdate.description,
        pillarIds: toddMemory.nextUpdate.pillarIds.length > 0
          ? [...toddMemory.nextUpdate.pillarIds]
          : [...(matchingQueuedUpdate?.pillarIds ?? matchingRoadmapPriority?.pillarIds ?? [])],
        updateKind: toddMemory.nextUpdate.updateKind,
        simplificationMode: toddMemory.nextUpdate.simplificationMode,
        structuralReason: toddMemory.nextUpdate.structuralReason,
        supportsNextStep: toddMemory.nextUpdate.supportsNextStep,
        skillsNeeded: [...toddMemory.nextUpdate.skillsNeeded],
        dependencies: [...toddMemory.nextUpdate.dependencies],
        pillarNames: getToddPillarNames(
          toddMemory.nextUpdate.pillarIds.length > 0
            ? toddMemory.nextUpdate.pillarIds
            : (matchingQueuedUpdate?.pillarIds ?? matchingRoadmapPriority?.pillarIds ?? []),
          corePillars,
        ),
        currentStateContext: trimToNull(toddMemory.nextUpdate.currentStateContext) ?? trimToNull(matchingRoadmapPriority?.currentStateContext),
        successDefinition: trimToNull(toddMemory.nextUpdate.successDefinition) ?? trimToNull(matchingRoadmapPriority?.successDefinition),
        partialSuccessDefinition: trimToNull(toddMemory.nextUpdate.partialSuccessDefinition) ?? trimToNull(matchingRoadmapPriority?.partialSuccessDefinition),
        partialFailureDefinition: trimToNull(toddMemory.nextUpdate.partialFailureDefinition) ?? trimToNull(matchingRoadmapPriority?.partialFailureDefinition),
        failureDefinition: trimToNull(toddMemory.nextUpdate.failureDefinition) ?? trimToNull(matchingRoadmapPriority?.failureDefinition),
        missingContractFields,
      }
    : matchingRoadmapPriority
      ? {
          source: "roadmap",
          id: matchingRoadmapPriority.id,
          title: matchingRoadmapPriority.title,
          description: matchingRoadmapPriority.description,
          pillarIds: [...matchingRoadmapPriority.pillarIds],
          updateKind: matchingRoadmapPriority.updateKind,
          simplificationMode: null,
          structuralReason: null,
          supportsNextStep: null,
          skillsNeeded: [],
          dependencies: [],
          pillarNames: getToddPillarNames(matchingRoadmapPriority.pillarIds, corePillars),
          currentStateContext: trimToNull(matchingRoadmapPriority.currentStateContext),
          successDefinition: trimToNull(matchingRoadmapPriority.successDefinition),
          partialSuccessDefinition: trimToNull(matchingRoadmapPriority.partialSuccessDefinition),
          partialFailureDefinition: trimToNull(matchingRoadmapPriority.partialFailureDefinition),
          failureDefinition: trimToNull(matchingRoadmapPriority.failureDefinition),
          missingContractFields,
        }
      : null;

  const supportingQueuedUpdates = queuedUpdates
    .filter(isOpenQueuedUpdate)
    .filter((update) => !priorityUpdate || !matchesUpdate(update, priorityUpdate));

  const hasRemainingWork = remainingSuccessChain.length > 0 || supportingQueuedUpdates.length > 0;
  const sectionStatus: Record<ToddHardMemorySectionKey, { incomplete: boolean; reason: string | null }> = {
    history: {
      incomplete: false,
      reason: null,
    },
    "current-state": {
      incomplete: !currentStateSummary,
      reason: currentStateSummary ? null : "Current State is not mapped yet.",
    },
    "priority-update": {
      incomplete: !priorityUpdate ? hasRemainingWork : missingContractFields.length > 0,
      reason: !priorityUpdate
        ? hasRemainingWork
          ? "Priority Update is not mapped yet."
          : null
        : formatMissingContractReason(missingContractFields),
    },
    "success-chain": {
      incomplete: trackedSuccessChain.length === 0,
      reason: trackedSuccessChain.length === 0 ? "Success Chain is not mapped yet." : null,
    },
    "end-state": {
      incomplete: !endStateSummary,
      reason: endStateSummary ? null : "End State is not mapped yet.",
    },
  };

  return {
    roadmap,
    sectionStatus,
    hasIncompleteSections: Object.values(sectionStatus).some((section) => section.incomplete),
    history: {
      previousUpdateLog,
      troubleLog,
      updateCount: previousUpdateLog.length,
      troubleCount: troubleLog.length,
      latestGoal: previousUpdateLog[0]?.goal ?? null,
      latestOutcome: previousUpdateLog[0]?.outcome ?? null,
    },
    currentState: {
      summary: currentStateSummary,
      items: roadmapCurrentState,
    },
    priorityUpdate,
    successChain: {
      trackedSteps: trackedSuccessChain,
      steps: remainingSuccessChain,
      supportingQueuedUpdates,
      remainingCount: remainingSuccessChain.length,
      trackedCount: trackedSuccessChain.length,
      nextPendingTitle: remainingSuccessChain[0]?.title ?? null,
    },
    endState: {
      summary: endStateSummary,
      items: roadmapEndState,
    },
  };
};

export const getToddHardMemoryIncompleteSectionKeys = (toddMemory: ToddMemory): ToddHardMemorySectionKey[] => {
  const viewModel = buildToddHardMemoryViewModel(toddMemory, []);
  return (Object.entries(viewModel.sectionStatus) as Array<[ToddHardMemorySectionKey, { incomplete: boolean }]>)
    .filter(([, section]) => section.incomplete)
    .map(([sectionKey]) => sectionKey);
};

export const hasToddIncompleteHardMemory = (toddMemory: ToddMemory): boolean =>
  getToddHardMemoryIncompleteSectionKeys(toddMemory).length > 0;
