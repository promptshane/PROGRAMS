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

  assert.equal(columns.length, placeholders.length);
  assert.equal(columns.length, 50);
  assert.ok(columns.includes("dan_side_notes_json"));
  assert.ok(columns.includes("dan_draft_core_details_json"));
  assert.ok(columns.includes("dan_draft_change_summary_json"));
  assert.ok(columns.includes("dan_draft_status"));
  assert.ok(columns.includes("dan_memory_json"));
  assert.ok(columns.includes("todd_memory_json"));
  assert.ok(columns.includes("ping_memory_json"));
  assert.ok(columns.includes("jeff_memory_json"));
  assert.ok(columns.includes("pong_memory_json"));
  assert.ok(columns.includes("automation_json"));
  assert.equal(columns.includes("agent_conversations_json"), false);
  assert.equal(columns.includes("active_agent_id"), false);
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
const projectRoot = process.cwd();
const { createEmptyProjectRelationshipSummary } = await import(
  pathToFileURL(path.join(projectRoot, "src/shared/types.ts")).href,
);
const absoluteImports = new Map([
  ["../../shared/types.ts", pathToFileURL(path.join(projectRoot, "src/shared/types.ts")).href],
  ["../../shared/agent-session.ts", pathToFileURL(path.join(projectRoot, "src/shared/agent-session.ts")).href],
  ["../../shared/pillar-status.ts", pathToFileURL(path.join(projectRoot, "src/shared/pillar-status.ts")).href],
  ["../defaults.ts", pathToFileURL(path.join(projectRoot, "src/main/defaults.ts")).href],
  ["../utils/fs.ts", pathToFileURL(path.join(projectRoot, "src/main/utils/fs.ts")).href],
]);
for (const [specifier, targetUrl] of absoluteImports) {
  source = source.replaceAll('from "' + specifier + '"', 'from ' + JSON.stringify(targetUrl));
}

const tempDir = await mkdtemp(path.join(process.cwd(), ".tmp-programs-project-store-module-"));
const tempPath = path.join(tempDir, "project-store.test.ts");
await writeFile(tempPath, source, "utf8");

