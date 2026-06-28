import assert from "node:assert/strict";
import test from "node:test";
import { CREATIVE_CATEGORIES } from "../src/shared/creative-categories.ts";
import {
  addExistingBlockPlacement,
  clearStrictTie,
  countBlockPlacements,
  countProjectThreads,
  countThreadBlocks,
  createBlock,
  createCrossThreadLooseTie,
  createEmptyThreadsState,
  createProject,
  createThread,
  deleteBlockEverywhere,
  deleteCrossThreadLooseTie,
  deleteProject,
  deleteThread,
  getBlockPlacementIds,
  getCategoryProjects,
  getIncomingCrossThreadLooseTies,
  getOutgoingCrossThreadLooseTies,
  getProjectThreads,
  getThreadBlockOrder,
  getThreadDisplayBlockIds,
  getThreadDisplayPlacementIds,
  migrateLegacyThreadsState,
  moveBlockInThread,
  moveThreadInProject,
  parseThreadsState,
  removeBlockPlacement,
  setStrictTie,
  updateBlockText,
  updateProject,
  updateThread,
} from "../src/renderer/src/lib/threads-store.ts";

const createFixture = () => {
  let state = createEmptyThreadsState();
  state = createProject(state, "Alpha Project", "tools", "project-alpha");
  state = createProject(state, "Beta Project", "games", "project-beta");
  state = createThread(state, "Alpha Thread", "project-alpha", "thread-alpha");
  state = createThread(state, "Beta Thread", "project-beta", "thread-beta");
  state = createBlock(state, "thread-alpha", "Alpha", "alpha");
  state = createBlock(state, "thread-alpha", "Beta", "beta");
  state = createBlock(state, "thread-alpha", "Gamma", "gamma");
  state = createBlock(state, "thread-beta", "Other", "other");
  return state;
};

const threadOrder = (state: ReturnType<typeof createFixture>, threadId = "thread-alpha") =>
  getThreadDisplayBlockIds(state, threadId);

