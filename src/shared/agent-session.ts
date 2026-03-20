import {
  DIRECTOR_NAMES,
  normalizeDirectorId,
  type DirectorId,
  type DirectorStateSnapshot,
  type PendingApproval,
  type PendingApprovalKind,
  type PendingApprovalStatus,
  type SlackChatMessage,
} from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeIsoString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value : fallback;

const sanitizeStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

const normalizeApprovalKind = (value: unknown): PendingApprovalKind | null => {
  switch (value) {
    case "handoff":
    case "internet-research":
    case "codebase-scan":
    case "store-data":
    case "plan":
    case "apply-pending-update":
    case "agent-update":
    case "validation":
      return value;
    default:
      return null;
  }
};

const normalizeApprovalStatus = (value: unknown): PendingApprovalStatus =>
  value === "later" ? "later" : "pending";

const fallbackSlackContent = (role: SlackChatMessage["role"], directorId: DirectorId | null): string => {
  if (role === "assistant" && directorId) {
    return `${DIRECTOR_NAMES[directorId]} did not return a message.`;
  }
  if (role === "assistant") {
    return "The assistant did not return a message.";
  }
  if (role === "system") {
    return "System event recorded.";
  }
  return "";
};

export const sanitizeSlackMessage = (value: unknown, index = 0): SlackChatMessage | null => {
  if (!isRecord(value)) {
    return null;
  }

  const role = value.role === "assistant" || value.role === "system" || value.role === "user"
    ? value.role
    : null;
  if (!role) {
    return null;
  }

  const directorId = normalizeDirectorId(typeof value.directorId === "string" ? value.directorId : null);
  const createdAt = normalizeIsoString(value.createdAt, new Date(0).toISOString());
  const content = typeof value.content === "string"
    ? value.content
    : fallbackSlackContent(role, directorId);

  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : `legacy-slack-${index}`,
    role,
    directorId,
    content,
    createdAt,
    status: value.status === "working" || value.status === "complete" ? value.status : undefined,
    metadata: isRecord(value.metadata) ? (value.metadata as SlackChatMessage["metadata"]) : null,
  };
};

export const sanitizeSlackMessages = (value: unknown): { messages: SlackChatMessage[]; changed: boolean } => {
  if (!Array.isArray(value)) {
    return { messages: [], changed: value != null };
  }

  const messages: SlackChatMessage[] = [];
  let changed = false;
  for (let index = 0; index < value.length; index += 1) {
    const sanitized = sanitizeSlackMessage(value[index], index);
    if (!sanitized) {
      changed = true;
      continue;
    }
    if (sanitized !== value[index]) {
      changed = true;
    }
    messages.push(sanitized);
  }

  return { messages, changed };
};

export const sanitizeDirectorStateMap = (
  value: unknown,
): { directorStateMap: Partial<Record<DirectorId, DirectorStateSnapshot>>; changed: boolean } => {
  if (!isRecord(value)) {
    return { directorStateMap: {}, changed: value != null };
  }

  const directorStateMap: Partial<Record<DirectorId, DirectorStateSnapshot>> = {};
  let changed = false;

  for (const [key, rawState] of Object.entries(value)) {
    const directorId = normalizeDirectorId(key);
    if (!directorId || !isRecord(rawState)) {
      changed = true;
      continue;
    }

    const assumptions = Array.isArray(rawState.assumptions)
      ? rawState.assumptions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    if (!Array.isArray(rawState.assumptions)) {
      changed = true;
    }

    directorStateMap[directorId] = {
      currentState: typeof rawState.currentState === "string" ? rawState.currentState : null,
      idealState: typeof rawState.idealState === "string" ? rawState.idealState : null,
      assumptions,
    };
  }

  return { directorStateMap, changed };
};

export const sanitizePendingApproval = (value: unknown, index = 0): PendingApproval | null => {
  if (!isRecord(value)) {
    return null;
  }

  const kind = normalizeApprovalKind(value.kind);
  if (!kind) {
    return null;
  }

  const draftPayload = isRecord(value.draftPayload) ? value.draftPayload : null;

  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : `legacy-approval-${index}`,
    kind,
    status: normalizeApprovalStatus(value.status),
    requestedByDirectorId: normalizeDirectorId(typeof value.requestedByDirectorId === "string" ? value.requestedByDirectorId : null),
    targetDirectorId: normalizeDirectorId(typeof value.targetDirectorId === "string" ? value.targetDirectorId : null),
    summary: typeof value.summary === "string" && value.summary.trim() ? value.summary : "Pending approval",
    draftMessage: typeof value.draftMessage === "string" ? value.draftMessage : null,
    draftPayload,
    createdAt: normalizeIsoString(value.createdAt, new Date(0).toISOString()),
    updatedAt: normalizeIsoString(value.updatedAt, new Date(0).toISOString()),
  };
};

export const sanitizePendingApprovals = (value: unknown): { pendingApprovals: PendingApproval[]; changed: boolean } => {
  if (!Array.isArray(value)) {
    return { pendingApprovals: [], changed: value != null };
  }

  const pendingApprovals: PendingApproval[] = [];
  let changed = false;
  for (let index = 0; index < value.length; index += 1) {
    const sanitized = sanitizePendingApproval(value[index], index);
    if (!sanitized) {
      changed = true;
      continue;
    }
    if (sanitized !== value[index]) {
      changed = true;
    }
    pendingApprovals.push(sanitized);
  }

  return { pendingApprovals, changed };
};

export const sanitizeSlackResponseContent = (
  value: unknown,
  directorId: DirectorId,
): string => {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return `${DIRECTOR_NAMES[directorId]} did not return a message.`;
};

export const sanitizeDanArchivedNotes = (value: unknown): { notes: string[]; changed: boolean } => {
  const notes = sanitizeStringList(value);
  return {
    notes,
    changed: !Array.isArray(value) || notes.length !== value.length,
  };
};

export const sanitizeSlackPresenceGuestId = (
  value: unknown,
): { directorId: DirectorId | null; changed: boolean } => {
  const directorId = normalizeDirectorId(typeof value === "string" ? value : null);
  const normalized = directorId && directorId !== "project-manager" ? directorId : null;
  return {
    directorId: normalized,
    changed: normalized !== value,
  };
};
