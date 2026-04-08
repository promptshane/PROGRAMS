import type { AgentSession, DirectorId, RdFocusMode, VersionUpdate } from "@shared/types";
import { getDanConflictQuestionCount, hasToddSupersedingDraftUpdatePlan } from "./session-helpers.ts";

export type AgentAlertTone = "white" | "red";
export type AgentAlertAction =
  | "refresh-project"
  | "review-jeff-work"
  | "review-dan-memory"
  | "reconcile-dan-memory"
  | "review-todd-memory"
  | "regenerate-todd-plan";

export interface AgentAlertState {
  tone: AgentAlertTone;
  warningTargetDirectorId: DirectorId | null;
  action: AgentAlertAction;
}

export const hasDanActionableMemory = (session: AgentSession | null): boolean =>
  Boolean(
    session
    && ((session.danMemory.softMemory?.length ?? 0) > 0),
  );

export const hasToddActionableMemory = (session: AgentSession | null): boolean =>
  Boolean(
    session
    && ((session.toddMemory.softMemory?.length ?? 0) > 0),
  );

export const hasPingPendingUpdate = (session: AgentSession | null): boolean =>
  Boolean(
    session
    && !hasToddSupersedingDraftUpdatePlan(session)
    && session.toddMemory.futureUpdatePlan.some((update) => update.status === "pending"),
  );

export const hasPingActiveTask = (session: AgentSession | null): boolean =>
  Boolean(session?.pingMemory.activeTask);

export const hasJeffFailureReport = (session: AgentSession | null): boolean =>
  Boolean(
    session
    && (
      (session.jeffMemory?.softMemory?.length ?? 0) > 0
      || session.jeffMemory?.currentProjectStatus?.status === "needs-refresh"
    ),
  );

export const needsProjectRefresh = (session: AgentSession | null): boolean =>
  session?.knowledgeStatus === "stale" || session?.knowledgeStatus === "needs-initial-refresh";

export const getNextPendingProgrammingUpdate = (session: AgentSession | null): VersionUpdate | null => {
  if (!session) {
    return null;
  }
  if (hasToddSupersedingDraftUpdatePlan(session)) {
    return null;
  }
  const roadmap = session.toddMemory.hardMemory ?? session.toddMemory.roadmap ?? null;
  if (roadmap?.priorityUpdate) {
    const tracked = session.toddMemory.futureUpdatePlan.find((update) => update.id === roadmap.priorityUpdate!.id) ?? null;
    return tracked ?? {
      id: roadmap.priorityUpdate.id,
      versionId: null,
      title: roadmap.priorityUpdate.title,
      description: roadmap.priorityUpdate.description,
      order: 0,
      status: "pending",
      dependencies: [],
      pillarIds: roadmap.priorityUpdate.pillarIds,
      skillsNeeded: [],
      updateKind: roadmap.priorityUpdate.updateKind,
      simplificationMode: null,
      structuralReason: null,
      supportsNextStep: null,
    };
  }
  return session.toddMemory.futureUpdatePlan
    .filter((update) => update.status === "pending")
    .slice()
    .sort((a, b) => a.order - b.order)[0] ?? null;
};

export const getToddMemoryProcessingFocusMode = (_session: AgentSession | null): RdFocusMode =>
  "update-planning";

export const resolveAgentAlertState = (
  directorId: DirectorId,
  session: AgentSession | null,
): AgentAlertState | null => {
  if (directorId === "project-manager") {
    if (needsProjectRefresh(session)) {
      return {
        tone: "white",
        warningTargetDirectorId: null,
        action: "refresh-project",
      };
    }
    if (!hasJeffFailureReport(session)) {
      return null;
    }
    return {
      tone: "red",
      warningTargetDirectorId: null,
      action: "review-jeff-work",
    };
  }

  if (directorId === "creative-director") {
    if (getDanConflictQuestionCount(session) > 0) {
      return { tone: "white", warningTargetDirectorId: null, action: "reconcile-dan-memory" };
    }
    return hasDanActionableMemory(session)
      ? { tone: "white", warningTargetDirectorId: null, action: "review-dan-memory" }
      : null;
  }

  if (directorId === "rd-director") {
    if (!hasToddActionableMemory(session)) return null;
    return { tone: "white", warningTargetDirectorId: null, action: "review-todd-memory" };
  }

  return null;
};
