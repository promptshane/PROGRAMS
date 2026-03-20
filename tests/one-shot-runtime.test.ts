import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClaudeOneShotSettingsArg,
  mapClaudeOneShotEffortLevel,
  resolveOneShotReasoningEffort,
} from "../src/main/utils/one-shot-runtime.ts";

test("resolveOneShotReasoningEffort prefers an explicit override", () => {
  assert.equal(resolveOneShotReasoningEffort("medium", "xhigh"), "xhigh");
  assert.equal(resolveOneShotReasoningEffort("high"), "high");
});

test("Claude one-shot settings clamp xhigh to Claude's highest supported effort", () => {
  assert.equal(mapClaudeOneShotEffortLevel("xhigh"), "high");
  assert.equal(buildClaudeOneShotSettingsArg("xhigh"), "{\"effortLevel\":\"high\"}");
});
