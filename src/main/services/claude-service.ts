import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import readline from "node:readline";
import { z } from "zod";
import {
  buildClaudeAuthStatus,
  buildClaudePrintArgs,
  type ClaudeCliAuthMetadata,
  type ClaudeCliFeatures,
  type ClaudeLocalAuthMetadata,
  parseClaudeCliAuthMetadata,
  parseClaudeCliFeatures,
  parseClaudeLocalAuthMetadata,
} from "../utils/claude-cli.ts";
import { execCommand, getCommandEnv } from "../utils/process.ts";
import { buildClaudeOneShotSettingsArg, resolveOneShotReasoningEffort } from "../utils/one-shot-runtime.ts";
import {
  CLAUDE_USAGE_RATE_LIMITS_ENV,
  buildClaudeUsageProbeSettingsArg,
  parseClaudeStatusLineUsageWindows,
  type ClaudeUsageWindowData,
} from "../utils/claude-usage.ts";
import type {
  ClaudeConnectionTestResult,
  ClaudeAuthStatus,
  PlanDraft,
  ProviderUsage,
  Project,
  ReasoningEffort,
  Settings,
  StartPlanInput,
} from "../../shared/types.ts";

type Emit = (
  event:
    | { type: "project.plan"; projectId: string; plan: PlanDraft | null }
    | { type: "auth.claude"; status: ClaudeAuthStatus }
    | { type: "auth.claude.codePrompt"; prompt: string }
    | { type: "toast"; level: "info" | "success" | "error"; message: string },
) => void;

interface ExecutionPayload {
  draft: PlanDraft;
  summary: string;
  description: string;
  commitMessage: string;
}

interface ClaudeUsageProbeResult {
  windows: ClaudeUsageWindowData[] | null;
  note: string | null;
}

const planOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "impact"],
  properties: {
    summary: { type: "string" },
    impact: { type: "string" },
  },
};

const executionOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "description", "commitMessage"],
  properties: {
    summary: { type: "string" },
    description: { type: "string" },
    commitMessage: { type: "string" },
  },
};

const planResultSchema = z.object({
  summary: z.string(),
  impact: z.string(),
});

const executionResultSchema = z.object({
  summary: z.string(),
  description: z.string(),
  commitMessage: z.string(),
});

const baseDeveloperInstructions = `
You are Claude operating inside PROGRAMS, a desktop control panel for AI-assisted coding.

Rules:
- Keep user-facing explanations concise and plain English.
- Never talk about git concepts like commit, push, branch, or rebase unless explicitly asked.
- Respect the project root as the only writable code area.
- When asked to plan, do not make file changes.
- When asked to execute, make the requested code changes directly in the project.
- Produce brief, clear summaries that non-technical users can understand.
`.trim();

const CLAUDE_USAGE_PROBE_PROMPT = "Reply with exactly OK.";
const CLAUDE_USAGE_PTY_SCRIPT_PATH = "/usr/bin/script";
const CLAUDE_FIRST_RUN_SETUP_NOTE =
  "Complete Claude Code's first-run terminal setup once in a real terminal to enable live usage bars in PROGRAMS.";
const CLAUDE_FIRST_RUN_SETUP_PATTERNS = [
  /let'?s get started/i,
  /choose the text style/i,
  /choose the theme/i,
];

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const formatContextPaths = (contextPaths: string[]): string =>
  contextPaths.length
    ? `Priority files and folders for this turn:\n${contextPaths.map((path) => `- ${path}`).join("\n")}`
    : "No extra files were selected for this turn.";

const formatSkillInstructions = (value: string | null | undefined): string =>
  value?.trim() ? `Attached skill:\n${value.trim()}\n` : "";

const buildPlanningPrompt = (
  project: Project,
  prompt: string,
  contextPaths: string[],
  skillInstructions: string | null,
  coreDetailsContext?: string | null,
  promptOnlyJsonFallback = true,
): string => `
${baseDeveloperInstructions}

${formatSkillInstructions(skillInstructions)}

Plan a change for the project "${project.name}".

Current project description:
${project.description}

${coreDetailsContext ? `${coreDetailsContext}\n\n` : ""}Requested change:
${prompt}

${formatContextPaths(contextPaths)}

Instructions:
- Explore the codebase as needed.
- Do not change any files.
- Produce a concise implementation plan.
- Include the expected user-visible impact.
${promptOnlyJsonFallback
    ? '- Your final answer must be ONLY strict JSON (no markdown fences) matching this schema:\n  {"summary": string, "impact": string}'
    : ""}
`.trim();

const buildExecutionPrompt = async (
  project: Project,
  draft: PlanDraft,
  promptOnlyJsonFallback = true,
): Promise<string> => `
${baseDeveloperInstructions}

${formatSkillInstructions(draft.skillInstructions)}

Implement the approved update for "${project.name}".

Original request:
${draft.prompt}

Approved plan:
${draft.explanation}

Plan steps:
${draft.steps.map((step) => `- ${step.step}`).join("\n") || "- Use the approved plan above."}

${formatContextPaths(draft.contextPaths)}

${draft.coreDetailsContext ? `${draft.coreDetailsContext}\n\n` : ""}Requirements:
- Make the code changes now.
- Keep the project description current and user-facing.
${promptOnlyJsonFallback
    ? '- Your final answer must be ONLY strict JSON (no markdown fences) matching this schema:\n  {"summary": string, "description": string, "commitMessage": string}'
    : ""}
- The summary must be one or two short sentences for the update history.
- The commitMessage must be short and action-oriented.
`.trim();

const parseNumstatDiffStats = (stdout: string): PlanDraft["diffStats"] => {
  let added = 0;
  let removed = 0;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [addedRaw, removedRaw] = trimmed.split("\t");
    if (!addedRaw || !removedRaw || addedRaw === "-" || removedRaw === "-") {
      continue;
    }

    const nextAdded = Number(addedRaw);
    const nextRemoved = Number(removedRaw);
    if (!Number.isFinite(nextAdded) || !Number.isFinite(nextRemoved)) {
      continue;
    }

    added += nextAdded;
    removed += nextRemoved;
  }

  return added || removed ? { added, removed } : null;
};

