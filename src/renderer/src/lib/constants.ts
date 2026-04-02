import {
  DIRECTOR_COLORS,
  DEFAULT_MODEL_CATALOG,
  type AiProvider,
  type AppUpdateStatus,
  type AuthSnapshot,
  type ClaudeModel,
  type CodexModel,
  type DirectorId,
  type ModelCatalog,
  type PlanningMode,
  type RuntimeState,
  type Settings,
  type SetupSnapshot,
  type SpeedMode,
  type UsageSnapshot,
} from "@shared/types";

export interface ComposerOptions {
  provider: AiProvider;
  model: CodexModel;
  claudeModel: ClaudeModel;
  reasoningEffort: Settings["advancedDefaults"]["reasoningEffort"];
  speed: SpeedMode;
  planningMode: PlanningMode;
  contextPaths: string[];
}

export const THEME_STORAGE_KEY = "programs.theme";
export const DEFAULT_ICON_COLORS = [
  "#FB7185",
  "#F97316",
  "#F59E0B",
  "#10B981",
  "#14B8A6",
  "#0EA5E9",
  "#3B82F6",
  "#64748B",
];

export const emptySettings: Settings = {
  theme: "dark",
  uiMode: "simple",
  defaultSpeed: "normal",
  autoApprovePlans: false,
  advancedDefaults: {
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    reasoningEffort: "xhigh",
    serviceTier: "flex",
    customInstructions: "",
  },
  appSourcePath: "/Users/kc/Desktop/PROGRAMS",
  codexBinaryPath: null,
  claudeBinaryPath: null,
};

export const emptySetup: SetupSnapshot = {
  checks: [],
  completedAt: null,
  isSetupComplete: false,
  showSetupOnLaunch: false,
  currentCheckId: null,
  isPackagedBuild: false,
};

export const emptyAuth: AuthSnapshot = {
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
};

export const emptyUsage: UsageSnapshot = {
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

export const emptyAppUpdateStatus: AppUpdateStatus = {
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

export const emptyRuntimeState = (projectId: string): RuntimeState => ({
  projectId,
  running: false,
  pid: null,
  url: null,
  startedAt: null,
  logs: [],
  source: "none",
  controllable: false,
});

export const emptyModelCatalog: ModelCatalog = DEFAULT_MODEL_CATALOG;

export type AgentDetailsRange = "daily" | "weekly" | "monthly";

export const USAGE_SCHEDULE_TOLERANCE = 6;
export const AGENT_DETAILS_RANGE_OPTIONS: AgentDetailsRange[] = ["daily", "weekly", "monthly"];
export const AGENT_DETAILS_DIRECTOR_FLOW: DirectorId[] = [
  "project-manager",
  "creative-director",
  "rd-director",
  "programming-director",
  "validation-director",
];

export const SIDEBAR_AGENTS: { id: DirectorId; name: string; color: string }[] = [
  { id: "project-manager", name: "Jeff", color: DIRECTOR_COLORS["project-manager"] },
  { id: "creative-director", name: "Dan", color: DIRECTOR_COLORS["creative-director"] },
  { id: "rd-director", name: "Todd", color: DIRECTOR_COLORS["rd-director"] },
  { id: "programming-director", name: "Ping", color: DIRECTOR_COLORS["programming-director"] },
  { id: "validation-director", name: "Pong", color: DIRECTOR_COLORS["validation-director"] },
];

export const COMPOSER_MIN_HEIGHT = 64;
export const COMPOSER_MAX_HEIGHT = 224;
export const AGENT_CHAT_COMPOSER_MIN_HEIGHT = 34;
