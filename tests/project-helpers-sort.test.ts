import assert from "node:assert/strict";
import test from "node:test";
import { sortProjectsForDisplay } from "../src/renderer/src/lib/project-helpers.ts";
import { createEmptyProjectRelationshipSummary, type Project } from "../src/shared/types.ts";

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
