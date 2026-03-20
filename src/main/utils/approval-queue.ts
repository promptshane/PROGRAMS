import { randomUUID } from "node:crypto";
import type {
  AgentSession,
  DirectorId,
  PendingApproval,
  PendingApprovalKind,
  PendingApprovalStatus,
} from "@shared/types";

interface CreatePendingApprovalInput {
  kind: PendingApprovalKind;
  requestedByDirectorId: DirectorId | null;
  targetDirectorId: DirectorId | null;
  summary: string;
  draftMessage?: string | null;
  draftPayload?: Record<string, unknown> | null;
}

const normalizeSummary = (summary: string): string => {
  const trimmed = summary.trim();
  return trimmed || "Pending approval";
};

export const ensurePendingApprovalQueue = (session: AgentSession): PendingApproval[] => {
  session.pendingApprovals = session.pendingApprovals ?? [];
  return session.pendingApprovals;
};

export const createPendingApproval = (
  session: AgentSession,
  input: CreatePendingApprovalInput,
): PendingApproval => {
  const now = new Date().toISOString();
  const approval: PendingApproval = {
    id: randomUUID(),
    kind: input.kind,
    status: "pending",
    requestedByDirectorId: input.requestedByDirectorId,
    targetDirectorId: input.targetDirectorId,
    summary: normalizeSummary(input.summary),
    draftMessage: input.draftMessage ?? null,
    draftPayload: input.draftPayload ?? null,
    createdAt: now,
    updatedAt: now,
  };
  ensurePendingApprovalQueue(session).push(approval);
  return approval;
};

export const getPendingApproval = (
  session: AgentSession,
  approvalId: string,
): PendingApproval | null =>
  ensurePendingApprovalQueue(session).find((approval) => approval.id === approvalId) ?? null;

export const updatePendingApproval = (
  session: AgentSession,
  approvalId: string,
  patch: {
    summary?: string;
    draftMessage?: string | null;
    draftPayload?: Record<string, unknown> | null;
    targetDirectorId?: DirectorId | null;
    status?: PendingApprovalStatus;
  },
): PendingApproval | null => {
  const approval = getPendingApproval(session, approvalId);
  if (!approval) {
    return null;
  }

  if (patch.summary !== undefined) {
    approval.summary = normalizeSummary(patch.summary);
  }
  if (patch.draftMessage !== undefined) {
    approval.draftMessage = patch.draftMessage;
  }
  if (patch.draftPayload !== undefined) {
    approval.draftPayload = patch.draftPayload;
  }
  if (patch.targetDirectorId !== undefined) {
    approval.targetDirectorId = patch.targetDirectorId;
  }
  if (patch.status !== undefined) {
    approval.status = patch.status;
  }
  approval.updatedAt = new Date().toISOString();
  return approval;
};

export const removePendingApproval = (session: AgentSession, approvalId: string): PendingApproval | null => {
  const approvals = ensurePendingApprovalQueue(session);
  const index = approvals.findIndex((approval) => approval.id === approvalId);
  if (index < 0) {
    return null;
  }

  const [removed] = approvals.splice(index, 1);
  return removed ?? null;
};
