import {
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
  DEFAULT_MODEL_CATALOG,
  type AiProvider,
  type AppUpdateStatus,
  type AppEvent,
  type AttachPathInspection,
  type AuthSnapshot,
  type ClaudeModel,
  type CodexModel,
  type EnvFileSnapshot,
  type EnvVariableEntry,
  type FlowchartGraph,
  type GenerateFlowchartResult,
  type GenerateProjectOutlineReportInput,
  type ModelCatalog,
  type ModelOption,
  type PlanDraft,
  type ProviderUsage,
  type Project,
  type ProjectDetail,
  type ProjectOutlineReport,
  type RuntimeState,
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
  type PendingPlannedUpdate,
  type PlanningChatMessage,
  type PlanningMode,
  type PlanningChatResponse,
  type GenerateFlowchartInput,
  type PlanningChatInput,
  type SavePlannedUpdateInput,
  type UpdateStageStatus,
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

interface ProjectEditorState {
  projectId: string;
  name: string;
  iconColor: string;
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

type ProgramDetailsTab = "history" | "current" | "planned" | "final";

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
    loggedIn: false,
    login: null,
    avatarUrl: null,
    expiresAt: null,
    errorMessage: null,
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
type AppPage = "homepage" | "programs" | "calendar" | "health" | "system";
type UsageScheduleTone = "under" | "onTrack" | "over";

const USAGE_SCHEDULE_TOLERANCE = 6;
const APP_PAGE_OPTIONS: Array<{
  id: AppPage;
  label: string;
}> = [
  {
    id: "homepage",
    label: "Homepage",
  },
  {
    id: "programs",
    label: "Programs",
  },
  {
    id: "calendar",
    label: "Calendar",
  },
  {
    id: "health",
    label: "Health",
  },
  {
    id: "system",
    label: "System",
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

const dedupePaths = (paths: string[]): string[] => Array.from(new Set(paths)).sort();

const COMPOSER_MIN_HEIGHT = 76;
const COMPOSER_MAX_HEIGHT = 224;

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

const getUsageScheduleTone = (window: UsageWindow): UsageScheduleTone => {
  if (typeof window.usedPercent !== "number") {
    return "onTrack";
  }

  if (!window.resetsAt || !window.windowDurationMins) {
    return "onTrack";
  }

  const resetsAt = new Date(window.resetsAt).getTime();
  if (Number.isNaN(resetsAt)) {
    return "onTrack";
  }

  const windowDurationMs = window.windowDurationMins * 60 * 1000;
  const startedAt = resetsAt - windowDurationMs;
  const elapsedRatio = Math.min(1, Math.max(0, (Date.now() - startedAt) / windowDurationMs));
  const expectedUsage = elapsedRatio * 100;
  const usageDelta = window.usedPercent - expectedUsage;

  if (usageDelta <= -USAGE_SCHEDULE_TOLERANCE) {
    return "under";
  }

  if (usageDelta >= USAGE_SCHEDULE_TOLERANCE) {
    return "over";
  }

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
  const [currentPage, setCurrentPage] = useState<AppPage>("programs");
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
  const [projectEditorState, setProjectEditorState] = useState<ProjectEditorState | null>(null);
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
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, PendingPlannedUpdate | null>>({});
  const [outlineReports, setOutlineReports] = useState<Record<string, ProjectOutlineReport | null | undefined>>({});
  const [envSnapshots, setEnvSnapshots] = useState<Record<string, EnvFileSnapshot | undefined>>({});
  const [isUpdateDropTarget, setIsUpdateDropTarget] = useState(false);
  const updateSectionRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const updateDropDepthRef = useRef(0);

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
      setComposerOptions(getComposerDefaults(bootstrap.settings));
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
    }
  }, [selectedProjectId]);

  useEffect(() => {
    setShowUpdatePanel(Boolean(selectedProjectId));
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
    const textarea = composerInputRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const nextHeight = Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
  }, [composerValue, showUpdatePanel, selectedProjectId]);

  useEffect(() => {
    if (currentPage !== "programs") {
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
        case "auth.github":
          setAuth((current) => ({ ...current, github: event.status }));
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
          setProjectEditorState((current) => (current?.projectId === event.projectId ? null : current));
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
    setProjectDetails((current) => ({ ...current, [projectId]: detail }));
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

  const handleSaveProject = async () => {
    if (!projectEditorState) {
      return;
    }

    await withBusy("project.update", async () => {
      await window.programs.updateProject({
        projectId: projectEditorState.projectId,
        name: projectEditorState.name,
        iconColor: projectEditorState.iconColor,
      });
      setProjectEditorState(null);
    });
  };

  const openProjectEditor = (project: Project) => {
    setProjectEditorState({
      projectId: project.id,
      name: project.name,
      iconColor: project.iconColor,
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
      setProjectEditorState(null);
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
      const [codexStatus, claudeStatus] = await Promise.all([
        window.programs.getCodexStatus(),
        window.programs.getClaudeStatus(),
      ]);
      setAuth((current) => ({
        ...current,
        codex: codexStatus,
        claude: claudeStatus,
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
  const isSelectedProjectView = currentPage === "programs" && Boolean(selectedProject);
  const homeAppUpdateButton = getHomeAppUpdateButtonState(appUpdate);
  const currentPageDefinition = APP_PAGE_OPTIONS.find((page) => page.id === currentPage) ?? APP_PAGE_OPTIONS[1];
  const programsTopBar = (
    <div className="homeTopBar windowNoDrag">
      {!selectedProject ? (
        homeAppUpdateButton === "prepare" ? (
          <button className="secondaryButton homeUpdateButton windowNoDrag" disabled>
            {busyKey === "app.update" || appUpdate.buildState === "installing" ? "Updating..." : "Preparing update..."}
          </button>
        ) : homeAppUpdateButton === "install" ? (
          <button
            className="secondaryButton homeUpdateButton windowNoDrag"
            onClick={() => void handleInstallAppUpdate()}
            disabled={busyKey === "app.update"}
          >
            {busyKey === "app.update" ? "Updating..." : "Update App"}
          </button>
        ) : homeAppUpdateButton === "issue" ? (
          <button className="secondaryButton homeUpdateButton windowNoDrag" onClick={openSettingsModal}>
            Update issue
          </button>
        ) : null
      ) : null}
      <button
        className={showUsageSheet ? "iconButton active windowNoDrag" : "iconButton windowNoDrag"}
        onClick={() => setShowUsageSheet((current) => !current)}
        aria-label="Open usage overview"
      >
        <TimerIcon />
      </button>
      <button className="iconButton windowNoDrag" onClick={openSettingsModal} aria-label="Open settings">
        <SettingsIcon />
      </button>
    </div>
  );
  const programsPage = !selectedProject ? (
    <section className="minimalHome">
      <div className="tileGrid">
        {projects.map((project) => (
          <HomeProjectTile
            key={project.id}
            project={project}
            runtime={projectRuntimes[project.id] ?? null}
            isLaunching={Boolean(launchingProjects[project.id])}
            onOpen={() => setSelectedProjectId(project.id)}
            onQuickAction={() => void handleHomeTileQuickAction(project)}
            onOpenOptions={() => openProjectOptions(project.id)}
          />
        ))}

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
                {showUpdateDock ? (
                  <UpdateStagePanel
                    plan={activePlan}
                    canConfirmPlan={canConfirmPlan}
                    confirmBusy={busyKey === "plan.approve"}
                    onConfirm={handleConfirmUpdate}
                  />
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
                      activePlan?.status === "awaitingApproval"
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
                    submitLabel={activePlan?.status === "awaitingApproval" ? "Revise update" : "Send update"}
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
        {currentPage === "programs" ? programsTopBar : null}

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
        </aside>

        <main className={isSelectedProjectView ? "shellContent shellContent-detailLocked" : "shellContent"}>
          {currentPage === "homepage" ? (
            <HomepagePlanner
              projects={projects}
              projectDetails={projectDetails}
              settings={settings}
              modelCatalog={modelCatalog}
              theme={theme}
              onApplyUpdate={(projectId, flowchart, flowchartGraph, description) => {
                void (async () => {
                  await window.programs.savePlannedUpdate({
                    projectId,
                    flowchart,
                    flowchartGraph,
                    previousFlowchart: projectDetails[projectId]?.flowchart ?? "",
                    previousFlowchartGraph: projectDetails[projectId]?.flowchartGraph ?? null,
                    description,
                  });
                  setSelectedProjectId(projectId);
                  setCurrentPage("programs");
                  void window.programs.applyPlannedUpdate(projectId);
                })();
              }}
              onSavePlan={async (projectId, flowchart, flowchartGraph, previousFlowchart, previousFlowchartGraph, description) => {
                await window.programs.savePlannedUpdate({
                  projectId,
                  flowchart,
                  flowchartGraph,
                  previousFlowchart,
                  previousFlowchartGraph,
                  description,
                });
                pushToast("Plan saved. Apply it from the program's View Plan.", "success");
              }}
            />
          ) : currentPage === "programs" ? (
            programsPage
          ) : (
            <PlaceholderWorkspace page={currentPageDefinition} onReturn={() => setCurrentPage("programs")} />
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

      {projectEditorState ? (
        <Modal title="Edit Project" onClose={() => setProjectEditorState(null)}>
          <div className="projectEditorStack">
            <label>
              Project name
              <input
                value={projectEditorState.name}
                onChange={(event) => setProjectEditorState({ ...projectEditorState, name: event.target.value })}
              />
            </label>

            <div className="modalSection">
              <div className="sectionHeader">
                <h3>Project color</h3>
              </div>
              <div className="colorSwatchGrid">
                {DEFAULT_ICON_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={projectEditorState.iconColor === color ? "colorSwatch active" : "colorSwatch"}
                    style={{ background: color }}
                    aria-label={`Set project color ${color}`}
                    onClick={() => setProjectEditorState({ ...projectEditorState, iconColor: color })}
                  />
                ))}
              </div>
              <label className="colorField">
                Custom color
                <input
                  type="color"
                  value={projectEditorState.iconColor}
                  onChange={(event) => setProjectEditorState({ ...projectEditorState, iconColor: event.target.value })}
                />
              </label>
            </div>

            <div className="modalActions">
              <button className="secondaryButton" onClick={() => setProjectEditorState(null)}>
                Cancel
              </button>
              <button className="primaryButton" onClick={() => void handleSaveProject()} disabled={busyKey === "project.update"}>
                Save
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {projectOptionsProject ? (
        <ProjectOptionsSheet
          project={projectOptionsProject}
          onClose={() => setProjectOptionsProjectId(null)}
          onEdit={() => {
            setProjectOptionsProjectId(null);
            openProjectEditor(projectOptionsProject);
          }}
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
          onDisconnectCodex={() => void handleDisconnectCodex()}
          onDisconnectClaude={() => void handleDisconnectClaude()}
          onDisconnectGitHub={() => void handleDisconnectGitHub()}
          onSetupCodex={() => void handleSetupCodex()}
          onSetupClaude={() => void handleSetupClaude()}
          onSetupAction={(check) => void withBusy(`setup-${check.id}`, async () => handleSetupAction(check))}
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
          busyKey={busyKey}
          theme={theme}
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

        {options.provider === "codex" ? (
          <>
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

          </>
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
  onOpen,
  onQuickAction,
  onOpenOptions,
}: {
  project: Project;
  runtime: RuntimeState | null;
  isLaunching: boolean;
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
          <div className="tileName">{project.name}</div>
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

function ProjectOptionsSheet({
  project,
  onClose,
  onEdit,
  onUnlink,
}: {
  project: Project;
  onClose: () => void;
  onEdit: () => void;
  onUnlink: () => void;
}) {
  return (
    <BottomSheet title={project.name} onClose={onClose}>
      <div className="projectOptionsList">
        <button className="projectOptionButton" onClick={onEdit}>
          Edit project
        </button>
        <button className="projectOptionButton projectOptionButton-danger" onClick={onUnlink}>
          Unlink project
        </button>
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
      subtitle: auth.claude.loggedIn ? formatUsageSubtitle(auth.claude.email, auth.claude.planType ?? "Signed in") : "Local history",
      badge: usage.claude.status === "ready" ? (claudeUsesLocalMetrics ? "Local" : "Live") : "Status",
      windows: usage.claude.windows,
      note: claudeNote,
    });
  }

  return (
    <BottomSheet title="Usage" onClose={onClose}>
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
                  {card.windows.map((window) => (
                    <UsageMetricBar
                      key={`${card.key}-${window.label}`}
                      window={window}
                    />
                  ))}
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
    </BottomSheet>
  );
}

function UsageMetricBar({ window }: { window: UsageWindow }) {
  const hasProgress = typeof window.usedPercent === "number";
  const tone = hasProgress ? getUsageScheduleTone(window) : "onTrack";
  const metricLabel = window.valueLabel ?? `${window.usedPercent ?? 0}% used`;
  const metricDetail = window.detail ?? formatUsageReset(window);

  return (
    <div className={`usageMetric usageMetric-${hasProgress ? tone : "static"}`}>
      <div className="usageMetricHead">
        <span>{window.label}</span>
        <strong>{metricLabel}</strong>
      </div>
      {hasProgress ? (
        <div className="usageBar" aria-hidden="true">
          <span className="usageBarFill" style={{ width: `${window.usedPercent}%` }} />
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
  onDisconnectCodex,
  onDisconnectClaude,
  onDisconnectGitHub,
  onSetupCodex,
  onSetupClaude,
  onSetupAction,
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
  onDisconnectCodex: () => void;
  onDisconnectClaude: () => void;
  onDisconnectGitHub: () => void;
  onSetupCodex: () => void;
  onSetupClaude: () => void;
  onSetupAction: (check: SetupCheck) => void;
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
    ? "info"
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

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  return (
    <Modal title="Settings" onClose={onClose}>
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
              disconnectLabel={auth.codex.loggedIn ? "Disconnect" : null}
              onDisconnect={auth.codex.loggedIn ? onDisconnectCodex : undefined}
              disabled={busyKey === "auth.codex"}
            />

            <ConnectionRow
              title="Claude"
              tone={claudeTone}
              detail={claudeDetail}
              actionLabel={claudeActionLabel}
              onAction={claudeAction}
              disconnectLabel={auth.claude.loggedIn ? "Disconnect" : null}
              onDisconnect={auth.claude.loggedIn ? onDisconnectClaude : undefined}
              disabled={busyKey === "auth.claude"}
            />

            <ConnectionRow
              title="GitHub"
              tone={auth.github.loggedIn ? "confirmed" : "info"}
              detail={
                auth.github.loggedIn
                  ? auth.github.login ? `Signed in as ${auth.github.login}` : "Connected."
                  : "Connect GitHub to sync projects with remote repositories."
              }
              actionLabel={null}
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
  actionLabel,
  onAction,
  disconnectLabel,
  onDisconnect,
  disabled = false,
}: {
  title: string;
  tone: StatusTone;
  detail: string;
  actionLabel: string | null;
  onAction?: () => void;
  disconnectLabel?: string | null;
  onDisconnect?: () => void;
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
  busyKey,
  theme,
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
  busyKey: string | null;
  theme: Theme;
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
  const selectedUpdate = savedUpdates.find((u) => u.id === selectedUpdateId) ?? null;
  const selectedIndex = selectedUpdate ? savedUpdates.indexOf(selectedUpdate) : -1;
  const previousFlowchart = selectedIndex > 0 ? savedUpdates[selectedIndex - 1].flowchart : null;
  const previousFlowchartGraph = selectedIndex > 0 ? savedUpdates[selectedIndex - 1].flowchartGraph : null;
  const tabAvailability: Record<ProgramDetailsTab, boolean> = {
    history: hasHistory,
    current: true,
    planned: hasPlanned,
    final: hasFinal,
  };
  const tabOptions: Array<{ id: ProgramDetailsTab; label: string }> = [
    { id: "history", label: "Update History" },
    { id: "current", label: "Current System" },
    { id: "planned", label: "Planned Updates" },
    { id: "final", label: "Final Product" },
  ];

  useEffect(() => {
    const activeTabAvailable =
      activeTab === "history" ? hasHistory : activeTab === "planned" ? hasPlanned : activeTab === "final" ? hasFinal : true;
    if (!activeTabAvailable) {
      setActiveTab("current");
    }
  }, [activeTab, hasFinal, hasHistory, hasPlanned]);

  useEffect(() => {
    if (activeTab !== "history") {
      setSelectedUpdateId(null);
    }
  }, [activeTab]);

  return (
    <Modal title="" onClose={onClose} wide>
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
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className={wide ? "modalFrame wide" : "modalFrame"} onClick={(event) => event.stopPropagation()}>
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

function HomepagePlanner({
  projects,
  projectDetails,
  settings,
  modelCatalog,
  theme,
  onApplyUpdate,
  onSavePlan,
}: {
  projects: Project[];
  projectDetails: Record<string, ProjectDetail>;
  settings: Settings;
  modelCatalog: ModelCatalog;
  theme: Theme;
  onApplyUpdate: (projectId: string, flowchart: string, flowchartGraph: FlowchartGraph | null, description: string) => void;
  onSavePlan: (
    projectId: string,
    flowchart: string,
    flowchartGraph: FlowchartGraph | null,
    previousFlowchart: string,
    previousFlowchartGraph: FlowchartGraph | null,
    description: string,
  ) => Promise<void>;
}) {
  const [chatMessages, setChatMessages] = useState<PlanningChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [attachedProjectId, setAttachedProjectId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<AiProvider>(settings.advancedDefaults.provider);
  const [showFlowchart, setShowFlowchart] = useState(true);
  const [currentFlowchart, setCurrentFlowchart] = useState<string | null>(null);
  const [currentFlowchartGraph, setCurrentFlowchartGraph] = useState<FlowchartGraph | null>(null);
  const [previousFlowchart, setPreviousFlowchart] = useState<string | null>(null);
  const [previousFlowchartGraph, setPreviousFlowchartGraph] = useState<FlowchartGraph | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const attachedProject = useMemo(
    () => projects.find((p) => p.id === attachedProjectId) ?? null,
    [projects, attachedProjectId],
  );

  const attachedFlowchart = attachedProjectId ? projectDetails[attachedProjectId]?.flowchart ?? null : null;
  const attachedFlowchartGraph = attachedProjectId ? projectDetails[attachedProjectId]?.flowchartGraph ?? null : null;

  useEffect(() => {
    if (attachedFlowchart && !currentFlowchart) {
      setCurrentFlowchart(attachedFlowchart);
      setCurrentFlowchartGraph(attachedFlowchartGraph);
      setPreviousFlowchart(attachedFlowchart);
      setPreviousFlowchartGraph(attachedFlowchartGraph);
    }
  }, [attachedFlowchart, attachedFlowchartGraph, currentFlowchart]);

  useEffect(() => {
    if (attachedFlowchartGraph && currentFlowchart === attachedFlowchart && !currentFlowchartGraph) {
      setCurrentFlowchartGraph(attachedFlowchartGraph);
    }
    if (attachedFlowchartGraph && previousFlowchart === attachedFlowchart && !previousFlowchartGraph) {
      setPreviousFlowchartGraph(attachedFlowchartGraph);
    }
  }, [
    attachedFlowchart,
    attachedFlowchartGraph,
    currentFlowchart,
    currentFlowchartGraph,
    previousFlowchart,
    previousFlowchartGraph,
  ]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleSend = async () => {
    if (!inputValue.trim() || !attachedProjectId) return;
    setIsLoading(true);
    const userMsg = inputValue;
    setInputValue("");

    try {
      const response: PlanningChatResponse = await window.programs.planningChat({
        projectId: attachedProjectId,
        provider: selectedProvider,
        model: settings.advancedDefaults.model,
        claudeModel: settings.advancedDefaults.claudeModel,
        message: userMsg,
        sessionId,
      });

      setSessionId(response.sessionId);
      setChatMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", content: userMsg, flowchart: null, flowchartGraph: null, createdAt: new Date().toISOString() },
        response.message,
      ]);

      if (response.updatedFlowchart) {
        setCurrentFlowchart(response.updatedFlowchart);
        setCurrentFlowchartGraph(response.updatedFlowchartGraph);
      }
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", content: userMsg, flowchart: null, flowchartGraph: null, createdAt: new Date().toISOString() },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: error instanceof Error ? error.message : "Something went wrong.",
          flowchart: null,
          flowchartGraph: null,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAttachChange = (projectId: string) => {
    setAttachedProjectId(projectId);
    setChatMessages([]);
    setSessionId(null);
    setCurrentFlowchart(null);
    setCurrentFlowchartGraph(null);
    setPreviousFlowchart(null);
    setPreviousFlowchartGraph(null);
  };

  const lastDescription = chatMessages.filter((m) => m.role === "assistant").at(-1)?.content ?? "Planned flowchart update";

  return (
    <section className="homepagePlanner">
      <div className="plannerTopBar">
        <select
          className="plannerSelect"
          value={attachedProjectId ?? ""}
          onChange={(e) => handleAttachChange(e.target.value)}
        >
          <option value="" disabled>Attach a program</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <div className="speedToggle">
          <button
            className={`toggleOption ${selectedProvider === "codex" ? "active" : ""}`}
            onClick={() => setSelectedProvider("codex")}
          >
            Codex
          </button>
          <button
            className={`toggleOption ${selectedProvider === "claude" ? "active" : ""}`}
            onClick={() => setSelectedProvider("claude")}
          >
            Claude
          </button>
        </div>
      </div>

      {attachedProject && currentFlowchart ? (
        <div className="plannerFlowchartPreview">
          <button className="textButton" onClick={() => setShowFlowchart((s) => !s)}>
            {showFlowchart ? "Hide flowchart" : "Show flowchart"}
          </button>
          {showFlowchart ? (
            previousFlowchart && currentFlowchart !== previousFlowchart ? (
              (currentFlowchartGraph || previousFlowchartGraph) ? (
                <FlowchartDiff
                  oldGraph={previousFlowchartGraph}
                  newGraph={currentFlowchartGraph}
                  theme={theme}
                />
              ) : (
                <MermaidChartDiff
                  oldChart={previousFlowchart}
                  newChart={currentFlowchart}
                  flowchartGraph={currentFlowchartGraph ?? previousFlowchartGraph}
                  theme={theme}
                />
              )
            ) : currentFlowchartGraph ? (
              <InteractiveFlowchart graph={currentFlowchartGraph} theme={theme} />
            ) : (
              <MermaidChart chart={currentFlowchart} flowchartGraph={currentFlowchartGraph} theme={theme} />
            )
          ) : null}
        </div>
      ) : null}

      <div className="plannerChatArea">
        {!attachedProjectId ? (
          <div className="placeholderPanel">
            <h4>Plan an update</h4>
            <p>Attach a program above, then describe what you want to change.</p>
          </div>
        ) : chatMessages.length === 0 ? (
          <div className="placeholderPanel">
            <h4>Start planning</h4>
            <p>Describe what you want to change about {attachedProject?.name}.</p>
          </div>
        ) : (
          chatMessages.map((msg) => (
            <div key={msg.id} className={`plannerMessage plannerMessage-${msg.role}`}>
              <div className="plannerMessageContent">{msg.content}</div>
              {msg.flowchart ? (
                <div className="plannerMessageFlowchart">
                  {msg.flowchartGraph ? (
                    <InteractiveFlowchart graph={msg.flowchartGraph} theme={theme} />
                  ) : (
                    <MermaidChart chart={msg.flowchart} flowchartGraph={msg.flowchartGraph} theme={theme} />
                  )}
                </div>
              ) : null}
            </div>
          ))
        )}
        {isLoading ? (
          <div className="plannerMessage plannerMessage-assistant">
            <div className="plannerMessageContent"><RunningIndicator /></div>
          </div>
        ) : null}
        <div ref={chatEndRef} />
      </div>

      {attachedProjectId && chatMessages.length > 0 && currentFlowchart && currentFlowchart !== previousFlowchart ? (
        <div className="plannerActionBar">
          <button
            className="secondaryButton"
            onClick={() =>
              void onSavePlan(
                attachedProjectId,
                currentFlowchart,
                currentFlowchartGraph,
                previousFlowchart ?? "",
                previousFlowchartGraph,
                lastDescription,
              )
            }
          >
            Save Plan
          </button>
          <button
            className="primaryButton"
            onClick={() => onApplyUpdate(attachedProjectId, currentFlowchart, currentFlowchartGraph, lastDescription)}
          >
            Apply Update
          </button>
        </div>
      ) : null}

      <div className="plannerInputArea">
        <textarea
          className="plannerInput"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={attachedProjectId ? "Describe what you want to change..." : "Attach a program first"}
          disabled={!attachedProjectId || isLoading}
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
          disabled={!attachedProjectId || !inputValue.trim() || isLoading}
        >
          Send
        </button>
      </div>
    </section>
  );
}

export default App;
