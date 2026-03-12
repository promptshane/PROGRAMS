import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { ProjectRuntimeConfig } from "@shared/types";
import { pathExists } from "@main/utils/fs";

export const slugifyRepositoryName = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const LOCAL_URL_LITERAL_REGEX = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}(?:\/[^\s"'<>]*)?/i;
const COMMAND_PORT_REGEX = /(?:^|\s)(?:PORT=(\d{2,5})|--port(?:=|\s+)(\d{2,5})|-p\s+(\d{2,5}))(?:\s|$)/i;
const COMMAND_HOST_REGEX = /(?:^|\s)(?:HOST=([^\s]+)|--host(?:=|\s+)([^\s]+))(?:\s|$)/i;
const VITE_CONFIG_FILE_NAMES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mts",
  "vite.config.mjs",
  "vite.config.cts",
  "vite.config.cjs",
] as const;
const NODE_ENTRYPOINT_REGEXES = [
  /(?:^|\s)node(?:\s+--[^\s]+)*\s+["']?([^"'\s]+?\.(?:[cm]?[jt]s|tsx))["']?/i,
  /(?:^|\s)tsx(?:\s+--[^\s]+)*\s+["']?([^"'\s]+?\.(?:[cm]?ts|tsx))["']?/i,
  /(?:^|\s)ts-node(?:\s+--[^\s]+)*\s+["']?([^"'\s]+?\.(?:[cm]?ts|tsx))["']?/i,
] as const;
const SOURCE_PORT_PATTERNS = [
  /\bPORT\s*=\s*Number\([^)]*\)\s*\|\|\s*(\d{2,5})/i,
  /\bPORT\s*=\s*parseInt\([^)]*\)\s*\|\|\s*(\d{2,5})/i,
  /\bPORT\s*=\s*process\.env\.[A-Z_]+\s*\|\|\s*(\d{2,5})/i,
  /\bPORT\s*=\s*(\d{2,5})/i,
  /\.listen\(\s*(\d{2,5})\s*[,)]/i,
] as const;
const SOURCE_HOST_PATTERNS = [
  /\bHOST\s*=\s*process\.env\.[A-Z_]+\s*\|\|\s*["']([^"']+)["']/i,
  /\bHOST\s*=\s*["']([^"']+)["']/i,
  /\.listen\(\s*\d{2,5}\s*,\s*["']([^"']+)["']/i,
] as const;
const VITE_CONFIG_PORT_PATTERNS = [/\bserver\s*:\s*\{[\s\S]*?\bport\s*:\s*(\d{2,5})/i] as const;
const VITE_CONFIG_HOST_PATTERNS = [/\bserver\s*:\s*\{[\s\S]*?\bhost\s*:\s*["']([^"']+)["']/i] as const;

interface SelectedScript {
  name: "dev" | "start" | "preview";
  command: string;
}

const pickScript = (pkg: Record<string, unknown>, scriptName: SelectedScript["name"]): SelectedScript | null => {
  const scripts = typeof pkg.scripts === "object" && pkg.scripts ? (pkg.scripts as Record<string, unknown>) : {};
  const value = scripts[scriptName];
  return typeof value === "string" ? { name: scriptName, command: value } : null;
};

const collectPackageNames = (pkg: Record<string, unknown>): Set<string> => {
  const dependencies =
    typeof pkg.dependencies === "object" && pkg.dependencies ? Object.keys(pkg.dependencies as Record<string, unknown>) : [];
  const devDependencies =
    typeof pkg.devDependencies === "object" && pkg.devDependencies
      ? Object.keys(pkg.devDependencies as Record<string, unknown>)
      : [];

  return new Set([...dependencies, ...devDependencies]);
};

const readCommandMatch = (command: string, pattern: RegExp): string | null => {
  const match = command.match(pattern);
  if (!match) {
    return null;
  }

  return match.slice(1).find((value) => typeof value === "string" && value.trim())?.trim() ?? null;
};

const readNumberMatch = (source: string, patterns: readonly RegExp[]): number | null => {
  for (const pattern of patterns) {
    const match = source.match(pattern)?.[1];
    if (!match) {
      continue;
    }

    const parsed = Number(match);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
};

const readStringMatch = (source: string, patterns: readonly RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = source.match(pattern)?.[1];
    if (match?.trim()) {
      return match.trim();
    }
  }

  return null;
};

const normalizeHost = (host: string | null | undefined): string => {
  const cleaned = (host ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/[;,]$/, "");

  if (!cleaned || cleaned === "0.0.0.0" || cleaned === "::" || cleaned === "[::]" || cleaned === "::1" || cleaned === "[::1]" || cleaned === "*") {
    return "localhost";
  }

  return cleaned;
};

const buildLocalUrl = (host: string | null | undefined, port: number): string => `http://${normalizeHost(host)}:${port}/`;

const detectFrameworkPort = (packageNames: Set<string>, command: string): number | null => {
  if (packageNames.has("next") || /\bnext\b/i.test(command)) {
    return 3000;
  }
  if (packageNames.has("vite") || /\bvite\b/i.test(command)) {
    return 5173;
  }
  if (packageNames.has("astro") || /\bastro\b/i.test(command)) {
    return 4321;
  }
  if (packageNames.has("nuxt") || /\bnuxt\b/i.test(command)) {
    return 3000;
  }
  if (packageNames.has("react-scripts") || /\breact-scripts\b/i.test(command)) {
    return 3000;
  }
  if (packageNames.has("@angular/cli") || /\bng\s+serve\b/i.test(command)) {
    return 4200;
  }
  if (packageNames.has("parcel") || /\bparcel\b/i.test(command)) {
    return 1234;
  }

  return null;
};

const detectViteConfigUrl = async (
  projectPath: string,
  explicitHost: string | null,
  explicitPort: number | null,
): Promise<string | null> => {
  for (const configName of VITE_CONFIG_FILE_NAMES) {
    const configPath = join(projectPath, configName);
    if (!(await pathExists(configPath))) {
      continue;
    }

    const source = await readFile(configPath, "utf8");
    const configPort = explicitPort ?? readNumberMatch(source, VITE_CONFIG_PORT_PATTERNS);
    if (!configPort) {
      continue;
    }

    const configHost = explicitHost ?? readStringMatch(source, VITE_CONFIG_HOST_PATTERNS);
    return buildLocalUrl(configHost, configPort);
  }

  return explicitPort ? buildLocalUrl(explicitHost, explicitPort) : null;
};

const resolveScriptEntryPath = (projectPath: string, command: string): string | null => {
  for (const pattern of NODE_ENTRYPOINT_REGEXES) {
    const match = command.match(pattern)?.[1];
    if (match) {
      return resolve(projectPath, match);
    }
  }

  return null;
};

const detectEntryPointUrl = async (
  projectPath: string,
  command: string,
  explicitHost: string | null,
  explicitPort: number | null,
): Promise<string | null> => {
  const entryPath = resolveScriptEntryPath(projectPath, command);
  if (!entryPath || !(await pathExists(entryPath))) {
    return explicitPort ? buildLocalUrl(explicitHost, explicitPort) : null;
  }

  const source = await readFile(entryPath, "utf8");
  const literalUrl = source.match(LOCAL_URL_LITERAL_REGEX)?.[0];
  if (literalUrl) {
    const url = new URL(literalUrl);
    return buildLocalUrl(explicitHost ?? url.hostname, Number(url.port) || explicitPort || 80);
  }

  const port = explicitPort ?? readNumberMatch(source, SOURCE_PORT_PATTERNS);
  if (!port) {
    return null;
  }

  const host = explicitHost ?? readStringMatch(source, SOURCE_HOST_PATTERNS);
  return buildLocalUrl(host, port);
};

const inferOpenUrl = async (
  projectPath: string,
  pkg: Record<string, unknown>,
  command: string | null,
): Promise<string | null> => {
  if (!command) {
    return null;
  }

  const explicitPortRaw = readCommandMatch(command, COMMAND_PORT_REGEX);
  const explicitPort = explicitPortRaw ? Number(explicitPortRaw) : null;
  const explicitHost = readCommandMatch(command, COMMAND_HOST_REGEX);
  const entryPointUrl = await detectEntryPointUrl(projectPath, command, explicitHost, explicitPort);
  if (entryPointUrl) {
    return entryPointUrl;
  }

  const packageNames = collectPackageNames(pkg);
  if (packageNames.has("vite") || /\bvite\b/i.test(command)) {
    const viteConfigUrl = await detectViteConfigUrl(projectPath, explicitHost, explicitPort);
    if (viteConfigUrl) {
      return viteConfigUrl;
    }
  }

  const frameworkPort = detectFrameworkPort(packageNames, command);
  if (explicitPort || frameworkPort) {
    return buildLocalUrl(explicitHost, explicitPort ?? frameworkPort ?? 80);
  }

  return null;
};

export const detectRuntimeConfig = async (projectPath: string): Promise<ProjectRuntimeConfig> => {
  const packageJsonPath = join(projectPath, "package.json");

  if (!(await pathExists(packageJsonPath))) {
    return {
      packageManager: "unknown",
      installCommand: null,
      runCommand: null,
      openUrl: null,
      lastRunUrl: null,
      initialIdea: null,
      githubRepoName: null,
    };
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
  const selectedScript = pickScript(packageJson, "dev") ?? pickScript(packageJson, "start") ?? pickScript(packageJson, "preview");

  let packageManager: ProjectRuntimeConfig["packageManager"] = "npm";
  if (await pathExists(join(projectPath, "pnpm-lock.yaml"))) {
    packageManager = "pnpm";
  } else if (await pathExists(join(projectPath, "yarn.lock"))) {
    packageManager = "yarn";
  } else if (await pathExists(join(projectPath, "bun.lockb"))) {
    packageManager = "bun";
  }

  const installCommand =
    packageManager === "pnpm"
      ? "pnpm install --frozen-lockfile"
      : packageManager === "yarn"
        ? "yarn install --immutable"
        : packageManager === "bun"
      ? "bun install"
      : "npm install";

  const runCommand = selectedScript ? `npm run ${selectedScript.name}` : null;
  const openUrl = await inferOpenUrl(projectPath, packageJson, selectedScript?.command ?? null);

  return {
    packageManager,
    installCommand,
    runCommand,
    openUrl,
    lastRunUrl: null,
    initialIdea: null,
    githubRepoName: basename(projectPath),
  };
};

export const deriveAttachedProjectName = (localPath: string): string => basename(localPath);

export const deriveProjectDescription = (name: string, initialIdea?: string | null): string => {
  if (initialIdea?.trim()) {
    return initialIdea.trim();
  }

  return `${name} is managed in PROGRAMS and ready for plan-first updates with Codex.`;
};
