import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type {
  LaunchCandidate,
  LaunchConfidence,
  LaunchMetadata,
  LaunchMode,
  LaunchOrigin,
  ProjectRuntimeConfig,
  RunCommandSuggestions,
} from "@shared/types";
import { pathExists } from "./fs.ts";

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
const ROOT_LAUNCHER_NAMES = [
  "run_dev.sh",
  "run-dev.sh",
  "dev.sh",
  "start.sh",
  "start-dev.sh",
  "launch.sh",
  "serve.sh",
  "server.sh",
  "run.sh",
] as const;
const MAKEFILE_TARGETS = ["dev", "start", "run", "serve", "launch"] as const;
const PYTHON_FASTAPI_HINT_REGEX = /\bFastAPI\b|from\s+fastapi\s+import\s+FastAPI|app\s*=\s*FastAPI\(/i;
const PYTHON_FLASK_HINT_REGEX = /\bFlask\b|from\s+flask\s+import\s+Flask|app\s*=\s*Flask\(/i;
const SHALLOW_SCAN_LIMIT = 24;
const IGNORED_LAUNCH_DIRECTORIES = new Set([
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

interface SelectedScript {
  name: string;
  command: string;
}

const WRANGLER_PAGES_DEV_REGEX = /\bwrangler\s+(?:pages\s+)?dev\b/i;
const WRANGLER_CONFIG_FILES = ["wrangler.toml", "wrangler.jsonc", "wrangler.json"] as const;
const CLOUDFLARE_PAGES_PREFERRED_SCRIPT_NAMES = ["pages:dev", "dev:pages", "dev:cf"] as const;

interface FallbackScript {
  name: string;
  command: string;
}

interface LaunchStep {
  cwd: string;
  command: string;
  label: string;
}

interface LaunchDirectoryCandidate {
  cwd: string;
  command: string;
  installCommand: string | null;
  openUrl: string | null;
  packageManager: ProjectRuntimeConfig["packageManager"];
  confidence: LaunchConfidence;
  source: string;
  notes: string[];
}

export interface LaunchResolution {
  packageManager: ProjectRuntimeConfig["packageManager"];
  installCommand: string | null;
  runCommand: string | null;
  openUrl: string | null;
  launch: LaunchMetadata | null;
  wrapperSteps: LaunchStep[] | null;
}

const pickScript = (pkg: Record<string, unknown>, scriptName: SelectedScript["name"]): SelectedScript | null => {
  const scripts = typeof pkg.scripts === "object" && pkg.scripts ? (pkg.scripts as Record<string, unknown>) : {};
  const value = scripts[scriptName];
  return typeof value === "string" ? { name: scriptName, command: value } : null;
};

// Cloudflare Pages projects need both Vite (frontend) and Wrangler (Functions
// emulator + API). Picking plain `dev` runs Vite only and leaves /api/* broken
// locally. If the project root has a wrangler config, prefer a script that
// actually invokes `wrangler [pages] dev`.
const pickCloudflarePagesScript = async (
  directoryPath: string,
  pkg: Record<string, unknown>,
): Promise<SelectedScript | null> => {
  let hasWranglerConfig = false;
  for (const name of WRANGLER_CONFIG_FILES) {
    if (await pathExists(join(directoryPath, name))) {
      hasWranglerConfig = true;
      break;
    }
  }
  if (!hasWranglerConfig) return null;

  const scripts = typeof pkg.scripts === "object" && pkg.scripts ? (pkg.scripts as Record<string, unknown>) : {};

  for (const preferred of CLOUDFLARE_PAGES_PREFERRED_SCRIPT_NAMES) {
    const value = scripts[preferred];
    if (typeof value === "string" && WRANGLER_PAGES_DEV_REGEX.test(value)) {
      return { name: preferred, command: value };
    }
  }
  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value === "string" && WRANGLER_PAGES_DEV_REGEX.test(value)) {
      return { name, command: value };
    }
  }
  return null;
};

const FALLBACK_SCRIPT_NAMES = ["serve", "watch", "develop", "run", "launch", "server"];
const FALLBACK_COMMAND_PREFIXES = ["node ", "tsx ", "ts-node ", "bun ", "vite", "next dev", "nuxt dev"];

const pickFallbackScript = (pkg: Record<string, unknown>): FallbackScript | null => {
  const scripts = typeof pkg.scripts === "object" && pkg.scripts ? (pkg.scripts as Record<string, unknown>) : {};
  // Priority 1: exact name match
  for (const name of FALLBACK_SCRIPT_NAMES) {
    const value = scripts[name];
    if (typeof value === "string") {
      return { name, command: value };
    }
  }
  // Priority 2: command body starts with a known runner prefix
  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value === "string" && FALLBACK_COMMAND_PREFIXES.some((prefix) => value.startsWith(prefix))) {
      return { name, command: value };
    }
  }
  return null;
};

