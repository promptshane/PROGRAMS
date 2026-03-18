import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";
import mermaid from "mermaid";
import { normalizeFlowchartGraph } from "@shared/flowchart";
import { InteractiveFlowchart } from "./components/InteractiveFlowchart";
import { FlowchartDiff } from "./components/FlowchartDiff";
import {
  AGENT_STAGE_LABELS,
  DIRECTOR_LABELS,
  DIRECTOR_NAMES,
  DIRECTOR_COLORS,
  DEFAULT_MODEL_CATALOG,
  type AgentChatMessage,
  type AgentCoreDetails,
  type AgentPlannedUpdate,
  type CoreDetailsProposal,
  type CorePillar,
  type CreativeFocusMode,
  type DirectorChatResponse,
  type DirectorFocusMode,
  type DirectorId,
  type AgentSession,
  type AgentStage,
  type AgentStageConfirmation,
  type AiProvider,
  type AppUpdateStatus,
  type AppEvent,
  type AttachPathInspection,
  type AuthSnapshot,
  type ClaudeModel,
  type CodexModel,
  type EnvFileSnapshot,
  type EnvVariableEntry,
  type FeasibilityAssessment,
  type FlowchartGraph,
  type GenerateFlowchartResult,
  type GenerateProjectOutlineReportInput,
  type HomeScratchpadItem,
  type InstallSkillCatalogInput,
  type CascadeProposal,
  type ModelCatalog,
  type ModelOption,
  type PillarType,
  type PlanDraft,
  type ProjectCategory,
  type ProviderUsage,
  type Project,
  type ProjectDetail,
  type ProjectOutlineReport,
  type RdFocusMode,
  type RuntimeState,
  type ScratchpadItem,
  type Settings,
  type SetupCheck,
  type SetupSnapshot,
  type SpeedMode,
  type StoredDataNode,
  type StatusTone,
  type Theme,
  type UpdateRecord,
  type UsageWindow,
  type UsageSnapshot,
  type ValidationFocusMode,
  type ValidationResult,
  type VersionPlan,
  type VersionUpdate,
  type VibeAttachment,
  type PendingPlannedUpdate,
  type PlanningChatMessage,
  type PlanningMode,
  type PlanningChatResponse,
  type GenerateFlowchartInput,
  type PlanningChatInput,
  type SavePlannedUpdateInput,
  type UpdateStageStatus,
  type ProgramUpdateMode,
  type UnifiedTodoItem,
  type DiffStats,
  type GitSyncResult,
  type Skill,
  type SlackChatMessage,
  type SlackChatInput,
  type SlackChatResponse,
} from "@shared/types";

interface ToastItem {
  id: string;
  level: "info" | "success" | "error";
  message: string;
}

interface AddProjectFormState {
  mode: "create" | "attach";
  createName: string;
  parentDirectory: string;
  attachDirectory: string;
  iconColor: string;
  initialIdea: string;
}


interface ComposerOptions {
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  reasoningEffort: Settings["advancedDefaults"]["reasoningEffort"];
  speed: SpeedMode;
  planningMode: PlanningMode;
  contextPaths: string[];
}

type ProgramDetailsTab = "history" | "current" | "planned" | "final" | "agentUpdates";

const THEME_STORAGE_KEY = "programs.theme";
const DEFAULT_ICON_COLORS = [
  "#FB7185",
  "#F97316",
  "#F59E0B",
  "#10B981",
  "#14B8A6",
  "#0EA5E9",
  "#3B82F6",
  "#64748B",
];

const emptySettings: Settings = {
  theme: "dark",
  uiMode: "simple",
  defaultSpeed: "normal",
  autoApprovePlans: true,
  advancedDefaults: {
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    reasoningEffort: "xhigh",
    serviceTier: "flex",
    customInstructions: "",
    repoVisibility: "private",
  },
  appSourcePath: "/Users/kc/Desktop/PROGRAMS",
  codexBinaryPath: null,
  claudeBinaryPath: null,
  githubClientIdOverride: null,
};

const emptySetup: SetupSnapshot = {
  checks: [],
  completedAt: null,
  isSetupComplete: false,
  showSetupOnLaunch: false,
  currentCheckId: null,
  isPackagedBuild: false,
  githubConfigured: false,
};

const emptyAuth: AuthSnapshot = {
  codex: {
    available: false,
    loggedIn: false,
    binaryPath: null,
    version: null,
    email: null,
    planType: null,
    authMode: null,
    errorMessage: null,
  },
  claude: {
    available: false,
    loggedIn: false,
    ready: false,
    canConnect: false,
    binaryPath: null,
    version: null,
    email: null,
    displayName: null,
    planType: null,
    errorMessage: null,
    runtimeErrorMessage: null,
    connectErrorMessage: null,
  },
  github: {
    configured: false,
    canConnect: false,
    clientIdSource: null,
    hasStoredToken: false,
    loggedIn: false,
    verified: false,
    login: null,
    avatarUrl: null,
    expiresAt: null,
    errorMessage: null,
    loginPrompt: null,
  },
};

const emptyUsage: UsageSnapshot = {
  codex: {
    status: "requiresInstall",
    windows: [],
    note: null,
  },
  claude: {
    status: "requiresInstall",
    windows: [],
    note: null,
  },
  updatedAt: "",
};

const emptyAppUpdateStatus: AppUpdateStatus = {
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
  reason: null,
};

const emptyRuntimeState = (projectId: string): RuntimeState => ({
  projectId,
  running: false,
  pid: null,
  url: null,
  startedAt: null,
  logs: [],
  source: "none",
  controllable: false,
});

const emptyModelCatalog: ModelCatalog = DEFAULT_MODEL_CATALOG;

type HomeTileDotState = "ready" | "launching" | "running" | "updating" | "runningUpdating" | "error";
type AppPage = "homepage" | "projects" | "slack" | "agents" | "skills" | "calendar" | "health";
type UsageScheduleTone = "under" | "onTrack" | "over";
type SlackDetailsRange = "daily" | "weekly" | "monthly";

const USAGE_SCHEDULE_TOLERANCE = 6;
const SLACK_DETAILS_RANGE_OPTIONS: SlackDetailsRange[] = ["daily", "weekly", "monthly"];
const SLACK_DETAILS_DIRECTOR_FLOW: DirectorId[] = [
  "project-manager",
  "creative-director",
  "rd-director",
  "programming-director",
  "validation-director",
];

const normalizeSentence = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const summarizeCorePillars = (pillars: CorePillar[]): string | null => {
  const names = pillars
    .map((pillar) => pillar.name.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (names.length === 0) return null;
  if (names.length === 1) {
    return `Core pillars currently center on ${names[0]}.`;
  }
  return `Core pillars currently center on ${names[0]} and ${names[1]}.`;
};

const buildSlackProjectDescription = (session: AgentSession | null): string => {
  const functionSummary = normalizeSentence(session?.stages.function.confirmed?.summary);
  const thesisSummary = normalizeSentence(session?.stages.thesis.confirmed?.summary);
  const pillarSummary = summarizeCorePillars(session?.corePillars ?? []);
  const sentences: string[] = [];

  if (functionSummary) {
    sentences.push(functionSummary);
  }
  if (thesisSummary && thesisSummary !== functionSummary) {
    sentences.push(thesisSummary);
  }
  if (sentences.length === 0 && pillarSummary) {
    sentences.push(pillarSummary);
  } else if (sentences.length === 1 && !thesisSummary && pillarSummary && pillarSummary !== sentences[0]) {
    sentences.push(pillarSummary);
  }

  return sentences.slice(0, 2).join(" ") || "Core details are still taking shape for this project.";
};
const APP_PAGE_OPTIONS: Array<{
  id: AppPage;
  label: string;
}> = [
  {
    id: "homepage",
    label: "Homepage",
  },
  {
    id: "projects",
    label: "Projects",
  },
  {
    id: "slack",
    label: "Slack",
  },
  {
    id: "agents",
    label: "Agents",
  },
  {
    id: "skills",
    label: "Skills",
  },
  {
    id: "calendar",
    label: "Calendar",
  },
  {
    id: "health",
    label: "Health",
  },
];

const formatDate = (value: string | null): string =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not yet updated";

const labelForRuntimeSource = (source: RuntimeState["source"]): string => {
  if (source === "managed") {
    return "Managed by PROGRAMS";
  }
  if (source === "restored") {
    return "Restored runtime";
  }
  if (source === "external") {
    return "Existing external runtime";
  }
  if (source === "self") {
    return "PROGRAMS runtime";
  }

  return "No runtime";
};

const initialsFromName = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

const createEmptyForm = (): AddProjectFormState => ({
  mode: "create",
  createName: "",
  parentDirectory: "",
  attachDirectory: "",
  iconColor: "#0EA5E9",
  initialIdea: "",
});

const nextIconColor = (count: number): string => DEFAULT_ICON_COLORS[count % DEFAULT_ICON_COLORS.length];

const parseProjectSortTime = (value: string | null): number => {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const sortProjectsForDisplay = (projects: Project[]): Project[] =>
  [...projects].sort((left, right) => {
    const lastUpdatedDelta = parseProjectSortTime(right.lastUpdatedAt) - parseProjectSortTime(left.lastUpdatedAt);
    if (lastUpdatedDelta !== 0) {
      return lastUpdatedDelta;
    }

    const createdDelta = parseProjectSortTime(right.createdAt) - parseProjectSortTime(left.createdAt);
    if (createdDelta !== 0) {
      return createdDelta;
    }

    return left.name.localeCompare(right.name);
  });

const readInitialTheme = (): Theme =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";

const applyTheme = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
};

const providerLabel = (provider: AiProvider): string =>
  provider === "claude" ? "Claude" : "Codex";

const titleCaseWord = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

const fallbackCodexModelLabel = (model: string): string =>
  model
    .replace(/^gpt-/i, "GPT-")
    .split("-")
    .map((part, index) => (index < 2 ? part : titleCaseWord(part)))
    .join(" ");

const fallbackClaudeModelLabel = (model: string): string => {
  if (model === "sonnet") {
    return "Claude Sonnet";
  }
  if (model === "opus") {
    return "Claude Opus";
  }

  return model
    .replace(/^claude-/i, "Claude ")
    .split("-")
    .map((part, index) => (index === 0 ? part : titleCaseWord(part)))
    .join(" ");
};

const labelForModel = (model: string, options: ModelOption[], fallback: (model: string) => string): string =>
  options.find((option) => option.id === model)?.label ?? fallback(model);

const labelForReasoningEffort = (reasoningEffort: ComposerOptions["reasoningEffort"]): string => {
  switch (reasoningEffort) {
    case "low":
      return "Low";
    case "medium":
      return "Normal";
    case "high":
      return "High";
    case "xhigh":
      return "Extra high";
  }
};

const labelForPlanningMode = (planningMode: PlanningMode): string => {
  switch (planningMode) {
    case "review":
      return "Review";
    case "auto":
      return "Auto";
    case "none":
      return "No Plan";
  }
};

const labelForComposerModel = (options: ComposerOptions, modelCatalog: ModelCatalog): string =>
  options.provider === "claude"
    ? labelForModel(options.claudeModel, modelCatalog.claude, fallbackClaudeModelLabel)
    : labelForModel(options.model, modelCatalog.codex, fallbackCodexModelLabel);

const getComposerDefaults = (settings: Settings): ComposerOptions => ({
  provider: settings.advancedDefaults.provider,
  model: settings.advancedDefaults.model,
  claudeModel: settings.advancedDefaults.claudeModel,
  reasoningEffort: settings.advancedDefaults.reasoningEffort,
  speed: settings.defaultSpeed,
  planningMode: settings.autoApprovePlans ? "auto" : "review",
  contextPaths: [],
});

const formatSlackTimestamp = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

function parseInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      nodes.push(<strong key={`${keyPrefix}-${idx}`}>{match[2]}</strong>);
    } else if (match[3]) {
      nodes.push(<em key={`${keyPrefix}-${idx}`}>{match[3]}</em>);
    } else if (match[4]) {
      nodes.push(<code key={`${keyPrefix}-${idx}`} className="slackInlineCode">{match[4]}</code>);
    }
    lastIndex = match.index + match[0].length;
    idx++;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function SlackMarkdown({ text }: { text: string }) {
  const parts = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) nodes.push(<br key={`br-${i}`} />);
      nodes.push(...parseInlineMarkdown(lines[i], `line-${i}`));
    }
    return nodes;
  }, [text]);
  return <>{parts}</>;
}

const dedupePaths = (paths: string[]): string[] => Array.from(new Set(paths)).sort();

const COMPOSER_MIN_HEIGHT = 64;
const COMPOSER_MAX_HEIGHT = 224;

const syncComposerTextareaHeight = (textarea: HTMLTextAreaElement | null): void => {
  if (!textarea) {
    return;
  }

  textarea.style.height = "auto";
  const nextHeight = Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, textarea.scrollHeight));
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
};

const hasFileDragPayload = (dataTransfer: DataTransfer | null): boolean => {
  if (!dataTransfer) {
    return false;
  }

  if (Array.from(dataTransfer.types).includes("Files")) {
    return true;
  }

  return Array.from(dataTransfer.items ?? []).some((item) => item.kind === "file");
};

const normalizeHexColor = (value: string): string | null => {
  const match = value.trim().match(/^#?([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) {
    return null;
  }

  const [, hex] = match;
  if (hex.length === 3) {
    return `#${hex
      .split("")
      .map((part) => `${part}${part}`)
      .join("")
      .toUpperCase()}`;
  }

  return `#${hex.toUpperCase()}`;
};

const createProjectTileStyle = (iconColor: string): CSSProperties => {
  const normalized = normalizeHexColor(iconColor) ?? "#0EA5E9";

  return {
    background: normalized,
  };
};

const isProjectUpdating = (status: Project["status"]): boolean => status === "executing" || status === "syncing";

const getHomeTileDotState = (
  project: Project,
  runtime: RuntimeState | null,
  isLaunching: boolean,
): HomeTileDotState => {
  const hasError = project.status === "error" || Boolean(project.lastError);
  const isRunning = Boolean(runtime?.running);
  const isUpdating = isProjectUpdating(project.status);

  if (isLaunching) {
    return "launching";
  }
  if (isRunning && isUpdating) {
    return "runningUpdating";
  }
  if (isRunning) {
    return "running";
  }
  if (hasError) {
    return "error";
  }
  if (isUpdating) {
    return "updating";
  }
  return "ready";
};

const formatUsageSubtitle = (label: string | null, fallback: string): string => label?.trim() || fallback;

const formatUsageTime = (value: Date): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);

const formatUsageDateTimeWithoutYear = (value: Date): string =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);

const formatUsageReset = (window: UsageWindow): string => {
  if (!window.resetsAt) {
    return "Reset time unavailable";
  }

  const resetsAt = new Date(window.resetsAt);
  if (Number.isNaN(resetsAt.getTime())) {
    return "Reset time unavailable";
  }

  if (window.windowDurationMins === 5 * 60) {
    return `Today at ${formatUsageTime(resetsAt)}`;
  }

  if (window.windowDurationMins === 7 * 24 * 60) {
    return formatUsageDateTimeWithoutYear(resetsAt);
  }

  return `Resets ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(resetsAt)}`;
};

const computeExpectedPercent = (window: UsageWindow): number | null => {
  if (!window.resetsAt || !window.windowDurationMins) return null;
  const resetsAt = new Date(window.resetsAt).getTime();
  if (Number.isNaN(resetsAt)) return null;
  const windowDurationMs = window.windowDurationMins * 60 * 1000;
  const startedAt = resetsAt - windowDurationMs;
  const elapsedRatio = Math.min(1, Math.max(0, (Date.now() - startedAt) / windowDurationMs));
  return elapsedRatio * 100;
};

