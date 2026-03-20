import type { ReasoningEffort } from "@shared/types";

export const resolveOneShotReasoningEffort = (
  defaultEffort: ReasoningEffort,
  override?: ReasoningEffort | null,
): ReasoningEffort => override ?? defaultEffort;

export const mapClaudeOneShotEffortLevel = (
  reasoningEffort: ReasoningEffort,
): "low" | "medium" | "high" => {
  switch (reasoningEffort) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
      return "high";
  }
};

export const buildClaudeOneShotSettingsArg = (reasoningEffort: ReasoningEffort): string =>
  JSON.stringify({
    effortLevel: mapClaudeOneShotEffortLevel(reasoningEffort),
  });
