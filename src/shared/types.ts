export type UiMode = "simple" | "advanced";
export type SpeedMode = "normal" | "fast";
export type Theme = "dark" | "light";
export type AiProvider = "codex" | "claude";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type PlanningMode = "review" | "auto" | "none";
export type UpdateStageStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";
export type CodexModel = string;
export type ClaudeModel = string;
export interface ModelOption {
  id: string;
  label: string;
  detail: string | null;
}

export interface ModelCatalog {
  codex: ModelOption[];
  claude: ModelOption[];
  source: "fallback" | "live";
  updatedAt: string | null;
}

export const CODEX_MODEL_OPTIONS = ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"] as const;
export const CLAUDE_MODEL_OPTIONS = ["sonnet", "opus"] as const;
export const DEFAULT_MODEL_CATALOG: ModelCatalog = {
  codex: [
    {
      id: "gpt-5.4",
      label: "GPT-5.4",
      detail: "Latest frontier agentic coding model.",
    },
    {
      id: "gpt-5.4-mini",
      label: "GPT-5.4 Mini",
      detail: "Smaller frontier agentic coding model.",
    },
    {
      id: "gpt-5.3-codex",
      label: "GPT-5.3 Codex",
      detail: "Frontier Codex-optimized agentic coding model.",
    },
  ],
  claude: [
    {
      id: "sonnet",
      label: "Claude Sonnet",
      detail: "Alias for the latest Claude Sonnet release in Claude Code.",
    },
    {
      id: "opus",
      label: "Claude Opus",
      detail: "Alias for the latest Claude Opus release in Claude Code.",
    },
  ],
  source: "fallback",
  updatedAt: null,
};
export type ProjectStatus =
  | "idle"
  | "planning"
  | "awaitingApproval"
  | "executing"
  | "running"
  | "error";
export type UpdateKind = "update" | "undo";
export type UpdateStatus =
  | "planned"
  | "executing"
  | "saved"
  | "reverted"
  | "failed";
export type ToastLevel = "info" | "success" | "error";
export type StatusTone = "action_required" | "confirmed" | "info" | "neutral";
export type SetupCheckStatus = Exclude<StatusTone, "neutral">;
export type SetupSection = "need" | "assistant";
export type SetupActionKind =
  | "openExternal"
  | "openSettings"
  | "setupCodex"
  | "setupClaude"
  | "codexLogin"
  | "claudeLogin"
  | "installGit"
  | "refresh"
  | "none";

export type DirectoryPickMode = "parent" | "attach";

export interface DirectorSettingsOverride {
  model?: CodexModel;
  claudeModel?: ClaudeModel;
  reasoningEffort?: ReasoningEffort;
  planningMode?: PlanningMode;
}

export type PingDirectRunMode = "auto" | "manual";

export interface AdvancedDefaults {
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  reasoningEffort: ReasoningEffort;
  serviceTier: "flex" | "fast";
  customInstructions: string;
}

export interface Settings {
  theme: Theme;
  uiMode: UiMode;
  defaultSpeed: SpeedMode;
  autoApprovePlans: boolean;
  advancedDefaults: AdvancedDefaults;
  appSourcePath: string | null;
  codexBinaryPath: string | null;
  claudeBinaryPath: string | null;
}

export interface SetupState {
  completedAt: string | null;
}

export interface SetupCheck {
  id: "codexInstall" | "gitInstall" | "codexLogin" | "claudeInstall" | "claudeLogin";
  section: SetupSection;
  label: string;
  status: SetupCheckStatus;
  version: string | null;
  detail: string;
  actionLabel: string | null;
  actionKind: SetupActionKind;
  actionTarget: string | null;
  secondaryActionLabel: string | null;
  secondaryActionKind: SetupActionKind;
  secondaryActionTarget: string | null;
  required: boolean;
}

export interface SetupSnapshot {
  checks: SetupCheck[];
  completedAt: string | null;
  isSetupComplete: boolean;
  showSetupOnLaunch: boolean;
  currentCheckId: SetupCheck["id"] | null;
  isPackagedBuild: boolean;
}

export interface ProjectRuntimeConfig {
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  installCommand: string | null;
  runCommand: string | null;
  openUrl: string | null;
  lastRunUrl: string | null;
  initialIdea: string | null;
}

export interface Project {
  id: string;
  name: string;
  iconColor: string;
  description: string;
  localPath: string;
  threadId: string | null;
  lastUpdatedAt: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  runtimeConfig: ProjectRuntimeConfig;
  lastError: string | null;
}

export interface UpdateRecord {
  id: string;
  projectId: string;
  prompt: string;
  summary: string;
  commitSha: string | null;
  createdAt: string;
  kind: UpdateKind;
  status: UpdateStatus;
  errorMessage: string | null;
}

export interface RuntimeState {
  projectId: string;
  running: boolean;
  pid: number | null;
  url: string | null;
  startedAt: string | null;
  logs: string[];
  source: "none" | "managed" | "restored" | "external" | "self";
  controllable: boolean;
}

export interface PlanStep {
  step: string;
  status: "pending" | "in_progress" | "completed";
}

export interface DiffStats {
  added: number;
  removed: number;
}

