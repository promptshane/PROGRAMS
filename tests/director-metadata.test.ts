import assert from "node:assert/strict";
import test from "node:test";
import {
  BIG_CLAUDE_MODEL,
  BIG_CODEX_MODEL,
  getDirectorMetadata,
  getDirectorRuntimeDefaults,
  resolveDirectorModelSelection,
  resolveDirectorModelTier,
  SMALL_CLAUDE_MODEL,
  SMALL_CODEX_MODEL,
  usesFixedDirectorRuntimePolicy,
} from "../src/shared/director-metadata.ts";

test("programming director runtime defaults use auto planning", () => {
  assert.deepEqual(getDirectorRuntimeDefaults("programming-director"), {
    reasoningEffort: "high",
    planningMode: "auto",
  });
});

test("Dan and Todd use fixed stage-aware runtime policy while Ping stays overrideable", () => {
  assert.equal(usesFixedDirectorRuntimePolicy("creative-director"), true);
  assert.equal(usesFixedDirectorRuntimePolicy("rd-director"), true);
  assert.equal(usesFixedDirectorRuntimePolicy("programming-director"), false);
  assert.equal(usesFixedDirectorRuntimePolicy("project-manager"), false);
  assert.equal(usesFixedDirectorRuntimePolicy("validation-director"), false);
});

test("stage-aware model tier resolution keeps Dan and Todd small for conversation and big for synthesis", () => {
  assert.equal(resolveDirectorModelTier("creative-director", "conversation"), "small");
  assert.equal(resolveDirectorModelTier("creative-director", "synthesis"), "big");
  assert.equal(resolveDirectorModelTier("rd-director", "conversation"), "small");
  assert.equal(resolveDirectorModelTier("rd-director", "synthesis"), "big");
  assert.equal(resolveDirectorModelTier("programming-director", "execution"), null);
  assert.equal(resolveDirectorModelTier("project-manager", "conversation"), null);
});

test("model selection swaps only the tier while preserving the active provider", () => {
  assert.deepEqual(
    resolveDirectorModelSelection("creative-director", "codex", BIG_CODEX_MODEL, BIG_CLAUDE_MODEL, "conversation"),
    {
      tier: "small",
      provider: "codex",
      model: SMALL_CODEX_MODEL,
      claudeModel: SMALL_CLAUDE_MODEL,
      activeModel: SMALL_CODEX_MODEL,
    },
  );

  assert.deepEqual(
    resolveDirectorModelSelection("rd-director", "claude", SMALL_CODEX_MODEL, SMALL_CLAUDE_MODEL, "synthesis"),
    {
      tier: "big",
      provider: "claude",
      model: BIG_CODEX_MODEL,
      claudeModel: BIG_CLAUDE_MODEL,
      activeModel: BIG_CLAUDE_MODEL,
    },
  );

  assert.deepEqual(
    resolveDirectorModelSelection("project-manager", "codex", SMALL_CODEX_MODEL, BIG_CLAUDE_MODEL, "conversation"),
    {
      tier: null,
      provider: "codex",
      model: SMALL_CODEX_MODEL,
      claudeModel: BIG_CLAUDE_MODEL,
      activeModel: SMALL_CODEX_MODEL,
    },
  );
});

test("validation director metadata reflects the expected information flow", () => {
  const metadata = getDirectorMetadata("validation-director");

  assert.equal(metadata.notesSource, null);
  assert.equal(metadata.receivesFrom.some((link) => link.kind === "director" && link.directorId === "programming-director"), true);
  assert.equal(metadata.sendsTo.some((link) => link.kind === "director" && link.directorId === "project-manager"), true);
});

test("project manager metadata keeps Pong out of automatic sends for this pass", () => {
  const metadata = getDirectorMetadata("project-manager");

  assert.equal(metadata.outroMessage.length > 0, true);
  assert.equal(metadata.sendsTo.some((link) => link.kind === "director" && link.directorId === "validation-director"), false);
});
