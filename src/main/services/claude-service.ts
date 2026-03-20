import { spawn, type ChildProcess } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";
import { z } from "zod";
import {
  FLOWCHART_OUTPUT_CONTRACT,
  FLOWCHART_PROMPT_RULES,
  collectFlowchartRepoHints,
  formatFlowchartRepoHints,
  flowchartGraphSchema,
  materializeFlowchartSnapshot,
} from "@main/utils/flowchart";
import {
  buildClaudeAuthStatus,
  buildClaudePrintArgs,
  type ClaudeCliAuthMetadata,
  type ClaudeCliFeatures,
  type ClaudeLocalAuthMetadata,
  parseClaudeCliAuthMetadata,
  parseClaudeCliFeatures,
  parseClaudeLocalAuthMetadata,
} from "@main/utils/claude-cli";
import { execCommand, getCommandEnv } from "@main/utils/process";
import {
  buildClaudeOneShotSettingsArg,
  resolveOneShotReasoningEffort,
} from "@main/utils/one-shot-runtime";
import type {
  ClaudeConnectionTestResult,
  ClaudeAuthStatus,
  FlowchartGraph,
  PlanDraft,
  ProviderUsage,
  Project,
  ReasoningEffort,
  Settings,
  StartPlanInput,
} from "@shared/types";

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
  flowchart: string;
  flowchartGraph: FlowchartGraph | null;
  commitMessage: string;
}

interface ClaudeDailyActivityEntry {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

interface ClaudeDailyModelTokenEntry {
  date: string;
  tokensByModel: Record<string, number>;
}

interface ClaudeStatsCache {
  lastComputedDate: string;
  dailyActivity: ClaudeDailyActivityEntry[];
  dailyModelTokens: ClaudeDailyModelTokenEntry[];
  totalSessions: number;
  totalMessages: number;
  firstSessionDate: string | null;
}

const planResultSchema = z.object({
  summary: z.string(),
  impact: z.string(),
  flowchartChanges: z.string(),
});

const executionResultSchema = z.object({
  summary: z.string(),
  description: z.string(),
  flowchartGraph: flowchartGraphSchema,
  commitMessage: z.string(),
});

const claudeDailyActivitySchema = z.object({
  date: z.string(),
  messageCount: z.number().int().nonnegative().catch(0),
  sessionCount: z.number().int().nonnegative().catch(0),
  toolCallCount: z.number().int().nonnegative().catch(0),
});

const claudeDailyModelTokenSchema = z.object({
  date: z.string(),
  tokensByModel: z.record(z.number().int().nonnegative()).catch({}),
});

const claudeStatsCacheSchema = z.object({
  lastComputedDate: z.string(),
  dailyActivity: z.array(claudeDailyActivitySchema).catch([]),
  dailyModelTokens: z.array(claudeDailyModelTokenSchema).catch([]),
  totalSessions: z.number().int().nonnegative().catch(0),
  totalMessages: z.number().int().nonnegative().catch(0),
  firstSessionDate: z.string().nullable().optional().catch(null),
});

const baseDeveloperInstructions = `
You are Claude operating inside PROGRAMS, a desktop control panel for AI-assisted coding.

Rules:
- Keep user-facing explanations concise and plain English.
- Never talk about git concepts like commit, push, branch, or rebase unless explicitly asked.
- Respect the project root as the only writable code area.
- When asked to plan, do not make file changes.
- When asked to execute, make the requested code changes directly in the project.
- Keep .programs/system-flow.mmd up to date as a Mermaid flowchart focused on user flow and major system responsibilities, not line-level code.
- Produce brief, clear summaries that non-technical users can understand.
`.trim();

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const formatClaudeNumber = (value: number): string =>
  new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(value)));

const parseClaudeDate = (value: string | null): Date | null => {
  if (!value) {
    return null;
  }

  const directDate = new Date(value);
  if (!Number.isNaN(directDate.getTime())) {
    return directDate;
  }

  const dayDate = new Date(`${value}T12:00:00`);
  if (!Number.isNaN(dayDate.getTime())) {
    return dayDate;
  }

  return null;
};

