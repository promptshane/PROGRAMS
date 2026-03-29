import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AgentSession } from "../src/shared/types.ts";
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
    () => {},
  );
  (backend as Record<string, unknown>).getSlackProviderPreflightErrors = async () => ({ codex: null, claude: null });

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
  (backend.runSlackDirectorTurn as Function) = async () => ({
    assistantMessage: {
      id: "assistant-1",
      role: "assistant",
      directorId: "project-manager",
      content: "Ready.",
      createdAt: new Date().toISOString(),
      status: "complete",
    },
    parsed: {
      handoffTo: null,
      handoffReason: null,
    },
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

test("Slack Ping with an active update skips the read-only chat turn and starts execution", async () => {
  const backend = createBackend() as Record<string, unknown>;
  (backend.ensureInitialized as Function) = async () => {};
  (backend.requireProject as Function) = async () => ({ id: "project-1", name: "Slack Enabled Project" });

  const session = (backend.createEmptyAgentSession as Function)("project-1", "codex") as AgentSession;
  session.toddMemory.futureUpdatePlan = [
    {
      id: "update-1",
      versionId: "version-1",
      title: "Ship Ping update",
      description: "Apply the latest update in Slack.",
      order: 0,
      status: "pending",
      dependencies: [],
      pillarIds: [],
      skillsNeeded: [],
    },
  ];
  session.pingMemory.activeUpdateId = "update-1";

  let routedUpdate: Record<string, unknown> | null = null;
  let chainCalled = false;
  (backend.getOrCreateAgentSession as Function) = async () => session;
  (backend.routeUpdateToProgrammingNow as Function) = async (input: Record<string, unknown>) => {
    routedUpdate = input;
    return { started: true };
  };
  (backend.runSlackDirectorChain as Function) = async () => {
    chainCalled = true;
    throw new Error("runSlackDirectorChain should not be called for an active Ping update");
  };

  const response = await (backend.slackChat as Function)({
    projectId: "project-1",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    message: "Ping, apply the update.",
    targetDirectorId: "programming-director",
  });

  assert.equal(chainCalled, false);
  assert.deepEqual(routedUpdate, {
    projectId: "project-1",
    updateId: "update-1",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
  });
  assert.equal(response.directorId, "programming-director");
  assert.equal(response.message.role, "system");
  assert.equal(response.message.content, "Handing this to Ping to update the code now.");
  assert.equal(session.slackActiveDirectorId, "programming-director");
  assert.equal(session.slackPresenceGuestId, "programming-director");
  assert.equal(session.slackMessages.at(-1)?.role, "system");
  assert.equal(session.slackMessages.at(-1)?.content, "Handing this to Ping to update the code now.");
});

test("Slack approval replay also routes Ping directly when an active update exists", async () => {
  const backend = createBackend() as Record<string, unknown>;
  (backend.ensureInitialized as Function) = async () => {};
  (backend.requireProject as Function) = async () => ({ id: "project-1", name: "Slack Enabled Project" });

  const session = (backend.createEmptyAgentSession as Function)("project-1", "codex") as AgentSession;
  session.toddMemory.futureUpdatePlan = [
    {
      id: "update-1",
      versionId: "version-1",
      title: "Ship Ping update",
      description: "Apply the latest update in Slack.",
      order: 0,
      status: "pending",
      dependencies: [],
      pillarIds: [],
      skillsNeeded: [],
    },
  ];
  session.pingMemory.activeUpdateId = "update-1";

  let routedUpdate: Record<string, unknown> | null = null;
  let chainCalled = false;
  (backend.routeUpdateToProgrammingNow as Function) = async (input: Record<string, unknown>) => {
    routedUpdate = input;
    return { started: true };
  };
  (backend.runSlackDirectorChain as Function) = async () => {
    chainCalled = true;
    throw new Error("runSlackDirectorChain should not be called for an active Ping approval");
  };

  await (backend.runSlackDirectorApproval as Function)(session, {
    draftMessage: "Ping, apply the update.",
    draftPayload: {
      directorId: "programming-director",
      provider: "codex",
      model: "gpt-5.4",
      claudeModel: "sonnet",
      message: "Ping, apply the update.",
      mode: "codebase-analysis",
    },
  });

  assert.equal(chainCalled, false);
  assert.deepEqual(routedUpdate, {
    projectId: "project-1",
    updateId: "update-1",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
  });
  assert.equal(session.slackMessages.at(-1)?.content, "Handing this to Ping to update the code now.");
});

test("Slack Ping falls back to the normal chat turn when the active update is stale", async () => {
  const backend = createBackend() as Record<string, unknown>;
  (backend.ensureInitialized as Function) = async () => {};
  (backend.requireProject as Function) = async () => ({ id: "project-1", name: "Slack Enabled Project" });

  const session = (backend.createEmptyAgentSession as Function)("project-1", "codex") as AgentSession;
  session.pingMemory.activeUpdateId = "missing-update";
  session.toddMemory.futureUpdatePlan = [];

  let routedCalled = false;
  let turnCalled = false;
  (backend.getOrCreateAgentSession as Function) = async () => session;
  (backend.routeUpdateToProgrammingNow as Function) = async () => {
    routedCalled = true;
    return { started: true };
  };
  (backend.runSlackDirectorTurn as Function) = async () => {
    turnCalled = true;
    return {
      assistantMessage: {
        id: "assistant-1",
        role: "assistant",
        directorId: "programming-director",
        content: "I'll look at the implementation...",
        createdAt: new Date().toISOString(),
        status: "complete",
      },
      parsed: {
        handoffTo: null,
        handoffReason: null,
      },
    };
  };

  const response = await (backend.slackChat as Function)({
    projectId: "project-1",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    message: "Ping, what should I do next?",
    targetDirectorId: "programming-director",
  });

  assert.equal(routedCalled, false);
  assert.equal(turnCalled, true);
  assert.equal(response.directorId, "programming-director");
  assert.equal(response.message.content, "I'll look at the implementation...");
  assert.equal(session.slackMessages.some((msg) => msg.content === "Handing this to Ping to update the code now."), false);
});
