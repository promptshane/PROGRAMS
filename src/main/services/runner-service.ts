import { spawn, type ChildProcess } from "node:child_process";
import { app } from "electron";
import { join, resolve } from "node:path";
import type { Project, RuntimeState } from "../../shared/types.ts";
import { EMPTY_RUNTIME } from "../defaults.ts";
import { readTextFile, writeTextFile } from "../utils/fs.ts";
import { execCommand, execFileCommand, getCommandEnv } from "../utils/process.ts";

type Emit = (
  event:
    | { type: "project.runtime"; projectId: string; runtime: RuntimeState }
    | { type: "project.updated"; project: Project }
    | { type: "toast"; level: "info" | "success" | "error"; message: string }
) => void;
type RuntimeExitHandler = (projectId: string) => void | Promise<void>;
type RuntimeUrlHandler = (projectId: string, url: string) => void | Promise<void>;

interface PersistedRuntimeEntry {
  projectId: string;
  pid: number;
  cwd: string;
  runCommand: string;
  startedAt: string;
  url: string | null;
  source?: RuntimeState["source"];
}

interface PersistedRuntimeRegistry {
  entries: PersistedRuntimeEntry[];
}

interface RunningProcess {
  child: ChildProcess | null;
  runtime: RuntimeState;
  cwd: string;
  runCommand: string;
}

interface LocalSocketAddress {
  host: string;
  port: number;
}

interface ProcessDetails {
  cwd: string;
  command: string;
}