try {
  const { ProjectStore } = await import(pathToFileURL(tempPath).href);
  const store = new ProjectStore();
  await store.initialize();

  const now = "2026-03-19T12:00:00.000Z";
  const emptyStage = { messages: [], confirmed: null };
  const confirmedDetail = (summary) => ({ summary, status: "confirmed" });
  const project = {
    id: "project-1",
    name: "Slack Session Test",
    iconColor: "#0EA5E9",
    description: "Regression coverage for the first Slack save path.",
    localPath: process.env.PROGRAMS_TEST_PROJECT_DIR,
    threadId: null,
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
      },
    lastError: null,
    relationship: createEmptyProjectRelationshipSummary(),
  };

  await store.createProject(project);
  await store.addUpdateRecord({
    id: "update-1",
    projectId: project.id,
    prompt: "Add the checkpoint.",
    summary: "Added onboarding checkpoint.",
    description: "The onboarding flow now pauses at a clearer checkpoint before entering the workspace.",
    commitSha: "abc123",
    createdAt: now,
    kind: "update",
    status: "saved",
    errorMessage: null,
  });

  const session = {
    id: "session-1",
    projectId: project.id,
    currentStage: "function",
    conversationMode: "guided",
    stages: {
      function: { ...emptyStage, confirmed: confirmedDetail("Guide users into the workspace with a confident first-run flow.") },
      thesis: { ...emptyStage, confirmed: confirmedDetail("Reduce first-run uncertainty by making the workspace feel legible immediately.") },
      core_pillars: { ...emptyStage, confirmed: confirmedDetail("1 top-level pillar") },
      full_flow: { ...emptyStage, confirmed: confirmedDetail("User arrives, completes setup, and lands inside a clear workspace baseline.") },
      iterations: { ...emptyStage },
      execution: { ...emptyStage },
    },
    unifiedMessages: [],
    scratchpad: [],
    plannedUpdates: [],
    corePillars: [
      {
        id: "pillar-1",
        name: "Onboarding",
        pillarType: "core",
        status: "canonical",
        function: confirmedDetail("Orient the user and collect the minimum setup inputs."),
        thesis: confirmedDetail("The first interaction should feel guided, not overwhelming."),
        corePillars: [],
        fullFlow: confirmedDetail("Start with setup, then move into the workspace."),
        description: "The main first-run sequence.",
        connectedPillarIds: [],
        assumptionText: null,
        assumptionSource: null,
        order: 1,
        threadMemberships: [],
        endState: null,
      },
    ],
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
    danSideNotes: ["Maybe keep the ambient onboarding sound optional."],
    danDraftCoreDetails: {
      function: { summary: "Guide users into the workspace with a confident first-run flow.", status: "edited" },
      thesis: null,
      corePillars: [],
      fullFlow: null,
      threads: [],
    },
    danDraftChangeSummary: ["Added an onboarding draft function summary."],
    danDraftStatus: "gathering",
    danArchivedNotes: ["[2026-03-19T12:00:00.000Z | slack draft processed] captured note"],
    deletedNotes: [],
    pingTaskContext: null,
    pingMemory: {
      activeUpdateId: null,
      activeTask: "Direct Ping request",
      context: "Add a clearer onboarding checkpoint.",
      codebaseMapSummary: "The repo already has an onboarding flow and a home shell.",
      latestRawReport: null,
      latestJeffReport: null,
      currentRun: {
        task: {
          source: "direct-ping-request",
          projectId: project.id,
          updateId: null,
          updateTitle: null,
          updateDescription: null,
          originalUserRequest: "Add a clearer onboarding checkpoint.",
          toddExplanation: null,
          relevantPillarIds: [],
          toddCodebaseMapSummary: "The repo already has an onboarding flow and a home shell.",
          coreDetailsContext: "Function: Guide users into the workspace.",
          runtime: {
            provider: "codex",
            model: "gpt-5.4",
            claudeModel: "opus",
            reasoningEffort: "high",
            planningMode: "auto",
            contextPaths: ["src/app/onboarding.tsx"],
          },
          planPrompt: "Implement the onboarding checkpoint change.",
          createdAt: now,
        },
        plan: null,
        report: null,
      },
    },
    pongTaskContext: null,
    projectCategory: "general-project",
    slackMessages: [
      {
        id: "slack-1",
        role: "user",
        directorId: null,
        content: "Hello team",
        createdAt: now,
      },
      {
        id: "slack-2",
        role: "assistant",
        directorId: "creative-director",
        content: "Here is Dan's hard-memory report.",
        createdAt: now,
        status: "complete",
        metadata: {
          type: "hard-memory-report",
          dataType: "danDraftCoreDetails",
          directorId: "creative-director",
          approvalId: "approval-1",
          summary: "Confirm Dan core details",
          currentState: "Current",
          idealState: "Ideal",
          changeSummary: ["Updated the function summary."],
          draftCoreDetails: null,
          roadmapVersions: null,
          versionUpdates: null,
          createdAt: now,
        },
      },
    ],
    slackActiveDirectorId: "project-manager",
    slackPresenceGuestId: "creative-director",
    pendingApprovals: [],
    directorSettingsOverrides: {},
    directorStateMap: {},
    toddMemory: {
      confirmedConcept: {
        function: confirmedDetail("Stale Todd concept that should be replaced."),
        thesis: null,
        corePillars: [],
        fullFlow: null,
        threads: [],
      },
      currentState: null,
      endStateGoal: null,
      successChain: [],
      nextUpdate: null,
      futureUpdatePlan: [],
      previousUpdateLog: [],
      troubleLog: [],
      codebaseIndexedMap: null,
      notes: [],
      pendingHandoff: null,
      backupNotes: [],
    },
  };

  await store.saveAgentSession(session);
  const reloaded = await store.getAgentSession(project.id);
  const reloadedProject = await store.readProject(project.id);
  const history = await store.readHistory(project.id);

  console.log(JSON.stringify({
    projectId: reloaded?.projectId ?? null,
    hasRemoteUrl: Boolean(reloadedProject && "remoteUrl" in reloadedProject),
    hasDefaultBranch: Boolean(reloadedProject && "defaultBranch" in reloadedProject),
    slackMessageCount: reloaded?.slackMessages.length ?? 0,
    firstSlackContent: reloaded?.slackMessages[0]?.content ?? null,
    secondSlackMetadataType: reloaded?.slackMessages[1]?.metadata?.type ?? null,
    secondSlackApprovalId: reloaded?.slackMessages[1]?.metadata?.approvalId ?? null,
    danArchivedNotes: reloaded?.danArchivedNotes ?? [],
    danSideNotes: reloaded?.danSideNotes ?? [],
    danDraftStatus: reloaded?.danDraftStatus ?? null,
    danDraftFunction: reloaded?.danDraftCoreDetails?.function?.summary ?? null,
    danDraftChangeSummary: reloaded?.danDraftChangeSummary ?? [],
    slackPresenceGuestId: reloaded?.slackPresenceGuestId ?? null,
    toddConfirmedFunction: reloaded?.toddMemory?.confirmedConcept?.function?.summary ?? null,
    pingCurrentRunPrompt: reloaded?.pingMemory?.currentRun?.task.planPrompt ?? null,
    historyDescription: history[0]?.description ?? null,
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
    assert.equal(result.hasRemoteUrl, false);
    assert.equal(result.hasDefaultBranch, false);
    assert.equal(result.slackMessageCount, 2);
    assert.equal(result.firstSlackContent, "Hello team");
    assert.equal(result.secondSlackMetadataType, "hard-memory-report");
    assert.equal(result.secondSlackApprovalId, "approval-1");
    assert.deepEqual(result.danArchivedNotes, ["[2026-03-19T12:00:00.000Z | slack draft processed] captured note"]);
    assert.deepEqual(result.danSideNotes, ["Maybe keep the ambient onboarding sound optional."]);
    assert.equal(result.danDraftStatus, "gathering");
    assert.equal(result.danDraftFunction, "Guide users into the workspace with a confident first-run flow.");
    assert.deepEqual(result.danDraftChangeSummary, ["Added an onboarding draft function summary."]);
    assert.equal(result.slackPresenceGuestId, "creative-director");
    assert.equal(result.toddConfirmedFunction, "Guide users into the workspace with a confident first-run flow.");
    assert.equal(result.pingCurrentRunPrompt, "Implement the onboarding checkpoint change.");
    assert.equal(result.historyDescription, "The onboarding flow now pauses at a clearer checkpoint before entering the workspace.");
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});
