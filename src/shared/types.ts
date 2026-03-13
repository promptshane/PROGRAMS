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

export const CODEX_MODEL_OPTIONS = ["gpt-5.4", "gpt-5.3-codex"] as const;
export const CLAUDE_MODEL_OPTIONS = ["sonnet", "opus"] as const;
export const DEFAULT_MODEL_CATALOG: ModelCatalog = {
  codex: [
    {
      id: "gpt-5.4",
      label: "GPT-5.4",
      detail: "Latest frontier agentic coding model.",
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

export interface GitHubAuthStatus {
  configured: boolean;
  loggedIn: boolean;
  login: string | null;
  avatarUrl: string | null;
  expiresAt: string | null;
  errorMessage: string | null;
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
  | { type: "project.outlineReport"; projectId: string; report: ProjectOutlineReport | null };

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
