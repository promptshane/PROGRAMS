import assert from "node:assert/strict";
import test from "node:test";
import type { CorePillar, ToddMemory } from "../src/shared/types.ts";
import {
  buildToddHardMemoryViewModel,
  getToddHardMemoryIncompleteSectionKeys,
} from "../src/renderer/src/lib/todd-hard-memory.ts";

const createCorePillar = (id: string, name: string): CorePillar => ({
  id,
  name,
  pillarType: "core",
  status: "canonical",
  function: null,
  thesis: null,
  corePillars: [],
  fullFlow: null,
  description: null,
  connectedPillarIds: [],
  assumptionText: null,
  assumptionSource: null,
  order: 0,
  threadMemberships: [],
  endState: null,
});

const createToddMemory = (overrides: Partial<ToddMemory> = {}): ToddMemory => ({
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
  ...overrides,
});

const createNextUpdate = (overrides: Partial<NonNullable<ToddMemory["nextUpdate"]>> = {}): NonNullable<ToddMemory["nextUpdate"]> => ({
  id: "next-update",
  title: "Priority update",
  description: "Execute the priority update.",
  pillarIds: [],
  currentStateContext: null,
  successDefinition: null,
  partialSuccessDefinition: null,
  partialFailureDefinition: null,
  failureDefinition: null,
  updateKind: "expand",
  simplificationMode: null,
  structuralReason: null,
  supportsNextStep: null,
  skillsNeeded: [],
  dependencies: [],
  ...overrides,
});

test("live Todd planning fields override roadmap summaries and priority preview", () => {
  const pillars = [createCorePillar("pillar-shell", "Shell")];
  const toddMemory = createToddMemory({
    roadmap: {
      currentState: [{
        id: "road-current",
        title: "Roadmap Current",
        description: "Roadmap-only current state.",
        pillarIds: ["pillar-shell"],
        itemStatus: "tbd",
        detailLines: [],
        sourceRefs: [],
      }],
      endState: [{
        id: "road-end",
        title: "Roadmap End",
        description: "Roadmap-only end state.",
        pillarIds: ["pillar-shell"],
        detailLines: [],
        sourceRefs: [],
      }],
      pathway: [{
        id: "road-path",
        title: "Roadmap Step",
        description: "Roadmap-only path step.",
        pillarIds: ["pillar-shell"],
        updateKind: "create",
        order: 0,
        detailLines: [],
        sourceRefs: [],
      }],
      priorityUpdate: {
        id: "road-priority",
        title: "Roadmap Priority",
        description: "Roadmap-only priority update.",
        pillarIds: ["pillar-shell"],
        updateKind: "create",
        currentStateContext: "Roadmap context",
        successDefinition: null,
        partialSuccessDefinition: null,
        partialFailureDefinition: null,
        failureDefinition: null,
        sourceRefs: [],
      },
      generatedAt: "2026-04-09T12:00:00.000Z",
    },
    currentState: "Live current-state summary.",
    endStateGoal: "Live end-state summary.",
    successChain: [{
      id: "live-step",
      title: "Live Step",
      description: "Live success-chain step.",
      order: 0,
      satisfied: false,
      satisfiedAt: null,
    }],
    nextUpdate: createNextUpdate({
      id: "live-priority",
      title: "Live Priority",
      description: "Live priority description.",
      pillarIds: ["pillar-shell"],
      currentStateContext: "The shell is present but the next expansion needs a cleaner edge.",
      successDefinition: "The shell expansion lands without breaking the existing entry path.",
      partialSuccessDefinition: "The shell expands but one non-critical edge still needs cleanup.",
      partialFailureDefinition: "The shell grows but regresses an existing flow.",
      failureDefinition: "The shell expansion breaks the current onboarding entry path.",
      updateKind: "expand",
      simplificationMode: "inline",
      structuralReason: "Local cleanup first.",
      supportsNextStep: "Unblocks the next shell pass.",
      skillsNeeded: ["react"],
      dependencies: ["base-shell"],
    }),
    futureUpdatePlan: [
      {
        id: "live-priority",
        versionId: null,
        title: "Live Priority",
        description: "Live priority description.",
        order: 0,
        status: "pending",
        dependencies: ["base-shell"],
        pillarIds: ["pillar-shell"],
        skillsNeeded: ["react"],
        updateKind: "expand",
        simplificationMode: "inline",
        structuralReason: "Local cleanup first.",
        supportsNextStep: "Unblocks the next shell pass.",
      },
      {
        id: "supporting-step",
        versionId: null,
        title: "Supporting Step",
        description: "Follow-on queued step.",
        order: 1,
        status: "in_progress",
        dependencies: [],
        pillarIds: [],
        skillsNeeded: [],
        updateKind: "refine",
        simplificationMode: null,
        structuralReason: null,
        supportsNextStep: null,
      },
    ],
  });

  const viewModel = buildToddHardMemoryViewModel(toddMemory, pillars);

  assert.equal(viewModel.currentState.summary, "Live current-state summary.");
  assert.equal(viewModel.endState.summary, "Live end-state summary.");
  assert.equal(viewModel.priorityUpdate?.source, "live");
  assert.equal(viewModel.priorityUpdate?.title, "Live Priority");
  assert.deepEqual(viewModel.priorityUpdate?.pillarNames, ["Shell"]);
  assert.equal(
    viewModel.priorityUpdate?.successDefinition,
    "The shell expansion lands without breaking the existing entry path.",
  );
  assert.deepEqual(viewModel.successChain.steps.map((step) => step.title), ["Live Step"]);
  assert.deepEqual(
    viewModel.successChain.supportingQueuedUpdates.map((update) => update.title),
    ["Supporting Step"],
  );
});

