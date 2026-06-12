import type {
  AppUpdateStatus,
  Project,
  RuntimeState,
  Settings,
  Theme,
} from "@shared/types";
import {
  FALLBACK_PROJECT_ICON_COLOR,
  collectUsedProjectIconColors,
  pickAvailableProjectIconColor,
} from "@shared/project-colors";
import {
  THEME_STORAGE_KEY,
  COMPOSER_MIN_HEIGHT,
  COMPOSER_MAX_HEIGHT,
  type ComposerOptions,
} from "./constants";
import { normalizeHexColor } from "./formatting";
import type { CSSProperties } from "react";

export type { ComposerOptions };

export interface AddProjectFormState {
  mode: "create" | "attach";
  createName: string;
  parentDirectory: string;
  attachDirectory: string;
  iconColor: string;
  initialIdea: string;
}

export type ProgramDetailsTab = "ideal" | "current" | "planned" | "history";
export type ProjectSortMode = "lastOpened" | "lastUpdated" | "lastSaved";
export type ProjectFilterMode = "all" | "root" | "starred";

export type HomeTileDotState = "ready" | "launching" | "running" | "error";
export type HomeAppUpdateButtonState = "prepare" | "install" | "issue" | null;

export interface AutoInstallAppUpdateDecisionInput {
  status: AppUpdateStatus;
  enabled: boolean;
  busyKey: string | null;
  attemptedKeys?: ReadonlySet<string>;
}

export const createEmptyForm = (): AddProjectFormState => ({
  mode: "create",
  createName: "",
  parentDirectory: "",
  attachDirectory: "",
  iconColor: FALLBACK_PROJECT_ICON_COLOR,
  initialIdea: "",
});

export const nextIconColor = (projects: Project[], excludeProjectId: string | null = null): string =>
  pickAvailableProjectIconColor(collectUsedProjectIconColors(projects, excludeProjectId));

export const parseProjectSortTime = (value: string | null): number => {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const getProjectLastOpenedTime = (project: Project, lastViewed: Record<string, string> = {}): number =>
  parseProjectSortTime(lastViewed[project.id] ?? null);

export const getProjectLastSavedTime = (project: Project): number =>
  parseProjectSortTime(project.githubConnection?.lastPushedAt ?? null);

export const getProjectLastUpdatedTime = (project: Project): number =>
  Math.max(
    parseProjectSortTime(project.relationship.contentUpdatedAt),
    getProjectLastSavedTime(project),
  );

export const sortProjectsForDisplay = (
  projects: Project[],
  {
    lastViewed = {},
    sortMode = "lastOpened",
    rootOnly = false,
    filterMode = "all",
    starredIds = {},
  }: {
    lastViewed?: Record<string, string>;
    sortMode?: ProjectSortMode;
    /** @deprecated use filterMode instead */
    rootOnly?: boolean;
    filterMode?: ProjectFilterMode;
    starredIds?: Record<string, boolean>;
  } = {},
): Project[] =>
  [...projects]
    .filter((project) => {
      const mode = rootOnly ? "root" : filterMode;
      if (mode === "root") return project.relationship.exactParentProjectId == null;
      if (mode === "starred") return Boolean(starredIds[project.id]);
      return true;
    })
    .sort((left, right) => {
      const primaryDelta =
        sortMode === "lastSaved"
          ? getProjectLastSavedTime(right) - getProjectLastSavedTime(left)
          : sortMode === "lastUpdated"
          ? getProjectLastUpdatedTime(right) - getProjectLastUpdatedTime(left)
          : getProjectLastOpenedTime(right, lastViewed) - getProjectLastOpenedTime(left, lastViewed);
      if (primaryDelta !== 0) {
        return primaryDelta;
      }

      const lastOpenedDelta = getProjectLastOpenedTime(right, lastViewed) - getProjectLastOpenedTime(left, lastViewed);
      if (lastOpenedDelta !== 0) {
        return lastOpenedDelta;
      }

      const lastUpdatedDelta = getProjectLastUpdatedTime(right) - getProjectLastUpdatedTime(left);
      if (lastUpdatedDelta !== 0) {
        return lastUpdatedDelta;
      }

      const createdDelta = parseProjectSortTime(right.createdAt) - parseProjectSortTime(left.createdAt);
      if (createdDelta !== 0) {
        return createdDelta;
      }

      return left.name.localeCompare(right.name);
    });

export const readInitialTheme = (): Theme =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";

export const applyTheme = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
};

