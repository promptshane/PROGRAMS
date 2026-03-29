import type { AgentSession, DirectorId, RdFocusMode, VersionUpdate } from "@shared/types";

export type AgentAlertTone = "white" | "red";

export interface AgentAlertState {
  tone: AgentAlertTone;
  warningTargetDirectorId: DirectorId | null;
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
  Boolean(session?.toddMemory.futureUpdatePlan.some((update) => update.status === "pending"));

export const hasPingActiveTask = (session: AgentSession | null): boolean =>
  Boolean(session?.pingMemory.activeTask);

export const hasJeffPendingWork = (session: AgentSession | null): boolean =>
  Boolean(
    session
    && (
      (session.jeffMemory?.pendingReports?.length ?? 0) > 0
      || (session.jeffMemory?.pendingValidations?.length ?? 0) > 0
    ),
  );

export const hasPongPendingWork = (session: AgentSession | null): boolean =>
  Boolean(session?.pongMemory?.jeffInstruction);

export const getNextPendingProgrammingUpdate = (session: AgentSession | null): VersionUpdate | null => {
  if (!session) {
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
    if (!hasJeffPendingWork(session)) {
      return null;
    }
    return {
      tone: hasPingActiveTask(session) ? "red" : "white",
      warningTargetDirectorId: hasPingActiveTask(session) ? "programming-director" : null,
    };
  }

  if (directorId === "creative-director") {
    return hasDanActionableMemory(session)
      ? { tone: "white", warningTargetDirectorId: null }
      : null;
  }

  if (directorId === "rd-director") {
    if (!hasToddActionableMemory(session)) {
      return null;
    }
    return {
      tone: hasDanActionableMemory(session) ? "red" : "white",
      warningTargetDirectorId: hasDanActionableMemory(session) ? "creative-director" : null,
    };
  }

  if (directorId === "programming-director") {
    if (!hasPingPendingUpdate(session)) {
      return null;
    }
    return {
      tone: hasToddActionableMemory(session) ? "red" : "white",
      warningTargetDirectorId: hasToddActionableMemory(session) ? "rd-director" : null,
    };
  }

  if (directorId === "validation-director") {
    if (!hasPongPendingWork(session)) {
      return null;
    }
    return {
      tone: hasPingActiveTask(session) ? "red" : "white",
      warningTargetDirectorId: hasPingActiveTask(session) ? "programming-director" : null,
    };
  }

  return null;
};
