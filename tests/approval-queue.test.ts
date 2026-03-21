import assert from "node:assert/strict";
import test from "node:test";
import {
  createPendingApproval,
  ensurePendingApprovalQueue,
  getPendingApproval,
  removePendingApproval,
  updatePendingApproval,
} from "../src/main/utils/approval-queue.ts";
import type { AgentSession } from "../src/shared/types.ts";

const createSession = (): AgentSession => {
  const now = "2026-03-19T12:00:00.000Z";
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
    createdAt: now,
    updatedAt: now,
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
    bradTaskContext: null,
    projectCategory: "general-project",
    dynamicSubAgents: [],
    slackMessages: [],
    slackActiveDirectorId: "project-manager",
    slackPresenceGuestId: null,
    pendingApprovals: [],
    directorSettingsOverrides: {},
    directorStateMap: {},
    agentConversations: {},
    activeAgentId: null,
  };
};

test("approval queue initializes and stores normalized approvals", () => {
  const session = createSession();

  assert.deepEqual(ensurePendingApprovalQueue(session), []);

  const approval = createPendingApproval(session, {
    kind: "handoff",
    requestedByDirectorId: "project-manager",
    targetDirectorId: "rd-director",
    summary: "   ",
    draftMessage: "Please ask Todd to research this.",
    draftPayload: { action: "runSlackDirector" },
  });

  assert.equal(session.pendingApprovals.length, 1);
  assert.equal(approval.summary, "Pending approval");
  assert.equal(getPendingApproval(session, approval.id)?.targetDirectorId, "rd-director");
});

test("approval queue updates summaries, targets, payloads, and status", () => {
  const session = createSession();
  const approval = createPendingApproval(session, {
    kind: "validation",
    requestedByDirectorId: "validation-director",
    targetDirectorId: "validation-director",
    summary: "Run validation",
  });

  const updated = updatePendingApproval(session, approval.id, {
    summary: " Confirm visual validation ",
    draftMessage: "Review the latest build before testing.",
    draftPayload: { action: "runValidation", validationType: "visual" },
    targetDirectorId: "programming-director",
    status: "later",
  });

  assert.ok(updated);
  assert.equal(updated?.summary, "Confirm visual validation");
  assert.equal(updated?.draftMessage, "Review the latest build before testing.");
  assert.deepEqual(updated?.draftPayload, { action: "runValidation", validationType: "visual" });
  assert.equal(updated?.targetDirectorId, "programming-director");
  assert.equal(updated?.status, "later");
  assert.equal(typeof updated?.updatedAt, "string");
});

test("approval queue removes approvals cleanly", () => {
  const session = createSession();
  const approval = createPendingApproval(session, {
    kind: "codebase-scan",
    requestedByDirectorId: null,
    targetDirectorId: "rd-director",
    summary: "Scan the repo",
  });

  const removed = removePendingApproval(session, approval.id);

  assert.equal(removed?.id, approval.id);
  assert.equal(session.pendingApprovals.length, 0);
  assert.equal(getPendingApproval(session, approval.id), null);
});
