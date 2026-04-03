import type { AgentSession, DirectorId, RdFocusMode, VersionUpdate } from "@shared/types";
import { getDanConflictQuestionCount, hasToddSupersedingDraftUpdatePlan } from "./session-helpers";

export type AgentAlertTone = "white" | "red";
export type AgentAlertAction =
  | "refresh-project"
  | "review-jeff-work"
  | "review-dan-memory"
  | "reconcile-dan-memory"
  | "review-todd-memory"
  | "run-ping-update"
  | "run-pong-validation";

export interface AgentAlertState {
  tone: AgentAlertTone;
  warningTargetDirectorId: DirectorId | null;
  action: AgentAlertAction;
}

export const hasDanActionableMemory = (session: AgentSession | null): boolean =>
  Boolean(
    session
    && (
      session.danMemory.notes.length > 0
      || (session.danMemory.toddHandoffNotes?.length ?? 0) > 0
      || session.danMemory.draftConcept
    ),
  );

export const hasToddActionableMemory = (session: AgentSession | null): boolean =>
  Boolean(
    session
    && (
      session.toddMemory.pendingHandoff
      || (session.danMemory.toddHandoffNotes?.length ?? 0) > 0
    ),
  );

export const hasPingPendingUpdate = (session: AgentSession | null): boolean =>
  Boolean(
    session
    && !hasToddSupersedingDraftUpdatePlan(session)
    && session.toddMemory.futureUpdatePlan.some((update) => update.status === "pending"),
  );

export const hasPingActiveTask = (session: AgentSession | null): boolean =>
  Boolean(session?.pingMemory.activeTask);

export const hasJeffPendingWork = (session: AgentSession | null): boolean =>
  Boolean(
    session
    && (session.jeffMemory?.pendingReports?.length ?? 0) > 0,
  );

export const hasPongPendingWork = (session: AgentSession | null): boolean =>
  Boolean(session?.pongMemory?.jeffInstruction);

export const needsProjectRefresh = (session: AgentSession | null): boolean =>
  session?.knowledgeStatus === "stale" || session?.knowledgeStatus === "needs-initial-refresh";

export const getNextPendingProgrammingUpdate = (session: AgentSession | null): VersionUpdate | null => {
  if (!session) {
    return null;
  }
  if (hasToddSupersedingDraftUpdatePlan(session)) {
    return null;
  }
  return session.toddMemory.futureUpdatePlan
    .filter((update) => update.status === "pending")
    .slice()
    .sort((a, b) => a.order - b.order)[0] ?? null;
};

export const getToddMemoryProcessingFocusMode = (session: AgentSession | null): RdFocusMode =>
  session && (
    session.toddMemory.versionPlan.v1
    || session.toddMemory.versionPlan.v2
    || session.toddMemory.versionPlan.v3
    || session.versions.length > 0
  )
    ? "update-planning"
    : "version-planning";

export const resolveAgentAlertState = (
  directorId: DirectorId,
  session: AgentSession | null,
): AgentAlertState | null => {
  if (directorId === "project-manager") {
    if (needsProjectRefresh(session)) {
      return {
        tone: hasPingPendingUpdate(session) || hasPingActiveTask(session) ? "red" : "white",
        warningTargetDirectorId: null,
        action: "refresh-project",
      };
    }
    if (!hasJeffPendingWork(session)) {
      return null;
    }
    return {
      tone: hasPingActiveTask(session) ? "red" : "white",
      warningTargetDirectorId: hasPingActiveTask(session) ? "programming-director" : null,
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
    if (!hasToddActionableMemory(session)) {
      return null;
    }
    return {
      tone: hasDanActionableMemory(session) ? "red" : "white",
      warningTargetDirectorId: hasDanActionableMemory(session) ? "creative-director" : null,
      action: "review-todd-memory",
    };
  }

  if (directorId === "programming-director") {
    if (!hasPingPendingUpdate(session)) {
      return null;
    }
    return {
      tone: needsProjectRefresh(session) || hasToddActionableMemory(session) ? "red" : "white",
      warningTargetDirectorId: needsProjectRefresh(session)
        ? "project-manager"
        : hasToddActionableMemory(session)
          ? "rd-director"
          : null,
      action: "run-ping-update",
    };
  }

  if (directorId === "validation-director") {
    if (!hasPongPendingWork(session)) {
      return null;
    }
    return {
      tone: hasPingActiveTask(session) ? "red" : "white",
      warningTargetDirectorId: hasPingActiveTask(session) ? "programming-director" : null,
      action: "run-pong-validation",
    };
  }

  return null;
};
