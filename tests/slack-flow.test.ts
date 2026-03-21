import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSlackApprovalDescriptor,
  buildSlackProviderAttemptPlan,
  canAutoRouteSlackDirector,
  normalizeSlackDirectorMode,
  resolveSlackDirectorMode,
  validateSlackTurnParsedResponse,
} from "../src/main/utils/slack-flow.ts";

test("Todd keeps repo-review requests in codebase-analysis", () => {
  assert.equal(
    resolveSlackDirectorMode("rd-director", "Check the backend and explain the current architecture."),
    "codebase-analysis",
  );
});

test("Todd switches to internet-research only for explicit external research requests", () => {
  assert.equal(
    resolveSlackDirectorMode("rd-director", "Search the web for the latest competitor pricing and docs."),
    "internet-research",
  );
});

test("Todd switches to version-planning for roadmap and version requests", () => {
  assert.equal(
    resolveSlackDirectorMode("rd-director", "Check the backend and draw the v0.1 completion roadmap."),
    "version-planning",
  );
});

test("Todd switches to update-planning for grouped implementation planning requests", () => {
  assert.equal(
    resolveSlackDirectorMode("rd-director", "Break this into grouped updates and write the implementation plan."),
    "update-planning",
  );
});

test("mode normalization keeps legacy internet-research payloads working only for Todd", () => {
  assert.equal(normalizeSlackDirectorMode("rd-director", undefined, true), "internet-research");
  assert.equal(normalizeSlackDirectorMode("rd-director", "codebase-analysis", true), "codebase-analysis");
  assert.equal(normalizeSlackDirectorMode("rd-director", "version-planning", false), "version-planning");
  assert.equal(normalizeSlackDirectorMode("rd-director", "update-planning", false), "update-planning");
  assert.equal(normalizeSlackDirectorMode("programming-director", "internet-research", true), "codebase-analysis");
});

test("approval descriptors keep Todd repo-analysis handoffs out of internet-research", () => {
  const descriptor = buildSlackApprovalDescriptor({
    targetDirectorId: "rd-director",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    message: "Check the backend architecture and explain the current gaps.",
  });

  assert.equal(descriptor.kind, "handoff");
  assert.equal(descriptor.mode, "codebase-analysis");
  assert.equal(descriptor.summaryPrefix, "Confirm handoff to Todd");
  assert.equal(descriptor.payload.mode, "codebase-analysis");
});

test("approval descriptors preserve Todd roadmap and update-planning handoffs", () => {
  const roadmapDescriptor = buildSlackApprovalDescriptor({
    targetDirectorId: "rd-director",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    message: "Create the V1 to V3 roadmap for this product.",
  });
  const updateDescriptor = buildSlackApprovalDescriptor({
    targetDirectorId: "rd-director",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    message: "Break this rollout into grouped updates with implementation steps.",
  });

  assert.equal(roadmapDescriptor.kind, "handoff");
  assert.equal(roadmapDescriptor.mode, "version-planning");
  assert.equal(roadmapDescriptor.payload.mode, "version-planning");
  assert.equal(updateDescriptor.kind, "handoff");
  assert.equal(updateDescriptor.mode, "update-planning");
  assert.equal(updateDescriptor.payload.mode, "update-planning");
});

test("automatic Slack routing excludes Brad for this pass", () => {
  assert.equal(canAutoRouteSlackDirector("project-manager"), true);
  assert.equal(canAutoRouteSlackDirector("creative-director"), true);
  assert.equal(canAutoRouteSlackDirector("rd-director"), true);
  assert.equal(canAutoRouteSlackDirector("programming-director"), true);
  assert.equal(canAutoRouteSlackDirector("validation-director"), false);
});

test("approval descriptors mark explicit Todd web research as internet-research", () => {
  const descriptor = buildSlackApprovalDescriptor({
    targetDirectorId: "rd-director",
    provider: "claude",
    model: "gpt-5.4-mini",
    claudeModel: "opus",
    message: "Look this up online and search the web for the latest docs.",
  });

  assert.equal(descriptor.kind, "internet-research");
  assert.equal(descriptor.mode, "internet-research");
  assert.equal(descriptor.summaryPrefix, "Confirm Todd internet-research handoff");
  assert.equal(descriptor.payload.mode, "internet-research");
});

