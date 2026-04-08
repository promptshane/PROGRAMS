import { DIRECTOR_NAMES } from "../../shared/types.ts";
import type {
  AiProvider,
  DirectorId,
  PendingApprovalKind,
  AgentChatDirectorApprovalPayload,
  AgentChatDirectorMode,
  ValidationFocusMode,
} from "../../shared/types.ts";
import { DIRECT_ROUTE_PATTERNS } from "../../shared/director-metadata.ts";

export const STANDARD_AGENT_CHAT_RESPONSE_FIELDS = [
  "response",
  "handoffTo",
  "handoffReason",
  "currentState",
  "idealState",
] as const;

export const RESEARCH_AGENT_CHAT_RESPONSE_FIELDS = [
  ...STANDARD_AGENT_CHAT_RESPONSE_FIELDS,
  "generalSummary",
  "projectSummary",
  "notesToAppend",
] as const;

export const TODD_VERSION_AGENT_CHAT_RESPONSE_FIELDS = [
  ...STANDARD_AGENT_CHAT_RESPONSE_FIELDS,
  "confirmationSuggested",
  "roadmap",
  "versions",
  "notesToAppend",
] as const;

export const TODD_UPDATE_AGENT_CHAT_RESPONSE_FIELDS = [
  ...STANDARD_AGENT_CHAT_RESPONSE_FIELDS,
  "confirmationSuggested",
  "roadmap",
  "updates",
  "notesToAppend",
] as const;

export const DAN_AGENT_CHAT_RESPONSE_FIELDS = [
  ...STANDARD_AGENT_CHAT_RESPONSE_FIELDS,
  "notesToAppend",
  "rawMemoriesToAppend",
  "conversationStatus",
  "draftChangeSummary",
  "draftOperations",
  "draftCoreDetails",
  "presenceAction",
  "toddHandoffNotesToAppend",
] as const;

export const PING_AGENT_CHAT_RESPONSE_FIELDS = [
  ...STANDARD_AGENT_CHAT_RESPONSE_FIELDS,
  "status",
  "zhResponse",
  "enTranslation",
  "rawReport",
] as const;

export const PONG_GOAL_AGENT_CHAT_RESPONSE_FIELDS = [
  ...STANDARD_AGENT_CHAT_RESPONSE_FIELDS,
  "zhResponse",
  "enTranslation",
  "goalSummary",
  "relevantPillarIds",
] as const;

export const PONG_TEST_AGENT_CHAT_RESPONSE_FIELDS = [
  ...STANDARD_AGENT_CHAT_RESPONSE_FIELDS,
  "zhResponse",
  "enTranslation",
  "validationPassed",
  "validationSummary",
  "validationDetails",
] as const;

export const PONG_COMPARE_AGENT_CHAT_RESPONSE_FIELDS = [
  ...STANDARD_AGENT_CHAT_RESPONSE_FIELDS,
  "zhResponse",
  "enTranslation",
  "passed",
  "improvementAreas",
  "comparisonSummary",
] as const;

const AUTO_ROUTED_AGENT_CHAT_DIRECTORS: DirectorId[] = [
  "project-manager",
  "creative-director",
  "rd-director",
] as const;

/**
 * Detects if the user's message clearly targets a specific director,
 * allowing us to skip Jeff's routing turn and go directly to that director.
 * Returns the target DirectorId, or null if the message is ambiguous
 * and Jeff should orchestrate.
 */
export const resolveAgentChatDirectRoute = (
  message: string,
  activeDirectorId: DirectorId | null,
): DirectorId | null => {
  const trimmed = message.trim();
  if (!trimmed) return null;

  // Check name-based patterns (e.g., "Dan, what about...", "@Todd can you...")
  for (const { pattern, directorId } of DIRECT_ROUTE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return directorId;
    }
  }

  // If a director is already active in the channel, keep routing to them
  // unless the message explicitly addresses Jeff or another director
  if (activeDirectorId && activeDirectorId !== "project-manager") {
    return activeDirectorId === "programming-director" || activeDirectorId === "validation-director"
      ? "rd-director"
      : activeDirectorId;
  }

  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const EXPLICIT_INTERNET_RESEARCH_PATTERNS = [
  /\bweb\s+research\b/i,
  /\binternet\s+research\b/i,
  /\bsearch\s+(the\s+)?(web|internet|online)\b/i,
  /\blook\s+(it|this|that)\s+up\b/i,
  /\blook\s+up\b/i,
  /\bgoogle\b/i,
  /\bcompetitor(s)?\b/i,
  /\bmarket\b/i,
  /\bindustry\b/i,
  /\blatest\b/i,
  /\bcurrent\s+(pricing|market|docs|documentation|news|standards?)\b/i,
  /\bonline\b/i,
  /\bexternal\s+(research|sources?|docs|documentation)\b/i,
  /\bfind\s+(sources?|articles?|docs|documentation|pricing)\b/i,
] as const;

