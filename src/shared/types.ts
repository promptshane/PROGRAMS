export type UiMode = "simple" | "advanced";
export type SpeedMode = "normal" | "fast";
export type Theme = "dark" | "light";
export type RepoVisibility = "private" | "public";
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
  | "syncing"
  | "running"
  | "error";
export type UpdateKind = "update" | "undo";
export type UpdateStatus =
  | "planned"
  | "executing"
  | "saved"
  | "pendingSync"
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
  | "githubLogin"
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

export interface AdvancedDefaults {
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  reasoningEffort: ReasoningEffort;
  serviceTier: "flex" | "fast";
  customInstructions: string;
  repoVisibility: RepoVisibility;
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
  githubClientIdOverride: string | null;
}

export interface SetupState {
  completedAt: string | null;
}

export interface SetupCheck {
  id: "codexInstall" | "gitInstall" | "codexLogin" | "claudeInstall" | "claudeLogin" | "githubConnect";
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
  githubConfigured: boolean;
}

export interface ProjectRuntimeConfig {
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  installCommand: string | null;
  runCommand: string | null;
  openUrl: string | null;
  lastRunUrl: string | null;
  initialIdea: string | null;
  githubRepoName: string | null;
  attachedSkillId?: string | null;
}

export type FlowchartDirection = "TD" | "LR";
export type FlowchartNodeKind = "entry" | "page" | "action" | "system";

export interface FlowchartGroup {
  id: string;
  label: string;
  description: string;
}

export interface FlowchartNode {
  id: string;
  label: string;
  kind: FlowchartNodeKind;
  description: string;
  groupId: string | null;
}

export interface FlowchartEdge {
  from: string;
  to: string;
  label: string | null;
}

export interface FlowchartGraph {
  version: 1;
  direction: FlowchartDirection;
  groups: FlowchartGroup[];
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
}

export interface FlowchartSnapshot {
  flowchart: string;
  flowchartGraph: FlowchartGraph | null;
}

export interface Project {
  id: string;
  name: string;
  iconColor: string;
  description: string;
  localPath: string;
  remoteUrl: string | null;
  defaultBranch: string;
  threadId: string | null;
  flowchartPath: string;
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
  flowchart: string;
  flowchartGraph: FlowchartGraph | null;
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
  status: "planning" | "awaitingApproval" | "executing" | "completed" | "failed";
  thinkingStatus: UpdateStageStatus;
  planningStatus: UpdateStageStatus;
  buildingStatus: UpdateStageStatus;
  verifyingStatus: UpdateStageStatus;
  explanation: string;
  steps: PlanStep[];
  summary: string | null;
  impact: string | null;
  flowchartChanges: string | null;
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
  flowchart: string;
  flowchartGraph: FlowchartGraph | null;
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
  createRemote: boolean;
  visibility: RepoVisibility;
}

export interface ProjectAttachInput {
  localPath: string;
  iconColor: string;
  createRemote: boolean;
  visibility: RepoVisibility;
}

export interface ProjectEnableSyncInput {
  projectId: string;
  visibility: RepoVisibility;
}

export interface AttachPathInspection {
  localPath: string;
  name: string | null;
  exists: boolean;
  isRepo: boolean;
  remoteUrl: string | null;
  defaultBranch: string | null;
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
  githubClientIdOverride?: string | null;
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

export type GitHubClientIdSource = "bundled" | "override" | null;

export interface GitHubAuthStatus {
  configured: boolean;
  canConnect: boolean;
  clientIdSource: GitHubClientIdSource;
  hasStoredToken: boolean;
  loggedIn: boolean;
  verified: boolean;
  login: string | null;
  avatarUrl: string | null;
  expiresAt: string | null;
  errorMessage: string | null;
  loginPrompt: GitHubLoginPrompt | null;
}

export interface GitHubLoginPrompt {
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  interval: number;
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
  github: GitHubAuthStatus;
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
  skills: Skill[];
}

export type AppEvent =
  | { type: "toast"; level: ToastLevel; message: string }
  | { type: "auth.codex"; status: CodexAuthStatus }
  | { type: "auth.claude"; status: ClaudeAuthStatus }
  | { type: "auth.github"; status: GitHubAuthStatus }
  | { type: "modelCatalog.updated"; catalog: ModelCatalog }
  | { type: "setup.updated"; setup: SetupSnapshot }
  | { type: "appUpdate.status"; status: AppUpdateStatus }
  | { type: "project.updated"; project: Project }
  | { type: "project.removed"; projectId: string }
  | { type: "project.runtime"; projectId: string; runtime: RuntimeState }
  | { type: "project.plan"; projectId: string; plan: PlanDraft | null }
  | { type: "project.history"; projectId: string; updates: UpdateRecord[] }
  | { type: "project.pendingUpdate"; projectId: string; pending: PendingPlannedUpdate | null }
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

export interface RetrySyncInput {
  projectId: string;
  updateId: string;
}

export interface PlanningChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  flowchart: string | null;
  flowchartGraph: FlowchartGraph | null;
  createdAt: string;
}