const mergeStreamingExplanation = (current: string, incoming: string): string => {
  if (!incoming.trim()) {
    return current;
  }

  const next = incoming;
  if (!current) {
    return next;
  }

  if (next.includes(current)) {
    return next;
  }

  if (current.endsWith(next) || current.includes(next)) {
    return current;
  }

  return `${current}${next}`;
};

const cleanClaudeProcessMessage = (value: string): string | null => {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  return lines.find((line) => /^(error:|Error:)/.test(line)) ?? lines.at(-1) ?? null;
};

const stripAnsi = (value: string): string =>
  value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");

const CLAUDE_WRAPPER_KEYS = new Set([
  "apiKeySource",
  "agents",
  "claude_code_version",
  "container",
  "content",
  "context_management",
  "cwd",
  "delta",
  "duration_api_ms",
  "duration_ms",
  "error",
  "errors",
  "fast_mode_state",
  "id",
  "input_tokens",
  "is_error",
  "mcp_servers",
  "message",
  "model",
  "modelUsage",
  "num_turns",
  "output_style",
  "parent_tool_use_id",
  "permissionMode",
  "permission_denials",
  "plugins",
  "result",
  "role",
  "session_id",
  "skills",
  "slash_commands",
  "stop_reason",
  "stop_sequence",
  "subtype",
  "tools",
  "total_cost_usd",
  "type",
  "usage",
  "uuid",
]);

const CLAUDE_CONTAINER_KEYS = ["result", "input", "output", "data", "value"] as const;

const extractClaudeTextBlocks = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      if (!entry || typeof entry !== "object") {
        return "";
      }

      const candidate = entry as { type?: string; text?: unknown; content?: unknown };
      if (candidate.type === "text" && typeof candidate.text === "string") {
        return candidate.text;
      }

      if (typeof candidate.text === "string") {
        return candidate.text;
      }

      if (typeof candidate.content === "string") {
        return candidate.content;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
};

const extractClaudeEventText = (event: {
  content?: unknown;
  message?: { content?: unknown } | null;
  delta?: { text?: unknown } | null;
}): string => {
  if (typeof event.delta?.text === "string") {
    return event.delta.text;
  }

  const direct = extractClaudeTextBlocks(event.content);
  if (direct) {
    return direct;
  }

  if (typeof event.content === "string") {
    return event.content;
  }

  const messageContent = event.message?.content;
  const fromMessage = extractClaudeTextBlocks(messageContent);
  if (fromMessage) {
    return fromMessage;
  }

  return typeof messageContent === "string" ? messageContent : "";
};

const isLikelyJsonResponse = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("```");
};

const isStructuredPayloadRecord = (value: Record<string, unknown>): boolean => {
  if (value.type === "text" && typeof value.text === "string") {
    return false;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    return false;
  }

  if (keys.some((key) => CLAUDE_CONTAINER_KEYS.includes(key as typeof CLAUDE_CONTAINER_KEYS[number]))) {
    return false;
  }

  return !keys.every((key) => CLAUDE_WRAPPER_KEYS.has(key));
};

const extractClaudeStructuredPayloadCandidate = (value: unknown, depth = 0): unknown | null => {
  if (value == null || depth > 6) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim() && isLikelyJsonResponse(value) ? value : null;
  }

  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const candidate = extractClaudeStructuredPayloadCandidate(value[index], depth + 1);
      if (candidate !== null) {
        return candidate;
      }
    }
    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  for (const key of CLAUDE_CONTAINER_KEYS) {
    const candidate = extractClaudeStructuredPayloadCandidate(record[key], depth + 1);
    if (candidate !== null) {
      return candidate;
    }
  }

  if (isStructuredPayloadRecord(record)) {
    return record;
  }

  return (
    extractClaudeStructuredPayloadCandidate(record.content, depth + 1)
    ?? extractClaudeStructuredPayloadCandidate(record.message, depth + 1)
    ?? extractClaudeStructuredPayloadCandidate(record.text, depth + 1)
  );
};

const describeClaudeResultEvent = (event: {
  result?: unknown;
  content?: unknown;
  message?: { content?: unknown } | null;
}): string => {
  const summarize = (value: unknown): string => {
    if (value == null) {
      return "null";
    }
    if (Array.isArray(value)) {
      return `array(${value.length})`;
    }
    if (typeof value === "object") {
      return `object(${Object.keys(value as Record<string, unknown>).slice(0, 5).join(",")})`;
    }
    return typeof value;
  };

  return `result=${summarize(event.result)}, content=${summarize(event.content)}, message.content=${summarize(event.message?.content)}`;
};

const extractClaudeResultEventError = (event: {
  errors?: unknown;
  result?: unknown;
  content?: unknown;
  message?: { content?: unknown } | null;
}): string | null => {
  if (Array.isArray(event.errors)) {
    for (const entry of event.errors) {
      if (typeof entry === "string" && entry.trim()) {
        return entry.trim();
      }
    }
  }

  if (typeof event.result === "string" && event.result.trim()) {
    return event.result.trim();
  }

  const text = extractClaudeEventText(event);
  return text.trim() || null;
};

const extractClaudeResultPayload = (event: {
  result?: unknown;
  content?: unknown;
  message?: { content?: unknown } | null;
  delta?: { text?: unknown } | null;
}): unknown | null => {
  if (typeof event.result === "string" && event.result.trim()) {
    return event.result;
  }

  if (event.result && typeof event.result === "object") {
    return event.result;
  }

  return (
    extractClaudeStructuredPayloadCandidate(event.content)
    ?? extractClaudeStructuredPayloadCandidate(event.message?.content)
    ?? (() => {
      const text = extractClaudeEventText(event);
      return text.trim() && isLikelyJsonResponse(text) ? text : null;
    })()
  );
};

const stringifyStructuredPayload = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