test("provider attempt plan retries the fallback provider when the requested provider is unavailable", () => {
  const plan = buildSlackProviderAttemptPlan("claude", {
    claude: "Claude is not connected.",
    codex: null,
  });

  assert.deepEqual(plan.attemptedProviders, ["codex"]);
  assert.equal(plan.requestedProviderError, "Claude is not connected.");
  assert.equal(plan.fallbackProvider, "codex");
  assert.equal(plan.fallbackProviderError, null);
});

test("provider attempt plan keeps requested provider first when both providers are ready", () => {
  const plan = buildSlackProviderAttemptPlan("codex", {
    codex: null,
    claude: null,
  });

  assert.deepEqual(plan.attemptedProviders, ["codex", "claude"]);
});

test("blank Slack responses are treated as runtime failures", () => {
  assert.throws(
    () => validateSlackTurnParsedResponse({
      response: "   ",
      handoffTo: null,
      handoffReason: null,
      currentState: null,
      idealState: null,
    }, "rd-director", "codebase-analysis"),
    /empty "response"/i,
  );
});

test("missing required Slack schema fields are rejected", () => {
  assert.throws(
    () => validateSlackTurnParsedResponse({
      response: "Looks good.",
      handoffTo: null,
      handoffReason: null,
      idealState: null,
    }, "project-manager", "codebase-analysis"),
    /missing "currentState"/i,
  );
});

test("Dan Slack responses require draftCoreDetails when ready-to-confirm", () => {
  assert.throws(
    () => validateSlackTurnParsedResponse({
      response: "I have a draft.",
      handoffTo: null,
      handoffReason: null,
      currentState: null,
      idealState: "Ideal summary",
      notesToAppend: ["User wants an animated onboarding flow."],
      sideNotesToAppend: [],
      conversationStatus: "ready-to-confirm",
      draftChangeSummary: ["Added onboarding as a primary pillar."],
      draftCoreDetails: null,
      presenceAction: "stay",
    }, "creative-director", "codebase-analysis"),
    /must include "draftCoreDetails"/i,
  );
});

test("Todd version-planning Slack responses require confirmationSuggested and valid versions", () => {
  assert.throws(
    () => validateSlackTurnParsedResponse({
      response: "Roadmap ready.",
      handoffTo: null,
      handoffReason: null,
      currentState: null,
      idealState: null,
      versions: null,
    }, "rd-director", "version-planning"),
    /confirmationSuggested/i,
  );
});

test("Todd update-planning Slack responses reject missing required update item fields", () => {
  assert.throws(
    () => validateSlackTurnParsedResponse({
      response: "Update plan ready.",
      handoffTo: null,
      handoffReason: null,
      currentState: null,
      idealState: null,
      confirmationSuggested: true,
      updates: [
        {
          title: "Ship auth",
          description: "Connect auth UI to backend.",
          versionLabel: "V1",
          dependencies: [],
          area: null,
        },
      ],
    }, "rd-director", "update-planning"),
    /skillsNeeded/i,
  );
});

test("Jeff to Todd to Ping handoff chain preserves actual work summary", () => {
  const toddDescriptor = buildSlackApprovalDescriptor({
    targetDirectorId: "rd-director",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    message: "Please re-scan the backend and map the remaining roadmap for V1.",
  });

  const pingDescriptor = buildSlackApprovalDescriptor({
    targetDirectorId: "programming-director",
    provider: toddDescriptor.payload.provider,
    model: toddDescriptor.payload.model,
    claudeModel: toddDescriptor.payload.claudeModel,
    message: "Build the three UI gaps Todd identified for v0.1 completion.",
  });

  assert.equal(toddDescriptor.mode, "version-planning");
  assert.equal(pingDescriptor.kind, "handoff");
  assert.equal(pingDescriptor.payload.message, "Build the three UI gaps Todd identified for v0.1 completion.");
  assert.equal(pingDescriptor.payload.mode, "codebase-analysis");
});
