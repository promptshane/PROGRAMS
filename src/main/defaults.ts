import "dotenv/config";
import type {
  AdvancedDefaults,
  RuntimeState,
  Settings,
  SetupState,
  SpeedMode,
} from "../shared/types";

export const DEFAULT_ADVANCED_DEFAULTS: AdvancedDefaults = {
  provider: "codex",
  model: "gpt-5.4",
  claudeModel: "sonnet",
  reasoningEffort: "xhigh",
  serviceTier: "flex",
  customInstructions: "",
};

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  uiMode: "simple",
  defaultSpeed: "normal",
  autoApprovePlans: false,
  advancedDefaults: DEFAULT_ADVANCED_DEFAULTS,
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
