import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type ChangeEvent as ReactChangeEvent,
} from "react";
import { getVisibleAppPageOptions, resolveVisibleAppPage, type AppPage } from "@shared/app-shell";
import {
  collectUsedProjectIconColors,
  normalizeProjectIconColor,
  pickAvailableProjectIconColor,
} from "@shared/project-colors";
import {
  type AgentSession,
  type AgentStage,
  type AiProvider,
  type AppEvent,
  type AppUpdateStatus,
  type ChatImage,
  type AttachPathInspection,
  type BasicAutomationStatus,
  type DirectorId,
  type AuthSnapshot,
  type DiffStats,
  type EnvFileSnapshot,
  type EnvVariableEntry,
  type GenerateProjectOutlineReportInput,
  type ModelCatalog,
  type Project,
  type ProjectChatMode,
  type ReasoningEffort,
  type ProjectSafetyState,
  type ProjectCategory,
  type ProjectDetail,
  type ProjectOutlineReport,
  type RuntimeState,
  type Settings,
  type SetupCheck,
  type SetupSnapshot,
  type SystemHealthSnapshot,
  type Theme,
  type UpdateRecord,
  type UsageSnapshot,
} from "@shared/types";
import { type ToastItem, Modal, ToastHost } from "./components/ui-primitives";
import {
  SettingsIcon,
  TimerIcon,
  PlusIcon,
  PlayIcon,
  XIcon,
  SidebarToggleIcon,
  ChevronDownIcon,
  GithubIcon,
  ArrowUpIcon,
  HistoryIcon,
} from "./components/icons";
import { HomeProjectTile } from "./components/home-tiles";
import { ConstellationHomepage } from "./components/constellation-homepage";
import { ProjectOptionsSheet } from "./components/project-options-sheet";
import { SettingsModal } from "./components/settings-modal";
import { UsageOverviewSheet } from "./components/usage-panel";
import { UsageTriggerButton } from "./components/usage-trigger";
import { ProgramDetailsModal, StoredDataModal, ConnectionsModal, RuntimeModal } from "./components/program-details-modal";
import { AgentsPage } from "./components/agents-page";
import { SystemHealthButton, SystemHealthModal } from "./components/system-health-panel";
import { AgentProjectDetailsModal } from "./components/agent-project-details-modal";
import {
  PlanDrawer,
  ResponseArea,
  type AssistantTurn,
  type ChatTurn,
} from "./components/response-area";
import { RunCommandModal } from "./components/run-command-modal";
import {
  emptySettings,
  emptySetup,
  emptyAuth,
  emptyUsage,
  emptyAppUpdateStatus,
  emptyRuntimeState,
  emptyModelCatalog,
  SIDEBAR_AGENTS,
} from "./lib/constants";
import { formatDate, labelForReasoningEffort } from "./lib/formatting";
import { reasoningEffortsForModel, maxReasoningEffortForModel } from "@shared/reasoning-levels";
import {
  type ChatSession,
  archiveActiveChat,
  loadHistorySession,
  loadProjectActiveChat,
  loadProjectChatHistory,
  saveActiveChat,
} from "./lib/project-chat-store";
import {
  type AddProjectFormState,
  type HomeAppUpdateButtonState,
  type ProjectFilterMode,
  type ProjectSortMode,
  createEmptyForm,
  createProjectColorSwatchStyle,
  nextIconColor,
  readInitialTheme,
  applyTheme,
  sortProjectsForDisplay,
  syncComposerTextareaHeight,
  wait,
  getHomeAppUpdateButtonState,
  getHomeTileDotState,
  shouldOpenProjectWhenReady,
  getAutoInstallAppUpdateKey,
} from "./lib/project-helpers";

type SafetyConfirmRequest = {
  title: string;
  message: string;
  detail?: string | null;
  confirmLabel: string;
  danger?: boolean;
};

const USAGE_ACTIVE_REFRESH_INTERVAL_MS = 15_000;
const USAGE_ACTIVE_REFRESH_STALE_MS = 55_000;
const USAGE_BACKGROUND_REFRESH_INTERVAL_MS = 5 * 60_000;
const USAGE_BACKGROUND_REFRESH_STALE_MS = 5 * 60_000;

// Project-chat model picker: provider-appropriate aliases + display labels. The
// alias is what the backend expects (CodexModel / ClaudeModel).
const PROJECT_CHAT_MODEL_OPTIONS: Record<AiProvider, { value: string; label: string }[]> = {
  codex: [
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5.5-mini", label: "GPT-5.5 Mini" },
  ],
  claude: [
    { value: "fable", label: "Fable 5" },
    { value: "opus", label: "Opus 4.8" },
    { value: "sonnet", label: "Sonnet 4.6" },
  ],
};

const projectChatModelLabel = (provider: AiProvider, alias: string): string =>
  PROJECT_CHAT_MODEL_OPTIONS[provider].find((o) => o.value === alias)?.label ?? alias;

const emptyBasicAutomationStatus = (): BasicAutomationStatus => ({
  state: "off",
  enabled: false,
  currentProjectId: null,
  pausedUntil: null,
  lastRunSummary: null,
  skippedProjects: [],
  updatedAt: new Date().toISOString(),
});

const automationProjectIdsToRecord = (projectIds: string[]): Record<string, boolean> =>
  Object.fromEntries(projectIds.map((projectId) => [projectId, true]));

const readStoredStarredProjectIds = (): string[] => {
  try {
    const raw = localStorage.getItem("starredProjectIds");
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    return Object.entries(parsed)
      .filter(([, value]) => Boolean(value))
      .map(([projectId]) => projectId);
  } catch {
    return [];
  }
};

const writeStoredStarredProjectIds = (projectIds: string[]): void => {
  try {
    localStorage.setItem("starredProjectIds", JSON.stringify(automationProjectIdsToRecord(projectIds)));
  } catch {
    // Best-effort compatibility with older local-only starred storage.
  }
};