export interface PlanDraft {
  projectId: string;
  provider: AiProvider;
  threadId: string | null;
  turnId: string | null;
  prompt: string;
  speed: SpeedMode;
  model: CodexModel;
  claudeModel: ClaudeModel;
  reasoningEffort: AdvancedDefaults["reasoningEffort"];
  planningMode: PlanningMode;
  autoApprove: boolean;
  contextPaths: string[];
  skillInstructions: string | null;
  coreDetailsContext: string | null;
  pingTaskSnapshot: PingTaskSnapshot | null;
  status: "planning" | "awaitingApproval" | "executing" | "completed" | "failed";
  thinkingStatus: UpdateStageStatus;
  planningStatus: UpdateStageStatus;
  buildingStatus: UpdateStageStatus;
  verifyingStatus: UpdateStageStatus;
  explanation: string;
  steps: PlanStep[];
  summary: string | null;
  impact: string | null;
  diff: string | null;
  diffStats: DiffStats | null;
  finalText: string | null;
  verificationDetails: string | null;
  errorMessage: string | null;
  lastUpdatedAt: string;
}

export interface ProjectDetail {
  project: Project;
  updates: UpdateRecord[];
  runtime: RuntimeState;
  activePlan: PlanDraft | null;
}

export interface StoredDataNode {
  label: string;
  description: string | null;
  children: StoredDataNode[];
}

export interface ConnectionReportItem {
  name: string;
  kind: string;
  description: string;
  envKeys: string[];
}

export interface CostReportItem {
  label: string;
  amount: string | null;
  description: string;
}

export interface ProjectOutlineReport {
  projectId: string;
  storedData: StoredDataNode[];
  connections: ConnectionReportItem[];
  costs: CostReportItem[];
  referencedEnvKeys: string[];
  generatedAt: string;
}

export interface EnvVariableEntry {
  key: string;
  value: string;
}

export interface EnvFileSnapshot {
  projectId: string;
  path: string;
  exists: boolean;
  entries: EnvVariableEntry[];
}

export interface ProjectCreateInput {
  name: string;
  iconColor: string;
  parentDirectory: string;
  initialIdea: string;
}

export interface ProjectAttachInput {
  localPath: string;
  iconColor: string;
}

export interface AttachPathInspection {
  localPath: string;
  name: string | null;
  exists: boolean;
  isRepo: boolean;
}

export interface ContextPathPickResult {
  canceled: boolean;
  paths: string[];
}

export interface DroppedContextPathResult {
  paths: string[];
  rejectedCount: number;
}

export interface ResolveDroppedContextPathsInput {
  projectId: string;
  paths: string[];
}

export interface SettingsUpdateInput {
  theme?: Theme;
  uiMode?: UiMode;
  defaultSpeed?: SpeedMode;
  autoApprovePlans?: boolean;
  advancedDefaults?: Partial<AdvancedDefaults>;
  appSourcePath?: string | null;
  codexBinaryPath?: string | null;
  claudeBinaryPath?: string | null;
}

export interface CodexAuthStatus {
  available: boolean;
  loggedIn: boolean;
  binaryPath: string | null;
  version: string | null;
  email: string | null;
  planType: string | null;
  authMode: string | null;
  errorMessage: string | null;
}

export interface ClaudeAuthStatus {
  available: boolean;
  loggedIn: boolean;
  ready: boolean;
  canConnect: boolean;
  binaryPath: string | null;
  version: string | null;
  email: string | null;
  displayName: string | null;
  planType: string | null;
  errorMessage: string | null;
  runtimeErrorMessage: string | null;
  connectErrorMessage: string | null;
}

export interface AddProjectDefaultState {
  iconColor: string;
  parentDirectory: string;
}

export interface DirectoryPickResult {
  canceled: boolean;
  path: string | null;
}

export interface AuthSnapshot {
  codex: CodexAuthStatus;
  claude: ClaudeAuthStatus;
}

export type ProviderUsageStatus = "ready" | "requiresInstall" | "requiresLogin" | "unsupported";

export interface UsageWindow {
  label: string;
  usedPercent: number | null;
  valueLabel: string | null;
  detail: string | null;
  resetsAt: string | null;
  windowDurationMins: number | null;
}

export interface ProviderUsage {
  status: ProviderUsageStatus;
  windows: UsageWindow[];
  note: string | null;
}

export interface UsageSnapshot {
  codex: ProviderUsage;
  claude: ProviderUsage;
  updatedAt: string;
}

export interface AppUpdateStatus {
  supported: boolean;
  available: boolean;
  currentAppPath: string | null;
  candidateAppPath: string | null;
  workspacePath: string | null;
  workspaceExists: boolean;
  sourceUpdatedAt: string | null;
  launchedAppUpdatedAt: string | null;
  currentUpdatedAt: string | null;
  candidateUpdatedAt: string | null;
  currentRendererAssetName: string | null;
  currentRendererAssetUpdatedAt: string | null;
  candidateRendererAssetName: string | null;
  candidateRendererAssetUpdatedAt: string | null;
  rendererAssetMatch: boolean | null;
  buildState: "idle" | "packaging" | "ready" | "installing" | "failed";
  buildError: string | null;
  requiresAdminPrompt: boolean;
  action: "none" | "restart" | "install";
  reason: string | null;
}

export interface BootstrapPayload {
  settings: Settings;
  projects: Project[];
  runtimes: Record<string, RuntimeState>;
  auth: AuthSnapshot;
  setup: SetupSnapshot;
  appUpdate: AppUpdateStatus;
  modelCatalog: ModelCatalog;
}

