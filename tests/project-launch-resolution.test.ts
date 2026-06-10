import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  detectRuntimeConfig,
  reconcileRuntimeConfig,
  repairMissingCdSeparator,
  resolveLaunchPlan,
} from "../src/main/utils/project.ts";
import type { ProjectRuntimeConfig } from "../src/shared/types.ts";

const createTempProject = async (): Promise<string> => mkdtemp(join(tmpdir(), "programs-launch-"));

test("resolveLaunchPlan prefers an explicit root launcher", async (t) => {
  const projectPath = await createTempProject();
  t.after(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  await writeFile(join(projectPath, "run_dev.sh"), "#!/bin/bash\nexit 0\n");

  const plan = await resolveLaunchPlan(projectPath);

  assert.equal(plan.runCommand, "bash run_dev.sh");
  assert.equal(plan.wrapperSteps, null);
  assert.equal(plan.launch?.origin, "detected");
  assert.equal(plan.launch?.candidate?.kind, "direct");
});

test("resolveLaunchPlan synthesizes a wrapper for nested frontend/backend apps", async (t) => {
  const projectPath = await createTempProject();
  t.after(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  await mkdir(join(projectPath, "frontend"), { recursive: true });
  await mkdir(join(projectPath, "backend"), { recursive: true });
  await writeFile(
    join(projectPath, "frontend", "package.json"),
    JSON.stringify({
      name: "frontend",
      private: true,
      scripts: {
        dev: "vite",
      },
    }, null, 2),
  );
  await writeFile(
    join(projectPath, "backend", "main.py"),
    [
      "from fastapi import FastAPI",
      "",
      "app = FastAPI()",
      "",
    ].join("\n"),
  );

  const plan = await resolveLaunchPlan(projectPath);

  assert.equal(plan.runCommand, null);
  assert.ok(plan.wrapperSteps);
  assert.equal(plan.wrapperSteps?.length, 2);
  assert.equal(plan.launch?.candidate?.kind, "wrapper");
  assert.ok(plan.wrapperSteps?.some((step) => /vite|npm run/i.test(step.command)));
  assert.ok(plan.wrapperSteps?.some((step) => /uvicorn|python3/i.test(step.command)));
  assert.match(plan.openUrl ?? "", /^http:\/\/localhost:\d{2,5}\//);
});

test("detectRuntimeConfig preserves a manual launch command over a weaker detected guess", async (t) => {
  const projectPath = await createTempProject();
  t.after(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  await writeFile(join(projectPath, "run_dev.sh"), "#!/bin/bash\nexit 0\n");

  const detected = await detectRuntimeConfig(projectPath);
  const manual: ProjectRuntimeConfig = {
    packageManager: "npm",
    installCommand: "npm install",
    runCommand: "npm start",
    openUrl: "http://localhost:3000/",
    lastRunUrl: null,
    initialIdea: null,
    launch: {
      origin: "manual",
      confidence: "high",
      locked: true,
      candidate: {
        kind: "direct",
        source: "manual",
        confidence: "high",
        summary: "User-provided run command.",
        notes: ["Entered manually in PROGRAMS."],
      },
      wrapperPath: null,
      workspacePath: null,
    },
  };

  const merged = reconcileRuntimeConfig(manual, detected);

  assert.equal(merged.runCommand, "npm start");
  assert.equal(merged.launch?.origin, "manual");
  assert.equal(merged.launch?.locked, true);
});

test("resolveLaunchPlan prefers pages:dev over dev for Cloudflare Pages projects", async (t) => {
  const projectPath = await createTempProject();
  t.after(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  await writeFile(join(projectPath, "wrangler.toml"), 'name = "demo"\ncompatibility_date = "2025-01-01"\n');
  await writeFile(
    join(projectPath, "package.json"),
    JSON.stringify({
      name: "demo",
      private: true,
      scripts: {
        dev: "vite",
        "pages:dev": "wrangler pages dev --proxy 5173 -- npm run dev",
      },
    }, null, 2),
  );

  const plan = await resolveLaunchPlan(projectPath);

  assert.equal(plan.runCommand, "npm run pages:dev");
  assert.equal(plan.openUrl, "http://localhost:8788/");
});

test("resolveLaunchPlan still picks dev when no wrangler config is present", async (t) => {
  const projectPath = await createTempProject();
  t.after(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  await writeFile(
    join(projectPath, "package.json"),
    JSON.stringify({
      name: "plain-vite",
      private: true,
      scripts: {
        dev: "vite",
        "pages:dev": "wrangler pages dev --proxy 5173 -- npm run dev",
      },
    }, null, 2),
  );

  const plan = await resolveLaunchPlan(projectPath);

  assert.equal(plan.runCommand, "npm run dev");
});

test("resolveLaunchPlan detects Swift packages", async (t) => {
  const projectPath = await createTempProject();
  t.after(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  await writeFile(
    join(projectPath, "Package.swift"),
    [
      "// swift-tools-version: 6.0",
      "import PackageDescription",
      "",
      "let package = Package(",
      '    name: "DMGReader",',
      "    targets: [.executableTarget(name: \"DMGReader\")]",
      ")",
      "",
    ].join("\n"),
  );

  const plan = await resolveLaunchPlan(projectPath);

  assert.equal(plan.runCommand, "swift run");
  assert.equal(plan.installCommand, "swift package resolve");
  assert.equal(plan.openUrl, null);
  assert.equal(plan.launch?.candidate?.source, "Swift Package");
});

test("repairMissingCdSeparator removes redundant cd prefix for the project cwd", async (t) => {
  const homePath = await mkdtemp(join(tmpdir(), "programs-home-"));
  const projectPath = join(homePath, "Desktop", "dmg_reader");
  await mkdir(projectPath, { recursive: true });
  t.after(async () => {
    await rm(homePath, { recursive: true, force: true });
  });

  assert.equal(
    repairMissingCdSeparator(projectPath, "cd ~/Desktop/dmg_reader swift run", homePath),
    "swift run",
  );
  assert.equal(
    repairMissingCdSeparator(projectPath, "cd ~/Desktop/other swift run", homePath),
    "cd ~/Desktop/other swift run",
  );
});