const createProjectGradientStyle = (iconColor: string, muted = false): CSSProperties => {
  const normalized = normalizeHexColor(iconColor) ?? FALLBACK_PROJECT_ICON_COLOR;
  const start = muted
    ? `color-mix(in srgb, ${normalized} 48%, #334155 52%)`
    : `color-mix(in srgb, ${normalized} 78%, #FFFFFF 22%)`;
  const end = muted
    ? `color-mix(in srgb, ${normalized} 30%, #08111B 70%)`
    : `color-mix(in srgb, ${normalized} 72%, #08111B 28%)`;

  return {
    backgroundColor: normalized,
    backgroundImage: `linear-gradient(145deg, ${start} 0%, ${normalized} 48%, ${end} 100%)`,
  };
};

export const createProjectTileStyle = (iconColor: string): CSSProperties =>
  createProjectGradientStyle(iconColor);

export const createProjectColorSwatchStyle = (iconColor: string): CSSProperties =>
  createProjectGradientStyle(iconColor);

export const createAgentLandingTileStyle = (iconColor: string, muted = false): CSSProperties =>
  createProjectGradientStyle(iconColor, muted);

export const isProjectUpdating = (status: Project["status"]): boolean => status === "executing";

// The runtime status dot reflects *only* whether the program is running — green
// when running, black when idle. Errors stay red and launching keeps its pulse;
// being updated/coded no longer affects this dot.
export const getHomeTileDotState = (
  project: Project,
  runtime: RuntimeState | null,
  isLaunching: boolean,
): HomeTileDotState => {
  const hasError = project.status === "error" || Boolean(project.lastError);
  const isRunning = Boolean(runtime?.running);

  if (isLaunching) {
    return "launching";
  }
  if (isRunning) {
    return "running";
  }
  if (hasError) {
    return "error";
  }
  return "ready";
};

export const getHomeAppUpdateButtonState = (status: AppUpdateStatus): HomeAppUpdateButtonState => {
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

export const getAutoInstallAppUpdateKey = ({
  status,
  enabled,
  busyKey,
  attemptedKeys,
}: AutoInstallAppUpdateDecisionInput): string | null => {
  if (
    !enabled ||
    busyKey === "app.update" ||
    !status.supported ||
    !status.available ||
    status.buildState !== "ready" ||
    status.requiresAdminPrompt ||
    (status.action !== "install" && status.action !== "restart")
  ) {
    return null;
  }

  const key = [
    status.action,
    status.currentAppPath ?? "",
    status.candidateAppPath ?? "",
    status.candidateUpdatedAt ?? "",
  ].join("::");

  return attemptedKeys?.has(key) ? null : key;
};

export const syncComposerTextareaHeight = (
  textarea: HTMLTextAreaElement | null,
  {
    minHeight = COMPOSER_MIN_HEIGHT,
    maxHeight = COMPOSER_MAX_HEIGHT,
  }: {
    minHeight?: number;
    maxHeight?: number;
  } = {},
): void => {
  if (!textarea) {
    return;
  }

  textarea.style.height = "auto";
  const nextHeight = Math.min(maxHeight, Math.max(minHeight, textarea.scrollHeight));
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
};

export const hasFileDragPayload = (dataTransfer: DataTransfer | null): boolean => {
  if (!dataTransfer) {
    return false;
  }

  if (Array.from(dataTransfer.types).includes("Files")) {
    return true;
  }

  return Array.from(dataTransfer.items ?? []).some((item) => item.kind === "file");
};

export const dedupePaths = (paths: string[]): string[] => Array.from(new Set(paths)).sort();

export const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

export const getComposerDefaults = (settings: Settings): ComposerOptions => ({
  provider: settings.advancedDefaults.provider,
  model: settings.advancedDefaults.model,
  claudeModel: settings.advancedDefaults.claudeModel,
  reasoningEffort: settings.advancedDefaults.reasoningEffort,
  speed: settings.defaultSpeed,
  planningMode: settings.autoApprovePlans ? "auto" : "review",
  contextPaths: [],
});
