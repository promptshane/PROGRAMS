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
