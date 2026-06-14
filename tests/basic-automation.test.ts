import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BASIC_AUTOMATION_RESET_BUFFER_MS,
  resolveBasicAutomationUsagePause,
} from "../src/main/utils/basic-automation.ts";
import type { UsageSnapshot, UsageWindow } from "../src/shared/types.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const readyUsage = (windows: UsageWindow[]): UsageSnapshot => ({
  claude: {
    status: "ready",
    windows,
    note: null,
  },
  codex: {
    status: "ready",
    windows: [],
    note: null,
  },
  updatedAt: "2026-06-13T04:00:00.000Z",
});

test("basic automation usage guard allows work below the threshold", () => {
  const decision = resolveBasicAutomationUsagePause(
    readyUsage([
      {
        label: "5-hour window",
        usedPercent: 94,
        resetsAt: "2026-06-13T09:00:00.000Z",
        windowDurationMins: 300,
      },
    ]),
    "claude",
    95,
  );

  assert.deepEqual(decision, { allowed: true });
});

test("basic automation usage guard pauses at the threshold until reset plus buffer", () => {
  const resetsAt = "2026-06-13T09:00:00.000Z";
  const decision = resolveBasicAutomationUsagePause(
    readyUsage([
      {
        label: "5-hour window",
        usedPercent: 95,
        resetsAt,
        windowDurationMins: 300,
      },
    ]),
    "claude",
    95,
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.state, "waiting_for_usage");
  assert.equal(
    decision.pausedUntil,
    new Date(new Date(resetsAt).getTime() + BASIC_AUTOMATION_RESET_BUFFER_MS).toISOString(),
  );
});

test("basic automation usage guard blocks when usage data is missing", () => {
  const decision = resolveBasicAutomationUsagePause(
    {
      ...readyUsage([]),
      claude: {
        status: "unsupported",
        windows: [],
        note: "Claude usage unavailable.",
      },
    },
    "claude",
    95,
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.state, "blocked");
  assert.equal(decision.pausedUntil, null);
});

test("basic automation usage guard pauses when observed usage reaches 100 percent", () => {
  const decision = resolveBasicAutomationUsagePause(
    readyUsage([
      {
        label: "5-hour window",
        usedPercent: 100,
        resetsAt: "2026-06-13T09:00:00.000Z",
        windowDurationMins: 300,
      },
    ]),
    "claude",
    95,
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.state, "waiting_for_usage");
  assert.match(decision.summary, /100%/);
});

const loadProjectStoreModule = async (userDataDir: string) => {
  const sourcePath = path.join(projectRoot, "src/main/services/project-store.ts");
  let source = await readFile(sourcePath, "utf8");
  source = source.replace(
    'import { app } from "electron";',
    `const app = { getPath: () => ${JSON.stringify(userDataDir)}, getAppPath: () => ${JSON.stringify(projectRoot)} };`,
  );

  const absoluteImports = new Map([
    ["../../shared/types.ts", pathToFileURL(path.join(projectRoot, "src/shared/types.ts")).href],
    ["../../shared/agent-session.ts", pathToFileURL(path.join(projectRoot, "src/shared/agent-session.ts")).href],
    ["../../shared/pillar-status.ts", pathToFileURL(path.join(projectRoot, "src/shared/pillar-status.ts")).href],
    ["../defaults.ts", pathToFileURL(path.join(projectRoot, "src/main/defaults.ts")).href],
    ["../utils/fs.ts", pathToFileURL(path.join(projectRoot, "src/main/utils/fs.ts")).href],
  ]);
  for (const [specifier, targetUrl] of absoluteImports) {
    source = source.replaceAll(`from "${specifier}"`, `from ${JSON.stringify(targetUrl)}`);
  }

  const tempDir = await mkdtemp(path.join(projectRoot, ".tmp-programs-basic-automation-store-"));
  const tempPath = path.join(tempDir, "project-store.test.ts");
  await writeFile(tempPath, source, "utf8");

  try {
    return await import(pathToFileURL(tempPath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

test("ProjectStore merges automation defaults and preserves nested automation updates", async () => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "programs-basic-automation-user-data-"));

  try {
    const { ProjectStore } = await loadProjectStoreModule(userDataDir);
    const store = new ProjectStore();
    await store.initialize();

    store.run("REPLACE INTO settings (key, value_json) VALUES (?, ?)", [
      "app",
      JSON.stringify({
        theme: "dark",
        advancedDefaults: {
          provider: "codex",
        },
      }),
    ]);

    const merged = await store.readSettings();
    assert.equal(merged.automation.enabled, false);
    assert.deepEqual(merged.automation.projectIds, []);
    assert.equal(merged.automation.provider, "claude");
    assert.equal(merged.automation.claudeModel, "opus");
    assert.equal(merged.automation.reasoningEffort, "max");
    assert.equal(merged.automation.usagePausePercent, 95);

    const updated = await store.updateSettings({
      automation: {
        enabled: true,
        projectIds: ["project-a"],
        note: "ship overnight improvements",
      },
    });
    assert.equal(updated.automation.enabled, true);
    assert.deepEqual(updated.automation.projectIds, ["project-a"]);
    assert.equal(updated.automation.note, "ship overnight improvements");
    assert.equal(updated.automation.provider, "claude");
    assert.equal(updated.automation.claudeModel, "opus");
    assert.equal(updated.automation.reasoningEffort, "max");

    const modelUpdated = await store.updateSettings({
      automation: {
        claudeModel: "sonnet",
      },
    });
    assert.deepEqual(modelUpdated.automation.projectIds, ["project-a"]);
    assert.equal(modelUpdated.automation.note, "ship overnight improvements");
    assert.equal(modelUpdated.automation.claudeModel, "sonnet");
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});
