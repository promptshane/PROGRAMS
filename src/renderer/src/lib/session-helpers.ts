import {
  DIRECTOR_NAMES,
  DIRECTOR_LABELS,
  DIRECTOR_COLORS,
  type AgentChatMessage,
  type AgentCoreDetails,
  type AgentSession,
  type CorePillar,
  type DirectorFocusMode,
  type DirectorId,
  type HardMemoryReportMetadata,
  type PendingApproval,
  type StageAgentMessage,
  type ToddUpdatePlanDraftPayload,
  type ToddUpdatePlanSource,
  type UsageWindow,
  type VersionPlan,
  type VersionUpdate,
} from "@shared/types";
import { USAGE_SCHEDULE_TOLERANCE } from "./constants.ts";
import { titleCaseWord, normalizeSentence, labelForDirectorStageStatus } from "./formatting.ts";

export type UsageScheduleTone = "under" | "onTrack" | "over";

export const buildLegacyConcept = (session: AgentSession | null): AgentCoreDetails | null => {
  if (!session) {
    return null;
  }

  const hasLegacyContent = Boolean(
    session.stages.function.confirmed
      || session.stages.thesis.confirmed
      || session.stages.full_flow.confirmed
      || session.corePillars.length > 0,
  );

  if (!hasLegacyContent) {
    return null;
  }

  return {
    function: session.stages.function.confirmed,
    thesis: session.stages.thesis.confirmed,
    corePillars: session.corePillars,
    fullFlow: session.stages.full_flow.confirmed,
    threads: [],
  };
};

export const getConfirmedConcept = (session: AgentSession | null): AgentCoreDetails | null =>
  session?.danMemory?.confirmedConcept
  ?? session?.toddMemory?.confirmedConcept
  ?? buildLegacyConcept(session);

export const getWorkingConcept = (session: AgentSession | null): AgentCoreDetails | null =>
  session?.danMemory?.draftConcept
  ?? getConfirmedConcept(session);