export type AppEvent =
  | { type: "toast"; level: ToastLevel; message: string }
  | { type: "auth.codex"; status: CodexAuthStatus }
  | { type: "auth.claude"; status: ClaudeAuthStatus }
  | { type: "modelCatalog.updated"; catalog: ModelCatalog }
  | { type: "setup.updated"; setup: SetupSnapshot }
  | { type: "appUpdate.status"; status: AppUpdateStatus }
  | { type: "project.updated"; project: Project }
  | { type: "project.removed"; projectId: string }
  | { type: "project.runtime"; projectId: string; runtime: RuntimeState }
  | { type: "project.plan"; projectId: string; plan: PlanDraft | null }
  | { type: "project.history"; projectId: string; updates: UpdateRecord[] }
  | { type: "project.outlineReport"; projectId: string; report: ProjectOutlineReport | null }
  | { type: "agent.session"; projectId: string; session: AgentSession | null }
  | { type: "auth.claude.codePrompt"; prompt: string };

export interface StartPlanInput {
  projectId: string;
  provider: AiProvider;
  prompt: string;
  speed: SpeedMode;
  model: CodexModel;
  claudeModel: ClaudeModel;
  reasoningEffort: AdvancedDefaults["reasoningEffort"];
  planningMode: PlanningMode;
  autoApprove: boolean;
  contextPaths: string[];
  skillInstructions?: string | null;
  coreDetailsContext?: string | null;
  pingTaskSnapshot?: PingTaskSnapshot | null;
}

export interface ApprovePlanInput {
  projectId: string;
}

export interface RevisePlanInput {
  projectId: string;
  prompt: string;
}

export interface RenameProjectInput {
  projectId: string;
  name: string;
}

export interface UpdateProjectInput {
  projectId: string;
  name: string;
  iconColor: string;
}

export interface GenerateProjectOutlineReportInput {
  projectId: string;
  provider?: AiProvider;
  model?: CodexModel;
  claudeModel?: ClaudeModel;
}

export interface WriteProjectEnvFileInput {
  projectId: string;
  entries: EnvVariableEntry[];
}

// --- Agent System ---

export type AgentStage = "function" | "thesis" | "core_pillars" | "full_flow" | "iterations" | "execution";

export const AGENT_STAGES: AgentStage[] = ["function", "thesis", "core_pillars", "full_flow", "iterations", "execution"];

export const AGENT_STAGE_LABELS: Record<AgentStage, string> = {
  function: "Function",
  thesis: "Thesis",
  core_pillars: "Core Pillars",
  full_flow: "Full-Flow",
  iterations: "Iterations",
  execution: "Execution",
};

export interface StageAgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status?: "working" | "complete";
  metadata?: AgentChatMessageMetadata | null;
}

export type HardMemoryReportDataType = "danDraftCoreDetails" | "versions" | "versionUpdates";

export interface HardMemoryReportUpdate {
  id: string;
  title: string;
  description: string;
  versionLabel: string;
  dependencies: string[];
  area: string | null;
  skillsNeeded: string[];
}

export interface HardMemoryReportMetadata {
  type: "hard-memory-report";
  dataType: HardMemoryReportDataType;
  directorId: Extract<DirectorId, "creative-director" | "rd-director">;
  approvalId: string | null;
  reportStage?: "soft" | "hard";
  summary: string;
  currentState: string | null;
  idealState: string | null;
  changeSummary: string[];
  draftCoreDetails: AgentCoreDetails | null;
  roadmapVersions: VersionPlan[] | null;
  versionUpdates: HardMemoryReportUpdate[] | null;
  createdAt: string;
}

export type DanDraftOperation =
  | {
      type: "set_root_detail";
      target: "function" | "thesis" | "fullFlow";
      value: string | null;
    }
  | {
      type: "upsert_pillar";
      name: string;
      previousName?: string | null;
      parentName?: string | null;
      pillarType?: PillarType | null;
      function?: string | null;
      thesis?: string | null;
      fullFlow?: string | null;
      description?: string | null;
      assumptionText?: string | null;
      assumptionSource?: "user" | "dan" | null;
      order?: number | null;
      connectedPillarNames?: string[] | null;
      threadMemberships?: { threadName: string; role: string | null }[] | null;
      endState?: PillarEndState | null;
    }
  | {
      type: "delete_pillar";
      name: string;
    }
  | {
      type: "upsert_thread";
      name: string;
      previousName?: string | null;
      description?: string | null;
    }
  | {
      type: "delete_thread";
      name: string;
    };

export type AgentChatMessageMetadata =
  | {
      type: "research-result";
      researchPrompt: string;
      generalSummary: string;
      projectSummary: string;
    }
  | {
      type: "refresh-update";
      directorId: DirectorId;
      same: string[];
      updated: string[];
      summary: string;
    }
  | {
      type: "ping-task";
      task: PingTaskSnapshot;
    }
  | {
      type: "execution-report";
      report: JeffExecutionReport;
    }
  | {
      type: "ping-plan-summary";
      summary: string;
      plan?: PingPlanSnapshot | null;
    }
  | {
      type: "ping-update-report";
      rawReport: PingRawReport;
      report?: PingExecutionReportSnapshot | null;
    }
  | HardMemoryReportMetadata
  | PingTranslationMetadata;

export type SlackMessageMetadata = AgentChatMessageMetadata;

export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  directorId: DirectorId | null;
  content: string;
  createdAt: string;
  status?: "working" | "complete";
  metadata?: AgentChatMessageMetadata | null;
}