function App() {
  const programsApi = "programs" in window ? window.programs : undefined;
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog>(emptyModelCatalog);
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [setup, setSetup] = useState<SetupSnapshot>(emptySetup);
  const [auth, setAuth] = useState<AuthSnapshot>(emptyAuth);
  const [usage, setUsage] = useState<UsageSnapshot>(emptyUsage);
  const usageRef = useRef(usage);
  usageRef.current = usage;
  const usageAuthSignature = [
    auth.codex.loggedIn ? `codex:${auth.codex.email ?? auth.codex.version ?? "connected"}` : "codex:logged-out",
    auth.claude.loggedIn
      ? `claude:${auth.claude.email ?? auth.claude.displayName ?? auth.claude.version ?? "connected"}`
      : "claude:logged-out",
  ].join("|");
  const usageAuthSignatureRef = useRef<string | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateStatus>(emptyAppUpdateStatus);
  const autoInstallAppUpdateAttemptedKeysRef = useRef<Set<string>>(new Set());
  const autoInstallAppUpdateInFlightRef = useRef(false);
  const appUpdateStatusPollInFlightRef = useRef(false);
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const [startupIssue, setStartupIssue] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectRuntimes, setProjectRuntimes] = useState<Record<string, RuntimeState>>({});
  const [projectDetails, setProjectDetails] = useState<Record<string, ProjectDetail>>({});
  const [launchingProjects, setLaunchingProjects] = useState<Record<string, boolean>>({});
  const [currentPage, setCurrentPage] = useState<AppPage>("homepage");
  const [projectCategories, setProjectCategories] = useState<Record<string, ProjectCategory>>({});
  const [automationPriorityProjectIds, setAutomationPriorityProjectIds] = useState<Record<string, boolean>>({});
  const [basicAutomationStatus, setBasicAutomationStatus] = useState<BasicAutomationStatus>(emptyBasicAutomationStatus);
  const [showSidebar, setShowSidebar] = useState(false);
  const [sidebarProjectsOpen, setSidebarProjectsOpen] = useState(false);
  const [sidebarAgentsOpen, setSidebarAgentsOpen] = useState(false);
  const [projectLastViewed, setProjectLastViewed] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("projectLastViewed") ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [projectSortMode, setProjectSortMode] = useState<ProjectSortMode>(() => {
    const storedValue = localStorage.getItem("projectSortMode");
    return storedValue === "lastUpdated" || storedValue === "lastSaved" || storedValue === "lastOpened"
      ? storedValue
      : "lastOpened";
  });
  const [projectFilterMode, setProjectFilterMode] = useState<ProjectFilterMode>(() => {
    const stored = localStorage.getItem("projectFilterMode");
    return (stored === "root" || stored === "starred") ? stored : "all";
  });
  const [systemHealth, setSystemHealth] = useState<SystemHealthSnapshot | null>(null);
  const [healthHistory, setHealthHistory] = useState<SystemHealthSnapshot[]>([]);
  const [showHealthSheet, setShowHealthSheet] = useState(false);
  const [fastHealthPoll, setFastHealthPoll] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showUsageSheet, setShowUsageSheet] = useState(false);
  const [showProjectDetails, setShowProjectDetails] = useState(false);
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
  const [restoreBackupProject, setRestoreBackupProject] = useState<Project | null>(null);
  const [safetyConfirmRequest, setSafetyConfirmRequest] = useState<SafetyConfirmRequest | null>(null);
  const [attachInspection, setAttachInspection] = useState<AttachPathInspection | null>(null);
  const [projectFormError, setProjectFormError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [runCommandPromptProject, setRunCommandPromptProject] = useState<Project | null>(null);
  const [githubSaveState, setGithubSaveState] = useState<null | "saving" | "saved" | "up-to-date" | "error">(null);
  const [githubSaveError, setGithubSaveError] = useState<string | null>(null);
  const [githubDownloadState, setGithubDownloadState] = useState<null | "downloading" | "downloaded" | "up-to-date" | "error">(null);
  const [githubDownloadError, setGithubDownloadError] = useState<string | null>(null);
  const [selectedProjectDiffStats, setSelectedProjectDiffStats] = useState<DiffStats | null>(null);
  const [refreshingProjectDetailIds, setRefreshingProjectDetailIds] = useState<Record<string, boolean>>({});

  // Project-page embedded chat UI
  const [projectChatTurns, setProjectChatTurns] = useState<ChatTurn[]>([]);
  const projectChatTurnsRef = useRef<ChatTurn[]>(projectChatTurns);
  projectChatTurnsRef.current = projectChatTurns;
  const [projectChatInput, setProjectChatInput] = useState('');
  const [projectChatLoading, setProjectChatLoading] = useState(false);
  const [projectChatMode, setProjectChatMode] = useState<'plan' | 'ask' | 'auto'>('ask');
  const [projectChatModeOpen, setProjectChatModeOpen] = useState(false);
  // Project-chat model is the provider-appropriate alias (codex: gpt-5.5/-mini;
  // claude: fable/opus/sonnet). Reasoning defaults to the selected model's max.
  const [projectChatModel, setProjectChatModel] = useState<string>('gpt-5.5');
  const [projectChatReasoning, setProjectChatReasoning] = useState<ReasoningEffort>('xhigh');
  // Per-run coding-power toggles + attached images for the next message.
  const [projectChatWeb, setProjectChatWeb] = useState(false);
  const [projectChatUltracode, setProjectChatUltracode] = useState(false);
  const [projectChatImages, setProjectChatImages] = useState<ChatImage[]>([]);
  const projectChatImageInputRef = useRef<HTMLInputElement | null>(null);
  const [projectChatHistory, setProjectChatHistory] = useState<ChatSession[]>([]);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [planDrawerTurnId, setPlanDrawerTurnId] = useState<string | null>(null);
  const projectChatScrollRef = useRef<HTMLDivElement>(null);
  const projectChatModeRef = useRef<HTMLDivElement>(null);
  const projectChatHistoryRef = useRef<HTMLDivElement>(null);
  // Tracks which assistant turn an in-flight real run is streaming into.
  const chatRunningTurnRef = useRef<{ projectId: string; turnId: string; mode: ProjectChatMode | "auto" } | null>(null);
  // Turn ids we've already auto-approved (Auto mode) so we only execute once.
  const autoApprovedRef = useRef<Set<string>>(new Set());

  const [previewingCommitSha, setPreviewingCommitSha] = useState<string | null>(null);
  const [previewProjectId, setPreviewProjectId] = useState<string | null>(null);
  const [claudeAuthCodePrompt, setClaudeAuthCodePrompt] = useState<string | null>(null);
  const [claudeAuthCodeInput, setClaudeAuthCodeInput] = useState("");
  const [agentSession, setAgentSession] = useState<AgentSession | null>(null);
  const agentSessionRef = useRef(agentSession);
  agentSessionRef.current = agentSession;
  const [agentSelectedProjectId, setAgentSelectedProjectId] = useState<string | null>(null);
  const [agentViewStage, setAgentViewStage] = useState<AgentStage>("function");
  const [requestedDirectorProfileId, setRequestedDirectorProfileId] = useState<DirectorId | null>(null);
  const projectSelectionRequestIdRef = useRef(0);
  const agentSelectedProjectIdRef = useRef(agentSelectedProjectId);
  agentSelectedProjectIdRef.current = agentSelectedProjectId;
  const selectedProjectIdRef = useRef(selectedProjectId);
  selectedProjectIdRef.current = selectedProjectId;
  const [programAgentSession, setProgramAgentSession] = useState<AgentSession | null>(null);
  const [projectAssumedFlags, setProjectAssumedFlags] = useState<Record<string, boolean>>({});
  const [outlineReports, setOutlineReports] = useState<Record<string, ProjectOutlineReport | null | undefined>>({});
  const [envSnapshots, setEnvSnapshots] = useState<Record<string, EnvFileSnapshot | undefined>>({});
  const projectChatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const safetyConfirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const shownErrorProjectIds = useRef<Set<string>>(new Set());
  const lastProjectRelationshipRefreshAtRef = useRef(0);

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
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const selectedProjectExactChildren = useMemo(() => {
    if (!selectedProject) {
      return [];
    }

    return selectedProject.relationship.exactChildProjectIds.flatMap((projectId) => {
      const project = projectsById.get(projectId);
      return project ? [project] : [];
    });
  }, [projectsById, selectedProject]);
  const selectedProjectMaybeRelated = useMemo(() => {
    if (!selectedProject) {
      return [];
    }

    return selectedProject.relationship.maybeRelated.flatMap((candidate) => {
      const project = projectsById.get(candidate.projectId);
      return project ? [{ ...candidate, project }] : [];
    });
  }, [projectsById, selectedProject]);

  const selectedDetail = selectedProjectId ? projectDetails[selectedProjectId] ?? null : null;
  const selectedRuntime = selectedProjectId ? projectRuntimes[selectedProjectId] ?? selectedDetail?.runtime ?? null : null;
  const activePage = resolveVisibleAppPage(currentPage);
  const visiblePageOptions = getVisibleAppPageOptions();
  const presentSidebarAgentId: DirectorId | null = selectedProjectId
    ? agentSession?.slackPresenceGuestId ?? agentSession?.slackActiveDirectorId ?? "project-manager"
    : null;

  const orderedProjects = useMemo(
    () => sortProjectsForDisplay(projects, {
      lastViewed: projectLastViewed,
      sortMode: projectSortMode,
    }),
    [projectLastViewed, projectSortMode, projects],
  );
  const displayedProjects = useMemo(
    () => sortProjectsForDisplay(projects, {
      lastViewed: projectLastViewed,
      sortMode: projectSortMode,
      filterMode: projectFilterMode,
      starredIds: automationPriorityProjectIds,
    }),
    [automationPriorityProjectIds, projectLastViewed, projectSortMode, projectFilterMode, projects],
  );


  const syncProjectSelection = useCallback((projectId: string | null) => {
    const requestId = ++projectSelectionRequestIdRef.current;
    const previousProjectId = selectedProjectIdRef.current;
    selectedProjectIdRef.current = projectId;
    agentSelectedProjectIdRef.current = projectId;

    // Stop any in-flight chat run and close transient chat UI.
    if (chatRunningTurnRef.current) {
      void window.programs.cancelProjectChat(chatRunningTurnRef.current.projectId).catch(() => undefined);
      chatRunningTurnRef.current = null;
    }
    setProjectChatLoading(false);
    setPlanDrawerTurnId(null);

    if (previousProjectId) {
      saveActiveChat(previousProjectId, projectChatTurnsRef.current);
    }
    setShowChatHistory(false);

    if (!projectId) {
      setProjectChatTurns([]);
      setProjectChatHistory([]);
      setSelectedProjectId(null);
      setAgentSelectedProjectId(null);
      setAgentSession(null);
      setProgramAgentSession(null);
      setAgentViewStage("function");
      setRequestedDirectorProfileId(null);
      return;
    }

    setProjectChatHistory(loadProjectChatHistory(projectId));
    setProjectChatTurns(loadProjectActiveChat(projectId));

    const now = new Date().toISOString();
    setProjectLastViewed((prev) => {
      const next = { ...prev, [projectId]: now };
      localStorage.setItem("projectLastViewed", JSON.stringify(next));
      return next;
    });
    setSelectedProjectId(projectId);
    setAgentSelectedProjectId(projectId);
    setAgentSession(null);
    setProgramAgentSession(null);
    setAgentViewStage("function");

    void (async () => {
      try {
        const session = await window.programs.getAgentSession(projectId);
        if (projectSelectionRequestIdRef.current !== requestId) {
          return;
        }

        const nextSession = session ?? null;
        setAgentSession(nextSession);
        setProgramAgentSession(nextSession);
        if (nextSession) {
          setAgentViewStage(nextSession.currentStage);
        }
      } catch {
        if (projectSelectionRequestIdRef.current !== requestId) {
          return;
        }

        setAgentSession(null);
        setProgramAgentSession(null);
      }
    })();
  }, []);

  // Keep the persisted "active" chat in sync (covers the delayed mock reply too),
  // so an in-progress conversation survives a crash/restart and archives cleanly.
  useEffect(() => {
    if (!selectedProjectId) return;
    saveActiveChat(selectedProjectId, projectChatTurns);
  }, [selectedProjectId, projectChatTurns]);

  // Cancel any in-flight chat run when the component unmounts.
  useEffect(() => () => {
    if (chatRunningTurnRef.current) {
      void window.programs.cancelProjectChat(chatRunningTurnRef.current.projectId).catch(() => undefined);
      chatRunningTurnRef.current = null;
    }
  }, []);

  const requestProjectRelationshipRefresh = useCallback(
    async (force = false) => {
      if (!programsApi) {
        return;
      }

      const now = Date.now();
      if (!force && now - lastProjectRelationshipRefreshAtRef.current < 30_000) {
        return;
      }

      lastProjectRelationshipRefreshAtRef.current = now;
      try {
        await programsApi.refreshProjectRelationships();
      } catch {
        // Keep background relationship refresh silent.
      }
    },
    [programsApi],
  );

  const selectProject = useCallback(
    (projectId: string) => {
      syncProjectSelection(projectId);
      setCurrentPage("projects");
      setSidebarProjectsOpen(false);
    },
    [syncProjectSelection],
  );

  useEffect(() => {
    if (currentPage !== "projects") setSidebarProjectsOpen(false);
    if (currentPage !== "agents") setSidebarAgentsOpen(false);
  }, [currentPage]);

  useEffect(() => {
    if (!selectedProjectId) {
      projectSelectionRequestIdRef.current += 1;
      setAgentSelectedProjectId(null);
      setAgentSession(null);
      setProgramAgentSession(null);
      setAgentViewStage("function");
      setSidebarAgentsOpen(false);
    }
  }, [selectedProjectId]);

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
      let bootSettings = bootstrap.settings;
      if (bootSettings.automation.projectIds.length === 0) {
        const projectIdSet = new Set(bootstrap.projects.map((project) => project.id));
        const migratedProjectIds = readStoredStarredProjectIds().filter((projectId) => projectIdSet.has(projectId));
        if (migratedProjectIds.length > 0) {
          bootSettings = await programsApi.updateSettings({
            automation: {
              projectIds: migratedProjectIds,
            },
          });
        }
      }
      writeStoredStarredProjectIds(bootSettings.automation.projectIds);
      setSettings(bootSettings);
      setTheme(bootSettings.theme);
      setProjects(bootstrap.projects);
      setProjectRuntimes(bootstrap.runtimes);
      setAuth(bootstrap.auth);
      setSetup(bootstrap.setup);
      setAppUpdate(bootstrap.appUpdate);
      setModelCatalog(bootstrap.modelCatalog);
      setAutomationPriorityProjectIds(automationProjectIdsToRecord(bootSettings.automation.projectIds));
      const automationStatus = await programsApi.readBasicAutomationStatus().catch(() => null);
      if (automationStatus) {
        setBasicAutomationStatus(automationStatus);
      }

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
      if (appUpdateStatusPollInFlightRef.current || autoInstallAppUpdateInFlightRef.current) {
        return;
      }
      appUpdateStatusPollInFlightRef.current = true;
      void programsApi
        .readAppUpdateStatus()
        .then((status) => setAppUpdate(status))
        .catch(() => undefined)
        .finally(() => {
          appUpdateStatusPollInFlightRef.current = false;
        });
    };

    window.addEventListener("focus", refreshAppUpdate);
    return () => {
      window.removeEventListener("focus", refreshAppUpdate);
    };
  }, [programsApi]);

  useEffect(() => {
    if (!programsApi || !agentSelectedProjectId) {
      return;
    }

    const refreshSelectedAgentSession = () => {
      const projectId = agentSelectedProjectIdRef.current;
      if (!projectId) {
        return;
      }

      void programsApi.getAgentSession(projectId).then((session) => {
        if (agentSelectedProjectIdRef.current !== projectId) {
          return;
        }
        setAgentSession(session ?? null);
        setProgramAgentSession(session ?? null);
      }).catch(() => undefined);
    };

    window.addEventListener("focus", refreshSelectedAgentSession);
    return () => {
      window.removeEventListener("focus", refreshSelectedAgentSession);
    };
  }, [agentSelectedProjectId, programsApi]);

  useEffect(() => {
    if (!programsApi || !selectedProjectId) {
      return;
    }

    void refreshProject(selectedProjectId).catch((error: unknown) => {
      pushToast(error instanceof Error ? error.message : "PROGRAMS could not load the project.", "error");
    });
  }, [programsApi, selectedProjectId]);

  useEffect(() => {
    if (activePage !== "projects" || projects.length === 0) {
      return;
    }

    void requestProjectRelationshipRefresh();
  }, [activePage, projects.length, requestProjectRelationshipRefresh]);

  useEffect(() => {
    if (!programsApi) {
      return;
    }

    const refreshRelationshipsOnFocus = () => {
      if (resolveVisibleAppPage(currentPage) !== "projects") {
        return;
      }
      void requestProjectRelationshipRefresh();
    };

    window.addEventListener("focus", refreshRelationshipsOnFocus);
    return () => {
      window.removeEventListener("focus", refreshRelationshipsOnFocus);
    };
  }, [currentPage, programsApi, requestProjectRelationshipRefresh]);

  useEffect(() => {
    if (selectedProjectId) {
      setShowUsageSheet(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProject) {
      setSelectedProjectDiffStats(null);
      return;
    }
    // Auto-detect an existing git remote so repo status is always up to date
    if (!selectedProject.githubConnection) {
      void window.programs.detectAndSyncGithubRemote(selectedProject.id).catch(() => undefined);
    }
    void window.programs.readProjectGithubDiffStats(selectedProject.id)
      .then((stats) => setSelectedProjectDiffStats(stats ?? null))
      .catch(() => setSelectedProjectDiffStats(null));
  }, [
    selectedProject?.id,
    selectedProject?.githubConnection?.lastPushedCommitSha,
    selectedProject?.githubConnection?.lastDownloadedCommitSha,
  ]);

  useEffect(() => {
    setShowProjectDetails(false);
  }, [currentPage, selectedProjectId]);

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

  // Grow the project-chat composer as the user types (and collapse after send).
  useLayoutEffect(() => {
    syncComposerTextareaHeight(projectChatInputRef.current, { maxHeight: 140 });
  }, [projectChatInput]);

  // Reset the chat model + thinking level to the provider's default (max for the
  // model) whenever the underlying advanced defaults change.
  useEffect(() => {
    const provider = settings.advancedDefaults.provider;
    const model = provider === "codex" ? settings.advancedDefaults.model : settings.advancedDefaults.claudeModel;
    setProjectChatModel(model);
    setProjectChatReasoning(maxReasoningEffortForModel(provider, provider === "claude" ? model : ""));
  }, [settings.advancedDefaults.provider, settings.advancedDefaults.model, settings.advancedDefaults.claudeModel]);

  // User picks a model in the chat: snap thinking to that model's max.
  const handleProjectChatModelChange = useCallback((alias: string) => {
    const provider = settings.advancedDefaults.provider;
    setProjectChatModel(alias);
    setProjectChatReasoning(maxReasoningEffortForModel(provider, provider === "claude" ? alias : ""));
  }, [settings.advancedDefaults.provider]);

  // Read attached/pasted image files into base64 (capped) for the next message.
  const addProjectChatImageFiles = useCallback((files: ArrayLike<File>) => {
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    for (const file of images) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        const comma = result.indexOf(",");
        if (comma === -1) return;
        const dataBase64 = result.slice(comma + 1);
        setProjectChatImages((prev) => (prev.length >= 6 ? prev : [...prev, { dataBase64, mediaType: file.type }]));
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleProjectChatPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file != null);
    if (files.length > 0) {
      event.preventDefault();
      addProjectChatImageFiles(files);
    }
  }, [addProjectChatImageFiles]);

  useEffect(() => {
    if (activePage !== currentPage) {
      setCurrentPage(activePage);
    }
    if (activePage !== "projects") {
      setShowUsageSheet(false);
    }
  }, [activePage, currentPage]);

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
    if (!programsApi) return;
    // Only poll aggressively while the health sheet is open. When it's closed the
    // always-visible status button just needs a coarse refresh, so back off to
    // 30s. (Each poll spawns several system processes; tight intervals were a
    // major source of load.)
    const intervalMs = showHealthSheet ? (fastHealthPoll ? 1000 : 5000) : 30000;
    const poll = () => {
      void programsApi.getSystemHealth().then((snap) => {
        setSystemHealth(snap);
        setHealthHistory((h) => [...h.slice(-299), snap]);
      });
    };
    poll();
    const id = setInterval(poll, intervalMs);
    return () => clearInterval(id);
  }, [programsApi, fastHealthPoll, showHealthSheet]);

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
    if (!programsApi || !showUsageSheet) {
      return;
    }

    const id = setInterval(() => {
      const updated = usageRef.current.updatedAt ? new Date(usageRef.current.updatedAt) : null;
      if (!updated || Date.now() - updated.getTime() >= USAGE_ACTIVE_REFRESH_STALE_MS) {
        void refreshUsage().catch(() => undefined);
      }
    }, USAGE_ACTIVE_REFRESH_INTERVAL_MS);

    return () => clearInterval(id);
  }, [programsApi, showUsageSheet]);

  useEffect(() => {
    if (!programsApi || showUsageSheet) {
      return;
    }

    const hasLoggedInUsageProvider = auth.codex.loggedIn || auth.claude.loggedIn;
    if (!hasLoggedInUsageProvider) {
      usageAuthSignatureRef.current = usageAuthSignature;
      return;
    }

    const authChanged = usageAuthSignatureRef.current !== usageAuthSignature;
    usageAuthSignatureRef.current = usageAuthSignature;

    const refreshIfStale = () => {
      const updated = usageRef.current.updatedAt ? new Date(usageRef.current.updatedAt) : null;
      if (!updated || Date.now() - updated.getTime() >= USAGE_BACKGROUND_REFRESH_STALE_MS) {
        void refreshUsage().catch(() => undefined);
      }
    };

    if (authChanged) {
      void refreshUsage().catch(() => undefined);
    } else {
      refreshIfStale();
    }
    const id = setInterval(refreshIfStale, USAGE_BACKGROUND_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [programsApi, showUsageSheet, usageAuthSignature, auth.codex.loggedIn, auth.claude.loggedIn]);

  useEffect(() => {
    setProjectChatModel(
      settings.advancedDefaults.provider === 'codex' ? 'gpt-5.5' : 'claude-sonnet-4-6'
    );
  }, [settings.advancedDefaults.provider]);

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
        case "auth.claude.codePrompt":
          setClaudeAuthCodePrompt(event.prompt);
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
        case "automation.basic.status":
          setBasicAutomationStatus(event.status);
          return;
        case "project.updated":
          setProjects((current) => {
            const exists = current.some((project) => project.id === event.project.id);
            return exists
              ? current.map((project) => (project.id === event.project.id ? event.project : project))
              : [event.project, ...current];
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
          if (selectedProjectIdRef.current === event.projectId) {
            syncProjectSelection(null);
          }
          setProjectOptionsProjectId((current) => (current === event.projectId ? null : current));
          setUnlinkProjectId((current) => (current === event.projectId ? null : current));
          setProgramDetailsProjectId((current) => (current === event.projectId ? null : current));
          setStoredDataProjectId((current) => (current === event.projectId ? null : current));
          setConnectionsProjectId((current) => (current === event.projectId ? null : current));
          setRuntimeProjectId((current) => (current === event.projectId ? null : current));
          setRestoreBackupProject((current) => (current?.id === event.projectId ? null : current));
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
          // Map a streaming PlanDraft onto the running project-chat turn.
          {
            const running = chatRunningTurnRef.current;
            const plan = event.plan;
            if (running && plan && running.projectId === event.projectId) {
              const failed = plan.status === "failed";
              const completed = plan.status === "completed";
              const awaiting = plan.status === "awaitingApproval";
              const isAuto = running.mode === "auto";
              // In Auto mode a ready plan keeps "running" (we auto-build it); in
              // Plan mode it pauses at "awaiting_approval" for the user to confirm.
              const turnStatus = failed
                ? "failed"
                : completed
                  ? "completed"
                  : awaiting
                    ? (isAuto ? "running" : "awaiting_approval")
                    : "running";
              const terminal = turnStatus === "failed" || turnStatus === "completed" || turnStatus === "awaiting_approval";
              setProjectChatTurns((prev) =>
                prev.map((t) => {
                  if (t.id !== running.turnId || t.role !== "assistant") return t;
                  return {
                    ...t,
                    thinkingStatus: plan.thinkingStatus,
                    planningStatus: plan.planningStatus,
                    buildingStatus: plan.buildingStatus,
                    verifyingStatus: plan.verifyingStatus,
                    thought: plan.transcript || t.thought || plan.explanation || "",
                    steps: plan.steps,
                    plan:
                      plan.summary || plan.impact || plan.diff
                        ? { summary: plan.summary, impact: plan.impact, diff: plan.diff }
                        : t.plan,
                    finalText: failed
                      ? plan.errorMessage ?? plan.finalText ?? "Something went wrong."
                      : plan.finalText ?? t.finalText,
                    status: turnStatus,
                    durationSec:
                      terminal && t.durationSec == null
                        ? Math.max(0, Math.round((Date.now() - t.createdAt.getTime()) / 1000))
                        : t.durationSec,
                  };
                }),
              );
              if (awaiting && isAuto && !autoApprovedRef.current.has(running.turnId)) {
                // Auto mode: a plan is ready — build it without asking.
                autoApprovedRef.current.add(running.turnId);
                void window.programs.approvePlan({ projectId: event.projectId }).catch(() => undefined);
              } else if (failed || completed || (awaiting && !isAuto)) {
                chatRunningTurnRef.current = null;
                setProjectChatLoading(false);
              }
            }
          }
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
        case "project.outlineReport":
          setOutlineReports((current) => ({
            ...current,
            [event.projectId]: event.report,
          }));
          return;
        case "agent.session":
          const nextSession = event.session && !event.session.knowledgeStatus && agentSessionRef.current?.projectId === event.projectId
            ? {
                ...event.session,
                knowledgeStatus: agentSessionRef.current.knowledgeStatus,
                knowledgeReasons: agentSessionRef.current.knowledgeReasons,
              }
            : event.session;
          if (event.projectId === agentSelectedProjectIdRef.current) {
            setAgentSession(nextSession);
            if (nextSession) {
              setAgentViewStage(nextSession.currentStage);
            }
          }
          // Also update programAgentSession for programs page features
          setProgramAgentSession((prev) => {
            if (prev && prev.projectId === event.projectId) {
              if (nextSession && !nextSession.knowledgeStatus) {
                return {
                  ...nextSession,
                  knowledgeStatus: prev.knowledgeStatus,
                  knowledgeReasons: prev.knowledgeReasons,
                };
              }
              return nextSession;
            }
            return prev;
          });
          // Track which projects have unconfirmed (assumed) core details for badge display
          setProjectAssumedFlags((prev) => ({
            ...prev,
            [event.projectId]: nextSession
              ? (["function", "thesis", "core_pillars", "full_flow"] as const).some(
                  (f) => nextSession.stages[f].confirmed?.status === "assumed",
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

  const resolveSafetyConfirm = (confirmed: boolean) => {
    safetyConfirmResolverRef.current?.(confirmed);
    safetyConfirmResolverRef.current = null;
    setSafetyConfirmRequest(null);
  };

  const requestSafetyConfirm = (request: SafetyConfirmRequest): Promise<boolean> =>
    new Promise((resolve) => {
      safetyConfirmResolverRef.current = resolve;
      setSafetyConfirmRequest(request);
    });

  const formatChangedFilesDetail = (state: ProjectSafetyState): string | null => {
    if (!state.hasUnsavedChanges) {
      return null;
    }
    const visible = state.changedFiles.slice(0, 8);
    const suffix = state.changedFiles.length > visible.length ? ` and ${state.changedFiles.length - visible.length} more` : "";
    return visible.length ? `Changed files: ${visible.join(", ")}${suffix}` : null;
  };

  const confirmDirtyWorkIfNeeded = async (projectId: string, title: string, confirmLabel: string): Promise<ProjectSafetyState | null> => {
    const state = await window.programs.readProjectSafetyState(projectId);
    if (!state.hasUnsavedChanges) {
      return state;
    }

    const confirmed = await requestSafetyConfirm({
      title,
      message: "This project has unsaved changes. Continuing may mix new work with existing work.",
      detail: formatChangedFilesDetail(state),
      confirmLabel,
      danger: false,
    });
    return confirmed ? state : null;
  };

  const refreshProject = async (projectId: string) => {
    const detail = await window.programs.readProject(projectId);
    const plan = detail.activePlan;
    const isTerminal = plan != null && (plan.status === "completed" || plan.status === "failed");
    // When returning to a project, don't show a completed/failed plan — make the area fresh
    const displayDetail = isTerminal ? { ...detail, activePlan: null } : detail;
    setProjectDetails((current) => ({ ...current, [projectId]: displayDetail }));
    // Show a one-time failure toast if the plan failed on its own.
    if (isTerminal && plan.status === "failed" && plan.errorMessage && !shownErrorProjectIds.current.has(projectId)) {
      shownErrorProjectIds.current.add(projectId);
      pushToast(plan.errorMessage, "error");
    }
    setProjectRuntimes((current) => ({
      ...current,
      [projectId]: detail.runtime,
    }));
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

  useEffect(() => {
    if (!programsApi || autoInstallAppUpdateInFlightRef.current) {
      return;
    }

    const candidateKey = getAutoInstallAppUpdateKey({
      status: appUpdate,
      enabled: settings.autoInstallAppUpdates,
      busyKey,
      attemptedKeys: autoInstallAppUpdateAttemptedKeysRef.current,
    });
    if (!candidateKey) {
      return;
    }

    autoInstallAppUpdateAttemptedKeysRef.current.add(candidateKey);
    autoInstallAppUpdateInFlightRef.current = true;
    setBusyKey("app.update");
    void programsApi.installAppUpdate()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "PROGRAMS could not auto-install the update.";
        pushToast(`${message} Use Update to retry.`, "error");
      })
      .finally(() => {
        autoInstallAppUpdateInFlightRef.current = false;
        setBusyKey(null);
      });
  }, [
    appUpdate,
    busyKey,
    programsApi,
    settings.autoInstallAppUpdates,
  ]);

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
      iconColor: nextIconColor(projects),
    });
    setAttachInspection(null);
    setProjectFormError(null);
  };

  const submitProjectForm = async (formState: AddProjectFormState) => {
    const iconColor = pickAvailableProjectIconColor(
      collectUsedProjectIconColors(projects),
      formState.iconColor,
    );

    if (formState.mode === "create") {
      const project = await window.programs.createProject({
        name: formState.createName.trim(),
        parentDirectory: formState.parentDirectory.trim(),
        iconColor,
        initialIdea: formState.initialIdea.trim(),
      });
      selectProject(project.id);
    } else {
      const project = await window.programs.attachProject({
        localPath: formState.attachDirectory.trim(),
        iconColor,
      });
      selectProject(project.id);
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
    setBusyKey("project.update");
    try {
      const normalizedColor = normalizeProjectIconColor(iconColor);
      if (!normalizedColor) {
        throw new Error("Choose a valid project color.");
      }

      const usedColors = collectUsedProjectIconColors(projects, projectId);
      if (usedColors.has(normalizedColor)) {
        throw new Error("That project color is already in use. Choose another color.");
      }

      await window.programs.updateProject({ projectId, name, iconColor: normalizedColor });
    } catch (error) {
      const message = error instanceof Error ? error.message : "That action could not finish.";
      pushToast(message, "error");
      throw error;
    } finally {
      setBusyKey(null);
    }
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
      if (selectedProjectIdRef.current === projectId) {
        syncProjectSelection(null);
      }
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

  const toggleUsageSheet = () => {
    setShowSettings(false);
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

  const handleConnectGithub = async () => {
    await withBusy("auth.github", async () => {
      const status = await window.programs.loginGithub();
      setAuth((current) => ({ ...current, github: status }));
    });
  };

  const handleDisconnectGithub = async () => {
    await withBusy("auth.github", async () => {
      const status = await window.programs.logoutGithub();
      setAuth((current) => ({ ...current, github: status }));
    });
  };

  const handlePublishToGithub = async (input: { projectId: string; repoName: string; isPrivate: boolean }) => {
    await withBusy(`github.publish.${input.projectId}`, async () => {
      await window.programs.publishProjectToGithub(input);
    });
  };

  const handleSaveToGithub = async (projectId?: string) => {
    const project = projectId ? projectsById.get(projectId) ?? null : selectedProject;
    if (!project) {
      return;
    }
    const isSelectedProject = project.id === selectedProjectIdRef.current;
    try {
      if (isSelectedProject) {
        setGithubSaveState("saving");
        setGithubSaveError(null);
      }
      const result = await window.programs.saveToGithub(project.id);
      if (isSelectedProject) {
        if (result.status === "up-to-date") {
          setGithubSaveState("up-to-date");
        } else {
          setGithubSaveState("saved");
          setSelectedProjectDiffStats(null);
        }
        setTimeout(() => setGithubSaveState(null), 3000);
      } else {
        pushToast(result.status === "up-to-date" ? "Already up to date on GitHub." : "Saved to GitHub.", "success");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save to GitHub.";
      if (isSelectedProject) {
        setGithubSaveError(message);
        setGithubSaveState("error");
        setTimeout(() => setGithubSaveState(null), 5000);
      } else {
        pushToast(message, "error");
      }
    }
  };

  const handleDownloadFromGithub = async (projectId?: string) => {
    const project = projectId ? projectsById.get(projectId) ?? null : selectedProject;
    if (!project) {
      return;
    }

    const isSelectedProject = project.id === selectedProjectIdRef.current;
    try {
      const safetyState = await window.programs.readProjectSafetyState(project.id);
      const changedFilesDetail = formatChangedFilesDetail(safetyState);
      const confirmed = await requestSafetyConfirm({
        title: "Download from GitHub?",
        message: `This will replace the local files in ${project.name} with the current GitHub version.`,
        detail: changedFilesDetail
          ? `${changedFilesDetail}. PROGRAMS will create a backup before replacing files.`
          : "PROGRAMS will create a backup before replacing files.",
        confirmLabel: "Download from GitHub",
        danger: true,
      });
      if (!confirmed) {
        return;
      }

      if (isSelectedProject) {
        setGithubDownloadState("downloading");
        setGithubDownloadError(null);
      }
      const result = await window.programs.downloadFromGithub(project.id);
      await refreshProject(project.id);
      if (isSelectedProject) {
        setGithubDownloadState(result.status === "up-to-date" ? "up-to-date" : "downloaded");
        setSelectedProjectDiffStats(null);
        setTimeout(() => setGithubDownloadState(null), 3000);
      } else {
        pushToast(result.status === "up-to-date" ? "Already up to date with GitHub." : "Downloaded from GitHub.", "success");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not download from GitHub.";
      if (isSelectedProject) {
        setGithubDownloadError(message);
        setGithubDownloadState("error");
        setTimeout(() => setGithubDownloadState(null), 5000);
      } else {
        pushToast(message, "error");
      }
    }
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

  const handleUpdateAgentDefaults = async (
    advancedDefaults: Partial<Settings["advancedDefaults"]>,
  ) => {
    await withBusy("settings.agentDefaults", async () => {
      const updated = await window.programs.updateSettings({ advancedDefaults });
      setSettings(updated);
    });
  };

  const handleUpdateAutomationSettings = async (
    automation: Partial<Settings["automation"]>,
  ) => {
    const previousSettings = settings;
    const optimisticSettings: Settings = {
      ...settings,
      automation: {
        ...settings.automation,
        ...automation,
      },
    };
    setSettings(optimisticSettings);
    if (automation.projectIds) {
      setAutomationPriorityProjectIds(automationProjectIdsToRecord(automation.projectIds));
      writeStoredStarredProjectIds(automation.projectIds);
    }

    try {
      const updated = await window.programs.updateSettings({ automation });
      setSettings(updated);
      setAutomationPriorityProjectIds(automationProjectIdsToRecord(updated.automation.projectIds));
      writeStoredStarredProjectIds(updated.automation.projectIds);
      const status = await window.programs.readBasicAutomationStatus().catch(() => null);
      if (status) {
        setBasicAutomationStatus(status);
      }
    } catch (error) {
      setSettings(previousSettings);
      setAutomationPriorityProjectIds(automationProjectIdsToRecord(previousSettings.automation.projectIds));
      writeStoredStarredProjectIds(previousSettings.automation.projectIds);
      pushToast(error instanceof Error ? error.message : "PROGRAMS could not update automation settings.", "error");
    }
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

    const confirmed = await confirmDirtyWorkIfNeeded(selectedProject.id, "Run project?", "Run project");
    if (!confirmed) {
      return;
    }

    setBusyKey("project.run");
    try {
      await window.programs.runProject(selectedProject.id);
      await refreshProject(selectedProject.id);
    } catch (error) {
      if (error instanceof Error && error.message.includes("could not find a run command")) {
        setRunCommandPromptProject(selectedProject);
      } else {
        pushToast(error instanceof Error ? error.message : "That action could not finish.", "error");
      }
    } finally {
      setBusyKey(null);
    }
  };

  const handlePrepareLaunchRepair = async (): Promise<boolean> => {
    if (!runCommandPromptProject) {
      return false;
    }

    setBusyKey("project.repair");
    try {
      await window.programs.prepareLaunchRepair(runCommandPromptProject.id);
      const detail = await refreshProject(runCommandPromptProject.id);
      setRunCommandPromptProject(detail.project);

      if (detail.project.runtimeConfig.runCommand) {
        await window.programs.runProject(detail.project.id);
        await refreshProject(detail.project.id);
        return true;
      }

      return false;
    } finally {
      setBusyKey(null);
    }
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

  const handleProjectChatSend = useCallback(() => {
    const content = projectChatInput.trim();
    const projectId = selectedProjectId;
    if (!content || projectChatLoading || chatRunningTurnRef.current || !projectId) return;

    const now = new Date();
    const userId = `u-${now.getTime()}`;
    const assistantId = `a-${now.getTime()}`;
    const provider = settings.advancedDefaults.provider; // "claude" | "codex"
    const uiMode = projectChatMode; // 'ask' | 'plan' | 'auto'
    const backendMode: ProjectChatMode = uiMode === 'ask' ? 'ask' : 'plan';
    // The chat's model picker holds a provider-appropriate alias; map it to the
    // CodexModel / ClaudeModel slot the backend expects.
    const isCodex = provider === 'codex';
    const codexModel = isCodex ? projectChatModel : settings.advancedDefaults.model;
    const claudeModel = isCodex ? settings.advancedDefaults.claudeModel : projectChatModel;
    const reasoningEffort = projectChatReasoning;
    // Ultracode (parallel subagents) is Claude-only.
    const ultracode = provider === 'claude' && projectChatUltracode;
    const images = projectChatImages;

    const assistantTurn: AssistantTurn = {
      id: assistantId,
      role: 'assistant',
      createdAt: now,
      provider,
      mode: uiMode,
      model: projectChatModelLabel(provider, projectChatModel),
      reasoningEffort,
      status: 'running',
      thinkingStatus: 'pending',
      planningStatus: 'pending',
      buildingStatus: 'pending',
      verifyingStatus: 'pending',
      thought: '',
      steps: [],
      plan: null,
      finalText: null,
      durationSec: null,
    };

    setProjectChatTurns((prev) => [
      ...prev,
      { id: userId, role: 'user', content, createdAt: now },
      assistantTurn,
    ]);
    setProjectChatInput('');
    setProjectChatImages([]);
    setProjectChatLoading(true);
    chatRunningTurnRef.current = { projectId, turnId: assistantId, mode: uiMode };

    // Real run — streams back as `project.plan` events (mapped onto this turn in
    // the onEvent handler). Only a synchronous throw (e.g. provider not ready)
    // lands here; service-internal failures arrive as a failed PlanDraft.
    void window.programs
      .startProjectChat({ projectId, provider, mode: backendMode, prompt: content, model: codexModel, claudeModel, reasoningEffort, webEnabled: projectChatWeb, ultracode, images })
      .catch((error: unknown) => {
        if (chatRunningTurnRef.current?.turnId !== assistantId) return;
        chatRunningTurnRef.current = null;
        const message = error instanceof Error ? error.message : 'That request could not start.';
        setProjectChatTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId && t.role === 'assistant'
              ? { ...t, status: 'failed', thinkingStatus: 'failed', finalText: message, durationSec: 0 }
              : t,
          ),
        );
        setProjectChatLoading(false);
      });
  }, [projectChatInput, projectChatLoading, projectChatMode, selectedProjectId, projectChatModel, projectChatReasoning, projectChatWeb, projectChatUltracode, projectChatImages, settings.advancedDefaults.provider, settings.advancedDefaults.model, settings.advancedDefaults.claudeModel]);

  const handleApproveTurn = (turnId: string) => {
    const projectId = selectedProjectId;
    if (!projectId || chatRunningTurnRef.current) return;
    chatRunningTurnRef.current = { projectId, turnId, mode: 'plan' };
    setProjectChatLoading(true);
    setProjectChatTurns((prev) =>
      prev.map((t) =>
        t.id === turnId && t.role === 'assistant'
          ? { ...t, status: 'running', buildingStatus: 'in_progress' }
          : t,
      ),
    );
    void window.programs.approvePlan({ projectId }).catch((error: unknown) => {
      if (chatRunningTurnRef.current?.turnId !== turnId) return;
      chatRunningTurnRef.current = null;
      const message = error instanceof Error ? error.message : 'That build could not start.';
      setProjectChatTurns((prev) =>
        prev.map((t) =>
          t.id === turnId && t.role === 'assistant'
            ? { ...t, status: 'failed', buildingStatus: 'failed', finalText: message }
            : t,
        ),
      );
      setProjectChatLoading(false);
    });
  };

  useEffect(() => {
    if (projectChatScrollRef.current) {
      projectChatScrollRef.current.scrollTop = projectChatScrollRef.current.scrollHeight;
    }
  }, [projectChatTurns, projectChatLoading]);

  const cycleProjectChatMode = useCallback(() => {
    setProjectChatMode(m => m === 'plan' ? 'ask' : m === 'ask' ? 'auto' : 'plan');
  }, []);

  useEffect(() => {
    if (!projectChatModeOpen) return;
    const handler = (e: MouseEvent) => {
      if (!projectChatModeRef.current?.contains(e.target as Node)) {
        setProjectChatModeOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [projectChatModeOpen]);

  useEffect(() => {
    if (!showChatHistory) return;
    const handler = (e: MouseEvent) => {
      if (!projectChatHistoryRef.current?.contains(e.target as Node)) {
        setShowChatHistory(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showChatHistory]);

  const handleLoadHistorySession = (sessionId: string) => {
    if (!selectedProjectId) return;
    const { turns, history } = loadHistorySession(selectedProjectId, sessionId);
    setProjectChatTurns(turns);
    setProjectChatHistory(history);
    setShowChatHistory(false);
  };

  const handleNewChat = () => {
    if (!selectedProjectId) return;
    // Archive the current chat (if non-empty) and start fresh.
    const history = archiveActiveChat(selectedProjectId);
    setProjectChatTurns([]);
    setProjectChatHistory(history);
    setShowChatHistory(false);
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

      const confirmed = await confirmDirtyWorkIfNeeded(project.id, `Run ${project.name}?`, "Run project");
      if (!confirmed) {
        return;
      }

      setLaunchingProjects((current) => ({ ...current, [project.id]: true }));
      try {
        await window.programs.runProject(project.id);
        let detail = await refreshProject(project.id);
        const expectsBrowserTarget = shouldOpenProjectWhenReady(detail.project, detail.runtime);
        const opened = expectsBrowserTarget ? await openProjectWhenReady(project.id) : false;
        if (opened) {
          detail = await refreshProject(project.id);
        }

        if (opened || detail.runtime.url || !detail.runtime.running || !expectsBrowserTarget) {
          setLaunchingProjects((current) => {
            if (!current[project.id]) {
              return current;
            }

            const next = { ...current };
            delete next[project.id];
            return next;
          });
        }

        if (!opened && expectsBrowserTarget) {
          // PROGRAMS couldn't open a URL within the wait window. Re-check the live
          // runtime: if the process has already exited, the launch genuinely
          // failed (bad run command, crash on boot, …) — offer the same
          // provider-assisted run-command fix we show when none was found. If it's
          // still running it may just be slow, so keep the gentle "almost there".
          const latest = await refreshProject(project.id);
          if (!latest.runtime.running) {
            setRunCommandPromptProject(latest.project);
          } else {
            pushToast("PROGRAMS started the project. The dot will turn solid green once its local URL is ready.", "info");
          }
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
        if (error instanceof Error && error.message.includes("could not find a run command")) {
          setRunCommandPromptProject(project);
          return;
        }
        throw error;
      }
    });
  };

  const handleHomeTileRestart = async (project: Project) => {
    await withBusy(`project.quick.${project.id}`, async () => {
      const confirmed = await confirmDirtyWorkIfNeeded(project.id, `Restart ${project.name}?`, "Restart project");
      if (!confirmed) {
        return;
      }

      setLaunchingProjects((current) => ({ ...current, [project.id]: true }));
      try {
        await window.programs.restartProject(project.id);
        let detail = await refreshProject(project.id);
        const expectsBrowserTarget = shouldOpenProjectWhenReady(detail.project, detail.runtime);
        const opened = expectsBrowserTarget ? await openProjectWhenReady(project.id) : false;
        if (opened) {
          detail = await refreshProject(project.id);
        }

        if (opened || detail.runtime.url || !detail.runtime.running || !expectsBrowserTarget) {
          setLaunchingProjects((current) => {
            if (!current[project.id]) {
              return current;
            }

            const next = { ...current };
            delete next[project.id];
            return next;
          });
        }

        if (!opened && expectsBrowserTarget) {
          pushToast("PROGRAMS restarted the project. The dot will turn solid green once its local URL is ready.", "info");
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

  const handleUndoUpdate = async (update: UpdateRecord) => {
    if (!selectedProject) {
      return;
    }

    await withBusy(`undo-${update.id}`, async () => {
      await window.programs.undoUpdate(selectedProject.id, update.id);
      await refreshProject(selectedProject.id);
    });
  };

  const handlePreviewCommit = async (update: UpdateRecord) => {
    if (!selectedProject || !update.commitSha) return;
    await withBusy(`preview-${update.id}`, async () => {
      await window.programs.previewCommit(selectedProject.id, update.commitSha!);
      setPreviewingCommitSha(update.commitSha);
      setPreviewProjectId(selectedProject.id);
    });
  };

  const handleRestoreFromPreview = async () => {
    const projectId = previewProjectId ?? selectedProject?.id;
    if (!projectId) return;
    await withBusy(`preview-restore-${projectId}`, async () => {
      await window.programs.restoreFromPreview(projectId);
      setPreviewingCommitSha(null);
      setPreviewProjectId(null);
    });
  };

  const handleRequestRestoreLastBackup = async (project: Project) => {
    await withBusy(`backup.check.${project.id}`, async () => {
      const backup = await window.programs.readLastProjectBackup(project.id);
      if (!backup) {
        pushToast("No backup found for this project yet.", "error");
        return;
      }
      setRestoreBackupProject(project);
    });
  };

  const handleRestoreLastBackup = async () => {
    if (!restoreBackupProject) {
      return;
    }

    await withBusy(`backup.restore.${restoreBackupProject.id}`, async () => {
      await window.programs.restoreLastProjectBackup(restoreBackupProject.id);
      await refreshProject(restoreBackupProject.id);
      pushToast("Backup restored.", "success");
      setRestoreBackupProject(null);
    });
  };

  const handleGenerateOutlineReport = async (projectId: string) => {
    const input: GenerateProjectOutlineReportInput = { projectId };
    await withBusy(`outline.generate.${projectId}`, async () => {
      const report = await window.programs.generateOutlineReport(input);
      setOutlineReports((current) => ({ ...current, [projectId]: report }));
    });
  };

  const handleRefreshProjectDetails = async (projectId: string) => {
    setRefreshingProjectDetailIds((current) => ({ ...current, [projectId]: true }));
    try {
      const result = await window.programs.refreshProjectDetails(projectId);
      if (result.session && selectedProjectIdRef.current === projectId) {
        setProgramAgentSession(result.session);
        setAgentSession(result.session);
      }
      await refreshProject(projectId);

      if (result.status === "success") {
        pushToast(`Project details refreshed with ${result.provider === "claude" ? "Claude" : "GPT"}.`, "success");
      } else if (result.status === "partial-success") {
        pushToast(result.warning ?? "Project details were partially refreshed.", "info");
      } else {
        pushToast(result.warning ?? "Project details refresh failed.", "error");
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Project details refresh failed.", "error");
    } finally {
      setRefreshingProjectDetailIds((current) => {
        const next = { ...current };
        delete next[projectId];
        return next;
      });
    }
  };

  const handleToggleAutomationPriority = (projectId: string) => {
    const currentProjectIds = settings.automation.projectIds;
    const nextProjectIds = currentProjectIds.includes(projectId)
      ? currentProjectIds.filter((candidate) => candidate !== projectId)
      : [...currentProjectIds, projectId];
    void handleUpdateAutomationSettings({ projectIds: nextProjectIds });
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
  const summaryPrimaryActionLabel = showRunningState ? "Open program" : "Run program";
  const summaryPrimaryActionDisabled = showRunningState
    ? !canOpenProject || busyKey === "project.open"
    : busyKey === "project.run";
  const summaryKillActionDisabled = !canStopProject || busyKey === "project.kill";
  const summaryPrimaryActionClassName = showRunningState
    ? "actionButton actionButton-open summaryActionButton"
    : "actionButton actionButton-run summaryActionButton";
  const summaryKillActionClassName = canStopProject
    ? "actionButton actionButton-stop summaryActionButton"
    : "actionButton actionButton-cancel summaryActionButton";
  const detailIsLaunching = Boolean(selectedProject && launchingProjects[selectedProject.id]);
  const detailDotState = selectedProject ? getHomeTileDotState(selectedProject, selectedRuntime, detailIsLaunching) : 'ready';
  const detailCanStop = isProjectRunning && !detailIsLaunching;
  const selectedProjectLastSavedAt = selectedProject?.githubConnection?.lastPushedAt ?? null;
  const selectedProjectHasGithubRepo = Boolean(selectedProject?.githubConnection?.repoUrl);
  const isSelectedProjectView = activePage === "projects" && Boolean(selectedProject);
  const useComposerLayout = isSelectedProjectView || activePage === "agents" || activePage === "homepage";
  const homeAppUpdateButton = getHomeAppUpdateButtonState(appUpdate);

  const sidebarAppUpdateButton = homeAppUpdateButton === "prepare"
    ? (
      <button type="button" className="sidebarFooterButton sidebarFooterButton-update windowNoDrag" disabled>
        {busyKey === "app.update" || appUpdate.buildState === "installing" ? "Updating..." : "Preparing update..."}
      </button>
    )
    : homeAppUpdateButton === "install"
      ? (
        <button
          type="button"
          className="sidebarFooterButton sidebarFooterButton-update windowNoDrag"
          onClick={() => void handleInstallAppUpdate()}
          disabled={busyKey === "app.update"}
        >
          {busyKey === "app.update" ? "Updating..." : "Update"}
        </button>
      )
      : homeAppUpdateButton === "issue"
        ? (
          <button
            type="button"
            className="sidebarFooterButton sidebarFooterButton-update windowNoDrag"
            onClick={() => void handleInstallAppUpdate()}
            disabled={busyKey === "app.update"}
          >
            {busyKey === "app.update" ? "Updating..." : "Update"}
          </button>
        )
        : null;
  const renderProjectTiles = (list: Project[]) =>
    list.map((project) => (
      <HomeProjectTile
        key={project.id}
        project={project}
        runtime={projectRuntimes[project.id] ?? null}
        isLaunching={Boolean(launchingProjects[project.id])}
        hasAssumedDetails={Boolean(projectAssumedFlags[project.id])}
        isAutomationPriority={Boolean(automationPriorityProjectIds[project.id])}
        onOpen={() => selectProject(project.id)}
        onQuickAction={() => void handleHomeTileQuickAction(project)}
        onRestart={() => void handleHomeTileRestart(project)}
        onOpenOptions={() => openProjectOptions(project.id)}
        onToggleAutomationPriority={handleToggleAutomationPriority}
      />
    ));

  const programsPage = !selectedProject ? (
    <section className="minimalHome">
      <div className="projectBrowseTopBar agentTopBar windowNoDrag">
        <div className="projectBrowseTopBarPrimary">
          <button
            type="button"
            className="projectBrowseBadge projectBrowseBadgeClickable"
            onClick={() => {
              const cycle: ProjectFilterMode[] = ["all", "root", "starred"];
              const next = cycle[(cycle.indexOf(projectFilterMode) + 1) % cycle.length];
              localStorage.setItem("projectFilterMode", next);
              setProjectFilterMode(next);
            }}
          >
            {projectFilterMode === "starred" ? "Starred" : projectFilterMode === "root" ? "Root Projects" : "All Projects"}
          </button>
          <button
            type="button"
            className="projectBrowseSortBadge projectBrowseBadgeClickable"
            onClick={() => {
              const modes: ProjectSortMode[] = ["lastOpened", "lastUpdated", "lastSaved"];
              const next = modes[(modes.indexOf(projectSortMode) + 1) % modes.length];
              localStorage.setItem("projectSortMode", next);
              setProjectSortMode(next);
            }}
          >
            {projectSortMode === "lastOpened" ? "Last opened" : projectSortMode === "lastUpdated" ? "Last updated" : "Last saved"}
          </button>
          <span className="projectBrowseCount">
            {displayedProjects.length} / {projects.length}
          </span>
        </div>
        <div className="pageChromeTopBarControls">
          {systemHealth && <SystemHealthButton health={systemHealth} onClick={() => setShowHealthSheet(true)} />}
          <UsageTriggerButton auth={auth} usage={usage} onClick={toggleUsageSheet} />
        </div>
      </div>
      <div className="chatViewportDivider pageChromeDivider" aria-hidden="true" />
      <div className="tileGrid">
        {renderProjectTiles(displayedProjects)}
        <button className="projectTile addProjectTile" onClick={openAddProjectChooser}>
          <PlusIcon />
        </button>
      </div>
    </section>
  ) : (
    <section className="projectLayout projectLayout-detail">
      <div className="projectTopBar windowNoDrag">
        <button type="button" className="agentTopBarButton windowNoDrag" onClick={() => syncProjectSelection(null)}>
          Back
        </button>
        <div className="pageChromeTopBarControls">
          {systemHealth ? <SystemHealthButton health={systemHealth} onClick={() => setShowHealthSheet(true)} /> : null}
          <UsageTriggerButton auth={auth} usage={usage} onClick={toggleUsageSheet} />
        </div>
      </div>

      <div className="chatViewportDivider pageChromeDivider" aria-hidden="true" />

      <div className="projectDetailWorkspace">
        <div className="projectSummaryCard">
          <div className="summaryMain">
            <div className="summaryHeaderRow">
              <div className="summaryCopy">
                <h2>{selectedProject.name}</h2>
                <p className="summaryTimestamp summaryTimestampRow">
                  <span>Last updated at {formatDate(selectedProject.lastUpdatedAt)}</span>
                  {selectedProjectLastSavedAt ? (
                    <>
                      <span className="summaryTimestampDot" aria-hidden="true" />
                      <span>Last saved at {formatDate(selectedProjectLastSavedAt)}</span>
                    </>
                  ) : null}
                </p>
                {selectedProject.lastError ? <div className="errorBanner">{selectedProject.lastError}</div> : null}
              </div>
              <div className="summaryActionRail">
                <button
                  type="button"
                  className={`projectStatusDot projectStatusDot-${detailDotState}${detailCanStop ? " projectStatusDot-stopAction" : ""} summaryStatusDot`}
                  aria-label={detailCanStop ? "Stop project" : detailIsLaunching ? "Starting..." : "Run project"}
                  title={detailCanStop ? "Stop project" : detailIsLaunching ? "Starting..." : "Run project"}
                  onClick={() => { if (!detailIsLaunching) void handleHomeTileQuickAction(selectedProject); }}
                  disabled={detailIsLaunching}
                />
                <div className="summaryInfoMenuWrap">
                  <button
                    type="button"
                    className="summaryInfoButton"
                    aria-label="Open project details"
                    title="Project details"
                    onClick={() => setShowProjectDetails(true)}
                  >
                    i
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="summaryGithubRow">
            <div className="summaryGithubActions">
              <button
                type="button"
                className={
                  githubSaveState === "saved"
                    ? "githubSaveButton githubSaveButton-success"
                    : githubSaveState === "up-to-date"
                      ? "githubSaveButton githubSaveButton-neutral"
                      : githubSaveState === "error"
                        ? "githubSaveButton githubSaveButton-error"
                        : "githubSaveButton"
                }
                onClick={() => void handleSaveToGithub()}
                disabled={githubSaveState === "saving" || githubDownloadState === "downloading"}
                aria-label="Save to GitHub"
              >
                <GithubIcon />
                {githubSaveState === "saving"
                  ? "Saving..."
                  : githubSaveState === "saved"
                    ? "Saved"
                    : githubSaveState === "up-to-date"
                      ? "Up to date"
                      : githubSaveState === "error"
                        ? "Save failed"
                        : "Save to GitHub"}
              </button>
            </div>
            {githubSaveState === "error" && githubSaveError ? (
              <span className="githubSaveErrorLabel">{githubSaveError}</span>
            ) : githubDownloadState === "error" && githubDownloadError ? (
              <span className="githubSaveErrorLabel">{githubDownloadError}</span>
            ) : selectedProjectDiffStats ? (
              <span className="githubDiffStats">
                <span className="githubDiffAdded">+{selectedProjectDiffStats.added}</span>
                <span className="githubDiffRemoved">-{selectedProjectDiffStats.removed}</span>
              </span>
            ) : null}
          </div>
        </div>
        {selectedProjectExactChildren.length > 0 || selectedProjectMaybeRelated.length > 0 ? (
          <details className="projectRelationshipDetails">
            <summary className="projectRelationshipSummary">
              <span>Sub-components & related</span>
              <span className="projectRelationshipCount">
                {selectedProjectExactChildren.length + selectedProjectMaybeRelated.length}
              </span>
            </summary>
            <div className="projectRelationshipGrid">
              {selectedProjectExactChildren.length > 0 ? (
                <section className="projectRelationshipCard">
                  <div className="projectRelationshipHead">
                    <div>
                      <div className="sectionTag">Sub-components</div>
                    </div>
                    <span className="projectRelationshipCount">{selectedProjectExactChildren.length}</span>
                  </div>
                  <div className="projectRelationshipList">
                    {selectedProjectExactChildren.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        className="projectRelationshipItem"
                        onClick={() => selectProject(project.id)}
                      >
                        <span
                          className="projectRelationshipSwatch"
                          style={createProjectColorSwatchStyle(project.iconColor)}
                          aria-hidden="true"
                        />
                        <span className="projectRelationshipCopy">
                          <strong>{project.name}</strong>
                          <span>Sub-component</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
              {selectedProjectMaybeRelated.length > 0 ? (
                <section className="projectRelationshipCard">
                  <div className="projectRelationshipHead">
                    <div>
                      <div className="sectionTag">Maybe Related</div>
                    </div>
                    <span className="projectRelationshipCount">{selectedProjectMaybeRelated.length}</span>
                  </div>
                  <div className="projectRelationshipList">
                    {selectedProjectMaybeRelated.map(({ overlapRatio, project }) => (
                      <button
                        key={project.id}
                        type="button"
                        className="projectRelationshipItem"
                        onClick={() => selectProject(project.id)}
                      >
                        <span
                          className="projectRelationshipSwatch"
                          style={createProjectColorSwatchStyle(project.iconColor)}
                          aria-hidden="true"
                        />
                        <span className="projectRelationshipCopy">
                          <strong>{project.name}</strong>
                          <span>{Math.round(overlapRatio * 100)}% overlap</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>

      <div className="projectChatPane" data-provider={settings.advancedDefaults.provider}>
        <div className="chatProviderToggleRow">
          <div className="detailProviderToggle windowNoDrag" role="group" aria-label="AI provider">
            <button
              type="button"
              className={`detailProviderOption detailProviderOption--claude${settings.advancedDefaults.provider === "claude" ? " detailProviderOption-active" : ""}`}
              onClick={() => void handleUpdateAgentDefaults({ provider: "claude" })}
              disabled={busyKey === "settings.agentDefaults"}
            >
              Claude
            </button>
            <button
              type="button"
              className={`detailProviderOption detailProviderOption--gpt${settings.advancedDefaults.provider === "codex" ? " detailProviderOption-active" : ""}`}
              onClick={() => void handleUpdateAgentDefaults({ provider: "codex" })}
              disabled={busyKey === "settings.agentDefaults"}
            >
              GPT
            </button>
          </div>
          <div className="chatHistoryWrap" ref={projectChatHistoryRef}>
            <button
              type="button"
              className="chatHistoryButton"
              aria-label="Chat history"
              title="Chat history"
              aria-expanded={showChatHistory}
              onClick={() => setShowChatHistory((v) => !v)}
            >
              <HistoryIcon />
            </button>
            {showChatHistory ? (
              <div className="chatHistoryDropdown">
                <button type="button" className="chatHistoryNewButton" onClick={handleNewChat}>
                  <PlusIcon />
                  <span>New chat</span>
                </button>
                <div className="chatHistoryDropdownHead">Chat history</div>
                {projectChatHistory.length === 0 ? (
                  <div className="chatHistoryEmpty">No previous chats.</div>
                ) : (
                  <ul className="chatHistoryList">
                    {projectChatHistory.map((session) => (
                      <li key={session.id}>
                        <button
                          type="button"
                          className="chatHistoryItem"
                          onClick={() => handleLoadHistorySession(session.id)}
                        >
                          <span className="chatHistoryItemTitle">{session.title}</span>
                          <span className="chatHistoryItemDate">{formatDate(session.updatedAt)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        </div>
        <div className="projectChatScroll" ref={projectChatScrollRef}>
          {projectChatTurns.length === 0 ? (
            <div className="projectChatEmptyState">
              <span>Ask me anything about this project</span>
            </div>
          ) : (
            <div className="projectChatMessageList">
              {projectChatTurns.map(turn =>
                turn.role === 'user' ? (
                  <div key={turn.id} className="projectChatBubble projectChatBubble--user">
                    <div className="projectChatBubbleContent">{turn.content}</div>
                    <div className="projectChatBubbleTime">
                      {turn.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ) : (
                  <ResponseArea
                    key={turn.id}
                    turn={turn}
                    onOpenPlan={setPlanDrawerTurnId}
                    onApprove={handleApproveTurn}
                  />
                ),
              )}
            </div>
          )}
        </div>

        <div className="projectChatComposer">
          {projectChatImages.length > 0 && (
            <div className="projectChatThumbs">
              {projectChatImages.map((img, i) => (
                <div key={i} className="projectChatThumb">
                  <img src={`data:${img.mediaType};base64,${img.dataBase64}`} alt="Attached" />
                  <button
                    type="button"
                    className="projectChatThumbRemove"
                    aria-label="Remove image"
                    onClick={() => setProjectChatImages(prev => prev.filter((_, idx) => idx !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="projectChatInputRow">
            <button
              type="button"
              className="projectChatAttachButton"
              onClick={() => projectChatImageInputRef.current?.click()}
              disabled={projectChatLoading}
              aria-label="Attach image"
              title="Attach image (or paste)"
            >
              <PlusIcon />
            </button>
            <input
              ref={projectChatImageInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e: ReactChangeEvent<HTMLInputElement>) => {
                if (e.target.files) addProjectChatImageFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <textarea
              ref={projectChatInputRef}
              className="projectChatInput"
              placeholder="Message..."
              value={projectChatInput}
              onChange={e => setProjectChatInput(e.target.value)}
              onPaste={handleProjectChatPaste}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleProjectChatSend();
                } else if (e.key === 'Tab' && e.shiftKey) {
                  e.preventDefault();
                  cycleProjectChatMode();
                }
              }}
              rows={1}
              disabled={projectChatLoading}
            />
            <button
              type="button"
              className="projectChatSendButton"
              onClick={handleProjectChatSend}
              disabled={(!projectChatInput.trim() && projectChatImages.length === 0) || projectChatLoading}
              aria-label="Send"
            >
              <ArrowUpIcon />
            </button>
          </div>

          <div className="projectChatControlBar">
            <div className="projectChatModePicker" ref={projectChatModeRef}>
              {projectChatModeOpen && (
                <div className="projectChatModeDropdown">
                  {(['plan', 'ask', 'auto'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      className={`projectChatModeOption${projectChatMode === m ? ' projectChatModeOption--active' : ''}`}
                      onClick={() => { setProjectChatMode(m); setProjectChatModeOpen(false); }}
                    >
                      {m === 'plan' ? 'Plan' : m === 'ask' ? 'Ask' : 'Auto'}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="projectChatModeCurrent"
                onClick={() => setProjectChatModeOpen(v => !v)}
                title="Shift+Tab to cycle modes"
              >
                {projectChatMode === 'plan' ? 'Plan' : projectChatMode === 'ask' ? 'Ask' : 'Auto'}
                <ChevronDownIcon />
              </button>
            </div>

            <div className="projectChatToggles">
              <button
                type="button"
                className={`projectChatToggle${projectChatWeb ? ' projectChatToggle--on' : ''}`}
                onClick={() => setProjectChatWeb(v => !v)}
                title="Web: let the agent search/fetch the internet for this message"
              >
                Web
              </button>
              {settings.advancedDefaults.provider === 'claude' && (
                <button
                  type="button"
                  className={`projectChatToggle${projectChatUltracode ? ' projectChatToggle--on' : ''}`}
                  onClick={() => setProjectChatUltracode(v => !v)}
                  title="Ultracode: run parallel subagents (pairs best with Extra-high thinking)"
                >
                  Ultracode ⚡
                </button>
              )}
            </div>

            <div className="projectChatRightControls">
              <select
                className="projectChatSelect"
                value={projectChatModel}
                onChange={e => handleProjectChatModelChange(e.target.value)}
                aria-label="Model"
              >
                {PROJECT_CHAT_MODEL_OPTIONS[settings.advancedDefaults.provider].map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <select
                className="projectChatSelect"
                value={projectChatReasoning}
                onChange={e => setProjectChatReasoning(e.target.value as ReasoningEffort)}
                aria-label="Thinking level"
              >
                {reasoningEffortsForModel(
                  settings.advancedDefaults.provider,
                  settings.advancedDefaults.provider === 'claude' ? projectChatModel : '',
                ).map(level => (
                  <option key={level} value={level}>{labelForReasoningEffort(level)}</option>
                ))}
              </select>
              {(() => {
                const totalChars = projectChatTurns.reduce(
                  (s, t) =>
                    s +
                    (t.role === 'user'
                      ? t.content.length
                      : t.thought.length + (t.finalText?.length ?? 0)),
                  0,
                );
                const pct = Math.min(100, Math.round((totalChars / 200000) * 100));
                const r = 9;
                const circ = 2 * Math.PI * r;
                const filled = (pct / 100) * circ;
                return (
                  <div className="projectChatContextRing" title={`Context used: ${pct}%`}>
                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                      <circle cx="13" cy="13" r={r} stroke="var(--border)" strokeWidth="2" />
                      {pct > 0 && (
                        <circle
                          cx="13" cy="13" r={r}
                          stroke="var(--accent, #007AFF)"
                          strokeWidth="2"
                          strokeDasharray={`${filled} ${circ}`}
                          strokeLinecap="round"
                          transform="rotate(-90 13 13)"
                        />
                      )}
                    </svg>
                    <span className="projectChatContextPct">{pct}%</span>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  if (!isBootstrapped) {
    return (
      <div className="appShell">
        <div className="loadingGate">
          <div className="sectionTag">Starting PROGRAMS</div>
          <h1 className={startupIssue ? undefined : "isLoading"}>{startupIssue ? "PROGRAMS could not start" : "Checking your workspace"}</h1>
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

        <aside className="shellSidebar" aria-label="App navigation">
          <nav className="shellSidebarNav">
            {visiblePageOptions.map((page) => {
              if (page.id === "projects") {
                return (
                  <Fragment key="projects">
                    <button
                      type="button"
                      className={activePage === "projects" ? "sidebarNavButton active" : "sidebarNavButton"}
                      onClick={() => {
                        setCurrentPage("projects");
                        setSidebarProjectsOpen((prev) => !prev);
                      }}
                    >
                      <span className="sidebarNavButtonLabel">{selectedProject ? selectedProject.name : "Projects"}</span>
                      <span className={sidebarProjectsOpen ? "sidebarNavChevron open" : "sidebarNavChevron"}>
                        <ChevronDownIcon />
                      </span>
                    </button>
                    {sidebarProjectsOpen && (
                      <div className="sidebarProjectList sidebarProjectList--full">
                        {orderedProjects.slice(0, 5).map((project) => (
                          <div key={project.id} className="sidebarProjectItemRow">
                            <button
                              type="button"
                              className={project.id === selectedProjectId ? "sidebarProjectItem active" : "sidebarProjectItem"}
                              onClick={() => selectProject(project.id)}
                            >
                              <span className="sidebarProjectDot" style={{ backgroundColor: project.iconColor }} />
                              <span className="sidebarProjectName">{project.name}</span>
                            </button>
                            {project.id === selectedProjectId && (
                              <button
                                type="button"
                                className="sidebarProjectDeselect"
                                title="Deselect project"
                                onClick={() => {
                                  syncProjectSelection(null);
                                  setCurrentPage("projects");
                                  setSidebarProjectsOpen(false);
                                }}
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </Fragment>
                );
              }

              if (page.id === "agents") {
                return (
                  <Fragment key="agents">
                    <button
                      type="button"
                      className={`sidebarNavButton${activePage === "agents" ? " active" : ""}${!selectedProjectId ? " dimmed" : ""}`}
                      onClick={() => {
                        setCurrentPage("agents");
                        setSidebarAgentsOpen((prev) => !prev);
                      }}
                    >
                      <span className="sidebarNavButtonLabel">{page.label}</span>
                      <span className={sidebarAgentsOpen ? "sidebarNavChevron open" : "sidebarNavChevron"}>
                        <ChevronDownIcon />
                      </span>
                    </button>
                    {sidebarAgentsOpen && (
                      <div className="sidebarProjectList sidebarProjectList--full">
                        {SIDEBAR_AGENTS.map((agent) => (
                          <div key={agent.id} className="sidebarProjectItemRow">
                            <button
                              type="button"
                              className="sidebarProjectItem"
                              disabled={!selectedProjectId}
                              onClick={() => {
                                setCurrentPage("agents");
                                setRequestedDirectorProfileId(agent.id);
                              }}
                            >
                              <span
                                className={`sidebarProjectDot sidebarProjectDot--agent${agent.id === presentSidebarAgentId ? " sidebarProjectDot--present" : ""}`}
                                style={agent.id === presentSidebarAgentId ? { backgroundColor: agent.color } : undefined}
                              />
                              <span className="sidebarProjectName">{agent.name}</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </Fragment>
                );
              }

              const isDimmed = false;
              return (
                <button
                  key={page.id}
                  type="button"
                  className={`sidebarNavButton${activePage === page.id ? " active" : ""}${isDimmed ? " dimmed" : ""}`}
                  onClick={() => {
                    setCurrentPage(page.id);
                    setSidebarProjectsOpen(false);
                    setSidebarAgentsOpen(false);
                  }}
                >
                  {page.label}
                </button>
              );
            })}
          </nav>
          <div className="shellSidebarDivider" aria-hidden="true" />
          <div className="shellSidebarFooter">
            {sidebarAppUpdateButton ? (
              <div className="shellSidebarFooterUpdateRow">
                {sidebarAppUpdateButton}
              </div>
            ) : null}
            <div className="shellSidebarFooterActions">
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
          </div>
        </aside>

        <main className={`shellContent${useComposerLayout ? " shellContent-composerLayout shellContent-detailLocked" : ""}`}>
          {activePage === "homepage" ? (
            <ConstellationHomepage
              topRightControls={
                <>
                  {systemHealth ? (
                    <SystemHealthButton
                      health={systemHealth}
                      onClick={() => setShowHealthSheet(true)}
                    />
                  ) : null}
                  <UsageTriggerButton
                    auth={auth}
                    usage={usage}
                    onClick={toggleUsageSheet}
                  />
                </>
              }
            />
          ) : activePage === "agents" ? (
            <AgentsPage
              projects={projects}
              settings={settings}
              agentSession={agentSession}
              agentSelectedProjectId={agentSelectedProjectId}
              requestedDirectorProfileId={requestedDirectorProfileId}
              modelCatalog={modelCatalog}
              onSelectProject={syncProjectSelection}
              onSessionUpdate={(session) => {
                setAgentSession(session);
              }}
              onUpdateAgentDefaults={handleUpdateAgentDefaults}
              onDirectorProfileRequestHandled={() => setRequestedDirectorProfileId(null)}
              pushToast={pushToast}
            />
          ) : (
            programsPage
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
          projects={projects}
          onClose={() => setProjectOptionsProjectId(null)}
          onSave={(name, iconColor) => handleSaveProjectDirect(projectOptionsProject.id, name, iconColor)}
          onUnlink={() => {
            setProjectOptionsProjectId(null);
            setUnlinkProjectId(projectOptionsProject.id);
          }}
        />
      ) : null}

      {(() => {
        if (!planDrawerTurnId) return null;
        const turn = projectChatTurns.find((t) => t.id === planDrawerTurnId);
        const plan = turn && turn.role === "assistant" ? turn.plan : null;
        if (!plan) return null;
        const canApprove = turn?.role === "assistant" && turn.status === "awaiting_approval";
        return (
          <PlanDrawer
            plan={plan}
            onClose={() => setPlanDrawerTurnId(null)}
            onApprove={canApprove ? () => handleApproveTurn(planDrawerTurnId) : undefined}
          />
        );
      })()}

      {showProjectDetails && selectedProject ? (
        <AgentProjectDetailsModal
          project={selectedProject}
          session={programAgentSession}
          settings={settings}
          modelCatalog={modelCatalog}
          onUpdateAgentDefaults={handleUpdateAgentDefaults}
          onSessionUpdate={(session) => setProgramAgentSession(session)}
          refreshBusy={Boolean(refreshingProjectDetailIds[selectedProject.id])}
          onRefreshProjectDetails={() => handleRefreshProjectDetails(selectedProject.id)}
          pushToast={pushToast}
          hasGithubConnection={selectedProjectHasGithubRepo}
          isProjectRunning={isProjectRunning}
          githubDownloadBusy={githubSaveState === "saving" || githubDownloadState === "downloading"}
          backupCheckBusy={busyKey === `backup.check.${selectedProject.id}`}
          backupRestoreBusy={busyKey === `backup.restore.${selectedProject.id}`}
          onDownloadFromGithub={() => void handleDownloadFromGithub()}
          onRequestRestoreBackup={() => void handleRequestRestoreLastBackup(selectedProject)}
          onClose={() => setShowProjectDetails(false)}
        />
      ) : null}

      {unlinkProjectId && unlinkProject ? (
        <Modal title="Unlink Project" onClose={() => setUnlinkProjectId(null)} compact>
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
          onReconnectCodex={() => void handleReconnectCodex()}
          onReconnectClaude={() => void handleReconnectClaude()}
          onTestClaude={() => void handleTestClaude()}
          onSetupCodex={() => void handleSetupCodex()}
          onSetupClaude={() => void handleSetupClaude()}
          onSetupAction={(check) => void withBusy(`setup-${check.id}`, async () => handleSetupAction(check))}
          onConnectGithub={() => void handleConnectGithub()}
          onDisconnectGithub={() => void handleDisconnectGithub()}
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
          provider={settings.advancedDefaults.provider}
          settings={settings}
          modelCatalog={modelCatalog}
          usage={usage}
          projects={projects}
          automationStatus={basicAutomationStatus}
          automationPriorityProjectIds={automationPriorityProjectIds}
          providerBusy={busyKey === "settings.agentDefaults"}
          onProviderChange={(provider) => void handleUpdateAgentDefaults({ provider })}
          onAutomationSettingsChange={(automation) => void handleUpdateAutomationSettings(automation)}
          onToggleAutomationProject={(projectId) => handleToggleAutomationPriority(projectId)}
          onClose={() => setShowUsageSheet(false)}
        />
      ) : null}

      {showHealthSheet && systemHealth ? (
        <SystemHealthModal
          health={systemHealth}
          history={healthHistory}
          onFastPollChange={setFastHealthPoll}
          onClose={() => {
            setShowHealthSheet(false);
            setFastHealthPoll(false);
          }}
        />
      ) : null}

      {programDetailsProjectId && programDetailsProject ? (
        <ProgramDetailsModal
          project={programDetailsProject}
          updates={projectDetails[programDetailsProjectId]?.updates ?? []}
          agentSession={programAgentSession}
          auth={auth}
          busyKey={busyKey}
          previewingCommitSha={previewProjectId === programDetailsProjectId ? previewingCommitSha : null}
          onClose={() => {
            if (previewProjectId === programDetailsProjectId && previewingCommitSha) {
              void handleRestoreFromPreview();
            }
            setProgramDetailsProjectId(null);
          }}
          onUndo={(update) => void handleUndoUpdate(update)}
          onPreviewCommit={(update) => void handlePreviewCommit(update)}
          onRestoreFromPreview={() => void handleRestoreFromPreview()}
          onConnectGithub={() => void handleConnectGithub()}
          onDisconnectGithub={() => void handleDisconnectGithub()}
          onPublishToGithub={(input) => void handlePublishToGithub(input)}
          onSaveToGithub={(projectId) => void handleSaveToGithub(projectId)}
          onDownloadFromGithub={(projectId) => void handleDownloadFromGithub(projectId)}
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
        <Modal title="Install Git" onClose={() => setSetupConfirmCheck(null)} compact>
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

      {runCommandPromptProject ? (
        <RunCommandModal
          project={runCommandPromptProject}
          provider={settings.advancedDefaults.provider}
          onDismiss={() => setRunCommandPromptProject(null)}
          onPrepareRepair={handlePrepareLaunchRepair}
          onConfirm={async (cmd) => {
            await window.programs.setRunCommand(runCommandPromptProject.id, cmd);
            setRunCommandPromptProject(null);
            if (selectedProject?.id === runCommandPromptProject.id) {
              await handleRun();
            }
          }}
        />
      ) : null}

      {restoreBackupProject ? (
        <Modal title="Restore Last Backup" onClose={() => setRestoreBackupProject(null)} compact>
          <div className="projectEditorStack">
            <p className="modalLead">
              This will overwrite the current files in <strong>{restoreBackupProject.name}</strong> with the latest PROGRAMS backup.
            </p>
            <div className="dangerCard">
              <strong>Current files will be replaced.</strong>
              <p>PROGRAMS will create one safety backup of the current folder before restoring, then copy the latest backup back into the project folder.</p>
            </div>
            <div className="modalActions">
              <button className="secondaryButton" onClick={() => setRestoreBackupProject(null)}>
                Cancel
              </button>
              <button
                className="secondaryButton dangerButton"
                onClick={() => void handleRestoreLastBackup()}
                disabled={busyKey === `backup.restore.${restoreBackupProject.id}`}
              >
                {busyKey === `backup.restore.${restoreBackupProject.id}` ? "Restoring..." : "Restore backup"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {safetyConfirmRequest ? (
        <Modal
          title={safetyConfirmRequest.title}
          onClose={() => resolveSafetyConfirm(false)}
          compact
          dismissOnOverlayClick={false}
        >
          <div className="projectEditorStack">
            <p className="modalLead">{safetyConfirmRequest.message}</p>
            {safetyConfirmRequest.detail ? <p className="helperText">{safetyConfirmRequest.detail}</p> : null}
            <div className="modalActions">
              <button className="secondaryButton" onClick={() => resolveSafetyConfirm(false)}>
                Cancel
              </button>
              <button
                className={safetyConfirmRequest.danger ? "secondaryButton dangerButton" : "primaryButton"}
                onClick={() => resolveSafetyConfirm(true)}
              >
                {safetyConfirmRequest.confirmLabel}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      <ToastHost toasts={toasts} />
    </div>
  );
}

export default App;
