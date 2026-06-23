import assert from "node:assert/strict";
import test from "node:test";
import { CREATIVE_CATEGORIES } from "../src/shared/creative-categories.ts";
import {
  createEmptySystemsSyntaxState,
  createSystemsSyntaxBlock,
  createSystemsSyntaxProject,
  deleteSystemsSyntaxBlock,
  deleteSystemsSyntaxProject,
  getSystemsSyntaxPath,
  migrateLegacySystemsSyntaxState,
  moveSystemsSyntaxBlock,
  moveSystemsSyntaxProject,
  moveSystemsSyntaxProjectToCategory,
  parseSystemsSyntaxState,
  updateSystemsSyntaxBlock,
  updateSystemsSyntaxProject,
} from "../src/renderer/src/lib/systems-syntax-store.ts";

const createFixture = () => {
  let state = createEmptySystemsSyntaxState();
  state = createSystemsSyntaxProject(state, "Alpha Project", "tools", "project-alpha");
  state = createSystemsSyntaxProject(state, "Beta Project", "games", "project-beta");
  state = createSystemsSyntaxBlock(
    state,
    "project-alpha",
    "Alpha",
    null,
    "alpha",
  );
  state = createSystemsSyntaxBlock(
    state,
    "project-alpha",
    "Beta",
    null,
    "beta",
  );
  state = createSystemsSyntaxBlock(
    state,
    "project-alpha",
    "Alpha child",
    "alpha",
    "alpha-child",
  );
  state = createSystemsSyntaxBlock(
    state,
    "project-beta",
    "Other project block",
    null,
    "other",
  );
  return state;
};

test("creative taxonomy matches the six constellation categories", () => {
  assert.deepEqual(
    CREATIVE_CATEGORIES.map((category) => category.id),
    ["stories", "philosophy", "tools", "games", "videos", "music"],
  );
  assert.deepEqual(
    CREATIVE_CATEGORIES.map((category) => category.singularLabel),
    ["Story", "Philosophy", "Tool", "Game", "Video", "Music"],
  );
  assert.equal(new Set(CREATIVE_CATEGORIES.map((category) => category.color)).size, 6);
});

test("Systems Syntax creates, orders, edits, and deletes projects", () => {
  let state = createEmptySystemsSyntaxState();
  state = createSystemsSyntaxProject(state, "First", "stories", "first");
  state = createSystemsSyntaxProject(state, "Second", "tools", "second");
  state = createSystemsSyntaxProject(state, "Third", "music", "third");

  assert.deepEqual(state.projectOrder, ["first", "second", "third"]);

  state = moveSystemsSyntaxProject(state, "third", 0);
  state = updateSystemsSyntaxProject(state, "second", {
    name: "Second renamed",
    categoryId: "games",
  });

  assert.deepEqual(state.projectOrder, ["third", "first", "second"]);
  assert.equal(state.projects.second.name, "Second renamed");
  assert.equal(state.projects.second.categoryId, "games");

  state = createSystemsSyntaxBlock(state, "second", "Nested", null, "nested");
  state = deleteSystemsSyntaxProject(state, "second");
  assert.equal(state.projects.second, undefined);
  assert.equal(state.blocks.nested, undefined);
  assert.deepEqual(state.projectOrder, ["third", "first"]);
});

test("Systems Syntax moves projects across categories", () => {
  let state = createEmptySystemsSyntaxState();
  state = createSystemsSyntaxProject(state, "First", "stories", "first");
  state = createSystemsSyntaxProject(state, "Second", "tools", "second");
  state = createSystemsSyntaxProject(state, "Third", "music", "third");

  state = moveSystemsSyntaxProjectToCategory(state, "first", "tools");

  assert.equal(state.projects.first.categoryId, "tools");
  assert.deepEqual(state.projectOrder, ["second", "first", "third"]);

  state = moveSystemsSyntaxProjectToCategory(state, "third", "tools", 0);

  assert.equal(state.projects.third.categoryId, "tools");
  assert.deepEqual(state.projectOrder, ["third", "second", "first"]);
});

test("Systems Syntax reorders project priority inside a category", () => {
  let state = createEmptySystemsSyntaxState();
  state = createSystemsSyntaxProject(state, "Alpha", "tools", "alpha");
  state = createSystemsSyntaxProject(state, "Beta", "tools", "beta");
  state = createSystemsSyntaxProject(state, "Gamma", "tools", "gamma");

  state = moveSystemsSyntaxProjectToCategory(state, "alpha", "tools", 2);

  assert.deepEqual(state.projectOrder, ["beta", "alpha", "gamma"]);

  state = moveSystemsSyntaxProjectToCategory(state, "gamma", "tools", 0);

  assert.deepEqual(state.projectOrder, ["gamma", "beta", "alpha"]);

  state = moveSystemsSyntaxProjectToCategory(state, "beta", "tools", 3);

  assert.deepEqual(state.projectOrder, ["gamma", "alpha", "beta"]);
});

test("Systems Syntax ignores invalid project category moves", () => {
  const state = createFixture();

  assert.equal(
    moveSystemsSyntaxProjectToCategory(state, "missing-project", "tools"),
    state,
  );
  assert.equal(
    moveSystemsSyntaxProjectToCategory(state, "project-alpha", "unknown" as never),
    state,
  );
});

test("Systems Syntax creates ordered root and nested blocks per project", () => {
  const state = createFixture();

  assert.deepEqual(state.projects["project-alpha"].rootBlockIds, ["alpha", "beta"]);
  assert.deepEqual(state.blocks.alpha.children, ["alpha-child"]);
  assert.equal(state.blocks["alpha-child"].parentId, "alpha");
  assert.equal(state.blocks["alpha-child"].projectId, "project-alpha");
});

