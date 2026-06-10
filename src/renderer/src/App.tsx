import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
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
  type AppEvent,
  type AppUpdateStatus,
  type AttachPathInspection,
  type DirectorId,
  type AuthSnapshot,
  type DiffStats,
  type EnvFileSnapshot,
  type EnvVariableEntry,
  type GenerateProjectOutlineReportInput,
  type ModelCatalog,
  type Project,
  type ProjectSafetyState,
  type ProjectCategory,
  type ProjectDetail,
  type ProjectOutlineReport,
  type RuntimeState,
  type Settings,
  type SetupCheck,
  type SetupSnapshot,
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
  ArrowDownIcon,
} from "./components/icons";
import { HomeProjectTile, HomepageComposer } from "./components/home-tiles";
import { ProjectOptionsSheet } from "./components/project-options-sheet";
import { SettingsModal } from "./components/settings-modal";
import { UsageOverviewSheet } from "./components/usage-panel";
import { ProgramDetailsModal, StoredDataModal, ConnectionsModal, RuntimeModal } from "./components/program-details-modal";
import { AgentsPage } from "./components/agents-page";
import { AgentProjectDetailsModal } from "./components/agent-project-details-modal";
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
import { formatDate, providerLabel } from "./lib/formatting";
import {
  type AddProjectFormState,
  type ComposerOptions,
  type HomeAppUpdateButtonState,
  type ProjectSortMode,
  createEmptyForm,
  createProjectColorSwatchStyle,
  nextIconColor,
  readInitialTheme,
  applyTheme,
  sortProjectsForDisplay,
  syncComposerTextareaHeight,
  hasFileDragPayload,
  dedupePaths,
  wait,
  getComposerDefaults,
  getHomeAppUpdateButtonState,
} from "./lib/project-helpers";

type SafetyConfirmRequest = {
  title: string;
  message: string;
  detail?: string | null;
  confirmLabel: string;
  danger?: boolean;
};

