import type { ReasoningEffort } from "@shared/types";
import { z } from "zod";
import { mapClaudeOneShotEffortLevel } from "./one-shot-runtime.ts";

export interface ClaudeUsageWindowData {
  label: string;
  usedPercent: number;
  resetsAt: string | null;
  windowDurationMins: number | null;
}

export const CLAUDE_USAGE_RATE_LIMITS_ENV = "PROGRAMS_CLAUDE_RATE_LIMITS_FILE";
export const CLAUDE_USAGE_STATUS_LINE_COMMAND =
  `/bin/sh -c 'cat >> "$PROGRAMS_CLAUDE_RATE_LIMITS_FILE"; printf "\\n" >> "$PROGRAMS_CLAUDE_RATE_LIMITS_FILE"'`;

const claudeRateLimitWindowSchema = z.object({
  used_percentage: z.number(),
  resets_at: z.number().int().nonnegative().nullable().optional().catch(null),
});

const claudeRateLimitsSchema = z
  .object({
    five_hour: claudeRateLimitWindowSchema.nullable().optional().catch(null),
    seven_day: claudeRateLimitWindowSchema.nullable().optional().catch(null),
  })
  .nullable()
  .optional()
  .catch(null);

const claudeStatusLineSchema = z
  .object({
    rate_limits: claudeRateLimitsSchema.optional().catch(null),
  })
  .passthrough();

const clampPercent = (value: number): number => Math.min(100, Math.max(0, Math.round(value)));

const toIsoTimestamp = (unixSeconds: number | null | undefined): string | null =>
  typeof unixSeconds === "number" ? new Date(unixSeconds * 1000).toISOString() : null;

const formatUsageWindowLabel = (windowDurationMins: number): string => {
  if (windowDurationMins % (60 * 24) === 0) {
    return `${windowDurationMins / (60 * 24)}-day window`;
  }

  if (windowDurationMins % 60 === 0) {
    return `${windowDurationMins / 60}-hour window`;
  }

  return `${windowDurationMins}-minute window`;
};

const buildUsageWindow = (
  windowDurationMins: number,
  rateLimitWindow: z.infer<typeof claudeRateLimitWindowSchema> | null | undefined,
): ClaudeUsageWindowData | null => {
  if (!rateLimitWindow) {
    return null;
  }

  return {
    label: formatUsageWindowLabel(windowDurationMins),
    usedPercent: clampPercent(rateLimitWindow.used_percentage),
    resetsAt: toIsoTimestamp(rateLimitWindow.resets_at ?? null),
    windowDurationMins,
  };
};

export const parseClaudeStatusLineUsageWindows = (raw: string): ClaudeUsageWindowData[] | null => {
  let latestWindows: ClaudeUsageWindowData[] | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = claudeStatusLineSchema.parse(JSON.parse(trimmed));
      const windows = [
        buildUsageWindow(5 * 60, parsed.rate_limits?.five_hour),
        buildUsageWindow(7 * 24 * 60, parsed.rate_limits?.seven_day),
      ].filter((window): window is ClaudeUsageWindowData => Boolean(window));

      if (windows.length > 0) {
        latestWindows = windows;
      }
    } catch {
      // Ignore partial writes and unrelated status line payloads.
    }
  }

  return latestWindows;
};

export const buildClaudeUsageProbeSettingsArg = (reasoningEffort: ReasoningEffort = "low"): string =>
  JSON.stringify({
    effortLevel: mapClaudeOneShotEffortLevel(reasoningEffort),
    statusLine: {
      type: "command",
      command: CLAUDE_USAGE_STATUS_LINE_COMMAND,
      padding: 0,
    },
  });