const formatStructuredOutputError = (providerLabel: string, error: unknown): string => {
  if (error instanceof z.ZodError) {
    const issues = error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "result"}: ${issue.message}`)
      .join("; ");
    return `${providerLabel} returned invalid structured output${issues ? `: ${issues}` : "."}`;
  }

  if (error instanceof SyntaxError) {
    return `${providerLabel} returned malformed JSON output.`;
  }

  return error instanceof Error ? error.message : `${providerLabel} returned an unexpected result.`;
};

const parseStructuredPayload = <T>(
  providerLabel: string,
  payload: unknown,
  schema: z.ZodType<T>,
): { parsed: T; finalText: string } => {
  try {
    const normalized = typeof payload === "string" ? parseJsonFromText(payload) : payload;
    return {
      parsed: schema.parse(normalized),
      finalText: stringifyStructuredPayload(payload),
    };
  } catch (error) {
    throw new Error(formatStructuredOutputError(providerLabel, error));
  }
};


export class ClaudeService {
  private readonly planDrafts = new Map<string, PlanDraft>();
  private readonly activeProcesses = new Map<string, ChildProcess>();
  private readonly pendingDiffRefresh = new Set<string>();
  private readonly cliFeaturesCache = new Map<string, ClaudeCliFeatures | null>();
  private pendingLoginStdin: import("stream").Writable | null = null;
  private readonly emit: Emit;
  private readonly openExternal?: (url: string) => Promise<void>;

  constructor(emit: Emit, openExternal?: (url: string) => Promise<void>) {
    this.emit = emit;
    this.openExternal = openExternal;
  }

  getActivePlan(projectId: string): PlanDraft | null {
    return this.planDrafts.get(projectId) ?? null;
  }

  syncDraft(draft: PlanDraft): void {
    draft.lastUpdatedAt = new Date().toISOString();
    this.planDrafts.set(draft.projectId, draft);
    this.emit({ type: "project.plan", projectId: draft.projectId, plan: { ...draft } });
  }

  clearPlan(projectId: string): void {
    this.planDrafts.delete(projectId);
    this.emit({ type: "project.plan", projectId, plan: null });
  }

  createDirectExecutionDraft(project: Project, input: StartPlanInput): PlanDraft {
    const draft: PlanDraft = {
      projectId: project.id,
      provider: "claude",
      threadId: null,
      turnId: null,
      prompt: input.prompt,
      speed: input.speed,
      model: input.model,
      claudeModel: input.claudeModel,
      reasoningEffort: input.reasoningEffort,
      planningMode: input.planningMode,
      autoApprove: input.autoApprove,
      contextPaths: [...input.contextPaths],
      skillInstructions: input.skillInstructions ?? null,
      coreDetailsContext: input.coreDetailsContext ?? null,
      pingTaskSnapshot: input.pingTaskSnapshot ?? null,
      status: "executing",
      thinkingStatus: "in_progress",
      planningStatus: "skipped",
      buildingStatus: "pending",
      verifyingStatus: "pending",
      explanation: "Claude is working directly without a draft plan.",
      steps: [],
      summary: null,
      impact: null,
      diff: null,
      diffStats: null,
      finalText: null,
      verificationDetails: null,
      errorMessage: null,
      lastUpdatedAt: new Date().toISOString(),
    };

    this.syncDraft(draft);
    return draft;
  }

  async getUsage(settings: Settings): Promise<ProviderUsage> {
    const auth = await this.getAuthStatus(settings);
    let liveUsageNote: string | null = null;

    if (auth.available && auth.loggedIn && auth.binaryPath) {
      const liveUsage = await this.readUsageWindows(auth.binaryPath, settings);
      liveUsageNote = liveUsage.note;
      const liveWindows = liveUsage.windows;
      if (liveWindows && liveWindows.length > 0) {
        return {
          status: "ready",
          windows: liveWindows.map((w) => ({
            label: w.label,
            usedPercent: w.usedPercent,
            valueLabel: null,
            detail: null,
            resetsAt: w.resetsAt,
            windowDurationMins: w.windowDurationMins,
          })),
          note: null,
        };
      }
    }

    if (!auth.available) {
      return {
        status: "requiresInstall",
        windows: [],
        note: "Install Claude Code to see connection status here.",
      };
    }

    if (!auth.loggedIn) {
      return {
        status: "requiresLogin",
        windows: [],
        note: auth.connectErrorMessage ?? "Connect Claude to use Claude from PROGRAMS.",
      };
    }

    if (!auth.ready) {
      return {
        status: "unsupported",
        windows: [],
        note: auth.runtimeErrorMessage ?? "PROGRAMS needs a newer Claude Code install before Claude can run here.",
      };
    }

    return {
      status: "unsupported",
      windows: [],
      note: liveUsageNote ?? "Live Claude usage bars are unavailable from this Claude Code session.",
    };
  }

  async getAuthStatus(settings: Settings): Promise<ClaudeAuthStatus> {
    const binaryPath = await this.detectBinaryPath(settings);
    if (!binaryPath) {
      return buildClaudeAuthStatus({
        available: false,
        binaryPath: null,
        version: null,
        cliAuth: null,
        localAuth: null,
        features: null,
      });
    }

    const [versionResult, cliAuth, localAuth, features] = await Promise.all([
      execCommand(`"${binaryPath}" --version`, process.cwd()),
      this.readCliAuthMetadata(binaryPath),
      this.readLocalAuthMetadata(),
      this.getCliFeatures(binaryPath),
    ]);

    return buildClaudeAuthStatus({
      available: true,
      binaryPath,
      version:
        versionResult.code === 0
          ? versionResult.stdout.trim() || versionResult.stderr.trim() || null
          : null,
      cliAuth,
      localAuth,
      features,
    });
  }

  async testConnection(settings: Settings, model: string): Promise<ClaudeConnectionTestResult> {
    await this.requireReadyStatus(settings);
    const project: Project = {
      id: "__claude-test__",
      name: "PROGRAMS",
      iconColor: "#64748B",
      description: "PROGRAMS self-test",
      localPath: process.cwd(),
      threadId: null,
      lastUpdatedAt: null,
      status: "idle",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runtimeConfig: {
        packageManager: "unknown",
        installCommand: null,
        runCommand: null,
        openUrl: null,
        lastRunUrl: null,
        initialIdea: null,
      },
      lastError: null,
    };

    try {
      const raw = await this.runOneShot(project, settings, "Reply with exactly: OK", model);
      const normalized = raw.trim();
      if (normalized === "OK") {
        return {
          ok: true,
          model,
          message: `Claude responded correctly with ${model}.`,
          raw: normalized,
        };
      }

      return {
        ok: false,
        model,
        message: `Claude responded, but the test output was unexpected for ${model}.`,
        raw: normalized,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Claude test failed.";
      return {
        ok: false,
        model,
        message,
        raw: null,
      };
    }
  }

  private async getCliFeatures(binaryPath: string): Promise<ClaudeCliFeatures | null> {
    if (this.cliFeaturesCache.has(binaryPath)) {
      return this.cliFeaturesCache.get(binaryPath) ?? null;
    }

    const features = await this.readCliFeatures(binaryPath);
    this.cliFeaturesCache.set(binaryPath, features);
    return features;
  }

  async installPlugin(settings: Settings, pluginSlug: string): Promise<string | null> {
    const status = await this.getAuthStatus(settings);
    if (!status.available || !status.binaryPath) {
      throw new Error("Install Claude Code before installing Claude plugins in PROGRAMS.");
    }
    if (!status.loggedIn) {
      throw new Error("Connect Claude before installing Claude plugins in PROGRAMS.");
    }

    const installResult = await execCommand(`"${status.binaryPath}" plugins install ${pluginSlug}`, process.cwd());
    const combinedOutput = `${installResult.stdout}\n${installResult.stderr}`.trim().toLowerCase();
    if (installResult.code !== 0 && !combinedOutput.includes("already installed")) {
      throw new Error(installResult.stderr.trim() || installResult.stdout.trim() || `Claude could not install the ${pluginSlug} plugin.`);
    }

    const plugins = await this.listPlugins(settings);
    const installed = plugins.find((plugin) => plugin.slug === pluginSlug);
    return installed?.path ?? null;
  }

  async listPlugins(settings: Settings): Promise<Array<{ slug: string; path: string | null }>> {
    const status = await this.getAuthStatus(settings);
    if (!status.available || !status.binaryPath) {
      return [];
    }

    const listResult = await execCommand(`"${status.binaryPath}" plugins list --json`, process.cwd());
    const output = `${listResult.stdout}\n${listResult.stderr}`.trim();
    if (!output) {
      return [];
    }

    try {
      const parsed = JSON.parse(output) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }

        const record = entry as Record<string, unknown>;
        const slugCandidate = record.slug ?? record.name ?? record.id;
        if (typeof slugCandidate !== "string" || !slugCandidate.trim()) {
          return [];
        }

        const pathCandidate =
          typeof record.path === "string"
            ? record.path
            : typeof record.installPath === "string"
              ? record.installPath
              : null;

        return [{
          slug: slugCandidate.trim(),
          path: pathCandidate,
        }];
      });
    } catch {
      return [];
    }
  }

  async login(settings: Settings): Promise<ClaudeAuthStatus> {
    const current = await this.getAuthStatus(settings);
    if (!current.available || !current.binaryPath) {
      throw new Error("Install Claude Code CLI before signing in. Run: npm install -g @anthropic-ai/claude-code");
    }
    const binaryPath = current.binaryPath;

    if (current.loggedIn && current.ready) {
      this.emit({ type: "auth.claude", status: current });
      return current;
    }

    if (!current.canConnect) {
      throw new Error(current.connectErrorMessage ?? "Update Claude Code to connect your Claude account from PROGRAMS.");
    }

    const commandEnv = await getCommandEnv();
    const child = spawn(binaryPath, ["auth", "login"], {
      env: commandEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Auto-confirm any re-authentication prompt from the CLI, then keep stdin
    // open so we can forward an auth code if the CLI falls back to device auth.
    child.stdin.write("y\n");
    this.pendingLoginStdin = child.stdin;

    // Capture stdout/stderr and intercept the OAuth URL so we can open it
    // reliably via Electron's shell (the CLI's own `open` call may fail
    // silently inside a subprocess spawned by an Electron app).
    // Also detect device-auth code prompts so the user can enter the code in
    // the PROGRAMS Settings UI.
    const urlPattern = /https?:\/\/[^\s"'<>]+/;
    const codePromptPattern = /enter.*code|authorization.*code|paste.*code|auth.*code/i;
    let urlOpened = false;

    const processLine = (line: string): void => {
      if (!urlOpened && this.openExternal) {
        const match = line.match(urlPattern);
        if (match) {
          urlOpened = true;
          this.emit({ type: "toast", level: "info", message: "Opening Claude sign-in in your browser." });
          void this.openExternal(match[0]);
        }
      }
      if (codePromptPattern.test(line)) {
        this.emit({ type: "auth.claude.codePrompt", prompt: line.trim() });
      }
    };

    readline.createInterface({ input: child.stdout }).on("line", processLine);
    readline.createInterface({ input: child.stderr }).on("line", processLine);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        this.pendingLoginStdin = null;
        reject(new Error("Claude sign-in timed out. Try again."));
      }, 120000);

      child.on("exit", (code) => {
        clearTimeout(timeout);
        this.pendingLoginStdin = null;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error("Claude sign-in failed. Try again."));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        this.pendingLoginStdin = null;
        reject(err);
      });
    });

    const status = await this.getAuthStatus(settings);
    if (!status.loggedIn) {
      throw new Error("Claude sign-in did not complete. Try again.");
    }
    if (!status.ready) {
      throw new Error(status.runtimeErrorMessage ?? "Claude signed in, but PROGRAMS still cannot run it.");
    }
    this.emit({ type: "auth.claude", status });
    return status;
  }

  submitLoginCode(code: string): void {
    if (this.pendingLoginStdin) {
      this.pendingLoginStdin.write(code.trim() + "\n");
      this.pendingLoginStdin.end();
      this.pendingLoginStdin = null;
    }
  }

  async logout(settings: Settings): Promise<ClaudeAuthStatus> {
    const current = await this.getAuthStatus(settings);
    if (!current.available || !current.binaryPath) {
      return this.getAuthStatus(settings);
    }
    const binaryPath = current.binaryPath;

    const command = current.canConnect ? `"${binaryPath}" auth logout` : `"${binaryPath}" logout`;
    await execCommand(command, process.cwd());

    const status = await this.getAuthStatus(settings);
    this.emit({ type: "auth.claude", status });
    return status;
  }

  async runOneShot(
    project: Project,
    settings: Settings,
    prompt: string,
    model: string,
    outputSchema?: Record<string, unknown>,
    reasoningEffortOverride?: ReasoningEffort,
    options?: { allowedTools?: string; maxTurns?: number },
  ): Promise<string> {
    const status = await this.requireReadyStatus(settings);
    const commandEnv = await getCommandEnv();
    const binaryPath = status.binaryPath!;
    const features = await this.getCliFeatures(binaryPath);
    const reasoningEffort = resolveOneShotReasoningEffort(
      settings.advancedDefaults.reasoningEffort,
      reasoningEffortOverride,
    );
    const supportsNativeJsonSchema = Boolean(outputSchema && features?.supportsJsonSchema);

    let finalPrompt = prompt;
    if (outputSchema && !supportsNativeJsonSchema) {
      finalPrompt += `\n\nIMPORTANT: You MUST respond with ONLY a valid JSON object matching this exact schema. No markdown, no explanation, no code fences — just the raw JSON object.\n\nRequired JSON schema:\n${JSON.stringify(outputSchema, null, 2)}`;
    }

    return new Promise<string>((resolve, reject) => {
      const args = buildClaudePrintArgs({
        prompt: finalPrompt,
        model,
        settingsArg: buildClaudeOneShotSettingsArg(reasoningEffort),
        maxTurns: options?.maxTurns ?? 5,
        allowedTools: options?.allowedTools ?? null,
        jsonSchema: supportsNativeJsonSchema ? outputSchema ?? null : null,
      });

      const child = spawn(binaryPath, args, {
        cwd: project.localPath,
        env: commandEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Close stdin immediately — runOneShot never writes to it.
      child.stdin.end();

      const chunks: string[] = [];
      let stderr = "";

      readline.createInterface({ input: child.stdout }).on("line", (line) => {
        chunks.push(line);
      });

      readline.createInterface({ input: child.stderr }).on("line", (line) => {
        stderr = stderr ? `${stderr}\n${line}` : line;
      });

      child.on("exit", (code) => {
        try {
          if (code !== 0) {
            const msg = this.extractErrorMessage(chunks, stderr) ?? "Claude could not complete the request.";
            console.error("[claude] runOneShot failed (exit code %d): %s", code, msg);
            throw new Error(msg);
          }

          const finalPayload = this.extractFinalResult(chunks);
          resolve(stringifyStructuredPayload(finalPayload));
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Claude returned an unexpected result."));
        }
      });

      child.on("error", (err) => {
        console.error("[claude] runOneShot spawn error:", err.message);
        reject(err);
      });
    });
  }

  previewPlanningPrompt(project: Project, input: StartPlanInput): string {
    return buildPlanningPrompt(
      project,
      input.prompt,
      input.contextPaths,
      input.skillInstructions ?? null,
      input.coreDetailsContext ?? null,
    );
  }

  async startPlanningTurn(project: Project, settings: Settings, input: StartPlanInput): Promise<PlanDraft> {
    const draft: PlanDraft = {
      projectId: project.id,
      provider: "claude",
      threadId: null,
      turnId: null,
      prompt: input.prompt,
      speed: input.speed,
      model: input.model,
      claudeModel: input.claudeModel,
      reasoningEffort: input.reasoningEffort,
      planningMode: input.planningMode,
      autoApprove: input.autoApprove,
      contextPaths: [...input.contextPaths],
      skillInstructions: input.skillInstructions ?? null,
      coreDetailsContext: input.coreDetailsContext ?? null,
      pingTaskSnapshot: input.pingTaskSnapshot ?? null,
      status: "planning",
      thinkingStatus: "in_progress",
      planningStatus: "in_progress",
      buildingStatus: "pending",
      verifyingStatus: "pending",
      explanation: "Claude is building the plan.",
      steps: [],
      summary: null,
      impact: null,
      diff: null,
      diffStats: null,
      finalText: null,
      verificationDetails: null,
      errorMessage: null,
      lastUpdatedAt: new Date().toISOString(),
    };

    this.syncDraft(draft);

    return new Promise<PlanDraft>((resolve, reject) => {
      void (async () => {
        try {
          const status = await this.requireReadyStatus(settings);
          const commandEnv = await getCommandEnv();
          const binaryPath = status.binaryPath!;
          const features = await this.getCliFeatures(binaryPath);
          const supportsNativeJsonSchema = Boolean(features?.supportsJsonSchema);
          const prompt = buildPlanningPrompt(
            project,
            input.prompt,
            input.contextPaths,
            input.skillInstructions ?? null,
            input.coreDetailsContext ?? null,
            !supportsNativeJsonSchema,
          );
          const args = buildClaudePrintArgs({
            prompt,
            model: input.claudeModel,
            settingsArg: buildClaudeOneShotSettingsArg(input.reasoningEffort),
            maxTurns: 5,
            jsonSchema: supportsNativeJsonSchema ? planOutputSchema : null,
            permissionMode: features?.supportsPermissionMode ? "plan" : null,
          });

          const child = spawn(binaryPath, args, {
            cwd: project.localPath,
            env: commandEnv,
            stdio: ["pipe", "pipe", "pipe"],
          });

          this.activeProcesses.set(project.id, child);
          const chunks: string[] = [];
          let stderr = "";

          readline.createInterface({ input: child.stdout }).on("line", (line) => {
            chunks.push(line);
            this.handleStreamEvent(project.id, project.localPath, draft, line);
          });

          readline.createInterface({ input: child.stderr }).on("line", (line) => {
            stderr = stderr ? `${stderr}\n${line}` : line;
          });

          child.on("exit", (code) => {
            this.activeProcesses.delete(project.id);

            try {
              if (code !== 0) {
                throw new Error(this.extractErrorMessage(chunks, stderr) ?? "Claude could not complete the plan.");
              }

              const finalPayload = this.extractFinalResult(chunks);
              const { parsed, finalText } = parseStructuredPayload("Claude", finalPayload, planResultSchema);
              draft.status = "awaitingApproval";
              draft.thinkingStatus = "completed";
              draft.planningStatus = "completed";
              draft.summary = parsed.summary;
              draft.impact = parsed.impact;
              draft.finalText = finalText;
              draft.errorMessage = null;
              this.syncDraft(draft);
              resolve({ ...draft });
            } catch (error) {
              draft.status = "failed";
              draft.thinkingStatus = "failed";
              draft.planningStatus = "failed";
              draft.errorMessage =
                error instanceof Error ? error.message : "Claude returned an unexpected result.";
              this.syncDraft(draft);
              reject(error instanceof Error ? error : new Error("Claude returned an unexpected result."));
            }
          });

          child.on("error", (err) => {
            this.activeProcesses.delete(project.id);
            draft.status = "failed";
            draft.thinkingStatus = "failed";
            draft.planningStatus = "failed";
            draft.errorMessage = err.message;
            this.syncDraft(draft);
            reject(err);
          });
        } catch (error) {
          draft.status = "failed";
          draft.thinkingStatus = "failed";
          draft.planningStatus = "failed";
          draft.errorMessage = error instanceof Error ? error.message : "Claude could not complete the plan.";
          this.syncDraft(draft);
          reject(error instanceof Error ? error : new Error("Claude could not complete the plan."));
        }
      })();
    });
  }

  async executeApprovedPlan(project: Project, settings: Settings, draft: PlanDraft): Promise<ExecutionPayload> {
    const status = await this.requireReadyStatus(settings);
    const commandEnv = await getCommandEnv();
    const binaryPath = status.binaryPath!;
    const features = await this.getCliFeatures(binaryPath);
    const supportsNativeJsonSchema = Boolean(features?.supportsJsonSchema);

    return new Promise<ExecutionPayload>(async (resolve, reject) => {
      const prompt = await buildExecutionPrompt(project, draft, !supportsNativeJsonSchema);
      const args = buildClaudePrintArgs({
        prompt,
        model: draft.claudeModel,
        settingsArg: buildClaudeOneShotSettingsArg(draft.reasoningEffort),
        maxTurns: 20,
        allowedTools: "Edit,Write,Bash(npm install:*),Bash(npx:*),Read,Glob,Grep",
        jsonSchema: supportsNativeJsonSchema ? executionOutputSchema : null,
      });

      const child = spawn(binaryPath, args, {
        cwd: project.localPath,
        env: commandEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.activeProcesses.set(project.id, child);
      const chunks: string[] = [];
      let stderr = "";

      draft.status = "executing";
      if (draft.planningMode === "none") {
        draft.thinkingStatus = "in_progress";
        draft.planningStatus = "skipped";
      } else {
        draft.thinkingStatus = "completed";
        draft.planningStatus = "completed";
      }
      draft.buildingStatus = "in_progress";
      draft.verifyingStatus = "pending";
      draft.errorMessage = null;
      draft.verificationDetails = null;
      this.syncDraft(draft);

      readline.createInterface({ input: child.stdout }).on("line", (line) => {
        chunks.push(line);
        this.handleStreamEvent(project.id, project.localPath, draft, line);
      });

      readline.createInterface({ input: child.stderr }).on("line", (line) => {
        stderr = stderr ? `${stderr}\n${line}` : line;
      });

      child.on("exit", (code) => {
        this.activeProcesses.delete(project.id);

        try {
          if (code !== 0) {
            throw new Error(this.extractErrorMessage(chunks, stderr) ?? "Claude could not finish the update.");
          }

          const finalPayload = this.extractFinalResult(chunks);
          const { parsed, finalText } = parseStructuredPayload("Claude", finalPayload, executionResultSchema);
          draft.status = "executing";
          if (draft.planningMode === "none") {
            draft.thinkingStatus = "completed";
          }
          draft.buildingStatus = "completed";
          draft.verifyingStatus = "in_progress";
          draft.summary = parsed.summary;
          draft.finalText = finalText;
          draft.errorMessage = null;
          draft.verificationDetails = "Saving local changes and update history.";
          this.syncDraft(draft);
          resolve({
            draft: { ...draft },
            summary: parsed.summary,
            description: parsed.description,
            commitMessage: parsed.commitMessage,
          });
        } catch (error) {
          draft.status = "failed";
          draft.buildingStatus = "failed";
          if (draft.planningMode === "none" && draft.thinkingStatus === "in_progress") {
            draft.thinkingStatus = "failed";
          }
          draft.errorMessage =
            error instanceof Error ? error.message : "Claude returned an unexpected result.";
          this.syncDraft(draft);
          reject(error instanceof Error ? error : new Error("Claude returned an unexpected result."));
        }
      });

      child.on("error", (err) => {
        this.activeProcesses.delete(project.id);
        draft.status = "failed";
        draft.buildingStatus = "failed";
        if (draft.planningMode === "none" && draft.thinkingStatus === "in_progress") {
          draft.thinkingStatus = "failed";
        }
        draft.errorMessage = err.message;
        this.syncDraft(draft);
        reject(err);
      });
    });
  }

  async interruptPlan(projectId: string): Promise<void> {
    const child = this.activeProcesses.get(projectId);
    if (child) {
      child.kill("SIGTERM");
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already exited
        }
      }, 3000);
      this.activeProcesses.delete(projectId);
    }
    this.clearPlan(projectId);
  }

  private handleStreamEvent(projectId: string, projectPath: string, draft: PlanDraft, line: string): void {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        subtype?: string;
        content?: unknown;
        delta?: { text?: unknown } | null;
        message?: { content?: unknown } | null;
      };
      const text = extractClaudeEventText(event);

      // Skip non-content events (init, rate limits, etc.)
      if (event.type === "system" || event.type === "rate_limit_event") {
        return;
      }

      // Log errors surfaced in the stream
      if (event.type === "error") {
        const errorText = text || (typeof event.content === "string" ? event.content : "");
        if (errorText) {
          draft.explanation = mergeStreamingExplanation(draft.explanation, `[Claude: ${errorText}]`);
          this.syncDraft(draft);
        }
        return;
      }

      if (event.type === "assistant" && text) {
        draft.explanation = mergeStreamingExplanation(draft.explanation, text);
        if (draft.status === "planning") {
          draft.thinkingStatus = "in_progress";
          draft.planningStatus = "in_progress";
        } else if (draft.status === "executing") {
          draft.buildingStatus = "in_progress";
        }
        this.syncDraft(draft);
        if (draft.status === "executing") {
          void this.refreshDiffStats(projectId, projectPath, draft);
        }
      } else if ((event.type === "content_block_delta" || event.subtype === "text") && text) {
        draft.explanation = mergeStreamingExplanation(draft.explanation, text);
        if (draft.status === "planning") {
          draft.thinkingStatus = "in_progress";
          draft.planningStatus = "in_progress";
        } else if (draft.status === "executing") {
          draft.buildingStatus = "in_progress";
        }
        this.syncDraft(draft);
        if (draft.status === "executing") {
          void this.refreshDiffStats(projectId, projectPath, draft);
        }
      }
    } catch {
      // Non-JSON line — check for plain-text error messages from the CLI
      const trimmed = line.trim();
      if (trimmed && /^(error:|Error:|FATAL|claude:)/i.test(trimmed)) {
        draft.explanation = mergeStreamingExplanation(draft.explanation, `[Claude CLI: ${trimmed}]`);
        this.syncDraft(draft);
      }
    }
  }

  private async refreshDiffStats(projectId: string, projectPath: string, draft: PlanDraft): Promise<void> {
    if (this.pendingDiffRefresh.has(projectId)) {
      return;
    }

    this.pendingDiffRefresh.add(projectId);
    try {
      const result = await execCommand("git diff --numstat", projectPath);
      if (result.code !== 0) {
        return;
      }

      draft.diffStats = parseNumstatDiffStats(result.stdout);
      this.syncDraft(draft);
    } finally {
      this.pendingDiffRefresh.delete(projectId);
    }
  }

  private extractFinalResult(chunks: string[]): unknown {
    let sawResultEvent = false;
    let resultEventSummary: string | null = null;

    for (let i = chunks.length - 1; i >= 0; i--) {
      let event: {
        type?: string;
        result?: unknown;
        is_error?: boolean;
        errors?: unknown;
        content?: unknown;
        delta?: { text?: unknown } | null;
        message?: { content?: unknown } | null;
      };

      try {
        event = JSON.parse(chunks[i]) as typeof event;
      } catch {
        const raw = chunks[i].trim();
        if (raw && isLikelyJsonResponse(raw)) {
          if (sawResultEvent) {
            console.info(
              "[claude] Falling back to raw JSON chunk after empty result event (%s).",
              resultEventSummary ?? "unknown result event shape",
            );
          }
          return raw;
        }
        continue;
      }

      if (event.type === "result") {
        sawResultEvent = true;
        resultEventSummary = describeClaudeResultEvent(event);
        if (event.is_error) {
          throw new Error(extractClaudeResultEventError(event) ?? "Claude returned an error.");
        }
        const payload = extractClaudeResultPayload(event);
        if (payload !== null) {
          return payload;
        }
        continue;
      }

      const payload = extractClaudeStructuredPayloadCandidate(event.content)
        ?? extractClaudeStructuredPayloadCandidate(event.message?.content);
      if (payload !== null) {
        if (sawResultEvent) {
          console.info(
            "[claude] Falling back to earlier structured output after empty result event (%s).",
            resultEventSummary ?? "unknown result event shape",
          );
        }
        return payload;
      }

      const text = extractClaudeEventText(event);
      if (text && isLikelyJsonResponse(text)) {
        if (sawResultEvent) {
          console.info(
            "[claude] Falling back to earlier JSON text after empty result event (%s).",
            resultEventSummary ?? "unknown result event shape",
          );
        }
        return text;
      }
    }

    if (sawResultEvent) {
      console.warn(
        "[claude] Result event had no structured payload and no earlier fallback candidate (%s).",
        resultEventSummary ?? "unknown result event shape",
      );
      throw new Error("Claude returned a result event without a valid payload.");
    }

    // Last resort: forward-scan for any raw JSON object in the chunks
    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      const jsonStart = trimmed.indexOf("{");
      if (jsonStart >= 0) {
        const candidate = trimmed.slice(jsonStart);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          // not valid JSON, continue
        }
      }
    }

    throw new Error("Claude did not return a valid result.");
  }

  private async detectBinaryPath(settings: Settings): Promise<string | null> {
    if (settings.claudeBinaryPath && (await this.isExecutable(settings.claudeBinaryPath))) {
      return settings.claudeBinaryPath;
    }

    // Check PATH
    const result = await execCommand("command -v claude", process.cwd());
    const pathBinary = result.stdout.trim();
    if (result.code === 0 && pathBinary && (await this.isExecutable(pathBinary))) {
      return pathBinary;
    }

    // Check common install locations
    const candidates = [
      "/usr/local/bin/claude",
      `${process.env.HOME}/.local/bin/claude`,
      `${process.env.HOME}/.npm-global/bin/claude`,
      `${process.env.HOME}/.claude/local/bin/claude`,
      `${process.env.HOME}/.claude/bin/claude`,
    ];
    for (const candidate of candidates) {
      if (await this.isExecutable(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private async isExecutable(path: string): Promise<boolean> {
    try {
      await access(path, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async requireReadyStatus(settings: Settings): Promise<ClaudeAuthStatus> {
    const status = await this.getAuthStatus(settings);
    if (!status.available || !status.binaryPath) {
      throw new Error("Install Claude Code CLI before using Claude in PROGRAMS. Run: npm install -g @anthropic-ai/claude-code");
    }
    if (!status.loggedIn) {
      throw new Error(status.connectErrorMessage ?? "Sign in to Claude Code before using Claude in PROGRAMS.");
    }
    if (!status.ready) {
      throw new Error(status.runtimeErrorMessage ?? "Update Claude Code before using Claude in PROGRAMS.");
    }
    return status;
  }

  private extractErrorMessage(chunks: string[], stderr: string): string | null {
    for (let i = chunks.length - 1; i >= 0; i--) {
      try {
        const event = JSON.parse(chunks[i]) as {
          type?: string;
          is_error?: boolean;
          errors?: unknown;
          result?: unknown;
          content?: unknown;
          message?: { content?: unknown } | null;
        };
        if (event.type === "result" && event.is_error) {
          return extractClaudeResultEventError(event);
        }
      } catch {
        // Ignore non-JSON lines while searching for the final result error.
      }
    }

    return cleanClaudeProcessMessage(stderr);
  }

  private async readLocalAuthMetadata(): Promise<ClaudeLocalAuthMetadata | null> {
    if (!process.env.HOME) {
      return null;
    }

    try {
      const raw = await readFile(join(process.env.HOME, ".claude.json"), "utf8");
      return parseClaudeLocalAuthMetadata(raw);
    } catch {
      return null;
    }
  }

  private async readCliAuthMetadata(binaryPath: string): Promise<ClaudeCliAuthMetadata | null> {
    const result = await execCommand(`"${binaryPath}" auth status`, process.cwd());
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (!output) {
      return null;
    }

    try {
      return parseClaudeCliAuthMetadata(output);
    } catch {
      return null;
    }
  }

  private async readCliFeatures(binaryPath: string): Promise<ClaudeCliFeatures | null> {
    const helpResult = await execCommand(`"${binaryPath}" --help`, process.cwd());
    const helpText = `${helpResult.stdout}\n${helpResult.stderr}`.trim();
    if (!helpText) {
      return null;
    }

    return parseClaudeCliFeatures(helpText);
  }

  private async readUsageWindows(binaryPath: string, settings: Settings): Promise<ClaudeUsageProbeResult> {
    try {
      return await this.readUsageRateLimitWindows(binaryPath, settings);
    } catch {
      return {
        windows: null,
        note: null,
      };
    }
  }

  private async readUsageRateLimitWindows(
    binaryPath: string,
    settings: Settings,
  ): Promise<ClaudeUsageProbeResult> {
    if (!(await this.isExecutable(CLAUDE_USAGE_PTY_SCRIPT_PATH))) {
      return {
        windows: null,
        note: "PROGRAMS could not start a terminal-backed Claude usage probe on this system.",
      };
    }

    const tempDir = await mkdtemp(join(tmpdir(), "programs-claude-rate-limits-"));
    const capturePath = join(tempDir, "statusline.json");
    const claudeSettingsPath = join(tempDir, "claude-usage-settings.json");
    const probeCwd = await this.resolveUsageProbeCwd(settings);
    const firstRunSetupPending = await this.isClaudeFirstRunSetupPending();
    const transcriptChunks: string[] = [];
    let child: ChildProcess | null = null;

    try {
      const probeSettings = JSON.parse(buildClaudeUsageProbeSettingsArg()) as Record<string, unknown>;
      probeSettings.model = settings.advancedDefaults.claudeModel;
      await writeFile(claudeSettingsPath, `${JSON.stringify(probeSettings, null, 2)}\n`, "utf8");

      const env = {
        ...process.env,
        [CLAUDE_USAGE_RATE_LIMITS_ENV]: capturePath,
      };

      child = spawn(
        CLAUDE_USAGE_PTY_SCRIPT_PATH,
        ["-q", "/dev/null", binaryPath, "--settings", claudeSettingsPath, CLAUDE_USAGE_PROBE_PROMPT],
        {
          cwd: probeCwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      child.stdout?.on("data", (chunk: string | Buffer) => {
        transcriptChunks.push(stripAnsi(String(chunk)));
      });
      child.stderr?.on("data", (chunk: string | Buffer) => {
        transcriptChunks.push(stripAnsi(String(chunk)));
      });

      let raw: string | null = null;
      try {
        raw = await withTimeout(this.readStatusLineCapture(capturePath, child), 10_000);
      } catch {
        raw = null;
      }

      const windows = raw ? parseClaudeStatusLineUsageWindows(raw) : null;
      if (windows && windows.length > 0) {
        return {
          windows,
          note: null,
        };
      }

      const transcript = transcriptChunks.join("\n");
      if (firstRunSetupPending && this.isClaudeFirstRunSetupTranscript(transcript)) {
        return {
          windows: null,
          note: CLAUDE_FIRST_RUN_SETUP_NOTE,
        };
      }

      return {
        windows: null,
        note: null,
      };
    } catch {
      return {
        windows: null,
        note: null,
      };
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }

      if (child) {
        const runningChild = child;
        await Promise.race([
          new Promise<void>((resolve) => {
            if (runningChild.exitCode !== null || runningChild.signalCode !== null) {
              resolve();
              return;
            }

            runningChild.once("close", () => resolve());
          }),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]).catch(() => undefined);

        if (runningChild.exitCode === null && runningChild.signalCode === null) {
          runningChild.kill("SIGKILL");
        }
      }

      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async readStatusLineCapture(path: string, child?: ChildProcess | null): Promise<string | null> {
    let latestRaw: string | null = null;
    let exitObservedAt: number | null = null;

    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const raw = await readFile(path, "utf8");
        if (!raw.trim()) {
          throw new Error("empty capture");
        }

        latestRaw = raw;
        if (raw.includes(`"rate_limits"`)) {
          return raw;
        }
      } catch {
        // The status line hook may still be flushing its final write.
      }

      if (child && (child.exitCode !== null || child.signalCode !== null)) {
        exitObservedAt ??= Date.now();
        if (Date.now() - exitObservedAt >= 1000) {
          return latestRaw;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return latestRaw;
  }

  private async isClaudeFirstRunSetupPending(): Promise<boolean> {
    if (!process.env.HOME) {
      return false;
    }

    try {
      const raw = await readFile(join(process.env.HOME, ".claude.json"), "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.prototype.hasOwnProperty.call(parsed, "theme") && parsed.theme === null;
    } catch {
      return false;
    }
  }

  private isClaudeFirstRunSetupTranscript(transcript: string): boolean {
    const normalized = stripAnsi(transcript);
    return CLAUDE_FIRST_RUN_SETUP_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  private async resolveUsageProbeCwd(settings: Settings): Promise<string> {
    const candidates = [
      settings.appSourcePath,
      process.env.HOME ?? null,
      process.cwd(),
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      try {
        await access(candidate, fsConstants.R_OK);
        return candidate;
      } catch {
        // Try the next candidate.
      }
    }

    return process.cwd();
  }
}

const parseJsonFromText = (value: string): unknown => {
  const trimmed = value.trim();
  if (trimmed.startsWith("```")) {
    const stripped = trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
    return JSON.parse(stripped);
  }

  return JSON.parse(trimmed);
};