const TODD_UPDATE_PLANNING_PATTERNS = [
  /\bupdate\s+sequence\b/i,
  /\bupdate\s+plan\b/i,
  /\bimplementation\s+plan\b/i,
  /\bimplementation\s+steps\b/i,
  /\brollout\s+steps\b/i,
  /\bgrouped\s+updates\b/i,
  /\bbreak\s+(it|this)\s+into\s+updates\b/i,
  /\bqueue\s+the\s+updates\b/i,
] as const;

const TODD_VERSION_PLANNING_PATTERNS = [
  /\broadmap\b/i,
  /\bmilestone(s)?\b/i,
  /\bversion\s+(roadmap|plan|plans)\b/i,
  /\bplan\s+(the\s+)?versions\b/i,
  /\bv[123]\b/i,
] as const;

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const validateNullableStringField = (
  parsed: Record<string, unknown>,
  field: string,
): void => {
  if (!hasOwn(parsed, field)) {
    throw new Error(`Agent chat structured output is missing "${field}".`);
  }

  const value = parsed[field];
  if (value !== null && typeof value !== "string") {
    throw new Error(`Agent chat structured output has an invalid "${field}" field.`);
  }
};

const validateNullableBooleanField = (
  parsed: Record<string, unknown>,
  field: string,
): void => {
  if (!hasOwn(parsed, field)) {
    throw new Error(`Agent chat structured output is missing "${field}".`);
  }

  const value = parsed[field];
  if (value !== null && typeof value !== "boolean") {
    throw new Error(`Agent chat structured output has an invalid "${field}" field.`);
  }
};

const validateNullableStringArrayField = (
  parsed: Record<string, unknown>,
  field: string,
): void => {
  if (!hasOwn(parsed, field)) {
    throw new Error(`Agent chat structured output is missing "${field}".`);
  }

  const value = parsed[field];
  if (value !== null) {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      throw new Error(`Agent chat structured output has an invalid "${field}" field.`);
    }
  }
};

export const resolveToddAgentChatMode = (text: string): AgentChatDirectorMode => {
  const normalized = text.trim();
  if (!normalized) {
    return "codebase-analysis";
  }

  if (EXPLICIT_INTERNET_RESEARCH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "internet-research";
  }
  if (TODD_UPDATE_PLANNING_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "update-planning";
  }
  if (TODD_VERSION_PLANNING_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "version-planning";
  }
  return "codebase-analysis";
};

export const resolveAgentChatDirectorMode = (
  directorId: DirectorId,
  text: string,
): AgentChatDirectorMode => directorId === "rd-director" ? resolveToddAgentChatMode(text) : "codebase-analysis";

export const normalizeAgentChatDirectorMode = (
  directorId: DirectorId,
  mode: unknown,
  legacyAllowInternetResearch?: unknown,
): AgentChatDirectorMode => {
  if (directorId !== "rd-director") {
    return "codebase-analysis";
  }

  if (mode === "internet-research") {
    return "internet-research";
  }

  if (mode === "version-planning") {
    return "version-planning";
  }

  if (mode === "update-planning") {
    return "update-planning";
  }

  if (mode === "codebase-analysis") {
    return "codebase-analysis";
  }

  return legacyAllowInternetResearch ? "internet-research" : "codebase-analysis";
};

export const resolveAgentChatApprovalKind = (
  directorId: DirectorId,
  mode: AgentChatDirectorMode,
): PendingApprovalKind => directorId === "rd-director" && mode === "internet-research" ? "internet-research" : "handoff";