const getUsageScheduleTone = (window: UsageWindow): UsageScheduleTone => {
  if (typeof window.usedPercent !== "number") return "onTrack";
  const expected = computeExpectedPercent(window);
  if (expected === null) return "onTrack";
  const delta = window.usedPercent - expected;
  if (delta <= -USAGE_SCHEDULE_TOLERANCE) return "under";
  if (delta >= USAGE_SCHEDULE_TOLERANCE) return "over";
  return "onTrack";
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

type HomeAppUpdateButtonState = "prepare" | "install" | "issue" | null;

const getHomeAppUpdateButtonState = (status: AppUpdateStatus): HomeAppUpdateButtonState => {
  if (status.buildState === "packaging" || status.buildState === "installing") {
    return "prepare";
  }
  if (status.action === "install" || status.action === "restart") {
    return "install";
  }
  if (status.buildState === "failed") {
    return "issue";
  }
  return null;
};

function App() {
  const programsApi = "programs" in window ? window.programs : undefined;
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog>(emptyModelCatalog);
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [setup, setSetup] = useState<SetupSnapshot>(emptySetup);
  const [auth, setAuth] = useState<AuthSnapshot>(emptyAuth);
  const [usage, setUsage] = useState<UsageSnapshot>(emptyUsage);
  const [appUpdate, setAppUpdate] = useState<AppUpdateStatus>(emptyAppUpdateStatus);
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const [startupIssue, setStartupIssue] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectRuntimes, setProjectRuntimes] = useState<Record<string, RuntimeState>>({});
  const [projectDetails, setProjectDetails] = useState<Record<string, ProjectDetail>>({});
  const [launchingProjects, setLaunchingProjects] = useState<Record<string, boolean>>({});
  const [currentPage, setCurrentPage] = useState<AppPage>("projects");
  const [projectCategories, setProjectCategories] = useState<Record<string, ProjectCategory>>({});
  const [showSidebar, setShowSidebar] = useState(false);
  const [showUpdatePanel, setShowUpdatePanel] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const [composerOptions, setComposerOptions] = useState<ComposerOptions>(getComposerDefaults(emptySettings));
  const [showSettings, setShowSettings] = useState(false);
  const [showUsageSheet, setShowUsageSheet] = useState(false);
  const [showAddProjectChooser, setShowAddProjectChooser] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [addProjectState, setAddProjectState] = useState<AddProjectFormState>(createEmptyForm());
  const [projectOptionsProjectId, setProjectOptionsProjectId] = useState<string | null>(null);
  const [unlinkProjectId, setUnlinkProjectId] = useState<string | null>(null);
  const [programDetailsProjectId, setProgramDetailsProjectId] = useState<string | null>(null);
  const [storedDataProjectId, setStoredDataProjectId] = useState<string | null>(null);
  const [connectionsProjectId, setConnectionsProjectId] = useState<string | null>(null);
  const [runtimeProjectId, setRuntimeProjectId] = useState<string | null>(null);
  const [setupConfirmCheck, setSetupConfirmCheck] = useState<SetupCheck | null>(null);
  const [attachInspection, setAttachInspection] = useState<AttachPathInspection | null>(null);
  const [projectFormError, setProjectFormError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [claudeAuthCodePrompt, setClaudeAuthCodePrompt] = useState<string | null>(null);
  const [claudeAuthCodeInput, setClaudeAuthCodeInput] = useState("");
  const [agentSession, setAgentSession] = useState<AgentSession | null>(null);
  const [agentSelectedProjectId, setAgentSelectedProjectId] = useState<string | null>(null);
  const [slackSelectedProjectId, setSlackSelectedProjectId] = useState<string | null>(null);
  const [slackAgentSession, setSlackAgentSession] = useState<AgentSession | null>(null);
  const [agentViewStage, setAgentViewStage] = useState<AgentStage>("function");
  const agentSelectedProjectIdRef = useRef(agentSelectedProjectId);
  agentSelectedProjectIdRef.current = agentSelectedProjectId;
  const [coreDetailsProjectId, setCoreDetailsProjectId] = useState<string | null>(null);
  const [programMode, setProgramMode] = useState<ProgramUpdateMode>("talk");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [programAgentSession, setProgramAgentSession] = useState<AgentSession | null>(null);
  const [projectAssumedFlags, setProjectAssumedFlags] = useState<Record<string, boolean>>({});
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, PendingPlannedUpdate | null>>({});
  const [outlineReports, setOutlineReports] = useState<Record<string, ProjectOutlineReport | null | undefined>>({});
  const [envSnapshots, setEnvSnapshots] = useState<Record<string, EnvFileSnapshot | undefined>>({});
  const [isUpdateDropTarget, setIsUpdateDropTarget] = useState(false);
  const updateSectionRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const updateDropDepthRef = useRef(0);
  const shownErrorProjectIds = useRef<Set<string>>(new Set());
  const [planError, setPlanError] = useState<string | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const projectOptionsProject = useMemo(
    () => projects.find((project) => project.id === projectOptionsProjectId) ?? null,
    [projectOptionsProjectId, projects],
  );
  const unlinkProject = useMemo(
    () => projects.find((project) => project.id === unlinkProjectId) ?? null,
    [projects, unlinkProjectId],
  );
  const programDetailsProject = useMemo(
    () => projects.find((project) => project.id === programDetailsProjectId) ?? null,
    [programDetailsProjectId, projects],
  );
  const storedDataProject = useMemo(
    () => projects.find((project) => project.id === storedDataProjectId) ?? null,
    [projects, storedDataProjectId],
  );
  const connectionsProject = useMemo(
    () => projects.find((project) => project.id === connectionsProjectId) ?? null,
    [connectionsProjectId, projects],
  );
  const runtimeProject = useMemo(
    () => projects.find((project) => project.id === runtimeProjectId) ?? null,
    [projects, runtimeProjectId],
  );

  const selectedDetail = selectedProjectId ? projectDetails[selectedProjectId] ?? null : null;
  const selectedRuntime = selectedProjectId ? projectRuntimes[selectedProjectId] ?? selectedDetail?.runtime ?? null : null;
  const activePlan = selectedDetail?.activePlan ?? null;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!programsApi) {
      setStartupIssue("PROGRAMS could not load its desktop connection. Restart the app and try again.");
      return;
    }

    void (async () => {
      const bootstrap = await programsApi.bootstrap();
      setSettings(bootstrap.settings);
      setTheme(bootstrap.settings.theme);
      setProjects(sortProjectsForDisplay(bootstrap.projects));
      setProjectRuntimes(bootstrap.runtimes);
      setAuth(bootstrap.auth);
      setSetup(bootstrap.setup);
      setAppUpdate(bootstrap.appUpdate);
      setModelCatalog(bootstrap.modelCatalog);
      setSkills(bootstrap.skills);
      setComposerOptions(getComposerDefaults(bootstrap.settings));

      // Derive project categories
      const cats: Record<string, ProjectCategory> = {};
      for (const p of bootstrap.projects) {
        try {
          cats[p.id] = await window.programs.deriveProjectCategory(p.id);
        } catch { cats[p.id] = "general-project"; }
      }
      setProjectCategories(cats);

      setIsBootstrapped(true);
    })().catch((error: unknown) => {
      setStartupIssue(error instanceof Error ? error.message : "PROGRAMS could not load.");
      setIsBootstrapped(true);
    });
  }, [programsApi]);

  useEffect(() => {
    if (!programsApi) {
      return;
    }

    const refreshAppUpdate = () => {
      void programsApi
        .readAppUpdateStatus()
        .then((status) => setAppUpdate(status))
        .catch(() => undefined);
    };

    window.addEventListener("focus", refreshAppUpdate);
    return () => {
      window.removeEventListener("focus", refreshAppUpdate);
    };
  }, [programsApi]);

  useEffect(() => {
    if (!programsApi || !selectedProjectId) {
      return;
    }

    void refreshProject(selectedProjectId).catch((error: unknown) => {
      pushToast(error instanceof Error ? error.message : "PROGRAMS could not load the project.", "error");
    });
  }, [programsApi, selectedProjectId]);

  useEffect(() => {
    setComposerOptions(getComposerDefaults(settings));
  }, [
    selectedProjectId,
    settings.uiMode,
    settings.defaultSpeed,
    settings.autoApprovePlans,
    settings.advancedDefaults.provider,
    settings.advancedDefaults.model,
    settings.advancedDefaults.claudeModel,
    settings.advancedDefaults.reasoningEffort,
  ]);

  useEffect(() => {
    if (selectedProjectId) {
      setShowUsageSheet(false);
      setComposerValue("");
      setPlanError(null);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    setShowUpdatePanel(Boolean(selectedProjectId));
  }, [selectedProjectId]);

  // Load agent session for programs page features (Core Details, To-Do, Agent Updates)
  useEffect(() => {
    if (selectedProjectId) {
      window.programs.getAgentSession(selectedProjectId).then(setProgramAgentSession);
    } else {
      setProgramAgentSession(null);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    updateDropDepthRef.current = 0;
    setIsUpdateDropTarget(false);
  }, [selectedProjectId, showUpdatePanel]);

  useEffect(() => {
    if (!programsApi || !storedDataProjectId) {
      return;
    }

    void loadOutlineReport(storedDataProjectId).catch((error: unknown) => {
      pushToast(error instanceof Error ? error.message : "PROGRAMS could not load the stored data report.", "error");
    });
  }, [programsApi, storedDataProjectId]);

  useEffect(() => {
    if (!programsApi || !connectionsProjectId) {
      return;
    }

    void loadOutlineReport(connectionsProjectId).catch((error: unknown) => {
      pushToast(error instanceof Error ? error.message : "PROGRAMS could not load the connections report.", "error");
    });
    void loadEnvSnapshot(connectionsProjectId).catch((error: unknown) => {
      pushToast(error instanceof Error ? error.message : "PROGRAMS could not load the environment file.", "error");
    });
  }, [programsApi, connectionsProjectId]);

  useLayoutEffect(() => {
    syncComposerTextareaHeight(composerInputRef.current);
  }, [composerValue, showUpdatePanel, selectedProjectId]);

  useEffect(() => {
    if (currentPage !== "projects") {
      setShowUsageSheet(false);
    }
  }, [currentPage]);

  useEffect(() => {
    if (!projectOptionsProjectId) {
      return;
    }

    const projectStillExists = projects.some((project) => project.id === projectOptionsProjectId);
    if (!projectStillExists) {
      setProjectOptionsProjectId(null);
    }
  }, [projectOptionsProjectId, projects]);

  useEffect(() => {
    if (!programsApi || !showUsageSheet) {
      return;
    }

    void refreshUsage().catch((error: unknown) => {
      pushToast(error instanceof Error ? error.message : "PROGRAMS could not load usage.", "error");
    });
  }, [
    programsApi,
    showUsageSheet,
    auth.codex.available,
    auth.codex.loggedIn,
    auth.codex.email,
    auth.claude.available,
    auth.claude.loggedIn,
  ]);

  useEffect(() => {
    if (!programsApi) {
      return;
    }

    const unsubscribe = programsApi.onEvent((event: AppEvent) => {
      switch (event.type) {
        case "toast":
          pushToast(event.message, event.level);
          return;
        case "auth.codex":
          setAuth((current) => ({ ...current, codex: event.status }));
          void refreshSetup().catch(() => undefined);
          return;
        case "auth.claude":
          setAuth((current) => ({ ...current, claude: event.status }));
          void refreshSetup().catch(() => undefined);
          return;
        case "auth.claude.codePrompt":
          setClaudeAuthCodePrompt(event.prompt);
          return;
        case "auth.github":
          setAuth((current) => ({ ...current, github: event.status }));
          void refreshSetup().catch(() => undefined);
          return;
        case "modelCatalog.updated":
          setModelCatalog(event.catalog);
          return;
        case "setup.updated":
          setSetup(event.setup);
          return;
        case "appUpdate.status":
          setAppUpdate(event.status);
          return;
        case "project.updated":
          setProjects((current) => {
            const exists = current.some((project) => project.id === event.project.id);
            const next = exists
              ? current.map((project) => (project.id === event.project.id ? event.project : project))
              : [event.project, ...current];
            return sortProjectsForDisplay(next);
          });
          setProjectRuntimes((current) =>
            current[event.project.id]
              ? current
              : {
                  ...current,
                  [event.project.id]: emptyRuntimeState(event.project.id),
                },
          );
          setProjectDetails((current) =>
            current[event.project.id]
              ? {
                  ...current,
                  [event.project.id]: {
                    ...current[event.project.id],
                    project: event.project,
                  },
                }
              : current,
          );
          return;
        case "project.removed":
          setProjects((current) => current.filter((project) => project.id !== event.projectId));
          setLaunchingProjects((current) => {
            if (!current[event.projectId]) {
              return current;
            }

            const next = { ...current };
            delete next[event.projectId];
            return next;
          });
          setProjectRuntimes((current) => {
            const next = { ...current };
            delete next[event.projectId];
            return next;
          });
          setProjectDetails((current) => {
            const next = { ...current };
            delete next[event.projectId];
            return next;
          });
          setSelectedProjectId((current) => (current === event.projectId ? null : current));
          setProjectOptionsProjectId((current) => (current === event.projectId ? null : current));
          setUnlinkProjectId((current) => (current === event.projectId ? null : current));
          setProgramDetailsProjectId((current) => (current === event.projectId ? null : current));
          setStoredDataProjectId((current) => (current === event.projectId ? null : current));
          setConnectionsProjectId((current) => (current === event.projectId ? null : current));
          setRuntimeProjectId((current) => (current === event.projectId ? null : current));
          setOutlineReports((current) => {
            const next = { ...current };
            delete next[event.projectId];
            return next;
          });
          setEnvSnapshots((current) => {
            const next = { ...current };
            delete next[event.projectId];
            return next;
          });
          return;
        case "project.runtime":
          setLaunchingProjects((current) => {
            if (!current[event.projectId]) {
              return current;
            }

            if (event.runtime.running && !event.runtime.url) {
              return current;
            }

            const next = { ...current };
            delete next[event.projectId];
            return next;
          });
          setProjectRuntimes((current) => ({
            ...current,
            [event.projectId]: event.runtime,
          }));
          setProjectDetails((current) =>
            current[event.projectId]
              ? {
                  ...current,
                  [event.projectId]: {
                    ...current[event.projectId],
                    runtime: event.runtime,
                  },
                }
              : current,
          );
          return;
        case "project.plan":
          setProjectDetails((current) =>
            current[event.projectId]
              ? {
                  ...current,
                  [event.projectId]: {
                    ...current[event.projectId],
                    activePlan: event.plan,
                  },
                }
              : current,
          );
          return;
        case "project.history":
          setProjectDetails((current) =>
            current[event.projectId]
              ? {
                  ...current,
                  [event.projectId]: {
                    ...current[event.projectId],
                    updates: event.updates,
                  },
                }
              : current,
          );
          return;
        case "project.pendingUpdate":
          setPendingUpdates((current) => ({
            ...current,
            [event.projectId]: event.pending,
          }));
          return;
        case "project.outlineReport":
          setOutlineReports((current) => ({
            ...current,
            [event.projectId]: event.report,
          }));
          return;
        case "agent.session":
          if (event.projectId === agentSelectedProjectIdRef.current) {
            setAgentSession(event.session);
            if (event.session) {
              setAgentViewStage(event.session.currentStage);
            }
          }
          // Also update programAgentSession for programs page features
          setProgramAgentSession((prev) => {
            if (prev && prev.projectId === event.projectId) {
              return event.session;
            }
            return prev;
          });
          // Track which projects have unconfirmed (assumed) core details for badge display
          setProjectAssumedFlags((prev) => ({
            ...prev,
            [event.projectId]: event.session
              ? (["function", "thesis", "core_pillars", "full_flow"] as const).some(
                  (f) => event.session!.stages[f].confirmed?.status === "assumed",
                )
              : false,
          }));
          return;
      }
    });

    return unsubscribe;
  }, [programsApi]);

  const pushToast = (message: string, level: ToastItem["level"]) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, level }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5000);
  };

  const refreshProject = async (projectId: string) => {
    const detail = await window.programs.readProject(projectId);
    const plan = detail.activePlan;
    const isTerminal = plan != null && (plan.status === "completed" || plan.status === "failed");
    // When returning to a project, don't show a completed/failed plan — make the area fresh
    const displayDetail = isTerminal ? { ...detail, activePlan: null } : detail;
    setProjectDetails((current) => ({ ...current, [projectId]: displayDetail }));
    // Show a one-time error banner if the plan failed on its own (not user-stopped — those are cleared immediately by the backend)
    if (isTerminal && plan.status === "failed" && plan.errorMessage && !shownErrorProjectIds.current.has(projectId)) {
      shownErrorProjectIds.current.add(projectId);
      setPlanError(plan.errorMessage);
    }
    setProjectRuntimes((current) => ({
      ...current,
      [projectId]: detail.runtime,
    }));
    void window.programs.getPendingUpdate(projectId).then((pending) => {
      setPendingUpdates((current) => ({ ...current, [projectId]: pending }));
    }).catch(() => undefined);
    return detail;
  };

  const refreshSetup = async () => {
    const snapshot = await window.programs.refreshSetup();
    setSetup(snapshot);
    return snapshot;
  };

  const refreshUsage = async () => {
    const snapshot = await window.programs.readUsage();
    setUsage(snapshot);
    return snapshot;
  };

  const loadOutlineReport = async (projectId: string) => {
    const report = await window.programs.readOutlineReport(projectId);
    setOutlineReports((current) => ({ ...current, [projectId]: report }));
    return report;
  };

  const loadEnvSnapshot = async (projectId: string) => {
    const snapshot = await window.programs.readEnvFile(projectId);
    setEnvSnapshots((current) => ({ ...current, [projectId]: snapshot }));
    return snapshot;
  };

  const withBusy = async (key: string, task: () => Promise<void>) => {
    setBusyKey(key);
    try {
      await task();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "That action could not finish.", "error");
    } finally {
      setBusyKey(null);
    }
  };

  const resetAddProjectFlow = (mode: AddProjectFormState["mode"] = "create") => {
    setShowUsageSheet(false);
    setShowAddProjectChooser(false);
    setShowAddProject(false);
    setAddProjectState({
      ...createEmptyForm(),
      mode,
    });
    setAttachInspection(null);
    setProjectFormError(null);
  };

  const openAddProjectChooser = () => {
    setShowUsageSheet(false);
    setShowAddProjectChooser(true);
    setProjectFormError(null);
  };

  const openAddProject = (mode: AddProjectFormState["mode"] = "create") => {
    setShowUsageSheet(false);
    setShowAddProjectChooser(false);
    setShowAddProject(true);
    setAddProjectState({
      ...createEmptyForm(),
      mode,
      iconColor: nextIconColor(projects.length),
    });
    setAttachInspection(null);
    setProjectFormError(null);
  };

  const submitProjectForm = async (formState: AddProjectFormState) => {
    if (formState.mode === "create") {
      const project = await window.programs.createProject({
        name: formState.createName.trim(),
        parentDirectory: formState.parentDirectory.trim(),
        iconColor: formState.iconColor,
        initialIdea: formState.initialIdea.trim(),
        createRemote: false,
        visibility: "private",
      });
      setSelectedProjectId(project.id);
    } else {
      const project = await window.programs.attachProject({
        localPath: formState.attachDirectory.trim(),
        iconColor: formState.iconColor,
        createRemote: false,
        visibility: "private",
      });
      setSelectedProjectId(project.id);
    }

    resetAddProjectFlow();
  };

  const inspectAttachSelection = async (localPath: string) => {
    const inspection = await window.programs.inspectAttachPath(localPath);
    setAttachInspection(inspection);
    if (!inspection.exists) {
      setProjectFormError("That folder is no longer available. Choose another folder.");
      return;
    }
    setProjectFormError(null);
  };

  const handleBrowse = async (mode: "parentDirectory" | "attachDirectory") => {
    const result = await window.programs.pickDirectory(mode === "attachDirectory" ? "attach" : "parent");
    if (result.canceled || !result.path) {
      return;
    }

    if (mode === "attachDirectory") {
      setAddProjectState((current) => ({
        ...current,
        attachDirectory: result.path!,
      }));
      try {
        await inspectAttachSelection(result.path);
      } catch (error) {
        const message = error instanceof Error ? error.message : "That folder could not be inspected.";
        setProjectFormError(message);
        pushToast(message, "error");
      }
      return;
    }

    setAddProjectState((current) => ({
      ...current,
      parentDirectory: result.path!,
    }));
  };

  const handleCreateOrAttach = async () => {
    setBusyKey("project.submit");
    setProjectFormError(null);
    try {
      const formState = { ...addProjectState };
      if (formState.mode === "attach" && !formState.attachDirectory.trim()) {
        throw new Error("Choose a folder before you attach a project.");
      }
      if (formState.mode === "create" && !formState.parentDirectory.trim()) {
        throw new Error("Choose where the new project should live first.");
      }
      if (formState.mode === "create" && !formState.createName.trim()) {
        throw new Error("Enter a project name first.");
      }

      await submitProjectForm(formState);
    } catch (error) {
      const message = error instanceof Error ? error.message : "That action could not finish.";
      setProjectFormError(message);
      pushToast(message, "error");
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveProjectDirect = async (projectId: string, name: string, iconColor: string) => {
    await withBusy("project.update", async () => {
      await window.programs.updateProject({ projectId, name, iconColor });
    });
  };

  const openProjectOptions = (projectId: string) => {
    setShowUsageSheet(false);
    setProjectOptionsProjectId(projectId);
  };

  const handleUnlinkProject = async () => {
    if (!unlinkProject) {
      return;
    }

    const projectId = unlinkProject.id;
    await withBusy("project.unlink", async () => {
      await window.programs.unlinkProject(projectId);
      setUnlinkProjectId(null);
      setSelectedProjectId((current) => (current === projectId ? null : current));
    });
  };

  const handleInstallAppUpdate = async () => {
    await withBusy("app.update", async () => {
      await window.programs.installAppUpdate();
    });
  };

  const handleSaveSettings = async (next: Settings) => {
    await withBusy("settings.save", async () => {
      const updated = await window.programs.updateSettings(next);
      const nextAppUpdate = await window.programs.readAppUpdateStatus();
      setSettings(updated);
      setTheme(updated.theme);
      setAppUpdate(nextAppUpdate);
      setComposerOptions(getComposerDefaults(updated));
      const [codexStatus, claudeStatus, githubStatus] = await Promise.all([
        window.programs.getCodexStatus(),
        window.programs.getClaudeStatus(),
        window.programs.getGitHubStatus(),
      ]);
      setAuth((current) => ({
        ...current,
        codex: codexStatus,
        claude: claudeStatus,
        github: githubStatus,
      }));
      await refreshSetup();
      if (showUsageSheet) {
        await refreshUsage();
      }
      setShowSettings(false);
    });
  };

  const handleBrowseAppSourcePath = async (): Promise<string | null> => {
    const result = await window.programs.pickDirectory("attach");
    if (result.canceled || !result.path) {
      return null;
    }

    return result.path;
  };

  const toggleUsageSheet = () => {
    setShowUsageSheet((current) => !current);
  };

  const openSettingsModal = () => {
    setShowUsageSheet(false);
    setShowSettings(true);
  };

  const handleCloseSettings = () => {
    setTheme(settings.theme);
    setShowSettings(false);
  };

  const handleConnectCodex = async () => {
    await withBusy("auth.codex", async () => {
      const status = await window.programs.loginCodex();
      setAuth((current) => ({ ...current, codex: status }));
      await refreshSetup();
    });
  };

  const handleConnectClaude = async () => {
    await withBusy("auth.claude", async () => {
      const status = await window.programs.loginClaude();
      setAuth((current) => ({ ...current, claude: status }));
      await refreshSetup();
    });
  };

  const handleConnectGitHub = async () => {
    await withBusy("auth.github", async () => {
      const prompt = await window.programs.loginGitHub();
      const status = await window.programs.getGitHubStatus();
      setAuth((current) => ({ ...current, github: status }));
      pushToast(`Approve GitHub access in your browser with code ${prompt.userCode}.`, "info");
      await refreshSetup();
    });
  };

  const handleDisconnectCodex = async () => {
    await withBusy("auth.codex", async () => {
      const status = await window.programs.logoutCodex();
      setAuth((current) => ({ ...current, codex: status }));
      await refreshSetup();
    });
  };

  const handleDisconnectClaude = async () => {
    await withBusy("auth.claude", async () => {
      const status = await window.programs.logoutClaude();
      setAuth((current) => ({ ...current, claude: status }));
      await refreshSetup();
    });
  };

  const handleDisconnectGitHub = async () => {
    await withBusy("auth.github", async () => {
      const status = await window.programs.logoutGitHub();
      setAuth((current) => ({ ...current, github: status }));
      await refreshSetup();
    });
  };

  const handleReconnectCodex = async () => {
    await withBusy("auth.codex", async () => {
      const status = await window.programs.getCodexStatus();
      setAuth((current) => ({ ...current, codex: status }));
      pushToast(status.loggedIn ? "Codex is connected." : "Codex is not connected.", status.loggedIn ? "success" : "error");
    });
  };

  const handleReconnectClaude = async () => {
    await withBusy("auth.claude", async () => {
      const status = await window.programs.getClaudeStatus();
      setAuth((current) => ({ ...current, claude: status }));
      pushToast(
        status.loggedIn && status.ready ? "Claude is connected and ready." : status.loggedIn ? "Claude is connected but needs attention." : "Claude is not connected.",
        status.loggedIn && status.ready ? "success" : "error",
      );
    });
  };

  const handleTestClaude = async () => {
    await withBusy("auth.claude.test", async () => {
      const result = await window.programs.testClaudeConnection();
      pushToast(result.message, result.ok ? "success" : "error");
      const status = await window.programs.getClaudeStatus();
      setAuth((current) => ({ ...current, claude: status }));
    });
  };

  const handleReconnectGitHub = async () => {
    await withBusy("auth.github", async () => {
      const status = await window.programs.getGitHubStatus();
      setAuth((current) => ({ ...current, github: status }));
      pushToast(status.loggedIn ? `GitHub is connected${status.login ? ` as ${status.login}` : ""}.` : "GitHub is not connected.", status.loggedIn ? "success" : "error");
    });
  };

  const handleSetupCodex = async () => {
    await withBusy("auth.codex", async () => {
      const status = await window.programs.setupCodex();
      setAuth((current) => ({ ...current, codex: status }));
      await refreshSetup();
      if (showUsageSheet) {
        await refreshUsage();
      }
    });
  };

  const handleSetupClaude = async () => {
    await withBusy("auth.claude", async () => {
      const status = await window.programs.setupClaude();
      setAuth((current) => ({ ...current, claude: status }));
      await refreshSetup();
      if (showUsageSheet) {
        await refreshUsage();
      }
    });
  };

  const handleSetupAction = async (check: SetupCheck, variant: "primary" | "secondary" = "primary") => {
    const actionKind = variant === "primary" ? check.actionKind : check.secondaryActionKind;
    const actionTarget = variant === "primary" ? check.actionTarget : check.secondaryActionTarget;

    switch (actionKind) {
      case "setupCodex":
        await handleSetupCodex();
        return;
      case "setupClaude":
        await handleSetupClaude();
        return;
      case "openExternal":
        if (actionTarget) {
          await window.programs.openExternal(actionTarget);
        }
        return;
      case "openSettings":
        openSettingsModal();
        return;
      case "codexLogin":
        await handleConnectCodex();
        return;
      case "claudeLogin":
        await handleConnectClaude();
        return;
      case "githubLogin":
        await handleConnectGitHub();
        return;
      case "installGit":
        setSetupConfirmCheck(check);
        return;
      case "refresh":
        await refreshSetup();
        return;
      case "none":
      default:
        return;
    }
  };

  const handleRun = async () => {
    if (!selectedProject) {
      return;
    }

    await withBusy("project.run", async () => {
      await window.programs.runProject(selectedProject.id);
      await refreshProject(selectedProject.id);
    });
  };

  const handleKill = async () => {
    if (!selectedProject) {
      return;
    }

    await withBusy("project.kill", async () => {
      const runtime = selectedRuntime;
      await window.programs.killProject(selectedProject.id);
      if (runtime?.source !== "self") {
        await refreshProject(selectedProject.id);
      }
    });
  };

  const handleOpen = async () => {
    if (!selectedProject) {
      return;
    }

    await withBusy("project.open", async () => {
      const opened = await window.programs.openProject(selectedProject.id);
      if (!opened) {
        throw new Error("Run the project once before opening it in the browser.");
      }
    });
  };

  const openProjectWhenReady = async (projectId: string): Promise<boolean> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const opened = await window.programs.openProject(projectId);
      if (opened) {
        return true;
      }
      await wait(750);
    }

    return false;
  };

  const handleHomeTileQuickAction = async (project: Project) => {
    await withBusy(`project.quick.${project.id}`, async () => {
      const runtime = projectRuntimes[project.id] ?? null;
      if (runtime?.running) {
        setLaunchingProjects((current) => {
          if (!current[project.id]) {
            return current;
          }

          const next = { ...current };
          delete next[project.id];
          return next;
        });
        await window.programs.killProject(project.id);
        if (runtime.source !== "self") {
          await refreshProject(project.id);
        }
        return;
      }

      setLaunchingProjects((current) => ({ ...current, [project.id]: true }));
      try {
        await window.programs.runProject(project.id);
        const opened = await openProjectWhenReady(project.id);
        const detail = await refreshProject(project.id);

        if (opened || detail.runtime.url || !detail.runtime.running) {
          setLaunchingProjects((current) => {
            if (!current[project.id]) {
              return current;
            }

            const next = { ...current };
            delete next[project.id];
            return next;
          });
        }

        if (!opened) {
          pushToast("PROGRAMS started the project. The dot will turn solid green once its local URL is ready.", "info");
        }
      } catch (error) {
        setLaunchingProjects((current) => {
          if (!current[project.id]) {
            return current;
          }

          const next = { ...current };
          delete next[project.id];
          return next;
        });
        throw error;
      }
    });
  };

  const handlePickContextPaths = async () => {
    if (!selectedProject) {
      return;
    }

    await withBusy("context.pick", async () => {
      const result = await window.programs.pickContextPaths(selectedProject.id);
      if (result.canceled || result.paths.length === 0) {
        return;
      }

      setComposerOptions((current) => ({
        ...current,
        contextPaths: dedupePaths([...current.contextPaths, ...result.paths]),
      }));
    });
  };

  const resetUpdateDropTarget = () => {
    updateDropDepthRef.current = 0;
    setIsUpdateDropTarget(false);
  };

  const handleUpdateSectionDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFileDragPayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    updateDropDepthRef.current += 1;
    setIsUpdateDropTarget(true);
  };

  const handleUpdateSectionDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFileDragPayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isUpdateDropTarget) {
      setIsUpdateDropTarget(true);
    }
  };

  const handleUpdateSectionDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFileDragPayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    updateDropDepthRef.current = Math.max(0, updateDropDepthRef.current - 1);
    if (updateDropDepthRef.current === 0) {
      setIsUpdateDropTarget(false);
    }
  };

  const handleUpdateSectionDrop = async (event: ReactDragEvent<HTMLDivElement>) => {
    if (!selectedProject || !hasFileDragPayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    resetUpdateDropTarget();

    const nativePaths = window.programs.resolveDroppedFilePaths(Array.from(event.dataTransfer.files));
    if (nativePaths.length === 0) {
      return;
    }

    try {
      const result = await window.programs.resolveDroppedContextPaths({
        projectId: selectedProject.id,
        paths: nativePaths,
      });

      if (result.paths.length) {
        setComposerOptions((current) => ({
          ...current,
          contextPaths: dedupePaths([...current.contextPaths, ...result.paths]),
        }));
      }

      if (result.rejectedCount > 0) {
        pushToast(
          result.paths.length
            ? "Some dropped items were ignored. Only files and folders inside this project can be attached here."
            : "Only files and folders inside this project can be attached here.",
          "error",
        );
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "PROGRAMS could not attach the dropped files.", "error");
    }
  };

  const handlePlanAction = async () => {
    if (!selectedProject) {
      return;
    }

    const prompt = composerValue.trim();
    if (!prompt) {
      pushToast("Describe the change you want first.", "error");
      return;
    }

    if (activePlan?.status === "planning" || activePlan?.status === "executing") {
      pushToast(`Wait for the current ${providerLabel(composerOptions.provider)} turn to finish or cancel it first.`, "error");
      return;
    }

    const input = {
      projectId: selectedProject.id,
      provider: composerOptions.provider,
      prompt,
      speed: composerOptions.speed,
      model: composerOptions.model,
      claudeModel: composerOptions.claudeModel,
      reasoningEffort: composerOptions.reasoningEffort,
      planningMode: composerOptions.planningMode,
      autoApprove: composerOptions.planningMode === "auto",
      contextPaths: composerOptions.contextPaths,
    } as const;

    await withBusy("plan.send", async () => {
      if (activePlan?.status === "awaitingApproval") {
        await window.programs.revisePlan(input);
      } else {
        await window.programs.startPlan(input);
      }
      setComposerValue("");
      setComposerOptions((current) => ({
        ...current,
        contextPaths: [],
      }));
    });
  };

  const handleConfirmUpdate = async () => {
    if (!selectedProject) {
      return;
    }

    await withBusy("plan.approve", async () => {
      await window.programs.approvePlan({ projectId: selectedProject.id });
    });
  };

  const handleCancelPlan = async () => {
    if (!selectedProject) {
      return;
    }

    await withBusy("plan.cancel", async () => {
      await window.programs.cancelPlan(selectedProject.id);
    });
  };

  const handleUndoUpdate = async (update: UpdateRecord) => {
    if (!selectedProject) {
      return;
    }

    await withBusy(`undo-${update.id}`, async () => {
      await window.programs.undoUpdate(selectedProject.id, update.id);
      await refreshProject(selectedProject.id);
    });
  };

  const handleGenerateOutlineReport = async (projectId: string) => {
    const input: GenerateProjectOutlineReportInput = { projectId };
    await withBusy(`outline.generate.${projectId}`, async () => {
      const report = await window.programs.generateOutlineReport(input);
      setOutlineReports((current) => ({ ...current, [projectId]: report }));
      pushToast("Program report generated.", "success");
    });
  };

  const handleSaveEnvFile = async (projectId: string, entries: EnvVariableEntry[]) => {
    await withBusy(`env.save.${projectId}`, async () => {
      const snapshot = await window.programs.writeEnvFile({ projectId, entries });
      setEnvSnapshots((current) => ({ ...current, [projectId]: snapshot }));
      pushToast("Environment file updated.", "success");
    });
  };

  const currentRuntimeUrl = selectedRuntime?.url ?? null;
  const lastKnownRuntimeUrl =
    selectedProject?.runtimeConfig.lastRunUrl ?? selectedProject?.runtimeConfig.openUrl ?? null;
  const isProjectRunning = Boolean(selectedRuntime?.running);
  const canStopProject = Boolean(selectedRuntime?.running);
  const canOpenProject = Boolean(currentRuntimeUrl || lastKnownRuntimeUrl);
  const showRunningState = isProjectRunning || busyKey === "project.run";
  const canConfirmPlan = activePlan?.status === "awaitingApproval";
  const showUpdateDock = Boolean(activePlan);
  const isSelectedProjectView = currentPage === "projects" && Boolean(selectedProject);
  const useComposerLayout = isSelectedProjectView || currentPage === "agents" || currentPage === "slack";
  const homeAppUpdateButton = getHomeAppUpdateButtonState(appUpdate);
  const currentPageDefinition = APP_PAGE_OPTIONS.find((page) => page.id === currentPage) ?? APP_PAGE_OPTIONS[1];
  const programsTopBarButton = !selectedProject
    ? homeAppUpdateButton === "prepare"
      ? (
        <button className="secondaryButton homeUpdateButton windowNoDrag" disabled>
          {busyKey === "app.update" || appUpdate.buildState === "installing" ? "Updating..." : "Preparing update..."}
        </button>
      )
      : homeAppUpdateButton === "install"
        ? (
          <button
            className="secondaryButton homeUpdateButton windowNoDrag"
            onClick={() => void handleInstallAppUpdate()}
            disabled={busyKey === "app.update"}
          >
            {busyKey === "app.update" ? "Updating..." : "Update App"}
          </button>
        )
        : homeAppUpdateButton === "issue"
          ? (
            <button className="secondaryButton homeUpdateButton windowNoDrag" onClick={openSettingsModal}>
              Update issue
            </button>
          )
          : null
    : null;
  const programsTopBar = programsTopBarButton ? (
    <div className="homeTopBar windowNoDrag">
      {programsTopBarButton}
    </div>
  ) : null;
  const programProjects = projects.filter((p) => projectCategories[p.id] === "program");
  const generalProjects = projects.filter((p) => projectCategories[p.id] === "general-project" || !projectCategories[p.id]);
  const ideaProjects = projects.filter((p) => projectCategories[p.id] === "idea-in-progress");

  const renderProjectTiles = (list: Project[]) =>
    list.map((project) => (
      <HomeProjectTile
        key={project.id}
        project={project}
        runtime={projectRuntimes[project.id] ?? null}
        isLaunching={Boolean(launchingProjects[project.id])}
        hasAssumedDetails={Boolean(projectAssumedFlags[project.id])}
        onOpen={() => setSelectedProjectId(project.id)}
        onQuickAction={() => void handleHomeTileQuickAction(project)}
        onOpenOptions={() => openProjectOptions(project.id)}
      />
    ));

  const programsPage = !selectedProject ? (
    <section className="minimalHome">
      {programProjects.length > 0 && (
        <div className="projectCategorySection">
          <h4 className="agentSectionLabel">Programs</h4>
          <div className="tileGrid">{renderProjectTiles(programProjects)}</div>
        </div>
      )}
      {generalProjects.length > 0 && (
        <div className="projectCategorySection">
          <h4 className="agentSectionLabel">General Projects</h4>
          <div className="tileGrid">{renderProjectTiles(generalProjects)}</div>
        </div>
      )}
      {ideaProjects.length > 0 && (
        <div className="projectCategorySection">
          <h4 className="agentSectionLabel">Ideas In-Progress</h4>
          <div className="tileGrid">{renderProjectTiles(ideaProjects)}</div>
        </div>
      )}
      {programProjects.length === 0 && generalProjects.length === 0 && ideaProjects.length === 0 && (
        <div className="projectCategorySection">
          <h4 className="agentSectionLabel">Projects</h4>
          <div className="tileGrid" />
        </div>
      )}
      <div className="tileGrid" style={{ paddingLeft: 20 }}>
        <button className="projectTile addProjectTile" onClick={openAddProjectChooser}>
          <PlusIcon />
        </button>
      </div>
    </section>
  ) : (
    <section className="projectLayout projectLayout-detail">
      <div className="projectTopBar windowNoDrag">
        <button className="textButton windowNoDrag" onClick={() => setSelectedProjectId(null)}>
          Back
        </button>
      </div>

      <div className={showUpdatePanel ? "projectDetailWorkspace updateOpen" : "projectDetailWorkspace"}>
        <div className="projectSummaryCard">
          <div className="summaryMain">
            <div className="summaryHeaderRow">
              <div className="summaryCopy">
                <h2>{selectedProject.name}</h2>
                <p className="summaryTimestamp">Last updated at {formatDate(selectedProject.lastUpdatedAt)}</p>
                <div className="summaryLinkRow">
                  <button
                    className="textButton planButtonWrapper summaryDetailButton"
                    onClick={() => setProgramDetailsProjectId(selectedProject.id)}
                  >
                    System Details
                    {pendingUpdates[selectedProject.id] ? <span className="notificationBadge" /> : null}
                  </button>
                  <button
                    className="textButton planButtonWrapper summaryDetailButton"
                    onClick={() => setCoreDetailsProjectId(selectedProject.id)}
                  >
                    Core Details
                  </button>
                </div>
                {selectedProject.lastError ? <div className="errorBanner">{selectedProject.lastError}</div> : null}
              </div>
              <div className="summaryActionRail">
                <button
                  className={
                    showRunningState
                      ? "actionButton actionButton-open summaryActionButton"
                      : "actionButton actionButton-run summaryActionButton"
                  }
                  onClick={showRunningState ? handleOpen : handleRun}
                  disabled={
                    showRunningState
                      ? !canOpenProject || busyKey === "project.open"
                      : busyKey === "project.run"
                  }
                >
                  {showRunningState ? "Open" : "Run"}
                </button>
                <button
                  className="actionButton actionButton-stop summaryActionButton"
                  onClick={handleKill}
                  disabled={!canStopProject || busyKey === "project.kill"}
                >
                  Stop
                </button>
              </div>
            </div>
          </div>
        </div>

        <ProgramModeSwitchRow
          programMode={programMode}
          onModeChange={setProgramMode}
          project={selectedProject}
          skills={skills}
          attachedSkillId={selectedProject.runtimeConfig.attachedSkillId ?? null}
          onAttachSkill={(skillId) => {
            void window.programs.attachSkillToProject({ projectId: selectedProject.id, skillId });
          }}
          onSync={() => {
            void (async () => {
              setBusyKey("git.sync");
              try {
                const result = await window.programs.syncProjectToGitHub({ projectId: selectedProject.id });
                if (result.error) {
                  pushToast(result.error, "error");
                } else if (result.committed || result.pushed) {
                  pushToast("Synced to GitHub.", "success");
                } else {
                  pushToast("Nothing to sync.", "info");
                }
              } catch (error) {
                pushToast(error instanceof Error ? error.message : "Sync failed.", "error");
              } finally {
                setBusyKey(null);
              }
            })();
          }}
          isSyncing={busyKey === "git.sync"}
          pushToast={pushToast}
        />

        {(programMode === "talk" || programMode === "plan") ? (
          <ProgramTodoList
            projectId={selectedProject.id}
            mode={programMode}
            settings={settings}
            pushToast={pushToast}
          />
        ) : null}

        {showUpdatePanel ? (
          <div
            ref={updateSectionRef}
            className={isUpdateDropTarget ? "updateSection dragActive" : "updateSection"}
            onDragEnter={handleUpdateSectionDragEnter}
            onDragOver={handleUpdateSectionDragOver}
            onDragLeave={handleUpdateSectionDragLeave}
            onDrop={(event) => void handleUpdateSectionDrop(event)}
          >
            <div className={showUpdateDock ? "updateCard updateCard-withDock" : "updateCard"}>
              <div className="updateCardSpacer" />

              <div className="updateFooterStack">
                {programMode === "work" && showUpdateDock ? (
                  <UpdateStagePanel
                    plan={activePlan}
                    canConfirmPlan={canConfirmPlan}
                    confirmBusy={busyKey === "plan.approve"}
                    onConfirm={handleConfirmUpdate}
                  />
                ) : null}

                {planError ? (
                  <div className="planErrorBanner">
                    <span className="planErrorBanner-message">{planError}</span>
                    <button className="planErrorBanner-dismiss" onClick={() => setPlanError(null)}>
                      Dismiss
                    </button>
                  </div>
                ) : null}

                <div className="composerShell">
                  {composerOptions.contextPaths.length ? (
                    <div className="composerAttachmentRow">
                      <div className="chipList">
                        {composerOptions.contextPaths.map((path) => (
                          <button
                            key={path}
                            className="pathChip"
                            onClick={() =>
                              setComposerOptions((current) => ({
                                ...current,
                                contextPaths: current.contextPaths.filter((item) => item !== path),
                              }))
                            }
                          >
                            {path}
                            <span aria-hidden="true">×</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <textarea
                    ref={composerInputRef}
                    value={composerValue}
                    onChange={(event) => setComposerValue(event.target.value)}
                    className="composerInput"
                    placeholder={
                      programMode === "talk"
                        ? "Chat about your project or add to-do items..."
                        : activePlan?.status === "awaitingApproval"
                          ? `Ask ${providerLabel(composerOptions.provider)} to revise the current plan.`
                          : "Describe the next change."
                    }
                  />

                  <ComposerControlBar
                    options={composerOptions}
                    modelCatalog={modelCatalog}
                    addFilesBusy={busyKey === "context.pick"}
                    sendBusy={busyKey === "plan.send"}
                    isRunning={Boolean(activePlan && activePlan.status !== "completed" && activePlan.status !== "failed" && activePlan.status !== "awaitingApproval")}
                    onCodexModelChange={(model) =>
                      setComposerOptions((current) => ({
                        ...current,
                        provider: "codex",
                        model,
                        speed: "normal",
                        reasoningEffort: "xhigh",
                      }))
                    }
                    onClaudeModelChange={(claudeModel) =>
                      setComposerOptions((current) => ({
                        ...current,
                        provider: "claude",
                        claudeModel,
                      }))
                    }
                    onReasoningChange={(reasoningEffort) =>
                      setComposerOptions((current) => ({ ...current, reasoningEffort }))
                    }
                    onSpeedChange={(speed) => setComposerOptions((current) => ({ ...current, speed }))}
                    onPlanningModeChange={(planningMode) =>
                      setComposerOptions((current) => ({ ...current, planningMode }))
                    }
                    onAddFiles={() => void handlePickContextPaths()}
                    onSubmit={handlePlanAction}
                    onStop={handleCancelPlan}
                    submitLabel={programMode === "talk" ? "Send" : activePlan?.status === "awaitingApproval" ? "Revise update" : "Send update"}
                  />
                </div>
              </div>

              {isUpdateDropTarget ? (
                <div className="updateDropOverlay" aria-hidden="true">
                  <span>Drop files anywhere in this area to attach them</span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );

  if (!isBootstrapped) {
    return (
      <div className="appShell">
        <div className="loadingGate">
          <div className="sectionTag">Starting PROGRAMS</div>
          <h1>{startupIssue ? "PROGRAMS could not start" : "Checking your workspace"}</h1>
          <p>{startupIssue ?? "PROGRAMS is loading your setup, projects, and local workspace."}</p>
        </div>
      </div>
    );
  }

  if (startupIssue && projects.length === 0 && !selectedProject) {
    return (
      <div className="appShell">
        <div className="loadingGate">
          <div className="sectionTag">PROGRAMS</div>
          <h1>Startup issue</h1>
          <p>{startupIssue}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={showSidebar ? "appShell appShellWithSidebar sidebarOpen" : "appShell appShellWithSidebar"}>
      <div className={showSidebar ? "shellFrame sidebarOpen" : "shellFrame"}>
        <div className="windowDragStrip" aria-hidden="true" />
        <div className="shellTopBar windowNoDrag">
          <button
            type="button"
            className={showSidebar ? "sidebarToggleButton active windowNoDrag" : "sidebarToggleButton windowNoDrag"}
            onClick={() => setShowSidebar((current) => !current)}
            aria-label={showSidebar ? "Hide sidebar" : "Show sidebar"}
            aria-expanded={showSidebar}
          >
            <SidebarToggleIcon />
          </button>
        </div>
        {programsTopBar}

        <aside className="shellSidebar" aria-label="App navigation">
          <nav className="shellSidebarNav">
            {APP_PAGE_OPTIONS.map((page) => (
              <button
                key={page.id}
                type="button"
                className={currentPage === page.id ? "sidebarNavButton active" : "sidebarNavButton"}
                onClick={() => setCurrentPage(page.id)}
              >
                {page.label}
              </button>
            ))}
          </nav>
          <div className="shellSidebarDivider" aria-hidden="true" />
          <div className="shellSidebarFooter">
            <button
              type="button"
              className={showSettings ? "sidebarFooterButton active windowNoDrag" : "sidebarFooterButton windowNoDrag"}
              onClick={openSettingsModal}
              aria-label="Open settings"
            >
              <SettingsIcon />
              <span>Settings</span>
            </button>
            <button
              type="button"
              className={
                showUsageSheet
                  ? "sidebarFooterButton sidebarFooterButton-usage active windowNoDrag"
                  : "sidebarFooterButton sidebarFooterButton-usage windowNoDrag"
              }
              onClick={toggleUsageSheet}
              aria-label="Open usage overview"
            >
              <TimerIcon />
              <span>Usage</span>
            </button>
          </div>
        </aside>

        <main className={`shellContent${useComposerLayout ? " shellContent-composerLayout shellContent-detailLocked" : ""}`}>
          {currentPage === "homepage" ? (
            <HomepageScratchpad projects={projects} />
          ) : currentPage === "slack" ? (
            <SlackPage
              projects={projects}
              settings={settings}
              slackSelectedProjectId={slackSelectedProjectId}
              slackAgentSession={slackAgentSession}
              modelCatalog={modelCatalog}
              onSelectProject={async (projectId) => {
                setSlackSelectedProjectId(projectId);
                setSlackAgentSession(null);
                if (projectId) {
                  const session = await window.programs.getAgentSession(projectId);
                  setSlackAgentSession(session ?? null);
                }
              }}
              onSessionUpdate={(s) => setSlackAgentSession(s)}
              pushToast={pushToast}
            />
          ) : currentPage === "agents" ? (
            <AgentsPage
              projects={projects}
              settings={settings}
              agentSession={agentSession}
              agentSelectedProjectId={agentSelectedProjectId}
              agentViewStage={agentViewStage}
              modelCatalog={modelCatalog}
              onSelectProject={async (projectId) => {
                setAgentSelectedProjectId(projectId);
                setAgentSession(null);
                setAgentViewStage("function");
                if (projectId) {
                  const session = await window.programs.getAgentSession(projectId);
                  setAgentSession(session);
                  if (session) setAgentViewStage(session.currentStage);
                }
              }}
              onSetViewStage={setAgentViewStage}
              onSessionUpdate={(session) => {
                setAgentSession(session);
              }}
              pushToast={pushToast}
            />
          ) : currentPage === "skills" ? (
            <SkillsPage skills={skills} onSkillsChange={setSkills} pushToast={pushToast} />
          ) : currentPage === "projects" ? (
            programsPage
          ) : (
            <PlaceholderWorkspace page={currentPageDefinition} onReturn={() => setCurrentPage("projects")} />
          )}
        </main>
      </div>

      {showAddProjectChooser ? (
        <Modal title="Add Project" onClose={() => setShowAddProjectChooser(false)}>
          <div className="choiceGrid">
            <button className="choiceCard" onClick={() => openAddProject("create")}>
              <strong>New Project</strong>
            </button>
            <button className="choiceCard" onClick={() => openAddProject("attach")}>
              <strong>Attach Existing</strong>
            </button>
          </div>
        </Modal>
      ) : null}

      {showAddProject ? (
        <Modal
          title={addProjectState.mode === "attach" ? "Attach Existing Project" : "New Project"}
          onClose={() => resetAddProjectFlow(addProjectState.mode)}
        >
          {addProjectState.mode === "create" ? (
            <div className="formGrid">
              <label>
                Project name
                <input
                  value={addProjectState.createName}
                  onChange={(event) =>
                    setAddProjectState((current) => ({ ...current, createName: event.target.value }))
                  }
                />
              </label>
              <label>
                Location
                <div className="fieldWithAction">
                  <input value={addProjectState.parentDirectory} readOnly placeholder="Choose a parent folder" />
                  <button className="secondaryButton" onClick={() => void handleBrowse("parentDirectory")}>
                    Choose
                  </button>
                </div>
              </label>
              <label className="spanTwo">
                Initial idea
                <textarea
                  rows={4}
                  value={addProjectState.initialIdea}
                  onChange={(event) =>
                    setAddProjectState((current) => ({ ...current, initialIdea: event.target.value }))
                  }
                  placeholder="Optional. Give Codex some starting context for this project."
                />
              </label>
            </div>
          ) : (
            <div className="modalSection">
              {!addProjectState.attachDirectory ? (
                <div className="pickerCard">
                  <div>
                    <strong>Choose the folder you already use.</strong>
                  </div>
                  <button className="primaryButton" onClick={() => void handleBrowse("attachDirectory")}>
                    Choose folder
                  </button>
                </div>
              ) : (
                <>
                  <div className="selectedPathRow">
                    <div className="selectedPathCopy">
                      <span className="fieldLabel">Selected folder</span>
                      <code>{addProjectState.attachDirectory}</code>
                    </div>
                    <button className="secondaryButton smallButton" onClick={() => void handleBrowse("attachDirectory")}>
                      Change
                    </button>
                  </div>

                  {attachInspection ? (
                    <div className="compactMetaGrid">
                      <div className="compactMetaCard">
                        <span className="fieldLabel">Project</span>
                        <strong>{attachInspection.name || "Unknown folder"}</strong>
                      </div>
                      <div className="compactMetaCard">
                        <span className="fieldLabel">Repository</span>
                        <strong>{attachInspection.isRepo ? "Git repo found" : "No Git repo yet"}</strong>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}

          {projectFormError ? <div className="errorBanner">{projectFormError}</div> : null}

          <div className="modalActions">
            <button className="secondaryButton" onClick={() => resetAddProjectFlow(addProjectState.mode)}>
              Cancel
            </button>
            <button
              className="primaryButton"
              onClick={() => void handleCreateOrAttach()}
              disabled={busyKey === "project.submit"}
            >
              {addProjectState.mode === "attach" ? "Attach project" : "Create project"}
            </button>
          </div>
        </Modal>
      ) : null}

      {projectOptionsProject ? (
        <ProjectOptionsSheet
          project={projectOptionsProject}
          onClose={() => setProjectOptionsProjectId(null)}
          onSave={(name, iconColor) => handleSaveProjectDirect(projectOptionsProject.id, name, iconColor)}
          onUnlink={() => {
            setProjectOptionsProjectId(null);
            setUnlinkProjectId(projectOptionsProject.id);
          }}
        />
      ) : null}

      {unlinkProjectId && unlinkProject ? (
        <Modal title="Unlink Project" onClose={() => setUnlinkProjectId(null)}>
          <div className="projectEditorStack">
            <p className="modalLead">
              Remove <strong>{unlinkProject.name}</strong> from the dashboard. The project folder and its files stay on disk.
            </p>
            <div className="dangerCard">
              <strong>This only removes the workspace from PROGRAMS.</strong>
              <p>You can attach it again later from its existing folder.</p>
            </div>
            <div className="modalActions">
              <button className="secondaryButton" onClick={() => setUnlinkProjectId(null)}>
                Cancel
              </button>
              <button className="secondaryButton dangerButton" onClick={() => void handleUnlinkProject()} disabled={busyKey === "project.unlink"}>
                Unlink project
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {showSettings ? (
        <SettingsModal
          settings={settings}
          modelCatalog={modelCatalog}
          auth={auth}
          setup={setup}
          appUpdate={appUpdate}
          isPackagedBuild={setup.isPackagedBuild}
          busyKey={busyKey}
          theme={theme}
          onPreviewTheme={setTheme}
          onBrowseAppSourcePath={() => handleBrowseAppSourcePath()}
          onClose={handleCloseSettings}
          onSave={(next) => void handleSaveSettings(next)}
          onConnectCodex={() => void handleConnectCodex()}
          onConnectClaude={() => void handleConnectClaude()}
          onConnectGitHub={() => void handleConnectGitHub()}
          onDisconnectCodex={() => void handleDisconnectCodex()}
          onDisconnectClaude={() => void handleDisconnectClaude()}
          onDisconnectGitHub={() => void handleDisconnectGitHub()}
          onReconnectCodex={() => void handleReconnectCodex()}
          onReconnectClaude={() => void handleReconnectClaude()}
          onReconnectGitHub={() => void handleReconnectGitHub()}
          onTestClaude={() => void handleTestClaude()}
          onSetupCodex={() => void handleSetupCodex()}
          onSetupClaude={() => void handleSetupClaude()}
          onSetupAction={(check) => void withBusy(`setup-${check.id}`, async () => handleSetupAction(check))}
          claudeAuthCodePrompt={claudeAuthCodePrompt}
          claudeAuthCodeInput={claudeAuthCodeInput}
          onClaudeAuthCodeChange={setClaudeAuthCodeInput}
          onSubmitClaudeAuthCode={() => {
            void window.programs.submitClaudeLoginCode(claudeAuthCodeInput.trim());
            setClaudeAuthCodePrompt(null);
            setClaudeAuthCodeInput("");
          }}
          onCancelClaudeAuthCode={() => { setClaudeAuthCodePrompt(null); setClaudeAuthCodeInput(""); }}
        />
      ) : null}

      {showUsageSheet ? (
        <UsageOverviewSheet
          auth={auth}
          usage={usage}
          onClose={() => setShowUsageSheet(false)}
          onOpenSettings={() => {
            setShowUsageSheet(false);
            setShowSettings(true);
          }}
        />
      ) : null}

      {programDetailsProjectId && programDetailsProject ? (
        <ProgramDetailsModal
          project={programDetailsProject}
          updates={projectDetails[programDetailsProjectId]?.updates ?? []}
          currentFlowchart={projectDetails[programDetailsProjectId]?.flowchart ?? createFallbackPlan(programDetailsProject)}
          currentFlowchartGraph={projectDetails[programDetailsProjectId]?.flowchartGraph ?? null}
          pendingUpdate={pendingUpdates[programDetailsProjectId] ?? null}
          agentSession={programAgentSession}
          busyKey={busyKey}
          theme={theme}
          settings={settings}
          onClose={() => setProgramDetailsProjectId(null)}
          onGenerateFlowchart={async (provider: AiProvider) => {
            await withBusy("generate-flowchart", async () => {
              const result = await window.programs.generateFlowchart({
                projectId: programDetailsProjectId,
                provider,
                model: composerOptions.model,
                claudeModel: composerOptions.claudeModel,
              });
              setProjectDetails((current) =>
                current[programDetailsProjectId]
                  ? {
                      ...current,
                      [programDetailsProjectId]: {
                        ...current[programDetailsProjectId],
                        flowchart: result.flowchart,
                        flowchartGraph: result.flowchartGraph,
                      },
                    }
                  : current,
              );
            });
          }}
          onApplyPendingUpdate={async () => {
            await withBusy("apply-pending", async () => {
              await window.programs.applyPlannedUpdate(programDetailsProjectId);
              setProgramDetailsProjectId(null);
            });
          }}
          onUndo={(update) => void handleUndoUpdate(update)}
        />
      ) : null}

      {coreDetailsProjectId ? (
        <CoreDetailsPanel
          projectId={coreDetailsProjectId}
          settings={settings}
          agentSession={programAgentSession}
          onClose={() => setCoreDetailsProjectId(null)}
          pushToast={pushToast}
        />
      ) : null}

      {storedDataProjectId && storedDataProject ? (
        <StoredDataModal
          project={storedDataProject}
          report={outlineReports[storedDataProjectId]}
          busy={busyKey === `outline.generate.${storedDataProjectId}`}
          onClose={() => setStoredDataProjectId(null)}
          onGenerateReport={() => void handleGenerateOutlineReport(storedDataProjectId)}
        />
      ) : null}

      {connectionsProjectId && connectionsProject ? (
        <ConnectionsModal
          project={connectionsProject}
          report={outlineReports[connectionsProjectId]}
          envSnapshot={envSnapshots[connectionsProjectId]}
          reportBusy={busyKey === `outline.generate.${connectionsProjectId}`}
          envBusy={busyKey === `env.save.${connectionsProjectId}`}
          onClose={() => setConnectionsProjectId(null)}
          onGenerateReport={() => void handleGenerateOutlineReport(connectionsProjectId)}
          onSaveEnv={(entries) => handleSaveEnvFile(connectionsProjectId, entries)}
        />
      ) : null}

      {runtimeProjectId && runtimeProject ? (
        <RuntimeModal
          project={runtimeProject}
          runtime={projectRuntimes[runtimeProjectId] ?? projectDetails[runtimeProjectId]?.runtime ?? null}
          onClose={() => setRuntimeProjectId(null)}
        />
      ) : null}

      {setupConfirmCheck?.actionKind === "installGit" ? (
        <Modal title="Install Git" onClose={() => setSetupConfirmCheck(null)}>
          <p className="modalLead">PROGRAMS will ask macOS to install Git. You may see one system prompt.</p>
          <details className="inlineDetails">
            <summary>More detail</summary>
            <p>
              If macOS cannot start the installer automatically, PROGRAMS will open the official Git download page instead.
            </p>
          </details>
          <div className="modalActions">
            <button className="secondaryButton" onClick={() => setSetupConfirmCheck(null)}>
              Cancel
            </button>
            <button
              className="primaryButton"
              disabled={busyKey === `setup-confirm-${setupConfirmCheck.id}`}
              onClick={() =>
                void withBusy(`setup-confirm-${setupConfirmCheck.id}`, async () => {
                  await window.programs.installGit();
                  setSetupConfirmCheck(null);
                  await refreshSetup();
                })
              }
            >
              Install
            </button>
          </div>
        </Modal>
      ) : null}

      <ToastHost toasts={toasts} />
    </div>
  );
}

type ComposerMenuKey = "model" | "speed" | "thinking" | "plan";

function ComposerControlBar({
  options,
  modelCatalog,
  addFilesBusy,
  sendBusy,
  isRunning,
  hidePlanningMenu,
  hideSpeedMenu,
  onCodexModelChange,
  onClaudeModelChange,
  onReasoningChange,
  onSpeedChange,
  onPlanningModeChange,
  onAddFiles,
  onSubmit,
  onStop,
  submitLabel,
}: {
  options: ComposerOptions;
  modelCatalog: ModelCatalog;
  addFilesBusy: boolean;
  sendBusy: boolean;
  isRunning: boolean;
  hidePlanningMenu?: boolean;
  hideSpeedMenu?: boolean;
  onCodexModelChange: (model: CodexModel) => void;
  onClaudeModelChange: (model: ClaudeModel) => void;
  onReasoningChange: (reasoningEffort: ComposerOptions["reasoningEffort"]) => void;
  onSpeedChange: (speed: SpeedMode) => void;
  onPlanningModeChange: (planningMode: PlanningMode) => void;
  onAddFiles: () => void;
  onSubmit: () => void;
  onStop: () => void;
  submitLabel: string;
}) {
  const [openMenu, setOpenMenu] = useState<ComposerMenuKey | null>(null);
  const closeMenus = () => setOpenMenu(null);
  const codexModelOptions = useMemo(() => {
    if (modelCatalog.codex.some((option) => option.id === options.model)) {
      return modelCatalog.codex;
    }

    return [
      {
        id: options.model,
        label: labelForModel(options.model, modelCatalog.codex, fallbackCodexModelLabel),
        detail: null,
      },
      ...modelCatalog.codex,
    ];
  }, [modelCatalog.codex, options.model]);
  const claudeModelOptions = useMemo(() => {
    if (modelCatalog.claude.some((option) => option.id === options.claudeModel)) {
      return modelCatalog.claude;
    }

    return [
      {
        id: options.claudeModel,
        label: labelForModel(options.claudeModel, modelCatalog.claude, fallbackClaudeModelLabel),
        detail: null,
      },
      ...modelCatalog.claude,
    ];
  }, [modelCatalog.claude, options.claudeModel]);

  return (
    <div className="composerControlRow">
      <div className="composerControlCluster">
        <button
          className="secondaryButton composerIconButton"
          onClick={() => {
            closeMenus();
            onAddFiles();
          }}
          disabled={addFilesBusy}
          aria-label="Add files"
        >
          <PlusIcon />
        </button>

        <ComposerMenu
          label={labelForComposerModel(options, modelCatalog)}
          open={openMenu === "model"}
          onToggle={() => setOpenMenu((current) => (current === "model" ? null : "model"))}
          onClose={closeMenus}
        >
            <div className="composerMenuSection">
            <span className="composerMenuSectionTitle">GPT models</span>
            {codexModelOptions.map((model) => (
              <ComposerMenuOption
                key={model.id}
                label={model.label}
                detail={model.detail ?? undefined}
                active={options.provider === "codex" && options.model === model.id}
                onClick={() => {
                  onCodexModelChange(model.id);
                  closeMenus();
                }}
              />
            ))}
          </div>

          <div className="composerMenuSection">
            <span className="composerMenuSectionTitle">Claude models</span>
            {claudeModelOptions.map((model) => (
              <ComposerMenuOption
                key={model.id}
                label={model.label}
                detail={model.detail ?? undefined}
                active={options.provider === "claude" && options.claudeModel === model.id}
                onClick={() => {
                  onClaudeModelChange(model.id);
                  closeMenus();
                }}
              />
            ))}
          </div>
        </ComposerMenu>

        {!hideSpeedMenu && options.provider === "codex" ? (
          <ComposerMenu
            label={`Speed: ${options.speed === "fast" ? "Fast" : "Normal"}`}
            open={openMenu === "speed"}
            onToggle={() => setOpenMenu((current) => (current === "speed" ? null : "speed"))}
            onClose={closeMenus}
          >
            <div className="composerMenuSection">
              <span className="composerMenuSectionTitle">Speed</span>
              <ComposerMenuOption
                label="Normal"
                active={options.speed === "normal"}
                onClick={() => {
                  onSpeedChange("normal");
                  closeMenus();
                }}
              />
              <ComposerMenuOption
                label="Fast"
                active={options.speed === "fast"}
                onClick={() => {
                  onSpeedChange("fast");
                  closeMenus();
                }}
              />
            </div>
          </ComposerMenu>
        ) : null}

        <ComposerMenu
          label={`Thinking: ${labelForReasoningEffort(options.reasoningEffort)}`}
          open={openMenu === "thinking"}
          onToggle={() => setOpenMenu((current) => (current === "thinking" ? null : "thinking"))}
          onClose={closeMenus}
        >
          <div className="composerMenuSection">
            <span className="composerMenuSectionTitle">Thinking depth</span>
            <ComposerMenuOption
              label="Low"
              active={options.reasoningEffort === "low"}
              onClick={() => {
                onReasoningChange("low");
                closeMenus();
              }}
            />
            <ComposerMenuOption
              label="Normal"
              active={options.reasoningEffort === "medium"}
              onClick={() => {
                onReasoningChange("medium");
                closeMenus();
              }}
            />
            <ComposerMenuOption
              label="High"
              active={options.reasoningEffort === "high"}
              onClick={() => {
                onReasoningChange("high");
                closeMenus();
              }}
            />
            <ComposerMenuOption
              label="Extra high"
              active={options.reasoningEffort === "xhigh"}
              onClick={() => {
                onReasoningChange("xhigh");
                closeMenus();
              }}
            />
          </div>
        </ComposerMenu>

        {!hidePlanningMenu && (
          <ComposerMenu
            label={`Planning: ${labelForPlanningMode(options.planningMode)}`}
            open={openMenu === "plan"}
            onToggle={() => setOpenMenu((current) => (current === "plan" ? null : "plan"))}
            onClose={closeMenus}
            align="end"
          >
            <div className="composerMenuSection">
              <span className="composerMenuSectionTitle">Planning mode</span>
              <ComposerMenuOption
                label="Review plan"
                detail="Pause after the draft so you can confirm it."
                active={options.planningMode === "review"}
                onClick={() => {
                  onPlanningModeChange("review");
                  closeMenus();
                }}
              />
              <ComposerMenuOption
                label="Auto-accept plan"
                detail="Apply the update as soon as the plan is ready."
                active={options.planningMode === "auto"}
                onClick={() => {
                  onPlanningModeChange("auto");
                  closeMenus();
                }}
              />
              <ComposerMenuOption
                label="No plan"
                detail="Skip drafting and start building immediately."
                active={options.planningMode === "none"}
                onClick={() => {
                  onPlanningModeChange("none");
                  closeMenus();
                }}
              />
            </div>
            <p className="composerMenuNote">
              Review pauses for approval, Auto applies the draft immediately, and No Plan skips the draft entirely.
            </p>
          </ComposerMenu>
        )}
      </div>

      {isRunning ? (
        <button
          className="composerSubmitButton composerStopButton"
          onClick={() => {
            closeMenus();
            onStop();
          }}
          aria-label="Stop update"
          title="Stop update"
        >
          <StopIcon />
        </button>
      ) : (
        <button
          className="primaryButton composerSubmitButton"
          onClick={() => {
            closeMenus();
            onSubmit();
          }}
          disabled={sendBusy}
          aria-label={submitLabel}
          title={submitLabel}
        >
          <ArrowUpIcon />
        </button>
      )}
    </div>
  );
}

function ComposerMenu({
  label,
  open,
  onToggle,
  onClose,
  align = "start",
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [placement, setPlacement] = useState<"above" | "below">("above");
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const updatePanelPosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const spaceAbove = rect.top - 20;
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      const nextPlacement = spaceAbove >= 260 || spaceAbove >= spaceBelow ? "above" : "below";
      const availableSpace = nextPlacement === "above" ? spaceAbove : spaceBelow;
      setPlacement(nextPlacement);
      setMaxHeight(Math.min(420, Math.max(0, Math.floor(availableSpace))));
    };

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    updatePanelPosition();
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, onClose]);

  return (
    <div ref={menuRef} className="composerMenu">
      <button
        type="button"
        ref={triggerRef}
        className={open ? "composerMenuTrigger active" : "composerMenuTrigger"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>{label}</span>
        <ChevronDownIcon />
      </button>
      {open ? (
        <div
          className={`composerMenuPanel composerMenuPanel-${placement} composerMenuPanel-${align}`}
          style={maxHeight !== undefined ? { maxHeight } : undefined}
          role="menu"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function ComposerMenuOption({
  label,
  detail,
  active,
  onClick,
}: {
  label: string;
  detail?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "composerMenuItem active" : "composerMenuItem"}
      onClick={onClick}
    >
      <span className="composerMenuItemCopy">
        <strong>{label}</strong>
        {detail ? <span>{detail}</span> : null}
      </span>
      <span className="composerMenuItemCheck" aria-hidden="true">
        {active ? <CheckIcon /> : null}
      </span>
    </button>
  );
}

function HomeProjectTile({
  project,
  runtime,
  isLaunching,
  hasAssumedDetails,
  onOpen,
  onQuickAction,
  onOpenOptions,
}: {
  project: Project;
  runtime: RuntimeState | null;
  isLaunching: boolean;
  hasAssumedDetails?: boolean;
  onOpen: () => void;
  onQuickAction: () => void;
  onOpenOptions: () => void;
}) {
  const dotState = getHomeTileDotState(project, runtime, isLaunching);
  const isRunning = Boolean(runtime?.running);
  const canStopFromDot = isRunning && !isLaunching;
  const quickActionLabel =
    isLaunching
      ? `Launching ${project.name}`
      : isRunning
      ? runtime?.source === "self"
        ? `Quit ${project.name}`
        : `Stop ${project.name}`
      : `Run and open ${project.name}`;

  return (
    <article className="projectTile projectTileGradient" style={createProjectTileStyle(project.iconColor)}>
      <button className="projectTileOpenArea" onClick={onOpen} aria-label={`Open ${project.name}`} />
      <div className="projectTileChrome">
        <div className="projectTileTopRow">
          <div className="projectTileMenu">
            <button
              type="button"
              className="projectTileMenuToggle"
              aria-label={`Project options for ${project.name}`}
              onClick={onOpenOptions}
            >
              <MoreIcon />
            </button>
          </div>
        </div>

        <div className="projectTileBottomRow">
          <div className="tileName">
            {project.name}
            {hasAssumedDetails && <span className="tileAssumedBadge" title="Core details need review" />}
          </div>
          <button
            type="button"
            className={`projectStatusDot projectStatusDot-${dotState}${canStopFromDot ? " projectStatusDot-stopAction" : ""}`}
            aria-label={quickActionLabel}
            title={quickActionLabel}
            onClick={onQuickAction}
          />
        </div>
      </div>
    </article>
  );
}

function PlaceholderWorkspace({
  page,
  onReturn,
}: {
  page: { label: string };
  onReturn: () => void;
}) {
  return (
    <section className="placeholderWorkspace">
      <div className="placeholderWorkspaceIntro">
        <h1>{page.label}</h1>
      </div>

      <div className="placeholderWorkspaceCard">
        <div className="placeholderPanel">
          <h4>{page.label}</h4>
        </div>

        <button className="primaryButton placeholderReturnButton" onClick={onReturn}>
          Open Programs
        </button>
      </div>
    </section>
  );
}

function HomepageScratchpad({ projects }: { projects: Project[] }) {
  const [todos, setTodos] = useState<UnifiedTodoItem[]>([]);
  const [newText, setNewText] = useState("");
  const [newProjectId, setNewProjectId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadTodos = () => {
    void window.programs.listTodos({ includeProcessed: false }).then((data) => {
      setTodos(data);
      setLoaded(true);
    });
  };

  useEffect(() => {
    loadTodos();
  }, []);

  // Listen for todo updates from other views
  useEffect(() => {
    const handler = (event: AppEvent) => {
      if (event.type === "app.event" && event.event === "todos.updated") {
        loadTodos();
      }
    };
    const unsubscribe = window.programs.onEvent(handler);
    return unsubscribe;
  }, []);

  const handleAdd = () => {
    if (!newText.trim()) return;
    void window.programs.addTodo({ text: newText.trim(), projectId: newProjectId, source: "user" }).then(() => {
      setNewText("");
      loadTodos();
    });
  };

  const handleRemove = (id: string) => {
    void window.programs.removeTodo(id).then(loadTodos);
  };

  if (!loaded) return null;

  return (
    <section className="homepageScratchpad">
      <h2 className="homeScratchpadTitle">To-do</h2>

      <div className="homeScratchpadInputRow">
        <input
          type="text"
          className="homeScratchpadTextInput"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Add a to-do..."
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <select
          className="homeScratchpadProjectSelect"
          value={newProjectId ?? ""}
          onChange={(e) => setNewProjectId(e.target.value || null)}
        >
          <option value="">Unassigned</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button className="primaryButton" onClick={handleAdd} disabled={!newText.trim()}>
          Add
        </button>
      </div>

      <div className="homeScratchpadGroups">
        {todos.map((item) => (
          <div key={item.id} className="unifiedTodoItem unifiedTodoItem--user">
            <span className="unifiedTodoBullet">&bull;</span>
            <span className="unifiedTodoText">{item.text}</span>
            <button className="deleteBtn" onClick={() => handleRemove(item.id)}>&times;</button>
          </div>
        ))}
        {todos.length === 0 ? (
          <p className="homeScratchpadEmpty">No to-do items yet. Add bullet points above.</p>
        ) : null}
      </div>
    </section>
  );
}

function ProjectOptionsSheet({
  project,
  onClose,
  onSave,
  onUnlink,
}: {
  project: Project;
  onClose: () => void;
  onSave: (name: string, iconColor: string) => Promise<void>;
  onUnlink: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [iconColor, setIconColor] = useState(project.iconColor);
  const [agentSession, setAgentSession] = useState<AgentSession | null>(null);
  const [activeTab, setActiveTab] = useState<"function" | "thesis">("function");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void window.programs.getAgentSession(project.id).then(setAgentSession);
  }, [project.id]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(name, iconColor);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <BottomSheet title={project.name} onClose={onClose}>
      <div className="projectOptionsContent">
        <div className="projectOptionsSection">
          <div className="agentInfoTabs">
            <button
              className={`agentInfoTabBtn${activeTab === "function" ? " active" : ""}`}
              onClick={() => setActiveTab("function")}
            >
              Function
            </button>
            <button
              className={`agentInfoTabBtn${activeTab === "thesis" ? " active" : ""}`}
              onClick={() => setActiveTab("thesis")}
            >
              Thesis
            </button>
          </div>
          <div className="agentInfoTabContent">
            {activeTab === "function" ? (
              <p className="coreDetailValue">
                {agentSession?.stages.function.confirmed?.summary ?? <em className="coreDetailEmpty">Not yet defined</em>}
              </p>
            ) : (
              <p className="coreDetailValue">
                {agentSession?.stages.thesis.confirmed?.summary ?? <em className="coreDetailEmpty">Not yet defined</em>}
              </p>
            )}
          </div>
        </div>

        <div className="projectOptionsSection">
          <label className="projectOptionsLabel">
            Name
            <input
              className="projectOptionsNameInput"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>

        <div className="projectOptionsSection">
          <span className="projectOptionsLabel">Color</span>
          <div className="colorSwatchGrid">
            {DEFAULT_ICON_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={iconColor === color ? "colorSwatch active" : "colorSwatch"}
                style={{ background: color }}
                aria-label={`Set project color ${color}`}
                onClick={() => setIconColor(color)}
              />
            ))}
          </div>
          <label className="colorField">
            Custom color
            <input
              type="color"
              value={iconColor}
              onChange={(e) => setIconColor(e.target.value)}
            />
          </label>
        </div>

        <div className="projectOptionsActions">
          <button className="primaryButton" onClick={() => void handleSave()} disabled={isSaving}>
            Save
          </button>
          <button className="projectOptionButton projectOptionButton-danger" onClick={onUnlink}>
            Unlink project
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

function UsageOverviewSheet({
  auth,
  usage,
  onClose,
  onOpenSettings,
}: {
  auth: AuthSnapshot;
  usage: UsageSnapshot;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  type UsageCard = {
    key: "codex" | "claude";
    name: string;
    subtitle: string;
    badge: string;
    windows: ProviderUsage["windows"];
    note: string | null;
  };

  const cards: UsageCard[] = [];
  const codexNote =
    auth.codex.loggedIn && usage.codex.status !== "ready" && !usage.codex.note
      ? "Loading live usage..."
      : usage.codex.note;
  if (usage.codex.status === "ready" || (auth.codex.loggedIn && codexNote)) {
    cards.push({
      key: "codex",
      name: "Codex",
      subtitle: formatUsageSubtitle(auth.codex.email, auth.codex.planType ?? "Signed in"),
      badge: usage.codex.status === "ready" ? "Live" : "Status",
      windows: usage.codex.windows,
      note: codexNote,
    });
  }
  const claudeNote =
    auth.claude.loggedIn && usage.claude.status !== "ready" && !usage.claude.note
      ? "Loading Claude usage..."
      : usage.claude.note;
  if (usage.claude.status === "ready" || auth.claude.loggedIn || claudeNote) {
    const claudeUsesLocalMetrics = usage.claude.windows.some((window) => window.usedPercent === null);
    cards.push({
      key: "claude",
      name: "Claude",
      subtitle: auth.claude.loggedIn ? formatUsageSubtitle(auth.claude.email, auth.claude.planType ?? "Signed in") : "Activity history",
      badge: usage.claude.status === "ready" ? (claudeUsesLocalMetrics ? "Activity" : "Live") : "Status",
      windows: usage.claude.windows,
      note: claudeNote,
    });
  }

  return (
    <Modal title="Usage" onClose={onClose} fullscreen>
      {cards.length ? (
        <div className="usageCardGrid">
          {cards.map((card) => (
            <article key={card.key} className={`usageCard usageCard-${card.key}`}>
              <div className="usageCardHead">
                <div>
                  <h4>{card.name}</h4>
                  <p>{card.subtitle}</p>
                </div>
                <span className="usagePreviewLabel">{card.badge}</span>
              </div>
              {card.windows.length ? (
                <div className="usageMetricList">
                  {(() => {
                    const weeklyFull = card.windows.some(
                      (w) => typeof w.usedPercent === "number" && w.usedPercent >= 100 && (w.windowDurationMins ?? 0) >= 10080,
                    );
                    return card.windows.map((win) => {
                      const isShortWindow = (win.windowDurationMins ?? Infinity) < 10080;
                      return (
                        <UsageMetricBar
                          key={`${card.key}-${win.label}`}
                          window={win}
                          dimmed={weeklyFull && isShortWindow}
                        />
                      );
                    });
                  })()}
                </div>
              ) : null}
              {card.note ? <p className="usageNote">{card.note}</p> : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="usageEmptyState">
          <h4>No usage data yet</h4>
          <p>Connect Codex or Claude in Settings to load live usage and connection status here.</p>
          <button className="secondaryButton" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      )}
    </Modal>
  );
}

function UsageMetricBar({ window, dimmed = false }: { window: UsageWindow; dimmed?: boolean }) {
  const hasProgress = typeof window.usedPercent === "number";
  const tone = hasProgress ? getUsageScheduleTone(window) : "onTrack";
  const metricLabel = window.valueLabel ?? `${window.usedPercent ?? 0}% used`;
  const metricDetail = window.detail ?? formatUsageReset(window);

  const actual = window.usedPercent ?? 0;
  const expected = computeExpectedPercent(window);
  const hasPaceData = expected !== null && hasProgress;

  let whiteWidth = 0;
  let scheduleWidth = 0;
  let isOver = false;

  if (hasPaceData) {
    const clampedActual = Math.min(100, actual);
    const clampedExpected = Math.min(100, expected!);
    if (actual < expected! - USAGE_SCHEDULE_TOLERANCE) {
      whiteWidth = clampedActual;
      scheduleWidth = Math.max(0, clampedExpected - clampedActual);
    } else if (actual > expected! + USAGE_SCHEDULE_TOLERANCE) {
      whiteWidth = clampedExpected;
      scheduleWidth = Math.max(0, clampedActual - clampedExpected);
      isOver = true;
    } else {
      whiteWidth = clampedActual;
    }
  } else if (hasProgress) {
    whiteWidth = Math.min(100, actual);
  }

  const showSchedule = scheduleWidth >= 1;

  return (
    <div className={`usageMetric usageMetric-${hasProgress ? tone : "static"}${dimmed ? " usageMetric-dimmed" : ""}`}>
      <div className="usageMetricHead">
        <span>{window.label}</span>
        <strong>{metricLabel}</strong>
      </div>
      {hasProgress ? (
        <div className="usageBar" aria-hidden="true">
          <span className="usageBarWhite" style={{ width: `${whiteWidth}%` }} />
          {showSchedule && (
            <span
              className={`usageBarSchedule usageBarSchedule-${isOver ? "over" : "under"}`}
              style={{ width: `${scheduleWidth}%` }}
            />
          )}
        </div>
      ) : null}
      <p className="usageResetLabel">{metricDetail}</p>
    </div>
  );
}

type UpdateStageKey = "thinking" | "planning" | "building" | "verifying";

function UpdateStagePanel({
  plan,
  canConfirmPlan,
  confirmBusy,
  onConfirm,
}: {
  plan: PlanDraft | null;
  canConfirmPlan: boolean;
  confirmBusy: boolean;
  onConfirm: () => void;
}) {
  const [openStage, setOpenStage] = useState<UpdateStageKey | null>(null);
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const autoOpenedRequestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!plan || plan.status === "completed" || plan.status === "failed") {
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [plan?.status, plan?.prompt]);

  useEffect(() => {
    if (!plan) {
      setOpenStage(null);
      autoOpenedRequestKeyRef.current = null;
      return;
    }

    const requestKey = `${plan.provider}:${plan.prompt}:${plan.turnId ?? "pending"}`;
    if (autoOpenedRequestKeyRef.current === requestKey) {
      return;
    }

    const preferredStage =
      ([
        ["thinking", plan.thinkingStatus],
        ["planning", plan.planningStatus],
        ["building", plan.buildingStatus],
        ["verifying", plan.verifyingStatus],
      ] as const).find(([, status]) => status === "failed")?.[0] ??
      ([
        ["thinking", plan.thinkingStatus],
        ["planning", plan.planningStatus],
        ["building", plan.buildingStatus],
        ["verifying", plan.verifyingStatus],
      ] as const).find(([, status]) => status === "in_progress")?.[0] ??
      "thinking";

    autoOpenedRequestKeyRef.current = requestKey;
    setOpenStage(preferredStage);
  }, [
    plan,
    plan?.prompt,
    plan?.provider,
    plan?.turnId,
  ]);

  if (!plan) {
    return null;
  }

  const stageItems: Array<{
    key: UpdateStageKey;
    label: string;
    status: UpdateStageStatus;
  }> = [
    { key: "thinking", label: "Thinking", status: plan.thinkingStatus },
    { key: "planning", label: "Planning", status: plan.planningStatus },
    { key: "building", label: "Building", status: plan.buildingStatus },
    { key: "verifying", label: "Verifying", status: plan.verifyingStatus },
  ];

  const detail =
    openStage === "thinking" ? (
      <div className="updateStageDetailBlock">
        <p><TypewriterText text={plan.explanation || "The model has not shared any thinking details yet."} /></p>
      </div>
    ) : openStage === "planning" ? (
      <div className="updateStageDetailBlock">
        {plan.planningMode === "none" ? <p>Skipped by request.</p> : null}
        {plan.steps.length ? (
          <ol className="planList">
            {plan.steps.map((step) => (
              <li key={step.step}>
                <span className={`stepPill step-${step.status}`}>{step.status.replace("_", " ")}</span>
                {step.step}
              </li>
            ))}
          </ol>
        ) : null}
        <div className="planMetaGrid">
          {plan.summary ? (
            <div>
              <strong>Summary</strong>
              <p><TypewriterText text={plan.summary} /></p>
            </div>
          ) : null}
          {plan.impact ? (
            <div>
              <strong>Impact</strong>
              <p><TypewriterText text={plan.impact} /></p>
            </div>
          ) : null}
          {plan.flowchartChanges ? (
            <div>
              <strong>Flowchart changes</strong>
              <p><TypewriterText text={plan.flowchartChanges} /></p>
            </div>
          ) : null}
        </div>
        {plan.contextPaths.length ? (
          <div className="planMetaGrid">
            <div>
              <strong>Priority context</strong>
              <p>{plan.contextPaths.join(", ")}</p>
            </div>
          </div>
        ) : null}
      </div>
    ) : openStage === "building" ? (
      <div className="updateStageDetailBlock">
        {plan.diff ? (
          <pre className="updateStageCodeBlock">{plan.diff}</pre>
        ) : plan.diffStats ? (
          <p>
            Current diff: +{plan.diffStats.added.toLocaleString()} / -{plan.diffStats.removed.toLocaleString()}
          </p>
        ) : (
          <p>Waiting for file changes.</p>
        )}
      </div>
    ) : openStage === "verifying" ? (
      <div className="updateStageDetailBlock">
        <p>
          <TypewriterText text={plan.verificationDetails ??
            (plan.verifyingStatus === "completed"
              ? "Verification finished."
              : plan.verifyingStatus === "failed"
                ? "Verification needs attention."
                : "Waiting for verification.")} />
        </p>
        {plan.errorMessage ? <div className="errorBanner">{plan.errorMessage}</div> : null}
      </div>
    ) : null;

  return (
    <div className="updateStatusShelf">
      <div className="updateStageHeader">
        <div className="updateStageTitleRow">
          <button
            className="updateStageTitleButton"
            onClick={() => setShowFullPrompt((prev) => !prev)}
            title="Click to view full update request"
          >
            {plan.prompt.length > 50
              ? plan.prompt.slice(0, 47).trim() + "..."
              : plan.prompt.charAt(0).toUpperCase() + plan.prompt.slice(1)}
          </button>
          <span className="updateStageStatusBadge">{labelForPlanStatus(plan.status)}</span>
          {elapsed > 0 && plan.status !== "completed" && plan.status !== "failed" ? (
            <span className="updateStageElapsed">{elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}</span>
          ) : null}
        </div>
        {plan.diffStats ? (
          <div className="updateStageDiffStats" aria-label="Changed lines">
            <span className="updateStageDiffStats-added">+{plan.diffStats.added.toLocaleString()}</span>
            <span className="updateStageDiffStats-removed">-{plan.diffStats.removed.toLocaleString()}</span>
          </div>
        ) : null}
      </div>
      {showFullPrompt ? (
        <div className="updateStageFullPrompt">
          <p>{plan.prompt}</p>
        </div>
      ) : null}

      {detail ? <div className="updateStageDetails">{detail}</div> : null}

      {canConfirmPlan ? (
        <div className="approvalActions updateStageActions">
          <button className="primaryButton" onClick={onConfirm} disabled={confirmBusy}>
            Confirm
          </button>
        </div>
      ) : null}

      <div className="updateStageStrip">
        {stageItems.map((stage) => (
          <button
            key={stage.key}
            type="button"
            className={openStage === stage.key ? "updateStageButton active" : "updateStageButton"}
            onClick={() => setOpenStage((current) => (current === stage.key ? null : stage.key))}
          >
            <span className={`updateStageDot updateStageDot-${stage.status}`} aria-hidden="true" />
            <span>{stage.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingsModal({
  settings,
  modelCatalog,
  auth,
  setup,
  appUpdate,
  isPackagedBuild,
  busyKey,
  theme,
  onPreviewTheme,
  onBrowseAppSourcePath,
  onClose,
  onSave,
  onConnectCodex,
  onConnectClaude,
  onConnectGitHub,
  onDisconnectCodex,
  onDisconnectClaude,
  onDisconnectGitHub,
  onReconnectCodex,
  onReconnectClaude,
  onReconnectGitHub,
  onTestClaude,
  onSetupCodex,
  onSetupClaude,
  onSetupAction,
  claudeAuthCodePrompt,
  claudeAuthCodeInput,
  onClaudeAuthCodeChange,
  onSubmitClaudeAuthCode,
  onCancelClaudeAuthCode,
}: {
  settings: Settings;
  modelCatalog: ModelCatalog;
  auth: AuthSnapshot;
  setup: SetupSnapshot;
  appUpdate: AppUpdateStatus;
  isPackagedBuild: boolean;
  busyKey: string | null;
  theme: Theme;
  onPreviewTheme: (theme: Theme) => void;
  onBrowseAppSourcePath: () => Promise<string | null>;
  onClose: () => void;
  onSave: (settings: Settings) => void;
  onConnectCodex: () => void;
  onConnectClaude: () => void;
  onConnectGitHub: () => void;
  onDisconnectCodex: () => void;
  onDisconnectClaude: () => void;
  onDisconnectGitHub: () => void;
  onReconnectCodex: () => void;
  onReconnectClaude: () => void;
  onReconnectGitHub: () => void;
  onTestClaude: () => void;
  onSetupCodex: () => void;
  onSetupClaude: () => void;
  onSetupAction: (check: SetupCheck) => void;
  claudeAuthCodePrompt: string | null;
  claudeAuthCodeInput: string;
  onClaudeAuthCodeChange: (value: string) => void;
  onSubmitClaudeAuthCode: () => void;
  onCancelClaudeAuthCode: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const codexModelOptions = useMemo(() => {
    const base = modelCatalog.codex.length ? modelCatalog.codex : DEFAULT_MODEL_CATALOG.codex;
    if (base.some((option) => option.id === draft.advancedDefaults.model)) {
      return base;
    }

    return [
      {
        id: draft.advancedDefaults.model,
        label: labelForModel(draft.advancedDefaults.model, base, fallbackCodexModelLabel),
        detail: null,
      },
      ...base,
    ];
  }, [draft.advancedDefaults.model, modelCatalog.codex]);
  const claudeModelOptions = useMemo(() => {
    const base = modelCatalog.claude.length ? modelCatalog.claude : DEFAULT_MODEL_CATALOG.claude;
    if (base.some((option) => option.id === draft.advancedDefaults.claudeModel)) {
      return base;
    }

    return [
      {
        id: draft.advancedDefaults.claudeModel,
        label: labelForModel(draft.advancedDefaults.claudeModel, base, fallbackClaudeModelLabel),
        detail: null,
      },
      ...base,
    ];
  }, [draft.advancedDefaults.claudeModel, modelCatalog.claude]);
  const gitInstallCheck = setup.checks.find((check) => check.id === "gitInstall") ?? null;
  const codexTone = auth.codex.loggedIn ? "confirmed" : auth.codex.available ? "info" : "action_required";
  const claudeTone: StatusTone = !auth.claude.available
    ? "action_required"
    : auth.claude.loggedIn
      ? auth.claude.ready
        ? auth.claude.canConnect
          ? "confirmed"
          : "info"
        : "action_required"
      : auth.claude.canConnect
        ? "info"
        : "action_required";
  const claudeIdentity = auth.claude.email || auth.claude.displayName || "Connected.";
  const claudeConnectedDetail = auth.claude.planType ? `${claudeIdentity} · ${auth.claude.planType}` : claudeIdentity;
  const claudeNeedsUpdateForConnect = auth.claude.loggedIn && auth.claude.ready && !auth.claude.canConnect;
  const claudeDetail = auth.claude.loggedIn
    ? auth.claude.ready
      ? claudeNeedsUpdateForConnect
        ? `${claudeConnectedDetail}. Update Claude Code to keep in-app sign-in compatible.`
        : claudeConnectedDetail
      : `${claudeConnectedDetail}. ${auth.claude.runtimeErrorMessage ?? "Claude needs attention before it can run in PROGRAMS."}`
    : auth.claude.available
      ? auth.claude.canConnect
        ? "Installed. Connect it to use Claude for updates."
        : auth.claude.connectErrorMessage ?? "Update Claude Code to connect it in PROGRAMS."
      : "Install and connect Claude Code in one step.";
  const claudeActionLabel = !auth.claude.available
    ? "Install & Connect"
    : auth.claude.loggedIn
      ? auth.claude.ready
        ? claudeNeedsUpdateForConnect
          ? "Update Claude"
          : null
        : "Repair"
      : auth.claude.canConnect
        ? "Connect"
        : "Update Claude";
  const claudeAction = !auth.claude.available || claudeNeedsUpdateForConnect || (auth.claude.loggedIn && !auth.claude.ready)
    ? onSetupClaude
    : !auth.claude.loggedIn && auth.claude.canConnect
      ? onConnectClaude
      : undefined;
  const githubTone: StatusTone = !auth.github.configured
    ? "info"
    : auth.github.loggedIn && auth.github.verified
      ? "confirmed"
      : auth.github.hasStoredToken
        ? "action_required"
        : "info";
  const githubDetail = !auth.github.configured
    ? "Add a GitHub OAuth client ID below, then connect GitHub to enable HTTPS sync."
    : auth.github.loggedIn
      ? auth.github.login
        ? `Signed in as ${auth.github.login}. HTTPS sync is ready.`
        : "Connected and verified for HTTPS sync."
      : auth.github.loginPrompt
        ? `Approve GitHub access in your browser with code ${auth.github.loginPrompt.userCode}.`
        : auth.github.errorMessage ?? "Connect GitHub to sync projects with remote repositories.";
  const githubActionLabel = auth.github.configured && !auth.github.loggedIn
    ? auth.github.hasStoredToken
      ? "Reconnect"
      : "Connect"
    : null;
  const githubClientIdSourceLabel = auth.github.clientIdSource === "bundled"
    ? "Bundled client ID is active."
    : auth.github.clientIdSource === "override"
      ? "Developer override is active."
      : "No client ID configured yet.";
  const isAdvancedMode = draft.uiMode === "advanced";
  const appUpdateTone: StatusTone =
    appUpdate.buildState === "failed"
      ? "action_required"
      : appUpdate.action !== "none"
        ? "confirmed"
        : appUpdate.buildState === "packaging" || appUpdate.supported
          ? "info"
          : "neutral";
  const appUpdateLabel =
    appUpdate.buildState === "failed"
      ? "Issue"
      : appUpdate.buildState === "packaging"
        ? "Preparing"
        : appUpdate.action !== "none"
          ? "Ready"
          : appUpdate.supported
            ? "Watching"
            : "Unavailable";
  const formatRendererAssetMeta = (assetName: string | null, updatedAt: string | null): ReactNode => {
    if (!assetName) {
      return "Unavailable";
    }

    return (
      <>
        <code className="appUpdateMetaCode">{assetName}</code>
        {updatedAt ? <span className="appUpdateMetaDetail">{formatDate(updatedAt)}</span> : null}
      </>
    );
  };
  const rendererMatchLabel =
    appUpdate.rendererAssetMatch === null
      ? "Unavailable"
      : appUpdate.rendererAssetMatch
        ? "Installed app matches the packaged renderer"
        : "Installed app differs from the packaged renderer";

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  return (
    <Modal title="Settings" onClose={onClose} fullscreen>
      <div className="settingsStack">
        <section className="settingsSection">
          <div className="settingsSectionHead">
            <h4>Mode</h4>
            <StatusChip tone="info">{isAdvancedMode ? "Advanced" : "Basic"}</StatusChip>
          </div>
          <div className="speedToggle">
            <button
              className={draft.uiMode === "simple" ? "toggleOption active" : "toggleOption"}
              onClick={() => setDraft({ ...draft, uiMode: "simple" })}
            >
              Basic
            </button>
            <button
              className={draft.uiMode === "advanced" ? "toggleOption active" : "toggleOption"}
              onClick={() => setDraft({ ...draft, uiMode: "advanced" })}
            >
              Advanced
            </button>
          </div>
          <p className="helperText">
            Basic keeps Settings lighter. Advanced exposes more saved AI defaults, while the Programs composer stays compact in either mode.
          </p>
        </section>

        <section className="settingsSection">
          <div className="settingsSectionHead">
            <h4>Appearance</h4>
            <StatusChip tone="info">{theme === "dark" ? "Dark default" : "Light active"}</StatusChip>
          </div>
          <div className="speedToggle">
            <button
              className={draft.theme === "dark" ? "toggleOption active" : "toggleOption"}
              onClick={() => {
                setDraft({ ...draft, theme: "dark" });
                onPreviewTheme("dark");
              }}
            >
              Dark
            </button>
            <button
              className={draft.theme === "light" ? "toggleOption active" : "toggleOption"}
              onClick={() => {
                setDraft({ ...draft, theme: "light" });
                onPreviewTheme("light");
              }}
            >
              Light
            </button>
          </div>
        </section>

        <section className="settingsSection">
          <div className="settingsSectionHead">
            <h4>App Updates</h4>
            <StatusChip tone={appUpdateTone}>{appUpdateLabel}</StatusChip>
          </div>

          <label>
            Source workspace
            <div className="settingsPathRow">
              <input
                value={draft.appSourcePath ?? ""}
                onChange={(event) => setDraft({ ...draft, appSourcePath: event.target.value || null })}
                placeholder="/Users/kc/Desktop/PROGRAMS"
              />
              <button
                className="secondaryButton"
                type="button"
                onClick={() => {
                  void onBrowseAppSourcePath().then((path) => {
                    if (!path) {
                      return;
                    }

                    setDraft((current) => ({
                      ...current,
                      appSourcePath: path,
                    }));
                  });
                }}
              >
                Browse
              </button>
            </div>
          </label>

          <p className="helperText">
            PROGRAMS watches this local checkout, packages a fresh macOS app when the source is newer, then offers one in-app update action.
          </p>

          <div className="appUpdateMetaGrid">
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Status</span>
              <p>{appUpdate.reason ?? "PROGRAMS is waiting for the next packaged build."}</p>
            </div>
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Running App</span>
              <p>{appUpdate.currentAppPath ?? "Unavailable"}</p>
            </div>
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Workspace</span>
              <p>{appUpdate.workspacePath ?? "Not configured"}</p>
            </div>
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Packaged Build</span>
              <p>{appUpdate.candidateAppPath ?? "Not built yet"}</p>
            </div>
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Source Updated</span>
              <p>{appUpdate.sourceUpdatedAt ? formatDate(appUpdate.sourceUpdatedAt) : "Unavailable"}</p>
            </div>
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Launched Build</span>
              <p>{appUpdate.launchedAppUpdatedAt ? formatDate(appUpdate.launchedAppUpdatedAt) : "Unavailable"}</p>
            </div>
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Installed Renderer</span>
              <p>{formatRendererAssetMeta(appUpdate.currentRendererAssetName, appUpdate.currentRendererAssetUpdatedAt)}</p>
            </div>
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Packaged Renderer</span>
              <p>{formatRendererAssetMeta(appUpdate.candidateRendererAssetName, appUpdate.candidateRendererAssetUpdatedAt)}</p>
            </div>
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Renderer Match</span>
              <p>{rendererMatchLabel}</p>
            </div>
          </div>

          {appUpdate.buildError ? <div className="errorBanner">{appUpdate.buildError}</div> : null}
        </section>

        <section className="settingsSection">
          <div className="settingsSectionHead">
            <h4>Connections</h4>
          </div>
          <div className="connectionList">
            <ConnectionRow
              title="Codex"
              tone={codexTone}
              detail={
                auth.codex.loggedIn
                  ? auth.codex.email || "Connected."
                  : auth.codex.available
                    ? "Installed. Connect it to plan and apply changes."
                    : "Install and connect Codex in one step."
              }
              actionLabel={!auth.codex.available ? "Install & Connect" : !auth.codex.loggedIn ? "Connect" : null}
              onAction={!auth.codex.available ? onSetupCodex : !auth.codex.loggedIn ? onConnectCodex : undefined}
              reconnectLabel={auth.codex.loggedIn ? "Reconnect" : null}
              onReconnect={auth.codex.loggedIn ? onReconnectCodex : undefined}
              disconnectLabel={auth.codex.loggedIn ? "Disconnect" : null}
              onDisconnect={auth.codex.loggedIn ? onDisconnectCodex : undefined}
              disabled={busyKey === "auth.codex"}
            />

            <ConnectionRow
              title="Claude"
              tone={claudeTone}
              detail={claudeDetail}
              extraActionLabel={auth.claude.loggedIn && auth.claude.ready ? "Test" : null}
              onExtraAction={auth.claude.loggedIn && auth.claude.ready ? onTestClaude : undefined}
              actionLabel={claudeActionLabel}
              onAction={claudeAction}
              reconnectLabel={auth.claude.loggedIn ? "Reconnect" : null}
              onReconnect={auth.claude.loggedIn ? onReconnectClaude : undefined}
              disconnectLabel={auth.claude.loggedIn ? "Disconnect" : null}
              onDisconnect={auth.claude.loggedIn ? onDisconnectClaude : undefined}
              disabled={busyKey === "auth.claude" || busyKey === "auth.claude.test"}
            />
            {claudeAuthCodePrompt ? (
              <div className="claudeAuthCodePrompt">
                <p className="claudeAuthCodePromptText">Claude is asking for an authorization code from your browser.</p>
                <div className="claudeAuthCodePromptRow">
                  <input
                    className="claudeAuthCodeInput"
                    type="text"
                    placeholder="Paste auth code here"
                    value={claudeAuthCodeInput}
                    onChange={(e) => onClaudeAuthCodeChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && claudeAuthCodeInput.trim()) {
                        onSubmitClaudeAuthCode();
                      }
                    }}
                    autoFocus
                  />
                  <button
                    className="primaryButton"
                    disabled={!claudeAuthCodeInput.trim()}
                    onClick={onSubmitClaudeAuthCode}
                  >Submit Code</button>
                  <button
                    className="secondaryButton"
                    onClick={onCancelClaudeAuthCode}
                  >Cancel</button>
                </div>
              </div>
            ) : null}

            <ConnectionRow
              title="GitHub"
              tone={githubTone}
              detail={githubDetail}
              extraActionLabel={auth.github.loginPrompt ? "Open Browser" : null}
              onExtraAction={
                auth.github.loginPrompt
                  ? () => {
                      void window.programs.openExternal(auth.github.loginPrompt!.verificationUri);
                    }
                  : undefined
              }
              actionLabel={githubActionLabel}
              onAction={githubActionLabel ? onConnectGitHub : undefined}
              reconnectLabel={auth.github.loggedIn ? "Reconnect" : null}
              onReconnect={auth.github.loggedIn ? onReconnectGitHub : undefined}
              disconnectLabel={auth.github.loggedIn ? "Disconnect" : null}
              onDisconnect={auth.github.loggedIn ? onDisconnectGitHub : undefined}
              disabled={busyKey === "auth.github"}
            />

            <ConnectionRow
              title="Git"
              tone={gitInstallCheck?.status ?? "info"}
              detail={
                gitInstallCheck?.status === "confirmed"
                  ? gitInstallCheck.version || "Installed."
                  : "Install Git so PROGRAMS can save local update history and run projects."
              }
              actionLabel={gitInstallCheck?.status === "action_required" ? "Install" : null}
              onAction={gitInstallCheck?.status === "action_required" ? () => onSetupAction(gitInstallCheck) : undefined}
              disabled={busyKey?.startsWith("setup-") ?? false}
            />
          </div>
        </section>

        {isAdvancedMode ? (
          <section className="settingsSection">
            <div className="settingsSectionHead">
              <h4>Advanced defaults</h4>
            </div>

            <label>
              Default AI provider
              <select
                value={draft.advancedDefaults.provider}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    advancedDefaults: {
                      ...draft.advancedDefaults,
                      provider: event.target.value as AiProvider,
                    },
                  })
                }
              >
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
              </select>
            </label>

            <label>
              Codex model
              <select
                value={draft.advancedDefaults.model}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    advancedDefaults: {
                      ...draft.advancedDefaults,
                      model: event.target.value as CodexModel,
                    },
                  })
                }
              >
                {codexModelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Claude model
              <select
                value={draft.advancedDefaults.claudeModel}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    advancedDefaults: {
                      ...draft.advancedDefaults,
                      claudeModel: event.target.value as ClaudeModel,
                    },
                  })
                }
              >
                {claudeModelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Thinking depth
              <select
                value={draft.advancedDefaults.reasoningEffort}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    advancedDefaults: {
                      ...draft.advancedDefaults,
                      reasoningEffort: event.target.value as Settings["advancedDefaults"]["reasoningEffort"],
                    },
                  })
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">Extra high</option>
              </select>
            </label>

            <div>
              <span className="fieldLabel">Speed</span>
              <div className="speedToggle">
                <button
                  className={draft.defaultSpeed === "normal" ? "toggleOption active" : "toggleOption"}
                  onClick={() => setDraft({ ...draft, defaultSpeed: "normal" })}
                >
                  Normal
                </button>
                <button
                  className={draft.defaultSpeed === "fast" ? "toggleOption active" : "toggleOption"}
                  onClick={() => setDraft({ ...draft, defaultSpeed: "fast" })}
                >
                  Fast
                </button>
              </div>
            </div>

            <label className="checkboxField">
              <input
                type="checkbox"
                checked={draft.autoApprovePlans}
                onChange={(event) => setDraft({ ...draft, autoApprovePlans: event.target.checked })}
              />
              <span>Auto-approve plans by default</span>
            </label>

            <label>
              Custom AI instructions
              <textarea
                rows={4}
                value={draft.advancedDefaults.customInstructions}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    advancedDefaults: {
                      ...draft.advancedDefaults,
                      customInstructions: event.target.value,
                    },
                  })
                }
              />
            </label>

            {!isPackagedBuild ? (
              <>
                <label>
                  Codex binary path
                  <input
                    value={draft.codexBinaryPath ?? ""}
                    onChange={(event) => setDraft({ ...draft, codexBinaryPath: event.target.value || null })}
                    placeholder="/Applications/Codex.app/Contents/Resources/codex"
                  />
                </label>
                <label>
                  Claude binary path
                  <input
                    value={draft.claudeBinaryPath ?? ""}
                    onChange={(event) => setDraft({ ...draft, claudeBinaryPath: event.target.value || null })}
                    placeholder="claude (auto-detected from PATH)"
                  />
                </label>
                <label>
                  GitHub OAuth client ID
                  <input
                    value={draft.githubClientIdOverride ?? ""}
                    onChange={(event) => setDraft({ ...draft, githubClientIdOverride: event.target.value || null })}
                    placeholder="Paste your GitHub OAuth app client ID"
                  />
                </label>
                <p className="helperText">
                  {githubClientIdSourceLabel} Use a GitHub OAuth app with device flow enabled so PROGRAMS can create and sync private repos over HTTPS.
                </p>
                <div className="settingsActionRow">
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() => {
                      void window.programs.openExternal("https://github.com/settings/developers");
                    }}
                  >
                    Configure GitHub App
                  </button>
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() => {
                      void window.programs.openExternal("https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps");
                    }}
                  >
                    Device Flow Docs
                  </button>
                </div>
              </>
            ) : null}
          </section>
        ) : null}
      </div>

      <div className="modalActions">
        <button className="secondaryButton" onClick={onClose}>
          Cancel
        </button>
        <button className="primaryButton" onClick={() => onSave(draft)}>
          Save Settings
        </button>
      </div>
    </Modal>
  );
}

function ConnectionRow({
  title,
  tone,
  detail,
  extraActionLabel,
  onExtraAction,
  actionLabel,
  onAction,
  disconnectLabel,
  onDisconnect,
  reconnectLabel,
  onReconnect,
  disabled = false,
}: {
  title: string;
  tone: StatusTone;
  detail: string;
  extraActionLabel?: string | null;
  onExtraAction?: () => void;
  actionLabel: string | null;
  onAction?: () => void;
  disconnectLabel?: string | null;
  onDisconnect?: () => void;
  reconnectLabel?: string | null;
  onReconnect?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="connectionRow">
      <div className="connectionCopy">
        <div className="connectionTitleRow">
          <strong>{title}</strong>
          <StatusChip tone={tone}>{labelForSetupStatus(tone)}</StatusChip>
        </div>
        <p className="helperText">{detail}</p>
      </div>
      <div className="connectionActions">
        {extraActionLabel && onExtraAction ? (
          <button className="secondaryButton" onClick={onExtraAction} disabled={disabled}>
            {extraActionLabel}
          </button>
        ) : null}
        {reconnectLabel && onReconnect ? (
          <button className="secondaryButton" onClick={onReconnect} disabled={disabled}>
            {reconnectLabel}
          </button>
        ) : null}
        {actionLabel && onAction ? (
          <button className="secondaryButton" onClick={onAction} disabled={disabled}>
            {actionLabel}
          </button>
        ) : null}
        {disconnectLabel && onDisconnect ? (
          <button className="secondaryButton dangerButton" onClick={onDisconnect} disabled={disabled}>
            {disconnectLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ProgramDetailsModal({
  project,
  updates,
  currentFlowchart,
  currentFlowchartGraph,
  pendingUpdate,
  agentSession,
  busyKey,
  theme,
  settings,
  onClose,
  onGenerateFlowchart,
  onApplyPendingUpdate,
  onUndo,
}: {
  project: Project;
  updates: UpdateRecord[];
  currentFlowchart: string;
  currentFlowchartGraph: FlowchartGraph | null;
  pendingUpdate: PendingPlannedUpdate | null;
  agentSession: AgentSession | null;
  busyKey: string | null;
  theme: Theme;
  settings: Settings;
  onClose: () => void;
  onGenerateFlowchart: (provider: AiProvider) => Promise<void>;
  onApplyPendingUpdate: () => Promise<void>;
  onUndo: (update: UpdateRecord) => void;
}) {
  const [activeTab, setActiveTab] = useState<ProgramDetailsTab>("current");
  const [selectedUpdateId, setSelectedUpdateId] = useState<string | null>(null);

  const savedUpdates = useMemo(
    () => [...updates].filter((u) => u.kind === "update" && (u.status === "saved" || u.status === "reverted")).reverse(),
    [updates],
  );
  const hasHistory = savedUpdates.length > 0;
  const hasPlanned = Boolean(pendingUpdate?.previousFlowchart);
  const hasFinal = Boolean(pendingUpdate);
  const hasAgentUpdates = (agentSession?.plannedUpdates.length ?? 0) > 0;
  const selectedUpdate = savedUpdates.find((u) => u.id === selectedUpdateId) ?? null;
  const selectedIndex = selectedUpdate ? savedUpdates.indexOf(selectedUpdate) : -1;
  const previousFlowchart = selectedIndex > 0 ? savedUpdates[selectedIndex - 1].flowchart : null;
  const previousFlowchartGraph = selectedIndex > 0 ? savedUpdates[selectedIndex - 1].flowchartGraph : null;
  const tabAvailability: Record<ProgramDetailsTab, boolean> = {
    history: hasHistory,
    current: true,
    planned: hasPlanned,
    final: hasFinal,
    agentUpdates: hasAgentUpdates,
  };
  const tabOptions: Array<{ id: ProgramDetailsTab; label: string }> = [
    { id: "history", label: "Update History" },
    { id: "current", label: "Current System" },
    { id: "planned", label: "Planned Updates" },
    { id: "agentUpdates", label: "Agent Updates" },
    { id: "final", label: "Final Product" },
  ];

  useEffect(() => {
    const activeTabAvailable =
      activeTab === "history" ? hasHistory : activeTab === "planned" ? hasPlanned : activeTab === "final" ? hasFinal : activeTab === "agentUpdates" ? hasAgentUpdates : true;
    if (!activeTabAvailable) {
      setActiveTab("current");
    }
  }, [activeTab, hasFinal, hasHistory, hasPlanned, hasAgentUpdates]);

  useEffect(() => {
    if (activeTab !== "history") {
      setSelectedUpdateId(null);
    }
  }, [activeTab]);

  return (
    <Modal title="" onClose={onClose} fullscreen>
      <div className="detailsTabBar" role="tablist" aria-label={`${project.name} system details sections`}>
        {tabOptions.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "tabOption active" : "tabOption"}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
            disabled={!tabAvailability[tab.id]}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="detailsScrollContent">
      {activeTab === "history" ? (
        <div className="detailsPanel">
          {selectedUpdate ? (
            <>
              <div className="detailsHeading">
                <div>
                  <span className="fieldLabel">History snapshot</span>
                  <h4>{`v${selectedIndex + 1} - ${selectedUpdate.summary}`}</h4>
                </div>
                <span className="helperText">{formatDate(selectedUpdate.createdAt)}</span>
              </div>
              {previousFlowchart ? (
                (selectedUpdate.flowchartGraph || previousFlowchartGraph) ? (
                  <FlowchartDiff
                    oldGraph={previousFlowchartGraph}
                    newGraph={selectedUpdate.flowchartGraph}
                    theme={theme}
                  />
                ) : (
                  <MermaidChartDiff
                    oldChart={previousFlowchart}
                    newChart={selectedUpdate.flowchart}
                    flowchartGraph={selectedUpdate.flowchartGraph ?? previousFlowchartGraph}
                    theme={theme}
                  />
                )
              ) : (
                selectedUpdate.flowchartGraph ? (
                  <InteractiveFlowchart graph={selectedUpdate.flowchartGraph} theme={theme} />
                ) : (
                  <MermaidChart chart={selectedUpdate.flowchart} flowchartGraph={selectedUpdate.flowchartGraph} theme={theme} />
                )
              )}
              <div className="modalActions">
                <button className="secondaryButton" onClick={() => setSelectedUpdateId(null)}>
                  Back to history
                </button>
                {selectedUpdate.status === "saved" ? (
                  <button
                    className="secondaryButton"
                    disabled={busyKey === `undo-${selectedUpdate.id}`}
                    onClick={() => onUndo(selectedUpdate)}
                  >
                    Undo Update
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="historyStack">
              {savedUpdates.length === 0 ? (
                <div className="placeholderPanel">
                  <h4>No updates yet</h4>
                  <p>Saved updates will show up here once PROGRAMS has applied changes to this project.</p>
                </div>
              ) : (
                <div className="historyListDetailed">
                  {savedUpdates.map((update, index) => (
                    <button
                      key={update.id}
                      className="historyDetailItem"
                      onClick={() => setSelectedUpdateId(update.id)}
                    >
                      <div className="historyDetailTopRow">
                        <span className="historyVersionTag">v{index + 1}</span>
                        <strong className="historyDetailSummary">{update.summary}</strong>
                        <span className="helperText">{formatDate(update.createdAt)}</span>
                      </div>
                      <p className="historyDetailDescription">{update.prompt}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "current" ? (
        <>
          <CurrentFlowchartPanel
            flowchart={currentFlowchart}
            flowchartGraph={currentFlowchartGraph}
            theme={theme}
            busyKey={busyKey}
            onGenerateFlowchart={onGenerateFlowchart}
          />
          <div className="detailsPlaceholderGrid">
            <div className="detailsPlaceholderCard">
              <span className="fieldLabel">Stored Data</span>
              <p className="helperText">Data stores and persistence layers used by this project.</p>
            </div>
            <div className="detailsPlaceholderCard">
              <span className="fieldLabel">Connections</span>
              <p className="helperText">External services and APIs connected to this project.</p>
            </div>
            <div className="detailsPlaceholderCard">
              <span className="fieldLabel">Runtime</span>
              <p className="helperText">Runtime environment and process information.</p>
            </div>
          </div>
        </>
      ) : null}

      {activeTab === "planned" && pendingUpdate ? (
        <div className="detailsPanel">
          <div className="detailsHeading">
            <div>
              <span className="fieldLabel">Planned changes</span>
              <h4>Current to final diff</h4>
            </div>
            <span className="helperText">{formatDate(pendingUpdate.createdAt)}</span>
          </div>
          <p className="modalLead">This compares the current saved system flow to the planned end state.</p>
          {(pendingUpdate.flowchartGraph || pendingUpdate.previousFlowchartGraph) ? (
            <FlowchartDiff
              oldGraph={pendingUpdate.previousFlowchartGraph}
              newGraph={pendingUpdate.flowchartGraph}
              theme={theme}
            />
          ) : (
            <MermaidChartDiff
              oldChart={pendingUpdate.previousFlowchart}
              newChart={pendingUpdate.flowchart}
              flowchartGraph={pendingUpdate.flowchartGraph ?? pendingUpdate.previousFlowchartGraph}
              theme={theme}
            />
          )}
        </div>
      ) : null}

      {activeTab === "final" && pendingUpdate ? (
        <div className="detailsPanel">
          <div className="pendingUpdateBanner">
            <span>{pendingUpdate.description}</span>
            <button
              className="primaryButton"
              onClick={() => void onApplyPendingUpdate()}
              disabled={busyKey === "apply-pending"}
            >
              Apply Update
            </button>
          </div>
          <p className="modalLead">This is the saved final flowchart that will become the new current system state.</p>
          {pendingUpdate.flowchartGraph ? (
            <InteractiveFlowchart graph={pendingUpdate.flowchartGraph} theme={theme} />
          ) : (
            <MermaidChart chart={pendingUpdate.flowchart} flowchartGraph={pendingUpdate.flowchartGraph} theme={theme} />
          )}
        </div>
      ) : null}

      {activeTab === "agentUpdates" && agentSession ? (
        <div className="detailsPanel">
          <p className="modalLead">Planned updates from the iteration agent. Apply them one at a time.</p>
          <div className="agentPlannedUpdatesList">
            {agentSession.plannedUpdates
              .sort((a, b) => a.order - b.order)
              .map((update, idx) => (
                <div key={update.id} className="agentPlannedUpdateItem">
                  <span className="orderBadge">{idx + 1}</span>
                  <div className="updateContent">
                    <div className="updateTitle">{update.title}</div>
                    <div className="updateDescription">{update.description}</div>
                  </div>
                  <div className="updateActions">
                    <StatusChip
                      tone={update.status === "completed" ? "confirmed" : update.status === "failed" ? "action_required" : update.status === "in_progress" ? "info" : "neutral"}
                    >{update.status}</StatusChip>
                    {update.status === "pending" ? (
                      <button
                        className="primaryButton"
                        onClick={() => {
                          void window.programs.agentExecuteUpdate({
                            projectId: project.id,
                            updateId: update.id,
                            provider: settings.advancedDefaults.provider,
                            model: settings.advancedDefaults.model,
                            claudeModel: settings.advancedDefaults.claudeModel,
                          });
                          onClose();
                        }}
                      >
                        Apply Update
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
          </div>
        </div>
      ) : null}
      </div>
    </Modal>
  );
}

function CurrentFlowchartPanel({
  flowchart,
  flowchartGraph,
  theme,
  busyKey,
  onGenerateFlowchart,
}: {
  flowchart: string;
  flowchartGraph: FlowchartGraph | null;
  theme: Theme;
  busyKey: string | null;
  onGenerateFlowchart: (provider: AiProvider) => Promise<void>;
}) {
  const [genProvider, setGenProvider] = useState<AiProvider>("codex");
  const isStarter = flowchart.includes("Describe a change in plain English") || flowchart.includes("Describe an update");

  return (
    <div className="detailsPanel">
      {isStarter ? (
        <div className="generateFlowchartCard">
          <h4>No system flowchart generated yet</h4>
          <p>Generate a flowchart from the current codebase to see how the system works.</p>
          <div className="generateFlowchartActions">
            <div className="speedToggle" style={{ marginBottom: 12 }}>
              <button
                className={`toggleOption ${genProvider === "codex" ? "active" : ""}`}
                onClick={() => setGenProvider("codex")}
              >
                Codex
              </button>
              <button
                className={`toggleOption ${genProvider === "claude" ? "active" : ""}`}
                onClick={() => setGenProvider("claude")}
              >
                Claude
              </button>
            </div>
            <button
              className="primaryButton"
              onClick={() => void onGenerateFlowchart(genProvider)}
              disabled={busyKey === "generate-flowchart"}
            >
              {busyKey === "generate-flowchart" ? "Generating..." : "Generate Flowchart"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="modalLead">This is the current high-level system flow for the selected project.</p>
          <div className="generateFlowchartActions regenerateFlowchartActions">
            <div className="speedToggle">
              <button
                className={`toggleOption ${genProvider === "codex" ? "active" : ""}`}
                onClick={() => setGenProvider("codex")}
              >
                Codex
              </button>
              <button
                className={`toggleOption ${genProvider === "claude" ? "active" : ""}`}
                onClick={() => setGenProvider("claude")}
              >
                Claude
              </button>
            </div>
            <button
              className="secondaryButton"
              onClick={() => void onGenerateFlowchart(genProvider)}
              disabled={busyKey === "generate-flowchart"}
            >
              {busyKey === "generate-flowchart" ? "Regenerating..." : "Regenerate Flowchart"}
            </button>
          </div>
          {flowchartGraph ? (
            <InteractiveFlowchart graph={flowchartGraph} theme={theme} />
          ) : (
            <MermaidChart chart={flowchart} flowchartGraph={flowchartGraph} theme={theme} />
          )}
        </>
      )}
    </div>
  );
}

function StoredDataModal({
  project,
  report,
  busy,
  onClose,
  onGenerateReport,
}: {
  project: Project;
  report: ProjectOutlineReport | null | undefined;
  busy: boolean;
  onClose: () => void;
  onGenerateReport: () => void;
}) {
  return (
    <Modal title={`${project.name} stored data`} onClose={onClose} wide>
      <div className="detailsPanel">
        {report === undefined ? (
          <div className="placeholderPanel">
            <h4>Loading stored data</h4>
            <p>PROGRAMS is reading the latest stored-data report for this project.</p>
          </div>
        ) : report === null ? (
          <div className="outlineEmptyState">
            <div className="placeholderPanel">
              <h4>No stored data report yet</h4>
              <p>Generate a report to explain what information the project stores in plain English.</p>
            </div>
            <button className="primaryButton" onClick={onGenerateReport} disabled={busy}>
              {busy ? "Generating..." : "Generate report"}
            </button>
          </div>
        ) : (
          <>
            <div className="detailsHeading">
              <div>
                <span className="fieldLabel">Generated</span>
                <h4>Stored data overview</h4>
              </div>
              <span className="helperText">{formatDate(report.generatedAt)}</span>
            </div>
            {report.storedData.length === 0 ? (
              <div className="placeholderPanel">
                <h4>No stored data detected</h4>
                <p>The current report did not find any clear soft-coded or user-facing stored data in this project.</p>
              </div>
            ) : (
              <ul className="storedDataTree">
                {report.storedData.map((node) => (
                  <StoredDataTreeNode key={`${node.label}-${node.description ?? ""}`} node={node} depth={0} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function StoredDataTreeNode({ node, depth }: { node: StoredDataNode; depth: number }) {
  const hasChildren = node.children.length > 0;

  return (
    <li className="storedDataTreeItem">
      {hasChildren ? (
        <details className="storedDataDetails" open={depth === 0}>
          <summary>
            <span className="storedDataLabel">{node.label}</span>
          </summary>
          {node.description ? <p className="helperText storedDataDescription">{node.description}</p> : null}
          <ul className="storedDataChildren">
            {node.children.map((child) => (
              <StoredDataTreeNode key={`${child.label}-${child.description ?? ""}`} node={child} depth={depth + 1} />
            ))}
          </ul>
        </details>
      ) : (
        <div className="storedDataLeaf">
          <span className="storedDataLabel">{node.label}</span>
          {node.description ? <p className="helperText storedDataDescription">{node.description}</p> : null}
        </div>
      )}
    </li>
  );
}

function ConnectionsModal({
  project,
  report,
  envSnapshot,
  reportBusy,
  envBusy,
  onClose,
  onGenerateReport,
  onSaveEnv,
}: {
  project: Project;
  report: ProjectOutlineReport | null | undefined;
  envSnapshot: EnvFileSnapshot | undefined;
  reportBusy: boolean;
  envBusy: boolean;
  onClose: () => void;
  onGenerateReport: () => void;
  onSaveEnv: (entries: EnvVariableEntry[]) => Promise<void>;
}) {
  const [draftEntries, setDraftEntries] = useState<EnvVariableEntry[]>([]);
  const [keysVisible, setKeysVisible] = useState(false);

  useEffect(() => {
    setDraftEntries(envSnapshot?.entries.map((entry) => ({ ...entry })) ?? []);
    setKeysVisible(false);
  }, [envSnapshot]);

  const handleEntryChange = (index: number, field: keyof EnvVariableEntry, value: string) => {
    setDraftEntries((current) =>
      current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, [field]: value } : entry)),
    );
  };

  const handleAddEntry = () => {
    setDraftEntries((current) => [...current, { key: "", value: "" }]);
  };

  const handleDeleteEntry = (index: number) => {
    setDraftEntries((current) => current.filter((_, entryIndex) => entryIndex !== index));
  };

  const toggleKeysVisible = () => {
    if (keysVisible) {
      setKeysVisible(false);
      return;
    }

    const confirmed = window.confirm("Reveal and edit the environment variable values for this project?");
    if (confirmed) {
      setKeysVisible(true);
    }
  };

  return (
    <Modal title={`${project.name} connections`} onClose={onClose} wide>
      <div className="detailsPanel">
        <section className="outlineSectionCard">
          <div className="outlineSectionHead">
            <div>
              <span className="fieldLabel">Connected services</span>
              <h4>APIs and services</h4>
            </div>
            {report === null ? (
              <button className="secondaryButton smallButton" onClick={onGenerateReport} disabled={reportBusy}>
                {reportBusy ? "Generating..." : "Generate report"}
              </button>
            ) : null}
          </div>

          {report === undefined ? (
            <p className="helperText">Loading the connections report for this project.</p>
          ) : report === null ? (
            <p className="helperText">Generate a report to surface likely services, APIs, and cost notes for this project.</p>
          ) : report.connections.length === 0 ? (
            <p className="helperText">No connected services were detected in the current report.</p>
          ) : (
            <div className="outlineCardGrid">
              {report.connections.map((connection) => (
                <div key={`${connection.name}-${connection.kind}`} className="outlineInfoCard">
                  <div className="outlineInfoHead">
                    <strong>{connection.name}</strong>
                    <span className="statusChip statusChip-info">{connection.kind}</span>
                  </div>
                  <p className="helperText">{connection.description}</p>
                  {connection.envKeys.length ? (
                    <div className="pillList">
                      {connection.envKeys.map((envKey) => (
                        <span key={envKey} className="outlinePill">
                          {envKey}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="outlineSectionCard">
          <div className="outlineSectionHead">
            <div>
              <span className="fieldLabel">Costs</span>
              <h4>Usage and spend notes</h4>
            </div>
          </div>

          {report === undefined ? (
            <p className="helperText">Loading cost notes.</p>
          ) : report === null ? (
            <p className="helperText">Generate a report to add rough cost guidance for the detected services.</p>
          ) : report.costs.length === 0 ? (
            <p className="helperText">No specific paid-service cost notes were detected in the current report.</p>
          ) : (
            <div className="outlineCardGrid">
              {report.costs.map((cost) => (
                <div key={cost.label} className="outlineInfoCard">
                  <div className="outlineInfoHead">
                    <strong>{cost.label}</strong>
                    {cost.amount ? <span className="statusChip statusChip-neutral">{cost.amount}</span> : null}
                  </div>
                  <p className="helperText">{cost.description}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="outlineSectionCard">
          <div className="outlineSectionHead">
            <div>
              <span className="fieldLabel">Environment</span>
              <h4>Root .env file</h4>
            </div>
            <div className="outlineActionRow">
              <button className="secondaryButton smallButton" onClick={toggleKeysVisible} disabled={envSnapshot === undefined}>
                {keysVisible ? "Hide Keys" : "View Keys"}
              </button>
              <button className="secondaryButton smallButton" onClick={handleAddEntry} disabled={envSnapshot === undefined}>
                Add Key
              </button>
            </div>
          </div>

          <p className="helperText">
            {envSnapshot
              ? envSnapshot.exists
                ? `Editing ${envSnapshot.path}`
                : `No .env file exists yet. Saving here will create ${envSnapshot.path}.`
              : "Loading the project environment file."}
          </p>

          {report && report.referencedEnvKeys.length ? (
            <div className="pillList">
              {report.referencedEnvKeys.map((envKey) => (
                <span key={envKey} className="outlinePill">
                  {envKey}
                </span>
              ))}
            </div>
          ) : null}

          {envSnapshot === undefined ? (
            <p className="helperText">Loading environment variables.</p>
          ) : draftEntries.length === 0 ? (
            <div className="placeholderPanel">
              <h4>No environment variables yet</h4>
              <p>Add a key to create the project&apos;s root .env file.</p>
            </div>
          ) : (
            <div className="envEditorList">
              {draftEntries.map((entry, index) => (
                <div key={`${index}-${entry.key}`} className="envEditorRow">
                  <input
                    value={entry.key}
                    onChange={(event) => handleEntryChange(index, "key", event.target.value)}
                    placeholder="API_KEY"
                  />
                  {keysVisible ? (
                    <input
                      value={entry.value}
                      onChange={(event) => handleEntryChange(index, "value", event.target.value)}
                      placeholder="Value"
                    />
                  ) : (
                    <div className="envMaskedValue">Hidden until you choose View Keys</div>
                  )}
                  <button className="textButton envDeleteButton" onClick={() => handleDeleteEntry(index)}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="envWarningCard">
            <strong>Save Updates writes directly to the project&apos;s root .env file.</strong>
            <p className="helperText">Review the keys carefully before saving. These values affect how the app runs locally.</p>
          </div>

          <div className="modalActions">
            <button className="secondaryButton" onClick={onClose}>
              Close
            </button>
            <button
              className="primaryButton"
              onClick={() => void onSaveEnv(draftEntries)}
              disabled={envBusy || envSnapshot === undefined}
            >
              {envBusy ? "Saving..." : "Save Updates"}
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

function RuntimeModal({
  project,
  runtime,
  onClose,
}: {
  project: Project;
  runtime: RuntimeState | null;
  onClose: () => void;
}) {
  const liveUrl = runtime?.url ?? null;
  const fallbackUrl = project.runtimeConfig.lastRunUrl ?? project.runtimeConfig.openUrl ?? null;
  const runtimeRows = [
    {
      label: "Status",
      value: runtime?.running ? "Running" : "Not running",
    },
    {
      label: "Runtime",
      value: labelForRuntimeSource(runtime?.source ?? "none"),
    },
    ...(liveUrl ? [{ label: "Live URL", value: liveUrl }] : fallbackUrl ? [{ label: "Last URL", value: fallbackUrl }] : []),
    ...(runtime?.startedAt ? [{ label: "Started", value: formatDate(runtime.startedAt) }] : []),
    ...(runtime?.pid ? [{ label: "PID", value: String(runtime.pid) }] : []),
    ...(project.runtimeConfig.runCommand ? [{ label: "Run command", value: project.runtimeConfig.runCommand }] : []),
    ...(project.runtimeConfig.openUrl ? [{ label: "Configured URL", value: project.runtimeConfig.openUrl }] : []),
  ];

  return (
    <Modal title={`${project.name} Runtime`} onClose={onClose} wide>
      <div className="detailsPanel">
        <div className="detailsHeading">
          <div>
            <span className="fieldLabel">Runtime</span>
            <h4>Current local run state</h4>
          </div>
          <span className="helperText">{runtime?.running ? "Live" : "Idle"}</span>
        </div>

        {runtimeRows.length ? (
          <div className="outlineCardGrid">
            {runtimeRows.map((row) => (
              <div key={row.label} className="outlineInfoCard">
                <span className="fieldLabel">{row.label}</span>
                <strong className="runtimeInfoValue">{row.value}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="placeholderPanel">
            <h4>No runtime data yet</h4>
            <p>Run this project once and PROGRAMS will store local runtime details here.</p>
          </div>
        )}

        {runtime?.logs.length ? (
          <section className="outlineSectionCard">
            <div className="outlineSectionHead">
              <div>
                <span className="fieldLabel">Logs</span>
                <h4>Recent runtime output</h4>
              </div>
            </div>
            <pre className="runtimeLog runtimeLogExpanded">{runtime.logs.join("\n")}</pre>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

interface FlowchartTooltipState {
  label: string;
  description: string;
  left: number;
  top: number;
}

function MermaidChart({
  chart,
  flowchartGraph,
  theme,
}: {
  chart: string;
  flowchartGraph?: FlowchartGraph | null;
  theme: Theme;
}) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bindFunctions, setBindFunctions] = useState<((element: Element) => void) | null>(null);
  const [tooltip, setTooltip] = useState<FlowchartTooltipState | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartId = useId().replace(/:/g, "-");
  const normalizedGraph = useMemo(() => normalizeFlowchartGraph(flowchartGraph), [flowchartGraph]);

  useEffect(() => {
    let cancelled = false;
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === "light" ? "default" : "dark",
      securityLevel: "loose",
      fontFamily: "IBM Plex Sans, Avenir Next, SF Pro Display, Segoe UI, sans-serif",
    });

    mermaid
      .render(`mermaid-${chartId}`, chart)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setSvg(result.svg);
        setBindFunctions(() => result.bindFunctions ?? null);
        setTooltip(null);
        setError(null);
      })
      .catch((renderError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(renderError instanceof Error ? renderError.message : "The flowchart could not be rendered.");
      });

    return () => {
      cancelled = true;
    };
  }, [chart, chartId, theme]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !svg) {
      return;
    }

    bindFunctions?.(container);
    setTooltip(null);

    if (!normalizedGraph) {
      return;
    }

    const cleanups: Array<() => void> = [];
    for (const node of normalizedGraph.nodes) {
      if (!node.description.trim()) {
        continue;
      }

      const target = container.querySelector<SVGGElement>(`[id="${node.id}"]`);
      if (!target) {
        continue;
      }

      const showTooltip = () => {
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        setTooltip({
          label: node.label,
          description: node.description,
          left: targetRect.left - containerRect.left + targetRect.width / 2,
          top: targetRect.top - containerRect.top - 10,
        });
      };

      const hideTooltip = () => {
        setTooltip((current) => (current?.label === node.label ? null : current));
      };

      target.classList.add("mermaidNodeInteractive");
      target.setAttribute("tabindex", "0");
      target.setAttribute("focusable", "true");
      target.setAttribute("aria-label", `${node.label}: ${node.description}`);
      target.addEventListener("mouseenter", showTooltip);
      target.addEventListener("mouseleave", hideTooltip);
      target.addEventListener("focus", showTooltip);
      target.addEventListener("blur", hideTooltip);

      cleanups.push(() => {
        target.classList.remove("mermaidNodeInteractive");
        target.removeAttribute("tabindex");
        target.removeAttribute("focusable");
        target.removeAttribute("aria-label");
        target.removeEventListener("mouseenter", showTooltip);
        target.removeEventListener("mouseleave", hideTooltip);
        target.removeEventListener("focus", showTooltip);
        target.removeEventListener("blur", hideTooltip);
      });
    }

    return () => {
      setTooltip(null);
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [bindFunctions, normalizedGraph, svg]);

  if (error) {
    return <div className="errorBanner">{error}</div>;
  }

  return (
    <div className="mermaidChartFrame">
      <div ref={containerRef} className="mermaidSurface" dangerouslySetInnerHTML={{ __html: svg }} />
      {tooltip ? (
        <div
          className="mermaidNodeTooltip"
          style={{
            left: tooltip.left,
            top: tooltip.top,
          }}
        >
          <strong>{tooltip.label}</strong>
          <span>{tooltip.description}</span>
        </div>
      ) : null}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide = false,
  fullscreen = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  fullscreen?: boolean;
}) {
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className={`modalFrame${wide ? " wide" : ""}${fullscreen ? " fullscreen" : ""}`} onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          {title ? <h3>{title}</h3> : null}
          <button className="textButton" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function BottomSheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="bottomSheetOverlay" onClick={onClose}>
      <div className="bottomSheetFrame" onClick={(event) => event.stopPropagation()}>
        <div className="bottomSheetHandle" aria-hidden="true" />
        <div className="bottomSheetHeader">
          <h3>{title}</h3>
          <button className="textButton" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ToastHost({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="toastHost">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.level}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}

function StatusChip({
  tone,
  children,
}: {
  tone: StatusTone;
  children: ReactNode;
}) {
  return <span className={`statusChip statusChip-${tone}`}>{children}</span>;
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10.9 2.1h2.2l.4 2a8 8 0 0 1 1.8.8l1.8-1.1 1.6 1.6-1.1 1.8a8 8 0 0 1 .8 1.8l2 .4v2.2l-2 .4a8 8 0 0 1-.8 1.8l1.1 1.8-1.6 1.6-1.8-1.1a8 8 0 0 1-1.8.8l-.4 2h-2.2l-.4-2a8 8 0 0 1-1.8-.8l-1.8 1.1-1.6-1.6 1.1-1.8a8 8 0 0 1-.8-1.8l-2-.4V9.7l2-.4a8 8 0 0 1 .8-1.8L4 5.7l1.6-1.6 1.8 1.1a8 8 0 0 1 1.8-.8l.4-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function TimerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 2h6M12 8v4l2.5 2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="14" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M16.5 6.5 18 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="5" cy="10" r="1.15" fill="currentColor" />
      <circle cx="10" cy="10" r="1.15" fill="currentColor" />
      <circle cx="15" cy="10" r="1.15" fill="currentColor" />
    </svg>
  );
}

function SidebarToggleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 7h14M5 12h10M5 17h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="m5.5 7.5 4.5 4.5 4.5-4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TypewriterText({ text, speed = 8 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState("");
  const prevTextRef = useRef("");

  useEffect(() => {
    const prev = prevTextRef.current;
    if (text.startsWith(prev) && prev.length < text.length) {
      const newPortion = text.slice(prev.length);
      let i = 0;
      const interval = setInterval(() => {
        if (i < newPortion.length) {
          i++;
          setDisplayed(prev + newPortion.slice(0, i));
        } else {
          clearInterval(interval);
          prevTextRef.current = text;
        }
      }, speed);
      return () => clearInterval(interval);
    }
    setDisplayed(text);
    prevTextRef.current = text;
  }, [text, speed]);

  return <>{displayed}</>;
}

function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 19V6m0 0-5 5m5-5 5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="m5 10 3.1 3.1L15 6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RunningIndicator() {
  return (
    <span className="runningIndicator">
      <span>Running</span>
      <span className="runningDots" aria-hidden="true">
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </span>
  );
}

function labelForSetupStatus(status: StatusTone): string {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "action_required":
      return "Needs action";
    case "neutral":
      return "Ready";
    case "info":
      return "Info";
  }
}

function labelForPlanStatus(status: PlanDraft["status"]): string {
  switch (status) {
    case "planning":
      return "Building the plan";
    case "awaitingApproval":
      return "Ready to confirm";
    case "executing":
      return "Applying the approved update";
    case "completed":
      return "Update finished";
    case "failed":
      return "Update needs attention";
  }
}

function labelForUpdateStatus(status: UpdateRecord["status"]): string {
  switch (status) {
    case "saved":
      return "saved";
    case "pendingSync":
      return "saved";
    case "reverted":
      return "reverted";
    case "failed":
      return "failed";
    case "executing":
      return "saving";
    case "planned":
      return "planned";
  }
}

function createFallbackPlan(project: Project): string {
  return `flowchart TD
    A["Select ${project.name}"] --> B["Describe an update"]
    B --> C["Review the AI plan"]
    C --> D["Apply the update locally"]
    D --> E["Run and review the local result"]
  `;
}

function buildDiffFlowchart(oldMermaid: string, newMermaid: string): string {
  const extractNodes = (mermaid: string): Map<string, string> => {
    const nodes = new Map<string, string>();
    const nodePattern =
      /([A-Za-z_]\w*)\s*(?:\(\["([^"]*?)"\]\)|\("([^"]*?)"\)|\[\["([^"]*?)"\]\]|\["([^"]*?)"\])/g;
    let match: RegExpExecArray | null;
    while ((match = nodePattern.exec(mermaid)) !== null) {
      const label = match[2] ?? match[3] ?? match[4] ?? match[5] ?? "";
      nodes.set(match[1], label);
    }
    return nodes;
  };

  const oldNodes = extractNodes(oldMermaid);
  const newNodes = extractNodes(newMermaid);

  const styles: string[] = [];
  for (const [id, label] of newNodes) {
    if (!oldNodes.has(id)) {
      styles.push(`  style ${id} fill:#10B981,color:#fff`);
    } else if (oldNodes.get(id) !== label) {
      styles.push(`  style ${id} fill:#F59E0B,color:#fff`);
    }
  }

  for (const [id] of oldNodes) {
    if (!newNodes.has(id)) {
      styles.push(`  style ${id} fill:#FB7185,color:#fff`);
    }
  }

  if (styles.length === 0) return newMermaid;

  const lines = newMermaid.trimEnd().split("\n");
  return [...lines, ...styles].join("\n");
}

function MermaidChartDiff({
  oldChart,
  newChart,
  flowchartGraph,
  theme,
}: {
  oldChart: string;
  newChart: string;
  flowchartGraph?: FlowchartGraph | null;
  theme: Theme;
}) {
  const diffChart = useMemo(() => buildDiffFlowchart(oldChart, newChart), [oldChart, newChart]);
  return <MermaidChart chart={diffChart} flowchartGraph={flowchartGraph} theme={theme} />;
}

function CoreDetailsPillarExpanded({
  pillar,
  depth = 0,
  projectId,
  onSessionUpdate,
  pushToast,
}: {
  pillar: CorePillar;
  depth?: number;
  projectId?: string;
  onSessionUpdate?: (session: AgentSession) => void;
  pushToast?: (message: string, level: "info" | "success" | "error") => void;
}) {
  const [expandedChildId, setExpandedChildId] = useState<string | null>(null);

  const handleAttachVibe = async () => {
    if (!projectId) return;
    const result = await window.programs.pickMaterialFiles();
    if (result.canceled || result.paths.length === 0) return;
    try {
      const session = await window.programs.attachVibe({
        projectId,
        pillarId: pillar.id,
        filePaths: result.paths,
      });
      onSessionUpdate?.(session);
      pushToast?.("Vibe attached.", "success");
    } catch (error) {
      pushToast?.(error instanceof Error ? error.message : "Failed to attach vibe.", "error");
    }
  };

  const handleRemoveVibe = async (vibeId: string) => {
    if (!projectId) return;
    try {
      const session = await window.programs.removeVibe({
        projectId,
        pillarId: pillar.id,
        vibeId,
      });
      onSessionUpdate?.(session);
    } catch (error) {
      pushToast?.(error instanceof Error ? error.message : "Failed to remove vibe.", "error");
    }
  };

  const vibes = pillar.vibes ?? [];

  return (
    <div className="corePillarExpanded" style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      <div className="pillarDetailRow">
        <span className="pillarDetailLabel">Function:</span>
        <span className={pillar.function?.status === "assumed" ? "assumedText" : ""}>
          {pillar.function?.summary ?? "Not defined"}
        </span>
      </div>
      <div className="pillarDetailRow">
        <span className="pillarDetailLabel">Thesis:</span>
        <span className={pillar.thesis?.status === "assumed" ? "assumedText" : ""}>
          {pillar.thesis?.summary ?? "Not defined"}
        </span>
      </div>
      {pillar.fullFlow ? (
        <div className="pillarDetailRow">
          <span className="pillarDetailLabel">Full-Flow:</span>
          <span className={pillar.fullFlow.status === "assumed" ? "assumedText" : ""}>
            {pillar.fullFlow.summary}
          </span>
        </div>
      ) : null}

      {/* Vibes section */}
      <div className="pillarVibesSection">
        <div className="pillarVibesHeader">
          <span className="pillarDetailLabel">Vibes</span>
          {projectId ? (
            <button className="secondaryButton vibeAttachBtn" onClick={() => void handleAttachVibe()}>
              + Add Vibe
            </button>
          ) : null}
        </div>
        {vibes.length > 0 ? (
          <div className="vibeGrid">
            {vibes.map((vibe) => (
              <div key={vibe.id} className="vibeThumb">
                {vibe.fileType === "image" ? (
                  <div className="vibeThumbImage" title={vibe.fileName}>
                    <span className="vibeThumbIcon">&#128247;</span>
                  </div>
                ) : (
                  <div className="vibeThumbFile" title={vibe.fileName}>
                    <span className="vibeThumbIcon">&#128196;</span>
                  </div>
                )}
                <span className="vibeThumbName">{vibe.fileName}</span>
                {projectId ? (
                  <button className="vibeRemoveBtn" onClick={() => void handleRemoveVibe(vibe.id)}>&times;</button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <span className="vibeEmpty">No vibes attached</span>
        )}
      </div>

      {/* Sub-pillars (recursive) */}
      {pillar.corePillars.length > 0 ? (
        <div className="pillarChildren">
          <span className="pillarDetailLabel" style={{ marginBottom: 4, display: "block" }}>Sub-Pillars:</span>
          <div className="corePillarChips">
            {pillar.corePillars.map((child) => (
              <button
                key={child.id}
                className={`corePillarChip${expandedChildId === child.id ? " active" : ""}`}
                onClick={() => setExpandedChildId(expandedChildId === child.id ? null : child.id)}
              >
                {child.name}
              </button>
            ))}
          </div>
          {expandedChildId ? (() => {
            const child = pillar.corePillars.find((c) => c.id === expandedChildId);
            if (!child) return null;
            return (
              <CoreDetailsPillarExpanded
                pillar={child}
                depth={depth + 1}
                projectId={projectId}
                onSessionUpdate={onSessionUpdate}
                pushToast={pushToast}
              />
            );
          })() : null}
        </div>
      ) : null}
    </div>
  );
}

function CoreDetailsPanel({
  projectId,
  settings,
  agentSession,
  onClose,
  pushToast,
}: {
  projectId: string;
  settings: Settings;
  agentSession: AgentSession | null;
  onClose: () => void;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
}) {
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"function" | "thesis" | "core_pillars" | "full_flow">("function");
  const [expandedPillarId, setExpandedPillarId] = useState<string | null>(null);
  const [updateAiMessage, setUpdateAiMessage] = useState<string | null>(null);
  const [pendingProposal, setPendingProposal] = useState<CoreDetailsProposal | null>(null);
  const [editedProposal, setEditedProposal] = useState<CoreDetailsProposal | null>(null);
  const [coreDetails, setCoreDetails] = useState<AgentCoreDetails>({
    function: agentSession?.stages.function.confirmed ?? null,
    thesis: agentSession?.stages.thesis.confirmed ?? null,
    corePillars: agentSession?.corePillars ?? [],
    fullFlow: agentSession?.stages.full_flow.confirmed ?? null,
  });
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const functionStatus = coreDetails.function?.status ?? null;
  const thesisStatus = coreDetails.thesis?.status ?? null;
  const pillarsStatus = agentSession?.stages.core_pillars.confirmed?.status ?? null;
  const fullFlowStatus = coreDetails.fullFlow?.status ?? null;

  const handleConfirmDetail = async (field: "function" | "thesis" | "core_pillars" | "full_flow") => {
    try {
      const session = await window.programs.agentConfirmCoreDetail(projectId, field);
      setCoreDetails({
        function: session.stages.function.confirmed ?? null,
        thesis: session.stages.thesis.confirmed ?? null,
        corePillars: session.corePillars,
        fullFlow: session.stages.full_flow.confirmed ?? null,
      });
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Failed to confirm.", "error");
    }
  };

  const focusEditForField = (field: "function" | "thesis" | "core_pillars" | "full_flow") => {
    setActiveTab(field);
    setTimeout(() => chatInputRef.current?.focus(), 50);
  };

  const handleSend = async () => {
    if (!inputValue.trim()) return;
    setIsLoading(true);
    const msg = inputValue;
    setInputValue("");
    try {
      const response = await window.programs.agentSuggestUpdate({
        projectId,
        provider: settings.advancedDefaults.provider,
        model: settings.advancedDefaults.model,
        claudeModel: settings.advancedDefaults.claudeModel,
        message: msg,
      });
      setUpdateAiMessage(response.aiMessage);
      if (response.proposal) {
        setPendingProposal(response.proposal);
        setEditedProposal(response.proposal);
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Failed to get suggestion.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = async (proposal: CoreDetailsProposal) => {
    try {
      const session = await window.programs.agentApplyCoreDetails({ projectId, proposal });
      setCoreDetails({
        function: session.stages.function.confirmed ?? null,
        thesis: session.stages.thesis.confirmed ?? null,
        corePillars: session.corePillars,
        fullFlow: session.stages.full_flow.confirmed ?? null,
      });
      setPendingProposal(null);
      setEditedProposal(null);
      setUpdateAiMessage(null);
      pushToast("Core details updated.", "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Failed to apply update.", "error");
    }
  };

  const expandedPillar = expandedPillarId
    ? coreDetails.corePillars.find((p) => p.id === expandedPillarId) ?? null
    : null;

  return (
    <Modal title="Core Details" onClose={onClose} fullscreen>
      <div className="agentInfoTabs">
        {(["function", "thesis", "core_pillars", "full_flow"] as const).map((tab) => (
          <button
            key={tab}
            className={`agentInfoTabBtn${activeTab === tab ? " active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "function" ? "Function" : tab === "thesis" ? "Thesis" : tab === "core_pillars" ? "Core Pillars" : "Full Flow"}
          </button>
        ))}
      </div>

      <div className="coreDetailsPanelContent">
        {activeTab === "function" ? (
          <div className="coreDetailItem">
            {(functionStatus === "assumed" || functionStatus === "edited") ? (
              <>
                <p className="assumedText">{coreDetails.function?.summary}</p>
                <div className="coreDetailReviewActions">
                  <button className="coreDetailConfirmBtn" onClick={() => void handleConfirmDetail("function")}>Confirm</button>
                  <button className="coreDetailEditBtn" onClick={() => focusEditForField("function")}>Edit</button>
                </div>
              </>
            ) : (
              <p>{coreDetails.function?.summary ?? "Not yet defined. Define in Agents page."}</p>
            )}
          </div>
        ) : activeTab === "thesis" ? (
          <div className="coreDetailItem">
            {(thesisStatus === "assumed" || thesisStatus === "edited") ? (
              <>
                <p className="assumedText">{coreDetails.thesis?.summary}</p>
                <div className="coreDetailReviewActions">
                  <button className="coreDetailConfirmBtn" onClick={() => void handleConfirmDetail("thesis")}>Confirm</button>
                  <button className="coreDetailEditBtn" onClick={() => focusEditForField("thesis")}>Edit</button>
                </div>
              </>
            ) : (
              <p>{coreDetails.thesis?.summary ?? "Not yet defined. Define in Agents page."}</p>
            )}
          </div>
        ) : activeTab === "core_pillars" ? (
          <div className="coreDetailItem">
            {(pillarsStatus === "assumed" || pillarsStatus === "edited") && (
              <div className="coreDetailReviewActions" style={{ marginBottom: 10 }}>
                <span className="assumedText" style={{ fontSize: "0.75rem" }}>AI-generated — please review</span>
                <button className="coreDetailConfirmBtn" onClick={() => void handleConfirmDetail("core_pillars")}>Confirm All</button>
                <button className="coreDetailEditBtn" onClick={() => focusEditForField("core_pillars")}>Edit</button>
              </div>
            )}
            {coreDetails.corePillars.length > 0 ? (
              <>
                <div className="corePillarChips">
                  {coreDetails.corePillars.map((pillar) => (
                    <button
                      key={pillar.id}
                      className={`corePillarChip${expandedPillarId === pillar.id ? " active" : ""}`}
                      onClick={() => setExpandedPillarId(expandedPillarId === pillar.id ? null : pillar.id)}
                    >
                      {pillar.name}
                    </button>
                  ))}
                </div>
                {expandedPillar ? <CoreDetailsPillarExpanded pillar={expandedPillar} /> : null}
              </>
            ) : (
              <p>Not yet defined. Define in Agents page.</p>
            )}
          </div>
        ) : (
          <div className="coreDetailItem">
            {(fullFlowStatus === "assumed" || fullFlowStatus === "edited") ? (
              <>
                <p className="assumedText">{coreDetails.fullFlow?.summary}</p>
                <div className="coreDetailReviewActions">
                  <button className="coreDetailConfirmBtn" onClick={() => void handleConfirmDetail("full_flow")}>Confirm</button>
                  <button className="coreDetailEditBtn" onClick={() => focusEditForField("full_flow")}>Edit</button>
                </div>
              </>
            ) : coreDetails.fullFlow?.steps && coreDetails.fullFlow.steps.length > 0 ? (
              <ol className="flowStepList">
                {coreDetails.fullFlow.steps.map((step) => (
                  <li key={step.id} className="flowStepItem">
                    <div>
                      <div>{step.description}</div>
                      {step.pillarIds.length > 0 ? (
                        <div className="flowStepPillars">
                          {step.pillarIds.map((pid) => {
                            const pillar = coreDetails.corePillars.find((p) => p.id === pid);
                            return pillar ? (
                              <span key={pid} className="flowStepPillarTag">{pillar.name}</span>
                            ) : null;
                          })}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p>{coreDetails.fullFlow?.summary ?? "Not yet defined. Define in Agents page."}</p>
            )}
          </div>
        )}
      </div>

      {updateAiMessage || editedProposal ? (
        <div className="coreDetailsAiSection">
          {updateAiMessage ? (
            <div className="updateAiMessage">{updateAiMessage}</div>
          ) : null}
          {editedProposal ? (
            <div className="pendingProposalCard">
              <h5>Proposed Changes</h5>
              {editedProposal.updatedFunction != null ? (
                <div className="proposalField">
                  <div className="proposalFieldLabel">Function</div>
                  <textarea
                    className="proposalFieldValue"
                    value={editedProposal.updatedFunction}
                    onChange={(e) => setEditedProposal({ ...editedProposal, updatedFunction: e.target.value })}
                  />
                </div>
              ) : null}
              {editedProposal.updatedThesis != null ? (
                <div className="proposalField">
                  <div className="proposalFieldLabel">Thesis</div>
                  <textarea
                    className="proposalFieldValue"
                    value={editedProposal.updatedThesis}
                    onChange={(e) => setEditedProposal({ ...editedProposal, updatedThesis: e.target.value })}
                  />
                </div>
              ) : null}
              {editedProposal.updatedFullFlow != null ? (
                <div className="proposalField">
                  <div className="proposalFieldLabel">Full-Flow</div>
                  <textarea
                    className="proposalFieldValue"
                    value={editedProposal.updatedFullFlow}
                    onChange={(e) => setEditedProposal({ ...editedProposal, updatedFullFlow: e.target.value })}
                  />
                </div>
              ) : null}
              {editedProposal.updatedCorePillars != null ? (
                <div className="proposalField">
                  <div className="proposalFieldLabel">Core Pillars</div>
                  <p className="coreDetailValue" style={{ fontSize: "0.8rem", margin: "2px 0 0" }}>
                    {editedProposal.updatedCorePillars.map((p) => p.name).join(", ")}
                  </p>
                </div>
              ) : null}
              <div className="proposalActions">
                <button className="primaryButton" onClick={() => void handleApply(editedProposal)}>Confirm</button>
                <button className="secondaryButton" onClick={() => { setPendingProposal(null); setEditedProposal(null); setUpdateAiMessage(null); }}>Dismiss</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="coreDetailsInputRow">
        <textarea
          ref={chatInputRef}
          className="plannerInput"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Describe what to update..."
          disabled={isLoading}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <button
          className="primaryButton"
          onClick={() => void handleSend()}
          disabled={!inputValue.trim() || isLoading}
        >
          {isLoading ? <RunningIndicator /> : "Send"}
        </button>
      </div>
    </Modal>
  );
}

function TodoNotepad({
  projectId,
  agentSession,
  settings,
  onClose,
  onSessionUpdate,
  pushToast,
}: {
  projectId: string;
  agentSession: AgentSession | null;
  settings: Settings;
  onClose: () => void;
  onSessionUpdate: (session: AgentSession | null) => void;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
}) {
  const [inputValue, setInputValue] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const scratchpad = agentSession?.scratchpad ?? [];
  const activeTodos = scratchpad.filter((s) => !s.completed);
  const completedTodos = scratchpad.filter((s) => s.completed);

  const handleAddTodo = () => {
    if (!inputValue.trim() || !agentSession) return;
    const newItem: ScratchpadItem = {
      id: crypto.randomUUID(),
      text: inputValue.trim(),
      completed: false,
      source: "user",
      createdAt: new Date().toISOString(),
    };
    const updated = [...agentSession.scratchpad, newItem];
    setInputValue("");
    void window.programs.agentUpdateScratchpad({
      projectId,
      scratchpad: updated,
    });
  };

  const handleRemoveTodo = (itemId: string) => {
    if (!agentSession) return;
    const updated = agentSession.scratchpad.filter((s) => s.id !== itemId);
    void window.programs.agentUpdateScratchpad({
      projectId,
      scratchpad: updated,
    });
  };

  const handleProcessTodos = async () => {
    if (activeTodos.length === 0) return;
    setIsProcessing(true);
    try {
      await window.programs.agentProcessTodosFromProgram({
        projectId,
        provider: settings.advancedDefaults.provider,
        model: settings.advancedDefaults.model,
        claudeModel: settings.advancedDefaults.claudeModel,
        newTodos: [],
      });
      pushToast("To-dos processed into planned updates.", "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Failed to process to-dos.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="todoNotepadOverlay">
      <div className="todoNotepadHeader">
        <span>To-do</span>
        <button className="deleteBtn" onClick={onClose}>&times;</button>
      </div>
      <div className="todoNotepadList">
        {activeTodos.map((item) => (
          <div key={item.id} className={`todoItem todoItem--${item.source}`}>
            <span className="todoItemText">{item.text}</span>
            <button className="deleteBtn" onClick={() => handleRemoveTodo(item.id)}>&times;</button>
          </div>
        ))}
        {completedTodos.length > 0 ? (
          <>
            <div className="todoCompletedDivider">Processed</div>
            {completedTodos.map((item) => (
              <div key={item.id} className="todoItem todoItem--completed">
                <span className="todoItemText">{item.text}</span>
              </div>
            ))}
          </>
        ) : null}
      </div>
      <div className="todoNotepadInput">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Add a to-do..."
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAddTodo();
            }
          }}
        />
      </div>
      {activeTodos.length > 0 ? (
        <button
          className="primaryButton"
          style={{ width: "100%", marginTop: 8 }}
          onClick={() => void handleProcessTodos()}
          disabled={isProcessing}
        >
          {isProcessing ? "Processing..." : "Process To-dos"}
        </button>
      ) : null}
    </div>
  );
}

function ProgramModeSwitchRow({
  programMode,
  onModeChange,
  project,
  skills,
  attachedSkillId,
  onAttachSkill,
  onSync,
  isSyncing,
  pushToast,
}: {
  programMode: ProgramUpdateMode;
  onModeChange: (mode: ProgramUpdateMode) => void;
  project: Project;
  skills: Skill[];
  attachedSkillId: string | null;
  onAttachSkill: (skillId: string | null) => void;
  onSync: () => void;
  isSyncing: boolean;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
}) {
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const attachableSkills = skills.filter((skill) => skill.installStatus === "ready");

  useEffect(() => {
    void window.programs.readProjectDiffStats(project.id).then(setDiffStats).catch(() => {});
  }, [project.id]);

  const attachedSkill = skills.find((s) => s.id === attachedSkillId) ?? null;

  return (
    <div className="programModeSwitchRow">
      <div className="programModeSwitch">
        {(["talk", "plan", "work"] as const).map((mode) => (
          <button
            key={mode}
            className={programMode === mode ? "toggleOption active" : "toggleOption"}
            onClick={() => onModeChange(mode)}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>

      <div className="skillAttachmentArea">
        <button
          className="skillAttachButton"
          onClick={() => setShowSkillPicker(!showSkillPicker)}
        >
          {attachedSkill ? attachedSkill.name : "Skill"}
        </button>
        {showSkillPicker ? (
          <div className="skillPickerPopover">
            <button className="skillPickerItem" onClick={() => { onAttachSkill(null); setShowSkillPicker(false); }}>
              None
            </button>
            {skills.map((skill) => (
              <button
                key={skill.id}
                className={`skillPickerItem${skill.id === attachedSkillId ? " active" : ""}`}
                onClick={() => { onAttachSkill(skill.id); setShowSkillPicker(false); }}
                disabled={skill.installStatus !== "ready"}
              >
                {skill.name}
                <span className="skillBadge">
                  {skill.installStatus !== "ready"
                    ? skill.installStatus
                    : skill.isUniversal
                      ? "Universal"
                      : skill.sourceProvider}
                </span>
              </button>
            ))}
            {skills.length === 0 ? <p className="skillPickerEmpty">No skills yet. Add them in the Agents page.</p> : null}
            {skills.length > 0 && attachableSkills.length === 0 ? (
              <p className="skillPickerEmpty">Installed skills are still unavailable. Finish or retry the install first.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="gitSyncPanel">
        {diffStats ? (
          <span className="gitSyncStats">
            <span className="gitSyncAdded">+{diffStats.added}</span>
            <span className="gitSyncRemoved">-{diffStats.removed}</span>
          </span>
        ) : (
          <span className="gitSyncStats gitSyncEmpty">No changes</span>
        )}
        <button
          className="secondaryButton gitSyncButton"
          onClick={() => {
            onSync();
            // Refresh diff stats after sync
            setTimeout(() => {
              void window.programs.readProjectDiffStats(project.id).then(setDiffStats).catch(() => {});
            }, 2000);
          }}
          disabled={isSyncing || !project.remoteUrl}
          title={project.remoteUrl ? "Commit and push to GitHub" : "No remote URL configured"}
        >
          {isSyncing ? "Syncing..." : "Sync"}
        </button>
      </div>
    </div>
  );
}

function ProgramTodoList({
  projectId,
  mode,
  settings,
  pushToast,
}: {
  projectId: string;
  mode: "talk" | "plan";
  settings: Settings;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
}) {
  const [todos, setTodos] = useState<UnifiedTodoItem[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const loadTodos = () => {
    void window.programs.listTodos({ projectId, includeProcessed: false }).then(setTodos).catch(() => {});
  };

  useEffect(() => {
    loadTodos();
  }, [projectId]);

  // Listen for todo updates
  useEffect(() => {
    const handler = (event: AppEvent) => {
      if (event.type === "app.event" && event.event === "todos.updated") {
        loadTodos();
      }
    };
    const unsubscribe = window.programs.onEvent(handler);
    return unsubscribe;
  }, [projectId]);

  const handleAdd = () => {
    if (!inputValue.trim()) return;
    void window.programs.addTodo({ text: inputValue.trim(), projectId, source: "user" }).then(() => {
      setInputValue("");
      loadTodos();
    });
  };

  const handleRemove = (id: string) => {
    void window.programs.removeTodo(id).then(loadTodos);
  };

  const handleProcessTodos = async () => {
    if (todos.length === 0) return;
    setIsProcessing(true);
    try {
      await window.programs.agentProcessTodosFromProgram({
        projectId,
        provider: settings.advancedDefaults.provider,
        model: settings.advancedDefaults.model,
        claudeModel: settings.advancedDefaults.claudeModel,
        newTodos: [],
      });
      pushToast("To-dos processed into planned updates.", "success");
      loadTodos();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Failed to process to-dos.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="programTodoList">
      {todos.map((item) => (
        <div key={item.id} className={`unifiedTodoItem unifiedTodoItem--${item.source}`}>
          <span className="unifiedTodoBullet">&bull;</span>
          <span className="unifiedTodoText">{item.text}</span>
          <button className="deleteBtn" onClick={() => handleRemove(item.id)}>&times;</button>
        </div>
      ))}
      {todos.length === 0 ? (
        <p className="programTodoEmpty">No to-do items yet.</p>
      ) : null}
      <div className="programTodoInputRow">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Add a to-do..."
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
      </div>
      {mode === "plan" && todos.length > 0 ? (
        <button
          className="primaryButton"
          style={{ width: "100%", marginTop: 8 }}
          onClick={() => void handleProcessTodos()}
          disabled={isProcessing}
        >
          {isProcessing ? "Processing..." : "Process into Plan"}
        </button>
      ) : null}
    </div>
  );
}

function SimpleFlowchart({
  pillars,
  confirmation,
  selectedNodeId,
  onSelectNode,
}: {
  pillars: CorePillar[];
  confirmation: AgentStageConfirmation | null;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
}) {
  const defaultText = confirmation?.flowchartParagraph ?? confirmation?.summary ?? null;
  const nodeDescriptions = confirmation?.nodeDescriptions ?? {};

  const selectedDescription = selectedNodeId ? nodeDescriptions[selectedNodeId] ?? null : null;

  return (
    <div className="simpleFlowchart">
      <div className="simpleFlowchartNodes">
        {pillars.map((pillar, idx) => (
          <div key={pillar.id} className="simpleFlowchartNodeGroup">
            {idx > 0 && <div className="simpleFlowchartArrow">&rarr;</div>}
            <button
              className={`simpleFlowchartNode${selectedNodeId === pillar.id ? " selected" : ""}`}
              onClick={() => onSelectNode(pillar.id)}
              title={pillar.name}
            >
              {pillar.name}
            </button>
          </div>
        ))}
      </div>
      <div className="simpleFlowchartDescription">
        {selectedDescription ?? defaultText ?? <em className="coreDetailEmpty">No flow description yet</em>}
      </div>
    </div>
  );
}

function CascadeCard({
  cascade,
  onAccept,
  onReject,
}: {
  cascade: CascadeProposal;
  onAccept: (acceptedStages: AgentStage[], editedSummaries?: Record<string, string>) => void;
  onReject: () => void;
}) {
  const [checkedStages, setCheckedStages] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const u of cascade.proposedUpdates) init[u.stage] = true;
    return init;
  });
  const [editedTexts, setEditedTexts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const u of cascade.proposedUpdates) init[u.stage] = u.updatedSummary;
    return init;
  });

  const handleToggle = (stage: string) => {
    setCheckedStages((prev) => ({ ...prev, [stage]: !prev[stage] }));
  };

  const handleAccept = () => {
    const accepted = cascade.proposedUpdates
      .filter((u) => checkedStages[u.stage])
      .map((u) => u.stage);
    const edited: Record<string, string> = {};
    for (const u of cascade.proposedUpdates) {
      if (checkedStages[u.stage] && editedTexts[u.stage] !== u.updatedSummary) {
        edited[u.stage] = editedTexts[u.stage];
      }
    }
    onAccept(accepted, Object.keys(edited).length > 0 ? edited : undefined);
  };

  return (
    <div className="cascadeCard">
      <h5 className="cascadeCardTitle">Cascade Updates</h5>
      <p className="cascadeCardSubtitle">
        Updating <strong>{AGENT_STAGE_LABELS[cascade.triggeredByStage]}</strong> may affect these sections:
      </p>
      <div className="cascadeItems">
        {cascade.proposedUpdates.map((update) => (
          <div key={update.stage} className="cascadeItem">
            <label className="cascadeItemHeader">
              <input
                type="checkbox"
                checked={checkedStages[update.stage] ?? false}
                onChange={() => handleToggle(update.stage)}
              />
              <span className="cascadeItemLabel">{AGENT_STAGE_LABELS[update.stage]}</span>
            </label>
            <textarea
              className="cascadeItemText"
              value={editedTexts[update.stage] ?? ""}
              onChange={(e) => setEditedTexts((prev) => ({ ...prev, [update.stage]: e.target.value }))}
              disabled={!checkedStages[update.stage]}
            />
          </div>
        ))}
      </div>
      <div className="cascadeActions">
        <button className="primaryButton" onClick={handleAccept}>
          Accept Selected
        </button>
        <button className="secondaryButton" onClick={onReject}>
          Reject All
        </button>
      </div>
    </div>
  );
}

const PILLAR_TYPE_LABELS: Record<PillarType, string> = {
  core: "Core",
  side: "Side",
  ghost: "Ghost",
  tbd: "TBD",
  "hard-stop": "Hard Stop",
};

function DirectorInfoPanel({
  directorId,
  focusMode,
  session,
  projectId,
  onSessionUpdate,
  onNavigateToDirector,
  pushToast,
}: {
  directorId: DirectorId;
  focusMode: DirectorFocusMode | null;
  session: AgentSession | null;
  projectId: string;
  onSessionUpdate: (session: AgentSession) => void;
  onNavigateToDirector: (directorId: DirectorId) => void;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
}) {
  const [expandedPillarId, setExpandedPillarId] = useState<string | null>(null);
  const [activeInfoTab, setActiveInfoTab] = useState<"function" | "thesis" | "core_pillars" | "full_flow">("function");

  if (!session) return null;

  switch (directorId) {
    case "project-manager":
      return (
        <div className="agentInfoPanel">
          <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Project Status Overview</h5>
          <div className="pmStatusGrid">
            <div className="pmStatusCard">
              <span className="pmStatusLabel">Dan — Creative</span>
              <span className={`pmStatusValue${session.stages.function.confirmed && session.stages.thesis.confirmed ? " pmStatusDone" : ""}`}>
                {session.stages.function.confirmed && session.stages.thesis.confirmed && session.stages.core_pillars.confirmed && session.stages.full_flow.confirmed
                  ? "Complete" : "In Progress"}
              </span>
            </div>
            <div className="pmStatusCard">
              <span className="pmStatusLabel">Todd — R&D</span>
              <span className={`pmStatusValue${session.versions.length > 0 ? " pmStatusDone" : ""}`}>
                {session.versions.length > 0 ? `${session.versions.length} versions` : "Pending"}
              </span>
            </div>
            <div className="pmStatusCard">
              <span className="pmStatusLabel">Ping — Programming</span>
              <span className="pmStatusValue">
                {session.versionUpdates.filter((u) => u.status === "completed").length}/{session.versionUpdates.length} updates
              </span>
            </div>
            <div className="pmStatusCard">
              <span className="pmStatusLabel">Brad — Validation</span>
              <span className="pmStatusValue">
                {session.validationResults.length > 0 ? `${session.validationResults.length} results` : "None yet"}
              </span>
            </div>
          </div>
        </div>
      );

    case "creative-director": {
      // Dan: mode-dependent panel
      if (focusMode === "conversation") {
        return (
          <div className="agentInfoPanel">
            <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Conversation Mode</h5>
            {session.danInternalNotes.length > 0 ? (
              <p className="danNotesIndicator">{session.danInternalNotes.length} internal note{session.danInternalNotes.length !== 1 ? "s" : ""} recorded</p>
            ) : null}
            <p className="coreDetailValue">Brainstorm freely. Dan is listening and taking notes.</p>
          </div>
        );
      }

      if (focusMode === "vibes") {
        const allVibes: { pillarName: string; vibe: VibeAttachment }[] = [];
        const collectVibes = (pillars: CorePillar[], prefix = "") => {
          for (const p of pillars) {
            const name = prefix ? `${prefix} > ${p.name}` : p.name;
            for (const v of (p.vibes ?? [])) allVibes.push({ pillarName: name, vibe: v });
            collectVibes(p.corePillars, name);
          }
        };
        collectVibes(session.corePillars);
        return (
          <div className="agentInfoPanel">
            <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>
              Vibe Gallery ({allVibes.length} vibes across all pillars)
            </h5>
            {allVibes.length > 0 ? (
              <div className="vibeGallery">
                {allVibes.map(({ pillarName, vibe }) => (
                  <div key={vibe.id} className="vibeGalleryItem">
                    <span className="vibeThumbIcon">{vibe.fileType === "image" ? "\u{1F5BC}" : "\u{1F4C4}"}</span>
                    <div className="vibeGalleryMeta">
                      <span className="vibeThumbName">{vibe.fileName}</span>
                      <span className="vibeGalleryPillar">{pillarName}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="coreDetailEmpty">No vibes attached yet. Attach vibes to core pillars.</p>
            )}
          </div>
        );
      }

      // Default: core-details mode
      return (
        <div className="agentInfoPanel">
          <div className="agentInfoTabs">
            {(["function", "thesis", "core_pillars", "full_flow"] as const).map((tab) => (
              <button
                key={tab}
                className={`agentInfoTabBtn${activeInfoTab === tab ? " active" : ""}`}
                onClick={() => setActiveInfoTab(tab)}
              >
                {tab === "function" ? "Function" : tab === "thesis" ? "Thesis" : tab === "core_pillars" ? "Core Pillars" : "Full Flow"}
              </button>
            ))}
          </div>
          <div className="agentInfoTabContent">
            {activeInfoTab === "function" ? (
              <p className="coreDetailValue">
                {session.stages.function.confirmed ? (
                  <span className={session.stages.function.confirmed.status === "assumed" ? "assumedText" : ""}>
                    {session.stages.function.confirmed.summary}
                  </span>
                ) : <em className="coreDetailEmpty">Not yet defined</em>}
              </p>
            ) : activeInfoTab === "thesis" ? (
              <p className="coreDetailValue">
                {session.stages.thesis.confirmed ? (
                  <span className={session.stages.thesis.confirmed.status === "assumed" ? "assumedText" : ""}>
                    {session.stages.thesis.confirmed.summary}
                  </span>
                ) : <em className="coreDetailEmpty">Not yet defined</em>}
              </p>
            ) : activeInfoTab === "core_pillars" ? (
              (session.corePillars.length ?? 0) > 0 ? (
                <>
                  <div className="corePillarChips">
                    {session.corePillars.map((p) => (
                      <button
                        key={p.id}
                        className={`corePillarChip${expandedPillarId === p.id ? " active" : ""}`}
                        onClick={() => setExpandedPillarId(expandedPillarId === p.id ? null : p.id)}
                      >
                        <span className={`pillarTypeBadge pillarTypeBadge--${p.pillarType}`}>{PILLAR_TYPE_LABELS[p.pillarType]}</span>
                        {p.name}
                      </button>
                    ))}
                  </div>
                  {expandedPillarId ? (() => {
                    const pillar = session.corePillars.find((x) => x.id === expandedPillarId);
                    return pillar ? (
                      <CoreDetailsPillarExpanded
                        pillar={pillar}
                        projectId={projectId}
                        onSessionUpdate={onSessionUpdate}
                        pushToast={pushToast}
                      />
                    ) : null;
                  })() : null}
                </>
              ) : <em className="coreDetailEmpty">Not yet defined</em>
            ) : (
              (session.corePillars.length ?? 0) > 0 && session.stages.full_flow.confirmed ? (
                <SimpleFlowchart
                  pillars={session.corePillars}
                  confirmation={session.stages.full_flow.confirmed}
                  selectedNodeId={expandedPillarId}
                  onSelectNode={(id) => setExpandedPillarId(expandedPillarId === id ? null : id)}
                />
              ) : (
                <p className="coreDetailValue">
                  {session.stages.full_flow.confirmed?.summary ?? <em className="coreDetailEmpty">Not yet defined</em>}
                </p>
              )
            )}
          </div>
          {session.stages.function.confirmed && session.stages.thesis.confirmed && session.stages.core_pillars.confirmed && session.stages.full_flow.confirmed ? (
            <button className="primaryButton" style={{ marginTop: 12, fontSize: "0.8rem" }} onClick={() => onNavigateToDirector("rd-director")}>
              Proceed to R&D
            </button>
          ) : null}
        </div>
      );
    }

    case "rd-director": {
      // Todd: mode-dependent panel
      if (focusMode === "research" || !focusMode) {
        return (
          <div className="agentInfoPanel">
            <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Feasibility Assessments</h5>
            {session.feasibilityAssessments.length > 0 ? (
              <div className="feasibilityList">
                {session.feasibilityAssessments.map((a) => (
                  <div key={a.id} className="feasibilityCard">
                    <div className="feasibilityHeader">
                      <span className={a.status === "assumed" ? "assumedText" : ""}>{a.area}</span>
                      <span className={`complexityBadge complexityBadge--${a.complexity}`}>{a.complexity}</span>
                    </div>
                    <p className={`feasibilityText${a.status === "assumed" ? " assumedText" : ""}`}>{a.assessment}</p>
                    {a.stackRecommendation ? <p className="feasibilityStack">Stack: {a.stackRecommendation}</p> : null}
                    {a.costNotes ? <p className="feasibilityCost">Cost: {a.costNotes}</p> : null}
                    {a.status === "assumed" ? (
                      <div className="coreDetailReviewActions">
                        <button className="coreDetailConfirmBtn" onClick={() => void window.programs.confirmAgentData({ projectId, dataType: "feasibility", itemId: a.id }).then(onSessionUpdate)}>Confirm</button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : <em className="coreDetailEmpty">No assessments yet. Discuss your concept to get feasibility analysis.</em>}
          </div>
        );
      }

      if (focusMode === "version-planning") {
        return (
          <div className="agentInfoPanel">
            <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Version Plans</h5>
            {session.versions.length > 0 ? (
              <div className="versionTimeline">
                {session.versions.sort((a, b) => a.order - b.order).map((v) => (
                  <div key={v.id} className="versionCard">
                    <div className="versionHeader">
                      <span className={`versionLabel${v.status === "assumed" ? " assumedText" : ""}`}>{v.label}</span>
                      <StatusChip tone={v.status === "confirmed" ? "confirmed" : v.status === "assumed" ? "action_required" : "info"}>{v.status}</StatusChip>
                    </div>
                    <p className={v.status === "assumed" ? "assumedText" : ""}>{v.description}</p>
                    <ul className="versionGoals">
                      {v.goals.map((g, i) => <li key={i}>{g}</li>)}
                    </ul>
                    {v.status === "assumed" ? (
                      <div className="coreDetailReviewActions">
                        <button className="coreDetailConfirmBtn" onClick={() => void window.programs.confirmAgentData({ projectId, dataType: "versions", itemId: v.id }).then(onSessionUpdate)}>Confirm</button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : <em className="coreDetailEmpty">No version plans yet. Start with feasibility research.</em>}
          </div>
        );
      }

      // update-planning mode
      const groupedByVersion: Record<string, VersionUpdate[]> = {};
      for (const u of session.versionUpdates) {
        const v = session.versions.find((ver) => ver.id === u.versionId);
        const label = v?.label ?? "Unassigned";
        if (!groupedByVersion[label]) groupedByVersion[label] = [];
        groupedByVersion[label].push(u);
      }
      return (
        <div className="agentInfoPanel">
          <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Update Plan</h5>
          {session.versionUpdates.length > 0 ? (
            <div className="updatePlanList">
              {Object.entries(groupedByVersion).map(([versionLabel, updates]) => (
                <div key={versionLabel} className="updatePlanGroup">
                  <h6 className="updatePlanGroupLabel">{versionLabel}</h6>
                  {updates.sort((a, b) => a.order - b.order).map((u, idx) => (
                    <div key={u.id} className="agentPlannedUpdateItem">
                      <span className="orderBadge">{idx + 1}</span>
                      <div className="updateContent">
                        <div className="updateTitle">{u.title}</div>
                        <div className="updateDescription">{u.description}</div>
                      </div>
                      <StatusChip tone={u.status === "completed" ? "confirmed" : u.status === "failed" ? "action_required" : u.status === "in_progress" ? "info" : "neutral"}>{u.status}</StatusChip>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : <em className="coreDetailEmpty">No updates planned yet. Define version plans first.</em>}
        </div>
      );
    }

    case "programming-director":
      return (
        <div className="agentInfoPanel">
          <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Programming Queue</h5>
          {session.versionUpdates.filter((u) => u.status === "pending" || u.status === "in_progress").length > 0 ? (
            <div className="programmingQueue">
              {session.versionUpdates.filter((u) => u.status === "pending" || u.status === "in_progress").map((u) => (
                <div key={u.id} className="agentPlannedUpdateItem">
                  <div className="updateContent">
                    <div className="updateTitle">{u.title}</div>
                    <div className="updateDescription">{u.description}</div>
                  </div>
                  <StatusChip tone={u.status === "in_progress" ? "info" : "neutral"}>{u.status}</StatusChip>
                </div>
              ))}
            </div>
          ) : <em className="coreDetailEmpty">No updates in the programming queue.</em>}
          {session.dynamicSubAgents.length > 0 ? (
            <>
              <h5 style={{ margin: "12px 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Sub-Agents</h5>
              <div className="agentTileGrid" style={{ gap: 8 }}>
                {session.dynamicSubAgents.map((sa) => (
                  <div key={sa.id} className="pmStatusCard" style={{ background: "var(--panel)" }}>
                    <span className="pmStatusLabel">{sa.name}</span>
                    <span className="pmStatusValue">{sa.role}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      );

    case "validation-director": {
      // Brad: mode-dependent panel
      if (focusMode === "identify-goal") {
        return (
          <div className="agentInfoPanel">
            <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Identify Goal</h5>
            <p className="coreDetailValue">Reviewing core-details and vibes for the most recently updated pillars.</p>
          </div>
        );
      }

      if (focusMode === "test-current-state") {
        return (
          <div className="agentInfoPanel">
            <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Test Current-State</h5>
            {session.validationResults.length > 0 ? (
              <div className="validationResultsList">
                {session.validationResults.slice(-5).map((r) => (
                  <div key={r.id} className={`validationResultCard validationResultCard--${r.passed ? "pass" : "fail"}`}>
                    <span className="validationResultType">{r.validationType}</span>
                    <span className={`validationResultStatus${r.passed ? " pmStatusDone" : ""}`}>{r.passed ? "PASS" : "FAIL"}</span>
                    <p>{r.summary}</p>
                  </div>
                ))}
              </div>
            ) : <em className="coreDetailEmpty">No test results yet.</em>}
          </div>
        );
      }

      // compare mode (default)
      return (
        <div className="agentInfoPanel">
          <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Compare</h5>
          <div className="validationFrequencyRow">
            <span className="pillarDetailLabel">Frequency:</span>
            <select
              className="plannerSelect"
              value={session.validationFrequency}
              onChange={(e) => void window.programs.setValidationFrequency({ projectId, frequency: e.target.value as "every-update" | "every-version" | "manual" }).then(onSessionUpdate)}
            >
              <option value="manual">Manual</option>
              <option value="every-update">Every Update</option>
              <option value="every-version">Every Version</option>
            </select>
          </div>
          {session.validationResults.length > 0 ? (
            <div className="validationResultsList">
              {session.validationResults.map((r) => (
                <div key={r.id} className={`validationResultCard validationResultCard--${r.passed ? "pass" : "fail"}`}>
                  <span className="validationResultType">{r.validationType}</span>
                  <span className={`validationResultStatus${r.passed ? " pmStatusDone" : ""}`}>{r.passed ? "PASS" : "FAIL"}</span>
                  <p>{r.summary}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      );
    }

    default:
      return null;
  }
}

function AgentsPage({
  projects,
  settings,
  agentSession,
  agentSelectedProjectId,
  agentViewStage,
  modelCatalog,
  onSelectProject,
  onSetViewStage,
  onSessionUpdate,
  pushToast,
}: {
  projects: Project[];
  settings: Settings;
  agentSession: AgentSession | null;
  agentSelectedProjectId: string | null;
  agentViewStage: AgentStage;
  modelCatalog: ModelCatalog;
  onSelectProject: (projectId: string | null) => void;
  onSetViewStage: (stage: AgentStage) => void;
  onSessionUpdate: (session: AgentSession) => void;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
}) {
  const [selectedDirectorId, setSelectedDirectorId] = useState<DirectorId | null>(null);
  const [activeFocusMode, setActiveFocusMode] = useState<DirectorFocusMode | null>(null);
  const [showProgressPanel, setShowProgressPanel] = useState(false);
  const [showDirectorProfile, setShowDirectorProfile] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [lastRouteHint, setLastRouteHint] = useState<{ directorId: DirectorId; reason: string } | null>(null);
  const [optimisticAgentMessages, setOptimisticAgentMessages] = useState<AgentChatMessage[]>([]);

  const DIRECTOR_STATUS: Record<DirectorId, string> = {
    "project-manager": "Project Director",
    "creative-director": "Creative Director",
    "rd-director": "R&D Director",
    "programming-director": "Programming Director",
    "validation-director": "Validation Director",
  };
  const [agentComposerOptions, setAgentComposerOptions] = useState<ComposerOptions>({
    ...getComposerDefaults(settings),
    planningMode: "none",
  });
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

  const DIRECTOR_SECTIONS: {
    id: DirectorId;
    label: string;
    color: string;
    subtitle: string;
    focusModes?: DirectorFocusMode[];
  }[] = [
    { id: "project-manager", label: "Jeff — Project Manager",
      color: DIRECTOR_COLORS["project-manager"], subtitle: "Oversees all directors" },
    { id: "creative-director", label: "Dan — Creative Director",
      color: DIRECTOR_COLORS["creative-director"], subtitle: "Conversation · Core-details · Vibes",
      focusModes: ["conversation", "core-details", "vibes"] as CreativeFocusMode[] },
    { id: "rd-director", label: "Todd — R&D Director",
      color: DIRECTOR_COLORS["rd-director"], subtitle: "Research · Version Planning · Update Planning",
      focusModes: ["research", "version-planning", "update-planning"] as RdFocusMode[] },
    { id: "programming-director", label: "Ping — Programming Director",
      color: DIRECTOR_COLORS["programming-director"], subtitle: "Lead programmer + skill-based sub-agents" },
    { id: "validation-director", label: "Brad — Validation Director",
      color: DIRECTOR_COLORS["validation-director"], subtitle: "Identify Goal · Test Current-State · Compare",
      focusModes: ["identify-goal", "test-current-state", "compare"] as ValidationFocusMode[] },
  ];

  const selectedDirector = DIRECTOR_SECTIONS.find((d) => d.id === selectedDirectorId) ?? null;

  const persistedDirectorMessages = selectedDirectorId
    ? agentSession?.directorConversations?.[selectedDirectorId]?.messages ?? agentSession?.agentConversations?.[selectedDirectorId]?.messages ?? []
    : [];
  const currentDirectorMessages = [...persistedDirectorMessages, ...optimisticAgentMessages];

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [currentDirectorMessages.length, isLoading]);

  useEffect(() => {
    setOptimisticAgentMessages([]);
  }, [persistedDirectorMessages.length]);

  useLayoutEffect(() => {
    syncComposerTextareaHeight(composerInputRef.current);
  }, [inputValue, agentSelectedProjectId, selectedDirectorId]);

  const handleSelectDirector = (directorId: DirectorId) => {
    setSelectedDirectorId(directorId);
    setLastRouteHint(null);
    const director = DIRECTOR_SECTIONS.find((d) => d.id === directorId);
    if (director?.focusModes?.length) {
      const stored = agentSession?.directorConversations?.[directorId]?.focusMode ?? null;
      setActiveFocusMode(stored ?? director.focusModes[0]);
    } else {
      setActiveFocusMode(null);
    }
  };

  const handleFocusModeChange = async (mode: DirectorFocusMode) => {
    setActiveFocusMode(mode);
    if (agentSelectedProjectId && selectedDirectorId) {
      try {
        const updated = await window.programs.setDirectorFocusMode(agentSelectedProjectId, selectedDirectorId, mode);
        onSessionUpdate(updated);
      } catch {
        // Focus mode state is already set locally; backend sync is best-effort
      }
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || !agentSelectedProjectId || !selectedDirectorId) return;
    const msg = inputValue;
    setInputValue("");
    setLastRouteHint(null);

    const optimisticUserMsg: AgentChatMessage = {
      id: `opt-${Date.now()}`,
      role: "user",
      content: msg,
      createdAt: new Date().toISOString(),
    };
    setOptimisticAgentMessages((prev) => [...prev, optimisticUserMsg]);
    setIsLoading(true);

    try {
      const response = await window.programs.directorChat({
        projectId: agentSelectedProjectId,
        directorId: selectedDirectorId,
        focusMode: activeFocusMode,
        provider: agentComposerOptions.provider,
        model: agentComposerOptions.model,
        claudeModel: agentComposerOptions.claudeModel,
        message: msg,
      });
      const refreshed = await window.programs.getAgentSession(agentSelectedProjectId);
      if (refreshed) onSessionUpdate(refreshed);

      if (response.routeSuggestion) {
        setLastRouteHint(response.routeSuggestion);
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Something went wrong.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const directorColor = selectedDirector?.color ?? "#6366F1";

  const formatFocusMode = (mode: DirectorFocusMode): string =>
    mode.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  return (
    <section className={selectedDirectorId !== null && agentSelectedProjectId ? "agentsPage agentsPage-conversation" : "agentsPage"}>
      <div className="agentsTopBar windowNoDrag">
        {selectedDirectorId !== null && (
          <button className="secondaryButton" style={{ height: '28px', padding: '0 10px', fontSize: '0.8rem', whiteSpace: 'nowrap' }} onClick={() => { setSelectedDirectorId(null); setActiveFocusMode(null); setLastRouteHint(null); }}>
            Back
          </button>
        )}
        <select
          className="plannerSelect"
          value={agentSelectedProjectId ?? ""}
          onChange={(e) => onSelectProject(e.target.value || null)}
        >
          <option value="" disabled>Select a project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {selectedDirector && (
          <button className="agentActiveLabel" style={{ borderColor: directorColor, color: directorColor, whiteSpace: 'nowrap', cursor: 'pointer', background: 'none' }} onClick={() => setShowDirectorProfile(true)}>
            {DIRECTOR_NAMES[selectedDirectorId!]}
          </button>
        )}
        {agentSelectedProjectId && !selectedDirectorId && (
          <button className="secondaryButton" style={{ height: '28px', padding: '0 10px', fontSize: '0.8rem' }} onClick={() => setShowProgressPanel(true)}>
            Progress
          </button>
        )}
      </div>

      {selectedDirectorId === null ? (
        /* Director tile grid */
        <div className="agentSectionsScroll">
          <div className="agentTileGrid" style={{ padding: "16px 20px" }}>
            {DIRECTOR_SECTIONS.map((director) => {
              const hasConversation =
                (agentSession?.directorConversations?.[director.id]?.messages.length ?? 0) > 0 ||
                (agentSession?.agentConversations?.[director.id]?.messages.length ?? 0) > 0;
              return (
                <article
                  key={director.id}
                  className={`projectTile projectTileGradient directorTile${!agentSelectedProjectId ? " agentTileDisabled" : ""}`}
                  style={{ background: director.color }}
                >
                  <button
                    className="projectTileOpenArea"
                    aria-label={`Open ${director.label}`}
                    disabled={!agentSelectedProjectId}
                    onClick={() => handleSelectDirector(director.id)}
                  />
                  <div className="projectTileChrome">
                    <div className="projectTileTopRow" />
                    <div className="projectTileBottomRow">
                      <div>
                        <div className="tileName">{director.label}</div>
                        <div className="directorSubtitle">{director.subtitle}</div>
                      </div>
                      {hasConversation ? <span className="agentStatusDot agentStatusDot--active" /> : <span className="agentStatusDot" />}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : agentSelectedProjectId ? (
        /* Director chat view */
        <>
          <div className="conversationViewportShell">
            <div className="chatViewportDivider" aria-hidden="true" />
            <div className="agentContentLayout">
              <div className="agentChatPane">
                {selectedDirector?.focusModes && (
                  <div className="directorFocusBar">
                    {selectedDirector.focusModes.map((mode) => (
                      <button
                        key={mode}
                        className={`focusModeBtn${activeFocusMode === mode ? " active" : ""}`}
                        onClick={() => void handleFocusModeChange(mode)}
                      >
                        {formatFocusMode(mode)}
                      </button>
                    ))}
                  </div>
                )}
                <div className="agentChatScroll" ref={chatScrollRef}>
                  <DirectorInfoPanel
                    directorId={selectedDirectorId}
                    focusMode={activeFocusMode}
                    session={agentSession}
                    projectId={agentSelectedProjectId}
                    onSessionUpdate={onSessionUpdate}
                    onNavigateToDirector={(id) => handleSelectDirector(id)}
                    pushToast={pushToast}
                  />

                  {selectedDirectorId === "creative-director" && activeFocusMode === "conversation" && agentSession && (agentSession.danInternalNotes?.length ?? 0) > 0 && (
                    <div className="danNotesIndicator">
                      Dan has taken {agentSession.danInternalNotes.length} internal note{agentSession.danInternalNotes.length !== 1 ? "s" : ""}
                    </div>
                  )}

                  <div className="agentUnifiedConversation">
                    {currentDirectorMessages.map((msg) => (
                      <div key={msg.id} className={`agentConvoMessage agentConvoMessage-${msg.role}`} style={msg.role === 'assistant' ? { background: directorColor, color: '#fff' } : undefined}>
                        <div className="agentConvoContent"><SlackMarkdown text={msg.content} /></div>
                        <div className="slackMessageTimestamp">{formatSlackTimestamp(msg.createdAt)}</div>
                      </div>
                    ))}
                    {isLoading ? (
                      <div className="agentConvoMessage agentConvoMessage-assistant" style={{ background: directorColor, color: '#fff' }}>
                        <div className="agentConvoContent">
                          <span className="slackTypingDots">
                            <span className="slackDot" />
                            <span className="slackDot" />
                            <span className="slackDot" />
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {lastRouteHint ? (
                    <div className="agentRouteHint">
                      <p>{lastRouteHint.reason}</p>
                      <button
                        className="primaryButton"
                        onClick={() => handleSelectDirector(lastRouteHint.directorId)}
                      >
                        Go to {DIRECTOR_LABELS[lastRouteHint.directorId]}
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="agentComposerFooter">
                  <div className="composerShell">
                    <textarea
                      ref={composerInputRef}
                      className="composerInput"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      placeholder={`Talk to ${DIRECTOR_NAMES[selectedDirectorId]} (${DIRECTOR_LABELS[selectedDirectorId]})...`}
                      disabled={isLoading}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                    />
                    <ComposerControlBar
                      options={agentComposerOptions}
                      modelCatalog={modelCatalog}
                      hidePlanningMenu
                      hideSpeedMenu
                      addFilesBusy={false}
                      sendBusy={isLoading}
                      isRunning={isLoading}
                      onCodexModelChange={(model) =>
                        setAgentComposerOptions((o) => ({ ...o, provider: "codex", model, speed: "normal", reasoningEffort: "xhigh" }))
                      }
                      onClaudeModelChange={(claudeModel) =>
                        setAgentComposerOptions((o) => ({ ...o, provider: "claude", claudeModel }))
                      }
                      onReasoningChange={(reasoningEffort) =>
                        setAgentComposerOptions((o) => ({ ...o, reasoningEffort }))
                      }
                      onSpeedChange={(speed) =>
                        setAgentComposerOptions((o) => ({ ...o, speed }))
                      }
                      onPlanningModeChange={(planningMode) =>
                        setAgentComposerOptions((o) => ({ ...o, planningMode }))
                      }
                      onAddFiles={() => {}}
                      onSubmit={() => void handleSend()}
                      onStop={() => {}}
                      submitLabel="Send"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="placeholderPanel" style={{ marginTop: 48 }}>
          <h4>{selectedDirector?.label ?? "Director"}</h4>
          <p>Select a project above to start the director workflow.</p>
        </div>
      )}

      {showProgressPanel && agentSession && (
        <Modal title="Project Progress" onClose={() => setShowProgressPanel(false)} fullscreen>
          <div className="progressPanelContent">
            <div className="progressSection">
              <h4>Dan — Creative</h4>
              <div className="progressItems">
                <div className="progressItem"><span>Function</span><StatusChip tone={agentSession.stages.function.confirmed ? "confirmed" : "neutral"}>{agentSession.stages.function.confirmed ? "Confirmed" : "Pending"}</StatusChip></div>
                <div className="progressItem"><span>Thesis</span><StatusChip tone={agentSession.stages.thesis.confirmed ? "confirmed" : "neutral"}>{agentSession.stages.thesis.confirmed ? "Confirmed" : "Pending"}</StatusChip></div>
                <div className="progressItem"><span>Core Pillars</span><StatusChip tone={agentSession.stages.core_pillars.confirmed ? "confirmed" : "neutral"}>{agentSession.stages.core_pillars.confirmed ? "Confirmed" : "Pending"}</StatusChip></div>
                <div className="progressItem"><span>Full Flow</span><StatusChip tone={agentSession.stages.full_flow.confirmed ? "confirmed" : "neutral"}>{agentSession.stages.full_flow.confirmed ? "Confirmed" : "Pending"}</StatusChip></div>
              </div>
            </div>
            <div className="progressSection">
              <h4>Todd — R&D</h4>
              <div className="progressItems">
                <div className="progressItem"><span>Feasibility</span><StatusChip tone={agentSession.feasibilityAssessments.length > 0 ? "confirmed" : "neutral"}>{agentSession.feasibilityAssessments.length} assessments</StatusChip></div>
                <div className="progressItem"><span>Versions</span><StatusChip tone={agentSession.versions.length > 0 ? "confirmed" : "neutral"}>{agentSession.versions.length} planned</StatusChip></div>
                <div className="progressItem"><span>Updates</span><StatusChip tone={agentSession.versionUpdates.length > 0 ? "confirmed" : "neutral"}>{agentSession.versionUpdates.length} mapped</StatusChip></div>
              </div>
            </div>
            <div className="progressSection">
              <h4>Ping — Programming</h4>
              <div className="progressItems">
                <div className="progressItem"><span>Completed</span><span>{agentSession.versionUpdates.filter((u) => u.status === "completed").length}</span></div>
                <div className="progressItem"><span>In Progress</span><span>{agentSession.versionUpdates.filter((u) => u.status === "in_progress").length}</span></div>
                <div className="progressItem"><span>Pending</span><span>{agentSession.versionUpdates.filter((u) => u.status === "pending").length}</span></div>
              </div>
            </div>
            <div className="progressSection">
              <h4>Brad — Validation</h4>
              <div className="progressItems">
                <div className="progressItem"><span>Frequency</span><span>{agentSession.validationFrequency}</span></div>
                <div className="progressItem"><span>Results</span><span>{agentSession.validationResults.length}</span></div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {showDirectorProfile && selectedDirector && (
        <Modal title="" onClose={() => setShowDirectorProfile(false)}>
          <div className="directorProfileCard">
            <div className="directorProfileAvatar" style={{ borderColor: directorColor }} />
            <div className="directorProfileName">{DIRECTOR_NAMES[selectedDirectorId!]}</div>
            <span className="agentActiveLabel" style={{ borderColor: directorColor, color: directorColor }}>
              {DIRECTOR_STATUS[selectedDirectorId!]}
            </span>
          </div>
        </Modal>
      )}
    </section>
  );
}

function SlackPage({
  projects,
  settings,
  slackSelectedProjectId,
  slackAgentSession,
  modelCatalog,
  onSelectProject,
  onSessionUpdate,
  pushToast,
}: {
  projects: Project[];
  settings: Settings;
  slackSelectedProjectId: string | null;
  slackAgentSession: AgentSession | null;
  modelCatalog: ModelCatalog;
  onSelectProject: (projectId: string | null) => void;
  onSessionUpdate: (session: AgentSession) => void;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
}) {
  const [messageValue, setMessageValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showProjectDetails, setShowProjectDetails] = useState(false);
  const [showDirectorProfile, setShowDirectorProfile] = useState<DirectorId | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [alertedDirectorId, setAlertedDirectorId] = useState<DirectorId | null>(null);
  const [pendingHandoff, setPendingHandoff] = useState<{ directorId: DirectorId; reason: string } | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<SlackChatMessage[]>([]);
  const [slackComposerOptions, setSlackComposerOptions] = useState<ComposerOptions>(() => ({
    ...getComposerDefaults(settings),
    planningMode: "none" as const,
  }));
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === slackSelectedProjectId) ?? null,
    [projects, slackSelectedProjectId],
  );

  const slackMessages = slackAgentSession?.slackMessages ?? [];
  const displayMessages: SlackChatMessage[] = [...slackMessages, ...optimisticMessages];

  const presentDirectors: DirectorId[] = useMemo(() => {
    const seen = new Set<DirectorId>(["project-manager"]);
    if (alertedDirectorId) seen.add(alertedDirectorId);
    for (const msg of slackMessages) {
      if (msg.directorId) seen.add(msg.directorId);
    }
    return Array.from(seen);
  }, [slackMessages, alertedDirectorId]);

  const activeDirectorId: DirectorId = alertedDirectorId
    ?? slackAgentSession?.slackActiveDirectorId
    ?? "project-manager";

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [displayMessages.length, isLoading]);

  useEffect(() => {
    setOptimisticMessages([]);
  }, [slackMessages.length]);

  useEffect(() => {
    if (!slackSelectedProjectId) {
      setShowProjectDetails(false);
    }
  }, [slackSelectedProjectId]);

  useLayoutEffect(() => {
    syncComposerTextareaHeight(composerInputRef.current);
  }, [messageValue, slackSelectedProjectId]);

  const NAME_TO_DIRECTOR: Record<string, DirectorId> = {
    jeff: "project-manager", dan: "creative-director",
    todd: "rd-director", ping: "programming-director", brad: "validation-director",
  };

  const handleSend = async () => {
    if (!messageValue.trim() || !slackSelectedProjectId) return;
    const msg = messageValue.trim();
    setMessageValue("");

    const optimisticUserMsg: SlackChatMessage = {
      id: `opt-${Date.now()}`,
      role: "user",
      directorId: null,
      content: msg,
      createdAt: new Date().toISOString(),
    };
    setOptimisticMessages((prev) => [...prev, optimisticUserMsg]);

    let targetDirectorId: DirectorId | null = null;
    const mentionMatch = msg.match(/^@(\w+)/i);
    if (mentionMatch) {
      const name = mentionMatch[1].toLowerCase();
      if (NAME_TO_DIRECTOR[name] && name !== "jeff") {
        targetDirectorId = NAME_TO_DIRECTOR[name];
      }
    }
    if (!targetDirectorId && alertedDirectorId && alertedDirectorId !== "project-manager") {
      targetDirectorId = alertedDirectorId;
    }

    setIsLoading(true);
    setPendingHandoff(null);

    try {
      const response = await window.programs.slackChat({
        projectId: slackSelectedProjectId,
        provider: slackComposerOptions.provider,
        model: slackComposerOptions.model,
        claudeModel: slackComposerOptions.claudeModel,
        message: msg,
        targetDirectorId,
      });
      const refreshed = await window.programs.getAgentSession(slackSelectedProjectId);
      if (refreshed) onSessionUpdate(refreshed);
      if (response.handoffTo) {
        setPendingHandoff({ directorId: response.handoffTo, reason: response.handoffReason ?? "" });
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Something went wrong.", "error");
    } finally {
      setIsLoading(false);
      setAlertedDirectorId(null);
      setSelectedMessageId(null);
    }
  };

  const handleAcceptHandoff = async () => {
    if (!pendingHandoff || !slackSelectedProjectId) return;
    setIsLoading(true);
    try {
      const response = await window.programs.slackChat({
        projectId: slackSelectedProjectId,
        provider: slackComposerOptions.provider,
        model: slackComposerOptions.model,
        claudeModel: slackComposerOptions.claudeModel,
        message: `[${DIRECTOR_NAMES[pendingHandoff.directorId]} has joined the channel]`,
        targetDirectorId: pendingHandoff.directorId,
      });
      const refreshed = await window.programs.getAgentSession(slackSelectedProjectId);
      if (refreshed) onSessionUpdate(refreshed);
      if (response.handoffTo) {
        setPendingHandoff({ directorId: response.handoffTo, reason: response.handoffReason ?? "" });
      } else {
        setPendingHandoff(null);
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Something went wrong.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleMessageClick = (msg: SlackChatMessage) => {
    if (msg.role !== "assistant" || !msg.directorId) return;
    if (selectedMessageId === msg.id) {
      setSelectedMessageId(null);
      setAlertedDirectorId(null);
    } else {
      setSelectedMessageId(msg.id);
      setAlertedDirectorId(msg.directorId);
    }
  };

  return (
    <section className={slackSelectedProjectId ? "agentsPage agentsPage-conversation" : "agentsPage"}>
      <div className="agentsTopBar slackTopBar windowNoDrag">
        <div className="slackTopBarPrimary">
          <select
            className="plannerSelect"
            value={slackSelectedProjectId ?? ""}
            onChange={(e) => onSelectProject(e.target.value || null)}
          >
            <option value="" disabled>Select a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {slackSelectedProjectId && (
            <button
              className="agentActiveLabel"
              style={{
                borderColor: DIRECTOR_COLORS[alertedDirectorId ?? activeDirectorId],
                color: DIRECTOR_COLORS[alertedDirectorId ?? activeDirectorId],
                whiteSpace: "nowrap",
                cursor: "pointer",
                background: "none",
              }}
              onClick={() => setShowDirectorProfile(alertedDirectorId ?? activeDirectorId)}
            >
              {DIRECTOR_NAMES[alertedDirectorId ?? activeDirectorId]}
            </button>
          )}

          <div className="slackDirectorPresence">
            {presentDirectors.map((dId) => (
              <button
                key={dId}
                className={`slackDirectorChip${alertedDirectorId === dId ? " slackDirectorChip--alerted" : ""}`}
                style={{ borderColor: DIRECTOR_COLORS[dId], color: DIRECTOR_COLORS[dId] }}
                onClick={() => setShowDirectorProfile(dId)}
              >
                {DIRECTOR_NAMES[dId]}
              </button>
            ))}
          </div>
        </div>
        {slackSelectedProjectId ? <div className="slackTopBarSpacer" aria-hidden="true" /> : null}
        {slackSelectedProjectId ? (
          <button
            className="secondaryButton slackDetailsButton"
            onClick={() => setShowProjectDetails(true)}
          >
            View Details
          </button>
        ) : null}
      </div>

      {slackSelectedProjectId ? (
        <>
          <div className="conversationViewportShell">
            <div className="chatViewportDivider" aria-hidden="true" />
            <div className="agentContentLayout">
              <div className="agentChatPane">
                <div className="agentChatScroll" ref={chatScrollRef}>
                  <div className="agentUnifiedConversation">
                    {displayMessages.map((msg) => (
                      <Fragment key={msg.id}>
                        {msg.role === "assistant" && msg.directorId && (
                          <div className="slackMessageLabel">{DIRECTOR_NAMES[msg.directorId]}</div>
                        )}
                        <div
                          className={`agentConvoMessage agentConvoMessage-${msg.role}${selectedMessageId === msg.id ? " slackMessageSelected" : ""}`}
                          style={msg.role === "assistant" && msg.directorId ? { background: DIRECTOR_COLORS[msg.directorId], color: "#fff" } : undefined}
                          onClick={() => handleMessageClick(msg)}
                        >
                          <div className="agentConvoContent">
                            <SlackMarkdown text={msg.content} />
                          </div>
                          <div className="slackMessageTimestamp">
                            {formatSlackTimestamp(msg.createdAt)}
                          </div>
                        </div>
                      </Fragment>
                    ))}

                    {isLoading && (
                      <>
                        <div className="slackMessageLabel">{DIRECTOR_NAMES[activeDirectorId]}</div>
                        <div className="agentConvoMessage agentConvoMessage-assistant" style={{ background: DIRECTOR_COLORS[activeDirectorId], color: "#fff" }}>
                          <div className="agentConvoContent">
                            <span className="slackTypingDots">
                              <span className="slackDot" />
                              <span className="slackDot" />
                              <span className="slackDot" />
                            </span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {pendingHandoff && (
                    <div className="slackHandoffBanner">
                      <p><strong>{DIRECTOR_NAMES[pendingHandoff.directorId]}</strong> wants to join — {pendingHandoff.reason}</p>
                      <button className="primaryButton" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => void handleAcceptHandoff()}>
                        Let {DIRECTOR_NAMES[pendingHandoff.directorId]} in
                      </button>
                      <button className="secondaryButton" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => setPendingHandoff(null)}>
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>

                <div className="slackComposerFooter">
                  <div className="composerShell">
                    <textarea
                      ref={composerInputRef}
                      className="composerInput"
                      placeholder={alertedDirectorId ? `Replying to ${DIRECTOR_NAMES[alertedDirectorId]}...` : "Message the team..."}
                      value={messageValue}
                      onChange={(e) => setMessageValue(e.target.value)}
                      disabled={isLoading}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                    />
                    <ComposerControlBar
                      options={slackComposerOptions}
                      modelCatalog={modelCatalog}
                      hidePlanningMenu
                      hideSpeedMenu
                      addFilesBusy={false}
                      sendBusy={isLoading}
                      isRunning={isLoading}
                      onCodexModelChange={(model) =>
                        setSlackComposerOptions((o) => ({ ...o, provider: "codex", model, speed: "normal", reasoningEffort: "xhigh" }))
                      }
                      onClaudeModelChange={(claudeModel) =>
                        setSlackComposerOptions((o) => ({ ...o, provider: "claude", claudeModel }))
                      }
                      onReasoningChange={(reasoningEffort) =>
                        setSlackComposerOptions((o) => ({ ...o, reasoningEffort }))
                      }
                      onSpeedChange={(speed) => setSlackComposerOptions((o) => ({ ...o, speed }))}
                      onPlanningModeChange={(planningMode) =>
                        setSlackComposerOptions((o) => ({ ...o, planningMode }))
                      }
                      onAddFiles={() => {}}
                      onSubmit={() => void handleSend()}
                      onStop={() => {}}
                      submitLabel="Send"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="placeholderPanel" style={{ marginTop: 48 }}>
          <h4>Team Slack</h4>
          <p>Select a project above to open the team channel.</p>
        </div>
      )}

      {showProjectDetails && selectedProject ? (
        <SlackProjectDetailsModal
          project={selectedProject}
          session={slackAgentSession}
          onClose={() => setShowProjectDetails(false)}
        />
      ) : null}

      {showDirectorProfile !== null && (
        <Modal title="" onClose={() => setShowDirectorProfile(null)}>
          <div className="directorProfileCard">
            <div className="directorProfileAvatar" style={{ borderColor: DIRECTOR_COLORS[showDirectorProfile] }} />
            <div className="directorProfileName">{DIRECTOR_NAMES[showDirectorProfile]}</div>
            <span className="agentActiveLabel" style={{ borderColor: DIRECTOR_COLORS[showDirectorProfile], color: DIRECTOR_COLORS[showDirectorProfile] }}>
              {DIRECTOR_LABELS[showDirectorProfile]}
            </span>
          </div>
        </Modal>
      )}
    </section>
  );
}

function SlackProjectDetailsModal({
  project,
  session,
  onClose,
}: {
  project: Project;
  session: AgentSession | null;
  onClose: () => void;
}) {
  const [showCoreDetails, setShowCoreDetails] = useState(false);
  const [summaryRange, setSummaryRange] = useState<SlackDetailsRange>("daily");
  const [forecastRange, setForecastRange] = useState<SlackDetailsRange>("daily");
  const description = buildSlackProjectDescription(session);
  const functionSummary = session?.stages.function.confirmed?.summary?.trim() || null;
  const thesisSummary = session?.stages.thesis.confirmed?.summary?.trim() || null;
  const fullFlow = session?.stages.full_flow.confirmed ?? null;

  return (
    <Modal title={`${project.name} Details`} onClose={onClose} fullscreen>
      <div className="detailsScrollContent slackDetailsModalContent">
        <section className="slackDetailsSection">
          <div className="slackDetailsSectionHeader">
            <h4>Project Description</h4>
          </div>
          <div className="slackDetailsCard">
            <p className="slackDetailsDescription">{description}</p>
            <button
              className="textButton slackDetailsToggle"
              onClick={() => setShowCoreDetails((current) => !current)}
            >
              {showCoreDetails ? "Hide full core details" : "View full core details"}
            </button>
            {showCoreDetails ? (
              <div className="agentCoreDetailsSection slackDetailsCoreGrid">
                <article className="coreDetailCard">
                  <h4>Function</h4>
                  <p className="coreDetailValue">{functionSummary ?? "Not yet defined."}</p>
                </article>
                <article className="coreDetailCard">
                  <h4>Thesis</h4>
                  <p className="coreDetailValue">{thesisSummary ?? "Not yet defined."}</p>
                </article>
                <article className="coreDetailCard coreDetailCard-full">
                  <h4>Core Pillars</h4>
                  {session?.corePillars.length ? (
                    <div className="slackDetailsPillarList">
                      {session.corePillars.map((pillar) => (
                        <SlackDetailsPillarTree key={pillar.id} pillar={pillar} />
                      ))}
                    </div>
                  ) : (
                    <p className="coreDetailEmpty">Core pillars have not been defined yet.</p>
                  )}
                </article>
                <article className="coreDetailCard coreDetailCard-full">
                  <h4>Full Flow</h4>
                  {fullFlow?.steps && fullFlow.steps.length > 0 ? (
                    <ol className="flowStepList">
                      {fullFlow.steps.map((step) => (
                        <li key={step.id} className="flowStepItem">
                          <div>
                            <div>{step.description}</div>
                            {step.pillarIds.length > 0 ? (
                              <div className="flowStepPillars">
                                {step.pillarIds.map((pillarId) => {
                                  const pillar = session?.corePillars.find((item) => item.id === pillarId);
                                  return pillar ? (
                                    <span key={pillarId} className="flowStepPillarTag">{pillar.name}</span>
                                  ) : null;
                                })}
                              </div>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="coreDetailValue">{fullFlow?.summary?.trim() || "Full flow has not been defined yet."}</p>
                  )}
                </article>
              </div>
            ) : null}
          </div>
        </section>

        <section className="slackDetailsSection">
          <div className="slackDetailsSectionHeader">
            <h4>Progress</h4>
          </div>
          <div className="slackDetailsProgressGrid">
            <article className="slackDetailsCard slackDetailsProgressCard">
              <div className="slackDetailsSubsectionHead">
                <h5>Summary</h5>
                <SlackDetailsRangeToggle value={summaryRange} onChange={setSummaryRange} />
              </div>
              <SlackDetailsPlaceholderPanel label="Summary" range={summaryRange} />
            </article>
            <article className="slackDetailsCard slackDetailsProgressCard">
              <div className="slackDetailsSubsectionHead">
                <h5>Forecast</h5>
                <SlackDetailsRangeToggle value={forecastRange} onChange={setForecastRange} />
              </div>
              <SlackDetailsPlaceholderPanel label="Forecast" range={forecastRange} />
            </article>
          </div>
        </section>

        <section className="slackDetailsSection">
          <div className="slackDetailsSectionHeader">
            <h4>Agents</h4>
          </div>
          <div className="slackDetailsCard slackDetailsAgentFlow">
            {SLACK_DETAILS_DIRECTOR_FLOW.map((directorId, index) => (
              <Fragment key={directorId}>
                <div
                  className="slackDetailsAgentNode"
                  style={{ "--slack-agent-color": DIRECTOR_COLORS[directorId] } as CSSProperties}
                >
                  <span className="slackDetailsAgentRole">{DIRECTOR_LABELS[directorId]}</span>
                  <span className="slackDetailsAgentName">{DIRECTOR_NAMES[directorId]}</span>
                </div>
                {index < SLACK_DETAILS_DIRECTOR_FLOW.length - 1 ? (
                  <div className="slackDetailsAgentArrow" aria-hidden="true" />
                ) : null}
              </Fragment>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function SlackDetailsRangeToggle({
  value,
  onChange,
}: {
  value: SlackDetailsRange;
  onChange: (value: SlackDetailsRange) => void;
}) {
  return (
    <div className="slackDetailsSegmentedControl" role="tablist" aria-label="Project detail range">
      {SLACK_DETAILS_RANGE_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          className={value === option ? "slackDetailsSegment active" : "slackDetailsSegment"}
          onClick={() => onChange(option)}
        >
          {option.charAt(0).toUpperCase() + option.slice(1)}
        </button>
      ))}
    </div>
  );
}

function SlackDetailsPlaceholderPanel({
  label,
  range,
}: {
  label: "Summary" | "Forecast";
  range: SlackDetailsRange;
}) {
  const rangeLabel = range.charAt(0).toUpperCase() + range.slice(1);

  return (
    <div className="slackDetailsPlaceholder">
      <div className="slackDetailsPlaceholderBars" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="slackDetailsPlaceholderCopy">{`${rangeLabel} ${label.toLowerCase()} placeholder.`}</p>
    </div>
  );
}

function SlackDetailsPillarTree({
  pillar,
  depth = 0,
}: {
  pillar: CorePillar;
  depth?: number;
}) {
  return (
    <div className="corePillarExpanded slackDetailsPillarExpanded" style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      <div className="slackDetailsPillarHeading">{pillar.name}</div>
      <div className="pillarDetailRow">
        <span className="pillarDetailLabel">Function:</span>
        <span>{pillar.function?.summary ?? "Not defined"}</span>
      </div>
      <div className="pillarDetailRow">
        <span className="pillarDetailLabel">Thesis:</span>
        <span>{pillar.thesis?.summary ?? "Not defined"}</span>
      </div>
      {pillar.corePillars.length > 0 ? (
        <div className="pillarChildren slackDetailsPillarChildren">
          {pillar.corePillars.map((child) => (
            <SlackDetailsPillarTree key={child.id} pillar={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SkillsPage({
  skills,
  onSkillsChange,
  pushToast,
}: {
  skills: Skill[];
  onSkillsChange: (skills: Skill[]) => void;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
}) {
  const recommendedSkills: Array<{
    catalogId: InstallSkillCatalogInput["catalogId"];
    providerLabel: string;
    typeLabel: string;
    title: string;
    description: string;
  }> = [
    {
      catalogId: "frontend-design-universal",
      providerLabel: "Universal",
      typeLabel: "Skill",
      title: "Front-end Design",
      description: "Design-focused guidance for stronger visual direction, layout polish, and responsive UI work across Codex and Claude.",
    },
    {
      catalogId: "user-testing-universal",
      providerLabel: "Universal",
      typeLabel: "Skill",
      title: "User Testing",
      description: "PROGRAMS-native browser testing with Playwright artifacts so either provider can inspect the app like a user.",
    },
  ];

  const upsertSkill = (nextSkill: Skill) => {
    const existingIndex = skills.findIndex((skill) => skill.id === nextSkill.id);
    if (existingIndex >= 0) {
      const next = [...skills];
      next[existingIndex] = nextSkill;
      onSkillsChange(next);
      return;
    }

    const duplicateIndex = skills.findIndex(
      (skill) =>
        (nextSkill.installSlug && skill.installSlug === nextSkill.installSlug)
        || skill.name === nextSkill.name,
    );
    if (duplicateIndex >= 0) {
      const next = [...skills];
      next[duplicateIndex] = nextSkill;
      onSkillsChange(next);
      return;
    }

    onSkillsChange([nextSkill, ...skills]);
  };

  const installedCatalogSkill = (catalogId: InstallSkillCatalogInput["catalogId"]): Skill | null =>
    skills.find((skill) => skill.installSlug === catalogId) ?? null;

  const sortedSkills = useMemo(
    () => [...skills].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [skills],
  );

  return (
    <section className="agentsPage">
      <div className="skillsSectionHeader">
        <h4>Skills</h4>
        <button
          className="secondaryButton"
          onClick={async () => {
            const result = await window.programs.pickMaterialFiles();
            if (result.canceled || result.paths.length === 0) return;
            try {
              const skill = await window.programs.downloadSkill({ filePath: result.paths[0] });
              onSkillsChange([...skills, skill]);
              pushToast(`Skill "${skill.name}" imported.`, "success");
            } catch (error) {
              pushToast(error instanceof Error ? error.message : "Failed to import skill.", "error");
            }
          }}
        >
          Import Skill
        </button>
      </div>
      <div className="catalogSkillsGrid">
        {recommendedSkills.map((item) => {
          const installed = installedCatalogSkill(item.catalogId);
          const installLabel = installed
            ? installed.installStatus === "ready"
              ? item.typeLabel === "Plugin"
                ? "Reinstall"
                : "Installed"
              : installed.installStatus === "error"
                ? "Retry Install"
                : "Installing..."
            : item.typeLabel === "Plugin"
              ? "Install Plugin"
              : "Install Skill";
          const installTone: StatusTone = installed
            ? installed.installStatus === "ready"
              ? "confirmed"
              : installed.installStatus === "error"
                ? "action_required"
                : "info"
            : "neutral";

          return (
            <div key={item.catalogId} className="skillCard skillCard-catalog">
              <div className="skillCardHeader">
                <span className="skillCardName">{item.title}</span>
                <span className={`skillProviderBadge skillProviderBadge-${item.providerLabel.toLowerCase()}`}>
                  {item.providerLabel}
                </span>
              </div>
              <div className="skillMetaRow">
                <span className="skillMetaTag">{item.typeLabel}</span>
                <StatusChip tone={installTone}>
                  {installed ? installed.installStatus : "Available"}
                </StatusChip>
              </div>
              <p className="skillCardDescription">{item.description}</p>
              {installed?.lastError ? <div className="errorBanner">{installed.lastError}</div> : null}
              <div className="skillCardActions">
                <button
                  className="secondaryButton"
                  disabled={installed?.installStatus === "installing"}
                  onClick={async () => {
                    try {
                      const skill = await window.programs.installSkillCatalogItem({ catalogId: item.catalogId });
                      upsertSkill(skill);
                      pushToast(
                        skill.installStatus === "ready"
                          ? `"${skill.name}" is available.`
                          : skill.lastError ?? `PROGRAMS could not finish installing "${skill.name}".`,
                        skill.installStatus === "ready" ? "success" : "error",
                      );
                    } catch (error) {
                      pushToast(error instanceof Error ? error.message : "Failed to install skill.", "error");
                    }
                  }}
                >
                  {installLabel}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {skills.length === 0 ? (
        <p className="skillsEmpty">No skills installed yet. Import a local skill or install one of the recommended Claude and universal skills above.</p>
      ) : (
        <div className="skillsGrid">
          {sortedSkills.map((skill) => (
            <div key={skill.id} className="skillCard">
              <div className="skillCardHeader">
                <span className="skillCardName">{skill.name}</span>
                <div className="skillBadgeRow">
                  <span className={`skillProviderBadge skillProviderBadge-${skill.sourceProvider}`}>
                    {skill.isUniversal ? "Universal" : skill.sourceProvider}
                  </span>
                  <span className="skillMetaTag">{skill.sourceType}</span>
                </div>
              </div>
              <div className="skillMetaRow">
                <StatusChip tone={skill.installStatus === "ready" ? "confirmed" : skill.installStatus === "error" ? "action_required" : "info"}>
                  {skill.installStatus}
                </StatusChip>
                {skill.installSlug ? <span className="helperText">{skill.installSlug}</span> : null}
              </div>
              {skill.description ? (
                <p className="skillCardDescription">{skill.description}</p>
              ) : null}
              {skill.installPath ? <p className="skillPathText">{skill.installPath}</p> : null}
              {skill.lastError ? <div className="errorBanner">{skill.lastError}</div> : null}
              <div className="skillCardActions">
                {skill.sourceType === "skill" && !skill.isUniversal ? (
                  <button
                    className="secondaryButton"
                    onClick={async () => {
                      try {
                        const converted = await window.programs.convertSkill({ skillId: skill.id });
                        onSkillsChange(skills.map((s) => (s.id === converted.id ? converted : s)));
                        pushToast(`Converted "${converted.name}" to universal.`, "success");
                      } catch (error) {
                        pushToast(error instanceof Error ? error.message : "Failed to convert skill.", "error");
                      }
                    }}
                  >
                    Convert to Universal
                  </button>
                ) : null}
                <button
                  className="secondaryButton skillDeleteButton"
                  onClick={async () => {
                    try {
                      await window.programs.deleteSkill(skill.id);
                      onSkillsChange(skills.filter((s) => s.id !== skill.id));
                      pushToast(`Skill "${skill.name}" deleted.`, "success");
                    } catch (error) {
                      pushToast(error instanceof Error ? error.message : "Failed to delete skill.", "error");
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default App;
