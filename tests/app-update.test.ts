import assert from "node:assert/strict";
import test from "node:test";
import { emitSettledAppUpdateStatus } from "../src/main/utils/app-update.ts";

test("emitSettledAppUpdateStatus emits a ready install status after packaging settles", async () => {
  let packagingActive = true;
  let action: "none" | "install" = "none";
  const emitted: Array<{ buildState: string; action: string }> = [];

  const status = await emitSettledAppUpdateStatus({
    applySettlement: () => {
      packagingActive = false;
      action = "install";
    },
    readStatus: async () => ({
      buildState: packagingActive ? "packaging" : "ready",
      action,
    }),
    emitStatus: (nextStatus) => emitted.push(nextStatus),
  });

  assert.deepEqual(status, {
    buildState: "ready",
    action: "install",
  });
  assert.deepEqual(emitted, [status]);
});

test("emitSettledAppUpdateStatus emits a failed status after packaging errors settle", async () => {
  let packagingActive = true;
  let buildError: string | null = null;
  const emitted: Array<{ buildState: string; buildError: string | null }> = [];

  const status = await emitSettledAppUpdateStatus({
    applySettlement: () => {
      packagingActive = false;
      buildError = "PROGRAMS could not package the latest app build.";
    },
    readStatus: async () => ({
      buildState: packagingActive ? "packaging" : "failed",
      buildError,
    }),
    emitStatus: (nextStatus) => emitted.push(nextStatus),
  });

  assert.deepEqual(status, {
    buildState: "failed",
    buildError: "PROGRAMS could not package the latest app build.",
  });
  assert.deepEqual(emitted, [status]);
});
