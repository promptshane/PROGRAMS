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

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "programs-backend-agent-chat-"));
  const tempPath = path.join(tempDir, "backend.test.ts");
  await writeFile(tempPath, source, "utf8");

  try {
    return await import(pathToFileURL(tempPath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const { ProgramsBackend } = await loadBackendModule();

const createBackend = (settingsOverride?: Record<string, unknown>) => {
  const settings = {
    advancedDefaults: {
      provider: "codex",
      model: "gpt-5.5",
      claudeModel: "sonnet",
    },
    defaultSpeed: "normal",
    ...settingsOverride,
  };
  const store = {
    readSettings: async () => settings,
    getAgentSession: async () => null,
    saveAgentSession: async () => {},
    getProject: async () => ({ id: "project-1", name: "Agent Chat Quarantine Project" }),
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
  (backend as Record<string, unknown>).getAgentChatProviderPreflightErrors = async () => ({ codex: null, claude: null });

  return backend;
};

test("Agents stays visible in the app shell when enabled", () => {
  assert.equal(getVisibleAppPageOptions().some((page) => page.id === "agents"), true);
  assert.equal(resolveVisibleAppPage("agents"), "agents");
});

test("Agent chat no longer fails fast behind the quarantine gate", async () => {
  const backend = createBackend() as Record<string, unknown>;
  (backend.ensureInitialized as Function) = async () => {};
  (backend.requireProject as Function) = async () => ({ id: "project-1", name: "Agent Chat Enabled Project" });
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

  const response = await (backend.agentChat as Function)({
    projectId: "project-1",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    message: "Hello team.",
    targetDirectorId: null,
  });

  assert.equal(response.directorId, "project-manager");
  assert.equal(response.message.content, "Ready.");
});

test("listPendingApprovals only returns live pending approvals", async () => {
  const backend = createBackend() as Record<string, unknown>;
  const session = (backend.createEmptyAgentSession as Function)("project-1", "claude") as AgentSession;
  session.pendingApprovals = [
    {
      id: "approval-pending",
      kind: "codebase-scan",
      status: "pending",
      requestedByDirectorId: "project-manager",
      targetDirectorId: "rd-director",
      summary: "Refresh project",
      draftMessage: "Refresh now.",
      draftPayload: { action: "refreshProject" },
      createdAt: "2026-04-04T00:45:00.000Z",
      updatedAt: "2026-04-04T00:45:00.000Z",
    },
    {
      id: "approval-later",
      kind: "codebase-scan",
      status: "later",
      requestedByDirectorId: "project-manager",
      targetDirectorId: "rd-director",
      summary: "Refresh later",
      draftMessage: "Refresh later.",
      draftPayload: { action: "refreshProject" },
      createdAt: "2026-04-04T00:46:00.000Z",
      updatedAt: "2026-04-04T00:46:00.000Z",
    },
  ];
  (backend.getAgentSession as Function) = async () => session;

  const approvals = await (backend.listPendingApprovals as Function)({ projectId: "project-1" }) as AgentSession["pendingApprovals"];

  assert.deepEqual(approvals.map((approval) => approval.id), ["approval-pending"]);
});

test("refreshProject queues a new live approval even when a legacy later refresh approval exists", async () => {
  const backend = createBackend() as Record<string, unknown>;
  (backend.ensureInitialized as Function) = async () => {};
  (backend.requireProject as Function) = async () => ({ id: "project-1", name: "Refresh Project" });

  let storedSession = (backend.createEmptyAgentSession as Function)("project-1", "claude") as AgentSession;
  storedSession.pendingApprovals = [
    {
      id: "approval-later",
      kind: "codebase-scan",
      status: "later",
      requestedByDirectorId: "project-manager",
      targetDirectorId: "rd-director",
      summary: "Refresh later",
      draftMessage: "Refresh later.",
      draftPayload: {
        action: "refreshProject",
        input: { projectId: "project-1", provider: "claude", model: "gpt-5.4", claudeModel: "sonnet" },
      },
      createdAt: "2026-04-04T00:46:00.000Z",
      updatedAt: "2026-04-04T00:46:00.000Z",
    },
  ];
  (backend.getOrCreateAgentSession as Function) = async () => storedSession;
  (backend.saveAgentSession as Function) = async (_projectId: string, session: AgentSession) => {
    storedSession = JSON.parse(JSON.stringify(session)) as AgentSession;
  };

  await (backend.refreshProject as Function)({
    projectId: "project-1",
    provider: "claude",
    model: "gpt-5.4",
    claudeModel: "sonnet",
  });

  assert.equal(storedSession.pendingApprovals.filter((approval) => approval.status === "pending").length, 1);
  assert.equal(
    storedSession.pendingApprovals.some((approval) => approval.id === "approval-later" && approval.status === "later"),
    true,
  );
});

test("deferPendingApproval keeps the approval in the queue as later instead of deleting it", async () => {
  const backend = createBackend() as Record<string, unknown>;
  (backend.ensureInitialized as Function) = async () => {};

  let storedSession = (backend.createEmptyAgentSession as Function)("project-1", "claude") as AgentSession;
  storedSession.pendingApprovals = [
    {
      id: "approval-refresh",
      kind: "codebase-scan",
      status: "pending",
      requestedByDirectorId: "project-manager",
      targetDirectorId: "rd-director",
      summary: "Refresh project",
      draftMessage: "Refresh now.",
      draftPayload: { action: "refreshProject" },
      createdAt: "2026-04-04T00:45:00.000Z",
      updatedAt: "2026-04-04T00:45:00.000Z",
    },
  ];

  const store = backend.store as {
    getAgentSession: (projectId: string) => Promise<AgentSession | null>;
    saveAgentSession: (session: AgentSession) => Promise<void>;
  };
  store.getAgentSession = async () => storedSession;
  store.saveAgentSession = async (session: AgentSession) => {
    storedSession = JSON.parse(JSON.stringify(session)) as AgentSession;
  };

  const updated = await (backend.deferPendingApproval as Function)({
    projectId: "project-1",
    approvalId: "approval-refresh",
  }) as AgentSession;

  assert.equal(updated.pendingApprovals[0]?.status, "later");
  assert.equal(storedSession.pendingApprovals.length, 1);
  assert.equal(storedSession.pendingApprovals[0]?.status, "later");
});

test("Ping execution helper queues approval before the big-model planning pass", async () => {
  const backend = createBackend() as Record<string, unknown>;
  (backend.ensureInitialized as Function) = async () => {};
  const project = { id: "project-1", name: "Agent Chat Enabled Project" };
  (backend.requireProject as Function) = async () => project;

  const session = (backend.createEmptyAgentSession as Function)("project-1", "codex") as AgentSession;
  session.toddMemory.futureUpdatePlan = [
    {
      id: "update-1",
      versionId: "version-1",
      title: "Ship Ping update",
      description: "Apply the latest update in agent chat.",
      order: 0,
      status: "pending",
      dependencies: [],
      pillarIds: [],
      skillsNeeded: [],
    },
  ];
  session.pingMemory.activeUpdateId = "update-1";

  const response = await (backend.tryStartSlackPingExecution as Function)({
    session,
    project,
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    directorId: "programming-director",
  });

  assert.ok(response);
  assert.equal(session.pendingApprovals.length, 1);
  assert.deepEqual(session.pendingApprovals[0]?.draftPayload?.input, {
    projectId: "project-1",
    updateId: "update-1",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
  });
  assert.match(response.content, /planning \+ execution loop/);
  assert.equal(session.slackActiveDirectorId, "rd-director");
  assert.equal(session.slackPresenceGuestId, "rd-director");
  assert.equal(session.slackMessages.some((msg) => msg.metadata?.type === "ping-task"), true);
});

test("Agent chat approval replay also queues the Ping approval when an active update exists", async () => {
  const backend = createBackend() as Record<string, unknown>;
  (backend.ensureInitialized as Function) = async () => {};
  (backend.requireProject as Function) = async () => ({ id: "project-1", name: "Agent Chat Enabled Project" });

  const session = (backend.createEmptyAgentSession as Function)("project-1", "codex") as AgentSession;
  session.toddMemory.futureUpdatePlan = [
    {
      id: "update-1",
      versionId: "version-1",
      title: "Ship Ping update",
      description: "Apply the latest update in agent chat.",
      order: 0,
      status: "pending",
      dependencies: [],
      pillarIds: [],
      skillsNeeded: [],
    },
  ];
  session.pingMemory.activeUpdateId = "update-1";

  (backend.runSlackDirectorChain as Function) = async () => {
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

  assert.equal(session.pendingApprovals.length, 1);
  assert.deepEqual(session.pendingApprovals[0]?.draftPayload?.input, {
    projectId: "project-1",
    updateId: "update-1",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
  });
  assert.equal((session.slackMessages.at(-1)?.content ?? "").includes("planning + execution loop"), true);
});

test("Ping execution helper returns null when the active update is stale", async () => {
  const backend = createBackend() as Record<string, unknown>;
  (backend.ensureInitialized as Function) = async () => {};
  const project = { id: "project-1", name: "Agent Chat Enabled Project" };
  (backend.requireProject as Function) = async () => project;

  const session = (backend.createEmptyAgentSession as Function)("project-1", "codex") as AgentSession;
  session.pingMemory.activeUpdateId = "missing-update";
  session.toddMemory.futureUpdatePlan = [];

  const response = await (backend.tryStartSlackPingExecution as Function)({
    session,
    project,
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    directorId: "programming-director",
  });

  assert.equal(response, null);
  assert.equal(session.pendingApprovals.length, 0);
  assert.equal(session.slackMessages.length, 0);
});

test("Direct Ping updates queue approval with the big Claude planning model and keep the small Claude model for execution runtime", async () => {
  const backend = createBackend({
    advancedDefaults: {
      provider: "claude",
      model: "gpt-5.4-mini",
      claudeModel: "sonnet",
    },
  }) as Record<string, unknown>;
  (backend.ensureInitialized as Function) = async () => {};
  (backend.requireProject as Function) = async () => ({ id: "project-1", name: "Ping Model Project" });

  const session = (backend.createEmptyAgentSession as Function)("project-1", "claude") as AgentSession;
  (backend.getOrCreateAgentSession as Function) = async () => session;
  (backend.decorateAgentSessionKnowledgeState as Function) = async (target: AgentSession) => {
    target.knowledgeStatus = "fresh";
    target.knowledgeReasons = [];
    return target;
  };

  await (backend.startPingDirectUpdate as Function)({
    projectId: "project-1",
    message: "Implement the next approved update.",
    runMode: "auto",
  });

  const queuedInput = session.pendingApprovals[0]?.draftPayload?.input as Record<string, any> | undefined;
  assert.ok(queuedInput);
  assert.equal(queuedInput?.provider, "claude");
  assert.equal(queuedInput?.claudeModel, "opus");
  assert.equal(queuedInput?.pingTaskSnapshot?.runtime?.provider, "claude");
  assert.equal(queuedInput?.pingTaskSnapshot?.runtime?.claudeModel, "sonnet");
  assert.equal(session.slackMessages.some((msg) => msg.metadata?.type === "ping-task"), true);
});

test("Alert-triggered Ping runs skip the extra confirmation and start immediately with Todd as the passive guest", async () => {
  const backend = createBackend({
    advancedDefaults: {
      provider: "claude",
      model: "gpt-5.4",
      claudeModel: "sonnet",
    },
  }) as Record<string, unknown>;
  (backend.ensureInitialized as Function) = async () => {};
  (backend.requireProject as Function) = async () => ({
    id: "project-1",
    name: "Ping Alert Project",
    localPath: projectRoot,
    status: "idle",
    lastError: null,
  });
  (backend.assertFreshProjectKnowledge as Function) = async () => {};
  (backend.requireProviderReady as Function) = async () => {};
  (backend.updateProjectStatus as Function) = async (project: Record<string, unknown>, status: string, lastError: string | null) => ({
    ...project,
    status,
    lastError,
  });
  (backend.readUsage as Function) = async () => ({
    updatedAt: "2026-04-04T00:09:30.000Z",
    claude: { status: "ready", windows: [], note: null },
    codex: { status: "ready", windows: [], note: null },
  });
  (backend.aiService as Function) = () => ({
    previewPlanningPrompt: () => "Plan prompt",
    startPlanningTurn: async () => new Promise(() => {}),
  });

  let storedSession = (backend.createEmptyAgentSession as Function)("project-1", "claude") as AgentSession;
  const savedSessions: AgentSession[] = [];
  storedSession.toddMemory.futureUpdatePlan = [
    {
      id: "update-1",
      versionId: "version-1",
      title: "Ship Ping update",
      description: "Apply the latest update in agent chat.",
      order: 0,
      status: "pending",
      dependencies: [],
      pillarIds: [],
      skillsNeeded: [],
    },
  ];
  (backend.store as Record<string, unknown>).getAgentSession = async () => storedSession;
  (backend.store as Record<string, unknown>).saveAgentSession = async (session: AgentSession) => {
    storedSession = JSON.parse(JSON.stringify(session)) as AgentSession;
    savedSessions.push(JSON.parse(JSON.stringify(session)) as AgentSession);
  };

  await (backend.routeUpdateToProgramming as Function)({
    projectId: "project-1",
    updateId: "update-1",
    provider: "claude",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    skipConfirmation: true,
  });

  assert.equal(storedSession.pendingApprovals.length, 0);
  assert.equal(storedSession.toddMemory.futureUpdatePlan[0]?.status, "in_progress");
  assert.equal(storedSession.slackActiveDirectorId, "programming-director");
  assert.equal(storedSession.slackPresenceGuestId, "rd-director");
  assert.equal(storedSession.pingMemory.activeUpdateId, "update-1");
  assert.ok(savedSessions.length >= 1);
  const firstSavedSession = savedSessions[0]!;
  assert.equal(firstSavedSession.slackActiveDirectorId, "programming-director");
  assert.equal(firstSavedSession.slackPresenceGuestId, "rd-director");
  assert.equal(firstSavedSession.pingMemory.activeUpdateId, "update-1");
  assert.match(storedSession.slackMessages.at(-4)?.content ?? "", /Task Report for Ping:/);
  assert.match(storedSession.slackMessages.at(-3)?.content ?? "", /I’m ready to hand Ping one specific update:/);
  assert.match(storedSession.slackMessages.at(-2)?.content ?? "", /I(?:'|’)ll map the plan/i);
  assert.equal(storedSession.slackMessages.at(-1)?.status, "working");
  assert.match(firstSavedSession.slackMessages.at(-4)?.content ?? "", /Task Report for Ping:/);
  assert.match(firstSavedSession.slackMessages.at(-3)?.content ?? "", /I’m ready to hand Ping one specific update:/);
  assert.match(firstSavedSession.slackMessages.at(-2)?.content ?? "", /I(?:'|’)ll map the plan/i);
  assert.equal(firstSavedSession.slackMessages.at(-1)?.status, "working");
});

test("Immediate agent session refresh keeps a live Ping planning run active", async () => {
  const backend = createBackend({
    advancedDefaults: {
      provider: "claude",
      model: "gpt-5.4",
      claudeModel: "sonnet",
    },
  }) as Record<string, unknown>;
  (backend.ensureInitialized as Function) = async () => {};
  (backend.assertFreshProjectKnowledge as Function) = async () => {};
  (backend.requireProviderReady as Function) = async () => {};
  (backend.decorateAgentSessionKnowledgeState as Function) = async (target: AgentSession) => {
    target.knowledgeStatus = "fresh";
    target.knowledgeReasons = [];
    return target;
  };
  (backend.readUsage as Function) = async () => ({
    updatedAt: "2026-04-04T00:09:30.000Z",
    claude: { status: "ready", windows: [], note: null },
    codex: { status: "ready", windows: [], note: null },
  });

  let project: Record<string, unknown> = {
    id: "project-1",
    name: "Ping Refresh Project",
    localPath: projectRoot,
    status: "idle",
    lastError: null,
    updatedAt: "2026-04-04T00:09:30.000Z",
    description: "Ping refresh project.",
    threadId: null,
  };
  (backend.requireProject as Function) = async () => project;

  let planningStarted = false;
  const livePlan = { status: "planning" };
  backend.codex = { getActivePlan: () => null };
  backend.claude = { getActivePlan: () => (planningStarted ? livePlan : null) };
  (backend.aiService as Function) = () => ({
    previewPlanningPrompt: () => "Plan prompt",
    startPlanningTurn: async () => {
      planningStarted = true;
      return new Promise(() => {});
    },
  });

  let storedSession = (backend.createEmptyAgentSession as Function)("project-1", "claude") as AgentSession;
  const savedSessions: AgentSession[] = [];
  storedSession.toddMemory.futureUpdatePlan = [
    {
      id: "update-1",
      versionId: "version-1",
      title: "Ship Ping update",
      description: "Apply the latest update in agent chat.",
      order: 0,
      status: "pending",
      dependencies: [],
      pillarIds: [],
      skillsNeeded: [],
    },
  ];
  (backend.store as Record<string, unknown>).getAgentSession = async () => storedSession;
  (backend.store as Record<string, unknown>).saveAgentSession = async (session: AgentSession) => {
    storedSession = JSON.parse(JSON.stringify(session)) as AgentSession;
    savedSessions.push(JSON.parse(JSON.stringify(session)) as AgentSession);
  };
  (backend.store as Record<string, unknown>).updateProject = async (nextProject: Record<string, unknown>) => {
    project = JSON.parse(JSON.stringify(nextProject));
  };

  await (backend.routeUpdateToProgramming as Function)({
    projectId: "project-1",
    updateId: "update-1",
    provider: "claude",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    skipConfirmation: true,
  });

  const saveCountBeforeRefresh = savedSessions.length;
  const refreshed = await (backend.getAgentSession as Function)("project-1") as AgentSession | null;

  assert.equal(planningStarted, true);
  assert.ok(refreshed);
  assert.equal(savedSessions.length, saveCountBeforeRefresh);
  assert.equal(refreshed?.pingMemory.activeUpdateId, "update-1");
  assert.equal(refreshed?.toddMemory.futureUpdatePlan[0]?.status, "in_progress");
  assert.equal(refreshed?.slackMessages.at(-1)?.status, "working");
  assert.equal(
    refreshed?.slackMessages.some((message) => /Ping stopped before execution began/i.test(message.content)),
    false,
  );
  assert.equal(project.status, "planning");
});

test("Immediate project refresh keeps a live Ping planning run active", async () => {
  const backend = createBackend({
    advancedDefaults: {
      provider: "claude",
      model: "gpt-5.4",
      claudeModel: "sonnet",
    },
  }) as Record<string, unknown>;
  (backend.ensureInitialized as Function) = async () => {};
  (backend.assertFreshProjectKnowledge as Function) = async () => {};
  (backend.requireProviderReady as Function) = async () => {};
  (backend.readUsage as Function) = async () => ({
    updatedAt: "2026-04-04T00:09:30.000Z",
    claude: { status: "ready", windows: [], note: null },
    codex: { status: "ready", windows: [], note: null },
  });
  (backend.refreshProjectRuntimeConfig as Function) = async (currentProject: Record<string, unknown>) => currentProject;
  (backend.syncProjectRuntimeState as Function) = async (currentProject: Record<string, unknown>) => ({
    project: currentProject,
    runtime: { running: false },
  });

  let project: Record<string, unknown> = {
    id: "project-1",
    name: "Ping Project Refresh Project",
    localPath: projectRoot,
    status: "idle",
    lastError: null,
    updatedAt: "2026-04-04T00:09:30.000Z",
    description: "Ping project refresh project.",
    threadId: null,
  };
  (backend.requireProject as Function) = async () => project;

  let planningStarted = false;
  const livePlan = { status: "planning" };
  backend.codex = { getActivePlan: () => null };
  backend.claude = { getActivePlan: () => (planningStarted ? livePlan : null) };
  (backend.aiService as Function) = () => ({
    previewPlanningPrompt: () => "Plan prompt",
    startPlanningTurn: async () => {
      planningStarted = true;
      return new Promise(() => {});
    },
  });

  let storedSession = (backend.createEmptyAgentSession as Function)("project-1", "claude") as AgentSession;
  const savedSessions: AgentSession[] = [];
  storedSession.toddMemory.futureUpdatePlan = [
    {
      id: "update-1",
      versionId: "version-1",
      title: "Ship Ping update",
      description: "Apply the latest update in agent chat.",
      order: 0,
      status: "pending",
      dependencies: [],
      pillarIds: [],
      skillsNeeded: [],
    },
  ];
  (backend.store as Record<string, unknown>).getAgentSession = async () => storedSession;
  (backend.store as Record<string, unknown>).saveAgentSession = async (session: AgentSession) => {
    storedSession = JSON.parse(JSON.stringify(session)) as AgentSession;
    savedSessions.push(JSON.parse(JSON.stringify(session)) as AgentSession);
  };
  (backend.store as Record<string, unknown>).readHistory = async () => [];
  (backend.store as Record<string, unknown>).updateProject = async (nextProject: Record<string, unknown>) => {
    project = JSON.parse(JSON.stringify(nextProject));
  };

  await (backend.routeUpdateToProgramming as Function)({
    projectId: "project-1",
    updateId: "update-1",
    provider: "claude",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    skipConfirmation: true,
  });

  const saveCountBeforeRefresh = savedSessions.length;
  const detail = await (backend.readProject as Function)("project-1") as { project: Record<string, unknown>; activePlan: { status: string } | null };

  assert.equal(planningStarted, true);
  assert.equal(savedSessions.length, saveCountBeforeRefresh);
  assert.equal(detail.project.status, "planning");
  assert.equal(detail.activePlan?.status, "planning");
  assert.equal(storedSession.pingMemory.activeUpdateId, "update-1");
  assert.equal(storedSession.slackMessages.at(-1)?.status, "working");
  assert.equal(
    storedSession.slackMessages.some((message) => /Ping stopped before execution began/i.test(message.content)),
    false,
  );
});

test("Agent session load repairs a stale Claude Ping startup failure and releases the Todd update", async () => {
  const backend = createBackend({
    advancedDefaults: {
      provider: "claude",
      model: "gpt-5.4",
      claudeModel: "sonnet",
    },
  }) as Record<string, unknown>;
  (backend.ensureInitialized as Function) = async () => {};
  (backend.decorateAgentSessionKnowledgeState as Function) = async (target: AgentSession) => {
    target.knowledgeStatus = "fresh";
    target.knowledgeReasons = [];
    return target;
  };
  backend.codex = { getActivePlan: () => null };
  backend.claude = { getActivePlan: () => null };

  let storedSession = (backend.createEmptyAgentSession as Function)("project-1", "claude") as AgentSession;
  storedSession.toddMemory.futureUpdatePlan = [
    {
      id: "update-1",
      versionId: "version-1",
      title: "Ship Ping update",
      description: "Apply the latest update in agent chat.",
      order: 0,
      status: "in_progress",
      dependencies: [],
      pillarIds: [],
      skillsNeeded: [],
    },
  ];
  storedSession.versionUpdates = [...storedSession.toddMemory.futureUpdatePlan];
  storedSession.pingMemory.activeUpdateId = "update-1";
  storedSession.pingMemory.activeTask = "Ship Ping update";
  storedSession.pingMemory.context = "Todd handed this off to Ping.";
  storedSession.pingMemory.currentRun = {
    task: {
      source: "todd-approved-update",
      projectId: "project-1",
      updateId: "update-1",
      updateTitle: "Ship Ping update",
      updateDescription: "Apply the latest update in agent chat.",
      originalUserRequest: "Ship Ping update",
      toddExplanation: "Apply the latest update in agent chat.",
      relevantPillarIds: [],
      toddCodebaseMapSummary: null,
      coreDetailsContext: null,
      runtime: {
        provider: "claude",
        model: "gpt-5.4",
        claudeModel: "sonnet",
        reasoningEffort: "medium",
        planningMode: "auto",
        contextPaths: [],
      },
      planPrompt: "Plan prompt",
      createdAt: "2026-04-03T23:21:22.576Z",
    },
    plan: null,
    report: null,
    usageBefore: null,
    usageAfter: null,
    validationReport: null,
  };
  storedSession.slackActiveDirectorId = "programming-director";
  storedSession.slackPresenceGuestId = "programming-director";
  (backend.appendSlackAssistantMessage as Function)(storedSession, "programming-director", "I’ll map the plan now.", {
    status: "complete",
    metadata: null,
  });
  (backend.appendSlackAssistantMessage as Function)(storedSession, "programming-director", "", {
    status: "working",
    metadata: null,
  });

  const project = {
    id: "project-1",
    name: "Ping Recovery Project",
    localPath: projectRoot,
    lastError: JSON.stringify([
      { path: ["summary"], message: "Required" },
      { path: ["impact"], message: "Required" },
    ]),
  };

  (backend.store as Record<string, unknown>).getAgentSession = async () => storedSession;
  (backend.store as Record<string, unknown>).saveAgentSession = async (session: AgentSession) => {
    storedSession = JSON.parse(JSON.stringify(session)) as AgentSession;
  };
  (backend.store as Record<string, unknown>).readProject = async () => project;

  const repaired = await (backend.getAgentSession as Function)("project-1") as AgentSession | null;

  assert.ok(repaired);
  assert.equal(repaired?.pingMemory.activeUpdateId, null);
  assert.equal(repaired?.pingMemory.activeTask, null);
  assert.equal(repaired?.pingMemory.context, null);
  assert.equal(repaired?.pingMemory.currentRun, null);
  assert.equal(repaired?.toddMemory.futureUpdatePlan[0]?.status, "pending");
  assert.equal(repaired?.versionUpdates[0]?.status, "pending");
  assert.equal(repaired?.slackActiveDirectorId, "project-manager");
  assert.equal(repaired?.slackPresenceGuestId, null);
  assert.equal(repaired?.slackMessages.at(-1)?.status, "complete");
  assert.match(repaired?.slackMessages.at(-1)?.content ?? "", /Structured output validation failed/i);
});

test("Agent session load repairs an orphaned Ping working message and clears transient project state", async () => {
  const backend = createBackend({
    advancedDefaults: {
      provider: "claude",
      model: "gpt-5.4",
      claudeModel: "sonnet",
    },
  }) as Record<string, unknown>;
  (backend.ensureInitialized as Function) = async () => {};
  (backend.decorateAgentSessionKnowledgeState as Function) = async (target: AgentSession) => {
    target.knowledgeStatus = "fresh";
    target.knowledgeReasons = [];
    return target;
  };
  backend.codex = { getActivePlan: () => null };
  backend.claude = { getActivePlan: () => null };

  let project = {
    id: "project-1",
    name: "Ping Orphan Recovery Project",
    localPath: projectRoot,
    status: "executing",
    lastError: null,
    updatedAt: "2026-04-04T00:09:30.000Z",
  };

  let storedSession = (backend.createEmptyAgentSession as Function)("project-1", "claude") as AgentSession;
  storedSession.toddMemory.futureUpdatePlan = [
    {
      id: "update-1",
      versionId: "version-1",
      title: "Ship Ping update",
      description: "Apply the latest update in agent chat.",
      order: 0,
      status: "in_progress",
      dependencies: [],
      pillarIds: [],
      skillsNeeded: [],
    },
  ];
  storedSession.versionUpdates = [...storedSession.toddMemory.futureUpdatePlan];
  storedSession.pingMemory.activeUpdateId = "update-1";
  storedSession.pingMemory.activeTask = "Ship Ping update";
  storedSession.pingMemory.context = "Todd handed this off to Ping.";
  storedSession.slackActiveDirectorId = "programming-director";
  storedSession.slackPresenceGuestId = "programming-director";
  (backend.appendSlackAssistantMessage as Function)(storedSession, "programming-director", "Plan completed.", {
    status: "complete",
    metadata: null,
  });
  (backend.appendSlackAssistantMessage as Function)(storedSession, "programming-director", "", {
    status: "working",
    metadata: null,
  });

  (backend.store as Record<string, unknown>).getAgentSession = async () => storedSession;
  (backend.store as Record<string, unknown>).saveAgentSession = async (session: AgentSession) => {
    storedSession = JSON.parse(JSON.stringify(session)) as AgentSession;
  };
  (backend.store as Record<string, unknown>).readProject = async () => project;
  (backend.store as Record<string, unknown>).updateProject = async (nextProject: typeof project) => {
    project = JSON.parse(JSON.stringify(nextProject));
  };

  const repaired = await (backend.getAgentSession as Function)("project-1") as AgentSession | null;

  assert.ok(repaired);
  assert.equal(repaired?.pingMemory.activeUpdateId, null);
  assert.equal(repaired?.pingMemory.activeTask, null);
  assert.equal(repaired?.pingMemory.context, null);
  assert.equal(repaired?.pingMemory.currentRun, null);
  assert.equal(repaired?.toddMemory.futureUpdatePlan[0]?.status, "pending");
  assert.equal(repaired?.versionUpdates[0]?.status, "pending");
  assert.equal(repaired?.slackActiveDirectorId, "project-manager");
  assert.equal(repaired?.slackPresenceGuestId, null);
  assert.equal(repaired?.slackMessages.at(-1)?.status, "complete");
  assert.match(repaired?.slackMessages.at(-1)?.content ?? "", /cleared after the run stopped/i);
  assert.equal(project.status, "idle");
  assert.equal(project.lastError, null);
});

test("Pong validation queues approval only when the active validation model is large", async () => {
  const largeBackend = createBackend() as Record<string, unknown>;
  const largeSession = (largeBackend.createEmptyAgentSession as Function)("project-1", "codex") as AgentSession;
  (largeBackend.ensureInitialized as Function) = async () => {};
  (largeBackend.store as Record<string, unknown>).getAgentSession = async () => largeSession;
  let largeImmediateRun = false;
  (largeBackend.runValidationNow as Function) = async () => {
    largeImmediateRun = true;
    throw new Error("runValidationNow should not be called for large-model validation");
  };

  await (largeBackend.assignPongValidation as Function)({
    projectId: "project-1",
    instruction: "Validate the latest project state.",
    updateId: null,
  });

  assert.equal(largeImmediateRun, false);
  assert.equal(largeSession.pendingApprovals[0]?.draftPayload?.action, "runValidation");

  const smallBackend = createBackend({
    advancedDefaults: {
      provider: "codex",
      model: "gpt-5.5-mini",
      claudeModel: "sonnet",
    },
  }) as Record<string, unknown>;
  const smallSession = (smallBackend.createEmptyAgentSession as Function)("project-1", "codex") as AgentSession;
  (smallBackend.store as Record<string, unknown>).getAgentSession = async () => smallSession;
  let smallImmediateInput: Record<string, unknown> | null = null;
  (smallBackend.runValidationNow as Function) = async (input: Record<string, unknown>) => {
    smallImmediateInput = input;
    return {
      id: "validation-1",
      updateId: "",
      validationType: "functional",
      passed: true,
      summary: "Validation passed.",
      details: null,
      screenshotPaths: [],
      createdAt: new Date().toISOString(),
    };
  };
  let smallQueuedApproval = false;
  (smallBackend.runValidation as Function) = async () => {
    smallQueuedApproval = true;
    return null;
  };

  await (smallBackend.assignPongValidation as Function)({
    projectId: "project-1",
    instruction: "Validate the latest project state.",
    updateId: null,
  });

  assert.equal(smallQueuedApproval, false);
  assert.equal(smallImmediateInput?.provider, "codex");
  assert.equal(smallImmediateInput?.model, "gpt-5.5-mini");
});

test("Ping execution switches the approved plan draft to the small execution runtime", async () => {
  const testProjectRoot = await mkdtemp(path.join(os.tmpdir(), "programs-ping-execution-project-"));
  await writeFile(path.join(testProjectRoot, "README.md"), "Test project.\n", "utf8");

  const backend = createBackend() as Record<string, unknown>;
  (backend.requireProviderReady as Function) = async () => {};
  (backend.updateProjectStatus as Function) = async (project: Record<string, unknown>) => project;

  let capturedDraft: Record<string, unknown> | null = null;
  (backend.aiService as Function) = () => ({
    executeApprovedPlan: async (_project: unknown, _settings: unknown, draft: Record<string, unknown>) => {
      capturedDraft = {
        provider: draft.provider,
        model: draft.model,
        claudeModel: draft.claudeModel,
        reasoningEffort: draft.reasoningEffort,
        contextPaths: draft.contextPaths,
      };
      return new Promise(() => {});
    },
  });

  const project = {
    id: "project-1",
    name: "Ping Execution Project",
    localPath: testProjectRoot,
  };
  const draft = {
    projectId: "project-1",
    provider: "codex",
    threadId: "thread-1",
    turnId: "turn-1",
    prompt: "Ship the approved update.",
    speed: "normal",
    model: "gpt-5.4",
    claudeModel: "opus",
    reasoningEffort: "high",
    planningMode: "auto",
    autoApprove: true,
    contextPaths: [],
    skillInstructions: null,
    coreDetailsContext: null,
    pingTaskSnapshot: {
      source: "direct-ping-request",
      projectId: "project-1",
      updateId: null,
      updateTitle: null,
      updateDescription: null,
      originalUserRequest: "Ship the approved update.",
      toddExplanation: "Ship the approved update.",
      relevantPillarIds: [],
      toddCodebaseMapSummary: null,
      coreDetailsContext: null,
      runtime: {
        provider: "codex",
        model: "gpt-5.4-mini",
        claudeModel: "sonnet",
        reasoningEffort: "high",
        planningMode: "auto",
        contextPaths: ["src/main/backend.ts"],
      },
      planPrompt: "Plan prompt",
      createdAt: new Date().toISOString(),
    },
    status: "awaitingApproval",
    thinkingStatus: "completed",
    planningStatus: "completed",
    buildingStatus: "pending",
    verifyingStatus: "pending",
    explanation: "Apply the approved implementation plan.",
    steps: [],
    summary: null,
    impact: null,
    diff: null,
    diffStats: null,
    finalText: null,
    verificationDetails: null,
    errorMessage: null,
    lastUpdatedAt: new Date().toISOString(),
  };

  try {
    await (backend.executePlan as Function)(project, {
      advancedDefaults: {
        provider: "codex",
        model: "gpt-5.4",
        claudeModel: "sonnet",
      },
      defaultSpeed: "normal",
    }, draft);

    assert.deepEqual(capturedDraft, {
      provider: "codex",
      model: "gpt-5.4-mini",
      claudeModel: "sonnet",
      reasoningEffort: "high",
      contextPaths: ["src/main/backend.ts"],
    });
  } finally {
    await rm(testProjectRoot, { recursive: true, force: true });
  }
});