const formatClaudeDateLabel = (value: string | null): string => {
  if (!value) {
    return "Unknown date";
  }

  const date = parseClaudeDate(value);
  if (!date) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
};

const parseClaudeDay = (value: string): number | null => {
  return parseClaudeDate(value)?.getTime() ?? null;
};

interface ClaudeUsageWindowData {
  label: string;
  usedPercent: number;
  resetsAt: string | null;
  windowDurationMins: number | null;
}

const parseResetExpression = (expr: string): string | null => {
  const cleaned = expr.replace(/\bat\b/gi, "").replace(/\bon\b/gi, "").trim();
  const d = new Date(cleaned);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  const timeOnly = new Date(`${new Date().toDateString()} ${cleaned}`);
  if (!Number.isNaN(timeOnly.getTime())) {
    if (timeOnly.getTime() < Date.now()) timeOnly.setDate(timeOnly.getDate() + 1);
    return timeOnly.toISOString();
  }
  // Try injecting current year for formats like "Mar 20 2:30 PM"
  const withYear = cleaned.replace(/^([A-Za-z]+\s+\d{1,2})\s+/, `$1, ${new Date().getFullYear()} `);
  if (withYear !== cleaned) {
    const dy = new Date(withYear);
    if (!Number.isNaN(dy.getTime())) return dy.toISOString();
  }
  return null;
};

const parseClaudeUsageWindows = (text: string): ClaudeUsageWindowData[] | null => {
  const windows: ClaudeUsageWindowData[] = [];
  const percentRe = /(\d+(?:\.\d+)?)\s*%/gi;
  const ratioRe = /(\d+)\s*\/\s*(\d+)\s*message/i;
  const resetRe = /reset[s]?\s+(?:at\s+)?([A-Za-z0-9 :,]+?)(?:\.|,|\n|$)/i;
  const weeklyRe = /week(?:ly)?|7.?day/i;
  const hourlyRe = /(\d+)\s*.?hour/i;

  // Scan both paragraph-level segments and individual lines so we catch info
  // regardless of how Claude CLI formats its output across lines.
  const segments = text.split(/(?:\r?\n){2,}/);
  const lines = text.split(/\r?\n/);
  const chunks = [...segments, ...lines];

  for (const chunk of chunks) {
    const pctMatch = percentRe.exec(chunk);
    percentRe.lastIndex = 0;
    if (!pctMatch) continue;

    const usedPct = parseFloat(pctMatch[1]!);
    if (!Number.isFinite(usedPct)) continue;

    const ratioMatch = ratioRe.exec(chunk);
    const usedPercent = ratioMatch
      ? Math.round((parseInt(ratioMatch[1]!, 10) / Math.max(1, parseInt(ratioMatch[2]!, 10))) * 100)
      : Math.round(usedPct);

    const resetMatch = resetRe.exec(chunk);
    const resetsAt = resetMatch ? parseResetExpression(resetMatch[1]!.trim()) : null;

    let windowDurationMins: number | null = null;
    let label: string;
    if (weeklyRe.test(chunk)) {
      windowDurationMins = 10080;
      label = "This Week";
    } else {
      const hourMatch = hourlyRe.exec(chunk);
      windowDurationMins = hourMatch ? parseInt(hourMatch[1]!, 10) * 60 : 300;
      label = hourMatch ? `${hourMatch[1]}h Window` : "Recent (5h)";
    }

    windows.push({ label, usedPercent: Math.min(100, Math.max(0, usedPercent)), resetsAt, windowDurationMins });
  }

  if (windows.length === 0) return null;
  windows.sort((a, b) => (a.windowDurationMins ?? 0) - (b.windowDurationMins ?? 0));
  const seen = new Map<number | null, ClaudeUsageWindowData>();
  for (const w of windows) {
    if (!seen.has(w.windowDurationMins) || (w.resetsAt && !seen.get(w.windowDurationMins)?.resetsAt)) {
      seen.set(w.windowDurationMins, w);
    }
  }
  return seen.size > 0 ? Array.from(seen.values()) : null;
};

const sumClaudeTokens = (entry: ClaudeDailyModelTokenEntry | undefined): number =>
  Object.values(entry?.tokensByModel ?? {}).reduce((total, value) => total + value, 0);

