import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_SETTINGS } from "../src/main/defaults.ts";
import {
  createEmptyProjectRelationshipSummary,
  type HomeRoutingPlan,
  type Project,
} from "../src/shared/types.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Mirrors tests/project-chat-backend.test.ts: rewrite backend.ts to stub electron + services.
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

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "programs-backend-home-"));
  const tempPath = path.join(tempDir, "backend.test.ts");
  await writeFile(tempPath, source, "utf8");

  try {
    return await import(pathToFileURL(tempPath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const { ProgramsBackend } = await loadBackendModule();

const makeProject = (id: string, name: string, description = ""): Project => ({
  id,
  name,
  iconColor: "#0EA5E9",
  description,
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
});

const combat = makeProject("proj-combat", "Combat Game", "A roguelike combat prototype.");
const fresh = makeProject("proj-empty", "Fresh Idea");

const combatSession = {
  corePillars: [{ id: "p1", name: "Combat Loop", thesis: { summary: "Tight, readable fights.", status: "confirmed" } }],
  directorStateMap: {
    "rd-director": {
      currentState: "Core loop playable; balancing in progress.",
      idealState: "Vertical slice with three enemy types.",
      assumptions: [],
    },
  },
};

const makeBackend = (overrides: {
  store: Record<string, unknown>;
  codexRunOneShot?: (...args: unknown[]) => Promise<string>;
}) => {
  const codex = {
    runOneShot: overrides.codexRunOneShot ?? (async () => "{}"),
  };
  const backend = new ProgramsBackend(overrides.store, {}, {}, {}, codex, {}, () => undefined);
  backend.initializationPromise = Promise.resolve();
  return backend;
};

test("homeChat builds digests, proposes a plan, and sends nothing", async () => {
  let capturedPrompt = "";
  let savedSession: any = null;
  const store = {
    readSettings: async () => DEFAULT_SETTINGS,
    readHomeSession: async () => null,
    writeHomeSession: async (session: unknown) => {
      savedSession = session;
    },
    listProjects: async () => [combat, fresh],
    getAgentSession: async (projectId: string) => (projectId === "proj-combat" ? combatSession : null),
    readProject: async (id: string) => (id === "proj-combat" ? combat : fresh),
  };

  const backend = makeBackend({
    store,
    codexRunOneShot: async (_project, _settings, prompt: string) => {
      capturedPrompt = prompt;
      return JSON.stringify({
        reply: "Two things — a combat idea and a brand-new tool.",
        clarifyingQuestions: [],
        deliveries: [
          {
            projectId: "proj-combat",
            newProjectName: null,
            content: "Add a boss to area two.",
            nature: "creative",
            reason: "Concept update.",
          },
          {
            projectId: null,
            newProjectName: "Loader Tool",
            content: "Build a standalone loader.",
            nature: "technical",
            reason: "Nothing matches.",
          },
        ],
        newProjectProposals: [
          { name: "Loader Tool", initialIdea: "A standalone loader.", reason: "Nothing matches." },
        ],
      });
    },
  });

  // If anything tried to actually deliver during a propose turn, that's a bug.
  backend.agentChat = async () => {
    throw new Error("homeChat must not deliver — that only happens on confirm.");
  };

  const response = await backend.homeChat({
    provider: "codex",
    model: "gpt-5.5",
    claudeModel: "opus",
    message: "boss fight idea + make a loader tool",
  });

  // Digest reached the model: real state for combat, placeholder for the empty project.
  assert.match(capturedPrompt, /Core loop playable/);
  assert.match(capturedPrompt, /Concept not yet defined/);
  assert.match(capturedPrompt, /boss fight idea \+ make a loader tool/);

  assert.equal(response.plan.deliveries.length, 2);
  assert.equal(response.plan.newProjectProposals.length, 1);

  // The plan was persisted as pending, and the conversation captured both turns.
  assert.ok(savedSession);
  assert.equal(savedSession.pendingPlan?.id, response.plan.id);
  const roles = savedSession.messages.map((m: { role: string }) => m.role);
  assert.deepEqual(roles, ["user", "assistant"]);
  assert.equal(savedSession.messages[1].plan?.id, response.plan.id);
});

const pendingPlanFixture = (): HomeRoutingPlan => ({
  id: "plan-1",
  reply: "Routing this.",
  clarifyingQuestions: [],
  deliveries: [
    {
      id: "d1",
      projectId: "proj-combat",
      projectName: "Combat Game",
      newProjectProposalId: null,
      content: "Add a boss to area two.",
      nature: "creative",
      reason: "Concept update.",
      status: "proposed",
    },
    {
      id: "d2",
      projectId: "",
      projectName: "Loader Tool",
      newProjectProposalId: "pp1",
      content: "Build a standalone loader.",
      nature: "technical",
      reason: "Nothing matches.",
      status: "proposed",
    },
  ],
  newProjectProposals: [{ id: "pp1", name: "Loader Tool", initialIdea: "A standalone loader.", reason: "Nothing matches." }],
});

test("confirmHomeDeliveries sends to Jeff, creates approved projects, and writes receipts", async () => {
  let savedSession: any = null;
  const store = {
    readSettings: async () => DEFAULT_SETTINGS,
    readHomeSession: async () => ({
      id: "home-1",
      messages: [],
      pendingPlan: pendingPlanFixture(),
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
    }),
    writeHomeSession: async (session: unknown) => {
      savedSession = session;
    },
    listProjects: async () => [combat],
    readProject: async (id: string) => (id === "created-1" ? makeProject("created-1", "Loader Tool") : combat),
  };

  const agentChatCalls: Array<{ projectId: string; targetDirectorId: string; message: string }> = [];
  const createProjectCalls: Array<{ name: string }> = [];

  const backend = makeBackend({ store });
  backend.createProject = async (input: { name: string }) => {
    createProjectCalls.push({ name: input.name });
    return makeProject("created-1", input.name);
  };
  backend.agentChat = async (input: { projectId: string; targetDirectorId: string; message: string }) => {
    agentChatCalls.push({ projectId: input.projectId, targetDirectorId: input.targetDirectorId, message: input.message });
    return {
      sessionId: "s",
      directorId: "project-manager",
      message: { id: `msg-${agentChatCalls.length}`, role: "assistant", directorId: "project-manager", content: "", createdAt: "" },
      handoffTo: null,
      handoffReason: null,
      chainedMessages: [],
    };
  };

  await backend.confirmHomeDeliveries({
    planId: "plan-1",
    approvedDeliveryIds: ["d1", "d2"],
    approvedProposals: [{ id: "pp1" }],
  });

  // The new project was created exactly once.
  assert.deepEqual(createProjectCalls, [{ name: "Loader Tool" }]);

  // Both deliveries went through the existing pipeline, addressed to Jeff, with the relay prefix.
  assert.equal(agentChatCalls.length, 2);
  for (const call of agentChatCalls) {
    assert.equal(call.targetDirectorId, "project-manager");
    assert.match(call.message, /From Home/);
  }
  // The new-project delivery was sent to the freshly created project id.
  const loaderCall = agentChatCalls.find((call) => /standalone loader/.test(call.message));
  assert.equal(loaderCall?.projectId, "created-1");

  // Receipts: deliveries marked sent, a system message appended, pending plan cleared.
  assert.ok(savedSession);
  assert.equal(savedSession.pendingPlan, null);
  const receipt = savedSession.messages.find((m: { role: string }) => m.role === "system");
  assert.ok(receipt, "expected a system receipt message");
  assert.match(receipt.content, /Sent 2 notes/);
  assert.ok(receipt.plan.deliveries.every((d: { status: string }) => d.status === "sent"));
});

test("confirmHomeDeliveries honors selective approval (skips unapproved proposal + delivery)", async () => {
  const store = {
    readSettings: async () => DEFAULT_SETTINGS,
    readHomeSession: async () => ({
      id: "home-1",
      messages: [],
      pendingPlan: pendingPlanFixture(),
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
    }),
    writeHomeSession: async () => {},
    listProjects: async () => [combat],
    readProject: async () => combat,
  };

  let createProjectCalled = false;
  const agentChatCalls: Array<{ projectId: string; targetDirectorId: string }> = [];

  const backend = makeBackend({ store });
  backend.createProject = async () => {
    createProjectCalled = true;
    return makeProject("created-1", "Loader Tool");
  };
  backend.agentChat = async (input: { projectId: string; targetDirectorId: string }) => {
    agentChatCalls.push({ projectId: input.projectId, targetDirectorId: input.targetDirectorId });
    return {
      sessionId: "s",
      directorId: "project-manager",
      message: { id: "m", role: "assistant", directorId: "project-manager", content: "", createdAt: "" },
      handoffTo: null,
      handoffReason: null,
      chainedMessages: [],
    };
  };

  // Approve only the existing-project delivery; leave the new project + its delivery unapproved.
  await backend.confirmHomeDeliveries({
    planId: "plan-1",
    approvedDeliveryIds: ["d1"],
    approvedProposals: [],
  });

  assert.equal(createProjectCalled, false);
  assert.equal(agentChatCalls.length, 1);
  assert.equal(agentChatCalls[0].projectId, "proj-combat");
  assert.equal(agentChatCalls[0].targetDirectorId, "project-manager");
});

test("confirmHomeDeliveries rejects a stale plan id", async () => {
  const store = {
    readSettings: async () => DEFAULT_SETTINGS,
    readHomeSession: async () => ({
      id: "home-1",
      messages: [],
      pendingPlan: pendingPlanFixture(),
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
    }),
    writeHomeSession: async () => {},
    listProjects: async () => [combat],
    readProject: async () => combat,
  };
  const backend = makeBackend({ store });
  backend.agentChat = async () => {
    throw new Error("should not deliver for a stale plan");
  };

  await assert.rejects(
    () => backend.confirmHomeDeliveries({ planId: "not-the-pending-plan", approvedDeliveryIds: ["d1"], approvedProposals: [] }),
    /no longer available/,
  );
});
