import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AgentSession } from "../src/shared/types.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const loadAgentAlertStateModule = async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "programs-agent-alert-state-"));
  const sharedTypesUrl = pathToFileURL(path.join(projectRoot, "src/shared/types.ts")).href;
  const modules = [
    "agent-alert-state.ts",
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

    const modulePath = path.join(tempDir, "agent-alert-state.ts");
    const sessionHelpersPath = path.join(tempDir, "session-helpers.ts");
    assert.ok(existsSync(modulePath), "Agent alert state shim was not created.");
    assert.ok(existsSync(sessionHelpersPath), "Session helpers shim was not created.");
    return {
      agentAlertState: await import(pathToFileURL(modulePath).href),
      sessionHelpers: await import(pathToFileURL(sessionHelpersPath).href),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const {
  agentAlertState: {
    getNextPendingProgrammingUpdate,
    getToddMemoryProcessingFocusMode,
    resolveAgentAlertState,
  },
  sessionHelpers: {
    findLivePendingApproval,
    getLivePendingApprovals,
  },
} = await loadAgentAlertStateModule();

const createSession = (): AgentSession => ({
  danMemory: {
    confirmedConcept: null,
    notes: [],
    toddHandoffNotes: [],
    draftConcept: null,
    derivedConcept: null,
    derivedNotes: [],
    derivedUpdatedAt: null,
  },
  toddMemory: {
    confirmedConcept: null,
    pendingHandoff: null,
    currentState: null,
    endStateGoal: null,
    successChain: [],
    nextUpdate: null,
    futureUpdatePlan: [],
    previousUpdateLog: [],
    troubleLog: [],
    codebaseIndexedMap: null,
    notes: [],
    backupNotes: [],
  },
  pingMemory: {
    activeUpdateId: null,
    activeTask: null,
    context: null,
    codebaseMapSummary: null,
    latestRawReport: null,
    latestJeffReport: null,
    currentRun: null,
  },
  versions: [],
  pendingApprovals: [],
}) as AgentSession;

test("live approval helpers hide legacy later approvals", () => {
  const session = createSession();
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

  assert.deepEqual(getLivePendingApprovals(session).map((approval) => approval.id), ["approval-pending"]);
  assert.equal(findLivePendingApproval(session, "approval-pending")?.id, "approval-pending");
  assert.equal(findLivePendingApproval(session, "approval-later"), null);
});

test("legacy later structural replans do not keep blocking Ping", () => {
  const session = createSession();
  session.toddMemory.futureUpdatePlan = [
    {
      id: "update-1",
      versionId: "version-1",
      title: "Next update",
      description: "Do this first.",
      order: 0,
      status: "pending",
      dependencies: [],
      pillarIds: [],
      skillsNeeded: [],
    },
  ];
  session.pendingApprovals = [
    {
      id: "approval-1",
      kind: "store-data",
      status: "later",
      requestedByDirectorId: "rd-director",
      targetDirectorId: "rd-director",
      summary: "Confirm structural replan",
      draftMessage: "Todd recommends simplifying before the next expansion.",
      draftPayload: {
        action: "applyStoredData",
        dataType: "versionUpdates",
        planSource: "post-run-structural-check",
        supersedesConfirmedPlan: true,
        updates: [],
      },
      createdAt: "2026-03-25T10:15:00.000Z",
      updatedAt: "2026-03-25T10:15:00.000Z",
    },
  ];

  assert.equal(getNextPendingProgrammingUpdate(session)?.id, "update-1");
  assert.deepEqual(resolveAgentAlertState("programming-director", session), {
    tone: "white",
    warningTargetDirectorId: null,
    action: "run-ping-update",
  });
});

test("Dan alert appears when Dan still has actionable soft memory", () => {
  const session = createSession();
  session.danMemory.notes.push("Capture the onboarding tone.");

  assert.deepEqual(resolveAgentAlertState("creative-director", session), {
    tone: "white",
    warningTargetDirectorId: null,
    action: "review-dan-memory",
  });
});

test("Todd alert is always visible with white tone when no Dan handoff is pending", () => {
  const session = createSession();

  assert.deepEqual(resolveAgentAlertState("rd-director", session), {
    tone: "white",
    warningTargetDirectorId: null,
    action: "regenerate-todd-plan",
  });
});

test("Todd alert turns red when Dan still has actionable memory upstream", () => {
  const session = createSession();
  session.danMemory.notes.push("Dan still has notes to process.");
  session.toddMemory.pendingHandoff = {
    summary: "Dan handed off the concept.",
    rawInputs: ["Keep onboarding calm."],
    context: "Creative session handoff",
    receivedAt: "2026-03-25T10:00:00.000Z",
  };

  assert.deepEqual(resolveAgentAlertState("rd-director", session), {
    tone: "red",
    warningTargetDirectorId: "creative-director",
    action: "regenerate-todd-plan",
  });
});

test("Ping alert is white when Todd has a pending update and no upstream memory to process", () => {
  const session = createSession();
  session.toddMemory.futureUpdatePlan = [
    {
      id: "update-1",
      versionId: "version-1",
      title: "Implement onboarding update",
      description: "Apply Todd's approved update.",
      order: 0,
      status: "pending",
      dependencies: [],
      pillarIds: [],
      skillsNeeded: [],
    },
  ];

  assert.deepEqual(resolveAgentAlertState("programming-director", session), {
    tone: "white",
    warningTargetDirectorId: null,
    action: "run-ping-update",
  });
});

test("Ping alert turns red when Todd still has memory to process before execution", () => {
  const session = createSession();
  session.toddMemory.pendingHandoff = {
    summary: "Todd still needs to process Dan's handoff.",
    rawInputs: ["Refine the roadmap first."],
    context: "Creative session handoff",
    receivedAt: "2026-03-25T10:05:00.000Z",
  };
  session.toddMemory.futureUpdatePlan = [
    {
      id: "update-1",
      versionId: "version-1",
      title: "Implement onboarding update",
      description: "Apply Todd's approved update.",
      order: 0,
      status: "pending",
      dependencies: [],
      pillarIds: [],
      skillsNeeded: [],
    },
  ];

  assert.deepEqual(resolveAgentAlertState("programming-director", session), {
    tone: "red",
    warningTargetDirectorId: "rd-director",
    action: "run-ping-update",
  });
});

test("Jeff alert becomes the refresh owner when Todd's project knowledge is stale", () => {
  const session = createSession();
  session.knowledgeStatus = "stale";
  session.knowledgeReasons = ["Todd's fingerprint is stale."];

  assert.deepEqual(resolveAgentAlertState("project-manager", session), {
    tone: "white",
    warningTargetDirectorId: null,
    action: "refresh-project",
  });
});

test("Jeff alert turns red for Todd-recommended failure reports that still need review", () => {
  const session = createSession();
  session.jeffMemory = {
    pendingReports: [
      {
        id: "report-1",
        updateId: "update-1",
        historyUpdateId: null,
        commitSha: null,
        title: "Ship onboarding update",
        summary: "Todd recommends treating this update as a failure.",
        outcome: "The implementation blocked on a missing dependency.",
        toddRecommendedDecision: "failure",
        toddFollowUpNeeded: true,
        toddFollowUpReason: "Todd wants Jeff to review the blocked outcome.",
        toddReplanNeeded: false,
        toddReplanReason: null,
        toddReplanApprovalId: null,
        rawReport: {
          status: "blocked",
          updateId: "update-1",
          goal: "Ship onboarding update",
          summary: "Ping was blocked before completion.",
          zhResponse: "",
          enTranslation: "",
          changedFiles: [],
          blocker: "Missing dependency",
          unexpectedNotes: [],
          createdAt: "2026-03-25T10:10:00.000Z",
        },
        decision: null,
        pingReport: null,
        validationReport: null,
        revertAvailable: false,
        revertHistoryUpdateId: null,
        revertCommitSha: null,
        createdAt: "2026-03-25T10:10:00.000Z",
      },
    ],
    pendingValidations: [],
    outcomeLog: [],
    notes: [],
    backupNotes: [],
  };

  assert.deepEqual(resolveAgentAlertState("project-manager", session), {
    tone: "red",
    warningTargetDirectorId: null,
    action: "review-jeff-work",
  });
});

test("next programming update chooses the first pending Todd update by order", () => {
  const session = createSession();
  session.toddMemory.futureUpdatePlan = [
    {
      id: "update-2",
      versionId: "version-1",
      title: "Later update",
      description: "Do this second.",
      order: 2,
      status: "pending",
      dependencies: [],
      pillarIds: [],
      skillsNeeded: [],
    },
    {
      id: "update-1",
      versionId: "version-1",
      title: "Next update",
      description: "Do this first.",
      order: 1,
      status: "pending",
      dependencies: [],
      pillarIds: [],
      skillsNeeded: [],
    },
    {
      id: "update-0",
      versionId: "version-1",
      title: "Already running",
      description: "Ignore this one.",
      order: 0,
      status: "in_progress",
      dependencies: [],
      pillarIds: [],
      skillsNeeded: [],
    },
  ];

  assert.equal(getNextPendingProgrammingUpdate(session)?.id, "update-1");
});

test("superseding Todd structural replan blocks the next pending programming update", () => {
  const session = createSession();
  session.toddMemory.futureUpdatePlan = [
    {
      id: "update-1",
      versionId: "version-1",
      title: "Next update",
      description: "Do this first.",
      order: 0,
      status: "pending",
      dependencies: [],
      pillarIds: [],
      skillsNeeded: [],
    },
  ];
  session.pendingApprovals = [
    {
      id: "approval-1",
      kind: "store-data",
      status: "pending",
      requestedByDirectorId: "rd-director",
      targetDirectorId: "rd-director",
      summary: "Confirm structural replan",
      draftMessage: "Todd recommends simplifying before the next expansion.",
      draftPayload: {
        action: "applyStoredData",
        dataType: "versionUpdates",
        planSource: "post-run-structural-check",
        supersedesConfirmedPlan: true,
        updates: [],
      },
      createdAt: "2026-03-25T10:15:00.000Z",
      updatedAt: "2026-03-25T10:15:00.000Z",
    },
  ];

  assert.equal(getNextPendingProgrammingUpdate(session), null);
  assert.equal(resolveAgentAlertState("programming-director", session), null);
});

test("Todd memory-processing focus always returns update-planning", () => {
  const session = createSession();
  assert.equal(getToddMemoryProcessingFocusMode(session), "update-planning");

  session.toddMemory.successChain = [
    { id: "step-1", title: "First step", description: "Do the first thing.", order: 0, satisfied: false, satisfiedAt: null },
  ];

  assert.equal(getToddMemoryProcessingFocusMode(session), "update-planning");
});
