import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { app, shell } from "electron";
import {
  CLAUDE_DOWNLOAD_URL,
  CODEX_DOWNLOAD_URL,
  GIT_DOWNLOAD_URL,
  EMPTY_RUNTIME,
} from "@main/defaults";
import { ClaudeService } from "@main/services/claude-service";
import { CodexService } from "@main/services/codex-service";
import { GitService } from "@main/services/git-service";
import { PlaywrightService } from "@main/services/playwright-service";
import {
  ensureProjectGitignoreSecretRules,
  formatSecretBlockMessage,
  isSecretLikePath,
  ProjectBackupService,
} from "@main/services/project-backup-service";
import { ProjectStore } from "@main/services/project-store";
import { RunnerService } from "@main/services/runner-service";
import { collectProjectRepoHints, formatProjectRepoHints, type ProjectRepoHints } from "@main/utils/project-hints";
import { emitSettledAppUpdateStatus } from "@main/utils/app-update";
import {
  createPendingApproval,
  getPendingApproval,
  removePendingApproval,
  updatePendingApproval,
} from "@main/utils/approval-queue";
import { resolveBasicAutomationUsagePause } from "@main/utils/basic-automation";
import { getProviderPreflightError } from "@main/utils/provider-auth";
import { parseEnvEntries, parseProjectOutlineReportResponse, serializeEnvEntries } from "@main/utils/project-outline";
import { parseAgentJsonResponse, AgentJsonParseError } from "@main/utils/agent-json";
import {
  detectRuntimeConfig,
  deriveAttachedProjectName,
  deriveProjectDescription,
  getRunCommandSuggestions,
  reconcileRuntimeConfig,
  resolveLaunchPlan,
  type LaunchResolution,
} from "@main/utils/project";
import { allocatePort, isValidAssignedPort } from "@main/utils/port-allocator";
import {
  buildAgentChatApprovalDescriptor,
  buildAgentChatProviderAttemptPlan,
  canAutoRouteAgentChatDirector,
  buildAgentChatResponseContract,
  normalizeAgentChatDirectorMode,
  resolveAgentChatDirectRoute,
  resolveAgentChatDirectorMode,
  validateAgentChatTurnParsedResponse,
} from "@main/utils/agent-chat-flow";
import { resolveDirectorChatFocusMode } from "@main/utils/director-chat-mode";
import {
  danAgentChatSchema,
  directorAgentChatSchema,
  pingAgentChatSchema,
  refreshScanSchema,
  researchAgentChatSchema,

} from "@main/utils/agent-chat-schema";
import {
  directorPongCompareSchema,
  directorPongGoalSchema,
  directorPongTestSchema,
  directorPingSchema,
  directorPmSchema,
  directorToddReviewSchema,
  directorToddRegenerateSchema,
  directorToddResearchSchema,
  directorToddUpdateSchema,
} from "@main/utils/director-chat-schema";
import { ensureDirectory, pathExists, readTextFile, writeTextFile } from "@main/utils/fs";
import { execCommand } from "@main/utils/process";
import {
  sanitizeDanArchivedNotes,
  sanitizeDirectorStateMap,
  sanitizePendingApprovals,
  sanitizeSlackPresenceGuestId,
  sanitizeSlackResponseContent,
} from "@shared/agent-session";
import {
  collectUsedProjectIconColors,
  normalizeProjectIconColor,
  pickAvailableProjectIconColor,
} from "@shared/project-colors";
import {
  BIG_CLAUDE_MODEL,
  BIG_CODEX_MODEL,
  getDirectorRuntimeDefaults,
  getDirectorMetadata,
  resolveDirectorModelSelection,
  usesFixedDirectorRuntimePolicy,
  type DirectorModelUseCase,
  type DirectorRuntimeDefaults,
} from "@shared/director-metadata";
import {
  buildPingLifecycleTranslationMetadata,
  buildPingStatusTranslationMetadata,
  buildTranslatedMessageMetadata,
  getPingStatusTranslation,
} from "@shared/ping-translations";
import {
  DEFAULT_MODEL_CATALOG,
  AGENT_STAGES,
  AGENT_STAGE_LABELS,
  DIRECTOR_LABELS,
  DIRECTOR_NAMES,
  DIRECTOR_COLORS,
  createEmptyProjectRelationshipSummary,
  normalizeDirectorId,
  type HardMemoryReportDataType,
  type HardMemoryReportMetadata,
  type HardMemoryReportUpdate,
} from "@shared/types";
import {
  BRANCH_PILLAR_TYPES,
  MAIN_TIMELINE_PILLAR_TYPES,
  formatPillarFlowSection,
  sortPillarsByOrder,
} from "@shared/pillar-flow";
import type {
  AgentChatInput,
  AgentChatMessage,
  AgentChatResponse,
  AgentChatDirectorApprovalPayload,
  AgentChatDirectorMode,
  AgentCoreDetails,
  DirectorChatRuntimeStage,
  AgentExecuteUpdateInput,
  AgentPlannedUpdate,
  AgentSession,
  AgentStage,
  AgentStageData,
  ConfirmAgentDataInput,
  CascadeProposal,
  CoreDetailsProposal,
  AiProvider,
  BasicAutomationSkippedProject,
  BasicAutomationStatus,
  AutomationConstraints,
  AutomationRunState,
  AutomationStopReason,
  AutomationTargetCandidate,
  AppUpdateStatus,
  AppEvent,
  ApprovePlanInput,
  AttachPathInspection,
  BootstrapPayload,
  ClaudeAuthStatus,
  CodexAuthStatus,
  CreativeFocusMode,
  DirectorChatInput,
  DirectorChatResponse,
  DirectorConversation,
  DirectorFocusMode,
  DirectorId,
  DirectorStructuredData,
  DanDraftOperation,
  DanMemory,
  DanRawMemory,
  DanHistoryLogEntry,
  JeffMemory,
  JeffManagerSummary,
  JeffProjectStatusEntry,
  JeffOutcomeDecision,
  JeffOutcomeEntry,
  MemoryResolution,
  MemorySourceRef,
  PongMemory,
  PongValidationReport,
  TaggedNote,
  EnvFileSnapshot,
  FeasibilityAssessment,
  GenerateProjectOutlineReportInput,
  JeffExecutionReport,
  ModelCatalog,
  PillarThread,
  PingMemory,
  PingExecutionReportSnapshot,
  PingPlanSnapshot,
  PingRawReport,
  PingRawReportStatus,
  PingRuntimeSnapshot,
  PingRunSnapshot,
  PingTaskSnapshot,
  PingTaskSource,
  ProjectCategory,
  ProjectKnowledgeFingerprint,
  ProjectKnowledgeStatus,
  ProjectDirectorProgress,
  RdFocusMode,
  ReasoningEffort,
  ValidationFocusMode,
  PlanDraft,
  Project,
  ProjectAttachInput,
  ProjectBackupInfo,
  ProjectCreateInput,
  ProjectDetail,
  ProjectRelationshipCandidate,
  ProjectRelationshipSummary,
  ProjectOutlineReport,
  ProjectSafetyState,
  RenameProjectInput,
  RouteUpdateToProgrammingInput,
  RunValidationInput,
  SetValidationFrequencyInput,
  Settings,
  SettingsUpdateInput,
  SetupCheck,
  ProjectChatInput,
  SetupSnapshot,
  StartPingDirectUpdateInput,
  StartPlanInput,
  UpdateProjectInput,
  UpdateRecord,
  RuntimeState,
  UsageSnapshot,
  UsageCapture,
  ValidationResult,
  ToddCodebaseIndexedMap,
  ToddIndexedMapSnapshot,
  ToddMemory,
  ToddSuccessChainStep,
  ToddNextUpdate,
  VersionPlan,
  VersionUpdate,
  PlanningMode,
  WriteProjectEnvFileInput,
  ListPendingApprovalsInput,
  ListAutomationTargetsInput,
  ListAutomationTargetsResponse,
  PauseAutomationRunInput,
  PendingApproval,
  PendingApprovalKind,
  DiffStats,
  PlaywrightRunInput,
  PlaywrightRunResult,
  ClaudeConnectionTestResult,
  ConfirmAutomationFailureRecoveryInput,
  RequestAutomationFailureRecoveryInput,
  DeleteAgentMessagesInput,
  ApprovePendingApprovalInput,
  RevisePendingApprovalInput,
  DirectorSettingsOverride,
  DirectorStateSnapshot,
  RefreshProjectInput,
  RegenerateToddPlanInput,
  CorePillar,
  StageAgentChatInput,
  StageAgentChatResponse,
  StageAgentMessage,
  StartAutomationRunInput,
  StopAutomationRunInput,
  ToddSimplificationMode,
  ToddUpdateKind,
  ToddUpdatePlanDraftPayload,
  ToddUpdatePlanSource,
  ToddRoadmap,
  ToddCurrentStateItem,
  ToddEndStateItem,
  ToddPathwayItem,
  ToddPriorityUpdate,
  ToddValidationRequest,
  UpdatePendingApprovalStatusInput,
  RunCommandSuggestions,
  GithubAuthStatus,
  GithubConnection,
  GithubPublishInput,
  DownloadFromGithubResult,
  SaveToGithubResult,
  RestoreProjectBackupResult,
  CommitPreviewResult,
} from "@shared/types";

type Emit = (event: AppEvent) => void;

const IGNORED_LAUNCH_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".programs",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "vendor",
]);

function resolveDirectorRuntime(
  session: AgentSession | null,
  directorId: DirectorId,
): DirectorRuntimeDefaults {
  const base = getDirectorRuntimeDefaults(directorId);
  if (usesFixedDirectorRuntimePolicy(directorId)) {
    return base;
  }
  const overrides = session?.directorSettingsOverrides?.[directorId];
  if (!overrides) return base;
  return {
    reasoningEffort: overrides.reasoningEffort ?? base.reasoningEffort,
    planningMode: overrides.planningMode ?? base.planningMode,
  };
}

function resolveDirectorRequestedModels(
  session: AgentSession | null,
  directorId: DirectorId,
  model: StartPlanInput["model"],
  claudeModel: StartPlanInput["claudeModel"],
): { model: StartPlanInput["model"]; claudeModel: StartPlanInput["claudeModel"] } {
  const overrides = session?.directorSettingsOverrides?.[directorId];
  return {
    model: overrides?.model ?? model,
    claudeModel: overrides?.claudeModel ?? claudeModel,
  };
}

function resolvePingRunModelSelections(
  session: AgentSession | null,
  provider: AiProvider,
  model: StartPlanInput["model"],
  claudeModel: StartPlanInput["claudeModel"],
): {
  planning: ReturnType<typeof resolveDirectorModelSelection>;
  execution: ReturnType<typeof resolveDirectorModelSelection>;
} {
  const requestedModels = resolveDirectorRequestedModels(
    session,
    "programming-director",
    model,
    claudeModel,
  );

  return {
    planning: resolveDirectorModelSelection(
      "programming-director",
      provider,
      requestedModels.model,
      requestedModels.claudeModel,
      "planning",
    ),
    execution: resolveDirectorModelSelection(
      "programming-director",
      provider,
      requestedModels.model,
      requestedModels.claudeModel,
      "execution",
    ),
  };
}

function applyPingExecutionRuntimeToDraft(draft: PlanDraft): void {
  const runtime = draft.pingTaskSnapshot?.runtime;
  if (!runtime) {
    return;
  }

  draft.provider = runtime.provider;
  draft.model = runtime.model;
  draft.claudeModel = runtime.claudeModel;
  draft.reasoningEffort = runtime.reasoningEffort;
  draft.contextPaths = [...runtime.contextPaths];
}

function isLargeModelSelection(
  provider: AiProvider,
  model: StartPlanInput["model"],
  claudeModel: StartPlanInput["claudeModel"],
): boolean {
  return provider === "claude"
    ? claudeModel === BIG_CLAUDE_MODEL
    : model === BIG_CODEX_MODEL;
}

function buildPingUpdatePrompt(input: {
  nextUpdate: ToddNextUpdate;
  currentStateItems: ToddCurrentStateItem[];
  priorityUpdate?: ToddPriorityUpdate | null;
}): string {
  const priorityContext = input.nextUpdate.currentStateContext?.trim()
    || input.priorityUpdate?.currentStateContext?.trim()
    || null;
  const currentStateSummary = input.currentStateItems.length > 0
    ? input.currentStateItems
      .map((item) => `- [${item.itemStatus.toUpperCase()}] ${item.title}: ${item.description}`)
      .join("\n")
    : "";
  const successDefinitions = [
    input.nextUpdate.successDefinition ? `Success: ${input.nextUpdate.successDefinition}` : null,
    input.nextUpdate.partialSuccessDefinition ? `Partial Success: ${input.nextUpdate.partialSuccessDefinition}` : null,
    input.nextUpdate.partialFailureDefinition ? `Partial Failure: ${input.nextUpdate.partialFailureDefinition}` : null,
    input.nextUpdate.failureDefinition ? `Failure: ${input.nextUpdate.failureDefinition}` : null,
  ].filter(Boolean).join("\n");
  const executionFrame = [
    input.nextUpdate.updateKind ? `Update Kind: ${input.nextUpdate.updateKind}` : null,
    input.nextUpdate.simplificationMode ? `Simplification Mode: ${input.nextUpdate.simplificationMode}` : null,
    input.nextUpdate.structuralReason ? `Structural Reason: ${input.nextUpdate.structuralReason}` : null,
    input.nextUpdate.supportsNextStep ? `Supports Next Step: ${input.nextUpdate.supportsNextStep}` : null,
    input.nextUpdate.dependencies.length > 0 ? `Dependencies: ${input.nextUpdate.dependencies.join(", ")}` : null,
    input.nextUpdate.skillsNeeded.length > 0 ? `Skills Needed: ${input.nextUpdate.skillsNeeded.join(", ")}` : null,
  ].filter(Boolean).join("\n");
  const sections = [
    `Priority Update: ${input.nextUpdate.title}`,
    "",
    `Exact Scope: ${input.nextUpdate.description}`,
    priorityContext ? `\nCurrent State Context:\n${priorityContext}` : "",
    currentStateSummary ? `\nCurrent-State Map:\n${currentStateSummary}` : "",
    successDefinitions ? `\nOutcome Definitions:\n${successDefinitions}` : "",
    executionFrame ? `\nExecution Frame:\n${executionFrame}` : "",
  ].filter((section) => section.length > 0);
  return sections.join("\n");
}

function buildToddNextUpdateFromExecutionContext(input: {
  update: VersionUpdate;
  nextUpdate: ToddNextUpdate | null;
  priorityUpdate: ToddPriorityUpdate | null;
  currentState: string | null;
}): ToddNextUpdate {
  const trackedNextUpdate = input.nextUpdate
    && (input.nextUpdate.id === input.update.id || input.nextUpdate.title === input.update.title)
    ? input.nextUpdate
    : null;
  const priorityUpdate = input.priorityUpdate
    && (input.priorityUpdate.id === input.update.id || input.priorityUpdate.title === input.update.title)
    ? input.priorityUpdate
    : input.priorityUpdate;

  return {
    id: trackedNextUpdate?.id ?? input.update.id,
    title: trackedNextUpdate?.title ?? input.update.title,
    description: trackedNextUpdate?.description ?? input.update.description,
    pillarIds: trackedNextUpdate?.pillarIds?.length
      ? [...trackedNextUpdate.pillarIds]
      : priorityUpdate?.pillarIds?.length
        ? [...priorityUpdate.pillarIds]
        : [...(input.update.pillarIds ?? [])],
    currentStateContext: trackedNextUpdate?.currentStateContext
      ?? priorityUpdate?.currentStateContext
      ?? input.currentState
      ?? null,
    successDefinition: trackedNextUpdate?.successDefinition ?? priorityUpdate?.successDefinition ?? null,
    partialSuccessDefinition: trackedNextUpdate?.partialSuccessDefinition ?? priorityUpdate?.partialSuccessDefinition ?? null,
    partialFailureDefinition: trackedNextUpdate?.partialFailureDefinition ?? priorityUpdate?.partialFailureDefinition ?? null,
    failureDefinition: trackedNextUpdate?.failureDefinition ?? priorityUpdate?.failureDefinition ?? null,
    updateKind: trackedNextUpdate?.updateKind ?? input.update.updateKind ?? null,
    simplificationMode: trackedNextUpdate?.simplificationMode ?? input.update.simplificationMode ?? null,
    structuralReason: trackedNextUpdate?.structuralReason ?? input.update.structuralReason ?? null,
    supportsNextStep: trackedNextUpdate?.supportsNextStep ?? input.update.supportsNextStep ?? null,
    skillsNeeded: trackedNextUpdate?.skillsNeeded?.length
      ? [...trackedNextUpdate.skillsNeeded]
      : [...(input.update.skillsNeeded ?? [])],
    dependencies: trackedNextUpdate?.dependencies?.length
      ? [...trackedNextUpdate.dependencies]
      : [...(input.update.dependencies ?? [])],
  };
}

function buildToddApprovedPingTaskSnapshot(
  session: AgentSession,
  input: {
    projectId: string;
    update: VersionUpdate;
    provider: AiProvider;
    model: StartPlanInput["model"];
    claudeModel: StartPlanInput["claudeModel"];
    reasoningEffort: ReasoningEffort;
    planningMode: PlanningMode;
    contextPaths?: string[];
  },
): PingTaskSnapshot {
  const pingModelSelections = resolvePingRunModelSelections(
    session,
    input.provider,
    input.model,
    input.claudeModel,
  );
  const roadmap = session.toddMemory.hardMemory ?? session.toddMemory.roadmap ?? null;
  const priorityUpdate = roadmap?.priorityUpdate ?? null;
  const currentStateItems = roadmap?.currentState ?? [];
  const handoffUpdate = buildToddNextUpdateFromExecutionContext({
    update: input.update,
    nextUpdate: session.toddMemory.nextUpdate,
    priorityUpdate,
    currentState: session.toddMemory.currentState,
  });
  const updateTitle = handoffUpdate.title;
  const updateDescription = handoffUpdate.description;
  const relevantPillarIds = handoffUpdate.pillarIds.length > 0 ? handoffUpdate.pillarIds : input.update.pillarIds ?? [];
  const sourceRefs = priorityUpdate?.sourceRefs ?? [];
  const mirroredPriorityUpdate = buildToddPriorityUpdateFromNextUpdate(handoffUpdate, sourceRefs);

  return buildPingTaskSnapshot({
    source: "todd-approved-update",
    projectId: input.projectId,
    updateId: input.update.id,
    updateTitle,
    updateDescription,
    originalUserRequest: resolveLatestHumanRequest(session, `${updateTitle}: ${updateDescription}`),
    toddExplanation: updateDescription,
    relevantPillarIds,
    currentStateItems,
    priorityUpdate: mirroredPriorityUpdate,
    sourceRefs,
    indexedMap: session.toddMemory.codebaseIndexedMap ? { ...session.toddMemory.codebaseIndexedMap } : null,
    toddCodebaseMapSummary: null,
    coreDetailsContext: null,
    runtime: {
      provider: input.provider,
      model: pingModelSelections.execution.model,
      claudeModel: pingModelSelections.execution.claudeModel,
      reasoningEffort: input.reasoningEffort,
      planningMode: input.planningMode,
      contextPaths: [...(input.contextPaths ?? [])],
    },
  });
}

function buildPingAcknowledgementText(task: PingTaskSnapshot): string {
  if (task.updateTitle) {
    return `I'll map the plan for "${task.updateTitle}" now.`;
  }
  return "I'll map the plan for this update now.";
}

function formatJeffOutcomeDecisionLabel(decision: JeffOutcomeDecision): string {
  switch (decision) {
    case "successful":
      return "successful";
    case "partially-successful":
      return "partially successful";
    case "failure":
      return "a failure";
    default:
      return "pending review";
  }
}

function isPingStartupFailure(error: unknown): error is Error & {
  startupFailed: true;
  replacementThreadId?: string | null;
} {
  return Boolean(
    error
    && typeof error === "object"
    && "startupFailed" in error
    && (error as { startupFailed?: boolean }).startupFailed === true,
  );
}

function formatStructuredOutputIssueMessage(message: string | null | undefined): string | null {
  const trimmed = message?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      return trimmed;
    }

    const issues = parsed
      .filter(isRecord)
      .map((issue) => {
        const path = Array.isArray(issue.path)
          ? issue.path.filter((entry) => typeof entry === "string" || typeof entry === "number").join(".")
          : "result";
        const detail = typeof issue.message === "string" && issue.message.trim()
          ? issue.message.trim()
          : "Invalid value";
        return `${path || "result"}: ${detail}`;
      });
    return issues.length > 0 ? `Structured output validation failed: ${issues.join("; ")}` : trimmed;
  } catch {
    return trimmed;
  }
}

function hasToddVersionRoadmap(session: AgentSession): boolean {
  return (session.toddMemory.successChain?.length ?? 0) > 0;
}

function resolveToddMemoryProcessingFocusMode(_session: AgentSession): RdFocusMode {
  return "update-planning";
}

function resolveDirectorModelUseCase(
  directorId: DirectorId,
  focusMode: DirectorFocusMode | AgentChatDirectorMode | null,
  runtimeStage: DirectorChatRuntimeStage | undefined,
): DirectorModelUseCase {
  if (directorId === "programming-director") {
    return "execution";
  }
  if (directorId === "creative-director") {
    return runtimeStage === "memory-processing" ? "synthesis" : "conversation";
  }
  if (
    directorId === "rd-director"
    && (
      runtimeStage === "memory-processing"
      || focusMode === "version-planning"
      || focusMode === "update-planning"
    )
  ) {
    return "synthesis";
  }
  return "conversation";
}

function shouldAllowDanHardMemory(runtimeStage: DirectorChatRuntimeStage | undefined): boolean {
  return runtimeStage === "memory-processing";
}

function shouldConsumeToddPendingHandoff(
  focusMode: DirectorFocusMode | AgentChatDirectorMode | null,
  runtimeStage: DirectorChatRuntimeStage | undefined,
): boolean {
  return runtimeStage === "memory-processing"
    || focusMode === "version-planning"
    || focusMode === "update-planning";
}

function requiresApprovalForSlackDirectorRun(
  directorId: DirectorId,
  mode: AgentChatDirectorMode,
): boolean {
  return directorId === "rd-director" && mode === "internet-research";
}

const APP_UPDATE_FRESHNESS_WINDOW_MS = 1000;
const APP_UPDATE_SOURCE_ROOTS = ["src", "scripts"] as const;
const APP_UPDATE_SOURCE_FILES = [
  "build/icon.icns",
  "build/icon.png",
  "build/icon.svg",
  "package.json",
  "package-lock.json",
  "electron-builder.yml",
  "electron.vite.config.ts",
  "tsconfig.json",
] as const;

const SLACK_DIRECTOR_INTRO_DELAY_MS = 0;
const SLACK_DIRECTOR_POST_INTRO_DELAY_MS = 0;
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const BASIC_AUTOMATION_WAIT_POLL_MS = 30_000;
const BASIC_AUTOMATION_IDLE_POLL_MS = 45_000;
const BASIC_AUTOMATION_RUN_SETTLE_MS = 1_500;

const PROJECT_KNOWLEDGE_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  ".cache",
  ".parcel-cache",
  ".vite",
  ".yarn",
  "logs",
  "log",
  "screenshots",
  "__snapshots__",
  "__image_snapshots__",
  "tmp",
  "temp",
]);

const PROJECT_KNOWLEDGE_MONITORED_EXTENSIONS = new Set([
  ".astro",
  ".bash",
  ".cjs",
  ".conf",
  ".config",
  ".css",
  ".cts",
  ".env",
  ".gql",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".less",
  ".mjs",
  ".mts",
  ".php",
  ".prisma",
  ".proto",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

const PROJECT_KNOWLEDGE_MONITORED_FILENAMES = new Set([
  ".env",
  ".env.development",
  ".env.development.local",
  ".env.local",
  ".env.production",
  ".env.production.local",
  ".env.test",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  ".prettierignore",
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.js",
  ".prettierrc.cjs",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "makefile",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "requirements.txt",
  "tsconfig.json",
  "tsconfig.base.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "vite.config.js",
  "vitest.config.ts",
  "vitest.config.js",
  "webpack.config.js",
  "webpack.config.ts",
  "yarn.lock",
]);

const normalizeProjectKnowledgePath = (rootPath: string, fullPath: string): string =>
  relative(rootPath, fullPath).split(sep).join("/");

const shouldSkipProjectKnowledgeDirectory = (relativePath: string): boolean =>
  relativePath.split("/").some((segment) => PROJECT_KNOWLEDGE_IGNORED_DIRS.has(segment.toLowerCase()));

const shouldMonitorProjectKnowledgeFile = (relativePath: string): boolean => {
  const normalized = relativePath.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const parts = normalized.split("/");
  if (parts.some((segment) => PROJECT_KNOWLEDGE_IGNORED_DIRS.has(segment))) {
    return false;
  }

  const filename = parts.at(-1) ?? normalized;
  if (PROJECT_KNOWLEDGE_MONITORED_FILENAMES.has(filename)) {
    return true;
  }
  if (filename.startsWith(".env")) {
    return true;
  }
  if (/^dockerfile(\.[a-z0-9_-]+)?$/i.test(filename)) {
    return true;
  }
  if (/^tsconfig(\.[a-z0-9_-]+)?\.json$/i.test(filename)) {
    return true;
  }

  return PROJECT_KNOWLEDGE_MONITORED_EXTENSIONS.has(extname(filename));
};

const PROJECT_RELATIONSHIP_EXCLUDED_FILENAMES = new Set([
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  ".prettierignore",
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.js",
  ".prettierrc.cjs",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);
const PROJECT_RELATIONSHIP_RUNTIME_DIRS = new Set([
  "__pycache__",
  ".venv",
  "venv",
  ".pytest_cache",
  ".mypy_cache",
  "downloads",
  "download",
  "collections",
  "collection",
  "profile_images",
  "thumbcache",
  "uploads",
  "upload",
  "archives",
  "archive",
  "artifacts",
  "storage",
  "media-cache",
]);
const PROJECT_RELATIONSHIP_NEAR_EXACT_THRESHOLD = 0.95;
const PROJECT_RELATIONSHIP_INTEGRATION_MIN_SHARED_FILES = 3;
const PROJECT_RELATIONSHIP_SEARCH_TEXT_LIMIT = 250_000;
const PROJECT_RELATIONSHIP_SEARCH_FILE_MAX_CHARS = 32_000;

interface ProjectRelationshipSnapshot {
  project: Project;
  fileHashCounts: Map<string, number>;
  meaningfulFileCount: number;
  contentUpdatedAt: string | null;
  searchText: string;
  referenceNeedles: string[];
  scanFailed: boolean;
  previousRelationship: ProjectRelationshipSummary;
}

const normalizeProjectRelationshipReferenceValue = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const buildProjectRelationshipReferenceNeedles = (project: Project): string[] => {
  const candidates = new Set<string>();
  const rawValues = [project.name, basename(project.localPath)];

  for (const rawValue of rawValues) {
    const exact = rawValue.trim().toLowerCase();
    if (exact.length >= 5) {
      candidates.add(exact);
    }

    const normalized = normalizeProjectRelationshipReferenceValue(rawValue);
    if (normalized.length >= 5) {
      candidates.add(normalized);
      candidates.add(normalized.replace(/_/g, "-"));
      candidates.add(normalized.replace(/_/g, ""));
    }
  }

  return [...candidates].filter((value) => value.length >= 5).sort();
};

const shouldSkipProjectRelationshipDirectory = (relativePath: string): boolean => {
  const parts = relativePath.split("/").map((segment) => segment.toLowerCase());
  return parts.some((segment) =>
    PROJECT_KNOWLEDGE_IGNORED_DIRS.has(segment) || PROJECT_RELATIONSHIP_RUNTIME_DIRS.has(segment)
  );
};

const shouldAnalyzeProjectRelationshipFile = (relativePath: string): boolean => {
  if (!shouldMonitorProjectKnowledgeFile(relativePath)) {
    return false;
  }

  const normalized = relativePath.trim().toLowerCase();
  const filename = normalized.split("/").at(-1) ?? normalized;
  if (filename.startsWith(".env")) {
    return false;
  }

  if (PROJECT_RELATIONSHIP_EXCLUDED_FILENAMES.has(filename)) {
    return false;
  }

  if (filename.endsWith(".log") || filename.endsWith(".snap")) {
    return false;
  }

  return true;
};

const normalizeProjectRelationshipFileContent = (content: string): string =>
  content
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n+$/g, "");

const collectProjectRelationshipFiles = async (
  rootPath: string,
): Promise<Array<{ fullPath: string; mtimeMs: number }>> => {
  const files: Array<{ fullPath: string; mtimeMs: number }> = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const currentPath = queue.pop();
    if (!currentPath) {
      continue;
    }

    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      const relativePath = normalizeProjectKnowledgePath(rootPath, fullPath);
      if (!relativePath || relativePath === ".") {
        continue;
      }

      if (entry.isDirectory()) {
        if (!shouldSkipProjectRelationshipDirectory(relativePath)) {
          queue.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile() || !shouldAnalyzeProjectRelationshipFile(relativePath)) {
        continue;
      }

      try {
        const metadata = await stat(fullPath);
        files.push({
          fullPath,
          mtimeMs: Math.floor(metadata.mtimeMs),
        });
      } catch {
        continue;
      }
    }
  }

  files.sort((left, right) => left.fullPath.localeCompare(right.fullPath));
  return files;
};

const buildProjectRelationshipSnapshot = async (project: Project): Promise<ProjectRelationshipSnapshot> => {
  try {
    if (!(await pathExists(project.localPath))) {
      throw new Error("Project path does not exist.");
    }

    const files = await collectProjectRelationshipFiles(project.localPath);
    const fileHashCounts = new Map<string, number>();
    let latestMtimeMs: number | null = null;
    let searchText = "";

    for (const file of files) {
      const raw = await readFile(file.fullPath, "utf8");
      const normalizedContent = normalizeProjectRelationshipFileContent(raw);
      const digest = createHash("sha1").update(normalizedContent).digest("hex");
      fileHashCounts.set(digest, (fileHashCounts.get(digest) ?? 0) + 1);
      latestMtimeMs = latestMtimeMs == null ? file.mtimeMs : Math.max(latestMtimeMs, file.mtimeMs);
      if (searchText.length < PROJECT_RELATIONSHIP_SEARCH_TEXT_LIMIT && normalizedContent.length > 0) {
        const nextChunk = normalizedContent
          .slice(0, PROJECT_RELATIONSHIP_SEARCH_FILE_MAX_CHARS)
          .toLowerCase();
        const remaining = PROJECT_RELATIONSHIP_SEARCH_TEXT_LIMIT - searchText.length;
        searchText += `\n${nextChunk}`.slice(0, remaining);
      }
    }

    return {
      project,
      fileHashCounts,
      meaningfulFileCount: files.length,
      contentUpdatedAt: latestMtimeMs == null ? null : new Date(latestMtimeMs).toISOString(),
      searchText,
      referenceNeedles: buildProjectRelationshipReferenceNeedles(project),
      scanFailed: false,
      previousRelationship: project.relationship,
    };
  } catch {
    return {
      project,
      fileHashCounts: new Map<string, number>(),
      meaningfulFileCount: 0,
      contentUpdatedAt: project.relationship.contentUpdatedAt,
      searchText: "",
      referenceNeedles: buildProjectRelationshipReferenceNeedles(project),
      scanFailed: true,
      previousRelationship: project.relationship,
    };
  }
};

const projectRelationshipHasReference = (
  source: ProjectRelationshipSnapshot,
  target: ProjectRelationshipSnapshot,
): boolean => target.referenceNeedles.some((needle) => needle.length >= 5 && source.searchText.includes(needle));

const countSharedRelationshipFiles = (
  left: Map<string, number>,
  right: Map<string, number>,
): number => {
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  let shared = 0;

  for (const [hash, count] of smaller.entries()) {
    shared += Math.min(count, larger.get(hash) ?? 0);
  }

  return shared;
};

const compareProjectRelationshipCandidates = (
  left: ProjectRelationshipCandidate,
  right: ProjectRelationshipCandidate,
): number => {
  if (right.overlapRatio !== left.overlapRatio) {
    return right.overlapRatio - left.overlapRatio;
  }
  if (right.sharedFileCount !== left.sharedFileCount) {
    return right.sharedFileCount - left.sharedFileCount;
  }
  return left.projectId.localeCompare(right.projectId);
};

const sameProjectRelationshipSummary = (
  left: ProjectRelationshipSummary,
  right: ProjectRelationshipSummary,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const readProjectHeadSha = async (localPath: string): Promise<string | null> => {
  const result = await execCommand("git rev-parse --verify HEAD", localPath);
  return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
};

const collectProjectKnowledgeFiles = async (
  rootPath: string,
): Promise<Array<{ path: string; size: number; mtimeMs: number }>> => {
  const files: Array<{ path: string; size: number; mtimeMs: number }> = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const currentPath = queue.pop();
    if (!currentPath) {
      continue;
    }

    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      const relativePath = normalizeProjectKnowledgePath(rootPath, fullPath);
      if (!relativePath || relativePath === ".") {
        continue;
      }

      if (entry.isDirectory()) {
        if (!shouldSkipProjectKnowledgeDirectory(relativePath)) {
          queue.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile() || !shouldMonitorProjectKnowledgeFile(relativePath)) {
        continue;
      }

      try {
        const metadata = await stat(fullPath);
        files.push({
          path: relativePath,
          size: metadata.size,
          mtimeMs: Math.floor(metadata.mtimeMs),
        });
      } catch {
        continue;
      }
    }
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
};

const buildProjectKnowledgeFingerprint = async (localPath: string): Promise<ProjectKnowledgeFingerprint | null> => {
  if (!(await pathExists(localPath))) {
    return null;
  }

  const [headSha, files] = await Promise.all([
    readProjectHeadSha(localPath),
    collectProjectKnowledgeFiles(localPath),
  ]);

  if (!headSha && files.length === 0) {
    return null;
  }

  const hasher = createHash("sha1");
  hasher.update(headSha ?? "no-head");
  let totalBytes = 0;
  let latestMtimeMs: number | null = null;
  for (const file of files) {
    totalBytes += file.size;
    latestMtimeMs = latestMtimeMs == null ? file.mtimeMs : Math.max(latestMtimeMs, file.mtimeMs);
    hasher.update(`\n${file.path}|${file.size}|${file.mtimeMs}`);
  }

  return {
    headSha,
    digest: hasher.digest("hex"),
    fileCount: files.length,
    totalBytes,
    latestMtimeMs,
    generatedAt: new Date().toISOString(),
  };
};

const compareProjectKnowledgeFingerprint = (
  currentFingerprint: ProjectKnowledgeFingerprint | null,
  indexedFingerprint: ProjectKnowledgeFingerprint | null,
): string[] => {
  if (!currentFingerprint && !indexedFingerprint) {
    return [];
  }

  if (currentFingerprint && !indexedFingerprint) {
    return ["Todd has not indexed the current source/config state yet."];
  }

  if (!currentFingerprint || !indexedFingerprint) {
    return ["Todd's indexed fingerprint no longer matches the current source/config state."];
  }

  if (currentFingerprint.digest === indexedFingerprint.digest) {
    return [];
  }

  const reasons: string[] = [];
  if (currentFingerprint.headSha !== indexedFingerprint.headSha) {
    reasons.push("Git HEAD changed since Todd's last codebase scan.");
  }
  if (currentFingerprint.fileCount !== indexedFingerprint.fileCount) {
    reasons.push("The monitored source/config file count changed.");
  }
  if (currentFingerprint.totalBytes !== indexedFingerprint.totalBytes) {
    reasons.push("The monitored source/config size changed.");
  }
  if (
    currentFingerprint.latestMtimeMs != null
    && indexedFingerprint.latestMtimeMs != null
    && currentFingerprint.latestMtimeMs !== indexedFingerprint.latestMtimeMs
  ) {
    reasons.push("At least one monitored source/config file changed after Todd's last scan.");
  }

  return reasons.length > 0
    ? reasons
    : ["Todd's indexed fingerprint no longer matches the current source/config state."];
};

const resolveProjectKnowledgeState = (
  currentFingerprint: ProjectKnowledgeFingerprint | null,
  indexedFingerprint: ProjectKnowledgeFingerprint | null,
): { status: ProjectKnowledgeStatus; reasons: string[] } => {
  if (!indexedFingerprint) {
    return currentFingerprint
      ? {
          status: "needs-initial-refresh",
          reasons: ["This project has monitored source/config files, but Todd has not indexed them yet."],
        }
      : {
          status: "fresh",
          reasons: [],
        };
  }

  const reasons = compareProjectKnowledgeFingerprint(currentFingerprint, indexedFingerprint);
  return {
    status: reasons.length > 0 ? "stale" : "fresh",
    reasons,
  };
};

interface AppUpdateWorkspaceInfo {
  workspacePath: string | null;
  workspaceExists: boolean;
  workspaceValid: boolean;
  workspaceError: string | null;
  sourceUpdatedAt: string | null;
  candidateAppPath: string | null;
  candidateUpdatedAt: string | null;
}

interface AppRendererAssetInfo {
  assetName: string | null;
  assetUpdatedAt: string | null;
}

interface AppUpdateEvaluation {
  status: AppUpdateStatus;
  shouldPackage: boolean;
  packageKey: string | null;
  statusKey: string | null;
  workspacePath: string | null;
}

const agentChatSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "confirmationSuggested", "suggestedSummary"],
  properties: {
    response: { type: "string" },
    confirmationSuggested: { type: "boolean" },
    suggestedSummary: { type: ["string", "null"] },
  },
} as const;

const generateCoreDetailsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["function", "thesis", "corePillars", "fullFlow"],
  properties: {
    function: { type: "string" },
    thesis: { type: "string" },
    corePillars: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "function", "thesis"],
        properties: {
          name: { type: "string" },
          function: { type: "string" },
          thesis: { type: "string" },
        },
      },
    },
    fullFlow: { type: "string" },
  },
} as const;

const agentGeneralChatSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "targetStages", "hasProposal", "proposedUpdates"],
  properties: {
    response: { type: "string" },
    targetStages: { type: "array", items: { type: "string" } },
    hasProposal: { type: "boolean" },
    proposedUpdates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["stage", "updatedSummary"],
        properties: {
          stage: { type: "string" },
          updatedSummary: { type: "string" },
        },
      },
    },
  },
} as const;

type DanConversationStatus = "gathering" | "ready-to-confirm";

interface DanAgentChatDraftPillar {
  name: string;
  pillarType: string;
  parentName: string | null;
  function: string | null;
  thesis: string | null;
  fullFlow: string | null;
  description: string | null;
  assumptionText: string | null;
  assumptionSource: "user" | "dan" | null;
  order: number;
  connectedPillarNames: string[];
}

interface DanAgentChatDraftCoreDetails {
  function: string | null;
  thesis: string | null;
  fullFlow: string | null;
  pillars: DanAgentChatDraftPillar[];
}

type DanNormalizedDraftOperation = DanDraftOperation;

type DanPresenceAction = "stay" | "exit";

interface DanDraftPillarNode {
  pillar: CorePillar;
  parentName: string | null;
  connectedNames: string[];
}

interface DanSharedTurnResult {
  presenceAction: DanPresenceAction;
  hardMemoryApprovalId: string | null;
  draftUpdated: boolean;
  consumedToddHandoff: boolean;
}

const SLACK_HISTORY_LIMIT = 12;
const AUTO_SLACK_HANDOFF_LIMIT = 4;
const DAN_SIDE_NOTE_LIMIT = 4;
const DAN_RECALL_PATTERNS = [
  /\bremember\b/i,
  /\bwe talked about\b/i,
  /\bthat idea\b/i,
  /\bidea i had\b/i,
  /\bjust checking to see if you remembered\b/i,
] as const;
const DAN_SIDE_NOTE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "about",
  "be",
  "did",
  "do",
  "for",
  "had",
  "have",
  "i",
  "if",
  "idea",
  "it",
  "just",
  "like",
  "me",
  "my",
  "not",
  "of",
  "or",
  "remember",
  "see",
  "that",
  "the",
  "this",
  "to",
  "talked",
  "we",
  "what",
  "where",
  "with",
  "you",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const normalizeNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const mergeTrimmedNotes = (...noteGroups: Array<string[] | null | undefined>): string[] => {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const group of noteGroups) {
    for (const rawNote of group ?? []) {
      const note = rawNote.trim();
      if (!note || seen.has(note)) {
        continue;
      }
      seen.add(note);
      merged.push(note);
    }
  }

  return merged;
};

const buildRecentAgentChatHistory = (session: AgentSession, limit = SLACK_HISTORY_LIMIT): string => {
  const history = (session.slackMessages ?? []).slice(-limit).map((message) => {
    if (message.role === "system") {
      return `[System: ${message.content}]`;
    }
    if (message.role === "user") {
      return `User: ${message.content}`;
    }
    return `${message.directorId ? DIRECTOR_NAMES[message.directorId] : "Agent"}: ${message.content}`;
  }).join("\n\n");

  return history ? `\nAgent chat history:\n${history}\n` : "";
};

const buildToddCodebaseSummary = (session: AgentSession): string => {
  const indexedMap = session.toddMemory?.codebaseIndexedMap ?? buildToddCodebaseMapFromSession(session, null);
  if (!indexedMap) {
    return "Current codebase map:\n- No repo scan summary has been saved yet.";
  }

  const parts: string[] = [];
  if (indexedMap.summary) {
    parts.push(`- Summary: ${indexedMap.summary}`);
  }
  if (indexedMap.featureAreas.length > 0) {
    parts.push(`- Indexed feature areas: ${indexedMap.featureAreas.join(", ")}`);
  }
  if (indexedMap.repoNotes.length > 0) {
    parts.push(`- Repo notes: ${indexedMap.repoNotes.join(" | ")}`);
  }

  return parts.length > 0
    ? `Current codebase map:\n${parts.join("\n")}`
    : "Current codebase map:\n- No repo scan summary has been saved yet.";
};

const collectExistingPillarsByName = (
  pillars: CorePillar[],
  index = new Map<string, CorePillar>(),
): Map<string, CorePillar> => {
  for (const pillar of pillars) {
    const key = pillar.name.trim().toLowerCase();
    if (key && !index.has(key)) {
      index.set(key, pillar);
    }
    collectExistingPillarsByName(pillar.corePillars, index);
  }
  return index;
};

const resolvePillarIdsFromArea = (session: AgentSession, area: string | null | undefined): string[] => {
  const normalized = area?.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  const pillar = collectExistingPillarsByName(session.corePillars).get(normalized);
  return pillar ? [pillar.id] : [];
};

const normalizeDanConversationStatus = (value: unknown): DanConversationStatus =>
  value === "ready-to-confirm" ? "ready-to-confirm" : "gathering";

const normalizeDanPresenceAction = (value: unknown): DanPresenceAction =>
  value === "exit" ? "exit" : "stay";

const normalizeDanPillarType = (value: unknown): CorePillar["pillarType"] => {
  switch (value) {
    case "core":
    case "side":
    case "ghost":
    case "tbd":
    case "hard-stop":
      return value;
    default:
      return "core";
  }
};

const createDraftDetail = (value: string | null): CorePillar["function"] =>
  value ? { summary: value, status: "edited" } : null;

const cloneDetailWithStatus = (
  detail: CorePillar["function"],
  status: "confirmed" | "edited",
): CorePillar["function"] => detail ? { ...detail, status } : null;

const clonePillarWithStatus = (
  pillar: CorePillar,
  status: "confirmed" | "edited",
): CorePillar => ({
  ...pillar,
  function: cloneDetailWithStatus(pillar.function, status),
  thesis: cloneDetailWithStatus(pillar.thesis, status),
  fullFlow: cloneDetailWithStatus(pillar.fullFlow, status),
  corePillars: pillar.corePillars.map((child) => clonePillarWithStatus(child, status)),
});

const extractDanRecallTerms = (message: string): string[] =>
  Array.from(new Set(
    message
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3 && !DAN_SIDE_NOTE_STOPWORDS.has(term)),
  ));

const isDanRecallMessage = (message: string): boolean =>
  DAN_RECALL_PATTERNS.some((pattern) => pattern.test(message));

const selectRelevantDanSideNotes = (message: string, sideNotes: string[]): string[] => {
  if (!isDanRecallMessage(message) || sideNotes.length === 0) {
    return [];
  }

  const recallTerms = extractDanRecallTerms(message);
  if (recallTerms.length === 0) {
    return [];
  }

  return sideNotes
    .map((note) => {
      const normalizedNote = note.toLowerCase();
      const score = recallTerms.reduce((total, term) => total + (normalizedNote.includes(term) ? 1 : 0), 0);
      return { note, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, DAN_SIDE_NOTE_LIMIT)
    .map((entry) => entry.note);
};

const normalizeDanDraftCoreDetails = (value: unknown): DanAgentChatDraftCoreDetails | null => {
  if (!isRecord(value)) {
    return null;
  }

  const rawPillars = Array.isArray(value.pillars) ? value.pillars : [];
  const pillars: DanAgentChatDraftPillar[] = rawPillars
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item, index) => ({
      name: normalizeNonEmptyString(item.name) ?? `Pillar ${index + 1}`,
      pillarType: typeof item.pillarType === "string" ? item.pillarType : "core",
      parentName: normalizeNonEmptyString(item.parentName),
      function: normalizeNonEmptyString(item.function),
      thesis: normalizeNonEmptyString(item.thesis),
      fullFlow: normalizeNonEmptyString(item.fullFlow),
      description: normalizeNonEmptyString(item.description),
      assumptionText: normalizeNonEmptyString(item.assumptionText),
      assumptionSource: item.assumptionSource === "user" || item.assumptionSource === "dan"
        ? item.assumptionSource
        : null,
      order: typeof item.order === "number" && Number.isFinite(item.order) ? item.order : index,
      connectedPillarNames: Array.isArray(item.connectedPillarNames)
        ? item.connectedPillarNames
          .map((entry) => normalizeNonEmptyString(entry))
          .filter((entry): entry is string => Boolean(entry))
        : [],
    }));

  return {
    function: normalizeNonEmptyString(value.function),
    thesis: normalizeNonEmptyString(value.thesis),
    fullFlow: normalizeNonEmptyString(value.fullFlow),
    pillars,
  };
};

const normalizeDraftOperationName = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const normalizeOptionalDraftText = (item: Record<string, unknown>, key: string): string | null | undefined => {
  if (!hasOwn(item, key)) {
    return undefined;
  }
  if (item[key] === null) {
    return null;
  }
  return normalizeNonEmptyString(item[key]);
};

const normalizeOptionalDraftNumber = (item: Record<string, unknown>, key: string): number | null | undefined => {
  if (!hasOwn(item, key)) {
    return undefined;
  }
  if (item[key] === null) {
    return null;
  }
  return typeof item[key] === "number" && Number.isFinite(item[key]) ? item[key] : undefined;
};

const normalizeOptionalConnectedPillarNames = (
  item: Record<string, unknown>,
): string[] | null | undefined => {
  if (!hasOwn(item, "connectedPillarNames")) {
    return undefined;
  }
  if (item.connectedPillarNames === null) {
    return null;
  }
  return Array.isArray(item.connectedPillarNames)
    ? item.connectedPillarNames
      .map((entry) => normalizeNonEmptyString(entry))
      .filter((entry): entry is string => Boolean(entry))
    : undefined;
};

const normalizeDanDraftOperations = (value: unknown): DanNormalizedDraftOperation[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const operations: DanNormalizedDraftOperation[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.type !== "string") {
      continue;
    }

    if (item.type === "set_root_detail") {
      const target = item.target === "function" || item.target === "thesis" || item.target === "fullFlow"
        ? item.target
        : null;
      if (!target) {
        continue;
      }
      operations.push({
        type: "set_root_detail",
        target,
        value: normalizeOptionalDraftText(item, "value") ?? null,
      });
      continue;
    }

    if (item.type === "delete_pillar") {
      const name = normalizeDraftOperationName(item.name);
      if (!name) {
        continue;
      }
      operations.push({
        type: "delete_pillar",
        name,
      });
      continue;
    }

    if (item.type === "upsert_pillar") {
      const name = normalizeDraftOperationName(item.name);
      if (!name) {
        continue;
      }
      const assumptionSource = hasOwn(item, "assumptionSource")
        ? item.assumptionSource === "user" || item.assumptionSource === "dan"
          ? item.assumptionSource
          : null
        : undefined;
      const pillarType = hasOwn(item, "pillarType")
        ? item.pillarType === null
          ? null
          : normalizeDanPillarType(item.pillarType)
        : undefined;
      operations.push({
        type: "upsert_pillar",
        name,
        previousName: normalizeOptionalDraftText(item, "previousName"),
        parentName: normalizeOptionalDraftText(item, "parentName"),
        pillarType,
        function: normalizeOptionalDraftText(item, "function"),
        thesis: normalizeOptionalDraftText(item, "thesis"),
        fullFlow: normalizeOptionalDraftText(item, "fullFlow"),
        description: normalizeOptionalDraftText(item, "description"),
        assumptionText: normalizeOptionalDraftText(item, "assumptionText"),
        assumptionSource,
        order: normalizeOptionalDraftNumber(item, "order"),
        connectedPillarNames: normalizeOptionalConnectedPillarNames(item),
      });
    }
  }

  return operations;
};

const normalizeRawMemoriesToAppend = (
  value: unknown,
  pillarsByName: Map<string, CorePillar>,
): DanRawMemory[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      id: randomUUID(),
      content: normalizeNonEmptyString(item.content) ?? "",
      relatedPillarIds: Array.isArray(item.relatedPillarNames)
        ? (item.relatedPillarNames as unknown[])
            .map((name) => pillarsByName.get(String(name).trim().toLowerCase())?.id)
            .filter((id): id is string => Boolean(id))
        : [],
      createdAt: new Date().toISOString(),
    }))
    .filter((entry) => entry.content.length > 0);
};

const sortNestedPillarsByOrder = (pillars: CorePillar[]): CorePillar[] =>
  [...pillars]
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((pillar) => ({
      ...pillar,
      corePillars: sortNestedPillarsByOrder(pillar.corePillars),
    }));

const archiveDanNotes = (
  session: AgentSession,
  reason: string,
  notes: TaggedNote[],
): void => {
  if (notes.length === 0) {
    session.danInternalNotes = [];
    return;
  }

  session.danArchivedNotes = session.danArchivedNotes ?? [];
  const timestamp = new Date().toISOString();
  session.danArchivedNotes.push(
    ...notes.map((note) => `[${timestamp} | ${reason}] ${note.content}`),
  );
  session.danInternalNotes = [];
};

const persistDirectorStateSnapshot = (
  session: AgentSession,
  directorId: DirectorId,
  nextState: {
    currentState?: string | null;
    idealState?: string | null;
    assumptions?: string[];
  },
): void => {
  session.directorStateMap = session.directorStateMap ?? {};
  const existing = session.directorStateMap[directorId] ?? {
    currentState: null,
    idealState: null,
    assumptions: [],
  };
  session.directorStateMap[directorId] = {
    currentState: nextState.currentState !== undefined ? nextState.currentState : existing.currentState,
    idealState: nextState.idealState !== undefined ? nextState.idealState : existing.idealState,
    assumptions: nextState.assumptions ?? existing.assumptions,
  };
};

const buildConfirmedConceptFromSession = (session: AgentSession): AgentCoreDetails | null => {
  const confirmedConcept: AgentCoreDetails = {
    function: session.stages.function.confirmed ?? null,
    thesis: session.stages.thesis.confirmed ?? null,
    corePillars: session.corePillars,
    fullFlow: session.stages.full_flow.confirmed ?? null,
    threads: session.danMemory?.threads ?? [],
  };

  return confirmedConcept.function || confirmedConcept.thesis || confirmedConcept.corePillars.length > 0 || confirmedConcept.fullFlow
    ? confirmedConcept
    : null;
};

const hasCoreDetailsContent = (concept: AgentCoreDetails | null | undefined): concept is AgentCoreDetails =>
  Boolean(concept && (concept.function || concept.thesis || concept.corePillars.length > 0 || concept.fullFlow));

const getDanConfirmedConcept = (session: AgentSession): AgentCoreDetails | null =>
  session.danMemory?.confirmedConcept ?? buildConfirmedConceptFromSession(session);

const getDanDraftSourceConcept = (session: AgentSession): AgentCoreDetails | null =>
  session.danMemory?.draftConcept
  ?? session.danDraftCoreDetails
  ?? getDanConfirmedConcept(session);

const cloneAgentDetail = <T extends { summary: string; status?: string } | null>(
  detail: T,
): T => detail ? ({ ...detail, status: detail.status ?? "confirmed" } as T) : detail;

const cloneCorePillarDeep = (pillar: CorePillar): CorePillar => ({
  ...pillar,
  function: cloneAgentDetail(pillar.function),
  thesis: cloneAgentDetail(pillar.thesis),
  corePillars: pillar.corePillars.map(cloneCorePillarDeep),
  fullFlow: cloneAgentDetail(pillar.fullFlow),
  connectedPillarIds: [...pillar.connectedPillarIds],
  threadMemberships: [...(pillar.threadMemberships ?? [])],
  endState: pillar.endState ?? null,
});

const cloneAgentCoreDetails = (concept: AgentCoreDetails): AgentCoreDetails => ({
  function: cloneAgentDetail(concept.function),
  thesis: cloneAgentDetail(concept.thesis),
  corePillars: concept.corePillars.map(cloneCorePillarDeep),
  fullFlow: cloneAgentDetail(concept.fullFlow),
  threads: [...(concept.threads ?? [])],
});

const buildGeneratedCoreDetailsConcept = (input: {
  function: string;
  thesis: string;
  corePillars: Array<{ name: string; function: string; thesis: string }>;
  fullFlow: string;
}): AgentCoreDetails => ({
  function: input.function ? { summary: input.function, status: "assumed" } : null,
  thesis: input.thesis ? { summary: input.thesis, status: "assumed" } : null,
  corePillars: input.corePillars.map((pillar, index) => ({
    id: randomUUID(),
    name: pillar.name,
    pillarType: "core",
    function: pillar.function ? { summary: pillar.function, status: "assumed" } : null,
    thesis: pillar.thesis ? { summary: pillar.thesis, status: "assumed" } : null,
    corePillars: [],
    fullFlow: null,
    description: null,
    connectedPillarIds: [],
    assumptionText: "Derived from the current codebase state and pending user confirmation.",
    assumptionSource: null,
    order: index,
    threadMemberships: [],
    endState: null,
  })),
  fullFlow: input.fullFlow ? { summary: input.fullFlow, status: "assumed" } : null,
  threads: [],
});

const buildDanDerivedNotesFromRefresh = (input: {
  scanSummary: string;
  detectedFeatures: string[];
  updatedAreas: string[];
}): TaggedNote[] =>
  migrateToTaggedNotes([
    input.scanSummary ? `Refresh summary: ${input.scanSummary}` : "",
    input.detectedFeatures.length > 0 ? `Detected current feature areas: ${input.detectedFeatures.join(", ")}` : "",
    input.updatedAreas.length > 0 ? `Todd flagged codebase changes around: ${input.updatedAreas.join(", ")}` : "",
  ].filter((note): note is string => note.trim().length > 0));

const collectPillarNamesById = (
  pillars: CorePillar[],
  index = new Map<string, string>(),
): Map<string, string> => {
  for (const pillar of pillars) {
    index.set(pillar.id, pillar.name);
    collectPillarNamesById(pillar.corePillars, index);
  }
  return index;
};

const collectDanDraftNodes = (
  pillars: CorePillar[],
  parentName: string | null,
  namesById: Map<string, string>,
  index = new Map<string, DanDraftPillarNode>(),
): Map<string, DanDraftPillarNode> => {
  for (const pillar of sortPillarsByOrder(pillars)) {
    const key = pillar.name.trim().toLowerCase();
    if (!key || index.has(key)) {
      continue;
    }

    const flattened = cloneCorePillarDeep(pillar);
    flattened.corePillars = [];
    flattened.connectedPillarIds = [];
    index.set(key, {
      pillar: flattened,
      parentName,
      connectedNames: pillar.connectedPillarIds
        .map((pillarId) => namesById.get(pillarId)?.trim().toLowerCase() ?? null)
        .filter((name): name is string => Boolean(name)),
    });
    collectDanDraftNodes(pillar.corePillars, key, namesById, index);
  }

  return index;
};

const rebuildDanDraftTree = (
  draftState: AgentCoreDetails,
  nodes: Map<string, DanDraftPillarNode>,
): AgentCoreDetails => {
  for (const node of nodes.values()) {
    node.pillar.corePillars = [];
  }

  const roots: CorePillar[] = [];
  for (const [key, node] of nodes.entries()) {
    const parent = node.parentName ? nodes.get(node.parentName) : null;
    if (parent && parent.pillar.id !== node.pillar.id) {
      parent.pillar.corePillars.push(node.pillar);
      continue;
    }
    roots.push(node.pillar);
  }

  for (const node of nodes.values()) {
    const connectedIds = node.connectedNames
      .map((name) => nodes.get(name)?.pillar.id ?? null)
      .filter((id): id is string => Boolean(id) && id !== node.pillar.id);
    node.pillar.connectedPillarIds = Array.from(new Set(connectedIds));
  }

  return {
    function: cloneAgentDetail(draftState.function),
    thesis: cloneAgentDetail(draftState.thesis),
    corePillars: sortNestedPillarsByOrder(roots),
    fullFlow: cloneAgentDetail(draftState.fullFlow),
    threads: [...(draftState.threads ?? [])],
  };
};

const applyDanDraftOperationsState = (
  session: AgentSession,
  operations: DanNormalizedDraftOperation[],
): AgentCoreDetails | null => {
  if (operations.length === 0) {
    return hasCoreDetailsContent(session.danMemory?.draftConcept ?? null)
      ? cloneAgentCoreDetails(session.danMemory!.draftConcept!)
      : null;
  }

  const base = getDanDraftSourceConcept(session) ?? {
    function: null,
    thesis: null,
    corePillars: [],
    fullFlow: null,
    threads: [],
  };
  const draftState = cloneAgentCoreDetails(base);
  const nodes = collectDanDraftNodes(
    draftState.corePillars,
    null,
    collectPillarNamesById(draftState.corePillars),
  );

  for (const operation of operations) {
    if (operation.type === "set_root_detail") {
      const nextDetail = operation.value ? { summary: operation.value, status: "edited" as const } : null;
      if (operation.target === "function") {
        draftState.function = nextDetail;
      } else if (operation.target === "thesis") {
        draftState.thesis = nextDetail;
      } else {
        draftState.fullFlow = nextDetail;
      }
      continue;
    }

    if (operation.type === "upsert_thread") {
      const threadName = operation.name.trim();
      const prevName = operation.previousName?.trim() ?? null;
      const existingIdx = prevName
        ? draftState.threads.findIndex((t) => t.name === prevName)
        : draftState.threads.findIndex((t) => t.name === threadName);
      if (existingIdx >= 0) {
        draftState.threads[existingIdx].name = threadName;
        if (operation.description !== undefined) {
          draftState.threads[existingIdx].description = operation.description ?? null;
        }
      } else {
        draftState.threads.push({
          id: randomUUID(),
          name: threadName,
          description: operation.description ?? null,
        });
      }
      continue;
    }

    if (operation.type === "delete_thread") {
      draftState.threads = draftState.threads.filter((t) => t.name !== operation.name.trim());
      continue;
    }

    if (operation.type === "delete_pillar") {
      nodes.delete(operation.name.trim().toLowerCase());
      continue;
    }

    const targetKey = operation.name.trim().toLowerCase();
    const previousKey = operation.previousName?.trim().toLowerCase() ?? null;
    const existing = previousKey
      ? nodes.get(previousKey) ?? nodes.get(targetKey) ?? null
      : nodes.get(targetKey) ?? null;
    const node: DanDraftPillarNode = existing ?? {
      pillar: {
        id: randomUUID(),
        name: operation.name,
        pillarType: "core",
        function: null,
        thesis: null,
        corePillars: [],
        fullFlow: null,
        description: null,
        connectedPillarIds: [],
        assumptionText: null,
        assumptionSource: null,
        order: nodes.size,
        threadMemberships: [],
        endState: null,
      },
      parentName: null,
      connectedNames: [],
    };

    if (previousKey && previousKey !== targetKey) {
      nodes.delete(previousKey);
      for (const otherNode of nodes.values()) {
        if (otherNode.parentName === previousKey) {
          otherNode.parentName = targetKey;
        }
        otherNode.connectedNames = otherNode.connectedNames.map((name) => name === previousKey ? targetKey : name);
      }
    }

    node.pillar.name = operation.name;
    if (operation.parentName !== undefined) {
      node.parentName = operation.parentName ? operation.parentName.trim().toLowerCase() : null;
    }
    if (operation.pillarType !== undefined) {
      node.pillar.pillarType = operation.pillarType ?? "core";
    }
    if (operation.function !== undefined) {
      node.pillar.function = createDraftDetail(operation.function ?? null);
    }
    if (operation.thesis !== undefined) {
      node.pillar.thesis = createDraftDetail(operation.thesis ?? null);
    }
    if (operation.fullFlow !== undefined) {
      node.pillar.fullFlow = createDraftDetail(operation.fullFlow ?? null);
    }
    if (operation.description !== undefined) {
      node.pillar.description = operation.description ?? null;
    }
    if (operation.assumptionText !== undefined) {
      node.pillar.assumptionText = operation.assumptionText ?? null;
    }
    if (operation.assumptionSource !== undefined) {
      node.pillar.assumptionSource = operation.assumptionSource ?? null;
    }
    if (operation.order !== undefined) {
      node.pillar.order = operation.order ?? node.pillar.order ?? nodes.size;
    } else if (node.pillar.order == null) {
      node.pillar.order = nodes.size;
    }
    if (operation.connectedPillarNames !== undefined) {
      node.connectedNames = (operation.connectedPillarNames ?? [])
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean);
    }
    if (operation.threadMemberships !== undefined) {
      node.pillar.threadMemberships = (operation.threadMemberships ?? []).map((tm) => ({
        threadId: "",
        threadName: tm.threadName,
        role: tm.role ?? null,
      }));
    }
    if (operation.endState !== undefined) {
      node.pillar.endState = operation.endState ?? null;
    }

    nodes.set(targetKey, node);
  }

  const rebuilt = rebuildDanDraftTree(draftState, nodes);
  return hasCoreDetailsContent(rebuilt) ? rebuilt : null;
};

const normalizeFutureUpdatePlan = (updates: VersionUpdate[]): VersionUpdate[] =>
  updates.map((update, index) => ({
    ...update,
    order: typeof update.order === "number" ? update.order : index,
    dependencies: Array.isArray(update.dependencies) ? update.dependencies : [],
    pillarIds: Array.isArray(update.pillarIds) ? update.pillarIds : [],
    skillsNeeded: Array.isArray(update.skillsNeeded)
      ? update.skillsNeeded.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [],
    updateKind: update.updateKind === "create" || update.updateKind === "expand" || update.updateKind === "refine" || update.updateKind === "simplify"
      ? update.updateKind
      : null,
    simplificationMode: update.simplificationMode === "inline" || update.simplificationMode === "staged" || update.simplificationMode === "overhaul"
      ? update.simplificationMode
      : null,
    structuralReason: typeof update.structuralReason === "string" && update.structuralReason.trim().length > 0
      ? update.structuralReason.trim()
      : null,
    supportsNextStep: typeof update.supportsNextStep === "string" && update.supportsNextStep.trim().length > 0
      ? update.supportsNextStep.trim()
      : null,
  }));

const normalizeToddUpdateKind = (value: unknown): ToddUpdateKind | null =>
  value === "create" || value === "expand" || value === "refine" || value === "simplify"
    ? value
    : null;

const normalizeToddSimplificationMode = (value: unknown): ToddSimplificationMode | null =>
  value === "inline" || value === "staged" || value === "overhaul"
    ? value
    : null;

const normalizeToddUpdatePlanSource = (value: unknown): ToddUpdatePlanSource =>
  value === "post-run-structural-check" ? value : "manual";

const normalizeOptionalToddText = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const normalizeToddPillarIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

const normalizeRoadmapUpdateKind = (value: unknown): "create" | "expand" | "refine" =>
  value === "create" || value === "expand" || value === "refine" ? value : "create";

const normalizeToddNextUpdate = (
  raw: Record<string, unknown>,
  fallback: Partial<ToddNextUpdate> = {},
): ToddNextUpdate => ({
  id: typeof raw.id === "string" && raw.id ? raw.id : fallback.id ?? randomUUID(),
  title: typeof raw.title === "string" ? raw.title.trim() : fallback.title ?? "Next update",
  description: typeof raw.description === "string" ? raw.description.trim() : fallback.description ?? "",
  pillarIds: normalizeToddPillarIds(raw.pillarIds ?? fallback.pillarIds),
  currentStateContext: normalizeOptionalToddText(raw.currentStateContext ?? fallback.currentStateContext),
  successDefinition: normalizeOptionalToddText(raw.successDefinition ?? fallback.successDefinition),
  partialSuccessDefinition: normalizeOptionalToddText(raw.partialSuccessDefinition ?? fallback.partialSuccessDefinition),
  partialFailureDefinition: normalizeOptionalToddText(raw.partialFailureDefinition ?? fallback.partialFailureDefinition),
  failureDefinition: normalizeOptionalToddText(raw.failureDefinition ?? fallback.failureDefinition),
  updateKind: normalizeToddUpdateKind(raw.updateKind ?? fallback.updateKind),
  simplificationMode: normalizeToddSimplificationMode(raw.simplificationMode ?? fallback.simplificationMode),
  structuralReason: normalizeOptionalToddText(raw.structuralReason ?? fallback.structuralReason),
  supportsNextStep: normalizeOptionalToddText(raw.supportsNextStep ?? fallback.supportsNextStep),
  skillsNeeded: Array.isArray(raw.skillsNeeded ?? fallback.skillsNeeded)
    ? ((raw.skillsNeeded ?? fallback.skillsNeeded) as unknown[]).filter((s): s is string => typeof s === "string")
    : [],
  dependencies: Array.isArray(raw.dependencies ?? fallback.dependencies)
    ? ((raw.dependencies ?? fallback.dependencies) as unknown[]).filter((s): s is string => typeof s === "string")
    : [],
});

const buildToddPriorityUpdateFromNextUpdate = (
  nextUpdate: ToddNextUpdate,
  sourceRefs: ToddPriorityUpdate["sourceRefs"] = [],
): ToddPriorityUpdate => ({
  id: nextUpdate.id,
  title: nextUpdate.title,
  description: nextUpdate.description,
  pillarIds: [...nextUpdate.pillarIds],
  updateKind: normalizeRoadmapUpdateKind(nextUpdate.updateKind === "simplify" ? "refine" : nextUpdate.updateKind),
  currentStateContext: nextUpdate.currentStateContext ?? "",
  successDefinition: nextUpdate.successDefinition,
  partialSuccessDefinition: nextUpdate.partialSuccessDefinition,
  partialFailureDefinition: nextUpdate.partialFailureDefinition,
  failureDefinition: nextUpdate.failureDefinition,
  sourceRefs: sourceRefs ?? [],
});

const normalizeToddRoadmap = (raw: Record<string, unknown>): ToddRoadmap => {
  const now = new Date().toISOString();

  const currentState: ToddCurrentStateItem[] = Array.isArray(raw.currentState)
    ? (raw.currentState as unknown[]).map((item) => {
        const r = item as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : randomUUID(),
          title: typeof r.title === "string" ? r.title.trim() : "Untitled",
          description: typeof r.description === "string" ? r.description.trim() : "",
          pillarIds: Array.isArray(r.pillarIds) ? (r.pillarIds as unknown[]).filter((p): p is string => typeof p === "string") : [],
          itemStatus: r.itemStatus === "done" ? "done" : "tbd",
          detailLines: Array.isArray(r.detailLines) ? (r.detailLines as unknown[]).filter((line): line is string => typeof line === "string") : [],
          sourceRefs: Array.isArray(r.sourceRefs) ? (r.sourceRefs as MemorySourceRef[]).filter(Boolean) : [],
        };
      })
    : [];

  const endState: ToddEndStateItem[] = Array.isArray(raw.endState)
    ? (raw.endState as unknown[]).map((item) => {
        const r = item as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : randomUUID(),
          title: typeof r.title === "string" ? r.title.trim() : "Untitled",
          description: typeof r.description === "string" ? r.description.trim() : "",
          pillarIds: Array.isArray(r.pillarIds) ? (r.pillarIds as unknown[]).filter((p): p is string => typeof p === "string") : [],
          detailLines: Array.isArray(r.detailLines) ? (r.detailLines as unknown[]).filter((line): line is string => typeof line === "string") : [],
          sourceRefs: Array.isArray(r.sourceRefs) ? (r.sourceRefs as MemorySourceRef[]).filter(Boolean) : [],
        };
      })
    : [];

  const pathway: ToddPathwayItem[] = Array.isArray(raw.pathway)
    ? (raw.pathway as unknown[]).map((item, idx) => {
        const r = item as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : randomUUID(),
          title: typeof r.title === "string" ? r.title.trim() : "Untitled",
          description: typeof r.description === "string" ? r.description.trim() : "",
          pillarIds: Array.isArray(r.pillarIds) ? (r.pillarIds as unknown[]).filter((p): p is string => typeof p === "string") : [],
          updateKind: normalizeRoadmapUpdateKind(r.updateKind),
          order: typeof r.order === "number" ? r.order : idx,
          detailLines: Array.isArray(r.detailLines) ? (r.detailLines as unknown[]).filter((line): line is string => typeof line === "string") : [],
          sourceRefs: Array.isArray(r.sourceRefs) ? (r.sourceRefs as MemorySourceRef[]).filter(Boolean) : [],
        };
      })
    : [];

  let priorityUpdate: ToddPriorityUpdate | null = null;
  const rawPu = raw.priorityUpdate && typeof raw.priorityUpdate === "object"
    ? raw.priorityUpdate as Record<string, unknown>
    : null;
  if (rawPu) {
    priorityUpdate = {
      id: typeof rawPu.id === "string" && rawPu.id ? rawPu.id : randomUUID(),
      title: typeof rawPu.title === "string" ? rawPu.title.trim() : "Priority Update",
      description: typeof rawPu.description === "string" ? rawPu.description.trim() : "",
      pillarIds: Array.isArray(rawPu.pillarIds) ? (rawPu.pillarIds as unknown[]).filter((p): p is string => typeof p === "string") : [],
      updateKind: normalizeRoadmapUpdateKind(rawPu.updateKind),
      currentStateContext: typeof rawPu.currentStateContext === "string" ? rawPu.currentStateContext.trim() : "",
      successDefinition: normalizeOptionalToddText(rawPu.successDefinition),
      partialSuccessDefinition: normalizeOptionalToddText(rawPu.partialSuccessDefinition),
      partialFailureDefinition: normalizeOptionalToddText(rawPu.partialFailureDefinition),
      failureDefinition: normalizeOptionalToddText(rawPu.failureDefinition),
      sourceRefs: Array.isArray(rawPu.sourceRefs) ? (rawPu.sourceRefs as MemorySourceRef[]).filter(Boolean) : [],
    };
  }

  return {
    currentState,
    endState,
    pathway,
    priorityUpdate,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : now,
  };
};

const isToddUpdatePlanDraftPayload = (payload: Record<string, unknown> | null | undefined): payload is ToddUpdatePlanDraftPayload =>
  Boolean(
    payload
    && payload.action === "applyStoredData"
    && payload.dataType === "versionUpdates"
    && Array.isArray(payload.updates),
  );

const getToddUpdatePlanDraftMetadata = (payload: Record<string, unknown> | null | undefined): {
  planSource: ToddUpdatePlanSource;
  supersedesConfirmedPlan: boolean;
} => ({
  planSource: normalizeToddUpdatePlanSource(payload?.planSource),
  supersedesConfirmedPlan: payload?.supersedesConfirmedPlan === true,
});

const buildToddUpdatePlanDraftPayload = (input: {
  updates: VersionUpdate[];
  currentState: string | null;
  idealState: string | null;
  planSource: ToddUpdatePlanSource;
  supersedesConfirmedPlan: boolean;
}): ToddUpdatePlanDraftPayload => ({
  action: "applyStoredData",
  dataType: "versionUpdates",
  updates: input.updates,
  currentState: input.currentState,
  idealState: input.idealState,
  planSource: input.planSource,
  supersedesConfirmedPlan: input.supersedesConfirmedPlan,
});

type ToddPlannedUpdateInput = {
  title: string;
  description: string;
  versionLabel: string;
  dependencies?: string[];
  pillarIds?: string[];
  area?: string | null;
  skillsNeeded?: string[];
  updateKind?: ToddUpdateKind | null;
  simplificationMode?: ToddSimplificationMode | null;
  structuralReason?: string | null;
  supportsNextStep?: string | null;
};

const mapToddPlannedUpdates = (
  session: AgentSession,
  roadmapVersions: VersionPlan[],
  parsedUpdates: ToddPlannedUpdateInput[],
): {
  updates: VersionUpdate[];
  reportUpdates: HardMemoryReportUpdate[];
} => {
  const updates: VersionUpdate[] = parsedUpdates.map((update, idx) => {
    const version = roadmapVersions.find((item) => item.label === update.versionLabel);
    return {
      id: randomUUID(),
      versionId: version?.id ?? null,
      title: update.title,
      description: update.description,
      order: idx,
      status: "pending",
      dependencies: update.dependencies ?? [],
      pillarIds: update.pillarIds?.length ? update.pillarIds : resolvePillarIdsFromArea(session, update.area),
      skillsNeeded: update.skillsNeeded ?? [],
      updateKind: normalizeToddUpdateKind(update.updateKind),
      simplificationMode: normalizeToddSimplificationMode(update.simplificationMode),
      structuralReason: normalizeOptionalToddText(update.structuralReason),
      supportsNextStep: normalizeOptionalToddText(update.supportsNextStep),
    };
  });

  const reportUpdates: HardMemoryReportUpdate[] = parsedUpdates.map((update, idx) => ({
    id: updates[idx]?.id ?? randomUUID(),
    title: update.title,
    description: update.description,
    versionLabel: update.versionLabel,
    dependencies: update.dependencies ?? [],
    area: update.area ?? null,
    skillsNeeded: update.skillsNeeded ?? [],
    updateKind: normalizeToddUpdateKind(update.updateKind),
    simplificationMode: normalizeToddSimplificationMode(update.simplificationMode),
    structuralReason: normalizeOptionalToddText(update.structuralReason),
    supportsNextStep: normalizeOptionalToddText(update.supportsNextStep),
  }));

  return { updates, reportUpdates };
};


const buildToddCodebaseMapFromSession = (
  session: AgentSession,
  existing: ToddCodebaseIndexedMap | null = null,
): ToddCodebaseIndexedMap | null => {
  const rdState = session.directorStateMap?.["rd-director"];
  const featureAreas = (session.currentCorePillars ?? [])
    .map((pillar) => pillar.name.trim())
    .filter((name) => name.length > 0);
  const repoNotes = rdState?.assumptions ?? [];
  const summary = existing?.summary ?? rdState?.currentState ?? null;

  if (!summary && featureAreas.length === 0 && repoNotes.length === 0 && !existing) {
    return null;
  }

  return {
    summary,
    indexedAt: existing?.indexedAt ?? null,
    featureAreas: existing?.featureAreas?.length ? existing.featureAreas : featureAreas,
    repoNotes: existing?.repoNotes?.length ? existing.repoNotes : repoNotes,
    lastIndexedFingerprint: existing?.lastIndexedFingerprint ?? null,
  };
};

const migrateToTaggedNotes = (
  notes: (string | TaggedNote)[],
  defaultTag: TaggedNote["tag"] = "general",
): TaggedNote[] =>
  notes.map((note) =>
    typeof note === "string"
      ? { id: randomUUID(), content: note, tag: defaultTag, createdAt: new Date().toISOString() }
      : note,
  );

const extractNoteContents = (notes: TaggedNote[]): string[] =>
  notes.map((note) => note.content);

const mergeTaggedNotes = (
  existing: TaggedNote[],
  newStrings: string[],
  defaultTag: TaggedNote["tag"] = "general",
): TaggedNote[] => {
  const seen = new Set(existing.map((note) => note.content.trim()));
  const result = [...existing];
  for (const raw of newStrings) {
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push({
      id: randomUUID(),
      content: trimmed,
      tag: defaultTag,
      createdAt: new Date().toISOString(),
    });
  }
  return result;
};

const buildLegacyMemorySourceRef = (
  rawText: string,
  directorId: DirectorId | null,
  index = 0,
): MemorySourceRef => ({
  id: `legacy-source-${directorId ?? "unknown"}-${index}`,
  messageId: null,
  rawText,
  directorId,
  kind: "legacy",
  createdAt: new Date(0).toISOString(),
});

const normalizeTaggedNotes = (
  notes: TaggedNote[],
  directorId: DirectorId | null,
): TaggedNote[] =>
  notes.map((note, index) => ({
    ...note,
    sourceRefs: note.sourceRefs?.length
      ? note.sourceRefs
      : [buildLegacyMemorySourceRef(note.content, directorId, index)],
    resolution: note.resolution ?? null,
  }));

const mergeTaggedNoteCollections = (
  ...collections: Array<TaggedNote[] | null | undefined>
): TaggedNote[] => {
  const merged: TaggedNote[] = [];
  const seen = new Set<string>();
  for (const collection of collections) {
    for (const note of collection ?? []) {
      const key = `${note.tag ?? "general"}::${note.content.trim()}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(note);
    }
  }
  return merged;
};

const resolveTaggedNotes = (
  notes: TaggedNote[],
  resolution: MemoryResolution,
): TaggedNote[] =>
  notes.map((note) => ({
    ...note,
    resolution,
  }));

const deriveFallbackPillarIds = (concept: AgentCoreDetails | null): string[] =>
  (concept?.corePillars ?? [])
    .map((pillar) => pillar.id)
    .filter((pillarId) => typeof pillarId === "string" && pillarId.trim().length > 0);

const ensureRoadmapItemPillarIds = (
  pillarIds: string[] | null | undefined,
  fallbackPillarIds: string[],
): string[] => {
  const normalized = Array.isArray(pillarIds)
    ? pillarIds.filter((pillarId): pillarId is string => typeof pillarId === "string" && pillarId.trim().length > 0)
    : [];
  return normalized.length > 0 ? normalized : [...fallbackPillarIds];
};

const deriveLegacyToddFieldsFromRoadmap = (
  roadmap: ToddRoadmap | null,
  existing: ToddMemory,
): Pick<ToddMemory, "currentState" | "endStateGoal" | "successChain" | "nextUpdate" | "futureUpdatePlan"> => {
  if (!roadmap) {
    return {
      currentState: existing.currentState ?? null,
      endStateGoal: existing.endStateGoal ?? null,
      successChain: existing.successChain ?? [],
      nextUpdate: existing.nextUpdate ?? null,
      futureUpdatePlan: normalizeFutureUpdatePlan(existing.futureUpdatePlan ?? []),
    };
  }

  const currentState = roadmap.currentState.length > 0
    ? roadmap.currentState.map((item) => `${item.title}: ${item.description}`).join("\n")
    : null;
  const endStateGoal = roadmap.endState.length > 0
    ? roadmap.endState.map((item) => `${item.title}: ${item.description}`).join("\n")
    : null;
  const successChain = roadmap.pathway.map((item, index) => {
    const existingStep = existing.successChain?.find((step) => step.id === item.id || step.title === item.title) ?? null;
    const satisfiedFromCurrentState = roadmap.currentState.some((stateItem) => stateItem.title === item.title && stateItem.itemStatus === "done");
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      order: item.order ?? index,
      satisfied: existingStep?.satisfied ?? satisfiedFromCurrentState,
      satisfiedAt: existingStep?.satisfiedAt ?? (satisfiedFromCurrentState ? roadmap.generatedAt : null),
    };
  });
  const nextUpdate = roadmap.priorityUpdate
    ? {
        id: roadmap.priorityUpdate.id,
        title: roadmap.priorityUpdate.title,
        description: roadmap.priorityUpdate.description,
        pillarIds: [...roadmap.priorityUpdate.pillarIds],
        currentStateContext: roadmap.priorityUpdate.currentStateContext ?? null,
        successDefinition: roadmap.priorityUpdate.successDefinition ?? null,
        partialSuccessDefinition: roadmap.priorityUpdate.partialSuccessDefinition ?? null,
        partialFailureDefinition: roadmap.priorityUpdate.partialFailureDefinition ?? null,
        failureDefinition: roadmap.priorityUpdate.failureDefinition ?? null,
        updateKind: roadmap.priorityUpdate.updateKind,
        simplificationMode: null,
        structuralReason: null,
        supportsNextStep: null,
        skillsNeeded: [],
        dependencies: [],
      }
    : null;
  const futureUpdatePlan = normalizeFutureUpdatePlan(
    roadmap.pathway.map((item, index) => {
      const existingUpdate = existing.futureUpdatePlan?.find((update) => update.id === item.id || update.title === item.title) ?? null;
      const completed = roadmap.currentState.some((stateItem) => stateItem.title === item.title && stateItem.itemStatus === "done");
      return {
        id: item.id,
        versionId: null,
        title: item.title,
        description: item.description,
        order: item.order ?? index,
        status: existingUpdate?.status ?? (completed ? "completed" : roadmap.priorityUpdate?.id === item.id ? "pending" : "pending"),
        dependencies: existingUpdate?.dependencies ?? [],
        pillarIds: item.pillarIds,
        skillsNeeded: existingUpdate?.skillsNeeded ?? [],
        updateKind: item.updateKind,
        simplificationMode: existingUpdate?.simplificationMode ?? null,
        structuralReason: existingUpdate?.structuralReason ?? null,
        supportsNextStep: existingUpdate?.supportsNextStep ?? null,
      };
    }),
  );

  return {
    currentState,
    endStateGoal,
    successChain,
    nextUpdate,
    futureUpdatePlan,
  };
};

const hasToddRoadmapContent = (roadmap: ToddRoadmap | null | undefined): boolean =>
  Boolean(
    roadmap
    && (
      roadmap.currentState.length > 0
      || roadmap.endState.length > 0
      || roadmap.pathway.length > 0
      || roadmap.priorityUpdate
    ),
  );

const hasToddLegacyRoadmapContent = (toddMemory: ToddMemory): boolean =>
  Boolean(
    (toddMemory.currentState && toddMemory.currentState.trim().length > 0)
    || (toddMemory.endStateGoal && toddMemory.endStateGoal.trim().length > 0)
    || toddMemory.nextUpdate
    || (toddMemory.futureUpdatePlan?.length ?? 0) > 0
    || (toddMemory.successChain?.length ?? 0) > 0
  );

const buildToddRoadmapFromLegacy = (
  toddMemory: ToddMemory,
  fallbackPillarIds: string[],
): ToddRoadmap | null => {
  if (!hasToddLegacyRoadmapContent(toddMemory)) {
    return null;
  }

  const now = new Date().toISOString();
  const currentState: ToddCurrentStateItem[] = toddMemory.currentState
    ? [{
        id: randomUUID(),
        title: "Current State",
        description: toddMemory.currentState,
        pillarIds: ensureRoadmapItemPillarIds([], fallbackPillarIds),
        itemStatus: "tbd",
        detailLines: [],
        sourceRefs: [],
      }]
    : [];

  const endState: ToddEndStateItem[] = toddMemory.endStateGoal
    ? [{
        id: randomUUID(),
        title: "End State Goal",
        description: toddMemory.endStateGoal,
        pillarIds: ensureRoadmapItemPillarIds([], fallbackPillarIds),
        detailLines: [],
        sourceRefs: [],
      }]
    : [];

  const pathway: ToddPathwayItem[] = (toddMemory.futureUpdatePlan ?? [])
    .filter((update) => update.status !== "completed" && update.status !== "failed")
    .map((update, index) => ({
      id: update.id,
      title: update.title,
      description: update.description,
      pillarIds: ensureRoadmapItemPillarIds(update.pillarIds, fallbackPillarIds),
      updateKind: ((update.updateKind === "simplify" ? "refine" : update.updateKind) as "create" | "expand" | "refine" | null) ?? "create",
      order: update.order ?? index,
      detailLines: [],
      sourceRefs: [],
    }));

  const prioritySource = toddMemory.nextUpdate
    ? {
        id: toddMemory.nextUpdate.id,
        title: toddMemory.nextUpdate.title,
        description: toddMemory.nextUpdate.description,
        pillarIds: ensureRoadmapItemPillarIds(toddMemory.nextUpdate.pillarIds, fallbackPillarIds),
        updateKind: ((toddMemory.nextUpdate.updateKind === "simplify" ? "refine" : toddMemory.nextUpdate.updateKind) as "create" | "expand" | "refine" | null) ?? "create",
      }
    : (() => {
        const nextQueuedUpdate = (toddMemory.futureUpdatePlan ?? [])
          .filter((update) => update.status === "pending" || update.status === "in_progress")
          .slice()
          .sort((left, right) => left.order - right.order)[0] ?? null;
        if (!nextQueuedUpdate) {
          return null;
        }
        return {
          id: nextQueuedUpdate.id,
          title: nextQueuedUpdate.title,
          description: nextQueuedUpdate.description,
          pillarIds: ensureRoadmapItemPillarIds(nextQueuedUpdate.pillarIds, fallbackPillarIds),
          updateKind: ((nextQueuedUpdate.updateKind === "simplify" ? "refine" : nextQueuedUpdate.updateKind) as "create" | "expand" | "refine" | null) ?? "create",
        };
      })();

  const priorityUpdate: ToddPriorityUpdate | null = prioritySource
    ? {
        ...prioritySource,
        currentStateContext: toddMemory.nextUpdate?.currentStateContext ?? toddMemory.currentState ?? "",
        successDefinition: toddMemory.nextUpdate?.successDefinition ?? null,
        partialSuccessDefinition: toddMemory.nextUpdate?.partialSuccessDefinition ?? null,
        partialFailureDefinition: toddMemory.nextUpdate?.partialFailureDefinition ?? null,
        failureDefinition: toddMemory.nextUpdate?.failureDefinition ?? null,
        sourceRefs: [],
      }
    : null;

  return {
    currentState,
    endState,
    pathway,
    priorityUpdate,
    generatedAt: now,
  };
};

const mergeToddRoadmapWithLegacy = (
  roadmap: ToddRoadmap,
  legacyRoadmap: ToddRoadmap | null,
): ToddRoadmap => {
  if (!legacyRoadmap) {
    return roadmap;
  }

  return {
    currentState: roadmap.currentState.length > 0 ? roadmap.currentState : legacyRoadmap.currentState,
    endState: roadmap.endState.length > 0 ? roadmap.endState : legacyRoadmap.endState,
    pathway: roadmap.pathway.length > 0 ? roadmap.pathway : legacyRoadmap.pathway,
    priorityUpdate: legacyRoadmap.priorityUpdate ?? roadmap.priorityUpdate,
    generatedAt: roadmap.generatedAt ?? legacyRoadmap.generatedAt,
  };
};

const migrateToddMemoryToRoadmap = (
  toddMemory: ToddMemory,
  fallbackPillarIds: string[],
): ToddMemory => {
  const existingRoadmap = toddMemory.hardMemory ?? toddMemory.roadmap ?? null;
  const legacyRoadmap = buildToddRoadmapFromLegacy(toddMemory, fallbackPillarIds);
  if (existingRoadmap) {
    const normalizedExistingRoadmap: ToddRoadmap = {
      currentState: existingRoadmap.currentState.map((item) => ({
        ...item,
        pillarIds: ensureRoadmapItemPillarIds(item.pillarIds, fallbackPillarIds),
        detailLines: item.detailLines ?? [],
        sourceRefs: item.sourceRefs ?? [],
      })),
      endState: existingRoadmap.endState.map((item) => ({
        ...item,
        pillarIds: ensureRoadmapItemPillarIds(item.pillarIds, fallbackPillarIds),
        detailLines: item.detailLines ?? [],
        sourceRefs: item.sourceRefs ?? [],
      })),
      pathway: existingRoadmap.pathway.map((item) => ({
        ...item,
        pillarIds: ensureRoadmapItemPillarIds(item.pillarIds, fallbackPillarIds),
        detailLines: item.detailLines ?? [],
        sourceRefs: item.sourceRefs ?? [],
      })),
      priorityUpdate: existingRoadmap.priorityUpdate
        ? {
            ...existingRoadmap.priorityUpdate,
            pillarIds: ensureRoadmapItemPillarIds(existingRoadmap.priorityUpdate.pillarIds, fallbackPillarIds),
            sourceRefs: existingRoadmap.priorityUpdate.sourceRefs ?? [],
          }
        : null,
      generatedAt: existingRoadmap.generatedAt,
    };
    const roadmap = hasToddRoadmapContent(normalizedExistingRoadmap)
      ? mergeToddRoadmapWithLegacy(normalizedExistingRoadmap, legacyRoadmap)
      : legacyRoadmap ?? normalizedExistingRoadmap;
    const legacy = deriveLegacyToddFieldsFromRoadmap(roadmap, toddMemory);
    return {
      ...toddMemory,
      hardMemory: roadmap,
      roadmap,
      ...legacy,
    };
  }

  if (!legacyRoadmap) {
    return {
      ...toddMemory,
      hardMemory: null,
      roadmap: null,
      futureUpdatePlan: normalizeFutureUpdatePlan(toddMemory.futureUpdatePlan ?? []),
    };
  }

  const roadmap: ToddRoadmap = legacyRoadmap;
  const legacy = deriveLegacyToddFieldsFromRoadmap(roadmap, toddMemory);
  return { ...toddMemory, hardMemory: roadmap, roadmap, ...legacy };
};

const summarizeDanForJeff = (concept: AgentCoreDetails | null): string | null => {
  if (!concept) {
    return null;
  }
  const parts = [
    concept.function?.summary ? `Function: ${concept.function.summary}` : null,
    concept.thesis?.summary ? `Thesis: ${concept.thesis.summary}` : null,
    concept.corePillars.length > 0 ? `Pillars: ${concept.corePillars.map((pillar) => pillar.name).join(", ")}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : null;
};

const summarizeToddForJeff = (roadmap: ToddRoadmap | null): string | null => {
  if (!roadmap) {
    return null;
  }
  const priority = roadmap.priorityUpdate?.title ? `Priority: ${roadmap.priorityUpdate.title}` : null;
  const current = roadmap.currentState.length > 0 ? `${roadmap.currentState.length} current-state item(s)` : null;
  const pathway = roadmap.pathway.length > 0 ? `${roadmap.pathway.length} pathway item(s)` : null;
  const end = roadmap.endState.length > 0 ? `${roadmap.endState.length} end-state item(s)` : null;
  const parts = [priority, current, pathway, end].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : null;
};

const syncAgentMemories = (session: AgentSession): AgentSession => {
  const confirmedConcept = buildConfirmedConceptFromSession(session);
  const hasDanMemory = Boolean(session.danMemory);
  const hasToddMemory = Boolean(session.toddMemory);
  const hasPingMemory = Boolean(session.pingMemory);
  const fallbackPillarIds = deriveFallbackPillarIds(confirmedConcept);
  const danSeedSoftNotes = mergeTaggedNoteCollections(
    hasDanMemory ? [...(session.danMemory!.softMemory ?? [])] : [],
    hasDanMemory ? [...(session.danMemory!.notes ?? [])] : [],
    hasDanMemory ? [...(session.danMemory!.toddHandoffNotes ?? [])] : [],
    !hasDanMemory ? migrateToTaggedNotes(session.danInternalNotes ?? []) : [],
  );
  const danSoftMemory = normalizeTaggedNotes(danSeedSoftNotes, "creative-director");
  const danBackupMemory = normalizeTaggedNotes(mergeTaggedNoteCollections(
    hasDanMemory ? [...(session.danMemory!.backupMemory ?? [])] : [],
    hasDanMemory ? migrateToTaggedNotes(session.danMemory!.archivedNotes ?? [], "likely-backup") : [],
    !hasDanMemory ? migrateToTaggedNotes(session.danArchivedNotes ?? [], "likely-backup") : [],
  ), "creative-director");
  const danMemory: DanMemory = {
    softMemory: danSoftMemory,
    hardMemory: session.danMemory?.hardMemory ?? session.danMemory?.confirmedConcept ?? confirmedConcept ?? null,
    backupMemory: danBackupMemory,
    hardMemoryUpdatedAt: session.danMemory?.hardMemoryUpdatedAt ?? null,
    latestReportId: session.danMemory?.latestReportId ?? null,
    confirmedConcept: session.danMemory?.hardMemory ?? session.danMemory?.confirmedConcept ?? confirmedConcept ?? null,
    draftConcept: hasDanMemory ? session.danMemory!.draftConcept : session.danDraftCoreDetails ?? null,
    derivedConcept: hasDanMemory ? session.danMemory!.derivedConcept ?? null : null,
    notes: danSoftMemory.filter((note) => note.tag !== "handoff-to-todd"),
    derivedNotes: normalizeTaggedNotes(migrateToTaggedNotes(hasDanMemory ? [...(session.danMemory!.derivedNotes ?? [])] : []), "creative-director"),
    sideNotes: hasDanMemory ? [...session.danMemory!.sideNotes] : session.danSideNotes ?? [],
    draftChangeSummary: hasDanMemory ? [...session.danMemory!.draftChangeSummary] : session.danDraftChangeSummary ?? [],
    draftStatus: hasDanMemory ? session.danMemory!.draftStatus : session.danDraftStatus ?? null,
    derivedUpdatedAt: hasDanMemory ? session.danMemory!.derivedUpdatedAt ?? null : null,
    fullExperienceDescription: session.danMemory?.fullExperienceDescription
      ?? confirmedConcept?.fullFlow?.summary
      ?? null,
    archivedNotes: danBackupMemory.map((note) => note.content),
    deletedNotes: hasDanMemory ? [...session.danMemory!.deletedNotes] : session.deletedNotes ?? [],
    rawMemories: hasDanMemory ? [...(session.danMemory!.rawMemories ?? [])] : [],
    forgottenMemories: hasDanMemory
      ? [...(session.danMemory!.forgottenMemories ?? [])]
      : [...(session.danSideNotes ?? []), ...(session.deletedNotes ?? [])],
    creativeHistory: hasDanMemory ? [...(session.danMemory!.creativeHistory ?? [])] : [],
    toddHandoffNotes: danSoftMemory.filter((note) => note.tag === "handoff-to-todd"),
    threads: hasDanMemory ? [...(session.danMemory!.threads ?? [])] : [],
  };

  const pendingHandoffNotes = hasToddMemory && session.toddMemory!.pendingHandoff
    ? session.toddMemory!.pendingHandoff.rawInputs.map((input, index): TaggedNote => ({
        id: `todd-handoff-${index}`,
        content: input,
        tag: "handoff-to-todd",
        createdAt: session.toddMemory!.pendingHandoff!.receivedAt,
        sourceRefs: [
          {
            id: `todd-handoff-source-${index}`,
            messageId: null,
            rawText: input,
            directorId: "creative-director",
            kind: "handoff",
            createdAt: session.toddMemory!.pendingHandoff!.receivedAt,
          },
        ],
        resolution: null,
      }))
    : [];
  const toddSoftMemory = normalizeTaggedNotes(mergeTaggedNoteCollections(
    hasToddMemory ? [...(session.toddMemory!.softMemory ?? [])] : [],
    hasToddMemory ? [...(session.toddMemory!.notes ?? [])] : [],
    pendingHandoffNotes,
  ), "rd-director");
  const toddBackupMemory = normalizeTaggedNotes(mergeTaggedNoteCollections(
    hasToddMemory ? [...(session.toddMemory!.backupMemory ?? [])] : [],
    hasToddMemory ? [...(session.toddMemory!.backupNotes ?? [])] : [],
  ), "rd-director");
  const toddMemoryBase: ToddMemory = {
    softMemory: toddSoftMemory,
    hardMemory: hasToddMemory ? (session.toddMemory!.hardMemory ?? session.toddMemory!.roadmap ?? null) : null,
    backupMemory: toddBackupMemory,
    hardMemoryUpdatedAt: hasToddMemory ? session.toddMemory!.hardMemoryUpdatedAt ?? null : null,
    latestReportId: hasToddMemory ? session.toddMemory!.latestReportId ?? null : null,
    confirmedConcept: danMemory.confirmedConcept,
    roadmap: hasToddMemory ? (session.toddMemory!.hardMemory ?? session.toddMemory!.roadmap ?? null) : null,
    currentState: hasToddMemory ? (session.toddMemory!.currentState ?? null) : null,
    endStateGoal: hasToddMemory ? (session.toddMemory!.endStateGoal ?? null) : null,
    successChain: hasToddMemory ? (session.toddMemory!.successChain ?? []) : [],
    nextUpdate: hasToddMemory ? (session.toddMemory!.nextUpdate ?? null) : null,
    futureUpdatePlan: hasToddMemory
      ? normalizeFutureUpdatePlan(session.toddMemory!.futureUpdatePlan ?? [])
      : normalizeFutureUpdatePlan(session.versionUpdates ?? []),
    previousUpdateLog: hasToddMemory ? [...session.toddMemory!.previousUpdateLog] : [],
    troubleLog: hasToddMemory ? [...session.toddMemory!.troubleLog] : [],
    codebaseIndexedMap: buildToddCodebaseMapFromSession(session, hasToddMemory ? session.toddMemory!.codebaseIndexedMap ?? null : null),
    notes: toddSoftMemory,
    pendingHandoff: null,
    backupNotes: toddBackupMemory,
  };
  const toddMemory = migrateToddMemoryToRoadmap(toddMemoryBase, fallbackPillarIds);

  const pingMemory: PingMemory = {
    activeUpdateId: hasPingMemory ? session.pingMemory!.activeUpdateId : null,
    activeTask: hasPingMemory ? session.pingMemory!.activeTask : session.pingTaskContext?.currentTask ?? null,
    context: hasPingMemory ? session.pingMemory!.context : session.pingTaskContext?.toddUpdateExplanation ?? null,
    codebaseMapSummary: hasPingMemory ? session.pingMemory!.codebaseMapSummary : toddMemory.codebaseIndexedMap?.summary ?? null,
    latestPlanReport: hasPingMemory ? session.pingMemory!.latestPlanReport ?? null : null,
    latestIndexedMap: hasPingMemory ? session.pingMemory!.latestIndexedMap ?? (toddMemory.codebaseIndexedMap ? { ...toddMemory.codebaseIndexedMap } : null) : (toddMemory.codebaseIndexedMap ? { ...toddMemory.codebaseIndexedMap } : null),
    latestRawReport: hasPingMemory ? session.pingMemory!.latestRawReport : null,
    latestJeffReport: hasPingMemory ? session.pingMemory!.latestJeffReport : null,
    currentRun: hasPingMemory ? session.pingMemory!.currentRun ?? null : null,
  };

  const hasJeffMemory = Boolean(session.jeffMemory);
  const currentProjectStatus = hasJeffMemory
    ? session.jeffMemory!.currentProjectStatus ?? session.jeffMemory!.projectStatusHistory?.at(-1) ?? null
    : null;
  const managerSummary: JeffManagerSummary = {
    danSummary: summarizeDanForJeff(danMemory.hardMemory),
    toddSummary: summarizeToddForJeff(toddMemory.hardMemory),
    currentProjectStatus: currentProjectStatus?.summary ?? null,
  };
  const jeffMemory: JeffMemory = {
    softMemory: normalizeTaggedNotes(mergeTaggedNoteCollections(
      hasJeffMemory ? [...(session.jeffMemory!.softMemory ?? [])] : [],
      hasJeffMemory ? [...(session.jeffMemory!.notes ?? [])] : [],
    ), "project-manager"),
    hardMemory: managerSummary,
    backupMemory: normalizeTaggedNotes(mergeTaggedNoteCollections(
      hasJeffMemory ? [...(session.jeffMemory!.backupMemory ?? [])] : [],
      hasJeffMemory ? [...(session.jeffMemory!.backupNotes ?? [])] : [],
    ), "project-manager"),
    hardMemoryUpdatedAt: hasJeffMemory ? session.jeffMemory!.hardMemoryUpdatedAt ?? null : null,
    latestReportId: hasJeffMemory ? session.jeffMemory!.latestReportId ?? null : null,
    pendingReports: hasJeffMemory ? [...(session.jeffMemory!.pendingReports ?? [])] : [],
    pendingValidations: hasJeffMemory ? [...(session.jeffMemory!.pendingValidations ?? [])] : [],
    outcomeLog: hasJeffMemory ? [...(session.jeffMemory!.outcomeLog ?? [])] : [],
    managerSummary,
    projectStatusHistory: hasJeffMemory ? [...(session.jeffMemory!.projectStatusHistory ?? [])] : [],
    currentProjectStatus,
    notes: normalizeTaggedNotes(mergeTaggedNoteCollections(
      hasJeffMemory ? [...(session.jeffMemory!.softMemory ?? [])] : [],
      hasJeffMemory ? [...(session.jeffMemory!.notes ?? [])] : [],
    ), "project-manager"),
    backupNotes: normalizeTaggedNotes(mergeTaggedNoteCollections(
      hasJeffMemory ? [...(session.jeffMemory!.backupMemory ?? [])] : [],
      hasJeffMemory ? [...(session.jeffMemory!.backupNotes ?? [])] : [],
    ), "project-manager"),
  };

  const hasPongMemory = Boolean(session.pongMemory);
  const validationRequest: ToddValidationRequest | null = hasPongMemory
    ? session.pongMemory!.validationRequest ?? (session.pongMemory!.jeffInstruction
      ? {
          id: "legacy-validation-request",
          instruction: session.pongMemory!.jeffInstruction,
          updateId: session.pingMemory?.currentRun?.task.updateId ?? session.pingMemory?.latestRawReport?.updateId ?? null,
          relevantPillarIds: session.pongTaskContext?.relevantPillarIds ?? [],
          sourceRefs: [buildLegacyMemorySourceRef(session.pongMemory!.jeffInstruction, "rd-director")],
          createdAt: new Date(0).toISOString(),
        }
      : null)
    : null;
  const pongMemory: PongMemory = {
    jeffInstruction: validationRequest?.instruction ?? null,
    validationRequest,
    previousValidationReports: hasPongMemory ? [...(session.pongMemory!.previousValidationReports ?? [])] : [],
    latestValidationReport: hasPongMemory ? session.pongMemory!.latestValidationReport ?? null : null,
    screenshotPaths: hasPongMemory ? [...(session.pongMemory!.screenshotPaths ?? [])] : [],
  };

  session.danMemory = danMemory;
  session.toddMemory = toddMemory;
  session.pingMemory = pingMemory;
  session.jeffMemory = jeffMemory;
  session.pongMemory = pongMemory;
  session.versions = [];
  session.versionUpdates = [...toddMemory.futureUpdatePlan];
  session.danInternalNotes = extractNoteContents(danMemory.notes);
  session.danSideNotes = [...danMemory.sideNotes];
  session.danDraftCoreDetails = danMemory.draftConcept;
  session.danDraftChangeSummary = [...danMemory.draftChangeSummary];
  session.danDraftStatus = danMemory.draftStatus;
  session.danArchivedNotes = [...danMemory.backupMemory.map((note) => note.content)];
  session.deletedNotes = [...danMemory.deletedNotes];
  session.automation = buildDefaultAutomationState(session.automation);
  return session;
};

const buildPingRawReport = (input: {
  status: PingRawReportStatus;
  updateId: string | null;
  goal: string | null;
  summary: string;
  changedFiles?: string[];
  blocker?: string | null;
  unexpectedNotes?: string[];
}): PingRawReport => {
  const translation = getPingStatusTranslation(input.status);
  return {
    status: input.status,
    updateId: input.updateId,
    goal: input.goal,
    summary: input.summary,
    zhResponse: translation.zhResponse,
    enTranslation: translation.enTranslation,
    changedFiles: input.changedFiles ?? [],
    blocker: input.blocker ?? null,
    unexpectedNotes: input.unexpectedNotes ?? [],
    createdAt: new Date().toISOString(),
  };
};

const buildPingPlanSnapshot = (draft: PlanDraft): PingPlanSnapshot | null => {
  if (!draft.pingTaskSnapshot) {
    return null;
  }

  return {
    task: draft.pingTaskSnapshot,
    provider: draft.provider,
    model: draft.model,
    claudeModel: draft.claudeModel,
    reasoningEffort: draft.reasoningEffort,
    planningMode: draft.planningMode,
    threadId: draft.threadId,
    turnId: draft.turnId,
    status: draft.status,
    thinkingStatus: draft.thinkingStatus,
    planningStatus: draft.planningStatus,
    buildingStatus: draft.buildingStatus,
    verifyingStatus: draft.verifyingStatus,
    explanation: draft.explanation,
    steps: [...draft.steps],
    summary: draft.summary,
    impact: draft.impact,
    contextPaths: [...draft.contextPaths],
    lastUpdatedAt: draft.lastUpdatedAt,
  };
};

const buildPingTaskSnapshot = (input: {
  source: PingTaskSource;
  projectId: string;
  updateId?: string | null;
  updateTitle?: string | null;
  updateDescription?: string | null;
  originalUserRequest: string;
  toddExplanation?: string | null;
  relevantPillarIds?: string[];
  currentStateItems?: ToddCurrentStateItem[];
  priorityUpdate?: ToddPriorityUpdate | null;
  sourceRefs?: MemorySourceRef[];
  indexedMap?: ToddIndexedMapSnapshot | null;
  toddCodebaseMapSummary?: string | null;
  coreDetailsContext?: string | null;
  runtime: PingRuntimeSnapshot;
  planPrompt?: string;
}): PingTaskSnapshot => ({
  source: input.source,
  projectId: input.projectId,
  updateId: input.updateId ?? null,
  updateTitle: input.updateTitle ?? null,
  updateDescription: input.updateDescription ?? null,
  originalUserRequest: input.originalUserRequest,
  toddExplanation: input.toddExplanation ?? null,
  relevantPillarIds: input.relevantPillarIds ?? [],
  currentStateItems: input.currentStateItems ?? [],
  priorityUpdate: input.priorityUpdate ?? null,
  sourceRefs: input.sourceRefs ?? [],
  indexedMap: input.indexedMap ?? null,
  toddCodebaseMapSummary: input.toddCodebaseMapSummary ?? null,
  coreDetailsContext: input.coreDetailsContext ?? null,
  runtime: input.runtime,
  planPrompt: input.planPrompt ?? "",
  createdAt: new Date().toISOString(),
});

const buildPingExecutionReportSnapshot = (input: {
  task: PingTaskSnapshot;
  plan: PingPlanSnapshot | null;
  rawReport: PingRawReport;
  usageBefore?: UsageCapture | null;
  usageAfter?: UsageCapture | null;
  historyUpdateId?: string | null;
  commitSha?: string | null;
  jeffReportId?: string | null;
  jeffSummary?: string | null;
}): PingExecutionReportSnapshot => ({
  task: input.task,
  plan: input.plan ?? null,
  rawReport: input.rawReport,
  usageBefore: input.usageBefore ?? null,
  usageAfter: input.usageAfter ?? null,
  historyUpdateId: input.historyUpdateId ?? null,
  commitSha: input.commitSha ?? null,
  jeffReportId: input.jeffReportId ?? null,
  jeffSummary: input.jeffSummary ?? null,
  createdAt: new Date().toISOString(),
});

const buildJeffExecutionReport = (input: {
  rawReport: PingRawReport;
  title: string;
  summary: string;
  outcome: string;
  toddRecommendedDecision?: JeffOutcomeDecision | null;
  toddFollowUpNeeded: boolean;
  toddFollowUpReason?: string | null;
  toddReplanNeeded?: boolean;
  toddReplanReason?: string | null;
  toddReplanApprovalId?: string | null;
  historyUpdateId?: string | null;
  commitSha?: string | null;
  decision?: JeffOutcomeDecision | null;
  pingReport?: PingExecutionReportSnapshot | null;
  validationReport?: PongValidationReport | null;
  revertAvailable?: boolean;
  revertHistoryUpdateId?: string | null;
  revertCommitSha?: string | null;
}): JeffExecutionReport => ({
  id: randomUUID(),
  updateId: input.rawReport.updateId,
  historyUpdateId: input.historyUpdateId ?? null,
  commitSha: input.commitSha ?? null,
  title: input.title,
  summary: input.summary,
  outcome: input.outcome,
  toddRecommendedDecision: input.toddRecommendedDecision ?? null,
  toddFollowUpNeeded: input.toddFollowUpNeeded,
  toddFollowUpReason: input.toddFollowUpReason ?? null,
  toddReplanNeeded: input.toddReplanNeeded ?? false,
  toddReplanReason: input.toddReplanReason ?? null,
  toddReplanApprovalId: input.toddReplanApprovalId ?? null,
  rawReport: input.rawReport,
  decision: input.decision ?? null,
  pingReport: input.pingReport ?? null,
  validationReport: input.validationReport ?? null,
  revertAvailable: input.revertAvailable ?? false,
  revertHistoryUpdateId: input.revertHistoryUpdateId ?? null,
  revertCommitSha: input.revertCommitSha ?? null,
  createdAt: new Date().toISOString(),
});

const buildDefaultAutomationState = (
  automation: Partial<AutomationRunState> = {},
): AutomationRunState => ({
  status: automation.status ?? "idle",
  selectedTargetUpdateId: automation.selectedTargetUpdateId ?? null,
  selectedTargetVersionId: automation.selectedTargetVersionId ?? null,
  inScopeUpdateIds: automation.inScopeUpdateIds ?? [],
  constraints: {
    allowedHours: automation.constraints?.allowedHours ?? null,
    codexMaxUsedPercent: typeof automation.constraints?.codexMaxUsedPercent === "number"
      ? automation.constraints.codexMaxUsedPercent
      : null,
    claudeMaxUsedPercent: typeof automation.constraints?.claudeMaxUsedPercent === "number"
      ? automation.constraints.claudeMaxUsedPercent
      : null,
  },
  stopReason: automation.stopReason ?? null,
  stopSummary: automation.stopSummary ?? null,
  currentStep: automation.currentStep ?? "idle",
  startedAt: automation.startedAt ?? null,
  lastResumedAt: automation.lastResumedAt ?? null,
  updatedAt: automation.updatedAt ?? null,
  completedAt: automation.completedAt ?? null,
  resumeRequired: automation.resumeRequired ?? false,
  nextUpdateId: automation.nextUpdateId ?? null,
  lastSuccessfulUpdateId: automation.lastSuccessfulUpdateId ?? null,
  lastSuccessfulHistoryUpdateId: automation.lastSuccessfulHistoryUpdateId ?? null,
  pendingRevertReportId: automation.pendingRevertReportId ?? null,
  pendingRevertHistoryUpdateId: automation.pendingRevertHistoryUpdateId ?? null,
  pendingRevertCommitSha: automation.pendingRevertCommitSha ?? null,
});

const AUTOMATION_VERSION_UNASSIGNED = "__unassigned__";
const AUTOMATION_POLL_INTERVAL_MS = 1500;

const collectToddRoadmapVersions = (_session: AgentSession): VersionPlan[] => [];

const findToddDraftUpdateApproval = (session: AgentSession): PendingApproval | null =>
  (session.pendingApprovals ?? [])
    .filter((approval) => approval.requestedByDirectorId === "rd-director" && approval.kind === "store-data")
    .filter((approval) => isToddUpdatePlanDraftPayload(approval.draftPayload ?? null))
    .sort((left, right) => {
      const leftMeta = getToddUpdatePlanDraftMetadata(left.draftPayload ?? null);
      const rightMeta = getToddUpdatePlanDraftMetadata(right.draftPayload ?? null);
      if (leftMeta.supersedesConfirmedPlan !== rightMeta.supersedesConfirmedPlan) {
        return leftMeta.supersedesConfirmedPlan ? -1 : 1;
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    })[0] ?? null;

const hasToddSupersedingDraftUpdatePlan = (session: AgentSession): boolean => {
  const draftApproval = findToddDraftUpdateApproval(session);
  return draftApproval ? getToddUpdatePlanDraftMetadata(draftApproval.draftPayload ?? null).supersedesConfirmedPlan : false;
};

const resolveToddPlanSource = (session: AgentSession): {
  updates: VersionUpdate[];
  roadmapVersions: VersionPlan[];
  draft: boolean;
  draftApprovalId: string | null;
  supersedesConfirmedPlan: boolean;
  planSource: ToddUpdatePlanSource | null;
  source: ListAutomationTargetsResponse["source"];
} => {
  const roadmapVersions = collectToddRoadmapVersions(session);
  const confirmedUpdates = normalizeFutureUpdatePlan(session.toddMemory.futureUpdatePlan ?? []);
  const draftApproval = findToddDraftUpdateApproval(session);
  const draftMeta = getToddUpdatePlanDraftMetadata(draftApproval?.draftPayload ?? null);
  if (draftApproval && draftMeta.supersedesConfirmedPlan) {
    return {
      updates: normalizeFutureUpdatePlan((draftApproval.draftPayload?.updates as VersionUpdate[]) ?? []),
      roadmapVersions,
      draft: true,
      draftApprovalId: draftApproval.id,
      supersedesConfirmedPlan: true,
      planSource: draftMeta.planSource,
      source: "draft",
    };
  }
  if (confirmedUpdates.length > 0) {
    return {
      updates: confirmedUpdates,
      roadmapVersions,
      draft: false,
      draftApprovalId: null,
      supersedesConfirmedPlan: false,
      planSource: null,
      source: "confirmed",
    };
  }

  if (!draftApproval) {
    return {
      updates: [],
      roadmapVersions,
      draft: false,
      draftApprovalId: null,
      supersedesConfirmedPlan: false,
      planSource: null,
      source: "none",
    };
  }

  return {
    updates: normalizeFutureUpdatePlan((draftApproval.draftPayload?.updates as VersionUpdate[]) ?? []),
    roadmapVersions,
    draft: true,
    draftApprovalId: draftApproval.id,
    supersedesConfirmedPlan: draftMeta.supersedesConfirmedPlan,
    planSource: draftMeta.planSource,
    source: "draft",
  };
};

const getAutomationVersionKey = (versionId: string | null): string =>
  versionId && versionId.trim().length > 0 ? versionId : AUTOMATION_VERSION_UNASSIGNED;

const compareAutomationUpdates = (
  left: VersionUpdate,
  right: VersionUpdate,
  versions: VersionPlan[],
): number => {
  const leftVersionIndex = versions.findIndex((version) => version.id === left.versionId);
  const rightVersionIndex = versions.findIndex((version) => version.id === right.versionId);
  const normalizedLeftVersionIndex = leftVersionIndex >= 0 ? leftVersionIndex : Number.MAX_SAFE_INTEGER;
  const normalizedRightVersionIndex = rightVersionIndex >= 0 ? rightVersionIndex : Number.MAX_SAFE_INTEGER;
  if (normalizedLeftVersionIndex !== normalizedRightVersionIndex) {
    return normalizedLeftVersionIndex - normalizedRightVersionIndex;
  }
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  return left.title.localeCompare(right.title);
};

const resolveAutomationCurrentVersionKey = (
  updates: VersionUpdate[],
  versions: VersionPlan[],
): string | null => {
  const active = updates
    .filter((update) => update.status === "pending" || update.status === "in_progress")
    .slice()
    .sort((left, right) => compareAutomationUpdates(left, right, versions))[0] ?? null;
  return active ? getAutomationVersionKey(active.versionId ?? null) : null;
};

const listAutomationTargetCandidates = (session: AgentSession): ListAutomationTargetsResponse => {
  syncAgentMemories(session);
  const plan = resolveToddPlanSource(session);
  const currentVersionKey = resolveAutomationCurrentVersionKey(plan.updates, plan.roadmapVersions);
  const currentVersion = currentVersionKey && currentVersionKey !== AUTOMATION_VERSION_UNASSIGNED
    ? plan.roadmapVersions.find((version) => version.id === currentVersionKey) ?? null
    : null;
  const versionUpdates = currentVersionKey
    ? plan.updates
      .filter((update) => getAutomationVersionKey(update.versionId ?? null) === currentVersionKey)
      .slice()
      .sort((left, right) => compareAutomationUpdates(left, right, plan.roadmapVersions))
    : [];

  const pendingPath = versionUpdates.filter((update) => update.status !== "completed");
  const candidates: AutomationTargetCandidate[] = versionUpdates
    .filter((update) => update.status === "pending" || update.status === "in_progress")
    .map((update) => ({
      updateId: update.id,
      versionId: update.versionId || null,
      versionLabel: currentVersion?.label ?? "Unassigned",
      title: update.title,
      description: update.description,
      order: update.order,
      status: update.status,
      available: !plan.draft,
      draft: plan.draft,
      blockedReason: plan.draft
        ? plan.supersedesConfirmedPlan
          ? "Confirm Todd's structural replan before automation continues."
          : "Confirm Todd's current update plan before starting automation."
        : null,
      pathUpdateIds: pendingPath
        .filter((candidate) => candidate.order <= update.order)
        .map((candidate) => candidate.id),
    }));

  return {
    source: plan.source,
    currentVersionId: currentVersion?.id ?? (currentVersionKey === AUTOMATION_VERSION_UNASSIGNED ? null : null),
    currentVersionLabel: currentVersion?.label ?? (currentVersionKey === AUTOMATION_VERSION_UNASSIGNED ? "Unassigned" : null),
    draftApprovalId: plan.draftApprovalId,
    candidates,
  };
};

const resolveAutomationTarget = (
  session: AgentSession,
  targetUpdateId: string,
): { candidate: AutomationTargetCandidate | null; draftApprovalId: string | null } => {
  const listing = listAutomationTargetCandidates(session);
  return {
    candidate: listing.candidates.find((candidate) => candidate.updateId === targetUpdateId) ?? null,
    draftApprovalId: listing.draftApprovalId,
  };
};

const resolveUsagePercent = (usage: UsageSnapshot["codex"] | UsageSnapshot["claude"]): number | null => {
  if (usage.status !== "ready") {
    return null;
  }
  const values = usage.windows
    .map((window) => window.usedPercent)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : null;
};

type BasicAutomationRunResult = {
  outcome: "success" | "no_changes";
  summary: string;
};

type PreparedPlanExecution = {
  executingProject: Project;
  service: CodexService | ClaudeService;
  providerLabel: string;
};

type ToddReviewNextAction =
  | "retry_ping"
  | "send_to_pong"
  | "finalize_success"
  | "finalize_partial"
  | "finalize_failure";

const normalizeToddReviewNextAction = (value: unknown): ToddReviewNextAction => {
  switch (value) {
    case "retry_ping":
    case "send_to_pong":
    case "finalize_success":
    case "finalize_partial":
    case "finalize_failure":
      return value;
    default:
      return "finalize_failure";
  }
};

const rerouteRestrictedAgentTarget = (directorId: DirectorId | null): DirectorId | null => (
  directorId === "programming-director" || directorId === "validation-director"
    ? "rd-director"
    : directorId
);

const isToddExecutorDirector = (directorId: DirectorId | null): boolean =>
  directorId === "programming-director" || directorId === "validation-director";

const coerceAllowedDirectorHandoff = (
  fromDirectorId: DirectorId,
  handoffTo: DirectorId | null,
): DirectorId | null => {
  if (!handoffTo) {
    return null;
  }

  if (fromDirectorId === "project-manager") {
    return handoffTo === "creative-director" || handoffTo === "rd-director" ? handoffTo : null;
  }

  if (fromDirectorId === "creative-director") {
    return handoffTo === "rd-director" ? handoffTo : null;
  }

  if (fromDirectorId === "rd-director") {
    return handoffTo === "project-manager" || handoffTo === "programming-director" || handoffTo === "validation-director"
      ? handoffTo
      : null;
  }

  if (fromDirectorId === "programming-director" || fromDirectorId === "validation-director") {
    return handoffTo === "rd-director" ? handoffTo : null;
  }

  return null;
};

const getToddRoadmap = (session: AgentSession): ToddRoadmap | null =>
  session.toddMemory.hardMemory ?? session.toddMemory.roadmap ?? null;

const findToddTrackedUpdate = (
  session: AgentSession,
  updateId: string | null,
  updateTitle: string | null,
): VersionUpdate | null => {
  if (!updateId && !updateTitle) {
    return null;
  }

  return session.toddMemory.futureUpdatePlan.find((update) =>
    (updateId && update.id === updateId) || (updateTitle && update.title === updateTitle)
  ) ?? null;
};

const buildCompatibilityUpdateFromPriority = (
  session: AgentSession,
  priorityUpdate: ToddPriorityUpdate,
): VersionUpdate => {
  const tracked = findToddTrackedUpdate(session, priorityUpdate.id, priorityUpdate.title);
  return {
    id: tracked?.id ?? priorityUpdate.id,
    versionId: tracked?.versionId ?? null,
    title: priorityUpdate.title,
    description: priorityUpdate.description,
    order: tracked?.order ?? 0,
    status: tracked?.status ?? "pending",
    dependencies: tracked?.dependencies ?? [],
    pillarIds: priorityUpdate.pillarIds,
    skillsNeeded: tracked?.skillsNeeded ?? [],
    updateKind: priorityUpdate.updateKind,
    simplificationMode: tracked?.simplificationMode ?? null,
    structuralReason: tracked?.structuralReason ?? null,
    supportsNextStep: tracked?.supportsNextStep ?? null,
  };
};

const syncToddRoadmapPriorityFromNextUpdate = (session: AgentSession): void => {
  const fallbackPillarIds = session.corePillars.map((pillar) => pillar.id);
  const roadmap = getToddRoadmap(session) ?? buildToddRoadmapFromLegacy(session.toddMemory, fallbackPillarIds);
  if (!roadmap) {
    return;
  }

  const nextUpdate = session.toddMemory.nextUpdate;
  if (nextUpdate) {
    const pathwayIndex = roadmap.pathway.findIndex((item) => item.id === nextUpdate.id || item.title === nextUpdate.title);
    if (pathwayIndex >= 0) {
      const existingPathway = roadmap.pathway[pathwayIndex];
      roadmap.pathway[pathwayIndex] = {
        ...existingPathway,
        title: nextUpdate.title,
        description: nextUpdate.description,
        pillarIds: nextUpdate.pillarIds.length > 0
          ? ensureRoadmapItemPillarIds(nextUpdate.pillarIds, existingPathway.pillarIds)
          : existingPathway.pillarIds,
        updateKind: normalizeRoadmapUpdateKind(nextUpdate.updateKind === "simplify" ? "refine" : nextUpdate.updateKind),
      };
    }

    roadmap.priorityUpdate = buildToddPriorityUpdateFromNextUpdate(
      {
        ...nextUpdate,
        pillarIds: nextUpdate.pillarIds.length > 0
          ? [...nextUpdate.pillarIds]
          : ensureRoadmapItemPillarIds(roadmap.priorityUpdate?.pillarIds ?? [], fallbackPillarIds),
        currentStateContext: nextUpdate.currentStateContext
          ?? roadmap.priorityUpdate?.currentStateContext
          ?? session.toddMemory.currentState,
      },
      roadmap.priorityUpdate?.sourceRefs ?? [],
    );
  }

  roadmap.generatedAt = new Date().toISOString();
  session.toddMemory.hardMemory = roadmap;
  session.toddMemory.roadmap = roadmap;
};

const upsertToddTrackedUpdate = (
  session: AgentSession,
  update: VersionUpdate,
): VersionUpdate => {
  const existingIndex = session.toddMemory.futureUpdatePlan.findIndex((item) =>
    item.id === update.id || item.title === update.title
  );

  if (existingIndex >= 0) {
    const existing = session.toddMemory.futureUpdatePlan[existingIndex];
    const merged: VersionUpdate = {
      ...existing,
      ...update,
      dependencies: update.dependencies ?? existing.dependencies ?? [],
      pillarIds: update.pillarIds ?? existing.pillarIds ?? [],
      skillsNeeded: update.skillsNeeded ?? existing.skillsNeeded ?? [],
    };
    session.toddMemory.futureUpdatePlan[existingIndex] = merged;
    session.versionUpdates = [...session.toddMemory.futureUpdatePlan];
    return merged;
  }

  session.toddMemory.futureUpdatePlan = normalizeFutureUpdatePlan([
    ...session.toddMemory.futureUpdatePlan,
    update,
  ]);
  session.versionUpdates = [...session.toddMemory.futureUpdatePlan];
  return session.toddMemory.futureUpdatePlan.find((item) => item.id === update.id) ?? update;
};

const updateToddRoadmapPriorityStatus = (
  session: AgentSession,
  decision: JeffProjectStatusEntry["status"],
): void => {
  const roadmap = getToddRoadmap(session);
  const priorityUpdate = roadmap?.priorityUpdate;
  if (!roadmap || !priorityUpdate) {
    return;
  }

  if (decision === "success" || decision === "partial-success") {
    const existingItemIndex = roadmap.currentState.findIndex((item) => item.id === priorityUpdate.id || item.title === priorityUpdate.title);
    const nextCurrentStateItem: ToddCurrentStateItem = {
      id: priorityUpdate.id,
      title: priorityUpdate.title,
      description: priorityUpdate.description,
      pillarIds: [...priorityUpdate.pillarIds],
      itemStatus: decision === "success" ? "done" : "tbd",
      detailLines: roadmap.currentState[existingItemIndex]?.detailLines ?? [],
      sourceRefs: priorityUpdate.sourceRefs ?? roadmap.currentState[existingItemIndex]?.sourceRefs ?? [],
    };
    if (existingItemIndex >= 0) {
      roadmap.currentState[existingItemIndex] = nextCurrentStateItem;
    } else {
      roadmap.currentState = [...roadmap.currentState, nextCurrentStateItem];
    }
  }

  if (decision === "success") {
    const remainingPathway = roadmap.pathway
      .filter((item) => item.id !== priorityUpdate.id)
      .sort((left, right) => left.order - right.order)
      .map((item, index) => ({ ...item, order: index }));
    const nextPriority = remainingPathway[0] ?? null;
    roadmap.pathway = remainingPathway;
    roadmap.priorityUpdate = nextPriority
      ? {
          id: nextPriority.id,
          title: nextPriority.title,
          description: nextPriority.description,
          pillarIds: [...nextPriority.pillarIds],
          updateKind: nextPriority.updateKind,
          currentStateContext: roadmap.currentState
            .map((item) => `${item.title}: ${item.description}`)
            .join("\n"),
          successDefinition: null,
          partialSuccessDefinition: null,
          partialFailureDefinition: null,
          failureDefinition: null,
          sourceRefs: nextPriority.sourceRefs ?? [],
        }
      : null;
  }

  if (session.toddMemory.nextUpdate && roadmap.priorityUpdate) {
    roadmap.priorityUpdate = buildToddPriorityUpdateFromNextUpdate(
      {
        ...session.toddMemory.nextUpdate,
        pillarIds: session.toddMemory.nextUpdate.pillarIds.length > 0
          ? [...session.toddMemory.nextUpdate.pillarIds]
          : [...roadmap.priorityUpdate.pillarIds],
        currentStateContext: session.toddMemory.nextUpdate.currentStateContext
          ?? roadmap.priorityUpdate.currentStateContext
          ?? session.toddMemory.currentState,
      },
      roadmap.priorityUpdate.sourceRefs ?? [],
    );
  }

  roadmap.generatedAt = new Date().toISOString();
  session.toddMemory.hardMemory = roadmap;
  session.toddMemory.roadmap = roadmap;
};

const refreshJeffManagerMemory = (session: AgentSession): void => {
  const managerSummary: JeffManagerSummary = {
    danSummary: summarizeDanForJeff(session.danMemory.hardMemory ?? session.danMemory.confirmedConcept ?? null),
    toddSummary: summarizeToddForJeff(getToddRoadmap(session)),
    currentProjectStatus: session.jeffMemory.currentProjectStatus?.summary ?? null,
  };
  session.jeffMemory.managerSummary = managerSummary;
  session.jeffMemory.hardMemory = managerSummary;
};

const appendJeffProjectStatusEntry = (
  session: AgentSession,
  input: {
    summary: string;
    status: JeffProjectStatusEntry["status"];
    reportId: string | null;
    sourceDirectorId: DirectorId | null;
  },
): JeffProjectStatusEntry => {
  const entry: JeffProjectStatusEntry = {
    id: randomUUID(),
    summary: input.summary,
    status: input.status,
    reportId: input.reportId,
    sourceDirectorId: input.sourceDirectorId,
    createdAt: new Date().toISOString(),
  };
  session.jeffMemory.currentProjectStatus = entry;
  session.jeffMemory.projectStatusHistory = [
    ...(session.jeffMemory.projectStatusHistory ?? []),
    entry,
  ];
  refreshJeffManagerMemory(session);
  return entry;
};

const buildUsageCapture = (
  provider: AiProvider,
  usage: UsageSnapshot,
): UsageCapture => {
  const providerUsage = provider === "claude" ? usage.claude : usage.codex;
  return {
    provider,
    capturedAt: usage.updatedAt,
    windows: providerUsage.windows.map((window) => ({ ...window })),
  };
};

const isWithinAutomationHours = (allowedHours: AutomationConstraints["allowedHours"]): boolean => {
  if (!allowedHours) {
    return true;
  }

  const start = Math.max(0, Math.min(23, allowedHours.startHour));
  const end = Math.max(0, Math.min(23, allowedHours.endHour));
  const currentHour = new Date().getHours();
  if (start === end) {
    return true;
  }
  if (start < end) {
    return currentHour >= start && currentHour < end;
  }
  return currentHour >= start || currentHour < end;
};

const shouldAutomationValidateUpdate = (session: AgentSession, update: VersionUpdate): boolean => {
  if (session.validationFrequency === "every-update") {
    return true;
  }
  const text = `${update.title} ${update.description}`.toLowerCase();
  return /(ui|visual|screen|page|layout|style|css|component|frontend|render)/.test(text);
};

const resolveAutomationValidationType = (update: VersionUpdate): RunValidationInput["validationType"] => {
  const text = `${update.title} ${update.description}`.toLowerCase();
  return /(ui|visual|screen|page|layout|style|css|component|frontend|render)/.test(text)
    ? "visual"
    : "functional";
};

const clipMemoryText = (value: string, maxLength: number): string => {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

const buildToddHandoffSummary = (notes: string[]): string => {
  const normalized = mergeTrimmedNotes(notes);
  if (normalized.length === 0) {
    return "Creative handoff from Dan.";
  }

  const summary = normalized
    .slice(0, 3)
    .map((note) => clipMemoryText(note, 120))
    .join(" | ");
  return normalized.length > 3 ? `${summary} | +${normalized.length - 3} more` : summary;
};

const buildToddHandoffPackage = (
  notes: string[],
  context: string | null,
): ToddMemory["pendingHandoff"] | null => {
  const rawInputs = mergeTrimmedNotes(notes);
  if (rawInputs.length === 0) {
    return null;
  }

  return {
    summary: buildToddHandoffSummary(rawInputs),
    rawInputs,
    context: context ?? "Creative session handoff",
    receivedAt: new Date().toISOString(),
  };
};

const formatToddPendingHandoffPrompt = (
  pendingHandoff: ToddMemory["pendingHandoff"],
): string => {
  if (!pendingHandoff) {
    return "";
  }

  const excerpt = pendingHandoff.rawInputs
    .slice(0, 3)
    .map((input) => `- ${clipMemoryText(input, 180)}`)
    .join("\n");
  const moreCount = pendingHandoff.rawInputs.length - Math.min(pendingHandoff.rawInputs.length, 3);
  const moreLine = moreCount > 0 ? `\n- ...and ${moreCount} more handoff note(s)` : "";

  return `\nLegacy Dan Handoff:\nSummary: ${pendingHandoff.summary}\nContext: ${pendingHandoff.context}\nKey notes:\n${excerpt}${moreLine}\nReceived: ${pendingHandoff.receivedAt}\n\nTreat this as Todd soft memory that still needs manual processing.\n`;
};

const formatToddSoftMemoryPrompt = (
  softMemory: TaggedNote[] | null | undefined,
  pendingHandoff: ToddMemory["pendingHandoff"],
): string => {
  const softMemoryLines = (softMemory ?? [])
    .map((note) => `- ${clipMemoryText(note.content, 220)}`);
  const legacySection = formatToddPendingHandoffPrompt(pendingHandoff);
  if (softMemoryLines.length === 0) {
    return legacySection;
  }

  return `\nTodd Soft Memory (manual processing required):\n${softMemoryLines.join("\n")}\n${legacySection}`;
};

const archiveToddPendingHandoff = (
  session: AgentSession,
  reason: string,
): void => {
  const pendingHandoff = session.toddMemory.pendingHandoff;
  if (!pendingHandoff) {
    return;
  }

  const timestamp = new Date().toISOString();
  const archivedNotes = [
    `[${timestamp} | ${reason}] Handoff summary: ${pendingHandoff.summary}`,
    `[${timestamp} | ${reason}] Handoff context: ${pendingHandoff.context}`,
    ...pendingHandoff.rawInputs.map((input) => `[${timestamp} | ${reason}] Handoff raw: ${input}`),
  ];
  session.toddMemory.backupNotes = mergeTaggedNotes(session.toddMemory.backupNotes ?? [], archivedNotes, "likely-backup");
};

const consumeToddPendingHandoff = (
  session: AgentSession,
  reason: string,
): boolean => {
  if (!session.toddMemory.pendingHandoff) {
    return false;
  }

  archiveToddPendingHandoff(session, reason);
  session.toddMemory.pendingHandoff = null;
  return true;
};

const summarizeDanDraftIdealState = (
  draftState: AgentCoreDetails,
  explicitIdealState?: string | null,
): string | null => explicitIdealState ?? ([
  draftState.function?.summary ? `Function: ${draftState.function.summary}` : null,
  draftState.thesis?.summary ? `Thesis: ${draftState.thesis.summary}` : null,
  draftState.corePillars.length > 0 ? `Pillars: ${draftState.corePillars.map((pillar) => pillar.name).join(", ")}` : null,
  draftState.fullFlow?.summary ? `Full-flow: ${draftState.fullFlow.summary}` : null,
].filter(Boolean).join(" | ") || null);

const buildDanDraftCoreDetailsState = (
  session: AgentSession,
  draft: DanAgentChatDraftCoreDetails,
): AgentCoreDetails => {
  const draftSource = getDanDraftSourceConcept(session);
  const seedPillars = draftSource?.corePillars?.length
    ? draftSource.corePillars
    : session.corePillars;
  const existingPillarsByName = collectExistingPillarsByName(seedPillars);
  const pillarsByName = new Map<string, CorePillar>();
  const parentByName = new Map<string, string | null>();
  const connectionsByName = new Map<string, string[]>();

  for (const draftPillar of [...draft.pillars].sort((left, right) => left.order - right.order)) {
    const key = draftPillar.name.trim().toLowerCase();
    if (!key || pillarsByName.has(key)) {
      continue;
    }

    const existing = existingPillarsByName.get(key);
    pillarsByName.set(key, {
      id: existing?.id ?? randomUUID(),
      name: draftPillar.name.trim(),
      pillarType: normalizeDanPillarType(draftPillar.pillarType),
      function: createDraftDetail(draftPillar.function),
      thesis: createDraftDetail(draftPillar.thesis),
      corePillars: [],
      fullFlow: createDraftDetail(draftPillar.fullFlow),
      description: draftPillar.description ?? existing?.description ?? null,
      connectedPillarIds: [],
      assumptionText: draftPillar.assumptionText,
      assumptionSource: draftPillar.assumptionSource,
      order: draftPillar.order,
      threadMemberships: (draftPillar as unknown as Record<string, unknown>).threadMemberships as CorePillar["threadMemberships"] ?? existing?.threadMemberships ?? [],
      endState: (draftPillar as unknown as Record<string, unknown>).endState as CorePillar["endState"] ?? existing?.endState ?? null,
    });
    parentByName.set(
      key,
      draftPillar.parentName ? draftPillar.parentName.trim().toLowerCase() : null,
    );
    connectionsByName.set(
      key,
      draftPillar.connectedPillarNames.map((name) => name.trim().toLowerCase()).filter(Boolean),
    );
  }

  const roots: CorePillar[] = [];
  for (const [key, pillar] of pillarsByName.entries()) {
    const parentKey = parentByName.get(key);
    const parent = parentKey ? pillarsByName.get(parentKey) : null;
    if (parent && parent.id !== pillar.id) {
      parent.corePillars.push(pillar);
      continue;
    }
    roots.push(pillar);
  }

  for (const [key, pillar] of pillarsByName.entries()) {
    const connectedIds = (connectionsByName.get(key) ?? [])
      .map((name) => pillarsByName.get(name)?.id ?? null)
      .filter((id): id is string => Boolean(id));
    pillar.connectedPillarIds = Array.from(new Set(connectedIds));
  }

  const sortedRoots = sortNestedPillarsByOrder(roots);
  return {
    function: draft.function ? { summary: draft.function, status: "edited" } : null,
    thesis: draft.thesis ? { summary: draft.thesis, status: "edited" } : null,
    corePillars: sortedRoots,
    fullFlow: draft.fullFlow ? { summary: draft.fullFlow, status: "edited" } : null,
    threads: ((draft as unknown as Record<string, unknown>).threads as PillarThread[]) ?? draftSource?.threads ?? [],
  };
};

const applyDanDraftCoreDetailsToSession = (
  session: AgentSession,
  draftState: AgentCoreDetails,
): void => {
  if (draftState.function?.summary) {
    session.stages.function.confirmed = {
      ...draftState.function,
      status: "confirmed",
    };
  }
  if (draftState.thesis?.summary) {
    session.stages.thesis.confirmed = {
      ...draftState.thesis,
      status: "confirmed",
    };
  }
  if (draftState.fullFlow?.summary) {
    session.stages.full_flow.confirmed = {
      ...draftState.fullFlow,
      status: "confirmed",
    };
  }
  if (draftState.corePillars.length > 0) {
    session.corePillars = sortNestedPillarsByOrder(
      draftState.corePillars.map((pillar) => clonePillarWithStatus(pillar, "confirmed")),
    );
    session.stages.core_pillars.confirmed = {
      summary: `${session.corePillars.length} top-level pillar(s): ${session.corePillars.map((pillar) => pillar.name).join(", ")}`,
      status: "confirmed",
    };
  }
};

function formatCoreDetails(session: AgentSession | null): string {
  if (!session) return "";
  const concept = session.danMemory?.confirmedConcept ?? buildConfirmedConceptFromSession(session);
  const fn = concept?.function?.summary ?? null;
  const th = concept?.thesis?.summary ?? null;
  const cp = concept?.corePillars?.length
    ? [...concept.corePillars].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((pillar) => pillar.name).join(", ")
    : null;
  const ff = concept?.fullFlow?.summary ?? session.danMemory?.fullExperienceDescription ?? null;
  if (!fn && !th && !cp && !ff) return "";
  return [
    "Project core details:",
    fn && `- Function: ${fn}`,
    th && `- Thesis: ${th}`,
    cp && `- Core pillars: ${cp}`,
    ff && `- Full-flow: ${ff}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatScopedCoreDetails(
  session: AgentSession,
  opts: {
    confirmedOnly?: boolean;
    relevantPillarIds?: string[];
    includeCurrent?: boolean;
    includeIdeal?: boolean;
  } = {},
): string {
  const { confirmedOnly = true, relevantPillarIds, includeCurrent = false, includeIdeal = true } = opts;
  const parts: string[] = [];

  const concept = includeIdeal
    ? (session.danMemory?.confirmedConcept ?? buildConfirmedConceptFromSession(session))
    : null;
  const fn = concept?.function ?? session.stages.function.confirmed;
  const th = concept?.thesis ?? session.stages.thesis.confirmed;
  const ff = concept?.fullFlow ?? session.stages.full_flow.confirmed;

  if (fn && (!confirmedOnly || fn.status !== "assumed")) parts.push(`- Function: ${fn.summary}`);
  if (th && (!confirmedOnly || th.status !== "assumed")) parts.push(`- Thesis: ${th.summary}`);
  if (ff && (!confirmedOnly || ff.status !== "assumed")) parts.push(`- Full-flow: ${ff.summary}`);

  if (includeIdeal && concept?.corePillars?.length) {
    let pillars = [...concept.corePillars].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (relevantPillarIds?.length) pillars = pillars.filter((p) => relevantPillarIds.includes(p.id));
    if (confirmedOnly) {
      pillars = pillars.filter((pillar) => {
        const statuses = [pillar.function?.status, pillar.thesis?.status, pillar.fullFlow?.status].filter(Boolean);
        return statuses.length === 0 || statuses.every((status) => status !== "assumed");
      });
    }
    if (pillars.length > 0) {
      parts.push(`Ideal core pillars: ${pillars.map((p) => `${p.name} (${p.function?.summary ?? "TBD"})`).join(", ")}`);
    }
  }

  if (includeCurrent && session.toddMemory?.codebaseIndexedMap?.featureAreas.length) {
    parts.push(`Current codebase areas: ${session.toddMemory.codebaseIndexedMap.featureAreas.join(", ")}`);
  }

  return parts.length > 0 ? `Project core details:\n${parts.join("\n")}` : "";
}

function formatConceptItems(pillars: CorePillar[], depth = 0): string[] {
  const lines: string[] = [];
  for (const pillar of sortPillarsByOrder(pillars)) {
    const indent = "  ".repeat(depth);
    lines.push(`${indent}- ${pillar.name}`);
    if (pillar.function?.summary) lines.push(`${indent}  Function: ${pillar.function.summary}`);
    if (pillar.thesis?.summary) lines.push(`${indent}  Thesis: ${pillar.thesis.summary}`);
    if (pillar.fullFlow?.summary) lines.push(`${indent}  Experience: ${pillar.fullFlow.summary}`);
    if (pillar.description) lines.push(`${indent}  Notes: ${pillar.description}`);
    if (pillar.corePillars.length > 0) {
      lines.push(...formatConceptItems(pillar.corePillars, depth + 1));
    }
  }
  return lines;
}

function computePillarEndStateLabel(pillar: CorePillar): string {
  if (pillar.corePillars.length > 0) return "NESTED";
  if (pillar.endState === "end") return "END";
  return "TBD";
}

function formatDanHardMemoryPillarTree(pillars: CorePillar[], depth = 0): string[] {
  const lines: string[] = [];
  for (const pillar of sortPillarsByOrder(pillars)) {
    const indent = "  ".repeat(depth);
    const typeLabel = pillar.pillarType === "side" ? " [side]"
      : pillar.pillarType === "ghost" ? " [ghost]"
      : "";
    const assumptionFlag = pillar.assumptionSource === "dan" ? " (assumption)" : "";
    const endLabel = ` [${computePillarEndStateLabel(pillar)}]`;
    const threadNames = (pillar.threadMemberships ?? []).map((tm) => tm.threadName);
    const threadLabel = threadNames.length > 0 ? ` [threads: ${threadNames.join(", ")}]` : "";
    lines.push(`${indent}- ${pillar.name}${typeLabel}${endLabel}${threadLabel}${assumptionFlag}`);
    if (pillar.function?.summary) lines.push(`${indent}  Function: ${pillar.function.summary}`);
    if (pillar.thesis?.summary) lines.push(`${indent}  Thesis: ${pillar.thesis.summary}`);
    if (pillar.description) lines.push(`${indent}  Notes: ${pillar.description}`);
    if (threadNames.length > 0) {
      for (const tm of pillar.threadMemberships ?? []) {
        if (tm.role) lines.push(`${indent}  Thread "${tm.threadName}" role: ${tm.role}`);
      }
    }
    if (pillar.corePillars.length > 0) {
      lines.push(...formatDanHardMemoryPillarTree(pillar.corePillars, depth + 1));
    }
  }
  return lines;
}

function formatDanHardMemory(session: AgentSession): string {
  const concept = session.danMemory?.confirmedConcept ?? buildConfirmedConceptFromSession(session);
  const parts: string[] = [];

  if (concept?.function?.summary) parts.push(`Function: ${concept.function.summary}`);
  if (concept?.thesis?.summary) parts.push(`Thesis: ${concept.thesis.summary}`);

  if (concept?.corePillars?.length) {
    parts.push("Core Pillar Tree:");
    parts.push(...formatDanHardMemoryPillarTree(concept.corePillars));
  }

  const threads = concept?.threads ?? session.danMemory?.threads ?? [];
  if (threads.length > 0) {
    parts.push("Threads:");
    for (const thread of threads) {
      parts.push(`- ${thread.name}${thread.description ? `: ${thread.description}` : ""}`);
    }
  }

  if (concept?.fullFlow?.summary) {
    parts.push(`Full-Flow: ${concept.fullFlow.summary}`);
  } else if (session.danMemory?.fullExperienceDescription) {
    parts.push(`Full-Flow: ${session.danMemory.fullExperienceDescription}`);
  }

  return parts.length > 0
    ? `Hard Memory (Ideal Creative Truth):\n${parts.join("\n")}`
    : "Hard Memory (Ideal Creative Truth):\n- None yet.";
}

function formatDanCoreDetailsSnapshot(label: string, concept: AgentCoreDetails | null): string {
  if (!concept) {
    return `${label}:\n- None yet.`;
  }

  const parts: string[] = [];
  if (concept.function?.summary) parts.push(`- Function: ${concept.function.summary}`);
  if (concept.thesis?.summary) parts.push(`- Thesis: ${concept.thesis.summary}`);
  if (concept.corePillars.length > 0) {
    parts.push("Concept structure:");
    parts.push(...formatConceptItems(concept.corePillars));
  }
  if (concept.fullFlow?.summary) parts.push(`- Full-flow: ${concept.fullFlow.summary}`);

  return parts.length > 0 ? `${label}:\n${parts.join("\n")}` : `${label}:\n- None yet.`;
}

function formatDanDraftCoreDetails(draft: AgentCoreDetails | null): string {
  return formatDanCoreDetailsSnapshot("Discussed Soft Memory", draft);
}

function formatDanDerivedCoreDetails(derived: AgentCoreDetails | null): string {
  return formatDanCoreDetailsSnapshot("Derived Soft Memory (from project refresh)", derived);
}

function buildDanFocusHint(): string {
  return "Synthesize proactively — follow the user's flow, lock concept details when they emerge, and brainstorm freely when the user is exploring.";
}

function formatDanBackupMemoryForRecall(currentMessage: string, session: AgentSession): string {
  if (!isDanRecallMessage(currentMessage)) return "";
  const sections: string[] = [];

  // Priority 2: Raw Memories
  const rawMemories = session.danMemory?.rawMemories ?? [];
  if (rawMemories.length > 0) {
    const relevantRaw = selectRelevantDanSideNotes(currentMessage, rawMemories.map((m) => m.content));
    if (relevantRaw.length > 0) {
      sections.push(`Back-up: Raw Memories (user inputs tied to pillars):\n${relevantRaw.map((note) => `- ${note}`).join("\n")}`);
    }
  }

  // Priority 3: Forgotten Memories
  const forgottenMemories = session.danMemory?.forgottenMemories ?? [];
  const legacySideNotes = session.danSideNotes ?? [];
  const allForgotten = [...forgottenMemories, ...legacySideNotes];
  if (allForgotten.length > 0) {
    const relevantForgotten = selectRelevantDanSideNotes(currentMessage, allForgotten);
    if (relevantForgotten.length > 0) {
      sections.push(`Back-up: Forgotten Memories (lower priority, from past sessions):\n${relevantForgotten.map((note) => `- ${note}`).join("\n")}`);
    }
  }

  if (sections.length === 0) {
    sections.push("Back-up Memory: No matching memories found in Raw or Forgotten memories.");
  }

  return `\n${sections.join("\n\n")}`;
}

function buildDanSharedPrompt(args: {
  projectName: string;
  session: AgentSession;
  focusMode: DirectorFocusMode | null;
  surface: "dm" | "slack";
  conversationSection: string;
  currentMessage: string;
}): string {
  const { projectName, session, focusMode, surface, conversationSection, currentMessage } = args;
  const hardMemorySection = formatDanHardMemory(session);
  const draftContext = formatDanDraftCoreDetails(session.danMemory?.draftConcept ?? session.danDraftCoreDetails);
  const derivedContext = formatDanDerivedCoreDetails(session.danMemory?.derivedConcept ?? null);
  const softNotes = session.danMemory?.notes ?? [];
  const softNotesSection = softNotes.length > 0
    ? `Discussed Support Notes:\n${softNotes.map((note) => `- ${typeof note === "string" ? note : note.content}`).join("\n")}`
    : "Discussed Support Notes:\n- None yet.";
  const derivedNotes = session.danMemory?.derivedNotes ?? [];
  const derivedNotesSection = derivedNotes.length > 0
    ? `Derived Support Notes:\n${derivedNotes.map((note) => `- ${typeof note === "string" ? note : note.content}`).join("\n")}`
    : "Derived Support Notes:\n- None yet.";
  const toddHandoffNotes = session.danMemory?.toddHandoffNotes ?? [];
  const toddHandoffSection = toddHandoffNotes.length > 0
    ? `\nTodd-Bound Handoff Notes (planning items to pass to Todd):\n${toddHandoffNotes.map((note) => `- ${typeof note === "string" ? note : note.content}`).join("\n")}`
    : "";
  const backupSection = formatDanBackupMemoryForRecall(currentMessage, session);
  const surfaceHint = surface === "slack"
    ? "You are replying in the team Slack flow. Jeff may still coordinate overall, but this turn is yours. Stay present unless you are explicitly stepping out."
    : "You are replying in a direct DM with the user. Always respond as Dan on this surface.";

  return `You are Dan, the Creative Director for "${projectName}".
You are the ideal creative hierarchy architect — a strong creative partner, not a passive questionnaire.
You define, refine, restructure, and preserve the project's ideal creative hierarchy.
You do NOT hold current-state or implementation understanding. Only the ideal creative truth.

Core operating rules:
- Continuously synthesize the user's ideas into a private working draft of the project's core-details.
- Lock down the global core-details first: Function, Thesis, the main concept areas (pillars), and the Full-Flow.
- Work one unresolved part of the idea at a time. If the user jumps, switch immediately and keep the earlier thread recoverable.
- If the user adds detail while ignoring your question, still capture it and place it under the right part of the idea.
- Keep "notesToAppend" lean and durable. These are Discussed soft-memory notes that persist until the user confirms hard memory.
- Use "rawMemoriesToAppend" to capture important raw user inputs and link them to relevant pillars by name. These persist as back-up memory.
- Ask questions only when they materially sharpen the concept. Be minimalist and guide where the user is already going.
- While gathering, prefer compact "draftOperations" that update the existing working draft instead of re-sending the full draft snapshot.
- Use "draftCoreDetails" only when you are ready to confirm the full synthesized draft, or when a full rebuild is genuinely necessary.
- Do not write draft changes into confirmed project state directly from conversation.
- Treat Discussed soft memory as stronger than Derived refresh memory. Derived memory is advisory current-state context until the user confirms a synthesis into hard memory.
- Keep assumptions internal while gathering. Do not present them piecemeal. Mark assumptions clearly with assumptionSource and assumptionText.
- When you reach a natural stopping point and the user has nothing else to add, set "conversationStatus" to "ready-to-confirm".
- In that ready state, include the full "draftCoreDetails". "response" should present the synthesized update, name what changed in concise terms, and ask the user to confirm.
- Fill "draftChangeSummary" with concise change bullets whenever the working draft changed.
- Use unique pillar names across the whole draft so they can be reconnected safely.
- Always set "currentState" to null. You do not track implementation state.
- "handoffTo" should be null unless another director truly needs to act next.
- Set "presenceAction" to "stay" unless you are explicitly stepping out.
- When you reach a natural pause in concept work, end your response with a brief completion line: "[Done: <1-sentence summary of what you explored or settled and any next step>]"
- Recognize when the user mentions roadmap thinking, build-order logic, implementation sequencing, dependency logic, or "first do X then Y then Z". These belong to Todd's world.
- Use "toddHandoffNotesToAppend" to capture these Todd-bound planning observations. Do NOT store them in "notesToAppend". They will be packaged and handed to Todd only when the user confirms hard memory.
- Continue the creative conversation normally — do not ignore Todd-bound information, just route it correctly.

Creative hierarchy management:
- You can restructure the hierarchy at any time: move, merge, split, retitle, or reword pillars.
- Core Pillars form the main timeline (the one experienced sequence — the linear flow).
- Side Pillars are ideas likely to be added but with uncertain placement. They can optionally be bounded between two main timeline points.
- Ghost Pillars are ideas worth keeping but would cause major ripple effects if integrated into the main timeline.
- Full-Flow is simply the full core-pillar tree described plainly in words from beginning to end. It is derived from the pillar structure, not a separate creative system.
- Each pillar appears in the linear flow where the user/audience encounters it, placed in order once within that sequence.

Pillar split logic:
- A pillar stays single when it behaves like one fused discussable unit and splitting would not improve clarity.
- Split into sub-pillars when the parts need separate reasoning because they have their own: function, thesis, thread membership, future changes, dependencies, or need for independent discussion.
- Bias toward clarity and modularity, not arbitrary splitting.
- When splitting, the parent retains a coherent function/thesis that encompasses all children.

Upward parent propagation:
- Whenever a nested pillar is added or updated, check whether that information is properly represented in every parent above it.
- The direct parent gets the most noticeable refinement.
- Each parent above gets a subtler refinement.
- All the way up to the root parent pillar.
- The deeper detail must not stay isolated — it should slightly reshape the wording/meaning of the larger parents while preserving the consistent higher-level thesis.
- Keep the whole conceptual chain reactive and coherent upward.

Thread management:
- Classify each pillar into one or more threads. Threads are recurring grouped logic distributed across the linear flow, escalating and building over time.
- One pillar can belong to multiple threads.
- Use "upsert_thread" to create or rename threads. Use "delete_thread" to remove them.
- When upserting a pillar, include "threadMemberships" to assign thread roles (threadName + the pillar's role within that thread).
- Maintain thread coherence: each thread should have a clear escalation arc across its member pillars.

End-state classification:
- Each pillar is classified as NESTED (has sub-pillars — automatic), END (user confirms nothing more needed), or TBD (more specificity needed later).
- You only set "end" or "tbd" via endState in upsert_pillar. NESTED is automatic when children exist.
- Estimate closure internally from 0 to 1. At low closure, ask the single highest-value narrowing question. Near 1, ask: "Anything else beyond this point?"
- The user confirms whether a pillar becomes END or stays TBD. Do not silently finalize important pillars.

Multi-level meaning:
- Each pillar stores: local function, local thesis, place in linear flow, thread membership, and role within each thread.
- Maintain series-level meaning at higher levels: pillar-level function/thesis, parent-pillar / nested-series function/thesis, thread-series function/thesis, and the larger project-role of those series.
- Keep the whole conceptual system coherent across all levels.

Every time you update hard memory:
1. Store the new or revised pillar info
2. Determine whether the pillar should remain single or split into sub-pillars
3. Classify the pillar into thread(s)
4. Update linear-flow placement if needed
5. Update local function and thesis
6. Update thread role(s)
7. Propagate necessary function/thesis refinements upward through all parent pillars
8. Classify the pillar ending as END, TBD, or automatically NESTED if children exist

Memory retrieval priority (when the user asks "do you remember..."):
1. Hard Memory first (confirmed pillar tree below)
2. Raw Memories second (back-up of user inputs that informed pillars)
3. Forgotten Memories third (items from past sessions not promoted to Hard Memory)
4. If nothing found in any layer, say it was not discussed

${surfaceHint}
${buildDanFocusHint()}

${hardMemorySection}
${draftContext}
${derivedContext}
${softNotesSection}
${derivedNotesSection}${toddHandoffSection}
${backupSection}
${conversationSection}
${buildAgentChatResponseContract("creative-director", "codebase-analysis")}`.trim();
}

function buildAssumedStateSummary(session: AgentSession): string {
  const items: string[] = [];

  // Assumed pillars
  for (const p of session.corePillars) {
    if (p.function?.status === "assumed") items.push(`Pillar "${p.name}" function is assumed`);
    if (p.thesis?.status === "assumed") items.push(`Pillar "${p.name}" thesis is assumed`);
    if (p.assumptionText && p.assumptionSource === "dan") items.push(`Pillar "${p.name}" has Dan's assumption: "${p.assumptionText}"`);
  }

  // Assumed stage confirmations
  for (const stage of ["function", "thesis", "core_pillars", "full_flow"] as const) {
    const conf = session.stages[stage].confirmed;
    if (conf?.status === "assumed") items.push(`${stage} confirmation is assumed`);
  }

  // Director assumptions from state map
  for (const [dId, ds] of Object.entries(session.directorStateMap ?? {})) {
    if (ds && ds.assumptions.length > 0) {
      items.push(`${DIRECTOR_NAMES[dId as DirectorId]} has ${ds.assumptions.length} assumption(s): ${ds.assumptions.join("; ")}`);
    }
  }

  // Assumed feasibility assessments
  for (const a of session.feasibilityAssessments) {
    if (a.status === "assumed") items.push(`Feasibility "${a.area}" is assumed`);
  }

  // Assumed version plans
  for (const v of session.versions) {
    if (v.status === "assumed") items.push(`Version "${v.label}" is assumed`);
  }

  for (const approval of session.pendingApprovals ?? []) {
    items.push(`Pending confirmation: ${approval.summary}`);
  }

  if (items.length === 0) return "";
  return `\nAssumed items across the project (not yet confirmed):\n${items.map((i) => `- ${i}`).join("\n")}\n`;
}

async function readMaterialContents(paths: string[]): Promise<string> {
  const results: string[] = [];
  for (const filePath of paths) {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const baseName = filePath.split("/").pop() ?? filePath;
    if (["txt", "md", "json", "csv", "html", "xml", "ts", "tsx", "js", "jsx"].includes(ext)) {
      try {
        const content = await readTextFile(filePath);
        results.push(`--- File: ${baseName} ---\n${content.slice(0, 8000)}`);
      } catch {
        results.push(`--- File: ${baseName} (could not read) ---`);
      }
    } else {
      results.push(`--- File: ${baseName} (binary, .${ext}) ---\n[File attached but content not directly readable]`);
    }
  }
  return results.join("\n\n");
}

function formatUnifiedConversation(session: AgentSession, maxMessages = 30): string {
  const msgs = session.unifiedMessages.slice(-maxMessages);
  if (msgs.length === 0) return "";
  return `\nConversation so far:\n${msgs.map((m) =>
    `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
  ).join("\n\n")}\n`;
}

// Legacy fallback for sessions without unified messages
function formatCrossStageMessages(session: AgentSession, stage: AgentStage): string {
  // If unified messages exist, use those
  if (session.unifiedMessages.length > 0) {
    return formatUnifiedConversation(session);
  }

  const formatMessages = (msgs: AgentSession["stages"]["function"]["messages"], label: string): string => {
    if (msgs.length === 0) return "";
    return `\n--- ${label} conversation ---\n${msgs.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")}\n`;
  };

  if (stage === "function") {
    const msgs = session.stages.function.messages.slice(-10);
    return msgs.length > 0
      ? `\nConversation so far:\n${msgs.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")}\n`
      : "";
  }

  if (stage === "thesis") {
    const funcMsgs = session.stages.function.messages.slice(-5);
    const thesisMsgs = session.stages.thesis.messages.slice(-10);
    return formatMessages(funcMsgs, "Function") + formatMessages(thesisMsgs, "Thesis");
  }

  if (stage === "core_pillars") {
    const funcMsgs = session.stages.function.messages.slice(-3);
    const thesisMsgs = session.stages.thesis.messages.slice(-5);
    const cpMsgs = session.stages.core_pillars.messages.slice(-10);
    return formatMessages(funcMsgs, "Function") + formatMessages(thesisMsgs, "Thesis") + formatMessages(cpMsgs, "Core Pillars");
  }

  if (stage === "full_flow") {
    const funcMsgs = session.stages.function.messages.slice(-3);
    const thesisMsgs = session.stages.thesis.messages.slice(-3);
    const cpMsgs = session.stages.core_pillars.messages.slice(-5);
    const flowMsgs = session.stages.full_flow.messages.slice(-10);
    return formatMessages(funcMsgs, "Function") + formatMessages(thesisMsgs, "Thesis") + formatMessages(cpMsgs, "Core Pillars") + formatMessages(flowMsgs, "Full-Flow");
  }

  const msgs = session.stages.iterations?.messages.slice(-10) ?? [];
  return msgs.length > 0
    ? `\nConversation so far:\n${msgs.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")}\n`
    : "";
}

async function buildAgentStagePrompt(
  stage: AgentStage,
  projectName: string,
  session: AgentSession,
  repoHints?: string,
): Promise<string> {
  const confirmedContext: string[] = [];
  const fc = session.stages.function.confirmed;
  if (fc) confirmedContext.push(`Function: ${fc.summary}`);
  const tc = session.stages.thesis.confirmed;
  if (tc) confirmedContext.push(`Thesis: ${tc.summary}`);
  const cpc = session.stages.core_pillars.confirmed;
  if (cpc) confirmedContext.push(`Core Pillars: ${cpc.summary}`);
  if (session.corePillars.length > 0) {
    const pillarSummary = session.corePillars.map((p) =>
      `- ${p.name}: ${p.function?.summary ?? "TBD"}`
    ).join("\n");
    confirmedContext.push(`Pillar Details:\n${pillarSummary}`);
  }
  const ff = session.stages.full_flow.confirmed;
  if (ff) {
    confirmedContext.push(`Full-Flow: ${ff.summary}`);
    if (ff.currentState) confirmedContext.push(`Current State: ${ff.currentState}`);
    if (ff.finalGoal) confirmedContext.push(`Final Goal: ${ff.finalGoal}`);
  }
  const ic = session.stages.iterations.confirmed;
  if (ic) confirmedContext.push(`Iterations: ${ic.summary}`);

  const priorContext = confirmedContext.length > 0
    ? `\nPreviously confirmed context:\n${confirmedContext.join("\n")}\n`
    : "";

  // Cross-stage conversation context for unified flow
  const conversationContext = formatCrossStageMessages(session, stage);

  // Material context
  let materialContext = "";
  if (session.attachedMaterials.length > 0) {
    const contents = await readMaterialContents(session.attachedMaterials);
    materialContext = `\nAttached materials:\n${contents}\n`;
  }

  const stageInstructions: Record<AgentStage, string> = {
    function: `You are guiding a user through defining what their software program "${projectName}" does.
Your goal: produce a clear, concise summary of the program's core function.
Ask clarifying questions to understand:
- What problem does it solve?
- Who uses it?
- What are the main actions a user can perform?
When you have enough information, set confirmationSuggested to true and provide a 2-3 sentence summary in suggestedSummary. Be concise, bold, and direct rather than overly safe or subtle.`,

    thesis: `You are guiding a user through articulating WHY their program "${projectName}" matters.
You are continuing from the Function conversation. The user has already defined what the program does.
Your goal: produce a concise thesis statement explaining why this program exists and what makes it valuable.
Ask clarifying questions about:
- What motivated building this?
- What's the unique value or insight?
- Who benefits most and why?
When ready, set confirmationSuggested to true with a 1-2 sentence thesis in suggestedSummary. Be concise, bold, and direct.`,

    core_pillars: `You are guiding a user through identifying the Core Pillars of "${projectName}".
You are continuing from the Function and Thesis conversations. The user has already defined what the program does and why it matters.
Your goal: identify the 3-7 major enduring pillars (features, capabilities, or domains) that define this product.
Each pillar should be:
- A major capability or feature area that is central to the product
- Enduring (not a one-time task, but something the product will always have)
- Distinct from other pillars (minimal overlap)

Ask clarifying questions to identify these pillars. Listen for explicit sub-pillars the user describes — these should become nested children of the relevant pillar.

For each pillar, be prepared to identify:
- Name (short label)
- Function (what it does)
- Thesis (why it matters)

When you have identified the major pillars, set confirmationSuggested to true with a summary listing all identified pillar names in suggestedSummary. Be concise, bold, and direct.`,

    full_flow: `You are guiding a user through mapping the complete product flow of "${projectName}".
You are continuing from the Function, Thesis, and Core Pillars conversations. The user has defined what the program does, why it matters, and its major building blocks.
${session.corePillars.length > 0 ? `\nConfirmed Core Pillars: ${session.corePillars.map((p) => p.name).join(", ")}\n` : ""}
Your goal: string those Core Pillars together into a beginning-to-end user experience — the ideal product flow.
The Full-Flow should:
- Represent what the user experiences from start to finish
- Show how each Core Pillar fits into the overall journey
- Be ordered by user experience (not by technical implementation)
- Be structured as a sequence of clear steps, not a blob paragraph

Ask about:
- What does the user see first?
- How do they move through the product?
- Which pillars does each step involve?
- What does the ideal final experience look like?
When ready, set confirmationSuggested to true with a structured summary in suggestedSummary listing the flow steps in order (each step on its own line). Be concise and direct.`,

    iterations: `You are the iteration agent for "${projectName}".
Your role: compare the confirmed conceptual flow against the current codebase, and plan a sequence of achievable updates that will move the project from its current state to the desired state.
${repoHints ? `\nCurrent codebase analysis:\n${repoHints}\n` : ""}
Each planned update should be:
- Scoped to be achievable in a single AI coding pass (by Claude or Codex)
- Conceptual enough that an execution agent can plan the specific code changes
- Ordered by dependency and priority (foundational changes first)

Current to-do items: ${session.scratchpad.filter((s) => !s.completed).map((s) => `- [${s.source}] ${s.text}`).join("\n") || "(none)"}
Current planned updates: ${session.plannedUpdates.map((u, i) => `${i + 1}. ${u.title}: ${u.description}`).join("\n") || "(none)"}

Help the user refine and reorder updates. When satisfied, set confirmationSuggested to true with a brief summary in suggestedSummary.`,

    execution: `You are the execution agent for "${projectName}".
Your role: take the planned updates and help the user execute them one at a time.
Each planned update will be sent to the program's codebase for implementation.
Help the user review results, troubleshoot issues, and decide when to move to the next update.
When all planned updates are complete, set confirmationSuggested to true with a brief completion summary.`,
  };

  return `${stageInstructions[stage]}
${materialContext}${priorContext}${conversationContext}
Your response must be ONLY strict JSON (no markdown fences):
{"response": string, "confirmationSuggested": boolean, "suggestedSummary": string | null}
- "response" is your conversational reply to the user.
- "confirmationSuggested" is true only when you believe the stage is ready to be confirmed.
- "suggestedSummary" is a concise summary for confirmation (null if not suggesting confirmation).`.trim();
}

const buildProjectOutlinePrompt = ({
  project,
  repoHints,
}: {
  project: Project;
  repoHints: ProjectRepoHints;
}): string => `
You are analyzing a software project for a non-technical dashboard view.

Project: "${project.name}"
Current description: ${project.description}
Current runtime command: ${project.runtimeConfig.runCommand ?? "Unknown"}
Current open URL: ${project.runtimeConfig.openUrl ?? "Unknown"}

${formatProjectRepoHints(repoHints)}

Instructions:
- Explore the codebase in read-only mode.
- Do not change any files.
- Focus on plain-English explanations for a non-coder.
- For storedData, describe user-facing or app-managed data stores such as databases, JSON files, browser storage, uploaded assets, caches, and app-generated content.
- For connections, list external APIs, SDKs, hosted services, payment tools, auth providers, databases, and developer services that the code connects to.
- For costs, provide rough placeholder cost notes when the project appears to use a paid service. If exact pricing is unknown, say so clearly.
- For referencedEnvKeys, include any environment variables you see referenced in code or config.
- Return strict JSON only with this shape:
  {
    "storedData": [{ "label": string, "description": string, "children": [...] }],
    "connections": [{ "name": string, "kind": string, "description": string, "envKeys": string[] }],
    "costs": [{ "label": string, "amount": string | null, "description": string }],
    "referencedEnvKeys": string[]
  }
- Use empty arrays when nothing is detected.
`.trim();

function getSchemaForDirector(directorId: DirectorId, focusMode: DirectorFocusMode | null) {
  switch (directorId) {
    case "project-manager": return directorPmSchema;
    case "creative-director":
      return danAgentChatSchema;
    case "rd-director":
      if (focusMode === "research") return directorToddResearchSchema;
      return directorToddUpdateSchema;
    case "programming-director": return directorPingSchema;
    case "validation-director":
      if (focusMode === "identify-goal") return directorPongGoalSchema;
      if (focusMode === "test-current-state") return directorPongTestSchema;
      return directorPongCompareSchema;
  }
}

function formatDirectorStatus(session: AgentSession): string {
  const parts: string[] = [];
  const concept = session.danMemory?.confirmedConcept ?? buildConfirmedConceptFromSession(session);
  const fc = concept?.function ?? null;
  const tc = concept?.thesis ?? null;
  const cpc = concept?.corePillars?.length ? session.stages.core_pillars.confirmed ?? { summary: `${concept.corePillars.length} concept area(s)` } : null;
  const ffc = concept?.fullFlow ?? null;
  parts.push(`Dan (Creative): Function=${fc ? "confirmed" : "pending"}, Thesis=${tc ? "confirmed" : "pending"}, Pillars=${cpc ? "confirmed" : "pending"}, Flow=${ffc ? "confirmed" : "pending"}`);
  const futureUpdatePlan = session.toddMemory?.futureUpdatePlan ?? normalizeFutureUpdatePlan(session.versionUpdates ?? []);
  parts.push(`Todd (R&D): Codebase=${session.toddMemory?.codebaseIndexedMap ? "indexed" : "pending"}, CurrentState=${session.toddMemory?.currentState ? "set" : "none"}, SuccessChain=${(session.toddMemory?.successChain ?? []).length} step(s), NextUpdate=${session.toddMemory?.nextUpdate?.title ?? "none"}, Queue=${futureUpdatePlan.length} update(s)`);
  const progUpdates = futureUpdatePlan.filter((u) => u.status === "in_progress" || u.status === "completed");
  parts.push(`Ping (Programming): ${progUpdates.length > 0 ? progUpdates.length + " updates processed" : "waiting for approved updates"}`);
  parts.push(`Pong (Validation): ${session.validationResults.length > 0 ? session.validationResults.length + " results" : "no validations yet"}, Frequency=${session.validationFrequency}`);
  // Director state map summary
  const stateMap = session.directorStateMap ?? {};
  for (const [dId, ds] of Object.entries(stateMap)) {
    if (!ds) continue;
    const name = DIRECTOR_NAMES[dId as DirectorId] ?? dId;
    const cur = ds.currentState ? `Current: ${ds.currentState.slice(0, 100)}` : "";
    const goal = ds.idealState ? `Ideal: ${ds.idealState.slice(0, 100)}` : "";
    const assumCount = ds.assumptions.length > 0 ? `${ds.assumptions.length} assumption(s)` : "";
    const stateParts = [cur, goal, assumCount].filter(Boolean);
    if (stateParts.length > 0) parts.push(`${name} state: ${stateParts.join(", ")}`);
  }
  return parts.join("\n");
}

function buildAgentChatDirectorPrompt(
  directorId: DirectorId,
  projectName: string,
  session: AgentSession,
  opts: {
    mode?: AgentChatDirectorMode;
  } = {},
): string {
  const directorName = DIRECTOR_NAMES[directorId];
  const directorLabel = DIRECTOR_LABELS[directorId];
  const coreContext = formatCoreDetails(session);
  const statusContext = formatDirectorStatus(session);
  const mode = opts.mode ?? "codebase-analysis";
  const allowInternetResearch = directorId === "rd-director" && mode === "internet-research";
  const conversationSection = buildRecentAgentChatHistory(session);

  // Build director state context if available
  const directorState = session.directorStateMap?.[directorId];
  const stateContext = directorState
    ? `\nYour tracked state:\n- Current State: ${directorState.currentState ?? "(not yet mapped)"}\n- Ideal State: ${directorState.idealState ?? "(not yet defined)"}\n${directorState.assumptions.length > 0 ? `- Assumptions: ${directorState.assumptions.join("; ")}` : ""}\n`
    : "";

  if (directorId === "project-manager") {
    // Gather unconfirmed items for Jeff to surface
    const unconfirmedItems: string[] = [];
    for (const p of session.corePillars) {
      if (p.function?.status === "assumed") unconfirmedItems.push(`Pillar "${p.name}" function`);
      if (p.thesis?.status === "assumed") unconfirmedItems.push(`Pillar "${p.name}" thesis`);
      if (p.assumptionText && p.assumptionSource === "dan") unconfirmedItems.push(`Pillar "${p.name}" assumption: "${p.assumptionText}"`);
    }
    for (const [dId, ds] of Object.entries(session.directorStateMap ?? {})) {
      if (ds && ds.assumptions.length > 0) unconfirmedItems.push(`${DIRECTOR_NAMES[dId as DirectorId]} has ${ds.assumptions.length} unconfirmed assumption(s)`);
    }
    const unconfirmedSection = unconfirmedItems.length > 0
      ? `\nUnconfirmed items awaiting user review:\n${unconfirmedItems.map((i) => `- ${i}`).join("\n")}\nIf the user asks what needs confirmation, present these items clearly.\n`
      : "";

    const assumedSummary = buildAssumedStateSummary(session);

    return `You are Jeff, the Project Manager for "${projectName}".
You are in a team agent chat with the user and all directors.
You are the central coordinator. Your role:
- Handle general user conversation about the project
- If the user's request requires a specialist, set handoffTo to the appropriate director ID and explain why in handoffReason
- Route codebase scans, architecture assessment, backend review, and update-planning work to rd-director (Todd) as codebase analysis
- Route explicit external research, current web information, competitor checks, market checks, or latest-documentation checks to rd-director (Todd) as internet research
- If you can handle the message yourself, set handoffTo to null
- If the user asks "anything for me to confirm?" or similar, present unconfirmed items and guide them through confirmation
- Only confirmed information should move downstream for actual planning/building/testing
- Be conversational and collaborative
- When handing work to Todd, make the handoffReason explicit enough that PROGRAMS can tell whether this is codebase analysis or internet research

Valid director IDs for handoff (use the exact ID string, not the name):
- "creative-director" (Dan)
- "rd-director" (Todd) — also handles internet research

Current project status:
${statusContext}
${unconfirmedSection}${assumedSummary}
${coreContext}
${stateContext}
${conversationSection}
${buildAgentChatResponseContract(directorId, mode)}`;
  }

  if (directorId === "rd-director") {
    const toddCoreContext = formatScopedCoreDetails(session, { confirmedOnly: true, includeCurrent: true, includeIdeal: true });
    const toddPendingHandoff = formatToddPendingHandoffPrompt(session.toddMemory?.pendingHandoff ?? null);
    const toddNotesSection = (session.toddMemory?.notes ?? []).length > 0
      ? `\nPlanning Notes (working assumptions):\n${session.toddMemory!.notes.map((note) => `- ${typeof note === "string" ? note : note.content}`).join("\n")}`
      : "";
    return `You are Todd, the R&D Director for "${projectName}".
You are in a team agent chat. Your role:
- Analyze technical questions, repo architecture, update planning, best practices, and product direction
- ${allowInternetResearch
    ? "You have access to web search and web fetch tools for this turn — use them to find real, up-to-date information from the internet when needed"
    : "You do not have internet access for this turn. Focus on the repo, confirmed project context, and your codebase understanding. If live external research is needed, say so plainly and explain what should be researched next"}.
- Assess feasibility and make recommendations
- You plan from CURRENT confirmed state toward IDEAL confirmed state using the full main timeline flow and branch references as the roadmap skeleton
- Dan owns conceptual truth. Treat confirmed concept details as read-only source of truth from Dan.
- If the user changes conceptual goals, asks for creative reinterpretation, or exposes a concept gap, set handoffTo to "creative-director" and explain why.
- Provide a short conversational response in "response" (what appears in chat)
- ${allowInternetResearch
    ? 'Provide "generalSummary" and "projectSummary" only as external-research summaries for this turn.'
    : 'Do not use external web research summaries in this mode; keep the answer grounded in repo analysis and confirmed project context.'}
- Set handoffTo to null unless another director needs to act on your findings
- Use "notesToAppend" to store planning notes and working assumptions as soft memory. Use [] when nothing new should be stored.
- Be conversational and direct

Valid director IDs for handoff (use the exact ID string, not the name):
- "project-manager" (Jeff)
- "creative-director" (Dan)
- "programming-director" (Ping)
- "validation-director" (Pong)

Current project status:
${statusContext}

${toddCoreContext}
${stateContext}${toddPendingHandoff}${toddNotesSection}
${conversationSection}
${buildAgentChatResponseContract(directorId, mode)}`;
  }

  if (directorId === "creative-director") {
    const danCoreContext = formatScopedCoreDetails(session, { includeCurrent: true, includeIdeal: true, confirmedOnly: false });
    const pillarContext = session.corePillars.length > 0
      ? `\nIdeal Core Pillars:\n${session.corePillars.map((p) => {
          let line = `- ${p.name} [${p.pillarType}]: ${p.function?.summary ?? "TBD"} (${p.function?.status ?? "unset"})`;
          if (p.assumptionText) line += `\n  Assumption (${p.assumptionSource ?? "unknown"}): "${p.assumptionText}"`;
          return line;
        }).join("\n")}\n`
      : "";
    const currentPillarContext = session.currentCorePillars?.length > 0
      ? `\nCurrent-State Core Pillars:\n${session.currentCorePillars.map((p) => {
          return `- ${p.name} [${p.pillarType}]: ${p.function?.summary ?? "TBD"} (${p.function?.status ?? "unset"})`;
        }).join("\n")}\n`
      : "";
    return `You are Dan, the Creative Director for "${projectName}".
You are in a team agent chat. Your role:
- Shape the product concept, clarify core details, and manage the pillar structure
- You track both CURRENT confirmed core-details and IDEAL confirmed core-details
- While gathering, prefer compact "draftOperations" that update the existing working draft instead of re-sending the full draft snapshot
- Only include full "draftCoreDetails" when you are ready to confirm the synthesized concept
- Always keep "currentState" null. You do not own implementation state
- If the user drifts into sequencing, roadmap, or implementation strategy, capture it with "toddHandoffNotesToAppend" instead of storing it as Dan memory
- When the user indicates uncertainty about what comes next (e.g. "that's as far as I've thought", "I'm not sure what's next"), you should:
  - Acknowledge the uncertainty
  - Write a thoughtful assumption about what might come next, considering the full project scope including side-pillars and ghost-pillars
  - This assumption will be stored with pillarType "tbd" (yellow uncertainty dot)
  - If the user provided their own possible direction, store that as the uncertain content (normal text display)
  - If the user leaves it blank, you write the assumption (mark assumptionSource as "dan" — displayed in red text)
- When the user indicates a hard definitive end point, note it as pillarType "hard-stop" (red end dot) — no assumptions beyond

Dot color mapping:
- GREEN = confirmed core pillar connected to the main flow
- RED = hard-stop; certain definitive end, nothing exists beyond
- YELLOW = uncertain continuation (tbd); always means uncertain
- BLUE = side pillar; belongs somewhere, placement unknown
- PURPLE = ghost pillar; may fundamentally change the project, may never be used

- Be conversational and collaborative
- Set handoffTo if another director needs to act

Valid director IDs for handoff (use the exact ID string, not the name):
- "project-manager" (Jeff)
- "rd-director" (Todd) — also handles internet research

Current project status:
${statusContext}
${pillarContext}${currentPillarContext}
${danCoreContext}
${stateContext}
${conversationSection}
${buildAgentChatResponseContract(directorId, mode)}`;
  }

  if (directorId === "programming-director") {
    const pingCoreContext = formatScopedCoreDetails(session, {
      confirmedOnly: true,
      relevantPillarIds: session.pingTaskContext?.relevantPillarIds,
    });
    const pingContext = session.pingTaskContext;
    const taskSection = pingContext
      ? `\nYour current task context:\n- Task: ${pingContext.currentTask ?? "none"}\n- Todd's explanation: ${pingContext.toddUpdateExplanation ?? "none"}\n${pingContext.lastResult ? `- Last result: ${pingContext.lastResult}` : ""}${pingContext.lastFailureReason ? `\n- Last failure: ${pingContext.lastFailureReason}` : ""}\n`
      : "";
    const pendingUpdates = session.versionUpdates.filter((u) => u.status === "pending" || u.status === "in_progress");
    const updatesSection = pendingUpdates.length > 0
      ? `\nCurrent update queue:\n${pendingUpdates.map((u) => `- [${u.status}] ${u.title}: ${u.description}`).join("\n")}\n`
      : "";

    return `You are Ping, the Programming Director for "${projectName}".
You are in a team agent chat. Your role:
- Implement updates from the confirmed plan
- You only receive confirmed core details relevant to your current task
- If something feels missing, ask Todd
- Be conversational and collaborative
- Set handoffTo if another director needs to act

Valid director IDs for handoff (use the exact ID string, not the name):
- "rd-director" (Todd)

${pingCoreContext}
${taskSection}${updatesSection}
${stateContext}
${conversationSection}
${buildAgentChatResponseContract(directorId, mode)}`;
  }

  if (directorId === "validation-director") {
    const pongCoreContext = formatScopedCoreDetails(session, {
      confirmedOnly: true,
      relevantPillarIds: session.pongTaskContext?.relevantPillarIds,
    });
    const pongContext = session.pongTaskContext;
    const taskSection = pongContext
      ? `\nYour current task context:\n- Task: ${pongContext.currentTask ?? "none"}\n- Todd's explanation of what this update should achieve: ${pongContext.toddUpdateExplanation ?? "none"}\n${pongContext.lastResult ? `- Last result: ${pongContext.lastResult}` : ""}${pongContext.lastFailureReason ? `\n- Last failure: ${pongContext.lastFailureReason}` : ""}\n`
      : "";
    const validationSection = session.validationResults.length > 0
      ? `\nPrior validation results:\n${session.validationResults.slice(-5).map((r) => `- ${r.validationType}: ${r.passed ? "PASS" : "FAIL"} — ${r.summary}`).join("\n")}\n`
      : "";

    return `You are Pong, the Validation Director for "${projectName}".
You are in a team agent chat. Your role:
- Validate current behavior against confirmed intended results
- You only receive confirmed core details relevant to your current validation
- Compare implementation output against the intended goal
- Be conversational and collaborative
- Set handoffTo if another director needs to act

Valid director IDs for handoff (use the exact ID string, not the name):
- "rd-director" (Todd)

${pongCoreContext}
${taskSection}${validationSection}
${stateContext}
${conversationSection}
${buildAgentChatResponseContract(directorId, mode)}`;
  }

  // Generic fallback for any future directors
  return `You are ${directorName}, the ${directorLabel} for "${projectName}".
You have just joined the team agent chat. The user or another director invited you.
Respond to the user's latest message directly and helpfully.
If you need to hand off to another specialist, set handoffTo to their director ID. Otherwise set handoffTo to null.
Be conversational and collaborative.

Valid director IDs for handoff (use the exact ID string, not the name):
- "project-manager" (Jeff)
- "creative-director" (Dan)
- "rd-director" (Todd)
- "programming-director" (Ping)
- "validation-director" (Pong)

Current project status:
${statusContext}

${coreContext}
${stateContext}
${conversationSection}
${buildAgentChatResponseContract(directorId, mode)}`;
}

function buildReworkedAgentChatDirectorPrompt(
  directorId: DirectorId,
  projectName: string,
  session: AgentSession,
  opts: {
    mode?: AgentChatDirectorMode;
  } = {},
): string {
  const directorName = DIRECTOR_NAMES[directorId];
  const directorLabel = DIRECTOR_LABELS[directorId];
  const coreContext = formatCoreDetails(session);
  const statusContext = formatDirectorStatus(session);
  const mode = opts.mode ?? "codebase-analysis";
  const allowInternetResearch = directorId === "rd-director" && mode === "internet-research";
  const conversationSection = buildRecentAgentChatHistory(session);

  const directorState = session.directorStateMap?.[directorId];
  const stateContext = directorState
    ? `\nYour tracked state:\n- Current State: ${directorState.currentState ?? "(not yet mapped)"}\n- Ideal State: ${directorState.idealState ?? "(not yet defined)"}\n${directorState.assumptions.length > 0 ? `- Assumptions: ${directorState.assumptions.join("; ")}` : ""}\n`
    : "";

  if (directorId === "project-manager") {
    const unconfirmedItems: string[] = [];
    for (const pillar of session.corePillars) {
      if (pillar.function?.status === "assumed") unconfirmedItems.push(`Pillar "${pillar.name}" function`);
      if (pillar.thesis?.status === "assumed") unconfirmedItems.push(`Pillar "${pillar.name}" thesis`);
      if (pillar.assumptionText && pillar.assumptionSource === "dan") {
        unconfirmedItems.push(`Pillar "${pillar.name}" assumption: "${pillar.assumptionText}"`);
      }
    }
    for (const [dId, snapshot] of Object.entries(session.directorStateMap ?? {})) {
      if (snapshot && snapshot.assumptions.length > 0) {
        unconfirmedItems.push(`${DIRECTOR_NAMES[dId as DirectorId]} has ${snapshot.assumptions.length} unconfirmed assumption(s)`);
      }
    }
    for (const approval of session.pendingApprovals ?? []) {
      unconfirmedItems.push(`Pending confirmation: ${approval.summary}`);
    }
    const unconfirmedSection = unconfirmedItems.length > 0
      ? `\nUnconfirmed items awaiting user review:\n${unconfirmedItems.map((item) => `- ${item}`).join("\n")}\nIf the user asks what needs confirmation, present these items clearly.\n`
      : "";
    const assumedSummary = buildAssumedStateSummary(session);
    const creativeHistoryEntries = session.danMemory?.creativeHistory ?? [];
    const creativeHistorySection = creativeHistoryEntries.length > 0
      ? `\nDan's creative update history (reference when user asks about prior iterations):\n${
          creativeHistoryEntries.slice(-10).map(
            (entry) => `- [${entry.createdAt}] ${entry.action}: ${entry.summary}`,
          ).join("\n")
        }\n`
      : "";

    const presenceDirector = session.slackPresenceGuestId ? DIRECTOR_NAMES[session.slackPresenceGuestId] : null;
    const presenceNote = presenceDirector
      ? `\nCurrent presence: ${presenceDirector} is the active director. If the user's message continues that thread, route to them rather than answering yourself. Only step in when the user explicitly addresses you, the conversation needs redirecting, or no other director is present.\n`
      : "";

    return `You are Jeff, the Project Manager for "${projectName}".
You are in a team agent chat with the user and all directors.
You are the central coordinator and orchestrator.${presenceNote}
Your role:
- You are the team lead — your job is to route work to the right people, not to do their work yourself
- When the user's message is clearly for one specialist, be brief: acknowledge and hand off immediately (e.g. "I'll bring Dan in for this.")
- When the message touches multiple domains, outline the plan before handing off to the first director (e.g. "This touches creative and technical — I'll bring Dan in first for the concept side, then we can loop Todd in for the architecture.")
- Do not repeat or analyze what the user said if a specialist should handle it — just route
- Route creative concept shaping and core-detail clarification to "creative-director" (Dan)
- Route codebase scans, architecture assessment, and repo review to "rd-director" (Todd) as codebase analysis
- Route roadmap, milestone, version, or V1/V2/V3 planning to "rd-director" (Todd) as version planning
- Route update sequencing, grouped implementation plans, and rollout-step planning to "rd-director" (Todd) as update planning
- Route explicit external research, current web information, competitor checks, market checks, or latest-documentation checks to "rd-director" (Todd) as internet research
- Route implementation-focused work to "rd-director" (Todd) so Todd can package the update for Ping
- If you can handle the message yourself (general questions, status checks, confirmations), set handoffTo to null
- If the user asks "anything for me to confirm?" or similar, present unresolved assumptions, assumed state, and pending confirmations clearly
- Only confirmed information should move downstream for actual planning/building/testing
- Pong stays manual for now; do not hand off automatically to the validation director in this pass
- Be conversational and direct — talk like a real project lead in the team chat, not a robot
- When handing work to Todd, make the handoffReason explicit enough that PROGRAMS can tell whether this is codebase analysis, version planning, update planning, or internet research
- If the user asks about prior creative iterations or what changed previously, reference Dan's creative update history below

Valid director IDs for handoff (use the exact ID string, not the name):
- "creative-director" (Dan)
- "rd-director" (Todd) — also handles internet research

Current project status:
${statusContext}
${unconfirmedSection}${assumedSummary}${creativeHistorySection}
${coreContext}
${conversationSection}
${buildAgentChatResponseContract(directorId, mode)}`;
  }

  if (directorId === "rd-director") {
    const toddCoreContext = formatScopedCoreDetails(session, {
      confirmedOnly: true,
      includeCurrent: true,
      includeIdeal: true,
    });
    const codebaseSummary = buildToddCodebaseSummary(session);
    const futureUpdates = session.toddMemory?.futureUpdatePlan ?? session.versionUpdates ?? [];
    const futureUpdateSection = futureUpdates.length > 0
      ? `\nCurrent update queue:\n${futureUpdates.map((update) =>
        `- [${update.status}] ${update.title}: ${update.description}${update.skillsNeeded.length > 0 ? ` | Skills: ${update.skillsNeeded.join(", ")}` : ""}`
      ).join("\n")}\n`
      : "";
    const toddPlanSection = [
      session.toddMemory?.currentState ? `Current State: ${session.toddMemory.currentState}` : null,
      session.toddMemory?.endStateGoal ? `End State Goal: ${session.toddMemory.endStateGoal}` : null,
      (session.toddMemory?.successChain?.length ?? 0) > 0
        ? `Success Chain:\n${session.toddMemory!.successChain.map((s, i) => `  ${i + 1}. [${s.satisfied ? "done" : "pending"}] ${s.title}: ${s.description}`).join("\n")}`
        : null,
      session.toddMemory?.nextUpdate
        ? `Next Update: ${session.toddMemory.nextUpdate.title} — ${session.toddMemory.nextUpdate.description}`
        : null,
    ].filter(Boolean).join("\n\n");

    if (mode === "internet-research") {
      return `You are Todd, the R&D Director for "${projectName}".
You are in a team agent chat. Your role:
- Analyze technical questions using confirmed concept details plus your own codebase map and logs
- You have access to web search and web fetch tools for this turn. Use them when the request depends on current external facts.
- Keep "response" conversational and direct
- Provide "generalSummary" and "projectSummary" only as external-research summaries for this turn
- Jeff manages user-facing coordination. Only set handoffTo when Jeff should coordinate next, or when Ping/Pong should execute or validate under your direction.
- If a concept gap blocks technical planning, explain it plainly in "response" and keep handoffTo null unless Jeff explicitly needs to step in.
- When you finish your current function, end your response with a brief completion line: "[Done: <1-sentence summary of what you accomplished and any next step>]"

Valid director IDs for handoff (use the exact ID string, not the name):
- "project-manager" (Jeff)
- "programming-director" (Ping)
- "validation-director" (Pong)

Current project status:
${statusContext}

${codebaseSummary}
${toddCoreContext}
${stateContext}
${conversationSection}
${buildAgentChatResponseContract(directorId, mode)}`;
    }

    const toddSoftMemory = formatToddSoftMemoryPrompt(
      session.toddMemory?.softMemory ?? session.toddMemory?.notes ?? [],
      session.toddMemory?.pendingHandoff ?? null,
    );
    return `You are Todd, the R&D Director for "${projectName}".
You are in a team agent chat. Your role:
- Analyze technical questions, repo architecture, and implementation risks
- You do not have internet access for this turn. Focus on the repo, confirmed project context, and your codebase understanding. If live external research is needed, say so plainly and explain what should be researched next.
- Assess feasibility and make recommendations
- Plan only from confirmed concept details plus your own codebase map and logs
- Dan owns conceptual truth. Treat confirmed concept details as read-only source of truth from Dan.
- Jeff manages user-facing coordination. Only set handoffTo when Jeff should coordinate next, or when Ping/Pong should execute or validate under your direction.
- If a concept gap blocks technical planning, explain it plainly in "response" and keep handoffTo null unless Jeff explicitly needs to step in.
- Keep "response" conversational and direct
- Do not use external web research summaries in this mode
- Set handoffTo to null unless another director needs to act on your findings
- When you finish your current function, end your response with a brief completion line: "[Done: <1-sentence summary of what you accomplished and any next step>]"

Valid director IDs for handoff (use the exact ID string, not the name):
- "project-manager" (Jeff)
- "programming-director" (Ping)
- "validation-director" (Pong)

Current project status:
${statusContext}

${codebaseSummary}
${toddCoreContext}
${toddPlanSection ? `\nPlanning State:\n${toddPlanSection}\n` : ""}${futureUpdateSection}${toddSoftMemory}
${stateContext}
${conversationSection}
${buildAgentChatResponseContract(directorId, mode)}`;
  }

  if (directorId === "creative-director") {
    const currentMessage = [...session.slackMessages].reverse().find((message) => message.role === "user")?.content ?? "";
    return buildDanSharedPrompt({
      projectName,
      session,
      focusMode: session.creativeFocusMode,
      surface: "slack",
      conversationSection: buildRecentAgentChatHistory(session, 10),
      currentMessage,
    });
  }

  if (directorId === "programming-director") {

    const pingCoreContext = formatScopedCoreDetails(session, {
      confirmedOnly: true,
      relevantPillarIds: session.pingTaskContext?.relevantPillarIds,
    });
    const pingContext = session.pingMemory ?? {
      activeUpdateId: null,
      activeTask: session.pingTaskContext?.currentTask ?? null,
      context: session.pingTaskContext?.toddUpdateExplanation ?? null,
      codebaseMapSummary: null,
      latestRawReport: null,
      latestJeffReport: null,
    };
    const taskSection = pingContext
      ? `\nYour current task context:\n- Task: ${pingContext.activeTask ?? "none"}\n- Todd's explanation: ${pingContext.context ?? "none"}\n${pingContext.latestRawReport?.summary ? `- Last result: ${pingContext.latestRawReport.summary}` : ""}${pingContext.latestRawReport?.blocker ? `\n- Last failure: ${pingContext.latestRawReport.blocker}` : ""}\n`
      : "";
    const pendingUpdates = (session.toddMemory?.futureUpdatePlan ?? session.versionUpdates ?? []).filter((update) => update.status === "pending" || update.status === "in_progress");
    const updatesSection = pendingUpdates.length > 0
      ? `\nCurrent update queue:\n${pendingUpdates.map((update) => `- [${update.status}] ${update.title}: ${update.description}`).join("\n")}\n`
      : "";

    return `You are Ping, the Programming Director for "${projectName}".
You are in a team agent chat. Your role:
- Implement updates from the confirmed plan
- Return only short execution status. Do not brainstorm, plan, or explain at length.
- Always think and respond first in concise Mandarin, then provide a simple literal English translation.
- Keep the English slightly broken and compressed, as if auto-translated.
- Use "status" as one of: success, blocked, unexpected, no_changes.
- "response" should match the Mandarin line shown in chat first.
- "rawReport" must stay minimal: summary, changedFiles, blocker, unexpectedNotes.
- If something feels missing, hand off to Todd.
- When you finish execution, end your response with a brief completion line: "[Done: <1-sentence summary of what you did and any blocker>]"

Valid director IDs for handoff (use the exact ID string, not the name):
- "rd-director" (Todd)

${pingCoreContext}
${taskSection}${updatesSection}
${stateContext}
${conversationSection}
Return ONLY strict JSON with exactly these fields:
- "response": string. Required. Use the Mandarin line shown first in chat.
- "handoffTo": string|null. Use a director ID or null.
- "handoffReason": string|null. Use a short reason or null.
- "currentState": string|null. Use null unless a short implementation-state note is necessary.
- "idealState": string|null. Use null unless a short target-state note is necessary.
- "status": string. Required. One of "success", "blocked", "unexpected", "no_changes".
- "zhResponse": string. Required. Short Mandarin status line.
- "enTranslation": string. Required. Short literal English translation.
- "rawReport": object|null. Required. Minimal execution report with fields "summary", "changedFiles", "blocker", "unexpectedNotes".`;
  }

  if (directorId === "validation-director") {
    const pongCoreContext = formatScopedCoreDetails(session, {
      confirmedOnly: true,
      relevantPillarIds: session.pongTaskContext?.relevantPillarIds,
    });
    const pongContext = session.pongTaskContext;
    const taskSection = pongContext
      ? `\nYour current task context:\n- Task: ${pongContext.currentTask ?? "none"}\n- Todd's explanation of what this update should achieve: ${pongContext.toddUpdateExplanation ?? "none"}\n${pongContext.lastResult ? `- Last result: ${pongContext.lastResult}` : ""}${pongContext.lastFailureReason ? `\n- Last failure: ${pongContext.lastFailureReason}` : ""}\n`
      : "";
    const jeffInstructionSection = session.pongMemory?.jeffInstruction
      ? `\nTodd's validation instruction:\n- ${session.pongMemory.jeffInstruction}\n`
      : "";
    const validationSection = session.validationResults.length > 0
      ? `\nPrior validation results:\n${session.validationResults.slice(-5).map((result) => `- ${result.validationType}: ${result.passed ? "PASS" : "FAIL"} — ${result.summary}`).join("\n")}\n`
      : "";

    return `You are Pong, the Validation Director for "${projectName}".
You are in a team agent chat. Your role:
- Validate current behavior against confirmed intended results
- You only receive confirmed core details relevant to your current validation
- Compare implementation output against the intended goal
- Be conversational and collaborative
- Set handoffTo if another director needs to act

Valid director IDs for handoff (use the exact ID string, not the name):
- "rd-director" (Todd)

${pongCoreContext}
${taskSection}${jeffInstructionSection}${validationSection}
${stateContext}
${conversationSection}
${buildAgentChatResponseContract(directorId, mode)}`;
  }

  return `You are ${directorName}, the ${directorLabel} for "${projectName}".
You have just joined the team agent chat. The user or another director invited you.
Respond to the user's latest message directly and helpfully.
If you need to hand off to another specialist, set handoffTo to their director ID. Otherwise set handoffTo to null.
Be conversational and collaborative.

Valid director IDs for handoff (use the exact ID string, not the name):
- "project-manager" (Jeff)
- "creative-director" (Dan)
- "rd-director" (Todd)
- "programming-director" (Ping)
- "validation-director" (Pong)

Current project status:
${statusContext}

${coreContext}
${stateContext}
${conversationSection}
${buildAgentChatResponseContract(directorId, mode)}`;
}

const buildToddRegeneratePrompt = (
  projectName: string,
  codebaseSummary: string,
  coreContext: string,
  existingChain: string,
  existingQueue: string,
  previousUpdateLog: string,
  troubleLog: string,
): string => `You are Todd, the R&D Director for "${projectName}".
Regenerate the full planning state for this project based on the codebase map and confirmed concept details below.

Your job is to produce four things:
1. currentState — what is currently true about this project's technical implementation (1–3 sentences, grounded in the codebase map)
2. endStateGoal — what the project is trying to become technically (1–3 sentences, grounded in the confirmed concept)
3. successChain — an ordered dependency chain of steps that must be completed to reach the end state goal. Each step must be independent enough that completing it is clearly testable. Earlier steps must be prerequisites for later ones. Mark satisfied=true only for steps that the previous update log confirms are fully done.
4. nextUpdate — the single most important next update for Ping to execute. This must be the first unsatisfied step from the success chain that is now unblocked. Treat this as the exact handoff contract Ping will receive with no extra rewrite. Provide full detail: title, description, pillarIds, currentStateContext, successDefinition, partialSuccessDefinition, partialFailureDefinition, failureDefinition, updateKind, simplificationMode, structuralReason, supportsNextStep, skillsNeeded, dependencies.

Rules:
- Plan only from confirmed concept details and the codebase map. Do not invent goals not present in either source.
- successChain must have 3–10 steps. Keep each step title concise (under 60 chars).
- nextUpdate must match the first unsatisfied and unblocked step in successChain.
- nextUpdate.currentStateContext must tell Ping what is already true in the codebase that matters for this step.
- nextUpdate.successDefinition, partialSuccessDefinition, partialFailureDefinition, and failureDefinition must be concrete enough that Ping can judge the result after the run.
- nextUpdate.pillarIds should contain relevant pillar IDs when they are clear from stored roadmap/context. If they are not clear, use [] rather than inventing IDs.
- If nextUpdate requires simplification first, make simplificationMode and structuralReason explicit.
- Set nextUpdate to null only if successChain is empty or all steps are already satisfied.
- Use updateKind exactly as: create = build a new piece that does not yet exist | expand = add meaningful capability onto an existing piece | refine = improve an existing piece while keeping its role | simplify = preserve intended function while improving structure so future work lands cleanly
- Use simplificationMode as: null when no simplification is needed first | inline when cleanup is local and bundled into the same step | staged when cleanup should be a dedicated step or sequence ahead of a later step | overhaul when layering more work on top would be poor practice
- response is a short plain-English summary of what Todd concluded (2–4 sentences), written as Todd speaking to the team.

${codebaseSummary}

Confirmed concept:
${coreContext}

Existing success chain (for reference — will be replaced):
${existingChain}

Current update queue (for context only — do not modify here):
${existingQueue}

Previous update log:
${previousUpdateLog}

Trouble log:
${troubleLog}

Respond with strict JSON:
{"currentState": string, "endStateGoal": string, "successChain": [{"title": string, "description": string, "satisfied": boolean}], "nextUpdate": {"title": string, "description": string, "pillarIds": string[], "currentStateContext": string|null, "successDefinition": string|null, "partialSuccessDefinition": string|null, "partialFailureDefinition": string|null, "failureDefinition": string|null, "updateKind": string|null, "simplificationMode": string|null, "structuralReason": string|null, "supportsNextStep": string|null, "skillsNeeded": string[], "dependencies": string[]} | null, "response": string}`;

function buildDirectorPrompt(
  directorId: DirectorId,
  focusMode: DirectorFocusMode | null,
  projectName: string,
  session: AgentSession,
): string {
  const directorLabel = DIRECTOR_LABELS[directorId];
  const directorName = DIRECTOR_NAMES[directorId];

  // Build confirmed context from Creative stages
  const coreContext = formatCoreDetails(session);
  const toddCodebaseContext = directorId === "rd-director" ? buildToddCodebaseSummary(session) : "";

  // Director's own conversation history
  const conv = session.directorConversations[directorId];
  const convHistory = conv?.messages.slice(-20).map((m) =>
    `${m.role === "user" ? "User" : directorName}: ${m.content}`
  ).join("\n\n") ?? "";

  const conversationSection = convHistory ? `\nConversation so far:\n${convHistory}\n` : "";

  switch (directorId) {
    case "project-manager":
      return `You are Jeff, the Project Manager for "${projectName}".
You are the central coordinator. You have access to all directors' notes. Your role:
- Handle general user conversation about the project
- Route requests to the correct director when the user wants to define, refine, or update something
- Maintain awareness of the overall project state
- Do NOT do deep specialist work — delegate to the appropriate director

Current project status:
${formatDirectorStatus(session)}

${coreContext}
${conversationSection}
If the user's message should be handled by a specific director, set routeTo to the director ID and explain why in routeReason.
Valid director IDs: creative-director (Dan), rd-director (Todd)
If you can handle the message yourself, set routeTo to null.

Respond as JSON: {"response": string, "routeTo": string|null, "routeReason": string|null}`;

    case "creative-director": {
      const currentMessage = [...(conv?.messages ?? [])].reverse().find((message) => message.role === "user")?.content ?? "";
      return buildDanSharedPrompt({
        projectName,
        session,
        focusMode,
        surface: "dm",
        conversationSection,
        currentMessage,
      });
    }

    case "rd-director": {
      const toddSoftMemoryDm = formatToddSoftMemoryPrompt(
        session.toddMemory?.softMemory ?? session.toddMemory?.notes ?? [],
        session.toddMemory?.pendingHandoff ?? null,
      );
      const toddNotesSectionDm = (session.toddMemory?.notes ?? []).length > 0
        ? `\nPlanning Notes (working assumptions):\n${session.toddMemory!.notes.map((note) => `- ${typeof note === "string" ? note : note.content}`).join("\n")}`
        : "";
      if (focusMode === "research") {
        const feasContext = session.feasibilityAssessments.length > 0
          ? `\nExisting feasibility assessments:\n${session.feasibilityAssessments.map((a) => `- ${a.area} [${a.complexity}]: ${a.assessment}`).join("\n")}`
          : "";
        return `You are Todd, the R&D Director for "${projectName}".
You are in Research mode — researching what is possible given the user's constraints. Your role:
- Assess feasibility of the concept
- Ask specific questions about budget (money, hardware, time, etc.)
- Recommend stack/technology decisions
- Lock in exactly what technical bridges/APIs are needed for the total function
- Plan only from confirmed concept details plus your current codebase map
- Dan owns the concept. If a concept gap blocks technical planning, explain it plainly in "response" and keep handoffTo null unless Jeff explicitly needs to coordinate next.
- Only use handoffTo for Jeff, Ping, or Pong.
- Use "notesToAppend" to store planning notes and working assumptions as soft memory. Use [] when nothing new should be stored.

${coreContext}
${toddCodebaseContext}
${feasContext}${toddSoftMemoryDm}${toddNotesSectionDm}
${conversationSection}
When you have feasibility assessments to propose, include them in the feasibilityAssessments array. Each item must include area, assessment, complexity (low/medium/high), stackRecommendation, and costNotes. Use null for stackRecommendation or costNotes when they do not apply. Set feasibilityAssessments to null if just chatting.

Respond as JSON: {"response": string, "handoffTo": string|null, "handoffReason": string|null, "currentState": string|null, "idealState": string|null, "feasibilityAssessments": [...]|null, "notesToAppend": [...]}`;
      }

      if (focusMode === "version-planning") {
        const versionsContext = session.versions.length > 0
          ? `\nExisting version plans:\n${session.versions.map((v) => `- ${v.label}: ${v.description} (${v.status})`).join("\n")}`
          : "";
        const feasContext = session.feasibilityAssessments.length > 0
          ? `\nFeasibility assessments:\n${session.feasibilityAssessments.map((a) => `- ${a.area} [${a.complexity}]: ${a.assessment}`).join("\n")}`
          : "";
      return `You are Todd, the R&D Director for "${projectName}".
You are in Version Planning mode — outlining the version roadmap. Your role:
- V1 features a fully functional process
- V2 features a functional user experience
- V3 features a polished releasable state
- Use only confirmed concept details plus the codebase map to shape the roadmap order
- Dan owns the concept. If a concept gap blocks technical planning, explain it plainly in "response" and keep handoffTo null unless Jeff explicitly needs to coordinate next.
- Only use handoffTo for Jeff, Ping, or Pong.
- Use "notesToAppend" to store planning notes and working assumptions as soft memory. Use [] when nothing new should be stored.

${coreContext}
${toddCodebaseContext}
${feasContext}
${versionsContext}${toddSoftMemoryDm}${toddNotesSectionDm}
${conversationSection}
When you have version plans to propose, set confirmationSuggested to true and include them in the versions array. Set versions to null if just chatting.

When proposing a roadmap, include a "roadmap" object (same structure as update-planning mode). Set roadmap to null if not proposing one.

Respond as JSON: {"response": string, "handoffTo": string|null, "handoffReason": string|null, "currentState": string|null, "idealState": string|null, "confirmationSuggested": boolean, "roadmap": {...}|null, "versions": [...]|null, "notesToAppend": [...]}`;
      }

      // Default: update-planning mode
      const versionsContext = session.versions.length > 0
        ? `\nVersion plans:\n${session.versions.map((v) => `- ${v.label}: ${v.description}\n  Goals: ${v.goals.join(", ")}`).join("\n")}`
        : "";
      const updatesContext = session.versionUpdates.length > 0
        ? `\nExisting updates:\n${session.versionUpdates.map((u) => `- [${u.status}] ${u.title}: ${u.description}`).join("\n")}`
        : "";
      return `You are Todd, the R&D Director for "${projectName}".
You are in Update Planning mode — specifying core updates from current state through each version. Your role:
- Group updates by what makes sense (all front-end updates grouped, all back-end updates grouped)
- Optimize update order based on what sections the programmer focuses on per update
- For V1: specific update plans. For V2: more general. For V3: end-state direction.
- Use only confirmed concept details plus the codebase map to decide the update sequence.
- Review update planning in this order:
  1. review current project direction
  2. review the relevant code/index shape
  3. identify the highest-priority next step
  4. classify it as Create, Expand, Refine, or Simplify
  5. decide whether simplification is unnecessary, inline, staged, or overhaul-first before the next major step
- Simplify means structural optimization that preserves intended function while reducing friction, coupling, confusion, or risk
- Trigger structural concern when responsibilities are mixed, one change would touch too many places, the module split no longer matches the concept, testing is messy because concerns are mixed, Ping would need workaround edits, coupling recently increased, or the next clean structure is blocked by the current shape
- File size alone is not enough reason to simplify
- Dan owns the concept. If a concept gap blocks technical planning, explain it plainly in "response" and keep handoffTo null unless Jeff explicitly needs to coordinate next.
- Only use handoffTo for Jeff, Ping, or Pong.
- Use "notesToAppend" to store planning notes and working assumptions as soft memory. Use [] when nothing new should be stored.

${coreContext}
${toddCodebaseContext}
${versionsContext}
${updatesContext}${toddSoftMemoryDm}${toddNotesSectionDm}
${conversationSection}
When you have updates to propose, set confirmationSuggested to true and include them in the updates array. Each update must include title, description, versionLabel, dependencies, area, skillsNeeded, updateKind, simplificationMode, structuralReason, and supportsNextStep. Use [] for dependencies when none exist. Use null for area, simplificationMode, structuralReason, or supportsNextStep when they do not apply. Always set updateKind to one of create, expand, refine, or simplify. Use inline simplification only for small local cleanup; use staged or overhaul when cleanup deserves its own structural pass. Set updates to null if just chatting.

When proposing a roadmap, include a "roadmap" object with currentState (array of {id,title,description,pillarIds,itemStatus:"done"|"tbd"}), endState (array of {id,title,description,pillarIds}), pathway (array of {id,title,description,pillarIds,updateKind:"create"|"expand"|"refine",order}), priorityUpdate ({id,title,description,pillarIds,updateKind,currentStateContext,successDefinition,partialSuccessDefinition,partialFailureDefinition,failureDefinition}|null), and generatedAt (ISO timestamp). Every item must reference at least one pillarId. Set roadmap to null if not proposing one.

Respond as JSON: {"response": string, "handoffTo": string|null, "handoffReason": string|null, "currentState": string|null, "idealState": string|null, "confirmationSuggested": boolean, "roadmap": {...}|null, "updates": [...]|null, "notesToAppend": [...]}`;
    }

    case "programming-director": {
      const pingScopedContext = formatScopedCoreDetails(session, {
        confirmedOnly: true,
        relevantPillarIds: session.pingTaskContext?.relevantPillarIds,
      });
      const pendingUpdates = (session.toddMemory?.futureUpdatePlan ?? session.versionUpdates ?? []).filter((u) => u.status === "pending" || u.status === "in_progress");
      const updatesContext = pendingUpdates.length > 0
        ? `\nCurrent iteration updates:\n${pendingUpdates.map((u) => `- [${u.id}] [${u.status}] ${u.title}: ${u.description}`).join("\n")}`
        : "\nNo updates awaiting implementation.";
      const pingCtx = session.pingMemory ?? {
        activeUpdateId: null,
        activeTask: session.pingTaskContext?.currentTask ?? null,
        context: session.pingTaskContext?.toddUpdateExplanation ?? null,
        codebaseMapSummary: null,
        latestRawReport: null,
        latestJeffReport: null,
      };
      const pingTaskSection = pingCtx
        ? `\nYour current task context:\n- Task: ${pingCtx.activeTask ?? "none"}\n- Todd's explanation: ${pingCtx.context ?? "none"}\n${pingCtx.latestRawReport?.summary ? `- Last result: ${pingCtx.latestRawReport.summary}` : ""}${pingCtx.latestRawReport?.blocker ? `\n- Last failure: ${pingCtx.latestRawReport.blocker}` : ""}\n`
        : "";
      return `You are Ping, the Programming Director for "${projectName}".
You are the lead programmer. Your role:
- Execute updates yourself for the active iteration
- You only receive confirmed core details relevant to your current task
- Do not plan. Do not brainstorm. Return only short execution status.
- Always answer first in concise Mandarin, then provide a simple literal English translation.
- If something feels missing, ask Todd

${pingScopedContext}
${pingTaskSection}${updatesContext}
${conversationSection}
Respond as JSON:
{"response": string, "status": string, "zhResponse": string, "enTranslation": string, "rawReport": {"summary": string, "changedFiles": string[], "blocker": string | null, "unexpectedNotes": string[]} | null}`;
    }

    case "validation-director": {
      const pongScopedContext = formatScopedCoreDetails(session, {
        confirmedOnly: true,
        relevantPillarIds: session.pongTaskContext?.relevantPillarIds,
      });
      const pongCtx = session.pongTaskContext;
      const pongTaskSection = pongCtx
        ? `\nYour current task context:\n- Task: ${pongCtx.currentTask ?? "none"}\n- Todd's explanation of what this update should achieve: ${pongCtx.toddUpdateExplanation ?? "none"}\n${pongCtx.lastResult ? `- Last result: ${pongCtx.lastResult}` : ""}${pongCtx.lastFailureReason ? `\n- Last failure: ${pongCtx.lastFailureReason}` : ""}\n`
        : "";
      const jeffInstructionSection = session.pongMemory?.jeffInstruction
        ? `\nTodd's validation instruction:\n- ${session.pongMemory.jeffInstruction}\n`
        : "";

      if (focusMode === "identify-goal") {
        return `You are Pong, the Validation Director for "${projectName}".
You are in Identify Goal mode — reviewing confirmed core-details for the pillars being validated. Your role:
- Review the confirmed core-details of the project
- Identify what the expected state should be after the most recent updates
- Summarize the goal clearly
- Always answer first in concise Mandarin, then provide a simple literal English translation
- Make "response" match the Mandarin line shown first in chat

${pongScopedContext}
${pongTaskSection}${jeffInstructionSection}
${session.corePillars.length > 0 ? `Pillars:\n${session.corePillars.map((p) => {
  return `- ${p.name} [${p.pillarType}]${p.description ? `: ${p.description}` : ""}`;
}).join("\n")}` : ""}
${conversationSection}
Include goalSummary with a clear summary of the expected state. Include relevantPillarIds with the IDs of pillars relevant to this goal.

Respond as JSON: {"response": string, "zhResponse": string, "enTranslation": string, "goalSummary": string|null, "relevantPillarIds": string[]|null}`;
      }

      if (focusMode === "test-current-state") {
        return `You are Pong, the Validation Director for "${projectName}".
You are in Test Current-State mode — testing the current state against confirmed intended results. Your role:
- Test functions and capture screenshots of visuals
- Report what the current state looks like
- Document any issues found
- Always answer first in concise Mandarin, then provide a simple literal English translation
- Make "response" match the Mandarin line shown first in chat

Validation results so far: ${session.validationResults.length > 0
  ? session.validationResults.map((r) => `${r.validationType}: ${r.passed ? "PASS" : "FAIL"} - ${r.summary}`).join("; ")
  : "None yet"}

${pongScopedContext}
${pongTaskSection}${jeffInstructionSection}
${conversationSection}
Include validationPassed, validationSummary, and validationDetails when reporting results. Set to null if just discussing.

Respond as JSON: {"response": string, "zhResponse": string, "enTranslation": string, "validationPassed": boolean|null, "validationSummary": string|null, "validationDetails": string|null}`;
      }

      // Default: compare mode
      return `You are Pong, the Validation Director for "${projectName}".
You are in Compare mode — comparing the current-state to the confirmed expected goal. Your role:
- Compare the current state (screenshots/test results) to the confirmed expected goal
- Return an objective comparison: current state vs intended goal-state
- Identify specific areas for improvement
- Always answer first in concise Mandarin, then provide a simple literal English translation
- Make "response" match the Mandarin line shown first in chat

${pongScopedContext}
${pongTaskSection}${jeffInstructionSection}
Validation results so far: ${session.validationResults.length > 0
  ? session.validationResults.map((r) => `${r.validationType}: ${r.passed ? "PASS" : "FAIL"} - ${r.summary}`).join("; ")
  : "None yet"}
${conversationSection}
Include passed (boolean), improvementAreas (specific areas that don't align with the plan), and comparisonSummary. Set to null if just discussing.

Respond as JSON: {"response": string, "zhResponse": string, "enTranslation": string, "passed": boolean|null, "improvementAreas": string[]|null, "comparisonSummary": string|null}`;
    }
  }
}

function findPillarById(pillars: AgentSession["corePillars"], id: string): AgentSession["corePillars"][number] | null {
  for (const p of pillars) {
    if (p.id === id) return p;
    const found = findPillarById(p.corePillars, id);
    if (found) return found;
  }
  return null;
}

function resolveNextProgrammingUpdate(
  session: AgentSession,
  requestedUpdateId: string | null,
): VersionUpdate | null {
  if (hasToddSupersedingDraftUpdatePlan(session)) {
    return null;
  }

  const activeUpdateId = session.pingMemory.activeUpdateId;
  if (activeUpdateId) {
    const activeUpdate = session.toddMemory.futureUpdatePlan.find((update) => update.id === activeUpdateId) ?? null;
    if (activeUpdate) {
      return activeUpdate;
    }
  }

  const roadmap = getToddRoadmap(session);
  const priorityUpdate = roadmap?.priorityUpdate ?? null;
  if (priorityUpdate) {
    if (requestedUpdateId && priorityUpdate.id !== requestedUpdateId) {
      return null;
    }
    return buildCompatibilityUpdateFromPriority(session, priorityUpdate);
  }

  const nextPendingUpdate = session.toddMemory.futureUpdatePlan
    .filter((update) => update.status === "pending")
    .slice()
    .sort((a, b) => a.order - b.order)[0] ?? null;
  if (nextPendingUpdate) {
    return nextPendingUpdate;
  }

  if (!requestedUpdateId) {
    return null;
  }

  return session.toddMemory.futureUpdatePlan.find((update) => update.id === requestedUpdateId) ?? null;
}

function ensureDirectorConversationRecord(
  session: AgentSession,
  directorId: DirectorId,
  focusMode: DirectorFocusMode | null = null,
): DirectorConversation {
  if (!session.directorConversations[directorId]) {
    session.directorConversations[directorId] = {
      directorId,
      focusMode,
      messages: [],
      lastActiveAt: null,
    };
  }

  const conversation = session.directorConversations[directorId];
  if (focusMode !== null) {
    conversation.focusMode = focusMode;
  }
  return conversation;
}

function resolveLatestHumanRequest(
  session: AgentSession,
  fallback: string,
): string {
  const agentMessage = [...session.unifiedMessages]
    .reverse()
    .find((message) => message.role === "user" && typeof message.content === "string" && message.content.trim().length > 0);
  if (agentMessage?.content?.trim()) {
    return agentMessage.content.trim();
  }

  const slackMessage = [...session.slackMessages]
    .reverse()
    .find((message) => message.role === "user" && typeof message.content === "string" && message.content.trim().length > 0);
  return slackMessage?.content?.trim() || fallback;
}

function tokenizeToddOverlap(text: string): string[] {
  const ignored = new Set([
    "this",
    "that",
    "with",
    "from",
    "into",
    "have",
    "will",
    "should",
    "about",
    "after",
    "before",
    "where",
    "there",
    "their",
    "your",
    "update",
    "build",
    "make",
    "need",
  ]);

  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 4 && !ignored.has(token));
}

function findToddOverlapForDirectPingRun(
  session: AgentSession,
  task: PingTaskSnapshot,
  rawReport: PingRawReport,
): VersionUpdate | null {
  const directTokens = new Set(
    tokenizeToddOverlap([
      task.originalUserRequest,
      task.updateTitle ?? "",
      task.updateDescription ?? "",
      rawReport.summary,
    ].join(" ")),
  );
  if (directTokens.size === 0) {
    return null;
  }

  let bestMatch: VersionUpdate | null = null;
  let bestScore = 0;
  for (const candidate of session.toddMemory.futureUpdatePlan) {
    const candidateTokens = new Set(tokenizeToddOverlap(`${candidate.title} ${candidate.description}`));
    let score = 0;
    for (const token of candidateTokens) {
      if (directTokens.has(token)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  return bestScore >= 2 ? bestMatch : null;
}

export class ProgramsBackend {
  private readonly projectBackups = new ProjectBackupService(join(app.getPath("userData"), "project-backups"));
  private readonly launchedAppPath = this.currentAppBundlePath();
  private readonly launchedAppUpdatedAtPromise = this.launchedAppPath
    ? this.readModifiedAt(this.launchedAppPath)
    : Promise.resolve(null);
  private appUpdatePackagingJob: Promise<void> | null = null;
  private appUpdatePackagingKey: string | null = null;
  private appUpdateFailedKey: string | null = null;
  private appUpdateBuildError: string | null = null;
  private appUpdateInstalling = false;
  private lastAppUpdateStatusJson: string | null = null;
  private initializationPromise: Promise<void> | null = null;
  private readonly automationJobs = new Set<string>();
  private basicAutomationLoopPromise: Promise<void> | null = null;
  private basicAutomationLastSettingsSignature: string | null = null;
  private basicAutomationCompletedProjectIds = new Set<string>();
  private basicAutomationCursor = 0;
  private basicAutomationStatus: BasicAutomationStatus = {
    state: "off",
    enabled: false,
    currentProjectId: null,
    pausedUntil: null,
    lastRunSummary: null,
    skippedProjects: [],
    updatedAt: new Date().toISOString(),
  };

  constructor(
    private readonly store: ProjectStore,
    private readonly git: GitService,
    private readonly runner: RunnerService,
    private readonly playwright: PlaywrightService,
    private readonly codex: CodexService,
    private readonly claude: ClaudeService,
    private readonly emit: Emit,
  ) {}

  async bootstrap(): Promise<BootstrapPayload> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    const projects = await this.syncSelfRuntime(
      settings,
      await this.refreshProjectsRuntimeConfig(await this.store.listProjects()),
    );
    const runtimes = this.runner.getRuntimeMap(projects.map((project) => project.id));
    const modelCatalog = await this.readModelCatalog(settings);
    const auth = {
      codex: await this.codex.getAuthStatus(settings),
      claude: await this.claude.getAuthStatus(settings),
      github: await this.git.getGithubStatus(),
    };
    const setup = await this.buildSetupSnapshot(settings, auth.codex, auth.claude);
    const appUpdate = await this.readAppUpdateStatus();

    return {
      settings,
      projects,
      runtimes,
      auth,
      setup,
      appUpdate,
      modelCatalog,
    };
  }

  async readAppUpdateStatus(): Promise<AppUpdateStatus> {
    const settings = await this.store.readSettings();
    const status = await this.refreshAppUpdateStatus(settings, true);
    this.emitAppUpdateStatus(status);
    return status;
  }

  async installAppUpdate(): Promise<{ started: true }> {
    const settings = await this.store.readSettings();
    let evaluation = await this.evaluateAppUpdate(settings);
    let status = evaluation.status;
    if (!status.supported) {
      throw new Error(status.reason || "This build cannot install app updates.");
    }
    if (status.buildState === "packaging") {
      throw new Error("PROGRAMS is still preparing the latest app build.");
    }
    if (status.action === "none" || !status.currentAppPath) {
      throw new Error(status.reason || "No newer packaged app build is available.");
    }

    this.appUpdateInstalling = true;
    this.appUpdateBuildError = null;
    status = await this.refreshAppUpdateStatus(settings, false);
    this.emitAppUpdateStatus(status);
    const currentAppPath = status.currentAppPath;
    if (!currentAppPath) {
      this.appUpdateInstalling = false;
      throw new Error("PROGRAMS could not determine which app bundle is running.");
    }

    try {
      if (status.action === "restart") {
        await this.startAppRelaunch(currentAppPath);
      } else {
        if (!status.candidateAppPath) {
          throw new Error("PROGRAMS could not find the packaged app bundle to install.");
        }

        const requiresAdminPrompt =
          status.requiresAdminPrompt || !(await this.canReplaceInstalledApp(currentAppPath));

        if (requiresAdminPrompt) {
          await this.startPrivilegedAppSwap(currentAppPath, status.candidateAppPath);
        } else {
          await this.startWritableAppSwap(currentAppPath, status.candidateAppPath);
        }
      }
    } catch (error) {
      this.appUpdateInstalling = false;
      this.appUpdateFailedKey = evaluation.statusKey;
      this.appUpdateBuildError = this.formatAppUpdateInstallError(
        error,
        status.candidateAppPath,
      );
      const failedStatus = await this.refreshAppUpdateStatus(settings, false);
      this.emitAppUpdateStatus(failedStatus);
      throw new Error(this.appUpdateBuildError);
    }

    app.quit();
    return { started: true };
  }

  async readSettings(): Promise<Settings> {
    return this.store.readSettings();
  }

  async updateSettings(input: SettingsUpdateInput): Promise<Settings> {
    await this.ensureInitialized();
    const settings = await this.store.updateSettings(input);
    this.syncBasicAutomationForSettings(settings);
    if (input.appSourcePath !== undefined) {
      this.appUpdateFailedKey = null;
      this.appUpdateBuildError = null;
    }
    await this.syncSelfRuntime(settings, await this.store.listProjects(), true);
    await this.emitSetupUpdated(settings);
    const appUpdateStatus = await this.refreshAppUpdateStatus(settings, true);
    this.emitAppUpdateStatus(appUpdateStatus);
    await this.emitModelCatalogUpdated(settings);
    return settings;
  }

  async listProjects(): Promise<Project[]> {
    await this.ensureInitialized();
    return this.syncSelfRuntime(
      undefined,
      await this.refreshProjectsRuntimeConfig(await this.store.listProjects()),
    );
  }

  async refreshProjectRelationships(): Promise<Project[]> {
    await this.ensureInitialized();
    return this.recomputeProjectRelationships(await this.store.listProjects(), true);
  }

  async readProject(projectId: string): Promise<ProjectDetail> {
    await this.ensureInitialized();
    const refreshedProject = await this.refreshProjectRuntimeConfig(await this.requireProject(projectId));
    const { project, runtime } = await this.syncProjectRuntimeState(refreshedProject);
    const updates = await this.store.readHistory(projectId);
    const session = await this.store.getAgentSession(projectId);
    if (session) {
      await this.reconcileStalePingStartupState(project.id, session, project.lastError, project);
    }
    const activePlan = this.codex.getActivePlan(projectId) ?? this.claude.getActivePlan(projectId);

    return {
      project,
      updates,
      runtime,
      activePlan,
    };
  }

  async readHistory(projectId: string): Promise<UpdateRecord[]> {
    await this.ensureInitialized();
    return this.store.readHistory(projectId);
  }

  async previewCommit(projectId: string, commitSha: string): Promise<CommitPreviewResult> {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    return this.git.previewCommit(project.localPath, commitSha);
  }

  async restoreFromPreview(projectId: string): Promise<void> {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    await this.git.restoreFromPreview(project.localPath);
  }

  async readOutlineReport(projectId: string): Promise<ProjectOutlineReport | null> {
    await this.ensureInitialized();
    await this.requireProject(projectId);
    return this.store.readOutlineReport(projectId);
  }

  private async generateOutlineReportNow(input: GenerateProjectOutlineReportInput): Promise<ProjectOutlineReport> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    await this.requireProviderReady(input.provider ?? settings.advancedDefaults.provider, settings);
    const project = await this.requireProject(input.projectId);
    const provider = input.provider ?? settings.advancedDefaults.provider;
    const model = provider === "claude"
      ? input.claudeModel ?? settings.advancedDefaults.claudeModel
      : input.model ?? settings.advancedDefaults.model;
    const repoHints = await collectProjectRepoHints(project.localPath);
    const prompt = buildProjectOutlinePrompt({
      project,
      repoHints,
    });
    const rawResult = await this.aiService(provider).runOneShot(
      project,
      settings,
      prompt,
      model,
    );
    const report = parseProjectOutlineReportResponse(project.id, rawResult);

    await this.store.saveOutlineReport(report);
    this.emit({ type: "project.outlineReport", projectId: project.id, report });
    return report;
  }

  async generateOutlineReport(input: GenerateProjectOutlineReportInput): Promise<ProjectOutlineReport | null> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    const provider = input.provider ?? settings.advancedDefaults.provider;
    const session = await this.getOrCreateAgentSession(input.projectId, provider);
    const approval = this.queueApproval(session, {
      kind: "codebase-scan",
      requestedByDirectorId: null,
      targetDirectorId: "rd-director",
      summary: this.buildApprovalSummary("Confirm codebase scan", "Generate a stored-data outline report for this project"),
      draftMessage: "Scan the project and generate the latest stored-data outline report.",
      draftPayload: {
        action: "generateOutlineReport",
        input,
      },
    });
    await this.saveAgentSession(input.projectId, session);
    this.emit({
      type: "toast",
      level: "info",
      message: `Queued approval: ${approval.summary}`,
    });
    return await this.store.readOutlineReport(input.projectId);
  }

  async readEnvFile(projectId: string): Promise<EnvFileSnapshot> {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    const path = join(project.localPath, ".env");
    const exists = await pathExists(path);
    const source = await readTextFile(path);

    return {
      projectId: project.id,
      path,
      exists,
      entries: parseEnvEntries(source),
    };
  }

  async writeEnvFile(input: WriteProjectEnvFileInput): Promise<EnvFileSnapshot> {
    await this.ensureInitialized();
    const project = await this.requireProject(input.projectId);
    const path = join(project.localPath, ".env");
    const content = serializeEnvEntries(input.entries);

    await writeTextFile(path, content);
    return {
      projectId: project.id,
      path,
      exists: true,
      entries: parseEnvEntries(content),
    };
  }

  // --- Agent System ---

  private async decorateAgentSessionKnowledgeState(
    session: AgentSession,
  ): Promise<AgentSession> {
    try {
      const project = await this.store.readProject(session.projectId);
      if (!project) {
        session.knowledgeStatus = "fresh";
        session.knowledgeReasons = [];
        return session;
      }

      const currentFingerprint = await buildProjectKnowledgeFingerprint(project.localPath);
      const indexedFingerprint = session.toddMemory.codebaseIndexedMap?.lastIndexedFingerprint ?? null;
      const knowledgeState = resolveProjectKnowledgeState(currentFingerprint, indexedFingerprint);
      session.knowledgeStatus = knowledgeState.status;
      session.knowledgeReasons = knowledgeState.reasons;
      return session;
    } catch (error) {
      session.knowledgeStatus = "stale";
      session.knowledgeReasons = [
        error instanceof Error
          ? `PROGRAMS could not verify Todd's source/config fingerprint: ${error.message}`
          : "PROGRAMS could not verify Todd's source/config fingerprint.",
      ];
      return session;
    }
  }

  private async resolveAgentSessionKnowledgeState(
    session: AgentSession,
  ): Promise<{ status: ProjectKnowledgeStatus; reasons: string[] }> {
    const project = await this.requireProject(session.projectId);
    const currentFingerprint = await buildProjectKnowledgeFingerprint(project.localPath);
    return resolveProjectKnowledgeState(
      currentFingerprint,
      session.toddMemory.codebaseIndexedMap?.lastIndexedFingerprint ?? null,
    );
  }

  private async assertFreshProjectKnowledge(session: AgentSession): Promise<void> {
    const knowledgeState = await this.resolveAgentSessionKnowledgeState(session);
    if (knowledgeState.status === "fresh") {
      return;
    }

    throw new Error(
      `${knowledgeState.reasons[0]
        ?? "Todd's technical understanding is stale."} Ask Jeff to refresh the project before starting Ping.`,
    );
  }

  async getAgentSession(projectId: string): Promise<AgentSession | null> {
    await this.ensureInitialized();
    let session = await this.store.getAgentSession(projectId);
    if (!session) {
      return null;
    }

    session = await this.reconcileStalePingStartupState(projectId, session);
    if (!session) {
      return null;
    }

    // Migration safety for older sessions missing slack fields
    session.slackMessages = session.slackMessages ?? [];
    session.slackActiveDirectorId = session.slackActiveDirectorId ?? "project-manager";
    session.slackPresenceGuestId = sanitizeSlackPresenceGuestId(session.slackPresenceGuestId).directorId;
    session.pendingApprovals = sanitizePendingApprovals(session.pendingApprovals).pendingApprovals;
    session.directorStateMap = sanitizeDirectorStateMap(session.directorStateMap).directorStateMap;
    session.danArchivedNotes = sanitizeDanArchivedNotes(session.danArchivedNotes).notes;
    session.danInternalNotes = sanitizeDanArchivedNotes(session.danInternalNotes).notes;
    session.danSideNotes = sanitizeDanArchivedNotes(session.danSideNotes).notes;
    session.danDraftChangeSummary = sanitizeDanArchivedNotes(session.danDraftChangeSummary).notes;
    session.danDraftCoreDetails = isRecord(session.danDraftCoreDetails)
      ? session.danDraftCoreDetails as AgentCoreDetails
      : null;
    session.danDraftStatus = session.danDraftStatus === "gathering" || session.danDraftStatus === "ready-to-confirm"
      ? session.danDraftStatus
      : null;
    syncAgentMemories(session);
    await this.decorateAgentSessionKnowledgeState(session);
    return session;
  }

  private createEmptyAgentSession(projectId: string, provider: AgentSession["provider"]): AgentSession {
    const emptyStage = (): AgentStageData => ({ messages: [], confirmed: null });
    return syncAgentMemories({
      id: randomUUID(),
      projectId,
      currentStage: "function",
      conversationMode: "guided",
      stages: {
        function: emptyStage(),
        thesis: emptyStage(),
        core_pillars: emptyStage(),
        full_flow: emptyStage(),
        iterations: emptyStage(),
        execution: emptyStage(),
      },
      unifiedMessages: [],
      scratchpad: [],
      plannedUpdates: [],
      corePillars: [],
      currentCorePillars: [],
      coreDetailsChatHistory: [],
      attachedMaterials: [],
      miscMaterials: [],
      cascadePending: null,
      provider,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Director system fields
      directorConversations: {},
      versions: [],
      versionUpdates: [],
      feasibilityAssessments: [],
      validationResults: [],
      validationFrequency: "manual",
      activeDirectorId: null,
      directorProgress: {
        creative: "not-started",
        rd: "not-started",
        programming: "not-started",
        validation: "not-started",
        currentDirector: null,
      },
      creativeFocusMode: null,
      rdFocusMode: null,
      validationFocusMode: null,
      danInternalNotes: [],
      danSideNotes: [],
      danDraftCoreDetails: null,
      danDraftChangeSummary: [],
      danDraftStatus: null,
      danArchivedNotes: [],
      deletedNotes: [],
      pingTaskContext: null,
      pongTaskContext: null,
      projectCategory: "general-project",
      slackMessages: [],
      slackActiveDirectorId: "project-manager",
      slackPresenceGuestId: null,
      pendingApprovals: [],
      directorSettingsOverrides: {},
      directorStateMap: {},
      danMemory: {
        softMemory: [],
        hardMemory: null,
        backupMemory: [],
        hardMemoryUpdatedAt: null,
        latestReportId: null,
        confirmedConcept: null,
        draftConcept: null,
        derivedConcept: null,
        notes: [],
        derivedNotes: [],
        sideNotes: [],
        draftChangeSummary: [],
        draftStatus: null,
        derivedUpdatedAt: null,
        fullExperienceDescription: null,
        archivedNotes: [],
        deletedNotes: [],
        rawMemories: [],
        forgottenMemories: [],
        creativeHistory: [],
        toddHandoffNotes: [],
        threads: [],
      },
      toddMemory: {
        softMemory: [],
        hardMemory: null,
        backupMemory: [],
        hardMemoryUpdatedAt: null,
        latestReportId: null,
        confirmedConcept: null,
        roadmap: null,
        currentState: null,
        endStateGoal: null,
        successChain: [],
        nextUpdate: null,
        futureUpdatePlan: [],
        previousUpdateLog: [],
        troubleLog: [],
        codebaseIndexedMap: null,
        notes: [],
        pendingHandoff: null,
        backupNotes: [],
      },
      pingMemory: {
        activeUpdateId: null,
        activeTask: null,
        context: null,
        codebaseMapSummary: null,
        latestPlanReport: null,
        latestIndexedMap: null,
        latestRawReport: null,
        latestJeffReport: null,
        currentRun: null,
      },
      jeffMemory: {
        softMemory: [],
        hardMemory: null,
        backupMemory: [],
        hardMemoryUpdatedAt: null,
        latestReportId: null,
        pendingReports: [],
        pendingValidations: [],
        outcomeLog: [],
        managerSummary: null,
        projectStatusHistory: [],
        currentProjectStatus: null,
        notes: [],
        backupNotes: [],
      },
      pongMemory: {
        jeffInstruction: null,
        validationRequest: null,
        previousValidationReports: [],
        latestValidationReport: null,
        screenshotPaths: [],
      },
      automation: buildDefaultAutomationState(),
    });
  }

  private async getOrCreateAgentSession(projectId: string, provider: AiProvider): Promise<AgentSession> {
    const existing = await this.store.getAgentSession(projectId);
    return existing ? syncAgentMemories(existing) : this.createEmptyAgentSession(projectId, provider);
  }

  private async saveAgentSession(projectId: string, session: AgentSession): Promise<void> {
    syncAgentMemories(session);
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId, session });
  }

  private buildApprovalSummary(prefix: string, detail: string): string {
    const normalizedDetail = detail.trim().replace(/\s+/g, " ");
    if (!normalizedDetail) {
      return prefix;
    }
    const clipped = normalizedDetail.length > 160 ? `${normalizedDetail.slice(0, 157).trimEnd()}...` : normalizedDetail;
    return `${prefix}: ${clipped}`;
  }

  private buildPingTaskReportContent(task: PingTaskSnapshot): string {
    if (task.updateTitle && task.updateDescription) {
      return `Task Report for Ping: ${task.updateTitle}. ${task.updateDescription} Confirm before PROGRAMS starts the planning pass.`;
    }
    return `Task Report for Ping: ${task.originalUserRequest} Confirm before PROGRAMS starts the planning pass.`;
  }

  private appendPingTaskReportMessage(session: AgentSession, task: PingTaskSnapshot): AgentChatMessage {
    return this.appendSlackAssistantMessage(
      session,
      "rd-director",
      this.buildPingTaskReportContent(task),
      {
        status: "complete",
        metadata: { type: "ping-task", task },
      },
    );
  }

  private buildToddPingHandoffMessage(updateTitle: string, updateDescription: string): string {
    return `I’m ready to hand Ping one specific update: ${updateTitle}. ${updateDescription} Confirm and I’ll start the planning + execution loop.`;
  }

  private normalizePassivePingGuestId(directorId: DirectorId | null | undefined): DirectorId | null {
    return directorId && directorId !== "project-manager" && directorId !== "programming-director"
      ? directorId
      : null;
  }

  private isSamePingTaskSnapshot(
    existingTask: PingTaskSnapshot | null | undefined,
    nextTask: PingTaskSnapshot,
  ): boolean {
    if (!existingTask) {
      return false;
    }

    if (existingTask.source !== nextTask.source) {
      return false;
    }

    if (existingTask.updateId || nextTask.updateId) {
      return existingTask.updateId === nextTask.updateId;
    }

    return existingTask.originalUserRequest === nextTask.originalUserRequest
      && existingTask.toddExplanation === nextTask.toddExplanation
      && existingTask.updateTitle === nextTask.updateTitle
      && existingTask.updateDescription === nextTask.updateDescription
      && existingTask.runtime.provider === nextTask.runtime.provider
      && existingTask.runtime.model === nextTask.runtime.model
      && existingTask.runtime.claudeModel === nextTask.runtime.claudeModel;
  }

  private seedPingStartupState(
    session: AgentSession,
    task: PingTaskSnapshot,
    usageBefore: UsageCapture | null,
    options: { appendMessages?: boolean } = {},
  ): void {
    const currentTask = task.updateTitle && task.updateDescription
      ? `${task.updateTitle}: ${task.updateDescription}`
      : task.updateTitle ?? task.originalUserRequest;
    const passiveGuestId = this.normalizePassivePingGuestId(session.slackPresenceGuestId);
    const existingRun = this.isSamePingTaskSnapshot(session.pingMemory.currentRun?.task, task)
      ? session.pingMemory.currentRun
      : null;

    session.pingTaskContext = {
      currentTask,
      lastResult: session.pingTaskContext?.lastResult ?? null,
      lastFailureReason: session.pingTaskContext?.lastFailureReason ?? null,
      toddUpdateExplanation: task.toddExplanation ?? task.updateDescription ?? task.originalUserRequest,
      relevantPillarIds: task.relevantPillarIds ?? [],
    };
    session.pingMemory.activeUpdateId = task.updateId ?? null;
    session.pingMemory.activeTask = currentTask;
    session.pingMemory.context = task.toddExplanation ?? task.updateDescription ?? task.originalUserRequest;
    session.pingMemory.codebaseMapSummary = task.toddCodebaseMapSummary;
    session.pingMemory.latestRawReport = null;
    session.pingMemory.latestJeffReport = null;
    session.pingMemory.currentRun = {
      task,
      plan: existingRun?.plan ?? null,
      report: existingRun?.report ?? null,
      usageBefore: usageBefore ?? existingRun?.usageBefore ?? null,
      usageAfter: existingRun?.usageAfter ?? null,
      validationReport: existingRun?.validationReport ?? null,
    };
    session.slackActiveDirectorId = "programming-director";
    session.slackPresenceGuestId = passiveGuestId;

    if (options.appendMessages !== false) {
      this.appendSlackAssistantMessage(
        session,
        "programming-director",
        buildPingAcknowledgementText(task),
        {
          status: "complete",
          metadata: null,
        },
      );
      this.appendSlackAssistantMessage(session, "programming-director", "", {
        status: "working",
        metadata: null,
      });
    }
  }

  private buildHardMemoryReportMetadata(input: {
    directorId: Extract<DirectorId, "creative-director" | "rd-director">;
    dataType: HardMemoryReportDataType;
    approvalId: string | null;
    reportStage?: "soft" | "hard";
    summary: string;
    currentState: string | null;
    idealState: string | null;
    changeSummary?: string[];
    draftCoreDetails?: AgentCoreDetails | null;
    roadmap?: ToddRoadmap | null;
    roadmapVersions?: VersionPlan[] | null;
    versionUpdates?: HardMemoryReportUpdate[] | null;
    createdAt?: string;
  }): HardMemoryReportMetadata {
    return {
      type: "hard-memory-report",
      dataType: input.dataType,
      directorId: input.directorId,
      approvalId: input.approvalId,
      reportStage: input.reportStage ?? "hard",
      summary: input.summary,
      currentState: input.currentState,
      idealState: input.idealState,
      changeSummary: input.changeSummary ?? [],
      draftCoreDetails: input.draftCoreDetails ?? null,
      roadmap: input.roadmap ?? null,
      roadmapVersions: input.roadmapVersions ?? null,
      versionUpdates: input.versionUpdates ?? null,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
  }

  private buildToddHardMemoryReportSnapshot(
    session: AgentSession,
    summary: string,
    createdAt?: string,
  ): HardMemoryReportMetadata {
    return this.buildHardMemoryReportMetadata({
      directorId: "rd-director",
      dataType: "toddRoadmap",
      approvalId: null,
      reportStage: "hard",
      summary,
      currentState: session.toddMemory.currentState ?? null,
      idealState: session.toddMemory.endStateGoal ?? null,
      roadmap: getToddRoadmap(session),
      createdAt,
    });
  }

  private appendToddHardMemoryReportMessage(
    session: AgentSession,
    summary: string,
    createdAt?: string,
  ): AgentChatMessage {
    const message = this.appendSlackAssistantMessage(
      session,
      "rd-director",
      summary,
      {
        status: "complete",
        metadata: this.buildToddHardMemoryReportSnapshot(session, summary, createdAt),
      },
    );
    session.toddMemory.latestReportId = message.id;
    return message;
  }

  private queueApproval(
    session: AgentSession,
    input: {
      kind: PendingApprovalKind;
      requestedByDirectorId: DirectorId | null;
      targetDirectorId: DirectorId | null;
      summary: string;
      draftMessage?: string | null;
      draftPayload?: Record<string, unknown> | null;
    },
  ): PendingApproval {
    return createPendingApproval(session, input);
  }

  private queueToddUpdatePlanApproval(
    session: AgentSession,
    input: {
      summary: string;
      draftMessage: string;
      updates: VersionUpdate[];
      currentState: string | null;
      idealState: string | null;
      planSource: ToddUpdatePlanSource;
      supersedesConfirmedPlan: boolean;
    },
  ): PendingApproval {
    session.pendingApprovals = (session.pendingApprovals ?? []).filter((approval) => !(
      approval.requestedByDirectorId === "rd-director"
      && approval.kind === "store-data"
      && isToddUpdatePlanDraftPayload(approval.draftPayload ?? null)
    ));

    return this.queueApproval(session, {
      kind: "store-data",
      requestedByDirectorId: "rd-director",
      targetDirectorId: "rd-director",
      summary: input.summary,
      draftMessage: input.draftMessage,
      draftPayload: buildToddUpdatePlanDraftPayload({
        updates: input.updates,
        currentState: input.currentState,
        idealState: input.idealState,
        planSource: input.planSource,
        supersedesConfirmedPlan: input.supersedesConfirmedPlan,
      }) as unknown as Record<string, unknown>,
    });
  }

  private findPendingApprovalByAction(
    session: AgentSession,
    action: string,
    predicate?: (payload: Record<string, unknown>) => boolean,
  ): PendingApproval | null {
    return session.pendingApprovals.find((approval) => {
      if (approval.status !== "pending") {
        return false;
      }
      const payload = approval.draftPayload;
      if (!payload || payload.action !== action) {
        return false;
      }
      return predicate ? predicate(payload) : true;
    }) ?? null;
  }

  private parseDraftPayloadText(text: string | null | undefined): Record<string, unknown> | null {
    if (text == null) {
      return null;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Approval payload is not valid JSON: ${message}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Approval payload must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  }

  private appendSlackSystemMessage(session: AgentSession, content: string): AgentChatMessage {
    const message: AgentChatMessage = {
      id: randomUUID(),
      role: "system",
      directorId: null,
      content,
      createdAt: new Date().toISOString(),
    };
    session.slackMessages.push(message);
    return message;
  }

  private queueSlackDirectorApproval(
    session: AgentSession,
    input: {
      requestedByDirectorId: DirectorId;
      targetDirectorId: DirectorId;
      provider: AiProvider;
      model: AgentChatDirectorApprovalPayload["model"];
      claudeModel: AgentChatDirectorApprovalPayload["claudeModel"];
      message: string;
      mode?: AgentChatDirectorMode;
    },
  ): PendingApproval {
    const descriptor = buildAgentChatApprovalDescriptor({
      targetDirectorId: input.targetDirectorId,
      provider: input.provider,
      model: input.model,
      claudeModel: input.claudeModel,
      message: input.message,
      mode: input.mode,
    });

    return this.queueApproval(session, {
      kind: descriptor.kind,
      requestedByDirectorId: input.requestedByDirectorId,
      targetDirectorId: input.targetDirectorId,
      summary: this.buildApprovalSummary(descriptor.summaryPrefix, input.message),
      draftMessage: input.message,
      draftPayload: descriptor.payload as unknown as Record<string, unknown>,
    });
  }

  private async getAgentChatProviderPreflightErrors(settings: Settings): Promise<Record<AiProvider, string | null>> {
    const [codexStatus, claudeStatus] = await Promise.all([
      this.codex.getAuthStatus(settings),
      this.claude.getAuthStatus(settings),
    ]);

    return {
      codex: getProviderPreflightError("codex", codexStatus),
      claude: getProviderPreflightError("claude", claudeStatus),
    };
  }

  private appendSlackAssistantMessage(
    session: AgentSession,
    directorId: DirectorId,
    content: string,
    extra: {
      status?: AgentChatMessage["status"];
      metadata?: AgentChatMessage["metadata"];
    } = {},
  ): AgentChatMessage {
    const message: AgentChatMessage = {
      id: randomUUID(),
      role: "assistant",
      directorId,
      content,
      createdAt: new Date().toISOString(),
      status: extra.status,
      metadata: extra.metadata ?? null,
    };
    session.slackMessages.push(message);

    // Mirror to the director's individual agent chat conversation
    this.mirrorSlackMessageToAgentChat(session, directorId, message);

    return message;
  }

  private mirrorSlackMessageToAgentChat(
    session: AgentSession,
    directorId: DirectorId,
    slackMsg: AgentChatMessage,
  ): void {
    const conv = ensureDirectorConversationRecord(session, directorId);
    const agentMsg: StageAgentMessage = {
      id: slackMsg.id,
      role: "assistant",
      content: slackMsg.content,
      createdAt: slackMsg.createdAt,
      status: slackMsg.status,
      metadata: (slackMsg.metadata as StageAgentMessage["metadata"]) ?? null,
    };
    conv.messages.push(agentMsg);
    session.unifiedMessages.push(agentMsg);
  }

  private replaceDirectorConversationMessage(
    session: AgentSession,
    directorId: DirectorId,
    nextMessage: StageAgentMessage,
  ): StageAgentMessage {
    const conv = ensureDirectorConversationRecord(session, directorId);
    const convIndex = conv.messages.findIndex((message) => message.id === nextMessage.id);
    if (convIndex >= 0) {
      conv.messages[convIndex] = nextMessage;
    }
    const unifiedIndex = session.unifiedMessages.findIndex((message) => message.id === nextMessage.id);
    if (unifiedIndex >= 0) {
      session.unifiedMessages[unifiedIndex] = nextMessage;
    }
    return nextMessage;
  }

  private replaceSlackAssistantMessage(
    session: AgentSession,
    directorId: DirectorId,
    nextMessage: AgentChatMessage,
  ): AgentChatMessage {
    const slackIndex = session.slackMessages.findIndex((message) => message.id === nextMessage.id);
    if (slackIndex >= 0) {
      session.slackMessages[slackIndex] = nextMessage;
    }
    this.replaceDirectorConversationMessage(session, directorId, {
      id: nextMessage.id,
      role: "assistant",
      content: nextMessage.content,
      createdAt: nextMessage.createdAt,
      status: nextMessage.status,
      metadata: (nextMessage.metadata as StageAgentMessage["metadata"]) ?? null,
    });
    return nextMessage;
  }

  private findLatestSlackAssistantMessage(
    session: AgentSession,
    directorId: DirectorId,
    predicate?: (message: AgentChatMessage) => boolean,
  ): AgentChatMessage | null {
    for (let index = session.slackMessages.length - 1; index >= 0; index -= 1) {
      const message = session.slackMessages[index];
      if (message.role !== "assistant" || message.directorId !== directorId) {
        continue;
      }
      if (!predicate || predicate(message)) {
        return message;
      }
    }
    return null;
  }

  /** Sync a mutated Slack message (e.g. working→complete) to its agent chat mirror. */
  private syncSlackMessageToAgentChat(
    session: AgentSession,
    directorId: DirectorId,
    slackMsg: AgentChatMessage,
  ): void {
    const conv = ensureDirectorConversationRecord(session, directorId);
    const mirror = conv.messages.find((m) => m.id === slackMsg.id);
    if (!mirror) return;
    mirror.content = slackMsg.content;
    mirror.status = slackMsg.status;
    mirror.createdAt = slackMsg.createdAt;
    mirror.metadata = (slackMsg.metadata as StageAgentMessage["metadata"]) ?? null;
  }

  private appendPingLifecycleMessage(
    session: AgentSession,
    phase: "intro" | "outro",
  ): AgentChatMessage {
    const text = phase === "intro"
      ? getDirectorMetadata("programming-director").introMessage
      : getDirectorMetadata("programming-director").outroMessage;
    return this.appendSlackAssistantMessage(session, "programming-director", text, {
      status: "complete",
      metadata: buildPingLifecycleTranslationMetadata(phase, text),
    });
  }

  private appendJeffSlackMessage(
    session: AgentSession,
    content: string,
    report?: JeffExecutionReport | null,
  ): AgentChatMessage {
    return this.appendSlackAssistantMessage(session, "project-manager", content, {
      status: "complete",
      metadata: report ? { type: "execution-report", report } : null,
    });
  }

  private async tryStartSlackPingExecution(args: {
    session: AgentSession;
    project: Project;
    provider: AiProvider;
    model: string;
    claudeModel: string;
    directorId: DirectorId;
  }): Promise<AgentChatMessage | null> {
    const {
      session,
      project,
      provider,
      model,
      claudeModel,
      directorId,
    } = args;

    if (directorId !== "programming-director") {
      return null;
    }

    syncAgentMemories(session);

    // Find an active or next pending update from Todd's plan
    const update = resolveNextProgrammingUpdate(session, null);
    if (!update) {
      return null;
    }

    const pingDefaults = resolveDirectorRuntime(session, "programming-director");
    const task = buildToddApprovedPingTaskSnapshot(session, {
      projectId: project.id,
      update,
      provider,
      model,
      claudeModel,
      reasoningEffort: pingDefaults.reasoningEffort,
      planningMode: pingDefaults.planningMode,
    });

    const existingApproval = this.findPendingApprovalByAction(
      session,
      "routeUpdateToProgramming",
      (payload) => {
        const payloadInput = isRecord(payload.input) ? payload.input : null;
        return payloadInput?.updateId === update.id;
      },
    );
    if (!existingApproval) {
      this.appendPingTaskReportMessage(session, task);
      this.queueApproval(session, {
        kind: "agent-update",
        requestedByDirectorId: "rd-director",
        targetDirectorId: "rd-director",
        summary: this.buildApprovalSummary("Confirm Ping update run", `${update.title}: ${update.description}`),
        draftMessage: `Ping is lined up to implement "${update.title}". Confirm before PROGRAMS spends tokens on the planning + coding pass.`,
        draftPayload: {
          action: "routeUpdateToProgramming",
          input: {
            projectId: project.id,
            updateId: update.id,
            provider,
            model,
            claudeModel,
          } satisfies RouteUpdateToProgrammingInput,
        },
      });
    }

    const executionMessage = this.appendSlackAssistantMessage(
      session,
      "rd-director",
      this.buildToddPingHandoffMessage(update.title, update.description),
      { status: "complete" },
    );
    session.slackActiveDirectorId = "rd-director";
    session.slackPresenceGuestId = "rd-director";
    await this.saveAgentSession(project.id, session);

    return executionMessage;
  }

  private async stageSlackDirectorIntroSequence(
    session: AgentSession,
    projectId: string,
    directorId: DirectorId,
  ): Promise<AgentChatMessage> {
    const responsePlaceholder = this.appendSlackAssistantMessage(session, directorId, "", { status: "working" });
    await this.saveAgentSession(projectId, session);
    return responsePlaceholder;
  }

  private applySlackDirectorStateSnapshot(
    session: AgentSession,
    directorId: DirectorId,
    parsed: Record<string, unknown>,
  ): void {
    const currentState = normalizeNonEmptyString(parsed.currentState);
    const idealState = normalizeNonEmptyString(parsed.idealState);
    if (currentState == null && idealState == null) {
      return;
    }

    const existing = session.directorStateMap?.[directorId];
    persistDirectorStateSnapshot(session, directorId, {
      currentState: currentState ?? existing?.currentState ?? null,
      idealState: idealState ?? existing?.idealState ?? null,
      assumptions: existing?.assumptions ?? [],
    });
  }

  private removeDanDraftApprovals(session: AgentSession): void {
    session.pendingApprovals = (session.pendingApprovals ?? []).filter((approval) => {
      const payload = approval.draftPayload ?? {};
      return !(
        approval.kind === "store-data"
        && approval.requestedByDirectorId === "creative-director"
        && payload.action === "applyStoredData"
        && payload.dataType === "danDraftCoreDetails"
      );
    });
  }

  private queueDanDraftApproval(
    session: AgentSession,
    parsed: Record<string, unknown>,
  ): PendingApproval | null {
    if (!session.danDraftCoreDetails) {
      return null;
    }

    this.removeDanDraftApprovals(session);
    const changeDetail = session.danDraftChangeSummary.length > 0
      ? session.danDraftChangeSummary.join(" | ")
      : sanitizeSlackResponseContent(parsed.response, "creative-director");

    return this.queueApproval(session, {
      kind: "store-data",
      requestedByDirectorId: "creative-director",
      targetDirectorId: "creative-director",
      summary: this.buildApprovalSummary("Confirm Dan core-details draft", changeDetail),
      draftMessage: sanitizeSlackResponseContent(parsed.response, "creative-director"),
      draftPayload: {
        action: "applyStoredData",
        dataType: "danDraftCoreDetails",
        draftCoreDetails: session.danDraftCoreDetails,
        draftChangeSummary: session.danDraftChangeSummary,
        currentState: normalizeNonEmptyString(parsed.currentState),
        idealState: normalizeNonEmptyString(parsed.idealState),
      },
    });
  }

  private applyDanSharedTurnState(
    session: AgentSession,
    parsed: Record<string, unknown>,
    options: { allowHardMemoryProcessing?: boolean } = {},
  ): DanSharedTurnResult {
    const allowHardMemoryProcessing = options.allowHardMemoryProcessing ?? false;
    const notesToAppend = Array.isArray(parsed.notesToAppend)
      ? parsed.notesToAppend.filter((note): note is string => typeof note === "string" && note.trim().length > 0)
      : [];
    const conversationStatus = normalizeDanConversationStatus(parsed.conversationStatus);
    const draftCoreDetails = normalizeDanDraftCoreDetails(parsed.draftCoreDetails);
    const draftOperations = normalizeDanDraftOperations(parsed.draftOperations);
    const draftChangeSummary = Array.isArray(parsed.draftChangeSummary)
      ? parsed.draftChangeSummary.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const presenceAction = normalizeDanPresenceAction(parsed.presenceAction);
    const toddHandoffNotesToAppend = Array.isArray(parsed.toddHandoffNotesToAppend)
      ? parsed.toddHandoffNotesToAppend.filter((note): note is string => typeof note === "string" && note.trim().length > 0)
      : [];
    const draftUpdated = Boolean(draftCoreDetails) || draftOperations.length > 0;

    session.danMemory.notes = mergeTaggedNotes(session.danMemory.notes, notesToAppend);
    session.danMemory.toddHandoffNotes = mergeTaggedNotes(session.danMemory.toddHandoffNotes ?? [], toddHandoffNotesToAppend, "handoff-to-todd");
    session.danMemory.draftStatus = conversationStatus;

    if (draftCoreDetails) {
      const nextDraftConcept = buildDanDraftCoreDetailsState(session, draftCoreDetails);
      session.danMemory.draftConcept = hasCoreDetailsContent(nextDraftConcept) ? nextDraftConcept : null;
    } else if (draftOperations.length > 0) {
      session.danMemory.draftConcept = applyDanDraftOperationsState(session, draftOperations);
    }
    if (draftChangeSummary.length > 0) {
      session.danMemory.draftChangeSummary = mergeTrimmedNotes(draftChangeSummary);
    }

    // Raw memories: link raw user inputs to the latest draft names when possible.
    session.danMemory.rawMemories = session.danMemory.rawMemories ?? [];
    const rawMemorySeedPillars = session.danMemory.draftConcept?.corePillars?.length
      ? session.danMemory.draftConcept.corePillars
      : getDanConfirmedConcept(session)?.corePillars?.length
        ? getDanConfirmedConcept(session)!.corePillars
        : session.corePillars;
    const rawMemories = normalizeRawMemoriesToAppend(parsed.rawMemoriesToAppend, collectExistingPillarsByName(rawMemorySeedPillars));
    if (rawMemories.length > 0) {
      session.danMemory.rawMemories.push(...rawMemories);
    }

    const idealState = session.danMemory.draftConcept
      ? summarizeDanDraftIdealState(
          session.danMemory.draftConcept,
          normalizeNonEmptyString(parsed.idealState),
        )
      : normalizeNonEmptyString(parsed.idealState) ?? session.directorStateMap?.["creative-director"]?.idealState ?? null;
    persistDirectorStateSnapshot(session, "creative-director", {
      currentState: null,
      idealState,
      assumptions: [],
    });
    session.danMemory.fullExperienceDescription = idealState;

    syncAgentMemories(session);

    let hardMemoryApprovalId: string | null = null;
    if (allowHardMemoryProcessing && conversationStatus === "ready-to-confirm" && session.danMemory.draftConcept) {
      hardMemoryApprovalId = this.queueDanDraftApproval(session, parsed)?.id ?? null;
    } else {
      this.removeDanDraftApprovals(session);
    }

    return {
      presenceAction,
      hardMemoryApprovalId,
      draftUpdated,
      consumedToddHandoff: false,
    };
  }

  private async runSlackDirectorTurn(args: {
    session: AgentSession;
    project: Project;
    settings: Settings;
    provider: AiProvider;
    model: string;
    claudeModel: string;
    directorId: DirectorId;
    userMessage: string;
    mode?: AgentChatDirectorMode;
  }): Promise<{
    assistantMessage: AgentChatMessage;
    parsed: Record<string, unknown>;
  }> {
    const {
      session,
      project,
      settings,
      provider,
      model,
      claudeModel,
      directorId,
      userMessage,
      mode = "codebase-analysis",
    } = args;

    session.slackMessages = session.slackMessages ?? [];
    session.slackActiveDirectorId = directorId;
    session.slackPresenceGuestId = directorId === "project-manager" ? null : directorId;
    session.directorSettingsOverrides = session.directorSettingsOverrides ?? {};
    session.directorStateMap = session.directorStateMap ?? {};
    session.danInternalNotes = session.danInternalNotes ?? [];
    session.danSideNotes = session.danSideNotes ?? [];
    session.danDraftCoreDetails = session.danDraftCoreDetails ?? null;
    session.danDraftChangeSummary = session.danDraftChangeSummary ?? [];
    session.danDraftStatus = session.danDraftStatus ?? null;
    session.danArchivedNotes = session.danArchivedNotes ?? [];
    syncAgentMemories(session);

    const isTodd = directorId === "rd-director";
    const researchMode = isTodd && mode === "internet-research";
    const schema = directorId === "creative-director"
      ? danAgentChatSchema
      : directorId === "programming-director"
        ? pingAgentChatSchema
      : researchMode
        ? researchAgentChatSchema
        : directorAgentChatSchema;
    const prompt = buildReworkedAgentChatDirectorPrompt(directorId, project.name, session, { mode });
    let hardMemoryReportMetadata: HardMemoryReportMetadata | null = null;

    const responsePlaceholder = directorId === "programming-director"
      ? await this.stageSlackDirectorIntroSequence(session, project.id, directorId)
      : this.appendSlackAssistantMessage(session, directorId, "", { status: "working" });
    if (directorId !== "programming-director") {
      await this.saveAgentSession(project.id, session);
    }

    const directorLabel = DIRECTOR_NAMES[directorId] ?? "Agent";
    const cleanJson = (raw: string): Record<string, unknown> =>
      parseAgentJsonResponse<Record<string, unknown>>(raw, {
        agentLabel: directorLabel,
        context: "director turn",
      });

    const providerLabels: Record<AiProvider, string> = {
      codex: "Codex",
      claude: "Claude",
    };
    const preflightErrors = await this.getAgentChatProviderPreflightErrors(settings);
    const attemptPlan = buildAgentChatProviderAttemptPlan(provider, preflightErrors);
    const failures: Array<{ provider: AiProvider; reason: string }> = [];
    const reasoningEffort = resolveDirectorRuntime(session, directorId).reasoningEffort;
    // Hard memory processing only activates in the guided memory-processing stage, not direct chat
    const allowDanHardMemoryProcessing = shouldAllowDanHardMemory(undefined);
    const consumeToddHandoff = shouldConsumeToddPendingHandoff(mode, undefined);

    for (const attemptProvider of attemptPlan.attemptedProviders) {
      try {
        hardMemoryReportMetadata = null;
        const service = this.aiService(attemptProvider);
        const requestedModels = resolveDirectorRequestedModels(
          session,
          directorId,
          model as StartPlanInput["model"],
          claudeModel as StartPlanInput["claudeModel"],
        );
        const modelSelection = resolveDirectorModelSelection(
          directorId,
          attemptProvider,
          requestedModels.model,
          requestedModels.claudeModel,
          resolveDirectorModelUseCase(directorId, mode, undefined),
        );
        const resolvedModel = attemptProvider === "claude"
          ? modelSelection.claudeModel
          : modelSelection.model;
        const toddCodexOpts = researchMode ? { networkAccess: true } : undefined;
        const toddClaudeOpts = researchMode ? { allowedTools: "WebSearch,WebFetch", maxTurns: 10 } : undefined;
        const rawResult = await service.runOneShot(
          project,
          settings,
          prompt,
          resolvedModel,
          schema,
          reasoningEffort,
          attemptProvider === "claude" ? toddClaudeOpts : toddCodexOpts,
        );
        const parsed = validateAgentChatTurnParsedResponse(cleanJson(rawResult), directorId, mode);
        const response = sanitizeSlackResponseContent(parsed.response, directorId);
        const responseCreatedAt = new Date().toISOString();
        let assistantContent = response;
        let assistantMetadata: AgentChatMessage["metadata"] = null;
        let danPresenceAction: DanPresenceAction = "exit";

        if (directorId === "creative-director") {
          const danTurnState = this.applyDanSharedTurnState(session, parsed, {
            allowHardMemoryProcessing: allowDanHardMemoryProcessing,
          });
          danPresenceAction = danTurnState.presenceAction;
          if ((danTurnState.draftUpdated || session.danMemory.draftStatus === "ready-to-confirm") && session.danMemory.draftConcept) {
            const isConfirmed = allowDanHardMemoryProcessing && session.danMemory.draftStatus === "ready-to-confirm";
            hardMemoryReportMetadata = this.buildHardMemoryReportMetadata({
              directorId: "creative-director",
              dataType: isConfirmed ? "danCoreDetails" : "danDraftCoreDetails",
              reportStage: isConfirmed ? "hard" : "soft",
              approvalId: danTurnState.hardMemoryApprovalId,
              summary: sanitizeSlackResponseContent(parsed.response, "creative-director"),
              currentState: normalizeNonEmptyString(parsed.currentState),
              idealState: normalizeNonEmptyString(parsed.idealState),
              changeSummary: session.danMemory.draftChangeSummary,
              draftCoreDetails: isConfirmed ? session.danMemory.draftConcept : null,
              createdAt: responseCreatedAt,
            });
          }
        } else if (directorId === "programming-director") {
          const status = parsed.status === "blocked" || parsed.status === "unexpected" || parsed.status === "no_changes"
            ? parsed.status as PingRawReportStatus
            : "success";
          const activeUpdateId = session.pingMemory.activeUpdateId ?? null;
          const activeUpdate = activeUpdateId
            ? session.toddMemory.futureUpdatePlan.find((update) => update.id === activeUpdateId) ?? null
            : null;
          const rawReportPayload = parsed.rawReport && typeof parsed.rawReport === "object"
            ? parsed.rawReport as Record<string, unknown>
            : null;
          const enTranslation = typeof parsed.enTranslation === "string" ? parsed.enTranslation : response;
          const rawReport = buildPingRawReport({
            status,
            updateId: activeUpdate?.id ?? null,
            goal: activeUpdate?.description ?? null,
            summary: typeof rawReportPayload?.summary === "string" ? rawReportPayload.summary : enTranslation,
            changedFiles: Array.isArray(rawReportPayload?.changedFiles)
              ? rawReportPayload.changedFiles.filter((item: unknown): item is string => typeof item === "string")
              : [],
            blocker: typeof rawReportPayload?.blocker === "string" ? rawReportPayload.blocker : null,
            unexpectedNotes: Array.isArray(rawReportPayload?.unexpectedNotes)
              ? rawReportPayload.unexpectedNotes.filter((item: unknown): item is string => typeof item === "string")
              : [],
          });
          session.pingMemory.latestRawReport = rawReport;
          session.pingMemory.latestJeffReport = null;
          session.pingTaskContext = {
            currentTask: activeUpdate ? session.pingMemory.activeTask : null,
            lastResult: rawReport.summary,
            lastFailureReason: rawReport.blocker,
            toddUpdateExplanation: activeUpdate?.description ?? null,
            relevantPillarIds: activeUpdate?.pillarIds ?? [],
          };
          this.applySlackDirectorStateSnapshot(session, directorId, parsed);
          assistantContent = typeof parsed.zhResponse === "string" && parsed.zhResponse.trim()
            ? parsed.zhResponse
            : response;
          assistantMetadata = buildPingStatusTranslationMetadata(status);
        } else {
          // Todd soft-memory: process notesToAppend and clear pending handoff
          if (directorId === "rd-director") {
            const toddNotesToAppend = Array.isArray(parsed.notesToAppend)
              ? parsed.notesToAppend.filter((note): note is string => typeof note === "string" && note.trim().length > 0)
              : [];
            session.toddMemory.notes = mergeTaggedNotes(session.toddMemory.notes ?? [], toddNotesToAppend);
            if (consumeToddHandoff) {
              syncAgentMemories(session);
            }
          }
          this.applySlackDirectorStateSnapshot(session, directorId, parsed);
        }

        if (directorId !== "programming-director") {
          assistantContent = response;
        }
        assistantMetadata = directorId === "programming-director"
          ? assistantMetadata
          : hardMemoryReportMetadata ?? (researchMode
            ? {
                type: "research-result",
                researchPrompt: userMessage,
                generalSummary: typeof parsed.generalSummary === "string" ? parsed.generalSummary : "",
                projectSummary: typeof parsed.projectSummary === "string" ? parsed.projectSummary : "",
              }
            : null);
        // Late-response guard: if the placeholder was already finalized by Stop (or a
        // restart-time orphan cleanup), discard this response rather than reviving a
        // typing bubble the user already dismissed.
        const placeholderLive = session.slackMessages.find((m) => m.id === responsePlaceholder.id);
        if (!placeholderLive || placeholderLive.status !== "working") {
          await this.saveAgentSession(project.id, session);
          return {
            assistantMessage: placeholderLive ?? responsePlaceholder,
            parsed,
          };
        }
        const assistantMessage = this.replaceSlackAssistantMessage(session, directorId, {
          ...responsePlaceholder,
          content: assistantContent,
          createdAt: responseCreatedAt,
          status: "complete",
          metadata: assistantMetadata,
        });
        const handoffTarget = coerceAllowedDirectorHandoff(
          directorId,
          normalizeDirectorId(typeof parsed.handoffTo === "string" ? parsed.handoffTo : null),
        );
        if (handoffTarget) {
          session.slackPresenceGuestId = handoffTarget === "project-manager" ? null : handoffTarget;
          session.slackActiveDirectorId = handoffTarget;
        } else if (directorId === "creative-director") {
          session.slackPresenceGuestId = danPresenceAction === "stay" ? "creative-director" : null;
          session.slackActiveDirectorId = danPresenceAction === "stay" ? "creative-director" : "project-manager";
        } else if (directorId === "programming-director") {
          session.slackPresenceGuestId = null;
          session.slackActiveDirectorId = "project-manager";
        } else {
          session.slackPresenceGuestId = directorId === "project-manager" ? null : directorId;
          session.slackActiveDirectorId = directorId;
        }
        if (directorId === "programming-director") {
          this.appendPingLifecycleMessage(session, "outro");
        }
        await this.saveAgentSession(project.id, session);
        return {
          assistantMessage,
          parsed,
        };
      } catch (error) {
        let reason: string;
        if (error instanceof AgentJsonParseError) {
          // Friendly message for the most common failure: agent replied with prose.
          reason = `returned conversational text instead of the required structured output`;
        } else if (error instanceof SyntaxError) {
          reason = "returned malformed output — please retry";
        } else {
          const rawMessage = error instanceof Error ? error.message : "Something went wrong.";
          // Strip raw SyntaxError noise if it leaked through a wrapped error.
          reason = /unexpected token|is not valid json/i.test(rawMessage)
            ? "returned malformed output — please retry"
            : rawMessage;
        }
        failures.push({ provider: attemptProvider, reason });
      }
    }

    // Guard: if Stop (or another path) already finalized the placeholder while we were
    // running, don't overwrite it with a failure message.
    const placeholderStillWorking = session.slackMessages.some(
      (m) => m.id === responsePlaceholder.id && m.status === "working",
    );
    if (!placeholderStillWorking) {
      session.slackPresenceGuestId = null;
      session.slackActiveDirectorId = "project-manager";
      await this.saveAgentSession(project.id, session);
      throw new Error(`${DIRECTOR_NAMES[directorId]} run was interrupted before a response could be produced.`);
    }

    const details: string[] = [];
    if (attemptPlan.requestedProviderError) {
      details.push(`${providerLabels[provider]} unavailable: ${attemptPlan.requestedProviderError}`);
    }
    for (const failure of failures) {
      details.push(`${providerLabels[failure.provider]} ${failure.reason}`);
    }
    if (
      attemptPlan.fallbackProvider
      && attemptPlan.fallbackProvider !== provider
      && attemptPlan.fallbackProviderError
      && !failures.some((failure) => failure.provider === attemptPlan.fallbackProvider)
    ) {
      details.push(`${providerLabels[attemptPlan.fallbackProvider]} unavailable: ${attemptPlan.fallbackProviderError}`);
    }

    const finalError = details.length > 0
      ? `${DIRECTOR_NAMES[directorId]} could not reply. ${details.join(" ")}`
      : `${DIRECTOR_NAMES[directorId]} could not reply because no provider was ready.`;
    this.replaceSlackAssistantMessage(session, directorId, {
      ...responsePlaceholder,
      content: finalError,
      createdAt: new Date().toISOString(),
      status: "complete",
      metadata: null,
    });
    session.slackPresenceGuestId = null;
    session.slackActiveDirectorId = "project-manager";
    await this.saveAgentSession(project.id, session);
    throw new Error(finalError);
  }

  private async runSlackDirectorChain(args: {
    session: AgentSession;
    project: Project;
    settings: Settings;
    provider: AiProvider;
    model: string;
    claudeModel: string;
    directorId: DirectorId;
    userMessage: string;
    mode?: AgentChatDirectorMode;
  }): Promise<{
    message: AgentChatMessage;
    handoffTo: DirectorId | null;
    handoffReason: string | null;
    chainedMessages: AgentChatMessage[];
  }> {
    let currentDirectorId = args.directorId;
    let currentMessage = args.userMessage;
    let currentMode = args.mode ?? resolveAgentChatDirectorMode(currentDirectorId, currentMessage);
    let primaryMessage: AgentChatMessage | null = null;
    const chainedMessages: AgentChatMessage[] = [];
    let lastHandoffTo: DirectorId | null = null;
    let lastHandoffReason: string | null = null;

    for (let hop = 0; hop < AUTO_SLACK_HANDOFF_LIMIT; hop += 1) {
      const { assistantMessage, parsed } = await this.runSlackDirectorTurn({
        session: args.session,
        project: args.project,
        settings: args.settings,
        provider: args.provider,
        model: args.model,
        claudeModel: args.claudeModel,
        directorId: currentDirectorId,
        userMessage: currentMessage,
        mode: currentMode,
      });

      if (!primaryMessage) {
        primaryMessage = assistantMessage;
      } else {
        chainedMessages.push(assistantMessage);
      }

      lastHandoffTo = coerceAllowedDirectorHandoff(
        currentDirectorId,
        normalizeDirectorId(typeof parsed.handoffTo === "string" ? parsed.handoffTo : null),
      );
      lastHandoffReason = typeof parsed.handoffReason === "string" ? parsed.handoffReason : null;

      if (!lastHandoffTo || !canAutoRouteAgentChatDirector(lastHandoffTo) || lastHandoffTo === currentDirectorId) {
        break;
      }

      currentDirectorId = lastHandoffTo;
      currentMessage = lastHandoffReason ?? assistantMessage.content;
      currentMode = resolveAgentChatDirectorMode(currentDirectorId, currentMessage);
    }

    if (!primaryMessage) {
      throw new Error("Slack director chain did not produce a response.");
    }

    return {
      message: primaryMessage,
      handoffTo: lastHandoffTo,
      handoffReason: lastHandoffReason,
      chainedMessages,
    };
  }

  private async generateProjectCoreDetails(project: Project, settings: Settings, provider: AiProvider): Promise<void> {
    const existing = await this.store.getAgentSession(project.id);
    if (
      existing?.danMemory?.confirmedConcept
      || existing?.danMemory?.draftConcept
      || existing?.danMemory?.derivedConcept
    ) {
      return;
    }

    const service = this.aiService(provider);
    const model = provider === "claude" ? settings.advancedDefaults.claudeModel : settings.advancedDefaults.model;

    const prompt = `Analyze the project "${project.name}" and generate concise core details.

Project description: ${project.description}

Explore the codebase as needed, then produce:
- function: One sentence — what the software does for its users.
- thesis: One sentence — the core value proposition or design philosophy.
- corePillars: 2–5 named pillars (major features/subsystems), each with a one-sentence function and thesis.
- fullFlow: 2–3 sentences describing the primary user journey end-to-end.

Your final answer must be ONLY strict JSON (no markdown fences) matching:
{"function": string, "thesis": string, "corePillars": [{"name": string, "function": string, "thesis": string}], "fullFlow": string}`;

    const rawResult = await service.runOneShot(
      project,
      settings,
      prompt,
      model,
      generateCoreDetailsSchema,
      resolveDirectorRuntime(existing, "creative-director").reasoningEffort,
    );
    const parsed = parseAgentJsonResponse<Record<string, unknown>>(rawResult, {
      agentLabel: "Dan",
      context: "generate core details",
    }) as unknown as {
      function: string;
      thesis: string;
      corePillars: Array<{ name: string; function: string; thesis: string }>;
      fullFlow: string;
    };

    const session = existing ?? this.createEmptyAgentSession(project.id, provider);
    session.danMemory.derivedConcept = buildGeneratedCoreDetailsConcept({
      function: parsed.function,
      thesis: parsed.thesis,
      corePillars: parsed.corePillars as Array<{ name: string; function: string; thesis: string }>,
      fullFlow: parsed.fullFlow,
    });
    session.danMemory.derivedNotes = migrateToTaggedNotes([
      "Auto-derived from the current codebase to give Dan baseline project context.",
    ]);
    session.danMemory.derivedUpdatedAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString();

    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: project.id, session });
  }

  async confirmCoreDetail(projectId: string, field: "function" | "thesis" | "core_pillars" | "full_flow"): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(projectId);
    if (!session) throw new Error("No agent session found for this project.");

    if (session.stages[field].confirmed) {
      session.stages[field].confirmed.status = "confirmed";
    }

    if (field === "core_pillars") {
      for (const pillar of session.corePillars) {
        if (pillar.function?.status === "assumed" || pillar.function?.status === "edited") {
          pillar.function.status = "confirmed";
        }
        if (pillar.thesis?.status === "assumed" || pillar.thesis?.status === "edited") {
          pillar.thesis.status = "confirmed";
        }
      }
    }

    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId, session });
    return session;
  }

  async stageAgentChat(input: StageAgentChatInput): Promise<StageAgentChatResponse> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    await this.requireProviderReady(input.provider, settings);
    const project = await this.requireProject(input.projectId);

    let session = await this.store.getAgentSession(input.projectId);
    if (!session) {
      session = this.createEmptyAgentSession(input.projectId, input.provider);
    }
    session.provider = input.provider;

    const stage = input.stage ?? session.currentStage;

    const userMessage: StageAgentMessage = {
      id: randomUUID(),
      role: "user" as const,
      content: input.message,
      createdAt: new Date().toISOString(),
    };
    session.stages[stage].messages.push(userMessage);
    session.unifiedMessages.push(userMessage);

    const prompt = await buildAgentStagePrompt(stage, project.name, session);
    const service = this.aiService(input.provider);
    const model = input.provider === "claude" ? input.claudeModel : input.model;

    const rawResult = await service.runOneShot(
      project,
      settings,
      prompt,
      model,
      agentChatSchema,
    );
    const parsed = parseAgentJsonResponse<{
      response: string;
      confirmationSuggested?: boolean;
      suggestedSummary?: string | null;
    }>(rawResult, {
      agentLabel: "Agent",
      context: `stage ${stage} chat`,
    });

    const assistantMessage = {
      id: randomUUID(),
      role: "assistant" as const,
      content: parsed.response,
      createdAt: new Date().toISOString(),
    };
    session.stages[stage].messages.push(assistantMessage);
    session.unifiedMessages.push(assistantMessage);
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });

    return {
      sessionId: session.id,
      message: assistantMessage,
      confirmationSuggested: parsed.confirmationSuggested ?? false,
      suggestedConfirmation: parsed.suggestedSummary
        ? { summary: parsed.suggestedSummary }
        : null,
    };
  }

  private async agentExecuteUpdateNow(
    input: AgentExecuteUpdateInput,
    options: { planningMode?: PlanningMode; usageBefore?: UsageCapture | null } = {},
  ): Promise<{ started: true }> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");

    const update = resolveNextProgrammingUpdate(session, input.updateId);
    if (!update) throw new Error("No pending programming update found.");

    const programmingDefaults = resolveDirectorRuntime(session, "programming-director");
    const planningMode = options.planningMode ?? programmingDefaults.planningMode;
    const pingModelSelections = resolvePingRunModelSelections(
      session,
      input.provider,
      input.model,
      input.claudeModel,
    );
    const pingTaskSnapshot = buildToddApprovedPingTaskSnapshot(session, {
      projectId: input.projectId,
      update,
      provider: input.provider,
      model: input.model,
      claudeModel: input.claudeModel,
      reasoningEffort: programmingDefaults.reasoningEffort,
      planningMode,
    });

    const trackedUpdate = upsertToddTrackedUpdate(session, {
      ...update,
      status: "in_progress",
    });
    this.seedPingStartupState(session, pingTaskSnapshot, options.usageBefore ?? null);
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });

    const roadmap = getToddRoadmap(session);
    const nextUpdate = buildToddNextUpdateFromExecutionContext({
      update: trackedUpdate,
      nextUpdate: session.toddMemory.nextUpdate,
      priorityUpdate: roadmap?.priorityUpdate ?? null,
      currentState: session.toddMemory.currentState,
    });
    const planInput: StartPlanInput = {
      projectId: input.projectId,
      provider: input.provider,
      prompt: buildPingUpdatePrompt({
        nextUpdate,
        currentStateItems: roadmap?.currentState ?? [],
        priorityUpdate: roadmap?.priorityUpdate ?? null,
      }),
      speed: "normal",
      model: pingModelSelections.planning.model,
      claudeModel: pingModelSelections.planning.claudeModel,
      reasoningEffort: programmingDefaults.reasoningEffort,
      planningMode,
      autoApprove: planningMode === "auto",
      contextPaths: [],
      usageBefore: options.usageBefore ?? null,
      pingTaskSnapshot,
    };

    return this.startPlanNow(planInput);
  }

  async startPingDirectUpdate(input: StartPingDirectUpdateInput): Promise<{ started: true }> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    const project = await this.requireProject(input.projectId);
    const message = input.message.trim();
    if (!message) {
      throw new Error("Describe the update you want Ping to make first.");
    }

    const session = await this.getOrCreateAgentSession(input.projectId, settings.advancedDefaults.provider);
    await this.decorateAgentSessionKnowledgeState(session);
    if (session.knowledgeStatus !== "fresh") {
      throw new Error(session.knowledgeReasons?.[0] ?? "Todd's technical understanding is stale. Refresh the project from Jeff before sending Ping.");
    }
    const pingDefaults = resolveDirectorRuntime(session, "programming-director");
    const runProvider = input.runMode === "manual"
      ? input.provider ?? settings.advancedDefaults.provider
      : settings.advancedDefaults.provider;
    const requestedModel = input.runMode === "manual"
      ? input.model ?? settings.advancedDefaults.model
      : settings.advancedDefaults.model;
    const requestedClaudeModel = input.runMode === "manual"
      ? input.claudeModel ?? settings.advancedDefaults.claudeModel
      : settings.advancedDefaults.claudeModel;
    const pingModelSelections = resolvePingRunModelSelections(
      session,
      runProvider,
      requestedModel,
      requestedClaudeModel,
    );
    const runtime: PingRuntimeSnapshot = {
      provider: runProvider,
      model: pingModelSelections.execution.model,
      claudeModel: pingModelSelections.execution.claudeModel,
      reasoningEffort: input.runMode === "manual"
        ? input.reasoningEffort ?? pingDefaults.reasoningEffort
        : pingDefaults.reasoningEffort,
      planningMode: input.runMode === "manual"
        ? input.planningMode ?? pingDefaults.planningMode
        : pingDefaults.planningMode,
      contextPaths: Array.from(new Set(input.contextPaths ?? [])),
    };

    session.provider = runtime.provider;
    session.activeDirectorId = "rd-director";
    const conversation = ensureDirectorConversationRecord(session, "rd-director");
    const userMessage: StageAgentMessage = {
      id: randomUUID(),
      role: "user",
      content: message,
      createdAt: new Date().toISOString(),
    };
    conversation.messages.push(userMessage);
    conversation.lastActiveAt = userMessage.createdAt;
    session.unifiedMessages.push(userMessage);
    if (session.directorProgress.programming === "not-started") {
      session.directorProgress.programming = "in-progress";
      session.directorProgress.currentDirector = "programming-director";
    }
    const planInput: StartPlanInput = {
      projectId: project.id,
      provider: runtime.provider,
      prompt: message,
      speed: runtime.provider === "codex" ? settings.defaultSpeed : "normal",
      model: pingModelSelections.planning.model,
      claudeModel: pingModelSelections.planning.claudeModel,
      reasoningEffort: runtime.reasoningEffort,
      planningMode: runtime.planningMode,
      autoApprove: runtime.planningMode === "auto",
      contextPaths: runtime.contextPaths,
      pingTaskSnapshot: buildPingTaskSnapshot({
        source: "direct-ping-request",
        projectId: project.id,
        originalUserRequest: message,
        toddCodebaseMapSummary: session.toddMemory.codebaseIndexedMap?.summary ?? null,
        coreDetailsContext: formatCoreDetails(session) || null,
        runtime,
      }),
    };
    const pingTaskSnapshot = planInput.pingTaskSnapshot;

    const existingApproval = this.findPendingApprovalByAction(
      session,
      "startPlan",
      (payload) => {
        const payloadInput = isRecord(payload.input) ? payload.input : null;
        return payloadInput?.projectId === project.id
          && payloadInput?.prompt === message;
      },
    );
    if (!existingApproval && pingTaskSnapshot) {
      this.appendPingTaskReportMessage(session, pingTaskSnapshot);
      this.queueApproval(session, {
        kind: "agent-update",
        requestedByDirectorId: "rd-director",
        targetDirectorId: "rd-director",
        summary: this.buildApprovalSummary("Confirm direct Ping update", message),
        draftMessage: "Ping is ready to start the planning and code pass for this direct request. Confirm before PROGRAMS spends tokens on the big-model run.",
        draftPayload: {
          action: "startPlan",
          input: planInput,
        },
      });
      this.appendSlackAssistantMessage(
        session,
        "rd-director",
        "I’m ready to hand Ping this focused update. Confirm and I’ll start the planning + execution loop.",
        { status: "complete" },
      );
    }

    session.updatedAt = userMessage.createdAt;
    await this.saveAgentSession(input.projectId, session);
    return { started: true };
  }


  async deleteAgentSession(projectId: string): Promise<void> {
    await this.ensureInitialized();
    await this.store.deleteAgentSession(projectId);
    this.emit({ type: "agent.session", projectId, session: null });
  }


  // --- Director System Methods ---

  async directorChat(input: DirectorChatInput): Promise<DirectorChatResponse> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    await this.requireProviderReady(input.provider, settings);
    const project = await this.requireProject(input.projectId);

    if (
      input.runtimeStage === "memory-processing"
      && (input.directorId === "creative-director" || input.directorId === "rd-director")
    ) {
      throw new Error("Hard-memory processing must stay behind the approval flow before PROGRAMS starts the large-model pass.");
    }

    let session = await this.store.getAgentSession(input.projectId);
    if (!session) {
      session = this.createEmptyAgentSession(input.projectId, input.provider);
    }
    const resolvedFocusMode = input.directorId === "rd-director" && input.runtimeStage === "memory-processing"
      ? resolveToddMemoryProcessingFocusMode(session)
      : resolveDirectorChatFocusMode(input.directorId, input.message, input.focusMode);
    session.provider = input.provider;
    session.activeDirectorId = input.directorId;
    session.danInternalNotes = session.danInternalNotes ?? [];
    session.danSideNotes = session.danSideNotes ?? [];
    session.danDraftChangeSummary = session.danDraftChangeSummary ?? [];
    session.danDraftCoreDetails = session.danDraftCoreDetails ?? null;
    session.danDraftStatus = session.danDraftStatus ?? null;

    // Update focus mode on session
    if (input.directorId === "creative-director" && resolvedFocusMode) {
      session.creativeFocusMode = resolvedFocusMode as CreativeFocusMode;
    } else if (input.directorId === "rd-director" && resolvedFocusMode) {
      session.rdFocusMode = resolvedFocusMode as RdFocusMode;
    } else if (input.directorId === "validation-director" && resolvedFocusMode) {
      session.validationFocusMode = resolvedFocusMode as ValidationFocusMode;
    }

    // Ensure this director has a conversation record
    if (!session.directorConversations[input.directorId]) {
      session.directorConversations[input.directorId] = {
        directorId: input.directorId,
        focusMode: resolvedFocusMode,
        messages: [],
        lastActiveAt: null,
      };
    }
    const conv = session.directorConversations[input.directorId];
    conv.focusMode = resolvedFocusMode;
    const userMessage = {
      id: randomUUID(),
      role: "user" as const,
      content: input.message,
      createdAt: new Date().toISOString(),
    };
    conv.messages.push(userMessage);
    conv.lastActiveAt = new Date().toISOString();
    session.unifiedMessages.push(userMessage);

    // Update director progress tracking
    if (input.directorId === "creative-director" && session.directorProgress.creative === "not-started") {
      session.directorProgress.creative = "in-progress";
      session.directorProgress.currentDirector = input.directorId;
    } else if (input.directorId === "rd-director" && session.directorProgress.rd === "not-started") {
      session.directorProgress.rd = "in-progress";
      session.directorProgress.currentDirector = input.directorId;
    } else if (input.directorId === "programming-director" && session.directorProgress.programming === "not-started") {
      session.directorProgress.programming = "in-progress";
      session.directorProgress.currentDirector = input.directorId;
    } else if (input.directorId === "validation-director" && session.directorProgress.validation === "not-started") {
      session.directorProgress.validation = "in-progress";
      session.directorProgress.currentDirector = input.directorId;
    }

    const prompt = buildDirectorPrompt(input.directorId, resolvedFocusMode, project.name, session);
    const service = this.aiService(input.provider);
    const requestedModels = resolveDirectorRequestedModels(
      session,
      input.directorId,
      input.model,
      input.claudeModel,
    );
    const modelSelection = resolveDirectorModelSelection(
      input.directorId,
      input.provider,
      requestedModels.model,
      requestedModels.claudeModel,
      resolveDirectorModelUseCase(input.directorId, resolvedFocusMode, input.runtimeStage),
    );
    const model = input.provider === "claude" ? modelSelection.claudeModel : modelSelection.model;
    const schema = getSchemaForDirector(input.directorId, resolvedFocusMode);

    // Emit intro message before AI call
    const introMsg: StageAgentMessage = {
      id: randomUUID(),
      role: "assistant" as const,
      content: "",
      createdAt: new Date().toISOString(),
      status: "working",
    };
    conv.messages.push(introMsg);
    session.unifiedMessages.push(introMsg);
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });

    const rawResult = await service.runOneShot(
      project,
      settings,
      prompt,
      model,
      schema,
      resolveDirectorRuntime(session, input.directorId).reasoningEffort,
    );
    const parsedJson = parseAgentJsonResponse<any>(rawResult, {
      agentLabel: DIRECTOR_NAMES[input.directorId] ?? "Director",
      context: "director chat",
    });
    const parsed = input.directorId === "creative-director" || input.directorId === "validation-director"
      ? validateAgentChatTurnParsedResponse(parsedJson, input.directorId, resolvedFocusMode as any)
      : parsedJson;

    const assistantCreatedAt = new Date().toISOString();
    let assistantContent = input.directorId === "validation-director" && typeof parsed.zhResponse === "string"
      ? parsed.zhResponse
      : sanitizeSlackResponseContent(parsed.response, input.directorId);
    let assistantMetadata: StageAgentMessage["metadata"] = input.directorId === "validation-director"
      ? buildTranslatedMessageMetadata(
        assistantContent,
        typeof parsed.enTranslation === "string" ? parsed.enTranslation : parsed.response,
      )
      : null;

    // Process structured data from director response
    let routeSuggestion: DirectorChatResponse["routeSuggestion"] = null;
    let structuredData: DirectorStructuredData | null = null;
    let internalNotes: string[] | null = null;
    let suggestCreateProject = false;
    let hardMemoryReportMetadata: HardMemoryReportMetadata | null = null;
    const allowDanHardMemoryProcessing = shouldAllowDanHardMemory(input.runtimeStage);
    const consumeToddHandoff = shouldConsumeToddPendingHandoff(resolvedFocusMode, input.runtimeStage);

    // Jeff — routing
    if (input.directorId === "project-manager" && parsed.routeTo) {
      const routeTo = coerceAllowedDirectorHandoff(
        "project-manager",
        normalizeDirectorId(parsed.routeTo as string),
      );
      if (routeTo) {
        routeSuggestion = { directorId: routeTo, reason: parsed.routeReason ?? "" };
      }
    }

    if (input.directorId === "creative-director") {
      const danTurnState = this.applyDanSharedTurnState(session, parsed, {
        allowHardMemoryProcessing: allowDanHardMemoryProcessing,
      });
      internalNotes = session.danInternalNotes;
      if ((danTurnState.draftUpdated || session.danMemory.draftStatus === "ready-to-confirm") && session.danMemory.draftConcept) {
        const isConfirmed = allowDanHardMemoryProcessing && session.danMemory.draftStatus === "ready-to-confirm";
        hardMemoryReportMetadata = this.buildHardMemoryReportMetadata({
          directorId: "creative-director",
          dataType: isConfirmed ? "danCoreDetails" : "danDraftCoreDetails",
          reportStage: isConfirmed ? "hard" : "soft",
          approvalId: danTurnState.hardMemoryApprovalId,
          summary: sanitizeSlackResponseContent(parsed.response, "creative-director"),
          currentState: normalizeNonEmptyString(parsed.currentState),
          idealState: normalizeNonEmptyString(parsed.idealState),
          changeSummary: session.danMemory.draftChangeSummary,
          draftCoreDetails: isConfirmed ? session.danMemory.draftConcept : null,
          createdAt: assistantCreatedAt,
        });
      }
      const handoffTo = coerceAllowedDirectorHandoff(
        "creative-director",
        normalizeDirectorId(typeof parsed.handoffTo === "string" ? parsed.handoffTo : null),
      );
      if (handoffTo) {
        routeSuggestion = {
          directorId: handoffTo,
          reason: typeof parsed.handoffReason === "string" ? parsed.handoffReason : "",
        };
      }
    }

    // Todd soft-memory: process notesToAppend and clear pending handoff
    if (input.directorId === "rd-director") {
      const toddNotesToAppend = Array.isArray(parsed.notesToAppend)
        ? (parsed.notesToAppend as unknown[]).filter((note): note is string => typeof note === "string" && note.trim().length > 0)
        : [];
      session.toddMemory.notes = mergeTaggedNotes(session.toddMemory.notes ?? [], toddNotesToAppend);
      // Queue roadmap for approval when Todd provides one with confirmationSuggested
      const rawRoadmapFromChat = parsed.roadmap && typeof parsed.roadmap === "object"
        ? parsed.roadmap as Record<string, unknown>
        : null;
      if (rawRoadmapFromChat && parsed.confirmationSuggested === true) {
        const roadmapApprovalSummary = this.buildApprovalSummary(
          "Confirm Todd's roadmap",
          typeof parsed.response === "string" ? parsed.response : "Todd has proposed a roadmap update.",
        );
        session.pendingApprovals = (session.pendingApprovals ?? []).filter((approval) => !(
          approval.requestedByDirectorId === "rd-director"
          && approval.kind === "store-data"
          && approval.draftPayload?.dataType === "toddRoadmap"
        ));
        this.queueApproval(session, {
          kind: "store-data",
          requestedByDirectorId: "rd-director",
          targetDirectorId: "rd-director",
          summary: roadmapApprovalSummary,
          draftMessage: typeof parsed.response === "string" ? parsed.response : null,
          draftPayload: {
            action: "applyStoredData",
            dataType: "toddRoadmap",
            roadmap: rawRoadmapFromChat,
          },
        });
      }
      const handoffTo = coerceAllowedDirectorHandoff(
        "rd-director",
        normalizeDirectorId(typeof parsed.handoffTo === "string" ? parsed.handoffTo : null),
      );
      if (handoffTo) {
        routeSuggestion = {
          directorId: handoffTo,
          reason: typeof parsed.handoffReason === "string" ? parsed.handoffReason : "",
        };
      }
      this.applySlackDirectorStateSnapshot(session, input.directorId, parsed);
      if (consumeToddHandoff) {
        syncAgentMemories(session);
      }
    }

    // Todd — Research mode: feasibility assessments
    if (input.directorId === "rd-director" && resolvedFocusMode === "research" && parsed.feasibilityAssessments) {
      const assessments: FeasibilityAssessment[] = parsed.feasibilityAssessments.map((a: { area: string; assessment: string; stackRecommendation?: string | null; complexity: string; costNotes?: string | null }) => ({
        id: randomUUID(),
        area: a.area,
        assessment: a.assessment,
        stackRecommendation: a.stackRecommendation ?? null,
        complexity: a.complexity as FeasibilityAssessment["complexity"],
        costNotes: a.costNotes ?? null,
        status: "assumed" as const,
      }));
      structuredData = { type: "feasibility", assessments };
      this.queueApproval(session, {
        kind: "store-data",
        requestedByDirectorId: input.directorId,
        targetDirectorId: input.directorId,
        summary: this.buildApprovalSummary("Confirm feasibility notes", parsed.response),
        draftMessage: parsed.response,
        draftPayload: {
          action: "applyStoredData",
          dataType: "feasibilityAssessments",
          assessments: [...session.feasibilityAssessments, ...assessments],
        },
      });
    }

    // Ping — minimal execution status only
    if (input.directorId === "programming-director") {
      const status = parsed.status === "blocked" || parsed.status === "unexpected" || parsed.status === "no_changes"
        ? parsed.status as PingRawReportStatus
        : "success";
      const rawReportPayload = parsed.rawReport && typeof parsed.rawReport === "object"
        ? parsed.rawReport as Record<string, unknown>
        : null;
      const enTranslation = typeof parsed.enTranslation === "string" ? parsed.enTranslation : parsed.response;
      const rawReport = buildPingRawReport({
        status,
        updateId: session.pingMemory.activeUpdateId ?? null,
        goal: session.pingMemory.context ?? null,
        summary: typeof rawReportPayload?.summary === "string" ? rawReportPayload.summary : enTranslation,
        changedFiles: Array.isArray(rawReportPayload?.changedFiles)
          ? rawReportPayload.changedFiles.filter((item: unknown): item is string => typeof item === "string")
          : [],
        blocker: typeof rawReportPayload?.blocker === "string" ? rawReportPayload.blocker : null,
        unexpectedNotes: Array.isArray(rawReportPayload?.unexpectedNotes)
          ? rawReportPayload.unexpectedNotes.filter((item: unknown): item is string => typeof item === "string")
          : [],
      });
      session.pingMemory.latestRawReport = rawReport;
      session.pingMemory.latestJeffReport = null;
      session.pingTaskContext = {
        currentTask: session.pingMemory.activeTask,
        lastResult: rawReport.summary,
        lastFailureReason: rawReport.blocker,
        toddUpdateExplanation: session.pingMemory.context,
        relevantPillarIds: session.pingTaskContext?.relevantPillarIds ?? [],
      };
      assistantContent = typeof parsed.zhResponse === "string" && parsed.zhResponse.trim()
        ? parsed.zhResponse
        : assistantContent;
      assistantMetadata = buildPingStatusTranslationMetadata(rawReport.status);
    }

    // Pong — Test mode: validation results
    if (input.directorId === "validation-director" && resolvedFocusMode === "test-current-state" && parsed.validationPassed != null) {
      const result: ValidationResult = {
        id: randomUUID(),
        updateId: "",
        validationType: "functional",
        passed: parsed.validationPassed,
        summary: parsed.validationSummary ?? "",
        details: parsed.validationDetails ?? "",
        screenshotPaths: [],
        createdAt: new Date().toISOString(),
      };
      structuredData = { type: "validationResult", result };
      this.queueApproval(session, {
        kind: "store-data",
        requestedByDirectorId: input.directorId,
        targetDirectorId: input.directorId,
        summary: this.buildApprovalSummary("Confirm validation result", result.summary || parsed.response),
        draftMessage: parsed.response,
        draftPayload: {
          action: "applyStoredData",
          dataType: "validationResults",
          results: [...session.validationResults, result],
        },
      });
    }

    // Pong — Compare mode: comparison
    if (input.directorId === "validation-director" && resolvedFocusMode === "compare" && parsed.passed != null) {
      structuredData = {
        type: "comparison",
        passed: parsed.passed,
        improvementAreas: parsed.improvementAreas ?? [],
        summary: parsed.comparisonSummary ?? "",
      };
    }

    // Pong — Identify Goal mode: goal summary
    if (input.directorId === "validation-director" && resolvedFocusMode === "identify-goal" && parsed.goalSummary) {
      structuredData = {
        type: "goalSummary",
        summary: parsed.goalSummary,
        pillarIds: parsed.relevantPillarIds ?? [],
      };
    }

    if (hardMemoryReportMetadata) {
      assistantMetadata = hardMemoryReportMetadata;
    }

    const assistantMessage = this.replaceDirectorConversationMessage(session, input.directorId, {
      ...introMsg,
      content: assistantContent,
      createdAt: assistantCreatedAt,
      status: "complete",
      metadata: assistantMetadata,
    });

    // Derive project category
    session.projectCategory = this.deriveProjectCategoryFromSession(session);

    session.updatedAt = new Date().toISOString();
    syncAgentMemories(session);
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });

    return {
      sessionId: session.id,
      directorId: input.directorId,
      message: assistantMessage,
      routeSuggestion,
      structuredData,
      internalNotes,
      suggestCreateProject,
    };
  }

  async agentChat(input: AgentChatInput): Promise<AgentChatResponse> {

    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    const project = await this.requireProject(input.projectId);

    const session = await this.getOrCreateAgentSession(input.projectId, input.provider);
    session.slackMessages = session.slackMessages ?? [];
    session.slackActiveDirectorId = session.slackActiveDirectorId ?? "project-manager";
    session.slackPresenceGuestId = session.slackPresenceGuestId ?? null;
    session.pendingApprovals = session.pendingApprovals ?? [];
    session.directorSettingsOverrides = session.directorSettingsOverrides ?? {};
    session.directorStateMap = session.directorStateMap ?? {};
    session.provider = input.provider;

    const userMessage: AgentChatMessage = {
      id: randomUUID(),
      role: "user",
      directorId: null,
      content: input.message,
      createdAt: new Date().toISOString(),
    };
    session.slackMessages.push(userMessage);

    const currentDirectorId: DirectorId =
      input.targetDirectorId && input.targetDirectorId !== "project-manager"
        ? rerouteRestrictedAgentTarget(input.targetDirectorId) ?? "project-manager"
        : resolveAgentChatDirectRoute(
          input.message,
          session.slackActiveDirectorId !== "project-manager" ? session.slackActiveDirectorId : null,
        ) ?? "project-manager";
    const initialMode = currentDirectorId === "project-manager"
      ? "codebase-analysis"
      : resolveAgentChatDirectorMode(currentDirectorId, input.message);
    if (requiresApprovalForSlackDirectorRun(currentDirectorId, initialMode)) {
      const existingApproval = this.findPendingApprovalByAction(
        session,
        "runSlackDirector",
        (payload) =>
          payload.directorId === currentDirectorId
          && payload.mode === initialMode
          && payload.message === input.message,
      );
      if (!existingApproval) {
        this.queueSlackDirectorApproval(session, {
          requestedByDirectorId: currentDirectorId,
          targetDirectorId: currentDirectorId,
          provider: input.provider,
          model: input.model,
          claudeModel: input.claudeModel,
          message: input.message,
          mode: initialMode,
        });
      }
      const queuedMessage = this.appendSlackAssistantMessage(
        session,
        currentDirectorId,
        initialMode === "internet-research"
          ? "I can research that next. Confirm and I'll run the internet + codebase pass."
          : initialMode === "version-planning"
            ? "I can lock down the next version plan. Confirm and I'll run the roadmap pass."
            : "I can break this into the next concrete update plan. Confirm and I'll run the planning pass.",
        { status: "complete" },
      );
      session.slackActiveDirectorId = currentDirectorId;
      session.slackPresenceGuestId = currentDirectorId === "project-manager" ? null : currentDirectorId;
      await this.saveAgentSession(project.id, session);
      return {
        sessionId: session.id,
        directorId: currentDirectorId,
        message: queuedMessage,
        handoffTo: null,
        handoffReason: null,
        chainedMessages: [],
      };
    }
    const executionMessage = await this.tryStartSlackPingExecution({
      session,
      project,
      provider: input.provider,
      model: input.model,
      claudeModel: input.claudeModel,
      directorId: currentDirectorId,
    });
    if (executionMessage) {
      return {
        sessionId: session.id,
        directorId: currentDirectorId,
        message: executionMessage,
        handoffTo: null,
        handoffReason: null,
        chainedMessages: [],
      };
    }
    const firstTurn = await this.runSlackDirectorTurn({
      session,
      project,
      settings,
      provider: input.provider,
      model: input.model,
      claudeModel: input.claudeModel,
      directorId: currentDirectorId,
      userMessage: input.message,
      mode: initialMode,
    });
    const message = firstTurn.assistantMessage;
    const handoffTo = coerceAllowedDirectorHandoff(
      currentDirectorId,
      normalizeDirectorId(typeof firstTurn.parsed.handoffTo === "string" ? firstTurn.parsed.handoffTo : null),
    );
    const handoffReason = typeof firstTurn.parsed.handoffReason === "string" ? firstTurn.parsed.handoffReason : null;
    const chainedMessages: AgentChatMessage[] = [];
    if (currentDirectorId === "rd-director" && handoffTo) {
      const nextMessage = handoffReason ?? message.content;
      const handled = await this.handleToddSpecialistHandoff({
        projectId: project.id,
        session,
        handoffTo,
        message: nextMessage,
        provider: input.provider,
        model: input.model,
        claudeModel: input.claudeModel,
      });
      if (handled) {
        await this.saveAgentSession(project.id, session);
        return {
          sessionId: session.id,
          directorId: currentDirectorId,
          message,
          handoffTo,
          handoffReason,
          chainedMessages,
        };
      }
    }
    if (handoffTo && canAutoRouteAgentChatDirector(handoffTo) && handoffTo !== currentDirectorId) {
      const nextMessage = handoffReason ?? message.content;
      const handoffMode = resolveAgentChatDirectorMode(handoffTo, nextMessage);
      this.appendJeffSlackMessage(
        session,
        `${DIRECTOR_NAMES[handoffTo]}, let's lock this down around ${clipMemoryText(nextMessage, 220)}.`,
      );
      if (requiresApprovalForSlackDirectorRun(handoffTo, handoffMode)) {
        const existingApproval = this.findPendingApprovalByAction(
          session,
          "runSlackDirector",
          (payload) =>
            payload.directorId === handoffTo
            && payload.mode === handoffMode
            && payload.message === nextMessage,
        );
        if (!existingApproval) {
          this.queueSlackDirectorApproval(session, {
            requestedByDirectorId: "project-manager",
            targetDirectorId: handoffTo,
            provider: input.provider,
            model: input.model,
            claudeModel: input.claudeModel,
            message: nextMessage,
            mode: handoffMode,
          });
        }
        this.appendSlackAssistantMessage(
          session,
          handoffTo,
          handoffMode === "internet-research"
            ? "I can take that research pass next. Confirm and I'll start."
            : handoffMode === "version-planning"
              ? "I can take that version-planning pass next. Confirm and I'll start."
              : "I can take that update-planning pass next. Confirm and I'll start.",
          { status: "complete" },
        );
        session.slackActiveDirectorId = handoffTo;
        session.slackPresenceGuestId = handoffTo;
        await this.saveAgentSession(project.id, session);
        return {
          sessionId: session.id,
          directorId: currentDirectorId,
          message,
          handoffTo,
          handoffReason,
          chainedMessages,
        };
      }
      await this.saveAgentSession(project.id, session);
      const handoffExecutionMessage = await this.tryStartSlackPingExecution({
        session,
        project,
        provider: input.provider,
        model: input.model,
        claudeModel: input.claudeModel,
        directorId: handoffTo,
      });
      if (handoffExecutionMessage) {
        chainedMessages.push(handoffExecutionMessage);
      } else {
        const secondTurn = await this.runSlackDirectorTurn({
          session,
          project,
          settings,
          provider: input.provider,
          model: input.model,
          claudeModel: input.claudeModel,
          directorId: handoffTo,
          userMessage: nextMessage,
          mode: resolveAgentChatDirectorMode(handoffTo, nextMessage),
        });
        chainedMessages.push(secondTurn.assistantMessage);
      }
      this.appendJeffSlackMessage(
        session,
        `Locked in so far: ${DIRECTOR_NAMES[handoffTo]} wrapped the current step. Let me know if you want anything else before we move on.`,
      );
      await this.saveAgentSession(project.id, session);
    }

    return {
      sessionId: session.id,
      directorId: currentDirectorId,
      message,
      handoffTo,
      handoffReason,
      chainedMessages,
    };
  }

  async deleteAgentMessages(input: DeleteAgentMessagesInput): Promise<void> {

    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found");
    const idsToDelete = new Set(input.messageIds);
    session.slackMessages = session.slackMessages.filter((m) => !idsToDelete.has(m.id));
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });
  }

  async clearAgentMessages(projectId: string): Promise<void> {

    await this.ensureInitialized();
    const session = await this.store.getAgentSession(projectId);
    if (!session) throw new Error("No agent session found");
    session.slackMessages = [];
    session.slackActiveDirectorId = "rd-director";
    session.slackPresenceGuestId = "rd-director";
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId, session });
  }

  /**
   * Finalize any assistant messages that are currently in the `working` state
   * for a project. Invoked when the user clicks the Stop button in the agents
   * chat so that the three-dot typing bubble disappears immediately, even if
   * an underlying CLI run is still streaming. Any late-arriving agent response
   * will be discarded by the late-response guard in runSlackDirectorTurn.
   */
  async finalizeWorkingAgentMessages(projectId: string): Promise<AgentSession | null> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(projectId);
    if (!session) return null;

    const stoppedAt = new Date().toISOString();
    let changed = false;

    const finalize = (messages: Array<{ role?: string; status?: string; content?: string; createdAt?: string }> | undefined): void => {
      if (!Array.isArray(messages)) return;
      for (const message of messages) {
        if (message && message.role === "assistant" && message.status === "working") {
          message.status = "complete";
          if (typeof message.content !== "string" || !message.content.trim()) {
            message.content = "(Stopped)";
          }
          message.createdAt = stoppedAt;
          changed = true;
        }
      }
    };

    finalize(session.slackMessages);
    finalize(session.unifiedMessages);
    if (session.directorConversations) {
      for (const conv of Object.values(session.directorConversations)) {
        if (conv && Array.isArray(conv.messages)) {
          finalize(conv.messages);
        }
      }
    }

    if (changed) {
      session.slackPresenceGuestId = null;
      session.slackActiveDirectorId = "project-manager";
      session.updatedAt = stoppedAt;
      await this.store.saveAgentSession(session);
      this.emit({ type: "agent.session", projectId, session });
    }
    return session;
  }

  async readBasicAutomationStatus(): Promise<BasicAutomationStatus> {
    await this.ensureInitialized();
    return { ...this.basicAutomationStatus, skippedProjects: [...this.basicAutomationStatus.skippedProjects] };
  }

  private setBasicAutomationStatus(patch: Partial<BasicAutomationStatus>): void {
    this.basicAutomationStatus = {
      ...this.basicAutomationStatus,
      ...patch,
      skippedProjects: patch.skippedProjects
        ? [...patch.skippedProjects]
        : [...this.basicAutomationStatus.skippedProjects],
      updatedAt: new Date().toISOString(),
    };
    this.emit({ type: "automation.basic.status", status: this.basicAutomationStatus });
  }

  private syncBasicAutomationSettingsSignature(settings: Settings): void {
    const signature = JSON.stringify({
      projectIds: settings.automation.projectIds,
      note: settings.automation.note,
      provider: settings.automation.provider,
      model: settings.automation.model,
      claudeModel: settings.automation.claudeModel,
      reasoningEffort: settings.automation.reasoningEffort,
    });
    if (signature === this.basicAutomationLastSettingsSignature) {
      return;
    }
    this.basicAutomationLastSettingsSignature = signature;
    this.basicAutomationCompletedProjectIds.clear();
    this.basicAutomationCursor = 0;
  }

  private syncBasicAutomationForSettings(settings: Settings): void {
    if (!settings.automation.enabled) {
      this.setBasicAutomationStatus({
        state: "off",
        enabled: false,
        currentProjectId: null,
        pausedUntil: null,
        lastRunSummary: this.basicAutomationStatus.lastRunSummary,
        skippedProjects: [],
      });
      return;
    }

    this.syncBasicAutomationSettingsSignature(settings);
    if (!this.basicAutomationLoopPromise) {
      this.basicAutomationLoopPromise = this.runBasicAutomationLoop()
        .catch((error) => {
          this.setBasicAutomationStatus({
            state: "blocked",
            enabled: true,
            currentProjectId: null,
            pausedUntil: null,
            lastRunSummary: error instanceof Error ? error.message : "Automation stopped after an unexpected error.",
          });
        })
        .finally(() => {
          this.basicAutomationLoopPromise = null;
        });
    }
  }

  private async waitForBasicAutomationUsage(currentProjectId: string | null): Promise<boolean> {
    for (;;) {
      const settings = await this.store.readSettings();
      if (!settings.automation.enabled) {
        this.syncBasicAutomationForSettings(settings);
        return false;
      }

      const usage = await this.readUsage();
      const decision = resolveBasicAutomationUsagePause(
        usage,
        settings.automation.provider,
        settings.automation.usagePausePercent,
      );
      if (decision.allowed) {
        return true;
      }

      this.setBasicAutomationStatus({
        state: decision.state,
        enabled: true,
        currentProjectId,
        pausedUntil: decision.pausedUntil,
        lastRunSummary: decision.summary,
      });
      const waitUntil = decision.pausedUntil ? new Date(decision.pausedUntil).getTime() : NaN;
      const waitMs = Number.isFinite(waitUntil)
        ? Math.max(5_000, Math.min(BASIC_AUTOMATION_WAIT_POLL_MS, waitUntil - Date.now()))
        : BASIC_AUTOMATION_WAIT_POLL_MS;
      await delay(waitMs);
    }
  }

  private clearTerminalActivePlan(projectId: string): void {
    const activePlan = this.codex.getActivePlan(projectId) ?? this.claude.getActivePlan(projectId);
    if (!activePlan || (activePlan.status !== "completed" && activePlan.status !== "failed")) {
      return;
    }
    this.aiService(activePlan.provider).clearPlan(projectId);
  }

  private async getBasicAutomationRunnableProject(
    projects: Project[],
  ): Promise<{ project: Project | null; skippedProjects: BasicAutomationSkippedProject[] }> {
    const skippedProjects: BasicAutomationSkippedProject[] = [];
    if (projects.length === 0) {
      return { project: null, skippedProjects };
    }

    for (let offset = 0; offset < projects.length; offset += 1) {
      const index = (this.basicAutomationCursor + offset) % projects.length;
      const project = projects[index]!;
      if (this.basicAutomationCompletedProjectIds.has(project.id)) {
        skippedProjects.push({
          projectId: project.id,
          reason: "done",
          detail: "This project made no further changes for the current automation note.",
        });
        continue;
      }

      this.clearTerminalActivePlan(project.id);
      const activePlan = this.codex.getActivePlan(project.id) ?? this.claude.getActivePlan(project.id);
      if (activePlan && activePlan.status !== "completed" && activePlan.status !== "failed") {
        skippedProjects.push({
          projectId: project.id,
          reason: "active-plan",
          detail: "A manual plan or edit is already active for this project.",
        });
        continue;
      }

      const changedFiles = await this.git.readWorkingTreeChangedFiles(project.localPath);
      if (changedFiles.length > 0) {
        skippedProjects.push({
          projectId: project.id,
          reason: "dirty-worktree",
          detail: `${changedFiles.slice(0, 5).join(", ")}${changedFiles.length > 5 ? ` and ${changedFiles.length - 5} more` : ""}`,
        });
        continue;
      }

      this.basicAutomationCursor = (index + 1) % projects.length;
      return { project, skippedProjects };
    }

    return { project: null, skippedProjects };
  }

  private buildBasicAutomationPrompt(project: Project, note: string): string {
    return `You are running unattended overnight automation for "${project.name}".

User automation note:
${note.trim()}

Work from the current repository state. Choose exactly one focused, useful update that advances the note. Keep the scope small enough for one safe edit. If the note is already satisfied for this project, make no file changes and explain that no further work is needed. Do not ask follow-up questions.`;
  }

  private async runBasicAutomationProjectOnce(project: Project, settings: Settings): Promise<BasicAutomationRunResult> {
    await this.requireProviderReady(settings.automation.provider, settings);
    const service = this.aiService(settings.automation.provider);
    const input: StartPlanInput = {
      projectId: project.id,
      provider: settings.automation.provider,
      prompt: this.buildBasicAutomationPrompt(project, settings.automation.note),
      speed: settings.automation.provider === "codex" ? settings.defaultSpeed : "normal",
      model: settings.automation.model,
      claudeModel: settings.automation.claudeModel,
      reasoningEffort: settings.automation.reasoningEffort,
      planningMode: "auto",
      autoApprove: true,
      contextPaths: [],
      webEnabled: false,
      ultracode: false,
    };

    const planningProject = await this.updateProjectStatus(project, "planning", null);
    const draft = await service.startPlanningTurn(planningProject, settings, input);
    let latest = await this.requireProject(project.id);
    latest.threadId = draft.threadId;
    latest.updatedAt = new Date().toISOString();
    await this.store.updateProject(latest);
    this.emit({ type: "project.updated", project: latest });
    latest = await this.updateProjectStatus(latest, "awaitingApproval", null);

    if (!(await this.waitForBasicAutomationUsage(project.id))) {
      return { outcome: "no_changes", summary: "Automation stopped before editing." };
    }

    return this.executePlanAndPersist(latest, settings, draft);
  }

  private async runBasicAutomationLoop(): Promise<void> {
    for (;;) {
      const settings = await this.store.readSettings();
      if (!settings.automation.enabled) {
        this.syncBasicAutomationForSettings(settings);
        return;
      }
      this.syncBasicAutomationSettingsSignature(settings);

      if (!settings.automation.note.trim()) {
        this.setBasicAutomationStatus({
          state: "blocked",
          enabled: true,
          currentProjectId: null,
          pausedUntil: null,
          lastRunSummary: "Add an automation note before turning overnight automation on.",
          skippedProjects: [],
        });
        await delay(BASIC_AUTOMATION_IDLE_POLL_MS);
        continue;
      }

      if (settings.automation.projectIds.length === 0) {
        this.setBasicAutomationStatus({
          state: "idle",
          enabled: true,
          currentProjectId: null,
          pausedUntil: null,
          lastRunSummary: "Choose at least one starred project for automation.",
          skippedProjects: [],
        });
        await delay(BASIC_AUTOMATION_IDLE_POLL_MS);
        continue;
      }

      if (!(await this.waitForBasicAutomationUsage(null))) {
        return;
      }

      const projectsById = new Map((await this.store.listProjects()).map((project) => [project.id, project]));
      const selectedProjects = settings.automation.projectIds.flatMap((projectId) => {
        const project = projectsById.get(projectId);
        return project ? [project] : [];
      });
      const { project, skippedProjects } = await this.getBasicAutomationRunnableProject(selectedProjects);
      if (!project) {
        this.setBasicAutomationStatus({
          state: "idle",
          enabled: true,
          currentProjectId: null,
          pausedUntil: null,
          lastRunSummary: skippedProjects.length > 0
            ? "No selected project is runnable right now."
            : "No selected projects were found.",
          skippedProjects,
        });
        await delay(BASIC_AUTOMATION_IDLE_POLL_MS);
        continue;
      }

      this.setBasicAutomationStatus({
        state: "running",
        enabled: true,
        currentProjectId: project.id,
        pausedUntil: null,
        lastRunSummary: `Running one automated update for ${project.name}.`,
        skippedProjects,
      });

      try {
        const result = await this.runBasicAutomationProjectOnce(project, settings);
        if (result.outcome === "no_changes") {
          this.basicAutomationCompletedProjectIds.add(project.id);
        }
        this.setBasicAutomationStatus({
          state: "idle",
          enabled: true,
          currentProjectId: null,
          pausedUntil: null,
          lastRunSummary: `${project.name}: ${result.summary}`,
          skippedProjects,
        });
      } catch (error) {
        this.basicAutomationCompletedProjectIds.add(project.id);
        this.setBasicAutomationStatus({
          state: "paused",
          enabled: true,
          currentProjectId: null,
          pausedUntil: null,
          lastRunSummary: `${project.name}: ${error instanceof Error ? error.message : "Automation run failed."}`,
          skippedProjects,
        });
      }

      await delay(BASIC_AUTOMATION_RUN_SETTLE_MS);
    }
  }

  private patchAutomationState(
    session: AgentSession,
    patch: Partial<AutomationRunState>,
  ): void {
    session.automation = buildDefaultAutomationState({
      ...session.automation,
      ...patch,
      constraints: {
        ...(session.automation?.constraints ?? {}),
        ...(patch.constraints ?? {}),
      },
      updatedAt: new Date().toISOString(),
    });
  }

  private async stopAutomationWithReason(
    session: AgentSession,
    reason: AutomationStopReason,
    summary: string,
    status: AutomationRunState["status"] = "stopped",
  ): Promise<AgentSession> {
    this.patchAutomationState(session, {
      status,
      stopReason: reason,
      stopSummary: summary,
      currentStep: status === "completed" ? "idle" : "awaiting-user",
      completedAt: status === "completed" ? new Date().toISOString() : session.automation.completedAt,
      resumeRequired: reason === "restart-resume-required",
      nextUpdateId: null,
    });
    this.appendJeffSlackMessage(session, summary);
    await this.saveAgentSession(session.projectId, session);
    return session;
  }

  private async normalizeAutomationSessionsOnStartup(projects: Project[]): Promise<void> {
    for (const project of projects) {
      const session = await this.store.getAgentSession(project.id);
      if (!session) {
        continue;
      }
      syncAgentMemories(session);
      if (session.automation.status !== "running") {
        continue;
      }
      this.patchAutomationState(session, {
        status: "paused",
        stopReason: "restart-resume-required",
        stopSummary: "Automation paused because PROGRAMS restarted. Resume when you are ready.",
        currentStep: "awaiting-user",
        resumeRequired: true,
        nextUpdateId: null,
      });
      this.appendJeffSlackMessage(session, "Automation paused because PROGRAMS restarted. Resume when you are ready.");
      await this.store.saveAgentSession(session);
    }
  }

  async listAutomationTargets(input: ListAutomationTargetsInput): Promise<ListAutomationTargetsResponse> {
    await this.ensureInitialized();
    const session = await this.getOrCreateAgentSession(input.projectId, "codex");
    return listAutomationTargetCandidates(session);
  }

  async startAutomationRun(input: StartAutomationRunInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    const session = await this.getOrCreateAgentSession(input.projectId, settings.advancedDefaults.provider);
    const { candidate } = resolveAutomationTarget(session, input.targetUpdateId);
    if (!candidate) {
      throw new Error("That automation target is no longer available.");
    }
    if (candidate.draft || !candidate.available) {
      throw new Error(candidate.blockedReason ?? "Confirm Todd's update plan before starting automation.");
    }

    const now = new Date().toISOString();
    this.patchAutomationState(session, {
      status: "running",
      selectedTargetUpdateId: candidate.updateId,
      selectedTargetVersionId: candidate.versionId,
      inScopeUpdateIds: candidate.pathUpdateIds,
      constraints: input.constraints,
      stopReason: null,
      stopSummary: null,
      currentStep: "jeff",
      startedAt: now,
      lastResumedAt: now,
      completedAt: null,
      resumeRequired: false,
      nextUpdateId: candidate.pathUpdateIds[0] ?? candidate.updateId,
      pendingRevertReportId: null,
      pendingRevertHistoryUpdateId: null,
      pendingRevertCommitSha: null,
    });
    this.appendJeffSlackMessage(
      session,
      `Starting automation toward "${candidate.title}". I’ll move one update at a time until that target is reached or I need to stop.`,
    );
    await this.saveAgentSession(input.projectId, session);
    this.kickAutomationRun(input.projectId);
    return session;
  }

  async pauseAutomationRun(input: PauseAutomationRunInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) {
      throw new Error("No agent session found for this project.");
    }
    syncAgentMemories(session);
    this.patchAutomationState(session, {
      status: "paused",
      stopReason: "manual-pause",
      stopSummary: input.summary ?? "Automation paused.",
      currentStep: "awaiting-user",
      nextUpdateId: null,
      resumeRequired: false,
    });
    this.appendJeffSlackMessage(session, input.summary ?? "Automation paused.");
    await this.saveAgentSession(input.projectId, session);
    return session;
  }

  async resumeAutomationRun(projectId: string): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(projectId);
    if (!session) {
      throw new Error("No agent session found for this project.");
    }
    syncAgentMemories(session);
    if (!session.automation.selectedTargetUpdateId) {
      throw new Error("Automation has no target to resume.");
    }
    const now = new Date().toISOString();
    this.patchAutomationState(session, {
      status: "running",
      stopReason: null,
      stopSummary: null,
      currentStep: "jeff",
      lastResumedAt: now,
      resumeRequired: false,
    });
    this.appendJeffSlackMessage(session, "Resuming automation.");
    await this.saveAgentSession(projectId, session);
    this.kickAutomationRun(projectId);
    return session;
  }

  async stopAutomationRun(input: StopAutomationRunInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) {
      throw new Error("No agent session found for this project.");
    }
    syncAgentMemories(session);
    this.patchAutomationState(session, {
      status: "stopped",
      stopReason: "manual-stop",
      stopSummary: input.summary ?? "Automation stopped.",
      currentStep: "awaiting-user",
      nextUpdateId: null,
      resumeRequired: false,
    });
    this.appendJeffSlackMessage(session, input.summary ?? "Automation stopped.");
    await this.saveAgentSession(input.projectId, session);
    return session;
  }

  async requestAutomationFailureRecovery(input: RequestAutomationFailureRecoveryInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) {
      throw new Error("No agent session found for this project.");
    }
    syncAgentMemories(session);
    if (!session.automation.pendingRevertCommitSha || !session.automation.pendingRevertHistoryUpdateId) {
      throw new Error("There is no revertable failed update to recover from.");
    }

    const existing = (session.pendingApprovals ?? []).find((approval) => approval.draftPayload?.action === "automationFailureRecovery");
    if (!existing) {
      this.queueApproval(session, {
        kind: "outcome-decision",
        requestedByDirectorId: "project-manager",
        targetDirectorId: "project-manager",
        summary: "Confirm failure recovery revert",
        draftMessage: "Revert the last failed automation update and stop at the last successful point.",
        draftPayload: {
          action: "automationFailureRecovery",
          projectId: input.projectId,
          reportId: session.automation.pendingRevertReportId,
          historyUpdateId: session.automation.pendingRevertHistoryUpdateId,
          commitSha: session.automation.pendingRevertCommitSha,
          provider: settings.advancedDefaults.provider,
        },
      });
      this.appendJeffSlackMessage(session, "A revert is available. Confirm it when you want me to recover from the failed update.");
    }
    await this.saveAgentSession(input.projectId, session);
    return session;
  }

  async confirmAutomationFailureRecovery(input: ConfirmAutomationFailureRecoveryInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) {
      throw new Error("No agent session found for this project.");
    }
    const approval = (session.pendingApprovals ?? []).find((item) => item.draftPayload?.action === "automationFailureRecovery");
    if (approval) {
      return this.executePendingApproval(session, approval);
    }
    throw new Error("No failure recovery action is waiting to be confirmed.");
  }

  private kickAutomationRun(projectId: string): void {
    if (this.automationJobs.has(projectId)) {
      return;
    }
    this.automationJobs.add(projectId);
    void this.runAutomationLoop(projectId)
      .catch((error) => {
        console.warn("[automation] loop failed", error);
      })
      .finally(() => {
        this.automationJobs.delete(projectId);
      });
  }

  private async runAutomationLoop(projectId: string): Promise<void> {
    for (;;) {
      const session = await this.store.getAgentSession(projectId);
      if (!session) {
        return;
      }
      syncAgentMemories(session);
      if (session.automation.status !== "running") {
        return;
      }

      const shouldWait = await this.performAutomationStep(session);
      if (!shouldWait) {
        return;
      }
      await delay(AUTOMATION_POLL_INTERVAL_MS);
    }
  }

  private async performAutomationStep(session: AgentSession): Promise<boolean> {
    const settings = await this.store.readSettings();
    const automation = buildDefaultAutomationState(session.automation);
    const targetUpdateId = automation.selectedTargetUpdateId;
    if (!targetUpdateId) {
      await this.stopAutomationWithReason(session, "no-target", "Automation stopped because there is no selected target.");
      return false;
    }

    const plan = resolveToddPlanSource(session);
    if (plan.draft || plan.updates.length === 0) {
      await this.stopAutomationWithReason(
        session,
        "no-confirmed-plan",
        plan.supersedesConfirmedPlan
          ? "Automation stopped because Todd drafted a structural replan that must be confirmed before continuing."
          : "Automation stopped because Todd's current update plan is not confirmed yet.",
      );
      return false;
    }

    if (!isWithinAutomationHours(automation.constraints.allowedHours)) {
      await this.stopAutomationWithReason(session, "outside-work-hours", "Automation stopped because the current time is outside the allowed work window.");
      return false;
    }

    if (automation.constraints.codexMaxUsedPercent != null || automation.constraints.claudeMaxUsedPercent != null) {
      const usage = await this.readUsage();
      const codexPercent = resolveUsagePercent(usage.codex);
      const claudePercent = resolveUsagePercent(usage.claude);
      if (automation.constraints.codexMaxUsedPercent != null && codexPercent != null && codexPercent >= automation.constraints.codexMaxUsedPercent) {
        await this.stopAutomationWithReason(session, "codex-usage-limit", `Automation stopped because Codex usage reached ${codexPercent}%.`);
        return false;
      }
      if (automation.constraints.claudeMaxUsedPercent != null && claudePercent != null && claudePercent >= automation.constraints.claudeMaxUsedPercent) {
        await this.stopAutomationWithReason(session, "claude-usage-limit", `Automation stopped because Claude usage reached ${claudePercent}%.`);
        return false;
      }
    }

    const targetUpdate = session.toddMemory.futureUpdatePlan.find((update) => update.id === targetUpdateId) ?? null;
    if (targetUpdate?.status === "completed") {
      await this.stopAutomationWithReason(
        session,
        "target-completed",
        `Reached the selected target update: ${targetUpdate.title}.`,
        "completed",
      );
      return false;
    }

    const pendingValidation = session.jeffMemory.pendingValidations[0] ?? null;
    if (pendingValidation) {
      await this.stopAutomationWithReason(
        session,
        "awaiting-user",
        `Automation paused while Jeff waits for a decision on Pong's validation: ${pendingValidation.summary}`,
      );
      return false;
    }

    const pendingReport = session.jeffMemory.pendingReports[0] ?? null;
    if (pendingReport) {
      await this.stopAutomationWithReason(
        session,
        "awaiting-user",
        `Automation paused while Jeff waits for a decision on "${pendingReport.title}".`,
      );
      return false;
    }

    const nextUpdate = plan.updates
      .filter((update) => automation.inScopeUpdateIds.includes(update.id))
      .filter((update) => update.status === "pending" || update.status === "in_progress")
      .slice()
      .sort((left, right) => compareAutomationUpdates(left, right, plan.roadmapVersions))[0] ?? null;

    if (!nextUpdate) {
      const latestSession = await this.getAgentSession(session.projectId);
      if (latestSession?.toddMemory.futureUpdatePlan.find((update) => update.id === targetUpdateId)?.status === "completed") {
        await this.stopAutomationWithReason(
          latestSession,
          "target-completed",
          `Reached the selected target update: ${latestSession.toddMemory.futureUpdatePlan.find((update) => update.id === targetUpdateId)?.title ?? "target"}.`,
          "completed",
        );
        return false;
      }
      await this.stopAutomationWithReason(session, "no-next-update", "Automation stopped because there is no next in-scope update to run.");
      return false;
    }

    if (nextUpdate.status === "in_progress") {
      this.patchAutomationState(session, {
        currentStep: "awaiting-report",
        nextUpdateId: nextUpdate.id,
      });
      await this.saveAgentSession(session.projectId, session);
      return true;
    }

    this.patchAutomationState(session, {
      currentStep: "ping",
      nextUpdateId: nextUpdate.id,
    });
    this.appendJeffSlackMessage(session, `Next step toward the target: "${nextUpdate.title}".`);
    await this.saveAgentSession(session.projectId, session);
    await this.routeUpdateToProgramming({
      projectId: session.projectId,
      updateId: nextUpdate.id,
      provider: settings.advancedDefaults.provider,
      model: settings.advancedDefaults.model,
      claudeModel: settings.advancedDefaults.claudeModel,
    });
    const latest = await this.getAgentSession(session.projectId);
    if (latest) {
      await this.stopAutomationWithReason(
        latest,
        "awaiting-user",
        `Automation paused while Ping waits for confirmation on "${nextUpdate.title}".`,
      );
    }
    return false;
  }

  private async refreshProjectNow(input: RefreshProjectInput): Promise<void> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    await this.requireProviderReady(input.provider, settings);
    const project = await this.requireProject(input.projectId);

    let session = await this.store.getAgentSession(input.projectId);
    if (!session) {
      session = this.createEmptyAgentSession(input.projectId, input.provider);
    }
    session.slackMessages = session.slackMessages ?? [];
    session.directorStateMap = session.directorStateMap ?? {};
    session.currentCorePillars = session.currentCorePillars ?? [];
    session.danArchivedNotes = session.danArchivedNotes ?? [];
    session.danMemory.derivedConcept = session.danMemory.derivedConcept ?? null;
    session.danMemory.derivedNotes = session.danMemory.derivedNotes ?? [];
    session.danMemory.derivedUpdatedAt = session.danMemory.derivedUpdatedAt ?? null;
    session.slackPresenceGuestId = null;
    session.provider = input.provider;

    const service = this.aiService(input.provider);
    const model = input.provider === "claude" ? input.claudeModel : input.model;
    const cleanJson = (raw: string, context: string) =>
      parseAgentJsonResponse<Record<string, unknown>>(raw, {
        agentLabel: "Todd",
        context,
      });
    const persistSession = async () => {
      session.updatedAt = new Date().toISOString();
      await this.store.saveAgentSession(session);
      this.emit({ type: "agent.session", projectId: input.projectId, session });
    };

    // System message: refresh started
    session.slackMessages.push({
      id: randomUUID(),
      role: "system",
      directorId: null,
      content: "Project refresh started...",
      createdAt: new Date().toISOString(),
    });
    await persistSession();

    // --- STEP 1: Todd scans the codebase ---
    session.slackPresenceGuestId = "rd-director";
    session.slackActiveDirectorId = "rd-director";
    let toddResponsePlaceholder: AgentChatMessage | null = null;
    toddResponsePlaceholder = await this.stageSlackDirectorIntroSequence(session, input.projectId, "rd-director");

    let scanSummary = "";
    let detectedFeatures: string[] = [];
    let toddSame: string[] = [];
    let toddUpdated: string[] = [];
    let refreshedToddCurrentState: string | null = null;
    let latestFingerprint: ProjectKnowledgeFingerprint | null = null;
    let outlineReport: ProjectOutlineReport | null = null;

    try {
      // Generate outline report for file tree
      outlineReport = await this.generateOutlineReportNow({
        projectId: input.projectId,
        provider: input.provider,
        model: input.model,
        claudeModel: input.claudeModel,
      });
      const fileTree = outlineReport.storedData.map((n) => n.label).join(", ");

      const previousState = session.directorStateMap["rd-director"]?.currentState ?? null;

      const toddPrompt = `You are Todd, the R&D Director for "${project.name}".
You are performing a project refresh — scanning the actual codebase to map its current state.

Project path: ${project.localPath}
File structure: ${fileTree}
${outlineReport.connections.length > 0 ? `Connections: ${outlineReport.connections.map((c) => `${c.name} (${c.kind})`).join(", ")}` : ""}

${formatCoreDetails(session) || "No existing core details mapped yet."}
${previousState ? `\nYour previous understanding of the codebase:\n${previousState}` : "\nThis is your first scan of this codebase."}

Your task:
1. Summarize the current state of the codebase
2. Identify the major features/systems you can detect from the file structure
3. Compare against your previous understanding (if any). Report what is the SAME and what has been UPDATED (additions, changes, or removals).

Return your response as a conversational summary of what you found.`;

      const toddRaw = await service.runOneShot(
        project,
        settings,
        toddPrompt,
        model,
        refreshScanSchema,
        "high",
      );
      const toddParsed = cleanJson(toddRaw, "Todd refresh scan") as {
        scanSummary?: string;
        detectedFeatures?: unknown;
        same?: unknown;
        updated?: unknown;
        currentState?: string;
        response?: string;
      };
      scanSummary = toddParsed.scanSummary ?? "";
      detectedFeatures = Array.isArray(toddParsed.detectedFeatures) ? toddParsed.detectedFeatures : [];
      toddSame = Array.isArray(toddParsed.same) ? toddParsed.same : [];
      toddUpdated = Array.isArray(toddParsed.updated) ? toddParsed.updated : [];
      refreshedToddCurrentState = typeof toddParsed.currentState === "string" ? toddParsed.currentState : scanSummary;
      latestFingerprint = await buildProjectKnowledgeFingerprint(project.localPath);
      session.toddMemory.codebaseIndexedMap = {
        summary: refreshedToddCurrentState,
        indexedAt: new Date().toISOString(),
        featureAreas: detectedFeatures,
        repoNotes: toddUpdated,
        lastIndexedFingerprint: latestFingerprint,
      };
      persistDirectorStateSnapshot(session, "rd-director", {
        currentState: refreshedToddCurrentState,
        idealState: session.directorStateMap["rd-director"]?.idealState ?? null,
        assumptions: toddSame.length > 0
          ? [`Refresh compared against prior scan. Same: ${toddSame.join(", ")}`]
          : [],
      });
      if (toddResponsePlaceholder) {
        toddResponsePlaceholder.content = sanitizeSlackResponseContent(toddParsed.response, "rd-director");
        toddResponsePlaceholder.status = "complete";
        toddResponsePlaceholder.createdAt = new Date().toISOString();
        toddResponsePlaceholder.metadata = {
          type: "refresh-update",
          directorId: "rd-director",
          same: toddSame,
          updated: toddUpdated,
          summary: scanSummary,
        };
        this.syncSlackMessageToAgentChat(session, "rd-director", toddResponsePlaceholder);
      }
      session.slackPresenceGuestId = null;
      await persistSession();
    } catch (error) {
      const errorMessage = `Scan encountered an error: ${error instanceof Error ? error.message : "Unknown error"}`;
      if (toddResponsePlaceholder) {
        toddResponsePlaceholder.content = errorMessage;
        toddResponsePlaceholder.status = "complete";
        toddResponsePlaceholder.createdAt = new Date().toISOString();
        toddResponsePlaceholder.metadata = null;
        this.syncSlackMessageToAgentChat(session, "rd-director", toddResponsePlaceholder);
      } else {
        this.appendSlackAssistantMessage(session, "rd-director", errorMessage, { status: "complete" });
      }
      session.slackPresenceGuestId = null;
      await persistSession();
      return;
    }

    // --- STEP 2: Dan receives a derived current-state snapshot in soft memory only ---
    let derivedRefreshStatus = "Dan's derived soft memory could not be refreshed.";
    const danWorkingMsg = this.appendSlackAssistantMessage(session, "creative-director", "", { status: "working" });
    session.slackActiveDirectorId = "creative-director";
    session.slackPresenceGuestId = "creative-director";
    await persistSession();

    try {
      const derivedPrompt = `Analyze the current codebase state for "${project.name}" and derive provisional core-details for Dan.

This output is NOT confirmed product truth. It is only a derived current-state snapshot from the codebase.
It must help Dan understand the existing implementation without overwriting the user's discussed ideal concept.

Todd's scan summary:
${scanSummary}

Detected feature areas:
${detectedFeatures.join(", ") || "(none found)"}

Recent codebase changes Todd flagged:
${toddUpdated.join(", ") || "(none found)"}

Known discussed/confirmed concept context for naming only:
${formatCoreDetails(session) || "No confirmed Dan core-details yet."}

Return ONLY strict JSON matching:
{"function": string, "thesis": string, "corePillars": [{"name": string, "function": string, "thesis": string}], "fullFlow": string}`;

      const derivedRaw = await service.runOneShot(
        project,
        settings,
        derivedPrompt,
        model,
        generateCoreDetailsSchema,
        "high",
      );
      const derivedParsed = cleanJson(derivedRaw, "Dan derived core details") as unknown as {
        function: string;
        thesis: string;
        corePillars: Array<{ name: string; function: string; thesis: string }>;
        fullFlow: string;
      };
      session.danMemory.derivedConcept = buildGeneratedCoreDetailsConcept(derivedParsed);
      session.danMemory.derivedNotes = buildDanDerivedNotesFromRefresh({
        scanSummary,
        detectedFeatures,
        updatedAreas: toddUpdated,
      });
      session.danMemory.derivedUpdatedAt = new Date().toISOString();
      derivedRefreshStatus = "Dan's derived soft memory was refreshed from the current codebase without touching hard memory.";
      danWorkingMsg.content = "I loaded a derived current-state snapshot into soft memory so we can compare it against the discussed concept without overwriting my hard memory.";
      danWorkingMsg.status = "complete";
      danWorkingMsg.createdAt = new Date().toISOString();
      danWorkingMsg.metadata = null;
      this.syncSlackMessageToAgentChat(session, "creative-director", danWorkingMsg);
      await persistSession();
    } catch (error) {
      derivedRefreshStatus = `Dan's derived soft memory refresh failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      danWorkingMsg.content = derivedRefreshStatus;
      danWorkingMsg.status = "complete";
      danWorkingMsg.createdAt = new Date().toISOString();
      danWorkingMsg.metadata = null;
      this.syncSlackMessageToAgentChat(session, "creative-director", danWorkingMsg);
      await persistSession();
    }

    // --- STEP 3: Jeff closes the loop ---
    const jeffMessage = this.appendSlackAssistantMessage(session, "project-manager", "", { status: "working" });
    session.slackActiveDirectorId = "project-manager";
    session.slackPresenceGuestId = null;
    await persistSession();

    const refreshLead = toddUpdated.length > 0
      ? `Todd flagged source/config drift around ${toddUpdated.join(", ")}.`
      : "Todd did not find any source/config drift from the last indexed understanding.";
    const featureLead = detectedFeatures.length > 0
      ? `His refreshed technical map now covers ${detectedFeatures.join(", ")}.`
      : "His refreshed technical map did not identify any clear feature buckets yet.";
    const fingerprintLead = latestFingerprint
      ? `Todd's source/config fingerprint was updated at ${session.toddMemory.codebaseIndexedMap?.indexedAt ?? new Date().toISOString()}.`
      : "Todd's scan completed, but PROGRAMS could not persist a new source/config fingerprint.";
    jeffMessage.content = [
      "Refresh complete.",
      refreshLead,
      featureLead,
      fingerprintLead,
      `${derivedRefreshStatus} Discussed core-details still win over derived context until you confirm hard memory.`,
    ].join(" ");
    jeffMessage.status = "complete";
    jeffMessage.createdAt = new Date().toISOString();
    jeffMessage.metadata = null;
    this.syncSlackMessageToAgentChat(session, "project-manager", jeffMessage);
    await persistSession();
  }

  async refreshProject(input: RefreshProjectInput): Promise<void> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    const project = await this.requireProject(input.projectId);
    const session = await this.getOrCreateAgentSession(input.projectId, input.provider);
    if (this.findPendingApprovalByAction(session, "refreshProject")) {
      await this.saveAgentSession(input.projectId, session);
      return;
    }

    const needsInitialRefresh = session.knowledgeStatus === "needs-initial-refresh" || !session.toddMemory.codebaseIndexedMap?.lastIndexedFingerprint;
    this.queueApproval(session, {
      kind: "codebase-scan",
      requestedByDirectorId: "project-manager",
      targetDirectorId: "rd-director",
      summary: needsInitialRefresh
        ? `Confirm initial project refresh for ${project.name}`
        : `Confirm project refresh for ${project.name}`,
      draftMessage: needsInitialRefresh
        ? "Jeff is ready to process this project into the agents' current understanding. Todd will refresh his technical map and Dan will only receive derived soft-memory until you confirm hard memory."
        : "Jeff is ready to refresh the project. Todd will rescan the current source/config state and Dan will only receive derived soft-memory. Confirm before PROGRAMS spends tokens on the refresh.",
      draftPayload: {
        action: "refreshProject",
        input: {
          ...input,
          provider: input.provider ?? settings.advancedDefaults.provider,
          model: input.model ?? settings.advancedDefaults.model,
          claudeModel: input.claudeModel ?? settings.advancedDefaults.claudeModel,
        },
      },
    });
    await this.saveAgentSession(input.projectId, session);
  }

  async regenerateToddPlan(input: RegenerateToddPlanInput): Promise<void> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    await this.requireProviderReady(input.provider, settings);
    const project = await this.requireProject(input.projectId);

    const session = await this.getOrCreateAgentSession(input.projectId, input.provider);
    syncAgentMemories(session);

    const responsePlaceholder = this.appendSlackAssistantMessage(session, "rd-director", "", { status: "working" });
    session.slackActiveDirectorId = "rd-director";
    session.slackPresenceGuestId = null;
    await this.saveAgentSession(input.projectId, session);

    try {
      const requestedModels = resolveDirectorRequestedModels(
        session,
        "rd-director",
        settings.advancedDefaults.model,
        settings.advancedDefaults.claudeModel,
      );
      const modelSelection = resolveDirectorModelSelection(
        "rd-director",
        input.provider,
        requestedModels.model,
        requestedModels.claudeModel,
        "synthesis",
      );
      const resolvedModel = input.provider === "claude" ? modelSelection.claudeModel : modelSelection.model;

      const codebaseSummary = buildToddCodebaseSummary(session);
      const coreContext = formatScopedCoreDetails(session, { confirmedOnly: true, includeCurrent: true, includeIdeal: true });

      const existingChain = (session.toddMemory.successChain ?? []).length > 0
        ? session.toddMemory.successChain.map((s, i) => `${i + 1}. [${s.satisfied ? "satisfied" : "pending"}] ${s.title}: ${s.description}`).join("\n")
        : "(none yet)";

      const existingQueue = session.toddMemory.futureUpdatePlan.length > 0
        ? session.toddMemory.futureUpdatePlan.map((u) => `- [${u.status}] ${u.title}: ${u.description}`).join("\n")
        : "(empty)";

      const previousUpdateLog = session.toddMemory.previousUpdateLog.slice(-5)
        .map((entry) => `- ${entry.status}: ${entry.goal} -> ${entry.outcome}`)
        .join("\n") || "(none)";

      const troubleLog = session.toddMemory.troubleLog.slice(-5)
        .map((entry) => `- ${entry.title}: ${entry.details}`)
        .join("\n") || "(none)";

      const prompt = buildToddRegeneratePrompt(
        project.name,
        codebaseSummary,
        coreContext,
        existingChain,
        existingQueue,
        previousUpdateLog,
        troubleLog,
      );

      const rawResult = await this.aiService(input.provider).runOneShot(
        project,
        settings,
        prompt,
        resolvedModel,
        directorToddRegenerateSchema,
        resolveDirectorRuntime(session, "rd-director").reasoningEffort,
      );

      const parsed = parseAgentJsonResponse<Record<string, unknown>>(rawResult, {
        agentLabel: "Todd",
        context: "plan regeneration",
      });

      const response = sanitizeSlackResponseContent(
        typeof parsed.response === "string" ? parsed.response : "Plan regenerated.",
        "rd-director",
      );

      const rawChain = Array.isArray(parsed.successChain) ? parsed.successChain : [];
      const newSuccessChain: ToddSuccessChainStep[] = rawChain.map((step: Record<string, unknown>, idx: number) => ({
        id: randomUUID(),
        title: typeof step.title === "string" ? step.title.trim() : `Step ${idx + 1}`,
        description: typeof step.description === "string" ? step.description.trim() : "",
        order: idx,
        satisfied: step.satisfied === true,
        satisfiedAt: null,
      }));

      const rawNext = parsed.nextUpdate && typeof parsed.nextUpdate === "object"
        ? parsed.nextUpdate as Record<string, unknown>
        : null;
      const newNextUpdate: ToddNextUpdate | null = rawNext ? normalizeToddNextUpdate(rawNext) : null;

      session.toddMemory.currentState = normalizeOptionalToddText(parsed.currentState) ?? session.toddMemory.currentState;
      session.toddMemory.endStateGoal = normalizeOptionalToddText(parsed.endStateGoal) ?? session.toddMemory.endStateGoal;
      session.toddMemory.successChain = newSuccessChain;
      session.toddMemory.nextUpdate = newNextUpdate;

      // Parse and store the new roadmap structure if the AI provided it
      const rawRoadmap = parsed.roadmap && typeof parsed.roadmap === "object"
        ? parsed.roadmap as Record<string, unknown>
        : null;
      if (rawRoadmap) {
        const roadmap = normalizeToddRoadmap(rawRoadmap);
        session.toddMemory.hardMemory = roadmap;
        session.toddMemory.roadmap = roadmap;
      }
      syncToddRoadmapPriorityFromNextUpdate(session);

      if (newNextUpdate) {
        const alreadyQueued = session.toddMemory.futureUpdatePlan.some(
          (u) => u.status === "pending" && u.title === newNextUpdate.title,
        );
        if (!alreadyQueued) {
          const asVersionUpdate: VersionUpdate = {
            id: newNextUpdate.id,
            versionId: null,
            title: newNextUpdate.title,
            description: newNextUpdate.description,
            order: session.toddMemory.futureUpdatePlan.length,
            status: "pending",
            dependencies: newNextUpdate.dependencies,
            pillarIds: newNextUpdate.pillarIds,
            skillsNeeded: newNextUpdate.skillsNeeded,
            updateKind: newNextUpdate.updateKind,
            simplificationMode: newNextUpdate.simplificationMode,
            structuralReason: newNextUpdate.structuralReason,
            supportsNextStep: newNextUpdate.supportsNextStep,
          };
          session.toddMemory.futureUpdatePlan = normalizeFutureUpdatePlan([
            ...session.toddMemory.futureUpdatePlan,
            asVersionUpdate,
          ]);
          session.versionUpdates = [...session.toddMemory.futureUpdatePlan];
        }
      }

      const createdAt = new Date().toISOString();
      this.replaceSlackAssistantMessage(session, "rd-director", {
        ...responsePlaceholder,
        content: response,
        createdAt,
        status: "complete",
        metadata: this.buildToddHardMemoryReportSnapshot(session, response, createdAt),
      });
      session.toddMemory.latestReportId = responsePlaceholder.id;
      await this.saveAgentSession(input.projectId, session);
    } catch (error) {
      this.replaceSlackAssistantMessage(session, "rd-director", {
        ...responsePlaceholder,
        content: error instanceof Error ? error.message : "Todd could not regenerate the plan.",
        createdAt: new Date().toISOString(),
        status: "complete",
        metadata: null,
      });
      await this.saveAgentSession(input.projectId, session);
      throw error;
    }
  }

  async listPendingApprovals(input: ListPendingApprovalsInput): Promise<PendingApproval[]> {
    const session = await this.getAgentSession(input.projectId);
    return (session?.pendingApprovals ?? []).filter((approval) => approval.status === "pending");
  }

  async revisePendingApproval(input: RevisePendingApprovalInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this project.");

    const patch: {
      summary?: string;
      draftMessage?: string | null;
      draftPayload?: Record<string, unknown> | null;
      targetDirectorId?: DirectorId | null;
    } = {};
    if (input.summary !== undefined) patch.summary = input.summary;
    if (input.draftMessage !== undefined) patch.draftMessage = input.draftMessage;
    if (input.draftPayloadText !== undefined) patch.draftPayload = this.parseDraftPayloadText(input.draftPayloadText);
    if (input.targetDirectorId !== undefined) patch.targetDirectorId = input.targetDirectorId;

    const approval = updatePendingApproval(session, input.approvalId, patch);
    if (!approval) throw new Error("Pending approval not found.");

    await this.saveAgentSession(input.projectId, session);
    return session;
  }

  async deferPendingApproval(input: UpdatePendingApprovalStatusInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this project.");
    const approval = updatePendingApproval(session, input.approvalId, { status: "later" });
    if (!approval) throw new Error("Pending approval not found.");
    await this.saveAgentSession(input.projectId, session);
    return session;
  }

  async dismissPendingApproval(input: UpdatePendingApprovalStatusInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this project.");
    const removed = removePendingApproval(session, input.approvalId);
    if (!removed) throw new Error("Pending approval not found.");
    await this.saveAgentSession(input.projectId, session);
    return session;
  }

  async approvePendingApproval(input: ApprovePendingApprovalInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this project.");
    const approval = getPendingApproval(session, input.approvalId);
    if (!approval) throw new Error("Pending approval not found.");
    return this.executePendingApproval(session, approval);
  }

  private async executePendingApproval(session: AgentSession, approval: PendingApproval): Promise<AgentSession> {
    const projectId = session.projectId;
    const removed = removePendingApproval(session, approval.id);
    if (!removed) {
      throw new Error("Pending approval not found.");
    }

    const payload = removed.draftPayload ?? {};
    const action = payload.action;

    if (action === "startPlan") {
      await this.saveAgentSession(projectId, session);
      await this.startPlanNow(payload.input as StartPlanInput);
      return session;
    }
    if (action === "generateOutlineReport") {
      await this.saveAgentSession(projectId, session);
      await this.generateOutlineReportNow(payload.input as GenerateProjectOutlineReportInput);
      return session;
    }
    if (action === "agentExecuteUpdate") {
      await this.saveAgentSession(projectId, session);
      await this.agentExecuteUpdateNow(payload.input as AgentExecuteUpdateInput);
      return session;
    }
    if (action === "routeUpdateToProgramming") {
      await this.saveAgentSession(projectId, session);
      await this.routeUpdateToProgrammingNow(payload.input as RouteUpdateToProgrammingInput);
      return session;
    }
    if (action === "runValidation") {
      await this.saveAgentSession(projectId, session);
      await this.runValidationNow(payload.input as RunValidationInput);
      return (await this.getAgentSession(projectId)) ?? session;
    }
    if (action === "refreshProject") {
      await this.saveAgentSession(projectId, session);
      await this.refreshProjectNow(payload.input as RefreshProjectInput);
      return (await this.getAgentSession(projectId)) ?? session;
    }
    if (action === "applyStoredData") {
      await this.applyStoredDataApproval(session, removed);
      return session;
    }
    if (action === "runSlackDirector") {
      await this.runSlackDirectorApproval(session, removed);
      return (await this.getAgentSession(projectId)) ?? session;
    }
    if (action === "automationFailureRecovery") {
      await this.runAutomationFailureRecovery(session, removed);
      return (await this.getAgentSession(projectId)) ?? session;
    }

    await this.saveAgentSession(projectId, session);
    throw new Error("Unsupported approval action.");
  }

  private async runAutomationFailureRecovery(session: AgentSession, approval: PendingApproval): Promise<void> {
    const payload = approval.draftPayload ?? {};
    const historyUpdateId = typeof payload.historyUpdateId === "string" ? payload.historyUpdateId : null;
    const reportId = typeof payload.reportId === "string" ? payload.reportId : null;
    if (!historyUpdateId) {
      throw new Error("Recovery approval is missing the failed history update.");
    }

    await this.undoUpdate(session.projectId, historyUpdateId);
    const latest = await this.getAgentSession(session.projectId);
    if (!latest) {
      return;
    }

    const failedOutcome = latest.jeffMemory.outcomeLog.find((entry) => entry.reportId === payload.reportId) ?? null;
    if (failedOutcome?.updateId) {
      const update = latest.toddMemory.futureUpdatePlan.find((item) => item.id === failedOutcome.updateId);
      if (update) {
        update.status = "pending";
      }
    }
    if (reportId) {
      latest.jeffMemory.pendingReports = latest.jeffMemory.pendingReports.filter((report) => report.id !== reportId);
    }
    this.patchAutomationState(latest, {
      status: "paused",
      stopReason: "awaiting-user",
      stopSummary: "Recovery revert completed. Todd should replan from the last successful point before automation resumes.",
      currentStep: "awaiting-user",
      resumeRequired: true,
      pendingRevertReportId: null,
      pendingRevertHistoryUpdateId: null,
      pendingRevertCommitSha: null,
    });
    this.appendJeffSlackMessage(
      latest,
      "Recovery revert completed. Todd should replan from the last successful point before automation resumes.",
    );
    latest.versionUpdates = [...latest.toddMemory.futureUpdatePlan];
    await this.saveAgentSession(latest.projectId, latest);
  }

  private async applyStoredDataApproval(session: AgentSession, approval: PendingApproval): Promise<void> {
    const payload = approval.draftPayload ?? {};
    const dataType = payload.dataType;
    session.directorStateMap = session.directorStateMap ?? {};
    syncAgentMemories(session);

    if (dataType === "feasibilityAssessments" && Array.isArray(payload.assessments)) {
      session.feasibilityAssessments = payload.assessments as FeasibilityAssessment[];
      session.projectCategory = this.deriveProjectCategoryFromSession(session);
      await this.saveAgentSession(session.projectId, session);
      return;
    }
    if (dataType === "versions" && Array.isArray(payload.versions)) {
      // Legacy: old V1-V3 roadmap approval. versionPlan field has been replaced by successChain.
      this.appendJeffSlackMessage(session, "Legacy roadmap data applied. Version plan has been replaced by the success chain model.");
      await this.saveAgentSession(session.projectId, session);
      return;
    }
    if (dataType === "versionUpdates" && Array.isArray(payload.updates)) {
      const resolvedAt = new Date().toISOString();
      session.toddMemory.futureUpdatePlan = normalizeFutureUpdatePlan(payload.updates as VersionUpdate[]);
      session.versionUpdates = [...session.toddMemory.futureUpdatePlan];
      session.toddMemory = migrateToddMemoryToRoadmap(
        {
          ...session.toddMemory,
          hardMemoryUpdatedAt: resolvedAt,
          latestReportId: approval.id,
          backupMemory: normalizeTaggedNotes([
            ...(session.toddMemory.backupMemory ?? []),
            ...resolveTaggedNotes(session.toddMemory.softMemory ?? [], {
              target: "hard",
              resolvedAt,
              reportId: approval.id,
            }),
          ], "rd-director"),
          softMemory: [],
          notes: [],
          backupNotes: normalizeTaggedNotes([
            ...(session.toddMemory.backupMemory ?? []),
            ...resolveTaggedNotes(session.toddMemory.softMemory ?? [], {
              target: "hard",
              resolvedAt,
              reportId: approval.id,
            }),
          ], "rd-director"),
        },
        deriveFallbackPillarIds(session.danMemory.hardMemory ?? session.danMemory.confirmedConcept ?? null),
      );
      refreshJeffManagerMemory(session);
      const updatePlanMeta = getToddUpdatePlanDraftMetadata(payload);
      this.appendJeffSlackMessage(
        session,
        updatePlanMeta.supersedesConfirmedPlan
          ? "Todd's structural replan is now confirmed in hard memory. That's the update queue we'll run from next."
          : "Todd's future update plan is now confirmed in hard memory. That's the update queue we'll run from.",
      );
      session.projectCategory = this.deriveProjectCategoryFromSession(session);
      await this.saveAgentSession(session.projectId, session);
      return;
    }
    if (dataType === "toddRoadmap" && payload.roadmap && typeof payload.roadmap === "object") {
      const resolvedAt = new Date().toISOString();
      const roadmap = normalizeToddRoadmap(payload.roadmap as Record<string, unknown>);
      const resolvedSoftMemory = resolveTaggedNotes(session.toddMemory.softMemory ?? [], {
        target: "hard",
        resolvedAt,
        reportId: approval.id,
      });
      const backupMemory = normalizeTaggedNotes([
        ...(session.toddMemory.backupMemory ?? []),
        ...resolvedSoftMemory,
      ], "rd-director");
      session.toddMemory = migrateToddMemoryToRoadmap(
        {
          ...session.toddMemory,
          roadmap,
          hardMemory: roadmap,
          hardMemoryUpdatedAt: resolvedAt,
          latestReportId: approval.id,
          softMemory: [],
          notes: [],
          backupMemory,
          backupNotes: backupMemory,
          pendingHandoff: null,
        },
        deriveFallbackPillarIds(session.danMemory.hardMemory ?? session.danMemory.confirmedConcept ?? null),
      );
      refreshJeffManagerMemory(session);
      this.appendJeffSlackMessage(session, "Todd's roadmap is now confirmed in hard memory.");
      await this.saveAgentSession(session.projectId, session);
      return;
    }
    if (dataType === "validationResults" && Array.isArray(payload.results)) {
      session.validationResults = payload.results as ValidationResult[];
      session.projectCategory = this.deriveProjectCategoryFromSession(session);
      await this.saveAgentSession(session.projectId, session);
      return;
    }
    if (dataType === "pillarDescriptions" && Array.isArray(payload.descriptions)) {
      for (const item of payload.descriptions as Array<{ pillarId: string; description: string }>) {
        const pillar = findPillarById(session.corePillars, item.pillarId);
        if (pillar) pillar.description = item.description;
      }
      await this.saveAgentSession(session.projectId, session);
      return;
    }
    if (dataType === "danDraftCoreDetails") {
      const draftCoreDetails = (payload.draftCoreDetails ?? session.danDraftCoreDetails ?? null) as AgentCoreDetails | null;
      if (!draftCoreDetails) {
        throw new Error("Dan draft approval is missing draft core-details.");
      }
      const resolvedAt = new Date().toISOString();
      const resolvedDanSoftMemory = resolveTaggedNotes(session.danMemory.softMemory ?? [], {
        target: "hard",
        resolvedAt,
        reportId: approval.id,
      });
      const resolvedToddHandoffNotes = resolveTaggedNotes(session.danMemory.toddHandoffNotes ?? [], {
        target: "hard",
        resolvedAt,
        reportId: approval.id,
      });

      applyDanDraftCoreDetailsToSession(session, draftCoreDetails);
      session.danMemory.hardMemory = buildConfirmedConceptFromSession(session);
      session.danMemory.confirmedConcept = session.danMemory.hardMemory;
      session.danMemory.hardMemoryUpdatedAt = resolvedAt;
      session.danMemory.latestReportId = approval.id;
      session.danMemory.fullExperienceDescription = summarizeDanDraftIdealState(
        draftCoreDetails,
        typeof payload.idealState === "string" ? payload.idealState : null,
      );
      persistDirectorStateSnapshot(session, "creative-director", {
        currentState: null,
        idealState: session.danMemory.fullExperienceDescription,
        assumptions: [],
      });

      // History log: record what was confirmed
      session.danMemory.creativeHistory = session.danMemory.creativeHistory ?? [];
      session.danMemory.creativeHistory.push({
        id: randomUUID(),
        action: "confirmed",
        summary: session.danMemory.draftChangeSummary.join("; ") || "Core details confirmed",
        affectedPillarIds: draftCoreDetails.corePillars.map((p) => p.id),
        createdAt: new Date().toISOString(),
      });

      session.danMemory.backupMemory = normalizeTaggedNotes([
        ...(session.danMemory.backupMemory ?? []),
        ...resolvedDanSoftMemory,
        ...resolvedToddHandoffNotes,
      ], "creative-director");
      session.danMemory.archivedNotes = session.danMemory.backupMemory.map((note) => note.content);
      session.danMemory.notes = [];
      session.danMemory.softMemory = [];
      session.danMemory.draftConcept = null;
      session.danMemory.derivedConcept = null;
      session.danMemory.derivedNotes = [];
      session.danMemory.derivedUpdatedAt = null;
      session.danMemory.draftChangeSummary = [];
      session.danMemory.draftStatus = null;
      session.danMemory.toddHandoffNotes = [];
      session.danInternalNotes = [];
      session.danArchivedNotes = session.danMemory.archivedNotes;
      session.danDraftCoreDetails = null;
      session.danDraftChangeSummary = [];
      session.danDraftStatus = null;
      const toddSoftMemorySeed: TaggedNote[] = resolvedToddHandoffNotes.length > 0
        ? resolvedToddHandoffNotes.map((note) => ({
            ...note,
            id: randomUUID(),
            tag: "handoff-to-todd",
            resolution: null,
          }))
        : [{
            id: randomUUID(),
            content: session.danMemory.fullExperienceDescription
              ? `Dan Core-Details updated: ${session.danMemory.fullExperienceDescription}`
              : "Dan Core-Details updated and Todd should review the change against the roadmap.",
            tag: "handoff-to-todd",
            createdAt: resolvedAt,
            sourceRefs: resolvedDanSoftMemory.flatMap((note) => note.sourceRefs ?? []),
            resolution: null,
          }];
      const nextToddSoftMemory = normalizeTaggedNotes([
        ...(session.toddMemory.softMemory ?? []),
        ...toddSoftMemorySeed,
      ], "rd-director");
      session.toddMemory.softMemory = nextToddSoftMemory;
      session.toddMemory.notes = nextToddSoftMemory;
      session.toddMemory.pendingHandoff = null;
      refreshJeffManagerMemory(session);
      this.appendJeffSlackMessage(
        session,
        "Dan's confirmed core-details are now in hard memory. Todd has new soft memory to review against the roadmap.",
      );
      session.projectCategory = this.deriveProjectCategoryFromSession(session);
      await this.saveAgentSession(session.projectId, session);
      return;
    }
    if (dataType === "directorStateSnapshot") {
      const directorId = normalizeDirectorId(typeof payload.directorId === "string" ? payload.directorId : null);
      if (!directorId) {
        throw new Error("Stored director state is missing a valid director.");
      }

      const existing = session.directorStateMap[directorId] ?? {
        currentState: null,
        idealState: null,
        assumptions: [],
      };
      session.directorStateMap[directorId] = {
        currentState: typeof payload.currentState === "string" ? payload.currentState : existing.currentState,
        idealState: typeof payload.idealState === "string" ? payload.idealState : existing.idealState,
        assumptions: Array.isArray(payload.assumptions)
          ? payload.assumptions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          : existing.assumptions,
      };
      await this.saveAgentSession(session.projectId, session);
      return;
    }
    if (dataType === "refreshCurrentState") {
      if (Array.isArray(payload.currentCorePillars)) {
        session.currentCorePillars = payload.currentCorePillars as CorePillar[];
      }
      if (Array.isArray(payload.corePillars)) {
        const derivedPillars = (payload.corePillars as CorePillar[]).map((p, index) => ({
          ...cloneCorePillarDeep(p),
          assumptionSource: p.assumptionSource ?? null,
          assumptionText: p.assumptionText ?? "Derived from a project refresh and pending confirmation.",
          order: p.order ?? index,
        }));
        session.danMemory.derivedConcept = {
          function: typeof payload.functionSummary === "string"
            ? { summary: payload.functionSummary, status: "assumed" }
            : session.danMemory.derivedConcept?.function ?? null,
          thesis: typeof payload.thesisSummary === "string"
            ? { summary: payload.thesisSummary, status: "assumed" }
            : session.danMemory.derivedConcept?.thesis ?? null,
          corePillars: derivedPillars,
          fullFlow: typeof payload.fullFlowSummary === "string"
            ? { summary: payload.fullFlowSummary, status: "assumed" }
            : session.danMemory.derivedConcept?.fullFlow ?? null,
          threads: session.danMemory.derivedConcept?.threads ?? [],
        };
        session.danMemory.derivedNotes = migrateToTaggedNotes([
          typeof payload.corePillarsSummary === "string" ? payload.corePillarsSummary : "",
        ].filter((item): item is string => item.trim().length > 0));
        session.danMemory.derivedUpdatedAt = new Date().toISOString();
      }
      if (Array.isArray(payload.directorStateUpdates)) {
        for (const rawUpdate of payload.directorStateUpdates as Array<Record<string, unknown>>) {
          const directorId = normalizeDirectorId(typeof rawUpdate.directorId === "string" ? rawUpdate.directorId : null);
          if (!directorId) {
            continue;
          }

          const existing = session.directorStateMap[directorId] ?? {
            currentState: null,
            idealState: null,
            assumptions: [],
          };
          session.directorStateMap[directorId] = {
            currentState: typeof rawUpdate.currentState === "string" ? rawUpdate.currentState : existing.currentState,
            idealState: typeof rawUpdate.idealState === "string" ? rawUpdate.idealState : existing.idealState,
            assumptions: Array.isArray(rawUpdate.assumptions)
              ? rawUpdate.assumptions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
              : existing.assumptions,
          };
        }
      }
      session.projectCategory = this.deriveProjectCategoryFromSession(session);
      await this.saveAgentSession(session.projectId, session);
      return;
    }

    throw new Error("Unsupported stored-data approval.");
  }

  private async runSlackDirectorApproval(session: AgentSession, approval: PendingApproval): Promise<void> {

    const payload = approval.draftPayload ?? {};
    const directorId = normalizeDirectorId(typeof payload.directorId === "string" ? payload.directorId : null);
    if (!directorId) {
      throw new Error("Agent chat approval is missing a target director.");
    }

    const project = await this.requireProject(session.projectId);
    const settings = await this.store.readSettings();
    const provider = payload.provider === "claude" ? "claude" : "codex";
    const model = typeof payload.model === "string" ? payload.model : settings.advancedDefaults.model;
    const claudeModel = typeof payload.claudeModel === "string" ? payload.claudeModel : settings.advancedDefaults.claudeModel;
    const userMessage = typeof payload.message === "string" ? payload.message : approval.draftMessage ?? "";
    const mode = normalizeAgentChatDirectorMode(
      directorId,
      payload.mode,
      payload.allowInternetResearch,
    );

    const executionMessage = await this.tryStartSlackPingExecution({
      session,
      project,
      provider,
      model,
      claudeModel,
      directorId,
    });
    if (executionMessage) {
      return;
    }

    if (approval.requestedByDirectorId === "project-manager" && directorId !== "project-manager") {
      this.appendJeffSlackMessage(
        session,
        `${DIRECTOR_NAMES[directorId]}, let's lock this down around ${clipMemoryText(userMessage, 220)}.`,
      );
    } else {
      this.appendSlackAssistantMessage(
        session,
        directorId,
        "Confirmed. I'll take it from here.",
        { status: "complete" },
      );
    }
    await this.saveAgentSession(project.id, session);

    const { handoffTo, handoffReason } = await this.runSlackDirectorChain({
      session,
      project,
      settings,
      provider,
      model,
      claudeModel,
      directorId,
      userMessage,
      mode,
    });
    if (directorId === "rd-director" && handoffTo) {
      const handled = await this.handleToddSpecialistHandoff({
        projectId: project.id,
        session,
        handoffTo,
        message: handoffReason ?? userMessage,
        provider,
        model,
        claudeModel,
      });
      if (handled) {
        await this.saveAgentSession(project.id, session);
        return;
      }
    }
    if (handoffTo && !canAutoRouteAgentChatDirector(handoffTo)) {
      this.appendSlackSystemMessage(
        session,
        `${DIRECTOR_NAMES[directorId]} suggested a manual handoff to ${DIRECTOR_NAMES[handoffTo]}${handoffReason ? `: ${handoffReason}` : ""}`,
      );
      await this.saveAgentSession(project.id, session);
      return;
    }

    if (approval.requestedByDirectorId === "project-manager" && directorId !== "project-manager") {
      this.appendJeffSlackMessage(
        session,
        `Locked in so far: ${DIRECTOR_NAMES[directorId]} finished this pass${handoffTo ? ` and pointed next at ${DIRECTOR_NAMES[handoffTo]}` : ""}.`,
      );
      await this.saveAgentSession(project.id, session);
    }
  }

  private deriveProjectCategoryFromSession(session: AgentSession): ProjectCategory {
    const fc = session.stages.function.confirmed;
    const tc = session.stages.thesis.confirmed;
    const cpc = session.stages.core_pillars.confirmed;
    const ffc = session.stages.full_flow.confirmed;
    const hasConfirmedCoreDetails = fc && tc && cpc && ffc;
    const hasCompletedV1 = session.versions.some((v) =>
      v.label.toLowerCase().includes("v1") && session.versionUpdates
        .filter((u) => u.versionId === v.id)
        .every((u) => u.status === "completed")
    );

    if (hasCompletedV1) return "program";
    if (hasConfirmedCoreDetails) return "general-project";
    return "idea-in-progress";
  }

  async deriveProjectCategory(projectId: string): Promise<ProjectCategory> {
    const session = await this.store.getAgentSession(projectId);
    if (!session) return "idea-in-progress";
    return this.deriveProjectCategoryFromSession(session);
  }

  async setDirectorFocusMode(projectId: string, directorId: DirectorId, focusMode: DirectorFocusMode): Promise<AgentSession> {
    await this.ensureInitialized();
    let session = await this.store.getAgentSession(projectId);
    if (!session) throw new Error("No agent session found for this project.");

    if (directorId === "creative-director") session.creativeFocusMode = focusMode as CreativeFocusMode;
    else if (directorId === "rd-director") session.rdFocusMode = focusMode as RdFocusMode;
    else if (directorId === "validation-director") session.validationFocusMode = focusMode as ValidationFocusMode;

    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId, session });
    return session;
  }

  async updateDirectorSettings(
    projectId: string,
    directorId: DirectorId,
    overrides: DirectorSettingsOverride,
  ): Promise<AgentSession> {
    await this.ensureInitialized();
    let session = await this.store.getAgentSession(projectId);
    if (!session) throw new Error("No agent session found for this project.");
    session.directorSettingsOverrides = session.directorSettingsOverrides ?? {};
    session.directorSettingsOverrides[directorId] = {
      ...session.directorSettingsOverrides[directorId],
      ...overrides,
    };
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId, session });
    return session;
  }

  async updateDirectorState(
    projectId: string,
    directorId: DirectorId,
    state: Partial<DirectorStateSnapshot>,
  ): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(projectId);
    if (!session) throw new Error("No agent session found for this project.");
    session.directorStateMap = session.directorStateMap ?? {};
    const existing = session.directorStateMap[directorId] ?? { currentState: null, idealState: null, assumptions: [] };
    session.directorStateMap[directorId] = {
      currentState: state.currentState !== undefined ? state.currentState : existing.currentState,
      idealState: state.idealState !== undefined ? state.idealState : existing.idealState,
      assumptions: state.assumptions !== undefined ? state.assumptions : existing.assumptions,
    };
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId, session });
    return session;
  }

  async confirmAgentData(input: ConfirmAgentDataInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");

    if (input.dataType === "feasibility") {
      if (input.itemId) {
        const item = session.feasibilityAssessments.find((a) => a.id === input.itemId);
        if (item) item.status = "confirmed";
      } else {
        for (const a of session.feasibilityAssessments) a.status = "confirmed";
      }
    } else if (input.dataType === "versions") {
      if (input.itemId) {
        const item = session.versions.find((v) => v.id === input.itemId);
        if (item) item.status = "confirmed";
      } else {
        for (const v of session.versions) v.status = "confirmed";
      }
    } else if (input.dataType === "versionUpdates") {
      // Version updates use their own status field, no DetailStatus
    }

    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });
    return session;
  }

  private async routeUpdateToProgrammingNow(input: RouteUpdateToProgrammingInput): Promise<{ started: true }> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");

    const update = resolveNextProgrammingUpdate(session, input.updateId);
    if (!update) throw new Error("No pending programming update found.");

    const programmingDefaults = resolveDirectorRuntime(session, "programming-director");
    const pingModelSelections = resolvePingRunModelSelections(
      session,
      input.provider,
      input.model,
      input.claudeModel,
    );
    const pingTaskSnapshot = buildToddApprovedPingTaskSnapshot(session, {
      projectId: input.projectId,
      update,
      provider: input.provider,
      model: input.model,
      claudeModel: input.claudeModel,
      reasoningEffort: programmingDefaults.reasoningEffort,
      planningMode: "auto",
    });

    const trackedUpdate = upsertToddTrackedUpdate(session, {
      ...update,
      status: "in_progress",
    });
    session.slackMessages = session.slackMessages ?? [];
    session.slackActiveDirectorId = "programming-director";
    session.slackPresenceGuestId = "rd-director";

    if (input.skipConfirmation) {
      this.appendPingTaskReportMessage(session, pingTaskSnapshot);
      this.appendSlackAssistantMessage(
        session,
        "rd-director",
        this.buildToddPingHandoffMessage(update.title, update.description),
        { status: "complete" },
      );
    }

    this.seedPingStartupState(session, pingTaskSnapshot, null);
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });

    const usageBefore = buildUsageCapture(input.provider, await this.readUsage());
    const roadmap = getToddRoadmap(session);
    const nextUpdate = buildToddNextUpdateFromExecutionContext({
      update: trackedUpdate,
      nextUpdate: session.toddMemory.nextUpdate,
      priorityUpdate: roadmap?.priorityUpdate ?? null,
      currentState: session.toddMemory.currentState,
    });
    return this.startPlanNow({
      projectId: input.projectId,
      provider: input.provider,
      prompt: buildPingUpdatePrompt({
        nextUpdate,
        currentStateItems: roadmap?.currentState ?? [],
        priorityUpdate: roadmap?.priorityUpdate ?? null,
      }),
      speed: "normal",
      model: pingModelSelections.planning.model,
      claudeModel: pingModelSelections.planning.claudeModel,
      reasoningEffort: programmingDefaults.reasoningEffort,
      planningMode: "auto",
      autoApprove: true,
      contextPaths: [],
      usageBefore,
      pingTaskSnapshot,
    });
  }

  async routeUpdateToProgramming(input: RouteUpdateToProgrammingInput): Promise<{ started: true }> {
    await this.ensureInitialized();
    if (input.skipConfirmation) {
      return this.routeUpdateToProgrammingNow(input);
    }
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");

    const update = resolveNextProgrammingUpdate(session, input.updateId);
    if (!update) {
      throw new Error("No pending programming update found.");
    }

    const pingDefaults = resolveDirectorRuntime(session, "programming-director");
    const task = buildToddApprovedPingTaskSnapshot(session, {
      projectId: input.projectId,
      update,
      provider: input.provider,
      model: input.model,
      claudeModel: input.claudeModel,
      reasoningEffort: pingDefaults.reasoningEffort,
      planningMode: "auto",
    });

    const existingApproval = this.findPendingApprovalByAction(
      session,
      "routeUpdateToProgramming",
      (payload) => {
        const payloadInput = isRecord(payload.input) ? payload.input : null;
        return payloadInput?.updateId === update.id;
      },
    );
    if (!existingApproval) {
      this.appendPingTaskReportMessage(session, task);
      this.queueApproval(session, {
        kind: "agent-update",
        requestedByDirectorId: "rd-director",
        targetDirectorId: "rd-director",
        summary: this.buildApprovalSummary("Confirm Ping update run", `${update.title}: ${update.description}`),
        draftMessage: `Ping is ready to plan and execute "${update.title}". Confirm before PROGRAMS spends tokens on the big-model update run.`,
        draftPayload: {
          action: "routeUpdateToProgramming",
          input: {
            ...input,
            updateId: update.id,
          },
        },
      });
      this.appendSlackAssistantMessage(
        session,
        "rd-director",
        this.buildToddPingHandoffMessage(update.title, update.description),
        { status: "complete" },
      );
      await this.saveAgentSession(input.projectId, session);
    }
    return { started: true };
  }

  async recordJeffOutcome(input: {
    projectId: string;
    reportId: string;
    decision: JeffOutcomeDecision;
    summary: string;
  }): Promise<void> {
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) return;
    syncAgentMemories(session);

    const reportIndex = session.jeffMemory.pendingReports.findIndex((r) => r.id === input.reportId);
    let report = reportIndex >= 0 ? session.jeffMemory.pendingReports[reportIndex] : null;
    const validationIndex = session.jeffMemory.pendingValidations.findIndex((r) => r.id === input.reportId);
    const validation = validationIndex >= 0 ? session.jeffMemory.pendingValidations[validationIndex] : null;
    const linkedReportIndex = !report && validation?.updateId
      ? session.jeffMemory.pendingReports.findIndex((item) => item.updateId === validation.updateId)
      : -1;
    if (!report && linkedReportIndex >= 0) {
      report = session.jeffMemory.pendingReports[linkedReportIndex] ?? null;
    }

    if (reportIndex >= 0) {
      session.jeffMemory.pendingReports.splice(reportIndex, 1);
    } else if (linkedReportIndex >= 0) {
      session.jeffMemory.pendingReports.splice(linkedReportIndex, 1);
    }
    if (validationIndex >= 0) {
      session.jeffMemory.pendingValidations.splice(validationIndex, 1);
    }

    if (!report) {
      await this.saveAgentSession(input.projectId, session);
      return;
    }

    const updateId = report.updateId ?? validation?.updateId ?? null;
    const historyUpdateId = report.historyUpdateId ?? validation?.historyUpdateId ?? null;
    const commitSha = report.commitSha ?? null;
    const finalizedReport: JeffExecutionReport = {
      ...report,
      summary: input.summary,
      outcome: input.summary,
      toddRecommendedDecision: report.toddRecommendedDecision ?? report.decision ?? null,
      decision: input.decision,
      revertAvailable: Boolean(input.decision === "failure" && commitSha && historyUpdateId),
      revertHistoryUpdateId: historyUpdateId,
      revertCommitSha: commitSha,
    };
    const decisionStatus: PingRawReportStatus = input.decision === "successful"
      ? report.rawReport.status ?? "success"
      : input.decision === "partially-successful"
        ? "unexpected"
        : report.rawReport.status === "unexpected"
          ? "unexpected"
          : "blocked";

    const outcomeEntry: JeffOutcomeEntry = {
      id: randomUUID(),
      updateId,
      reportId: finalizedReport.id,
      decision: input.decision,
      summary: input.summary,
      revertTriggered: input.decision === "failure",
      createdAt: new Date().toISOString(),
    };
    session.jeffMemory.outcomeLog.push(outcomeEntry);
    session.pingMemory.latestJeffReport = finalizedReport;
    if (session.pingMemory.currentRun?.report && session.pingMemory.currentRun.report.rawReport.updateId === updateId) {
      session.pingMemory.currentRun.report = {
        ...session.pingMemory.currentRun.report,
        jeffReportId: finalizedReport.id,
        jeffSummary: input.summary,
      };
    }

    if (input.decision === "successful" && updateId) {
      const update = session.toddMemory.futureUpdatePlan.find((u) => u.id === updateId);
      if (update) {
        update.status = "completed";
        session.versionUpdates = [...session.toddMemory.futureUpdatePlan];
      }
      session.automation.lastSuccessfulUpdateId = updateId;
      session.automation.lastSuccessfulHistoryUpdateId = historyUpdateId;
      session.automation.pendingRevertReportId = null;
      session.automation.pendingRevertHistoryUpdateId = null;
      session.automation.pendingRevertCommitSha = null;
    }

    if (input.decision === "partially-successful") {
      if (updateId) {
        const update = session.toddMemory.futureUpdatePlan.find((u) => u.id === updateId);
        if (update) {
          update.status = "failed";
          session.versionUpdates = [...session.toddMemory.futureUpdatePlan];
        }
      }
      session.toddMemory.troubleLog.push({
        id: randomUUID(),
        title: `Partial: ${finalizedReport.title}`,
        details: input.summary,
        priority: "medium",
        occurrences: 1,
        lastSeenAt: new Date().toISOString(),
        updateIds: updateId ? [updateId] : [],
      });
    }

    if (input.decision === "failure") {
      session.toddMemory.troubleLog.push({
        id: randomUUID(),
        title: `Failed: ${finalizedReport.title}`,
        details: input.summary,
        priority: "high",
        occurrences: 1,
        lastSeenAt: new Date().toISOString(),
        updateIds: updateId ? [updateId] : [],
      });
      if (updateId) {
        const update = session.toddMemory.futureUpdatePlan.find((u) => u.id === updateId);
        if (update) {
          update.status = "failed";
          session.versionUpdates = [...session.toddMemory.futureUpdatePlan];
        }
      }
      session.automation.pendingRevertReportId = commitSha && historyUpdateId ? finalizedReport.id : null;
      session.automation.pendingRevertHistoryUpdateId = historyUpdateId;
      session.automation.pendingRevertCommitSha = commitSha;
    }

    if (updateId) {
      session.toddMemory.previousUpdateLog.push({
        id: randomUUID(),
        updateId,
        goal: finalizedReport.rawReport.goal ?? finalizedReport.title ?? validation?.summary ?? "Execution update",
        outcome: input.summary,
        status: decisionStatus,
        reportId: finalizedReport.id,
        historyUpdateId,
        commitSha,
        createdAt: new Date().toISOString(),
      });
    }

    this.appendJeffSlackMessage(
      session,
      input.decision === "successful"
        ? `Marked as successful. ${input.summary}`
        : input.decision === "partially-successful"
          ? `Marked as partially successful. Todd needs a follow-up plan before this continues.`
          : commitSha && historyUpdateId
            ? `Marked as failure. A revert is available if you want it.`
            : `Marked as failure. This needs manual recovery.`,
      finalizedReport,
    );
    session.slackActiveDirectorId = "project-manager";
    session.slackPresenceGuestId = null;
    session.automation.updatedAt = new Date().toISOString();
    this.appendToddHardMemoryReportMessage(
      session,
      `Todd hard memory updated after Jeff finalized "${finalizedReport.title}" as ${input.decision.replace(/-/g, " ")}.`,
    );

    await this.saveAgentSession(input.projectId, session);
  }

  async assignPongValidation(input: {
    projectId: string;
    instruction: string;
    updateId?: string | null;
  }): Promise<void> {
    const settings = await this.store.readSettings();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) return;
    syncAgentMemories(session);
    const roadmap = getToddRoadmap(session);
    const update = input.updateId
      ? findToddTrackedUpdate(session, input.updateId, null)
      : roadmap?.priorityUpdate
        ? buildCompatibilityUpdateFromPriority(session, roadmap.priorityUpdate)
        : null;
    const validationRequest: ToddValidationRequest = {
      id: randomUUID(),
      instruction: input.instruction,
      updateId: update?.id ?? input.updateId ?? null,
      relevantPillarIds: update?.pillarIds ?? roadmap?.priorityUpdate?.pillarIds ?? [],
      sourceRefs: [{
        id: randomUUID(),
        messageId: null,
        rawText: input.instruction,
        directorId: "rd-director",
        kind: "handoff",
        createdAt: new Date().toISOString(),
      }],
      createdAt: new Date().toISOString(),
    };
    session.pongMemory.validationRequest = validationRequest;
    session.pongMemory.jeffInstruction = input.instruction;
    session.pongTaskContext = {
      currentTask: update ? `Validate: ${update.title}` : "Validate the latest project state",
      lastResult: session.pongTaskContext?.lastResult ?? null,
      lastFailureReason: session.pongTaskContext?.lastFailureReason ?? null,
      toddUpdateExplanation: update?.description ?? validationRequest.instruction,
      relevantPillarIds: validationRequest.relevantPillarIds,
    };
    this.appendSlackAssistantMessage(
      session,
      "rd-director",
      `I’m asking Pong to validate this pass before we finalize it. ${input.instruction}`,
      { status: "complete" },
    );
    const usesLargeValidationModel = isLargeModelSelection(
      settings.advancedDefaults.provider,
      settings.advancedDefaults.model,
      settings.advancedDefaults.claudeModel,
    );
    const validationInput: RunValidationInput = {
      projectId: input.projectId,
      updateId: validationRequest.updateId ?? "",
      validationType: input.updateId
        ? resolveAutomationValidationType(
          session.toddMemory.futureUpdatePlan.find((item) => item.id === input.updateId)
            ?? session.versionUpdates.find((item) => item.id === input.updateId)
            ?? {
              id: "",
              versionId: "",
              title: "Validate latest state",
              description: input.instruction,
              order: 0,
              status: "pending",
              dependencies: [],
              pillarIds: [],
              skillsNeeded: [],
              updateKind: null,
              simplificationMode: null,
              structuralReason: null,
              supportsNextStep: null,
            },
        )
        : "functional",
      provider: settings.advancedDefaults.provider,
      model: settings.advancedDefaults.model,
      claudeModel: settings.advancedDefaults.claudeModel,
    };

    if (usesLargeValidationModel) {
      if (session.automation.status === "running") {
        this.patchAutomationState(session, {
          status: "stopped",
          stopReason: "awaiting-user",
          stopSummary: "Automation paused while Pong waits for validation confirmation.",
          currentStep: "awaiting-user",
          nextUpdateId: null,
        });
        this.appendJeffSlackMessage(session, "Automation paused while Pong waits for validation confirmation.");
      }
      await this.saveAgentSession(input.projectId, session);
      await this.runValidation(validationInput);
      return;
    }

    this.appendSlackAssistantMessage(session, "validation-director", "", { status: "working" });
    await this.saveAgentSession(input.projectId, session);
    await this.runValidationNow(validationInput);
  }

  private async runValidationNow(input: RunValidationInput): Promise<ValidationResult> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    const project = await this.requireProject(input.projectId);

    let session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");
    syncAgentMemories(session);
    const validationRequest = session.pongMemory.validationRequest ?? (session.pongMemory.jeffInstruction
      ? {
          id: randomUUID(),
          instruction: session.pongMemory.jeffInstruction,
          updateId: input.updateId,
          relevantPillarIds: session.pongTaskContext?.relevantPillarIds ?? [],
          sourceRefs: [buildLegacyMemorySourceRef(session.pongMemory.jeffInstruction, "rd-director")],
          createdAt: new Date().toISOString(),
        } satisfies ToddValidationRequest
      : null);

    // Try to use Playwright for screenshots if the project is running
    let screenshotPaths: string[] = [];
    const runtime = this.runner.getRuntime(input.projectId);
    if (runtime?.running && runtime.url) {
      try {
        const playwrightResult = await this.playwright.run({
          projectId: input.projectId,
          cwd: project.localPath ?? ".",
          url: runtime.url,
          actions: [],
          headless: true,
          settleMs: 2000,
        });
        screenshotPaths = playwrightResult.screenshots;
      } catch { /* Playwright not available, continue without screenshots */ }
    }

    // Populate Pong's short-horizon task context
    const relatedUpdate = findToddTrackedUpdate(session, input.updateId, null);
    session.pongTaskContext = {
      currentTask: `Validating: ${relatedUpdate?.title ?? "project state"}`,
      lastResult: session.pongTaskContext?.lastResult ?? null,
      lastFailureReason: session.pongTaskContext?.lastFailureReason ?? null,
      toddUpdateExplanation: validationRequest?.instruction ?? relatedUpdate?.description ?? null,
      relevantPillarIds: validationRequest?.relevantPillarIds ?? relatedUpdate?.pillarIds ?? [],
    };

    // Ask AI to validate — scoped to confirmed details for relevant pillars
    const coreContext = formatScopedCoreDetails(session, {
      confirmedOnly: true,
      relevantPillarIds: session.pongTaskContext?.relevantPillarIds,
    });
    const updateExplanation = session.pongTaskContext?.toddUpdateExplanation
      ? `\nTodd's explanation of what this update should achieve: ${session.pongTaskContext.toddUpdateExplanation}`
      : "";
    const toddValidationInstruction = validationRequest?.instruction
      ? `\nTodd's validation instruction: ${validationRequest.instruction}`
      : "";
    const validationPrompt = input.validationType === "visual"
      ? `You are validating the visual output of "${project.name}". Compare the current state against the confirmed intended visual direction.\n${coreContext}${updateExplanation}${toddValidationInstruction}\n${screenshotPaths.length > 0 ? `Screenshots taken: ${screenshotPaths.length}` : "No screenshots available."}\nDoes the current output match the intended visual direction? Report any mismatches.`
      : `You are validating the functional output of "${project.name}". Test whether the latest update works correctly.\n${coreContext}${updateExplanation}${toddValidationInstruction}\nDoes the feature work as intended? Report any issues.`;

    const service = this.aiService(input.provider);
    const model = input.provider === "claude" ? input.claudeModel : input.model;
    const usageBefore = buildUsageCapture(input.provider, await this.readUsage());
    const rawResult = await service.runOneShot(
      project,
      settings,
      validationPrompt,
      model,
      directorPongTestSchema,
      resolveDirectorRuntime(session, "validation-director").reasoningEffort,
    );
    const parsed = parseAgentJsonResponse<{
      validationPassed?: boolean;
      validationSummary?: string;
      validationDetails?: string;
      response?: string;
    }>(rawResult, {
      agentLabel: "Pong",
      context: `${input.validationType} validation`,
    });

    const result: ValidationResult = {
      id: randomUUID(),
      updateId: input.updateId,
      validationType: input.validationType,
      passed: parsed.validationPassed ?? true,
      summary: parsed.validationSummary ?? parsed.response ?? "",
      details: parsed.validationDetails ?? "",
      screenshotPaths,
      createdAt: new Date().toISOString(),
    };
    const linkedJeffReport = input.updateId
      ? session.pingMemory.latestJeffReport?.updateId === input.updateId
        ? session.pingMemory.latestJeffReport
        : null
      : null;
    const validationReport: PongValidationReport = {
      id: randomUUID(),
      updateId: input.updateId,
      historyUpdateId: linkedJeffReport?.historyUpdateId ?? session.pingMemory.currentRun?.report?.historyUpdateId ?? null,
      summary: result.summary,
      passed: result.passed,
      details: result.details || null,
      screenshotPaths,
      usageBefore,
      usageAfter: buildUsageCapture(input.provider, await this.readUsage()),
      createdAt: result.createdAt,
    };

    // Update Pong's short-horizon context with result
    if (session.pongTaskContext) {
      session.pongTaskContext.lastResult = result.summary;
      session.pongTaskContext.lastFailureReason = result.passed ? null : result.details;
    }

    session.validationResults.push(result);
    session.pongMemory.previousValidationReports.push(validationReport);
    session.pongMemory.latestValidationReport = validationReport;
    session.pongMemory.screenshotPaths = [...screenshotPaths];
    session.pongMemory.validationRequest = null;
    session.pongMemory.jeffInstruction = null;
    if (session.pingMemory.currentRun) {
      session.pingMemory.currentRun.validationReport = validationReport;
    }
    const workingMessage = this.findLatestSlackAssistantMessage(
      session,
      "validation-director",
      (item) => item.status === "working",
    );
    const validationSummary = typeof parsed.validationSummary === "string" && parsed.validationSummary.trim()
      ? parsed.validationSummary
      : parsed.response ?? "";
    if (workingMessage) {
      this.replaceSlackAssistantMessage(session, "validation-director", {
        ...workingMessage,
        content: validationSummary,
        createdAt: new Date().toISOString(),
        status: "complete",
        metadata: null,
      });
    } else {
      this.appendSlackAssistantMessage(session, "validation-director", validationSummary, {
        status: "complete",
        metadata: null,
      });
    }
    session.slackActiveDirectorId = "project-manager";
    session.slackPresenceGuestId = null;
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });
    void this.reviewValidationWithTodd(input.projectId, validationReport).catch((error) => {
      console.warn("[reviewValidationWithTodd] background failure", error);
    });
    return result;
  }

  async runValidation(input: RunValidationInput): Promise<ValidationResult | null> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");

    const relatedUpdate = session.versionUpdates.find((item) => item.id === input.updateId);
    const approval = this.queueApproval(session, {
      kind: "validation",
      requestedByDirectorId: "validation-director",
      targetDirectorId: "validation-director",
      summary: this.buildApprovalSummary(
        `Confirm ${input.validationType} validation`,
        relatedUpdate?.title ?? "Validate the latest project state",
      ),
      draftMessage: relatedUpdate?.description ?? null,
      draftPayload: {
        action: "runValidation",
        input,
      },
    });
    await this.saveAgentSession(input.projectId, session);
    this.emit({
      type: "toast",
      level: "info",
      message: `Queued approval: ${approval.summary}`,
    });
    return null;
  }

  async setValidationFrequency(input: SetValidationFrequencyInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");

    session.validationFrequency = input.frequency;
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });
    return session;
  }

  async createProject(input: ProjectCreateInput): Promise<Project> {
    await this.ensureInitialized();
    if (!input.name.trim()) {
      throw new Error("Enter a program name first.");
    }
    if (!input.parentDirectory.trim()) {
      throw new Error("Choose where the new program should live first.");
    }

    const existingProjects = await this.store.listProjects();
    const iconColor = this.resolveProjectIconColor(input.iconColor, existingProjects, null, true);
    const settings = await this.store.readSettings();
    const localPath = join(input.parentDirectory, input.name);
    if (existingProjects.some((project) => project.localPath === localPath)) {
      throw new Error("That project is already attached in PROGRAMS.");
    }
    if (await pathExists(localPath)) {
      throw new Error("That folder already exists. Choose a different location or attach it instead.");
    }

    await this.git.initializeRepository(localPath, "main");

    const description = deriveProjectDescription(input.name, input.initialIdea);
    await writeTextFile(
      join(localPath, "README.md"),
      `# ${input.name}\n\n${description}\n`,
    );

    const runtimeConfig = await detectRuntimeConfig(localPath);
    runtimeConfig.initialIdea = input.initialIdea || null;

    const project: Project = {
      id: randomUUID(),
      name: input.name,
      iconColor,
      description,
      localPath,
      threadId: null,
      lastUpdatedAt: null,
      status: "idle",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runtimeConfig,
      lastError: null,
      githubConnection: null,
      relationship: createEmptyProjectRelationshipSummary(),
    };

    await this.git.commitAll(localPath, `Initialize ${input.name}`);

    await this.store.createProject(project);
    await this.store.saveAgentSession(this.createEmptyAgentSession(project.id, settings.advancedDefaults.provider));
    await this.recomputeProjectRelationships(await this.store.listProjects(), true);
    const latestProject = await this.requireProject(project.id);
    this.emit({ type: "project.updated", project: latestProject });
    await this.syncSelfRuntime(settings, await this.store.listProjects(), true);
    return latestProject;
  }

  async attachProject(input: ProjectAttachInput): Promise<Project> {
    await this.ensureInitialized();
    if (!input.localPath.trim()) {
      throw new Error("Choose a project folder to attach first.");
    }
    const existingProjects = await this.store.listProjects();
    const iconColor = this.resolveProjectIconColor(input.iconColor, existingProjects, null, true);
    if (existingProjects.some((project) => project.localPath === input.localPath)) {
      throw new Error("That project is already attached in PROGRAMS.");
    }
    if (!(await pathExists(input.localPath))) {
      throw new Error("PROGRAMS could not find that project folder.");
    }

    const settings = await this.store.readSettings();
    const inspected = await this.git.inspectRepository(input.localPath);
    if (!inspected.isRepo) {
      await this.git.initializeRepository(input.localPath, "main");
    }

    const name = deriveAttachedProjectName(input.localPath);

    const runtimeConfig = await detectRuntimeConfig(input.localPath);

    const project: Project = {
      id: randomUUID(),
      name,
      iconColor,
      description: deriveProjectDescription(name),
      localPath: input.localPath,
      threadId: null,
      lastUpdatedAt: null,
      status: "idle",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runtimeConfig,
      lastError: null,
      githubConnection: null,
      relationship: createEmptyProjectRelationshipSummary(),
    };

    await this.store.createProject(project);
    await this.recomputeProjectRelationships(await this.store.listProjects(), true);
    const latestProject = await this.requireProject(project.id);
    this.emit({ type: "project.updated", project: latestProject });
    await this.syncSelfRuntime(settings, await this.store.listProjects(), true);
    return latestProject;
  }

  async renameProject(input: RenameProjectInput): Promise<Project> {
    await this.ensureInitialized();
    const project = await this.store.renameProject(input.projectId, input.name.trim());
    this.emit({ type: "project.updated", project });
    return project;
  }

  async updateProject(input: UpdateProjectInput): Promise<Project> {
    await this.ensureInitialized();
    const project = await this.requireProject(input.projectId);
    const projects = await this.store.listProjects();
    const name = input.name.trim();
    const iconColor = this.resolveProjectIconColor(input.iconColor, projects, project.id);

    if (!name) {
      throw new Error("Enter a project name first.");
    }

    project.name = name;
    project.iconColor = iconColor;
    project.updatedAt = new Date().toISOString();

    await this.store.updateProject(project);
    this.emit({ type: "project.updated", project });
    return project;
  }

  async unlinkProject(projectId: string): Promise<{ removed: true }> {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    const activePlan = this.codex.getActivePlan(projectId) ?? this.claude.getActivePlan(projectId);
    if (activePlan) {
      throw new Error("Cancel the current update before unlinking this project.");
    }

    const runtime = await this.runner.validateRuntime(projectId);
    if (runtime.running && runtime.controllable) {
      await this.runner.stop(projectId);
    }
    await this.store.deleteProject(projectId);
    await this.recomputeProjectRelationships(await this.store.listProjects(), true);
    await this.syncSelfRuntime(undefined, await this.store.listProjects(), false);
    this.emit({ type: "project.removed", projectId });
    this.emit({
      type: "toast",
      level: "success",
      message: `${project.name} was removed from the dashboard.`,
    });
    return { removed: true };
  }

  async getCodexStatus(): Promise<CodexAuthStatus> {
    const settings = await this.store.readSettings();
    const status = await this.codex.getAuthStatus(settings);
    await this.emitModelCatalogUpdated(settings);
    return status;
  }

  async readUsage(): Promise<UsageSnapshot> {
    const settings = await this.store.readSettings();
    const [codex, claude] = await Promise.all([
      this.codex.getUsage(settings),
      this.claude.getUsage(settings),
    ]);

    return {
      codex,
      claude,
      updatedAt: new Date().toISOString(),
    };
  }

  async loginCodex(): Promise<CodexAuthStatus> {
    const settings = await this.store.readSettings();
    const status = await this.codex.login(settings);
    await this.emitSetupUpdated(settings, status);
    await this.emitModelCatalogUpdated(settings);
    return status;
  }

  async setupCodex(): Promise<CodexAuthStatus> {
    let settings = await this.store.readSettings();

    try {
      let installation = await this.codex.inspectInstallation(settings);
      if (!installation.available || !installation.binaryPath) {
        this.emit({
          type: "toast",
          level: "info",
          message: "Installing Codex for PROGRAMS.",
        });
        const binaryPath = await this.installCodexCli();
        settings = await this.store.updateSettings({ codexBinaryPath: binaryPath });
        installation = await this.codex.inspectInstallation(settings);
      } else if (installation.binaryPath !== settings.codexBinaryPath) {
        settings = await this.store.updateSettings({ codexBinaryPath: installation.binaryPath });
      }

      let status = await this.codex.getAuthStatus(settings);
      if (!status.loggedIn) {
        this.emit({
          type: "toast",
          level: "info",
          message: "Opening the Codex sign-in flow.",
        });
        status = await this.codex.login(settings);
      }

      if (status.binaryPath && status.binaryPath !== settings.codexBinaryPath) {
        settings = await this.store.updateSettings({ codexBinaryPath: status.binaryPath });
      }

      await this.emitSetupUpdated(settings, status);
      await this.emitModelCatalogUpdated(settings);
      return status;
    } catch (error) {
      await this.emitSetupUpdated(settings);
      await this.emitModelCatalogUpdated(settings);
      throw error;
    }
  }

  async logoutCodex(): Promise<CodexAuthStatus> {
    const settings = await this.store.readSettings();
    const status = await this.codex.logout(settings);
    await this.emitSetupUpdated(settings, status);
    await this.emitModelCatalogUpdated(settings);
    return status;
  }

  async getClaudeStatus(): Promise<ClaudeAuthStatus> {
    const settings = await this.store.readSettings();
    return this.claude.getAuthStatus(settings);
  }

  async setupClaude(): Promise<ClaudeAuthStatus> {
    let settings = await this.store.readSettings();

    try {
      let status = await this.claude.getAuthStatus(settings);
      if (!status.available || !status.binaryPath) {
        this.emit({
          type: "toast",
          level: "info",
          message: "Installing Claude Code for PROGRAMS.",
        });
        await this.installClaudeCli();
        status = await this.claude.getAuthStatus(settings);
      }

      if (!status.available || !status.binaryPath) {
        await shell.openExternal(CLAUDE_DOWNLOAD_URL);
        throw new Error("PROGRAMS could not finish the Claude install automatically. It opened the official Claude Code docs.");
      }

      if (status.binaryPath !== settings.claudeBinaryPath) {
        settings = await this.store.updateSettings({ claudeBinaryPath: status.binaryPath });
      }

      const needsRepair = !status.canConnect || (status.loggedIn && !status.ready);
      if (needsRepair) {
        this.emit({
          type: "toast",
          level: "info",
          message: "Updating Claude Code for PROGRAMS.",
        });
        await this.installClaudeCli();
        status = await this.claude.getAuthStatus(settings);
      }

      if (!status.loggedIn) {
        if (!status.canConnect) {
          await shell.openExternal(CLAUDE_DOWNLOAD_URL);
          throw new Error(status.connectErrorMessage ?? "PROGRAMS could not open the Claude sign-in flow. It opened the official Claude Code docs.");
        }
        this.emit({
          type: "toast",
          level: "info",
          message: "Opening the Claude sign-in flow.",
        });
        status = await this.claude.login(settings);
      }

      if (status.binaryPath && status.binaryPath !== settings.claudeBinaryPath) {
        settings = await this.store.updateSettings({ claudeBinaryPath: status.binaryPath });
      }

      if (!status.ready) {
        await shell.openExternal(CLAUDE_DOWNLOAD_URL);
        throw new Error(status.runtimeErrorMessage ?? "PROGRAMS could not use Claude Code yet. It opened the official Claude Code docs.");
      }

      await this.emitSetupUpdated(settings, undefined, status);
      return status;
    } catch (error) {
      await this.emitSetupUpdated(settings);
      throw error;
    }
  }

  async loginClaude(): Promise<ClaudeAuthStatus> {
    const settings = await this.store.readSettings();
    const current = await this.claude.getAuthStatus(settings);
    if ((!current.loggedIn && !current.canConnect) || (current.loggedIn && !current.ready)) {
      return this.setupClaude();
    }
    const status = await this.claude.login(settings);
    await this.emitSetupUpdated(settings, undefined, status);
    return status;
  }

  async logoutClaude(): Promise<ClaudeAuthStatus> {
    const settings = await this.store.readSettings();
    const status = await this.claude.logout(settings);
    await this.emitSetupUpdated(settings, undefined, status);
    return status;
  }

  async getGithubStatus(): Promise<GithubAuthStatus> {
    return this.git.getGithubStatus();
  }

  async loginGithub(): Promise<GithubAuthStatus> {
    const status = await this.git.loginGithub((url) => shell.openExternal(url));
    this.emit({ type: "auth.github", status });
    return status;
  }

  async logoutGithub(): Promise<GithubAuthStatus> {
    const status = await this.git.logoutGithub();
    this.emit({ type: "auth.github", status });
    return status;
  }

  async publishProjectToGithub(input: GithubPublishInput): Promise<GithubConnection> {
    const project = await this.store.readProject(input.projectId);
    if (!project) {
      throw new Error("Project not found.");
    }
    const repoUrl = await this.git.createAndPushToGithub(project.localPath, input.repoName, input.isPrivate);
    const commitSha = await this.git.getHeadCommitSha(project.localPath);
    const connection: GithubConnection = {
      repoUrl,
      lastPushedAt: new Date().toISOString(),
      lastPushedCommitSha: commitSha,
      lastDownloadedAt: null,
      lastDownloadedCommitSha: null,
    };
    await this.store.updateGithubConnection(input.projectId, connection);
    await this.recomputeProjectRelationships(await this.store.listProjects(), true);
    const updated = await this.requireProject(input.projectId);
    this.emit({ type: "project.updated", project: updated });
    this.emit({ type: "project.githubConnection", projectId: input.projectId, connection });
    return connection;
  }

  async pushProjectToGithub(input: { projectId: string }): Promise<GithubConnection> {
    const project = await this.store.readProject(input.projectId);
    if (!project) {
      throw new Error("Project not found.");
    }
    if (!project.githubConnection?.repoUrl) {
      throw new Error("No GitHub remote configured for this project.");
    }
    await this.git.pushToExistingGithub(project.localPath);
    const commitSha = await this.git.getHeadCommitSha(project.localPath);
    const connection: GithubConnection = {
      ...project.githubConnection,
      lastPushedAt: new Date().toISOString(),
      lastPushedCommitSha: commitSha,
    };
    await this.store.updateGithubConnection(input.projectId, connection);
    await this.recomputeProjectRelationships(await this.store.listProjects(), true);
    const updated = await this.requireProject(input.projectId);
    this.emit({ type: "project.updated", project: updated });
    this.emit({ type: "project.githubConnection", projectId: input.projectId, connection });
    return connection;
  }

  async readProjectGithubDiffStats(projectId: string): Promise<DiffStats | null> {
    const project = await this.store.readProject(projectId);
    if (!project?.localPath) {
      return null;
    }

    // Tier 1: dashboard GitHub action — diff since the latest save/download baseline
    if (project.githubConnection?.lastPushedCommitSha || project.githubConnection?.lastDownloadedCommitSha) {
      const pushedAt = project.githubConnection.lastPushedAt ? Date.parse(project.githubConnection.lastPushedAt) : 0;
      const downloadedAt = project.githubConnection.lastDownloadedAt ? Date.parse(project.githubConnection.lastDownloadedAt) : 0;
      const baselineSha =
        downloadedAt > pushedAt
          ? project.githubConnection.lastDownloadedCommitSha
          : project.githubConnection.lastPushedCommitSha ?? project.githubConnection.lastDownloadedCommitSha;
      if (baselineSha) {
        return this.git.getDiffStatsSinceCommit(project.localPath, baselineSha);
      }
    }

    // Tier 2: remote exists but no dashboard push — count unpushed commits via tracking branch
    if (project.githubConnection?.repoUrl) {
      const unpushed = await this.git.getUnpushedCommitStats(project.localPath);
      if (unpushed) return unpushed;
    }

    // Tier 3: no remote or no tracking info — show uncommitted working-tree changes
    return this.git.readWorkingTreeDiffStats(project.localPath);
  }

  async saveToGithub(projectId: string): Promise<SaveToGithubResult> {
    const project = await this.store.readProject(projectId);
    if (!project) {
      throw new Error("Project not found.");
    }

    const githubStatus = await this.git.getGithubStatus();
    if (!githubStatus.available) {
      throw new Error(githubStatus.errorMessage ?? "GitHub CLI is not installed. Go to https://cli.github.com to install it.");
    }
    if (!githubStatus.loggedIn) {
      throw new Error(githubStatus.errorMessage ?? "Log in to GitHub in Settings to save your project.");
    }

    await this.git.setupGitCredentialHelper();
    await this.git.ensureRepository(project.localPath);
    await ensureProjectGitignoreSecretRules(project.localPath);
    const changedFilesBeforeSave = await this.git.readWorkingTreeChangedFiles(project.localPath);
    const secretLikeFiles = changedFilesBeforeSave.filter(isSecretLikePath);
    if (secretLikeFiles.length > 0) {
      throw new Error(formatSecretBlockMessage(secretLikeFiles));
    }
    await this.git.stageAll(project.localPath);
    const stagedSummary = await this.git.getStagedDiffSummary(project.localPath);

    if (stagedSummary) {
      const fileLabel = stagedSummary.files === 1 ? "1 file" : `${stagedSummary.files} files`;
      const message = `Save · ${fileLabel} · +${stagedSummary.added} -${stagedSummary.removed}`;
      await this.git.commitAll(project.localPath, message);
    }

    if (!project.githubConnection?.repoUrl) {
      const repoName =
        project.name
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "") || "my-project";
      const repoUrl = await this.git.createAndPushToGithub(project.localPath, repoName, true);
      const commitSha = await this.git.getHeadCommitSha(project.localPath);
      const connection: GithubConnection = {
        repoUrl,
        lastPushedAt: new Date().toISOString(),
        lastPushedCommitSha: commitSha,
        lastDownloadedAt: null,
        lastDownloadedCommitSha: null,
      };
      await this.store.updateGithubConnection(projectId, connection);
      await this.recomputeProjectRelationships(await this.store.listProjects(), true);
      const updated = await this.requireProject(projectId);
      this.emit({ type: "project.updated", project: updated });
      this.emit({ type: "project.githubConnection", projectId, connection });
      return { connection, status: "saved" };
    }

    if (!stagedSummary) {
      const unpushed = await this.git.getUnpushedCommitStats(project.localPath);
      if (!unpushed) {
        return { connection: project.githubConnection, status: "up-to-date" };
      }
    }

    await this.git.pushToExistingGithub(project.localPath);
    const commitSha = await this.git.getHeadCommitSha(project.localPath);
    const connection: GithubConnection = {
      ...project.githubConnection,
      lastPushedAt: new Date().toISOString(),
      lastPushedCommitSha: commitSha,
    };
    await this.store.updateGithubConnection(projectId, connection);
    await this.recomputeProjectRelationships(await this.store.listProjects(), true);
    const updated = await this.requireProject(projectId);
    this.emit({ type: "project.updated", project: updated });
    this.emit({ type: "project.githubConnection", projectId, connection });
    return { connection, status: "saved" };
  }

  async downloadFromGithub(projectId: string): Promise<DownloadFromGithubResult> {
    const project = await this.store.readProject(projectId);
    if (!project) {
      throw new Error("Project not found.");
    }

    const githubStatus = await this.git.getGithubStatus();
    if (!githubStatus.available) {
      throw new Error(githubStatus.errorMessage ?? "GitHub CLI is not installed. Go to https://cli.github.com to install it.");
    }
    if (!githubStatus.loggedIn) {
      throw new Error(githubStatus.errorMessage ?? "Log in to GitHub in Settings to download your project.");
    }

    await this.git.setupGitCredentialHelper();
    const runtime = await this.runner.validateRuntime(projectId);
    if (runtime.running) {
      throw new Error("Stop this project before downloading from GitHub.");
    }

    const remoteUrl = await this.git.getRemoteOriginUrl(project.localPath);
    if (!remoteUrl || !remoteUrl.includes("github.com")) {
      throw new Error("No GitHub repository is connected. Save to GitHub first, then download from GitHub when needed.");
    }

    let connection = project.githubConnection;
    if (!connection?.repoUrl) {
      connection = {
        repoUrl: remoteUrl,
        lastPushedAt: null,
        lastPushedCommitSha: null,
        lastDownloadedAt: null,
        lastDownloadedCommitSha: null,
      };
    }

    const plannedDownload = await this.git.previewGithubDownload(project.localPath);
    if (plannedDownload.status === "up-to-date") {
      // Defensive: clear any stale workspace copy left over from a prior run, even
      // when git reports nothing to download.
      await this.invalidateLaunchWorkspace(project);
      const nextConnection: GithubConnection = {
        ...connection,
        repoUrl: remoteUrl,
        lastDownloadedAt: new Date().toISOString(),
        lastDownloadedCommitSha: plannedDownload.commitSha,
      };
      await this.store.updateGithubConnection(projectId, nextConnection);
      await this.recomputeProjectRelationships(await this.store.listProjects(), true);
      const updated = await this.requireProject(projectId);
      this.emit({ type: "project.updated", project: updated });
      this.emit({ type: "project.githubConnection", projectId, connection: nextConnection });
      return { connection: nextConnection, status: "up-to-date" };
    }

    try {
      await this.projectBackups.createProjectBackup(project, "Before downloading from GitHub");
      this.emit({
        type: "toast",
        level: "success",
        message: "Backup created before downloading from GitHub.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Backup failed — download cancelled.";
      const displayMessage = `Backup failed — download cancelled. ${message}`;
      this.emit({
        type: "toast",
        level: "error",
        message: displayMessage,
      });
      throw new Error(displayMessage);
    }

    const result = await this.git.downloadFromGithub(project.localPath, plannedDownload);
    // Discard the cached workspace (and persist the cleared launch config) before
    // re-detecting runtime config, so detection reads the freshly updated localPath
    // rather than the stale workspace copy.
    await this.invalidateLaunchWorkspace(await this.requireProject(projectId));
    const nextConnection: GithubConnection = {
      ...connection,
      repoUrl: remoteUrl,
      lastDownloadedAt: new Date().toISOString(),
      lastDownloadedCommitSha: result.commitSha,
    };
    await this.store.updateGithubConnection(projectId, nextConnection);
    await this.recomputeProjectRelationships(await this.store.listProjects(), true);
    const updated = await this.refreshProjectRuntimeConfig(await this.requireProject(projectId));
    this.emit({ type: "project.updated", project: updated });
    this.emit({ type: "project.githubConnection", projectId, connection: nextConnection });
    return { connection: nextConnection, status: result.status };
  }

  async detectAndSyncGithubRemote(projectId: string): Promise<GithubConnection | null> {
    const project = await this.store.readProject(projectId);
    if (!project) {
      return null;
    }
    const remoteUrl = await this.git.getRemoteOriginUrl(project.localPath);
    if (!remoteUrl || !remoteUrl.includes("github.com")) {
      return null;
    }
    const connection: GithubConnection = {
      repoUrl: remoteUrl,
      lastPushedAt: null,
      lastPushedCommitSha: null,
      lastDownloadedAt: null,
      lastDownloadedCommitSha: null,
    };
    const updated = await this.store.updateGithubConnection(projectId, connection);
    this.emit({ type: "project.updated", project: updated });
    this.emit({ type: "project.githubConnection", projectId, connection });
    return connection;
  }

  async readLastProjectBackup(projectId: string): Promise<ProjectBackupInfo | null> {
    await this.ensureInitialized();
    await this.requireProject(projectId);
    return this.projectBackups.readLastProjectBackup(projectId);
  }

  async restoreLastProjectBackup(projectId: string): Promise<RestoreProjectBackupResult> {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    const runtime = await this.runner.validateRuntime(projectId);
    if (runtime.running) {
      throw new Error("Stop this project before restoring a backup.");
    }

    try {
      const result = await this.projectBackups.restoreLastProjectBackup(project);
      this.emit({
        type: "toast",
        level: "success",
        message: "Backup restored. Current files were replaced with the selected backup.",
      });
      const refreshedProject = await this.refreshProjectRuntimeConfig(await this.requireProject(projectId));
      this.emit({ type: "project.updated", project: refreshedProject });
      await this.recomputeProjectRelationships(await this.store.listProjects(), true);
      await this.emitHistory(projectId);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Restore failed.";
      this.emit({ type: "toast", level: "error", message });
      throw error;
    }
  }

  async readProjectSafetyState(projectId: string): Promise<ProjectSafetyState> {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    const changedFiles = await this.git.readWorkingTreeChangedFiles(project.localPath);
    return {
      projectId,
      hasUnsavedChanges: changedFiles.length > 0,
      changedFiles,
      secretLikeFiles: changedFiles.filter(isSecretLikePath),
      latestBackup: await this.projectBackups.readLastProjectBackup(projectId),
    };
  }

  async testClaudeConnection(): Promise<ClaudeConnectionTestResult> {
    const settings = await this.store.readSettings();
    return this.claude.testConnection(settings, settings.advancedDefaults.claudeModel);
  }

  submitClaudeLoginCode(code: string): void {
    this.claude.submitLoginCode(code);
  }

  private async readModelCatalog(settings: Settings): Promise<ModelCatalog> {
    const codex = await this.codex.getModelCatalog(settings);
    const matchesFallback =
      JSON.stringify(codex.map((option) => option.id)) ===
      JSON.stringify(DEFAULT_MODEL_CATALOG.codex.map((option) => option.id));

    return {
      codex: codex.length ? codex : DEFAULT_MODEL_CATALOG.codex,
      claude: DEFAULT_MODEL_CATALOG.claude,
      source: matchesFallback ? "fallback" : "live",
      updatedAt: new Date().toISOString(),
    };
  }

  private async emitModelCatalogUpdated(settings: Settings): Promise<void> {
    this.emit({
      type: "modelCatalog.updated",
      catalog: await this.readModelCatalog(settings),
    });
  }

  async inspectAttachPath(localPath: string): Promise<AttachPathInspection> {
    const normalizedPath = localPath.trim();
    if (!normalizedPath) {
      return {
        localPath: "",
        name: null,
        exists: false,
        isRepo: false,
      };
    }

    const exists = await pathExists(normalizedPath);
    if (!exists) {
      return {
        localPath: normalizedPath,
        name: deriveAttachedProjectName(normalizedPath),
        exists: false,
        isRepo: false,
      };
    }

    const inspected = await this.git.inspectRepository(normalizedPath);
    return {
      localPath: normalizedPath,
      name: deriveAttachedProjectName(normalizedPath),
      exists: true,
      isRepo: inspected.isRepo,
    };
  }

  async readSetup(): Promise<SetupSnapshot> {
    return this.buildSetupSnapshot();
  }

  async refreshSetup(): Promise<SetupSnapshot> {
    const snapshot = await this.buildSetupSnapshot();
    this.emit({ type: "setup.updated", setup: snapshot });
    return snapshot;
  }

  async installGit(): Promise<{ outcome: "alreadyAvailable" | "requested" | "manualDownload" }> {
    const outcome = await this.git.promptInstall();

    if (outcome === "requested") {
      this.emit({
        type: "toast",
        level: "info",
        message: "macOS opened the Git install prompt. Confirm it, then refresh the checks.",
      });
    } else if (outcome === "alreadyAvailable") {
      this.emit({
        type: "toast",
        level: "success",
        message: "Git is already installed.",
      });
    } else {
      this.emit({
        type: "toast",
        level: "info",
        message: "PROGRAMS opened the Git download page because macOS did not start the installer automatically.",
      });
      await shell.openExternal(GIT_DOWNLOAD_URL);
    }

    const snapshot = await this.buildSetupSnapshot();
    this.emit({ type: "setup.updated", setup: snapshot });
    return { outcome };
  }

  private async installCodexCli(): Promise<string> {
    if (process.platform !== "darwin") {
      await shell.openExternal(CODEX_DOWNLOAD_URL);
      throw new Error("Automatic Codex setup is only available on macOS right now. PROGRAMS opened the official Codex page.");
    }

    const npmVersion = await execCommand("npm --version", process.cwd());
    if (npmVersion.code !== 0) {
      await shell.openExternal(CODEX_DOWNLOAD_URL);
      throw new Error("PROGRAMS could not find npm to install Codex automatically. It opened the official Codex page.");
    }

    const installDir = join(app.getPath("userData"), "tools", "codex");
    await ensureDirectory(installDir);
    const installResult = await execCommand(
      `npm install --prefix "${installDir}" --no-audit --no-fund @openai/codex`,
      process.cwd(),
    );

    const binaryPath = join(installDir, "node_modules", ".bin", "codex");
    if (installResult.code !== 0 || !(await pathExists(binaryPath))) {
      await shell.openExternal(CODEX_DOWNLOAD_URL);
      throw new Error("PROGRAMS could not install Codex automatically. It opened the official Codex page.");
    }

    return binaryPath;
  }

  private async installClaudeCli(): Promise<void> {
    if (process.platform !== "darwin") {
      await shell.openExternal(CLAUDE_DOWNLOAD_URL);
      throw new Error("Automatic Claude setup is only available on macOS right now. PROGRAMS opened the official Claude Code docs.");
    }

    const installResult = await execCommand(
      `/bin/zsh -lc 'curl -fsSL https://claude.ai/install.sh | bash'`,
      process.cwd(),
    );

    if (installResult.code !== 0) {
      await shell.openExternal(CLAUDE_DOWNLOAD_URL);
      throw new Error("PROGRAMS could not install Claude Code automatically. It opened the official Claude Code docs.");
    }
  }

  async setRunCommand(projectId: string, runCommand: string) {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    const trimmed = runCommand.trim();
    if (!trimmed) {
      throw new Error("Enter a run command first.");
    }
    const nextProject: Project = {
      ...project,
      updatedAt: new Date().toISOString(),
      runtimeConfig: {
        ...project.runtimeConfig,
        runCommand: trimmed,
        launch: {
          origin: "manual",
          confidence: "high",
          locked: true,
          candidate: {
            kind: "direct",
            source: "manual",
            confidence: "high",
            summary: "User-provided run command.",
            notes: ["Entered manually in PROGRAMS."],
          },
          wrapperPath: null,
          workspacePath: project.runtimeConfig.launch?.workspacePath?.trim() || null,
        },
      },
    };
    await this.store.updateProject(nextProject);
    this.emit({ type: "project.updated", project: nextProject });
    return nextProject;
  }

  async getRunCommandSuggestions(projectId: string): Promise<RunCommandSuggestions> {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    return getRunCommandSuggestions(this.getProjectWorkingPath(project));
  }

  async suggestRunCommand(projectId: string): Promise<string | null> {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    const settings = await this.store.readSettings();
    const provider = settings.advancedDefaults.provider;
    const model = settings.advancedDefaults.model;
    const service = this.aiService(provider);

    const { projectContext } = await getRunCommandSuggestions(this.getProjectWorkingPath(project));

    const prompt = `You are analyzing a software project to determine its run command.

Here is information about the project:

${projectContext}

Based on this information, what is the single shell command that starts this project in development/server mode?

Respond with ONLY the command string — no explanation, no markdown, no quotes. If you truly cannot determine it, respond with exactly: unknown`;

    try {
      const result = await service.runOneShot(project, settings, prompt, model, undefined, "low");
      const trimmed = result.trim().replace(/^["'`]|["'`]$/g, "");
      return trimmed === "unknown" || !trimmed ? null : trimmed;
    } catch {
      return null;
    }
  }

  async runProject(projectId: string) {
    await this.ensureInitialized();
    let project = await this.refreshProjectRuntimeConfig(await this.requireProject(projectId));
    project = await this.ensureLaunchWorkspaceIfNeeded(project);
    const existing = await this.syncProjectRuntimeState(project);
    project = existing.project;
    if (existing.runtime.running) {
      return existing.runtime;
    }

    project = await this.updateProjectStatus(project, "running", null);
    project = await this.ensureAssignedPort(project);

    try {
      const workingPath = this.getProjectWorkingPath(project);
      await this.git.ensureRepository(workingPath);
      await this.runner.install(project);
      return await this.runner.start(project);
    } catch (error) {
      await this.updateProjectStatus(
        project,
        "error",
        error instanceof Error ? error.message : "PROGRAMS could not run this project.",
      );
      throw error;
    }
  }

  async killProject(projectId: string) {
    await this.ensureInitialized();
    const validatedRuntime = await this.runner.validateRuntime(projectId);
    if (!validatedRuntime.running) {
      return validatedRuntime;
    }

    const project = await this.requireProject(projectId);
    if (validatedRuntime.source === "self") {
      const nextRuntime = EMPTY_RUNTIME(projectId);
      await this.updateProjectStatus(project, "idle", null);
      this.emit({ type: "project.runtime", projectId, runtime: nextRuntime });
      setImmediate(() => app.quit());
      return nextRuntime;
    }

    const runtime = await this.runner.stop(projectId);
    await this.updateProjectStatus(project, "idle", null);
    return runtime;
  }

  async restartProject(projectId: string) {
    await this.ensureInitialized();
    let project = await this.refreshProjectRuntimeConfig(await this.requireProject(projectId));
    project = await this.ensureLaunchWorkspaceIfNeeded(project);

    const validatedRuntime = await this.runner.validateRuntime(projectId);
    if (validatedRuntime.running && validatedRuntime.source !== "self") {
      await this.runner.stop(projectId);
      await this.updateProjectStatus(project, "idle", null);
    }

    project = await this.updateProjectStatus(project, "running", null);
    project = await this.ensureAssignedPort(project);
    try {
      const workingPath = this.getProjectWorkingPath(project);
      await this.git.ensureRepository(workingPath);
      await this.runner.install(project);
      return await this.runner.start(project);
    } catch (error) {
      await this.updateProjectStatus(
        project,
        "error",
        error instanceof Error ? error.message : "PROGRAMS could not restart this project.",
      );
      throw error;
    }
  }

  async openProject(projectId: string): Promise<boolean> {
    await this.ensureInitialized();
    const refreshedProject = await this.refreshProjectRuntimeConfig(await this.requireProject(projectId));
    const { runtime } = await this.syncProjectRuntimeState(refreshedProject);
    if (!runtime.running || !runtime.url) {
      return false;
    }

    await shell.openExternal(runtime.url);
    return true;
  }

  async handleRuntimeExit(projectId: string): Promise<void> {
    const project = await this.store.readProject(projectId);
    if (!project || project.status !== "running") {
      return;
    }

    await this.updateProjectStatus(project, "idle", null);
  }

  async handleRuntimeUrlDetected(projectId: string, url: string): Promise<void> {
    const project = await this.store.readProject(projectId);
    if (!project) {
      return;
    }

    const nextRuntimeConfig = {
      ...project.runtimeConfig,
      lastRunUrl: url,
    };

    if (JSON.stringify(nextRuntimeConfig) === JSON.stringify(project.runtimeConfig)) {
      return;
    }

    project.runtimeConfig = nextRuntimeConfig;
    project.updatedAt = new Date().toISOString();
    await this.store.updateProject(project);
    this.emit({ type: "project.updated", project });
  }

  private aiService(provider: StartPlanInput["provider"]): CodexService | ClaudeService {
    return provider === "claude" ? this.claude : this.codex;
  }

  private async createBackupBeforeProjectEdit(project: Project, reason: string): Promise<ProjectBackupInfo> {
    try {
      const backup = await this.projectBackups.createProjectBackup(project, reason);
      this.emit({
        type: "toast",
        level: "success",
        message: "Backup created before AI edit.",
      });
      return backup;
    } catch {
      this.emit({
        type: "toast",
        level: "error",
        message: "Backup failed — AI edit cancelled.",
      });
      throw new Error("Backup failed — AI edit cancelled.");
    }
  }

  private async requireProviderReady(provider: StartPlanInput["provider"], settings: Settings): Promise<void> {
    const status = provider === "claude"
      ? await this.claude.getAuthStatus(settings)
      : await this.codex.getAuthStatus(settings);
    const message = getProviderPreflightError(provider, status);
    if (message) {
      throw new Error(message);
    }
  }

  private isLivePingPlanDraft(draft: PlanDraft | null | undefined): boolean {
    return Boolean(draft && (
      draft.status === "planning"
      || draft.status === "awaitingApproval"
      || draft.status === "executing"
    ));
  }

  private async settleProjectAfterPingRecovery(
    projectId: string,
    message: string,
    options: {
      existingProject?: Project | null;
      preferredStatus?: "error" | "idle";
    } = {},
  ): Promise<Project | null> {
    const project = options.existingProject ?? await this.store.readProject(projectId);
    if (!project) {
      return null;
    }

    const transientStatus = project.status === "planning"
      || project.status === "awaitingApproval"
      || project.status === "executing";
    const preferredStatus = options.preferredStatus ?? "error";
    const normalizedMessage = formatStructuredOutputIssueMessage(message) ?? "Ping stopped before execution began.";
    const nextStatus = preferredStatus === "error" || project.status === "error" ? "error" : "idle";
    const nextLastError = nextStatus === "error" ? normalizedMessage : null;

    if (!transientStatus && !(project.status === "error" && project.lastError !== nextLastError)) {
      return project;
    }

    if (project.status === nextStatus && project.lastError === nextLastError) {
      return project;
    }

    return this.updateProjectStatus(project, nextStatus, nextLastError);
  }

  private async rollbackPingStartupState(
    projectId: string,
    message: string,
    existingSession?: AgentSession | null,
    options: {
      existingProject?: Project | null;
      preferredProjectStatus?: "error" | "idle";
    } = {},
  ): Promise<void> {
    const session = existingSession ?? await this.store.getAgentSession(projectId);
    if (!session) {
      return;
    }
    syncAgentMemories(session);

    const activeUpdateId = session.pingMemory.activeUpdateId ?? session.pingMemory.currentRun?.task.updateId ?? null;
    if (activeUpdateId) {
      const update = session.toddMemory.futureUpdatePlan.find((item) => item.id === activeUpdateId) ?? null;
      if (update && update.status === "in_progress") {
        update.status = "pending";
      }
      session.versionUpdates = [...session.toddMemory.futureUpdatePlan];
    }

    session.pingMemory.activeUpdateId = null;
    session.pingMemory.activeTask = null;
    session.pingMemory.context = null;
    session.pingMemory.latestRawReport = null;
    session.pingMemory.latestJeffReport = null;
    session.pingMemory.currentRun = null;
    session.pingTaskContext = null;
    const normalizedMessage = formatStructuredOutputIssueMessage(message) ?? "Ping stopped before execution began.";
    const workingMessage = this.findLatestSlackAssistantMessage(
      session,
      "programming-director",
      (item) => item.status === "working",
    );
    if (workingMessage) {
      this.replaceSlackAssistantMessage(session, "programming-director", {
        ...workingMessage,
        content: normalizedMessage,
        createdAt: new Date().toISOString(),
        status: "complete",
        metadata: null,
      });
    } else {
      this.appendSlackAssistantMessage(session, "programming-director", normalizedMessage, { status: "complete" });
    }
    session.slackActiveDirectorId = "project-manager";
    session.slackPresenceGuestId = null;
    await this.saveAgentSession(projectId, session);
    await this.settleProjectAfterPingRecovery(projectId, normalizedMessage, {
      existingProject: options.existingProject,
      preferredStatus: options.preferredProjectStatus ?? "error",
    });
  }

  private async reconcileStalePingStartupState(
    projectId: string,
    session: AgentSession | null,
    projectLastError?: string | null,
    existingProject?: Project | null,
  ): Promise<AgentSession | null> {
    if (!session) {
      return session;
    }

    syncAgentMemories(session);
    const activePlan = this.codex.getActivePlan(projectId) ?? this.claude.getActivePlan(projectId);
    if (this.isLivePingPlanDraft(activePlan)) {
      return session;
    }

    const currentRun = session.pingMemory.currentRun;
    const workingMessage = this.findLatestSlackAssistantMessage(
      session,
      "programming-director",
      (item) => item.status === "working",
    );
    if (!workingMessage) {
      return session;
    }

    if (!currentRun) {
      const fallbackProject = existingProject ?? (
        projectLastError === undefined
          ? await this.store.readProject(projectId)
          : null
      );
      const orphanMessage = projectLastError
        ?? fallbackProject?.lastError
        ?? "Ping's previous working state was cleared after the run stopped.";
      await this.rollbackPingStartupState(projectId, orphanMessage, session, {
        existingProject: fallbackProject,
        preferredProjectStatus: (projectLastError ?? fallbackProject?.lastError) ? "error" : "idle",
      });
      return await this.store.getAgentSession(projectId);
    }

    if (currentRun.report) {
      return session;
    }

    const fallbackProject = existingProject ?? (
      projectLastError === undefined
        ? await this.store.readProject(projectId)
        : null
    );
    await this.rollbackPingStartupState(
      projectId,
      projectLastError ?? fallbackProject?.lastError ?? "Ping stopped before execution began.",
      session,
      {
        existingProject: fallbackProject,
        preferredProjectStatus: "error",
      },
    );
    return await this.store.getAgentSession(projectId);
  }

  private async reconcileToddAfterPingRun(
    session: AgentSession,
    report: PingExecutionReportSnapshot,
  ): Promise<void> {
    const statusLabel = report.rawReport.status === "no_changes"
      ? "did not need code changes"
      : report.rawReport.status === "success"
        ? "finished successfully"
        : report.rawReport.status === "unexpected"
          ? "finished with an unexpected outcome"
          : "hit a blocker";
    let note: string;
    if (report.task.source === "todd-approved-update") {
      const updateTitle = report.task.updateTitle ?? report.task.originalUserRequest;
      note = `Todd note: Todd's planned update "${updateTitle}" completed. Ping ${statusLabel}.`;
    } else {
      const matchedUpdate = findToddOverlapForDirectPingRun(session, report.task, report.rawReport);
      note = matchedUpdate
        ? `Todd note: Ping completed a direct request that appears to overlap with "${matchedUpdate.title}". Ping ${statusLabel}.`
        : `Todd note: Ping completed a direct request that does not clearly map to an existing Todd plan item. Ping ${statusLabel}.`;
    }
    const indexedMap = session.toddMemory.codebaseIndexedMap ?? {
      summary: session.pingMemory.codebaseMapSummary ?? null,
      indexedAt: null,
      featureAreas: [],
      repoNotes: [],
      lastIndexedFingerprint: null,
    };
    indexedMap.indexedAt = new Date().toISOString();
    indexedMap.repoNotes = Array.from(new Set([note, ...indexedMap.repoNotes]));
    session.toddMemory.codebaseIndexedMap = indexedMap;
    session.toddMemory.notes = mergeTaggedNotes(session.toddMemory.notes, [note], "general");
    this.appendSlackAssistantMessage(session, "rd-director", note, { status: "complete" });
  }

  private async startToddDirectedPingRun(input: {
    projectId: string;
    message: string;
    runtime: PingRuntimeSnapshot;
    originalUserRequest?: string;
  }): Promise<{ started: true }> {
    const settings = await this.store.readSettings();
    const session = await this.getOrCreateAgentSession(input.projectId, input.runtime.provider);
    const pingModelSelections = resolvePingRunModelSelections(
      session,
      input.runtime.provider,
      input.runtime.model,
      input.runtime.claudeModel,
    );
    const usageBefore = buildUsageCapture(input.runtime.provider, await this.readUsage());
    const pingTaskSnapshot = buildPingTaskSnapshot({
      source: "direct-ping-request",
      projectId: input.projectId,
      originalUserRequest: input.originalUserRequest ?? input.message,
      toddExplanation: input.message,
      toddCodebaseMapSummary: session.toddMemory.codebaseIndexedMap?.summary ?? null,
      coreDetailsContext: formatCoreDetails(session) || null,
      runtime: input.runtime,
    });
    const planInput: StartPlanInput = {
      projectId: input.projectId,
      provider: input.runtime.provider,
      prompt: input.message,
      speed: input.runtime.provider === "claude" ? "normal" : settings.defaultSpeed,
      model: pingModelSelections.planning.model,
      claudeModel: pingModelSelections.planning.claudeModel,
      reasoningEffort: input.runtime.reasoningEffort,
      planningMode: input.runtime.planningMode,
      autoApprove: input.runtime.planningMode === "auto",
      contextPaths: input.runtime.contextPaths,
      usageBefore,
      pingTaskSnapshot,
    };

    const existingApproval = this.findPendingApprovalByAction(
      session,
      "startPlan",
      (payload) => {
        const payloadInput = isRecord(payload.input) ? payload.input : null;
        return payloadInput?.projectId === input.projectId
          && payloadInput?.prompt === input.message;
      },
    );
    if (!existingApproval) {
      this.appendPingTaskReportMessage(session, pingTaskSnapshot);
      this.queueApproval(session, {
        kind: "agent-update",
        requestedByDirectorId: "rd-director",
        targetDirectorId: "rd-director",
        summary: this.buildApprovalSummary("Confirm Ping follow-up run", input.message),
        draftMessage: "Todd prepared a focused Ping follow-up. Confirm before PROGRAMS spends tokens on the planning pass.",
        draftPayload: {
          action: "startPlan",
          input: planInput,
        },
      });
    }
    if (session.automation.status === "running") {
      this.patchAutomationState(session, {
        status: "stopped",
        stopReason: "awaiting-user",
        stopSummary: "Automation paused while Ping waits for confirmation on Todd's follow-up task.",
        currentStep: "awaiting-user",
        nextUpdateId: null,
      });
      this.appendJeffSlackMessage(session, "Automation paused while Ping waits for confirmation on Todd's follow-up task.");
    }
    session.slackActiveDirectorId = "rd-director";
    session.slackPresenceGuestId = "rd-director";
    await this.saveAgentSession(input.projectId, session);
    return { started: true };
  }

  private async handleToddSpecialistHandoff(input: {
    projectId: string;
    session: AgentSession;
    handoffTo: DirectorId;
    message: string;
    provider: AiProvider;
    model: string;
    claudeModel: string;
  }): Promise<boolean> {
    if (input.handoffTo === "programming-director") {
      const pingDefaults = resolveDirectorRuntime(input.session, "programming-director");
      const pingModels = resolvePingRunModelSelections(
        input.session,
        input.provider,
        input.model,
        input.claudeModel,
      );
      await this.startToddDirectedPingRun({
        projectId: input.projectId,
        message: input.message,
        runtime: {
          provider: input.provider,
          model: pingModels.execution.model,
          claudeModel: pingModels.execution.claudeModel,
          reasoningEffort: pingDefaults.reasoningEffort,
          planningMode: pingDefaults.planningMode,
          contextPaths: [],
        },
      });
      return true;
    }

    if (input.handoffTo === "validation-director") {
      await this.assignPongValidation({
        projectId: input.projectId,
        instruction: input.message,
        updateId: input.session.pingMemory.currentRun?.report?.task.updateId
          ?? input.session.pingMemory.currentRun?.task.updateId
          ?? input.session.pingMemory.latestRawReport?.updateId
          ?? null,
      });
      return true;
    }

    return false;
  }

  private async startPlanNow(input: StartPlanInput): Promise<{ started: true }> {
    const settings = await this.store.readSettings();
    const project = await this.requireProject(input.projectId);
    const agentSession = await this.getOrCreateAgentSession(input.projectId, input.provider);
    const coreDetailsContext = formatCoreDetails(agentSession);
    const service = this.aiService(input.provider);
    const seededTask = input.pingTaskSnapshot ?? buildPingTaskSnapshot({
      source: "direct-ping-request",
      projectId: input.projectId,
      originalUserRequest: input.prompt,
      toddExplanation: input.prompt,
      toddCodebaseMapSummary: agentSession.toddMemory.codebaseIndexedMap?.summary ?? null,
      coreDetailsContext: coreDetailsContext || null,
      runtime: {
        provider: input.provider,
        model: input.model,
        claudeModel: input.claudeModel,
        reasoningEffort: input.reasoningEffort,
        planningMode: input.planningMode,
        contextPaths: [...input.contextPaths],
      },
    });
    const pingTaskSnapshot: PingTaskSnapshot = {
      ...seededTask,
      coreDetailsContext: seededTask.coreDetailsContext ?? (coreDetailsContext || null),
    };
    const enrichedInput: StartPlanInput = {
      ...input,
      coreDetailsContext: coreDetailsContext || null,
      pingTaskSnapshot,
    };
    pingTaskSnapshot.planPrompt = service.previewPlanningPrompt(project, enrichedInput);
    const providerLabel = input.provider === "claude" ? "Claude" : "Codex";
    const startupAlreadySeeded = this.isSamePingTaskSnapshot(agentSession.pingMemory.currentRun?.task, pingTaskSnapshot)
      && Boolean(this.findLatestSlackAssistantMessage(
        agentSession,
        "programming-director",
        (item) => item.status === "working",
      ));
    this.seedPingStartupState(agentSession, pingTaskSnapshot, input.usageBefore ?? null, {
      appendMessages: !startupAlreadySeeded,
    });
    agentSession.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(agentSession);
    this.emit({ type: "agent.session", projectId: input.projectId, session: agentSession });

    try {
      if (pingTaskSnapshot.source === "todd-approved-update" && pingTaskSnapshot.updateId) {
        await this.assertFreshProjectKnowledge(agentSession);
        const hasUnconfirmedPillars = agentSession.corePillars.some((pillar) =>
          pillar.function?.status === "assumed" || pillar.thesis?.status === "assumed"
        );
        if (hasUnconfirmedPillars) {
          throw new Error("Some core pillars are still marked as assumed. Please confirm them with Dan before building. Ask Jeff \"anything for me to confirm?\" to see what needs attention.");
        }
      }

      await this.requireProviderReady(input.provider, settings);
    } catch (error) {
      const latest = await this.requireProject(project.id);
      const failureMessage = error instanceof Error ? error.message : `PROGRAMS could not create a plan with ${providerLabel}.`;
      await this.updateProjectStatus(latest, "error", failureMessage);
      await this.rollbackPingStartupState(project.id, failureMessage, undefined, {
        existingProject: latest,
        preferredProjectStatus: "error",
      });
      throw error instanceof Error ? error : new Error(failureMessage);
    }

    if (input.planningMode === "none") {
      const executingProject = await this.updateProjectStatus(project, "executing", null);
      const draft = service.createDirectExecutionDraft(executingProject, enrichedInput);
      const latestSession = await this.store.getAgentSession(input.projectId);
      if (latestSession) {
        const plan = buildPingPlanSnapshot(draft);
        if (latestSession.pingMemory.currentRun) {
          latestSession.pingMemory.currentRun.plan = plan;
        }
        const workingMessage = this.findLatestSlackAssistantMessage(
          latestSession,
          "programming-director",
          (item) => item.status === "working",
        );
        const planSummary = draft.explanation || "Plan skipped by request.";
        if (workingMessage) {
          this.replaceSlackAssistantMessage(latestSession, "programming-director", {
            ...workingMessage,
            content: planSummary,
            createdAt: new Date().toISOString(),
            status: "complete",
            metadata: {
              type: "ping-plan-summary",
              summary: planSummary,
              plan,
            },
          });
        } else {
          this.appendSlackAssistantMessage(
            latestSession,
            "programming-director",
            planSummary,
            {
              status: "complete",
              metadata: {
                type: "ping-plan-summary",
                summary: planSummary,
                plan,
              },
            },
          );
        }
        this.appendSlackAssistantMessage(latestSession, "programming-director", "", {
          status: "working",
          metadata: null,
        });
        latestSession.updatedAt = new Date().toISOString();
        await this.store.saveAgentSession(latestSession);
        this.emit({ type: "agent.session", projectId: input.projectId, session: latestSession });
      }
      void this.executePlan(executingProject, settings, draft).catch((error) => {
        console.warn("[executePlan] background failure", error);
      });
      return { started: true };
    }

    await this.updateProjectStatus(project, "planning", null);

    void service
      .startPlanningTurn(project, settings, enrichedInput)
      .then(async (draft) => {
        const latest = await this.requireProject(project.id);
        latest.threadId = draft.threadId;
        latest.updatedAt = new Date().toISOString();
        await this.store.updateProject(latest);
        this.emit({ type: "project.updated", project: latest });

        // Announce plan completion in agent chat
        const latestSession = await this.store.getAgentSession(input.projectId);
        if (latestSession) {
          const plan = buildPingPlanSnapshot(draft);
          const planSummary = draft.explanation || draft.summary || "Plan completed.";
          if (latestSession.pingMemory.currentRun) {
            latestSession.pingMemory.currentRun.plan = plan;
          }
          const workingMessage = this.findLatestSlackAssistantMessage(
            latestSession,
            "programming-director",
            (item) => item.status === "working",
          );
          if (workingMessage) {
            this.replaceSlackAssistantMessage(latestSession, "programming-director", {
              ...workingMessage,
              content: planSummary,
              createdAt: new Date().toISOString(),
              status: "complete",
              metadata: { type: "ping-plan-summary", summary: planSummary, plan },
            });
          } else {
            this.appendSlackAssistantMessage(latestSession, "programming-director", planSummary, {
              status: "complete",
              metadata: { type: "ping-plan-summary", summary: planSummary, plan },
            });
          }
          if (draft.autoApprove) {
            this.appendSlackAssistantMessage(latestSession, "programming-director", "", {
              status: "working",
              metadata: null,
            });
          }
          latestSession.updatedAt = new Date().toISOString();
          await this.store.saveAgentSession(latestSession);
          this.emit({ type: "agent.session", projectId: input.projectId, session: latestSession });
        }

        if (draft.autoApprove) {
          await this.executePlan(latest, settings, draft);
          return;
        }

        await this.updateProjectStatus(latest, "awaitingApproval");
      })
      .catch(async (error) => {
        const latest = await this.requireProject(project.id);
        const failureMessage = error instanceof Error ? error.message : `PROGRAMS could not create a plan with ${providerLabel}.`;
        // Persist any new threadId even on failure so we don't keep retrying a stale one.
        const activeDraft = service.getActivePlan(project.id);
        if (activeDraft?.threadId && activeDraft.threadId !== latest.threadId) {
          latest.threadId = activeDraft.threadId;
          latest.updatedAt = new Date().toISOString();
          await this.store.updateProject(latest);
        }
        await this.updateProjectStatus(
          latest,
          "error",
          failureMessage,
        );
        await this.rollbackPingStartupState(project.id, failureMessage, undefined, {
          existingProject: latest,
          preferredProjectStatus: "error",
        });
      });

    return { started: true };
  }

  async startPlan(input: StartPlanInput): Promise<{ started: true }> {
    await this.ensureInitialized();
    const session = await this.getOrCreateAgentSession(input.projectId, input.provider);
    const approval = this.queueApproval(session, {
      kind: "plan",
      requestedByDirectorId: null,
      targetDirectorId: "programming-director",
      summary: this.buildApprovalSummary("Confirm planning run", input.prompt),
      draftMessage: input.prompt,
      draftPayload: {
        action: "startPlan",
        input,
      },
    });
    await this.saveAgentSession(input.projectId, session);
    this.emit({
      type: "toast",
      level: "info",
      message: `Queued approval: ${approval.summary}`,
    });
    return { started: true };
  }

  async revisePlan(input: StartPlanInput): Promise<{ started: true }> {
    const service = this.aiService(input.provider);
    await service.interruptPlan(input.projectId);
    return this.startPlan(input);
  }

  async cancelPlan(projectId: string): Promise<{ cancelled: true }> {
    // Interrupt whichever service has an active plan
    const codexPlan = this.codex.getActivePlan(projectId);
    const claudePlan = this.claude.getActivePlan(projectId);
    if (codexPlan) await this.codex.interruptPlan(projectId);
    if (claudePlan) await this.claude.interruptPlan(projectId);
    const project = await this.requireProject(projectId);
    await this.updateProjectStatus(project, "idle");
    return { cancelled: true };
  }

  // Direct project-chat entry point (bypasses the director approval queue).
  // "ask" → read-only text answer; "plan" → read-only planning that stops at a
  // reviewable plan (no execution — that's a later increment). Streams the
  // PlanDraft to the renderer via the existing "project.plan" event.
  // Write base64 images to a per-project temp dir and return their paths. The
  // dir is cleared first, so each send replaces the previous run's images
  // (they persist across plan→execute but never accumulate).
  private async persistChatImages(
    projectId: string,
    images?: ProjectChatInput["images"],
  ): Promise<string[]> {
    const dir = join(tmpdir(), "programs-images", projectId);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    if (!images || images.length === 0) {
      return [];
    }
    await mkdir(dir, { recursive: true });
    const extFor = (mediaType: string): string =>
      mediaType === "image/jpeg" ? "jpg"
      : mediaType === "image/webp" ? "webp"
      : mediaType === "image/gif" ? "gif"
      : "png";
    const paths: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const path = join(dir, `image-${i}.${extFor(images[i].mediaType)}`);
      await writeFile(path, Buffer.from(images[i].dataBase64, "base64"));
      paths.push(path);
    }
    return paths;
  }

  async startProjectChat(input: ProjectChatInput): Promise<{ started: true }> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    const project = await this.requireProject(input.projectId);
    // Auth/preflight throws here so the renderer's await surfaces the error.
    await this.requireProviderReady(input.provider, settings);
    const service = this.aiService(input.provider);
    // Persist any pasted/attached images to a per-project temp dir so the CLI
    // can read them. Kept for the whole plan→execute lifecycle; replaced on the
    // next send (see persistChatImages).
    const imagePaths = await this.persistChatImages(input.projectId, input.images);
    const existingSession = input.mode === "plan"
      ? await this.store.getAgentSession(input.projectId)
      : null;
    const coreDetailsContext = existingSession ? formatCoreDetails(existingSession) || null : null;
    const planInput: StartPlanInput = {
      projectId: input.projectId,
      provider: input.provider,
      prompt: input.prompt,
      speed: settings.defaultSpeed,
      model: input.model ?? settings.advancedDefaults.model,
      claudeModel: input.claudeModel ?? settings.advancedDefaults.claudeModel,
      reasoningEffort: input.reasoningEffort ?? settings.advancedDefaults.reasoningEffort,
      planningMode: input.mode === "plan" ? "review" : "none",
      autoApprove: false,
      contextPaths: [],
      coreDetailsContext,
      webEnabled: input.webEnabled ?? false,
      ultracode: input.ultracode ?? false,
      imagePaths,
    };

    // Run in the background; progress streams via project.plan events. The
    // service methods sync a failed draft on their own errors.
    void (async () => {
      try {
        if (input.mode === "ask") {
          await service.answerQuestion(project, settings, planInput);
        } else {
          await service.startPlanningTurn(project, settings, planInput);
        }
      } catch {
        // Already surfaced via the draft's failed status.
      }
    })();

    return { started: true };
  }

  async cancelProjectChat(projectId: string): Promise<{ cancelled: true }> {
    if (this.codex.getActivePlan(projectId)) await this.codex.interruptPlan(projectId);
    if (this.claude.getActivePlan(projectId)) await this.claude.interruptPlan(projectId);
    return { cancelled: true };
  }

  async approvePlan(input: ApprovePlanInput): Promise<{ started: true }> {
    const settings = await this.store.readSettings();
    const project = await this.requireProject(input.projectId);
    const draft = this.codex.getActivePlan(project.id) ?? this.claude.getActivePlan(project.id);
    if (!draft || draft.status !== "awaitingApproval") {
      throw new Error("There is no approved plan ready to confirm.");
    }

    await this.executePlan(project, settings, draft);

    return { started: true };
  }

  async undoUpdate(projectId: string, updateId: string): Promise<{ started: true }> {
    let project = await this.requireProject(projectId);
    const updates = await this.store.readHistory(projectId);
    const target = updates.find((item) => item.id === updateId);
    if (!target?.commitSha) {
      throw new Error("That update cannot be undone.");
    }

    await this.createBackupBeforeProjectEdit(project, "Before undoing saved update");
    project = await this.updateProjectStatus(project, "executing");
    await this.git.ensureRepository(project.localPath);
    const revertSha = await this.git.revertCommit(project.localPath, target.commitSha);

    target.status = "reverted";
    target.errorMessage = null;
    await this.store.updateHistoryRecord(target);

    const undoRecord: UpdateRecord = {
      id: randomUUID(),
      projectId: project.id,
      prompt: `Undo ${target.summary}`,
      summary: `Undid: ${target.summary}`,
      description: target.description ? `Reverted update details: ${target.description}` : null,
      commitSha: revertSha,
      createdAt: new Date().toISOString(),
      kind: "undo",
      status: "saved",
      errorMessage: null,
    };

    await this.store.addUpdateRecord(undoRecord);
    project.lastUpdatedAt = undoRecord.createdAt;
    project.status = "idle";
    project.lastError = null;
    project.updatedAt = new Date().toISOString();
    await this.store.updateProject(project);
    await this.recomputeProjectRelationships(await this.store.listProjects(), true);
    const latestProject = await this.requireProject(project.id);
    this.emit({ type: "project.updated", project: latestProject });
    await this.emitHistory(project.id);
    return { started: true };
  }

  private async finalizePingExecutionOutcome(projectId: string, input: {
    status: PingRawReportStatus;
    summary: string;
    changedFiles?: string[] | null;
    blocker?: string | null;
    toddFollowUpReason?: string | null;
    historyUpdateId?: string | null;
    commitSha?: string | null;
  }): Promise<void> {
    const session = await this.store.getAgentSession(projectId);
    if (!session) return;
    syncAgentMemories(session);
    const usageProvider = session.pingMemory.currentRun?.task.runtime.provider ?? session.provider;
    const usageAfter = buildUsageCapture(usageProvider, await this.readUsage());

    const activeUpdateId = session.pingMemory.activeUpdateId;
    const activeUpdate = activeUpdateId
      ? session.toddMemory.futureUpdatePlan.find((update) => update.id === activeUpdateId) ?? null
      : null;
    const currentRun = session.pingMemory.currentRun;
    const rawReport = buildPingRawReport({
      status: input.status,
      updateId: activeUpdateId ?? null,
      goal: activeUpdate?.description
        ?? currentRun?.task.updateDescription
        ?? currentRun?.task.originalUserRequest
        ?? session.pingMemory.context
        ?? null,
      summary: input.summary,
      changedFiles: input.changedFiles ?? [],
      blocker: input.blocker ?? null,
      unexpectedNotes: input.toddFollowUpReason ? [input.toddFollowUpReason] : [],
    });

    session.pingMemory.latestRawReport = rawReport;
    session.pingMemory.latestJeffReport = null;
    session.pingTaskContext = {
      currentTask: session.pingMemory.activeTask,
      lastResult: rawReport.summary,
      lastFailureReason: rawReport.blocker,
      toddUpdateExplanation: session.pingMemory.context,
      relevantPillarIds: activeUpdate?.pillarIds ?? [],
    };

    session.versionUpdates = [...session.toddMemory.futureUpdatePlan];
    const reportSnapshot = currentRun?.task
      ? buildPingExecutionReportSnapshot({
          task: currentRun.task,
          plan: currentRun.plan,
          rawReport,
          usageBefore: currentRun.usageBefore ?? null,
          usageAfter,
          historyUpdateId: input.historyUpdateId ?? null,
          commitSha: input.commitSha ?? null,
          jeffReportId: null,
          jeffSummary: null,
        })
      : null;
    if (currentRun) {
      session.pingMemory.currentRun = {
        ...currentRun,
        usageAfter,
        report: reportSnapshot,
      };
    }
    const workingMessage = this.findLatestSlackAssistantMessage(
      session,
      "programming-director",
      (item) => item.status === "working",
    );
    if (workingMessage) {
      this.replaceSlackAssistantMessage(session, "programming-director", {
        ...workingMessage,
        content: rawReport.summary,
        createdAt: new Date().toISOString(),
        status: "complete",
        metadata: { type: "ping-update-report", rawReport, report: reportSnapshot },
      });
    } else {
      this.appendSlackAssistantMessage(session, "programming-director", rawReport.summary, {
        status: "complete",
        metadata: { type: "ping-update-report", rawReport, report: reportSnapshot },
      });
    }
    if (reportSnapshot) {
      await this.reconcileToddAfterPingRun(session, reportSnapshot);
    }
    session.slackActiveDirectorId = reportSnapshot ? "rd-director" : "project-manager";
    session.slackPresenceGuestId = null;
    session.pingMemory.activeUpdateId = null;
    session.pingMemory.activeTask = null;
    session.pingMemory.context = null;
    await this.saveAgentSession(projectId, session);
    if (reportSnapshot) {
      void this.reviewPingExecutionWithTodd(projectId, reportSnapshot).catch((error) => {
        console.warn("[reviewPingExecutionWithTodd] background failure", error);
      });
    }
  }

  private async reviewPingExecutionWithTodd(
    projectId: string,
    report: PingExecutionReportSnapshot,
  ): Promise<void> {
    const settings = await this.store.readSettings();
    const project = await this.requireProject(projectId);
    const session = await this.store.getAgentSession(projectId);
    if (!session) {
      return;
    }
    syncAgentMemories(session);

    const responsePlaceholder = this.appendSlackAssistantMessage(session, "rd-director", "", { status: "working" });
    session.slackActiveDirectorId = "rd-director";
    session.slackPresenceGuestId = null;
    await this.saveAgentSession(projectId, session);

    try {
      const requestedModels = resolveDirectorRequestedModels(
        session,
        "rd-director",
        settings.advancedDefaults.model,
        settings.advancedDefaults.claudeModel,
      );
      const modelSelection = resolveDirectorModelSelection(
        "rd-director",
        report.task.runtime.provider,
        requestedModels.model,
        requestedModels.claudeModel,
        "synthesis",
      );
      const changedFileSnippets: string[] = [];
      for (const filePath of report.rawReport.changedFiles.slice(0, 10)) {
        try {
          const fullPath = join(project.localPath, filePath);
          const content = await readFile(fullPath, "utf-8");
          const lines = content.split("\n");
          const preview = lines.length > 120
            ? [...lines.slice(0, 120), `... (${lines.length - 120} more lines)`].join("\n")
            : content;
          changedFileSnippets.push(`--- ${filePath} ---\n${preview}`);
        } catch {
          changedFileSnippets.push(`--- ${filePath} --- (could not read)`);
        }
      }
      const changedFileContext = changedFileSnippets.length > 0
        ? changedFileSnippets.join("\n\n")
        : "(no changed file contents available)";

      const prompt = `You are Todd, the R&D Director for "${project.name}".
Review Ping's latest completed run and decide what happens next.

Current update task:
- Title: ${report.task.updateTitle ?? report.task.originalUserRequest}
- Description: ${report.task.updateDescription ?? report.task.toddExplanation ?? report.task.originalUserRequest}

Ping plan summary:
${report.plan?.summary ?? report.plan?.explanation ?? "(no stored plan summary)"}

Ping execution report:
- Status: ${report.rawReport.status}
- Summary: ${report.rawReport.summary}
- Changed files: ${report.rawReport.changedFiles.join(", ") || "(none)"}
- Blocker: ${report.rawReport.blocker ?? "(none)"}
- Unexpected notes: ${report.rawReport.unexpectedNotes.join(" | ") || "(none)"}

Updated file contents (post-execution indexed code):
${changedFileContext}

Provider usage before:
${report.usageBefore?.windows.map((window) => `- ${window.label}: ${window.usedPercent ?? 0}% used`).join("\n") ?? "(not captured)"}

Provider usage after:
${report.usageAfter?.windows.map((window) => `- ${window.label}: ${window.usedPercent ?? 0}% used`).join("\n") ?? "(not captured)"}

Todd's codebase map:
${session.toddMemory.codebaseIndexedMap?.summary ?? "(no current codebase map summary)"}

Previous update log:
${session.toddMemory.previousUpdateLog.slice(-5).map((entry) => `- ${entry.status}: ${entry.goal} -> ${entry.outcome}`).join("\n") || "(empty)"}

Trouble log:
${session.toddMemory.troubleLog.slice(-5).map((entry) => `- ${entry.title}: ${entry.details}`).join("\n") || "(empty)"}

Current state:
${session.toddMemory.currentState ?? "(not set)"}

End state goal:
${session.toddMemory.endStateGoal ?? "(not set)"}

Success chain:
${(session.toddMemory.successChain ?? []).length > 0
  ? session.toddMemory.successChain.map((step, i) => `${i + 1}. [${step.satisfied ? "satisfied" : "pending"}] ${step.title}: ${step.description}`).join("\n")
  : "(none)"}

Next update that was just executed:
${session.toddMemory.nextUpdate ? `${session.toddMemory.nextUpdate.title}: ${session.toddMemory.nextUpdate.description}` : "(not set)"}

Update queue:
${session.toddMemory.futureUpdatePlan.map((update) =>
  `- [${update.status}] ${update.title}: ${update.description}${update.updateKind ? ` | Kind: ${update.updateKind}` : ""}${update.simplificationMode ? ` | Simplification: ${update.simplificationMode}` : ""}`
).join("\n") || "(none)"}

Rules:
- Choose exactly one nextAction:
  - retry_ping
  - send_to_pong
  - finalize_success
  - finalize_partial
  - finalize_failure
- Use retry_ping only when Ping should immediately take one tighter follow-up step.
- Use send_to_pong when validation is needed before finalizing.
- Use finalize_partial only for a real step forward with no major regression of what already worked.
- Use finalize_failure when this step moved backward, broke important behavior, or should be reverted instead of continued.
- After deciding the current run, update the planning state:
  - updatedCurrentState: revise currentState to reflect what is now true after this run (required on all finalizing actions)
  - satisfiedStepTitles: list the exact titles of any success chain steps now fully satisfied by this run (empty array if none)
  - newNextUpdate: the full next update for Ping — the first unsatisfied and unblocked step from the success chain. Treat it as the exact Ping handoff contract with no extra rewrite. Include pillarIds, currentStateContext, successDefinition, partialSuccessDefinition, partialFailureDefinition, failureDefinition, updateKind, simplificationMode, structuralReason, supportsNextStep, skillsNeeded, and dependencies. Set to null if retry_ping is chosen (retryInstruction handles the next step) or if all steps are done.
- replanNeeded/replanUpdates: set replanNeeded=true and provide replanUpdates only if the code structure now makes the success chain invalid and a full replan is required. In that case, also set newNextUpdate to null.
- Trigger structural concern when responsibilities are mixed, one change would touch too many places, the module split no longer matches the concept, testing is messy because concerns are mixed, Ping would need workaround edits, coupling recently increased, or the next clean structure is blocked by the current shape
- File size alone is not enough reason to trigger a replan
- Keep response conversational and short. It is Todd's chat message.

Return strict JSON with:
{
  "response": string,
  "nextAction": string,
  "finalDecision": string | null,
  "finalSummary": string | null,
  "retryInstruction": string | null,
  "validationInstruction": string | null,
  "replanNeeded": boolean,
  "replanReason": string | null,
  "replanCurrentState": string | null,
  "replanIdealState": string | null,
  "replanUpdates": [...] | null,
  "updatedCurrentState": string | null,
  "satisfiedStepTitles": string[] | null,
  "newNextUpdate": {"title": string, "description": string, "pillarIds": string[], "currentStateContext": string|null, "successDefinition": string|null, "partialSuccessDefinition": string|null, "partialFailureDefinition": string|null, "failureDefinition": string|null, "updateKind": string|null, "simplificationMode": string|null, "structuralReason": string|null, "supportsNextStep": string|null, "skillsNeeded": string[], "dependencies": string[]} | null
}`;
      const rawResult = await this.aiService(report.task.runtime.provider).runOneShot(
        project,
        settings,
        prompt,
        report.task.runtime.provider === "claude" ? modelSelection.claudeModel : modelSelection.model,
        directorToddReviewSchema,
        resolveDirectorRuntime(session, "rd-director").reasoningEffort,
      );
      const parsed = parseAgentJsonResponse<Record<string, unknown>>(rawResult, {
        agentLabel: "Todd",
        context: "Todd review of Ping report",
      });
      const response = sanitizeSlackResponseContent(typeof parsed.response === "string" ? parsed.response : "I’ve reviewed Ping’s report.", "rd-director");
      const nextAction = normalizeToddReviewNextAction(parsed.nextAction);
      const replanNeeded = parsed.replanNeeded === true;
      const replanReason = normalizeOptionalToddText(parsed.replanReason);
      const replanCurrentState = normalizeOptionalToddText(parsed.replanCurrentState);
      const replanIdealState = normalizeOptionalToddText(parsed.replanIdealState);
      const replanUpdates = Array.isArray(parsed.replanUpdates)
        ? parsed.replanUpdates as ToddPlannedUpdateInput[]
        : null;

      const updatedCurrentState = normalizeOptionalToddText(parsed.updatedCurrentState);
      const satisfiedStepTitles = Array.isArray(parsed.satisfiedStepTitles)
        ? (parsed.satisfiedStepTitles as unknown[]).filter((s): s is string => typeof s === "string")
        : [];
      const rawNewNextUpdate = parsed.newNextUpdate && typeof parsed.newNextUpdate === "object"
        ? parsed.newNextUpdate as Record<string, unknown>
        : null;
      const newNextUpdate: ToddNextUpdate | null = rawNewNextUpdate ? normalizeToddNextUpdate(rawNewNextUpdate) : null;

      if (updatedCurrentState) {
        session.toddMemory.currentState = updatedCurrentState;
      }
      if (satisfiedStepTitles.length > 0) {
        const now = new Date().toISOString();
        session.toddMemory.successChain = (session.toddMemory.successChain ?? []).map((step) =>
          satisfiedStepTitles.includes(step.title)
            ? { ...step, satisfied: true, satisfiedAt: step.satisfiedAt ?? now }
            : step,
        );
      }
      if (newNextUpdate && !replanNeeded) {
        session.toddMemory.nextUpdate = newNextUpdate;
        const alreadyQueued = session.toddMemory.futureUpdatePlan.some(
          (u) => u.status === "pending" && u.title === newNextUpdate.title,
        );
        if (!alreadyQueued) {
          const asVersionUpdate: VersionUpdate = {
            id: newNextUpdate.id,
            versionId: null,
            title: newNextUpdate.title,
            description: newNextUpdate.description,
            order: session.toddMemory.futureUpdatePlan.length,
            status: "pending",
            dependencies: newNextUpdate.dependencies,
            pillarIds: newNextUpdate.pillarIds,
            skillsNeeded: newNextUpdate.skillsNeeded,
            updateKind: newNextUpdate.updateKind,
            simplificationMode: newNextUpdate.simplificationMode,
            structuralReason: newNextUpdate.structuralReason,
            supportsNextStep: newNextUpdate.supportsNextStep,
          };
          session.toddMemory.futureUpdatePlan = normalizeFutureUpdatePlan([
            ...session.toddMemory.futureUpdatePlan,
            asVersionUpdate,
          ]);
          session.versionUpdates = [...session.toddMemory.futureUpdatePlan];
        }
      }
      syncToddRoadmapPriorityFromNextUpdate(session);

      const createdAt = new Date().toISOString();
      this.replaceSlackAssistantMessage(session, "rd-director", {
        ...responsePlaceholder,
        content: response,
        createdAt,
        status: "complete",
        metadata: this.buildToddHardMemoryReportSnapshot(session, response, createdAt),
      });
      session.toddMemory.latestReportId = responsePlaceholder.id;
      try {
        const postPingFingerprint = await buildProjectKnowledgeFingerprint(project.localPath);
        if (session.toddMemory.codebaseIndexedMap && postPingFingerprint) {
          session.toddMemory.codebaseIndexedMap.lastIndexedFingerprint = postPingFingerprint;
        }
      } catch { /* non-fatal: fingerprint update is best-effort */ }
      await this.saveAgentSession(projectId, session);

      if (nextAction === "retry_ping") {
        const retryInstruction = typeof parsed.retryInstruction === "string" && parsed.retryInstruction.trim()
          ? parsed.retryInstruction.trim()
          : `Follow up on the latest issue: ${report.rawReport.summary}`;
        await this.startToddDirectedPingRun({
          projectId,
          message: retryInstruction,
          originalUserRequest: report.task.originalUserRequest,
          runtime: report.task.runtime,
        });
        return;
      }

      if (nextAction === "send_to_pong") {
        const validationInstruction = typeof parsed.validationInstruction === "string" && parsed.validationInstruction.trim()
          ? parsed.validationInstruction.trim()
          : report.rawReport.summary;
        await this.assignPongValidation({
          projectId,
          instruction: validationInstruction,
          updateId: report.task.updateId,
        });
        return;
      }

      const finalDecision = nextAction === "finalize_success"
        ? "successful"
        : nextAction === "finalize_partial"
          ? "partially-successful"
          : "failure";
      await this.finalizeToddOutcomeToJeff(projectId, {
        decision: finalDecision,
        summary: typeof parsed.finalSummary === "string" && parsed.finalSummary.trim()
          ? parsed.finalSummary.trim()
          : report.rawReport.summary,
        pingReport: report,
        validationReport: null,
        replanProposal: replanNeeded && replanReason && replanUpdates
          ? {
              reason: replanReason,
              currentState: replanCurrentState,
              idealState: replanIdealState,
              updates: replanUpdates,
            }
          : null,
      });
    } catch (error) {
      this.replaceSlackAssistantMessage(session, "rd-director", {
        ...responsePlaceholder,
        content: error instanceof Error ? error.message : "Todd could not review Ping's latest run.",
        createdAt: new Date().toISOString(),
        status: "complete",
        metadata: null,
      });
      try {
        const postPingFingerprint = await buildProjectKnowledgeFingerprint(project.localPath);
        if (session.toddMemory.codebaseIndexedMap && postPingFingerprint) {
          session.toddMemory.codebaseIndexedMap.lastIndexedFingerprint = postPingFingerprint;
        }
      } catch { /* non-fatal */ }
      await this.saveAgentSession(projectId, session);
      await this.finalizeToddOutcomeToJeff(projectId, {
        decision: report.rawReport.status === "blocked" ? "failure" : report.rawReport.status === "unexpected" ? "partially-successful" : "successful",
        summary: report.rawReport.summary,
        pingReport: report,
        validationReport: null,
      });
    }
  }

  private async reviewValidationWithTodd(
    projectId: string,
    validationReport: PongValidationReport,
  ): Promise<void> {
    const settings = await this.store.readSettings();
    const project = await this.requireProject(projectId);
    const session = await this.store.getAgentSession(projectId);
    if (!session) {
      return;
    }
    syncAgentMemories(session);
    const pingReport = session.pingMemory.currentRun?.report ?? null;

    const responsePlaceholder = this.appendSlackAssistantMessage(session, "rd-director", "", { status: "working" });
    session.slackActiveDirectorId = "rd-director";
    session.slackPresenceGuestId = "rd-director";
    await this.saveAgentSession(projectId, session);

    try {
      const requestedModels = resolveDirectorRequestedModels(
        session,
        "rd-director",
        settings.advancedDefaults.model,
        settings.advancedDefaults.claudeModel,
      );
      const provider = pingReport?.task.runtime.provider ?? session.provider;
      const modelSelection = resolveDirectorModelSelection(
        "rd-director",
        provider,
        requestedModels.model,
        requestedModels.claudeModel,
        "synthesis",
      );
      const prompt = `You are Todd, the R&D Director for "${project.name}".
Review Pong's latest validation after Ping's update and decide what happens next.

Ping execution summary:
${pingReport?.rawReport.summary ?? "(missing Ping report)"}

Validation report:
- Summary: ${validationReport.summary}
- Passed: ${validationReport.passed == null ? "unknown" : validationReport.passed ? "true" : "false"}
- Details: ${validationReport.details ?? "(none)"}

Validation usage before:
${validationReport.usageBefore?.windows.map((window) => `- ${window.label}: ${window.usedPercent ?? 0}% used`).join("\n") ?? "(not captured)"}

Validation usage after:
${validationReport.usageAfter?.windows.map((window) => `- ${window.label}: ${window.usedPercent ?? 0}% used`).join("\n") ?? "(not captured)"}

Previous update log:
${session.toddMemory.previousUpdateLog.slice(-5).map((entry) => `- ${entry.status}: ${entry.goal} -> ${entry.outcome}`).join("\n") || "(empty)"}

Trouble log:
${session.toddMemory.troubleLog.slice(-5).map((entry) => `- ${entry.title}: ${entry.details}`).join("\n") || "(empty)"}

Choose exactly one nextAction:
- retry_ping
- finalize_success
- finalize_partial
- finalize_failure

Return strict JSON with:
{
  "response": string,
  "nextAction": string,
  "finalDecision": string | null,
  "finalSummary": string | null,
  "retryInstruction": string | null,
  "validationInstruction": null,
  "replanNeeded": false,
  "replanReason": null,
  "replanCurrentState": null,
  "replanIdealState": null,
  "replanUpdates": null,
  "updatedCurrentState": null,
  "satisfiedStepTitles": null,
  "newNextUpdate": null
}`;
      const rawResult = await this.aiService(provider).runOneShot(
        project,
        settings,
        prompt,
        provider === "claude" ? modelSelection.claudeModel : modelSelection.model,
        directorToddReviewSchema,
        resolveDirectorRuntime(session, "rd-director").reasoningEffort,
      );
      const parsed = parseAgentJsonResponse<Record<string, unknown>>(rawResult, {
        agentLabel: "Todd",
        context: "Todd review of Pong validation",
      });
      const response = sanitizeSlackResponseContent(typeof parsed.response === "string" ? parsed.response : "I’ve reviewed Pong’s validation.", "rd-director");
      const nextAction = normalizeToddReviewNextAction(parsed.nextAction);
      this.replaceSlackAssistantMessage(session, "rd-director", {
        ...responsePlaceholder,
        content: response,
        createdAt: new Date().toISOString(),
        status: "complete",
        metadata: null,
      });
      await this.saveAgentSession(projectId, session);

      if (nextAction === "retry_ping" && pingReport) {
        const retryInstruction = typeof parsed.retryInstruction === "string" && parsed.retryInstruction.trim()
          ? parsed.retryInstruction.trim()
          : validationReport.summary;
        await this.startToddDirectedPingRun({
          projectId,
          message: retryInstruction,
          originalUserRequest: pingReport.task.originalUserRequest,
          runtime: pingReport.task.runtime,
        });
        return;
      }

      const finalDecision = nextAction === "finalize_success"
        ? "successful"
        : nextAction === "finalize_partial"
          ? "partially-successful"
          : "failure";
      await this.finalizeToddOutcomeToJeff(projectId, {
        decision: finalDecision,
        summary: typeof parsed.finalSummary === "string" && parsed.finalSummary.trim()
          ? parsed.finalSummary.trim()
          : validationReport.summary,
        pingReport,
        validationReport,
      });
    } catch (error) {
      this.replaceSlackAssistantMessage(session, "rd-director", {
        ...responsePlaceholder,
        content: error instanceof Error ? error.message : "Todd could not review Pong's validation.",
        createdAt: new Date().toISOString(),
        status: "complete",
        metadata: null,
      });
      await this.saveAgentSession(projectId, session);
      await this.finalizeToddOutcomeToJeff(projectId, {
        decision: validationReport.passed === false ? "failure" : validationReport.passed === true ? "successful" : "partially-successful",
        summary: validationReport.summary,
        pingReport,
        validationReport,
      });
    }
  }

  private async finalizeToddOutcomeToJeff(inputProjectId: string, input: {
    decision: JeffOutcomeDecision;
    summary: string;
    pingReport: PingExecutionReportSnapshot | null;
    validationReport: PongValidationReport | null;
    replanProposal?: {
      reason: string;
      currentState: string | null;
      idealState: string | null;
      updates: ToddPlannedUpdateInput[];
    } | null;
  }): Promise<void> {
    const session = await this.store.getAgentSession(inputProjectId);
    if (!session) {
      return;
    }
    syncAgentMemories(session);
    const pingReport = input.pingReport;
    const rawReport = pingReport?.rawReport ?? session.pingMemory.latestRawReport;
    if (!rawReport) {
      return;
    }

    const updateId = rawReport.updateId;
    const activeUpdate = updateId
      ? session.toddMemory.futureUpdatePlan.find((update) => update.id === updateId) ?? null
      : null;
    const historyUpdateId = pingReport?.historyUpdateId ?? input.validationReport?.historyUpdateId ?? null;
    const commitSha = pingReport?.commitSha ?? null;
    const roadmapVersions = collectToddRoadmapVersions(session);
    const replanProposal = input.replanProposal && input.replanProposal.updates.length > 0
      ? input.replanProposal
      : null;
    const replanApproval = replanProposal
      ? this.queueToddUpdatePlanApproval(session, {
          summary: this.buildApprovalSummary("Confirm structural replan", replanProposal.reason),
          draftMessage: `Todd recommends a structural replan before the next priority update.\n\n${replanProposal.reason}`,
          updates: mapToddPlannedUpdates(session, roadmapVersions, replanProposal.updates).updates,
          currentState: replanProposal.currentState,
          idealState: replanProposal.idealState,
          planSource: "post-run-structural-check",
          supersedesConfirmedPlan: true,
        })
      : null;
    const report = buildJeffExecutionReport({
      rawReport,
      title: activeUpdate
        ? `Project Status Report: ${activeUpdate.title}`
        : pingReport?.task.updateTitle
          ? `Project Status Report: ${pingReport.task.updateTitle}`
          : "Project Status Report",
      summary: input.summary,
      outcome: input.summary,
      toddRecommendedDecision: input.decision,
      toddFollowUpNeeded: input.decision !== "successful",
      toddFollowUpReason: input.decision === "successful" ? null : input.summary,
      toddReplanNeeded: Boolean(replanProposal),
      toddReplanReason: replanProposal?.reason ?? null,
      toddReplanApprovalId: replanApproval?.id ?? null,
      historyUpdateId,
      commitSha,
      decision: null,
      pingReport,
      validationReport: input.validationReport,
      revertAvailable: Boolean(commitSha && historyUpdateId),
      revertHistoryUpdateId: historyUpdateId,
      revertCommitSha: commitSha,
    });
    const projectStatus: JeffProjectStatusEntry["status"] = input.decision === "successful"
      ? "success"
      : input.decision === "failure"
        ? "failure"
        : input.validationReport?.passed === false || rawReport.status === "blocked"
          ? "partial-failure"
          : "partial-success";
    const trackedUpdateStatus: VersionUpdate["status"] = input.decision === "successful"
      ? "completed"
      : input.decision === "failure"
        ? "failed"
        : input.validationReport?.passed === false || rawReport.status === "blocked"
          ? "failed"
          : "completed";

    session.pingMemory.latestJeffReport = report;
    session.jeffMemory.pendingReports = session.jeffMemory.pendingReports
      .filter((item) => item.id !== report.id && item.updateId !== report.updateId);
    session.jeffMemory.pendingValidations = session.jeffMemory.pendingValidations
      .filter((item) => item.updateId !== report.updateId);
    if (session.pingMemory.currentRun?.report && session.pingMemory.currentRun.report.rawReport.updateId === updateId) {
      session.pingMemory.currentRun.report = {
        ...session.pingMemory.currentRun.report,
        jeffReportId: report.id,
        jeffSummary: input.summary,
      };
    }
    if (activeUpdate) {
      upsertToddTrackedUpdate(session, {
        ...activeUpdate,
        status: trackedUpdateStatus,
      });
    }
    updateToddRoadmapPriorityStatus(session, projectStatus);
    appendJeffProjectStatusEntry(session, {
      summary: input.summary,
      status: projectStatus,
      reportId: report.id,
      sourceDirectorId: "rd-director",
    });

    this.appendJeffSlackMessage(
      session,
      input.decision === "successful"
        ? "Todd finalized the latest execution as a success and updated project status."
        : input.decision === "failure"
          ? "Todd finalized the latest execution as a failure and recorded what changed in project status."
          : "Todd finalized the latest execution as a partial result and recorded the follow-up state.",
      report,
    );
    session.slackActiveDirectorId = "project-manager";
    session.slackPresenceGuestId = null;
    session.automation.updatedAt = new Date().toISOString();
    this.appendToddHardMemoryReportMessage(
      session,
      `Todd hard memory updated after finalizing "${report.title}" as ${input.decision.replace(/-/g, " ")}.`,
    );

    if (input.decision === "failure") {
      session.automation.pendingRevertReportId = commitSha && historyUpdateId ? report.id : null;
      session.automation.pendingRevertHistoryUpdateId = historyUpdateId;
      session.automation.pendingRevertCommitSha = commitSha;
    }

    if (session.automation.status === "running" && (input.decision === "failure" || Boolean(replanProposal))) {
      this.patchAutomationState(session, {
        status: "stopped",
        stopReason: "awaiting-user",
        stopSummary: input.decision === "failure"
          ? "Automation paused after a failed Todd review."
          : "Automation paused while Todd waits for the structural replan to be confirmed.",
        currentStep: "awaiting-user",
        nextUpdateId: null,
      });
    }

    await this.saveAgentSession(inputProjectId, session);
  }

  private async executePlan(project: Project, settings: Settings, draft: PlanDraft): Promise<void> {
    const prepared = await this.preparePlanExecution(project, settings, draft);
    void this.executePreparedPlanAndPersist(prepared, settings, draft).catch((error) => {
      console.warn(
        "[executePlan] Background edit failed:",
        error instanceof Error ? error.message : error,
      );
    });
  }

  private async executePlanAndPersist(project: Project, settings: Settings, draft: PlanDraft): Promise<BasicAutomationRunResult> {
    const prepared = await this.preparePlanExecution(project, settings, draft);
    return this.executePreparedPlanAndPersist(prepared, settings, draft);
  }

  private async preparePlanExecution(project: Project, settings: Settings, draft: PlanDraft): Promise<PreparedPlanExecution> {
    applyPingExecutionRuntimeToDraft(draft);
    await this.requireProviderReady(draft.provider, settings);
    const executingProject = await this.updateProjectStatus(project, "executing", null);
    const service = this.aiService(draft.provider);
    const providerLabel = draft.provider === "claude" ? "Claude" : "Codex";
    try {
      await this.createBackupBeforeProjectEdit(executingProject, "Before AI edit");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Backup failed — AI edit cancelled.";
      await this.updateProjectStatus(executingProject, "error", message);
      await this.finalizePingExecutionOutcome(executingProject.id, {
        status: "blocked",
        summary: message,
        changedFiles: [],
        blocker: message,
        toddFollowUpReason: message,
        historyUpdateId: null,
        commitSha: null,
      });
      throw error;
    }

    return {
      executingProject,
      service,
      providerLabel,
    };
  }

  private async executePreparedPlanAndPersist(
    prepared: PreparedPlanExecution,
    settings: Settings,
    draft: PlanDraft,
  ): Promise<BasicAutomationRunResult> {
    const { executingProject, service, providerLabel } = prepared;
    try {
      const result = await service.executeApprovedPlan(executingProject, settings, draft);
      let latest = await this.requireProject(executingProject.id);
      await this.git.ensureRepository(latest.localPath);
      latest.description = result.description;
      latest.threadId = result.draft.threadId;
      latest.updatedAt = new Date().toISOString();
      latest.status = "executing";
      latest.lastError = null;
      await this.store.updateProject(latest);
      this.emit({ type: "project.updated", project: latest });

      result.draft.verifyingStatus = "in_progress";
      result.draft.verificationDetails = "Preparing the local save.";
      const changedFiles = await this.git.readWorkingTreeChangedFiles(latest.localPath);
      result.draft.diffStats = await this.git.readWorkingTreeDiffStats(latest.localPath);
      service.syncDraft(result.draft);

      const commitSha = await this.git.commitAll(latest.localPath, result.commitMessage);
      if (!commitSha) {
        result.draft.status = "completed";
        if (result.draft.planningMode === "none" && result.draft.thinkingStatus === "in_progress") {
          result.draft.thinkingStatus = "completed";
        }
        result.draft.buildingStatus = "completed";
        result.draft.verifyingStatus = "completed";
        result.draft.verificationDetails = "No local file changes were needed.";
        service.syncDraft(result.draft);
        latest = await this.updateProjectStatus(latest, "idle", null);
        await this.finalizePingExecutionOutcome(latest.id, {
          status: "no_changes",
          summary: "No local file changes were needed.",
          changedFiles: [],
          historyUpdateId: null,
          commitSha: null,
        });
        this.emit({
          type: "toast",
          level: "info",
          message: `${providerLabel} finished, but no local file changes were needed.`,
        });
        return {
          outcome: "no_changes",
          summary: "No local file changes were needed.",
        };
      }

      const historyRecord: UpdateRecord = {
        id: randomUUID(),
        projectId: latest.id,
        prompt: draft.prompt,
        summary: result.summary,
        description: result.description,
        commitSha,
        createdAt: new Date().toISOString(),
        kind: "update",
        status: "saved",
        errorMessage: null,
      };
      await this.store.addUpdateRecord(historyRecord);
      latest.lastUpdatedAt = historyRecord.createdAt;
      latest.status = "idle";
      latest.updatedAt = new Date().toISOString();
      latest.lastError = null;
      await this.store.updateProject(latest);
      await this.recomputeProjectRelationships(await this.store.listProjects(), true);
      latest = await this.requireProject(latest.id);
      this.emit({ type: "project.updated", project: latest });
      await this.emitHistory(latest.id);
      result.draft.status = "completed";
      if (result.draft.planningMode === "none" && result.draft.thinkingStatus === "in_progress") {
        result.draft.thinkingStatus = "completed";
      }
      result.draft.buildingStatus = "completed";
      result.draft.verifyingStatus = "completed";
      result.draft.verificationDetails = "Update saved locally.";
      service.syncDraft(result.draft);
      await this.finalizePingExecutionOutcome(latest.id, {
        status: "success",
        summary: result.summary || "Update saved locally.",
        changedFiles,
        historyUpdateId: historyRecord.id,
        commitSha,
      });
      this.emit({
        type: "toast",
        level: "success",
        message: "Update saved locally.",
      });
      return {
        outcome: "success",
        summary: result.summary || "Update saved locally.",
      };
    } catch (error) {
      const latest = await this.requireProject(executingProject.id);
      const message = error instanceof Error ? error.message : `PROGRAMS could not finish the update with ${providerLabel}.`;
      const currentDraft = service.getActivePlan(executingProject.id);
      if (currentDraft) {
        currentDraft.status = "failed";
        currentDraft.errorMessage = message;
        currentDraft.verificationDetails = currentDraft.errorMessage;
        if (currentDraft.verifyingStatus === "in_progress" || currentDraft.buildingStatus === "completed") {
          currentDraft.verifyingStatus = "failed";
        } else {
          currentDraft.buildingStatus = "failed";
          if (currentDraft.planningMode === "none" && currentDraft.thinkingStatus === "in_progress") {
            currentDraft.thinkingStatus = "failed";
          }
        }
        service.syncDraft(currentDraft);
      }
      await this.updateProjectStatus(latest, "error", message);
      if (isPingStartupFailure(error)) {
        await this.rollbackPingStartupState(
          latest.id,
          message,
          undefined,
          {
            existingProject: latest,
            preferredProjectStatus: "error",
          },
        );
        throw error;
      }
      await this.finalizePingExecutionOutcome(latest.id, {
        status: "blocked",
        summary: message,
        changedFiles: [],
        blocker: message,
        toddFollowUpReason: message,
        historyUpdateId: null,
        commitSha: null,
      });
      throw error;
    }
  }

  private async requireProject(projectId: string): Promise<Project> {
    const project = await this.store.readProject(projectId);
    if (!project) {
      throw new Error("Project not found.");
    }
    return project;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeRuntimeState();
    }

    await this.initializationPromise;
  }

  private async initializeRuntimeState(): Promise<void> {
    const settings = await this.store.readSettings();
    const colorNormalizedProjects = await this.ensureUniqueProjectIconColors(await this.store.listProjects());
    const projects = await this.recomputeProjectRelationships(colorNormalizedProjects, false);
    await this.runner.restorePersistedRuntimes(projects, settings.appSourcePath, process.env.ELECTRON_RENDERER_URL ?? null);
    await this.normalizeAutomationSessionsOnStartup(projects);
    await this.reconcileProjectStatuses(projects, false);
    this.syncBasicAutomationForSettings(settings);
  }

  private resolveProjectIconColor(
    inputColor: string,
    projects: Project[],
    excludeProjectId: string | null = null,
    fallbackToAvailable = false,
  ): string {
    const normalized = normalizeProjectIconColor(inputColor);
    const usedColors = collectUsedProjectIconColors(projects, excludeProjectId);

    if (normalized && !usedColors.has(normalized)) {
      return normalized;
    }

    if (fallbackToAvailable) {
      return pickAvailableProjectIconColor(usedColors, normalized);
    }

    if (!normalized) {
      throw new Error("Choose a valid project color.");
    }

    throw new Error("That project color is already in use. Choose another color.");
  }

  private async ensureUniqueProjectIconColors(projectsArg?: Project[]): Promise<Project[]> {
    const projects = projectsArg ?? (await this.store.listProjects());
    const ordered = [...projects].sort((left, right) => {
      const createdDelta = left.createdAt.localeCompare(right.createdAt);
      if (createdDelta !== 0) {
        return createdDelta;
      }
      return left.id.localeCompare(right.id);
    });
    const usedColors = new Set<string>();
    const nextColors = new Map<string, string>();

    for (const project of ordered) {
      const normalized = normalizeProjectIconColor(project.iconColor);
      const nextColor =
        normalized && !usedColors.has(normalized)
          ? normalized
          : pickAvailableProjectIconColor(usedColors, normalized);

      usedColors.add(nextColor);
      if (nextColor !== project.iconColor) {
        const nextProject: Project = { ...project, iconColor: nextColor };
        await this.store.updateProject(nextProject);
        nextColors.set(project.id, nextColor);
      }
    }

    if (nextColors.size === 0) {
      return projects;
    }

    return projects.map((project) =>
      nextColors.has(project.id)
        ? { ...project, iconColor: nextColors.get(project.id)! }
        : project,
    );
  }

  private async recomputeProjectRelationships(projectsArg?: Project[], emitEvents = false): Promise<Project[]> {
    const projects = projectsArg ?? (await this.store.listProjects());
    if (projects.length === 0) {
      return projects;
    }

    const scannedAt = new Date().toISOString();
    const snapshots = await Promise.all(projects.map((project) => buildProjectRelationshipSnapshot(project)));
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.project.id, snapshot]));
    const exactParentCandidates = new Map<string, Array<{ parentId: string; parentFileCount: number; parentCreatedAt: string }>>();
    const maybeRelatedByProjectId = new Map<string, ProjectRelationshipCandidate[]>();

    for (let index = 0; index < snapshots.length; index += 1) {
      const left = snapshots[index];
      if (left.scanFailed || left.meaningfulFileCount < 3) {
        continue;
      }

      for (let innerIndex = index + 1; innerIndex < snapshots.length; innerIndex += 1) {
        const right = snapshots[innerIndex];
        if (right.scanFailed || right.meaningfulFileCount < 3) {
          continue;
        }

        const sharedFileCount = countSharedRelationshipFiles(left.fileHashCounts, right.fileHashCounts);
        if (sharedFileCount === 0) {
          continue;
        }

        const smallerFileCount = Math.min(left.meaningfulFileCount, right.meaningfulFileCount);
        const overlapRatio = sharedFileCount / smallerFileCount;
        const leftReferencesRight = projectRelationshipHasReference(left, right);
        const rightReferencesLeft = projectRelationshipHasReference(right, left);
        const leftIsExactChild =
          (left.meaningfulFileCount < right.meaningfulFileCount && sharedFileCount === left.meaningfulFileCount)
          || (
            left.meaningfulFileCount < right.meaningfulFileCount
            && overlapRatio >= PROJECT_RELATIONSHIP_NEAR_EXACT_THRESHOLD
          )
          || (
            rightReferencesLeft
            && !leftReferencesRight
            && sharedFileCount >= PROJECT_RELATIONSHIP_INTEGRATION_MIN_SHARED_FILES
          );
        const rightIsExactChild =
          (right.meaningfulFileCount < left.meaningfulFileCount && sharedFileCount === right.meaningfulFileCount)
          || (
            right.meaningfulFileCount < left.meaningfulFileCount
            && overlapRatio >= PROJECT_RELATIONSHIP_NEAR_EXACT_THRESHOLD
          )
          || (
            leftReferencesRight
            && !rightReferencesLeft
            && sharedFileCount >= PROJECT_RELATIONSHIP_INTEGRATION_MIN_SHARED_FILES
          );

        if (leftIsExactChild) {
          const candidates = exactParentCandidates.get(left.project.id) ?? [];
          candidates.push({
            parentId: right.project.id,
            parentFileCount: right.meaningfulFileCount,
            parentCreatedAt: right.project.createdAt,
          });
          exactParentCandidates.set(left.project.id, candidates);
          continue;
        }

        if (rightIsExactChild) {
          const candidates = exactParentCandidates.get(right.project.id) ?? [];
          candidates.push({
            parentId: left.project.id,
            parentFileCount: left.meaningfulFileCount,
            parentCreatedAt: left.project.createdAt,
          });
          exactParentCandidates.set(right.project.id, candidates);
          continue;
        }

        if (sharedFileCount < 3 || overlapRatio < 0.35) {
          continue;
        }

        const leftCandidates = maybeRelatedByProjectId.get(left.project.id) ?? [];
        leftCandidates.push({
          projectId: right.project.id,
          overlapRatio,
          sharedFileCount,
        });
        maybeRelatedByProjectId.set(left.project.id, leftCandidates);

        const rightCandidates = maybeRelatedByProjectId.get(right.project.id) ?? [];
        rightCandidates.push({
          projectId: left.project.id,
          overlapRatio,
          sharedFileCount,
        });
        maybeRelatedByProjectId.set(right.project.id, rightCandidates);
      }
    }

    const exactParentByChildId = new Map<string, string>();
    for (const [childId, candidates] of exactParentCandidates.entries()) {
      candidates.sort((left, right) => {
        if (left.parentFileCount !== right.parentFileCount) {
          return left.parentFileCount - right.parentFileCount;
        }
        if (left.parentCreatedAt !== right.parentCreatedAt) {
          return left.parentCreatedAt.localeCompare(right.parentCreatedAt);
        }
        return left.parentId.localeCompare(right.parentId);
      });
      exactParentByChildId.set(childId, candidates[0].parentId);
    }

    const exactChildrenByParentId = new Map<string, string[]>();
    for (const [childId, parentId] of exactParentByChildId.entries()) {
      const children = exactChildrenByParentId.get(parentId) ?? [];
      children.push(childId);
      exactChildrenByParentId.set(parentId, children);
    }

    const nextProjects: Project[] = [];
    for (const project of projects) {
      const snapshot = snapshotById.get(project.id);
      if (!snapshot) {
        nextProjects.push(project);
        continue;
      }

      if (snapshot.scanFailed) {
        nextProjects.push(project);
        continue;
      }

      const exactChildProjectIds = [...(exactChildrenByParentId.get(project.id) ?? [])].sort((leftId, rightId) => {
        const leftProject = projectById.get(leftId);
        const rightProject = projectById.get(rightId);
        if (leftProject && rightProject) {
          return leftProject.name.localeCompare(rightProject.name);
        }
        return leftId.localeCompare(rightId);
      });
      const maybeRelated = (maybeRelatedByProjectId.get(project.id) ?? [])
        .filter((candidate) =>
          candidate.projectId !== exactParentByChildId.get(project.id)
          && exactParentByChildId.get(candidate.projectId) !== project.id,
        )
        .sort(compareProjectRelationshipCandidates);

      const nextRelationship: ProjectRelationshipSummary = {
        scannedAt,
        contentUpdatedAt: snapshot.contentUpdatedAt,
        exactParentProjectId: exactParentByChildId.get(project.id) ?? null,
        exactChildProjectIds,
        maybeRelated,
      };

      if (sameProjectRelationshipSummary(project.relationship, nextRelationship)) {
        nextProjects.push(project);
        continue;
      }

      const nextProject: Project = {
        ...project,
        relationship: nextRelationship,
      };
      await this.store.updateProject(nextProject);
      if (emitEvents) {
        this.emit({ type: "project.updated", project: nextProject });
      }
      nextProjects.push(nextProject);
    }

    return nextProjects;
  }

  private async syncSelfRuntime(
    settingsArg?: Settings,
    projectsArg?: Project[],
    emitEvents = false,
  ): Promise<Project[]> {
    const settings = settingsArg ?? (await this.store.readSettings());
    const projects = projectsArg ?? (await this.store.listProjects());
    const changedIds = this.runner.syncSelfRuntime(
      projects,
      settings.appSourcePath,
      process.env.ELECTRON_RENDERER_URL ?? null,
    );
    const nextProjects = await this.reconcileProjectStatuses(projects, emitEvents);

    if (emitEvents) {
      for (const projectId of changedIds) {
        this.emit({
          type: "project.runtime",
          projectId,
          runtime: this.runner.getRuntime(projectId),
        });
      }
    }

    return nextProjects;
  }

  private async reconcileProjectStatuses(projects: Project[], emitEvents: boolean): Promise<Project[]> {
    const nextProjects: Project[] = [];

    for (const project of projects) {
      const runtime = this.runner.getRuntime(project.id);
      const nextStatus = this.resolveRuntimeBackedStatus(project.status, runtime.running);
      const nextLastError = runtime.running ? null : project.lastError;

      if (nextStatus === project.status && nextLastError === project.lastError) {
        nextProjects.push(project);
        continue;
      }

      const nextProject: Project = {
        ...project,
        status: nextStatus,
        lastError: nextLastError,
        updatedAt: new Date().toISOString(),
      };
      await this.store.updateProject(nextProject);
      if (emitEvents) {
        this.emit({ type: "project.updated", project: nextProject });
      }
      nextProjects.push(nextProject);
    }

    return nextProjects;
  }

  private async syncProjectRuntimeState(
    project: Project,
    emitUpdates = true,
  ): Promise<{ project: Project; runtime: RuntimeState }> {
    let runtime = await this.runner.validateRuntime(project.id);
    if (!runtime.running) {
      runtime = await this.runner.detectExternalRuntime(project);
    }
    const nextStatus = this.resolveRuntimeBackedStatus(project.status, runtime.running);
    const nextLastError = runtime.running ? null : project.lastError;

    if (nextStatus === project.status && nextLastError === project.lastError) {
      return { project, runtime };
    }

    const nextProject: Project = {
      ...project,
      status: nextStatus,
      lastError: nextLastError,
      updatedAt: new Date().toISOString(),
    };
    await this.store.updateProject(nextProject);
    if (emitUpdates) {
      this.emit({ type: "project.updated", project: nextProject });
    }

    return { project: nextProject, runtime };
  }

  private resolveRuntimeBackedStatus(status: Project["status"], runtimeRunning: boolean): Project["status"] {
    if (runtimeRunning) {
      if (status === "executing" || status === "planning" || status === "awaitingApproval") {
        return status;
      }

      return "running";
    }

    return status === "running" ? "idle" : status;
  }

  private async refreshProjectsRuntimeConfig(projects: Project[]): Promise<Project[]> {
    return Promise.all(projects.map((project) => this.refreshProjectRuntimeConfig(project)));
  }

  private async refreshProjectRuntimeConfig(project: Project): Promise<Project> {
    let detected: Project["runtimeConfig"];
    try {
      detected = await detectRuntimeConfig(this.getProjectWorkingPath(project));
    } catch {
      return project;
    }

    const nextRuntimeConfig = reconcileRuntimeConfig(project.runtimeConfig, detected);

    if (JSON.stringify(nextRuntimeConfig) === JSON.stringify(project.runtimeConfig)) {
      return project;
    }

    const nextProject: Project = {
      ...project,
      runtimeConfig: nextRuntimeConfig,
    };
    await this.store.updateProject(nextProject);
    return nextProject;
  }

  // Guarantee the project owns a stable, unique port before launch so concurrent
  // projects never collide on a shared framework default. Allocated lazily and
  // persisted, so a project keeps the same port across restarts.
  private async ensureAssignedPort(project: Project): Promise<Project> {
    const current = project.runtimeConfig.assignedPort;

    const otherProjects = await this.store.listProjects();
    const takenPorts = new Set<number>();
    for (const other of otherProjects) {
      if (other.id === project.id) {
        continue;
      }
      const port = other.runtimeConfig.assignedPort;
      if (isValidAssignedPort(port)) {
        takenPorts.add(port);
      }
    }

    // Keep a valid existing assignment unless another project has the same port.
    if (isValidAssignedPort(current) && !takenPorts.has(current)) {
      return project;
    }

    const assignedPort = await allocatePort({ projectId: project.id, takenPorts });
    const nextProject: Project = {
      ...project,
      updatedAt: new Date().toISOString(),
      runtimeConfig: {
        ...project.runtimeConfig,
        assignedPort,
      },
    };
    await this.store.updateProject(nextProject);
    this.emit({ type: "project.updated", project: nextProject });
    return nextProject;
  }

  private getProjectWorkingPath(project: Project): string {
    return project.runtimeConfig.launch?.workspacePath?.trim() || project.localPath;
  }

  private getLaunchWorkspaceRoot(project: Project): string {
    return join(app.getPath("userData"), "launch-workspaces", project.id);
  }

  private getLaunchWorkspacePath(project: Project): string {
    return join(this.getLaunchWorkspaceRoot(project), "workspace");
  }

  private getLaunchWrapperPath(workspacePath: string): string {
    return join(workspacePath, ".programs", "launch.sh");
  }

  private async copyProjectToLaunchWorkspace(project: Project): Promise<string> {
    const workspacePath = this.getLaunchWorkspacePath(project);
    await rm(workspacePath, { force: true, recursive: true });
    await ensureDirectory(this.getLaunchWorkspaceRoot(project));

    const copyFilter = (source: string): boolean => {
      const relativeSource = relative(project.localPath, source);
      if (!relativeSource || relativeSource === "") {
        return true;
      }
      const segments = relativeSource.split(sep).filter(Boolean);
      return !segments.some((segment) => IGNORED_LAUNCH_DIRECTORIES.has(segment));
    };

    await cp(project.localPath, workspacePath, {
      recursive: true,
      force: true,
      filter: (source) => copyFilter(source),
    });

    return workspacePath;
  }

  private async ensureLaunchWorkspaceIfNeeded(project: Project): Promise<Project> {
    if (project.runtimeConfig.runCommand) {
      return project;
    }

    const resolution = await resolveLaunchPlan(project.localPath);
    if (!resolution.wrapperSteps?.length || resolution.runCommand) {
      return project;
    }

    return this.materializeLaunchWorkspace(project, resolution, "wrapped");
  }

  // Discard the cached launch-workspace copy so the next run rebuilds it from the
  // current localPath. Without this, downloads update localPath but runs keep using
  // the stale workspace copy created on a previous run.
  private async invalidateLaunchWorkspace(project: Project): Promise<Project> {
    // Always remove the on-disk copy so a fresh one is materialized next run.
    await rm(this.getLaunchWorkspaceRoot(project), { force: true, recursive: true });

    // If a synthetic launch wrapper was in effect, clear it so detection + re-wrapping
    // run again against the updated localPath.
    if (!project.runtimeConfig.launch) {
      return project;
    }
    const { launch, ...restConfig } = project.runtimeConfig;
    const nextRuntimeConfig: Project["runtimeConfig"] = {
      ...restConfig,
      // Drop the synthetic wrapper command; keep any genuinely-detected command.
      runCommand:
        project.runtimeConfig.runCommand === "bash .programs/launch.sh"
          ? null
          : project.runtimeConfig.runCommand,
    };
    const nextProject: Project = { ...project, runtimeConfig: nextRuntimeConfig };
    await this.store.updateProject(nextProject);
    return nextProject;
  }

  private async materializeLaunchWorkspace(
    project: Project,
    resolution: LaunchResolution,
    origin: "wrapped" | "repaired",
  ): Promise<Project> {
    const workspacePath = await this.copyProjectToLaunchWorkspace(project);
    const wrapperPath = this.getLaunchWrapperPath(workspacePath);
    await ensureDirectory(dirname(wrapperPath));
    const wrapperScript = this.buildLaunchWrapperScript(resolution);
    await writeTextFile(wrapperPath, wrapperScript);

    const nextRuntimeConfig: Project["runtimeConfig"] = {
      ...project.runtimeConfig,
      packageManager: resolution.packageManager,
      installCommand: resolution.installCommand ?? project.runtimeConfig.installCommand,
      runCommand: "bash .programs/launch.sh",
      openUrl: resolution.openUrl ?? project.runtimeConfig.openUrl,
      launch: {
        origin,
        confidence: resolution.launch?.confidence ?? "medium",
        locked: false,
        candidate: {
          kind: origin === "repaired" ? "repair" : "wrapper",
          source: resolution.launch?.candidate?.source ?? "composite launch",
          confidence: resolution.launch?.confidence ?? "medium",
          summary: resolution.launch?.candidate?.summary ?? `Launches ${resolution.wrapperSteps?.length ?? 0} nested app roots.`,
          notes: resolution.launch?.candidate?.notes ?? [],
        },
        wrapperPath,
        workspacePath,
      },
    };

    const nextProject: Project = {
      ...project,
      updatedAt: new Date().toISOString(),
      runtimeConfig: nextRuntimeConfig,
    };
    await this.store.updateProject(nextProject);
    this.emit({ type: "project.updated", project: nextProject });
    return nextProject;
  }

  async prepareLaunchRepair(projectId: string): Promise<Project> {
    await this.ensureInitialized();
    const project = await this.refreshProjectRuntimeConfig(await this.requireProject(projectId));
    const resolution = await resolveLaunchPlan(project.localPath);

    if (resolution.wrapperSteps?.length) {
      return this.materializeLaunchWorkspace(project, resolution, "repaired");
    }

    const workspacePath = await this.copyProjectToLaunchWorkspace(project);

    const nextProject: Project = {
      ...project,
      updatedAt: new Date().toISOString(),
      runtimeConfig: {
        ...project.runtimeConfig,
        launch: {
          origin: "repaired",
          confidence: resolution.launch?.confidence ?? "medium",
          locked: false,
          candidate: {
            kind: "repair",
            source: resolution.launch?.candidate?.source ?? "repair workspace",
            confidence: resolution.launch?.confidence ?? "medium",
            summary: "PROGRAMS prepared a repair workspace clone.",
            notes: [
              ...(resolution.launch?.candidate?.notes ?? []),
              "PROGRAMS created a safe working copy for manual repair.",
            ],
          },
          wrapperPath: null,
          workspacePath,
        },
      },
    };
    await this.store.updateProject(nextProject);
    this.emit({ type: "project.updated", project: nextProject });
    this.emit({
      type: "toast",
      level: "info",
      message: "PROGRAMS prepared a repair workspace copy for this project.",
    });
    return nextProject;
  }

  private buildLaunchWrapperScript(resolution: LaunchResolution): string {
    const steps = resolution.wrapperSteps ?? [];
    const lines = [
      "#!/bin/bash",
      "set -e",
      "trap 'kill 0' EXIT INT TERM",
    ];

    for (const step of steps) {
      const command = step.command.trim();
      if (!command) {
        continue;
      }

      lines.push(`(${command}) &`);
    }

    lines.push("wait");
    return `${lines.join("\n")}\n`;
  }

  private async emitHistory(projectId: string): Promise<void> {
    const updates = await this.store.readHistory(projectId);
    this.emit({ type: "project.history", projectId, updates });
  }

  private async emitSetupUpdated(
    settings?: Settings,
    codex?: CodexAuthStatus,
    claudeStatus?: ClaudeAuthStatus,
  ): Promise<void> {
    const snapshot = await this.buildSetupSnapshot(settings, codex, claudeStatus);
    this.emit({ type: "setup.updated", setup: snapshot });
  }

  private async buildSetupSnapshot(
    settingsArg?: Settings,
    codexArg?: CodexAuthStatus,
    claudeArg?: ClaudeAuthStatus,
  ): Promise<SetupSnapshot> {
    const settings = settingsArg ?? (await this.store.readSettings());
    const [setupState, gitVersion, codex, claudeStatus] = await Promise.all([
      this.store.readSetupState(),
      this.git.getVersion(),
      codexArg ? Promise.resolve(codexArg) : this.codex.getAuthStatus(settings),
      claudeArg ? Promise.resolve(claudeArg) : this.claude.getAuthStatus(settings),
    ]);

    const isPackagedBuild = app.isPackaged;
    const codexInstalled = codex.available && Boolean(codex.binaryPath);
    const claudeInstalled = claudeStatus.available && Boolean(claudeStatus.binaryPath);
    const gitInstalled = Boolean(gitVersion);

    const checks: SetupCheck[] = [
      {
        id: "codexInstall",
        section: "need",
        label: "Install Codex",
        status: codexInstalled ? "confirmed" : "action_required",
        version: codex.version,
        detail: codexInstalled
          ? codex.binaryPath
            ? `Installed at ${codex.binaryPath}.`
            : "Installed and ready."
          : "Required before PROGRAMS can plan or apply changes.",
        actionLabel: codexInstalled ? null : "Install & Connect",
        actionKind: codexInstalled ? "none" : "setupCodex",
        actionTarget: null,
        secondaryActionLabel: codexInstalled ? "View" : null,
        secondaryActionKind: codexInstalled ? "openExternal" : "none",
        secondaryActionTarget: codexInstalled ? CODEX_DOWNLOAD_URL : null,
        required: true,
      },
      {
        id: "codexLogin",
        section: "need",
        label: "Connect Codex",
        status: !codexInstalled ? "info" : codex.loggedIn ? "confirmed" : "action_required",
        version: null,
        detail: !codexInstalled
          ? "Install Codex first."
          : codex.loggedIn
            ? codex.email
              ? `Confirmed as ${codex.email}.`
              : "Confirmed."
            : "PROGRAMS opens the browser sign-in flow and validates it after login.",
        actionLabel: !codexInstalled ? null : codex.loggedIn ? null : "Connect",
        actionKind: !codexInstalled ? "none" : codex.loggedIn ? "none" : "codexLogin",
        actionTarget: null,
        secondaryActionLabel: null,
        secondaryActionKind: "none",
        secondaryActionTarget: null,
        required: true,
      },
      {
        id: "claudeInstall",
        section: "assistant",
        label: "Install Claude Code",
        status: claudeInstalled ? "confirmed" : "info",
        version: claudeStatus.version,
        detail: claudeInstalled
          ? claudeStatus.binaryPath
            ? `Installed at ${claudeStatus.binaryPath}.`
            : "Installed and ready."
          : "Optional. Install and connect Claude Code to use Claude for updates.",
        actionLabel: claudeInstalled ? null : "Install & Connect",
        actionKind: claudeInstalled ? "none" : "setupClaude",
        actionTarget: null,
        secondaryActionLabel: claudeInstalled ? "View" : null,
        secondaryActionKind: claudeInstalled ? "openExternal" : "none",
        secondaryActionTarget: claudeInstalled ? CLAUDE_DOWNLOAD_URL : null,
        required: false,
      },
      {
        id: "claudeLogin",
        section: "assistant",
        label: "Connect Claude",
        status: !claudeInstalled
          ? "info"
          : claudeStatus.loggedIn
            ? claudeStatus.ready
              ? claudeStatus.canConnect
                ? "confirmed"
                : "info"
              : "action_required"
            : claudeStatus.canConnect
              ? "info"
              : "action_required",
        version: null,
        detail: !claudeInstalled
          ? "Install Claude Code first."
          : claudeStatus.loggedIn
            ? claudeStatus.ready
              ? claudeStatus.canConnect
                ? claudeStatus.email
                  ? `Confirmed as ${claudeStatus.email}.`
                  : "Confirmed and ready."
                : claudeStatus.email
                  ? `Confirmed as ${claudeStatus.email}. Update Claude Code to keep in-app sign-in compatible.`
                  : "Confirmed. Update Claude Code to keep in-app sign-in compatible."
              : claudeStatus.runtimeErrorMessage ?? "Claude needs attention before it can run in PROGRAMS."
            : claudeStatus.canConnect
              ? "Sign in to use your Claude subscription."
              : claudeStatus.connectErrorMessage ?? "Update Claude Code to connect your Claude account from PROGRAMS.",
        actionLabel: !claudeInstalled
          ? null
          : claudeStatus.loggedIn
            ? claudeStatus.ready
              ? claudeStatus.canConnect
                ? null
                : "Update Claude"
              : "Repair"
            : claudeStatus.canConnect
              ? "Connect"
              : "Update Claude",
        actionKind: !claudeInstalled
          ? "none"
          : claudeStatus.loggedIn
            ? claudeStatus.ready
              ? claudeStatus.canConnect
                ? "none"
                : "setupClaude"
              : "setupClaude"
            : claudeStatus.canConnect
              ? "claudeLogin"
              : "setupClaude",
        actionTarget: null,
        secondaryActionLabel: null,
        secondaryActionKind: "none",
        secondaryActionTarget: null,
        required: false,
      },
      {
        id: "gitInstall",
        section: "assistant",
        label: "Install Git",
        status: gitInstalled ? "confirmed" : "action_required",
        version: gitVersion,
        detail: gitInstalled
          ? "Confirmed and ready for sync."
          : "PROGRAMS can ask macOS to install it. You only confirm the system prompt.",
        actionLabel: gitInstalled ? null : "Install",
        actionKind: gitInstalled ? "none" : "installGit",
        actionTarget: null,
        secondaryActionLabel: gitInstalled ? "Refresh" : null,
        secondaryActionKind: gitInstalled ? "refresh" : "none",
        secondaryActionTarget: null,
        required: true,
      },
    ];

    const isSetupComplete = checks.every((check) => !check.required || check.status === "confirmed");
    const currentCheckId = checks.find((check) => check.required && check.status !== "confirmed")?.id ?? null;

    return {
      checks,
      completedAt: setupState.completedAt,
      isSetupComplete,
      showSetupOnLaunch: false,
      currentCheckId,
      isPackagedBuild,
    };
  }

  private emitAppUpdateStatus(status: AppUpdateStatus): void {
    const nextJson = JSON.stringify(status);
    if (nextJson === this.lastAppUpdateStatusJson) {
      return;
    }

    this.lastAppUpdateStatusJson = nextJson;
    this.emit({ type: "appUpdate.status", status });
  }

  private async refreshAppUpdateStatus(settings: Settings, autoBuild: boolean): Promise<AppUpdateStatus> {
    const evaluation = await this.evaluateAppUpdate(settings);

    if (autoBuild && evaluation.shouldPackage && evaluation.packageKey && evaluation.workspacePath) {
      this.ensureAppUpdatePackaging(settings, evaluation.workspacePath, evaluation.packageKey);
      return (await this.evaluateAppUpdate(settings)).status;
    }

    return evaluation.status;
  }

  private async evaluateAppUpdate(settings: Settings): Promise<AppUpdateEvaluation> {
    if (process.platform !== "darwin" || !app.isPackaged) {
      return {
        status: {
          supported: false,
          available: false,
          currentAppPath: null,
          candidateAppPath: null,
          workspacePath: null,
          workspaceExists: false,
          sourceUpdatedAt: null,
          launchedAppUpdatedAt: null,
          currentUpdatedAt: null,
          candidateUpdatedAt: null,
          currentRendererAssetName: null,
          currentRendererAssetUpdatedAt: null,
          candidateRendererAssetName: null,
          candidateRendererAssetUpdatedAt: null,
          rendererAssetMatch: null,
          buildState: "idle",
          buildError: null,
          requiresAdminPrompt: false,
          action: "none",
          reason: "App updates are only available from the packaged macOS app.",
        },
        shouldPackage: false,
        packageKey: null,
        statusKey: null,
        workspacePath: null,
      };
    }

    const currentAppPath = this.currentAppBundlePath();
    const launchedAppUpdatedAt = await this.launchedAppUpdatedAtPromise;
    const currentUpdatedAt = currentAppPath ? await this.readModifiedAt(currentAppPath) : null;
    const workspace = await this.readAppUpdateWorkspace(settings);
    const currentRendererAsset = await this.readRendererAssetInfo(currentAppPath);
    const candidateRendererAsset = await this.readRendererAssetInfo(workspace.candidateAppPath);
    const packageKey =
      workspace.workspaceValid && workspace.workspacePath && workspace.sourceUpdatedAt
        ? this.buildAppUpdatePackageKey(workspace.workspacePath, workspace.sourceUpdatedAt)
        : null;
    const statusKey = this.buildAppUpdateStatusKey(
      workspace.workspacePath ?? currentAppPath,
      workspace.sourceUpdatedAt ?? workspace.candidateUpdatedAt,
    );
    const candidateMatchesLatestSource = this.candidateMatchesLatestSource(
      workspace.workspaceValid,
      workspace.sourceUpdatedAt,
      workspace.candidateUpdatedAt,
    );
    const sourceIsNewer =
      workspace.workspaceValid && workspace.sourceUpdatedAt
        ? !candidateMatchesLatestSource
        : false;

    let action: AppUpdateStatus["action"] = "none";
    if (
      candidateMatchesLatestSource &&
      currentAppPath &&
      workspace.candidateAppPath &&
      workspace.candidateUpdatedAt
    ) {
      if (currentAppPath === workspace.candidateAppPath) {
        if (launchedAppUpdatedAt && this.isTimestampNewer(workspace.candidateUpdatedAt, launchedAppUpdatedAt)) {
          action = "restart";
        }
      } else if (!currentUpdatedAt || this.isTimestampNewer(workspace.candidateUpdatedAt, currentUpdatedAt)) {
        action = "install";
      }
    }

    const requiresAdminPrompt =
      action === "install" && currentAppPath ? !(await this.canReplaceInstalledApp(currentAppPath)) : false;

    let buildState: AppUpdateStatus["buildState"] = "idle";
    if (this.appUpdateInstalling) {
      buildState = "installing";
    } else if (this.appUpdatePackagingJob) {
      buildState = "packaging";
    } else if (statusKey && this.appUpdateFailedKey === statusKey) {
      buildState = "failed";
    } else if (candidateMatchesLatestSource && workspace.candidateUpdatedAt) {
      buildState = "ready";
    }

    const reason = this.describeAppUpdateStatus({
      supported: true,
      currentAppPath,
      workspace,
      sourceIsNewer,
      buildState,
      action,
      requiresAdminPrompt,
      buildError: this.appUpdateBuildError,
    });

    return {
      status: {
        supported: true,
        available: action !== "none",
        currentAppPath,
        candidateAppPath: workspace.candidateAppPath,
        workspacePath: workspace.workspacePath,
        workspaceExists: workspace.workspaceExists,
        sourceUpdatedAt: workspace.sourceUpdatedAt,
        launchedAppUpdatedAt,
        currentUpdatedAt,
        candidateUpdatedAt: workspace.candidateUpdatedAt,
        currentRendererAssetName: currentRendererAsset.assetName,
        currentRendererAssetUpdatedAt: currentRendererAsset.assetUpdatedAt,
        candidateRendererAssetName: candidateRendererAsset.assetName,
        candidateRendererAssetUpdatedAt: candidateRendererAsset.assetUpdatedAt,
        rendererAssetMatch: this.rendererAssetsMatch(currentRendererAsset, candidateRendererAsset),
        buildState,
        buildError: buildState === "failed" ? this.appUpdateBuildError : null,
        requiresAdminPrompt,
        action,
        reason,
      },
      shouldPackage:
        Boolean(packageKey) &&
        sourceIsNewer &&
        !this.appUpdatePackagingJob &&
        this.appUpdateFailedKey !== statusKey,
      packageKey,
      statusKey,
      workspacePath: workspace.workspacePath,
    };
  }

  private async ensureAppUpdatePackaging(
    settings: Settings,
    workspacePath: string,
    packageKey: string,
  ): Promise<void> {
    if (this.appUpdatePackagingJob && this.appUpdatePackagingKey === packageKey) {
      return;
    }
    if (this.appUpdatePackagingJob) {
      return;
    }

    this.appUpdatePackagingKey = packageKey;
    this.appUpdateFailedKey = null;
    this.appUpdateBuildError = null;
    const job = this.runAppUpdatePackaging(settings, workspacePath, packageKey);
    this.appUpdatePackagingJob = job;
    void this.evaluateAppUpdate(settings)
      .then((result) => this.emitAppUpdateStatus(result.status))
      .catch((error) => {
        console.warn("[evaluateAppUpdate] background failure", error);
      });
    void job.finally(() => {
      if (this.appUpdatePackagingJob === job) {
        this.appUpdatePackagingJob = null;
      }
    });
  }

  private async runAppUpdatePackaging(settings: Settings, workspacePath: string, packageKey: string): Promise<void> {
    try {
      const preflightError = await this.preflightAppPackaging(workspacePath);
      if (preflightError) {
        throw new Error(preflightError);
      }

      const result = await execCommand("npm run package:mac", workspacePath);
      if (result.code !== 0) {
        const message = (result.stderr || result.stdout).trim() || "PROGRAMS could not package the latest app build.";
        throw new Error(message);
      }

      await emitSettledAppUpdateStatus({
        applySettlement: () => {
          this.appUpdatePackagingJob = null;
          this.appUpdateFailedKey = null;
          this.appUpdateBuildError = null;
          this.appUpdatePackagingKey = null;
        },
        readStatus: () => this.refreshAppUpdateStatus(settings, false),
        emitStatus: (status) => this.emitAppUpdateStatus(status),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PROGRAMS could not package the latest app build.";
      await emitSettledAppUpdateStatus({
        applySettlement: () => {
          this.appUpdatePackagingJob = null;
          this.appUpdatePackagingKey = null;
          this.appUpdateFailedKey = packageKey;
          this.appUpdateBuildError = message;
        },
        readStatus: () => this.refreshAppUpdateStatus(settings, false),
        emitStatus: (status) => this.emitAppUpdateStatus(status),
      });
    }
  }

  private async preflightAppPackaging(workspacePath: string): Promise<string | null> {
    const packageJsonPath = join(workspacePath, "package.json");
    const packageJsonText = await readTextFile(packageJsonPath);
    if (!packageJsonText.trim()) {
      return "PROGRAMS could not read package.json from the configured source workspace.";
    }

    try {
      const packageJson = JSON.parse(packageJsonText) as {
        scripts?: Record<string, string>;
      };
      if (!packageJson.scripts?.["package:mac"]) {
        return "The configured source workspace is missing the package:mac build script.";
      }
    } catch {
      return "PROGRAMS could not parse package.json from the configured source workspace.";
    }

    const npmVersion = await execCommand("npm --version", workspacePath);
    if (npmVersion.code !== 0) {
      return "PROGRAMS could not find npm. Install Node.js with npm to enable in-app app packaging.";
    }

    return null;
  }

  private async readAppUpdateWorkspace(settings: Settings): Promise<AppUpdateWorkspaceInfo> {
    const workspacePath = settings.appSourcePath?.trim() || null;
    if (!workspacePath) {
      return {
        workspacePath: null,
        workspaceExists: false,
        workspaceValid: false,
        workspaceError: "Choose the PROGRAMS source workspace in Settings to enable in-app updates.",
        sourceUpdatedAt: null,
        candidateAppPath: null,
        candidateUpdatedAt: null,
      };
    }

    const workspaceExists = await pathExists(workspacePath);
    if (!workspaceExists) {
      return {
        workspacePath,
        workspaceExists: false,
        workspaceValid: false,
        workspaceError: "PROGRAMS could not find the configured source workspace.",
        sourceUpdatedAt: null,
        candidateAppPath: null,
        candidateUpdatedAt: null,
      };
    }

    const packageJsonPath = join(workspacePath, "package.json");
    const builderConfigPath = join(workspacePath, "electron-builder.yml");
    const workspaceValid = (await pathExists(packageJsonPath)) && (await pathExists(builderConfigPath));
    const candidateAppPath = await this.resolveCandidateAppPath(workspacePath);
    const candidateUpdatedAt = candidateAppPath ? await this.readModifiedAt(candidateAppPath) : null;

    if (!workspaceValid) {
      return {
        workspacePath,
        workspaceExists,
        workspaceValid: false,
        workspaceError: "The configured source workspace is missing package.json or electron-builder.yml.",
        sourceUpdatedAt: null,
        candidateAppPath,
        candidateUpdatedAt,
      };
    }

    return {
      workspacePath,
      workspaceExists,
      workspaceValid: true,
      workspaceError: null,
      sourceUpdatedAt: await this.readLatestSourceModifiedAt(workspacePath),
      candidateAppPath,
      candidateUpdatedAt,
    };
  }

  private async readLatestSourceModifiedAt(workspacePath: string): Promise<string | null> {
    let latest = 0;

    for (const relativePath of APP_UPDATE_SOURCE_FILES) {
      const absolutePath = join(workspacePath, relativePath);
      const modifiedAt = await this.readModifiedAt(absolutePath);
      if (!modifiedAt) {
        continue;
      }

      latest = Math.max(latest, new Date(modifiedAt).getTime());
    }

    for (const relativePath of APP_UPDATE_SOURCE_ROOTS) {
      latest = Math.max(latest, await this.readLatestDirectoryModifiedAt(join(workspacePath, relativePath)));
    }

    return latest > 0 ? new Date(latest).toISOString() : null;
  }

  private async readLatestDirectoryModifiedAt(path: string): Promise<number> {
    if (!(await pathExists(path))) {
      return 0;
    }

    let latest = 0;
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        latest = Math.max(latest, await this.readLatestDirectoryModifiedAt(entryPath));
        continue;
      }

      const modifiedAt = await this.readModifiedAt(entryPath);
      if (!modifiedAt) {
        continue;
      }

      latest = Math.max(latest, new Date(modifiedAt).getTime());
    }

    return latest;
  }

  private async readRendererAssetInfo(appBundlePath: string | null): Promise<AppRendererAssetInfo> {
    if (!appBundlePath) {
      return {
        assetName: null,
        assetUpdatedAt: null,
      };
    }

    const assetsDir = join(appBundlePath, "Contents", "Resources", "app", "out", "renderer", "assets");
    if (!(await pathExists(assetsDir))) {
      return {
        assetName: null,
        assetUpdatedAt: null,
      };
    }

    const entries = await readdir(assetsDir, { withFileTypes: true });
    const assetName =
      entries.find((entry) => entry.isFile() && /^index-[^.]+\.js$/.test(entry.name))?.name ??
      entries.find((entry) => entry.isFile() && /^index-[^.]+\.css$/.test(entry.name))?.name ??
      null;

    if (!assetName) {
      return {
        assetName: null,
        assetUpdatedAt: null,
      };
    }

    return {
      assetName,
      assetUpdatedAt: await this.readModifiedAt(join(assetsDir, assetName)),
    };
  }

  private rendererAssetsMatch(current: AppRendererAssetInfo, candidate: AppRendererAssetInfo): boolean | null {
    if (!current.assetName || !candidate.assetName) {
      return null;
    }

    if (current.assetName !== candidate.assetName) {
      return false;
    }

    if (current.assetUpdatedAt && candidate.assetUpdatedAt) {
      return current.assetUpdatedAt === candidate.assetUpdatedAt;
    }

    return true;
  }

  private describeAppUpdateStatus({
    supported,
    currentAppPath,
    workspace,
    sourceIsNewer,
    buildState,
    action,
    requiresAdminPrompt,
    buildError,
  }: {
    supported: boolean;
    currentAppPath: string | null;
    workspace: AppUpdateWorkspaceInfo;
    sourceIsNewer: boolean;
    buildState: AppUpdateStatus["buildState"];
    action: AppUpdateStatus["action"];
    requiresAdminPrompt: boolean;
    buildError: string | null;
  }): string {
    if (!supported) {
      return "App updates are only available from the packaged macOS app.";
    }
    if (!currentAppPath) {
      return "PROGRAMS could not determine the running app bundle path.";
    }
    if (buildState === "installing") {
      return "Installing the latest PROGRAMS app build.";
    }
    if (buildState === "packaging") {
      return "PROGRAMS is packaging the latest macOS app in the background.";
    }
    if (buildState === "failed") {
      return buildError || "PROGRAMS could not prepare the latest app build.";
    }
    if (!workspace.workspacePath) {
      return workspace.workspaceError || "Choose the PROGRAMS source workspace in Settings to enable in-app updates.";
    }
    if (!workspace.workspaceExists || !workspace.workspaceValid) {
      return workspace.workspaceError || "PROGRAMS could not inspect the configured source workspace.";
    }
    if (action === "restart") {
      return "A newer build is ready. Restart PROGRAMS to load it.";
    }
    if (action === "install") {
      return requiresAdminPrompt
        ? "A newer build is ready. PROGRAMS will ask macOS for permission to replace the installed app."
        : "A newer build is ready to install.";
    }
    if (sourceIsNewer) {
      return "PROGRAMS needs to package a fresh macOS app build from the latest source changes.";
    }
    if (workspace.candidateUpdatedAt) {
      return "The installed app already matches the latest packaged build.";
    }
    return "PROGRAMS has not packaged a macOS app bundle from this workspace yet.";
  }

  private candidateMatchesLatestSource(
    workspaceValid: boolean,
    sourceUpdatedAt: string | null,
    candidateUpdatedAt: string | null,
  ): boolean {
    if (!candidateUpdatedAt) {
      return false;
    }
    if (!workspaceValid || !sourceUpdatedAt) {
      return true;
    }
    return !this.isTimestampNewer(sourceUpdatedAt, candidateUpdatedAt);
  }

  private buildAppUpdatePackageKey(workspacePath: string, sourceUpdatedAt: string): string {
    return `${workspacePath}::${sourceUpdatedAt}`;
  }

  private buildAppUpdateStatusKey(scope: string | null, timestamp: string | null): string | null {
    if (!scope) {
      return null;
    }

    return `${scope}::${timestamp ?? "unknown"}`;
  }

  private isTimestampNewer(left: string, right: string): boolean {
    return new Date(left).getTime() > new Date(right).getTime() + APP_UPDATE_FRESHNESS_WINDOW_MS;
  }

  private async canReplaceInstalledApp(appPath: string): Promise<boolean> {
    try {
      await access(dirname(appPath), fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async startAppRelaunch(appPath: string): Promise<void> {
    const scriptPath = await this.createAppUpdateScript(
      "relaunch-app.sh",
      [
        "#!/bin/zsh",
        "sleep 1",
        `/usr/bin/open '${this.escapeShellPath(appPath)}'`,
      ],
    );
    this.launchDetachedScript(scriptPath);
  }

  private async startWritableAppSwap(currentAppPath: string, candidateAppPath: string): Promise<void> {
    const escapedCurrent = this.escapeShellPath(currentAppPath);
    const escapedCandidate = this.escapeShellPath(candidateAppPath);
    const escapedNext = this.escapeShellPath(`${currentAppPath}.next`);
    const escapedBackup = this.escapeShellPath(`${currentAppPath}.previous`);
    const scriptPath = await this.createAppUpdateScript(
      "install-update.sh",
      [
        "#!/bin/zsh",
        "set -e",
        "sleep 1",
        `/bin/rm -rf '${escapedNext}'`,
        `/usr/bin/ditto '${escapedCandidate}' '${escapedNext}'`,
        `/bin/rm -rf '${escapedBackup}'`,
        `/bin/mv '${escapedCurrent}' '${escapedBackup}'`,
        `/bin/mv '${escapedNext}' '${escapedCurrent}'`,
        `/usr/bin/open '${escapedCurrent}'`,
        `/bin/rm -rf '${escapedBackup}'`,
      ],
    );
    this.launchDetachedScript(scriptPath);
  }

  private async startPrivilegedAppSwap(currentAppPath: string, candidateAppPath: string): Promise<void> {
    const escapedCurrent = this.escapeShellPath(currentAppPath);
    const escapedCandidate = this.escapeShellPath(candidateAppPath);
    const escapedNext = this.escapeShellPath(`${currentAppPath}.next`);
    const escapedBackup = this.escapeShellPath(`${currentAppPath}.previous`);
    const installScript = await this.createAppUpdateScript(
      "install-update-admin.sh",
      [
        "#!/bin/zsh",
        "set -e",
        "sleep 1",
        `/bin/rm -rf '${escapedNext}'`,
        `/usr/bin/ditto '${escapedCandidate}' '${escapedNext}'`,
        `/bin/rm -rf '${escapedBackup}'`,
        `/bin/mv '${escapedCurrent}' '${escapedBackup}'`,
        `/bin/mv '${escapedNext}' '${escapedCurrent}'`,
        `/bin/rm -rf '${escapedBackup}'`,
      ],
    );
    const relaunchScript = await this.createAppUpdateScript(
      "relaunch-after-install.sh",
      [
        "#!/bin/zsh",
        "sleep 3",
        `/usr/bin/open '${escapedCurrent}'`,
      ],
    );

    await this.launchPrivilegedDetachedScript(installScript);
    this.launchDetachedScript(relaunchScript);
  }

  private async createAppUpdateScript(name: string, lines: string[]): Promise<string> {
    const tempDir = await mkdtemp(join(tmpdir(), "programs-update-"));
    const scriptPath = join(tempDir, name);
    await writeTextFile(scriptPath, `${lines.join("\n")}\n/bin/rm -f '${this.escapeShellPath(scriptPath)}'\n`);
    return scriptPath;
  }

  private launchDetachedScript(scriptPath: string): void {
    const child = spawn("/bin/zsh", [scriptPath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  private async launchPrivilegedDetachedScript(scriptPath: string): Promise<void> {
    const shellCommand = `/bin/zsh '${this.escapeShellPath(scriptPath)}' >/dev/null 2>&1 &`;
    const result = await execCommand(
      `/usr/bin/osascript -e "${this.escapeAppleScriptString(
        `do shell script "${shellCommand}" with administrator privileges`,
      )}"`,
      app.getPath("home"),
    );

    if (result.code !== 0) {
      const details = `${result.stderr}\n${result.stdout}`.trim();
      throw new Error(details || "macOS did not approve the app replacement.");
    }
  }

  private currentAppBundlePath(): string | null {
    if (!app.isPackaged) {
      return null;
    }

    const macosDirectory = dirname(process.execPath);
    const contentsDirectory = dirname(macosDirectory);
    const appBundlePath = dirname(contentsDirectory);
    return appBundlePath.endsWith(".app") ? appBundlePath : null;
  }

  private async resolveCandidateAppPath(workspaceRoot: string): Promise<string | null> {
    const candidates = [
      join(workspaceRoot, "dist", "mac-arm64", "PROGRAMS.app"),
      join(workspaceRoot, "dist", "mac", "PROGRAMS.app"),
    ];
    let latestPath: string | null = null;
    let latestTimestamp = 0;

    for (const candidate of candidates) {
      const modifiedAt = await this.readModifiedAt(candidate);
      if (!modifiedAt) {
        continue;
      }

      const timestamp = new Date(modifiedAt).getTime();
      if (timestamp > latestTimestamp) {
        latestTimestamp = timestamp;
        latestPath = candidate;
      }
    }

    return latestPath;
  }

  private async readModifiedAt(path: string): Promise<string | null> {
    try {
      const details = await stat(path);
      return details.mtime.toISOString();
    } catch {
      return null;
    }
  }

  private escapeShellPath(value: string): string {
    return value.replace(/'/g, `'\\''`);
  }

  private escapeAppleScriptString(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  private formatAppUpdateInstallError(error: unknown, candidateAppPath: string | null): string {
    const baseMessage =
      error instanceof Error ? error.message : "PROGRAMS could not install the latest app build.";
    if (!candidateAppPath) {
      return baseMessage;
    }

    return `${baseMessage} Built app: ${candidateAppPath}`;
  }

  private async updateProjectStatus(
    project: Project,
    status: Project["status"],
    lastError: string | null = null,
  ): Promise<Project> {
    project.status = status;
    project.lastError = lastError;
    project.updatedAt = new Date().toISOString();
    await this.store.updateProject(project);
    this.emit({ type: "project.updated", project });
    return project;
  }

  async readProjectDiffStats(projectId: string): Promise<DiffStats | null> {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    return this.git.readWorkingTreeDiffStats(project.localPath);
  }

}
