import assert from "node:assert/strict";
import test from "node:test";
import { getDirectorMetadata, getDirectorRuntimeDefaults } from "../src/shared/director-metadata.ts";

test("programming director runtime defaults use review planning", () => {
  assert.deepEqual(getDirectorRuntimeDefaults("programming-director"), {
    reasoningEffort: "high",
    planningMode: "review",
  });
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
