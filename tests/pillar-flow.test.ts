import assert from "node:assert/strict";
import test from "node:test";
import type { CorePillar } from "../src/shared/types.ts";
import {
  BRANCH_PILLAR_TYPES,
  MAIN_TIMELINE_PILLAR_TYPES,
  collectPillarFlowLines,
  formatPillarFlowSection,
} from "../src/shared/pillar-flow.ts";

const detail = (summary: string, status: "confirmed" | "assumed" | "edited" = "confirmed") => ({
  summary,
  status,
});

const samplePillars: CorePillar[] = [
  {
    id: "alpha",
    name: "Alpha",
    pillarType: "core",
    function: detail("Guide the user into the first series."),
    thesis: detail("The opening path should be obvious."),
    corePillars: [
      {
        id: "alpha-side",
        name: "Alpha Side",
        pillarType: "side",
        function: detail("A side lane that can branch off."),
        thesis: detail("Keep the main lane focused."),
        corePillars: [],
        fullFlow: detail("Optional support lives beside the main path."),
        description: null,
        connectedPillarIds: [],
        assumptionText: null,
        assumptionSource: null,
        order: 1,
        threadMemberships: [],
        endState: null,
      },
      {
        id: "alpha-tbd",
        name: "Alpha TBD",
        pillarType: "tbd",
        function: detail("Resolve the remaining uncertainty.", "assumed"),
        thesis: detail("This lane still needs more information.", "assumed"),
        corePillars: [],
        fullFlow: detail("The next step is still open.", "assumed"),
        description: null,
        connectedPillarIds: [],
        assumptionText: "Keep this lane open until the user clarifies it.",
        assumptionSource: "dan",
        order: 2,
        threadMemberships: [],
        endState: null,
      },
    ],
    fullFlow: detail("Guide, then hand off to the next series."),
    description: null,
    connectedPillarIds: ["beta"],
    assumptionText: null,
    assumptionSource: null,
    order: 1,
    threadMemberships: [],
    endState: null,
  },
  {
    id: "beta",
    name: "Beta",
    pillarType: "core",
    function: detail("Give the user a stable working surface."),
    thesis: detail("The core lane should end in a usable state."),
    corePillars: [
      {
        id: "beta-ghost",
        name: "Beta Ghost",
        pillarType: "ghost",
        function: detail("A speculative branch that may reshape the flow."),
        thesis: detail("It may never ship, but it should stay visible."),
        corePillars: [],
        fullFlow: detail("A potentially transformative idea stays off the main lane."),
        description: null,
        connectedPillarIds: [],
        assumptionText: null,
        assumptionSource: null,
        order: 1,
        threadMemberships: [],
        endState: null,
      },
      {
        id: "beta-end",
        name: "Beta End",
        pillarType: "hard-stop",
        function: detail("Mark the end of the main sequence."),
        thesis: detail("The flow needs a clear terminal point."),
        corePillars: [],
        fullFlow: detail("This is the red end point for the series."),
        description: null,
        connectedPillarIds: [],
        assumptionText: null,
        assumptionSource: null,
        order: 2,
        threadMemberships: [],
        endState: null,
      },
    ],
    fullFlow: detail("Land the user in the workspace baseline."),
    description: null,
    connectedPillarIds: ["alpha"],
    assumptionText: null,
    assumptionSource: null,
    order: 2,
    threadMemberships: [],
    endState: null,
  },
];

test("collectPillarFlowLines keeps main and branch lanes separate", () => {
  assert.deepEqual(
    collectPillarFlowLines(samplePillars, MAIN_TIMELINE_PILLAR_TYPES).map((line) => line.pillar.name),
    ["Alpha", "Alpha TBD", "Beta", "Beta End"],
  );

  assert.deepEqual(
    collectPillarFlowLines(samplePillars, BRANCH_PILLAR_TYPES).map((line) => line.pillar.name),
    ["Alpha Side", "Beta Ghost"],
  );
});

test("formatPillarFlowSection labels the main timeline and branches with the expected dot colors", () => {
  const mainSection = formatPillarFlowSection(
    "Main timeline",
    samplePillars,
    MAIN_TIMELINE_PILLAR_TYPES,
    { includeDetails: true, showTrail: true },
  );
  const branchSection = formatPillarFlowSection(
    "Branch references",
    samplePillars,
    BRANCH_PILLAR_TYPES,
    { includeDetails: true, showTrail: true },
  );

  assert.match(mainSection, /Main timeline:/);
  assert.match(mainSection, /\[green core\] Alpha/);
  assert.match(mainSection, /\[yellow tbd\] Alpha TBD/);
  assert.match(mainSection, /\[red end\] Beta End/);
  assert.match(branchSection, /Branch references:/);
  assert.match(branchSection, /\[blue side\] Alpha Side/);
  assert.match(branchSection, /\[purple ghost\] Beta Ghost/);
});
