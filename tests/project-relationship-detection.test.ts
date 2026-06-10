import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createEmptyProjectRelationshipSummary, type Project } from "../src/shared/types.ts";

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

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "programs-backend-relationships-"));
  const tempPath = path.join(tempDir, "backend.test.ts");
  await writeFile(tempPath, source, "utf8");

  try {
    return await import(pathToFileURL(tempPath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const { ProgramsBackend } = await loadBackendModule();

const createProject = (
  id: string,
  name: string,
  localPath: string,
  overrides: Partial<Project> = {},
): Project => ({
  id,
  name,
  iconColor: "#0EA5E9",
  description: "",
  localPath,
  threadId: null,
  lastUpdatedAt: null,
  status: "idle",
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  runtimeConfig: {
    packageManager: "npm",
    installCommand: null,
    runCommand: null,
    openUrl: null,
    lastRunUrl: null,
    initialIdea: null,
    launch: null,
  },
  lastError: null,
  githubConnection: null,
  relationship: createEmptyProjectRelationshipSummary(),
  ...overrides,
});

const writeProjectFiles = async (root: string, files: Record<string, string>) => {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");
  }
};

const createBackend = () => {
  const updatedProjects: Project[] = [];
  const backend = new ProgramsBackend(
    {
      updateProject: async (project: Project) => {
        updatedProjects.push(project);
        return project;
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    () => {},
  ) as Record<string, unknown>;

  return {
    backend,
    updatedProjects,
  };
};

test("recomputeProjectRelationships detects exact containment and maybe-related clones", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "programs-project-relationships-"));

  try {
    const rootDir = path.join(tempRoot, "root");
    const childDir = path.join(tempRoot, "child");
    const cloneDir = path.join(tempRoot, "clone");

    await writeProjectFiles(rootDir, {
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 2;\n",
      "src/c.ts": "export const c = 3;\n",
      "src/root-only.ts": "export const rootOnly = true;\n",
    });
    await writeProjectFiles(childDir, {
      "lib/a.ts": "export const a = 1;\n",
      "lib/b.ts": "export const b = 2;\n",
      "lib/c.ts": "export const c = 3;\n",
    });
    await writeProjectFiles(cloneDir, {
      "app/a.ts": "export const a = 1;\n",
      "app/b.ts": "export const b = 2;\n",
      "app/c.ts": "export const c = 3;\n",
      "app/root-only.ts": "export const rootOnly = true;\n",
    });

    const rootProject = createProject("root", "Root Project", rootDir, {
      createdAt: "2026-04-01T00:00:00.000Z",
    });
    const childProject = createProject("child", "Child Project", childDir, {
      createdAt: "2026-04-02T00:00:00.000Z",
    });
    const cloneProject = createProject("clone", "Clone Project", cloneDir, {
      createdAt: "2026-04-03T00:00:00.000Z",
    });

    const { backend } = createBackend();
    const result = await ((backend.recomputeProjectRelationships as Function)([
      rootProject,
      childProject,
      cloneProject,
    ], false) as Promise<Project[]>);
    const byId = new Map(result.map((project) => [project.id, project]));

    assert.equal(byId.get("child")?.relationship.exactParentProjectId, "root");
    assert.deepEqual(byId.get("root")?.relationship.exactChildProjectIds, ["child"]);
    assert.equal(byId.get("child")?.relationship.maybeRelated.length, 0);
    assert.equal(byId.get("root")?.relationship.maybeRelated[0]?.projectId, "clone");
    assert.equal(byId.get("clone")?.relationship.exactParentProjectId, null);
    assert.equal(byId.get("clone")?.relationship.maybeRelated[0]?.projectId, "root");
    assert.equal(byId.get("clone")?.relationship.maybeRelated[0]?.sharedFileCount, 4);
    assert.equal(byId.get("clone")?.relationship.maybeRelated[0]?.overlapRatio, 1);
    assert.ok(byId.get("root")?.relationship.scannedAt);
    assert.ok(byId.get("root")?.relationship.contentUpdatedAt);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("recomputeProjectRelationships marks partial overlap as maybe-related and leaves low-overlap or tiny repos standalone", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "programs-project-relationship-overlap-"));

  try {
    const maybeOneDir = path.join(tempRoot, "maybe-one");
    const maybeTwoDir = path.join(tempRoot, "maybe-two");
    const lowOneDir = path.join(tempRoot, "low-one");
    const lowTwoDir = path.join(tempRoot, "low-two");
    const tinyOneDir = path.join(tempRoot, "tiny-one");
    const tinyTwoDir = path.join(tempRoot, "tiny-two");

    await writeProjectFiles(maybeOneDir, {
      "src/shared-a.ts": "export const sharedA = 1;\n",
      "src/shared-b.ts": "export const sharedB = 2;\n",
      "src/shared-c.ts": "export const sharedC = 3;\n",
      "src/solo-one.ts": "export const soloOne = 4;\n",
    });
    await writeProjectFiles(maybeTwoDir, {
      "pages/shared-a.tsx": "export const sharedA = 1;\n",
      "pages/shared-b.tsx": "export const sharedB = 2;\n",
      "pages/shared-c.tsx": "export const sharedC = 3;\n",
      "pages/solo-two.tsx": "export const soloTwo = 5;\n",
      "pages/solo-three.tsx": "export const soloThree = 6;\n",
    });
    await writeProjectFiles(lowOneDir, {
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 2;\n",
      "src/c.ts": "export const c = 3;\n",
      "src/d.ts": "export const d = 4;\n",
    });
    await writeProjectFiles(lowTwoDir, {
      "src/a.ts": "export const a = 1;\n",
      "src/x.ts": "export const x = 24;\n",
      "src/y.ts": "export const y = 25;\n",
      "src/z.ts": "export const z = 26;\n",
    });
    await writeProjectFiles(tinyOneDir, {
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 2;\n",
    });
    await writeProjectFiles(tinyTwoDir, {
      "lib/a.ts": "export const a = 1;\n",
      "lib/b.ts": "export const b = 2;\n",
    });

    const { backend } = createBackend();
    const result = await ((backend.recomputeProjectRelationships as Function)([
      createProject("maybe-one", "Maybe One", maybeOneDir),
      createProject("maybe-two", "Maybe Two", maybeTwoDir),
      createProject("low-one", "Low One", lowOneDir),
      createProject("low-two", "Low Two", lowTwoDir),
      createProject("tiny-one", "Tiny One", tinyOneDir),
      createProject("tiny-two", "Tiny Two", tinyTwoDir),
    ], false) as Promise<Project[]>);
    const byId = new Map(result.map((project) => [project.id, project]));

    assert.equal(byId.get("maybe-one")?.relationship.exactParentProjectId, null);
    assert.equal(byId.get("maybe-two")?.relationship.exactParentProjectId, null);
    assert.equal(byId.get("maybe-one")?.relationship.maybeRelated[0]?.projectId, "maybe-two");
    assert.equal(byId.get("maybe-two")?.relationship.maybeRelated[0]?.projectId, "maybe-one");
    assert.equal(byId.get("maybe-one")?.relationship.maybeRelated[0]?.sharedFileCount, 3);
    assert.equal(byId.get("maybe-one")?.relationship.maybeRelated[0]?.overlapRatio, 0.75);

    assert.deepEqual(byId.get("low-one")?.relationship, {
      scannedAt: byId.get("low-one")?.relationship.scannedAt ?? null,
      contentUpdatedAt: byId.get("low-one")?.relationship.contentUpdatedAt ?? null,
      exactParentProjectId: null,
      exactChildProjectIds: [],
      maybeRelated: [],
    });
    assert.equal(byId.get("tiny-one")?.relationship.exactParentProjectId, null);
    assert.deepEqual(byId.get("tiny-one")?.relationship.exactChildProjectIds, []);
    assert.deepEqual(byId.get("tiny-one")?.relationship.maybeRelated, []);
    assert.deepEqual(byId.get("tiny-two")?.relationship.maybeRelated, []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("recomputeProjectRelationships treats one-way helper integration as exact and ignores runtime download folders", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "programs-project-relationship-integration-"));

  try {
    const rootDir = path.join(tempRoot, "profile-view");
    const childDir = path.join(tempRoot, "tiktok-helper");
    const otherDir = path.join(tempRoot, "other-helper");

    await writeProjectFiles(rootDir, {
      "config.py": 'TIKTOK_HELPER_DIR = "/tmp/tiktok-helper"\n',
      "backend/app.py": "from core.shared import SHARED\nprint(SHARED)\n",
      "core/shared.py": "SHARED = 1\n",
      "frontend/app.ts": "export const helperMode = true;\n",
      "core/util.py": "def run():\n    return 'profile'\n",
      "downloads/runtime.json": '{"same":"runtime"}\n',
    });
    await writeProjectFiles(childDir, {
      "config.py": "MAX_VIDEOS = 200\n",
      "backend/app.py": "from core.shared import SHARED\nprint(SHARED)\n",
      "core/shared.py": "SHARED = 1\n",
      "frontend/app.ts": "export const helperMode = true;\n",
      "core/util.py": "def run():\n    return 'helper'\n",
      "downloads/runtime.json": '{"same":"runtime"}\n',
    });
    await writeProjectFiles(otherDir, {
      "main.py": "print('standalone')\n",
      "downloads/runtime.json": '{"same":"runtime"}\n',
      "downloads/second.json": '{"same":"runtime"}\n',
      "downloads/third.json": '{"same":"runtime"}\n',
    });

    const { backend } = createBackend();
    const result = await ((backend.recomputeProjectRelationships as Function)([
      createProject("root", "Profile View", rootDir),
      createProject("child", "Tiktok Helper", childDir),
      createProject("other", "Other Helper", otherDir),
    ], false) as Promise<Project[]>);
    const byId = new Map(result.map((project) => [project.id, project]));

    assert.equal(byId.get("child")?.relationship.exactParentProjectId, "root");
    assert.deepEqual(byId.get("root")?.relationship.exactChildProjectIds, ["child"]);
    assert.equal(byId.get("other")?.relationship.exactParentProjectId, null);
    assert.deepEqual(byId.get("other")?.relationship.maybeRelated, []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
