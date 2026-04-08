import {
  DIRECTOR_NAMES,
  normalizeDirectorId,
  type DirectorId,
  type DirectorStateSnapshot,
  type JeffExecutionReport,
  type JeffMemory,
  type JeffOutcomeEntry,
  type MemoryResolution,
  type MemorySourceRef,
  type PendingApproval,
  type PendingApprovalKind,
  type PendingApprovalStatus,
  type PongMemory,
  type PongValidationReport,
  type SlackChatMessage,
  type SoftMemoryTag,
  type TaggedNote,
} from "./types.ts";

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
    case "agent-update":
    case "validation":
    case "outcome-decision":
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

const VALID_SOFT_MEMORY_TAGS: SoftMemoryTag[] = [
  "likely-hard",
  "likely-backup",
  "handoff-to-dan",
  "handoff-to-todd",
  "handoff-to-ping",
  "handoff-to-pong",
  "handoff-to-jeff",
  "general",
];

const normalizeSoftMemoryTag = (value: unknown): SoftMemoryTag =>
  typeof value === "string" && VALID_SOFT_MEMORY_TAGS.includes(value as SoftMemoryTag)
    ? (value as SoftMemoryTag)
    : "general";

export const sanitizeTaggedNotes = (value: unknown): TaggedNote[] => {
  if (!Array.isArray(value)) return [];
  const notes: TaggedNote[] = [];
  const sanitizeSourceRefs = (input: unknown): MemorySourceRef[] => {
    if (!Array.isArray(input)) return [];
    return input
      .filter(isRecord)
      .map((item, index) => ({
        id: typeof item.id === "string" && item.id.trim() ? item.id : `source-${index}`,
        messageId: typeof item.messageId === "string" && item.messageId.trim() ? item.messageId : null,
        rawText: typeof item.rawText === "string" ? item.rawText : "",
        directorId: normalizeDirectorId(typeof item.directorId === "string" ? item.directorId : null),
        kind: item.kind === "user-message" || item.kind === "assistant-message" || item.kind === "handoff" || item.kind === "report" || item.kind === "legacy"
          ? item.kind as MemorySourceRef["kind"]
          : "legacy",
        createdAt: normalizeIsoString(item.createdAt, new Date(0).toISOString()),
      }))
      .filter((item) => item.rawText.trim().length > 0);
  };
  const sanitizeResolution = (input: unknown): MemoryResolution | null => {
    if (!isRecord(input)) return null;
    return {
      target: input.target === "backup" ? "backup" : "hard",
      resolvedAt: normalizeIsoString(input.resolvedAt, new Date(0).toISOString()),
      reportId: typeof input.reportId === "string" && input.reportId.trim() ? input.reportId : null,
    };
  };
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item === "string" && item.trim()) {
      notes.push({
        id: `migrated-${i}`,
        content: item,
        tag: "general",
        createdAt: new Date(0).toISOString(),
        sourceRefs: [],
        resolution: null,
      });
    } else if (isRecord(item) && typeof item.content === "string" && item.content.trim()) {
      notes.push({
        id: typeof item.id === "string" && item.id.trim() ? item.id : `sanitized-${i}`,
        content: item.content,
        tag: normalizeSoftMemoryTag(item.tag),
        createdAt: normalizeIsoString(item.createdAt, new Date(0).toISOString()),
        sourceRefs: sanitizeSourceRefs(item.sourceRefs),
        resolution: sanitizeResolution(item.resolution),
      });
    }
  }
  return notes;
};

const sanitizeJeffExecutionReports = (value: unknown): JeffExecutionReport[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is JeffExecutionReport =>
      isRecord(item) && typeof item.id === "string" && typeof item.summary === "string",
  );
};

const sanitizePongValidationReports = (value: unknown): PongValidationReport[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is PongValidationReport =>
      isRecord(item) && typeof item.id === "string" && typeof item.summary === "string",
  );
};

const sanitizeJeffOutcomeLog = (value: unknown): JeffOutcomeEntry[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is JeffOutcomeEntry =>
      isRecord(item)
      && typeof item.id === "string"
      && typeof item.reportId === "string"
      && typeof item.decision === "string",
  );
};

export const sanitizeJeffMemory = (value: unknown): JeffMemory => {
  if (!isRecord(value)) {
    return {
      softMemory: [],
      hardMemory: null,
      backupMemory: [],
      hardMemoryUpdatedAt: null,
      latestReportId: null,
      pendingReports: [],
      pendingValidations: [],
      outcomeLog: [],
      managerSummary: null,
      projectStatusHistory: [],
      currentProjectStatus: null,
      notes: [],
      backupNotes: [],
    };
  }
  return {
    softMemory: sanitizeTaggedNotes(value.softMemory ?? value.notes),
    hardMemory: isRecord(value.hardMemory) ? value.hardMemory as unknown as JeffMemory["hardMemory"] : null,
    backupMemory: sanitizeTaggedNotes(value.backupMemory ?? value.backupNotes),
    hardMemoryUpdatedAt: typeof value.hardMemoryUpdatedAt === "string" ? value.hardMemoryUpdatedAt : null,
    latestReportId: typeof value.latestReportId === "string" ? value.latestReportId : null,
    pendingReports: sanitizeJeffExecutionReports(value.pendingReports),
    pendingValidations: sanitizePongValidationReports(value.pendingValidations),
    outcomeLog: sanitizeJeffOutcomeLog(value.outcomeLog),
    managerSummary: isRecord(value.managerSummary) ? value.managerSummary as unknown as JeffMemory["managerSummary"] : null,
    projectStatusHistory: Array.isArray(value.projectStatusHistory) ? value.projectStatusHistory as unknown as JeffMemory["projectStatusHistory"] : [],
    currentProjectStatus: isRecord(value.currentProjectStatus) ? value.currentProjectStatus as unknown as JeffMemory["currentProjectStatus"] : null,
    notes: sanitizeTaggedNotes(value.notes ?? value.softMemory),
    backupNotes: sanitizeTaggedNotes(value.backupNotes ?? value.backupMemory),
  };
};

export const sanitizePongMemory = (value: unknown): PongMemory => {
  if (!isRecord(value)) {
    return {
      jeffInstruction: null,
      validationRequest: null,
      previousValidationReports: [],
      latestValidationReport: null,
      screenshotPaths: [],
    };
  }
  return {
    jeffInstruction: typeof value.jeffInstruction === "string" ? value.jeffInstruction : null,
    validationRequest: isRecord(value.validationRequest) ? value.validationRequest as unknown as PongMemory["validationRequest"] : null,
    previousValidationReports: sanitizePongValidationReports(value.previousValidationReports),
    latestValidationReport:
      isRecord(value.latestValidationReport)
      && typeof (value.latestValidationReport as Record<string, unknown>).id === "string"
        ? (value.latestValidationReport as unknown as PongValidationReport)
        : null,
    screenshotPaths: sanitizeStringList(value.screenshotPaths),
  };
};
