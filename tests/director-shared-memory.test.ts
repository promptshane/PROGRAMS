import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AgentSession } from "../src/shared/types.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const loadSessionHelpersModule = async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "programs-session-helpers-"));
  const sharedTypesUrl = pathToFileURL(path.join(projectRoot, "src/shared/types.ts")).href;
  const directorMetadataUrl = pathToFileURL(path.join(projectRoot, "src/shared/director-metadata.ts")).href;
  const modules = [
    "session-helpers.ts",
    "formatting.ts",
    "constants.ts",
  ] as const;

  try {
    for (const fileName of modules) {
      const sourcePath = path.join(projectRoot, "src/renderer/src/lib", fileName);
      let source = await readFile(sourcePath, "utf8");
      source = source.replaceAll('from "@shared/types"', `from ${JSON.stringify(sharedTypesUrl)}`);
      source = source.replaceAll('from "@shared/director-metadata"', `from ${JSON.stringify(directorMetadataUrl)}`);

      for (const dependency of modules) {
        const specifier = `./${dependency}`;
        if (source.includes(specifier)) {
          source = source.replaceAll(
            specifier,
            pathToFileURL(path.join(tempDir, dependency)).href,
          );
        }
      }

      await writeFile(path.join(tempDir, fileName), source, "utf8");
    }

    return await import(pathToFileURL(path.join(tempDir, "session-helpers.ts")).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const {
  buildDirectorSharedMemorySources,
  buildDirectorExportedMemoryTargets,
  buildDirectorReportStream,
  collectToddRoadmapReportHistory,
  collectToddResearchReportHistory,
  findLatestToddResearchMessage,
} = await loadSessionHelpersModule();

const createSession = (): AgentSession => ({
  danMemory: {
    softMemory: [],
    hardMemory: null,
    backupMemory: [],
    hardMemoryUpdatedAt: null,
    latestReportId: null,
    confirmedConcept: null,
    draftConcept: null,
    derivedConcept: null,
    notes: [],
    derivedNotes: [],
    sideNotes: [],
    draftChangeSummary: [],
    draftStatus: null,
    derivedUpdatedAt: null,
    fullExperienceDescription: null,
    archivedNotes: [],
    deletedNotes: [],
    rawMemories: [],
    forgottenMemories: [],
    creativeHistory: [],
    toddHandoffNotes: [],
    threads: [],
  },
  toddMemory: {
    softMemory: [],
    hardMemory: null,
    backupMemory: [],
    hardMemoryUpdatedAt: null,
    latestReportId: null,
    confirmedConcept: null,
    roadmap: null,
    currentState: null,
    endStateGoal: null,
    successChain: [],
    nextUpdate: null,
    futureUpdatePlan: [],
    previousUpdateLog: [],
    troubleLog: [],
    codebaseIndexedMap: null,
    notes: [],
    pendingHandoff: null,
    backupNotes: [],
  },
  pingMemory: {
    activeUpdateId: null,
    activeTask: null,
    context: null,
    codebaseMapSummary: null,
    latestPlanReport: null,
    latestIndexedMap: null,
    latestRawReport: null,
    latestJeffReport: null,
    currentRun: null,
  },
  jeffMemory: {
    softMemory: [],
    hardMemory: null,
    backupMemory: [],
    hardMemoryUpdatedAt: null,
    latestReportId: null,
    pendingReports: [],
    pendingValidations: [],
    outcomeLog: [],
    managerSummary: null,
    projectStatusHistory: [],
    currentProjectStatus: null,
    notes: [],
    backupNotes: [],
  },
  pongMemory: {
    jeffInstruction: null,
    validationRequest: null,
    previousValidationReports: [],
    latestValidationReport: null,
    screenshotPaths: [],
  },
  stages: {
    function: { messages: [], confirmed: null },
    thesis: { messages: [], confirmed: null },
    core_pillars: { messages: [], confirmed: null },
    full_flow: { messages: [], confirmed: null },
    iterations: { messages: [], confirmed: null },
    execution: { messages: [], confirmed: null },
  },
  corePillars: [],
  currentCorePillars: [],
  validationResults: [],
  validationFrequency: "manual",
  directorConversations: {},
  versions: [],
  versionUpdates: [],
  feasibilityAssessments: [],
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
  slackMessages: [],
  slackActiveDirectorId: "project-manager",
  slackPresenceGuestId: null,
  pendingApprovals: [],
  directorSettingsOverrides: {},
  automation: {
    status: "idle",
    selectedTargetUpdateId: null,
    selectedTargetVersionId: null,
    inScopeUpdateIds: [],
    constraints: {
      allowedHours: null,
      codexMaxUsedPercent: null,
      claudeMaxUsedPercent: null,
    },
    stopReason: null,
    stopSummary: null,
    currentStep: "idle",
    startedAt: null,
    lastResumedAt: null,
    updatedAt: null,
    completedAt: null,
    resumeRequired: false,
    nextUpdateId: null,
    lastSuccessfulUpdateId: null,
    lastSuccessfulHistoryUpdateId: null,
    pendingRevertReportId: null,
    pendingRevertHistoryUpdateId: null,
    pendingRevertCommitSha: null,
  },
}) as AgentSession;

test("Dan has no shared memory sources", () => {
  const session = createSession();
  assert.deepEqual(buildDirectorSharedMemorySources("creative-director", session), []);
});

test("Todd only gets Dan's core-details", () => {
  const session = createSession();
  session.danMemory.confirmedConcept = {
    function: null,
    thesis: null,
    corePillars: [],
    fullFlow: null,
    threads: [],
  } as AgentSession["danMemory"]["confirmedConcept"];

  assert.deepEqual(buildDirectorSharedMemorySources("rd-director", session), [
    {
      kind: "dan-core-details",
      directorId: "creative-director",
      label: "Dan",
      bodyTitle: "Dan's Core-details",
    },
  ]);
});

test("per-agent report stream stays formal-only and filters by agent ownership", () => {
  const session = createSession();
  session.slackMessages = [
    {
      id: "todd-report",
      role: "assistant",
      directorId: "rd-director",
      content: "Todd hard-memory report",
      createdAt: "2026-04-09T12:00:00.000Z",
      metadata: {
        type: "hard-memory-report",
        dataType: "toddRoadmap",
        directorId: "rd-director",
        approvalId: null,
        reportStage: "hard",
        summary: "Todd updated the roadmap.",
        currentState: "Current state",
        idealState: "End state",
        changeSummary: [],
        draftCoreDetails: null,
        roadmap: null,
        roadmapVersions: null,
        versionUpdates: null,
        createdAt: "2026-04-09T12:00:00.000Z",
      },
    },
    {
      id: "ping-report",
      role: "assistant",
      directorId: "programming-director",
      content: "Ping update report",
      createdAt: "2026-04-09T12:05:00.000Z",
      metadata: {
        type: "ping-update-report",
        rawReport: {
          status: "success",
          updateId: "update-1",
          goal: "Ship shell",
          summary: "Ping shipped the shell.",
          zhResponse: "已完成。",
          enTranslation: "Done.",
          changedFiles: ["src/shell.tsx"],
          blocker: null,
          unexpectedNotes: [],
          createdAt: "2026-04-09T12:05:00.000Z",
        },
        report: null,
      },
    },
    {
      id: "plain-chat",
      role: "assistant",
      directorId: "rd-director",
      content: "Plain Todd chat with no formal report metadata",
      createdAt: "2026-04-09T12:06:00.000Z",
      metadata: null,
    },
  ] as AgentSession["slackMessages"];

  assert.deepEqual(
    buildDirectorReportStream("rd-director", session).map((report) => report.id),
    ["todd-report"],
  );
  assert.deepEqual(
    buildDirectorReportStream("programming-director", session).map((report) => report.id),
    ["ping-report"],
  );
});

test("Ping gets Todd update context and Jeff's latest report", () => {
  const session = createSession();
  session.toddMemory.futureUpdatePlan = [{ id: "update-1" } as AgentSession["toddMemory"]["futureUpdatePlan"][number]];
  session.pingTaskContext = {
    currentTask: "Implement the next update",
    lastResult: null,
    lastFailureReason: null,
    toddUpdateExplanation: "Apply the planned change.",
    relevantPillarIds: [],
  };
  session.pingMemory.activeTask = "Implement the next update";
  session.pingMemory.context = "Apply the planned change.";
  session.pingMemory.latestJeffReport = { id: "report-1" } as AgentSession["pingMemory"]["latestJeffReport"];

  assert.deepEqual(
    buildDirectorSharedMemorySources("programming-director", session),
    [
      {
        kind: "todd-update-context",
        directorId: "rd-director",
        label: "Todd",
        bodyTitle: "Todd's Update Context",
      },
      {
        kind: "jeff-latest-report",
        directorId: "project-manager",
        label: "Jeff",
        bodyTitle: "Jeff's Latest Report",
      },
    ],
  );
});

test("Pong gets validation request and history", () => {
  const session = createSession();
  session.pongTaskContext = {
    currentTask: "Validate the latest pass",
    lastResult: null,
    lastFailureReason: null,
    toddUpdateExplanation: "Check the latest pass.",
    relevantPillarIds: [],
  };
  session.pongMemory.validationRequest = {
    id: "validation-1",
    instruction: "Check the latest pass.",
    updateId: "update-1",
    relevantPillarIds: [],
    sourceRefs: [],
    createdAt: "2026-04-08T00:00:00.000Z",
  } as AgentSession["pongMemory"]["validationRequest"];
  session.pongMemory.previousValidationReports = [
    {
      id: "validation-report-1",
      updateId: "update-1",
      historyUpdateId: null,
      summary: "Looks good",
      passed: true,
      details: null,
      screenshotPaths: [],
      createdAt: "2026-04-08T00:00:00.000Z",
    } as AgentSession["pongMemory"]["previousValidationReports"][number],
  ];
  session.validationResults = [
    {
      id: "validation-result-1",
      updateId: "update-1",
      validationType: "functional",
      passed: true,
      summary: "Looks good",
      details: "",
      screenshotPaths: [],
      createdAt: "2026-04-08T00:00:00.000Z",
    } as AgentSession["validationResults"][number],
  ];

  assert.deepEqual(
    buildDirectorSharedMemorySources("validation-director", session),
    [
      {
        kind: "todd-validation-request",
        directorId: "rd-director",
        label: "Todd",
        bodyTitle: "Todd's Validation Request",
      },
      {
        kind: "pong-validation-history",
        directorId: "validation-director",
        label: "Pong",
        bodyTitle: "Pong's Validation History",
      },
    ],
  );
});

test("Jeff gets the full shared memory stack", () => {
  const session = createSession();
  session.danMemory.confirmedConcept = {
    function: null,
    thesis: null,
    corePillars: [],
    fullFlow: null,
    threads: [],
  } as AgentSession["danMemory"]["confirmedConcept"];
  session.toddMemory.roadmap = {
    currentState: [],
    endState: [],
    pathway: [],
    priorityUpdate: null,
    generatedAt: "2026-04-08T00:00:00.000Z",
  } as AgentSession["toddMemory"]["roadmap"];
  session.jeffMemory.pendingReports = [{ id: "report-1" } as AgentSession["jeffMemory"]["pendingReports"][number]];
  session.pongMemory.previousValidationReports = [
    {
      id: "validation-report-1",
      updateId: "update-1",
      historyUpdateId: null,
      summary: "Looks good",
      passed: true,
      details: null,
      screenshotPaths: [],
      createdAt: "2026-04-08T00:00:00.000Z",
    } as AgentSession["pongMemory"]["previousValidationReports"][number],
  ];

  assert.deepEqual(
    buildDirectorSharedMemorySources("project-manager", session),
    [
      {
        kind: "dan-core-details",
        directorId: "creative-director",
        label: "Dan",
        bodyTitle: "Dan's Core-details",
      },
      {
        kind: "todd-roadmap-and-updates",
        directorId: "rd-director",
        label: "Todd",
        bodyTitle: "Todd's Roadmap & Update Reports",
      },
      {
        kind: "ping-execution-reports",
        directorId: "programming-director",
        label: "Ping",
        bodyTitle: "Ping's Execution Reports",
      },
      {
        kind: "pong-validation-history",
        directorId: "validation-director",
        label: "Pong",
        bodyTitle: "Pong's Validation History",
      },
    ],
  );
});

test("Dan exported memory targets prefer Jeff and Todd in display order", () => {
  const session = createSession();
  session.danMemory.confirmedConcept = {
    function: null,
    thesis: null,
    corePillars: [],
    fullFlow: null,
    threads: [],
  } as AgentSession["danMemory"]["confirmedConcept"];

  const targets = buildDirectorExportedMemoryTargets("creative-director", session);

  assert.deepEqual(targets.map((target) => target.directorId), ["project-manager", "rd-director"]);
  assert.deepEqual(targets.map((target) => target.label), ["Jeff", "Todd"]);
});

test("Jeff exported memory targets keep the expected director order", () => {
  const session = createSession();
  session.pingMemory.latestJeffReport = { id: "report-1" } as AgentSession["pingMemory"]["latestJeffReport"];

  const targets = buildDirectorExportedMemoryTargets("project-manager", session);

  assert.deepEqual(targets.map((target) => target.directorId), ["creative-director", "rd-director", "programming-director"]);
  assert.deepEqual(targets.map((target) => target.label), ["Dan", "Todd", "Ping"]);
});

test("Todd roadmap collector returns newest reports first, dedupes duplicates, and falls back on missing dates", () => {
  const session = createSession();
  session.slackMessages = [
    {
      id: "roadmap-duplicate",
      role: "assistant",
      directorId: "rd-director",
      content: "Older Todd roadmap",
      createdAt: "2026-04-09T10:00:00.000Z",
      metadata: {
        type: "hard-memory-report",
        dataType: "toddRoadmap",
        directorId: "rd-director",
        approvalId: null,
        reportStage: "hard",
        summary: "Older roadmap snapshot.",
        currentState: "Older current state.",
        idealState: null,
        changeSummary: [],
        draftCoreDetails: null,
        roadmap: null,
        roadmapVersions: null,
        versionUpdates: null,
        createdAt: "2026-04-09T10:00:00.000Z",
      },
    } as AgentSession["slackMessages"][number],
    {
      id: "roadmap-legacy",
      role: "assistant",
      directorId: "rd-director",
      content: "Legacy Todd roadmap",
      createdAt: "",
      metadata: {
        type: "hard-memory-report",
        dataType: "toddRoadmap",
        directorId: "rd-director",
        approvalId: null,
        reportStage: "hard",
        summary: "Legacy roadmap snapshot.",
        currentState: "Legacy current state.",
        idealState: null,
        changeSummary: [],
        draftCoreDetails: null,
        roadmap: null,
        roadmapVersions: null,
        versionUpdates: null,
        createdAt: "",
      },
    } as AgentSession["slackMessages"][number],
  ];
  session.unifiedMessages = [
    {
      id: "roadmap-newer",
      role: "assistant",
      content: "Newest Todd roadmap",
      createdAt: "2026-04-09T12:00:00.000Z",
      metadata: {
        type: "hard-memory-report",
        dataType: "toddRoadmap",
        directorId: "rd-director",
        approvalId: null,
        reportStage: "hard",
        summary: "Newest roadmap snapshot.",
        currentState: "Newest current state.",
        idealState: null,
        changeSummary: [],
        draftCoreDetails: null,
        roadmap: null,
        roadmapVersions: null,
        versionUpdates: null,
        createdAt: "2026-04-09T12:00:00.000Z",
      },
    } as AgentSession["unifiedMessages"][number],
    {
      id: "roadmap-duplicate",
      role: "assistant",
      content: "Duplicate Todd roadmap",
      createdAt: "2026-04-09T10:05:00.000Z",
      metadata: {
        type: "hard-memory-report",
        dataType: "toddRoadmap",
        directorId: "rd-director",
        approvalId: null,
        reportStage: "hard",
        summary: "Duplicate roadmap snapshot.",
        currentState: "Duplicate current state.",
        idealState: null,
        changeSummary: [],
        draftCoreDetails: null,
        roadmap: null,
        roadmapVersions: null,
        versionUpdates: null,
        createdAt: "2026-04-09T10:05:00.000Z",
      },
    } as AgentSession["unifiedMessages"][number],
  ];

  const history = collectToddRoadmapReportHistory(session);

  assert.deepEqual(history.map((entry) => entry.id), ["roadmap-newer", "roadmap-duplicate", "roadmap-legacy"]);
  assert.equal(history[1]?.message.metadata.currentState, "Older current state.");
  assert.equal(history[2]?.createdAtLabel, "Date unavailable");
});

test("Todd research collector returns newest reports first and dedupes duplicates", () => {
  const session = createSession();
  session.slackMessages = [
    {
      id: "research-older",
      role: "assistant",
      directorId: "rd-director",
      content: "Older Todd research",
      createdAt: "2026-04-09T09:00:00.000Z",
      metadata: {
        type: "research-result",
        researchPrompt: "Check the shell flow.",
        generalSummary: "Older general findings.",
        projectSummary: "Older project findings.",
      },
    } as AgentSession["slackMessages"][number],
  ];
  session.unifiedMessages = [
    {
      id: "research-newer",
      role: "assistant",
      content: "Newer Todd research",
      createdAt: "2026-04-09T12:30:00.000Z",
      metadata: {
        type: "research-result",
        researchPrompt: "Check the version plan.",
        generalSummary: "Newer general findings.",
        projectSummary: "Newer project findings.",
      },
    } as AgentSession["unifiedMessages"][number],
    {
      id: "research-older",
      role: "assistant",
      content: "Duplicate older Todd research",
      createdAt: "2026-04-09T09:05:00.000Z",
      metadata: {
        type: "research-result",
        researchPrompt: "Check the shell flow.",
        generalSummary: "Duplicate general findings.",
        projectSummary: "Duplicate project findings.",
      },
    } as AgentSession["unifiedMessages"][number],
  ];

  const history = collectToddResearchReportHistory(session);

  assert.deepEqual(history.map((entry) => entry.id), ["research-newer", "research-older"]);
  assert.equal(history[0]?.message.metadata.projectSummary, "Newer project findings.");
  assert.equal(history[1]?.message.metadata.researchPrompt, "Check the shell flow.");
});

test("Todd research selector returns the latest Todd research result", () => {
  const session = createSession();
  session.slackMessages = [
    {
      id: "older-research",
      role: "assistant",
      directorId: "rd-director",
      content: "Older Todd research",
      createdAt: "2026-04-09T12:00:00.000Z",
      metadata: {
        type: "research-result",
        researchPrompt: "Check the shell flow.",
        generalSummary: "Older general findings.",
        projectSummary: "Older project findings.",
      },
    } as AgentSession["slackMessages"][number],
    {
      id: "non-research",
      role: "assistant",
      directorId: "rd-director",
      content: "Plain Todd chat",
      createdAt: "2026-04-09T12:20:00.000Z",
      metadata: null,
    } as AgentSession["slackMessages"][number],
  ];
  session.unifiedMessages = [
    {
      id: "newer-research",
      role: "assistant",
      directorId: "rd-director",
      content: "Newer Todd research",
      createdAt: "2026-04-09T12:10:00.000Z",
      metadata: {
        type: "research-result",
        researchPrompt: "Check the version plan.",
        generalSummary: "Newer general findings.",
        projectSummary: "Newer project findings.",
      },
    } as AgentSession["unifiedMessages"][number],
  ];

  const latest = findLatestToddResearchMessage(session);

  assert.equal(latest?.id, "newer-research");
  assert.equal(latest?.metadata.researchPrompt, "Check the version plan.");
  assert.equal(latest?.metadata.projectSummary, "Newer project findings.");
});
