import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_SETTINGS } from "../src/main/defaults.ts";
import { createEmptyProjectRelationshipSummary, type Project, type StartPlanInput } from "../src/shared/types.ts";

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

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "programs-backend-project-chat-"));
  const tempPath = path.join(tempDir, "backend.test.ts");
  await writeFile(tempPath, source, "utf8");

  try {
    return await import(pathToFileURL(tempPath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const { ProgramsBackend } = await loadBackendModule();

const project: Project = {
  id: "project-1",
  name: "Dashboard App",
  iconColor: "#0EA5E9",
  description: "A dashboard for local apps.",
  localPath: projectRoot,
  threadId: null,
  lastUpdatedAt: null,
  status: "idle",
  createdAt: "2026-06-13T12:00:00.000Z",
  updatedAt: "2026-06-13T12:00:00.000Z",
  runtimeConfig: {
    packageManager: "npm",
    installCommand: null,
    runCommand: null,
    openUrl: null,
    lastRunUrl: null,
    initialIdea: null,
    launch: null,
    assignedPort: null,
  },
  lastError: null,
  githubConnection: null,
  relationship: createEmptyProjectRelationshipSummary(),
};

const readyCodexStatus = {
  available: true,
  loggedIn: true,
  binaryPath: "/usr/local/bin/codex",
  version: "1.0.0",
  email: "test@example.com",
  planType: "Team",
  authMode: "chatgpt",
  errorMessage: null,
};

test("dashboard project-chat planning includes existing core details", async () => {
  let capturedInput: StartPlanInput | null = null;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const store = {
    readSettings: async () => DEFAULT_SETTINGS,
    readProject: async () => project,
    getAgentSession: async () => ({
      danMemory: {
        confirmedConcept: {
          function: { summary: "Help users run and update local apps.", status: "confirmed" },
          thesis: { summary: "The dashboard should make local app work feel immediate.", status: "confirmed" },
          corePillars: [{ id: "pillar-1", name: "Run Control", order: 1 }],
          fullFlow: { summary: "Pick a project, plan an update, run it, and save the result.", status: "confirmed" },
          threads: [],
        },
        fullExperienceDescription: null,
      },
    }),
  };
  const codex = {
    getAuthStatus: async () => readyCodexStatus,
    startPlanningTurn: async (_project: Project, _settings: unknown, input: StartPlanInput) => {
      capturedInput = input;
      started();
      return {} as never;
    },
    answerQuestion: async () => {
      throw new Error("Ask path should not run for planning mode.");
    },
  };
  const backend = new ProgramsBackend(store, {}, {}, {}, codex, {}, () => undefined);
  backend.initializationPromise = Promise.resolve();

  await backend.startProjectChat({
    projectId: project.id,
    provider: "codex",
    mode: "plan",
    prompt: "Make run status clearer.",
  });
  await startedPromise;

  assert.equal(capturedInput?.planningMode, "review");
  assert.match(capturedInput?.coreDetailsContext ?? "", /Function: Help users run and update local apps/);
  assert.match(capturedInput?.coreDetailsContext ?? "", /Core pillars: Run Control/);
  assert.match(capturedInput?.coreDetailsContext ?? "", /Full-flow: Pick a project/);
});

test("dashboard project-chat ask mode stays on read-only answer path", async () => {
  let capturedAskInput: StartPlanInput | null = null;
  let getAgentSessionCalls = 0;
  let answered!: () => void;
  const answeredPromise = new Promise<void>((resolve) => {
    answered = resolve;
  });
  const store = {
    readSettings: async () => DEFAULT_SETTINGS,
    readProject: async () => project,
    getAgentSession: async () => {
      getAgentSessionCalls += 1;
      return null;
    },
  };
  const codex = {
    getAuthStatus: async () => readyCodexStatus,
    startPlanningTurn: async () => {
      throw new Error("Planning path should not run for ask mode.");
    },
    answerQuestion: async (_project: Project, _settings: unknown, input: StartPlanInput) => {
      capturedAskInput = input;
      answered();
      return {} as never;
    },
  };
  const backend = new ProgramsBackend(store, {}, {}, {}, codex, {}, () => undefined);
  backend.initializationPromise = Promise.resolve();

  await backend.startProjectChat({
    projectId: project.id,
    provider: "codex",
    mode: "ask",
    prompt: "What starts this project?",
  });
  await answeredPromise;

  assert.equal(getAgentSessionCalls, 0);
  assert.equal(capturedAskInput?.planningMode, "none");
  assert.equal(capturedAskInput?.coreDetailsContext, null);
});
