import type { AiProvider, ClaudeModel, ReasoningEffort } from "./types.ts";

// Which thinking/effort levels each provider+model actually supports, ordered
// low → highest. Codex (GPT-5.5/mini) tops out at xhigh; Claude Fable/Opus add
// max; Claude Sonnet supports max but not xhigh. The last entry is the model's
// max — the default we snap to when a model is selected.
export const reasoningEffortsForModel = (
  provider: AiProvider,
  claudeModel: ClaudeModel,
): ReasoningEffort[] => {
  if (provider === "codex") {
    return ["low", "medium", "high", "xhigh"];
  }
  if (claudeModel === "sonnet") {
    return ["low", "medium", "high", "max"];
  }
  // Claude Fable / Opus (and any future model): full ladder.
  return ["low", "medium", "high", "xhigh", "max"];
};

export const maxReasoningEffortForModel = (
  provider: AiProvider,
  claudeModel: ClaudeModel,
): ReasoningEffort => {
  const levels = reasoningEffortsForModel(provider, claudeModel);
  return levels[levels.length - 1];
};
