import assert from "node:assert/strict";
import test from "node:test";
import type { AgentCoreDetails, AgentSession, HardMemoryReportMetadata } from "../src/shared/types.ts";
import { resolveDanHardMemoryReportDraft } from "../src/renderer/src/lib/hard-memory-report.ts";

const createDraft = (summary: string): AgentCoreDetails => ({
  function: { summary, status: "edited" },
  thesis: null,
  corePillars: [],
  fullFlow: null,
  threads: [],
});

const createSession = (): AgentSession => ({
  danMemory: {
    confirmedConcept: null,
    draftConcept: createDraft("Live draft from session"),
    derivedConcept: null,
    notes: [],
    derivedNotes: [],
    sideNotes: [],
    draftChangeSummary: [],
    draftStatus: "gathering",
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
  danDraftCoreDetails: createDraft("Legacy live draft alias"),
} as AgentSession);

test("soft Dan reports resolve against the live session draft when no snapshot is stored", () => {
  const report: HardMemoryReportMetadata = {
    type: "hard-memory-report",
    dataType: "danDraftCoreDetails",
    directorId: "creative-director",
    approvalId: null,
    reportStage: "soft",
    summary: "Soft report",
    currentState: null,
    idealState: "Ideal",
    changeSummary: ["Updated the draft."],
    draftCoreDetails: null,
    roadmapVersions: null,
    versionUpdates: null,
    createdAt: "2026-03-24T12:00:00.000Z",
  };

  assert.equal(
    resolveDanHardMemoryReportDraft(report, createSession())?.function?.summary,
    "Live draft from session",
  );
});

test("legacy Dan soft reports keep their stored snapshot when present", () => {
  const report: HardMemoryReportMetadata = {
    type: "hard-memory-report",
    dataType: "danDraftCoreDetails",
    directorId: "creative-director",
    approvalId: null,
    reportStage: "soft",
    summary: "Legacy soft report",
    currentState: null,
    idealState: "Ideal",
    changeSummary: ["Updated the draft."],
    draftCoreDetails: createDraft("Stored snapshot draft"),
    roadmapVersions: null,
    versionUpdates: null,
    createdAt: "2026-03-24T12:00:00.000Z",
  };

  assert.equal(
    resolveDanHardMemoryReportDraft(report, createSession())?.function?.summary,
    "Stored snapshot draft",
  );
});