const sumClaudeActivity = (entries: ClaudeDailyActivityEntry[]) =>
  entries.reduce(
    (summary, entry) => ({
      messageCount: summary.messageCount + entry.messageCount,
      sessionCount: summary.sessionCount + entry.sessionCount,
      toolCallCount: summary.toolCallCount + entry.toolCallCount,
    }),
    {
      messageCount: 0,
      sessionCount: 0,
      toolCallCount: 0,
    },
  );

const buildClaudeDetailLabel = (summary: ReturnType<typeof sumClaudeActivity>, lead: string): string => {
  const parts = [lead, `${formatClaudeNumber(summary.sessionCount)} sessions`, `${formatClaudeNumber(summary.messageCount)} messages`];
  if (summary.toolCallCount > 0) {
    parts.push(`${formatClaudeNumber(summary.toolCallCount)} tool calls`);
  }
  return parts.join(" · ");
};

const formatContextPaths = (contextPaths: string[]): string =>
  contextPaths.length
    ? `Priority files and folders for this turn:\n${contextPaths.map((path) => `- ${path}`).join("\n")}`
    : "No extra files were selected for this turn.";

const formatSkillInstructions = (value: string | null | undefined): string =>
  value?.trim() ? `Attached skill:\n${value.trim()}\n` : "";

const buildPlanningPrompt = (project: Project, prompt: string, contextPaths: string[], skillInstructions: string | null, coreDetailsContext?: string | null): string => `
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
- Describe how the system flowchart should change.
- Your final answer must be ONLY strict JSON (no markdown fences) matching this schema:
  {"summary": string, "impact": string, "flowchartChanges": string}
`.trim();

const buildExecutionPrompt = async (project: Project, draft: PlanDraft): Promise<string> => {
  const repoHints = await collectFlowchartRepoHints(project.localPath);
  return `
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

${formatFlowchartRepoHints(repoHints)}

${draft.coreDetailsContext ? `${draft.coreDetailsContext}\n\n` : ""}Requirements:
- Make the code changes now.
- Return an updated structured system flowchart that matches the final user-visible flow after your code changes.
- Keep the project description current and user-facing.
- Your final answer must be ONLY strict JSON (no markdown fences) matching this schema:
  {"summary": string, "description": string, "flowchartGraph": FlowchartGraph, "commitMessage": string}
- Use these flowchart rules:
${FLOWCHART_PROMPT_RULES}
- ${FLOWCHART_OUTPUT_CONTRACT}
- The summary must be one or two short sentences for the update history.
- The commitMessage must be short and action-oriented.
`.trim();
};

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


export class ClaudeService {
  private readonly planDrafts = new Map<string, PlanDraft>();
  private readonly activeProcesses = new Map<string, ChildProcess>();
  private readonly pendingDiffRefresh = new Set<string>();
  private pendingLoginStdin: import("stream").Writable | null = null;

  constructor(
    private readonly emit: Emit,
    private readonly openExternal?: (url: string) => Promise<void>,
  ) {}

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
      status: "executing",
      thinkingStatus: "in_progress",
      planningStatus: "skipped",
      buildingStatus: "pending",
      verifyingStatus: "pending",
      explanation: "Claude is working directly without a draft plan.",
      steps: [],
      summary: null,
      impact: null,
      flowchartChanges: null,
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

