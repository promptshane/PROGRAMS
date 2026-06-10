import { createServer } from "node:net";

// PROGRAMS hands every project its own port out of a dedicated high band so
// multiple projects can run at once without fighting over a framework default
// (Vite 5173, Next 3000, CRA 3000, …). The band is intentionally away from the
// common defaults so we rarely trip over servers PROGRAMS did not start.
export const PORT_RANGE_START = 4100;
export const PORT_RANGE_END = 4999;

const RANGE_SIZE = PORT_RANGE_END - PORT_RANGE_START + 1;

// Stable per-project seed so a given project tends to land on the same port
// even before its assignment is persisted, and so two freshly created projects
// start probing from different offsets instead of both grabbing the low end.
const seedOffset = (projectId: string): number => {
  let hash = 0;
  for (let index = 0; index < projectId.length; index += 1) {
    hash = (hash * 31 + projectId.charCodeAt(index)) >>> 0;
  }
  return hash % RANGE_SIZE;
};

export const isValidAssignedPort = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= PORT_RANGE_START && value <= PORT_RANGE_END;

// Lightweight, dependency-free check: a port is "available" if we can briefly
// bind a listener to it on the loopback interface.
export const isPortAvailable = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });

interface AllocatePortOptions {
  projectId: string;
  // Ports already claimed by other projects — never hand the same port to two
  // projects, even if one of them is not running right now.
  takenPorts: Iterable<number>;
  // Defaults to a real loopback bind check; injectable for tests.
  isAvailable?: (port: number) => Promise<boolean>;
}

// Probe the band starting from the project's stable seed, skipping ports that
// belong to another project or are currently in use, and return the first that
// is free. Falls back to the first un-taken port (ignoring the liveness check)
// if every candidate is momentarily busy, then to the seed as a last resort so
// we always return something deterministic.
export const allocatePort = async ({
  projectId,
  takenPorts,
  isAvailable = isPortAvailable,
}: AllocatePortOptions): Promise<number> => {
  const taken = new Set<number>(takenPorts);
  const start = seedOffset(projectId);
  let firstUntaken: number | null = null;

  for (let step = 0; step < RANGE_SIZE; step += 1) {
    const port = PORT_RANGE_START + ((start + step) % RANGE_SIZE);
    if (taken.has(port)) {
      continue;
    }
    if (firstUntaken === null) {
      firstUntaken = port;
    }
    if (await isAvailable(port)) {
      return port;
    }
  }

  return firstUntaken ?? PORT_RANGE_START + start;
};
