import { z } from "zod";
import type { ClaudeAuthStatus } from "@shared/types";

export interface ClaudeLocalAuthMetadata {
  loggedIn: boolean;
  email: string | null;
  displayName: string | null;
  planType: string | null;
}

export interface ClaudeCliFeatures {
  supportsAuthCommands: boolean;
  supportsStreamJsonVerbose: boolean;
}

const claudeLocalAuthSchema = z.object({
  oauthAccount: z
    .object({
      emailAddress: z.string().trim().min(1).nullable().optional().catch(null),
      displayName: z.string().trim().min(1).nullable().optional().catch(null),
      billingType: z.string().trim().min(1).nullable().optional().catch(null),
    })
    .nullable()
    .optional()
    .catch(null),
});

const formatBillingType = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  if (value === "stripe_subscription") {
    return "Subscription";
  }

  return value
    .split(/[_-]+/)
    .map((part) => (part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
};

export const parseClaudeLocalAuthMetadata = (raw: string): ClaudeLocalAuthMetadata => {
  const parsed = claudeLocalAuthSchema.parse(JSON.parse(raw));
  const account = parsed.oauthAccount;
  return {
    loggedIn: Boolean(account?.emailAddress),
    email: account?.emailAddress ?? null,
    displayName: account?.displayName ?? null,
    planType: formatBillingType(account?.billingType ?? null),
  };
};

export const parseClaudeCliFeatures = (helpText: string): ClaudeCliFeatures => ({
  supportsAuthCommands: /^\s+auth(?:\s{2,}|\s*$)/m.test(helpText),
  supportsStreamJsonVerbose:
    /--output-format\s+<format>/.test(helpText) &&
    /--verbose\b/.test(helpText) &&
    /--print\b/.test(helpText),
});

export interface BuildClaudeAuthStatusInput {
  available: boolean;
  binaryPath: string | null;
  version: string | null;
  localAuth: ClaudeLocalAuthMetadata | null;
  features: ClaudeCliFeatures | null;
}

export const buildClaudeAuthStatus = ({
  available,
  binaryPath,
  version,
  localAuth,
  features,
}: BuildClaudeAuthStatusInput): ClaudeAuthStatus => {
  if (!available) {
    return {
      available: false,
      loggedIn: false,
      ready: false,
      canConnect: false,
      binaryPath: null,
      version: null,
      email: null,
      displayName: null,
      planType: null,
      errorMessage: "Claude Code CLI is not installed.",
      runtimeErrorMessage: null,
      connectErrorMessage: null,
    };
  }

  const loggedIn = Boolean(localAuth?.loggedIn);
  const ready = loggedIn && Boolean(features?.supportsStreamJsonVerbose);
  const canConnect = Boolean(features?.supportsAuthCommands);
  const runtimeErrorMessage =
    loggedIn && !ready ? "Update Claude Code to use Claude from PROGRAMS." : null;
  const connectErrorMessage =
    !loggedIn && !canConnect ? "Update Claude Code to connect your Claude account from PROGRAMS." : null;

  return {
    available: true,
    loggedIn,
    ready,
    canConnect,
    binaryPath,
    version,
    email: localAuth?.email ?? null,
    displayName: localAuth?.displayName ?? null,
    planType: localAuth?.planType ?? null,
    errorMessage:
      runtimeErrorMessage ??
      connectErrorMessage ??
      (loggedIn ? null : "Claude Code is not signed in."),
    runtimeErrorMessage,
    connectErrorMessage,
  };
};

export interface BuildClaudePrintArgsInput {
  prompt: string;
  model: string;
  settingsArg?: string | null;
  maxTurns: number;
  allowedTools?: string | null;
}

export const buildClaudePrintArgs = ({
  prompt,
  model,
  settingsArg = null,
  maxTurns,
  allowedTools = null,
}: BuildClaudePrintArgsInput): string[] => [
  "-p",
  prompt,
  "--model",
  model,
  ...(settingsArg ? ["--settings", settingsArg] : []),
  "--print",
  "--verbose",
  "--max-turns",
  String(maxTurns),
  "--output-format",
  "stream-json",
  ...(allowedTools ? ["--allowedTools", allowedTools] : []),
];
