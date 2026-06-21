import assert from "node:assert/strict";
import test from "node:test";
import type { AgentCoreDetails, AgentSession } from "../src/shared/types.ts";
import {
  buildAgentProjectDescription,
  getProjectDetailsCurrentSnapshot,
  getProjectDetailsLastScannedAt,
  getProjectDetailsPrimaryConcept,
} from "../src/renderer/src/lib/session-helpers.ts";

const concept = (summary: string, status: "confirmed" | "assumed"): AgentCoreDetails => ({
  function: {
    summary,
    status,
    confirmedAt: "2026-06-01T00:00:00.000Z",
  },
  thesis: null,
  corePillars: [],
  fullFlow: null,
  threads: [],
});

const sessionWithConcepts = (
  confirmedConcept: AgentCoreDetails | null,
  derivedConcept: AgentCoreDetails | null,
): AgentSession => ({
  stages: {
    function: { messages: [], confirmed: null },
    thesis: { messages: [], confirmed: null },
    core_pillars: { messages: [], confirmed: null },
    full_flow: { messages: [], confirmed: null },
    iterations: { messages: [], confirmed: null },
    execution: { messages: [], confirmed: null },
  },
  corePillars: [],
  danMemory: {
    confirmedConcept,
    derivedConcept,
    derivedUpdatedAt: "2026-06-18T12:30:00.000Z",
  },
  toddMemory: {
    codebaseIndexedMap: {
      indexedAt: "2026-06-18T12:00:00.000Z",
    },
  },
} as unknown as AgentSession);

test("Project Details uses the derived concept when no confirmed concept exists", () => {
  const derived = concept("Generated current project function", "assumed");
  const session = sessionWithConcepts(null, derived);

  assert.equal(getProjectDetailsPrimaryConcept(session), derived);
  assert.equal(getProjectDetailsCurrentSnapshot(session), null);
  assert.match(buildAgentProjectDescription(session), /Generated current project function/);
  assert.equal(getProjectDetailsLastScannedAt(session), "2026-06-18T12:30:00.000Z");
});

test("Project Details keeps confirmed intent primary and exposes derived state separately", () => {
  const confirmed = concept("Confirmed product function", "confirmed");
  const derived = concept("Generated current codebase function", "assumed");
  const session = sessionWithConcepts(confirmed, derived);

  assert.equal(getProjectDetailsPrimaryConcept(session), confirmed);
  assert.equal(getProjectDetailsCurrentSnapshot(session), derived);
  assert.match(buildAgentProjectDescription(session), /Confirmed product function/);
  assert.doesNotMatch(buildAgentProjectDescription(session), /Generated current codebase function/);
});
