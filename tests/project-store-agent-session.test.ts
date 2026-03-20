import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

test("agent session save statement keeps columns and placeholders aligned", async () => {
  const source = await readFile(path.join(projectRoot, "src/main/services/project-store.ts"), "utf8");
  const match = source.match(/REPLACE INTO agent_sessions \(([\s\S]*?)\)\s*VALUES \(([\s\S]*?)\)`/m);

  assert.ok(match, "Could not find the agent_sessions REPLACE INTO statement.");

  const columns = match[1]!.split(",").map((value) => value.trim()).filter(Boolean);
  const placeholders = match[2]!.split(",").map((value) => value.trim()).filter(Boolean);

  assert.equal(columns.length, 43);
  assert.equal(placeholders.length, 43);
});

test("ProjectStore round-trips agent sessions with a first Slack message and new Slack fields", async () => {
  const userDataDir = await mkdtemp(path.join(projectRoot, ".tmp-programs-user-data-"));
  const projectDir = await mkdtemp(path.join(projectRoot, ".tmp-programs-project-"));

  const script = `
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sourcePath = path.resolve(process.cwd(), "src/main/services/project-store.ts");
let source = await readFile(sourcePath, "utf8");
source = source.replace(
  'import { app } from "electron";',
  \`const app = { getPath: () => \${JSON.stringify(process.env.PROGRAMS_TEST_USER_DATA)}, getAppPath: () => \${JSON.stringify(process.cwd())} };\`,
);

const tempDir = await mkdtemp(path.join(process.cwd(), ".tmp-programs-project-store-module-"));
const tempPath = path.join(tempDir, "project-store.test.ts");
await writeFile(tempPath, source, "utf8");

try {
  const { ProjectStore } = await import(pathToFileURL(tempPath).href);
  const store = new ProjectStore();
  await store.initialize();

  const now = "2026-03-19T12:00:00.000Z";
  const emptyStage = { messages: [], confirmed: null };
  const project = {
    id: "project-1",
    name: "Slack Session Test",
    iconColor: "#0EA5E9",
    description: "Regression coverage for the first Slack save path.",
    localPath: process.env.PROGRAMS_TEST_PROJECT_DIR,
    remoteUrl: null,
    defaultBranch: "main",
    threadId: null,
    flowchartPath: path.join(process.env.PROGRAMS_TEST_PROJECT_DIR, "flowchart.mmd"),
    lastUpdatedAt: null,
    status: "idle",
    createdAt: now,
    updatedAt: now,
    runtimeConfig: {
      packageManager: "npm",
      installCommand: null,
      runCommand: null,
      openUrl: null,
      lastRunUrl: null,
      initialIdea: null,
      githubRepoName: null,
    },
    lastError: null,
  };

  await store.createProject(project);

  const session = {
    id: "session-1",
    projectId: project.id,
    currentStage: "function",
    conversationMode: "guided",
    stages: {
      function: { ...emptyStage },
      thesis: { ...emptyStage },
      core_pillars: { ...emptyStage },
      full_flow: { ...emptyStage },
      iterations: { ...emptyStage },
      execution: { ...emptyStage },
    },
    unifiedMessages: [],
    scratchpad: [],
    plannedUpdates: [],
    corePillars: [],
    currentCorePillars: [],
    coreDetailsChatHistory: [],
    attachedMaterials: [],
    miscMaterials: [],
    cascadePending: null,
    provider: "codex",
    createdAt: now,
    updatedAt: now,
    directorConversations: {},
    versions: [],
    versionUpdates: [],
    feasibilityAssessments: [],
    validationResults: [],
    validationFrequency: "manual",
    activeDirectorId: null,
    directorProgress: {
      creative: "not-started",
      rd: "not-started",
      programming: "not-started",
      validation: "not-started",
      currentDirector: null,
    },
    creativeFocusMode: null,
    rdFocusMode: null,
    validationFocusMode: null,
    danInternalNotes: [],
    danArchivedNotes: ["[2026-03-19T12:00:00.000Z | slack draft processed] captured note"],
    deletedNotes: [],
    pingTaskContext: null,
    bradTaskContext: null,
    projectCategory: "general-project",
    dynamicSubAgents: [],
    slackMessages: [
      {
        id: "slack-1",
        role: "user",
        directorId: null,
        content: "Hello team",
        createdAt: now,
      },
    ],
    slackActiveDirectorId: "project-manager",
    slackPresenceGuestId: "creative-director",
    pendingApprovals: [],
    directorSettingsOverrides: {},
    directorStateMap: {},
    agentConversations: {},
    activeAgentId: null,
  };

  await store.saveAgentSession(session);
  const reloaded = await store.getAgentSession(project.id);

  console.log(JSON.stringify({
    projectId: reloaded?.projectId ?? null,
    slackMessageCount: reloaded?.slackMessages.length ?? 0,
    firstSlackContent: reloaded?.slackMessages[0]?.content ?? null,
    danArchivedNotes: reloaded?.danArchivedNotes ?? [],
    slackPresenceGuestId: reloaded?.slackPresenceGuestId ?? null,
  }));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
`;

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--loader", "./tests/node-ts-path-loader.mjs", "--input-type=module", "-e", script],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          PROGRAMS_TEST_USER_DATA: userDataDir,
          PROGRAMS_TEST_PROJECT_DIR: projectDir,
        },
      },
    );

    const result = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
    assert.equal(result.projectId, "project-1");
    assert.equal(result.slackMessageCount, 1);
    assert.equal(result.firstSlackContent, "Hello team");
    assert.deepEqual(result.danArchivedNotes, ["[2026-03-19T12:00:00.000Z | slack draft processed] captured note"]);
    assert.equal(result.slackPresenceGuestId, "creative-director");
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});