    // Try live rate limit data via CLI first
    if (auth.available && auth.loggedIn && auth.binaryPath) {
      const liveWindows = await this.readUsageWindows(auth.binaryPath);
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

    const statsCache = await this.readStatsCache();
    if (statsCache) {
      const latestDayTimestamp = parseClaudeDay(statsCache.lastComputedDate);

      // Recent (5h) — today's activity as a rolling-window analogue
      const latestActivity = statsCache.dailyActivity.at(-1);
      const latestTokenEntry = statsCache.dailyModelTokens.at(-1);
      const latestTokens = sumClaudeTokens(latestTokenEntry);
      const latestActivitySummary = latestActivity ? sumClaudeActivity([latestActivity]) : sumClaudeActivity([]);

      // This Week — last 7 days
      const weekActivity =
        latestDayTimestamp === null
          ? statsCache.dailyActivity
          : statsCache.dailyActivity.filter((entry) => {
              const entryDay = parseClaudeDay(entry.date);
              return entryDay !== null && latestDayTimestamp - entryDay <= 6 * DAY_IN_MS;
            });
      const weekTokenEntries =
        latestDayTimestamp === null
          ? statsCache.dailyModelTokens
          : statsCache.dailyModelTokens.filter((entry) => {
              const entryDay = parseClaudeDay(entry.date);
              return entryDay !== null && latestDayTimestamp - entryDay <= 6 * DAY_IN_MS;
            });
      const weekTokens = weekTokenEntries.reduce((total, entry) => total + sumClaudeTokens(entry), 0);
      const weekActivitySummary = sumClaudeActivity(weekActivity);

      const windows = [
        {
          label: "Recent (5h)",
          usedPercent: null,
          valueLabel: `${formatClaudeNumber(latestTokens)} tokens`,
          detail: null,
          resetsAt: null,
          windowDurationMins: 300,
        },
        {
          label: "This Week",
          usedPercent: null,
          valueLabel: `${formatClaudeNumber(weekTokens)} tokens`,
          detail: null,
          resetsAt: null,
          windowDurationMins: 10080,
        },
      ];

      let note = `Activity through ${formatClaudeDateLabel(statsCache.lastComputedDate)}. Claude does not expose rate limits — these are activity metrics.`;
      if (!auth.available) {
        note = `${note} Install Claude Code to keep this up to date.`;
      } else if (!auth.loggedIn) {
        note = `${note} Sign in to Claude Code to refresh.`;
      } else if (!auth.ready) {
        note = `${note} ${auth.runtimeErrorMessage ?? "PROGRAMS needs a newer Claude Code install to refresh."}`;
      } else {
        note = `${note} Check console.anthropic.com for billing details.`;
      }

      return {
        status: "ready",
        windows,
        note,
      };
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
      note: "PROGRAMS could not find Claude usage history yet. Use Claude Code once, then reopen Usage.",
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
      this.readCliFeatures(binaryPath),
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
      remoteUrl: null,
      defaultBranch: "main",
      threadId: null,
      flowchartPath: "",
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
        githubRepoName: null,
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
    const reasoningEffort = resolveOneShotReasoningEffort(
      settings.advancedDefaults.reasoningEffort,
      reasoningEffortOverride,
    );

    // If an output schema is provided, inject it into the prompt so Claude
    // returns structured JSON (the CLI has no --output-schema flag).
    let finalPrompt = prompt;
    if (outputSchema) {
      finalPrompt += `\n\nIMPORTANT: You MUST respond with ONLY a valid JSON object matching this exact schema. No markdown, no explanation, no code fences — just the raw JSON object.\n\nRequired JSON schema:\n${JSON.stringify(outputSchema, null, 2)}`;
    }

    return new Promise<string>((resolve, reject) => {
      const args = buildClaudePrintArgs({
        prompt: finalPrompt,
        model,
        settingsArg: buildClaudeOneShotSettingsArg(reasoningEffort),
        maxTurns: options?.maxTurns ?? 5,
        allowedTools: options?.allowedTools ?? null,
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

          const finalText = this.extractFinalResult(chunks);
          resolve(finalText);
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

  async startPlanningTurn(project: Project, settings: Settings, input: StartPlanInput): Promise<PlanDraft> {
    const status = await this.requireReadyStatus(settings);
    const commandEnv = await getCommandEnv();
    const binaryPath = status.binaryPath!;

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
      status: "planning",
      thinkingStatus: "in_progress",
      planningStatus: "in_progress",
      buildingStatus: "pending",
      verifyingStatus: "pending",
      explanation: "Claude is building the plan.",
      steps: [],
      summary: null,
      impact: null,
      flowchartChanges: null,
      diff: null,
      diffStats: null,
      finalText: null,
      verificationDetails: null,
      errorMessage: null,
      lastUpdatedAt: new Date().toISOString(),
    };

    this.syncDraft(draft);

    return new Promise<PlanDraft>((resolve, reject) => {
      const prompt = buildPlanningPrompt(project, input.prompt, input.contextPaths, input.skillInstructions ?? null, input.coreDetailsContext ?? null);
      const args = buildClaudePrintArgs({
        prompt,
        model: input.claudeModel,
        settingsArg: buildClaudeOneShotSettingsArg(input.reasoningEffort),
        maxTurns: 5,
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

          const finalText = this.extractFinalResult(chunks);
          const parsed = planResultSchema.parse(parseJsonFromText(finalText));
          draft.status = "awaitingApproval";
          draft.thinkingStatus = "completed";
          draft.planningStatus = "completed";
          draft.summary = parsed.summary;
          draft.impact = parsed.impact;
          draft.flowchartChanges = parsed.flowchartChanges;
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
    });
  }

  async executeApprovedPlan(project: Project, settings: Settings, draft: PlanDraft): Promise<ExecutionPayload> {
    const status = await this.requireReadyStatus(settings);
    const commandEnv = await getCommandEnv();
    const binaryPath = status.binaryPath!;

    return new Promise<ExecutionPayload>(async (resolve, reject) => {
      const prompt = await buildExecutionPrompt(project, draft);
      const args = buildClaudePrintArgs({
        prompt,
        model: draft.claudeModel,
        settingsArg: buildClaudeOneShotSettingsArg(draft.reasoningEffort),
        maxTurns: 20,
        allowedTools: "Edit,Write,Bash(npm install:*),Bash(npx:*),Read,Glob,Grep",
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

          const finalText = this.extractFinalResult(chunks);
          const parsed = executionResultSchema.parse(parseJsonFromText(finalText));
          const flowchartSnapshot = materializeFlowchartSnapshot(parsed.flowchartGraph);
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
            flowchart: flowchartSnapshot.flowchart,
            flowchartGraph: flowchartSnapshot.flowchartGraph,
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

  private extractFinalResult(chunks: string[]): string {
    for (let i = chunks.length - 1; i >= 0; i--) {
      try {
        const event = JSON.parse(chunks[i]) as {
          type?: string;
          result?: unknown;
          is_error?: boolean;
          errors?: unknown;
          content?: unknown;
          delta?: { text?: unknown } | null;
          message?: { content?: unknown } | null;
        };
        if (event.type === "result") {
          if (event.is_error) {
            throw new Error(extractClaudeResultEventError(event) ?? "Claude returned an error.");
          }
          if (typeof event.result === "string" && event.result.trim()) {
            return event.result;
          }
        }

        const text = extractClaudeEventText(event);
        if (text && isLikelyJsonResponse(text)) {
          return text;
        }
      } catch {
        const raw = chunks[i].trim();
        if (raw && isLikelyJsonResponse(raw)) {
          return raw;
        }
      }
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

  private async readUsageWindows(binaryPath: string): Promise<ClaudeUsageWindowData[] | null> {
    try {
      const withTimeout = <T>(p: Promise<T>, ms: number) =>
        Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
      const result = await withTimeout(
        execCommand(`"${binaryPath}" -p "/status" --print --max-turns 1`, process.cwd()),
        10_000,
      );
      const text = `${result.stdout}\n${result.stderr}`.trim();
      if (!text) return null;
      return parseClaudeUsageWindows(text);
    } catch {
      return null;
    }
  }

  private async readStatsCache(): Promise<ClaudeStatsCache | null> {
    if (!process.env.HOME) {
      return null;
    }

    try {
      const raw = await readFile(join(process.env.HOME, ".claude", "stats-cache.json"), "utf8");
      const parsed = claudeStatsCacheSchema.parse(JSON.parse(raw));
      if (
        parsed.dailyActivity.length === 0 &&
        parsed.dailyModelTokens.length === 0 &&
        parsed.totalSessions === 0 &&
        parsed.totalMessages === 0
      ) {
        return null;
      }

      return {
        lastComputedDate: parsed.lastComputedDate,
        dailyActivity: parsed.dailyActivity.sort((left, right) => left.date.localeCompare(right.date)),
        dailyModelTokens: parsed.dailyModelTokens.sort((left, right) => left.date.localeCompare(right.date)),
        totalSessions: parsed.totalSessions,
        totalMessages: parsed.totalMessages,
        firstSessionDate: parsed.firstSessionDate ?? null,
      };
    } catch {
      return null;
    }
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
