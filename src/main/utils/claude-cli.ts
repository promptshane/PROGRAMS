import { z } from "zod";
import type { ClaudeAuthStatus } from "@shared/types";

export interface ClaudeLocalAuthMetadata {
  loggedIn: boolean;
  email: string | null;
  displayName: string | null;
  planType: string | null;
}

export interface ClaudeCliAuthMetadata {
  loggedIn: boolean;
  authMethod: string | null;
  apiProvider: string | null;
}

export interface ClaudeCliFeatures {
  supportsAuthCommands: boolean;
  supportsStreamJsonVerbose: boolean;
  supportsJsonSchema: boolean;
  supportsPermissionMode: boolean;
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

const claudeCliAuthSchema = z.object({
  loggedIn: z.boolean().catch(false),
  authMethod: z.string().trim().min(1).nullable().optional().catch(null),
  apiProvider: z.string().trim().min(1).nullable().optional().catch(null),
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

export const parseClaudeCliAuthMetadata = (raw: string): ClaudeCliAuthMetadata => {
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  const jsonPayload =
    jsonStart >= 0 && jsonEnd > jsonStart
      ? trimmed.slice(jsonStart, jsonEnd + 1)
      : trimmed;
  const parsed = claudeCliAuthSchema.parse(JSON.parse(jsonPayload));
  return {
    loggedIn: parsed.loggedIn,
    authMethod: parsed.authMethod ?? null,
    apiProvider: parsed.apiProvider ?? null,
  };
};

export const parseClaudeCliFeatures = (helpText: string): ClaudeCliFeatures => ({
  supportsAuthCommands: /^\s+auth(?:\s{2,}|\s*$)/m.test(helpText),
  supportsStreamJsonVerbose:
    /--output-format\s+<format>/.test(helpText) &&
    /--verbose\b/.test(helpText) &&
    /--print\b/.test(helpText),
  supportsJsonSchema: /--json-schema\b/.test(helpText),
  supportsPermissionMode: /--permission-mode\b/.test(helpText),
});

export interface BuildClaudeAuthStatusInput {
  available: boolean;
  binaryPath: string | null;
  version: string | null;
  cliAuth: ClaudeCliAuthMetadata | null;
  localAuth: ClaudeLocalAuthMetadata | null;
  features: ClaudeCliFeatures | null;
}

export const buildClaudeAuthStatus = ({
  available,
  binaryPath,
  version,
  cliAuth,
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

  const loggedIn = Boolean(cliAuth?.loggedIn);
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
    email: loggedIn ? localAuth?.email ?? null : null,
    displayName: loggedIn ? localAuth?.displayName ?? null : null,
    planType: loggedIn ? localAuth?.planType ?? null : null,
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
  jsonSchema?: Record<string, unknown> | null;
  permissionMode?: string | null;
}

export const buildClaudePrintArgs = ({
  prompt,
  model,
  settingsArg = null,
  maxTurns,
  allowedTools = null,
  jsonSchema = null,
  permissionMode = null,
}: BuildClaudePrintArgsInput): string[] => [
  "-p",
  prompt,
  "--model",
  model,
  ...(settingsArg ? ["--settings", settingsArg] : []),
  ...(jsonSchema ? ["--json-schema", JSON.stringify(jsonSchema)] : []),
  ...(permissionMode ? ["--permission-mode", permissionMode] : []),
  "--print",
  "--verbose",
  "--max-turns",
  String(maxTurns),
  "--output-format",
  "stream-json",
  ...(allowedTools ? ["--allowedTools", allowedTools] : []),
];