test("Systems Syntax renames and recursively deletes blocks", () => {
  const state = createFixture();
  const renamed = updateSystemsSyntaxBlock(state, "alpha-child", "Renamed child");
  const deleted = deleteSystemsSyntaxBlock(renamed, "alpha");

  assert.equal(renamed.blocks["alpha-child"].name, "Renamed child");
  assert.equal(deleted.blocks.alpha, undefined);
  assert.equal(deleted.blocks["alpha-child"], undefined);
  assert.deepEqual(deleted.projects["project-alpha"].rootBlockIds, ["beta"]);
  assert.ok(deleted.blocks.other);
});

test("Systems Syntax reorders siblings and reparents blocks within a project", () => {
  const state = createFixture();
  const reordered = moveSystemsSyntaxBlock(
    state,
    "beta",
    "project-alpha",
    null,
    0,
  );
  const nested = moveSystemsSyntaxBlock(
    reordered,
    "beta",
    "project-alpha",
    "alpha",
    1,
  );

  assert.deepEqual(
    reordered.projects["project-alpha"].rootBlockIds,
    ["beta", "alpha"],
  );
  assert.deepEqual(nested.projects["project-alpha"].rootBlockIds, ["alpha"]);
  assert.deepEqual(nested.blocks.alpha.children, ["alpha-child", "beta"]);
  assert.equal(nested.blocks.beta.parentId, "alpha");
});

test("Systems Syntax prevents cycles and cross-project block movement", () => {
  const state = createFixture();

  assert.equal(
    moveSystemsSyntaxBlock(state, "alpha", "project-alpha", "alpha", 0),
    state,
  );
  assert.equal(
    moveSystemsSyntaxBlock(state, "alpha", "project-alpha", "alpha-child", 0),
    state,
  );
  assert.equal(
    moveSystemsSyntaxBlock(state, "alpha", "project-beta", null, 0),
    state,
  );
  assert.equal(
    moveSystemsSyntaxBlock(state, "alpha", "project-alpha", "other", 0),
    state,
  );
});

test("Systems Syntax exposes the opened block path", () => {
  const state = createFixture();
  assert.deepEqual(
    getSystemsSyntaxPath(state, "alpha-child").map((block) => block.id),
    ["alpha", "alpha-child"],
  );
});

test("Systems Syntax v2 parser rejects malformed roots and repairs ownership", () => {
  assert.deepEqual(parseSystemsSyntaxState("not json"), createEmptySystemsSyntaxState());
  assert.deepEqual(parseSystemsSyntaxState("{}"), createEmptySystemsSyntaxState());

  const parsed = parseSystemsSyntaxState(JSON.stringify({
    version: 2,
    projectOrder: ["alpha-project", "missing", "alpha-project"],
    projects: {
      "alpha-project": {
        id: "alpha-project",
        name: " Alpha project ",
        categoryId: "tools",
        rootBlockIds: ["alpha", "cross-project", "missing"],
      },
      "beta-project": {
        id: "beta-project",
        name: "Beta project",
        categoryId: "games",
        rootBlockIds: ["cross-project"],
      },
      invalid: {
        id: "invalid",
        name: "Invalid",
        categoryId: "unknown",
        rootBlockIds: [],
      },
    },
    blocks: {
      alpha: {
        id: "alpha",
        projectId: "alpha-project",
        name: " Alpha ",
        parentId: "child",
        children: ["child", "child", "cross-project"],
      },
      child: {
        id: "child",
        projectId: "alpha-project",
        name: "Child",
        parentId: "alpha",
        children: ["alpha"],
      },
      "cross-project": {
        id: "cross-project",
        projectId: "beta-project",
        name: "Other",
        parentId: "alpha",
        children: [],
      },
      orphan: {
        id: "orphan",
        projectId: "missing",
        name: "Discard me",
        parentId: null,
        children: [],
      },
    },
  }));

  assert.deepEqual(parsed.projectOrder, ["alpha-project", "beta-project"]);
  assert.equal(parsed.projects["alpha-project"].name, "Alpha project");
  assert.equal(parsed.projects.invalid, undefined);
  assert.equal(parsed.blocks.orphan, undefined);
  assert.equal(parsed.blocks.alpha.parentId, null);
  assert.equal(parsed.blocks.child.parentId, "alpha");
  assert.deepEqual(parsed.blocks.alpha.children, ["child"]);
  assert.equal(parsed.blocks["cross-project"].parentId, null);
  assert.deepEqual(parsed.projects["beta-project"].rootBlockIds, ["cross-project"]);
});

test("Systems Syntax migrates the v1 global tree into an Imported Syntax tool project", () => {
  const migrated = migrateLegacySystemsSyntaxState(JSON.stringify({
    rootChildren: ["alpha", "beta"],
    blocks: {
      alpha: {
        id: "alpha",
        name: "Alpha",
        parentId: null,
        children: ["alpha-child"],
      },
      beta: {
        id: "beta",
        name: "Beta",
        parentId: null,
        children: [],
      },
      "alpha-child": {
        id: "alpha-child",
        name: "Alpha child",
        parentId: "alpha",
        children: [],
      },
    },
  }));

  assert.deepEqual(migrated.projectOrder, ["imported-syntax"]);
  assert.equal(migrated.projects["imported-syntax"].name, "Imported Syntax");
  assert.equal(migrated.projects["imported-syntax"].categoryId, "tools");
  assert.deepEqual(
    migrated.projects["imported-syntax"].rootBlockIds,
    ["alpha", "beta"],
  );
  assert.deepEqual(migrated.blocks.alpha.children, ["alpha-child"]);
  assert.equal(migrated.blocks["alpha-child"].projectId, "imported-syntax");
  assert.equal(migrated.blocks["alpha-child"].parentId, "alpha");
});