const formatGithubRepoStatus = (connection: Project["githubConnection"]): string => {
  if (!connection?.repoUrl) {
    return "No repo yet";
  }

  const pushedAt = connection.lastPushedAt ? Date.parse(connection.lastPushedAt) : 0;
  const downloadedAt = connection.lastDownloadedAt ? Date.parse(connection.lastDownloadedAt) : 0;
  if (connection.lastDownloadedAt && downloadedAt > pushedAt) {
    return `Downloaded ${formatDate(connection.lastDownloadedAt)}`;
  }
  if (connection.lastPushedAt) {
    return `Saved ${formatDate(connection.lastPushedAt)}`;
  }
  return connection.repoUrl.replace("https://github.com/", "");
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
  const [automationPriorityProjectIds, setAutomationPriorityProjectIds] = useState<Record<string, boolean>>({});
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
  const [rootProjectsOnly, setRootProjectsOnly] = useState<boolean>(() => localStorage.getItem("rootProjectsOnly") === "true");
  const [showUpdatePanel, setShowUpdatePanel] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const [composerOptions, setComposerOptions] = useState<ComposerOptions>(getComposerDefaults(emptySettings));
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
  const [isUpdateDropTarget, setIsUpdateDropTarget] = useState(false);
  const updateSectionRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const safetyConfirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const updateDropDepthRef = useRef(0);
  const shownErrorProjectIds = useRef<Set<string>>(new Set());
  const lastProjectRelationshipRefreshAtRef = useRef(0);
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
  const activePlan = selectedDetail?.activePlan ?? null;
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
      rootOnly: rootProjectsOnly,
    }),
    [projectLastViewed, projectSortMode, projects, rootProjectsOnly],
  );


  const syncProjectSelection = useCallback((projectId: string | null) => {
    const requestId = ++projectSelectionRequestIdRef.current;
    selectedProjectIdRef.current = projectId;
    agentSelectedProjectIdRef.current = projectId;

    if (!projectId) {
      setSelectedProjectId(null);
      setAgentSelectedProjectId(null);
      setAgentSession(null);
      setProgramAgentSession(null);
      setAgentViewStage("function");
      setRequestedDirectorProfileId(null);
      return;
    }

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
      setSettings(bootstrap.settings);
      setTheme(bootstrap.settings.theme);
      setProjects(bootstrap.projects);
      setProjectRuntimes(bootstrap.runtimes);
      setAuth(bootstrap.auth);
      setSetup(bootstrap.setup);
      setAppUpdate(bootstrap.appUpdate);
      setModelCatalog(bootstrap.modelCatalog);
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
    // Show a one-time error banner if the plan failed on its own (not user-stopped — those are cleared immediately by the backend)
    if (isTerminal && plan.status === "failed" && plan.errorMessage && !shownErrorProjectIds.current.has(projectId)) {
      shownErrorProjectIds.current.add(projectId);
      setPlanError(plan.errorMessage);
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
      const safetyState = await confirmDirtyWorkIfNeeded(project.id, "Save to GitHub?", "Save to GitHub");
      if (!safetyState) {
        return;
      }

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

  const hasProjectBrowserTarget = (project: Project): boolean =>
    Boolean(project.runtimeConfig.lastRunUrl ?? project.runtimeConfig.openUrl);

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
        const expectsBrowserTarget = hasProjectBrowserTarget(detail.project);
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
        const expectsBrowserTarget = hasProjectBrowserTarget(detail.project);
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

    if (composerOptions.planningMode === "auto" || composerOptions.planningMode === "none") {
      const confirmed = await confirmDirtyWorkIfNeeded(selectedProject.id, "Start AI edit?", "Start AI edit");
      if (!confirmed) {
        return;
      }
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

    const confirmed = await confirmDirtyWorkIfNeeded(selectedProject.id, "Approve plan and start work?", "Approve plan");
    if (!confirmed) {
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

  const handleToggleAutomationPriority = (projectId: string) => {
    setAutomationPriorityProjectIds((current) => {
      const next = { ...current };
      if (next[projectId]) {
        delete next[projectId];
      } else {
        next[projectId] = true;
      }
      return next;
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
  const canConfirmPlan = activePlan?.status === "awaitingApproval";
  const showUpdateDock = Boolean(activePlan);
  const isSelectedProjectView = activePage === "projects" && Boolean(selectedProject);
  const useComposerLayout = isSelectedProjectView || activePage === "agents";
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
            onClick={openSettingsModal}
          >
            Update issue
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
          <span className="projectBrowseBadge">{rootProjectsOnly ? "Root Projects" : "All Projects"}</span>
          <span className="projectBrowseCount">
            {displayedProjects.length} / {projects.length}
          </span>
        </div>
        <div className="projectBrowseTopBarControls">
          <div className="speedToggle projectBrowseToggle" role="group" aria-label="Sort projects">
            <button
              type="button"
              className={projectSortMode === "lastOpened" ? "toggleOption projectBrowseOption active" : "toggleOption projectBrowseOption"}
              onClick={() => {
                localStorage.setItem("projectSortMode", "lastOpened");
                setProjectSortMode("lastOpened");
              }}
            >
              Last opened
            </button>
            <button
              type="button"
              className={projectSortMode === "lastUpdated" ? "toggleOption projectBrowseOption active" : "toggleOption projectBrowseOption"}
              onClick={() => {
                localStorage.setItem("projectSortMode", "lastUpdated");
                setProjectSortMode("lastUpdated");
              }}
            >
              Last updated
            </button>
            <button
              type="button"
              className={projectSortMode === "lastSaved" ? "toggleOption projectBrowseOption active" : "toggleOption projectBrowseOption"}
              onClick={() => {
                localStorage.setItem("projectSortMode", "lastSaved");
                setProjectSortMode("lastSaved");
              }}
            >
              Last saved
            </button>
          </div>
          <div className="speedToggle projectBrowseToggle" role="group" aria-label="Project visibility">
            <button
              type="button"
              className={rootProjectsOnly ? "toggleOption projectBrowseOption" : "toggleOption projectBrowseOption active"}
              onClick={() => {
                localStorage.setItem("rootProjectsOnly", "false");
                setRootProjectsOnly(false);
              }}
            >
              All Projects
            </button>
            <button
              type="button"
              className={rootProjectsOnly ? "toggleOption projectBrowseOption active" : "toggleOption projectBrowseOption"}
              onClick={() => {
                localStorage.setItem("rootProjectsOnly", "true");
                setRootProjectsOnly(true);
              }}
            >
              Root Projects
            </button>
          </div>
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
        <button
          type="button"
          className="agentTopBarButton agentDetailsButton windowNoDrag"
          onClick={() => setShowProjectDetails(true)}
        >
          Project Details
        </button>
      </div>

      <div className="chatViewportDivider pageChromeDivider" aria-hidden="true" />

      <div className="chatFabWrap">
        <button
          type="button"
          className="chatFab"
          aria-label="Open agent chat"
          onClick={() => {
            setCurrentPage("agents");
          }}
        >
          <svg width="28" height="28" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M2 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6l-4 3V4z" fill="currentColor" />
          </svg>
        </button>
      </div>

      <div className="projectDetailWorkspace">
        <div className="projectSummaryCard">
          <div className="summaryMain">
            <div className="summaryHeaderRow">
              <div className="summaryCopy">
                <h2>{selectedProject.name}</h2>
                <p className="summaryTimestamp">Last updated at {formatDate(selectedProject.lastUpdatedAt)}</p>
                {selectedProject.lastError ? <div className="errorBanner">{selectedProject.lastError}</div> : null}
              </div>
              <div className="summaryActionRail">
                <button
                  type="button"
                  className={summaryPrimaryActionClassName}
                  onClick={() => {
                    if (summaryPrimaryActionDisabled) {
                      return;
                    }

                    if (showRunningState) {
                      void handleOpen();
                    } else {
                      void handleRun();
                    }
                  }}
                  aria-label={summaryPrimaryActionLabel}
                  title={summaryPrimaryActionLabel}
                  aria-disabled={summaryPrimaryActionDisabled}
                >
                  {showRunningState ? <PlusIcon /> : <PlayIcon />}
                </button>
                <button
                  type="button"
                  className={summaryKillActionClassName}
                  onClick={() => {
                    if (summaryKillActionDisabled) {
                      return;
                    }

                    void handleKill();
                  }}
                  aria-label="Kill program"
                  title="Kill program"
                  aria-disabled={summaryKillActionDisabled}
                >
                  <XIcon />
                </button>
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
                    ? "Saved to GitHub"
                    : githubSaveState === "up-to-date"
                      ? "Already up to date"
                      : githubSaveState === "error"
                        ? "Save failed"
                        : "Save to GitHub"}
              </button>
              <button
                type="button"
                className={
                  githubDownloadState === "downloaded"
                    ? "githubSaveButton githubSaveButton-success"
                    : githubDownloadState === "up-to-date"
                      ? "githubSaveButton githubSaveButton-neutral"
                      : githubDownloadState === "error"
                        ? "githubSaveButton githubSaveButton-error"
                        : "githubSaveButton"
                }
                onClick={() => void handleDownloadFromGithub()}
                disabled={githubSaveState === "saving" || githubDownloadState === "downloading"}
                aria-label="Download from GitHub"
              >
                <ArrowDownIcon />
                {githubDownloadState === "downloading"
                  ? "Downloading..."
                  : githubDownloadState === "downloaded"
                    ? "Downloaded"
                    : githubDownloadState === "up-to-date"
                      ? "Already up to date"
                      : githubDownloadState === "error"
                        ? "Download failed"
                        : "Download from GitHub"}
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
            <span className="githubRepoStatus">
              {formatGithubRepoStatus(selectedProject?.githubConnection ?? null)}
            </span>
          </div>
          <div className="summarySafetyRow">
            <button
              type="button"
              className="secondaryButton smallButton"
              onClick={() => void handleRequestRestoreLastBackup(selectedProject)}
              disabled={isProjectRunning || busyKey === `backup.restore.${selectedProject.id}` || busyKey === `backup.check.${selectedProject.id}`}
              title={isProjectRunning ? "Stop the project before restoring a backup." : "Restore this project from its latest PROGRAMS backup."}
            >
              {busyKey === `backup.check.${selectedProject.id}` ? "Checking Backup..." : "Restore Last Backup"}
            </button>
            {isProjectRunning ? <span className="helperText">Stop the project before restoring.</span> : null}
          </div>
        </div>
        {selectedProjectExactChildren.length > 0 || selectedProjectMaybeRelated.length > 0 ? (
          <div className="projectRelationshipGrid">
            {selectedProjectExactChildren.length > 0 ? (
              <section className="projectRelationshipCard">
                <div className="projectRelationshipHead">
                  <div>
                    <div className="sectionTag">Sub-components</div>
                    <h3>Nested projects inside this root</h3>
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
                    <h3>Projects with overlapping code</h3>
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
        ) : null}
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
            <HomepageComposer />
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

      {showProjectDetails && selectedProject ? (
        <AgentProjectDetailsModal
          project={selectedProject}
          session={programAgentSession}
          settings={settings}
          modelCatalog={modelCatalog}
          onUpdateAgentDefaults={handleUpdateAgentDefaults}
          onSessionUpdate={(session) => setProgramAgentSession(session)}
          pushToast={pushToast}
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
          usage={usage}
          projects={projects}
          automationPriorityProjectIds={automationPriorityProjectIds}
          providerBusy={busyKey === "settings.agentDefaults"}
          onProviderChange={(provider) => void handleUpdateAgentDefaults({ provider })}
          onClose={() => setShowUsageSheet(false)}
        />
      ) : null}

      {programDetailsProjectId && programDetailsProject ? (
        <ProgramDetailsModal
          project={programDetailsProject}
          updates={projectDetails[programDetailsProjectId]?.updates ?? []}
          agentSession={programAgentSession}
          auth={auth}
          busyKey={busyKey}
          onClose={() => setProgramDetailsProjectId(null)}
          onUndo={(update) => void handleUndoUpdate(update)}
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
