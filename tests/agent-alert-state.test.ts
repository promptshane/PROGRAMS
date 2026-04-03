import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSession } from "../src/shared/types.ts";
import {
  getNextPendingProgrammingUpdate,
  getToddMemoryProcessingFocusMode,
  resolveAgentAlertState,
} from "../src/renderer/src/lib/agent-alert-state.ts";

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
    futureUpdatePlan: [],
    versionPlan: {
      v1: null,
      v2: null,
      v3: null,
    },
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
}) as AgentSession;

test("Dan alert appears when Dan still has actionable soft memory", () => {
  const session = createSession();
  session.danMemory.notes.push("Capture the onboarding tone.");

  assert.deepEqual(resolveAgentAlertState("creative-director", session), {
    tone: "white",
    warningTargetDirectorId: null,
    action: "review-dan-memory",
  });
});

test("Todd alert stays hidden until a Dan handoff is waiting", () => {
  const session = createSession();

  assert.equal(resolveAgentAlertState("rd-director", session), null);
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
    action: "review-todd-memory",
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

test("Todd memory-processing focus switches from version planning to update planning once a roadmap exists", () => {
  const session = createSession();
  assert.equal(getToddMemoryProcessingFocusMode(session), "version-planning");

  session.toddMemory.versionPlan.v1 = {
    id: "version-1",
    label: "V1",
    description: "Ship the initial version.",
    goals: ["Land the core flow."],
    status: "confirmed",
    order: 0,
  };

  assert.equal(getToddMemoryProcessingFocusMode(session), "update-planning");
});
