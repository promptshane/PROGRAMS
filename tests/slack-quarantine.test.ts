import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getVisibleAppPageOptions, resolveVisibleAppPage } from "../src/shared/app-shell.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const loadBackendModule = async () => {
  const sourcePath = path.join(projectRoot, "src/main/backend.ts");
  let source = await readFile(sourcePath, "utf8");
  const replacements: Array<[string, string]> = [
    [
      'import { app, shell } from "electron";',
      `const app = { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() };
const shell = { openExternal: async () => {}, showItemInFolder: async () => {}, openPath: async () => "" };`,
    ],
    ['import { ClaudeService } from "@main/services/claude-service";', "class ClaudeService {}"],
    ['import { CodexService } from "@main/services/codex-service";', "class CodexService {}"],
    [
      'import { GitHubService, type GitHubClientConfig } from "@main/services/github-service";',
      "class GitHubService {}\ntype GitHubClientConfig = Record<string, unknown> | null;",
    ],
    ['import { GitService } from "@main/services/git-service";', "class GitService {}"],
    ['import { PlaywrightService } from "@main/services/playwright-service";', "class PlaywrightService {}"],
    ['import { ProjectStore } from "@main/services/project-store";', "class ProjectStore {}"],
    ['import { RunnerService } from "@main/services/runner-service";', "class RunnerService {}"],
    [
      `  constructor(
    private readonly store: ProjectStore,
    private readonly git: GitService,
    private readonly github: GitHubService,
    private readonly runner: RunnerService,
    private readonly playwright: PlaywrightService,
    private readonly codex: CodexService,
    private readonly claude: ClaudeService,
    private readonly emit: Emit,
  ) {}`,
      `  constructor(
    store: ProjectStore,
    git: GitService,
    github: GitHubService,
    runner: RunnerService,
    playwright: PlaywrightService,
    codex: CodexService,
    claude: ClaudeService,
    emit: Emit,
  ) {
    this.store = store;
    this.git = git;
    this.github = github;
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

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "programs-backend-slack-"));
  const tempPath = path.join(tempDir, "backend.test.ts");
  await writeFile(tempPath, source, "utf8");

  try {
    return await import(pathToFileURL(tempPath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const { ProgramsBackend } = await loadBackendModule();

const createBackend = () => {
  const settings = {
    advancedDefaults: {
      provider: "codex",
      model: "gpt-5.4",
      claudeModel: "sonnet",
    },
  };
  const store = {
    readSettings: async () => settings,
    getAgentSession: async () => null,
    saveAgentSession: async () => {},
    getProject: async () => ({ id: "project-1", name: "Slack Quarantine Project" }),
  };
  const stub = {};
  const backend = new ProgramsBackend(
    store as never,
    stub as never,
    stub as never,
    stub as never,
    stub as never,
    stub as never,
    stub as never,
    () => {},
  );

  return backend;
};

test("Slack stays visible in the app shell when enabled", () => {
  assert.equal(getVisibleAppPageOptions().some((page) => page.id === "slack"), true);
  assert.equal(resolveVisibleAppPage("slack"), "slack");
});

test("Slack chat no longer fails fast behind the quarantine gate", async () => {
  const backend = createBackend() as Record<string, unknown>;
  (backend.ensureInitialized as Function) = async () => {};
  (backend.requireProject as Function) = async () => ({ id: "project-1", name: "Slack Enabled Project" });
  (backend.getOrCreateAgentSession as Function) = async () => (backend.createEmptyAgentSession as Function)("project-1", "codex");
  (backend.runSlackDirectorChain as Function) = async () => ({
    message: {
      id: "assistant-1",
      role: "assistant",
      directorId: "project-manager",
      content: "Ready.",
      createdAt: new Date().toISOString(),
      status: "complete",
    },
    handoffTo: null,
    handoffReason: null,
    chainedMessages: [],
  });

  const response = await (backend.slackChat as Function)({
    projectId: "project-1",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    message: "Hello Slack.",
    targetDirectorId: null,
  });

  assert.equal(response.directorId, "project-manager");
  assert.equal(response.message.content, "Ready.");
});