test("legacy flat Todd planning fields still populate the view model without roadmap data", () => {
  const toddMemory = createToddMemory({
    currentState: "Legacy current state.",
    endStateGoal: "Legacy end state.",
    successChain: [{
      id: "legacy-step",
      title: "Legacy Step",
      description: "Legacy chain step.",
      order: 0,
      satisfied: true,
      satisfiedAt: "2026-04-09T12:00:00.000Z",
    }],
    nextUpdate: createNextUpdate({
      id: "legacy-priority",
      title: "Legacy Priority",
      description: "Legacy next update.",
      updateKind: "refine",
    }),
  });

  const viewModel = buildToddHardMemoryViewModel(toddMemory, []);

  assert.equal(viewModel.currentState.summary, "Legacy current state.");
  assert.equal(viewModel.endState.summary, "Legacy end state.");
  assert.equal(viewModel.priorityUpdate?.source, "live");
  assert.equal(viewModel.priorityUpdate?.title, "Legacy Priority");
  assert.equal(viewModel.successChain.remainingCount, 0);
  assert.equal(viewModel.successChain.trackedCount, 1);
  assert.deepEqual(viewModel.successChain.steps, []);
});

test("roadmap data backfills summaries and success-chain details when flat fields are missing", () => {
  const pillars = [createCorePillar("pillar-roadmap", "Roadmap Pillar")];
  const toddMemory = createToddMemory({
    roadmap: {
      currentState: [{
        id: "road-current",
        title: "Indexed Shell",
        description: "Initial roadmap current state item.",
        pillarIds: ["pillar-roadmap"],
        itemStatus: "done",
        detailLines: [],
        sourceRefs: [],
      }],
      endState: [{
        id: "road-end",
        title: "Polished Shell",
        description: "Final roadmap state item.",
        pillarIds: ["pillar-roadmap"],
        detailLines: [],
        sourceRefs: [],
      }],
      pathway: [{
        id: "road-path",
        title: "Finish Shell",
        description: "Roadmap pathway step.",
        pillarIds: ["pillar-roadmap"],
        updateKind: "expand",
        order: 0,
        detailLines: [],
        sourceRefs: [],
      }],
      priorityUpdate: {
        id: "road-path",
        title: "Finish Shell",
        description: "Roadmap priority update.",
        pillarIds: ["pillar-roadmap"],
        updateKind: "expand",
        currentStateContext: "Roadmap current-state context.",
        successDefinition: null,
        partialSuccessDefinition: null,
        partialFailureDefinition: null,
        failureDefinition: null,
        sourceRefs: [],
      },
      generatedAt: "2026-04-09T12:00:00.000Z",
    },
  });

  const viewModel = buildToddHardMemoryViewModel(toddMemory, pillars);

  assert.equal(viewModel.currentState.summary, "Indexed Shell");
  assert.equal(viewModel.endState.summary, "Polished Shell");
  assert.equal(viewModel.priorityUpdate?.source, "roadmap");
  assert.equal(viewModel.priorityUpdate?.title, "Finish Shell");
  assert.deepEqual(viewModel.priorityUpdate?.pillarNames, ["Roadmap Pillar"]);
  assert.equal(viewModel.successChain.trackedCount, 1);
  assert.equal(viewModel.successChain.nextPendingTitle, "Finish Shell");
});