export interface PlanningSession {
  id: string;
  projectId: string;
  provider: AiProvider;
  messages: PlanningChatMessage[];
  currentFlowchart: string;
  currentFlowchartGraph: FlowchartGraph | null;
  previousFlowchart: string;
  previousFlowchartGraph: FlowchartGraph | null;
  createdAt: string;
  updatedAt: string;
}

export interface PendingPlannedUpdate {
  id: string;
  projectId: string;
  flowchart: string;
  flowchartGraph: FlowchartGraph | null;
  previousFlowchart: string;
  previousFlowchartGraph: FlowchartGraph | null;
  description: string;
  createdAt: string;
}

export interface GenerateFlowchartInput {
  projectId: string;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
}

export interface GenerateFlowchartResult extends FlowchartSnapshot {}

export interface GenerateProjectOutlineReportInput {
  projectId: string;
  provider?: AiProvider;
  model?: CodexModel;
  claudeModel?: ClaudeModel;
}

export interface PlanningChatInput {
  projectId: string;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  message: string;
  sessionId: string | null;
}

export interface PlanningChatResponse {
  sessionId: string;
  message: PlanningChatMessage;
  updatedFlowchart: string | null;
  updatedFlowchartGraph: FlowchartGraph | null;
}

export interface SavePlannedUpdateInput {
  projectId: string;
  flowchart: string;
  flowchartGraph: FlowchartGraph | null;
  previousFlowchart: string;
  previousFlowchartGraph: FlowchartGraph | null;
  description: string;
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

export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status?: "working" | "complete";
  metadata?: PingTranslationMetadata | HardMemoryReportMetadata | null;
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
    }
  | {
      type: "delete_pillar";
      name: string;
    };

export type SlackMessageMetadata =
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
      type: "execution-report";
      report: JeffExecutionReport;
    }
  | HardMemoryReportMetadata
  | PingTranslationMetadata;

export interface SlackChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  directorId: DirectorId | null;
  content: string;
  createdAt: string;
  status?: "working" | "complete";
  metadata?: SlackMessageMetadata | null;
}

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

/** @deprecated Use DirectorId */
export type AgentId = DirectorId;

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

/** @deprecated Use DIRECTOR_LABELS */
export const AGENT_LABELS: Record<DirectorId, string> = DIRECTOR_LABELS;

// --- Focus Modes ---

export type CreativeFocusMode = "conversation" | "core-details" | "vibes";
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

export const SLACK_CHAT_ENABLED = true;
export const SLACK_CHAT_DISABLED_MESSAGE = "Slack chat is temporarily disabled while the DM workflow is being rebuilt.";

export interface VibeAttachment {
  id: string;
  filePath: string;
  fileName: string;
  description: string | null;
  fileType: "image" | "text" | "screenshot" | "note" | "other";
  createdAt: string;
}

export interface DirectorConversation {
  directorId: DirectorId;
  focusMode: DirectorFocusMode | null;
  messages: AgentChatMessage[];
  lastActiveAt: string | null;
}

/** @deprecated Use DirectorConversation */
export type AgentConversation = DirectorConversation;

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
  vibes: VibeAttachment[];
  description: string | null;
  connectedPillarIds: string[];
  assumptionText: string | null;
  assumptionSource: "user" | "dan" | null;
  order: number;
}

export interface FlowStep {
  id: string;
  description: string;
  pillarIds: string[];
}

export interface AgentStageData {
  messages: AgentChatMessage[];
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

export interface DynamicSubAgent {
  id: string;
  skillId: string;
  name: string;
  role: string;
  assignedUpdates: string[];
  conversation: AgentChatMessage[];
  sourcePillarId: string | null;
  departmentDirectorId: DirectorId | null;
  modelTier: "mini" | "large";
}

export type PendingApprovalKind =
  | "handoff"
  | "internet-research"
  | "codebase-scan"
  | "store-data"
  | "plan"
  | "apply-pending-update"
  | "agent-update"
  | "validation";

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
  notes: string[];
  sideNotes: string[];
  draftChangeSummary: string[];
  draftStatus: DanDraftStatus | null;
  fullExperienceDescription: string | null;
  archivedNotes: string[];
  deletedNotes: string[];
  rawMemories: DanRawMemory[];
  forgottenMemories: string[];
  creativeHistory: DanHistoryLogEntry[];
  toddHandoffNotes: string[];
}

export interface ToddCodebaseIndexedMap {
  summary: string | null;
  indexedAt: string | null;
  featureAreas: string[];
  repoNotes: string[];
}

