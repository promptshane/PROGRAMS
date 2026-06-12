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

test("Claude one-shot settings pass the effort level through unchanged", () => {
  // Claude Code honors the same effort vocabulary as the API (xhigh/max included),
  // so we no longer collapse the upper levels down to "high".
  assert.equal(mapClaudeOneShotEffortLevel("high"), "high");
  assert.equal(mapClaudeOneShotEffortLevel("xhigh"), "xhigh");
  assert.equal(mapClaudeOneShotEffortLevel("max"), "max");
  assert.equal(buildClaudeOneShotSettingsArg("xhigh"), "{\"effortLevel\":\"xhigh\"}");
  assert.equal(buildClaudeOneShotSettingsArg("max"), "{\"effortLevel\":\"max\"}");
});