const detectMainFieldCommand = (pkg: Record<string, unknown>): string | null => {
  if (typeof pkg.main !== "string" || !pkg.main) return null;
  const main = pkg.main;
  if (/\.(js|mjs|cjs)$/.test(main)) return `node ${main}`;
  if (/\.(ts|tsx|mts)$/.test(main)) return `tsx ${main}`;
  return null;
};

const buildPackageManagerRunCommand = (pm: string, scriptName: string): string => {
  if (pm === "yarn") return `yarn ${scriptName}`;
  if (pm === "pnpm") return `pnpm run ${scriptName}`;
  if (pm === "bun") return `bun run ${scriptName}`;
  return `npm run ${scriptName}`;
};

const buildCwdCommand = (cwd: string, command: string): string => {
  if (cwd === "." || !cwd.trim()) {
    return command;
  }

  return `cd ${cwd} && ${command}`;
};

const detectPackageManagerAt = async (projectPath: string): Promise<ProjectRuntimeConfig["packageManager"]> => {
  if (await pathExists(join(projectPath, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (await pathExists(join(projectPath, "yarn.lock"))) {
    return "yarn";
  }
  if (await pathExists(join(projectPath, "bun.lockb"))) {
    return "bun";
  }

  return (await pathExists(join(projectPath, "package.json"))) ? "npm" : "unknown";
};

const buildPackageManagerInstallCommand = (packageManager: ProjectRuntimeConfig["packageManager"]): string => {
  if (packageManager === "pnpm") {
    return "pnpm install --frozen-lockfile";
  }
  if (packageManager === "yarn") {
    return "yarn install --immutable";
  }
  if (packageManager === "bun") {
    return "bun install";
  }

  return "npm install";
};

const escapeShellPath = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const wrapCommandForCwd = (cwd: string, command: string): string => {
  if (cwd === "." || !cwd.trim()) {
    return command;
  }

  return `cd ${escapeShellPath(cwd)} && ${command}`;
};

const buildPythonModuleCommand = (cwd: string, fileName: string, port: number): string =>
  wrapCommandForCwd(cwd, `uvicorn ${basename(fileName, ".py")}:app --reload --port ${port}`);

const buildPythonScriptCommand = (cwd: string, fileName: string): string =>
  wrapCommandForCwd(cwd, `python3 ${fileName}`);

const buildMakeCommand = (cwd: string, target: string): string =>
  cwd === "." ? `make ${target}` : `make -C ${escapeShellPath(cwd)} ${target}`;

const buildDockerComposeCommand = (cwd: string): string =>
  wrapCommandForCwd(cwd, "docker compose up --build");

const buildProcfileCommand = (cwd: string): string => wrapCommandForCwd(cwd, "foreman start");

const buildGoCommand = (cwd: string): string => wrapCommandForCwd(cwd, "go run .");

const buildRubyCommand = (cwd: string, command: string): string => wrapCommandForCwd(cwd, command);

const buildLaunchMetadata = (
  origin: LaunchOrigin,
  confidence: LaunchConfidence,
  candidate: LaunchCandidate | null,
  locked = false,
  wrapperPath: string | null = null,
  workspacePath: string | null = null,
): LaunchMetadata => ({
  origin,
  confidence,
  locked,
  candidate,
  wrapperPath,
  workspacePath,
});

const confidenceRank: Record<LaunchConfidence, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const originRank: Record<LaunchOrigin, number> = {
  restored: 1,
  detected: 2,
  wrapped: 3,
  repaired: 4,
  manual: 5,
};

const modeRank: Record<LaunchMode, number> = {
  direct: 3,
  wrapper: 2,
  repair: 1,
};

const scoreLaunchMetadata = (launch: LaunchMetadata | null): number => {
  if (!launch) {
    return 0;
  }
  if (launch.locked) {
    return Number.POSITIVE_INFINITY;
  }

  return confidenceRank[launch.confidence] * 100 + originRank[launch.origin] * 10 + (launch.candidate ? modeRank[launch.candidate.kind] : 0);
};

const normalizeLegacyLaunch = (launch: ProjectRuntimeConfig["launch"], runCommand: string | null): LaunchMetadata | null => {
  if (launch) {
    return launch;
  }

  if (!runCommand) {
    return null;
  }

  return buildLaunchMetadata("restored", "medium", null, true);
};

const chooseStrongerLaunch = (
  current: LaunchMetadata | null,
  detected: LaunchMetadata | null,
): LaunchMetadata | null => {
  if (!current) {
    return detected;
  }
  if (current.locked) {
    return current;
  }
  if (!detected) {
    return current;
  }

  return scoreLaunchMetadata(detected) > scoreLaunchMetadata(current) ? detected : current;
};

const combineInstallCommands = (commands: Array<string | null | undefined>): string | null => {
  const normalized = commands
    .map((command) => command?.trim())
    .filter((command): command is string => Boolean(command));

  return normalized.length > 0 ? normalized.join(" && ") : null;
};

const selectPrimaryLaunchCandidate = (candidates: LaunchDirectoryCandidate[]): LaunchDirectoryCandidate => {
  return [...candidates].sort((left, right) => {
    if (Boolean(left.openUrl) !== Boolean(right.openUrl)) {
      return Boolean(right.openUrl) ? 1 : -1;
    }
    if (left.confidence !== right.confidence) {
      return confidenceRank[right.confidence] - confidenceRank[left.confidence];
    }
    if (left.packageManager !== right.packageManager) {
      return left.packageManager === "unknown" ? 1 : -1;
    }

    return left.cwd.localeCompare(right.cwd);
  })[0] ?? candidates[0];
};

const buildLaunchResolutionFromCandidate = (candidate: LaunchDirectoryCandidate): LaunchResolution => {
  const metadata = buildLaunchMetadata(
    "detected",
    candidate.confidence,
    {
      kind: "direct",
      source: candidate.source,
      confidence: candidate.confidence,
      summary: candidate.notes[0] ?? candidate.source,
      notes: candidate.notes,
    },
  );

  return {
    packageManager: candidate.packageManager,
    installCommand: candidate.installCommand,
    runCommand: candidate.command,
    openUrl: candidate.openUrl,
    launch: metadata,
    wrapperSteps: null,
  };
};

const buildCompositeLaunchResolution = (candidates: LaunchDirectoryCandidate[]): LaunchResolution => {
  const primary = selectPrimaryLaunchCandidate(candidates);
  const installCommand = combineInstallCommands(candidates.map((candidate) => candidate.installCommand));
  const packageManagers = new Set(candidates.map((candidate) => candidate.packageManager).filter((value) => value !== "unknown"));
  const [solePackageManager] = [...packageManagers];
  const packageManager = packageManagers.size === 1
    ? (solePackageManager as ProjectRuntimeConfig["packageManager"])
    : "unknown";
  const wrapperSteps = candidates.map((candidate) => ({
    cwd: candidate.cwd,
    command: candidate.command,
    label: candidate.source,
  }));
  const confidence = candidates.every((candidate) => candidate.confidence === "high") ? "high" : "medium";
  const notes = [
    `Found ${candidates.length} launchable directories.`,
    ...candidates.flatMap((candidate) => candidate.notes.map((note) => `${candidate.cwd}: ${note}`)),
  ];

  return {
    packageManager,
    installCommand,
    runCommand: null,
    openUrl: primary.openUrl,
    launch: buildLaunchMetadata("detected", confidence, {
      kind: "wrapper",
      source: primary.source,
      confidence,
      summary: `Launches ${candidates.length} nested app roots.`,
      notes,
    }),
    wrapperSteps,
  };
};

const detectDirectoryLaunchAtDirectory = async (
  projectPath: string,
  cwd = ".",
): Promise<LaunchDirectoryCandidate | null> => {
  const directoryPath = cwd === "." ? projectPath : join(projectPath, cwd);

  for (const script of ROOT_LAUNCHER_NAMES) {
    if (await pathExists(join(directoryPath, script))) {
      return {
        cwd,
        command: wrapCommandForCwd(cwd, `bash ${script}`),
        installCommand: null,
        openUrl: null,
        packageManager: "unknown",
        confidence: "high",
        source: "shell script",
        notes: [`Found ${script}.`],
      };
    }
  }

  const packageJsonPath = join(directoryPath, "package.json");
  if (await pathExists(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
      const packageManager = await detectPackageManagerAt(directoryPath);
      const installCommand = buildPackageManagerInstallCommand(packageManager);
      const selectedScript =
        (await pickCloudflarePagesScript(directoryPath, packageJson)) ??
        pickScript(packageJson, "dev") ??
        pickScript(packageJson, "start") ??
        pickScript(packageJson, "preview") ??
        pickFallbackScript(packageJson);
      const runCommand = selectedScript
        ? buildPackageManagerRunCommand(packageManager, selectedScript.name)
        : detectMainFieldCommand(packageJson);
      if (runCommand !== null) {
        return {
          cwd,
          command: wrapCommandForCwd(cwd, runCommand),
          installCommand: wrapCommandForCwd(cwd, installCommand),
          openUrl: await inferOpenUrl(directoryPath, packageJson, selectedScript?.command ?? null),
          packageManager,
          confidence: "high",
          source: selectedScript ? "package.json script" : "package.json main",
          notes: selectedScript
            ? [`Selected ${selectedScript.name} script from package.json.`]
            : [`Used the package.json main field in ${cwd === "." ? "the project root" : cwd}.`],
        };
      }
    } catch {
      // ignore invalid package manifests
    }
  }

  for (const makefileName of ["Makefile", "makefile"] as const) {
    const makefilePath = join(directoryPath, makefileName);
    if (!(await pathExists(makefilePath))) {
      continue;
    }

    try {
      const source = await readFile(makefilePath, "utf8");
      const target = MAKEFILE_TARGETS.find((name) => new RegExp(`(?:^|\\n)${name}:`, "i").test(source));
      if (target) {
        return {
          cwd,
          command: buildMakeCommand(cwd, target),
          installCommand: null,
          openUrl: null,
          packageManager: "unknown",
          confidence: "high",
          source: "Makefile",
          notes: [`Found a ${target} target in ${makefileName}.`],
        };
      }
    } catch {
      // ignore unreadable makefiles
    }
  }

  for (const composeName of ["docker-compose.yml", "docker-compose.yaml"] as const) {
    if (await pathExists(join(directoryPath, composeName))) {
      return {
        cwd,
        command: buildDockerComposeCommand(cwd),
        installCommand: null,
        openUrl: null,
        packageManager: "unknown",
        confidence: "high",
        source: "docker-compose",
        notes: [`Found ${composeName}.`],
      };
    }
  }

  for (const procfileName of ["Procfile", "Procfile.dev"] as const) {
    if (await pathExists(join(directoryPath, procfileName))) {
      return {
        cwd,
        command: buildProcfileCommand(cwd),
        installCommand: null,
        openUrl: null,
        packageManager: "unknown",
        confidence: "medium",
        source: "Procfile",
        notes: [`Found ${procfileName}; PROGRAMS will try foreman start.`],
      };
    }
  }

  if (await pathExists(join(directoryPath, "manage.py"))) {
    const installCommand = (await pathExists(join(directoryPath, "requirements.txt")))
      ? "pip install -r requirements.txt"
      : (await pathExists(join(directoryPath, "Pipfile")))
        ? "pipenv install"
        : (await pathExists(join(directoryPath, "pyproject.toml")))
          ? "pip install -e ."
          : null;
    return {
      cwd,
      command: wrapCommandForCwd(cwd, "python3 manage.py runserver 0.0.0.0:8000"),
      installCommand: installCommand ? wrapCommandForCwd(cwd, installCommand) : null,
      openUrl: null,
      packageManager: "unknown",
      confidence: "high",
      source: "Django",
      notes: ["Found manage.py."],
    };
  }

  for (const pyName of ["app.py", "main.py"] as const) {
    const pyPath = join(directoryPath, pyName);
    if (!(await pathExists(pyPath))) {
      continue;
    }

    const installCommand = (await pathExists(join(directoryPath, "requirements.txt")))
      ? "pip install -r requirements.txt"
      : null;

    try {
      const source = await readFile(pyPath, "utf8");
      if (PYTHON_FASTAPI_HINT_REGEX.test(source)) {
        return {
          cwd,
          command: buildPythonModuleCommand(cwd, pyName, 8000),
          installCommand: installCommand ? wrapCommandForCwd(cwd, installCommand) : null,
          openUrl: null,
          packageManager: "unknown",
          confidence: "high",
          source: "FastAPI",
          notes: [`Detected a FastAPI app in ${pyName}.`],
        };
      }
      if (PYTHON_FLASK_HINT_REGEX.test(source) && pyName === "app.py") {
        return {
          cwd,
          command: buildPythonScriptCommand(cwd, pyName),
          installCommand: installCommand ? wrapCommandForCwd(cwd, installCommand) : null,
          openUrl: null,
          packageManager: "unknown",
          confidence: "high",
          source: "Flask",
          notes: [`Detected a Flask app in ${pyName}.`],
        };
      }
    } catch {
      // ignore parse errors and fall through to the plain python command
    }

    return {
      cwd,
      command: buildPythonScriptCommand(cwd, pyName),
      installCommand: installCommand ? wrapCommandForCwd(cwd, installCommand) : null,
      openUrl: null,
      packageManager: "unknown",
      confidence: "high",
      source: "Python script",
      notes: [`Found ${pyName}.`],
    };
  }

  if (await pathExists(join(directoryPath, "go.mod"))) {
    return {
      cwd,
      command: buildGoCommand(cwd),
      installCommand: null,
      openUrl: null,
      packageManager: "unknown",
      confidence: "high",
      source: "Go",
      notes: ["Found go.mod."],
    };
  }

  if (await pathExists(join(directoryPath, "config", "environment.rb"))) {
    return {
      cwd,
      command: buildRubyCommand(cwd, "bundle exec rails server"),
      installCommand: wrapCommandForCwd(cwd, "bundle install"),
      openUrl: null,
      packageManager: "unknown",
      confidence: "high",
      source: "Rails",
      notes: ["Found config/environment.rb."],
    };
  }

  if (await pathExists(join(directoryPath, "Gemfile"))) {
    return {
      cwd,
      command: buildRubyCommand(cwd, "bundle exec rackup"),
      installCommand: wrapCommandForCwd(cwd, "bundle install"),
      openUrl: null,
      packageManager: "unknown",
      confidence: "high",
      source: "Ruby",
      notes: ["Found Gemfile."],
    };
  }

  if (await pathExists(join(directoryPath, "Cargo.toml"))) {
    return {
      cwd,
      command: wrapCommandForCwd(cwd, "cargo run"),
      installCommand: null,
      openUrl: null,
      packageManager: "unknown",
      confidence: "high",
      source: "Rust",
      notes: ["Found Cargo.toml."],
    };
  }

  return null;
};

const detectNestedLaunchCandidates = async (projectPath: string): Promise<LaunchDirectoryCandidate[]> => {
  let entries: string[] = [];
  try {
    entries = await readdir(projectPath);
  } catch {
    return [];
  }

  const childDirectories = entries
    .filter((entry) => {
      if (!entry || entry.startsWith(".")) {
        return false;
      }
      return !IGNORED_LAUNCH_DIRECTORIES.has(entry);
    })
    .slice(0, SHALLOW_SCAN_LIMIT);

  const candidates: LaunchDirectoryCandidate[] = [];
  for (const child of childDirectories) {
    const childPath = join(projectPath, child);
    try {
      const details = await detectDirectoryLaunchAtDirectory(projectPath, child);
      if (details) {
        candidates.push(details);
      }
    } catch {
      // ignore malformed child directories
    }
  }

  return candidates;
};

export const resolveLaunchPlan = async (projectPath: string): Promise<LaunchResolution> => {
  const rootLaunch = await detectDirectoryLaunchAtDirectory(projectPath);
  if (rootLaunch) {
    return buildLaunchResolutionFromCandidate(rootLaunch);
  }

  const childCandidates = await detectNestedLaunchCandidates(projectPath);
  if (childCandidates.length === 1) {
    return buildLaunchResolutionFromCandidate(childCandidates[0]);
  }

  if (childCandidates.length > 1) {
    return buildCompositeLaunchResolution(childCandidates);
  }

  return {
    packageManager: "unknown",
    installCommand: null,
    runCommand: null,
    openUrl: null,
    launch: null,
    wrapperSteps: null,
  };
};

const mergeRuntimeConfig = (
  current: ProjectRuntimeConfig,
  detected: ProjectRuntimeConfig,
): ProjectRuntimeConfig => {
  const currentLaunch = normalizeLegacyLaunch(current.launch, current.runCommand);
  const detectedLaunch = detected.launch ?? null;
  const nextLaunch = chooseStrongerLaunch(currentLaunch, detectedLaunch);
  const nextRunCommand = currentLaunch?.locked ? current.runCommand : (detected.runCommand ?? current.runCommand);
  const nextRunCommandChanged = nextRunCommand !== current.runCommand;

  return {
    packageManager: detected.packageManager !== "unknown" ? detected.packageManager : current.packageManager,
    installCommand: detected.installCommand ?? current.installCommand,
    runCommand: nextRunCommand,
    openUrl: nextRunCommandChanged ? detected.openUrl ?? current.openUrl : current.openUrl ?? detected.openUrl,
    lastRunUrl: current.lastRunUrl,
    initialIdea: current.initialIdea,
    launch: nextLaunch,
  };
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
  // wrangler pages dev / wrangler dev — Cloudflare's emulator listens on 8788
  // by default and proxies the frontend. Check this BEFORE vite so a fullstack
  // command like `wrangler pages dev --proxy 5173 -- npm run dev` opens at the
  // API-serving port rather than the bare Vite port.
  if (WRANGLER_PAGES_DEV_REGEX.test(command)) {
    return 8788;
  }
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
  const resolution = await resolveLaunchPlan(projectPath);

  return {
    packageManager: resolution.packageManager,
    installCommand: resolution.installCommand,
    runCommand: resolution.runCommand,
    openUrl: resolution.openUrl,
    lastRunUrl: null,
    initialIdea: null,
    launch: resolution.launch,
  };
};

export const reconcileRuntimeConfig = (
  current: ProjectRuntimeConfig,
  detected: ProjectRuntimeConfig,
): ProjectRuntimeConfig => mergeRuntimeConfig(current, detected);

const README_COMMAND_REGEX = /(?:^|\n)[^\n]*(?:run|start|launch|usage|getting started)[^\n]*\n+(?:```[^\n]*\n([\s\S]*?)```|`([^`\n]+)`|\$\s+([^\n]+))/gi;
const INLINE_COMMAND_REGEX = /`([^`\n]{3,60})`/g;
const SHELL_PROMPT_REGEX = /^\s*\$\s+(.+)/gm;

const extractReadmeCommands = (readme: string): string[] => {
  const candidates = new Set<string>();

  // Lines starting with $ (shell prompt style)
  for (const match of readme.matchAll(SHELL_PROMPT_REGEX)) {
    const cmd = match[1].trim();
    if (cmd.length > 2 && cmd.length < 80) candidates.add(cmd);
  }

  // Inline backtick commands near run-related keywords
  const lowerReadme = readme.toLowerCase();
  const runKeywordPositions: number[] = [];
  for (const kw of ["run", "start", "launch", "execute", "usage"]) {
    let idx = lowerReadme.indexOf(kw);
    while (idx !== -1) {
      runKeywordPositions.push(idx);
      idx = lowerReadme.indexOf(kw, idx + 1);
    }
  }

  for (const match of readme.matchAll(INLINE_COMMAND_REGEX)) {
    const cmd = match[1].trim();
    const pos = match.index ?? 0;
    const isNearKeyword = runKeywordPositions.some((kwPos) => Math.abs(kwPos - pos) < 300);
    if (isNearKeyword && cmd.length > 2 && cmd.length < 80) {
      candidates.add(cmd);
    }
  }

  // Filter: keep only things that look like shell commands
  const COMMAND_STARTERS = ["npm", "pnpm", "yarn", "bun", "node", "python", "python3", "go ", "cargo", "ruby", "bundle", "bash", "sh ", "make", "docker", "uvicorn", "flask", "deno", "tsx", "ts-node"];
  return [...candidates].filter((cmd) =>
    COMMAND_STARTERS.some((starter) => cmd.startsWith(starter)),
  );
};

export const getRunCommandSuggestions = async (projectPath: string): Promise<RunCommandSuggestions> => {
  // Tier 1: package.json scripts
  const packageScripts: string[] = [];
  const packageJsonPath = join(projectPath, "package.json");
  let packageJsonContent = "";
  if (await pathExists(packageJsonPath)) {
    try {
      packageJsonContent = await readFile(packageJsonPath, "utf8");
      const pkg = JSON.parse(packageJsonContent) as Record<string, unknown>;
      const scripts = typeof pkg.scripts === "object" && pkg.scripts ? (pkg.scripts as Record<string, string>) : {};
      packageScripts.push(...Object.keys(scripts));
    } catch {
      // ignore parse errors
    }
  }

  // Tier 2: README commands
  let readmeSuggestions: string[] = [];
  let readmeContent = "";
  for (const name of ["README.md", "readme.md", "README.txt", "README"]) {
    const readmePath = join(projectPath, name);
    if (await pathExists(readmePath)) {
      try {
        readmeContent = await readFile(readmePath, "utf8");
        readmeSuggestions = extractReadmeCommands(readmeContent);
      } catch {
        // ignore
      }
      break;
    }
  }

  // Project context for Tier 3 (compact summary for Claude)
  let topLevelFiles: string[] = [];
  try {
    topLevelFiles = await readdir(projectPath);
  } catch {
    // ignore
  }

  const contextParts: string[] = [
    `Top-level files: ${topLevelFiles.slice(0, 40).join(", ")}`,
  ];
  if (packageJsonContent) {
    contextParts.push(`package.json:\n${packageJsonContent.slice(0, 1500)}`);
  }
  if (readmeContent) {
    contextParts.push(`README (first 1500 chars):\n${readmeContent.slice(0, 1500)}`);
  }

  return {
    packageScripts,
    readmeSuggestions,
    projectContext: contextParts.join("\n\n"),
  };
};

export const deriveAttachedProjectName = (localPath: string): string => basename(localPath);

export const deriveProjectDescription = (name: string, initialIdea?: string | null): string => {
  if (initialIdea?.trim()) {
    return initialIdea.trim();
  }

  return `${name} is managed in PROGRAMS and ready for plan-first updates with Codex.`;
};
