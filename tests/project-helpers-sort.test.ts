import assert from "node:assert/strict";
import test from "node:test";
import {
  getAutoInstallAppUpdateKey,
  sortProjectsForDisplay,
} from "../src/renderer/src/lib/project-helpers.ts";
import {
  createEmptyProjectRelationshipSummary,
  type AppUpdateStatus,
  type Project,
} from "../src/shared/types.ts";

const createProject = (
  id: string,
  name: string,
  overrides: Partial<Project> = {},
): Project => ({
  id,
  name,
  iconColor: "#0EA5E9",
  description: "",
  localPath: `/tmp/${id}`,
  threadId: null,
  lastUpdatedAt: null,
  status: "idle",
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  runtimeConfig: {
    packageManager: "npm",
    installCommand: null,
    runCommand: null,
    openUrl: null,
    lastRunUrl: null,
    initialIdea: null,
    launch: null,
  },
  lastError: null,
  githubConnection: null,
  relationship: createEmptyProjectRelationshipSummary(),
  ...overrides,
});

test("sortProjectsForDisplay orders by last opened and hides exact children in root mode", () => {
  const root = createProject("root", "Root Project");
  const child = createProject("child", "Child Project", {
    relationship: {
      ...createEmptyProjectRelationshipSummary(),
      exactParentProjectId: "root",
    },
  });
  const maybe = createProject("maybe", "Maybe Project", {
    relationship: {
      ...createEmptyProjectRelationshipSummary(),
      maybeRelated: [{ projectId: "root", overlapRatio: 0.5, sharedFileCount: 3 }],
    },
  });

  const result = sortProjectsForDisplay([child, maybe, root], {
    lastViewed: {
      maybe: "2026-04-10T12:00:00.000Z",
      child: "2026-04-09T12:00:00.000Z",
      root: "2026-04-08T12:00:00.000Z",
    },
    sortMode: "lastOpened",
    rootOnly: true,
  });

  assert.deepEqual(result.map((project) => project.id), ["maybe", "root"]);
});

test("sortProjectsForDisplay uses last updated and last saved timestamps correctly", () => {
  const localLead = createProject("local-lead", "Local Lead", {
    relationship: {
      ...createEmptyProjectRelationshipSummary(),
      contentUpdatedAt: "2026-04-12T09:00:00.000Z",
    },
  });
  const savedLead = createProject("saved-lead", "Saved Lead", {
    githubConnection: {
      repoUrl: "https://github.com/example/saved-lead",
      lastPushedAt: "2026-04-13T09:00:00.000Z",
      lastPushedCommitSha: "abc123",
      lastDownloadedAt: null,
      lastDownloadedCommitSha: null,
    },
    relationship: {
      ...createEmptyProjectRelationshipSummary(),
      contentUpdatedAt: "2026-04-11T09:00:00.000Z",
    },
  });
  const stale = createProject("stale", "Stale", {
    githubConnection: {
      repoUrl: "https://github.com/example/stale",
      lastPushedAt: "2026-04-10T09:00:00.000Z",
      lastPushedCommitSha: "def456",
      lastDownloadedAt: null,
      lastDownloadedCommitSha: null,
    },
    relationship: {
      ...createEmptyProjectRelationshipSummary(),
      contentUpdatedAt: "2026-04-09T09:00:00.000Z",
    },
  });

  const byUpdated = sortProjectsForDisplay([stale, localLead, savedLead], {
    sortMode: "lastUpdated",
  });
  assert.deepEqual(byUpdated.map((project) => project.id), ["saved-lead", "local-lead", "stale"]);

  const bySaved = sortProjectsForDisplay([stale, localLead, savedLead], {
    sortMode: "lastSaved",
  });
  assert.deepEqual(bySaved.map((project) => project.id), ["saved-lead", "stale", "local-lead"]);
});

