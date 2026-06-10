import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { resolvePortInjection } from "../src/main/utils/project.ts";

const PORT = 4321;

const createTempProject = async (scripts: Record<string, string>, dependencies: Record<string, string> = {}): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "programs-port-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "fixture", private: true, scripts, dependencies }, null, 2));
  return dir;
};

test("appends a --port flag for a bare vite binary", async () => {
  const injection = await resolvePortInjection("/tmp/missing", "vite", PORT);
  assert.equal(injection.command, `vite --port ${PORT}`);
  assert.equal(injection.env.PORT, String(PORT));
});

test("appends a --port flag for astro and angular dev servers", async () => {
  assert.equal((await resolvePortInjection("/tmp/missing", "astro dev", PORT)).command, `astro dev --port ${PORT}`);
  assert.equal((await resolvePortInjection("/tmp/missing", "ng serve", PORT)).command, `ng serve --port ${PORT}`);
});

test("forwards the flag through npm/pnpm scripts with a -- delimiter", async (t) => {
  const projectPath = await createTempProject({ dev: "vite" });
  t.after(async () => rm(projectPath, { recursive: true, force: true }));

  const npm = await resolvePortInjection(projectPath, "npm run dev", PORT);
  assert.equal(npm.command, `npm run dev -- --port ${PORT}`);

  const pnpm = await resolvePortInjection(projectPath, "pnpm dev", PORT);
  assert.equal(pnpm.command, `pnpm dev -- --port ${PORT}`);
});

test("forwards the flag without a delimiter for yarn and bun", async (t) => {
  const projectPath = await createTempProject({ dev: "vite" });
  t.after(async () => rm(projectPath, { recursive: true, force: true }));

  const yarn = await resolvePortInjection(projectPath, "yarn dev", PORT);
  assert.equal(yarn.command, `yarn dev --port ${PORT}`);

  const bun = await resolvePortInjection(projectPath, "bun run dev", PORT);
  assert.equal(bun.command, `bun run dev --port ${PORT}`);
});

test("reads package.json from the nested cd target", async (t) => {
  const projectPath = await mkdtemp(join(tmpdir(), "programs-port-nested-"));
  t.after(async () => rm(projectPath, { recursive: true, force: true }));
  await mkdir(join(projectPath, "frontend"), { recursive: true });
  await writeFile(
    join(projectPath, "frontend", "package.json"),
    JSON.stringify({ name: "frontend", scripts: { dev: "vite" } }, null, 2),
  );

  const injection = await resolvePortInjection(projectPath, "cd 'frontend' && npm run dev", PORT);
  assert.equal(injection.command, `cd 'frontend' && npm run dev -- --port ${PORT}`);
});

test("relies on PORT env (no flag) for Next.js", async (t) => {
  const projectPath = await createTempProject({ dev: "next dev" });
  t.after(async () => rm(projectPath, { recursive: true, force: true }));

  const injection = await resolvePortInjection(projectPath, "npm run dev", PORT);
  assert.equal(injection.command, "npm run dev");
  assert.equal(injection.env.PORT, String(PORT));
});

test("relies on PORT env (no flag) for create-react-app", async (t) => {
  const projectPath = await createTempProject({ start: "react-scripts start" });
  t.after(async () => rm(projectPath, { recursive: true, force: true }));

  const injection = await resolvePortInjection(projectPath, "npm start", PORT);
  assert.equal(injection.command, "npm start");
  assert.equal(injection.env.PORT, String(PORT));
});

test("sets PORT env but never appends a flag for a plain node server", async () => {
  const injection = await resolvePortInjection("/tmp/missing", "node server.js", PORT);
  assert.equal(injection.command, "node server.js");
  assert.equal(injection.env.PORT, String(PORT));
});

test("respects an explicit port already in the command", async () => {
  const injection = await resolvePortInjection("/tmp/missing", "vite --port 5180", PORT);
  assert.equal(injection.command, "vite --port 5180");
  assert.deepEqual(injection.env, {});
});

test("respects an explicit port pinned inside an npm script", async (t) => {
  const projectPath = await createTempProject({ dev: "vite --port 5180" });
  t.after(async () => rm(projectPath, { recursive: true, force: true }));

  const injection = await resolvePortInjection(projectPath, "npm run dev", PORT);
  assert.equal(injection.command, "npm run dev");
  assert.equal(injection.env.PORT, String(PORT));
});

test("falls back to vite dependency detection when the script is opaque", async (t) => {
  const projectPath = await createTempProject({ dev: "run-p watch build" }, { vite: "^5.0.0" });
  t.after(async () => rm(projectPath, { recursive: true, force: true }));

  const injection = await resolvePortInjection(projectPath, "npm run dev", PORT);
  assert.equal(injection.command, `npm run dev -- --port ${PORT}`);
});
