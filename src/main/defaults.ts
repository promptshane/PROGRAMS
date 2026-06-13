import "dotenv/config";
import type {
  AdvancedDefaults,
  BasicAutomationSettings,
  RuntimeState,
  Settings,
  SetupState,
  SpeedMode,
} from "../shared/types";

export const DEFAULT_ADVANCED_DEFAULTS: AdvancedDefaults = {
  provider: "codex",
  model: "gpt-5.5",
  claudeModel: "sonnet",
  reasoningEffort: "xhigh",
  serviceTier: "flex",
  customInstructions: "",
};

export const DEFAULT_AUTOMATION_SETTINGS: BasicAutomationSettings = {
  enabled: false,
  projectIds: [],
  note: "",
  provider: "claude",
  model: "gpt-5.5",
  claudeModel: "opus",
  reasoningEffort: "max",
  usagePausePercent: 95,
  rotateMode: "one-at-a-time",
};

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  uiMode: "simple",
  defaultSpeed: "normal",
  autoApprovePlans: false,
  autoInstallAppUpdates: true,
  advancedDefaults: DEFAULT_ADVANCED_DEFAULTS,
  automation: DEFAULT_AUTOMATION_SETTINGS,
  appSourcePath: "/Users/kc/Desktop/PROGRAMS",
  codexBinaryPath: null,
  claudeBinaryPath: null,
};

export const DEFAULT_SETUP_STATE: SetupState = {
  completedAt: null,
};

export const CODEX_DOWNLOAD_URL = "https://openai.com/codex/";
export const CLAUDE_DOWNLOAD_URL = "https://docs.anthropic.com/en/docs/claude-code/overview";
export const CODEX_SIGNIN_HELP_URL =
  "https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan";
export const GIT_DOWNLOAD_URL = "https://git-scm.com/install/mac.html";

export const EMPTY_RUNTIME = (projectId: string): RuntimeState => ({
  projectId,
  running: false,
  pid: null,
  url: null,
  startedAt: null,
  logs: [],
  source: "none",
  controllable: false,
});

export const speedToServiceTier = (speed: SpeedMode): "flex" | "fast" =>
  speed === "fast" ? "fast" : "flex";
