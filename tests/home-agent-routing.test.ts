import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHomeAgentPrompt,
  parseHomeRoutingResponse,
} from "../src/main/utils/home-agent-chat.ts";
import type { ProjectDigest } from "../src/shared/types.ts";

const digests: ProjectDigest[] = [
  {
    projectId: "proj-combat",
    name: "Combat Game",
    description: "A roguelike combat prototype.",
    whereItsAt: "Core loop playable; balancing in progress.",
    whereItsGoing: "Ship a vertical slice with three enemy types.",
  },
  {
    projectId: "proj-empty",
    name: "Fresh Idea",
    description: "",
    whereItsAt: "Concept not yet defined.",
    whereItsGoing: "Direction not yet defined.",
  },
];

test("buildHomeAgentPrompt embeds every project's digest and the user note", () => {
  const prompt = buildHomeAgentPrompt(digests, [], "new boss fight idea and a crash on load");

  assert.match(prompt, /Combat Game/);
  assert.match(prompt, /id: proj-combat/);
  assert.match(prompt, /Core loop playable/);
  // The empty project still appears so the agent can avoid misrouting to it.
  assert.match(prompt, /Concept not yet defined/);
  assert.match(prompt, /new boss fight idea and a crash on load/);
});

test("buildHomeAgentPrompt notes when there are no projects", () => {
  const prompt = buildHomeAgentPrompt([], [], "anything");
  assert.match(prompt, /no projects exist yet/);
});

test("parseHomeRoutingResponse keeps reply, questions, and deliveries", () => {
  const raw = JSON.stringify({
    reply: "Got it — two things here.",
    clarifyingQuestions: ["Which project is the loader note about?"],
    deliveries: [
      {
        projectId: "proj-combat",
        newProjectName: null,
        content: "Add a boss fight to the second area.",
        nature: "creative",
        reason: "Concept/idea update.",
      },
    ],
    newProjectProposals: [],
  });

  const plan = parseHomeRoutingResponse(raw);

  assert.equal(plan.reply, "Got it — two things here.");
  assert.deepEqual(plan.clarifyingQuestions, ["Which project is the loader note about?"]);
  assert.equal(plan.deliveries.length, 1);
  assert.equal(plan.deliveries[0].projectId, "proj-combat");
  assert.equal(plan.deliveries[0].nature, "creative");
  assert.equal(plan.deliveries[0].status, "proposed");
  assert.equal(plan.deliveries[0].newProjectProposalId, null);
  assert.ok(plan.id);
  assert.ok(plan.deliveries[0].id);
});

test("parseHomeRoutingResponse links a new-project delivery to its proposal by name", () => {
  const raw = JSON.stringify({
    reply: "This looks brand new.",
    clarifyingQuestions: [],
    deliveries: [
      {
        projectId: null,
        newProjectName: "Loader Tool",
        content: "Build a standalone asset loader.",
        nature: "technical",
        reason: "No existing project matches.",
      },
    ],
    newProjectProposals: [
      { name: "Loader Tool", initialIdea: "A standalone asset loader.", reason: "Nothing matches." },
    ],
  });

  const plan = parseHomeRoutingResponse(raw);

  assert.equal(plan.newProjectProposals.length, 1);
  const proposal = plan.newProjectProposals[0];
  assert.equal(plan.deliveries.length, 1);
  // The delivery has no projectId yet but points at the proposal it depends on.
  assert.equal(plan.deliveries[0].projectId, "");
  assert.equal(plan.deliveries[0].newProjectProposalId, proposal.id);
  assert.equal(plan.deliveries[0].projectName, "Loader Tool");
});

test("parseHomeRoutingResponse drops empty deliveries and normalizes bad nature", () => {
  const raw = JSON.stringify({
    reply: "",
    clarifyingQuestions: ["", "  Real question?  "],
    deliveries: [
      { projectId: "p1", newProjectName: null, content: "  ", nature: "creative", reason: "x" },
      { projectId: "p1", newProjectName: null, content: "Keep me", nature: "weird", reason: "" },
    ],
    newProjectProposals: [],
  });

  const plan = parseHomeRoutingResponse(raw);

  // Falls back to a non-empty reply.
  assert.ok(plan.reply.length > 0);
  // Blank questions are stripped, real ones trimmed.
  assert.deepEqual(plan.clarifyingQuestions, ["Real question?"]);
  // The whitespace-only delivery is dropped; the bad nature becomes "general".
  assert.equal(plan.deliveries.length, 1);
  assert.equal(plan.deliveries[0].content, "Keep me");
  assert.equal(plan.deliveries[0].nature, "general");
});

test("parseHomeRoutingResponse tolerates prose-wrapped JSON", () => {
  const raw = "Sure! Here is the routing:\n```json\n" +
    JSON.stringify({
      reply: "Done.",
      clarifyingQuestions: [],
      deliveries: [],
      newProjectProposals: [],
    }) +
    "\n```";

  const plan = parseHomeRoutingResponse(raw);
  assert.equal(plan.reply, "Done.");
  assert.equal(plan.deliveries.length, 0);
});