export const canAutoRouteAgentChatDirector = (directorId: DirectorId): boolean =>
  AUTO_ROUTED_AGENT_CHAT_DIRECTORS.includes(directorId);

export const buildAgentChatResponseContract = (
  directorId: DirectorId,
  mode: AgentChatDirectorMode | ValidationFocusMode,
): string => {
  const isResearchMode = directorId === "rd-director" && mode === "internet-research";
  const isToddVersionPlanning = directorId === "rd-director" && mode === "version-planning";
  const isToddUpdatePlanning = directorId === "rd-director" && mode === "update-planning";
  const isPongGoalMode = directorId === "validation-director" && mode === "identify-goal";
  const isPongTestMode = directorId === "validation-director" && mode === "test-current-state";
  const isPongCompareMode = directorId === "validation-director" && mode === "compare";
  const fields = directorId === "creative-director"
    ? DAN_AGENT_CHAT_RESPONSE_FIELDS
    : directorId === "programming-director"
      ? PING_AGENT_CHAT_RESPONSE_FIELDS
      : isPongGoalMode
        ? PONG_GOAL_AGENT_CHAT_RESPONSE_FIELDS
      : isPongTestMode
        ? PONG_TEST_AGENT_CHAT_RESPONSE_FIELDS
      : isPongCompareMode
        ? PONG_COMPARE_AGENT_CHAT_RESPONSE_FIELDS
      : isToddVersionPlanning
        ? TODD_VERSION_AGENT_CHAT_RESPONSE_FIELDS
      : isToddUpdatePlanning
        ? TODD_UPDATE_AGENT_CHAT_RESPONSE_FIELDS
      : isResearchMode
        ? RESEARCH_AGENT_CHAT_RESPONSE_FIELDS
        : STANDARD_AGENT_CHAT_RESPONSE_FIELDS;

  const descriptions = fields.map((field) => {
    switch (field) {
      case "response":
        return `- "response": string. Required. The actual chat reply shown to the user.`;
      case "handoffTo":
        return `- "handoffTo": string|null. Use a director ID or null when no handoff is needed.`;
      case "handoffReason":
        return `- "handoffReason": string|null. Short reason for the next director, or null when no handoff is needed.`;
      case "currentState":
        return `- "currentState": string|null. Your current-state understanding for this director, or null.`;
      case "idealState":
        return `- "idealState": string|null. Your ideal-state understanding for this director, or null.`;
      case "generalSummary":
        return `- "generalSummary": string|null. Broad external findings. Use null if no external research was needed.`;
      case "projectSummary":
        return `- "projectSummary": string|null. Project-specific external findings. Use null if no external research was needed.`;
      case "confirmationSuggested":
        return `- "confirmationSuggested": boolean. Required for Todd planning modes. Use true when the proposed roadmap or update plan should be confirmed and stored.`;
      case "versions":
        return `- "versions": array|null. Required for Todd version-planning only. Each item must include label, description, and goals. Use null when you are only discussing.`;
      case "updates":
        return `- "updates": array|null. Required for Todd update-planning only. Each item must include title, description, versionLabel, dependencies, area, skillsNeeded, updateKind, simplificationMode, structuralReason, and supportsNextStep. Use null when you are only discussing.`;
      case "notesToAppend":
        return directorId === "creative-director"
          ? `- "notesToAppend": string[]. Required for Dan only. Soft memory notes for this session. These are temporary working notes cleared when Dan leaves. Use [] when nothing new should be stored.`
          : `- "notesToAppend": string[]. Planning notes and working assumptions for Todd's soft memory. These persist through the session. Use [] when nothing new should be stored.`;
      case "rawMemoriesToAppend":
        return `- "rawMemoriesToAppend": array|null. Required for Dan only. Raw user inputs to store as back-up memory tied to pillars. Each item: {"content": string, "relatedPillarNames": string[]}. Use null when none apply.`;
      case "conversationStatus":
        return `- "conversationStatus": string. Required for Dan only. Use "gathering" while you still need more discussion, or "ready-to-confirm" when you are done asking questions and want to present a full draft for confirmation.`;
      case "draftChangeSummary":
        return `- "draftChangeSummary": string[]. Required for Dan only. Concise bullet-style change summary for what Dan would present for confirmation. Use [] when no synthesized change summary is ready yet.`;
      case "draftOperations":
        return `- "draftOperations": array. Required for Dan only. Use compact draft operations during gathering turns when durable details changed. Use [] when nothing durable changed this turn.`;
      case "draftCoreDetails":
        return `- "draftCoreDetails": object|null. Required for Dan only. Use null during gathering unless a full snapshot is explicitly needed. When "conversationStatus" is "ready-to-confirm", this must contain the full working draft.`;
      case "presenceAction":
        return `- "presenceAction": string. Required for Dan only. Use "stay" when Dan should remain present in agent chat after replying, or "exit" when Dan is explicitly stepping out.`;
      case "status":
        return `- "status": string. Required for Ping only. Use "success", "blocked", "unexpected", or "no_changes".`;
      case "zhResponse":
        return `- "zhResponse": string. Required for Ping only. Short Mandarin line shown first in chat.`;
      case "enTranslation":
        return `- "enTranslation": string. Required for Ping only. Short literal English translation shown second.`;
      case "rawReport":
        return `- "rawReport": object|null. Required for Ping only. Minimal execution report with "summary", "changedFiles", "blocker", and "unexpectedNotes".`;
      case "goalSummary":
        return `- "goalSummary": string|null. Required for Pong identify-goal mode. Clear summary of the expected state.`;
      case "relevantPillarIds":
        return `- "relevantPillarIds": string[]|null. Required for Pong identify-goal mode. Pillar IDs relevant to the goal.`;
      case "validationPassed":
        return `- "validationPassed": boolean|null. Required for Pong test-current-state mode. Use null when just discussing.`;
      case "validationSummary":
        return `- "validationSummary": string|null. Required for Pong test-current-state mode. Use null when just discussing.`;
      case "validationDetails":
        return `- "validationDetails": string|null. Required for Pong test-current-state mode. Use null when just discussing.`;
      case "passed":
        return `- "passed": boolean|null. Required for Pong compare mode. Use null when just discussing.`;
      case "improvementAreas":
        return `- "improvementAreas": string[]|null. Required for Pong compare mode. Use null when just discussing.`;
      case "comparisonSummary":
        return `- "comparisonSummary": string|null. Required for Pong compare mode. Use null when just discussing.`;
      case "toddHandoffNotesToAppend":
        return `- "toddHandoffNotesToAppend": string[]. Required for Dan only. Todd-bound planning observations (roadmap, build-order, implementation sequencing). These will be packaged and handed to Todd when Dan exits. Use [] when nothing applies.`;
      default:
        return `- "${field}": string|null.`;
    }
  }).join("\n");

  return `Return ONLY strict JSON with exactly these fields:
${descriptions}
Use null for any optional field that does not apply. Do not omit fields.`;
};

