import type { AiProvider, UsageSnapshot } from "../../shared/types.ts";

export const BASIC_AUTOMATION_RESET_BUFFER_MS = 2 * 60_000;

const resolveShortUsageWindow = (
  usage: UsageSnapshot["codex"] | UsageSnapshot["claude"],
): UsageSnapshot["codex"]["windows"][number] | null => {
  if (usage.status !== "ready") {
    return null;
  }
  const usableWindows = usage.windows.filter((window) => typeof window.usedPercent === "number");
  return usableWindows.find((window) => window.windowDurationMins === 5 * 60)
    ?? usableWindows
      .slice()
      .sort((left, right) => (left.windowDurationMins ?? Number.MAX_SAFE_INTEGER) - (right.windowDurationMins ?? Number.MAX_SAFE_INTEGER))[0]
    ?? null;
};

export const resolveBasicAutomationUsagePause = (
  usage: UsageSnapshot,
  provider: AiProvider,
  threshold: number,
): { allowed: true } | { allowed: false; state: "waiting_for_usage" | "blocked"; summary: string; pausedUntil: string | null } => {
  const providerUsage = provider === "claude" ? usage.claude : usage.codex;
  const window = resolveShortUsageWindow(providerUsage);
  const providerLabel = provider === "claude" ? "Claude" : "Codex";
  if (!window || typeof window.usedPercent !== "number") {
    return {
      allowed: false,
      state: "blocked",
      summary: `${providerLabel} usage is unavailable, so automation paused instead of risking excess usage.`,
      pausedUntil: null,
    };
  }

  if (window.usedPercent < threshold) {
    return { allowed: true };
  }

  const resetTime = window.resetsAt ? new Date(window.resetsAt).getTime() : NaN;
  const pausedUntil = Number.isFinite(resetTime)
    ? new Date(resetTime + BASIC_AUTOMATION_RESET_BUFFER_MS).toISOString()
    : null;
  return {
    allowed: false,
    state: pausedUntil ? "waiting_for_usage" : "blocked",
    summary: pausedUntil
      ? `${providerLabel} ${window.label} usage is at ${window.usedPercent}%, so automation is waiting for the next reset.`
      : `${providerLabel} usage is at ${window.usedPercent}%, but PROGRAMS could not read the reset time.`,
    pausedUntil,
  };
};