export type SlackChatMessage = AgentChatMessage;

export interface ScratchpadItem {
  id: string;
  text: string;
  completed: boolean;
  source: "user" | "agent";
  createdAt: string;
}

export interface AgentPlannedUpdate {
  id: string;
  title: string;
  description: string;
  order: number;
  status: "pending" | "in_progress" | "completed" | "failed";
  sourceTodoIds: string[];
}

export interface AgentStageConfirmation {
  summary: string;
  status?: DetailStatus;
  currentState?: string;
  finalGoal?: string;
  steps?: FlowStep[];
  flowchartParagraph?: string;
  nodeDescriptions?: Record<string, string>;
}

export type DetailStatus = "assumed" | "confirmed" | "edited";

// --- Director System (formerly Multi-Agent) ---

export type DirectorId =
  | "project-manager"      // Jeff
  | "creative-director"    // Dan
  | "rd-director"          // Todd
  | "programming-director" // Ping
  | "validation-director"; // Pong

export const DIRECTOR_NAMES: Record<DirectorId, string> = {
  "project-manager": "Jeff",
  "creative-director": "Dan",
  "rd-director": "Todd",
  "programming-director": "Ping",
  "validation-director": "Pong",
};

export const DIRECTOR_LABELS: Record<DirectorId, string> = {
  "project-manager": "Project Manager",
  "creative-director": "Creative Director",
  "rd-director": "R&D Director",
  "programming-director": "Programming Director",
  "validation-director": "Validation Director",
};

export const DIRECTOR_COLORS: Record<DirectorId, string> = {
  "project-manager": "#991B1B",
  "creative-director": "#C2410C",
  "rd-director": "#166534",
  "programming-director": "#A16207",
  "validation-director": "#5B21B6",
};

export function normalizeDirectorId(raw: string | null | undefined): DirectorId | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed in DIRECTOR_NAMES) return trimmed as DirectorId;
  const lower = trimmed.toLowerCase();
  for (const [id, name] of Object.entries(DIRECTOR_NAMES)) {
    if (name.toLowerCase() === lower) return id as DirectorId;
  }
  const normalized = lower.replace(/_/g, "-");
  if (normalized in DIRECTOR_NAMES) return normalized as DirectorId;
  return null;
}

// --- Focus Modes ---

export type CreativeFocusMode = "core-details";
export type RdFocusMode = "research" | "version-planning" | "update-planning";
export type ValidationFocusMode = "identify-goal" | "test-current-state" | "compare";
export type DirectorFocusMode = CreativeFocusMode | RdFocusMode | ValidationFocusMode;
export type DirectorChatRuntimeStage = "conversation" | "memory-processing";
export type DanDraftStatus = "gathering" | "ready-to-confirm";
export type DanPresenceAction = "stay" | "exit";

// --- Director Progress Tracking ---

export type DirectorStage = "creative" | "rd" | "programming" | "validation";
export type DirectorStageStatus = "not-started" | "in-progress" | "completed";

export interface ProjectDirectorProgress {
  creative: DirectorStageStatus;
  rd: DirectorStageStatus;
  programming: DirectorStageStatus;
  validation: DirectorStageStatus;
  currentDirector: DirectorId | null;
}

// --- Project Category ---

export type ProjectCategory = "program" | "general-project" | "idea-in-progress";

// --- Pillar Types ---

export type PillarType = "core" | "side" | "ghost" | "tbd" | "hard-stop";

export type PillarEndState = "end" | "tbd";

export interface PillarThread {
  id: string;
  name: string;
  description: string | null;
}

export interface PillarThreadRole {
  threadId: string;
  threadName: string;
  role: string | null;
}

export interface DirectorConversation {
  directorId: DirectorId;
  focusMode: DirectorFocusMode | null;
  messages: StageAgentMessage[];
  lastActiveAt: string | null;
}

export interface FeasibilityAssessment {
  id: string;
  area: string;
  assessment: string;
  stackRecommendation: string | null;
  complexity: "low" | "medium" | "high";
  costNotes: string | null;
  status: DetailStatus;
}

export interface VersionPlan {
  id: string;
  label: string;
  description: string;
  goals: string[];
  status: DetailStatus;
  order: number;
}

export interface VersionUpdate {
  id: string;
  versionId: string;
  title: string;
  description: string;
  order: number;
  status: "pending" | "in_progress" | "completed" | "failed";
  dependencies: string[];
  pillarIds: string[];
  skillsNeeded: string[];
}

export interface ValidationResult {
  id: string;
  updateId: string;
  validationType: "visual" | "functional";
  passed: boolean;
  summary: string;
  details: string;
  screenshotPaths: string[];
  createdAt: string;
}

export type ValidationFrequency = "every-update" | "every-version" | "manual";

export interface AutomationAllowedHours {
  startHour: number;
  endHour: number;
}

export interface AutomationConstraints {
  allowedHours: AutomationAllowedHours | null;
  codexMaxUsedPercent: number | null;
  claudeMaxUsedPercent: number | null;
}

export type AutomationRunStatus = "idle" | "running" | "paused" | "stopped" | "completed";

export type AutomationStopReason =
  | "manual-pause"
  | "manual-stop"
  | "target-completed"
  | "outside-work-hours"
  | "codex-usage-limit"
  | "claude-usage-limit"
  | "partially-successful"
  | "failure"
  | "no-confirmed-plan"
  | "no-target"
  | "no-next-update"
  | "awaiting-user"
  | "restart-resume-required";

