import assert from "node:assert/strict";
import test from "node:test";
import { isUsageSnapshotStale } from "../src/renderer/src/lib/usage-freshness";

const nowMs = Date.parse("2026-06-23T16:00:00.000Z");
const staleMs = 55_000;

test("usage freshness treats missing and invalid timestamps as stale", () => {
  assert.equal(isUsageSnapshotStale("", nowMs, staleMs), true);
  assert.equal(isUsageSnapshotStale(null, nowMs, staleMs), true);
  assert.equal(isUsageSnapshotStale("not-a-date", nowMs, staleMs), true);
});

test("usage freshness treats snapshots younger than the active window as fresh", () => {
  assert.equal(isUsageSnapshotStale(new Date(nowMs - 54_999).toISOString(), nowMs, staleMs), false);
});

test("usage freshness treats snapshots at or past the active window as stale", () => {
  assert.equal(isUsageSnapshotStale(new Date(nowMs - 55_000).toISOString(), nowMs, staleMs), true);
  assert.equal(isUsageSnapshotStale(new Date(nowMs - 60_000).toISOString(), nowMs, staleMs), true);
});
