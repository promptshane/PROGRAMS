import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AgentSession, CorePillar, DirectorId, PendingApproval } from "../src/shared/types.ts";
import { getDirectorMetadata } from "../src/shared/director-metadata.ts";
import { buildPingLifecycleTranslationMetadata } from "../src/shared/ping-translations.ts";

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

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "programs-backend-dan-"));
  const tempPath = path.join(tempDir, "backend.test.ts");
  await writeFile(tempPath, source, "utf8");

  try {
    return await import(pathToFileURL(tempPath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const { ProgramsBackend } = await loadBackendModule();

const NOW = "2026-03-20T12:00:00.000Z";

const createSession = (): AgentSession => {
  const emptyStage = { messages: [], confirmed: null };
  return {
    id: "session-1",
    projectId: "project-1",
    currentStage: "function",
    conversationMode: "guided",
    stages: {
      function: { ...emptyStage },
      thesis: { ...emptyStage },
      core_pillars: { ...emptyStage },
      full_flow: { ...emptyStage },
      iterations: { ...emptyStage },
      execution: { ...emptyStage },
    },
    unifiedMessages: [],
    scratchpad: [],
    plannedUpdates: [],
    corePillars: [],
    currentCorePillars: [],
    coreDetailsChatHistory: [],
    attachedMaterials: [],
    miscMaterials: [],
    cascadePending: null,
    provider: "codex",
    createdAt: NOW,
    updatedAt: NOW,
    directorConversations: {},
    versions: [],
    versionUpdates: [],
    feasibilityAssessments: [],
    validationResults: [],
    validationFrequency: "manual",
    activeDirectorId: null,
    directorProgress: {
      creative: "not-started",
      rd: "not-started",
      programming: "not-started",
      validation: "not-started",
      currentDirector: null,
    },
    creativeFocusMode: null,
    rdFocusMode: null,
    validationFocusMode: null,
    danInternalNotes: [],
    danSideNotes: [],
    danDraftCoreDetails: null,
    danDraftChangeSummary: [],
    danDraftStatus: null,
    danArchivedNotes: [],
    deletedNotes: [],
    pingTaskContext: null,
    pongTaskContext: null,
    projectCategory: "general-project",
    dynamicSubAgents: [],
    slackMessages: [],
    slackActiveDirectorId: "project-manager",
    slackPresenceGuestId: null,
    pendingApprovals: [],
    directorSettingsOverrides: {},
    directorStateMap: {},
    danMemory: {
      confirmedConcept: null,
      draftConcept: null,
      notes: [],
      sideNotes: [],
      draftChangeSummary: [],
      draftStatus: null,
      fullExperienceDescription: null,
      archivedNotes: [],
      deletedNotes: [],
      rawMemories: [],
      forgottenMemories: [],
      creativeHistory: [],
    },
    toddMemory: {
      confirmedConcept: null,
      versionPlan: { v1: null, v2: null, v3: null },
      futureUpdatePlan: [],
      previousUpdateLog: [],
      troubleLog: [],
      codebaseIndexedMap: null,
    },
    pingMemory: {
      activeUpdateId: null,
      activeTask: null,
      context: null,
      codebaseMapSummary: null,
      latestRawReport: null,
      latestJeffReport: null,
    },
    agentConversations: {},
    activeAgentId: null,
  };
};

const createDanDraft = () => ({
  function: "Guide new users into the workspace with a focused onboarding flow.",
  thesis: "Reduce first-run uncertainty by making the workspace feel legible immediately.",
  fullFlow: "User arrives, gets guided through setup, and lands inside a clear workspace baseline.",
  pillars: [
    {
      name: "Onboarding",
      pillarType: "core",
      parentName: null,
      function: "Orient the user and collect the minimum setup inputs.",
      thesis: "The first interaction should feel guided, not overwhelming.",
      fullFlow: "Start with a short setup sequence before entering the workspace.",
      description: "A step-based onboarding flow.",
      assumptionText: null,
      assumptionSource: null,
      order: 1,
      connectedPillarNames: [],
    },
    {
      name: "Workspace",
      pillarType: "core",
      parentName: null,
      function: "Give the user a stable place to act once setup is done.",
      thesis: "The product should feel ready to use after onboarding ends.",
      fullFlow: "Move from onboarding into the user's working area.",
      description: "The user's primary working surface.",
      assumptionText: null,
      assumptionSource: null,
      order: 2,
      connectedPillarNames: ["Onboarding"],
    },
  ],
});

const createDanPayload = (overrides: Record<string, unknown> = {}) => ({
  response: "I tightened the onboarding concept and I'm still gathering details.",
  handoffTo: null,
  handoffReason: null,
  currentState: "We are shaping the onboarding direction.",
  idealState: null,
  notesToAppend: ["User wants onboarding to explain the workspace immediately."],
  rawMemoriesToAppend: null,
  conversationStatus: "gathering",
  draftChangeSummary: ["Added an onboarding flow and workspace landing sequence."],
  draftCoreDetails: createDanDraft(),
  presenceAction: "stay",
  ...overrides,
});

const createDirectorPayload = (overrides: Record<string, unknown> = {}) => ({
  response: "Todd can take it from here.",
  handoffTo: null,
  handoffReason: null,
  currentState: "Backend review queued.",
  idealState: null,
  ...overrides,
});

const createDetail = (summary: string, status: "confirmed" | "assumed" | "edited" = "confirmed") => ({
  summary,
  status,
});

const createFlowPillars = (): CorePillar[] => [
  {
    id: "onboarding",
    name: "Onboarding",
    pillarType: "core",
    function: createDetail("Guide the user from arrival into the product."),
    thesis: createDetail("The first interaction should feel obvious and narrow."),
    corePillars: [
      {
        id: "onboarding-help",
        name: "Guided Help",
        pillarType: "tbd",
        function: createDetail("Surface guidance without overwhelming the user.", "assumed"),
        thesis: createDetail("Help should appear only when the user needs it.", "assumed"),
        corePillars: [],
        fullFlow: createDetail("A contextual help branch appears during setup.", "assumed"),
        vibes: [],
        description: "A small help branch inside onboarding.",
        connectedPillarIds: [],
        assumptionText: "This may stay separate from the main onboarding lane.",
        assumptionSource: "dan",
        order: 1,
      },
      {
        id: "onboarding-ambient",
        name: "Ambient Support",
        pillarType: "side",
        function: createDetail("Add a softer side branch for supportive copy."),
        thesis: createDetail("The main series should stay focused while the side branch stays optional."),
        corePillars: [],
        fullFlow: createDetail("Supportive guidance can sit off the main path."),
        vibes: [],
        description: "Side branch for optional guidance.",
        connectedPillarIds: [],
        assumptionText: null,
        assumptionSource: null,
        order: 2,
      },
    ],
    fullFlow: createDetail("Start the setup flow, then land in the workspace."),
    vibes: [],
    description: "The main first-run series.",
    connectedPillarIds: ["workspace"],
    assumptionText: null,
    assumptionSource: null,
    order: 1,
  },
  {
    id: "workspace",
    name: "Workspace",
    pillarType: "core",
    function: createDetail("Give the user a stable working surface."),
    thesis: createDetail("After setup, the product should feel ready to use."),
    corePillars: [
      {
        id: "workspace-experiment",
        name: "Experimental Split View",
        pillarType: "ghost",
        function: createDetail("Test an experimental split layout."),
        thesis: createDetail("The branch may never ship, but it could reshape the experience."),
        corePillars: [],
        fullFlow: createDetail("A speculative split view lives off the main lane."),
        vibes: [],
        description: "Potentially transformative branch.",
        connectedPillarIds: [],
        assumptionText: null,
        assumptionSource: null,
        order: 1,
      },
      {
        id: "workspace-end",
        name: "Launch Baseline",
        pillarType: "hard-stop",
        function: createDetail("Mark the point where the first release can end."),
        thesis: createDetail("The core flow should have a clear terminal point."),
        corePillars: [],
        fullFlow: createDetail("This lane ends once the launch baseline is in place."),
        vibes: [],
        description: "End of the core main timeline.",
        connectedPillarIds: [],
        assumptionText: null,
        assumptionSource: null,
        order: 2,
      },
    ],
    fullFlow: createDetail("Move from setup into the workspace baseline."),
    vibes: [],
    description: "The primary working surface.",
    connectedPillarIds: ["onboarding"],
    assumptionText: null,
    assumptionSource: null,
    order: 2,
  },
];

const createFlowDraft = () => ({
  function: createDetail("Guide the user from arrival into the product."),
  thesis: createDetail("The first interaction should feel obvious and narrow."),
  fullFlow: createDetail("Start the setup flow, then land in the workspace."),
  corePillars: createFlowPillars(),
});

const cloneSession = (session: AgentSession): AgentSession =>
  JSON.parse(JSON.stringify(session)) as AgentSession;

const collectPillarNames = (
  pillars: NonNullable<AgentSession["danDraftCoreDetails"]>["corePillars"],
  names = new Map<string, string>(),
): Map<string, string> => {
  for (const pillar of pillars) {
    names.set(pillar.id, pillar.name);
    collectPillarNames(pillar.corePillars, names);
  }
  return names;
};

const normalizeDanDraftCoreDetails = (draft: AgentSession["danDraftCoreDetails"]) => {
  if (!draft) {
    return null;
  }

  const pillarNames = collectPillarNames(draft.corePillars);
  const normalizePillar = (pillar: (typeof draft.corePillars)[number]) => ({
    name: pillar.name,
    pillarType: pillar.pillarType,
    function: pillar.function,
    thesis: pillar.thesis,
    corePillars: pillar.corePillars.map(normalizePillar),
    fullFlow: pillar.fullFlow,
    vibes: pillar.vibes,
    description: pillar.description,
    connectedPillarNames: pillar.connectedPillarIds
      .map((pillarId) => pillarNames.get(pillarId) ?? pillarId)
      .sort(),
    assumptionText: pillar.assumptionText,
    assumptionSource: pillar.assumptionSource,
    order: pillar.order,
  });

  return {
    function: draft.function,
    thesis: draft.thesis,
    corePillars: draft.corePillars.map(normalizePillar),
    fullFlow: draft.fullFlow,
  };
};

const summarizeDanState = (session: AgentSession) => ({
  danInternalNotes: session.danInternalNotes,
  danSideNotes: session.danSideNotes,
  danDraftCoreDetails: normalizeDanDraftCoreDetails(session.danDraftCoreDetails),
  danDraftChangeSummary: session.danDraftChangeSummary,
  danDraftStatus: session.danDraftStatus,
  directorState: session.directorStateMap["creative-director"] ?? null,
});

const createBackendHarness = (responses: Array<Record<string, unknown>>) => {
  const prompts: string[] = [];
  let responseIndex = 0;
  let storedSession: AgentSession | null = null;
  const savedSessions: AgentSession[] = [];
  const settings = {
    advancedDefaults: {
      provider: "codex",
      model: "gpt-5.4",
      claudeModel: "sonnet",
    },
  };
  const project = {
    id: "project-1",
    name: "Dan Test Project",
  };
  const cloneSession = (session: AgentSession): AgentSession => JSON.parse(JSON.stringify(session)) as AgentSession;
  const store = {
    readSettings: async () => settings,
    getAgentSession: async () => storedSession,
    saveAgentSession: async (session: AgentSession) => {
      savedSessions.push(cloneSession(session));
      storedSession = session;
    },
    getProject: async () => project,
  };
  const codex = {
    getAuthStatus: async () => ({ authenticated: true }),
    runOneShot: async (
      _project: unknown,
      _settings: unknown,
      prompt: string,
    ) => {
      prompts.push(prompt);
      const payload = responses[responseIndex] ?? responses[responses.length - 1];
      responseIndex += 1;
      return JSON.stringify(payload);
    },
  };
  const claude = {
    getAuthStatus: async () => ({ authenticated: true }),
    runOneShot: async () => {
      throw new Error("Claude should not be used in this test.");
    },
  };
  const backend = new ProgramsBackend(
    store as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    codex as never,
    claude as never,
    () => {},
  ) as Record<string, unknown>;

  backend.ensureInitialized = async () => {};
  backend.requireProviderReady = async () => {};
  backend.requireProject = async () => project;
  backend.getSlackProviderPreflightErrors = async () => ({ codex: null, claude: null });
  backend.saveAgentSession = async (_projectId: string, session: AgentSession) => {
    savedSessions.push(cloneSession(session));
    storedSession = session;
  };
  backend.stageSlackDirectorIntroSequence = async (session: AgentSession, _projectId: string, directorId: string) => {
    const message = {
      id: `intro-${directorId}-${session.slackMessages.length}`,
      role: "assistant" as const,
      directorId,
      content: "",
      createdAt: NOW,
      status: "working" as const,
      metadata: null,
    };
    session.slackMessages.push(message);
    return message;
  };

  return {
    backend,
    prompts,
    project,
    settings,
    setStoredSession(session: AgentSession | null) {
      storedSession = session;
    },
    getStoredSession() {
      return storedSession;
    },
    getSavedSessions() {
      return savedSessions;
    },
  };
};

test("Dan gathering turns update draft state and side notes without mutating confirmed core-details", async () => {
  const session = createSession();
  session.slackMessages.push({
    id: "user-1",
    role: "user",
    directorId: null,
    content: "I want onboarding to explain the workspace immediately.",
    createdAt: NOW,
  });
  const harness = createBackendHarness([
    createDanPayload({
      rawMemoriesToAppend: [{ content: "Optional ambient audio could stay as a side experiment.", relatedPillarNames: [] }],
    }),
  ]);

  await (harness.backend.runSlackDirectorTurn as Function)({
    session,
    project: harness.project,
    settings: harness.settings,
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    directorId: "creative-director",
    userMessage: "I want onboarding to explain the workspace immediately.",
    mode: "codebase-analysis",
  });

  assert.equal(session.stages.function.confirmed, null);
  assert.equal(session.stages.thesis.confirmed, null);
  assert.equal(session.stages.core_pillars.confirmed, null);
  assert.equal(session.stages.full_flow.confirmed, null);
  assert.equal(session.danDraftStatus, "gathering");
  assert.deepEqual(session.danInternalNotes, ["User wants onboarding to explain the workspace immediately."]);
  assert.equal(session.danMemory.rawMemories.length, 1);
  assert.equal(session.danMemory.rawMemories[0].content, "Optional ambient audio could stay as a side experiment.");
  assert.deepEqual(session.danDraftChangeSummary, ["Added an onboarding flow and workspace landing sequence."]);
  assert.equal(
    session.danDraftCoreDetails?.function?.summary,
    "Guide new users into the workspace with a focused onboarding flow.",
  );
  assert.equal(session.pendingApprovals.length, 0);
  assert.equal(session.slackPresenceGuestId, "creative-director");
  assert.equal(session.slackActiveDirectorId, "creative-director");
});

test("Dan prompt includes matching back-up memories for explicit recall requests", async () => {
  const recallSession = createSession();
  recallSession.danMemory.forgottenMemories = [
    "Animated onboarding could use a slow camera pan.",
    "Pricing experiment mentioned for a later phase.",
  ];
  recallSession.danSideNotes = [...recallSession.danMemory.forgottenMemories];
  recallSession.slackMessages.push({
    id: "user-1",
    role: "user",
    directorId: null,
    content: "Dan, remember that idea we talked about for animated onboarding?",
    createdAt: NOW,
  });
  const recallHarness = createBackendHarness([createDanPayload({ draftCoreDetails: null, draftChangeSummary: [] })]);

  await (recallHarness.backend.runSlackDirectorTurn as Function)({
    session: recallSession,
    project: recallHarness.project,
    settings: recallHarness.settings,
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    directorId: "creative-director",
    userMessage: "Dan, remember that idea we talked about for animated onboarding?",
    mode: "codebase-analysis",
  });

  assert.match(recallHarness.prompts[0] ?? "", /Back-up: Forgotten Memories/);
  assert.match(recallHarness.prompts[0] ?? "", /Animated onboarding could use a slow camera pan\./);
  assert.doesNotMatch(recallHarness.prompts[0] ?? "", /Pricing experiment mentioned for a later phase\./);

  const nonRecallSession = createSession();
  nonRecallSession.danMemory.forgottenMemories = [...recallSession.danMemory.forgottenMemories];
  nonRecallSession.danSideNotes = [...nonRecallSession.danMemory.forgottenMemories];
  nonRecallSession.slackMessages.push({
    id: "user-2",
    role: "user",
    directorId: null,
    content: "Let's keep refining the onboarding flow.",
    createdAt: NOW,
  });
  const nonRecallHarness = createBackendHarness([createDanPayload({ draftCoreDetails: null, draftChangeSummary: [] })]);

  await (nonRecallHarness.backend.runSlackDirectorTurn as Function)({
    session: nonRecallSession,
    project: nonRecallHarness.project,
    settings: nonRecallHarness.settings,
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    directorId: "creative-director",
    userMessage: "Let's keep refining the onboarding flow.",
    mode: "codebase-analysis",
  });

  assert.doesNotMatch(nonRecallHarness.prompts[0] ?? "", /Back-up: Forgotten Memories/);
});

test("Dan prompt keeps concept structure private and surfaces only concept memory plus draft context", async () => {
  const session = createSession();
  session.corePillars = createFlowPillars();
  session.danMemory.draftConcept = createFlowDraft() as AgentSession["danMemory"]["draftConcept"];
  session.danDraftCoreDetails = session.danMemory.draftConcept;
  session.slackMessages.push({
    id: "user-flow-1",
    role: "user",
    directorId: null,
    content: "Walk me through the main timeline and the separate branches.",
    createdAt: NOW,
  });

  const harness = createBackendHarness([createDanPayload({ draftCoreDetails: null, draftChangeSummary: [] })]);

  await (harness.backend.runSlackDirectorTurn as Function)({
    session,
    project: harness.project,
    settings: harness.settings,
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    directorId: "creative-director",
    userMessage: "Walk me through the main timeline and the separate branches.",
    mode: "codebase-analysis",
  });

  const prompt = harness.prompts[0] ?? "";
  assert.match(prompt, /Hard Memory \(Ideal Creative Truth\):/);
  assert.match(prompt, /Dan's working draft:/);
  assert.match(prompt, /Function draft:/);
  assert.match(prompt, /Onboarding/);
  assert.match(prompt, /Ambient Support/);
  assert.match(prompt, /Experimental Split View/);
  assert.doesNotMatch(prompt, /Confirmed main timeline:/);
  assert.doesNotMatch(prompt, /Branch draft:/);
});

test("Dan ready-to-confirm queues an approval and applying it confirms the draft", async () => {
  const session = createSession();
  session.danInternalNotes = ["User wants the onboarding to feel decisive."];
  session.slackMessages.push({
    id: "user-1",
    role: "user",
    directorId: null,
    content: "That sounds right. Show me the full draft.",
    createdAt: NOW,
  });
  const harness = createBackendHarness([
    createDanPayload({
      response: "Here is the synthesized draft. Does this look good to you?",
      conversationStatus: "ready-to-confirm",
      draftChangeSummary: [
        "Added onboarding as the first pillar.",
        "Defined the workspace landing flow after setup.",
      ],
    }),
  ]);

  await (harness.backend.runSlackDirectorTurn as Function)({
    session,
    project: harness.project,
    settings: harness.settings,
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    directorId: "creative-director",
    userMessage: "That sounds right. Show me the full draft.",
    mode: "codebase-analysis",
  });

  assert.equal(session.pendingApprovals.length, 1);
  const approval = session.pendingApprovals[0] as PendingApproval;
  assert.equal(approval.kind, "store-data");
  assert.equal(approval.requestedByDirectorId, "creative-director");
  assert.equal(approval.targetDirectorId, "creative-director");
  assert.equal(approval.draftPayload?.dataType, "danDraftCoreDetails");

  await (harness.backend.applyStoredDataApproval as Function)(session, approval);

  assert.equal(
    session.stages.function.confirmed?.summary,
    "Guide new users into the workspace with a focused onboarding flow.",
  );
  assert.equal(session.stages.function.confirmed?.status, "confirmed");
  assert.equal(
    session.stages.thesis.confirmed?.summary,
    "Reduce first-run uncertainty by making the workspace feel legible immediately.",
  );
  assert.equal(session.stages.thesis.confirmed?.status, "confirmed");
  assert.equal(
    session.stages.full_flow.confirmed?.summary,
    "User arrives, gets guided through setup, and lands inside a clear workspace baseline.",
  );
  assert.equal(session.stages.full_flow.confirmed?.status, "confirmed");
  assert.equal(session.corePillars.length, 2);
  assert.equal(session.corePillars[0]?.function?.status, "confirmed");
  assert.equal(session.corePillars[1]?.thesis?.status, "confirmed");
  assert.equal(session.danDraftCoreDetails, null);
  assert.deepEqual(session.danDraftChangeSummary, []);
  assert.equal(session.danDraftStatus, null);
  assert.deepEqual(session.danInternalNotes, []);
  assert.match(session.danArchivedNotes[0] ?? "", /dan draft confirmed/);
});

test("Dan uses the same reducer path in DM and Slack, and Slack presence changes on handoff or exit", async () => {
  const dmSession = createSession();
  const slackSession = createSession();
  const sharedPayload = createDanPayload({
    notesToAppend: ["User wants a guided first-run experience."],
    rawMemoriesToAppend: [{ content: "Maybe add ambient motion later.", relatedPillarNames: [] }],
  });

  const dmHarness = createBackendHarness([sharedPayload]);
  dmHarness.setStoredSession(dmSession);
  await (dmHarness.backend.directorChat as Function)({
    projectId: "project-1",
    directorId: "creative-director",
    message: "I want a guided first-run experience.",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    focusMode: "conversation",
  });

  slackSession.slackMessages.push({
    id: "user-1",
    role: "user",
    directorId: null,
    content: "I want a guided first-run experience.",
    createdAt: NOW,
  });
  const slackHarness = createBackendHarness([sharedPayload]);
  await (slackHarness.backend.runSlackDirectorTurn as Function)({
    session: slackSession,
    project: slackHarness.project,
    settings: slackHarness.settings,
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    directorId: "creative-director",
    userMessage: "I want a guided first-run experience.",
    mode: "codebase-analysis",
  });

  assert.deepEqual(
    summarizeDanState(dmHarness.getStoredSession() ?? dmSession),
    summarizeDanState(slackSession),
  );

  const handoffSession = createSession();
  handoffSession.slackMessages.push({
    id: "user-2",
    role: "user",
    directorId: null,
    content: "Dan, ask Todd to inspect the current backend state next.",
    createdAt: NOW,
  });
  const handoffHarness = createBackendHarness([
    createDanPayload({
      response: "Todd should inspect the current backend state next.",
      handoffTo: "rd-director",
      handoffReason: "Inspect the current backend state and summarize the main technical constraints.",
    }),
    createDirectorPayload({
      response: "I inspected the backend and mapped the current constraints.",
      currentState: "Backend constraints mapped.",
    }),
  ]);

  const chainResult = await (handoffHarness.backend.runSlackDirectorChain as Function)({
    session: handoffSession,
    project: handoffHarness.project,
    settings: handoffHarness.settings,
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    directorId: "creative-director",
    userMessage: "Dan, ask Todd to inspect the current backend state next.",
    mode: "codebase-analysis",
  });

  assert.equal(chainResult.message.directorId, "creative-director");
  assert.equal(chainResult.chainedMessages.length, 1);
  assert.equal(chainResult.chainedMessages[0]?.directorId, "rd-director");
  assert.equal(handoffSession.slackPresenceGuestId, null);
  assert.equal(handoffSession.slackActiveDirectorId, "project-manager");
  assert.ok(handoffSession.slackMessages.some((message) => message.directorId === "rd-director"));

  const exitSession = createSession();
  exitSession.slackMessages.push({
    id: "user-3",
    role: "user",
    directorId: null,
    content: "Thanks Dan, you can step out.",
    createdAt: NOW,
  });
  const exitHarness = createBackendHarness([
    createDanPayload({
      response: "I have what I need. Let me know if you want to pick this back up.",
      presenceAction: "exit",
    }),
  ]);

  await (exitHarness.backend.runSlackDirectorTurn as Function)({
    session: exitSession,
    project: exitHarness.project,
    settings: exitHarness.settings,
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    directorId: "creative-director",
    userMessage: "Thanks Dan, you can step out.",
    mode: "codebase-analysis",
  });

  assert.equal(exitSession.slackPresenceGuestId, null);
  assert.equal(exitSession.slackActiveDirectorId, "project-manager");
});

test("DM focus mode inference resolves from the message when focusMode is omitted", async () => {
  const assertDmTurn = async (args: {
    directorId: DirectorId;
    message: string;
    expectedFocusMode: string | null;
    response: Record<string, unknown>;
    promptPattern: RegExp;
  }) => {
    const session = createSession();
    session.slackMessages.push({
      id: `user-${args.directorId}`,
      role: "user",
      directorId: null,
      content: args.message,
      createdAt: NOW,
    });

    const harness = createBackendHarness([args.response]);
    harness.setStoredSession(session);

    await (harness.backend.directorChat as Function)({
      projectId: "project-1",
      directorId: args.directorId,
      message: args.message,
      provider: "codex",
      model: "gpt-5.4",
      claudeModel: "sonnet",
      focusMode: null,
    });

    const savedSessions = harness.getSavedSessions();
    const workingSnapshot = savedSessions[0];
    const conversation = workingSnapshot?.directorConversations?.[args.directorId];
    const placeholder = conversation?.messages.at(-1);

    assert.ok(conversation);
    assert.equal(conversation?.focusMode, args.expectedFocusMode);
    assert.equal(placeholder?.status, "working");
    assert.equal(placeholder?.content, "");
    assert.match(harness.prompts[0] ?? "", args.promptPattern);
  };

  await assertDmTurn({
    directorId: "creative-director",
    message: "Let's talk about the vibe, palette, and visual direction.",
    expectedFocusMode: "vibes",
    response: createDanPayload({
      response: "I’m leaning into that visual direction.",
      draftCoreDetails: null,
      draftChangeSummary: [],
      notesToAppend: [],
      rawMemoriesToAppend: null,
    }),
    promptPattern: /Focus hint: the user is discussing inspiration, mood, or attachments\./,
  });

  await assertDmTurn({
    directorId: "rd-director",
    message: "Break this into a V1 roadmap.",
    expectedFocusMode: "version-planning",
    response: {
      response: "Roadmap framed.",
      handoffTo: null,
      handoffReason: null,
      currentState: null,
      idealState: null,
      confirmationSuggested: false,
      versions: null,
    },
    promptPattern: /You are in Version Planning mode/,
  });

  await assertDmTurn({
    directorId: "validation-director",
    message: "Compare the current output against the intended goal.",
    expectedFocusMode: "compare",
    response: {
      response: "Comparison complete.",
      handoffTo: null,
      handoffReason: null,
      currentState: null,
      idealState: null,
      passed: null,
      improvementAreas: null,
      summary: null,
    },
    promptPattern: /You are in Compare mode/,
  });
});

test("Todd DM prompt receives the codebase map and confirmed concept memory without Dan's old flow language", async () => {
  const session = createSession();
  session.corePillars = createFlowPillars();
  session.currentCorePillars = createFlowPillars();
  const harness = createBackendHarness([
    { response: "Here is the roadmap framing.", feasibilityAssessments: [] },
  ]);
  harness.setStoredSession(session);

  await (harness.backend.directorChat as Function)({
    projectId: "project-1",
    directorId: "rd-director",
    message: "Map the current concept into a V1 roadmap.",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    focusMode: "research",
  });

  const prompt = harness.prompts[0] ?? "";
  assert.match(prompt, /Current codebase map:/);
  assert.match(prompt, /Project core details:/);
  assert.match(prompt, /Core pillars: Onboarding, Workspace/);
  assert.doesNotMatch(prompt, /Confirmed main timeline:/);
  assert.doesNotMatch(prompt, /Confirmed branch references:/);
  assert.doesNotMatch(prompt, /Current-state main timeline:/);
});

test("Ping routed Slack updates force direct execution instead of review planning", async () => {
  const session = createSession();
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

  const harness = createBackendHarness([]);
  harness.setStoredSession(session);

  let capturedPlanningMode: string | null = null;
  harness.backend.agentExecuteUpdateNow = async (_input: unknown, options?: { planningMode?: string }) => {
    capturedPlanningMode = options?.planningMode ?? null;
    return { started: true };
  };

  await (harness.backend.routeUpdateToProgrammingNow as Function)({
    projectId: "project-1",
    updateId: "update-1",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
  });

  assert.equal(capturedPlanningMode, "none");
  assert.equal(session.pingMemory.activeUpdateId, "update-1");
  assert.equal(session.pingTaskContext?.currentTask, "Ship Ping update: Apply the latest update in Slack.");
  assert.equal(session.pingMemory.activeTask, "Ship Ping update: Apply the latest update in Slack.");
  assert.equal(session.pingMemory.context, "Apply the latest update in Slack.");
  assert.equal(session.toddMemory.futureUpdatePlan[0]?.status, "in_progress");
  assert.equal(session.versionUpdates[0]?.status, "in_progress");
});

test("Ping Slack intro, response, and outro bubbles all carry translation metadata", async () => {
  const session = createSession();
  session.slackMessages.push({
    id: "user-1",
    role: "user",
    directorId: null,
    content: "Ping, apply the update.",
    createdAt: NOW,
  });

  const harness = createBackendHarness([
    {
      response: "已完成。修改已保存。",
      handoffTo: null,
      handoffReason: null,
      currentState: null,
      idealState: null,
      status: "success",
      zhResponse: "已完成。修改已保存。",
      enTranslation: "Done. Changes saved.",
      rawReport: {
        summary: "Saved the update.",
        changedFiles: ["src/app.ts"],
        blocker: null,
        unexpectedNotes: [],
      },
    },
  ]);

  harness.backend.stageSlackDirectorIntroSequence = async (currentSession: AgentSession, _projectId: string, directorId: "programming-director") => {
    const introText = getDirectorMetadata(directorId).introMessage;
    const introMessage = {
      id: `intro-${directorId}-${currentSession.slackMessages.length}`,
      role: "assistant" as const,
      directorId,
      content: introText,
      createdAt: NOW,
      status: "complete" as const,
      metadata: buildPingLifecycleTranslationMetadata("intro", introText),
    };
    const responsePlaceholder = {
      id: `response-${directorId}-${currentSession.slackMessages.length + 1}`,
      role: "assistant" as const,
      directorId,
      content: "",
      createdAt: NOW,
      status: "working" as const,
      metadata: null,
    };
    currentSession.slackMessages.push(introMessage, responsePlaceholder);
    return responsePlaceholder;
  };

  await (harness.backend.runSlackDirectorTurn as Function)({
    session,
    project: harness.project,
    settings: harness.settings,
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    directorId: "programming-director",
    userMessage: "Ping, apply the update.",
    mode: "codebase-analysis",
  });

  const introMetadata = session.slackMessages[1]?.metadata as { type?: string; kind?: string; phase?: string } | null;
  const responseMetadata = session.slackMessages[2]?.metadata as { type?: string; kind?: string; status?: string } | null;
  const outroMetadata = session.slackMessages[3]?.metadata as { type?: string; kind?: string; phase?: string } | null;

  assert.equal(session.slackMessages.length, 4);
  assert.equal(introMetadata?.type, "ping-translation");
  assert.equal(introMetadata?.kind, "lifecycle");
  assert.equal(introMetadata?.phase, "intro");
  assert.equal(responseMetadata?.type, "ping-translation");
  assert.equal(responseMetadata?.kind, "status");
  assert.equal(responseMetadata?.status, "success");
  assert.equal(outroMetadata?.type, "ping-translation");
  assert.equal(outroMetadata?.kind, "lifecycle");
  assert.equal(outroMetadata?.phase, "outro");
  assert.equal(session.slackMessages[1]?.content, "I'll look at the implementation...");
  assert.equal(session.slackMessages[2]?.content, "已完成。修改已保存。");
  assert.equal(session.slackMessages[3]?.content, "I’m stepping back out of the code thread.");
});