export interface ToddUpdateLogEntry {
  id: string;
  updateId: string | null;
  goal: string;
  outcome: string;
  status: PingRawReportStatus;
  reportId: string | null;
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
  notes: string[];
  pendingHandoff: ToddHandoffPackage | null;
  backupNotes: string[];
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

export interface JeffExecutionReport {
  id: string;
  updateId: string | null;
  title: string;
  summary: string;
  outcome: string;
  toddFollowUpNeeded: boolean;
  toddFollowUpReason: string | null;
  rawReport: PingRawReport;
  createdAt: string;
}

export interface PingMemory {
  activeUpdateId: string | null;
  activeTask: string | null;
  context: string | null;
  codebaseMapSummary: string | null;
  latestRawReport: PingRawReport | null;
  latestJeffReport: JeffExecutionReport | null;
}

export interface AgentSession {
  id: string;
  projectId: string;
  currentStage: AgentStage;
  conversationMode: "guided" | "general";
  stages: Record<AgentStage, AgentStageData>;
  unifiedMessages: AgentChatMessage[];
  scratchpad: ScratchpadItem[];
  plannedUpdates: AgentPlannedUpdate[];
  corePillars: CorePillar[];
  currentCorePillars: CorePillar[];
  coreDetailsChatHistory: AgentChatMessage[];
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
  dynamicSubAgents: DynamicSubAgent[];
  slackMessages: SlackChatMessage[];
  slackActiveDirectorId: DirectorId;
  slackPresenceGuestId: DirectorId | null;
  pendingApprovals: PendingApproval[];
  directorSettingsOverrides: Partial<Record<DirectorId, DirectorSettingsOverride>>;
  directorStateMap: Partial<Record<DirectorId, DirectorStateSnapshot>>;
  danMemory: DanMemory;
  toddMemory: ToddMemory;
  pingMemory: PingMemory;
  /** @deprecated Use directorConversations */
  agentConversations: Record<string, DirectorConversation>;
  /** @deprecated Use activeDirectorId */
  activeAgentId: DirectorId | null;
}

export interface AgentChatInput {
  projectId: string;
  stage: AgentStage;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  message: string;
}

export interface AgentChatResponse {
  sessionId: string;
  message: AgentChatMessage;
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
  message: AgentChatMessage;
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
  message: AgentChatMessage;
  updatedCoreDetails: AgentCoreDetails | null;
}

export interface AgentProcessTodosInput {
  projectId: string;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  newTodos: string[];
}

// --- Git Sync ---

export interface GitSyncInput {
  projectId: string;
  commitMessage?: string;
}

export interface GitSyncResult {
  committed: boolean;
  pushed: boolean;
  commitSha: string | null;
  error: string | null;
}

// --- Skills ---

export type SkillSourceType = "skill" | "plugin";
export type SkillInstallStatus = "ready" | "installing" | "error";
export type SkillProviderCompatibility = "claude" | "codex" | "universal";

export interface Skill {
  id: string;
  name: string;
  description: string;
  sourceProvider: SkillProviderCompatibility;
  sourceType: SkillSourceType;
  instructions: string;
  originalFilePath: string | null;
  isUniversal: boolean;
  installStatus: SkillInstallStatus;
  installSlug: string | null;
  installPath: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DownloadSkillInput {
  filePath: string;
  name?: string;
}

export interface InstallSkillCatalogInput {
  catalogId: "frontend-design-universal" | "user-testing-universal";
}

export interface ConvertSkillInput {
  skillId: string;
}

export interface AttachSkillInput {
  projectId: string;
  skillId: string | null;
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
  message: AgentChatMessage;
  routeSuggestion: { directorId: DirectorId; reason: string } | null;
  structuredData: DirectorStructuredData | null;
  internalNotes: string[] | null;
  suggestCreateProject: boolean;
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

/** @deprecated Use DirectorChatInput */
export type MultiAgentChatInput = DirectorChatInput;
/** @deprecated Use DirectorChatResponse */
export type MultiAgentChatResponse = DirectorChatResponse;
/** @deprecated Use DirectorStructuredData */
export type MultiAgentStructuredData = DirectorStructuredData;

export interface SlackChatInput {
  projectId: string;
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  message: string;
  targetDirectorId?: DirectorId | null;
}

export type SlackDirectorMode =
  | "codebase-analysis"
  | "internet-research"
  | "version-planning"
  | "update-planning";

export interface SlackDirectorApprovalPayload {
  action: "runSlackDirector";
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  directorId: DirectorId;
  message: string;
  mode: SlackDirectorMode;
}

export interface SlackChatResponse {
  sessionId: string;
  directorId: DirectorId;
  message: SlackChatMessage;
  handoffTo: DirectorId | null;
  handoffReason: string | null;
  chainedMessages?: SlackChatMessage[];
}

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

export interface AttachVibeInput {
  projectId: string;
  pillarId: string;
  filePaths: string[];
  descriptions?: (string | null)[];
}

export interface RemoveVibeInput {
  projectId: string;
  pillarId: string;
  vibeId: string;
}

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

// --- Pillar Sub-Agents ---

export interface CreatePillarSubAgentsInput {
  projectId: string;
}
