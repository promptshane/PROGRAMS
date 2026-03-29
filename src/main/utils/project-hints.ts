import { readdir } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { readTextFile } from "./fs.ts";
import {
  extractActionHintsFromText,
  extractNavigationHintsFromText,
  type ProjectHintGroup,
  type ProjectHintItem,
} from "../../shared/project-hints.ts";

const MAX_HINT_FILES = 120;
const MAX_HINT_FILE_BYTES = 64_000;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mdx"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".programs",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "vendor",
]);

export interface ProjectRepoHints {
  routes: ProjectHintItem[];
  navigation: ProjectHintGroup[];
  actions: ProjectHintItem[];
}

const humanizeSegment = (value: string): string =>
  value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());

const prioritizeHintFile = (relativePath: string): number => {
  if (/\/App\.(t|j)sx?$/i.test(relativePath) || /^App\.(t|j)sx?$/i.test(relativePath)) {
    return 0;
  }
  if (/\/page\.(t|j)sx?$/i.test(relativePath)) {
    return 1;
  }
  if (/\/pages?\//i.test(relativePath)) {
    return 2;
  }
  return 3;
};

const collectLikelySourceFiles = async (rootPath: string): Promise<string[]> => {
  const discovered: string[] = [];

  const visit = async (dirPath: string): Promise<void> => {
    if (discovered.length >= MAX_HINT_FILES) {
      return;
    }

    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (discovered.length >= MAX_HINT_FILES) {
        return;
      }

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        await visit(join(dirPath, entry.name));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = entry.name.slice(entry.name.lastIndexOf("."));
      if (!SOURCE_EXTENSIONS.has(extension)) {
        continue;
      }

      discovered.push(join(dirPath, entry.name));
    }
  };

  await visit(rootPath);
  return discovered
    .sort((left, right) => {
      const leftRelative = relative(rootPath, left);
      const rightRelative = relative(rootPath, right);
      return prioritizeHintFile(leftRelative) - prioritizeHintFile(rightRelative) || leftRelative.localeCompare(rightRelative);
    })
    .slice(0, MAX_HINT_FILES);
};

const extractRouteHints = (relativePath: string): ProjectHintItem[] => {
  if (/^app(?:\/.*)?\/page\.(t|j)sx?$/i.test(relativePath)) {
    const segments = relativePath.split(sep);
    const routeSegments = segments.slice(1, -1).filter((segment) => segment !== "index");
    const label = routeSegments.length ? routeSegments.map(humanizeSegment).join(" / ") : "Home";
    return [{ file: relativePath, label }];
  }

  if (/^(?:src\/)?pages\/.+\.(t|j)sx?$/i.test(relativePath)) {
    const segments = relativePath.split(sep);
    const pageSegments = segments.slice(segments.indexOf("pages") + 1).join("/").replace(/\.(t|j)sx?$/i, "");
    if (!pageSegments || pageSegments.startsWith("_")) {
      return [];
    }
    return [{ file: relativePath, label: pageSegments.split("/").map(humanizeSegment).join(" / ") }];
  }

  if (basename(relativePath).match(/^App\.(t|j)sx?$/i)) {
    return [{ file: relativePath, label: "App shell" }];
  }

  return [];
};

export const collectProjectRepoHints = async (projectRoot: string): Promise<ProjectRepoHints> => {
  const files = await collectLikelySourceFiles(projectRoot);
  const routes: ProjectHintItem[] = [];
  const navigation: ProjectHintGroup[] = [];
  const actions: ProjectHintItem[] = [];
  const seenRouteKeys = new Set<string>();
  const seenActionKeys = new Set<string>();
  const seenNavigationKeys = new Set<string>();

  for (const filePath of files) {
    const relativePath = relative(projectRoot, filePath);
    for (const route of extractRouteHints(relativePath)) {
      const key = `${route.file}:${route.label}`;
      if (seenRouteKeys.has(key)) {
        continue;
      }
      seenRouteKeys.add(key);
      routes.push(route);
    }

    const text = await readTextFile(filePath, "");
    if (!text || text.length > MAX_HINT_FILE_BYTES) {
      continue;
    }

    for (const hint of extractNavigationHintsFromText(relativePath, text)) {
      const key = `${hint.file}:${hint.source}:${hint.items.join("|")}`;
      if (seenNavigationKeys.has(key)) {
        continue;
      }
      seenNavigationKeys.add(key);
      navigation.push(hint);
    }

    for (const hint of extractActionHintsFromText(relativePath, text)) {
      const key = `${hint.file}:${hint.label}`;
      if (seenActionKeys.has(key)) {
        continue;
      }
      seenActionKeys.add(key);
      actions.push(hint);
    }
  }

  return {
    routes: routes.slice(0, 12),
    navigation: navigation.slice(0, 10),
    actions: actions.slice(0, 20),
  };
};

export const formatProjectRepoHints = (hints: ProjectRepoHints): string => {
  const sections: string[] = [];

  if (hints.routes.length) {
    sections.push("Observed route-like screens:");
    for (const route of hints.routes) {
      sections.push(`- ${route.label} (${route.file})`);
    }
  }

  if (hints.navigation.length) {
    sections.push("Observed navigation states and tab groups:");
    for (const group of hints.navigation) {
      sections.push(`- ${group.source}: ${group.items.join(", ")} (${group.file})`);
    }
  }

  if (hints.actions.length) {
    sections.push("Observed major user actions:");
    for (const action of hints.actions) {
      sections.push(`- ${action.label} (${action.file})`);
    }
  }

  return sections.length ? sections.join("\n") : "No strong local route or navigation hints were detected.";
};
