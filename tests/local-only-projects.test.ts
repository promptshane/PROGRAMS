import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const loadBackendModule = async () => {
  const sourcePath = path.join(projectRoot, "src/main/backend.ts");
  let source = await readFile(sourcePath, "utf8");
  const replacements: Array<[string, string]> = [
    [
      'import { app, shell } from "electron";',
      `const app = { isPackaged: false, getAppPath: () => process.cwd(), getPath: (name: string) => name === "userData" ? join(tmpdir(), "programs-test-user-data") : process.cwd() };
const shell = { openExternal: async () => {}, showItemInFolder: async () => {}, openPath: async () => "" };`,
    ],
    ['import { ClaudeService } from "@main/services/claude-service";', "class ClaudeService {}"],
    ['import { CodexService } from "@main/services/codex-service";', "class CodexService {}"],
    ['import { GitService } from "@main/services/git-service";', "class GitService {}"],
    ['import { PlaywrightService } from "@main/services/playwright-service";', "class PlaywrightService {}"],
    ['import { ProjectStore } from "@main/services/project-store";', "class ProjectStore {}"],
    ['import { RunnerService } from "@main/services/runner-service";', "class RunnerService {}"],
    [
      `  constructor(
    private readonly store: ProjectStore,
    private readonly git: GitService,
    private readonly runner: RunnerService,
    private readonly playwright: PlaywrightService,
    private readonly codex: CodexService,
    private readonly claude: ClaudeService,
    private readonly emit: Emit,
  ) {}`,
      `  constructor(
    store: ProjectStore,
    git: GitService,
    runner: RunnerService,
    playwright: PlaywrightService,
    codex: CodexService,
    claude: ClaudeService,
    emit: Emit,
  ) {
    this.store = store;
    this.git = git;
    this.runner = runner;
    this.playwright = playwright;
    this.codex = codex;
    this.claude = claude;
    this.emit = emit;
  }`,
    ],
  ];

  for (const [search, replacement] of replacements) {
    assert.ok(source.includes(search), `Backend test shim could not find import: ${search}`);
    source = source.replace(search, replacement);
  }

  source = source.replace(/from "(@main|@shared)\/([^"]+)";/g, (_match, scope: string, specifier: string) => {
    const root = scope === "@main"
      ? path.join(projectRoot, "src/main")
      : path.join(projectRoot, "src/shared");
    const directPath = path.join(root, `${specifier}.ts`);
    const indexPath = path.join(root, specifier, "index.ts");
    const resolvedPath = existsSync(directPath) ? directPath : indexPath;
    assert.ok(existsSync(resolvedPath), `Backend test shim could not resolve alias import: ${scope}/${specifier}`);
    return `from ${JSON.stringify(pathToFileURL(resolvedPath).href)};`;
  });

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "programs-backend-local-only-"));
  const tempPath = path.join(tempDir, "backend.test.ts");
  await writeFile(tempPath, source, "utf8");

  try {
    return await import(pathToFileURL(tempPath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const { ProgramsBackend } = await loadBackendModule();

test("inspectAttachPath returns local-only inspection data", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "programs-inspect-project-"));

  try {
    const backend = new ProgramsBackend(
      {} as never,
      {
        inspectRepository: async () => ({ isRepo: true }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      () => {},
    ) as Record<string, unknown>;

    backend.ensureInitialized = async () => {};

    const result = await (backend.inspectAttachPath as Function)(projectDir);

    assert.deepEqual(result, {
      localPath: projectDir,
      name: path.basename(projectDir),
      exists: true,
      isRepo: true,
    });
    assert.equal("remoteUrl" in result, false);
    assert.equal("defaultBranch" in result, false);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("attachProject persists only local project fields and initializes git when needed", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "programs-attach-project-"));
  const createdProjects: Array<Record<string, unknown>> = [];
  let initializedRepo = false;

  try {
    let storedProject: Record<string, unknown> | null = null;
    const backend = new ProgramsBackend(
      {
        listProjects: async () => (storedProject ? [storedProject] : []),
        readSettings: async () => ({}),
        createProject: async (project: Record<string, unknown>) => {
          createdProjects.push(project);
          storedProject = project;
          return project;
        },
        readProject: async () => storedProject,
        updateProject: async (project: Record<string, unknown>) => {
          storedProject = project;
          return project;
        },
      } as never,
      {
        inspectRepository: async () => ({ isRepo: false }),
        initializeRepository: async () => {
          initializedRepo = true;
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      () => {},
    ) as Record<string, unknown>;

    backend.ensureInitialized = async () => {};
    backend.syncSelfRuntime = async () => [];

    const project = await (backend.attachProject as Function)({
      localPath: projectDir,
      iconColor: "#0EA5E9",
    });

    assert.equal(initializedRepo, true);
    assert.equal(createdProjects.length, 1);
    assert.equal(project.localPath, projectDir);
    assert.equal(project.threadId, null);
    assert.equal(project.status, "idle");
    assert.equal("remoteUrl" in project, false);
    assert.equal("defaultBranch" in project, false);
    assert.equal("remoteUrl" in createdProjects[0]!, false);
    assert.equal("defaultBranch" in createdProjects[0]!, false);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});