export const validateAgentChatTurnParsedResponse = (
  parsed: Record<string, unknown>,
  directorId: DirectorId,
  mode: AgentChatDirectorMode | ValidationFocusMode,
): Record<string, unknown> => {
  for (const field of STANDARD_AGENT_CHAT_RESPONSE_FIELDS) {
    validateNullableStringField(parsed, field);
  }

  const response = parsed.response;
  if (typeof response !== "string" || !response.trim()) {
    throw new Error(`Agent chat structured output returned an empty "response" for ${DIRECTOR_NAMES[directorId]}.`);
  }

  if (directorId === "rd-director" && mode === "internet-research") {
    for (const field of ["generalSummary", "projectSummary"] as const) {
      validateNullableStringField(parsed, field);
    }
  }

  if (directorId === "rd-director" && (mode === "version-planning" || mode === "update-planning")) {
    if (!hasOwn(parsed, "confirmationSuggested") || typeof parsed.confirmationSuggested !== "boolean") {
      throw new Error(`Agent chat structured output is missing "confirmationSuggested" for ${DIRECTOR_NAMES[directorId]}.`);
    }
  }

  if (directorId === "rd-director" && mode === "version-planning") {
    if (!hasOwn(parsed, "versions")) {
      throw new Error(`Agent chat structured output is missing "versions" for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (parsed.versions !== null) {
      if (!Array.isArray(parsed.versions)) {
        throw new Error(`Agent chat structured output has an invalid "versions" field for ${DIRECTOR_NAMES[directorId]}.`);
      }
      for (const item of parsed.versions) {
        if (!isRecord(item)) {
          throw new Error(`Agent chat structured output has an invalid "versions" item for ${DIRECTOR_NAMES[directorId]}.`);
        }
        if (typeof item.label !== "string" || typeof item.description !== "string") {
          throw new Error(`Agent chat structured output has an invalid "versions" item for ${DIRECTOR_NAMES[directorId]}.`);
        }
        if (!Array.isArray(item.goals) || !item.goals.every((goal) => typeof goal === "string")) {
          throw new Error(`Agent chat structured output has an invalid "versions.goals" field for ${DIRECTOR_NAMES[directorId]}.`);
        }
      }
    }
  }

  if (directorId === "rd-director" && mode === "update-planning") {
    if (!hasOwn(parsed, "updates")) {
      throw new Error(`Agent chat structured output is missing "updates" for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (parsed.updates !== null) {
      if (!Array.isArray(parsed.updates)) {
        throw new Error(`Agent chat structured output has an invalid "updates" field for ${DIRECTOR_NAMES[directorId]}.`);
      }
      for (const item of parsed.updates) {
        if (!isRecord(item)) {
          throw new Error(`Agent chat structured output has an invalid "updates" item for ${DIRECTOR_NAMES[directorId]}.`);
        }
        if (
          typeof item.title !== "string"
          || typeof item.description !== "string"
          || typeof item.versionLabel !== "string"
        ) {
          throw new Error(`Agent chat structured output has an invalid "updates" item for ${DIRECTOR_NAMES[directorId]}.`);
        }
        if (!Array.isArray(item.dependencies) || !item.dependencies.every((dependency) => typeof dependency === "string")) {
          throw new Error(`Agent chat structured output has an invalid "updates.dependencies" field for ${DIRECTOR_NAMES[directorId]}.`);
        }
        if (item.area !== null && typeof item.area !== "string") {
          throw new Error(`Agent chat structured output has an invalid "updates.area" field for ${DIRECTOR_NAMES[directorId]}.`);
        }
        if (!Array.isArray(item.skillsNeeded) || !item.skillsNeeded.every((skill) => typeof skill === "string")) {
          throw new Error(`Agent chat structured output has an invalid "updates.skillsNeeded" field for ${DIRECTOR_NAMES[directorId]}.`);
        }
        if (
          item.updateKind !== "create"
          && item.updateKind !== "expand"
          && item.updateKind !== "refine"
          && item.updateKind !== "simplify"
        ) {
          throw new Error(`Agent chat structured output has an invalid "updates.updateKind" field for ${DIRECTOR_NAMES[directorId]}.`);
        }
        if (
          item.simplificationMode !== null
          && item.simplificationMode !== "inline"
          && item.simplificationMode !== "staged"
          && item.simplificationMode !== "overhaul"
        ) {
          throw new Error(`Agent chat structured output has an invalid "updates.simplificationMode" field for ${DIRECTOR_NAMES[directorId]}.`);
        }
        if (item.structuralReason !== null && typeof item.structuralReason !== "string") {
          throw new Error(`Agent chat structured output has an invalid "updates.structuralReason" field for ${DIRECTOR_NAMES[directorId]}.`);
        }
        if (item.supportsNextStep !== null && typeof item.supportsNextStep !== "string") {
          throw new Error(`Agent chat structured output has an invalid "updates.supportsNextStep" field for ${DIRECTOR_NAMES[directorId]}.`);
        }
      }
    }
  }

  if (directorId === "creative-director") {
    if (!hasOwn(parsed, "notesToAppend") || !Array.isArray(parsed.notesToAppend)) {
      throw new Error(`Agent chat structured output is missing a valid "notesToAppend" field for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (!parsed.notesToAppend.every((item) => typeof item === "string")) {
      throw new Error(`Agent chat structured output has an invalid "notesToAppend" field for ${DIRECTOR_NAMES[directorId]}.`);
    }

    if (hasOwn(parsed, "rawMemoriesToAppend") && parsed.rawMemoriesToAppend !== null && !Array.isArray(parsed.rawMemoriesToAppend)) {
      throw new Error(`Agent chat structured output has an invalid "rawMemoriesToAppend" field for ${DIRECTOR_NAMES[directorId]}.`);
    }

    if (!hasOwn(parsed, "conversationStatus")) {
      throw new Error(`Agent chat structured output is missing "conversationStatus" for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (parsed.conversationStatus !== "gathering" && parsed.conversationStatus !== "ready-to-confirm") {
      throw new Error(`Agent chat structured output has an invalid "conversationStatus" for ${DIRECTOR_NAMES[directorId]}.`);
    }

    if (!hasOwn(parsed, "draftChangeSummary") || !Array.isArray(parsed.draftChangeSummary)) {
      throw new Error(`Agent chat structured output is missing a valid "draftChangeSummary" field for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (!parsed.draftChangeSummary.every((item) => typeof item === "string")) {
      throw new Error(`Agent chat structured output has an invalid "draftChangeSummary" field for ${DIRECTOR_NAMES[directorId]}.`);
    }

    if (!hasOwn(parsed, "draftOperations") || !Array.isArray(parsed.draftOperations)) {
      throw new Error(`Agent chat structured output is missing a valid "draftOperations" field for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (!parsed.draftOperations.every((item) => isRecord(item) && typeof item.type === "string")) {
      throw new Error(`Agent chat structured output has an invalid "draftOperations" field for ${DIRECTOR_NAMES[directorId]}.`);
    }

    if (!hasOwn(parsed, "draftCoreDetails")) {
      throw new Error(`Agent chat structured output is missing "draftCoreDetails" for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (parsed.draftCoreDetails !== null && !isRecord(parsed.draftCoreDetails)) {
      throw new Error(`Agent chat structured output has an invalid "draftCoreDetails" field for ${DIRECTOR_NAMES[directorId]}.`);
    }

    if (!hasOwn(parsed, "presenceAction")) {
      throw new Error(`Agent chat structured output is missing "presenceAction" for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (parsed.presenceAction !== "stay" && parsed.presenceAction !== "exit") {
      throw new Error(`Agent chat structured output has an invalid "presenceAction" for ${DIRECTOR_NAMES[directorId]}.`);
    }

    if (parsed.conversationStatus === "ready-to-confirm" && !isRecord(parsed.draftCoreDetails)) {
      throw new Error(`Agent chat structured output must include "draftCoreDetails" when ${DIRECTOR_NAMES[directorId]} is ready to confirm.`);
    }
  }

  if (directorId === "programming-director") {
    if (!hasOwn(parsed, "status") || typeof parsed.status !== "string") {
      throw new Error(`Agent chat structured output is missing "status" for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (!hasOwn(parsed, "zhResponse") || typeof parsed.zhResponse !== "string" || !parsed.zhResponse.trim()) {
      throw new Error(`Agent chat structured output is missing "zhResponse" for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (!hasOwn(parsed, "enTranslation") || typeof parsed.enTranslation !== "string" || !parsed.enTranslation.trim()) {
      throw new Error(`Agent chat structured output is missing "enTranslation" for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (!hasOwn(parsed, "rawReport")) {
      throw new Error(`Agent chat structured output is missing "rawReport" for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (parsed.rawReport !== null) {
      if (!isRecord(parsed.rawReport)) {
        throw new Error(`Agent chat structured output has an invalid "rawReport" field for ${DIRECTOR_NAMES[directorId]}.`);
      }
      if (typeof parsed.rawReport.summary !== "string") {
        throw new Error(`Agent chat structured output is missing "rawReport.summary" for ${DIRECTOR_NAMES[directorId]}.`);
      }
      if (!Array.isArray(parsed.rawReport.changedFiles) || !parsed.rawReport.changedFiles.every((item) => typeof item === "string")) {
        throw new Error(`Agent chat structured output has an invalid "rawReport.changedFiles" field for ${DIRECTOR_NAMES[directorId]}.`);
      }
      if (parsed.rawReport.blocker !== null && typeof parsed.rawReport.blocker !== "string") {
        throw new Error(`Agent chat structured output has an invalid "rawReport.blocker" field for ${DIRECTOR_NAMES[directorId]}.`);
      }
      if (!Array.isArray(parsed.rawReport.unexpectedNotes) || !parsed.rawReport.unexpectedNotes.every((item) => typeof item === "string")) {
        throw new Error(`Agent chat structured output has an invalid "rawReport.unexpectedNotes" field for ${DIRECTOR_NAMES[directorId]}.`);
      }
    }
  }

  if (directorId === "validation-director") {
    if (!hasOwn(parsed, "zhResponse") || typeof parsed.zhResponse !== "string" || !parsed.zhResponse.trim()) {
      throw new Error(`Agent chat structured output is missing "zhResponse" for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (!hasOwn(parsed, "enTranslation") || typeof parsed.enTranslation !== "string" || !parsed.enTranslation.trim()) {
      throw new Error(`Agent chat structured output is missing "enTranslation" for ${DIRECTOR_NAMES[directorId]}.`);
    }

    if (mode === "identify-goal") {
      validateNullableStringField(parsed, "goalSummary");
      validateNullableStringArrayField(parsed, "relevantPillarIds");
    }

    if (mode === "test-current-state") {
      validateNullableBooleanField(parsed, "validationPassed");
      validateNullableStringField(parsed, "validationSummary");
      validateNullableStringField(parsed, "validationDetails");
    }

    if (mode === "compare") {
      validateNullableBooleanField(parsed, "passed");
      validateNullableStringArrayField(parsed, "improvementAreas");
      validateNullableStringField(parsed, "comparisonSummary");
    }
  }

  return parsed;
};

export interface AgentChatProviderAttemptPlan {
  requestedProvider: AiProvider;
  attemptedProviders: AiProvider[];
  requestedProviderError: string | null;
  fallbackProvider: AiProvider | null;
  fallbackProviderError: string | null;
}

export const buildAgentChatProviderAttemptPlan = (
  requestedProvider: AiProvider,
  preflightErrors: Record<AiProvider, string | null>,
): AgentChatProviderAttemptPlan => {
  const fallbackProvider: AiProvider = requestedProvider === "claude" ? "codex" : "claude";
  const attemptedProviders: AiProvider[] = [];

  if (!preflightErrors[requestedProvider]) {
    attemptedProviders.push(requestedProvider);
  }
  if (!preflightErrors[fallbackProvider]) {
    attemptedProviders.push(fallbackProvider);
  }

  return {
    requestedProvider,
    attemptedProviders,
    requestedProviderError: preflightErrors[requestedProvider],
    fallbackProvider,
    fallbackProviderError: preflightErrors[fallbackProvider],
  };
};

export interface AgentChatApprovalDescriptor {
  kind: PendingApprovalKind;
  mode: AgentChatDirectorMode;
  summaryPrefix: string;
  payload: AgentChatDirectorApprovalPayload;
}

export const buildAgentChatApprovalDescriptor = (input: {
  targetDirectorId: DirectorId;
  provider: AiProvider;
  model: AgentChatDirectorApprovalPayload["model"];
  claudeModel: AgentChatDirectorApprovalPayload["claudeModel"];
  message: string;
  mode?: AgentChatDirectorMode;
}): AgentChatApprovalDescriptor => {
  const mode = normalizeAgentChatDirectorMode(
    input.targetDirectorId,
    input.mode ?? resolveAgentChatDirectorMode(input.targetDirectorId, input.message),
  );
  const kind = resolveAgentChatApprovalKind(input.targetDirectorId, mode);
  const summaryPrefix =
    input.targetDirectorId === "rd-director" && mode === "internet-research"
      ? "Confirm Todd internet-research handoff"
      : `Confirm handoff to ${DIRECTOR_NAMES[input.targetDirectorId]}`;

  return {
    kind,
    mode,
    summaryPrefix,
    payload: {
      action: "runSlackDirector",
      provider: input.provider,
      model: input.model,
      claudeModel: input.claudeModel,
      directorId: input.targetDirectorId,
      message: input.message,
      mode,
    },
  };
};
