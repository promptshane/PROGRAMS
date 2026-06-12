import type { ReasoningEffort } from "@shared/types";

export const resolveOneShotReasoningEffort = (
  defaultEffort: ReasoningEffort,
  override?: ReasoningEffort | null,
): ReasoningEffort => override ?? defaultEffort;

// Claude Code honors the same effort vocabulary as the API (xhigh is its own
// default for coding; max is the ceiling). Pass the level through unchanged.
export const mapClaudeOneShotEffortLevel = (
  reasoningEffort: ReasoningEffort,
): ReasoningEffort => reasoningEffort;

export const buildClaudeOneShotSettingsArg = (reasoningEffort: ReasoningEffort): string =>
  JSON.stringify({
    effortLevel: mapClaudeOneShotEffortLevel(reasoningEffort),
  });