const LOCAL_URL_REGEX = /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1):\d{2,5}(?:\/[^\s"'<>]*)?)/gi;
const RUNTIME_URL_HINT_REGEX = /\b(local|ready|running|listening|started|server)\b/i;
const ASSET_PATH_REGEX =
  /(?:\/@fs\/|\/@id\/|\/node_modules\/|\/__vite_ping(?:$|[/?#])|\/src\/.*\.(?:[cm]?[jt]sx?|css|map)$|\.(?:[cm]?[jt]sx?|css|map)$)/i;
const PROCESS_CWD_BIN = "/usr/sbin/lsof";
const PROCESS_LIST_BIN = "/bin/ps";
const REGISTRY_FILE_NAME = "runtime-registry.json";

const normalizeCommand = (value: string): string => value.replace(/\s+/g, " ").trim();

const normalizeHostToken = (value: string): string => value.trim().replace(/^\[|\]$/g, "").toLowerCase();

const canonicalizeDetectedHost = (value: string): string | null => {
  const normalized = normalizeHostToken(value);
  if (!normalized) {
    return null;
  }
  if (normalized === "127.0.0.1") {
    return "127.0.0.1";
  }
  if (normalized === "localhost") {
    return "localhost";
  }
  if (normalized === "::1") {
    return "[::1]";
  }
  if (normalized === "0.0.0.0" || normalized === "*") {
    return "127.0.0.1";
  }
  if (normalized === "::") {
    return "[::1]";
  }

  return null;
};

const canonicalizePreferredLoopbackHost = (value: string | null | undefined): string | null => {
  if (!value?.trim()) {
    return null;
  }

  const normalized = normalizeHostToken(value);
  if (normalized === "127.0.0.1" || normalized === "localhost") {
    return "127.0.0.1";
  }
  if (normalized === "::1") {
    return "[::1]";
  }

  return null;
};

const canonicalizeSocketHost = (value: string, preferredHost?: string | null): string | null => {
  const normalized = normalizeHostToken(value);
  if (!normalized) {
    return null;
  }
  if (normalized === "127.0.0.1") {
    return "127.0.0.1";
  }
  if (normalized === "::1") {
    return "[::1]";
  }
  if (normalized === "localhost") {
    return canonicalizePreferredLoopbackHost(preferredHost) ?? "127.0.0.1";
  }
  if (normalized === "0.0.0.0" || normalized === "*" || normalized === "::") {
    return canonicalizePreferredLoopbackHost(preferredHost) ?? "127.0.0.1";
  }

  return null;
};

const formatLocalUrl = (host: string, port: number): string => {
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${formattedHost}:${port}/`;
};

const parseLocalSocketAddress = (value: string): LocalSocketAddress | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("[")) {
    const closingIndex = trimmed.indexOf("]");
    if (closingIndex < 0) {
      return null;
    }
    const host = trimmed.slice(0, closingIndex + 1);
    const port = Number(trimmed.slice(closingIndex + 2));
    return Number.isInteger(port) && port > 0 ? { host, port } : null;
  }

  const separatorIndex = trimmed.lastIndexOf(":");
  if (separatorIndex < 0) {
    return null;
  }

  const host = trimmed.slice(0, separatorIndex);
  const port = Number(trimmed.slice(separatorIndex + 1));
  return Number.isInteger(port) && port > 0 ? { host, port } : null;
};

const parseLocalUrl = (value: string | null | undefined): { url: string; host: string; port: number } | null => {
  const normalized = normalizeLocalRuntimeUrl(value);
  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);
    const host = canonicalizeDetectedHost(url.hostname);
    if (!host || !url.port) {
      return null;
    }

    const port = Number(url.port);
    return Number.isInteger(port) && port > 0 ? { url: normalized, host, port } : null;
  } catch {
    return null;
  }
};

const normalizeLocalRuntimeUrl = (value: string | null | undefined): string | null => {
  if (!value?.trim()) {
    return null;
  }

  let cleaned = value.trim();
  while (cleaned && ["(", '"', "'", "[", "<"].includes(cleaned[0])) {
    cleaned = cleaned.slice(1).trimStart();
  }
  while (cleaned && [")", '"', "'", "]", ",", ";", ">"].includes(cleaned.at(-1) ?? "")) {
    cleaned = cleaned.slice(0, -1).trimEnd();
  }

  try {
    const url = new URL(cleaned);
    const normalizedHost = canonicalizeDetectedHost(url.hostname);
    if (!normalizedHost) {
      return null;
    }
    if (!url.port) {
      return null;
    }
    if (ASSET_PATH_REGEX.test(url.pathname)) {
      return null;
    }

    return formatLocalUrl(normalizedHost, Number(url.port));
  } catch {
    return null;
  }
};

const createRuntimeState = (
  projectId: string,
  source: RuntimeState["source"],
  overrides: Partial<RuntimeState>,
): RuntimeState => ({
  ...EMPTY_RUNTIME(projectId),
  source,
  controllable: source !== "none" && source !== "self",
  ...overrides,
});

export class RunnerService {
  private readonly processes = new Map<string, RunningProcess>();
  private readonly registryPath = join(app.getPath("userData"), REGISTRY_FILE_NAME);
  private onRuntimeExit: RuntimeExitHandler | null = null;
  private onRuntimeUrlDetected: RuntimeUrlHandler | null = null;
  private selfRuntimeProjectId: string | null = null;
  private selfRuntime: RuntimeState | null = null;
  private registryWriteQueue: Promise<void> = Promise.resolve();

  constructor(private readonly emit: Emit) {}

  private getProjectWorkingPath(project: Project): string {
    return project.runtimeConfig.launch?.workspacePath?.trim() || project.localPath;
  }

  private getProjectWorkingPaths(project: Project): string[] {
    return Array.from(
      new Set([project.localPath, project.runtimeConfig.launch?.workspacePath?.trim() ?? null].filter((value): value is string => Boolean(value))),
    );
  }

  setOnRuntimeExit(handler: RuntimeExitHandler): void {
    this.onRuntimeExit = handler;
  }

  setOnRuntimeUrlDetected(handler: RuntimeUrlHandler): void {
    this.onRuntimeUrlDetected = handler;
  }

  async restorePersistedRuntimes(
    projects: Project[],
    appSourcePath: string | null,
    rendererUrl: string | null,
  ): Promise<void> {
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const registry = await this.readRegistry();

    for (const entry of registry.entries) {
      if (this.processes.has(entry.projectId)) {
        continue;
      }

      const project = projectById.get(entry.projectId);
      if (!project) {
        continue;
      }

      const valid = await this.validatePersistedEntry(entry);
      if (!valid) {
        continue;
      }

      const restoredSource = entry.source === "external" ? "external" : "restored";
      const resolvedUrl = await this.resolveRuntimeUrlForPid(entry.pid, [entry.url]);

      this.processes.set(entry.projectId, {
        child: null,
        cwd: entry.cwd,
        runCommand: entry.runCommand,
        runtime: createRuntimeState(entry.projectId, restoredSource, {
          running: true,
          pid: entry.pid,
          url: resolvedUrl ?? normalizeLocalRuntimeUrl(entry.url),
          startedAt: entry.startedAt,
          logs: [],
        }),
      });
    }

    this.syncSelfRuntime(projects, appSourcePath, rendererUrl);
    await this.persistRegistry();
  }

  syncSelfRuntime(projects: Project[], appSourcePath: string | null, rendererUrl: string | null): string[] {
    const normalizedSourcePath = appSourcePath?.trim() ? resolve(appSourcePath) : null;
    const nextProject = normalizedSourcePath
      ? projects.find((project) => resolve(project.localPath) === normalizedSourcePath) ?? null
      : null;
    const nextProjectId = nextProject?.id ?? null;
    const nextRuntime = nextProject
      ? createRuntimeState(nextProject.id, "self", {
          running: true,
          pid: process.pid,
          url: normalizeLocalRuntimeUrl(rendererUrl),
          startedAt:
            this.selfRuntimeProjectId === nextProject.id && this.selfRuntime?.startedAt
              ? this.selfRuntime.startedAt
              : new Date().toISOString(),
          logs: [],
          controllable: false,
        })
      : null;

    const changedIds = new Set<string>();
    if (this.selfRuntimeProjectId && this.selfRuntimeProjectId !== nextProjectId) {
      changedIds.add(this.selfRuntimeProjectId);
    }
    if (nextProjectId) {
      const previousJson =
        this.selfRuntimeProjectId === nextProjectId && this.selfRuntime ? JSON.stringify(this.selfRuntime) : null;
      const nextJson = nextRuntime ? JSON.stringify(nextRuntime) : null;
      if (previousJson !== nextJson) {
        changedIds.add(nextProjectId);
      }
    }

    this.selfRuntimeProjectId = nextProjectId;
    this.selfRuntime = nextRuntime;
    return Array.from(changedIds);
  }

  getRuntime(projectId: string): RuntimeState {
    if (this.selfRuntimeProjectId === projectId && this.selfRuntime) {
      return this.selfRuntime;
    }

    return this.processes.get(projectId)?.runtime ?? EMPTY_RUNTIME(projectId);
  }

  getRuntimeMap(projectIds: string[]): Record<string, RuntimeState> {
    return Object.fromEntries(projectIds.map((projectId) => [projectId, this.getRuntime(projectId)]));
  }

  async validateRuntime(projectId: string): Promise<RuntimeState> {
    if (this.selfRuntimeProjectId === projectId && this.selfRuntime) {
      return this.selfRuntime;
    }

    const running = this.processes.get(projectId);
    if (!running) {
      return EMPTY_RUNTIME(projectId);
    }

    if (running.child && running.child.exitCode === null) {
      if (!running.runtime.pid || !this.isProcessAlive(running.runtime.pid)) {
        await this.invalidateRuntime(projectId);
        return EMPTY_RUNTIME(projectId);
      }

      await this.syncRuntimeUrl(projectId);

      return running.runtime;
    }

    if (!running.runtime.pid) {
      await this.invalidateRuntime(projectId);
      return EMPTY_RUNTIME(projectId);
    }

    const valid = await this.validatePersistedEntry({
      projectId,
      pid: running.runtime.pid,
      cwd: running.cwd,
      runCommand: running.runCommand,
      startedAt: running.runtime.startedAt ?? new Date().toISOString(),
      url: running.runtime.url,
    });

    if (!valid) {
      await this.invalidateRuntime(projectId);
      return EMPTY_RUNTIME(projectId);
    }

    await this.syncRuntimeUrl(projectId);

    return running.runtime;
  }

  async detectExternalRuntime(project: Project): Promise<RuntimeState> {
    if (!project.runtimeConfig.runCommand) {
      return EMPTY_RUNTIME(project.id);
    }

    const existing = this.processes.get(project.id);
    if (existing?.runtime.running && existing.runtime.source === "external") {
      if (!existing.runtime.pid || !this.isProcessAlive(existing.runtime.pid)) {
        await this.invalidateRuntime(project.id);
      } else {
        await this.syncRuntimeUrl(
          project.id,
          this.collectKnownRuntimeUrls(project).map((entry) => entry.url),
        );
        return existing.runtime;
      }
    }

    const candidateUrls = this.collectKnownRuntimeUrls(project);
    const candidatePorts = Array.from(new Set(candidateUrls.map((entry) => entry.port)));
    const expectedCwds = new Set(this.getProjectWorkingPaths(project).map((path) => resolve(path)));

    for (const port of candidatePorts) {
      const pids = await this.findListeningPids(port);
      for (const pid of pids) {
        const processDetails = await this.readProcessDetails(pid);
        if (!processDetails || !expectedCwds.has(resolve(processDetails.cwd))) {
          continue;
        }

        const resolvedUrl =
          (await this.resolveRuntimeUrlForPid(pid, candidateUrls.map((entry) => entry.url))) ??
          candidateUrls.find((entry) => entry.port === port)?.url ??
          null;
        const runtime = createRuntimeState(project.id, "external", {
          running: true,
          pid,
          url: resolvedUrl,
          startedAt: existing?.runtime.pid === pid ? existing.runtime.startedAt : new Date().toISOString(),
          logs: existing?.runtime.pid === pid ? existing.runtime.logs : [],
        });

        this.processes.set(project.id, {
          child: null,
          cwd: project.localPath,
          runCommand: processDetails.command,
          runtime,
        });
        await this.persistRegistry();
        this.emit({ type: "project.runtime", projectId: project.id, runtime: { ...runtime } });

        if (resolvedUrl) {
          await this.onRuntimeUrlDetected?.(project.id, resolvedUrl);
        }

        return runtime;
      }
    }

    return EMPTY_RUNTIME(project.id);
  }

  async install(project: Project): Promise<void> {
    const installCommand = project.runtimeConfig.installCommand;
    if (!installCommand) {
      return;
    }
    const workingPath = this.getProjectWorkingPath(project);

    this.emit({
      type: "toast",
      level: "info",
      message: `Installing the latest ${project.name} dependencies.`,
    });

    const result = await execCommand(installCommand, workingPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "The project dependencies could not be installed.");
    }
  }

  async start(project: Project): Promise<RuntimeState> {
    const existing = await this.validateRuntime(project.id);
    if (existing.running) {
      return existing;
    }

    const runCommand = project.runtimeConfig.runCommand;
    if (!runCommand) {
      throw new Error("PROGRAMS could not find a run command for this project yet.");
    }
    const workingPath = this.getProjectWorkingPath(project);

    // Wait for the project's known port to be free before spawning
    const knownUrls = this.collectKnownRuntimeUrls(project);
    if (knownUrls.length > 0) {
      await this.waitForPortFree(knownUrls[0].port);
    }

    const commandEnv = await getCommandEnv();
    const child = spawn(runCommand, {
      cwd: workingPath,
      shell: true,
      detached: true,
      env: commandEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const runtime = createRuntimeState(project.id, "managed", {
      running: true,
      pid: child.pid ?? null,
      url: null,
      startedAt: new Date().toISOString(),
      logs: [],
      controllable: true,
    });

    const runningProcess: RunningProcess = {
      child,
      runtime,
      cwd: workingPath,
      runCommand,
    };
    this.processes.set(project.id, runningProcess);
    await this.persistRegistry();
    this.emit({ type: "project.runtime", projectId: project.id, runtime });

    const handleChunk = (chunk: Buffer): void => {
      const text = chunk.toString();
      runtime.logs = [...runtime.logs, ...text.split(/\r?\n/).filter(Boolean)].slice(-200);

      const detectedUrl = this.readRuntimeUrl(text);
      if (detectedUrl && detectedUrl !== runtime.url) {
        runtime.url = detectedUrl;
        void this.persistRegistry();
        void this.onRuntimeUrlDetected?.(project.id, detectedUrl);
        void this.syncRuntimeUrl(project.id, [detectedUrl]);
      }

      this.emit({ type: "project.runtime", projectId: project.id, runtime: { ...runtime } });
    };

    child.stdout?.on("data", handleChunk);
    child.stderr?.on("data", handleChunk);

    child.on("close", () => {
      if (this.processes.get(project.id) !== runningProcess) {
        return;
      }

      this.processes.delete(project.id);
      void this.persistRegistry();
      this.emit({
        type: "project.runtime",
        projectId: project.id,
        runtime: EMPTY_RUNTIME(project.id),
      });
      void this.onRuntimeExit?.(project.id);
    });

    return runtime;
  }

  async stop(projectId: string): Promise<RuntimeState> {
    const runtime = await this.validateRuntime(projectId);
    if (!runtime.running) {
      return EMPTY_RUNTIME(projectId);
    }
    if (runtime.source === "self") {
      throw new Error("PROGRAMS cannot stop itself from the dashboard.");
    }

    const running = this.processes.get(projectId);
    if (!running) {
      return EMPTY_RUNTIME(projectId);
    }

    await this.terminateProcess(running);

    this.processes.delete(projectId);
    await this.persistRegistry();
    const nextRuntime = EMPTY_RUNTIME(projectId);
    this.emit({ type: "project.runtime", projectId, runtime: nextRuntime });
    return nextRuntime;
  }

  private async invalidateRuntime(projectId: string): Promise<void> {
    if (!this.processes.has(projectId)) {
      return;
    }

    this.processes.delete(projectId);
    await this.persistRegistry();
    this.emit({
      type: "project.runtime",
      projectId,
      runtime: EMPTY_RUNTIME(projectId),
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async terminateProcess(running: RunningProcess): Promise<void> {
    const candidatePids = Array.from(
      new Set([running.runtime.pid, running.child?.pid].filter((value): value is number => Boolean(value))),
    );

    for (const pid of candidatePids) {
      const killedGroup = this.tryKillSignal(-pid, "SIGTERM");
      if (killedGroup) {
        break;
      }

      const killedProcess = this.tryKillSignal(pid, "SIGTERM");
      if (killedProcess) {
        break;
      }
    }

    try {
      running.child?.kill("SIGTERM");
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : null;
      if (code !== "ESRCH") {
        throw error;
      }
    }

    // Poll for up to 3 seconds; escalate to SIGKILL if the process is still alive
    const primaryPid = running.runtime.pid ?? running.child?.pid ?? null;
    if (primaryPid !== null) {
      for (let i = 0; i < 3; i++) {
        await this.sleep(1000);
        if (!this.isProcessAlive(primaryPid)) return;
      }

      for (const pid of candidatePids) {
        this.tryKillSignal(-pid, "SIGKILL");
        this.tryKillSignal(pid, "SIGKILL");
      }
      try {
        running.child?.kill("SIGKILL");
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : null;
        if (code !== "ESRCH") {
          throw error;
        }
      }
    }
  }

  private tryKillSignal(target: number, signal: NodeJS.Signals): boolean {
    try {
      process.kill(target, signal);
      return true;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : null;
      if (code === "ESRCH") {
        return false;
      }
      throw error;
    }
  }

  private readRuntimeUrl(output: string): string | null {
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      if (!RUNTIME_URL_HINT_REGEX.test(line)) {
        continue;
      }

      const matches = line.matchAll(LOCAL_URL_REGEX);
      for (const match of matches) {
        const normalized = normalizeLocalRuntimeUrl(match[1]);
        if (normalized) {
          return normalized;
        }
      }
    }

    return null;
  }

  private collectKnownRuntimeUrls(project: Project): Array<{ url: string; host: string; port: number }> {
    return [project.runtimeConfig.lastRunUrl, project.runtimeConfig.openUrl]
      .map((value) => parseLocalUrl(value))
      .filter((value): value is { url: string; host: string; port: number } => Boolean(value));
  }

  private async syncRuntimeUrl(projectId: string, candidateUrls: Array<string | null | undefined> = []): Promise<void> {
    const running = this.processes.get(projectId);
    if (!running?.runtime.running || !running.runtime.pid) {
      return;
    }

    const resolvedUrl = await this.resolveRuntimeUrlForPid(running.runtime.pid, [
      running.runtime.url,
      ...candidateUrls,
    ]);
    if (!resolvedUrl || resolvedUrl === running.runtime.url) {
      return;
    }

    running.runtime.url = resolvedUrl;
    await this.persistRegistry();
    this.emit({ type: "project.runtime", projectId, runtime: { ...running.runtime } });
    await this.onRuntimeUrlDetected?.(projectId, resolvedUrl);
  }

  private async resolveRuntimeUrlForPid(
    pid: number,
    candidateUrls: Array<string | null | undefined> = [],
  ): Promise<string | null> {
    const sockets = await this.readListeningSockets(pid);
    if (!sockets.length) {
      return null;
    }

    const parsedCandidates = candidateUrls
      .map((value) => parseLocalUrl(value))
      .filter((value): value is { url: string; host: string; port: number } => Boolean(value));

    for (const candidate of parsedCandidates) {
      const match = sockets.find((socket) => socket.port === candidate.port);
      if (!match) {
        continue;
      }

      const host = canonicalizeSocketHost(match.host, candidate.host);
      if (host) {
        return formatLocalUrl(host, match.port);
      }
    }

    for (const socket of sockets) {
      const host = canonicalizeSocketHost(socket.host);
      if (host) {
        return formatLocalUrl(host, socket.port);
      }
    }

    return null;
  }

  private async findListeningPids(port: number): Promise<number[]> {
    const result = await execFileCommand(
      PROCESS_CWD_BIN,
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      app.getPath("home"),
    );
    if (result.code !== 0) {
      return [];
    }

    return Array.from(
      new Set(
        result.stdout
          .split(/\r?\n/)
          .map((line) => Number(line.trim()))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    );
  }

  private async waitForPortFree(port: number, timeoutMs = 3500): Promise<void> {
    const interval = 500;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pids = await this.findListeningPids(port);
      if (pids.length === 0) return;
      await this.sleep(interval);
    }
    // Port is still occupied after timeout — proceed anyway so the error surfaces visibly
  }

  private async readListeningSockets(pid: number): Promise<LocalSocketAddress[]> {
    const result = await execFileCommand(
      PROCESS_CWD_BIN,
      ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"],
      app.getPath("home"),
    );
    if (result.code !== 0) {
      return [];
    }

    return result.stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("n"))
      .map((line) => parseLocalSocketAddress(line.slice(1)))
      .filter((value): value is LocalSocketAddress => Boolean(value));
  }

  private async readProcessDetails(pid: number): Promise<ProcessDetails | null> {
    if (!Number.isInteger(pid) || pid <= 0) {
      return null;
    }

    const [cwdResult, commandResult] = await Promise.all([
      execFileCommand(PROCESS_CWD_BIN, ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], app.getPath("home")),
      execFileCommand(PROCESS_LIST_BIN, ["-p", String(pid), "-o", "command="], app.getPath("home")),
    ]);
    if (cwdResult.code !== 0 || commandResult.code !== 0) {
      return null;
    }

    const cwd = cwdResult.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith("n"))
      ?.slice(1)
      .trim();
    const command = commandResult.stdout.trim();
    if (!cwd || !command) {
      return null;
    }

    return { cwd, command };
  }

  private async validatePersistedEntry(entry: PersistedRuntimeEntry): Promise<boolean> {
    if (!Number.isInteger(entry.pid) || entry.pid <= 0) {
      return false;
    }
    if (!entry.cwd.trim() || !entry.runCommand.trim()) {
      return false;
    }
    if (!this.isProcessAlive(entry.pid)) {
      return false;
    }

    const processDetails = await this.readProcessDetails(entry.pid);
    if (!processDetails) {
      return false;
    }
    if (resolve(processDetails.cwd) !== resolve(entry.cwd)) {
      return false;
    }

    return normalizeCommand(processDetails.command).includes(normalizeCommand(entry.runCommand));
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async readRegistry(): Promise<PersistedRuntimeRegistry> {
    const text = await readTextFile(this.registryPath, "{\"entries\":[]}");
    try {
      const parsed = JSON.parse(text) as Partial<PersistedRuntimeRegistry>;
      return {
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      };
    } catch {
      return { entries: [] };
    }
  }

  private async persistRegistry(): Promise<void> {
    const entries = Array.from(this.processes.entries())
      .filter(([, running]) => running.runtime.running && running.runtime.pid && running.runtime.source !== "self")
      .map(([projectId, running]) => ({
        projectId,
        pid: running.runtime.pid!,
        cwd: running.cwd,
        runCommand: running.runCommand,
        startedAt: running.runtime.startedAt ?? new Date().toISOString(),
        url: running.runtime.url,
        source: running.runtime.source,
      }));

    this.registryWriteQueue = this.registryWriteQueue.then(() =>
      writeTextFile(this.registryPath, `${JSON.stringify({ entries }, null, 2)}\n`),
    );

    await this.registryWriteQueue;
  }
}
