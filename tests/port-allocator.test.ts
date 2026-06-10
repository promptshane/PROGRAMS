import assert from "node:assert/strict";
import test from "node:test";
import {
  PORT_RANGE_END,
  PORT_RANGE_START,
  allocatePort,
  isValidAssignedPort,
} from "../src/main/utils/port-allocator.ts";

const alwaysAvailable = async (): Promise<boolean> => true;

test("allocatePort returns a port inside the dedicated band", async () => {
  const port = await allocatePort({ projectId: "alpha", takenPorts: [], isAvailable: alwaysAvailable });
  assert.ok(port >= PORT_RANGE_START && port <= PORT_RANGE_END);
});

test("allocatePort is stable for the same project id", async () => {
  const first = await allocatePort({ projectId: "stable-id", takenPorts: [], isAvailable: alwaysAvailable });
  const second = await allocatePort({ projectId: "stable-id", takenPorts: [], isAvailable: alwaysAvailable });
  assert.equal(first, second);
});

test("allocatePort gives different projects different starting ports", async () => {
  const a = await allocatePort({ projectId: "project-a", takenPorts: [], isAvailable: alwaysAvailable });
  const b = await allocatePort({ projectId: "project-b", takenPorts: [], isAvailable: alwaysAvailable });
  assert.notEqual(a, b);
});

test("allocatePort never hands out a port claimed by another project", async () => {
  const seed = await allocatePort({ projectId: "claimer", takenPorts: [], isAvailable: alwaysAvailable });
  const next = await allocatePort({ projectId: "claimer", takenPorts: [seed], isAvailable: alwaysAvailable });
  assert.notEqual(next, seed);
  assert.ok(next >= PORT_RANGE_START && next <= PORT_RANGE_END);
});

test("allocatePort skips ports that are currently busy", async () => {
  const seed = await allocatePort({ projectId: "busy-seed", takenPorts: [], isAvailable: alwaysAvailable });
  const isAvailable = async (port: number): Promise<boolean> => port !== seed;
  const next = await allocatePort({ projectId: "busy-seed", takenPorts: [], isAvailable });
  assert.notEqual(next, seed);
});

test("allocatePort falls back to an un-taken port when everything is busy", async () => {
  const taken = [PORT_RANGE_START, PORT_RANGE_START + 1];
  const port = await allocatePort({
    projectId: "all-busy",
    takenPorts: taken,
    isAvailable: async () => false,
  });
  assert.ok(!taken.includes(port));
  assert.ok(port >= PORT_RANGE_START && port <= PORT_RANGE_END);
});

test("isValidAssignedPort accepts only ports inside the band", () => {
  assert.equal(isValidAssignedPort(PORT_RANGE_START), true);
  assert.equal(isValidAssignedPort(PORT_RANGE_END), true);
  assert.equal(isValidAssignedPort(PORT_RANGE_START - 1), false);
  assert.equal(isValidAssignedPort(PORT_RANGE_END + 1), false);
  assert.equal(isValidAssignedPort(null), false);
  assert.equal(isValidAssignedPort(4200.5), false);
  assert.equal(isValidAssignedPort("4200"), false);
});
