import { DIRECTOR_NAMES } from "../../shared/types.ts";
import type {
  AiProvider,
  DirectorId,
  PendingApprovalKind,
  SlackDirectorApprovalPayload,
  SlackDirectorMode,
} from "../../shared/types.ts";

export const STANDARD_SLACK_RESPONSE_FIELDS = [
  "response",
  "handoffTo",
  "handoffReason",
  "currentState",
  "idealState",
] as const;

export const RESEARCH_SLACK_RESPONSE_FIELDS = [
  ...STANDARD_SLACK_RESPONSE_FIELDS,
  "generalSummary",
  "projectSummary",
] as const;

export const DAN_SLACK_RESPONSE_FIELDS = [
  ...STANDARD_SLACK_RESPONSE_FIELDS,
  "notesToAppend",
  "conversationStatus",
  "draftCoreDetails",
] as const;

const AUTO_ROUTED_SLACK_DIRECTORS: DirectorId[] = [
  "project-manager",
  "creative-director",
  "rd-director",
  "programming-director",
] as const;

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

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const validateNullableStringField = (
  parsed: Record<string, unknown>,
  field: string,
): void => {
  if (!hasOwn(parsed, field)) {
    throw new Error(`Slack structured output is missing "${field}".`);
  }

  const value = parsed[field];
  if (value !== null && typeof value !== "string") {
    throw new Error(`Slack structured output has an invalid "${field}" field.`);
  }
};

export const resolveToddSlackMode = (text: string): SlackDirectorMode => {
  const normalized = text.trim();
  if (!normalized) {
    return "codebase-analysis";
  }

  return EXPLICIT_INTERNET_RESEARCH_PATTERNS.some((pattern) => pattern.test(normalized))
    ? "internet-research"
    : "codebase-analysis";
};

export const resolveSlackDirectorMode = (
  directorId: DirectorId,
  text: string,
): SlackDirectorMode => directorId === "rd-director" ? resolveToddSlackMode(text) : "codebase-analysis";

export const normalizeSlackDirectorMode = (
  directorId: DirectorId,
  mode: unknown,
  legacyAllowInternetResearch?: unknown,
): SlackDirectorMode => {
  if (directorId !== "rd-director") {
    return "codebase-analysis";
  }

  if (mode === "internet-research") {
    return "internet-research";
  }

  if (mode === "codebase-analysis") {
    return "codebase-analysis";
  }

  return legacyAllowInternetResearch ? "internet-research" : "codebase-analysis";
};

export const resolveSlackApprovalKind = (
  directorId: DirectorId,
  mode: SlackDirectorMode,
): PendingApprovalKind => directorId === "rd-director" && mode === "internet-research" ? "internet-research" : "handoff";

export const canAutoRouteSlackDirector = (directorId: DirectorId): boolean =>
  AUTO_ROUTED_SLACK_DIRECTORS.includes(directorId);

export const buildSlackResponseContract = (
  directorId: DirectorId,
  mode: SlackDirectorMode,
): string => {
  const isResearchMode = directorId === "rd-director" && mode === "internet-research";
  const fields = directorId === "creative-director"
    ? DAN_SLACK_RESPONSE_FIELDS
    : isResearchMode
      ? RESEARCH_SLACK_RESPONSE_FIELDS
      : STANDARD_SLACK_RESPONSE_FIELDS;

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
      case "notesToAppend":
        return `- "notesToAppend": string[]. Required for Dan only. New short working notes to append this turn. Use [] when nothing new should be stored.`;
      case "conversationStatus":
        return `- "conversationStatus": string. Required for Dan only. Use "gathering" while you still need more discussion, or "ready-to-draft" when you are done asking questions and can draft the ideal core-details now.`;
      case "draftCoreDetails":
        return `- "draftCoreDetails": object|null. Required for Dan only. When "conversationStatus" is "ready-to-draft", provide the full ideal core-details draft with unique pillar names; otherwise use null.`;
      default:
        return `- "${field}": string|null.`;
    }
  }).join("\n");

  return `Return ONLY strict JSON with exactly these fields:
${descriptions}
Use null for any optional field that does not apply. Do not omit fields.`;
};

export const validateSlackTurnParsedResponse = (
  parsed: Record<string, unknown>,
  directorId: DirectorId,
  mode: SlackDirectorMode,
): Record<string, unknown> => {
  for (const field of STANDARD_SLACK_RESPONSE_FIELDS) {
    validateNullableStringField(parsed, field);
  }

  const response = parsed.response;
  if (typeof response !== "string" || !response.trim()) {
    throw new Error(`Slack structured output returned an empty "response" for ${DIRECTOR_NAMES[directorId]}.`);
  }

  if (directorId === "rd-director" && mode === "internet-research") {
    for (const field of ["generalSummary", "projectSummary"] as const) {
      validateNullableStringField(parsed, field);
    }
  }

  if (directorId === "creative-director") {
    if (!hasOwn(parsed, "notesToAppend") || !Array.isArray(parsed.notesToAppend)) {
      throw new Error(`Slack structured output is missing a valid "notesToAppend" field for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (!parsed.notesToAppend.every((item) => typeof item === "string")) {
      throw new Error(`Slack structured output has an invalid "notesToAppend" field for ${DIRECTOR_NAMES[directorId]}.`);
    }

    if (!hasOwn(parsed, "conversationStatus")) {
      throw new Error(`Slack structured output is missing "conversationStatus" for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (parsed.conversationStatus !== "gathering" && parsed.conversationStatus !== "ready-to-draft") {
      throw new Error(`Slack structured output has an invalid "conversationStatus" for ${DIRECTOR_NAMES[directorId]}.`);
    }

    if (!hasOwn(parsed, "draftCoreDetails")) {
      throw new Error(`Slack structured output is missing "draftCoreDetails" for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (parsed.draftCoreDetails !== null && !isRecord(parsed.draftCoreDetails)) {
      throw new Error(`Slack structured output has an invalid "draftCoreDetails" field for ${DIRECTOR_NAMES[directorId]}.`);
    }
    if (parsed.conversationStatus === "ready-to-draft" && !isRecord(parsed.draftCoreDetails)) {
      throw new Error(`Slack structured output must include "draftCoreDetails" when ${DIRECTOR_NAMES[directorId]} is ready to draft.`);
    }
  }

  return parsed;
};

export interface SlackProviderAttemptPlan {
  requestedProvider: AiProvider;
  attemptedProviders: AiProvider[];
  requestedProviderError: string | null;
  fallbackProvider: AiProvider | null;
  fallbackProviderError: string | null;
}

export const buildSlackProviderAttemptPlan = (
  requestedProvider: AiProvider,
  preflightErrors: Record<AiProvider, string | null>,
): SlackProviderAttemptPlan => {
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

export interface SlackApprovalDescriptor {
  kind: PendingApprovalKind;
  mode: SlackDirectorMode;
  summaryPrefix: string;
  payload: SlackDirectorApprovalPayload;
}

export const buildSlackApprovalDescriptor = (input: {
  targetDirectorId: DirectorId;
  provider: AiProvider;
  model: SlackDirectorApprovalPayload["model"];
  claudeModel: SlackDirectorApprovalPayload["claudeModel"];
  message: string;
  mode?: SlackDirectorMode;
}): SlackApprovalDescriptor => {
  const mode = normalizeSlackDirectorMode(
    input.targetDirectorId,
    input.mode ?? resolveSlackDirectorMode(input.targetDirectorId, input.message),
  );
  const kind = resolveSlackApprovalKind(input.targetDirectorId, mode);
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
