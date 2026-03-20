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

test("Todd defaults to codebase-analysis for repo review and update planning requests", () => {
  assert.equal(
    resolveSlackDirectorMode("rd-director", "Check the backend and draw the v0.1 completion plan."),
    "codebase-analysis",
  );
});

test("Todd switches to internet-research only for explicit external research requests", () => {
  assert.equal(
    resolveSlackDirectorMode("rd-director", "Search the web for the latest competitor pricing and docs."),
    "internet-research",
  );
});

test("mode normalization keeps legacy internet-research payloads working only for Todd", () => {
  assert.equal(normalizeSlackDirectorMode("rd-director", undefined, true), "internet-research");
  assert.equal(normalizeSlackDirectorMode("rd-director", "codebase-analysis", true), "codebase-analysis");
  assert.equal(normalizeSlackDirectorMode("programming-director", "internet-research", true), "codebase-analysis");
});

test("approval descriptors keep Todd repo-analysis handoffs out of internet-research", () => {
  const descriptor = buildSlackApprovalDescriptor({
    targetDirectorId: "rd-director",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    message: "Check the backend and draw the update plan.",
  });

  assert.equal(descriptor.kind, "handoff");
  assert.equal(descriptor.mode, "codebase-analysis");
  assert.equal(descriptor.summaryPrefix, "Confirm handoff to Todd");
  assert.equal(descriptor.payload.mode, "codebase-analysis");
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

test("Dan Slack responses require draftCoreDetails when ready-to-draft", () => {
  assert.throws(
    () => validateSlackTurnParsedResponse({
      response: "I have a draft.",
      handoffTo: null,
      handoffReason: null,
      currentState: null,
      idealState: "Ideal summary",
      notesToAppend: ["User wants an animated onboarding flow."],
      conversationStatus: "ready-to-draft",
      draftCoreDetails: null,
    }, "creative-director", "codebase-analysis"),
    /must include "draftCoreDetails"/i,
  );
});

test("Jeff to Todd to Ping handoff chain preserves actual work summary", () => {
  const toddDescriptor = buildSlackApprovalDescriptor({
    targetDirectorId: "rd-director",
    provider: "codex",
    model: "gpt-5.4",
    claudeModel: "sonnet",
    message: "Please re-scan the backend and map the remaining v0.1 work.",
  });

  const pingDescriptor = buildSlackApprovalDescriptor({
    targetDirectorId: "programming-director",
    provider: toddDescriptor.payload.provider,
    model: toddDescriptor.payload.model,
    claudeModel: toddDescriptor.payload.claudeModel,
    message: "Build the three UI gaps Todd identified for v0.1 completion.",
  });

  assert.equal(toddDescriptor.mode, "codebase-analysis");
  assert.equal(pingDescriptor.kind, "handoff");
  assert.equal(pingDescriptor.payload.message, "Build the three UI gaps Todd identified for v0.1 completion.");
  assert.equal(pingDescriptor.payload.mode, "codebase-analysis");
});
