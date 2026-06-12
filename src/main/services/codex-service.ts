import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { shell } from "electron";
import { z } from "zod";
import { resolveOneShotReasoningEffort } from "../utils/one-shot-runtime.ts";
import { selectPreferredCodexModels } from "../utils/codex-model-catalog.ts";
import { isSubPath } from "../utils/fs.ts";
import { execCommand, getCommandEnv } from "../utils/process.ts";
import { DEFAULT_MODEL_CATALOG, type ModelOption } from "../../shared/types.ts";
import type {
  CodexAuthStatus,
  PlanDraft,
  PlanStep,
  ProviderUsage,
  Project,
  ReasoningEffort,
  Settings,
  SpeedMode,
  StartPlanInput,
} from "../../shared/types.ts";

type Emit = (
  event:
    | { type: "project.plan"; projectId: string; plan: PlanDraft | null }
    | { type: "auth.codex"; status: CodexAuthStatus }
    | { type: "toast"; level: "info" | "success" | "error"; message: string },
) => void;

interface RpcMessage {
  jsonrpc?: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface PendingLogin {
  resolve: () => void;
  reject: (error: Error) => void;
}

type JsonSchema = Record<string, unknown>;
type TurnPhase = "plan" | "execute" | "ask";

interface ActiveTurn {
  projectId: string;
  projectPath: string;
  threadId: string;
  turnId: string | null;
  phase: TurnPhase;
  prompt: string;
  speed: SpeedMode;
  draft: PlanDraft;
  projectRoot: string;
  finalMessages: string[];
  pendingItems: Map<string, unknown>;
  transcribedLines?: Set<string>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

// Shape of a Codex app-server thread item (subset we read). Codex emits these
// via item/started + item/completed notifications during a turn.
interface CodexItem {
  id: string;
  type: string;
  text?: string;
  phase?: string | null;
  command?: string | string[] | null;
  query?: string | null;
  server?: string | null;
  tool?: string | null;
  changes?: Array<{ path: string }>;
}

interface ActiveOneShot {
  threadId: string;
  turnId: string;
  finalMessages: string[];
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

interface ExecutionPayload {
  draft: PlanDraft;
  summary: string;
  description: string;
  commitMessage: string;
}

interface CodexInstallationInfo {
  available: boolean;
  binaryPath: string | null;
  version: string | null;
}

interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

interface CodexRateLimitSnapshot {
  limitId: string | null;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
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

const turnResultSchema = z.object({
  status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
  error: z
    .object({
      message: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const accountSchema = z.object({
  account: z
    .object({
      type: z.string(),
      email: z.string().nullable().optional(),
      planType: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  requiresOpenaiAuth: z.boolean().optional(),
});

const loginResponseSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("chatgpt"),
    authUrl: z.string(),
    loginId: z.string(),
  }),
  z.object({
    type: z.literal("apiKey"),
  }),
  z.object({
    type: z.literal("chatgptAuthTokens"),
  }),
]);

const rateLimitWindowSchema = z.object({
  usedPercent: z.number().int(),
  windowDurationMins: z.number().int().nullable().optional(),
  resetsAt: z.number().int().nullable().optional(),
});

const rateLimitSnapshotSchema = z.object({
  limitId: z.string().nullable().optional(),
  primary: rateLimitWindowSchema.nullable().optional(),
  secondary: rateLimitWindowSchema.nullable().optional(),
});

const rateLimitsResponseSchema = z.object({
  rateLimits: rateLimitSnapshotSchema,
  rateLimitsByLimitId: z.record(rateLimitSnapshotSchema).nullable().optional(),
});

const modelListItemSchema = z.object({
  id: z.string(),
  model: z.string(),
  displayName: z.string().optional(),
  description: z.string().nullable().optional(),
  hidden: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

const modelListResponseSchema = z.object({
  data: z.array(modelListItemSchema),
  nextCursor: z.string().nullable().optional(),
});

const baseDeveloperInstructions = `
You are Codex operating inside PROGRAMS, a desktop control panel for AI-assisted coding.

Rules:
- Keep user-facing explanations concise and plain English.
- Never talk about git concepts like commit, push, branch, or rebase unless explicitly asked.
- Respect the project root as the only writable code area.
- When asked to plan, do not make file changes or request write approval.
- When asked to execute, make the requested code changes directly in the project.
- Produce brief, clear summaries that non-technical users can understand.
`.trim();

const formatContextPaths = (contextPaths: string[]): string =>
  contextPaths.length
    ? `Priority files and folders for this turn:\n${contextPaths.map((path) => `- ${path}`).join("\n")}`
    : "No extra files were selected for this turn.";

const formatSkillInstructions = (value: string | null | undefined): string =>
  value?.trim() ? `Attached skill:\n${value.trim()}\n` : "";

const buildPlanningPrompt = (project: Project, prompt: string, contextPaths: string[], skillInstructions: string | null, coreDetailsContext?: string | null): string => `
Plan a change for the project "${project.name}".

${formatSkillInstructions(skillInstructions)}

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
- Your final answer must be strict JSON matching the requested schema.
`.trim();

// Codex app-server turn input: the text prompt plus any attached images as
// localImage items (the model views them as multimodal input).
const buildCodexTurnInput = (text: string, imagePaths: string[] = []): Array<Record<string, unknown>> => [
  { type: "text", text },
  ...imagePaths.map((path) => ({ type: "localImage", path })),
];

const buildAskPrompt = (project: Project, prompt: string, contextPaths: string[]): string => `
You are a helpful assistant answering a question about the software project "${project.name}".

Current project description:
${project.description}

Question:
${prompt}

${formatContextPaths(contextPaths)}

Instructions:
- Read the codebase as needed to answer accurately.
- Do NOT modify any files.
- Answer conversationally and concisely in plain text (no JSON).
`.trim();

const buildExecutionPrompt = async (project: Project, draft: PlanDraft): Promise<string> => `
Implement the approved update for "${project.name}".

${formatSkillInstructions(draft.skillInstructions)}

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
- Your final answer must be strict JSON matching the requested schema.
- The summary must be one or two short sentences for the update history.
- The commitMessage must be short and action-oriented.
`.trim();

const parseUnifiedDiffStats = (diff: string | null): PlanDraft["diffStats"] => {
  if (!diff) {
    return null;
  }

  let added = 0;
  let removed = 0;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      added += 1;
      continue;
    }
    if (line.startsWith("-")) {
      removed += 1;
    }
  }

  return added || removed ? { added, removed } : null;
};

export class CodexService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private responseId = 1;
  private readonly pendingResponses = new Map<number | string, PendingRequest>();
  private readonly pendingLogins = new Map<string, PendingLogin>();
  private readonly activeTurns = new Map<string, ActiveTurn>();
  private readonly activeOneShots = new Map<string, ActiveOneShot>();
  private readonly planDrafts = new Map<string, PlanDraft>();
  private resolvedBinaryPath: string | null = null;
  private initialized = false;
  private latestRateLimits: CodexRateLimitSnapshot | null = null;
  private latestModelOptions: ModelOption[] | null = null;

  constructor(private readonly emit: Emit) {}

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
      provider: "codex",
      threadId: project.threadId,
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
      explanation: "Codex is working directly without a draft plan.",
      transcript: "",
      webEnabled: input.webEnabled ?? false,
      ultracode: input.ultracode ?? false,
      imagePaths: input.imagePaths ?? [],
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

  async inspectInstallation(settings: Settings): Promise<CodexInstallationInfo> {
    const binaryPath = await this.resolveBinaryPath(settings);
    if (!binaryPath) {
      return {
        available: false,
        binaryPath: null,
        version: null,
      };
    }

    const versionResult = await execCommand(`"${binaryPath}" --version`, process.cwd());
    const version =
      versionResult.code === 0
        ? versionResult.stdout.trim() || versionResult.stderr.trim() || null
        : null;

    return {
      available: true,
      binaryPath,
      version,
    };
  }

  async getUsage(settings: Settings): Promise<ProviderUsage> {
    const auth = await this.getAuthStatus(settings);
    if (!auth.available) {
      return {
        status: "requiresInstall",
        windows: [],
        note: "Install Codex to see live usage in PROGRAMS.",
      };
    }

    if (!auth.loggedIn) {
      return {
        status: "requiresLogin",
        windows: [],
        note: "Connect Codex to see live usage in PROGRAMS.",
      };
    }

    try {
      await this.ensureStarted(settings);
      const result = rateLimitsResponseSchema.parse(await this.sendRequest("account/rateLimits/read", null));
      const snapshot = result.rateLimitsByLimitId?.codex ?? result.rateLimits;
      this.latestRateLimits = {
        limitId: snapshot.limitId ?? null,
        primary: snapshot.primary
          ? {
              usedPercent: snapshot.primary.usedPercent,
              windowDurationMins: snapshot.primary.windowDurationMins ?? null,
              resetsAt: snapshot.primary.resetsAt ?? null,
            }
          : null,
        secondary: snapshot.secondary
          ? {
              usedPercent: snapshot.secondary.usedPercent,
              windowDurationMins: snapshot.secondary.windowDurationMins ?? null,
              resetsAt: snapshot.secondary.resetsAt ?? null,
            }
          : null,
      };

      return {
        status: "ready",
        windows: [this.latestRateLimits.primary, this.latestRateLimits.secondary]
          .filter((window): window is CodexRateLimitWindow => Boolean(window))
          .map((window) => ({
            label: formatUsageWindowLabel(window.windowDurationMins),
            usedPercent: clampPercent(window.usedPercent),
            valueLabel: null,
            detail: null,
            resetsAt: toIsoTimestamp(window.resetsAt),
            windowDurationMins: window.windowDurationMins,
          })),
        note: null,
      };
    } catch (error) {
      if (this.latestRateLimits) {
        return {
          status: "ready",
          windows: [this.latestRateLimits.primary, this.latestRateLimits.secondary]
            .filter((window): window is CodexRateLimitWindow => Boolean(window))
            .map((window) => ({
              label: formatUsageWindowLabel(window.windowDurationMins),
              usedPercent: clampPercent(window.usedPercent),
              valueLabel: null,
              detail: null,
              resetsAt: toIsoTimestamp(window.resetsAt),
              windowDurationMins: window.windowDurationMins,
            })),
          note: "Showing the latest Codex usage PROGRAMS already loaded.",
        };
      }

      return {
        status: "unsupported",
        windows: [],
        note: error instanceof Error ? error.message : "PROGRAMS could not load Codex usage right now.",
      };
    }
  }

  async getModelCatalog(settings: Settings): Promise<ModelOption[]> {
    const installation = await this.inspectInstallation(settings);
    if (!installation.available) {
      return this.latestModelOptions ?? DEFAULT_MODEL_CATALOG.codex;
    }

    try {
      await this.ensureStarted(settings);
      const response = modelListResponseSchema.parse(
        await this.sendRequest("model/list", {
          includeHidden: false,
          limit: 100,
        }),
      );
      const nextModels = selectPreferredCodexModels(response.data);
      this.latestModelOptions = nextModels;
      return nextModels;
    } catch {
      return this.latestModelOptions ?? DEFAULT_MODEL_CATALOG.codex;
    }
  }

  async getAuthStatus(settings: Settings): Promise<CodexAuthStatus> {
    const installation = await this.inspectInstallation(settings);
    try {
      if (!installation.available) {
        return {
          available: false,
          loggedIn: false,
          binaryPath: null,
          version: null,
          email: null,
          planType: null,
          authMode: null,
          errorMessage: "Codex is not installed.",
        };
      }

      await this.ensureStarted(settings);
      const result = accountSchema.parse(await this.sendRequest("account/read", { refreshToken: false }));
      const account = result.account;
      return {
        available: true,
        loggedIn: Boolean(account),
        binaryPath: installation.binaryPath,
        version: installation.version,
        email: account?.email ?? null,
        planType: account?.planType ?? null,
        authMode: account?.type ?? null,
        errorMessage: null,
      };
    } catch (error) {
      return {
        available: installation.available,
        loggedIn: false,
        binaryPath: installation.binaryPath,
        version: installation.version,
        email: null,
        planType: null,
        authMode: null,
        errorMessage: error instanceof Error ? error.message : "Codex is not available.",
      };
    }
  }

  async login(settings: Settings): Promise<CodexAuthStatus> {
    await this.ensureStarted(settings);
    const current = await this.getAuthStatus(settings);
    if (current.loggedIn) {
      this.emit({ type: "auth.codex", status: current });
      return current;
    }

    const response = loginResponseSchema.parse(
      await this.sendRequest("account/login/start", { type: "chatgpt" }),
    );

    if (response.type !== "chatgpt") {
      throw new Error("PROGRAMS expected a ChatGPT sign-in flow from Codex.");
    }

    await shell.openExternal(response.authUrl);
    await new Promise<void>((resolve, reject) => {
      this.pendingLogins.set(response.loginId, { resolve, reject });
      setTimeout(() => {
        if (this.pendingLogins.has(response.loginId)) {
          this.pendingLogins.delete(response.loginId);
          reject(new Error("Codex sign-in timed out. Try again."));
        }
      }, 120000);
    });

    const next = await this.getAuthStatus(settings);
    this.emit({ type: "auth.codex", status: next });
    return next;
  }

  async logout(settings: Settings): Promise<CodexAuthStatus> {
    await this.ensureStarted(settings);
    await this.sendRequest("account/logout", null);
    const status = await this.getAuthStatus(settings);
    this.emit({ type: "auth.codex", status });
    return status;
  }

  async ensureThread(
    project: Project,
    settings: Settings,
    speed: SpeedMode,
    model: StartPlanInput["model"],
  ): Promise<{ threadId: string; isNew: boolean }> {
    await this.ensureStarted(settings);

    if (project.threadId) {
      try {
        await this.sendRequest("thread/read", {
          threadId: project.threadId,
          includeTurns: false,
        });
        return { threadId: project.threadId, isNew: false };
      } catch {
        // Stale thread — fall through to create a new one.
      }
    }

    const response = (await this.sendRequest("thread/start", {
      cwd: project.localPath,
      baseInstructions: baseDeveloperInstructions,
      developerInstructions:
        settings.uiMode === "advanced" ? settings.advancedDefaults.customInstructions || null : null,
      model,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      serviceName: "PROGRAMS",
      personality: "pragmatic",
    })) as { thread?: { id?: string } };

    const threadId = response.thread?.id;
    if (!threadId) {
      throw new Error("Codex did not return a valid project thread.");
    }

    // Persist in-place so callers reuse the correct threadId on subsequent calls.
    project.threadId = threadId;

    return { threadId, isNew: true };
  }

  async runOneShot(
    project: Project,
    settings: Settings,
    prompt: string,
    model: string,
    outputSchema?: JsonSchema,
    reasoningEffortOverride?: ReasoningEffort,
    options?: { networkAccess?: boolean },
  ): Promise<string> {
    let threadId = (await this.ensureThread(project, settings, "normal", model)).threadId;
    const reasoningEffort = resolveOneShotReasoningEffort(
      settings.advancedDefaults.reasoningEffort,
      reasoningEffortOverride,
    );

    const buildTurnParams = (tid: string) => ({
      threadId: tid,
      cwd: project.localPath,
      input: [{ type: "text", text: prompt }],
      effort: reasoningEffort,
      model,
      ...(outputSchema ? { outputSchema } : {}),
      personality: "pragmatic",
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "readOnly",
        networkAccess: options?.networkAccess ?? false,
      },
      summary: "auto",
    });

    let result: { turn?: { id?: string } };
    try {
      result = (await this.sendRequest("turn/start", buildTurnParams(threadId))) as { turn?: { id?: string } };
    } catch (err) {
      if (err instanceof Error && err.message.includes("thread not found")) {
        // Thread became stale between ensureThread and turn/start — recreate and retry once.
        project.threadId = null;
        threadId = (await this.ensureThread(project, settings, "normal", model)).threadId;
        result = (await this.sendRequest("turn/start", buildTurnParams(threadId))) as { turn?: { id?: string } };
      } else {
        throw err;
      }
    }

    // Wait for the turn to complete via notification handling
    return new Promise<string>((resolve, reject) => {
      const turnId = result.turn?.id ?? null;
      if (!turnId) {
        reject(new Error("Codex did not start a turn."));
        return;
      }

      this.activeOneShots.set(this.turnKey(threadId, turnId), {
        threadId,
        turnId,
        finalMessages: [],
        resolve,
        reject,
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
      provider: "codex",
      threadId: project.threadId,
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
      explanation: "Codex is building the plan.",
      transcript: "",
      webEnabled: input.webEnabled ?? false,
      ultracode: input.ultracode ?? false,
      imagePaths: input.imagePaths ?? [],
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
          const { result, threadId: resolvedThreadId } = await this.startTurnWithThreadRetry(
            project,
            settings,
            input.speed,
            input.model,
            (activeThreadId) => ({
              threadId: activeThreadId,
              cwd: project.localPath,
              input: buildCodexTurnInput(this.previewPlanningPrompt(project, input), input.imagePaths),
              effort: input.reasoningEffort,
              model: input.model,
              outputSchema: planOutputSchema,
              personality: "pragmatic",
              approvalPolicy: "never",
              sandboxPolicy: {
                type: "readOnly",
                networkAccess: input.webEnabled ?? false,
              },
              summary: "auto",
            }),
          );

          const turnId = result.turn?.id ?? null;
          const activeTurn: ActiveTurn = {
            projectId: project.id,
            projectPath: project.localPath,
            threadId: resolvedThreadId,
            turnId,
            phase: "plan",
            prompt: input.prompt,
            speed: input.speed,
            draft,
            projectRoot: project.localPath,
            finalMessages: [],
            pendingItems: new Map(),
            resolve: (value) => resolve(value as PlanDraft),
            reject,
          };

          draft.threadId = resolvedThreadId;
          draft.turnId = turnId;
          this.activeTurns.set(project.id, activeTurn);
          this.syncDraft(draft);
        } catch (error) {
          draft.status = "failed";
          draft.thinkingStatus = "failed";
          draft.planningStatus = "failed";
          draft.errorMessage = error instanceof Error ? error.message : "Planning failed.";
          this.syncDraft(draft);
          reject(error instanceof Error ? error : new Error("Planning failed."));
        }
      })();
    });
  }