export interface AutomationTargetCandidate {
  updateId: string;
  versionId: string | null;
  versionLabel: string;
  title: string;
  description: string;
  order: number;
  status: VersionUpdate["status"];
  available: boolean;
  draft: boolean;
  blockedReason: string | null;
  pathUpdateIds: string[];
}

export interface AutomationRunState {
  status: AutomationRunStatus;
  selectedTargetUpdateId: string | null;
  selectedTargetVersionId: string | null;
  inScopeUpdateIds: string[];
  constraints: AutomationConstraints;
  stopReason: AutomationStopReason | null;
  stopSummary: string | null;
  currentStep: "idle" | "jeff" | "todd" | "ping" | "pong" | "awaiting-report" | "awaiting-user";
  startedAt: string | null;
  lastResumedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  resumeRequired: boolean;
  nextUpdateId: string | null;
  lastSuccessfulUpdateId: string | null;
  lastSuccessfulHistoryUpdateId: string | null;
  pendingRevertReportId: string | null;
  pendingRevertHistoryUpdateId: string | null;
  pendingRevertCommitSha: string | null;
}

export interface CorePillarDetail {
  summary: string;
  status: DetailStatus;
}

export interface CorePillar {
  id: string;
  name: string;
  pillarType: PillarType;
  function: CorePillarDetail | null;
  thesis: CorePillarDetail | null;
  corePillars: CorePillar[];
  fullFlow: CorePillarDetail | null;
  description: string | null;
  connectedPillarIds: string[];
  assumptionText: string | null;
  assumptionSource: "user" | "dan" | null;
  order: number;
  threadMemberships: PillarThreadRole[];
  endState: PillarEndState | null;
}

export interface FlowStep {
  id: string;
  description: string;
  pillarIds: string[];
}

export interface AgentStageData {
  messages: StageAgentMessage[];
  confirmed: AgentStageConfirmation | null;
}

export interface DirectorStateSnapshot {
  currentState: string | null;
  idealState: string | null;
  assumptions: string[];
}

export interface ShortHorizonContext {
  currentTask: string | null;
  lastResult: string | null;
  lastFailureReason: string | null;
  toddUpdateExplanation: string | null;
  relevantPillarIds: string[];
}

export interface CascadeProposal {
  id: string;
  triggeredByStage: AgentStage;
  proposedUpdates: { stage: AgentStage; updatedSummary: string }[];
  createdAt: string;
}

export type SoftMemoryTag =
  | "likely-hard"
  | "likely-backup"
  | "handoff-to-dan"
  | "handoff-to-todd"
  | "handoff-to-ping"
  | "handoff-to-pong"
  | "handoff-to-jeff"
  | "general";

export interface TaggedNote {
  id: string;
  content: string;
  tag: SoftMemoryTag;
  createdAt: string;
}

export type JeffOutcomeDecision = "successful" | "partially-successful" | "failure";

export interface JeffOutcomeEntry {
  id: string;
  updateId: string | null;
  reportId: string;
  decision: JeffOutcomeDecision;
  summary: string;
  revertTriggered: boolean;
  createdAt: string;
}

export interface PongValidationReport {
  id: string;
  updateId: string | null;
  historyUpdateId: string | null;
  summary: string;
  passed: boolean | null;
  details: string | null;
  screenshotPaths: string[];
  createdAt: string;
}

export interface HandoffPayload {
  sourceDirectorId: DirectorId;
  targetDirectorId: DirectorId;
  summary: string;
  rawUserText: string | null;
  contextNotes: string[];
}

export type PendingApprovalKind =
  | "handoff"
  | "internet-research"
  | "codebase-scan"
  | "store-data"
  | "plan"
  | "agent-update"
  | "validation"
  | "outcome-decision";

export type PendingApprovalStatus = "pending" | "later";