test("history, trouble counts, and incomplete sections are derived cleanly", () => {
  const emptyViewModel = buildToddHardMemoryViewModel(createToddMemory(), []);
  assert.equal(emptyViewModel.history.updateCount, 0);
  assert.equal(emptyViewModel.history.troubleCount, 0);
  assert.equal(emptyViewModel.history.latestGoal, null);
  assert.equal(emptyViewModel.currentState.summary, null);
  assert.deepEqual(
    getToddHardMemoryIncompleteSectionKeys(createToddMemory()),
    ["current-state", "success-chain", "end-state"],
  );

  const populatedViewModel = buildToddHardMemoryViewModel(createToddMemory({
    previousUpdateLog: [{
      id: "log-1",
      updateId: "update-1",
      goal: "Ship shell",
      outcome: "Shell landed cleanly.",
      status: "success",
      reportId: null,
      historyUpdateId: null,
      commitSha: null,
      createdAt: "2026-04-09T12:05:00.000Z",
    }],
    troubleLog: [{
      id: "trouble-1",
      title: "Shell regression",
      details: "One UI regression remains.",
      priority: "high",
      occurrences: 2,
      lastSeenAt: "2026-04-09T12:06:00.000Z",
      updateIds: ["update-1"],
    }],
  }), []);

  assert.equal(populatedViewModel.history.updateCount, 1);
  assert.equal(populatedViewModel.history.troubleCount, 1);
  assert.equal(populatedViewModel.history.latestGoal, "Ship shell");
  assert.equal(populatedViewModel.history.latestOutcome, "Shell landed cleanly.");
});

test("priority update stays incomplete when the live Ping handoff contract is missing outcome criteria", () => {
  const toddMemory = createToddMemory({
    currentState: "Current shell is in place.",
    endStateGoal: "Reach the polished shell.",
    successChain: [{
      id: "step-1",
      title: "Expand shell",
      description: "Expand the shell toward the polished state.",
      order: 0,
      satisfied: false,
      satisfiedAt: null,
    }],
    nextUpdate: createNextUpdate({
      id: "step-1",
      title: "Expand shell",
      description: "Expand the shell toward the polished state.",
      pillarIds: ["pillar-shell"],
    }),
  });

  const viewModel = buildToddHardMemoryViewModel(toddMemory, [createCorePillar("pillar-shell", "Shell")]);

  assert.equal(viewModel.sectionStatus["priority-update"].incomplete, true);
  assert.match(viewModel.sectionStatus["priority-update"].reason ?? "", /success definition/i);
  assert.deepEqual(getToddHardMemoryIncompleteSectionKeys(toddMemory), ["priority-update"]);
});