const normalizeConflictText = (value: string | null | undefined): string =>
  (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

const normalizeConceptDetail = (
  detail: { summary: string } | null | undefined,
): string => normalizeConflictText(detail?.summary);

const collectConceptPillarsByName = (
  pillars: CorePillar[],
  index = new Map<string, CorePillar>(),
): Map<string, CorePillar> => {
  for (const pillar of pillars) {
    const key = normalizeConflictText(pillar.name);
    if (key && !index.has(key)) {
      index.set(key, pillar);
    }
    collectConceptPillarsByName(pillar.corePillars ?? [], index);
  }
  return index;
};

export const getDanConflictQuestions = (session: AgentSession | null): string[] => {
  const discussed = session?.danMemory?.draftConcept ?? null;
  const derived = session?.danMemory?.derivedConcept ?? null;
  if (!discussed || !derived) {
    return [];
  }

  const conflicts: string[] = [];
  if (normalizeConceptDetail(discussed.function) !== normalizeConceptDetail(derived.function)) {
    conflicts.push("Discussed and derived Function do not match.");
  }
  if (normalizeConceptDetail(discussed.thesis) !== normalizeConceptDetail(derived.thesis)) {
    conflicts.push("Discussed and derived Thesis do not match.");
  }
  if (normalizeConceptDetail(discussed.fullFlow) !== normalizeConceptDetail(derived.fullFlow)) {
    conflicts.push("Discussed and derived Full-Flow do not match.");
  }

  const discussedPillars = collectConceptPillarsByName(discussed.corePillars);
  const derivedPillars = collectConceptPillarsByName(derived.corePillars);
  const allKeys = new Set([...discussedPillars.keys(), ...derivedPillars.keys()]);
  for (const key of allKeys) {
    const discussedPillar = discussedPillars.get(key) ?? null;
    const derivedPillar = derivedPillars.get(key) ?? null;
    if (!discussedPillar || !derivedPillar) {
      conflicts.push(`Pillar "${(discussedPillar ?? derivedPillar)?.name ?? key}" only appears in one soft-memory view.`);
      continue;
    }

    const pillarMismatch =
      normalizeConceptDetail(discussedPillar.function) !== normalizeConceptDetail(derivedPillar.function)
      || normalizeConceptDetail(discussedPillar.thesis) !== normalizeConceptDetail(derivedPillar.thesis)
      || normalizeConceptDetail(discussedPillar.fullFlow) !== normalizeConceptDetail(derivedPillar.fullFlow);
    if (pillarMismatch) {
      conflicts.push(`Pillar "${discussedPillar.name}" does not match between discussed and derived soft memory.`);
    }
  }

  return conflicts;
};

export const getDanConflictQuestionCount = (session: AgentSession | null): number =>
  getDanConflictQuestions(session).length;

export const summarizeCorePillars = (pillars: CorePillar[]): string | null => {
  const names = pillars
    .map((pillar) => pillar.name.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (names.length === 0) return null;
  if (names.length === 1) {
    return `Concept currently centers on ${names[0]}.`;
  }
  return `Concept currently centers on ${names[0]} and ${names[1]}.`;
};

export const buildAgentProjectDescription = (session: AgentSession | null): string => {
  const concept = getConfirmedConcept(session);
  const functionSummary = normalizeSentence(concept?.function?.summary);
  const thesisSummary = normalizeSentence(concept?.thesis?.summary);
  const pillarSummary = summarizeCorePillars(concept?.corePillars ?? []);
  const sentences: string[] = [];

  if (functionSummary) {
    sentences.push(functionSummary);
  }
  if (thesisSummary && thesisSummary !== functionSummary) {
    sentences.push(thesisSummary);
  }
  if (sentences.length === 0 && pillarSummary) {
    sentences.push(pillarSummary);
  } else if (sentences.length === 1 && !thesisSummary && pillarSummary && pillarSummary !== sentences[0]) {
    sentences.push(pillarSummary);
  }

  return sentences.slice(0, 2).join(" ") || "Core details are still taking shape for this project.";
};

export const getDirectorProfileMeta = (directorId: DirectorId) => ({
  name: DIRECTOR_NAMES[directorId],
  functionLabel: DIRECTOR_LABELS[directorId],
  color: DIRECTOR_COLORS[directorId],
});

export const getDirectorFocusModes = (directorId: DirectorId): DirectorFocusMode[] => {
  switch (directorId) {
    case "creative-director":
      return [];
    case "rd-director":
      return ["research", "version-planning", "update-planning"];
    case "validation-director":
      return ["identify-goal", "test-current-state", "compare"];
    default:
      return [];
  }
};

export const describeDirectorFocusMode = (directorId: DirectorId, mode: DirectorFocusMode): string => {
  switch (directorId) {
    case "creative-director":
      return "Lock the concept, structure, and full experience.";
    case "rd-director":
      switch (mode) {
        case "research":
          return "Check feasibility and codebase context.";
        case "version-planning":
          return "Shape the roadmap into versions.";
        case "update-planning":
          return "Break the roadmap into concrete updates.";
      }
      break;
    case "validation-director":
      switch (mode) {
        case "identify-goal":
          return "Define the expected outcome to validate.";
        case "test-current-state":
          return "Run checks against the current build.";
        case "compare":
          return "Compare actual output against the goal.";
      }
      break;
  }

  return "";
};

export const buildDirectorLiveContextItems = (directorId: DirectorId, session: AgentSession | null): string[] => {
  if (!session) {
    return ["Open a project with agent data to view this agent's live context for the selected project."];
  }

  const confirmedConcept = getConfirmedConcept(session);
  const workingConcept = getWorkingConcept(session);
  const toddMemory = session.toddMemory;
  const pingMemory = session.pingMemory;

  switch (directorId) {
    case "project-manager": {
      const liveApprovals = (session.pendingApprovals ?? []).filter((approval) => approval.status === "pending");
      const activeDirector = session.directorProgress.currentDirector
        ? `${DIRECTOR_NAMES[session.directorProgress.currentDirector]} is currently active.`
        : "No active director has been set yet.";
      return [
        `Creative ${labelForDirectorStageStatus(session.directorProgress.creative)}, R&D ${labelForDirectorStageStatus(session.directorProgress.rd)}, Programming ${labelForDirectorStageStatus(session.directorProgress.programming)}, Validation ${labelForDirectorStageStatus(session.directorProgress.validation)}.`,
        `${confirmedConcept ? "Dan has locked the concept." : "Dan is still shaping the concept."} Todd is tracking ${toddMemory.futureUpdatePlan.length} planned update(s) and ${toddMemory.previousUpdateLog.length} completed execution report(s).`,
        `${liveApprovals.length} pending confirmation(s) and ${Object.values(session.directorStateMap ?? {}).reduce((total, snapshot) => total + (snapshot?.assumptions.length ?? 0), 0)} unresolved assumption(s) are currently visible to Jeff.`,
        activeDirector,
      ];
    }
    case "creative-director": {
      const conflictCount = getDanConflictQuestionCount(session);
      return [
        confirmedConcept
          ? `${confirmedConcept.corePillars.length} concept thread(s) are locked in for Dan to reference.`
          : "No confirmed concept is locked in yet.",
        `${session.danMemory.notes.length} discussed note(s), ${session.danMemory.derivedNotes.length} derived note(s), and ${session.danMemory.sideNotes.length} side note(s) are stored for Dan.`,
        session.danMemory.draftConcept
          ? `Dan currently has a ${session.danMemory.draftStatus === "ready-to-confirm" ? "ready-to-confirm" : "working"} draft concept.`
          : "Dan is focused on concept conversation, not project current-state.",
        conflictCount > 0
          ? `Dan has ${conflictCount} reconciliation question(s) between discussed and derived soft memory.`
          : "No discussed-vs-derived conflicts are currently flagged for Dan.",
      ];
    }
    case "rd-director": {
      return [
        `${confirmedConcept ? "Confirmed Dan concept is available." : "Todd is waiting on confirmed Dan concept."}`,
        `${(toddMemory.successChain ?? []).length} success chain step(s), ${toddMemory.futureUpdatePlan.length} future update(s), and ${toddMemory.previousUpdateLog.length} logged execution outcome(s) are available.`,
        toddMemory.codebaseIndexedMap?.featureAreas.length
          ? `Current codebase index covers ${toddMemory.codebaseIndexedMap.featureAreas.length} feature area(s).`
          : "No codebase index has been stored yet.",
        toddMemory.troubleLog.length > 0
          ? `${toddMemory.troubleLog.length} recurring implementation issue(s) are tracked for follow-up.`
          : "No recurring implementation issues are logged yet.",
      ];
    }
    case "programming-director": {
      const pending = toddMemory.futureUpdatePlan.filter((update) => update.status === "pending").length;
      const inProgress = toddMemory.futureUpdatePlan.filter((update) => update.status === "in_progress").length;
      const completed = toddMemory.futureUpdatePlan.filter((update) => update.status === "completed").length;
      return [
        `${pending} pending, ${inProgress} in-progress, and ${completed} completed implementation update(s) are in the queue.`,
        pingMemory.codebaseMapSummary
          ? "Ping has Todd's current codebase map summary and active update context."
          : "Ping is waiting for Todd to hand down an active update context.",
        pingMemory.activeTask
          ? `Active task: ${pingMemory.activeTask}`
          : "No short-horizon programming task is active yet.",
        pingMemory.latestRawReport
          ? `Latest execution result: ${pingMemory.latestRawReport.status.replace(/_/g, " ")}.`
          : "No execution report has been recorded yet.",
      ];
    }
    case "validation-director":
      return [
        `${session.validationResults.length} validation result(s) have been recorded so far.`,
        `Validation frequency is currently ${session.validationFrequency.split("-").join(" ")}.`,
        `${toddMemory.futureUpdatePlan.filter((update) => update.status === "in_progress" || update.status === "completed").length} implementation update(s) are available to validate or compare.`,
      ];
  }
};

export const getDirectorProjectNotes = (directorId: DirectorId, session: AgentSession | null): string[] =>
  directorId === "creative-director"
    ? (session?.danMemory.notes ?? []).map((n) => typeof n === "string" ? n : n.content)
    : [];

export type DirectorSharedMemorySourceKind =
  | "dan-core-details"
  | "todd-update-context"
  | "jeff-latest-report"
  | "todd-validation-request"
  | "pong-validation-history"
  | "todd-roadmap-and-updates"
  | "ping-execution-reports";

export interface DirectorSharedMemorySource {
  kind: DirectorSharedMemorySourceKind;
  directorId: DirectorId;
  label: string;
  bodyTitle: string;
}

const hasAnyItems = (...collections: Array<{ length?: number } | null | undefined>): boolean =>
  collections.some((collection) => (collection?.length ?? 0) > 0);

const createSharedMemorySource = (
  directorId: DirectorId,
  kind: DirectorSharedMemorySourceKind,
  bodyTitle: string,
): DirectorSharedMemorySource => ({
  kind,
  directorId,
  label: DIRECTOR_NAMES[directorId],
  bodyTitle,
});

export const buildDirectorSharedMemorySources = (
  directorId: DirectorId,
  session: AgentSession | null,
): DirectorSharedMemorySource[] => {
  if (!session) {
    return [];
  }

  const confirmedConcept = getConfirmedConcept(session);

  switch (directorId) {
    case "creative-director":
      return [];
    case "rd-director":
      return confirmedConcept
        ? [createSharedMemorySource("creative-director", "dan-core-details", "Dan's Core-details")]
        : [];
    case "programming-director": {
      const sources: DirectorSharedMemorySource[] = [];
      const hasUpdateContext =
        Boolean(session.pingTaskContext?.currentTask)
        || Boolean(session.pingTaskContext?.toddUpdateExplanation)
        || Boolean(session.pingTaskContext?.lastResult)
        || Boolean(session.pingTaskContext?.lastFailureReason)
        || Boolean(session.pingMemory?.activeTask)
        || Boolean(session.pingMemory?.context)
        || Boolean(session.pingMemory?.codebaseMapSummary)
        || Boolean(session.pingMemory?.latestRawReport)
        || Boolean(session.pingMemory?.currentRun)
        || hasAnyItems(session.toddMemory?.futureUpdatePlan);

      if (hasUpdateContext) {
        sources.push(createSharedMemorySource("rd-director", "todd-update-context", "Todd's Update Context"));
      }
      if (session.pingMemory?.latestJeffReport) {
        sources.push(createSharedMemorySource("project-manager", "jeff-latest-report", "Jeff's Latest Report"));
      }
      return sources;
    }
    case "validation-director": {
      const sources: DirectorSharedMemorySource[] = [];
      const hasValidationRequest =
        Boolean(session.pongTaskContext?.currentTask)
        || Boolean(session.pongTaskContext?.toddUpdateExplanation)
        || Boolean(session.pongTaskContext?.lastResult)
        || Boolean(session.pongTaskContext?.lastFailureReason)
        || Boolean(session.pongMemory?.validationRequest)
        || Boolean(session.pongMemory?.jeffInstruction);

      if (hasValidationRequest) {
        sources.push(createSharedMemorySource("rd-director", "todd-validation-request", "Todd's Validation Request"));
      }
      if (
        hasAnyItems(session.pongMemory?.previousValidationReports, session.validationResults)
        || Boolean(session.pongMemory?.latestValidationReport)
      ) {
        sources.push(createSharedMemorySource("validation-director", "pong-validation-history", "Pong's Validation History"));
      }
      return sources;
    }
    case "project-manager": {
      const sources: DirectorSharedMemorySource[] = [];
      if (confirmedConcept) {
        sources.push(createSharedMemorySource("creative-director", "dan-core-details", "Dan's Core-details"));
      }
      if (
        session.toddMemory?.roadmap
        || Boolean(session.toddMemory?.currentState)
        || Boolean(session.toddMemory?.endStateGoal)
        || hasAnyItems(session.toddMemory?.futureUpdatePlan, session.toddMemory?.previousUpdateLog, session.toddMemory?.troubleLog)
      ) {
        sources.push(createSharedMemorySource("rd-director", "todd-roadmap-and-updates", "Todd's Roadmap & Update Reports"));
      }
      if (hasAnyItems(session.jeffMemory?.pendingReports, session.jeffMemory?.outcomeLog)) {
        sources.push(createSharedMemorySource("programming-director", "ping-execution-reports", "Ping's Execution Reports"));
      }
      if (
        hasAnyItems(session.jeffMemory?.pendingValidations, session.pongMemory?.previousValidationReports, session.validationResults)
        || Boolean(session.pongMemory?.latestValidationReport)
      ) {
        sources.push(createSharedMemorySource("validation-director", "pong-validation-history", "Pong's Validation History"));
      }
      return sources;
    }
  }
};

export const computeExpectedPercent = (window: UsageWindow): number | null => {
  if (!window.resetsAt || !window.windowDurationMins) return null;
  const resetsAt = new Date(window.resetsAt).getTime();
  if (Number.isNaN(resetsAt)) return null;
  const windowDurationMs = window.windowDurationMins * 60 * 1000;
  const startedAt = resetsAt - windowDurationMs;
  const elapsedRatio = Math.min(1, Math.max(0, (Date.now() - startedAt) / windowDurationMs));
  return elapsedRatio * 100;
};

export const getUsageScheduleTone = (window: UsageWindow): UsageScheduleTone => {
  if (typeof window.usedPercent !== "number") return "onTrack";
  const expected = computeExpectedPercent(window);
  if (expected === null) return "onTrack";
  const delta = window.usedPercent - expected;
  if (delta <= -USAGE_SCHEDULE_TOLERANCE) return "under";
  if (delta >= USAGE_SCHEDULE_TOLERANCE) return "over";
  return "onTrack";
};

export const getReportMessages = (session: AgentSession | null): Array<StageAgentMessage | AgentChatMessage> => {
  if (!session) {
    return [];
  }

  return [
    ...(session.slackMessages ?? []),
    ...Object.values(session.directorConversations ?? {}).flatMap((conversation) => conversation.messages ?? []),
    ...(session.unifiedMessages ?? []),
  ];
};

export const findHardMemoryReportMetadata = (session: AgentSession | null, approvalId: string): HardMemoryReportMetadata | null => {
  for (const message of [...getReportMessages(session)].reverse()) {
    const metadata = message.metadata;
    if (metadata?.type === "hard-memory-report" && metadata.approvalId === approvalId) {
      return metadata;
    }
  }

  return null;
};

export const resolveHardMemoryReportArea = (session: AgentSession | null, pillarIds: string[]): string | null => {
  if (!session || pillarIds.length === 0) {
    return null;
  }

  const names = pillarIds
    .map((pillarId) => session.corePillars.find((pillar) => pillar.id === pillarId)?.name ?? null)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0);

  return names.length > 0 ? names.join(", ") : null;
};

export const collectHardMemoryRoadmapVersions = (_session: AgentSession | null): VersionPlan[] => [];

export const buildHardMemoryReportFromApproval = (
  session: AgentSession | null,
  approval: PendingApproval,
): HardMemoryReportMetadata | null => {
  const liveReport = findHardMemoryReportMetadata(session, approval.id);
  if (liveReport) {
    return liveReport;
  }

  const payload = approval.draftPayload;
  if (!payload || payload.action !== "applyStoredData") {
    return null;
  }

  const createdAt = approval.updatedAt ?? approval.createdAt;

  if (payload.dataType === "danDraftCoreDetails" && payload.draftCoreDetails) {
    return {
      type: "hard-memory-report",
      dataType: "danCoreDetails",
      directorId: "creative-director",
      approvalId: approval.id,
      reportStage: "hard",
      summary: approval.draftMessage ?? approval.summary,
      currentState: typeof payload.currentState === "string" ? payload.currentState : null,
      idealState: typeof payload.idealState === "string" ? payload.idealState : null,
      changeSummary: Array.isArray(payload.draftChangeSummary)
        ? payload.draftChangeSummary.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [],
      draftCoreDetails: payload.draftCoreDetails as AgentCoreDetails,
      roadmapVersions: null,
      versionUpdates: null,
      createdAt,
    };
  }

  if (payload.dataType === "toddRoadmap" && payload.roadmap && typeof payload.roadmap === "object") {
    return {
      type: "hard-memory-report",
      dataType: "toddRoadmap",
      directorId: "rd-director",
      approvalId: approval.id,
      reportStage: "hard",
      summary: approval.draftMessage ?? approval.summary,
      currentState: null,
      idealState: null,
      changeSummary: [],
      draftCoreDetails: null,
      roadmap: payload.roadmap as HardMemoryReportMetadata["roadmap"],
      roadmapVersions: null,
      versionUpdates: null,
      createdAt,
    };
  }

  if (payload.dataType === "versions" && Array.isArray(payload.versions)) {
    return {
      type: "hard-memory-report",
      dataType: "versions",
      directorId: "rd-director",
      approvalId: approval.id,
      reportStage: "hard",
      summary: approval.draftMessage ?? approval.summary,
      currentState: typeof payload.currentState === "string" ? payload.currentState : null,
      idealState: typeof payload.idealState === "string" ? payload.idealState : null,
      changeSummary: [],
      draftCoreDetails: null,
      roadmapVersions: payload.versions as VersionPlan[],
      versionUpdates: null,
      createdAt,
    };
  }

  if (payload.dataType === "versionUpdates" && Array.isArray(payload.updates)) {
    const roadmapVersions = collectHardMemoryRoadmapVersions(session);
    return {
      type: "hard-memory-report",
      dataType: "versionUpdates",
      directorId: "rd-director",
      approvalId: approval.id,
      reportStage: "hard",
      summary: approval.draftMessage ?? approval.summary,
      currentState: typeof payload.currentState === "string" ? payload.currentState : null,
      idealState: typeof payload.idealState === "string" ? payload.idealState : null,
      changeSummary: [],
      draftCoreDetails: null,
      roadmapVersions,
      versionUpdates: (payload.updates as VersionUpdate[]).map((update) => ({
        id: update.id,
        title: update.title,
        description: update.description,
        versionLabel: roadmapVersions.find((version) => version.id === update.versionId)?.label ?? "Unassigned",
        dependencies: Array.isArray(update.dependencies) ? update.dependencies : [],
        area: resolveHardMemoryReportArea(session, Array.isArray(update.pillarIds) ? update.pillarIds : []),
        skillsNeeded: Array.isArray(update.skillsNeeded) ? update.skillsNeeded : [],
        updateKind: update.updateKind ?? null,
        simplificationMode: update.simplificationMode ?? null,
        structuralReason: update.structuralReason ?? null,
        supportsNextStep: update.supportsNextStep ?? null,
      })),
      createdAt,
    };
  }

  return null;
};

export const getToddUpdatePlanDraftPayload = (approval: PendingApproval | null): ToddUpdatePlanDraftPayload | null => {
  const payload = approval?.draftPayload;
  if (!payload || payload.action !== "applyStoredData" || payload.dataType !== "versionUpdates" || !Array.isArray(payload.updates)) {
    return null;
  }
  return payload as unknown as ToddUpdatePlanDraftPayload;
};

export const getToddUpdatePlanDraftMeta = (approval: PendingApproval | null): {
  planSource: ToddUpdatePlanSource;
  supersedesConfirmedPlan: boolean;
} => {
  const payload = getToddUpdatePlanDraftPayload(approval);
  return {
    planSource: payload?.planSource === "post-run-structural-check" ? "post-run-structural-check" : "manual",
    supersedesConfirmedPlan: payload?.supersedesConfirmedPlan === true,
  };
};

export const getLivePendingApprovals = (session: AgentSession | null): PendingApproval[] =>
  (session?.pendingApprovals ?? []).filter((approval) => approval.status === "pending");

export const findLivePendingApproval = (
  session: AgentSession | null,
  approvalId: string | null | undefined,
): PendingApproval | null => {
  if (!approvalId) {
    return null;
  }

  return getLivePendingApprovals(session).find((approval) => approval.id === approvalId) ?? null;
};

export const findToddUpdatePlanDraftApproval = (session: AgentSession | null): PendingApproval | null =>
  getLivePendingApprovals(session)
    .filter((approval) => approval.requestedByDirectorId === "rd-director" && approval.kind === "store-data")
    .filter((approval) => Boolean(getToddUpdatePlanDraftPayload(approval)))
    .sort((left, right) => {
      const leftMeta = getToddUpdatePlanDraftMeta(left);
      const rightMeta = getToddUpdatePlanDraftMeta(right);
      if (leftMeta.supersedesConfirmedPlan !== rightMeta.supersedesConfirmedPlan) {
        return leftMeta.supersedesConfirmedPlan ? -1 : 1;
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    })[0] ?? null;

export const hasToddSupersedingDraftUpdatePlan = (session: AgentSession | null): boolean =>
  getToddUpdatePlanDraftMeta(findToddUpdatePlanDraftApproval(session)).supersedesConfirmedPlan;

export const buildDisplayedUpdatePlan = (session: AgentSession | null): {
  source: "none" | "confirmed" | "draft";
  versions: VersionPlan[];
  updates: VersionUpdate[];
  draftApprovalId: string | null;
  draftReport: HardMemoryReportMetadata | null;
  supersedesConfirmedPlan: boolean;
  planSource: ToddUpdatePlanSource | null;
} => {
  const confirmedUpdates = session?.toddMemory?.futureUpdatePlan ?? [];
  const versions = collectHardMemoryRoadmapVersions(session);
  const draftApproval = findToddUpdatePlanDraftApproval(session);
  const draftMeta = getToddUpdatePlanDraftMeta(draftApproval);
  if (draftApproval && draftMeta.supersedesConfirmedPlan) {
    const draftReport = buildHardMemoryReportFromApproval(session, draftApproval);
    return {
      source: "draft",
      versions: draftReport?.roadmapVersions ?? versions,
      updates: Array.isArray(draftApproval.draftPayload?.updates)
        ? draftApproval.draftPayload.updates as VersionUpdate[]
        : [],
      draftApprovalId: draftApproval.id,
      draftReport,
      supersedesConfirmedPlan: true,
      planSource: draftMeta.planSource,
    };
  }
  if (confirmedUpdates.length > 0) {
    return {
      source: "confirmed",
      versions,
      updates: confirmedUpdates,
      draftApprovalId: null,
      draftReport: null,
      supersedesConfirmedPlan: false,
      planSource: null,
    };
  }

  if (!draftApproval) {
    return {
      source: "none",
      versions,
      updates: [],
      draftApprovalId: null,
      draftReport: null,
      supersedesConfirmedPlan: false,
      planSource: null,
    };
  }

  const draftReport = buildHardMemoryReportFromApproval(session, draftApproval);
  return {
    source: "draft",
    versions: draftReport?.roadmapVersions ?? versions,
    updates: Array.isArray(draftApproval.draftPayload?.updates)
      ? draftApproval.draftPayload.updates as VersionUpdate[]
      : [],
    draftApprovalId: draftApproval.id,
    draftReport,
    supersedesConfirmedPlan: draftMeta.supersedesConfirmedPlan,
    planSource: draftMeta.planSource,
  };
};

export const getHardMemoryReportDirectorName = (report: HardMemoryReportMetadata): string =>
  DIRECTOR_NAMES[report.directorId];

export const getHardMemoryReportScopeLabel = (report: HardMemoryReportMetadata): string => {
  switch (report.dataType) {
    case "danDraftCoreDetails":
    case "danCoreDetails":
      return "Core Details";
    case "versions":
    case "toddRoadmap":
      return "Roadmap";
    case "versionUpdates":
      return "Updates";
  }
};

export const HARD_MEMORY_REPORT_TITLES: Record<HardMemoryReportMetadata["dataType"], string> = {
  danDraftCoreDetails: "Dan Core-Details Draft",
  danCoreDetails: "Core-Details Report",
  versions: "Todd Roadmap",
  versionUpdates: "Todd Update Plan",
  toddRoadmap: "Roadmap Report",
};