export interface PendingApproval {
  id: string;
  kind: PendingApprovalKind;
  status: PendingApprovalStatus;
  requestedByDirectorId: DirectorId | null;
  targetDirectorId: DirectorId | null;
  summary: string;
  draftMessage: string | null;
  draftPayload: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface DanRawMemory {
  id: string;
  content: string;
  relatedPillarIds: string[];
  createdAt: string;
}

export interface DanHistoryLogEntry {
  id: string;
  action: string;
  summary: string;
  affectedPillarIds: string[];
  createdAt: string;
}

export interface DanMemory {
  confirmedConcept: AgentCoreDetails | null;
  draftConcept: AgentCoreDetails | null;
  derivedConcept: AgentCoreDetails | null;
  notes: TaggedNote[];
  derivedNotes: TaggedNote[];
  sideNotes: string[];
  draftChangeSummary: string[];
  draftStatus: DanDraftStatus | null;
  derivedUpdatedAt: string | null;
  fullExperienceDescription: string | null;
  archivedNotes: string[];
  deletedNotes: string[];
  rawMemories: DanRawMemory[];
  forgottenMemories: string[];
  creativeHistory: DanHistoryLogEntry[];
  toddHandoffNotes: TaggedNote[];
  threads: PillarThread[];
}

export interface ProjectKnowledgeFingerprint {
  headSha: string | null;
  digest: string;
  fileCount: number;
  totalBytes: number;
  latestMtimeMs: number | null;
  generatedAt: string;
}

export type ProjectKnowledgeStatus = "fresh" | "stale" | "needs-initial-refresh";

export interface ToddCodebaseIndexedMap {
  summary: string | null;
  indexedAt: string | null;
  featureAreas: string[];
  repoNotes: string[];
  lastIndexedFingerprint: ProjectKnowledgeFingerprint | null;
}

export interface ToddUpdateLogEntry {
  id: string;
  updateId: string | null;
  goal: string;
  outcome: string;
  status: PingRawReportStatus;
  reportId: string | null;
  historyUpdateId: string | null;
  commitSha: string | null;
  createdAt: string;
}

export interface ToddTroubleLogEntry {
  id: string;
  title: string;
  details: string;
  priority: "low" | "medium" | "high";
  occurrences: number;
  lastSeenAt: string;
  updateIds: string[];
}

export interface ToddHandoffPackage {
  summary: string;
  rawInputs: string[];
  context: string;
  receivedAt: string;
}

export interface ToddMemory {
  confirmedConcept: AgentCoreDetails | null;
  versionPlan: {
    v1: VersionPlan | null;
    v2: VersionPlan | null;
    v3: VersionPlan | null;
  };
  futureUpdatePlan: VersionUpdate[];
  previousUpdateLog: ToddUpdateLogEntry[];
  troubleLog: ToddTroubleLogEntry[];
  codebaseIndexedMap: ToddCodebaseIndexedMap | null;
  notes: TaggedNote[];
  pendingHandoff: ToddHandoffPackage | null;
  backupNotes: TaggedNote[];
}

export type PingRawReportStatus = "success" | "blocked" | "unexpected" | "no_changes";

export type PingLifecyclePhase = "intro" | "outro";

export interface PingTranslationMetadataBase {
  type: "ping-translation";
  zhResponse: string;
  enTranslation: string;
}

export interface PingStatusTranslationMetadata extends PingTranslationMetadataBase {
  kind: "status";
  status: PingRawReportStatus;
}

export interface PingLifecycleTranslationMetadata extends PingTranslationMetadataBase {
  kind: "lifecycle";
  phase: PingLifecyclePhase;
}

export interface PingMessageTranslationMetadata extends PingTranslationMetadataBase {
  kind: "message";
}

export type PingTranslationMetadata =
  | PingStatusTranslationMetadata
  | PingLifecycleTranslationMetadata
  | PingMessageTranslationMetadata;

export interface PingRawReport {
  status: PingRawReportStatus;
  updateId: string | null;
  goal: string | null;
  summary: string;
  zhResponse: string;
  enTranslation: string;
  changedFiles: string[];
  blocker: string | null;
  unexpectedNotes: string[];
  createdAt: string;
}

export type PingTaskSource = "todd-approved-update" | "direct-ping-request";

export interface PingRuntimeSnapshot {
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  reasoningEffort: AdvancedDefaults["reasoningEffort"];
  planningMode: PlanningMode;
  contextPaths: string[];
}

export interface PingTaskSnapshot {
  source: PingTaskSource;
  projectId: string;
  updateId: string | null;
  updateTitle: string | null;
  updateDescription: string | null;
  originalUserRequest: string;
  toddExplanation: string | null;
  relevantPillarIds: string[];
  toddCodebaseMapSummary: string | null;
  coreDetailsContext: string | null;
  runtime: PingRuntimeSnapshot;
  planPrompt: string;
  createdAt: string;
}

export interface JeffExecutionReport {
  id: string;
  updateId: string | null;
  historyUpdateId: string | null;
  commitSha: string | null;
  title: string;
  summary: string;
  outcome: string;
  toddFollowUpNeeded: boolean;
  toddFollowUpReason: string | null;
  rawReport: PingRawReport;
  createdAt: string;
}

export interface PingPlanSnapshot {
  task: PingTaskSnapshot;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  reasoningEffort: AdvancedDefaults["reasoningEffort"];
  planningMode: PlanningMode;
  threadId: string | null;
  turnId: string | null;
  status: PlanDraft["status"];
  thinkingStatus: UpdateStageStatus;
  planningStatus: UpdateStageStatus;
  buildingStatus: UpdateStageStatus;
  verifyingStatus: UpdateStageStatus;
  explanation: string;
  steps: PlanStep[];
  summary: string | null;
  impact: string | null;
  contextPaths: string[];
  lastUpdatedAt: string;
}

export interface PingExecutionReportSnapshot {
  task: PingTaskSnapshot;
  plan: PingPlanSnapshot | null;
  rawReport: PingRawReport;
  historyUpdateId: string | null;
  commitSha: string | null;
  jeffReportId: string | null;
  jeffSummary: string | null;
  createdAt: string;
}

export interface PingRunSnapshot {
  task: PingTaskSnapshot;
  plan: PingPlanSnapshot | null;
  report: PingExecutionReportSnapshot | null;
}

export interface PingMemory {
  activeUpdateId: string | null;
  activeTask: string | null;
  context: string | null;
  codebaseMapSummary: string | null;
  latestRawReport: PingRawReport | null;
  latestJeffReport: JeffExecutionReport | null;
  currentRun: PingRunSnapshot | null;
}

export interface JeffMemory {
  pendingReports: JeffExecutionReport[];
  pendingValidations: PongValidationReport[];
  outcomeLog: JeffOutcomeEntry[];
  notes: TaggedNote[];
  backupNotes: TaggedNote[];
}

export interface PongMemory {
  jeffInstruction: string | null;
  previousValidationReports: PongValidationReport[];
  latestValidationReport: PongValidationReport | null;
  screenshotPaths: string[];
}

export interface AgentSession {
  id: string;
  projectId: string;
  currentStage: AgentStage;
  conversationMode: "guided" | "general";
  stages: Record<AgentStage, AgentStageData>;
  unifiedMessages: StageAgentMessage[];
  scratchpad: ScratchpadItem[];
  plannedUpdates: AgentPlannedUpdate[];
  corePillars: CorePillar[];
  currentCorePillars: CorePillar[];
  coreDetailsChatHistory: StageAgentMessage[];
  attachedMaterials: string[];
  miscMaterials: string[];
  cascadePending: CascadeProposal | null;
  provider: AiProvider;
  createdAt: string;
  updatedAt: string;
  // Director system fields
  directorConversations: Record<string, DirectorConversation>;
  versions: VersionPlan[];
  versionUpdates: VersionUpdate[];
  feasibilityAssessments: FeasibilityAssessment[];
  validationResults: ValidationResult[];
  validationFrequency: ValidationFrequency;
  activeDirectorId: DirectorId | null;
  directorProgress: ProjectDirectorProgress;
  creativeFocusMode: CreativeFocusMode | null;
  rdFocusMode: RdFocusMode | null;
  validationFocusMode: ValidationFocusMode | null;
  danInternalNotes: string[];
  danSideNotes: string[];
  danDraftCoreDetails: AgentCoreDetails | null;
  danDraftChangeSummary: string[];
  danDraftStatus: DanDraftStatus | null;
  danArchivedNotes: string[];
  deletedNotes: string[];
  pingTaskContext: ShortHorizonContext | null;
  pongTaskContext: ShortHorizonContext | null;
  projectCategory: ProjectCategory;
  // Legacy storage-backed names kept for compatibility until a dedicated migration.
  slackMessages: SlackChatMessage[];
  slackActiveDirectorId: DirectorId;
  slackPresenceGuestId: DirectorId | null;
  pendingApprovals: PendingApproval[];
  directorSettingsOverrides: Partial<Record<DirectorId, DirectorSettingsOverride>>;
  directorStateMap: Partial<Record<DirectorId, DirectorStateSnapshot>>;
  danMemory: DanMemory;
  toddMemory: ToddMemory;
  pingMemory: PingMemory;
  jeffMemory: JeffMemory;
  pongMemory: PongMemory;
  automation: AutomationRunState;
  knowledgeStatus?: ProjectKnowledgeStatus;
  knowledgeReasons?: string[];
}

export interface StageAgentChatInput {
  projectId: string;
  stage: AgentStage;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  message: string;
}

export interface StageAgentChatResponse {
  sessionId: string;
  message: StageAgentMessage;
  confirmationSuggested: boolean;
  suggestedConfirmation: AgentStageConfirmation | null;
}

export interface AgentConfirmStageInput {
  projectId: string;
  stage: AgentStage;
  confirmation: AgentStageConfirmation;
}

export interface AgentUpdateScratchpadInput {
  projectId: string;
  scratchpad: ScratchpadItem[];
}

export interface AgentSubmitTodosInput {
  projectId: string;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
}

export interface AgentSubmitTodosResponse {
  sessionId: string;
  plannedUpdates: AgentPlannedUpdate[];
  message: StageAgentMessage;
}

export interface AgentReorderUpdatesInput {
  projectId: string;
  updateIds: string[];
}

export interface AgentExecuteUpdateInput {
  projectId: string;
  updateId: string;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
}

export interface AgentAttachMaterialsInput {
  projectId: string;
  filePaths: string[];
  replace?: boolean;
}

export interface AgentAttachMaterialsResult {
  session: AgentSession;
  attachedPaths: string[];
  failedPaths: string[];
}

export interface AgentCoreDetails {
  function: AgentStageConfirmation | null;
  thesis: AgentStageConfirmation | null;
  corePillars: CorePillar[];
  fullFlow: AgentStageConfirmation | null;
  threads: PillarThread[];
}

export interface CoreDetailsProposal {
  id: string;
  aiMessage: string;
  updatedFunction: string | null;
  updatedThesis: string | null;
  updatedCorePillars: { name: string; functionSummary: string | null; thesisSummary: string | null }[] | null;
  updatedFullFlow: string | null;
}

export interface AgentSuggestUpdateInput {
  projectId: string;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  message: string;
  focusArea?: "function" | "thesis" | "core_pillars" | "full_flow" | null;
}

export interface AgentSuggestUpdateResponse {
  aiMessage: string;
  proposal: CoreDetailsProposal | null;
}

export interface AgentApplyCoreDetailsInput {
  projectId: string;
  proposal: CoreDetailsProposal;
}

export interface AgentAcceptCascadeInput {
  projectId: string;
  cascadeId: string;
  acceptedStages: AgentStage[];
  editedSummaries?: Record<string, string>;
}

export interface CoreDetailsChatInput {
  projectId: string;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  message: string;
}

export interface CoreDetailsChatResponse {
  message: StageAgentMessage;
  updatedCoreDetails: AgentCoreDetails | null;
}

export interface AgentProcessTodosInput {
  projectId: string;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  newTodos: string[];
}

export type PlaywrightAction =
  | {
      type: "wait";
      ms: number;
    }
  | {
      type: "click";
      selector: string;
    }
  | {
      type: "fill";
      selector: string;
      value: string;
    }
  | {
      type: "press";
      key: string;
      selector?: string | null;
    }
  | {
      type: "hover";
      selector: string;
    };

export interface PlaywrightRunInput {
  projectId: string;
  url?: string | null;
  actions?: PlaywrightAction[];
  headless?: boolean;
  settleMs?: number;
}

export interface PlaywrightRunResult {
  runId: string;
  projectId: string;
  url: string;
  outputDir: string;
  screenshots: string[];
  consoleMessages: string[];
  pageErrors: string[];
  textSnapshot: string | null;
  renderGameText: string | null;
  startedAt: string;
  completedAt: string;
  success: boolean;
  errorMessage: string | null;
}

export interface ClaudeConnectionTestResult {
  ok: boolean;
  model: string;
  message: string;
  raw: string | null;
}

// --- Multi-Agent IPC Types ---

export interface DirectorChatInput {
  projectId: string;
  directorId: DirectorId;
  focusMode: DirectorFocusMode | null;
  runtimeStage?: DirectorChatRuntimeStage;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  message: string;
}

export interface DirectorChatResponse {
  sessionId: string;
  directorId: DirectorId;
  message: StageAgentMessage;
  routeSuggestion: { directorId: DirectorId; reason: string } | null;
  structuredData: DirectorStructuredData | null;
  internalNotes: string[] | null;
  suggestCreateProject: boolean;
}

export interface StartPingDirectUpdateInput {
  projectId: string;
  message: string;
  runMode: PingDirectRunMode;
  provider?: AiProvider;
  model?: CodexModel;
  claudeModel?: ClaudeModel;
  reasoningEffort?: ReasoningEffort;
  planningMode?: PlanningMode;
  contextPaths?: string[];
}

export type DirectorStructuredData =
  | { type: "feasibility"; assessments: FeasibilityAssessment[] }
  | { type: "versions"; versions: VersionPlan[] }
  | { type: "versionUpdates"; updates: VersionUpdate[] }
  | { type: "routedUpdates"; routed: { updateId: string; assignedTo: string }[] }
  | { type: "executionPlan"; updateId: string; steps: string[]; readyToExecute: boolean }
  | { type: "validationResult"; result: ValidationResult }
  | { type: "goalSummary"; summary: string; pillarIds: string[] }
  | { type: "comparison"; passed: boolean; improvementAreas: string[]; summary: string };

export interface AgentChatInput {
  projectId: string;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  message: string;
  targetDirectorId?: DirectorId | null;
}

export type SlackChatInput = AgentChatInput;

export type AgentChatDirectorMode =
  | "codebase-analysis"
  | "internet-research"
  | "version-planning"
  | "update-planning";

export type SlackDirectorMode = AgentChatDirectorMode;

export interface AgentChatDirectorApprovalPayload {
  action: "runSlackDirector";
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  directorId: DirectorId;
  message: string;
  mode: AgentChatDirectorMode;
}

export type SlackDirectorApprovalPayload = AgentChatDirectorApprovalPayload;

export interface AgentChatResponse {
  sessionId: string;
  directorId: DirectorId;
  message: AgentChatMessage;
  handoffTo: DirectorId | null;
  handoffReason: string | null;
  chainedMessages?: AgentChatMessage[];
}

export type SlackChatResponse = AgentChatResponse;

export interface ListPendingApprovalsInput {
  projectId: string;
}

export interface ApprovePendingApprovalInput {
  projectId: string;
  approvalId: string;
}

export interface RevisePendingApprovalInput {
  projectId: string;
  approvalId: string;
  summary?: string;
  draftMessage?: string | null;
  draftPayloadText?: string | null;
  targetDirectorId?: DirectorId | null;
}

export interface UpdatePendingApprovalStatusInput {
  projectId: string;
  approvalId: string;
}

export interface DeleteSlackMessagesInput {
  projectId: string;
  messageIds: string[];
}

export type DeleteAgentMessagesInput = DeleteSlackMessagesInput;

export interface ConfirmAgentDataInput {
  projectId: string;
  dataType: "feasibility" | "versions" | "versionUpdates";
  itemId?: string;
}

export interface RouteUpdateToProgrammingInput {
  projectId: string;
  updateId: string;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
}

export interface RunValidationInput {
  projectId: string;
  updateId: string;
  validationType: "visual" | "functional";
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
}

export interface SetValidationFrequencyInput {
  projectId: string;
  frequency: ValidationFrequency;
}

// --- Refresh Project ---

export interface RefreshProjectInput {
  projectId: string;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
}

export interface ListAutomationTargetsInput {
  projectId: string;
}

export interface ListAutomationTargetsResponse {
  source: "none" | "confirmed" | "draft";
  currentVersionId: string | null;
  currentVersionLabel: string | null;
  draftApprovalId: string | null;
  candidates: AutomationTargetCandidate[];
}

export interface StartAutomationRunInput {
  projectId: string;
  targetUpdateId: string;
  constraints: AutomationConstraints;
}

export interface PauseAutomationRunInput {
  projectId: string;
  summary?: string | null;
}

export interface StopAutomationRunInput {
  projectId: string;
  summary?: string | null;
}

export interface RequestAutomationFailureRecoveryInput {
  projectId: string;
}

export interface ConfirmAutomationFailureRecoveryInput {
  projectId: string;
}
