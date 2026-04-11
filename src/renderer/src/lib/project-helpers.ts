import type {
  AppUpdateStatus,
  Project,
  RuntimeState,
  Settings,
  Theme,
} from "@shared/types";
import {
  THEME_STORAGE_KEY,
  DEFAULT_ICON_COLORS,
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

export type HomeTileDotState = "ready" | "launching" | "running" | "updating" | "runningUpdating" | "error";
export type HomeAppUpdateButtonState = "prepare" | "install" | "issue" | null;

export const createEmptyForm = (): AddProjectFormState => ({
  mode: "create",
  createName: "",
  parentDirectory: "",
  attachDirectory: "",
  iconColor: "#0EA5E9",
  initialIdea: "",
});

export const nextIconColor = (count: number): string => DEFAULT_ICON_COLORS[count % DEFAULT_ICON_COLORS.length];

export const parseProjectSortTime = (value: string | null): number => {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const sortProjectsForDisplay = (projects: Project[], lastViewed: Record<string, string> = {}): Project[] =>
  [...projects].sort((left, right) => {
    const lastViewedDelta = parseProjectSortTime(lastViewed[right.id] ?? null) - parseProjectSortTime(lastViewed[left.id] ?? null);
    if (lastViewedDelta !== 0) {
      return lastViewedDelta;
    }

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

export const readInitialTheme = (): Theme =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";

export const applyTheme = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
};

export const createProjectTileStyle = (iconColor: string): CSSProperties => {
  const normalized = normalizeHexColor(iconColor) ?? "#0EA5E9";

  return {
    background: normalized,
  };
};

export const createAgentLandingTileStyle = (iconColor: string, muted = false): CSSProperties => {
  const normalized = normalizeHexColor(iconColor) ?? "#0EA5E9";

  return {
    background: muted
      ? `color-mix(in srgb, ${normalized} 68%, #202833 32%)`
      : normalized,
  };
};

export const isProjectUpdating = (status: Project["status"]): boolean => status === "executing";

export const getHomeTileDotState = (
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