test("creative taxonomy matches the six Thread categories", () => {
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

test("Projects create, order, edit, group, and delete by category", () => {
  let state = createEmptyThreadsState();
  state = createProject(state, "First", "stories", "first");
  state = createProject(state, "Second", "tools", "second");
  state = createProject(state, "Third", "music", "third");

  assert.deepEqual(state.projectOrder, ["first", "second", "third"]);

  state = updateProject(state, "second", {
    name: " Second renamed ",
    categoryId: "games",
  });

  assert.deepEqual(state.projectOrder, ["first", "second", "third"]);
  assert.equal(state.projects.second.name, "Second renamed");
  assert.equal(state.projects.second.categoryId, "games");

  const unchanged = updateProject(state, "second", { name: "   " });
  assert.equal(unchanged, state);

  assert.deepEqual(
    getCategoryProjects(state, "games").map((project) => project.id),
    ["second"],
  );

  state = createThread(state, "Removed Thread", "second", "removed-thread");
  state = createBlock(state, "removed-thread", "Removed Block", "removed-block");
  state = deleteProject(state, "second");
  assert.equal(state.projects.second, undefined);
  assert.equal(state.threads["removed-thread"], undefined);
  assert.equal(state.blocks["removed-block"], undefined);
  assert.equal(state.blockPlacements["removed-block"], undefined);
  assert.deepEqual(state.projectOrder, ["first", "third"]);
});

test("Projects preserve order across category changes", () => {
  let state = createEmptyThreadsState();
  state = createProject(state, "First", "stories", "first");
  state = createProject(state, "Second", "tools", "second");
  state = createProject(state, "Third", "music", "third");

  state = updateProject(state, "first", { categoryId: "tools" });
  state = updateProject(state, "third", { categoryId: "tools" });

  assert.deepEqual(state.projectOrder, ["first", "second", "third"]);
  assert.equal(state.projects.first.categoryId, "tools");
  assert.equal(state.projects.third.categoryId, "tools");
});

test("Threads create, order, edit, count, group, and delete under Projects", () => {
  let state = createEmptyThreadsState();
  state = createProject(state, "Project", "stories", "project");
  state = createProject(state, "Other Project", "tools", "other-project");
  state = createThread(state, "First", "project", "first");
  state = createThread(state, "Second", "project", "second");
  state = createThread(state, "Third", "other-project", "third");

  assert.deepEqual(state.threadOrder, ["first", "second", "third"]);
  assert.equal(countProjectThreads(state, "project"), 2);
  assert.deepEqual(
    getProjectThreads(state, "project").map((thread) => thread.id),
    ["first", "second"],
  );

  state = updateThread(state, "second", {
    name: " Second renamed ",
    projectId: "other-project",
  });

  assert.deepEqual(state.threadOrder, ["first", "second", "third"]);
  assert.equal(state.threads.second.name, "Second renamed");
  assert.equal(state.threads.second.projectId, "other-project");
  assert.equal(countProjectThreads(state, "project"), 1);
  assert.equal(countProjectThreads(state, "other-project"), 2);

  const unchanged = updateThread(state, "second", { name: "   " });
  assert.equal(unchanged, state);

  state = createBlock(state, "second", "Removed Block", "removed-block");
  state = deleteThread(state, "second");
  assert.equal(state.threads.second, undefined);
  assert.equal(state.blocks["removed-block"], undefined);
  assert.deepEqual(state.threadOrder, ["first", "third"]);
});

test("Manual Thread reorder affects only one Project's Thread slots", () => {
  let state = createEmptyThreadsState();
  state = createProject(state, "Project", "stories", "project");
  state = createProject(state, "Other Project", "tools", "other-project");
  state = createThread(state, "First", "project", "first");
  state = createThread(state, "Other First", "other-project", "other-first");
  state = createThread(state, "Second", "project", "second");
  state = createThread(state, "Other Second", "other-project", "other-second");
  state = createThread(state, "Third", "project", "third");

  let result = moveThreadInProject(state, "second", "up");
  assert.equal(result.error, null);
  state = result.state;
  assert.deepEqual(state.threadOrder, [
    "second",
    "other-first",
    "first",
    "other-second",
    "third",
  ]);
  assert.deepEqual(
    getProjectThreads(state, "project").map((thread) => thread.id),
    ["second", "first", "third"],
  );
  assert.deepEqual(
    getProjectThreads(state, "other-project").map((thread) => thread.id),
    ["other-first", "other-second"],
  );

  result = moveThreadInProject(state, "second", "up");
  assert.equal(result.state, state);
  assert.match(result.error ?? "", /top/);

  result = moveThreadInProject(state, "first", "down");
  assert.equal(result.error, null);
  state = result.state;
  assert.deepEqual(state.threadOrder, [
    "second",
    "other-first",
    "third",
    "other-second",
    "first",
  ]);

  state = deleteThread(state, "third");
  assert.deepEqual(state.threadOrder, [
    "second",
    "other-first",
    "other-second",
    "first",
  ]);
});

test("Blocks are created, edited, counted, and deleted inside one Thread", () => {
  let state = createFixture();
  assert.equal(countThreadBlocks(state, "thread-alpha"), 3);
  assert.equal(countThreadBlocks(state, "thread-beta"), 1);

  state = updateBlockText(state, "beta", " Beta revised ");
  assert.equal(state.blocks.beta.text, "Beta revised");
  assert.equal(updateBlockText(state, "beta", "   "), state);

  state = deleteBlockEverywhere(state, "beta");

  assert.equal(state.blocks.beta, undefined);
  assert.equal(state.blockPlacements.beta, undefined);
  assert.deepEqual(state.blockOrder, ["alpha", "gamma", "other"]);
  assert.deepEqual(state.blockPlacementOrder, ["alpha", "gamma", "other"]);
  assert.equal(countThreadBlocks(state, "thread-alpha"), 2);
});

test("Strict ties require same-thread adjacency and set reciprocal before and after values", () => {
  let state = createFixture();

  let result = setStrictTie(state, "alpha", "after", "gamma");
  assert.equal(result.state, state);
  assert.match(result.error ?? "", /adjacent/);

  result = setStrictTie(state, "alpha", "after", "other");
  assert.equal(result.state, state);
  assert.match(result.error ?? "", /same thread/);

  result = setStrictTie(state, "alpha", "after", "beta");
  assert.equal(result.error, null);
  state = result.state;
  assert.equal(state.blockPlacements.alpha.strictTies.after, "beta");
  assert.equal(state.blockPlacements.beta.strictTies.before, "alpha");

  result = setStrictTie(state, "gamma", "before", "beta");
  assert.equal(result.error, null);
  state = result.state;
  assert.equal(state.blockPlacements.gamma.strictTies.before, "beta");
  assert.equal(state.blockPlacements.beta.strictTies.after, "gamma");
});

test("Strict ties can be cleared without changing loose order", () => {
  let state = createFixture();
  state = setStrictTie(state, "alpha", "after", "beta").state;

  state = clearStrictTie(state, "alpha", "after");

  assert.equal(state.blockPlacements.alpha.strictTies.after, null);
  assert.equal(state.blockPlacements.beta.strictTies.before, null);
  assert.deepEqual(threadOrder(state), ["alpha", "beta", "gamma"]);
});

test("Loose order moves untied Blocks without creating strict ties", () => {
  let state = createFixture();
  const result = moveBlockInThread(state, "gamma", "up");

  assert.equal(result.error, null);
  state = result.state;
  assert.deepEqual(threadOrder(state), ["alpha", "gamma", "beta"]);
  assert.deepEqual(state.blockPlacements.gamma.strictTies, { before: null, after: null });
  assert.deepEqual(getThreadBlockOrder(state, "thread-alpha"), {
    orderedBlockIds: ["alpha", "gamma", "beta"],
    unplacedBlockIds: [],
  });
});

test("Loose order moves the selected strict-tied chain as one segment", () => {
  let state = createFixture();
  state = setStrictTie(state, "alpha", "after", "beta").state;

  const result = moveBlockInThread(state, "beta", "down");

  assert.equal(result.error, null);
  state = result.state;
  assert.deepEqual(threadOrder(state), ["gamma", "alpha", "beta"]);
  assert.equal(state.blockPlacements.alpha.strictTies.after, "beta");
  assert.equal(state.blockPlacements.beta.strictTies.before, "alpha");
});

test("Loose order jumps over neighboring strict-tied segments", () => {
  let state = createFixture();
  state = setStrictTie(state, "alpha", "after", "beta").state;

  let result = moveBlockInThread(state, "gamma", "up");

  assert.equal(result.error, null);
  state = result.state;
  assert.deepEqual(threadOrder(state), ["gamma", "alpha", "beta"]);
  assert.equal(state.blockPlacements.alpha.strictTies.after, "beta");
  assert.equal(state.blockPlacements.beta.strictTies.before, "alpha");

  state = createFixture();
  state = setStrictTie(state, "beta", "after", "gamma").state;

  result = moveBlockInThread(state, "alpha", "down");

  assert.equal(result.error, null);
  state = result.state;
  assert.deepEqual(threadOrder(state), ["beta", "gamma", "alpha"]);
  assert.equal(state.blockPlacements.beta.strictTies.after, "gamma");
  assert.equal(state.blockPlacements.gamma.strictTies.before, "beta");
});

test("Existing Blocks can be placed in another Thread with shared content", () => {
  let state = createFixture();

  let result = addExistingBlockPlacement(state, "thread-beta", "beta", "beta-party");
  assert.equal(result.error, null);
  state = result.state;

  assert.equal(countBlockPlacements(state, "beta"), 2);
  assert.deepEqual(getBlockPlacementIds(state, "beta"), ["beta", "beta-party"]);
  assert.deepEqual(getThreadDisplayBlockIds(state, "thread-beta"), ["other", "beta"]);
  assert.deepEqual(getThreadDisplayPlacementIds(state, "thread-beta"), ["other", "beta-party"]);

  state = updateBlockText(state, "beta", "Shared firework");
  assert.equal(state.blocks.beta.text, "Shared firework");
  assert.equal(state.blocks[state.blockPlacements["beta-party"].blockId].text, "Shared firework");

  result = addExistingBlockPlacement(state, "thread-beta", "beta", "beta-party-duplicate");
  assert.equal(result.state, state);
  assert.match(result.error ?? "", /already in this Thread/);
});

test("Shared Block strict ties and loose order are independent per placement", () => {
  let state = createFixture();
  state = addExistingBlockPlacement(state, "thread-beta", "beta", "beta-party").state;

  state = setStrictTie(state, "alpha", "after", "beta").state;
  state = setStrictTie(state, "other", "after", "beta-party").state;

  assert.equal(state.blockPlacements.beta.strictTies.before, "alpha");
  assert.equal(state.blockPlacements["beta-party"].strictTies.before, "other");

  state = clearStrictTie(state, "alpha", "after");
  assert.equal(state.blockPlacements.beta.strictTies.before, null);
  assert.equal(state.blockPlacements["beta-party"].strictTies.before, "other");

  state = clearStrictTie(state, "other", "after");
  const result = moveBlockInThread(state, "beta-party", "up");
  assert.equal(result.error, null);
  state = result.state;

  assert.deepEqual(getThreadDisplayBlockIds(state, "thread-alpha"), ["alpha", "beta", "gamma"]);
  assert.deepEqual(getThreadDisplayBlockIds(state, "thread-beta"), ["beta", "other"]);
});

test("Removing one placement preserves shared content and Links until the final placement is removed", () => {
  let state = createFixture();
  state = addExistingBlockPlacement(state, "thread-beta", "beta", "beta-party").state;
  state = createCrossThreadLooseTie(state, "beta", "other", "link-1").state;

  state = removeBlockPlacement(state, "beta-party");

  assert.equal(state.blocks.beta.text, "Beta");
  assert.equal(countBlockPlacements(state, "beta"), 1);
  assert.equal(state.crossThreadLooseTies["link-1"].sourceBlockId, "beta");
  assert.deepEqual(getThreadDisplayBlockIds(state, "thread-beta"), ["other"]);

  state = removeBlockPlacement(state, "beta");

  assert.equal(state.blocks.beta, undefined);
  assert.equal(state.blockPlacements.beta, undefined);
  assert.equal(state.crossThreadLooseTies["link-1"], undefined);
  assert.deepEqual(state.crossThreadLooseTieOrder, []);
});

test("Deleting a shared Block everywhere removes all placements, strict ties, and Links", () => {
  let state = createFixture();
  state = addExistingBlockPlacement(state, "thread-beta", "beta", "beta-party").state;
  state = setStrictTie(state, "alpha", "after", "beta").state;
  state = setStrictTie(state, "other", "after", "beta-party").state;
  state = createCrossThreadLooseTie(state, "beta", "other", "link-1").state;

  state = deleteBlockEverywhere(state, "beta");

  assert.equal(state.blocks.beta, undefined);
  assert.equal(state.blockPlacements.beta, undefined);
  assert.equal(state.blockPlacements["beta-party"], undefined);
  assert.equal(state.blockPlacements.alpha.strictTies.after, null);
  assert.equal(state.blockPlacements.other.strictTies.after, null);
  assert.equal(state.crossThreadLooseTies["link-1"], undefined);
  assert.deepEqual(getThreadDisplayBlockIds(state, "thread-alpha"), ["alpha", "gamma"]);
  assert.deepEqual(getThreadDisplayBlockIds(state, "thread-beta"), ["other"]);
});

test("Deleting Threads removes placements only and preserves shared Blocks elsewhere", () => {
  let state = createFixture();
  state = addExistingBlockPlacement(state, "thread-beta", "beta", "beta-party").state;
  state = createCrossThreadLooseTie(state, "beta", "other", "link-1").state;

  state = deleteThread(state, "thread-alpha");

  assert.equal(state.threads["thread-alpha"], undefined);
  assert.equal(state.blocks.beta.text, "Beta");
  assert.deepEqual(getBlockPlacementIds(state, "beta"), ["beta-party"]);
  assert.deepEqual(getThreadDisplayBlockIds(state, "thread-beta"), ["other", "beta"]);
  assert.equal(state.crossThreadLooseTies["link-1"].sourceBlockId, "beta");
});

test("Cross-thread loose ties are directional annotations and do not affect order", () => {
  let state = createFixture();

  let result = createCrossThreadLooseTie(state, "alpha", "other", "link-1");
  assert.equal(result.error, null);
  state = result.state;

  assert.deepEqual(
    getOutgoingCrossThreadLooseTies(state, "alpha").map((tie) => tie.id),
    ["link-1"],
  );
  assert.deepEqual(
    getIncomingCrossThreadLooseTies(state, "other").map((tie) => tie.id),
    ["link-1"],
  );
  assert.deepEqual(getIncomingCrossThreadLooseTies(state, "alpha"), []);
  assert.deepEqual(threadOrder(state), ["alpha", "beta", "gamma"]);

  result = createCrossThreadLooseTie(state, "alpha", "other", "link-duplicate");
  assert.equal(result.state, state);
  assert.match(result.error ?? "", /already exists/);

  result = createCrossThreadLooseTie(state, "alpha", "beta", "link-2");
  assert.equal(result.error, null);
  state = result.state;
  assert.deepEqual(
    getOutgoingCrossThreadLooseTies(state, "alpha").map((tie) => tie.id),
    ["link-1", "link-2"],
  );

  state = deleteCrossThreadLooseTie(state, "link-1");
  assert.deepEqual(
    getOutgoingCrossThreadLooseTies(state, "alpha").map((tie) => tie.id),
    ["link-2"],
  );
});

test("Deleting Blocks clears strict ties and cross-thread loose ties", () => {
  let state = createFixture();
  state = setStrictTie(state, "alpha", "after", "beta").state;
  state = createCrossThreadLooseTie(state, "beta", "other", "link-1").state;
  state = createCrossThreadLooseTie(state, "other", "beta", "link-2").state;

  state = deleteBlockEverywhere(state, "beta");

  assert.equal(state.blockPlacements.alpha.strictTies.after, null);
  assert.equal(state.crossThreadLooseTies["link-1"], undefined);
  assert.equal(state.crossThreadLooseTies["link-2"], undefined);
  assert.deepEqual(state.crossThreadLooseTieOrder, []);
});

test("Threads parser normalizes malformed v4 state, strict ties, and callback links", () => {
  const parsed = parseThreadsState(JSON.stringify({
    version: 4,
    projectOrder: ["alpha-project", "missing", "alpha-project"],
    threadOrder: ["alpha-thread", "missing", "alpha-thread"],
    blockOrder: ["alpha", "bravo", "cross-thread", "unused", "missing", "alpha"],
    blockPlacementOrder: ["alpha-place", "bravo-place", "cross-place", "duplicate-place", "missing", "alpha-place"],
    crossThreadLooseTieOrder: ["valid-link", "self-link", "valid-link"],
    projects: {
      "alpha-project": {
        id: "alpha-project",
        name: " Alpha project ",
        categoryId: "tools",
      },
      "beta-project": {
        id: "beta-project",
        name: "Beta project",
        categoryId: "games",
      },
      invalid: {
        id: "invalid",
        name: "Invalid",
        categoryId: "unknown",
      },
    },
    threads: {
      "alpha-thread": {
        id: "alpha-thread",
        name: " Alpha thread ",
        projectId: "alpha-project",
      },
      "beta-thread": {
        id: "beta-thread",
        name: "Beta thread",
        projectId: "beta-project",
      },
      orphan: {
        id: "orphan",
        name: "Discard me",
        projectId: "missing",
      },
    },
    blocks: {
      alpha: { id: "alpha", text: " Alpha " },
      bravo: { id: "bravo", text: "Bravo" },
      "cross-thread": { id: "cross-thread", text: "Other" },
      unused: { id: "unused", text: "Prune me" },
      orphan: { id: "orphan", text: "Discard me" },
    },
    blockPlacements: {
      "alpha-place": {
        id: "alpha-place",
        blockId: "alpha",
        threadId: "alpha-thread",
        strictTies: { before: null, after: "bravo-place" },
      },
      "bravo-place": {
        id: "bravo-place",
        blockId: "bravo",
        threadId: "alpha-thread",
        strictTies: { before: "alpha-place", after: "cross-place" },
      },
      "cross-place": {
        id: "cross-place",
        blockId: "cross-thread",
        threadId: "beta-thread",
        strictTies: { before: "bravo-place", after: null },
      },
      "duplicate-place": {
        id: "duplicate-place",
        blockId: "alpha",
        threadId: "alpha-thread",
        strictTies: { before: null, after: null },
      },
      "orphan-place": {
        id: "orphan-place",
        blockId: "orphan",
        threadId: "missing",
        strictTies: { before: null, after: null },
      },
    },
    crossThreadLooseTies: {
      "valid-link": {
        id: "valid-link",
        sourceBlockId: "alpha",
        targetBlockId: "cross-thread",
      },
      "self-link": {
        id: "self-link",
        sourceBlockId: "alpha",
        targetBlockId: "alpha",
      },
      "missing-link": {
        id: "missing-link",
        sourceBlockId: "alpha",
        targetBlockId: "missing",
      },
    },
  }));

  assert.equal(parsed.version, 4);
  assert.deepEqual(parsed.projectOrder, ["alpha-project", "beta-project"]);
  assert.deepEqual(parsed.threadOrder, ["alpha-thread", "beta-thread"]);
  assert.equal(parsed.projects["alpha-project"].name, "Alpha project");
  assert.equal(parsed.projects.invalid, undefined);
  assert.equal(parsed.threads.orphan, undefined);
  assert.equal(parsed.blocks.orphan, undefined);
  assert.equal(parsed.blocks.unused, undefined);
  assert.equal(parsed.blockPlacements["alpha-place"].strictTies.after, "bravo-place");
  assert.equal(parsed.blockPlacements["bravo-place"].strictTies.before, "alpha-place");
  assert.equal(parsed.blockPlacements["bravo-place"].strictTies.after, null);
  assert.equal(parsed.blockPlacements["cross-place"].strictTies.before, null);
  assert.equal(parsed.blockPlacements["duplicate-place"], undefined);
  assert.deepEqual(parsed.blockOrder, ["alpha", "bravo", "cross-thread"]);
  assert.deepEqual(parsed.blockPlacementOrder, ["alpha-place", "bravo-place", "cross-place"]);
  assert.deepEqual(parsed.crossThreadLooseTieOrder, ["valid-link"]);
});

test("Threads migration imports v3 state as Blocks plus one placement each", () => {
  const migrated = parseThreadsState(JSON.stringify({
    version: 3,
    projectOrder: ["alpha-project", "beta-project"],
    threadOrder: ["alpha-thread", "beta-thread"],
    blockOrder: ["alpha", "bravo", "cross-thread"],
    crossThreadLooseTieOrder: ["valid-link"],
    projects: {
      "alpha-project": {
        id: "alpha-project",
        name: " Alpha project ",
        categoryId: "tools",
      },
      "beta-project": {
        id: "beta-project",
        name: "Beta project",
        categoryId: "games",
      },
    },
    threads: {
      "alpha-thread": {
        id: "alpha-thread",
        name: " Alpha thread ",
        projectId: "alpha-project",
      },
      "beta-thread": {
        id: "beta-thread",
        name: "Beta thread",
        projectId: "beta-project",
      },
    },
    blocks: {
      alpha: {
        id: "alpha",
        threadId: "alpha-thread",
        text: " Alpha ",
        strictTies: { before: null, after: "bravo" },
      },
      bravo: {
        id: "bravo",
        threadId: "alpha-thread",
        text: "Bravo",
        strictTies: { before: "alpha", after: "cross-thread" },
      },
      "cross-thread": {
        id: "cross-thread",
        threadId: "beta-thread",
        text: "Other",
        strictTies: { before: "bravo", after: null },
      },
    },
    crossThreadLooseTies: {
      "valid-link": {
        id: "valid-link",
        sourceBlockId: "alpha",
        targetBlockId: "cross-thread",
      },
    },
  }));

  assert.equal(migrated.version, 4);
  assert.equal(migrated.blocks.alpha.text, "Alpha");
  assert.deepEqual(migrated.blockOrder, ["alpha", "bravo", "cross-thread"]);
  assert.deepEqual(migrated.blockPlacementOrder, ["alpha", "bravo", "cross-thread"]);
  assert.equal(migrated.blockPlacements.alpha.blockId, "alpha");
  assert.equal(migrated.blockPlacements.alpha.threadId, "alpha-thread");
  assert.equal(migrated.blockPlacements.alpha.strictTies.after, "bravo");
  assert.equal(migrated.blockPlacements.bravo.strictTies.before, "alpha");
  assert.equal(migrated.blockPlacements.bravo.strictTies.after, null);
  assert.equal(migrated.blockPlacements["cross-thread"].strictTies.before, null);
  assert.deepEqual(migrated.crossThreadLooseTieOrder, ["valid-link"]);
});

test("Threads migration imports v2 state as loose order and adjacent strict ties", () => {
  const migrated = migrateLegacyThreadsState(JSON.stringify({
    version: 2,
    projectOrder: ["alpha-project"],
    threadOrder: ["alpha-thread"],
    blockOrder: ["gamma", "alpha", "beta"],
    projects: {
      "alpha-project": {
        id: "alpha-project",
        name: "Alpha Project",
        categoryId: "tools",
      },
    },
    threads: {
      "alpha-thread": {
        id: "alpha-thread",
        name: "Alpha Thread",
        projectId: "alpha-project",
      },
    },
    blocks: {
      alpha: {
        id: "alpha",
        threadId: "alpha-thread",
        text: "Alpha",
        ties: { before: null, after: "beta" },
      },
      beta: {
        id: "beta",
        threadId: "alpha-thread",
        text: "Beta",
        ties: { before: "alpha", after: "gamma" },
      },
      gamma: {
        id: "gamma",
        threadId: "alpha-thread",
        text: "Gamma",
        ties: { before: "beta", after: null },
      },
    },
  }));

  assert.equal(migrated.version, 4);
  assert.deepEqual(getThreadDisplayBlockIds(migrated, "alpha-thread"), [
    "alpha",
    "beta",
    "gamma",
  ]);
  assert.equal(migrated.blockPlacements.alpha.strictTies.after, "beta");
  assert.equal(migrated.blockPlacements.beta.strictTies.before, "alpha");
  assert.equal(migrated.blockPlacements.beta.strictTies.after, "gamma");
  assert.deepEqual(migrated.crossThreadLooseTies, {});
});

test("Threads migration imports legacy v1 Thread records as Projects only", () => {
  const migrated = migrateLegacyThreadsState(null, JSON.stringify({
    version: 1,
    threadOrder: ["alpha-thread", "beta-thread"],
    threads: {
      "alpha-thread": {
        id: "alpha-thread",
        name: "Alpha Project",
        categoryId: "tools",
      },
      "beta-thread": {
        id: "beta-thread",
        name: "Beta Project",
        categoryId: "games",
      },
    },
    blocks: {
      alpha: {
        id: "alpha",
        threadId: "alpha-thread",
        text: "Alpha",
        ties: { before: null, after: null },
      },
    },
  }));

  assert.deepEqual(migrated.projectOrder, ["alpha-thread", "beta-thread"]);
  assert.equal(migrated.projects["alpha-thread"].name, "Alpha Project");
  assert.equal(migrated.projects["alpha-thread"].categoryId, "tools");
  assert.equal(migrated.projects["beta-thread"].name, "Beta Project");
  assert.deepEqual(migrated.threads, {});
  assert.deepEqual(migrated.threadOrder, []);
  assert.deepEqual(migrated.blocks, {});
  assert.deepEqual(migrated.blockOrder, []);
});

test("Threads migration imports legacy Systems Syntax Projects only", () => {
  const migrated = migrateLegacyThreadsState(null, null, JSON.stringify({
    version: 2,
    projectOrder: ["alpha-project", "beta-project"],
    projects: {
      "alpha-project": {
        id: "alpha-project",
        name: "Alpha Project",
        categoryId: "tools",
        rootBlockIds: ["alpha"],
      },
      "beta-project": {
        id: "beta-project",
        name: "Beta Project",
        categoryId: "games",
        rootBlockIds: [],
      },
    },
    blocks: {
      alpha: {
        id: "alpha",
        projectId: "alpha-project",
        name: "Alpha",
        parentId: null,
        children: [],
      },
    },
  }));

  assert.deepEqual(migrated.projectOrder, ["alpha-project", "beta-project"]);
  assert.equal(migrated.projects["alpha-project"].name, "Alpha Project");
  assert.equal(migrated.projects["alpha-project"].categoryId, "tools");
  assert.equal(migrated.projects["beta-project"].name, "Beta Project");
  assert.deepEqual(migrated.threads, {});
  assert.deepEqual(migrated.blocks, {});
});
