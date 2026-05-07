import type {
  AiProvider,
  AgentSession,
  ClaudeModel,
  CodexModel,
  DirectorFocusMode,
  ModelCatalog,
  ModelOption,
  PlanningMode,
  ReasoningEffort,
  RuntimeState,
  Settings,
  SpeedMode,
  ToddSimplificationMode,
  ToddUpdateKind,
  UsageWindow,
} from "@shared/types";
import { normalizeProjectIconColor } from "@shared/project-colors";

import type { ComposerOptions } from "./constants.ts";
export type { ComposerOptions } from "./constants.ts";

export const normalizeSentence = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

export const titleCaseWord = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

export const initialsFromName = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
};

export const normalizeHexColor = (value: string): string | null => normalizeProjectIconColor(value);

export const providerLabel = (provider: AiProvider): string =>
  provider === "claude" ? "Claude" : "Codex";

export const labelForAgentProvider = (provider: AiProvider): string =>
  provider === "claude" ? "Claude" : "GPT";

export const fallbackCodexModelLabel = (model: string): string =>
  model
    .replace(/^gpt-/i, "GPT-")
    .split("-")
    .map((part, index) => (index < 2 ? part : titleCaseWord(part)))
    .join(" ");

export const fallbackClaudeModelLabel = (model: string): string => {
  if (model === "sonnet") {
    return "Claude Sonnet";
  }
  if (model === "opus") {
    return "Claude Opus";
  }

  return model
    .replace(/^claude-/i, "Claude ")
    .split("-")
    .map((part, index) => (index === 0 ? part : titleCaseWord(part)))
    .join(" ");
};

export const labelForModel = (model: string, options: ModelOption[], fallback: (model: string) => string): string =>
  options.find((option) => option.id === model)?.label ?? fallback(model);

export const resolveModelOptions = (
  currentModel: string,
  options: ModelOption[],
  fallback: (model: string) => string,
): ModelOption[] => {
  if (options.some((option) => option.id === currentModel)) {
    return options;
  }

  return [
    {
      id: currentModel,
      label: labelForModel(currentModel, options, fallback),
      detail: null,
    },
    ...options,
  ];
};

export const labelForReasoningEffort = (reasoningEffort: ComposerOptions["reasoningEffort"]): string => {
  switch (reasoningEffort) {
    case "low":
      return "Low";
    case "medium":
      return "Normal";
    case "high":
      return "High";
    case "xhigh":
      return "Extra high";
  }
};

export const labelForPlanningMode = (planningMode: PlanningMode): string => {
  switch (planningMode) {
    case "review":
      return "Review";
    case "auto":
      return "Auto";
    case "none":
      return "No Plan";
  }
};

export const labelForComposerModel = (options: ComposerOptions, modelCatalog: ModelCatalog): string =>
  options.provider === "claude"
    ? labelForModel(options.claudeModel, modelCatalog.claude, fallbackClaudeModelLabel)
    : labelForModel(options.model, modelCatalog.codex, fallbackCodexModelLabel);

export const formatDate = (value: string | null): string =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not yet updated";

export const formatAgentChatTimestamp = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

export const formatUsageSubtitle = (label: string | null, fallback: string): string => label?.trim() || fallback;

export const formatUsageTime = (value: Date): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);

export const formatUsageDateTimeWithoutYear = (value: Date): string =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);

export const formatUsageReset = (window: UsageWindow): string => {
  if (!window.resetsAt) {
    return "Reset time unavailable";
  }

  const resetsAt = new Date(window.resetsAt);
  if (Number.isNaN(resetsAt.getTime())) {
    return "Reset time unavailable";
  }

  if (window.windowDurationMins === 5 * 60) {
    return `Today at ${formatUsageTime(resetsAt)}`;
  }

  if (window.windowDurationMins === 7 * 24 * 60) {
    return formatUsageDateTimeWithoutYear(resetsAt);
  }

  return `Resets ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(resetsAt)}`;
};

export const formatDirectorFocusModeLabel = (mode: DirectorFocusMode): string => {
  switch (mode) {
    case "core-details":
      return "Concept";
    case "identify-goal":
      return "Goal";
    case "test-current-state":
      return "Test";
    case "version-planning":
      return "Roadmap";
    case "update-planning":
      return "Updates";
    default:
      return mode.split("-").map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  }
};

export const labelForToddUpdateKind = (kind: ToddUpdateKind | null): string | null =>
  kind ? titleCaseWord(kind) : null;

export const labelForToddSimplificationMode = (mode: ToddSimplificationMode | null): string | null =>
  mode ? titleCaseWord(mode) : null;

export const labelForRuntimeSource = (source: RuntimeState["source"]): string => {
  if (source === "managed") {
    return "Managed by PROGRAMS";
  }
  if (source === "restored") {
    return "Restored runtime";
  }
  if (source === "external") {
    return "Existing external runtime";
  }
  if (source === "self") {
    return "PROGRAMS runtime";
  }

  return "No runtime";
};

export const labelForDirectorStageStatus = (status: AgentSession["directorProgress"]["creative"]): string =>
  status
    .split("-")
    .map((part: string) => titleCaseWord(part))
    .join(" ");
