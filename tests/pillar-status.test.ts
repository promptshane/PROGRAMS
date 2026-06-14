import assert from "node:assert/strict";
import test from "node:test";
import type { CorePillar, PillarStatus } from "../src/shared/types.ts";
import {
  AGENT_PILLAR_STATUS,
  PILLAR_STATUSES,
  coercePillarStatus,
  derivePillarStatus,
  isCanon,
  isUnconfirmedSuggestion,
} from "../src/shared/pillar-status.ts";

test("derivePillarStatus maps each legacy pillarType to a lifecycle status", () => {
  assert.equal(derivePillarStatus({ pillarType: "core", assumptionSource: null }), "canonical");
  assert.equal(derivePillarStatus({ pillarType: "hard-stop", assumptionSource: null }), "canonical");
  assert.equal(derivePillarStatus({ pillarType: "tbd", assumptionSource: null }), "open");
  assert.equal(derivePillarStatus({ pillarType: "side", assumptionSource: null }), "maybe");
  assert.equal(derivePillarStatus({ pillarType: "ghost", assumptionSource: null }), "maybe");
});

test("derivePillarStatus treats a Dan assumption as an unconfirmed suggestion regardless of pillarType", () => {
  assert.equal(derivePillarStatus({ pillarType: "core", assumptionSource: "dan" }), "suggested");
  assert.equal(derivePillarStatus({ pillarType: "tbd", assumptionSource: "dan" }), "suggested");
  assert.equal(derivePillarStatus({ pillarType: "hard-stop", assumptionSource: "dan" }), "suggested");
  // A user-sourced assumption is not an agent suggestion — it falls back to pillarType.
  assert.equal(derivePillarStatus({ pillarType: "core", assumptionSource: "user" }), "canonical");
});

test("coercePillarStatus preserves valid statuses and rejects junk to open", () => {
  for (const status of PILLAR_STATUSES) {
    assert.equal(coercePillarStatus(status), status);
  }
  assert.equal(coercePillarStatus("bogus"), "open");
  assert.equal(coercePillarStatus(undefined), "open");
  assert.equal(coercePillarStatus(null), "open");
  assert.equal(coercePillarStatus(42), "open");
});

test("isCanon / isUnconfirmedSuggestion truth tables", () => {
  assert.equal(isCanon({ status: "canonical" }), true);
  for (const status of ["maybe", "open", "suggested", "silenced"] as PillarStatus[]) {
    assert.equal(isCanon({ status }), false);
  }
  assert.equal(isUnconfirmedSuggestion({ status: "suggested" }), true);
  for (const status of ["canonical", "maybe", "open", "silenced"] as PillarStatus[]) {
    assert.equal(isUnconfirmedSuggestion({ status }), false);
  }
  // The only status an agent may assign is an unconfirmed suggestion.
  assert.equal(AGENT_PILLAR_STATUS, "suggested");
  assert.equal(isUnconfirmedSuggestion({ status: AGENT_PILLAR_STATUS }), true);
  assert.equal(isCanon({ status: AGENT_PILLAR_STATUS }), false);
});

// --- Data migration ---
// Mirrors the per-node decision that project-store's `migratePillars` applies on
// load: existing valid status is preserved, otherwise it is derived from the
// legacy fields. We walk a nested legacy tree (pillars saved before `status`
// existed) and assert every node gets the right status with nothing else lost.

type LegacyPillar = Omit<CorePillar, "status" | "corePillars"> & {
  status?: PillarStatus;
  corePillars: LegacyPillar[];
};

const migrateStatus = (pillars: LegacyPillar[]): CorePillar[] =>
  pillars.map((p) => ({
    ...p,
    status: p.status
      ? coercePillarStatus(p.status)
      : derivePillarStatus({ pillarType: p.pillarType, assumptionSource: p.assumptionSource ?? null }),
    corePillars: migrateStatus(p.corePillars),
  }));

const legacyPillar = (overrides: Partial<LegacyPillar>): LegacyPillar => ({
  id: overrides.id ?? "id",
  name: overrides.name ?? "Pillar",
  pillarType: overrides.pillarType ?? "core",
  function: overrides.function ?? null,
  thesis: overrides.thesis ?? null,
  corePillars: overrides.corePillars ?? [],
  fullFlow: overrides.fullFlow ?? null,
  description: overrides.description ?? null,
  connectedPillarIds: overrides.connectedPillarIds ?? [],
  assumptionText: overrides.assumptionText ?? null,
  assumptionSource: overrides.assumptionSource ?? null,
  order: overrides.order ?? 0,
  threadMemberships: overrides.threadMemberships ?? [],
  endState: overrides.endState ?? null,
  ...overrides,
});

test("migration backfills status on legacy pillar trees without losing data", () => {
  const legacy: LegacyPillar[] = [
    legacyPillar({
      id: "root-core",
      name: "Root Core",
      pillarType: "core",
      description: "keep me",
      endState: "end",
      corePillars: [
        legacyPillar({ id: "child-tbd", name: "Child TBD", pillarType: "tbd" }),
        legacyPillar({
          id: "child-dan",
          name: "Child Dan Guess",
          pillarType: "core",
          assumptionSource: "dan",
          assumptionText: "Dan's hunch",
        }),
        legacyPillar({ id: "child-ghost", name: "Child Ghost", pillarType: "ghost" }),
      ],
    }),
    legacyPillar({ id: "root-side", name: "Root Side", pillarType: "side" }),
    legacyPillar({ id: "root-stop", name: "Root Stop", pillarType: "hard-stop" }),
  ];

  const migrated = migrateStatus(legacy);

  const statusById = new Map<string, PillarStatus>();
  const walk = (pillars: CorePillar[]): void => {
    for (const p of pillars) {
      statusById.set(p.id, p.status);
      walk(p.corePillars);
    }
  };
  walk(migrated);

  assert.equal(statusById.get("root-core"), "canonical");
  assert.equal(statusById.get("child-tbd"), "open");
  assert.equal(statusById.get("child-dan"), "suggested"); // dan-assumption overrides core
  assert.equal(statusById.get("child-ghost"), "maybe");
  assert.equal(statusById.get("root-side"), "maybe");
  assert.equal(statusById.get("root-stop"), "canonical");

  // No data loss: every original field survives untouched, only `status` is added.
  const root = migrated[0]!;
  assert.equal(root.description, "keep me");
  assert.equal(root.endState, "end");
  assert.equal(root.corePillars.length, 3);
  const danChild = root.corePillars[1]!;
  assert.equal(danChild.assumptionText, "Dan's hunch");
  assert.equal(danChild.assumptionSource, "dan");
});

test("migration is idempotent — a valid existing status is preserved", () => {
  const alreadyMigrated: LegacyPillar[] = [
    // A user previously silenced this side pillar; migration must not reset it to "maybe".
    legacyPillar({ id: "silenced-side", name: "Set Aside", pillarType: "side", status: "silenced" }),
    // A confirmed pillar carrying a stale Dan assumption must stay canonical, not revert to suggested.
    legacyPillar({
      id: "confirmed-with-note",
      name: "Confirmed",
      pillarType: "core",
      status: "canonical",
      assumptionSource: "dan",
    }),
  ];

  const migrated = migrateStatus(alreadyMigrated);
  assert.equal(migrated[0]!.status, "silenced");
  assert.equal(migrated[1]!.status, "canonical");

  // Re-running over already-migrated data changes nothing.
  assert.deepEqual(migrateStatus(migrated), migrated);
});