test("sortProjectsForDisplay sends null timestamps last and falls back to createdAt then name", () => {
  const newerCreated = createProject("newer-created", "Zulu", {
    createdAt: "2026-04-03T00:00:00.000Z",
  });
  const olderCreated = createProject("older-created", "Alpha", {
    createdAt: "2026-04-02T00:00:00.000Z",
  });
  const sameCreatedAlpha = createProject("same-created-alpha", "Alpha", {
    createdAt: "2026-04-01T00:00:00.000Z",
  });
  const sameCreatedBravo = createProject("same-created-bravo", "Bravo", {
    createdAt: "2026-04-01T00:00:00.000Z",
  });

  const result = sortProjectsForDisplay(
    [sameCreatedBravo, olderCreated, sameCreatedAlpha, newerCreated],
    { sortMode: "lastSaved" },
  );

  assert.deepEqual(result.map((project) => project.id), [
    "newer-created",
    "older-created",
    "same-created-alpha",
    "same-created-bravo",
  ]);
});

const createAppUpdateStatus = (overrides: Partial<AppUpdateStatus> = {}): AppUpdateStatus => ({
  supported: true,
  available: true,
  currentAppPath: "/Applications/PROGRAMS.app",
  candidateAppPath: "/Users/kc/Desktop/PROGRAMS/dist/mac-arm64/PROGRAMS.app",
  workspacePath: "/Users/kc/Desktop/PROGRAMS",
  workspaceExists: true,
  sourceUpdatedAt: "2026-06-11T14:00:00.000Z",
  launchedAppUpdatedAt: "2026-06-11T13:00:00.000Z",
  currentUpdatedAt: "2026-06-11T13:00:00.000Z",
  candidateUpdatedAt: "2026-06-11T14:05:00.000Z",
  currentRendererAssetName: "index-old.js",
  currentRendererAssetUpdatedAt: "2026-06-11T13:00:00.000Z",
  candidateRendererAssetName: "index-new.js",
  candidateRendererAssetUpdatedAt: "2026-06-11T14:05:00.000Z",
  rendererAssetMatch: false,
  buildState: "ready",
  buildError: null,
  requiresAdminPrompt: false,
  action: "install",
  reason: "A newer build is ready to install.",
  ...overrides,
});

test("getAutoInstallAppUpdateKey returns an install candidate for ready writable updates", () => {
  assert.equal(
    getAutoInstallAppUpdateKey({
      status: createAppUpdateStatus(),
      enabled: true,
      busyKey: null,
    }),
    "install::/Applications/PROGRAMS.app::/Users/kc/Desktop/PROGRAMS/dist/mac-arm64/PROGRAMS.app::2026-06-11T14:05:00.000Z",
  );
});

test("getAutoInstallAppUpdateKey returns a restart candidate for ready restart updates", () => {
  assert.equal(
    getAutoInstallAppUpdateKey({
      status: createAppUpdateStatus({
        action: "restart",
        candidateAppPath: "/Applications/PROGRAMS.app",
        reason: "A newer build is ready. Restart PROGRAMS to load it.",
      }),
      enabled: true,
      busyKey: null,
    }),
    "restart::/Applications/PROGRAMS.app::/Applications/PROGRAMS.app::2026-06-11T14:05:00.000Z",
  );
});

test("getAutoInstallAppUpdateKey skips unsafe or unavailable auto-install states", () => {
  const base = createAppUpdateStatus();
  assert.equal(getAutoInstallAppUpdateKey({ status: base, enabled: false, busyKey: null }), null);
  assert.equal(getAutoInstallAppUpdateKey({ status: base, enabled: true, busyKey: "app.update" }), null);
  assert.equal(getAutoInstallAppUpdateKey({ status: createAppUpdateStatus({ buildState: "packaging" }), enabled: true, busyKey: null }), null);
  assert.equal(getAutoInstallAppUpdateKey({ status: createAppUpdateStatus({ buildState: "failed" }), enabled: true, busyKey: null }), null);
  assert.equal(getAutoInstallAppUpdateKey({ status: createAppUpdateStatus({ available: false, action: "none" }), enabled: true, busyKey: null }), null);
  assert.equal(getAutoInstallAppUpdateKey({ status: createAppUpdateStatus({ requiresAdminPrompt: true }), enabled: true, busyKey: null }), null);
});

test("getAutoInstallAppUpdateKey skips already attempted candidates", () => {
  const key = getAutoInstallAppUpdateKey({
    status: createAppUpdateStatus(),
    enabled: true,
    busyKey: null,
  });
  assert.ok(key);
  assert.equal(
    getAutoInstallAppUpdateKey({
      status: createAppUpdateStatus(),
      enabled: true,
      busyKey: null,
      attemptedKeys: new Set([key]),
    }),
    null,
  );
});