  // Read-only "ask": stream a plain-text answer (no plan, no file edits) using a
  // readOnly sandbox and no output schema. Mirrors startPlanningTurn but phase "ask".
  async answerQuestion(project: Project, settings: Settings, input: StartPlanInput): Promise<PlanDraft> {
    const draft: PlanDraft = {
      projectId: project.id,
      provider: "codex",
      threadId: project.threadId,
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
      buildingStatus: "skipped",
      verifyingStatus: "skipped",
      explanation: "",
      transcript: "",
      webEnabled: input.webEnabled ?? false,
      ultracode: input.ultracode ?? false,
      imagePaths: input.imagePaths ?? [],
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
          const { result, threadId: resolvedThreadId } = await this.startTurnWithThreadRetry(
            project,
            settings,
            input.speed,
            input.model,
            (activeThreadId) => ({
              threadId: activeThreadId,
              cwd: project.localPath,
              input: buildCodexTurnInput(buildAskPrompt(project, input.prompt, input.contextPaths), input.imagePaths),
              effort: input.reasoningEffort,
              model: input.model,
              personality: "pragmatic",
              approvalPolicy: "never",
              sandboxPolicy: {
                type: "readOnly",
                networkAccess: input.webEnabled ?? false,
              },
              summary: "auto",
            }),
          );

          const turnId = result.turn?.id ?? null;
          const activeTurn: ActiveTurn = {
            projectId: project.id,
            projectPath: project.localPath,
            threadId: resolvedThreadId,
            turnId,
            phase: "ask",
            prompt: input.prompt,
            speed: input.speed,
            draft,
            projectRoot: project.localPath,
            finalMessages: [],
            pendingItems: new Map(),
            resolve: (value) => resolve(value as PlanDraft),
            reject,
          };

          draft.threadId = resolvedThreadId;
          draft.turnId = turnId;
          this.activeTurns.set(project.id, activeTurn);
          this.syncDraft(draft);
        } catch (error) {
          draft.status = "failed";
          draft.thinkingStatus = "failed";
          draft.errorMessage = error instanceof Error ? error.message : "Codex could not answer.";
          this.syncDraft(draft);
          reject(error instanceof Error ? error : new Error("Codex could not answer."));
        }
      })();
    });
  }

  async executeApprovedPlan(project: Project, settings: Settings, draft: PlanDraft): Promise<ExecutionPayload> {
    const threadId = draft.threadId ?? (await this.ensureThread(project, settings, draft.speed, draft.model)).threadId;
    draft.threadId = threadId;

    return new Promise<ExecutionPayload>(async (resolve, reject) => {
      try {
        const executionPrompt = await buildExecutionPrompt(project, draft);
        const { result, threadId: resolvedThreadId } = await this.startTurnWithThreadRetry(
          project,
          settings,
          draft.speed,
          draft.model,
          (activeThreadId) => ({
            threadId: activeThreadId,
            cwd: project.localPath,
            input: buildCodexTurnInput(executionPrompt, draft.imagePaths),
            effort: draft.reasoningEffort,
            model: draft.model,
            outputSchema: executionOutputSchema,
            personality: "pragmatic",
            approvalPolicy: "on-request",
            sandboxPolicy: {
              type: "workspaceWrite",
              writableRoots: [project.localPath],
              networkAccess: draft.webEnabled,
            },
            summary: "auto",
          }),
        );

        draft.threadId = resolvedThreadId;
        draft.turnId = result.turn?.id ?? null;
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

        this.activeTurns.set(project.id, {
          projectId: project.id,
          projectPath: project.localPath,
          threadId: resolvedThreadId,
          turnId: draft.turnId,
          phase: "execute",
          prompt: draft.prompt,
          speed: draft.speed,
          draft,
          projectRoot: project.localPath,
          finalMessages: [],
          pendingItems: new Map(),
          resolve: (value) => resolve(value as ExecutionPayload),
          reject,
        });
      } catch (error) {
        draft.status = "failed";
        draft.buildingStatus = "failed";
        draft.errorMessage = error instanceof Error ? error.message : "Execution failed.";
        if (draft.planningMode === "none" && draft.thinkingStatus === "in_progress") {
          draft.thinkingStatus = "failed";
        }
        this.syncDraft(draft);
        reject(error instanceof Error ? error : new Error("Execution failed."));
      }
    });
  }

  private isThreadNotFoundError(error: unknown): boolean {
    return error instanceof Error && error.message.includes("thread not found");
  }

  private asTurnStartFailure(error: unknown): Error & { startupFailed: true } {
    const normalized = error instanceof Error ? error : new Error("Codex could not start the turn.");
    return Object.assign(normalized, { startupFailed: true as const });
  }

  private async startTurnWithThreadRetry(
    project: Project,
    settings: Settings,
    speed: SpeedMode,
    model: StartPlanInput["model"],
    buildParams: (threadId: string) => Record<string, unknown>,
  ): Promise<{ result: { turn?: { id?: string } }; threadId: string }> {
    let threadId = (await this.ensureThread(project, settings, speed, model)).threadId;

    try {
      const result = (await this.sendRequest("turn/start", buildParams(threadId))) as { turn?: { id?: string } };
      return { result, threadId };
    } catch (error) {
      if (!this.isThreadNotFoundError(error)) {
        throw this.asTurnStartFailure(error);
      }
    }

    project.threadId = null;
    threadId = (await this.ensureThread(project, settings, speed, model)).threadId;
    try {
      const result = (await this.sendRequest("turn/start", buildParams(threadId))) as { turn?: { id?: string } };
      return { result, threadId };
    } catch (error) {
      throw this.asTurnStartFailure(error);
    }
  }

  async interruptPlan(projectId: string): Promise<void> {
    const plan = this.planDrafts.get(projectId);
    if (!plan?.threadId || !plan.turnId) {
      this.clearPlan(projectId);
      return;
    }

    try {
      await this.sendRequest("turn/interrupt", {
        threadId: plan.threadId,
        turnId: plan.turnId,
      });
    } finally {
      this.activeTurns.delete(projectId);
      this.clearPlan(projectId);
    }
  }

  private async ensureStarted(settings: Settings): Promise<void> {
    if (this.child && this.initialized) {
      return;
    }

    const binaryPath = await this.resolveBinaryPath(settings);
    if (!binaryPath) {
      throw new Error("Install the Codex desktop app or CLI before using Codex in PROGRAMS.");
    }

    if (!this.child) {
      this.resolvedBinaryPath = binaryPath;
      const commandEnv = await getCommandEnv();
      this.child = spawn(binaryPath, ["app-server", "--listen", "stdio://"], {
        env: commandEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      readline.createInterface({ input: this.child.stdout }).on("line", (line) => {
        this.handleIncomingLine(line);
      });

      readline.createInterface({ input: this.child.stderr }).on("line", () => {
        // Codex emits diagnostics here; keep the stream drained but do not surface every line.
      });

      this.child.on("exit", () => {
        this.child = null;
        this.initialized = false;
      });
    }

    if (!this.initialized) {
      await this.sendRequest("initialize", {
        clientInfo: {
          name: "PROGRAMS",
          version: "0.1.0",
        },
      });
      this.sendNotification("initialized");
      this.initialized = true;
    }
  }

  private async detectBinaryPath(): Promise<string | null> {
    if (process.env.PATH) {
      const result = await execCommand("command -v codex", process.cwd());
      const candidate = result.stdout.trim();
      if (result.code === 0 && candidate && (await this.isExecutable(candidate))) {
        return candidate;
      }
    }

    const candidate = "/Applications/Codex.app/Contents/Resources/codex";
    return (await this.isExecutable(candidate)) ? candidate : null;
  }

  private async resolveBinaryPath(settings: Settings): Promise<string | null> {
    if (settings.codexBinaryPath && (await this.isExecutable(settings.codexBinaryPath))) {
      return settings.codexBinaryPath;
    }

    return this.detectBinaryPath();
  }

  private async isExecutable(path: string): Promise<boolean> {
    try {
      await access(path, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  private sendNotification(method: string, params?: unknown): void {
    this.writeMessage({
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    });
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    const id = this.responseId++;

    return new Promise((resolve, reject) => {
      this.pendingResponses.set(id, { resolve, reject });
      this.writeMessage({
        jsonrpc: "2.0",
        id,
        method,
        ...(params === undefined ? {} : { params }),
      });
    });
  }

  private writeMessage(message: RpcMessage): void {
    if (!this.child) {
      throw new Error("Codex is not running.");
    }

    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleIncomingLine(line: string): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return;
    }

    if (message.method && message.id !== undefined) {
      void this.handleServerRequest(message);
      return;
    }

    if (message.id !== undefined && !message.method) {
      const pending = this.pendingResponses.get(message.id);
      if (!pending) {
        return;
      }

      this.pendingResponses.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      this.handleNotification(message.method, message.params);
    }
  }

  private async handleServerRequest(message: RpcMessage): Promise<void> {
    if (message.id === undefined || !message.method) {
      return;
    }

    switch (message.method) {
      case "item/fileChange/requestApproval": {
        const params = message.params as {
          threadId: string;
          turnId: string;
          itemId: string;
          reason?: string | null;
          grantRoot?: string | null;
        };
        const turn = this.findTurn(params.threadId, params.turnId);
        const decision =
          turn && turn.phase === "execute" && (!params.grantRoot || isSubPath(turn.projectRoot, params.grantRoot))
            ? "acceptForSession"
            : "cancel";
        this.writeMessage({
          jsonrpc: "2.0",
          id: message.id,
          result: { decision },
        });
        if (decision !== "acceptForSession") {
          this.emit({
            type: "toast",
            level: "error",
            message: "Codex requested file access outside the project. PROGRAMS blocked the update.",
          });
        }
        return;
      }
      case "item/commandExecution/requestApproval": {
        const params = message.params as {
          threadId: string;
          turnId: string;
          command?: string | null;
          cwd?: string | null;
        };
        const turn = this.findTurn(params.threadId, params.turnId);
        const command = params.command ?? "";
        const looksUnsafe = /(git\s+reset|rm\s+-rf|mkfs|diskutil|chmod\s+-R\s+777)/i.test(command);
        const inProject = !params.cwd || (turn ? isSubPath(turn.projectRoot, params.cwd) : false);
        const decision = turn && turn.phase === "execute" && inProject && !looksUnsafe ? "accept" : "cancel";
        this.writeMessage({
          jsonrpc: "2.0",
          id: message.id,
          result: { decision },
        });
        if (decision !== "accept") {
          this.emit({
            type: "toast",
            level: "error",
            message: "PROGRAMS blocked a command that needed extra access or looked destructive.",
          });
        }
        return;
      }
      default:
        this.writeMessage({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32601,
            message: `Unsupported server request: ${message.method}`,
          },
        });
    }
  }

  private handleNotification(method: string, params: unknown): void {
    switch (method) {
      case "account/login/completed": {
        const payload = params as { loginId?: string | null; success: boolean; error?: string | null };
        const loginId = payload.loginId ?? "";
        const pending = this.pendingLogins.get(loginId);
        if (!pending) {
          return;
        }
        this.pendingLogins.delete(loginId);
        if (payload.success) {
          pending.resolve();
        } else {
          pending.reject(new Error(payload.error || "Codex sign-in failed."));
        }
        return;
      }
      case "account/rateLimits/updated": {
        const parsed = rateLimitSnapshotSchema.safeParse(params);
        if (!parsed.success) {
          return;
        }

        const payload = parsed.data;
        this.latestRateLimits = {
          limitId: payload.limitId ?? null,
          primary: payload.primary
            ? {
                usedPercent: payload.primary.usedPercent,
                windowDurationMins: payload.primary.windowDurationMins ?? null,
                resetsAt: payload.primary.resetsAt ?? null,
              }
            : null,
          secondary: payload.secondary
            ? {
                usedPercent: payload.secondary.usedPercent,
                windowDurationMins: payload.secondary.windowDurationMins ?? null,
                resetsAt: payload.secondary.resetsAt ?? null,
              }
            : null,
        };
        return;
      }
      case "turn/plan/updated": {
        const payload = params as {
          threadId: string;
          turnId: string;
          explanation?: string | null;
          plan: Array<{ step: string; status: "pending" | "inProgress" | "completed" }>;
        };
        const turn = this.findTurn(payload.threadId, payload.turnId);
        if (!turn) {
          return;
        }

        turn.draft.explanation = payload.explanation ?? turn.draft.explanation;
        turn.draft.steps = payload.plan.map<PlanStep>((step) => ({
          step: step.step,
          status: step.status === "inProgress" ? "in_progress" : step.status,
        }));
        turn.draft.thinkingStatus = "in_progress";
        turn.draft.planningStatus = "in_progress";
        this.syncDraft(turn.draft);
        return;
      }
      case "turn/diff/updated": {
        const payload = params as { threadId: string; turnId: string; diff: string };
        const turn = this.findTurn(payload.threadId, payload.turnId);
        if (!turn) {
          return;
        }

        turn.draft.diff = payload.diff;
        turn.draft.buildingStatus = "in_progress";
        turn.draft.diffStats = parseUnifiedDiffStats(payload.diff);
        this.syncDraft(turn.draft);
        return;
      }
      case "item/started":
      case "item/completed": {
        const payload = params as { threadId: string; turnId: string; item: CodexItem };
        const turn = this.findTurn(payload.threadId, payload.turnId);
        const oneShot = this.findOneShot(payload.threadId, payload.turnId);
        if (!turn && !oneShot) {
          return;
        }

        if (payload.item.type === "agentMessage" && payload.item.text) {
          if (turn) {
            turn.pendingItems.set(payload.item.id, payload.item);
            turn.finalMessages.push(payload.item.text);
            if (turn.phase === "plan") {
              // The agent message is the structured plan JSON — keep it for
              // parsing in completeTurn, but don't surface the raw JSON as the
              // response (completeTurn sets finalText to the clean summary).
              turn.draft.thinkingStatus = "in_progress";
              turn.draft.planningStatus = "in_progress";
            } else if (turn.phase === "ask") {
              // Read-only answer: plain text — safe to surface directly.
              turn.draft.finalText = payload.item.text;
              turn.draft.explanation = payload.item.text;
              turn.draft.thinkingStatus = "in_progress";
            } else {
              // Execution: also structured JSON — don't surface raw.
              turn.draft.buildingStatus = "in_progress";
            }
            this.syncDraft(turn.draft);
          }

          if (oneShot) {
            oneShot.finalMessages.push(payload.item.text);
          }
          return;
        }

        if (turn) {
          turn.pendingItems.set(payload.item.id, payload.item);
          // Surface live reasoning + tool activity so planning/coding isn't a
          // silent wait — this streams into the renderer's "thinking" transcript.
          const line = this.formatTranscriptLine(payload.item, method as "item/started" | "item/completed");
          if (line) {
            this.appendTranscript(turn, line);
          }
        }
        return;
      }
      case "turn/completed": {
        const payload = params as { threadId: string; turn: { id: string; status: string; error?: { message?: string | null } | null } };
        const turn = this.findTurn(payload.threadId, payload.turn.id);
        const oneShot = this.findOneShot(payload.threadId, payload.turn.id);
        if (!turn && !oneShot) {
          return;
        }

        if (turn) {
          void this.completeTurn(turn, payload.turn);
        }

        if (oneShot) {
          this.completeOneShot(oneShot, payload.turn);
        }
        return;
      }
      default:
        return;
    }
  }

  // Append one line of live activity to the draft transcript, skipping exact
  // duplicates (an item can surface on both started and completed).
  private appendTranscript(turn: ActiveTurn, line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    turn.transcribedLines ??= new Set<string>();
    if (turn.transcribedLines.has(trimmed)) {
      return;
    }
    turn.transcribedLines.add(trimmed);
    turn.draft.transcript = turn.draft.transcript ? `${turn.draft.transcript}\n${trimmed}` : trimmed;
    this.syncDraft(turn.draft);
  }

  // Turn a Codex thread item into a short human-readable activity line, or null
  // if it carries nothing worth surfacing. Reasoning/web items are emitted once
  // complete; command/tool items are emitted as they start so progress shows ASAP.
  private formatTranscriptLine(item: CodexItem, method: "item/started" | "item/completed"): string | null {
    switch (item.type) {
      case "reasoning":
        return method === "item/completed" && item.text ? item.text.trim() : null;
      case "commandExecution": {
        if (method !== "item/started") {
          return null;
        }
        const cmd = Array.isArray(item.command) ? item.command.join(" ") : item.command ?? "";
        const short = cmd.length > 120 ? `${cmd.slice(0, 117)}…` : cmd;
        return short ? `\`${short}\`` : null;
      }
      case "fileChange": {
        if (method !== "item/completed") {
          return null;
        }
        const paths = (item.changes ?? []).map((c) => c.path).filter(Boolean);
        return paths.length ? `Edited ${paths.join(", ")}` : null;
      }
      case "mcpToolCall":
        return method === "item/started" && (item.server || item.tool)
          ? `Tool ${[item.server, item.tool].filter(Boolean).join("/")}`
          : null;
      case "webSearch":
        return method === "item/completed" && item.query ? `Searched the web: ${item.query}` : null;
      default:
        return null;
    }
  }

  private async completeTurn(turn: ActiveTurn, turnResult: unknown): Promise<void> {
    this.activeTurns.delete(turn.projectId);
    const parsedStatus = turnResultSchema.parse(turnResult);
    if (parsedStatus.status !== "completed") {
      const error = this.turnCompletionError(parsedStatus);
      turn.draft.status = "failed";
      if (turn.phase === "plan") {
        turn.draft.thinkingStatus = "failed";
        turn.draft.planningStatus = "failed";
      } else if (turn.phase === "ask") {
        turn.draft.thinkingStatus = "failed";
      } else {
        turn.draft.buildingStatus = "failed";
        if (turn.draft.planningMode === "none" && turn.draft.thinkingStatus === "in_progress") {
          turn.draft.thinkingStatus = "failed";
        }
      }
      turn.draft.errorMessage = error.message;
      this.syncDraft(turn.draft);
      turn.reject(error);
      return;
    }

    const finalText = [...turn.finalMessages].reverse().find(Boolean) ?? turn.draft.finalText ?? "";

    try {
      if (turn.phase === "ask") {
        // Plain-text answer — no schema parsing.
        turn.draft.status = "completed";
        turn.draft.thinkingStatus = "completed";
        turn.draft.finalText = finalText;
        turn.draft.errorMessage = null;
        this.syncDraft(turn.draft);
        turn.resolve({ ...turn.draft });
        return;
      }

      if (turn.phase === "plan") {
        const parsed = planResultSchema.parse(parseJsonFromText(finalText));
        turn.draft.status = "awaitingApproval";
        turn.draft.thinkingStatus = "completed";
        turn.draft.planningStatus = "completed";
        turn.draft.summary = parsed.summary;
        turn.draft.impact = parsed.impact;
        // Surface the clean summary as the response — never the raw JSON.
        turn.draft.finalText = parsed.summary;
        turn.draft.errorMessage = null;
        this.syncDraft(turn.draft);
        turn.resolve({ ...turn.draft });
        return;
      }

      const parsed = executionResultSchema.parse(parseJsonFromText(finalText));
      turn.draft.status = "executing";
      if (turn.draft.planningMode === "none") {
        turn.draft.thinkingStatus = "completed";
      }
      turn.draft.buildingStatus = "completed";
      turn.draft.verifyingStatus = "in_progress";
      turn.draft.summary = parsed.summary;
      turn.draft.errorMessage = null;
      // Clean prose, not the raw {summary,description,commitMessage} JSON.
      turn.draft.finalText = parsed.summary;
      turn.draft.verificationDetails = "Saving local changes and update history.";
      this.syncDraft(turn.draft);
      turn.resolve({
        draft: { ...turn.draft },
        summary: parsed.summary,
        description: parsed.description,
        commitMessage: parsed.commitMessage,
      });
    } catch (error) {
      turn.draft.status = "failed";
      if (turn.phase === "plan") {
        turn.draft.thinkingStatus = "failed";
        turn.draft.planningStatus = "failed";
      } else {
        turn.draft.buildingStatus = "failed";
        if (turn.draft.planningMode === "none" && turn.draft.thinkingStatus === "in_progress") {
          turn.draft.thinkingStatus = "failed";
        }
      }
      const message = formatStructuredOutputError("Codex", error);
      turn.draft.errorMessage = message;
      this.syncDraft(turn.draft);
      turn.reject(new Error(message));
    }
  }

  private completeOneShot(oneShot: ActiveOneShot, turnResult: unknown): void {
    this.activeOneShots.delete(this.turnKey(oneShot.threadId, oneShot.turnId));
    const parsedStatus = turnResultSchema.parse(turnResult);
    if (parsedStatus.status !== "completed") {
      oneShot.reject(this.turnCompletionError(parsedStatus));
      return;
    }

    const finalText = [...oneShot.finalMessages].reverse().find(Boolean) ?? "";
    if (!finalText) {
      oneShot.reject(new Error("Codex did not return a valid result."));
      return;
    }

    oneShot.resolve(finalText);
  }

  private findTurn(threadId: string, turnId: string): ActiveTurn | null {
    for (const turn of this.activeTurns.values()) {
      if (turn.threadId === threadId && turn.turnId === turnId) {
        return turn;
      }
    }

    return null;
  }

  private findOneShot(threadId: string, turnId: string): ActiveOneShot | null {
    return this.activeOneShots.get(this.turnKey(threadId, turnId)) ?? null;
  }

  private turnCompletionError(turnResult: z.infer<typeof turnResultSchema>): Error {
    if (turnResult.status === "interrupted") {
      return new Error("Codex stopped before finishing the update.");
    }

    return new Error(extractTurnErrorMessage(turnResult.error?.message) ?? "Codex could not finish the turn.");
  }

  private turnKey(threadId: string, turnId: string): string {
    return `${threadId}:${turnId}`;
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

const extractTurnErrorMessage = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { message?: unknown } | null;
      message?: unknown;
    };
    const nested =
      parsed?.error && typeof parsed.error === "object" && typeof parsed.error.message === "string"
        ? parsed.error.message
        : typeof parsed?.message === "string"
          ? parsed.message
          : null;
    if (nested?.trim()) {
      return nested.trim();
    }
  } catch {
    // Leave non-JSON error messages untouched.
  }

  return trimmed;
};

const clampPercent = (value: number): number => Math.min(100, Math.max(0, Math.round(value)));

const toIsoTimestamp = (unixSeconds: number | null): string | null =>
  typeof unixSeconds === "number" ? new Date(unixSeconds * 1000).toISOString() : null;

const formatWindowSpan = (value: number, unit: string): string => `${value}-${unit} window`;

const formatUsageWindowLabel = (windowDurationMins: number | null): string => {
  if (!windowDurationMins || windowDurationMins < 1) {
    return "Usage window";
  }

  if (windowDurationMins % (60 * 24) === 0) {
    return formatWindowSpan(windowDurationMins / (60 * 24), "day");
  }

  if (windowDurationMins % 60 === 0) {
    return formatWindowSpan(windowDurationMins / 60, "hour");
  }

  return formatWindowSpan(windowDurationMins, "minute");
};
